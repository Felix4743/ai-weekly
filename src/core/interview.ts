import { MAX_FOLLOWUPS_PER_QUESTION, SCRIPT, TOTAL_MAIN_QUESTIONS } from './script'
import type { Dimension, InterviewState } from './types'

export function createInterview(): InterviewState {
  return { dimensionIndex: 0, askIndex: 0, followUpCount: 0, done: false }
}

export function currentDimension(s: InterviewState): Dimension {
  const d = SCRIPT[Math.min(s.dimensionIndex, SCRIPT.length - 1)]
  return d.key
}

/** 当前主问题原文 */
export function currentQuestion(s: InterviewState): string {
  const d = SCRIPT[s.dimensionIndex]
  if (!d) return ''
  return d.mainQuestions[Math.min(s.askIndex, d.mainQuestions.length - 1)] ?? ''
}

/** 当前应使用的追问话术 */
export function currentFollowUp(s: InterviewState): string {
  const d = SCRIPT[s.dimensionIndex]
  if (!d) return ''
  return d.followUps[s.followUpCount % d.followUps.length] ?? ''
}

/**
 * 核心状态机：是否追问由 AI 提议，但覆盖范围由状态机硬性约束。
 * 这是本产品最重要的设计——AI 负责问得自然，状态机负责不漏块。
 */
export function nextStep(s: InterviewState, aiWantsFollowUp: boolean): InterviewState {
  if (s.done) return s

  const dim = SCRIPT[s.dimensionIndex]
  if (!dim) return { ...s, done: true }

  if (aiWantsFollowUp && s.followUpCount < MAX_FOLLOWUPS_PER_QUESTION) {
    return { ...s, followUpCount: s.followUpCount + 1 }
  }

  const nextAsk = s.askIndex + 1
  if (nextAsk < dim.mainQuestions.length) {
    return { ...s, askIndex: nextAsk, followUpCount: 0 }
  }

  const nextDim = s.dimensionIndex + 1
  if (nextDim < SCRIPT.length) {
    return { ...s, dimensionIndex: nextDim, askIndex: 0, followUpCount: 0 }
  }

  return { ...s, done: true }
}

/** 用户点「聊够了」时强制收尾 */
export function forceFinish(s: InterviewState): InterviewState {
  return { ...s, done: true }
}

/** 已经问过的主问题数 */
export function askedMainQuestions(s: InterviewState): number {
  let n = 0
  for (let i = 0; i < s.dimensionIndex && i < SCRIPT.length; i++) {
    n += SCRIPT[i].mainQuestions.length
  }
  const cur = SCRIPT[s.dimensionIndex]
  if (cur) n += Math.min(s.askIndex, cur.mainQuestions.length)
  return n
}

export function progressPercent(s: InterviewState): number {
  if (s.done) return 100
  const pct = (askedMainQuestions(s) / TOTAL_MAIN_QUESTIONS) * 100
  return Math.max(0, Math.min(99, Math.round(pct)))
}

/** 是否刚刚进入一个新区块（用于在对话里插入分隔标签） */
export function startsNewBlock(s: InterviewState): boolean {
  return s.askIndex === 0 && s.followUpCount === 0 && s.dimensionIndex > 0
}

/** 当前区块的提问是否已全部覆盖（AI 应主动询问是否可以出结果） */
export function isCoverageComplete(s: InterviewState): boolean {
  return s.done || (s.dimensionIndex === SCRIPT.length - 1 && s.askIndex >= SCRIPT[SCRIPT.length - 1].mainQuestions.length - 1)
}
