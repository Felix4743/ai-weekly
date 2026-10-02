import { parseJsonObject, pick, readString, toStringList } from './coerce'
import type { WeekKey } from './week'

/**
 * 一份复盘：AI 读完用户那一段原文之后，给出的全部内容（0.9.0 的主角）。
 *
 * 和旧的「四栏结果」的区别是它是**给人做决定用的**，不是档案分类：
 * 做了什么、出了什么问题（以及怎么办）、上周说的对上了没有、下周做什么。
 * 全是纯数据，解析与容错在这里，界面只负责摆出来。
 */

export interface Issue {
  /** 问题本身，一句话 */
  text: string
  /** 针对这条问题的建议，一到三条 */
  advice: string[]
  /**
   * 跨周识别用的短标签（如「报价拖延」）。
   * AI 被要求「同一个问题就照抄上周的标签」，于是就能靠它算出「这问题第几次出现了」。
   * 空串表示这条不参与跨周比对。
   */
  key: string
}

export type ReconcileState = 'done' | 'partial' | 'unmentioned'

/** 上周定下的行动项，这周对上了没有 */
export interface Reconcile {
  /** 上周那条行动项，原文照抄 */
  text: string
  state: ReconcileState
  /** 一句话说明凭什么这么判 */
  note: string
}

export interface Plan {
  text: string
  /** 打算什么时候做；没提到就是空串 */
  when: string
}

export interface Review {
  /** 一句话说清这一周 */
  headline: string
  /** 这周做了什么 */
  did: string[]
  /** 这周出现的问题，每条配建议 */
  issues: Issue[]
  /** 上周说的，这周对上了没有；没有上一周时是空数组 */
  reconcile: Reconcile[]
  /** 下周能一条条对着看的行动项 */
  plan: Plan[]
  /** 补漏的一句提醒；六个角度都提到了就是空串 */
  nudge: string
}

export const RECONCILE_LABELS: Record<ReconcileState, string> = {
  done: '做了',
  partial: '做了一半',
  unmentioned: '没提到',
}

/** 上一周的复盘语境：只取对账用得上的那部分，不把整份塞给模型 */
export interface PreviousWeek {
  week: WeekKey
  weekText: string
  plan: Plan[]
  issues: { text: string; key: string }[]
}

export function createEmptyReview(): Review {
  return { headline: '', did: [], issues: [], reconcile: [], plan: [], nudge: '' }
}

/** 一份什么都没写出来的复盘（AI 一个字都没提炼出来时用） */
export function isReviewEmpty(review: Review | null): boolean {
  if (!review) return true
  return (
    review.headline.trim().length === 0 &&
    review.did.length === 0 &&
    review.issues.length === 0 &&
    review.reconcile.length === 0 &&
    review.plan.length === 0
  )
}

/* ---------------- 解析 ---------------- */

const STATE_ALIASES: Record<string, ReconcileState> = {
  done: 'done',
  做了: 'done',
  完成: 'done',
  完成了: 'done',
  已完成: 'done',
  partial: 'partial',
  部分: 'partial',
  做了一半: 'partial',
  没做完: 'partial',
  在做: 'partial',
  unmentioned: 'unmentioned',
  没提到: 'unmentioned',
  未提到: 'unmentioned',
  没提: 'unmentioned',
  不知道: 'unmentioned',
}

function toState(value: unknown): ReconcileState {
  const text = readString(value)
  return STATE_ALIASES[text] ?? STATE_ALIASES[text.toLowerCase()] ?? 'unmentioned'
}

function toIssues(value: unknown): Issue[] {
  const out: Issue[] = []
  for (const raw of Array.isArray(value) ? value : []) {
    if (typeof raw === 'string') {
      const text = raw.trim()
      if (text) out.push({ text, advice: [], key: '' })
      continue
    }
    if (!raw || typeof raw !== 'object') continue
    const o = raw as Record<string, unknown>
    const text = readString(pick(o, ['text', 'issue', '问题', 'title']))
    if (!text) continue
    out.push({
      text,
      advice: toStringList(pick(o, ['advice', '建议', 'suggestions'])),
      key: readString(pick(o, ['key', 'label', '标签'])),
    })
  }
  return out
}

