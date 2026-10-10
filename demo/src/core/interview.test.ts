import { describe, expect, it } from 'vitest'
import {
  blockProgress,
  coveragePercent,
  coveredIdsFromNumbers,
  coveredInBlock,
  createInterview,
  currentFollowUpCap,
  currentPoint,
  currentPointNumber,
  finishAll,
  isAllComplete,
  isBlockComplete,
  isFollowUpTurn,
  isFreeChat,
  nextIncompleteBlock,
  nextStage,
  nextStep,
  nudgeBack,
  openBlock,
  planBlockEnd,
  pointsFor,
  pointsInBlock,
  setDepth,
  setStateDone,
  uncoveredPoints,
} from './interview'
import {
  CONTENT_BLOCKS,
  DEFAULT_FOLLOWUP_CAP,
  FOLLOWUP_CAPS,
  MAX_NUDGES,
  MAX_TURNS_PER_BLOCK,
  PROBE_KEY,
  SCRIPT,
  TOTAL_POINTS,
  dimensionScript,
  followUpCap,
  isContentBlock,
  pointsOf,
  spoken,
} from './script'
import type { BlockProgress, Dimension, InterviewState, TurnAction } from './types'
import { STATE_KEYS } from './types'

const EMPTY: BlockProgress = {
  asked: 0,
  followUpCount: 0,
  complete: false,
  freeTurns: 0,
  covered: [],
  nudges: 0,
}

/** 在某个区块里一路问到底；action 决定每一轮都追问还是每一轮都换方向 */
function runBlock(state: InterviewState, dim: Dimension, action: TurnAction) {
  const asked: string[] = []
  let s = state
  let guard = 0
  while (!isBlockComplete(s, dim) && guard < 300) {
    asked.push(spoken(currentPoint(s, dim)))
    s = nextStep(s, dim, action)
    guard += 1
  }
  return { state: s, asked }
}

/** 模型收尾时把这一块的要点全报上（真模型写的是 `[换块] 覆盖:1,2,3,4`） */
function allNumbers(state: InterviewState, dim: Dimension): number[] {
  return pointsFor(state, dim).map((_, i) => i + 1)
}

