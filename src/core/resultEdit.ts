import type { PersonNote, WeeklyResult } from './types'

/** 单值列表的字段名（人际是对象列表，单独处理） */
export type ListKey = 'events' | 'pending' | 'highlights' | 'nextFocus' | 'nextFollowUps'

export function updateItem(
  result: WeeklyResult,
  key: ListKey,
  index: number,
  value: string,
): WeeklyResult {
  const list = result[key]
  if (index < 0 || index >= list.length) return result
  const next = [...list]
  next[index] = value.trim()
  return { ...result, [key]: next }
}

export function removeItem(result: WeeklyResult, key: ListKey, index: number): WeeklyResult {
  const list = result[key]
  if (index < 0 || index >= list.length) return result
  return { ...result, [key]: list.filter((_, i) => i !== index) }
}

export function addItem(result: WeeklyResult, key: ListKey, value: string): WeeklyResult {
  const text = value.trim()
  if (!text) return result
  return { ...result, [key]: [...result[key], text] }
}

export function updatePerson(
  result: WeeklyResult,
  index: number,
  patch: Partial<PersonNote>,
): WeeklyResult {
  if (index < 0 || index >= result.people.length) return result
  const next = result.people.map((p, i) =>
    i === index
      ? {
          name: (patch.name ?? p.name).trim(),
          note: (patch.note ?? p.note).trim(),
        }
      : p,
  )
  return { ...result, people: next }
}

export function removePerson(result: WeeklyResult, index: number): WeeklyResult {
  if (index < 0 || index >= result.people.length) return result
  return { ...result, people: result.people.filter((_, i) => i !== index) }
}

export function addPerson(result: WeeklyResult, person: PersonNote): WeeklyResult {
  const name = person.name.trim()
  if (!name) return result
  return { ...result, people: [...result.people, { name, note: person.note.trim() }] }
}
