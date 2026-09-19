import { describe, expect, it } from 'vitest'
import { createMockAi, extractName, groupAnswers, isNonAnswer, personHint, sampleAnswer } from './mockAi'
import {
  createInterview,
  currentFollowUp,
  currentQuestion,
  finishAll,
  openBlock,
} from './interview'
import type { BlockProgress, ChatMessage, Dimension, InterviewState } from './types'

const ai = createMockAi({ instant: true })

let seq = 0
function msg(role: 'ai' | 'user', text: string, dimension: Dimension): ChatMessage {
  seq += 1
  return { id: `m${seq}`, role, text, dimension, at: seq }
}

function withBlocks(patch: Partial<Record<Dimension, BlockProgress>>): InterviewState {
  const base = createInterview()
  return { active: null, blocks: { ...base.blocks, ...patch } }
}

const FULL_HISTORY: ChatMessage[] = [
  msg('ai', '周末好。这周主要忙了些什么？', 'event'),
  msg('user', '在改客户那个方案，改了三版了还没定下来。', 'event'),
  msg('user', '本来想把季度数据整理一下，一直没腾出时间。', 'event'),
  msg('ai', '好，说说人。这周跟谁打交道最多？', 'people'),
  msg('user', '主要是跟老王对接方案，还有跟小李吃了顿饭。', 'people'),
  msg('user', '想约张总聊聊明年的方向，但一直没敢开口。', 'people'),
  msg('ai', '再说说东西 —— 这周买了什么、或者添置了什么东西？', 'thing'),
  msg('user', '买了个新键盘，之前那个手感不行，纠结了半个月终于下单了。', 'thing'),
  msg('user', '没有，这周没顾上这些。', 'thing'),
  msg('ai', '换个角度。这周整体感觉怎么样，累不累？', 'mood'),
  msg('user', '挺累的，主要就是方案反复改这件事拖着。', 'mood'),
]

describe('演示用假 AI · 对话', () => {
  it('区块第一次被打开时，给出开场语和第一个问题', async () => {
    const text = await ai.nextMessage(createInterview(), 'event', [])
    expect(text).toContain('周末好')
    expect(text).toContain('这周主要忙了些什么')
  })

  it('不是首次进入时，只问问题，不加开场语', async () => {
    const s = openBlock(createInterview(), 'event')
    const text = await ai.nextMessage(s, 'event', FULL_HISTORY)
    expect(text).toBe(currentQuestion(s, 'event'))
  })

  it('追问态返回追问话术', async () => {
    const s = withBlocks({ event: { askIndex: 0, followUpCount: 1, complete: false } })
    expect(await ai.nextMessage(s, 'event', FULL_HISTORY)).toBe(currentFollowUp(s, 'event'))
  })

  it('区块聊完后给出收尾语，并提示下一块', async () => {
    const s = withBlocks({
      event: { askIndex: 2, followUpCount: 0, complete: true },
      people: { askIndex: 2, followUpCount: 0, complete: true },
      thing: { askIndex: 2, followUpCount: 0, complete: true },
    })
    const text = await ai.nextMessage(s, 'thing', FULL_HISTORY)
    expect(text).toContain('物品')
    expect(text).toContain('状态')
  })

  it('四块都聊完后提示可以生成梳理', async () => {
    const text = await ai.nextMessage(finishAll(createInterview()), 'mood', FULL_HISTORY)
    expect(text).toContain('生成')
  })

  it('回答太短就追问，回答完整就换下一题', async () => {
    const s = createInterview()
    expect(await ai.wantsFollowUp('改方案', s, 'event')).toBe(true)
    expect(
      await ai.wantsFollowUp(
        '这周主要是在改客户那个方案，来回改了三版，中间还开了很多会，最后终于定下来了。',
        s,
        'event',
      ),
    ).toBe(false)
  })

  it('「没有」这类回答不追问，空回答也不追问', async () => {
    const s = createInterview()
    expect(await ai.wantsFollowUp('没有，这周没顾上这些。', s, 'thing')).toBe(false)
    expect(await ai.wantsFollowUp('   ', s, 'event')).toBe(false)
  })

  it('到达追问上限后不再追问', async () => {
    const s = withBlocks({ thing: { askIndex: 0, followUpCount: 2, complete: false } })
    expect(await ai.wantsFollowUp('短', s, 'thing')).toBe(false)
  })
})

