import {
  createEmptyResult,
  createEmptyState,
  type PersonNote,
  type WeeklyResult,
  type WeeklyState,
} from './types'
import { coerceScores, hasAnyScore } from './stateScore'

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

/** 0.9.1/0.9.2 那两版状态是四行文字，读回来时并成一行备注（原话保留） */
const LEGACY_STATE_ROWS: { label: string; keys: string[] }[] = [
  { label: '身体', keys: ['body', '身体', 'physical'] },
  { label: '情绪', keys: ['mood', '情绪', 'emotion'] },
  { label: '精力', keys: ['focus', '精力', '专注', 'energy'] },
  { label: '心智', keys: ['growth', '心智', '成长', 'learning'] },
]

/**
 * 状态那一栏：0.9.3 起是「四项分数 + 一行备注」，0.9.4 又多了「追问问出来的小结」。
 *
 * 容错口径和别处一致 —— 字段名各种叫法都认、缺项留空。
 * 分数只有 1–5 的整数才算数：模型自己编的分也认（读得回来），
 * 但生成与重新整理两步都会用界面上真实的点击把它盖掉。
 * 老的「四行文字」不会丢：并成备注，原话照抄。
 *
 * `digestRaw` 是**模型输出里的那一段**：`state` 不在结果 schema 里（分数不归模型管），
 * 所以模型写的小结只能走顶层字段，到这儿再折进 `state.followUp`。
 */
function toState(value: unknown, digestRaw?: unknown): WeeklyState {
  const out = createEmptyState()
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return withDigest(out, digestRaw)
  }
  const o = value as Record<string, unknown>

  const note = readString(o.note ?? o.备注 ?? o.说明 ?? '')
  if (note) out.note = note
  else {
    const rows: string[] = []
    for (const row of LEGACY_STATE_ROWS) {
      // 老档的键名五花八门（英文、中文、还有 0.9.1 中途换过的说法），逐个认
      const raw = row.keys.map((key) => o[key]).find((v) => v !== undefined && v !== null)
      const text = readString(raw ?? '')
      if (text) rows.push(`${row.label}：${text}`)
    }
    if (rows.length > 0) out.note = rows.join('；')
  }

  const scores = coerceScores(o.scores ?? o.评分 ?? o.打分)
  if (hasAnyScore(scores)) out.scores = scores

  // 归档读回来时小结就在 state 里（`followUp`）；模型输出走顶层字段，由调用方传进来
  return withDigest(out, digestRaw ?? o.followUp ?? o.追问 ?? o.状态小结)
}

/** 有小结才写这个键：空串不该在存档里留下一个空字段 */
function withDigest(state: WeeklyState, raw: unknown): WeeklyState {
  const text = readString(raw ?? '')
  if (text) state.followUp = text
  return state
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
    growth: toStringArray(o.growth ?? o.成长),
    highlights: toStringArray(o.highlights ?? o.本周主线 ?? o.本周热点),
    nextFocus: toStringArray(o.nextFocus ?? o.下周重点),
    nextFollowUps: toStringArray(o.nextFollowUps ?? o.下周跟进),
    // 0.9.0 之前的档里没有 state：给空备注，不炸也不冒充有内容
    // 追问小结（0.9.4）写的时候是顶层字段，因为状态那一栏不由模型产出
    state: toState(o.state ?? o.状态, o.stateFollowUp ?? o.stateDigest ?? o.状态小结),
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
