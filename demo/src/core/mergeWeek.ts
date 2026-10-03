import type { PersonNote, WeeklyResult } from './types'

/**
 * 一周里聊第二次时的合并。
 *
 * 归档的规矩是「同一周只留一份」（见 archive.ts 的 upsertWeek），
 * 所以第二次梳理必须**接着上次补**，而不是把上次那份顶掉 ——
 * 用户说的原话是「接着上次补，并进同一份」。
 *
 * 规矩分三类，都是「新的一轮说什么就算什么，旧的不丢」：
 * - 清单（事情 / 人际 / 物品与支出 / 未办 / 成长）：新的在前、旧的接在后面，按内容去重；
 * - 主线与下周计划：新一轮给了就用新的，没给出东西才留旧的；
 * - 状态：分数与备注都是用户在界面上点的、写的，怎么算由调用方定（这里原样带过来）。
 */

function normalize(text: string): string {
  return text.trim().replace(/\s+/g, ' ')
}

/** 新的在前，旧的接在后面，按内容去重；空串一律丢掉 */
export function mergeNewFirst(current: string[], incoming: string[]): string[] {
  const out: string[] = []
  const seen = new Set<string>()

  for (const raw of [...incoming, ...current]) {
    const t = raw.trim()
    if (!t) continue
    const key = normalize(t)
    if (seen.has(key)) continue
    seen.add(key)
    out.push(t)
  }
  return out
}

/** 人名是去重键：新一轮里提到的人放在前面 */
export function mergePeopleNewFirst(current: PersonNote[], incoming: PersonNote[]): PersonNote[] {
  const out: PersonNote[] = []
  const seen = new Set<string>()

  for (const p of [...incoming, ...current]) {
    const name = p.name.trim()
    if (!name) continue
    const key = normalize(name)
    if (seen.has(key)) continue
    seen.add(key)
    out.push({ name, note: p.note.trim() })
  }
  return out
}

/** 新一轮这几项给了内容就用新的；一条都没给，才留旧的 */
function preferFresh(current: string[], incoming: string[]): string[] {
  const fresh = mergeNewFirst([], incoming)
  return fresh.length > 0 ? fresh : mergeNewFirst(current, [])
}

export function mergeWeekResult(
  fresh: WeeklyResult,
  previous: WeeklyResult | null | undefined,
): WeeklyResult {
  if (!previous) return fresh
  return {
    events: mergeNewFirst(previous.events, fresh.events),
    people: mergePeopleNewFirst(previous.people, fresh.people),
    things: mergeNewFirst(previous.things, fresh.things),
    pending: mergeNewFirst(previous.pending, fresh.pending),
    growth: mergeNewFirst(previous.growth, fresh.growth),
    highlights: preferFresh(previous.highlights, fresh.highlights),
    nextFocus: preferFresh(previous.nextFocus, fresh.nextFocus),
    nextFollowUps: preferFresh(previous.nextFollowUps, fresh.nextFollowUps),
    // 状态整组以新一轮为准（里面是用户这次点/写的东西）
    state: fresh.state,
  }
}

/** 开场复述用的几行：把这周已经记下的东西说给他听，再问他今天补什么 */
export function recapLines(result: WeeklyResult): string[] {
  const lines: string[] = []
  if (result.events.length > 0) lines.push(`事情：${result.events.slice(0, 3).join('；')}`)
  if (result.people.length > 0) {
    lines.push(`人际：${result.people.slice(0, 2).map((p) => p.name).join('、')}`)
  }
  if (result.things.length > 0) lines.push(`物品与支出：${result.things.slice(0, 2).join('；')}`)
  if (result.pending.length > 0) lines.push(`未办：${result.pending.slice(0, 2).join('；')}`)
  if (result.growth.length > 0) lines.push(`成长：${result.growth.slice(0, 2).join('；')}`)
  if (result.highlights.length > 0) lines.push(`本周主线：${result.highlights[0]}`)
  return lines
}

/** 这周已经记下东西了吗（空条目不算） */
export function hasWeekContent(result: WeeklyResult): boolean {
  return (
    result.events.length > 0 ||
    result.people.length > 0 ||
    result.things.length > 0 ||
    result.pending.length > 0 ||
    result.growth.length > 0 ||
    result.highlights.length > 0
  )
}
