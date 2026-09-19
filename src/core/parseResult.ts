import { createEmptyResult, type PersonNote, type WeeklyResult } from './types'

export interface ParseOutcome {
  result: WeeklyResult
  error?: string
}

function stripFences(raw: string): string {
  const trimmed = raw.trim()
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)
  return fenced ? fenced[1].trim() : trimmed
}

function sliceJsonObject(text: string): string | null {
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start === -1 || end === -1 || end <= start) return null
  return text.slice(start, end + 1)
}

function readString(value: unknown): string {
  if (typeof value === 'string') return value.trim()
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (value && typeof value === 'object') {
    const o = value as Record<string, unknown>
    return readString(o.text ?? o.name ?? o.title ?? '')
  }
  return ''
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.map(readString).filter((s) => s.length > 0)
}

function toPeople(value: unknown): PersonNote[] {
  if (!Array.isArray(value)) return []
  const out: PersonNote[] = []
  for (const item of value) {
    if (typeof item === 'string') {
      const s = item.trim()
      if (s) out.push({ name: s, note: '' })
      continue
    }
    if (item && typeof item === 'object') {
      const o = item as Record<string, unknown>
      const name = readString(o.name ?? o.who ?? o.person ?? '')
      const note = readString(o.note ?? o.detail ?? o.desc ?? o.text ?? '')
      if (name || note) out.push({ name: name || note, note })
    }
  }
  return out
}

/** 把模型返回的任意文本规整成结果结构；无法解析时抛错 */
export function parseResult(raw: string): WeeklyResult {
  if (typeof raw !== 'string' || raw.trim().length === 0) {
    throw new Error('模型返回为空')
  }
  const sliced = sliceJsonObject(stripFences(raw))
  if (!sliced) throw new Error('模型返回中没有找到 JSON 对象')

  let data: unknown
  try {
    data = JSON.parse(sliced)
  } catch (err) {
    throw new Error(`模型返回的 JSON 无法解析：${(err as Error).message}`)
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new Error('模型返回的 JSON 不是对象')
  }

  const o = data as Record<string, unknown>
  return {
    events: toStringArray(o.events ?? o.事情),
    people: toPeople(o.people ?? o.人际),
    pending: toStringArray(o.pending ?? o.悬而未决 ?? o.pendingItems),
    highlights: toStringArray(o.highlights ?? o.本周热点),
    nextFocus: toStringArray(o.nextFocus ?? o.下周重点),
    nextFollowUps: toStringArray(o.nextFollowUps ?? o.下周跟进),
  }
}

/**
 * 容错版本：模型输出一定偶尔不合法，这里永远不抛错，
 * 解析失败时降级为空结果并返回原因，由界面提示重试。
 */
export function parseResultSafe(raw: string): ParseOutcome {
  try {
    return { result: parseResult(raw) }
  } catch (err) {
    return { result: createEmptyResult(), error: (err as Error).message }
  }
}
