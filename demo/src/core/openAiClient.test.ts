import { describe, expect, it } from 'vitest'
import { AiError } from './aiError'
import type { ChatRequest, ChatTransport } from './chatTransport'
import { createInterview, openBlock } from './interview'
import { createOpenAiClient } from './openAiClient'
import { DEFAULT_FOLLOWUP_CAP, FOLLOWUP_CAPS, pointsOf, spoken } from './script'
import {
  createEmptyResult,
  type AppConfig,
  type ChatMessage,
  type Depth,
  type Dimension,
  type InterviewState,
  type WeeklyResult,
} from './types'

const PERSONA = '你是一个测试人设：说话像老同事，不爱客套。'

const CONFIG: AppConfig = {
  apiKey: 'sk-test',
  baseUrl: 'https://api.example.com/v1',
  model: 'test-model',
  persona: { prompt: PERSONA, preset: 'custom' },
}

/**
 * 按剧本回答的假传输层：既能断言「到底发了什么出去」，
 * 也能模拟流式吐字与网络失败，整个测试不碰网络。
 */
function scriptedTransport(script: Array<string | Error>) {
  const seen: ChatRequest[] = []
  const transport: ChatTransport = {
    async send(req, onDelta) {
      seen.push(req)
      const next = script.shift()
      if (next instanceof Error) throw next
      const text = next ?? ''
      if (onDelta) for (const ch of text) onDelta(ch)
      return text
    },
  }
  return { transport, seen }
}

let seq = 0
function msg(role: 'ai' | 'user', text: string, dimension: Dimension): ChatMessage {
  seq += 1
  return { id: `m${seq}`, role, text, dimension, at: seq }
}

const HISTORY = [
  msg('ai', '这周主要忙了些什么？', 'event'),
  msg('user', '在改客户那个方案，改了三版还没定', 'event'),
]

function withFollowUps(count: number, depth: Depth | null = null): InterviewState {
  const base = createInterview()
  return {
    active: 'event',
    blocks: {
      ...base.blocks,
      event: { ...base.blocks.event, followUpCount: count },
    },
    // 状态卡与档位都已经过去了，这里只测区块内的一轮
    stateDone: true,
    lowKeys: [],
    depth,
  }
}

/**
 * 这一块的要点已经聊完，用户还想接着说。
 * 追问次数刻意给到深度档上限，用来证明自由聊确实不受上限约束。
 */
function inFreeChat(freeTurns = 1, followUpCount = FOLLOWUP_CAPS.deep): InterviewState {
  const base = createInterview()
  return {
    active: 'event',
    blocks: {
      ...base.blocks,
      event: { ...base.blocks.event, complete: true, freeTurns, followUpCount },
    },
    stateDone: true,
    lowKeys: [],
    depth: 'deep',
  }
}

