import { describe, expect, it } from 'vitest'
import {
  answeredInBlock,
  blockProgress,
  coveragePercent,
  createInterview,
  currentFollowUpCap,
  currentFollowUpSpec,
  currentQuestionSpec,
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
  setStateDone,
} from './interview'
import {
  CONTENT_BLOCKS,
  DEFAULT_FOLLOWUP_CAP,
  FOLLOWUP_CAPS,
  PROBE_KEY,
  SCRIPT,
  TOTAL_MAIN_QUESTIONS,
  dimensionScript,
  followUpCap,
  isContentBlock,
  spoken,
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
    asked.push(spoken(currentQuestionSpec(s, dim)))
    s = nextStep(s, dim, action)
    guard += 1
  }
  return { state: s, asked }
}

describe('分块采访状态机', () => {
  it('初始时每个区块都是空的，没选中任何一块，也还没交状态卡、没定档', () => {
    const s = createInterview()
    expect(s.active).toBeNull()
    expect(s.stateDone).toBe(false)
    expect(s.depth).toBeNull()
    for (const d of SCRIPT) {
      expect(blockProgress(s, d.key)).toEqual(EMPTY)
    }
    expect(coveragePercent(s)).toBe(0)
    expect(isAllComplete(s)).toBe(false)
    expect(nextStage(s)).toEqual({ kind: 'state' })
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
    // 状态卡还是要先交
    expect(without.stateDone).toBe(false)
  })

  it('可以自己切到任意一块', () => {
    let s = createInterview()
    s = openBlock(s, 'people')
    expect(s.active).toBe('people')
    expect(openBlock(s, 'people')).toBe(s)

    s = openBlock(s, 'thing')
    expect(s.active).toBe('thing')

    s = openBlock(s, 'growth')
    expect(s.active).toBe('growth')
  })

  it('不追问时按顺序走完一个区块，并停在这一块', () => {
    const started = openBlock(createInterview(), 'event')
    const { state, asked } = runBlock(started, 'event', 'next')

    expect(asked).toEqual((dimensionScript('event')?.mainQuestions ?? []).map(spoken))
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
    expect(blockProgress(s, 'growth').askIndex).toBe(0)
  })

  it('区块的主问题聊完后，用户还想说就能接着说（自由聊）', () => {
    const { state } = runBlock(openBlock(createInterview(), 'growth'), 'growth', 'next')
    expect(isFreeChat(state, 'growth')).toBe(true)

    const before = coveragePercent(state)
    const next = nextStep(state, 'growth', 'followup')

    // 题目不再推进，覆盖率也不动 —— 该聊的已经聊过了
    expect(blockProgress(next, 'growth').askIndex).toBe(blockProgress(state, 'growth').askIndex)
    expect(blockProgress(next, 'growth').complete).toBe(true)
    expect(coveragePercent(next)).toBe(before)

    // 但这一句被记下来了，没人把他的话筒收走
    expect(blockProgress(next, 'growth').freeTurns).toBe(1)
    expect(blockProgress(next, 'growth').freeTurns).toBeGreaterThan(
      blockProgress(state, 'growth').freeTurns,
    )
  })

  it('每个内容块至少两道主问题，除状态追问外每个区块都有能念出来的追问', () => {
    for (const d of CONTENT_BLOCKS) {
      expect(d.mainQuestions.length).toBeGreaterThanOrEqual(2)
    }
    for (const d of SCRIPT) {
      // 状态追问的题目与追问池都按分数现算（probe.ts），这份静态表里当然是空的
      if (d.key === PROBE_KEY) {
        expect(d.mainQuestions).toEqual([])
        expect(d.followUps).toEqual([])
        continue
      }
      expect(d.followUps.length).toBeGreaterThan(0)
      for (const spec of d.followUps) expect(spoken(spec).trim().length).toBeGreaterThan(0)
    }
  })

  it('能区分「换题」和「追问」', () => {
    let s = openBlock(createInterview(), 'thing')
    expect(isFollowUpTurn(s, 'thing')).toBe(false)

    s = nextStep(s, 'thing', 'followup')
    expect(isFollowUpTurn(s, 'thing')).toBe(true)
    // 追问池按次数轮着取：追过一次之后取第二道
    expect(currentFollowUpSpec(s, 'thing')).toBe(dimensionScript('thing')?.followUps[1])
    expect(spoken(currentFollowUpSpec(s, 'thing')).trim().length).toBeGreaterThan(0)
  })

  it('[换块] 让当前块立即收尾，不再往后数题', () => {
    let s = openBlock(createInterview(), 'event')
    expect(coveragePercent(s)).toBe(0)

    s = nextStep(s, 'event', 'block')
    expect(isBlockComplete(s, 'event')).toBe(true)
    expect(blockProgress(s, 'event').followUpCount).toBe(0)
    // 六个主问题一次性算完，占覆盖率里的那一份
    expect(answeredInBlock(s, 'event')).toBe(questionsInBlock('event'))
    expect(coveragePercent(s)).toBe(
      Math.round((questionsInBlock('event') / TOTAL_MAIN_QUESTIONS) * 100),
    )
  })

  it('能算出覆盖率，并指出下一块该聊什么', () => {
    let s = createInterview()
    expect(nextIncompleteBlock(s)).toBe('event')

    s = runBlock(openBlock(s, 'event'), 'event', 'next').state
    expect(answeredInBlock(s, 'event')).toBe(questionsInBlock('event'))
    expect(nextIncompleteBlock(s)).toBe('people')
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

  it('nextStage：先交状态打分卡，再定档，然后才进第一块', () => {
    expect(nextStage(createInterview())).toEqual({ kind: 'state' })

    // 卡没交，先按档位按钮也不往下走
    expect(nextStage(setDepth(createInterview(), 'mid'))).toEqual({ kind: 'state' })

    const stateDone = setStateDone(createInterview())
    expect(nextStage(stateDone)).toEqual({ kind: 'depth' })

    // 卡交了但没挑档位：哪怕已经有一块聊完了，也停在 depth 等人挑
    const growthDone = runBlock(stateDone, 'growth', 'next').state
    expect(nextStage(growthDone)).toEqual({ kind: 'depth' })
    expect(nextStage(setDepth(growthDone, 'mid'))).toEqual({ kind: 'block', dim: 'reconcile' })
  })

  it('nextStage：定档后按脚本顺序走，跳过没有的上周对账，全完就是 done', () => {
    const ready = (s: InterviewState) => setDepth(setStateDone(s), 'mid')

    expect(nextStage(ready(createInterview()))).toEqual({ kind: 'block', dim: 'reconcile' })
    expect(nextStage(ready(createInterview({ hasLastWeek: false })))).toEqual({
      kind: 'block',
      dim: 'event',
    })

    // 一块聊完就轮到下一块
    const reconcileDone = runBlock(createInterview(), 'reconcile', 'next').state
    expect(nextStage(ready(reconcileDone))).toEqual({ kind: 'block', dim: 'event' })

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
      // 状态追问的题目按分数现算，没交卡（没有低分项）时它一道题都没有，
      // 这一步「一个主问题都不漏」的口径只对写死题库的那些步骤有意义
      if (d.key === PROBE_KEY) {
        s = runBlock(s, d.key, 'next').state
        expect(isBlockComplete(s, PROBE_KEY)).toBe(true)
        continue
      }
      const r = runBlock(s, d.key, 'next')
      allAsked.push(...r.asked)
      s = r.state
    }
    expect(allAsked).toEqual(
      SCRIPT.filter((d) => d.key !== PROBE_KEY)
        .flatMap((d) => d.mainQuestions)
        .map(spoken),
    )
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
    // 直接生成也算把状态卡这一步翻过去了
    expect(s.stateDone).toBe(true)
  })

  it('状态残缺或区块未知时不抛错', () => {
    // 手工造的残缺状态：连 stateDone 都没有
    const wild = { active: null, blocks: {}, depth: null } as unknown as InterviewState
    expect(() => nextStage(wild)).not.toThrow()
    // 没交卡就先要卡，不会越过去瞎问
    expect(nextStage(wild)).toEqual({ kind: 'state' })

    const ready = { ...wild, stateDone: true, depth: 'mid' } as InterviewState
    expect(nextStage(ready)).toEqual({ kind: 'block', dim: 'reconcile' })

    expect(() => currentQuestionSpec(wild, 'event')).not.toThrow()
    expect(currentQuestionSpec(wild, 'event')).toBe(dimensionScript('event')?.mainQuestions[0])
    expect(() => currentFollowUpSpec(wild, 'event')).not.toThrow()
    expect(currentFollowUpSpec(wild, 'event')).toBe(dimensionScript('event')?.followUps[0])
    expect(currentFollowUpCap(wild)).toBe(DEFAULT_FOLLOWUP_CAP)

    const unknown = 'nope' as Dimension
    expect(currentQuestionSpec(wild, unknown)).toBeUndefined()
    expect(currentFollowUpSpec(wild, unknown)).toBeUndefined()
    expect(nextStep(wild, unknown, 'followup')).toBe(wild)
    expect(questionsInBlock(unknown)).toBe(0)
    expect(answeredInBlock(wild, unknown)).toBe(0)
  })
})

/**
 * 0.9.3 起「状态」不再是采访的一块：它是开场一张打分卡（四项点星 + 一行备注），
 * 由界面点击产生，既不进 SCRIPT、也不占主问题、也不占 AI 轮次。
 * 这一组用例钉的就是这条边界 —— 旧口径下 mood 是第五个区块，还带四道主问题。
 */
describe('状态打分卡 · 不再是采访的一块', () => {
  it('mood 不是采访区块，脚本与内容块里都没有它', () => {
    expect(SCRIPT.some((d) => (d.key as string) === 'mood')).toBe(false)
    expect(CONTENT_BLOCKS.some((d) => (d.key as string) === 'mood')).toBe(false)
    expect(isContentBlock('mood' as Dimension)).toBe(false)
    expect(dimensionScript('mood' as Dimension)).toBeUndefined()
  })

  it('四排星是固定四项，跟脚本里的区块不是一回事', () => {
    expect(STATE_KEYS).toEqual(['mood', 'sleep', 'sport', 'diet'])
    for (const key of STATE_KEYS) {
      expect(SCRIPT.some((d) => (d.key as string) === key)).toBe(false)
    }
  })

  it('没交卡之前一步都不往下走', () => {
    expect(nextStage(createInterview())).toEqual({ kind: 'state' })
    expect(nextStage(openBlock(createInterview(), 'event'))).toEqual({ kind: 'state' })
    expect(nextStage(setDepth(createInterview(), 'deep'))).toEqual({ kind: 'state' })
  })

  it('交卡与定档各推进一格，重复交卡不白改状态', () => {
    const s = setStateDone(createInterview())
    expect(s.stateDone).toBe(true)
    expect(setStateDone(s)).toBe(s)
    expect(nextStage(s)).toEqual({ kind: 'depth' })
    expect(nextStage(setDepth(s, 'fast'))).toEqual({ kind: 'block', dim: 'reconcile' })
  })
})

/**
 * 0.9.4：打完分之后的「状态追问」。
 *
 * 这一步是用户提的第一个问题（「打完分之后就没后续了」）的解法：
 * 问哪几项、问几道题，全看交卡那一刻的分 —— 所以它必须排在定档之后、内容块之前，
 * 而且没有低分项时**整步跳过**，不能给用户一个空步骤。
 */
describe('状态追问 · 按打分决定问什么', () => {
  /** 交卡 → 定档，走完流程的前两步 */
  const ready = (scores: Record<string, number>) =>
    setDepth(setStateDone(createInterview(), scores), 'mid')

  it('交卡时把低分项定下来（≤ 2 星）', () => {
    const s = setStateDone(createInterview(), { mood: 4, sleep: 2, sport: 1, diet: 5 })
    expect(s.lowKeys).toEqual(['sleep', 'sport'])
  })

  it('有低分项：定档之后先问状态，再问上周对账', () => {
    const s = ready({ sleep: 2, sport: 1 })
    expect(nextStage(s)).toEqual({ kind: 'block', dim: 'probe' })
  })

  it('四项都还行：这一步整步跳过，直接进上周对账', () => {
    const s = ready({ mood: 4, sleep: 5, sport: 3, diet: 4 })
    expect(s.lowKeys).toEqual([])
    expect(isBlockComplete(s, 'probe')).toBe(true)
    expect(nextStage(s)).toEqual({ kind: 'block', dim: 'reconcile' })
  })

  it('一项都没打分：也跳过（「没打分」不等于「过得不好」）', () => {
    const s = ready({})
    expect(s.lowKeys).toEqual([])
    expect(nextStage(s)).toEqual({ kind: 'block', dim: 'reconcile' })
  })

  it('两项低就有两道题，一道一道问，问完这一步才算完', () => {
    let s = ready({ sleep: 2, sport: 1 })
    s = openBlock(s, 'probe')

    const first = currentQuestionSpec(s, 'probe')
    expect(first?.intent).toContain('睡眠')

    // 换题 → 轮到第二项
    s = nextStep(s, 'probe', 'next')
    expect(blockProgress(s, 'probe').askIndex).toBe(1)
    expect(currentQuestionSpec(s, 'probe')?.intent).toContain('运动')
    expect(isBlockComplete(s, 'probe')).toBe(false)

    // 再换一次 → 两项都问过，这一步收尾
    s = nextStep(s, 'probe', 'next')
    expect(isBlockComplete(s, 'probe')).toBe(true)
  })

  it('每一项各有各的追问额度：换了项就重新数', () => {
    let s = openBlock(ready({ sleep: 2, sport: 2 }), 'probe')
    s = nextStep(s, 'probe', 'followup')
    expect(blockProgress(s, 'probe').followUpCount).toBe(1)

    s = nextStep(s, 'probe', 'next')
    expect(blockProgress(s, 'probe').followUpCount).toBe(0)
    expect(blockProgress(s, 'probe').askIndex).toBe(1)
  })

  it('追问次数到顶就该换项了 —— 上限还是跟着档位走', () => {
    const fast = setDepth(setStateDone(createInterview(), { sleep: 1, sport: 1 }), 'fast')
    let s = openBlock(fast, 'probe')
    expect(currentFollowUpCap(s)).toBe(FOLLOWUP_CAPS.fast)

    s = nextStep(s, 'probe', 'followup')
    expect(blockProgress(s, 'probe').followUpCount).toBe(1)
    // 到顶了：再要追问也只能换项
    s = nextStep(s, 'probe', 'followup')
    expect(blockProgress(s, 'probe').askIndex).toBe(1)
  })

  it('[换块] 让这一步立刻收尾，不用把剩下的项走完', () => {
    let s = openBlock(ready({ sleep: 1, sport: 1, mood: 1 }), 'probe')
    s = nextStep(s, 'probe', 'block')
    expect(isBlockComplete(s, 'probe')).toBe(true)
    expect(nextStage(s)).toEqual({ kind: 'block', dim: 'reconcile' })
  })

  it('状态追问不占覆盖率 —— 它是流程里的一步，不是内容块', () => {
    let s = openBlock(ready({ sleep: 1, sport: 1 }), 'probe')
    expect(coveragePercent(s)).toBe(0)
    s = nextStep(s, 'probe', 'next')
    s = nextStep(s, 'probe', 'next')
    expect(isBlockComplete(s, 'probe')).toBe(true)
    expect(coveragePercent(s)).toBe(0)
  })

  it('全新一场采访里它还没到：先要卡、再定档，才轮到它', () => {
    expect(nextStage(createInterview())).toEqual({ kind: 'state' })
    expect(nextStage(setDepth(createInterview(), 'mid'))).toEqual({ kind: 'state' })
    expect(nextStage(setStateDone(createInterview(), { sleep: 1 }))).toEqual({ kind: 'depth' })
  })

  it('残缺状态里没有 lowKeys 也不炸（归档翻出来的老状态就是没有这个键）', () => {
    const wild = {
      active: null,
      blocks: {},
      stateDone: true,
      depth: 'mid',
    } as unknown as InterviewState
    expect(() => nextStage(wild)).not.toThrow()
    expect(nextStage(wild)).toEqual({ kind: 'block', dim: 'reconcile' })
  })
})