/** 直接让模型「这一块聊完了」：报上全部要点序号收尾 */
function closeBlock(state: InterviewState, dim: Dimension): InterviewState {
  return nextStep(state, dim, 'block', { covered: allNumbers(state, dim) })
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

  it('不追问时，模型报上全部要点这一块就收尾 —— 块内没有固定顺序，客户端也不再数题', () => {
    let s = openBlock(createInterview(), 'event')
    const ids = pointsFor(s, 'event').map((p) => p.id)
    expect(ids).toHaveLength(4)

    s = closeBlock(s, 'event')
    expect(isBlockComplete(s, 'event')).toBe(true)
    expect(blockProgress(s, 'event').covered).toEqual(ids)
    // 一个回合就收尾：没有「一道一道问」这件事了
    expect(blockProgress(s, 'event').asked).toBe(1)
    expect(s.active).toBe('event')
  })

  it('模型一直不收尾时，聊满 MAX_TURNS_PER_BLOCK 个回合就被兜底收尾', () => {
    const started = openBlock(createInterview(), 'event')
    const { state, asked } = runBlock(started, 'event', 'next')

    expect(asked).toHaveLength(MAX_TURNS_PER_BLOCK)
    expect(blockProgress(state, 'event').asked).toBe(MAX_TURNS_PER_BLOCK)
    expect(isBlockComplete(state, 'event')).toBe(true)
    // 兜底收尾不改 active，也不伪造覆盖
    expect(state.active).toBe('event')
    expect(blockProgress(state, 'event').covered).toEqual([])
  })

  it('每次都要求追问时，追问次数被档位上限硬性拦住（到顶就降级成换方向）', () => {
    // 还没定档：用默认上限
    let s = openBlock(createInterview(), 'people')
    for (let i = 0; i < DEFAULT_FOLLOWUP_CAP; i++) s = nextStep(s, 'people', 'followup')
    expect(blockProgress(s, 'people').followUpCount).toBe(DEFAULT_FOLLOWUP_CAP)
    expect(isFollowUpTurn(s, 'people')).toBe(true)

    // 到顶之后再要追问，只能当作「换个方向」：计数归零
    s = nextStep(s, 'people', 'followup')
    expect(blockProgress(s, 'people').followUpCount).toBe(0)
    expect(isFollowUpTurn(s, 'people')).toBe(false)

    // 定了快速档：上限收到 1 次
    let fast = openBlock(setDepth(createInterview(), 'fast'), 'people')
    fast = nextStep(fast, 'people', 'followup')
    expect(blockProgress(fast, 'people').followUpCount).toBe(FOLLOWUP_CAPS.fast)
    fast = nextStep(fast, 'people', 'followup')
    expect(blockProgress(fast, 'people').followUpCount).toBe(0)

    // 一直追问也不会把这一块卡住：回合上限到了照样收尾
    expect(runBlock(openBlock(createInterview(), 'people'), 'people', 'followup').asked).toHaveLength(
      MAX_TURNS_PER_BLOCK,
    )
  })

  it('区块之间互不影响，可以只聊其中一块', () => {
    let s = openBlock(createInterview(), 'event')
    s = nextStep(s, 'event', 'next')

    expect(blockProgress(s, 'event').asked).toBe(1)
    expect(blockProgress(s, 'people').asked).toBe(0)
    expect(blockProgress(s, 'thing').asked).toBe(0)
    expect(blockProgress(s, 'growth').asked).toBe(0)
  })

  it('要点都聊完后，用户还想说就能接着说（自由聊）', () => {
    let s = openBlock(createInterview(), 'growth')
    s = closeBlock(s, 'growth')
    expect(isFreeChat(s, 'growth')).toBe(true)

    const before = coveragePercent(s)
    const beforeCovered = blockProgress(s, 'growth').covered
    const next = nextStep(s, 'growth', 'followup')

    // 要点不再推进，覆盖率也不动 —— 该聊的已经聊过了
    expect(blockProgress(next, 'growth').asked).toBe(blockProgress(s, 'growth').asked)
    expect(blockProgress(next, 'growth').covered).toEqual(beforeCovered)
    expect(blockProgress(next, 'growth').complete).toBe(true)
    expect(coveragePercent(next)).toBe(before)

    // 但这一句被记下来了，没人把他的话筒收走
    expect(blockProgress(next, 'growth').freeTurns).toBe(1)
    expect(blockProgress(next, 'growth').freeTurns).toBeGreaterThan(
      blockProgress(s, 'growth').freeTurns,
    )
  })

  it('每个内容块至少两个要点，除状态追问外每一步都有能念出来的锚点', () => {
    for (const d of CONTENT_BLOCKS) {
      expect(d.points.length).toBeGreaterThanOrEqual(2)
    }
    for (const d of SCRIPT) {
      // 状态追问的要点按分数现算（probe.ts），这份静态表里当然是空的
      if (d.key === PROBE_KEY) {
        expect(d.points).toEqual([])
        continue
      }
      expect(d.points.length).toBeGreaterThan(0)
      for (const p of d.points) expect(spoken(p).trim().length).toBeGreaterThan(0)
    }
  })

  it('能区分「换方向」和「追问」', () => {
    let s = openBlock(createInterview(), 'thing')
    expect(isFollowUpTurn(s, 'thing')).toBe(false)

    s = nextStep(s, 'thing', 'followup')
    expect(isFollowUpTurn(s, 'thing')).toBe(true)
    expect(blockProgress(s, 'thing').followUpCount).toBe(1)

    // 换方向：追问计数归零，模型报上来的那个要点被记下
    s = nextStep(s, 'thing', 'next', { covered: [2] })
    expect(isFollowUpTurn(s, 'thing')).toBe(false)
    expect(blockProgress(s, 'thing').followUpCount).toBe(0)
    expect(blockProgress(s, 'thing').covered).toEqual(['thing-delayed'])
    expect(spoken(currentPoint(s, 'thing')).trim().length).toBeGreaterThan(0)

    // 收尾同样归零
    s = nextStep(s, 'thing', 'block')
    expect(blockProgress(s, 'thing').followUpCount).toBe(0)
    expect(isBlockComplete(s, 'thing')).toBe(true)
  })

  it('[换块] 让当前块立即收尾，覆盖率按报上来的要点算', () => {
    let s = openBlock(createInterview(), 'event')
    expect(coveragePercent(s)).toBe(0)

    s = nextStep(s, 'event', 'block', { covered: [1, 3] })
    expect(isBlockComplete(s, 'event')).toBe(true)
    expect(blockProgress(s, 'event').followUpCount).toBe(0)
    // 模型只报了两个要点，覆盖率就只算这两个 —— 剩下的是收尾对账要去补的
    expect(coveredInBlock(s, 'event')).toBe(2)
    expect(blockProgress(s, 'event').covered).toEqual(['event-focus', 'event-unsure'])
    expect(coveragePercent(s)).toBe(Math.round((2 / TOTAL_POINTS) * 100))
  })

  it('能算出覆盖率，并指出下一块该聊什么', () => {
    let s = createInterview()
    expect(nextIncompleteBlock(s)).toBe('event')

    s = closeBlock(openBlock(s, 'event'), 'event')
    expect(coveredInBlock(s, 'event')).toBe(4)
    expect(nextIncompleteBlock(s)).toBe('people')
    expect(isAllComplete(s)).toBe(false)

    for (const d of SCRIPT) s = closeBlock(openBlock(s, d.key), d.key)
    expect(isAllComplete(s)).toBe(true)
    expect(coveragePercent(s)).toBe(100)
    expect(nextIncompleteBlock(s)).toBeNull()
  })

  it('覆盖率的分母只有四个内容块，上周对账不占进度', () => {
    const reconcileOnly = nextStep(createInterview(), 'reconcile', 'block', { covered: [1] })
    expect(isBlockComplete(reconcileOnly, 'reconcile')).toBe(true)
    expect(coveredInBlock(reconcileOnly, 'reconcile')).toBe(1)
    expect(coveragePercent(reconcileOnly)).toBe(0)

    expect(TOTAL_POINTS).toBe(CONTENT_BLOCKS.reduce((n, d) => n + d.points.length, 0))
    expect(dimensionScript('reconcile')?.kind).toBe('step')
  })

  it('nextStage：先交状态打分卡，再定档，然后才进第一块', () => {
    expect(nextStage(createInterview())).toEqual({ kind: 'state' })

    // 卡没交，先按档位按钮也不往下走
    expect(nextStage(setDepth(createInterview(), 'mid'))).toEqual({ kind: 'state' })

    const stateDone = setStateDone(createInterview())
    expect(nextStage(stateDone)).toEqual({ kind: 'depth' })

    // 卡交了但没挑档位：哪怕已经有一块聊完了，也停在 depth 等人挑
    const growthDone = closeBlock(stateDone, 'growth')
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
    const reconcileDone = closeBlock(createInterview(), 'reconcile')
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

  it('走完全部要点，一个都不漏', () => {
    let s = createInterview()
    const coveredAll: string[] = []
    for (const d of SCRIPT) {
      s = closeBlock(openBlock(s, d.key), d.key)
      coveredAll.push(...blockProgress(s, d.key).covered)
    }
    // 状态追问没有低分项（它是空的一步），所以这里正好把脚本里写死的要点全收齐
    expect(coveredAll).toEqual(
      SCRIPT.filter((d) => d.key !== PROBE_KEY)
        .flatMap((d) => d.points)
        .map((p) => p.id),
    )
    // 四个内容块的要点正好是 TOTAL_POINTS，对账那一个不占进度
    expect(CONTENT_BLOCKS.flatMap((d) => d.points)).toHaveLength(TOTAL_POINTS)
    expect(SCRIPT.flatMap((d) => d.points)).toHaveLength(TOTAL_POINTS + 1)
  })

  it('覆盖率只增不减，并最终到达 100', () => {
    let s = createInterview()
    const seen = [coveragePercent(s)]
    for (const d of CONTENT_BLOCKS) {
      // 一个要点一个要点地报，覆盖率应当一步一步往上走
      for (const n of allNumbers(s, d.key)) {
        s = nextStep(s, d.key, 'next', { covered: [n] })
        seen.push(coveragePercent(s))
      }
    }
    expect(seen[seen.length - 1]).toBe(100)
    for (let i = 1; i < seen.length; i++) {
      expect(seen[i]).toBeGreaterThanOrEqual(seen[i - 1])
    }
  })

  it('未聊到的要点按要点表顺序给出，序号 1 起', () => {
    const s = createInterview()
    expect(uncoveredPoints(s, 'people').map((p) => p.id)).toEqual([
      'people-most',
      'people-missed',
      'people-awkward',
    ])
    expect(currentPointNumber(s, 'people')).toBe(1)
    expect(pointsInBlock(s, 'people')).toBe(3)

    const after = nextStep(s, 'people', 'next', { covered: [1] })
    expect(currentPoint(after, 'people')?.id).toBe('people-missed')
    expect(currentPointNumber(after, 'people')).toBe(2)
    expect(coveredInBlock(after, 'people')).toBe(1)

    // 都聊到了就是 undefined，而不是 0 或者越界
    const done = closeBlock(s, 'people')
    expect(currentPoint(done, 'people')).toBeUndefined()
    expect(currentPointNumber(done, 'people')).toBeUndefined()
    expect(uncoveredPoints(done, 'people')).toEqual([])
  })

  it('把模型报的序号翻成要点 id：越界的丢掉、重复的只算一次', () => {
    const s = createInterview()
    expect(coveredIdsFromNumbers(s, 'event', [1, 3])).toEqual(['event-focus', 'event-unsure'])
    expect(coveredIdsFromNumbers(s, 'event', [1, 1, 3])).toEqual(['event-focus', 'event-unsure'])
    expect(coveredIdsFromNumbers(s, 'event', [0, 9])).toEqual([])
    expect(coveredIdsFromNumbers(s, 'event', [])).toEqual([])
    expect(coveredIdsFromNumbers(s, 'nope' as Dimension, [1])).toEqual([])
  })

  it('收尾对账：没聊到的要点摆出来，补问就把这一块退回未完成', () => {
    let s = nextStep(openBlock(createInterview(), 'event'), 'event', 'block', { covered: [1, 2] })

    let plan = planBlockEnd(s, 'event')
    expect(plan.missing.map((p) => p.id)).toEqual(['event-unsure', 'event-interrupt'])
    expect(plan.nudge).toBe(true)
    expect(plan.ask).toBe(plan.missing[0])

    s = nudgeBack(s, 'event')
    expect(isBlockComplete(s, 'event')).toBe(false)
    expect(blockProgress(s, 'event').nudges).toBe(1)

    // 补满 MAX_NUDGES 次还不齐就放行：宁可少聊一样，也不要变成审讯
    s = nudgeBack(s, 'event')
    expect(blockProgress(s, 'event').nudges).toBe(MAX_NUDGES)
    plan = planBlockEnd(s, 'event')
    expect(plan.missing.map((p) => p.id)).toEqual(['event-unsure', 'event-interrupt'])
    expect(plan.nudge).toBe(false)
    expect(plan.ask).toBeUndefined()
  })

  it('要点都聊到了就不用补问', () => {
    const s = closeBlock(createInterview(), 'event')
    expect(planBlockEnd(s, 'event')).toEqual({ missing: [], nudge: false })
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

    expect(() => currentPoint(wild, 'event')).not.toThrow()
    expect(currentPoint(wild, 'event')).toBe(pointsOf('event')[0])
    expect(currentPointNumber(wild, 'event')).toBe(1)
    expect(pointsInBlock(wild, 'event')).toBe(4)
    expect(currentFollowUpCap(wild)).toBe(DEFAULT_FOLLOWUP_CAP)
    // 残缺状态里没有 lowKeys：状态追问这一步就是空的，不会凭空造要点
    expect(pointsFor(wild, PROBE_KEY)).toEqual([])

    const unknown = 'nope' as Dimension
    expect(currentPoint(wild, unknown)).toBeUndefined()
    expect(currentPointNumber(wild, unknown)).toBeUndefined()
    expect(nextStep(wild, unknown, 'followup')).toBe(wild)
    expect(pointsInBlock(wild, unknown)).toBe(0)
    expect(coveredInBlock(wild, unknown)).toBe(0)
    expect(planBlockEnd(wild, unknown)).toEqual({ missing: [], nudge: false })
  })
})

/**
 * 0.9.3 起「状态」不再是采访的一块：它是开场一张打分卡（四项点星 + 一行备注），
 * 由界面点击产生，既不进 SCRIPT、也不占要点、也不占 AI 轮次。
 * 这一组用例钉的就是这条边界 —— 旧口径下 mood 是第五个区块，还带四道题。
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

  it('重复交卡但分数变了，低分项跟着重算', () => {
    const first = setStateDone(createInterview(), { sleep: 2, sport: 1 })
    expect(first.lowKeys).toEqual(['sleep', 'sport'])
    // 分一样：连引用都不换
    expect(setStateDone(first, { sleep: 2, sport: 1 })).toBe(first)
    // 分变了：低分项跟着变
    const changed = setStateDone(first, { sleep: 5, sport: 1 })
    expect(changed).not.toBe(first)
    expect(changed.lowKeys).toEqual(['sport'])
  })
})

/**
 * 0.9.4：打完分之后的「状态追问」。
 *
 * 这一步是用户提的第一个问题（「打完分之后就没后续了」）的解法：
 * 聊哪几样全看交卡那一刻的分 —— 所以它必须排在定档之后、内容块之前，
 * 而且没有低分项时**整步跳过**，不能给用户一个空步骤。
 *
 * 0.9.5 起这一步的「题目」也变成了**要点**：一项一个，按打分卡顺序现算，
 * 但先聊哪个、怎么聊仍然由模型定。
 */
describe('状态追问 · 按打分决定聊什么', () => {
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

  it('这一步的要点按低分项现算：一项一个，id 形如 probe-sleep', () => {
    const s = ready({ sleep: 2, sport: 1 })
    expect(pointsInBlock(s, 'probe')).toBe(2)
    expect(pointsFor(s, 'probe').map((p) => p.id)).toEqual(['probe-sleep', 'probe-sport'])
    expect(pointsFor(s, 'probe')[0].intent).toContain('睡眠')
  })

  it('两项低就有两个要点，聊到一个才算一个，两个都聊到这一步才收尾', () => {
    let s = openBlock(ready({ sleep: 2, sport: 1 }), 'probe')

    expect(pointsFor(s, 'probe').map((p) => p.id)).toEqual(['probe-sleep', 'probe-sport'])
    expect(currentPoint(s, 'probe')?.intent).toContain('睡眠')

    // 聊到第一项 → 轮到第二项，这一步还没完
    s = nextStep(s, 'probe', 'next', { covered: [1] })
    expect(coveredInBlock(s, 'probe')).toBe(1)
    expect(currentPoint(s, 'probe')?.intent).toContain('运动')
    expect(isBlockComplete(s, 'probe')).toBe(false)

    // 收尾时把第二项也报上 → 两项都聊到，这一步收尾
    s = nextStep(s, 'probe', 'block', { covered: [2] })
    expect(isBlockComplete(s, 'probe')).toBe(true)
    expect(uncoveredPoints(s, 'probe')).toEqual([])
    expect(coveragePercent(s)).toBe(0)
  })

  it('换了要点就重新数追问：换方向时追问计数归零', () => {
    let s = openBlock(ready({ sleep: 2, sport: 2 }), 'probe')
    s = nextStep(s, 'probe', 'followup')
    expect(blockProgress(s, 'probe').followUpCount).toBe(1)

    s = nextStep(s, 'probe', 'next', { covered: [1] })
    expect(blockProgress(s, 'probe').followUpCount).toBe(0)
    expect(currentPoint(s, 'probe')?.intent).toContain('运动')
  })

  it('追问次数到顶就该换要点 —— 上限还是跟着档位走', () => {
    const fast = setDepth(setStateDone(createInterview(), { sleep: 1, sport: 1 }), 'fast')
    let s = openBlock(fast, 'probe')
    expect(currentFollowUpCap(s)).toBe(FOLLOWUP_CAPS.fast)

    s = nextStep(s, 'probe', 'followup')
    expect(blockProgress(s, 'probe').followUpCount).toBe(1)
    // 到顶了：再要追问也只能换要点
    s = nextStep(s, 'probe', 'followup')
    expect(blockProgress(s, 'probe').followUpCount).toBe(0)
  })

  it('[换块] 让这一步立刻收尾，不用把剩下的要点走完', () => {
    let s = openBlock(ready({ sleep: 1, sport: 1, mood: 1 }), 'probe')
    s = nextStep(s, 'probe', 'block', { covered: [1] })
    expect(isBlockComplete(s, 'probe')).toBe(true)
    expect(nextStage(s)).toEqual({ kind: 'block', dim: 'reconcile' })
    // 只报了一项，收尾对账会把剩下的摆出来
    expect(uncoveredPoints(s, 'probe').map((p) => p.id)).toEqual(['probe-sleep', 'probe-sport'])
  })

  it('状态追问不占覆盖率 —— 它是流程里的一步，不是内容块', () => {
    let s = openBlock(ready({ sleep: 1, sport: 1 }), 'probe')
    expect(coveragePercent(s)).toBe(0)
    s = nextStep(s, 'probe', 'block', { covered: [1, 2] })
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
