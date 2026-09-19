import { createDefaultConfig, type AppConfig, type ChatMessage, type WeeklyResult } from '../core/types'

const CONFIG_KEY = 'ai-weekly:config'
const SESSION_KEY = 'ai-weekly:last-session'

export interface SavedSession {
  messages: ChatMessage[]
  result: WeeklyResult
  savedAt: number
}

function storage(): Storage | null {
  try {
    if (typeof localStorage === 'undefined') return null
    return localStorage
  } catch {
    return null
  }
}

export function loadConfig(): AppConfig | null {
  const s = storage()
  if (!s) return null
  try {
    const raw = s.getItem(CONFIG_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<AppConfig>
    const base = createDefaultConfig()
    return {
      apiKey: typeof parsed.apiKey === 'string' ? parsed.apiKey : base.apiKey,
      baseUrl: typeof parsed.baseUrl === 'string' ? parsed.baseUrl : base.baseUrl,
      model: typeof parsed.model === 'string' ? parsed.model : base.model,
    }
  } catch {
    return null
  }
}

export function saveConfig(config: AppConfig): void {
  const s = storage()
  if (!s) return
  try {
    s.setItem(CONFIG_KEY, JSON.stringify(config))
  } catch {
    /* 存储不可用时静默降级，不影响本次使用 */
  }
}

export function loadSession(): SavedSession | null {
  const s = storage()
  if (!s) return null
  try {
    const raw = s.getItem(SESSION_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<SavedSession>
    if (!Array.isArray(parsed.messages) || !parsed.result) return null
    return {
      messages: parsed.messages,
      result: parsed.result,
      savedAt: typeof parsed.savedAt === 'number' ? parsed.savedAt : Date.now(),
    }
  } catch {
    return null
  }
}

export function saveSession(session: SavedSession): void {
  const s = storage()
  if (!s) return
  try {
    s.setItem(SESSION_KEY, JSON.stringify(session))
  } catch {
    /* 同上 */
  }
}

export function clearSession(): void {
  const s = storage()
  if (!s) return
  try {
    s.removeItem(SESSION_KEY)
  } catch {
    /* 同上 */
  }
}
