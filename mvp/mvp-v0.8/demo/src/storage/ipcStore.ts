import type { WeekEntry } from '../core/archive'
import type { AppConfig } from '../core/types'
import type { AiWeeklyBridge } from '../shared/ipc'
import {
  normalizeArchive,
  normalizeConfig,
  normalizeSession,
  type AppStore,
  type SavedSession,
} from './shape'

/**
 * Electron 里的存储：读写都交给主进程，落在两个 JSON 文件上。
 *
 * 读是同步的（首屏要在第一次渲染之前就决定进设置页还是对话页），
 * 写走异步 —— 存一次配置不值得让界面卡一下。
 *
 * 桥那头的任何异常都在这里兜住：存储坏掉最多是「这次没记住」，
 * 不能把整个界面带崩。
 */

export function createIpcStore(bridge: AiWeeklyBridge): AppStore {
  const store = bridge.store

  return {
    loadConfig(): AppConfig | null {
      try {
        return normalizeConfig(store.loadConfig())
      } catch {
        return null
      }
    },

    saveConfig(config: AppConfig): void {
      try {
        store.saveConfig(config)
      } catch {
        /* 同上：静默降级 */
      }
    },

    loadSession(): SavedSession | null {
      try {
        return normalizeSession(store.loadSession())
      } catch {
        return null
      }
    },

    saveSession(session: SavedSession): void {
      try {
        store.saveSession(session)
      } catch {
        /* 同上 */
      }
    },

    clearSession(): void {
      try {
        store.clearSession()
      } catch {
        /* 同上 */
      }
    },

    loadArchive(): WeekEntry[] {
      try {
        return normalizeArchive(store.loadArchive())
      } catch {
        return []
      }
    },

    saveArchive(list: WeekEntry[]): void {
      try {
        store.saveArchive(list)
      } catch {
        /* 同上 */
      }
    },
  }
}
