import {
  CONTENT_BLOCKS,
  PROBE_KEY,
  SCRIPT,
  TOTAL_MAIN_QUESTIONS,
  dimensionScript,
  followUpCap,
  type QuestionSpec,
} from './script'
import { lowScoreKeys, probeQuestions } from './probe'
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
  askIndex: 0,
  followUpCount: 0,
  complete: false,
  freeTurns: 0,
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
 * 交卡这一刻顺带**定下低分项**（≤ 2 星）——`probe` 那一步问的就是这几项，
 * 问几道题、什么时候跳过都由它决定，所以必须在这里落定，而不是每次现算。
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

/* ---------------- 当前该问什么 ---------------- */

/**
 * 这一步的主问题清单。
 *
 * 只有 `probe` 是现算的 —— 问几道题取决于他给自己打的分（见 `probe.ts`），
 * 别的步骤都是写死的。`currentQuestionSpec` / `nextStep` / `answeredInBlock`
 * 全部走这一个入口，免得出现「状态机按写死的清单推进、提示词按分数提问」
 * 这种两边对不上的情况。
 */
export function mainQuestionsFor(s: InterviewState, dim: Dimension): QuestionSpec[] {
  // `?? []` 不是多余的：手工拼的残缺状态（比如归档里翻出来的）可能根本没有这个键，
  // 而这里被 nextStage 每走一步都要问一次，抛错就等于整个流程打不开
  if (dim === PROBE_KEY) return probeQuestions(s.lowKeys ?? [])
  return dimensionScript(dim)?.mainQuestions ?? []
}

export function currentQuestionSpec(s: InterviewState, dim: Dimension): QuestionSpec | undefined {
  const list = mainQuestionsFor(s, dim)
  if (list.length === 0) return undefined
  const p = blockProgress(s, dim)
  return list[Math.min(p.askIndex, list.length - 1)]
}

export function currentFollowUpSpec(s: InterviewState, dim: Dimension): QuestionSpec | undefined {
  const script = dimensionScript(dim)
  if (!script || script.followUps.length === 0) return undefined
  const p = blockProgress(s, dim)
  return script.followUps[p.followUpCount % script.followUps.length]
}

/** 当前这一问是不是追问（用于让 AI 区分「换题」和「深挖」） */
export function isFollowUpTurn(s: InterviewState, dim: Dimension): boolean {
  return blockProgress(s, dim).followUpCount > 0
}

/* ---------------- 深度档位 ---------------- */

/**
 * 定档。
 *
 * 档位只决定两件事：每道题最多追几次（安全上限，判定还是靠「问到效果没有」），
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

/** 模型这一轮想干什么：接着追 / 换下一题 / 这块聊够了换下一块 */
/**
 * 在某个区块内推进一步。
 *
 * 换下一块由模型判定（`[换块]`），状态机只兜两件事：
 * 追问次数上限（防审讯），以及参考清单问完之后自动收尾（兜底，防止原地打转）。
 */
