import type { WeekEntry } from './archive'
import { STATE_FIELDS } from './stateFields'
import type { StateKey, StateScores } from './types'
import { dayLabel, parseWeekKey, weekRangeText, weeksBetween, type WeekKey } from './week'

/**
 * 把归档用起来：这一周跟上一周比，以及跨周反复出现的东西。
 *
 * 这一层是**只读**的 —— 数据早就在 weeks.json 里躺着了，这儿只是换一种看法。
 * 所以它不需要新存储、不需要迁移，也不碰任何写路径：算错了最多是少显示一句，
 * 不会污染已经记下来的东西。
 *
 * 原则是宁可少说、不可说错：
 * - 分数对比只报数字和差多少，不替用户解释「为什么掉了」；
 * - 「反复出现」只在**至少两周**里真的出现过才列出来；
 * - 人名的重复只认规范化之后完全一样的两个名字 —— 人名之间算相似度，
 *   「张总好」和「李总好」能算出 0.5，那不是同一个人。
 */

// ---------- 上周对比 ----------

/** 状态四项里的一项，这一周跟上次比是什么样 */
export interface CompareRow {
  key: StateKey
  /** 那一项的中文标签，比如「睡眠」 */
  label: string
  /** 这一周打了几分；没打分就是 undefined */
  current?: number
  /** 上一条记录那一周打了几分 */
  previous?: number
  /** 上一次怎么称呼：「上周」/「上一次」；没有更早的记录就是 null */
  previousTag: string | null
  /** 上一条记录的日期区间（`9月21日 – 9月27日`）；没有就是空串 */
  previousRange: string
  /** current - previous；两边都有分才有值 */
  delta?: number
}

/** 结果页上「这周跟上次比」的全部信息 */
export interface StateComparison {
  previousWeek: WeekKey | null
  previousTag: string | null
  previousRange: string
  rows: CompareRow[]
  /** 打过分的项里涨了几项、掉了几项（持平不算） */
  up: number
  down: number
}

/**
 * 这一周之前最近记过的那个星期。
 *
 * 找的是「上一条记录」而不是死板的「上一周」：中间有一周没记，
 * 那就跟再往前那一周比，文案也会跟着说「上一次」而不是「上周」。
 */
export function previousEntry(archive: WeekEntry[], week: WeekKey): WeekEntry | null {
  let found: WeekEntry | null = null
  for (const entry of archive) {
    if (entry.week >= week) continue
    if (!found || entry.week > found.week) found = entry
  }
  return found
}

/** 上一条记录离得近就叫「上周」，隔了不止一周就叫「上一次」 */
export function previousTag(week: WeekKey, previousWeek: WeekKey): string {
  return weeksBetween(previousWeek, week) === 1 ? '上周' : '上一次'
}

export function compareScores(
  current: StateScores | undefined,
  prev: WeekEntry | null,
  week: WeekKey,
): StateComparison {
  const tag = prev ? previousTag(week, prev.week) : null
  const rows: CompareRow[] = STATE_FIELDS.map((field) => {
    const now = current?.[field.key]
    const before = prev?.result.state.scores?.[field.key]
    return {
      key: field.key,
      label: field.label,
      current: now,
      previous: before,
      previousTag: tag,
      previousRange: prev ? weekRangeText(prev.week) : '',
      delta: now !== undefined && before !== undefined ? now - before : undefined,
    }
  })
  return {
    previousWeek: prev?.week ?? null,
    previousTag: tag,
    previousRange: prev ? weekRangeText(prev.week) : '',
    rows,
    up: rows.filter((row) => row.delta !== undefined && row.delta > 0).length,
    down: rows.filter((row) => row.delta !== undefined && row.delta < 0).length,
  }
}

/**
 * 一行小字：`上周 3 ↑1` / `上周 3 持平` / `上一次没打分`。
 * 没有更早的记录、或者这一项压根没在结果页上，就是空串。
 */
