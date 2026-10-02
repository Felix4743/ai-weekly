import {
  CONTENT_BLOCKS,
  SCRIPT,
  TOTAL_MAIN_QUESTIONS,
  dimensionScript,
  followUpCap,
} from './script'
import type {
  BlockProgress,
  BlockProgressMap,
  Depth,
  Dimension,
  InterviewState,
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
  return { active: null, blocks, depth: null }
}

export function blockProgress(s: InterviewState, dim: Dimension): BlockProgress {
  return s.blocks[dim] ?? EMPTY_PROGRESS
}

/* ---------------- 切换区块 ---------------- */

export function openBlock(s: InterviewState, dim: Dimension): InterviewState {
  if (s.active === dim) return s
  return { ...s, active: dim }
}

/* ---------------- 当前该问什么 ---------------- */

export function currentQuestion(s: InterviewState, dim: Dimension): string {
  const script = dimensionScript(dim)
  if (!script) return ''
  const p = blockProgress(s, dim)
  return script.mainQuestions[Math.min(p.askIndex, script.mainQuestions.length - 1)] ?? ''
}

export function currentFollowUp(s: InterviewState, dim: Dimension): string {
  const script = dimensionScript(dim)
  if (!script) return ''
  const p = blockProgress(s, dim)
  return script.followUps[p.followUpCount % script.followUps.length] ?? ''
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
  const script = dimensionScript(dim)
  if (!script) return s

  const p = blockProgress(s, dim)

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
  if (nextAsk < script.mainQuestions.length) {
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
  return { active: s.active, blocks, depth: s.depth }
}

/* ---------------- 流程走到哪儿了 ---------------- */

export type Stage =
  | { kind: 'block'; dim: Dimension }
  | { kind: 'depth' }
  | { kind: 'done' }

/**
 * 这一刻该干什么。纯函数，UI 与 App 都靠它，避免各自记一套顺序。
 *
 * 顺序：状态没聊完 → 状态；聊完了还没定档 → 等用户挑档位；
 * 然后按 SCRIPT 顺序走（对账 → 事情 → 人际 → 物与钱），全完 → done。
 */
export function nextStage(s: InterviewState): Stage {
  const mood = blockProgress(s, 'mood')
  if (!mood.complete) return { kind: 'block', dim: 'mood' }
  if (s.depth === null) return { kind: 'depth' }

  for (const d of SCRIPT) {
    if (d.key === 'mood') continue
    if (!blockProgress(s, d.key).complete) return { kind: 'block', dim: d.key }
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
  const script = dimensionScript(dim)
  if (!script) return 0
  const p = blockProgress(s, dim)
  if (p.complete) return script.mainQuestions.length
  return Math.min(p.askIndex, script.mainQuestions.length)
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
