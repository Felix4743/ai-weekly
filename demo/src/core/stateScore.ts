import { STATE_KEYS, type StateKey, type StateScores, type WeeklyState } from './types'
import { stateField } from './stateFields'

/**
 * 状态评分：0–5 星。
 *
 * 界面是五颗星：点第 N 颗 = N 分，**再点同一颗 = 取消**（回到未打分）。
 * 也就是说「0 分」和「没打分」在数据上是一回事 —— 都不写这个键。
 * 这样存档里只有真正点过的分，趋势页不会把「没打分」读成 0 分。
 */

/** 星星上限：0–5 星里的那个 5 */
export const SCORE_MAX = 5

/** 能落盘的分数只有 1–5 的整数；别的（0、6、3.5、'3'、null）一律当没打分 */
export function coerceScore(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isInteger(value)) return undefined
  return value >= 1 && value <= SCORE_MAX ? value : undefined
}

/** 把一段来路不明的对象收成一组合法分数；一项都不合法就返回空对象 */
export function coerceScores(value: unknown): StateScores {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const o = value as Record<string, unknown>
  const out: StateScores = {}
  for (const key of STATE_KEYS) {
    const n = coerceScore(o[key])
    if (n !== undefined) out[key] = n
  }
  return out
}

export function hasAnyScore(scores: StateScores | undefined): boolean {
  if (!scores) return false
  return STATE_KEYS.some((key) => coerceScore(scores[key]) !== undefined)
}

/** 点星：给了分就写上，传 undefined（再点同一颗）就把这一项删掉 */
export function withScore(
  scores: StateScores | undefined,
  key: StateKey,
  value: number | undefined,
): StateScores {
  const next: StateScores = { ...(scores ?? {}) }
  const n = coerceScore(value)
  if (n === undefined) delete next[key]
  else next[key] = n
  return next
}

/**
 * 把「界面上的分数」与备注拼成一份状态（0.9.3 起状态就是「四项分数 + 一行备注」）。
 *
 * 给的分数与备注就是全部：旧状态不参与合并，省得模型编的分数、上一版留下的
 * 文字从缝里钻回来。一项都没点就**不写 `scores` 键** —— 否则 `{scores:{}}`
 * 会进归档，以后再读回来还得分「空对象」和「没有」两种情况。
 */
export function attachState(scores: StateScores | undefined, note: string): WeeklyState {
  const clean = coerceScores(scores)
  const trimmed = note.trim()
  const next: WeeklyState = { note: trimmed }
  return hasAnyScore(clean) ? { ...next, scores: clean } : next
}

/** 界面上那四排星的总览：`心情 4/5 · 睡眠 3/5 · 运动 5/5 · 饮食 2/5`；一项没点就是空串 */
export function scoresText(scores: StateScores | undefined): string {
  return STATE_KEYS.filter((key) => coerceScore(scores?.[key]) !== undefined)
    .map((key) => {
      const field = stateField(key)
      return `${field?.label ?? key} ${coerceScore(scores?.[key])}/${SCORE_MAX}`
    })
    .join(' · ')
}

/** 界面上的分数文案：`3 / 5`，没打分就是「未打分」 */
export function scoreText(value: number | undefined): string {
  const n = coerceScore(value)
  return n === undefined ? '未打分' : `${n} / ${SCORE_MAX}`
}

/** 跟在一句文字后面的分数：`（4 / 5）`；没打分就是空串 */
export function scoreSuffix(value: number | undefined): string {
  const n = coerceScore(value)
  return n === undefined ? '' : `（${n} / ${SCORE_MAX}）`
}
