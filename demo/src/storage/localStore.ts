import type { WeekEntry } from '../core/archive'
import type { AppConfig } from '../core/types'
import { normalizeArchive, normalizeConfig, type AppStore } from './shape'

/**
 * 浏览器里的存储：localStorage。
 * 读取一律经过 shape.ts 的归一化，坏了当没有，不往外抛 —— 存储出问题
 * 不该让整个应用打不开。
 */

const CONFIG_KEY = 'ai-weekly:config'
const ARCHIVE_KEY = 'ai-weekly:weeks'

function storage(): Storage | null {
  try {
    if (typeof localStorage === 'undefined') return null
    return localStorage
  } catch {
    return null
  }
}

function read(key: string): unknown {
  const s = storage()
  if (!s) return null
  try {
    const raw = s.getItem(key)
    if (!raw) return null
    return JSON.parse(raw) as unknown
  } catch {
    return null
  }
}

function write(key: string, value: unknown): void {
  const s = storage()
  if (!s) return
  try {
    s.setItem(key, JSON.stringify(value))
  } catch {
    /* 存储不可用时静默降级，不影响本次使用 */
  }
}

export function loadConfig(): AppConfig | null {
  return normalizeConfig(read(CONFIG_KEY))
}

export function saveConfig(config: AppConfig): void {
  write(CONFIG_KEY, config)
}

export function loadArchive(): WeekEntry[] {
  return normalizeArchive(read(ARCHIVE_KEY))
}

export function saveArchive(list: WeekEntry[]): void {
  write(ARCHIVE_KEY, list)
}

export function createLocalStore(): AppStore {
  return { loadConfig, saveConfig, loadArchive, saveArchive }
}
