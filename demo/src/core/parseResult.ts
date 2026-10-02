import {
  createEmptyResult,
  createEmptyState,
  type PersonNote,
  type WeeklyResult,
  type WeeklyState,
} from './types'

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

/**
 * 状态那一段：四项各一句。
 *
 * 容错口径和别处一致 —— 缺项留空、字段名各种叫法都认、模型写成数组也接得住。
 */
function toState(value: unknown): WeeklyState {
  const out = createEmptyState()
  if (!value || typeof value !== 'object' || Array.isArray(value)) return out
  const o = value as Record<string, unknown>
  out.body = readString(o.body ?? o.身体 ?? o.physical)
  out.mood = readString(o.mood ?? o.情绪 ?? o.emotion)
  out.focus = readString(o.focus ?? o.精力 ?? o.专注 ?? o.energy)
  out.growth = readString(o.growth ?? o.心智 ?? o.成长 ?? o.learning)
  return out
}

/**
 * 把一份**已经是对象**的东西规整成结果结构；不是对象就返回 null。
 *
 * 和 `parseResult` 的区别只在入口：那个负责从模型的一整段文本里挖出 JSON，
 * 这个负责「已经拿到对象了，但字段可能缺、可能是脏的」——
 * 周归档从文件里读回来走的正是后者。
 */
export function coerceResult(raw: unknown): WeeklyResult | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const o = raw as Record<string, unknown>
  return {
    events: toStringArray(o.events ?? o.事情),
    people: toPeople(o.people ?? o.人际),
    things: toStringArray(o.things ?? o.物品),
    pending: toStringArray(o.pending ?? o.未办 ?? o.悬而未决 ?? o.pendingItems),
    highlights: toStringArray(o.highlights ?? o.本周主线 ?? o.本周热点),
    nextFocus: toStringArray(o.nextFocus ?? o.下周重点),
    nextFollowUps: toStringArray(o.nextFollowUps ?? o.下周跟进),
    // 0.9.1 之前的档里没有 state：给四个空串，不炸也不冒充有内容
    state: toState(o.state ?? o.状态),
  }
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

  const result = coerceResult(data)
  if (!result) throw new Error('模型返回的 JSON 不是对象')
  return result
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

/**
 * 解析失败时的降级结果。
 * 文档要求「解析层必须带容错与降级，不允许崩溃」，
 * 所以这里给出一份看得懂、能继续操作的结果，而不是白屏或报错弹窗。
 */
export function degradedResult(reason: string): WeeklyResult {
  const result = createEmptyResult()
  result.highlights = [`这次没能整理成功：${reason}`, '可以点「重新整理」再试一次']
  result.nextFocus = ['重新生成一次本周梳理']
  return result
}
