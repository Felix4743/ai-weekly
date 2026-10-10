import {
  CONTENT_BLOCKS,
  MAX_NUDGES,
  MAX_TURNS_PER_BLOCK,
  PROBE_KEY,
  SCRIPT,
  TOTAL_POINTS,
  dimensionScript,
  followUpCap,
  pointsOf,
  type PointSpec,
} from './script'
import { lowScoreKeys, probePoints } from './probe'
import type {
  BlockProgress,
  BlockProgressMap,
  Depth,
  Dimension,
  InterviewState,
  StateScores,
  TurnAction,
} from './types'

export type { TurnAction }

const EMPTY_PROGRESS: BlockProgress = {
  asked: 0,
  followUpCount: 0,
  complete: false,
  freeTurns: 0,
  covered: [],
  nudges: 0,
}

export interface CreateInterviewOptions {
  /** 上一周有没有记录；没有就把「上周对账」这一步直接标成已过 */
  hasLastWeek?: boolean
}

export function createInterview(options: CreateInterviewOptions = {}): InterviewState {
  const { hasLastWeek = true } = options
  const blocks = {} as BlockProgressMap
  for (const d of SCRIPT) {
    blocks[d.key] = { ...EMPTY_PROGRESS }
  }
  if (!hasLastWeek) {
    blocks.reconcile = { ...EMPTY_PROGRESS, complete: true }
  }
  // probe 要不要跳过，得等卡交上来才知道（分数那时才有），所以创建时一律是「没问过」
  return { active: null, blocks, stateDone: false, lowKeys: [], depth: null }
}

export function blockProgress(s: InterviewState, dim: Dimension): BlockProgress {
  return s.blocks[dim] ?? EMPTY_PROGRESS
}

/* ---------------- 切换区块 ---------------- */

export function openBlock(s: InterviewState, dim: Dimension): InterviewState {
  if (s.active === dim) return s
  return { ...s, active: dim }
}

/**
 * 开场那张状态打分卡交上来了（四项点完星、点了开始）。
 *
 * 交卡这一刻顺带**定下低分项**（≤ 2 星）——`probe` 那一步聊的就是这几项，
 * 聊几样、什么时候跳过都由它决定，所以必须在这里落定，而不是每次现算。
 * 一项都不低（或者他压根没打分）就把这一步直接标成已过：用户看不到空的一步。
 */
export function setStateDone(
  s: InterviewState,
  scores: StateScores | undefined = {},
): InterviewState {
  const lowKeys = lowScoreKeys(scores)
  const current = s.lowKeys ?? []
  const sameKeys = current.length === lowKeys.length && current.every((key, i) => key === lowKeys[i])
  // 重复交卡不该白改一次状态（界面照旧、引用也别换）
  if (s.stateDone && sameKeys) return s

  const blocks =
    lowKeys.length > 0
      ? s.blocks
      : { ...s.blocks, [PROBE_KEY]: { ...blockProgress(s, PROBE_KEY), complete: true } }
  return { ...s, stateDone: true, lowKeys, blocks }
}

/* ---------------- 要点：这一块要聊到哪几样 ---------------- */

/**
 * 这一块要聊到的几样。
 *
 * 只有 `probe` 是现算的 —— 聊哪几项取决于他给自己打的分（见 `probe.ts`），
 * 别的块都是写死的。状态机与提示词都走这一个入口，免得两边对不上。
 */
export function pointsFor(s: InterviewState, dim: Dimension): PointSpec[] {
  // `?? []` 不是多余的：手工拼的残缺状态可能根本没有这个键，而这里每走一步都要问一次
  if (dim === PROBE_KEY) return probePoints(s.lowKeys ?? [])
  return pointsOf(dim)
}

/** 这一块还没聊到的要点。**顺序就是要点表里的顺序**，补问按它挑第一个 */
export function uncoveredPoints(s: InterviewState, dim: Dimension): PointSpec[] {
  const covered = new Set(blockProgress(s, dim).covered ?? [])
  return pointsFor(s, dim).filter((p) => !covered.has(p.id))
}

/** 第一个还没聊到的要点；都聊到了就是 undefined */
export function currentPoint(s: InterviewState, dim: Dimension): PointSpec | undefined {
  return uncoveredPoints(s, dim)[0]
}

/**
 * 当前这个（还没聊到的）要点的**序号**，1 起；都聊到了就是 undefined。
 *
 * 「这题跳过」要用它：跳过 = 「这一点我没什么可说的」，于是把它记成聊到了再往下走 ——
 * 不然下一个要点的锚点问法会把同一句又问一遍。
 */
export function currentPointNumber(s: InterviewState, dim: Dimension): number | undefined {
  const points = pointsFor(s, dim)
  const covered = new Set(blockProgress(s, dim).covered ?? [])
  const idx = points.findIndex((p) => !covered.has(p.id))
  return idx >= 0 ? idx + 1 : undefined
}