describe('真实模型客户端 · 一轮回复', () => {
  it('读出 [追问] 标记，并且不把标记带进正文', async () => {
    const { transport } = scriptedTransport(['[追问]\n这件事哪一部分最花时间？'])
    const ai = createOpenAiClient({ transport, config: CONFIG })
    const turn = await ai.reply(openBlock(createInterview(), 'event'), 'event', HISTORY)
    expect(turn.action).toBe('followup')
    expect(turn.message).toBe('这件事哪一部分最花时间？')
  })

  it('[换题] 时换到下一题', async () => {
    const { transport } = scriptedTransport(['[换题]那有没有本来打算做、结果没做成的事？'])
    const ai = createOpenAiClient({ transport, config: CONFIG })
    const turn = await ai.reply(openBlock(createInterview(), 'event'), 'event', HISTORY)
    expect(turn.action).toBe('next')
    expect(turn.message).toContain('本来打算做')
  })

  it('[换块] 时这一块收尾，交给上层开下一块', async () => {
    const { transport } = scriptedTransport(['[换块]这块先到这儿，接着聊聊人。'])
    const ai = createOpenAiClient({ transport, config: CONFIG })
    const turn = await ai.reply(openBlock(createInterview(), 'event'), 'event', HISTORY)
    expect(turn.action).toBe('block')
    expect(turn.message).toBe('这块先到这儿，接着聊聊人。')
  })

  it('状态机才是追问次数的最终裁判：模型想追问但已到上限，按换题处理', async () => {
    const { transport } = scriptedTransport(['[追问]\n再问一句'])
    const ai = createOpenAiClient({ transport, config: CONFIG })
    const turn = await ai.reply(withFollowUps(DEFAULT_FOLLOWUP_CAP), 'event', HISTORY)
    expect(turn.action).toBe('next')
    // 降级只改动作，模型说的话照旧给出来
    expect(turn.message).toBe('再问一句')
  })

  it('快速档只允许追一次，到顶后模型说要追也降级成换题', async () => {
    const { transport } = scriptedTransport(['[追问]\n再问一句'])
    const ai = createOpenAiClient({ transport, config: CONFIG })
    const turn = await ai.reply(withFollowUps(FOLLOWUP_CAPS.fast, 'fast'), 'event', HISTORY)
    expect(turn.action).toBe('next')
  })

  it('模型没给标记时按换题处理，保证每个区块都被覆盖', async () => {
    const { transport } = scriptedTransport(['那后来呢？'])
    const ai = createOpenAiClient({ transport, config: CONFIG })
    const turn = await ai.reply(openBlock(createInterview(), 'event'), 'event', HISTORY)
    expect(turn.action).toBe('next')
    expect(turn.message).toBe('那后来呢？')
  })

  it('模型一句话都没说时退回脚本要点，界面不会留空气泡', async () => {
    const { transport } = scriptedTransport(['[追问]\n   '])
    const ai = createOpenAiClient({ transport, config: CONFIG })
    const turn = await ai.reply(openBlock(createInterview(), 'event'), 'event', HISTORY)
    expect(turn.action).toBe('followup')
    // 退回的是「还没聊到的第一个要点」的锚点，不是某道「题」
    expect(turn.message).toBe(spoken(pointsOf('event')[0]))
  })

  it('一次请求就够了：带上模型名、完整对话与进度信息', async () => {
    const { transport, seen } = scriptedTransport(['[换题]下一题'])
    const ai = createOpenAiClient({ transport, config: CONFIG })
    await ai.reply(openBlock(createInterview(), 'event'), 'event', HISTORY)

    expect(seen).toHaveLength(1)
    expect(seen[0].model).toBe('test-model')
    expect(seen[0].baseUrl).toBe('https://api.example.com/v1')
    expect(seen[0].json).toBeFalsy()

    const payload = JSON.stringify(seen[0].messages)
    expect(payload).toContain('这周主要忙了些什么')
    expect(payload).toContain('同一个话题已经连着追了 0 次')
    expect(payload).toContain('在改客户那个方案')
  })

  it('流式增量会原样转发给上层', async () => {
    const { transport } = scriptedTransport(['[换题]好'])
    const ai = createOpenAiClient({ transport, config: CONFIG })
    const pieces: string[] = []
    await ai.reply(openBlock(createInterview(), 'event'), 'event', HISTORY, (d) => pieces.push(d))
    expect(pieces.join('')).toBe('[换题]好')
  })
})

