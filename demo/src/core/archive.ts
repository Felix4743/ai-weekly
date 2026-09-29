import { type WeeklyResult } from './types'
import {
  addWeeks,
  relationLabel,
  weekKeyOf,
  weekRelation,
  type WeekKey,
  type WeekRelation,
} from './week'

/**
 * 按周归档：每一周的结果各存一份，键是那一周的周一。
 *
 * 存在的理由是产品上的：`session.json` 只留得住「最近一次」，而「上周到底在忙什么」
 * 恰恰是做周复盘时最想知道的东西 —— 没有地方留它，日历就永远是空的。
 *
 * 这里全是纯函数，读写交给 storage/。所以「同一周改十遍只留一份」「旧的一周
 * 改完存回原来那一周」这些规则不用起界面就能测。
 */

export interface WeekEntry {
  /** 那一周的周一，`YYYY-MM-DD` */
  week: WeekKey
  /** 最后一次写入这个时刻 */
  savedAt: number
  result: WeeklyResult
}

/**
 * 存档上限：五年。
 *
 * 不做淘汰才是错的：这份文件每次编辑整份重写，十年下来会变成几兆，
 * 而十年以前的周报不会有人翻。真要更长，改这一个常量。
 */
export const ARCHIVE_LIMIT = 260

function byWeekDesc(a: WeekEntry, b: WeekEntry): number {
  // week 是零填充的日期串，字典序就是时间序
  return a.week < b.week ? 1 : a.week > b.week ? -1 : 0
}

/** 新的在前 */
export function sortEntries(list: WeekEntry[]): WeekEntry[] {
  return [...list].sort(byWeekDesc)
}

function trim(list: WeekEntry[]): WeekEntry[] {
  return sortEntries(list).slice(0, ARCHIVE_LIMIT)
}

/** 同一周只留一份：后来的覆盖先前的 */
export function upsertWeek(list: WeekEntry[], entry: WeekEntry): WeekEntry[] {
  return trim([...list.filter((e) => e.week !== entry.week), entry])
}

/**
 * 把一份结果记进它所属的那一周。
 * `week` 一般不用传：默认按 `at` 落在那一周 —— 周日晚十一点和周一早九点
 * 会落到不同的周，这是刻意的（档案要跟真实日期一致，而不是跟「感觉」一致）。
 */
export function archiveResult(
  list: WeekEntry[],
  result: WeeklyResult,
  at: number,
  week: WeekKey = weekKeyOf(new Date(at)),
): WeekEntry[] {
  return upsertWeek(list, { week, savedAt: at, result })
}

export function findEntry(list: WeekEntry[], week: WeekKey): WeekEntry | null {
  return list.find((e) => e.week === week) ?? null
}

/** 就地改某一周（总览页里直接编辑旧周那条路）；那一周不存在时原样返回 */
export function updateWeekResult(
  list: WeekEntry[],
  week: WeekKey,
  result: WeeklyResult,
  at: number,
): WeekEntry[] {
  const existing = findEntry(list, week)
  if (!existing) return list
  return upsertWeek(list, { week, savedAt: at, result })
}

/**
 * 把一份结果挪到前后几周 —— 周一早上补做上周的复盘时，它会落到新的一周里。
 * 目标那一周已经有记录时**原样返回**：宁可不挪，也不能悄悄顶掉另一周的存档。
 */
export function moveWeek(list: WeekEntry[], from: WeekKey, delta: number): WeekEntry[] {
  const entry = findEntry(list, from)
  if (!entry || delta === 0) return list
  const target = addWeeks(from, delta)
  if (target === from || findEntry(list, target)) return list
  return trim([...list.filter((e) => e.week !== from), { ...entry, week: target }])
}

/** 这一周的主线：第一条非空的主线。没有就是空串，界面照实说「没写主线」 */
export function mainLine(entry: WeekEntry | null): string {
  if (!entry) return ''
  return entry.result.highlights.find((h) => h.trim().length > 0)?.trim() ?? ''
}

export interface WeekCounts {
  events: number
  people: number
  things: number
  pending: number
  /** 主线那几条 */
  highlights: number
  plan: number
}

export function weekCounts(result: WeeklyResult): WeekCounts {
  return {
    events: result.events.length,
    people: result.people.length,
    things: result.things.length,
    pending: result.pending.length,
    highlights: result.highlights.length,
    plan: result.nextFocus.length + result.nextFollowUps.length,
  }
}

export interface RecentSlot {
  week: WeekKey
  relation: WeekRelation
  /** 本周 / 上周 / 上上周 */
  label: string
  entry: WeekEntry | null
}

/**
 * 本周、上周、上上周三个位置。
 * **没记录的那一周也占一个位置**（entry 为 null）—— 「上上周忘了记」这件事
 * 本身就是要看见的信息，直接跳过它只会让人以为那一周不存在。
 */
export function recentSlots(
  list: WeekEntry[],
  now: Date = new Date(),
  count = 3,
): RecentSlot[] {
  const thisWeek = weekKeyOf(now)
  return Array.from({ length: count }, (_, i) => {
    const week = addWeeks(thisWeek, -i)
    const relation = weekRelation(week, now)
    return { week, relation, label: relationLabel(relation), entry: findEntry(list, week) }
  })
}

export interface ArchiveStats {
  /** 一共记了几周 */
  weeks: number
  /** 从最近一次记录往前，连续不断的有几周 */
  streak: number
  latest: WeekKey | null
  hasThisWeek: boolean
}

export function archiveStats(list: WeekEntry[], now: Date = new Date()): ArchiveStats {
  const latest = sortEntries(list)[0]?.week ?? null
  let streak = 0
  if (latest) {
    const known = new Set(list.map((e) => e.week))
    let cursor: WeekKey = latest
    while (known.has(cursor)) {
      streak += 1
      cursor = addWeeks(cursor, -1)
    }
  }
  return {
    weeks: list.length,
    streak,
    latest,
    hasThisWeek: list.some((e) => e.week === weekKeyOf(now)),
  }
}
