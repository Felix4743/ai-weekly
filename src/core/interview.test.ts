import { describe, expect, it } from 'vitest'
import {
  askedMainQuestions,
  createInterview,
  currentDimension,
  currentFollowUp,
  currentQuestion,
  forceFinish,
  nextStep,
  progressPercent,
  startsNewBlock,
} from './interview'
import { MAX_FOLLOWUPS_PER_QUESTION, SCRIPT, TOTAL_MAIN_QUESTIONS } from './script'
import type { InterviewState } from './types'

const ALL_QUESTIONS = SCRIPT.flatMap((d) => d.mainQuestions)

function runAll(followUp: boolean) {
  let state = createInterview()
  const asked: string[] = []
  let guard = 0
  while (!state.done && guard < 500) {
    asked.push(currentQuestion(state))
    state = nextStep(state, followUp)
    guard += 1
  }
  return { state, asked }
}

describe('采访状态机', () => {
  it('初始状态指向第一个区块的第一个问题', () => {
    const s = createInterview()
    expect(s).toEqual({ dimensionIndex: 0, askIndex: 0, followUpCount: 0, done: false })
    expect(currentDimension(s)).toBe('event')
    expect(currentQuestion(s)).toBe(SCRIPT[0].mainQuestions[0])
    expect(progressPercent(s)).toBe(0)
  })

  it('不追问时，按脚本顺序逐题走完并结束', () => {
    const { state, asked } = runAll(false)
    expect(asked).toEqual(ALL_QUESTIONS)
    expect(asked).toHaveLength(TOTAL_MAIN_QUESTIONS)
    expect(state.done).toBe(true)
  })

  it('每次都要求追问时，每题追问次数被硬性限制', () => {
    const { asked } = runAll(true)
    expect(asked).toHaveLength(TOTAL_MAIN_QUESTIONS * (MAX_FOLLOWUPS_PER_QUESTION + 1))

    const counts = new Map<string, number>()
    for (const q of asked) counts.set(q, (counts.get(q) ?? 0) + 1)
    for (const q of ALL_QUESTIONS) {
      expect(counts.get(q)).toBe(MAX_FOLLOWUPS_PER_QUESTION + 1)
    }
  })

  it('追问到达上限后自动推进到下一题', () => {
    let s = createInterview()

    s = nextStep(s, true)
    expect(s.followUpCount).toBe(1)
    expect(s.askIndex).toBe(0)

    s = nextStep(s, true)
    expect(s.followUpCount).toBe(2)
    expect(s.askIndex).toBe(0)

    s = nextStep(s, true)
    expect(s.followUpCount).toBe(0)
    expect(s.askIndex).toBe(1)
  })

  it('AI 想追问但状态机已结束时不越界', () => {
    let s = createInterview()
    for (let i = 0; i < 100 && !s.done; i++) s = nextStep(s, false)
    expect(s.done).toBe(true)
    expect(nextStep(s, true)).toEqual(s)
  })

  it('用户点「聊够了」可以随时提前收尾', () => {
    const s = forceFinish(createInterview())
    expect(s.done).toBe(true)
    expect(progressPercent(s)).toBe(100)
    expect(nextStep(s, true)).toEqual(s)
  })

  it('进度只增不减，并最终到达 100', () => {
    let s = createInterview()
    const seen = [progressPercent(s)]
    let guard = 0
    while (!s.done && guard < 100) {
      s = nextStep(s, false)
      seen.push(progressPercent(s))
      guard += 1
    }
    expect(seen[0]).toBe(0)
    expect(seen[seen.length - 1]).toBe(100)
    for (let i = 1; i < seen.length; i++) {
      expect(seen[i]).toBeGreaterThanOrEqual(seen[i - 1])
    }
  })

  it('能算出已问过的主问题数，并识别区块切换', () => {
    expect(askedMainQuestions(createInterview())).toBe(0)

    const entering: InterviewState = {
      dimensionIndex: 1,
      askIndex: 0,
      followUpCount: 0,
      done: false,
    }
    expect(askedMainQuestions(entering)).toBe(SCRIPT[0].mainQuestions.length)
    expect(startsNewBlock(entering)).toBe(true)
    expect(startsNewBlock({ ...entering, followUpCount: 1 })).toBe(false)
    expect(startsNewBlock({ ...entering, dimensionIndex: 0 })).toBe(false)
  })

  it('状态越界时不抛错，安全降级', () => {
    const wild: InterviewState = { dimensionIndex: 99, askIndex: 99, followUpCount: 0, done: false }
    expect(() => currentDimension(wild)).not.toThrow()
    expect(currentQuestion(wild)).toBe('')
    expect(currentFollowUp(wild)).toBe('')
    expect(nextStep(wild, true).done).toBe(true)
  })

  it('追问话术池循环取用，不会越界', () => {
    let s = createInterview()
    for (let i = 0; i < MAX_FOLLOWUPS_PER_QUESTION; i++) {
      s = nextStep(s, true)
      expect(currentFollowUp(s).length).toBeGreaterThan(0)
    }
  })
})
