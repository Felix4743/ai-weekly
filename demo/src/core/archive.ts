import { createEmptyResult, type Note, type WeeklyResult } from './types'
import { addNote, removeNote } from './notes'
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
  /**
   * 那一周随手记下来的碎片（0.9.8 新增）。
   *
   * 它和 `result` 是**同一周的两样东西**：随手记是平时攒的素材（可能一条都没有），
   * 结果是周末收口之后写下来的那份。所以一周可以有随手记而还没有结果 ——
   * `result` 这时是一份空结果，界面上照实说「这一周还没有被梳理过」。
   *
   * 老档（0.9.7 及以前）没有这个键，读回来是空数组（见 `storage/shape.ts`）。
   */
  notes: Note[]
}

/** 一份空的周条目：只有随手记、还没聊过的那些周就是这样 */
export function createEmptyEntry(week: WeekKey, savedAt: number): WeekEntry {
  return { week, savedAt, result: createEmptyResult(), notes: [] }
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
  // 这一周已有的随手记要接着留着 —— 重新生成结果不该把平时记的东西抹掉
  const existing = findEntry(list, week)
  return upsertWeek(list, { week, savedAt: at, result, notes: existing?.notes ?? [] })
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
  return upsertWeek(list, { week, savedAt: at, result, notes: existing.notes })
}

/** 某一周随手记下的碎片；没有那一周就是空数组 */
export function notesOf(list: WeekEntry[], week: WeekKey): Note[] {
  return findEntry(list, week)?.notes ?? []
}

/**
 * 往某一周添一条随手记。
 *
 * 这一周**还没有条目就现建一个**（结果是空的、只有这一条随手记）—— 这是 0.9.8
 * 给归档添的新形态：一周可以在没人聊过之前就存在。`savedAt` 跟着更新，
 * 因为「上次记录是什么时候」问的就是我上次动手是什么时候，记一笔也算。
 */
export function addWeekNote(
  list: WeekEntry[],
  week: WeekKey,
  note: Note,
  at: number = Date.now(),
): WeekEntry[] {
  const existing = findEntry(list, week)
  return upsertWeek(list, {
    week,
    savedAt: at,
    result: existing?.result ?? createEmptyResult(),
    notes: addNote(existing?.notes ?? [], note),
  })
}

/** 删掉某一条随手记；那一周或那一条不存在时原样返回 */
export function removeWeekNote(
  list: WeekEntry[],
  week: WeekKey,
  id: string,
  at: number = Date.now(),
): WeekEntry[] {
  const existing = findEntry(list, week)
  if (!existing) return list
  const notes = removeNote(existing.notes, id)
  if (notes.length === existing.notes.length) return list
  return upsertWeek(list, { ...existing, savedAt: at, notes })
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

/**
 * 一份结果的主线：第一条非空的主线。没有就是空串，界面照实说「没写主线」。
 *
 * 抽出来是因为有三处问的是同一件事：总览页的卡片、结果页页头那条概览、
 * 归档列表 —— 各写一遍 `highlights.find(...)` 迟早会漂。
 */
export function mainLineOf(result: WeeklyResult): string {
  return result.highlights.find((h) => h.trim().length > 0)?.trim() ?? ''
}

/** 这一周的主线；没有那一周就是空串 */
export function mainLine(entry: WeekEntry | null): string {
  return entry ? mainLineOf(entry.result) : ''
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
  /**
   * 最近一次**写入**的时刻 —— 注意这和 `latest` 不是一回事：
   * 今天去改一笔三个月前的旧周，`latest` 还是那一个月，这里却是今天。
   * 「上次记录是什么时候」问的是后者：我上次动手是什么时候。
   */
  lastWritten: number | null
}

/** 最近一次写入归档的时刻；归档为空、或里面全是脏时间戳时返回 null */
export function lastWrittenAt(list: WeekEntry[]): number | null {
  let newest: number | null = null
  for (const entry of list) {
    if (!Number.isFinite(entry.savedAt)) continue
    if (newest === null || entry.savedAt > newest) newest = entry.savedAt
  }
  return newest
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
    lastWritten: lastWrittenAt(list),
  }
}