export function compareText(row: CompareRow): string {
  // 这一周没打分的项不跟上次比：没打分的那几行本来就在等着点星，再挂一句小字只是噪音
  if (row.current === undefined) return ''
  if (!row.previousTag) return ''
  if (row.previous === undefined) return `${row.previousTag}没打分`
  const tail =
    row.delta === undefined
      ? ''
      : row.delta > 0
        ? ` ↑${row.delta}`
        : row.delta < 0
          ? ` ↓${-row.delta}`
          : ' 持平'
  return `${row.previousTag} ${row.previous}${tail}`
}

// ---------- 反复出现 ----------

/** 反复出现的东西是从哪一栏挖出来的 */
export type PatternSource = 'pending' | 'nextFocus' | 'people'

/** stuck = 一直挂着；person = 又提到的人 */
export type PatternKind = 'stuck' | 'person'

/** 某一周里的一次出场 */
export interface PatternHit {
  week: WeekKey
  /** 那一周的原话；人名组里这就是名字 */
  text: string
  source: PatternSource
  /** 补充说明：人名组里是那一周的备注 */
  detail?: string
}

export interface PatternGroup {
  kind: PatternKind
  /** 代表说法：最早那一周的原话（人名组里就是名字） */
  text: string
  /** 按周升序，一周最多一笔 */
  hits: PatternHit[]
  /** 涉及几周 */
  weeks: number
}

/** 至少两周才叫「反复出现」 */
export const PATTERN_MIN_WEEKS = 2
/** 两句话像到这个程度才当成同一件事 */
export const SIMILARITY_MIN = 0.5
/** 只看这一周之前最近多少条记录 —— 攒了几年的归档不该在渲染时做几百万次比较 */
export const PATTERN_WINDOW = 12

export const PATTERN_SOURCE_LABELS: Record<PatternSource, string> = {
  pending: '未办',
  nextFocus: '计划',
  people: '提到',
}

/**
 * 只留汉字、拉丁字母和数字。
 * 标点、空格、全角半角、大小写都不该影响「这说的是不是同一件事」。
 */
export function normalizeText(text: string): string {
  return (
    text
      // 全角字母数字先折成半角，不然「ＡＢＣ」和「abc」会被当成两回事
      .replace(/[\uff01-\uff5e]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0))
      .toLowerCase()
      .replace(/[^0-9a-z\u4e00-\u9fff\u3400-\u4dbf]+/g, '')
  )
}

function bigrams(text: string): string[] {
  if (text.length < 2) return text ? [text] : []
  const out: string[] = []
  for (let i = 0; i + 1 < text.length; i += 1) out.push(text.slice(i, i + 2))
  return out
}

/**
 * 字符二元组的 Dice 系数：0 = 毫无重叠，1 = 一模一样。
 *
 * 「报价发出去」和「报价发出去了」是 0.89（同一件事换了个说法），
 * 「把报价发出去」和「把简历发出去」是 0.4（都带「发出去」，但不是一件事）——
 * 阈值 0.5 正好卡在这两类中间。
 */
export function similarity(a: string, b: string): number {
  const left = bigrams(a)
  const right = bigrams(b)
  if (left.length === 0 || right.length === 0) return a === b ? 1 : 0
  const pool = new Map<string, number>()
  for (const gram of left) pool.set(gram, (pool.get(gram) ?? 0) + 1)
  let shared = 0
  for (const gram of right) {
    const rest = pool.get(gram) ?? 0
    if (rest > 0) {
      pool.set(gram, rest - 1)
      shared += 1
    }
  }
  return (2 * shared) / (left.length + right.length)
}

/** `9月22日` —— 卡片上每一笔的日期头 */
export function shortWeek(week: WeekKey): string {
  const date = parseWeekKey(week)
  return date ? dayLabel(date) : week
}

/** 一笔小字：`9月22日 · 未办` */
export function patternHitLine(hit: PatternHit): string {
  return `${shortWeek(hit.week)} · ${PATTERN_SOURCE_LABELS[hit.source]}`
}

