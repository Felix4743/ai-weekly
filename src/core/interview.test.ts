import { describe, expect, it } from 'vitest'
import {
  answeredInBlock,
  blockProgress,
  closeBlock,
  coveragePercent,
  createInterview,
  currentFollowUp,
  currentQuestion,
  finishAll,
  isAllComplete,
  isBlockComplete,
  isFollowUpTurn,
  nextIncompleteBlock,
  nextStep,
  openBlock,
  questionsInBlock,
} from './interview'
import { MAX_FOLLOWUPS_PER_QUESTION, SCRIPT, TOTAL_MAIN_QUESTIONS } from './script'
import type { Dimension, InterviewState } from './types'

/** 在某个区块里一路问到底 */
function runBlock(state: InterviewState, dim: Dimension, followUp: boolean) {
  const asked: string[] = []
  let s = state
  let guard = 0
  while (!isBlockComplete(s, dim) && guard < 200) {
    asked.push(currentQuestion(s, dim))
    s = nextStep(s, dim, followUp)
    guard += 1
  }
  return { state: s, asked }
}

describe('分块采访状态机', () => {
  it('初始时每个区块都是空的，没有展开任何一块', () => {
    const s = createInterview()
    expect(s.active).toBeNull()
    for (const d of SCRIPT) {
      expect(blockProgress(s, d.key)).toEqual({ askIndex: 0, followUpCount: 0, complete: false })
    }
    expect(coveragePercent(s)).toBe(0)
    expect(isAllComplete(s)).toBe(false)
  })

  it('可以自己展开某一块，也可以收起', () => {
    let s = createInterview()
    s = openBlock(s, 'people')
    expect(s.active).toBe('people')
    expect(openBlock(s, 'people')).toBe(s)

    s = openBlock(s, 'thing')
    expect(s.active).toBe('thing')

    s = closeBlock(s)
    expect(s.active).toBeNull()
    expect(closeBlock(s)).toBe(s)
  })

  it('不追问时按顺序走完一个区块，并自动收起', () => {
    const started = openBlock(createInterview(), 'event')
    const { state, asked } = runBlock(started, 'event', false)

    expect(asked).toEqual(SCRIPT[0].mainQuestions)
    expect(isBlockComplete(state, 'event')).toBe(true)
    expect(state.active).toBeNull()
  })

  it('每次都要求追问时，追问次数被硬性限制', () => {
    const { asked } = runBlock(openBlock(createInterview(), 'people'), 'people', true)
    expect(asked).toHaveLength(SCRIPT[1].mainQuestions.length * (MAX_FOLLOWUPS_PER_QUESTION + 1))
  })

  it('区块之间互不影响，可以只聊其中一块', () => {
    let s = openBlock(createInterview(), 'event')
    s = nextStep(s, 'event', false)

    expect(blockProgress(s, 'event').askIndex).toBe(1)
    expect(blockProgress(s, 'people').askIndex).toBe(0)
    expect(blockProgress(s, 'thing').askIndex).toBe(0)
    expect(blockProgress(s, 'mood').askIndex).toBe(0)
  })

  it('区块聊完后不再推进', () => {
    const { state } = runBlock(openBlock(createInterview(), 'mood'), 'mood', false)
    expect(nextStep(state, 'mood', true)).toBe(state)
  })

  it('能区分「换题」和「追问」', () => {
    let s = openBlock(createInterview(), 'thing')
    expect(isFollowUpTurn(s, 'thing')).toBe(false)

    s = nextStep(s, 'thing', true)
    expect(isFollowUpTurn(s, 'thing')).toBe(true)
    expect(currentFollowUp(s, 'thing').length).toBeGreaterThan(0)
  })

  it('能算出覆盖率，并指出下一块该聊什么', () => {
    let s = createInterview()
    expect(nextIncompleteBlock(s)).toBe('event')

    s = runBlock(openBlock(s, 'event'), 'event', false).state
    expect(answeredInBlock(s, 'event')).toBe(questionsInBlock('event'))
    expect(nextIncompleteBlock(s)).toBe('people')
    expect(isAllComplete(s)).toBe(false)

    for (const d of SCRIPT) s = runBlock(s, d.key, false).state
    expect(isAllComplete(s)).toBe(true)
    expect(coveragePercent(s)).toBe(100)
    expect(nextIncompleteBlock(s)).toBeNull()
  })

  it('直接生成梳理时，所有区块都标记为结束', () => {
    const s = finishAll(openBlock(createInterview(), 'event'))
    expect(isAllComplete(s)).toBe(true)
    expect(s.active).toBeNull()
  })

  it('覆盖全部主问题，一个都不漏', () => {
    let s = createInterview()
    const allAsked: string[] = []
    for (const d of SCRIPT) {
      const r = runBlock(s, d.key, false)
      allAsked.push(...r.asked)
      s = r.state
    }
    expect(allAsked).toEqual(SCRIPT.flatMap((d) => d.mainQuestions))
    expect(allAsked).toHaveLength(TOTAL_MAIN_QUESTIONS)
  })

  it('覆盖率只增不减，并最终到达 100', () => {
    let s = createInterview()
    const seen = [coveragePercent(s)]
    for (const d of SCRIPT) {
      let guard = 0
      while (!isBlockComplete(s, d.key) && guard < 50) {
        s = nextStep(s, d.key, false)
        seen.push(coveragePercent(s))
        guard += 1
      }
    }
    expect(seen[seen.length - 1]).toBe(100)
    for (let i = 1; i < seen.length; i++) {
      expect(seen[i]).toBeGreaterThanOrEqual(seen[i - 1])
    }
  })

  it('状态残缺或区块未知时不抛错', () => {
    const wild = { active: null, blocks: {} } as unknown as InterviewState
    expect(() => currentQuestion(wild, 'event')).not.toThrow()
    expect(currentQuestion(wild, 'event')).toBe(SCRIPT[0].mainQuestions[0])
    expect(() => currentFollowUp(wild, 'event')).not.toThrow()

    const unknown = 'nope' as Dimension
    expect(currentQuestion(wild, unknown)).toBe('')
    expect(currentFollowUp(wild, unknown)).toBe('')
    expect(nextStep(wild, unknown, true)).toBe(wild)
    expect(questionsInBlock(unknown)).toBe(0)
    expect(answeredInBlock(wild, unknown)).toBe(0)
  })
})
