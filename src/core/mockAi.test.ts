import { describe, expect, it } from 'vitest'
import { createMockAi, extractName, groupAnswers, personHint, sampleAnswer } from './mockAi'
import { createInterview, currentFollowUp, currentQuestion } from './interview'
import type { ChatMessage, Dimension, InterviewState } from './types'

const ai = createMockAi({ instant: true })

let seq = 0
function msg(role: 'ai' | 'user', text: string, dimension: Dimension): ChatMessage {
  seq += 1
  return { id: `m${seq}`, role, text, dimension, at: seq }
}

const FULL_HISTORY: ChatMessage[] = [
  msg('ai', '周末好。这周主要忙了些什么？', 'event'),
  msg('user', '在改客户那个方案，改了三版了还没定下来。', 'event'),
  msg('user', '本来想把季度数据整理一下，一直没腾出时间。', 'event'),
  msg('ai', '事情先放一放，再聊聊人。这周跟谁打交道最多？', 'people'),
  msg('user', '主要是跟老王对接方案，还有跟小李吃了顿饭。', 'people'),
  msg('user', '想约张总聊聊明年的方向，但一直没敢开口。', 'people'),
  msg('ai', '换个角度 —— 这周整体感觉怎么样，累不累？', 'mood'),
  msg('user', '挺累的，主要就是方案反复改这件事拖着。', 'mood'),
]

describe('演示用假 AI', () => {
  it('开场白直接带出第一个问题', async () => {
    const text = await ai.opening()
    expect(text.length).toBeGreaterThan(0)
    expect(text).toContain('这周主要忙了些什么')
  })

  it('回答太短就追问，答得完整就换下一题', async () => {
    expect(await ai.wantsFollowUp('改方案', createInterview())).toBe(true)
    expect(
      await ai.wantsFollowUp(
        '这周主要是在改客户那个方案，来回改了三版，中间还开了很多会，最后终于定下来了。',
        createInterview(),
      ),
    ).toBe(false)
  })

  it('到达追问上限后不再追问，空回答也不追问', async () => {
    const capped: InterviewState = { ...createInterview(), followUpCount: 2 }
    expect(await ai.wantsFollowUp('短', capped)).toBe(false)
    expect(await ai.wantsFollowUp('   ', createInterview())).toBe(false)
  })

  it('追问态返回追问话术，主问题态返回主问题', async () => {
    const following: InterviewState = { ...createInterview(), followUpCount: 1 }
    expect(await ai.nextMessage(following, FULL_HISTORY)).toBe(currentFollowUp(following))

    const fresh = createInterview()
    expect(await ai.nextMessage(fresh, [msg('ai', '开场', 'event')])).toBe(currentQuestion(fresh))
  })

  it('进入新区块时带一句过渡语', async () => {
    const entering: InterviewState = { dimensionIndex: 1, askIndex: 0, followUpCount: 0, done: false }
    const text = await ai.nextMessage(entering, [msg('ai', '开场', 'event')])
    expect(text).toContain(currentQuestion(entering))
    expect(text).not.toBe(currentQuestion(entering))
  })

  it('能从中文句子里猜出人名', () => {
    expect(extractName('@张三 那边还没给反馈')).toBe('张三')
    expect(extractName('想约张总聊聊明年的方向，但一直没敢开口。')).toBe('张总')
    expect(extractName('主要是跟老王对接方案，还有跟小李吃了顿饭。')).toBe('老王')
  })

  it('按区块归类用户回答', () => {
    const grouped = groupAnswers(FULL_HISTORY)
    expect(grouped.event).toHaveLength(2)
    expect(grouped.people).toHaveLength(2)
    expect(grouped.mood).toHaveLength(1)
    expect(grouped.closing).toHaveLength(0)
  })

  it('汇总结果取自用户真实回答，而不是固定文案', async () => {
    const r = await ai.summarize(FULL_HISTORY)

    expect(r.events.length).toBeGreaterThan(0)
    expect(r.events.join(' ')).toContain('客户那个方案')

    const names = r.people.map((p) => p.name)
    expect(names).toContain('老王')
    expect(names).toContain('张总')

    expect(r.pending.length).toBeGreaterThan(0)
    expect(r.highlights.length).toBeGreaterThan(0)
    expect(r.nextFocus).toHaveLength(3)
    expect(r.nextFollowUps.length).toBeGreaterThan(0)
  })

  it('没有聊到任何内容时也能给出兜底结果', async () => {
    const r = await ai.summarize([])
    expect(r.events.length).toBeGreaterThan(0)
    expect(r.highlights.length).toBeGreaterThan(0)
    expect(r.nextFocus.length).toBeGreaterThan(0)
  })

  it('示例回答循环取用，方便快速走完 Demo', () => {
    expect(sampleAnswer('event', 0).length).toBeGreaterThan(0)
    expect(sampleAnswer('event', 4)).toBe(sampleAnswer('event', 0))
    expect(sampleAnswer('closing', 0).length).toBeGreaterThan(0)
  })

  it('猜不出人名时返回 null，避免把普通句子当成人', () => {
    expect(personHint('要把季度数据整理完')).toBeNull()
    expect(personHint('给自己留出整块时间')).toBeNull()
    expect(personHint('写个总结')).toBeNull()
  })
})

describe('用户补充后由 AI 重新整理', () => {
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

  it('把补充内容识别成人、悬着或事情', async () => {
    const initial = await ai.summarize(FULL_HISTORY)
    const next = await ai.refine(
      FULL_HISTORY,
      initial,
      '下周要跟赵总确认预算。体检还一直没预约。把桌面整理一下。',
    )

    expect(next.people.map((p) => p.name)).toContain('赵总')
    expect(next.pending.join(' ')).toContain('体检')
    expect(next.events.join(' ')).toContain('桌面')
  })

  it('重新整理后仍然给出热点与三条下周建议', async () => {
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
    expect(next.people).toEqual(initial.people)
    expect(next.nextFocus).toEqual(initial.nextFocus)
  })

  it('重复补充不会产生重复条目', async () => {
    const initial = await ai.summarize(FULL_HISTORY)
    const once = await ai.refine(FULL_HISTORY, initial, '下周要跟赵总确认预算。')
    const twice = await ai.refine(FULL_HISTORY, once, '下周要跟赵总确认预算。')
    expect(twice.people.filter((p) => p.name === '赵总')).toHaveLength(1)
  })
})