/** 一句话说明：`2 周都挂着` / `3 周都提到` */
export function patternSummary(group: PatternGroup): string {
  return group.kind === 'person' ? `${group.weeks} 周都提到` : `${group.weeks} 周都挂着`
}

/** 卡片上每一笔正文：人名组给备注，其余给原话 */
export function patternHitText(hit: PatternHit): string {
  return hit.detail ?? hit.text
}

interface Draft {
  kind: PatternKind
  text: string
  /** 规范化之后的代表说法，用来跟后来的话比 */
  key: string
  hits: PatternHit[]
}

function itemsOf(entry: WeekEntry): PatternHit[] {
  const out: PatternHit[] = []
  for (const text of entry.result.pending) {
    if (text.trim()) out.push({ week: entry.week, text: text.trim(), source: 'pending' })
  }
  for (const text of entry.result.nextFocus) {
    if (text.trim()) out.push({ week: entry.week, text: text.trim(), source: 'nextFocus' })
  }
  for (const person of entry.result.people) {
    const name = person.name.trim()
    if (name) {
      out.push({
        week: entry.week,
        text: name,
        source: 'people',
        detail: person.note.trim() || undefined,
      })
    }
  }
  return out
}

/**
 * 挖出跨周反复出现的东西。
 *
 * 只看 `upto` 那一周及更早、且最多往回 `PATTERN_WINDOW` 条记录 ——
 * 看旧周的归档时就按那一刻的情况算，不会拿「未来」的周去说它反复出现。
 *
 * 两个来源、两套配法：
 * - 「未办」和「计划」混在一起比说法（相似度 ≥ 阈值）——
 *   上周计划里写着、这周还挂在未办里，就是最值得看见的那类；
 * - 「人际」只按名字完全相等配（人名之间算相似度会张冠李戴）。
 */
export function recurringPatterns(
  archive: WeekEntry[],
  upto: WeekKey,
  opts: { window?: number; minWeeks?: number; minSimilarity?: number } = {},
): PatternGroup[] {
  const span = opts.window ?? PATTERN_WINDOW
  const minWeeks = opts.minWeeks ?? PATTERN_MIN_WEEKS
  const threshold = opts.minSimilarity ?? SIMILARITY_MIN

  const recent = archive
    .filter((entry) => entry.week <= upto)
    .sort((a, b) => (a.week < b.week ? -1 : a.week > b.week ? 1 : 0))
    .slice(-span)

  const drafts: Draft[] = []
  for (const entry of recent) {
    for (const item of itemsOf(entry)) {
      const key = normalizeText(item.text)
      if (!key) continue
      const kind: PatternKind = item.source === 'people' ? 'person' : 'stuck'
      // 一个字的东西判不出「是不是同一件事」，人名例外（人名本来就可能只有一个字）
      if (kind === 'stuck' && key.length < 2) continue
      const matched = drafts.find(
        (draft) =>
          draft.kind === kind &&
          draft.hits.every((seen) => seen.week !== item.week) &&
          (kind === 'person' ? draft.key === key : similarity(draft.key, key) >= threshold),
      )
      if (matched) matched.hits.push(item)
      else drafts.push({ kind, text: item.text, key, hits: [item] })
    }
  }

  return drafts
    .map((draft) => ({
      kind: draft.kind,
      text: draft.text,
      hits: draft.hits,
      // 一笔一周，所以条数就是周数
      weeks: draft.hits.length,
    }))
    .filter((group) => group.weeks >= minWeeks)
    .sort((a, b) => {
      if (a.weeks !== b.weeks) return b.weeks - a.weeks
      const lastA = a.hits[a.hits.length - 1].week
      const lastB = b.hits[b.hits.length - 1].week
      if (lastA !== lastB) return lastA < lastB ? 1 : -1
      return a.text < b.text ? -1 : a.text > b.text ? 1 : 0
    })
}
