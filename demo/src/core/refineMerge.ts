import type { PersonNote, WeeklyResult } from './types'
import { attachState } from './stateScore'

/**
 * 「重新整理」的结果合并。
 *
 * 这是文档 3.4 那条约定的最后一道保险：**用户手改过的清单不能被一次点击抹掉**。
 * 提示词里已经要求模型原样返回清单，但模型不总是听话，
 * 所以这里在代码层面再兜一次 —— 清单以用户改过的版本为准，模型只能往里加新内容。
 */

function normalize(text: string): string {
  return text.trim().replace(/\s+/g, ' ')
}

/** 保留当前顺序，把模型新给的追加到末尾，按内容去重 */
function mergeStrings(current: string[], incoming: string[]): string[] {
  const out: string[] = []
  const seen = new Set<string>()

  for (const raw of current) {
    const t = raw.trim()
    if (!t) continue
    const key = normalize(t)
    if (seen.has(key)) continue
    seen.add(key)
    out.push(t)
  }
  for (const raw of incoming) {
    const t = raw.trim()
    if (!t) continue
    const key = normalize(t)
    if (seen.has(key)) continue
    seen.add(key)
    out.push(t)
  }
  return out
}

/** 人名是去重键：同名的人以用户改过的版本为准 */
function mergePeople(current: PersonNote[], incoming: PersonNote[]): PersonNote[] {
  const out: PersonNote[] = []
  const seen = new Set<string>()

  for (const p of current) {
    const name = p.name.trim()
    if (!name) continue
    const key = normalize(name)
    if (seen.has(key)) continue
    seen.add(key)
    out.push({ name, note: p.note.trim() })
  }
  for (const p of incoming) {
    const name = p.name.trim()
    if (!name) continue
    const key = normalize(name)
    if (seen.has(key)) continue
    seen.add(key)
    out.push({ name, note: p.note.trim() })
  }
  return out
}

/** 模型这三项给了内容就用模型的；一条都没给，就保留原来的，避免把界面清空 */
function preferIncoming(current: string[], incoming: string[]): string[] {
  const merged = mergeStrings([], incoming)
  return merged.length > 0 ? merged : mergeStrings(current, [])
}

export function mergeRefined(current: WeeklyResult, fromModel: WeeklyResult): WeeklyResult {
  return {
    events: mergeStrings(current.events, fromModel.events),
    people: mergePeople(current.people, fromModel.people),
    things: mergeStrings(current.things, fromModel.things),
    pending: mergeStrings(current.pending, fromModel.pending),
    growth: mergeStrings(current.growth, fromModel.growth),
    highlights: preferIncoming(current.highlights, fromModel.highlights),
    nextFocus: preferIncoming(current.nextFocus, fromModel.nextFocus),
    nextFollowUps: preferIncoming(current.nextFollowUps, fromModel.nextFollowUps),
    // 状态整组照搬当前的：备注是用户自己写的，分数是他在界面上点出来的，
    // 追问小结是据那场追问写下的 —— 模型三样都不该动。
    // （不带上这三个参数，「重新整理」一次就把星星和追问小结全洗掉了）
    state: attachState(current.state.scores, current.state.note, current.state.followUp),
  }
}
