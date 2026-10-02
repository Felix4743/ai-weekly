import { pick, readString, toStringList } from './coerce'
import type { Review } from './review'

/**
 * 0.8.x 那套「四栏结果」的读取与迁移。
 *
 * 旧版的采访式周报在归档里留下的是 events / people / things / pending /
 * highlights / nextFocus / nextFollowUps 这七样。0.9.0 换成了复盘五段，
 * 旧数据不会自动变成新数据 —— 这里只做**能对上号的那部分**映射，
 * 剩下一律不迁（新版的版式里没有它们的位置，硬塞进去只会更乱）。
 */

export interface PersonNote {
  name: string
  note: string
}

export interface LegacyResult {
  events: string[]
  people: PersonNote[]
  things: string[]
  pending: string[]
  highlights: string[]
  nextFocus: string[]
  nextFollowUps: string[]
}

export function createEmptyLegacyResult(): LegacyResult {
  return {
    events: [],
    people: [],
    things: [],
    pending: [],
    highlights: [],
    nextFocus: [],
    nextFollowUps: [],
  }
}

function toPeople(value: unknown): PersonNote[] {
  const out: PersonNote[] = []
  for (const item of Array.isArray(value) ? value : []) {
    if (typeof item === 'string') {
      const name = item.trim()
      if (name) out.push({ name, note: '' })
      continue
    }
    if (!item || typeof item !== 'object') continue
    const o = item as Record<string, unknown>
    const name = readString(pick(o, ['name', 'who', '谁']))
    if (!name) continue
    out.push({ name, note: readString(pick(o, ['note', '关于他/她', '备注'])) })
  }
  return out
}

const EVENT_KEYS = ['events', '事情', '事件']
const PEOPLE_KEYS = ['people', '人际', '人']
const THING_KEYS = ['things', '物品', '东西']
const PENDING_KEYS = ['pending', '未办', '悬而未决', '没做完']
const HIGHLIGHT_KEYS = ['highlights', '本周主线', '本周热点', '主线']
const FOCUS_KEYS = ['nextFocus', '下周重点', '下周焦点']
const FOLLOW_KEYS = ['nextFollowUps', '下周跟进', '要跟进的人']

/** 读一份旧结果；不是对象就返回 null（存储层据此丢掉这个坏条目） */
export function coerceResult(raw: unknown): LegacyResult | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const o = raw as Record<string, unknown>
  return {
    events: toStringList(pick(o, EVENT_KEYS)),
    people: toPeople(pick(o, PEOPLE_KEYS)),
    things: toStringList(pick(o, THING_KEYS)),
    pending: toStringList(pick(o, PENDING_KEYS)),
    highlights: toStringList(pick(o, HIGHLIGHT_KEYS)),
    nextFocus: toStringList(pick(o, FOCUS_KEYS)),
    nextFollowUps: toStringList(pick(o, FOLLOW_KEYS)),
  }
}

function unique(items: string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const item of items) {
    const text = item.trim()
    if (!text || seen.has(text)) continue
    seen.add(text)
    out.push(text)
  }
  return out
}

/**
 * 旧结果 → 复盘。
 *
 * - 主线 + 事情 → 这周做了什么（主线排在最前面，它本来就是最重要那一件）
 * - 未办 → 问题（没有建议，因为旧版根本没让 AI 给过建议）
 * - 下周重点 + 下周跟进的人 → 下周的行动项（旧版没记时间，`when` 一律空）
 * - 人际 / 物品：不迁 —— 复盘五段里没有对应位置
 */
export function legacyToReview(legacy: LegacyResult): Review {
  return {
    headline: '',
    did: unique([...legacy.highlights, ...legacy.events]),
    issues: unique(legacy.pending).map((text) => ({ text, advice: [], key: '' })),
    reconcile: [],
    plan: unique([...legacy.nextFocus, ...legacy.nextFollowUps]).map((text) => ({
      text,
      when: '',
    })),
    nudge: '',
  }
}
