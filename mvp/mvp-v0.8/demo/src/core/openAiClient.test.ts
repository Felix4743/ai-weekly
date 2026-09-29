import { describe, expect, it } from 'vitest'
import { AiError } from './aiError'
import type { ChatRequest, ChatTransport } from './chatTransport'
import { createInterview, openBlock } from './interview'
import { createOpenAiClient } from './openAiClient'
import { MAX_FOLLOWUPS_PER_QUESTION, SCRIPT } from './script'
import { createEmptyResult, type AppConfig, type ChatMessage, type Dimension, type WeeklyResult } from './types'

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

function withFollowUps(count: number) {
  const base = createInterview()
  return {
    active: 'event' as const,
    blocks: {
      ...base.blocks,
      event: { askIndex: 0, followUpCount: count, complete: false, freeTurns: 0 },
    },
  }
}

/** 这一块的主问题已经问完，用户还想接着说 */
function inFreeChat(freeTurns = 1) {
  const base = createInterview()
  return {
    active: 'event' as const,
    blocks: { ...base.blocks, event: { ...base.blocks.event, complete: true, freeTurns } },
  }
}

describe('真实模型客户端 · 一轮回复', () => {
  it('读出 [追问] 标记，并且不把标记带进正文', async () => {
    const { transport } = scriptedTransport(['[追问]\n这件事哪一部分最花时间？'])
    const ai = createOpenAiClient({ transport, config: CONFIG })
    const turn = await ai.reply(openBlock(createInterview(), 'event'), 'event', HISTORY)
    expect(turn.wantsFollowUp).toBe(true)
    expect(turn.message).toBe('这件事哪一部分最花时间？')
  })

  it('[换题] 时不追问', async () => {
    const { transport } = scriptedTransport(['[换题]那有没有本来打算做、结果没做成的事？'])
    const ai = createOpenAiClient({ transport, config: CONFIG })
    const turn = await ai.reply(openBlock(createInterview(), 'event'), 'event', HISTORY)
    expect(turn.wantsFollowUp).toBe(false)
    expect(turn.message).toContain('本来打算做')
  })

  it('状态机才是追问次数的最终裁判：模型想追问但已到上限，按换题处理', async () => {
    const { transport } = scriptedTransport(['[追问]\n再问一句'])
    const ai = createOpenAiClient({ transport, config: CONFIG })
    const turn = await ai.reply(withFollowUps(MAX_FOLLOWUPS_PER_QUESTION), 'event', HISTORY)
    expect(turn.wantsFollowUp).toBe(false)
  })

  it('模型没给标记时按换题处理，保证四个区块都被覆盖', async () => {
    const { transport } = scriptedTransport(['那后来呢？'])
    const ai = createOpenAiClient({ transport, config: CONFIG })
    const turn = await ai.reply(openBlock(createInterview(), 'event'), 'event', HISTORY)
    expect(turn.wantsFollowUp).toBe(false)
    expect(turn.message).toBe('那后来呢？')
  })

  it('模型一句话都没说时退回脚本问题，界面不会留空气泡', async () => {
    const { transport } = scriptedTransport(['[追问]\n   '])
    const ai = createOpenAiClient({ transport, config: CONFIG })
    const turn = await ai.reply(openBlock(createInterview(), 'event'), 'event', HISTORY)
    expect(turn.message.trim().length).toBeGreaterThan(0)
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
    expect(payload).toContain('本题已追问 0 次')
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
    expect(system).toContain('一次只问一件事')
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

  it('主问题聊完之后还能追：自由聊不受追问上限约束', async () => {
    const { transport } = scriptedTransport(['[追问]\n那这件事后来呢？'])
    const ai = createOpenAiClient({ transport, config: CONFIG })
    const turn = await ai.reply(inFreeChat(), 'event', HISTORY)
    expect(turn.wantsFollowUp).toBe(true)
    expect(turn.message).toBe('那这件事后来呢？')
  })

  it('自由聊时模型不说话，也不会把最后一道旧题再念一遍', async () => {
    const { transport } = scriptedTransport(['[追问]\n   '])
    const ai = createOpenAiClient({ transport, config: CONFIG })
    const turn = await ai.reply(inFreeChat(), 'event', HISTORY)
    const lastQuestion = SCRIPT[0].mainQuestions[SCRIPT[0].mainQuestions.length - 1]
    expect(turn.message).not.toContain(lastQuestion)
    expect(turn.message.trim().length).toBeGreaterThan(0)
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
      '这周买了什么',
    )
  })
})

describe('真实模型客户端 · 生成结果', () => {
  const GOOD = JSON.stringify({
    events: ['改了三版方案'],
    people: [{ name: '老王', note: '一直没拍板' }],
    things: ['买了个键盘'],
    pending: ['报销拖了两周没交'],
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
  })

  it('生成时要求 JSON 模式', async () => {
    const { transport, seen } = scriptedTransport([GOOD])
    const ai = createOpenAiClient({ transport, config: CONFIG })
    await ai.summarize([])
    expect(seen[0].json).toBe(true)
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
  }

  it('模型想改用户手改的清单也改不掉', async () => {
    const modelSays = JSON.stringify({
      events: ['模型自己编的'],
      people: [{ name: '老王', note: '模型改的备注' }],
      things: [],
      pending: [],
      highlights: ['新热点'],
      nextFocus: ['新重点'],
      nextFollowUps: ['小李'],
    })
    const { transport } = scriptedTransport([modelSays])
    const ai = createOpenAiClient({ transport, config: CONFIG })
    const r = await ai.refine([], CURRENT, '下周必须把报价发出去')

    expect(r.events).toEqual(['我手改的那一条', '模型自己编的'])
    expect(r.people[0].note).toBe('我写的备注')
    expect(r.highlights).toEqual(['新热点'])
    expect(r.nextFocus).toEqual(['新重点'])
    expect(r.nextFollowUps).toEqual(['小李'])
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