/** 这一块已经聊到几个要点 */
export function coveredInBlock(s: InterviewState, dim: Dimension): number {
  const covered = new Set(blockProgress(s, dim).covered ?? [])
  return pointsFor(s, dim).filter((p) => covered.has(p.id)).length
}

/** 这一块一共几个要点（界面上 tab 的分母） */
export function pointsInBlock(s: InterviewState, dim: Dimension): number {
  return pointsFor(s, dim).length
}

/** 把模型报上来的序号翻成要点 id；认不出来的号直接丢掉 */
export function coveredIdsFromNumbers(
  s: InterviewState,
  dim: Dimension,
  numbers: readonly number[],
): string[] {
  const points = pointsFor(s, dim)
  const out: string[] = []
  for (const n of numbers) {
    const point = points[n - 1]
    if (point && !out.includes(point.id)) out.push(point.id)
  }
  return out
}

/* ---------------- 深度档位 ---------------- */

/**
 * 定档。
 *
 * 档位只决定两件事：同一个话题最多连着追几次（安全上限，判定还是靠「问到效果没有」），
 * 以及提示词里怎么把握节奏。中途改口就再调一次，不锁死。
 */
export function setDepth(s: InterviewState, depth: Depth): InterviewState {
  if (s.depth === depth) return s
  return { ...s, depth }
}

export function currentFollowUpCap(s: InterviewState): number {
  return followUpCap(s.depth)
}

/* ---------------- 推进 ---------------- */

export interface AdvanceOptions {
  /** 模型这一轮在 `[换块]` 那行报上来的要点序号（1 起） */
  covered?: readonly number[]
}

/**
 * 在一个区块内推进一步。
 *
 * 0.9.5 起**没有「下一道题」了**：模型自己在要点之间走，客户端只记两件事 ——
 * 这一块聊了几个回合（防打转）、同一个话题连着追了几次（防审讯）。
 * 「这一块聊完了」由模型用 `[换块]` 说，并在那一行报上覆盖了哪几个要点。
 */
export function nextStep(
  s: InterviewState,
  dim: Dimension,
  action: TurnAction,
  options: AdvanceOptions = {},
): InterviewState {
  const points = pointsFor(s, dim)
  const p = blockProgress(s, dim)

  // 没有要点可聊（状态追问没挑出低分项时就是这样）：直接算这一步过。
  // 未知区块例外：那种情况连要点都构造不出来，原样返回、别凭空虚造一个进度项。
  if (points.length === 0) {
    if (!dimensionScript(dim) || p.complete) return s
    return { ...s, blocks: { ...s.blocks, [dim]: { ...p, complete: true } } }
  }

  /**
   * 主问题聊完之后的**自由聊**。
   *
   * 这里刻意只加 freeTurns、不动覆盖率，也不把他赶去下一块：
   * 要点聊完了不等于他想说的说完了。追问上限是防审讯的，不该用来捂嘴。
   */
  if (p.complete) {
    return {
      ...s,
      blocks: { ...s.blocks, [dim]: { ...p, freeTurns: p.freeTurns + 1 } },
    }
  }

  const asked = p.asked + 1
  const coveredNow = coveredIdsFromNumbers(s, dim, options.covered ?? [])

  if (action === 'block') {
    const covered = [...new Set([...(p.covered ?? []), ...coveredNow])]
    return {
      ...s,
      blocks: { ...s.blocks, [dim]: { ...p, asked, followUpCount: 0, complete: true, covered } },
    }
  }

  // 连着追到上限了就当作换题：少追一次只是损失一点深度，卡在这儿才是产品层面失效
  const cap = followUpCap(s.depth)
  const followup = action === 'followup' && p.followUpCount < cap
  const coveredAfter = followup
    ? (p.covered ?? [])
    : [...new Set([...(p.covered ?? []), ...coveredNow])]
  const next: BlockProgress = {
    ...p,
    asked,
    followUpCount: followup ? p.followUpCount + 1 : 0,
    covered: coveredAfter,
  }

  /**
   * 什么时候算这一块聊完了。
   *
   * 正常路径是模型用 `[换块]` 说一声（那一行还报着覆盖）；但**要点都聊到了本身就等于聊完了** ——
   * 不必等它开口。这一条兜住两种真实情况：用户在「这题跳过」里逐个跳过所有要点、
   * 以及演示模式的假 AI 逐个报覆盖。少了它，块会一直开着而界面上没有下一句可显示。
   *
   * `asked` 到上限是另一条兜底：模型一直不换块、或者用户一直追同一件事。
   */
  if (coveredAfter.length >= points.length || asked >= MAX_TURNS_PER_BLOCK) next.complete = true

  return { ...s, blocks: { ...s.blocks, [dim]: next } }
}

