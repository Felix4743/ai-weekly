import { describe, expect, it } from 'vitest'
import {
  answeredInBlock,
  blockProgress,
  coveragePercent,
  createInterview,
  currentFollowUp,
  currentFollowUpCap,
  currentQuestion,
  finishAll,
  isAllComplete,
  isBlockComplete,
  isFollowUpTurn,
  isFreeChat,
  nextIncompleteBlock,
  nextStage,
  nextStep,
  openBlock,
  questionsInBlock,
  setDepth,
  stateKeyForAnswer,
} from './interview'
import {
  CONTENT_BLOCKS,
  DEFAULT_FOLLOWUP_CAP,
  FOLLOWUP_CAPS,
  SCRIPT,
  TOTAL_MAIN_QUESTIONS,
  dimensionScript,
  followUpCap,
} from './script'
import type { BlockProgress, Dimension, InterviewState, TurnAction } from './types'
import { STATE_KEYS } from './types'

const EMPTY: BlockProgress = { askIndex: 0, followUpCount: 0, complete: false, freeTurns: 0 }

/** 在某个区块里一路问到底；action 决定每一轮都追问还是每一轮都换题 */
function runBlock(state: InterviewState, dim: Dimension, action: TurnAction) {
  const asked: string[] = []
  let s = state
  let guard = 0
  while (!isBlockComplete(s, dim) && guard < 300) {
    asked.push(currentQuestion(s, dim))
    s = nextStep(s, dim, action)
    guard += 1
  }
  return { state: s, asked }
}

