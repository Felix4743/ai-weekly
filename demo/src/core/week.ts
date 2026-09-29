/**
 * 「哪一周」这件事的全部算法。纯函数，不认环境。
 *
 * 一周从**周一**算起，一周的键就是那一周周一的本地日期（`YYYY-MM-DD`）。
 *
 * 为什么不用 ISO 周号（`2026-W39`）：跨年那几周是出了名的绕（第 1 周到底从哪天开始），
 * 而且「W39」这种东西用户不认、排序还得额外写比较函数。用周一日期当键，
 * 可排序、可相减、存档里一眼看得懂。
 *
 * 全程走**本地时间**，一次都不碰 UTC：晚上十一点存下来的东西，
 * 不该因为时区差被算到第二天、甚至下一周去。
 */

/** 一周的标识：那一周周一的本地日期，形如 `2026-09-21` */
export type WeekKey = string

/** 日历表头：周一起，和 weekKey 的口径一致 */
export const WEEKDAY_NAMES = ['一', '二', '三', '四', '五', '六', '日'] as const

const WEEK_MS = 7 * 24 * 60 * 60 * 1000

function pad(n: number): string {
  return n < 10 ? `0${n}` : String(n)
}

/** 本地日期 → `YYYY-MM-DD` */
export function dateKey(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

/** 那一天所在的周一，零点 */
export function startOfWeek(date: Date): Date {
  const day = new Date(date.getFullYear(), date.getMonth(), date.getDate())
  // getDay()：周日是 0，转换成本周已经过去几天（周一 = 0）
  const offset = (day.getDay() + 6) % 7
  day.setDate(day.getDate() - offset)
  return day
}

/** 某个时刻属于哪一周 */
export function weekKeyOf(date: Date): WeekKey {
  return dateKey(startOfWeek(date))
}

/**
 * 键 → 那一周周一的零点。
 * 不是 `YYYY-MM-DD`、不是真实存在的日期（`2026-02-31`）、或者那天根本不是周一，
 * 一律返回 null —— 存档是从文件里读回来的，什么都可能在里面。
 */
export function parseWeekKey(key: unknown): Date | null {
  if (typeof key !== 'string') return null
  const matched = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key)
  if (!matched) return null
  const year = Number(matched[1])
  const month = Number(matched[2])
  const day = Number(matched[3])
  const date = new Date(year, month - 1, day)
  // Date 会把 2 月 31 日悄悄滚到 3 月，这里挡掉这种「看起来合法」的输入
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
    return null
  }
  if (date.getDay() !== 1) return null
  return date
}

export function isWeekKey(value: unknown): value is WeekKey {
  return parseWeekKey(value) !== null
}

/** 加天数：用「年月日」构造，跨月跨年跨闰年都由 Date 自己算 */
export function addDays(date: Date, days: number): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days)
}

/** 前后挪几周 */
export function addWeeks(key: WeekKey, delta: number): WeekKey {
  const date = parseWeekKey(key)
  if (!date) return key
  return dateKey(addDays(date, delta * 7))
}

/** 相差几周（b - a）；有一边不合法时返回 null */
export function weeksBetween(a: WeekKey, b: WeekKey): number | null {
  const from = parseWeekKey(a)
  const to = parseWeekKey(b)
  if (!from || !to) return null
  // 两个都是本地零点，夏令时地区可能差一小时，四舍五入即可
  return Math.round((to.getTime() - from.getTime()) / WEEK_MS)
}

/** 那一周的七天，周一在前 */
export function daysOfWeek(key: WeekKey): Date[] {
  const monday = parseWeekKey(key)
  if (!monday) return []
  return Array.from({ length: 7 }, (_, i) => addDays(monday, i))
}

/** `9月22日 – 9月28日`；跨年时带上年份，免得两份存档看起来一样 */
export function weekRangeText(key: WeekKey): string {
  const monday = parseWeekKey(key)
  if (!monday) return ''
  const sunday = addDays(monday, 6)
  const from = `${monday.getMonth() + 1}月${monday.getDate()}日`
  const to = `${sunday.getMonth() + 1}月${sunday.getDate()}日`
  if (monday.getFullYear() !== sunday.getFullYear()) {
    return `${monday.getFullYear()}年${from} – ${sunday.getFullYear()}年${to}`
  }
  return `${from} – ${to}`
}

/** `9月22日这一周`；不是今年的，把年份带上 */
export function weekTitle(key: WeekKey, now: Date = new Date()): string {
  const monday = parseWeekKey(key)
  if (!monday) return ''
  const prefix = monday.getFullYear() === now.getFullYear() ? '' : `${monday.getFullYear()}年`
  return `${prefix}${monday.getMonth() + 1}月${monday.getDate()}日这一周`
}

/** 某一天相对今天的说法 */
export function dayLabel(date: Date): string {
  return `${date.getMonth() + 1}月${date.getDate()}日`
}

/* ---------------- 相对说法：本周 / 上周 / 上上周 ---------------- */

export type WeekRelation = 'this' | 'last' | 'twoAgo' | 'past' | 'future'

export function weekRelation(key: WeekKey, now: Date = new Date()): WeekRelation {
  const diff = weeksBetween(weekKeyOf(now), key)
  if (diff === null) return 'past'
  if (diff === 0) return 'this'
  if (diff === -1) return 'last'
  if (diff === -2) return 'twoAgo'
  return diff < 0 ? 'past' : 'future'
}

const RELATION_LABELS: Record<WeekRelation, string> = {
  this: '本周',
  last: '上周',
  twoAgo: '上上周',
  past: '',
  future: '还没到',
}

/** 本周 / 上周 / 上上周；更早的周返回空串（界面上直接用日期说话） */
export function relationLabel(relation: WeekRelation): string {
  return RELATION_LABELS[relation]
}

/* ---------------- 月历 ---------------- */

/** 月份引用；month 从 0 开始，和 Date 一致 */
export interface MonthRef {
  year: number
  month: number
}

export function monthOf(date: Date): MonthRef {
  return { year: date.getFullYear(), month: date.getMonth() }
}

export function shiftMonth(ref: MonthRef, delta: number): MonthRef {
  return monthOf(new Date(ref.year, ref.month + delta, 1))
}

export function monthLabel(ref: MonthRef): string {
  return `${ref.year}年${ref.month + 1}月`
}

/**
 * 这个月在月历上要画出来的所有整周（每项是一个周一的键）。
 * 首尾会被补齐成整周 —— 月历的一行就是一周，不能有半行。
 */
export function weeksInMonth(ref: MonthRef): WeekKey[] {
  const first = startOfWeek(new Date(ref.year, ref.month, 1))
  const last = startOfWeek(new Date(ref.year, ref.month + 1, 0))
  const weeks: WeekKey[] = []
  for (let cursor = first; cursor.getTime() <= last.getTime(); cursor = addDays(cursor, 7)) {
    weeks.push(dateKey(cursor))
  }
  return weeks
}

/** 这一天是不是属于这个月（用来把月历上补齐的那几天画淡） */
export function inMonth(date: Date, ref: MonthRef): boolean {
  return date.getFullYear() === ref.year && date.getMonth() === ref.month
}
