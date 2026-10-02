import { repeatCount as countKeys, type PreviousWeek, type Review } from './review'
import {
  addWeeks,
  relationLabel,
  weekKeyOf,
  weekRangeText,
  weekRelation,
  type WeekKey,
  type WeekRelation,
} from './week'

/**
 * 按周归档：每一周各存一份，键是那一周的周一。
 *
 * 0.9.0 起一条记录由两部分组成：**用户写的那段原文（notes）**和
 * **AI 复盘的结果（review）**。这两样分开存是有意的：
 * - 复盘是 AI 说的，可以一键重来；原文是你写的，重来一次不该逼你重写一遍
 * - review 为 null 表示「这一周只写了原文，还没复盘」，这是合法状态，
 *   日历上照常有它，点进去就能接着做
 *
 * 这里全是纯函数，读写交给 storage/。所以「同一周改十遍只留一份」
 * 「旧的一周改完存回原来那一周」这些规则不用起界面就能测。
 */

export interface WeekEntry {
  /** 那一周的周一，`YYYY-MM-DD` */
  week: WeekKey
  /** 最后一次写入这个时刻（改原文、重做复盘都算） */
  savedAt: number
  /** 用户自己写的那一段原文 */
  notes: string
  /** AI 复盘的结果；null = 只写了原文，还没复盘 */
  review: Review | null
  /**
   * 用户在这一周里**亲手删掉**的条目文本。
   *
   * 为什么得存下来：重新复盘是拿最新的原文整份重来，模型很可能又把用户
   * 删掉的那条推出来。合并的那一刻只有「用户现在这份」和「模型这份」，
   * 看不出少过什么 —— 不把「删过什么」记在归档里，删除就会被下一次
   * 重新整理悄悄冲掉，产品承诺的「你改过的清单要留住」也就断了。
   * 空数组或没有这个字段都表示「这一周没删过东西」。
   */
  dropped?: string[]
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

/**
 * 什么都不值得留的条目：没写原文、也没有复盘。
 *
 * 这种条目是**误点**留下的（打开这一周、一个字没写就退了），
 * 留着只会让日历上多一个点不明白的空格子。
 */
export function isEmptyEntry(entry: WeekEntry): boolean {
  return entry.notes.trim().length === 0 && entry.review === null
}

/** 同一周只留一份：后来的覆盖先前的 */
export function upsertWeek(list: WeekEntry[], entry: WeekEntry): WeekEntry[] {
  const rest = list.filter((e) => e.week !== entry.week)
  if (isEmptyEntry(entry)) return trim(rest)
  return trim([...rest, entry])
}

export function findEntry(list: WeekEntry[], week: WeekKey): WeekEntry | null {
  return list.find((e) => e.week === week) ?? null
}

/** 原地改某一周（原文、复盘结果都走这里）；那一周不存在时**建一条** */
export function updateWeek(
  list: WeekEntry[],
  week: WeekKey,
  patch: Partial<Pick<WeekEntry, 'notes' | 'review' | 'dropped'>>,
  at: number,
): WeekEntry[] {
  const existing = findEntry(list, week)
  // dropped 跟着写下去：改原文、重做复盘都不该把「用户删过什么」洗掉，
  // 否则下一次合并就再也拦不住那些被删掉的条目
  const dropped = patch.dropped ?? existing?.dropped ?? []
  return upsertWeek(list, {
    week,
    savedAt: at,
    notes: patch.notes ?? existing?.notes ?? '',
    review: patch.review !== undefined ? patch.review : (existing?.review ?? null),
    // 一条都没删过时不留这个字段，存量记录的形状保持不变
    ...(dropped.length > 0 ? { dropped } : {}),
  })
}

/**
 * 这一周摆在列表上的那行字：先是 AI 那句话（主线），一句话没写出来时退到
 * 第一条「做了什么」，再退到第一条问题、第一条计划 —— 总比让日历上写着
 * 「还没复盘」强，那明明复盘过了。对账项不参与：那是**上周**的事，
 * 摆在这一周的格子里会看错周。
 */
export function mainLine(entry: WeekEntry | null): string {
  const review = entry?.review
  if (!review) return ''
  const candidates = [
    review.headline,
    ...review.did,
    ...review.issues.map((issue) => issue.text),
    ...review.plan.map((item) => item.text),
  ]
  for (const text of candidates) {
    const line = text.trim()
    if (line) return line
  }
  return ''
}

/**
 * 把某一周的记录挪到另一周 —— 记错周的时候用。
 *
 * 两个「原样返回」都是有意的：目标周**已经有记录**时绝不顶掉（那份是
 * 用户真写出来的东西，代价比多跑一次「挪」大得多）；来源周没记录时也没得挪。
 * 调用方拿返回值和原数组比引用就知道挪没挪成（`next === list` 即没动）。
 */
export function moveWeek(
  list: WeekEntry[],
  from: WeekKey,
  to: WeekKey,
  at: number,
): WeekEntry[] {
  if (from === to) return list
  const entry = findEntry(list, from)
  if (!entry) return list
  if (findEntry(list, to)) return list
  const rest = list.filter((e) => e.week !== from)
  return trim([...rest, { ...entry, week: to, savedAt: at }])
}

export interface WeekCounts {
  did: number
  issues: number
  plan: number
  /** 对账过的上周行动项条数 */
  reconcile: number
}

export function weekCounts(review: Review | null): WeekCounts {
  return {
    did: review?.did.length ?? 0,
    issues: review?.issues.length ?? 0,
    plan: review?.plan.length ?? 0,
    reconcile: review?.reconcile.length ?? 0,
  }
}

/**
 * 同一个问题标签在**这周之前**出现过几次。
 *
 * 界面拿它显示「这个问题第三周出现了」——这是 0.9.0 要的那层
 * 「把几周连起来看」，靠的是模型给出的稳定 key，而不是字符串相似度。
 */
export function repeatCount(list: WeekEntry[], week: WeekKey, key: string): number {
  const past = list
    .filter((entry) => entry.week < week)
    .map((entry) => (entry.review?.issues ?? []).map((issue) => issue.key))
  return countKeys(past, key)
}

/**
 * 交给模型的「上周语境」：紧邻的那一周的计划与问题标签。
 *
 * 只看紧邻的上一周，不往前翻：对账的对象是「上周定的东西」，
 * 拿三周前的计划来问「做了吗」只会让人困惑。上一周没记录就是 null。
 */
export function previousWeekContext(list: WeekEntry[], week: WeekKey): PreviousWeek | null {
  const prev = findEntry(list, addWeeks(week, -1))
  if (!prev) return null
  return {
    week: prev.week,
    weekText: weekRangeText(prev.week),
    plan: prev.review?.plan ?? [],
    issues: (prev.review?.issues ?? []).map((issue) => ({ text: issue.text, key: issue.key })),
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