export function nextStep(
  s: InterviewState,
  dim: Dimension,
  action: TurnAction,
): InterviewState {
  const questions = mainQuestionsFor(s, dim)
  const p = blockProgress(s, dim)

  // 没有题目可问（状态追问没挑出低分项时就是这样）：直接算这一步过。
  // 不能原样返回 —— 那样这一步永远完不成，流程会卡在一个空的步骤上。
  // 未知区块例外：那种情况连题目都构造不出来，原样返回、别凭空虚造一个进度项。
  if (questions.length === 0) {
    if (!dimensionScript(dim) || p.complete) return s
    return { ...s, blocks: { ...s.blocks, [dim]: { ...p, complete: true } } }
  }

  /**
   * 主问题已经问完，用户还在说。
   *
   * 这里刻意只加 freeTurns、不动覆盖率，也不把他赶去下一块：
   * 脚本问完了不等于他想说的说完了。追问上限是防审讯的，不该用来捂嘴。
   */
  if (p.complete) {
    return {
      ...s,
      blocks: { ...s.blocks, [dim]: { ...p, freeTurns: p.freeTurns + 1 } },
    }
  }

  // 模型判定「这块的关键都拿到了」：直接收尾，不再数题
  if (action === 'block') {
    return {
      ...s,
      blocks: { ...s.blocks, [dim]: { ...p, followUpCount: 0, complete: true } },
    }
  }

  const cap = followUpCap(s.depth)
  if (action === 'followup' && p.followUpCount < cap) {
    return {
      ...s,
      blocks: { ...s.blocks, [dim]: { ...p, followUpCount: p.followUpCount + 1 } },
    }
  }

  const nextAsk = p.askIndex + 1
  if (nextAsk < questions.length) {
    return {
      ...s,
      blocks: {
        ...s.blocks,
        [dim]: { askIndex: nextAsk, followUpCount: 0, complete: false, freeTurns: p.freeTurns },
      },
    }
  }

  // 参考清单问完了，自动收尾（正常情况模型会先给出 [换块]）
  return {
    ...s,
    blocks: { ...s.blocks, [dim]: { ...p, followUpCount: 0, complete: true } },
  }
}

/** 这一块的主问题已经问完，现在多说的每一句都算自由聊 */
export function isFreeChat(s: InterviewState, dim: Dimension): boolean {
  return blockProgress(s, dim).complete
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
 * 顺序：**先交状态打分卡** → 定档 → 按 SCRIPT 顺序走（对账 → 事情 → 人际 → 物品与支出 → 成长）
 * → 全完 → done。
 *
 * 状态卡不是问答块：它是客户端一屏（四项点星 + 一行备注），
 * 交上来才算 `stateDone`，所以「先打分再开始问」是流程保证，不是提示词里的请求。
 */
export function nextStage(s: InterviewState): Stage {
  if (!s.stateDone) return { kind: 'state' }
  if (s.depth === null) return { kind: 'depth' }

  for (const d of SCRIPT) {
    if (blockProgress(s, d.key).complete) continue
    // 没有题目的步骤直接跳过：状态追问没挑出低分项时它就是空的一步，
    // 不该在流程里露出来（谁拼的状态都一样 —— 不指望调用方先把 complete 标好）
    if (mainQuestionsFor(s, d.key).length === 0) continue
    return { kind: 'block', dim: d.key }
  }
  return { kind: 'done' }
}

/* ---------------- 进度与统计 ---------------- */

export function isBlockComplete(s: InterviewState, dim: Dimension): boolean {
  return blockProgress(s, dim).complete
}

export function isAllComplete(s: InterviewState): boolean {
  return SCRIPT.every((d) => blockProgress(s, d.key).complete)
}

/** 该区块已经回答过几个主问题 */
export function answeredInBlock(s: InterviewState, dim: Dimension): number {
  const list = mainQuestionsFor(s, dim)
  const p = blockProgress(s, dim)
  if (p.complete) return list.length
  return Math.min(p.askIndex, list.length)
}

/** 该区块一共有几个主问题 */
export function questionsInBlock(dim: Dimension): number {
  return dimensionScript(dim)?.mainQuestions.length ?? 0
}

/** 覆盖率只算四个内容块；「上周对账」是流程里的一道小题，不占进度 */
export function coveragePercent(s: InterviewState): number {
  const done = CONTENT_BLOCKS.reduce((n, d) => n + answeredInBlock(s, d.key), 0)
  const pct = (done / TOTAL_MAIN_QUESTIONS) * 100
  return Math.max(0, Math.min(100, Math.round(pct)))
}

/** 下一个还没聊完的内容块，用于给出「接着聊」的建议 */
export function nextIncompleteBlock(s: InterviewState): Dimension | null {
  return CONTENT_BLOCKS.find((d) => !blockProgress(s, d.key).complete)?.key ?? null
}