describe('真实模型客户端 · 专属采访者', () => {
  it('用户写的人设原样进了请求，机器约定跟在后面', async () => {
    const { transport, seen } = scriptedTransport(['[换题]下一题'])
    const ai = createOpenAiClient({ transport, config: CONFIG })
    await ai.reply(openBlock(createInterview(), 'event'), 'event', HISTORY)

    const system = seen[0].messages.find((m) => m.role === 'system')?.content ?? ''
    expect(system).toContain(PERSONA)
    expect(system).toContain('[追问]')
    expect(system).toContain('[换题]')
    expect(system).toContain('[换块]')
    expect(system).toContain('不要编造')
  })

  it('换一段人设就换一套口气，不用重启应用', async () => {
    const { transport, seen } = scriptedTransport(['[换题]一', '[换题]二'])
    const first = createOpenAiClient({
      transport,
      config: { ...CONFIG, persona: { prompt: 'A 人设', preset: 'custom' } },
    })
    await first.reply(openBlock(createInterview(), 'event'), 'event', HISTORY)

    const second = createOpenAiClient({
      transport,
      config: { ...CONFIG, persona: { prompt: 'B 人设', preset: 'custom' } },
    })
    await second.reply(openBlock(createInterview(), 'event'), 'event', HISTORY)

    expect(JSON.stringify(seen[0].messages)).toContain('A 人设')
    expect(JSON.stringify(seen[1].messages)).toContain('B 人设')
  })

  it('要点聊完之后还能追：自由聊不受追问上限约束', async () => {
    const { transport } = scriptedTransport(['[追问]\n那这件事后来呢？'])
    const ai = createOpenAiClient({ transport, config: CONFIG })
    const turn = await ai.reply(inFreeChat(), 'event', HISTORY)
    expect(turn.action).toBe('followup')
    expect(turn.message).toBe('那这件事后来呢？')
  })

  it('自由聊时模型不说话，也不会把要点的锚点再念一遍', async () => {
    const { transport } = scriptedTransport(['[追问]\n   '])
    const ai = createOpenAiClient({ transport, config: CONFIG })
    const turn = await ai.reply(inFreeChat(), 'event', HISTORY)
    expect(turn.action).toBe('followup')
    // 要点都聊完了，只能给一句中性的搭话
    expect(turn.message).toBe('嗯，还有呢？')
    expect(turn.message.trim().length).toBeGreaterThan(0)
    // 要点锚点就是「旧题」的等价物：自由聊里一句都不该被念出来
    for (const point of pointsOf('event')) {
      expect(spoken(point).length).toBeGreaterThan(0)
      expect(turn.message).not.toContain(spoken(point))
    }
  })
})

describe('真实模型客户端 · 区块开场', () => {
  it('开场白也会摘掉可能冒出来的标记', async () => {
    const { transport } = scriptedTransport(['[换题]这周买了什么？'])
    const ai = createOpenAiClient({ transport, config: CONFIG })
    expect(await ai.nextMessage(openBlock(createInterview(), 'thing'), 'thing', [])).toBe(
      '这周买了什么？',
    )
  })

  it('模型返回空白时退回脚本里的问题', async () => {
    const { transport } = scriptedTransport(['   '])
    const ai = createOpenAiClient({ transport, config: CONFIG })
    expect(await ai.nextMessage(openBlock(createInterview(), 'thing'), 'thing', [])).toContain(
      '这周买了点什么',
    )
  })
})

describe('真实模型客户端 · 生成结果', () => {
  const GOOD = JSON.stringify({
    events: ['改了三版方案'],
    people: [{ name: '老王', note: '一直没拍板' }],
    things: ['买了个键盘'],
    pending: ['报销拖了两周没交'],
    growth: ['开始用周复盘模板梳理自己'],
    highlights: ['方案难产是这周主线'],
    nextFocus: ['推动方案定稿', '联系老王', '留出整块时间'],
    nextFollowUps: ['老王'],
  })

  it('解析模型返回的 JSON', async () => {
    const { transport } = scriptedTransport([GOOD])
    const ai = createOpenAiClient({ transport, config: CONFIG })
    const r = await ai.summarize([msg('user', '在改方案', 'event')])
    expect(r.events).toEqual(['改了三版方案'])
    expect(r.people[0].name).toBe('老王')
    expect(r.nextFocus).toHaveLength(3)
    expect(r.growth).toEqual(['开始用周复盘模板梳理自己'])
    // 状态分数不再是模型产的：模型不给 state，结果里也就没有分数
    expect(r.state).toEqual({ note: '' })
    expect('scores' in r.state).toBe(false)
  })

  it('生成时要求 JSON 模式', async () => {
    const { transport, seen } = scriptedTransport([GOOD])
    const ai = createOpenAiClient({ transport, config: CONFIG })
    await ai.summarize([])
    expect(seen[0].json).toBe(true)
  })

  it('生成提示词里要成长，不要状态分数', async () => {
    const { transport, seen } = scriptedTransport([GOOD])
    const ai = createOpenAiClient({ transport, config: CONFIG })
    await ai.summarize([msg('user', '在改方案', 'event')])
    const prompt = seen[0].messages.map((m) => m.content).join('\n')
    expect(prompt).toContain('growth')
    // 状态是开场那张打分卡的事，模型不产分数，也就不该被要求填 state
    expect(prompt).not.toContain('"state"')
  })

  it('模型返回一坨垃圾时降级不崩，并说明原因', async () => {
    const { transport } = scriptedTransport(['完全不是 JSON'])
    const ai = createOpenAiClient({ transport, config: CONFIG })
    const r = await ai.summarize([msg('user', '在改方案', 'event')])
    expect(r.events).toEqual([])
    expect(r.highlights.join(' ')).toContain('没能整理成功')
    expect(r.nextFocus.length).toBeGreaterThan(0)
  })

  it('网络层报错时照实往上抛，不伪装成结果', async () => {
    const { transport } = scriptedTransport([new AiError('API Key 不对')])
    const ai = createOpenAiClient({ transport, config: CONFIG })
    await expect(ai.summarize([])).rejects.toThrow('API Key 不对')
  })
})