describe('演示用假 AI · 人名与归类', () => {
  it('能从中文句子里猜出人名', () => {
    expect(extractName('@张三 那边还没给反馈')).toBe('张三')
    expect(extractName('想约张总聊聊明年的方向，但一直没敢开口。')).toBe('张总')
    expect(extractName('主要是跟老王对接方案，还有跟小李吃了顿饭。')).toBe('老王')
  })

  it('猜不出人名时返回 null，避免把普通句子当成人', () => {
    expect(personHint('要把季度数据整理完')).toBeNull()
    expect(personHint('给自己留出整块时间')).toBeNull()
    expect(personHint('写个总结')).toBeNull()
  })

  it('能识别「没有」这类非回答', () => {
    expect(isNonAnswer('暂时没有，这周没顾上这些。')).toBe(true)
    expect(isNonAnswer('没什么')).toBe(true)
    expect(isNonAnswer('想换个键盘')).toBe(false)
  })

  it('按区块归类用户回答，物品单独一块', () => {
    const grouped = groupAnswers(FULL_HISTORY)
    expect(grouped.event).toHaveLength(2)
    expect(grouped.people).toHaveLength(2)
    expect(grouped.thing).toHaveLength(2)
    expect(grouped.mood).toHaveLength(1)
  })

  it('示例回答覆盖全部四个区块', () => {
    for (const dim of ['event', 'people', 'thing', 'mood'] as Dimension[]) {
      expect(sampleAnswer(dim, 0).length).toBeGreaterThan(0)
    }
    expect(sampleAnswer('event', 4)).toBe(sampleAnswer('event', 0))
  })
})

describe('演示用假 AI · 结果生成', () => {
  it('事情、人际、物品三块都归纳出内容', async () => {
    const r = await ai.summarize(FULL_HISTORY)

    expect(r.events.join(' ')).toContain('客户那个方案')
    expect(r.people.map((p) => p.name)).toEqual(expect.arrayContaining(['老王', '张总']))
    expect(r.things.join(' ')).toContain('键盘')
  })

  it('「没有」这类回答不会被当成一条物品记录', async () => {
    const r = await ai.summarize(FULL_HISTORY)
    expect(r.things.join(' ')).not.toContain('没有')
  })

  it('给出热点与三条下周建议', async () => {
    const r = await ai.summarize(FULL_HISTORY)
    expect(r.highlights.length).toBeGreaterThan(0)
    expect(r.nextFocus).toHaveLength(3)
    expect(r.nextFollowUps.length).toBeGreaterThan(0)
  })

  it('完全没聊到内容时给出兜底结果', async () => {
    const r = await ai.summarize([])
    expect(r.events.length).toBeGreaterThan(0)
    expect(r.highlights.length).toBeGreaterThan(0)
    expect(r.nextFocus.length).toBeGreaterThan(0)
  })

  it('全部回答都是「没有」时也走兜底，不编造内容', async () => {
    const empty: ChatMessage[] = [
      msg('user', '没有。', 'event'),
      msg('user', '暂时没有。', 'people'),
      msg('user', '没什么。', 'thing'),
      msg('user', '还好。', 'mood'),
    ]
    const r = await ai.summarize(empty)
    expect(r.events).toEqual(['（这次没有聊到具体的事情）'])
    expect(r.things).toEqual([])
  })
})

describe('演示用假 AI · 用户补充后重新整理', () => {
  it('尊重用户已经手工做过的修改', async () => {
    const initial = await ai.summarize(FULL_HISTORY)
    const edited = {
      ...initial,
      events: ['我自己改过的事情', ...initial.events],
      people: [...initial.people, { name: '手工加的人', note: '我加的' }],
    }

    const next = await ai.refine(FULL_HISTORY, edited, '下周要跟赵总确认一下预算。')

    expect(next.events).toContain('我自己改过的事情')
    expect(next.people.map((p) => p.name)).toContain('手工加的人')
  })

  it('把补充内容分别识别成人、物品和悬着的事', async () => {
    const initial = await ai.summarize(FULL_HISTORY)
    const next = await ai.refine(
      FULL_HISTORY,
      initial,
      '下周要跟赵总确认预算。想换个显示器。体检还一直没预约。',
    )

    expect(next.people.map((p) => p.name)).toContain('赵总')
    expect(next.things.join(' ')).toContain('显示器')
    expect(next.pending.join(' ')).toContain('体检')
  })

  it('补充后重新给出热点与三条建议', async () => {
    const initial = await ai.summarize(FULL_HISTORY)
    const next = await ai.refine(FULL_HISTORY, initial, '下周要跟赵总确认预算。')

    expect(next.highlights.length).toBeGreaterThan(0)
    expect(next.nextFocus).toHaveLength(3)
    expect(next.nextFollowUps.length).toBeGreaterThan(0)
  })

  it('补充为空时不会破坏原有结果', async () => {
    const initial = await ai.summarize(FULL_HISTORY)
    const next = await ai.refine(FULL_HISTORY, initial, '   ')
    expect(next.events).toEqual(initial.events)
    expect(next.things).toEqual(initial.things)
    expect(next.nextFocus).toEqual(initial.nextFocus)
  })

  it('重复补充不会产生重复条目', async () => {
    const initial = await ai.summarize(FULL_HISTORY)
    const once = await ai.refine(FULL_HISTORY, initial, '下周要跟赵总确认预算。')
    const twice = await ai.refine(FULL_HISTORY, once, '下周要跟赵总确认预算。')
    expect(twice.people.filter((p) => p.name === '赵总')).toHaveLength(1)
  })
})
