import type { AppConfig } from '../core/types'
import { getBridge } from '../shared/bridge'
import { createIpcStore } from './ipcStore'
import { createLocalStore } from './localStore'
import type { AppStore, SavedSession } from './shape'

/**
 * 存储的门面：按运行环境挑实现，界面那边一行都不用改。
 *
 * 装在 Electron 里 → 主进程写 JSON 文件（有桥）
 * 在浏览器里跑   → localStorage（M2/M3 那条路）
 */

export type { AppStore, SavedSession } from './shape'

export function selectStore(): AppStore {
  const bridge = getBridge()
  return bridge ? createIpcStore(bridge) : createLocalStore()
}

export function loadConfig(): AppConfig | null {
  return selectStore().loadConfig()
}

export function saveConfig(config: AppConfig): void {
  selectStore().saveConfig(config)
}

export function loadSession(): SavedSession | null {
  return selectStore().loadSession()
}

export function saveSession(session: SavedSession): void {
  selectStore().saveSession(session)
}

export function clearSession(): void {
  selectStore().clearSession()
}