describe('真实模型客户端 · 重新整理', () => {
  const CURRENT: WeeklyResult = {
    ...createEmptyResult(),
    events: ['我手改的那一条'],
    people: [{ name: '老王', note: '我写的备注' }],
    highlights: ['旧热点'],
    nextFocus: ['旧重点'],
    nextFollowUps: ['老王'],
    // 状态分数是用户在打分卡上亲手点的，重新整理不该动它
    state: { note: '我自己写的备注', scores: { mood: 4 } },
  }

  it('模型想改用户手改的清单也改不掉', async () => {
    const modelSays = JSON.stringify({
      events: ['模型自己编的'],
      people: [{ name: '老王', note: '模型改的备注' }],
      things: [],
      pending: [],
      growth: ['模型给的成长'],
      highlights: ['新热点'],
      nextFocus: ['新重点'],
      nextFollowUps: ['小李'],
      state: { note: '模型想改的备注', scores: { mood: 1 } },
    })
    const { transport } = scriptedTransport([modelSays])
    const ai = createOpenAiClient({ transport, config: CONFIG })
    const r = await ai.refine([], CURRENT, '下周必须把报价发出去')

    expect(r.events).toEqual(['我手改的那一条', '模型自己编的'])
    expect(r.people[0].note).toBe('我写的备注')
    expect(r.highlights).toEqual(['新热点'])
    expect(r.nextFocus).toEqual(['新重点'])
    expect(r.nextFollowUps).toEqual(['小李'])
    // 成长是模型新增的一栏，合并进来
    expect(r.growth).toEqual(['模型给的成长'])
    // 分数和备注一个字都没变
    expect(r.state).toEqual({ note: '我自己写的备注', scores: { mood: 4 } })
  })

  it('把补充说明和当前结果一起发给模型', async () => {
    const { transport, seen } = scriptedTransport([JSON.stringify({ highlights: ['新'] })])
    const ai = createOpenAiClient({ transport, config: CONFIG })
    await ai.refine([], CURRENT, '下周必须把报价发出去')
    const payload = JSON.stringify(seen[0].messages)
    expect(payload).toContain('下周必须把报价发出去')
    expect(payload).toContain('我手改的那一条')
  })

  it('解析不了就抛错，用户当前的结果原地不动', async () => {
    const { transport } = scriptedTransport(['不是 JSON'])
    const ai = createOpenAiClient({ transport, config: CONFIG })
    await expect(ai.refine([], CURRENT, '补充')).rejects.toThrow('再试一次')
  })
})

describe('真实模型客户端 · 配置校验', () => {
  it('没填 Key 就直接报错，一个请求都不发', async () => {
    const { transport, seen } = scriptedTransport(['x'])
    const ai = createOpenAiClient({ transport, config: { ...CONFIG, apiKey: '  ' } })
    await expect(ai.summarize([])).rejects.toThrow('API Key')
    expect(seen).toHaveLength(0)
  })

  it('没填模型名就直接报错', async () => {
    const { transport, seen } = scriptedTransport(['x'])
    const ai = createOpenAiClient({ transport, config: { ...CONFIG, model: '' } })
    await expect(ai.summarize([])).rejects.toThrow('模型名')
    expect(seen).toHaveLength(0)
  })

  it('没填接口地址就直接报错', async () => {
    const { transport, seen } = scriptedTransport(['x'])
    const ai = createOpenAiClient({ transport, config: { ...CONFIG, baseUrl: '' } })
    await expect(ai.summarize([])).rejects.toThrow('接口地址')
    expect(seen).toHaveLength(0)
  })
})
