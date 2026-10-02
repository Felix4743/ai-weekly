import {
  createDefaultConfig,
  DEFAULT_PERSONA_PRESET,
  type AppConfig,
  type ChatMessage,
  type PersonaConfig,
  type WeeklyResult,
} from '../core/types'
import { ARCHIVE_LIMIT, sortEntries, type WeekEntry } from '../core/archive'
import { isWeekKey, weekKeyOf, type WeekKey } from '../core/week'
import { coerceResult } from '../core/parseResult'
import { matchPersonaPreset } from '../core/persona'

/**
 * 存储的「形状」与校验。
 *
 * localStorage 与主进程 JSON 文件是两条通路，但「读出来的是什么、坏了怎么兜」
 * 必须是同一套规则 —— 否则同一个文件在两边会解析出不同结果。这里只做纯数据的
 * 归一化，不碰任何环境 API，所以能直接单测。
 */

export interface SavedSession {
  messages: ChatMessage[]
  result: WeeklyResult
  savedAt: number
  /** 这份结果算在哪一周（那一周的周一）。旧存档没这一项，按 savedAt 推 */
  week: WeekKey
}

/** 所有存储实现共同的接口：上层只认这七个操作 */
export interface AppStore {
  loadConfig(): AppConfig | null
  saveConfig(config: AppConfig): void
  loadSession(): SavedSession | null
  saveSession(session: SavedSession): void
  clearSession(): void
  /** 按周归档的结果，新的在前 */
  loadArchive(): WeekEntry[]
  saveArchive(list: WeekEntry[]): void
}

/**
 * 人设：缺字段就补默认，坏掉的当没写过。
 *
 * preset 一律从提示词原文推导，不直接采信存下来的值 ——
 * 它只用来决定界面上高亮哪一套，让它可以陈旧就等于给自己留了一个
 * 「显示的是温和朋友、实际发出去的是另一段」的坑。
 */
export function normalizePersona(raw: unknown): PersonaConfig {
  const base = createDefaultConfig().persona
  if (!raw || typeof raw !== 'object') return base
  const parsed = raw as Partial<PersonaConfig>
  const prompt = typeof parsed.prompt === 'string' ? parsed.prompt : base.prompt
  return {
    prompt,
    preset: prompt.trim() ? matchPersonaPreset(prompt) : DEFAULT_PERSONA_PRESET,
  }
}

/** 缺字段的配置补上默认值；整块不是对象就当没配过 */
export function normalizeConfig(raw: unknown): AppConfig | null {
  if (!raw || typeof raw !== 'object') return null
  const parsed = raw as Partial<AppConfig>
  const base = createDefaultConfig()
  return {
    apiKey: typeof parsed.apiKey === 'string' ? parsed.apiKey : base.apiKey,
    baseUrl: typeof parsed.baseUrl === 'string' ? parsed.baseUrl : base.baseUrl,
    model: typeof parsed.model === 'string' ? parsed.model : base.model,
    // 旧配置里没有这一项：补上默认人设，别的照旧
    persona: normalizePersona(parsed.persona),
  }
}

/** 会话至少要有一份消息数组和一份结果，否则当作没有 */
export function normalizeSession(raw: unknown): SavedSession | null {
  if (!raw || typeof raw !== 'object') return null
  const parsed = raw as Partial<SavedSession>
  if (!Array.isArray(parsed.messages) || !parsed.result) return null
  const savedAt = Number.isFinite(parsed.savedAt) ? (parsed.savedAt as number) : Date.now()
  return {
    messages: parsed.messages,
    result: parsed.result,
    savedAt,
    // M7 之前存的会话没有 week：按保存时间推一个，总比算到本周头上强
    week: isWeekKey(parsed.week) ? parsed.week : weekKeyOf(new Date(savedAt)),
  }
}

/**
 * 周归档：坏掉的条目**逐条丢掉**，而不是整份丢掉。
 *
 * 和会话不一样 —— 会话是一份、坏一份等于没有；归档是一串，
 * 里面有一周写坏了不该连累另外几十周。丢掉的条目会在下一次写入时自然消失。
 */
export function normalizeArchive(raw: unknown): WeekEntry[] {
  if (!Array.isArray(raw)) return []
  const out: WeekEntry[] = []
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const parsed = item as Partial<WeekEntry>
    if (!isWeekKey(parsed.week)) continue
    const result = coerceResult(parsed.result)
    if (!result) continue
    out.push({
      week: parsed.week,
      // 不是个正常的数字（缺了、NaN、Infinity）就当下现在写的 —— 排序与「上次记录」都靠它
      savedAt: Number.isFinite(parsed.savedAt) ? (parsed.savedAt as number) : Date.now(),
      result,
    })
  }
  // 同一周出现两条时留最后一条（文件被手工编辑过才会这样）
  const byWeek = new Map<WeekKey, WeekEntry>()
  for (const item of out) byWeek.set(item.week, item)
  return sortEntries([...byWeek.values()]).slice(0, ARCHIVE_LIMIT)
}