/**
 * 收尾对账：模型说「这一块聊完了」之后，客户端算一下还差哪几样。
 *
 * 只做一件事 —— 把「缺的要点」和「要不要替它补问一句」摆出来，不自己改状态。
 * `nudge` 为真时调用方应当把这一块退回未完成（`nudgeBack`）并补问 `ask`。
 */
export interface BlockEndPlan {
  /** 还差哪几个要点 */
  missing: PointSpec[]
  /** 客户端要不要补问一句（true = 这一块先不收尾） */
  nudge: boolean
  /** 补问该问哪一个；没得补就是 undefined */
  ask?: PointSpec
}

export function planBlockEnd(s: InterviewState, dim: Dimension): BlockEndPlan {
  const missing = uncoveredPoints(s, dim)
  const p = blockProgress(s, dim)

  if (missing.length === 0) return { missing, nudge: false }

  /**
   * **一条覆盖都没报过**时按「没按格式报」处理，而不是「一样都没聊到」。
   *
   * 这两种在数据上一样（`covered` 是空的），但意思完全不同：后者会让我们每个块都
   * 白补问两句、把人按在这儿。没有信息就不该替它下判断 —— 补问只在
   * 「报过覆盖、而且报得不全」时才发生。
   */
  if ((p.covered ?? []).length === 0) return { missing, nudge: false }

  // 补满次数还不齐就放行：宁可少聊一样，也不要变成审讯
  if ((p.nudges ?? 0) >= MAX_NUDGES) return { missing, nudge: false }
  return { missing, nudge: true, ask: missing[0] }
}

/** 把已经收尾的块退回未完成，并记一次补问（调用方随后把 `ask` 那句问出去） */
export function nudgeBack(s: InterviewState, dim: Dimension): InterviewState {
  const p = blockProgress(s, dim)
  return {
    ...s,
    blocks: { ...s.blocks, [dim]: { ...p, complete: false, nudges: (p.nudges ?? 0) + 1 } },
  }
}

/** 这一块的主问题已经聊完，现在多说的每一句都算自由聊 */
export function isFreeChat(s: InterviewState, dim: Dimension): boolean {
  return blockProgress(s, dim).complete
}

/** 当前这一问是不是追问 */
export function isFollowUpTurn(s: InterviewState, dim: Dimension): boolean {
  return blockProgress(s, dim).followUpCount > 0
}

/** 用户点「生成梳理」时，把所有区块标记为已结束 */
export function finishAll(s: InterviewState): InterviewState {
  const blocks = {} as BlockProgressMap
  for (const d of SCRIPT) blocks[d.key] = { ...blockProgress(s, d.key), complete: true }
  return { active: s.active, blocks, stateDone: true, lowKeys: s.lowKeys, depth: s.depth }
}

/* ---------------- 流程走到哪儿了 ---------------- */

export type Stage =
  | { kind: 'state' }
  | { kind: 'depth' }
  | { kind: 'block'; dim: Dimension }
  | { kind: 'done' }

/**
 * 这一刻该干什么。纯函数，UI 与 App 都靠它，避免各自记一套顺序。
 *
 * 顺序：**先交状态打分卡** → 定档 → 按 SCRIPT 顺序走（状态追问 → 对账 → 事情 → 人际 → 物品与支出 → 成长）
 * → 全完 → done。
 * 没有要点的步骤直接跳过（状态追问没挑出低分项时它就是空的一步）。
 */
export function nextStage(s: InterviewState): Stage {
  if (!s.stateDone) return { kind: 'state' }
  if (s.depth === null) return { kind: 'depth' }

  for (const d of SCRIPT) {
    if (blockProgress(s, d.key).complete) continue
    if (pointsFor(s, d.key).length === 0) continue
    return { kind: 'block', dim: d.key }
  }
  return { kind: 'done' }
}

/* ---------------- 进度与统计 ---------------- */

export function isBlockComplete(s: InterviewState, dim: Dimension): boolean {
  return blockProgress(s, dim).complete
}

export function isAllComplete(s: InterviewState): boolean {
  return SCRIPT.every(
    (d) => blockProgress(s, d.key).complete || pointsFor(s, d.key).length === 0,
  )
}

/**
 * 覆盖率只算四个内容块，而且算的是**要点**：已聊到的要点 ÷ 12。
 * 状态追问与上周对账是流程里的两道小题，不占进度。
 */
export function coveragePercent(s: InterviewState): number {
  const done = CONTENT_BLOCKS.reduce((n, d) => n + coveredInBlock(s, d.key), 0)
  const pct = TOTAL_POINTS > 0 ? (done / TOTAL_POINTS) * 100 : 0
  return Math.max(0, Math.min(100, Math.round(pct)))
}

/** 下一个还没聊完的内容块，用于给出「接着聊」的建议 */
export function nextIncompleteBlock(s: InterviewState): Dimension | null {
  return CONTENT_BLOCKS.find((d) => !blockProgress(s, d.key).complete)?.key ?? null
}
