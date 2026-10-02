import type { PreviousWeek, Review } from './review'
import type { WeekKey } from './week'

/**
 * AI 那一层的接口。
 *
 * 0.9.0 只剩一个动作：`analyze` —— 把这一周的原文交出去，拿回一份复盘。
 * 旧的 nextMessage / reply / summarize 那套「采访 + 整理」两件事，
 * 随着采访流程一起删掉了：这一版 AI 不提问，只分析。
 */

export type DeltaHandler = (delta: string) => void

export interface ReviewRequest {
  week: WeekKey
  /** `9月28日 – 10月4日` 这种给人看的说法，模型据此知道窗口是哪七天 */
  weekText: string
  /** 用户自己写的那一段原文 */
  notes: string
  /** 上一周的复盘语境；没有就是 null */
  previous: PreviousWeek | null
  /** 用户在第一次整理之后又补了话 */
  isFollowUp: boolean
}

export interface ReviewOutcome {
  review: Review
  /** 补充/反驳时 AI 的一句话回应；第一次整理是空串（**不落盘**，见过就完了） */
  reply: string
}

export interface AiClient {
  analyze(req: ReviewRequest, onDelta?: DeltaHandler): Promise<ReviewOutcome>
}