describe('分块采访状态机', () => {
  it('初始时每个区块都是空的，没有选中任何一块，也还没定档', () => {
    const s = createInterview()
    expect(s.active).toBeNull()
    expect(s.depth).toBeNull()
    for (const d of SCRIPT) {
      expect(blockProgress(s, d.key)).toEqual(EMPTY)
    }
    expect(coveragePercent(s)).toBe(0)
    expect(isAllComplete(s)).toBe(false)
    expect(nextStage(s)).toEqual({ kind: 'block', dim: 'mood' })
  })

  it('没有上一周记录时，把「上周对账」这一步直接标成已过', () => {
    const withLastWeek = createInterview()
    expect(blockProgress(withLastWeek, 'reconcile').complete).toBe(false)

    const without = createInterview({ hasLastWeek: false })
    expect(blockProgress(without, 'reconcile')).toEqual({ ...EMPTY, complete: true })
    for (const d of CONTENT_BLOCKS) {
      expect(blockProgress(without, d.key).complete).toBe(false)
    }
    // 跳过对账不等于已经聊过内容块，覆盖率仍然是 0
    expect(coveragePercent(without)).toBe(0)
  })

  it('可以自己切到任意一块', () => {
    let s = createInterview()
    s = openBlock(s, 'people')
    expect(s.active).toBe('people')
    expect(openBlock(s, 'people')).toBe(s)

    s = openBlock(s, 'thing')
    expect(s.active).toBe('thing')

    s = openBlock(s, 'mood')
    expect(s.active).toBe('mood')
  })

  it('不追问时按顺序走完一个区块，并停在这一块', () => {
    const started = openBlock(createInterview(), 'event')
    const { state, asked } = runBlock(started, 'event', 'next')

    expect(asked).toEqual(dimensionScript('event')?.mainQuestions ?? [])
    expect(isBlockComplete(state, 'event')).toBe(true)
    expect(state.active).toBe('event')
  })

  it('每次都要求追问时，追问次数被档位上限硬性拦住', () => {
    const questions = dimensionScript('people')?.mainQuestions.length ?? 0

    // 还没定档：用默认上限
    const beforeDepth = runBlock(openBlock(createInterview(), 'people'), 'people', 'followup')
    expect(beforeDepth.asked).toHaveLength(questions * (DEFAULT_FOLLOWUP_CAP + 1))

    // 定了快速档：上限收到 1 次
    const fast = setDepth(createInterview(), 'fast')
    const afterDepth = runBlock(openBlock(fast, 'people'), 'people', 'followup')
    expect(afterDepth.asked).toHaveLength(questions * (FOLLOWUP_CAPS.fast + 1))
  })

  it('区块之间互不影响，可以只聊其中一块', () => {
    let s = openBlock(createInterview(), 'event')
    s = nextStep(s, 'event', 'next')

    expect(blockProgress(s, 'event').askIndex).toBe(1)
    expect(blockProgress(s, 'people').askIndex).toBe(0)
    expect(blockProgress(s, 'thing').askIndex).toBe(0)
    expect(blockProgress(s, 'mood').askIndex).toBe(0)
  })

  it('区块的主问题聊完后，用户还想说就能接着说（自由聊）', () => {
    const { state } = runBlock(openBlock(createInterview(), 'mood'), 'mood', 'next')
    expect(isFreeChat(state, 'mood')).toBe(true)

    const before = coveragePercent(state)
    const next = nextStep(state, 'mood', 'followup')

    // 题目不再推进，覆盖率也不动 —— 该聊的已经聊过了
    expect(blockProgress(next, 'mood').askIndex).toBe(blockProgress(state, 'mood').askIndex)
    expect(blockProgress(next, 'mood').complete).toBe(true)
    expect(coveragePercent(next)).toBe(before)

    // 但这一句被记下来了，没人把他的话筒收走
    expect(blockProgress(next, 'mood').freeTurns).toBe(1)
    expect(blockProgress(next, 'mood').freeTurns).toBeGreaterThan(
      blockProgress(state, 'mood').freeTurns,
    )
  })

  it('每个内容块的主问题都不少于 4 个，每个区块都有追问池', () => {
    for (const d of CONTENT_BLOCKS) {
      expect(d.mainQuestions.length).toBeGreaterThanOrEqual(4)
    }
    for (const d of SCRIPT) {
      expect(d.followUps.length).toBeGreaterThan(0)
    }
  })

  it('能区分「换题」和「追问」', () => {
    let s = openBlock(createInterview(), 'thing')
    expect(isFollowUpTurn(s, 'thing')).toBe(false)

    s = nextStep(s, 'thing', 'followup')
    expect(isFollowUpTurn(s, 'thing')).toBe(true)
    expect(currentFollowUp(s, 'thing').length).toBeGreaterThan(0)
  })

  it('[换块] 让当前块立即收尾，不再往后数题', () => {
    let s = openBlock(createInterview(), 'event')
    expect(coveragePercent(s)).toBe(0)

    s = nextStep(s, 'event', 'block')
    expect(isBlockComplete(s, 'event')).toBe(true)
    expect(blockProgress(s, 'event').followUpCount).toBe(0)
    // 六个主问题一次性算完：6/18 ≈ 33%
    expect(answeredInBlock(s, 'event')).toBe(questionsInBlock('event'))
    expect(coveragePercent(s)).toBe(Math.round((questionsInBlock('event') / TOTAL_MAIN_QUESTIONS) * 100))
  })

  it('能算出覆盖率，并指出下一块该聊什么', () => {
    let s = createInterview()
    expect(nextIncompleteBlock(s)).toBe('mood')

    s = runBlock(openBlock(s, 'mood'), 'mood', 'next').state
    expect(answeredInBlock(s, 'mood')).toBe(questionsInBlock('mood'))
    expect(nextIncompleteBlock(s)).toBe('event')
    expect(isAllComplete(s)).toBe(false)

    for (const d of SCRIPT) s = runBlock(s, d.key, 'next').state
    expect(isAllComplete(s)).toBe(true)
    expect(coveragePercent(s)).toBe(100)
    expect(nextIncompleteBlock(s)).toBeNull()
  })

  it('覆盖率的分母只有四个内容块，上周对账不占进度', () => {
    const reconcileOnly = runBlock(createInterview(), 'reconcile', 'next').state
    expect(isBlockComplete(reconcileOnly, 'reconcile')).toBe(true)
    expect(answeredInBlock(reconcileOnly, 'reconcile')).toBe(1)
    expect(coveragePercent(reconcileOnly)).toBe(0)

    expect(TOTAL_MAIN_QUESTIONS).toBe(
      CONTENT_BLOCKS.reduce((n, d) => n + d.mainQuestions.length, 0),
    )
    expect(dimensionScript('reconcile')?.kind).toBe('step')
  })

  it('nextStage：状态没聊完就是状态，聊完还没定档就等用户挑', () => {
    expect(nextStage(createInterview())).toEqual({ kind: 'block', dim: 'mood' })

    const moodDone = runBlock(createInterview(), 'mood', 'next').state
    expect(nextStage(moodDone)).toEqual({ kind: 'depth' })
  })

  it('nextStage：定档后按脚本顺序走，跳过没有的上周对账，全完就是 done', () => {
    const moodDone = runBlock(createInterview(), 'mood', 'next').state
    expect(nextStage(setDepth(moodDone, 'mid'))).toEqual({ kind: 'block', dim: 'reconcile' })

    const noLastWeek = runBlock(createInterview({ hasLastWeek: false }), 'mood', 'next').state
    expect(nextStage(setDepth(noLastWeek, 'mid'))).toEqual({ kind: 'block', dim: 'event' })

    // 全部标成结束但一直没定档时，仍然会停在等档位这一步
    expect(nextStage(finishAll(createInterview()))).toEqual({ kind: 'depth' })
    const allDone = setDepth(finishAll(createInterview()), 'mid')
    expect(nextStage(allDone)).toEqual({ kind: 'done' })
  })

  it('追问上限随档位变化，没定档时用默认上限', () => {
    expect(DEFAULT_FOLLOWUP_CAP).toBe(2)
    expect(followUpCap(null)).toBe(DEFAULT_FOLLOWUP_CAP)
    expect(followUpCap('fast')).toBe(1)
    expect(followUpCap('mid')).toBe(2)
    expect(followUpCap('deep')).toBe(5)

    const s = createInterview()
    expect(currentFollowUpCap(s)).toBe(DEFAULT_FOLLOWUP_CAP)
    expect(currentFollowUpCap(setDepth(s, 'deep'))).toBe(FOLLOWUP_CAPS.deep)
    expect(currentFollowUpCap(setDepth(s, 'fast'))).toBe(FOLLOWUP_CAPS.fast)
  })

  it('重复设同一档不会白改状态，换一档才真的换', () => {
    const s = setDepth(createInterview(), 'mid')
    expect(setDepth(s, 'mid')).toBe(s)
    expect(setDepth(s, 'deep')).not.toBe(s)
    expect(setDepth(s, 'deep').depth).toBe('deep')
  })

  it('覆盖全部主问题，一个都不漏', () => {
    let s = createInterview()
    const allAsked: string[] = []
    for (const d of SCRIPT) {
      const r = runBlock(s, d.key, 'next')
      allAsked.push(...r.asked)
      s = r.state
    }
    expect(allAsked).toEqual(SCRIPT.flatMap((d) => d.mainQuestions))
    // 四个内容块的题目正好是 TOTAL_MAIN_QUESTIONS，对账那一题不占进度
    expect(CONTENT_BLOCKS.flatMap((d) => d.mainQuestions)).toHaveLength(TOTAL_MAIN_QUESTIONS)
    expect(allAsked).toHaveLength(TOTAL_MAIN_QUESTIONS + 1)
  })

  it('覆盖率只增不减，并最终到达 100', () => {
    let s = createInterview()
    const seen = [coveragePercent(s)]
    for (const d of SCRIPT) {
      let guard = 0
      while (!isBlockComplete(s, d.key) && guard < 50) {
        s = nextStep(s, d.key, 'next')
        seen.push(coveragePercent(s))
        guard += 1
      }
    }
    expect(seen[seen.length - 1]).toBe(100)
    for (let i = 1; i < seen.length; i++) {
      expect(seen[i]).toBeGreaterThanOrEqual(seen[i - 1])
    }
  })

  it('直接生成梳理时，所有区块都标记为结束，档位留着', () => {
    const s = finishAll(setDepth(openBlock(createInterview(), 'event'), 'deep'))
    expect(isAllComplete(s)).toBe(true)
    expect(s.active).toBe('event')
    expect(s.depth).toBe('deep')
  })

  it('状态残缺或区块未知时不抛错', () => {
    const wild = { active: null, blocks: {}, depth: null } as unknown as InterviewState
    expect(() => currentQuestion(wild, 'event')).not.toThrow()
    expect(currentQuestion(wild, 'event')).toBe(dimensionScript('event')?.mainQuestions[0])
    expect(() => currentFollowUp(wild, 'event')).not.toThrow()
    expect(currentFollowUpCap(wild)).toBe(DEFAULT_FOLLOWUP_CAP)
    expect(nextStage(wild)).toEqual({ kind: 'block', dim: 'mood' })

    const unknown = 'nope' as Dimension
    expect(currentQuestion(wild, unknown)).toBe('')
    expect(currentFollowUp(wild, unknown)).toBe('')
    expect(nextStep(wild, unknown, 'followup')).toBe(wild)
    expect(questionsInBlock(unknown)).toBe(0)
    expect(answeredInBlock(wild, unknown)).toBe(0)
  })
})

