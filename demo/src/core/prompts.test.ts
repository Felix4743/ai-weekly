import { describe, expect, it } from 'vitest'
import { createInterview, finishAll, openBlock } from './interview'
import {
  buildClosingPrompt,
  buildOpeningPrompt,
  buildRefinePrompt,
  buildSummarizePrompt,
  buildTurnPrompt,
  formatTranscript,
} from './prompts'
import { MAX_FOLLOWUPS_PER_QUESTION } from './script'
import { createEmptyResult, type ChatMessage, type Dimension, type InterviewState } from './types'

let seq = 0
function msg(role: 'ai' | 'user', text: string, dimension: Dimension): ChatMessage {
  seq += 1
  return { id: `m${seq}`, role, text, dimension, at: seq }
}

/** 把系统提示与用户提示拼起来，方便整体断言 */
function textOf(messages: { content: string }[]): string {
  return messages.map((m) => m.content).join('\n---\n')
}

function withBlock(
  dim: Dimension,
  patch: { askIndex: number; followUpCount: number; complete: boolean },
): InterviewState {
  const base = createInterview()
  return { active: dim, blocks: { ...base.blocks, [dim]: patch } }
}

describe('提示词 · 对话记录', () => {
  it('按区块分组，并标出谁是采访者、谁在回答', () => {
    const t = formatTranscript([
      msg('ai', '这周主要忙了些什么？', 'event'),
      msg('user', '在改客户那个方案', 'event'),
      msg('user', '跟老王对接得比较多', 'people'),
    ])
    expect(t).toContain('【事情】')
    expect(t).toContain('采访者：这周主要忙了些什么？')
    expect(t).toContain('对方：在改客户那个方案')
    expect(t).toContain('【人际】')
  })

  it('只取指定区块，避免模型串台去聊别的块', () => {
    const t = formatTranscript(
      [msg('user', '在改客户那个方案', 'event'), msg('user', '跟老王对接', 'people')],
      'people',
    )
    expect(t).toContain('跟老王对接')
    expect(t).not.toContain('在改客户那个方案')
    expect(t).not.toContain('【事情】')
  })

  it('没有对话时给占位，不留空', () => {
    expect(formatTranscript([])).toContain('还没有对话')
  })
})

describe('提示词 · 区块开场与收尾', () => {
  it('第一块会带上打招呼的指示', () => {
    const text = textOf(buildOpeningPrompt(openBlock(createInterview(), 'event'), 'event', []))
    expect(text).toContain('这周主要忙了些什么')
    expect(text).toContain('打个招呼')
  })

  it('后面几块不再打招呼', () => {
    const history = [msg('ai', '这周主要忙了些什么？', 'event')]
    const text = textOf(buildOpeningPrompt(openBlock(createInterview(), 'thing'), 'thing', history))
    expect(text).toContain('这周买了什么')
    expect(text).not.toContain('打个招呼')
  })

  it('把主问题清单交给模型，覆盖才不会被漏掉', () => {
    const text = textOf(buildOpeningPrompt(openBlock(createInterview(), 'mood'), 'mood', []))
    expect(text).toContain('这周整体感觉怎么样')
    expect(text).toContain('还有什么我没问到')
  })

  it('开场也会带上四个区块的整体进度', () => {
    const state = openBlock(createInterview(), 'people')
    const text = textOf(buildOpeningPrompt(state, 'people', []))
    expect(text).toContain('四个区块整体进度')
    expect(text).toContain('事情')
  })

  it('聊完时改成收尾，并指向还没聊的块', () => {
    const base = createInterview()
    const state: InterviewState = {
      active: 'event',
      blocks: { ...base.blocks, event: { askIndex: 2, followUpCount: 0, complete: true } },
    }
    const text = textOf(buildClosingPrompt(state, 'event'))
    expect(text).toContain('已经问完')
    expect(text).toContain('人际')
  })

  it('四块都聊完时提示可以生成梳理', () => {
    expect(textOf(buildClosingPrompt(finishAll(createInterview()), 'mood'))).toContain('生成')
  })
})

