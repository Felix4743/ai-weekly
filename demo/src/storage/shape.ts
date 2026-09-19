import {
  createDefaultConfig,
  DEFAULT_PERSONA_PRESET,
  type AppConfig,
  type ChatMessage,
  type PersonaConfig,
  type WeeklyResult,
} from '../core/types'
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
}

/** 所有存储实现共同的接口：上层只认这五个操作 */
export interface AppStore {
  loadConfig(): AppConfig | null
  saveConfig(config: AppConfig): void
  loadSession(): SavedSession | null
  saveSession(session: SavedSession): void
  clearSession(): void
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
  return {
    messages: parsed.messages,
    result: parsed.result,
    savedAt: typeof parsed.savedAt === 'number' ? parsed.savedAt : Date.now(),
  }
}