/**
 * 状态那一段的四道题与四项评分一一对应，界面靠这个关系决定
 * 「这一条回答下面挂哪一排星」——错了就会把「精力」的分记到「情绪」上。
 */
describe('状态评分 · 回答与四项的对应', () => {
  it('按顺序：身体 → 情绪 → 精力 → 心智', () => {
    let s = createInterview()
    const keys: (string | undefined)[] = []
    for (let i = 0; i < 4; i++) {
      keys.push(stateKeyForAnswer(s))
      s = nextStep(s, 'mood', 'next')
    }
    expect(keys).toEqual([...STATE_KEYS])
  })

  it('四道题都问完之后就没有对应项了（自由聊的话不归哪一项）', () => {
    let s = createInterview()
    for (let i = 0; i < 4; i++) s = nextStep(s, 'mood', 'next')
    expect(isFreeChat(s, 'mood')).toBe(true)
    expect(stateKeyForAnswer(s)).toBeUndefined()
    // 再多说几句也还是 undefined
    s = nextStep(s, 'mood', 'next')
    expect(stateKeyForAnswer(s)).toBeUndefined()
  })

  it('状态与其他区块的题数一致 —— 谁改短了都会在这里被拦住', () => {
    expect(STATE_KEYS).toHaveLength(dimensionScript('mood')?.mainQuestions.length ?? 0)
  })
})