describe('提示词 · 一轮追问判断', () => {
  const history = [
    msg('ai', '这周主要忙了些什么？', 'event'),
    msg('user', '在改客户那个方案，改了三版还没定', 'event'),
  ]

  it('把当前问题、追问次数、上限都告诉模型', () => {
    const text = textOf(buildTurnPrompt(openBlock(createInterview(), 'event'), 'event', history))
    expect(text).toContain('这周主要忙了些什么')
    expect(text).toContain('本题已追问 0 次')
    expect(text).toContain(`上限 ${MAX_FOLLOWUPS_PER_QUESTION} 次`)
  })

  it('明确要求模型用行首标记表态', () => {
    const text = textOf(buildTurnPrompt(openBlock(createInterview(), 'event'), 'event', history))
    expect(text).toContain('[追问]')
    expect(text).toContain('[换题]')
  })

  it('把对方的回答原文交给模型', () => {
    const text = textOf(buildTurnPrompt(openBlock(createInterview(), 'event'), 'event', history))
    expect(text).toContain('在改客户那个方案，改了三版还没定')
  })

  it('追问到顶时明确要求只能换题', () => {
    const state = withBlock('event', {
      askIndex: 0,
      followUpCount: MAX_FOLLOWUPS_PER_QUESTION,
      complete: false,
    })
    const text = textOf(buildTurnPrompt(state, 'event', history))
    expect(text).toContain('已达上限，必须换题')
    expect(text).toContain('只能用 [换题]')
  })

  it('换题时告诉模型下一个主问题是什么', () => {
    const text = textOf(buildTurnPrompt(openBlock(createInterview(), 'event'), 'event', history))
    expect(text).toContain('有没有本来打算做、结果没做成的事')
  })

  it('这一块问完时改成收尾，并指向下一块', () => {
    const state = withBlock('event', { askIndex: 2, followUpCount: 0, complete: false })
    const text = textOf(buildTurnPrompt(state, 'event', history))
    expect(text).toContain('已经问完')
    expect(text).toContain('人际')
  })
})

describe('提示词 · 生成与重新整理', () => {
  it('生成时给出完整的 JSON 结构', () => {
    const text = textOf(buildSummarizePrompt([msg('user', '在改方案', 'event')]))
    for (const key of [
      'events',
      'people',
      'things',
      'pending',
      'highlights',
      'nextFocus',
      'nextFollowUps',
    ]) {
      expect(text).toContain(key)
    }
    expect(text).toContain('不要编造')
  })

  it('一次都没说时如实留空，不让模型瞎编', () => {
    expect(textOf(buildSummarizePrompt([]))).toContain('什么都没说')
  })

  it('重新整理时把手改过的结果原样交给模型，并要求只能追加', () => {
    const current = { ...createEmptyResult(), events: ['我改过的这一条'] }
    const text = textOf(
      buildRefinePrompt([msg('user', '在改方案', 'event')], current, '下周必须把报价发出去'),
    )
    expect(text).toContain('我改过的这一条')
    expect(text).toContain('下周必须把报价发出去')
    expect(text).toContain('原样保留')
    expect(text).toContain('追加')
  })
})

describe('提示词 · 健壮性', () => {
  it('未知区块返回空提示词，而不是抛出', () => {
    const state = createInterview()
    const bogus = 'nope' as Dimension
    expect(buildOpeningPrompt(state, bogus, [])).toEqual([])
    expect(buildTurnPrompt(state, bogus, [])).toEqual([])
    expect(buildClosingPrompt(state, bogus)).toEqual([])
  })

  it('提示词里不会出现 undefined 之类没填上的占位', () => {
    const text = textOf(buildTurnPrompt(openBlock(createInterview(), 'people'), 'people', []))
    expect(text).not.toContain('undefined')
    expect(text).not.toContain('NaN')
  })
})