function toReconcile(value: unknown): Reconcile[] {
  const out: Reconcile[] = []
  for (const raw of Array.isArray(value) ? value : []) {
    if (typeof raw === 'string') {
      const text = raw.trim()
      if (text) out.push({ text, state: 'unmentioned', note: '' })
      continue
    }
    if (!raw || typeof raw !== 'object') continue
    const o = raw as Record<string, unknown>
    const text = readString(pick(o, ['text', 'plan', '行动项', '上周', 'title']))
    if (!text) continue
    out.push({
      text,
      state: toState(pick(o, ['state', 'status', '状态'])),
      note: readString(pick(o, ['note', '说明', 'why'])),
    })
  }
  return out
}

function toPlans(value: unknown): Plan[] {
  const out: Plan[] = []
  for (const raw of Array.isArray(value) ? value : []) {
    if (typeof raw === 'string') {
      const text = raw.trim()
      if (text) out.push({ text, when: '' })
      continue
    }
    if (!raw || typeof raw !== 'object') continue
    const o = raw as Record<string, unknown>
    const text = readString(pick(o, ['text', 'task', '做什么', 'title']))
    if (!text) continue
    out.push({ text, when: readString(pick(o, ['when', 'time', '什么时候', '时间'])) })
  }
  return out
}

/**
 * 把模型给的东西变成一份复盘；连对象都不是就返回 null。
 * 中英文键都认 —— 有些模型会把 schema 翻译一遍再输出。
 */
export function coerceReview(raw: unknown): Review | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const o = raw as Record<string, unknown>
  return {
    headline: readString(pick(o, ['headline', 'summary', '一句话', '总结'])),
    did: toStringList(pick(o, ['did', 'done', '做了什么', '这周做了什么'])),
    issues: toIssues(pick(o, ['issues', 'problems', '问题'])),
    reconcile: toReconcile(pick(o, ['reconcile', 'lastweek', '上周', '对账'])),
    plan: toPlans(pick(o, ['plan', 'next', '下周', '下周计划'])),
    nudge: readString(pick(o, ['nudge', 'reminder', '提醒', '补漏'])),
  }
}

export interface ParsedReview {
  /** 认不出来时是 null，由调用方决定拿什么兜底 */
  review: Review | null
  /** 用户在第一次整理之后补了话时，AI 的一句话回应 */
  reply: string
  error?: string
}

export function parseReview(raw: string): ParsedReview {
  const { value, error } = parseJsonObject(raw)
  if (error) return { review: null, reply: '', error }
  const review = coerceReview(value)
  if (!review) return { review: null, reply: '', error: '模型返回的内容不是一份复盘' }
  const reply = readString(
    pick(value as Record<string, unknown>, ['reply', 'response', '回应']),
  )
  return { review, reply }
}

/** 解析失败也**不抛**：给一份说得清失败的复盘，界面照常能画出来 */
export function parseReviewSafe(raw: string): { review: Review; reply: string; error?: string } {
  const parsed = parseReview(raw)
  if (parsed.review) return { review: parsed.review, reply: parsed.reply }
  return { review: degradedReview(parsed.error ?? '模型这次没能给出可用的复盘'), reply: '' }
}

/**
 * 失败时摆给用户看的那一份。
 * 刻意不装作「这周什么都没发生」：明说失败了，并告诉他下一步能做什么。
 */
export const DEGRADED_PREFIX = '这次没能整理成功：'

export function degradedReview(reason: string): Review {
  return {
    headline: `${DEGRADED_PREFIX}${reason}`,
    did: [],
    issues: [],
    reconcile: [],
    plan: [],
    nudge: '可以点「重新复盘」再试一次。',
  }
}

/**
 * 这是不是一份「没整理成功」的占位？
 *
 * 界面拿它决定**别把这一份并进用户已有的复盘**、也别落盘 ——
 * 一次网络抖动不该把上次理得挺好的一份换成一句失败提示。
 */
export function isDegradedReview(review: Review): boolean {
  return review.headline.startsWith(DEGRADED_PREFIX)
}

/* ---------------- 跨周比对 ---------------- */

/** 标签归一化：去掉空白与标点，方便「报价拖延」和「报价 拖延！」认成同一条 */
export function normalizeKey(key: string): string {
  return key
    .replace(/[\s\u3000]/g, '')
    .replace(/[、。，,．.！!？?；;：:（）()【】\[\]「」『』"'·—-]/g, '')
    .toLowerCase()
}

/** 这是第几次出现：过去几周里同一个标签出现过几回（不含本周） */
export function repeatCount(historyKeys: string[][], key: string): number {
  const target = normalizeKey(key)
  if (!target) return 0
  return historyKeys.filter((keys) => keys.some((k) => normalizeKey(k) === target)).length
}
