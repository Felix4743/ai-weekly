import {
  MAX_FOLLOWUPS_PER_QUESTION,
  SCRIPT,
  TOTAL_MAIN_QUESTIONS,
  dimensionScript,
} from './script'
import type { BlockProgress, BlockProgressMap, Dimension, InterviewState } from './types'

const EMPTY_PROGRESS: BlockProgress = { askIndex: 0, followUpCount: 0, complete: false }

export function createInterview(): InterviewState {
  const blocks = {} as BlockProgressMap
  for (const d of SCRIPT) {
    blocks[d.key] = { ...EMPTY_PROGRESS }
  }
  return { active: null, blocks }
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

/* ---------------- 推进 ---------------- */

/**
 * 在某个区块内推进一步。
 * 是否追问由 AI 提议，但次数上限与区块推进由状态机硬性约束。
 */
export function nextStep(
  s: InterviewState,
  dim: Dimension,
  aiWantsFollowUp: boolean,
): InterviewState {
  const script = dimensionScript(dim)
  if (!script) return s

  const p = blockProgress(s, dim)
  if (p.complete) return s

  if (aiWantsFollowUp && p.followUpCount < MAX_FOLLOWUPS_PER_QUESTION) {
    return {
      ...s,
      blocks: { ...s.blocks, [dim]: { ...p, followUpCount: p.followUpCount + 1 } },
    }
  }

  const nextAsk = p.askIndex + 1
  if (nextAsk < script.mainQuestions.length) {
    return {
      ...s,
      blocks: { ...s.blocks, [dim]: { askIndex: nextAsk, followUpCount: 0, complete: false } },
    }
  }

  // 这一块聊完了，但保持它仍然是当前展开的块
  return {
    ...s,
    blocks: { ...s.blocks, [dim]: { ...p, followUpCount: 0, complete: true } },
  }
}

/** 用户点「生成梳理」时，把所有区块标记为已结束 */
export function finishAll(s: InterviewState): InterviewState {
  const blocks = {} as BlockProgressMap
  for (const d of SCRIPT) blocks[d.key] = { ...blockProgress(s, d.key), complete: true }
  return { active: s.active, blocks }
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

export function coveragePercent(s: InterviewState): number {
  const done = SCRIPT.reduce((n, d) => n + answeredInBlock(s, d.key), 0)
  const pct = (done / TOTAL_MAIN_QUESTIONS) * 100
  return Math.max(0, Math.min(100, Math.round(pct)))
}

/** 下一个还没聊完的区块，用于给出「接着聊」的建议 */
export function nextIncompleteBlock(s: InterviewState): Dimension | null {
  return SCRIPT.find((d) => !blockProgress(s, d.key).complete)?.key ?? null
}
