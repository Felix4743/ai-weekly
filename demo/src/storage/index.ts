import type { WeekEntry } from '../core/archive'
import type { AppConfig } from '../core/types'
import { getBridge } from '../shared/bridge'
import { createIpcStore } from './ipcStore'
import { createLocalStore } from './localStore'
import type { AppStore } from './shape'

/**
 * 存储的门面：按运行环境挑实现，界面那边一行都不用改。
 *
 * 装在 Electron 里 → 主进程写 JSON 文件（有桥）
 * 在浏览器里跑   → localStorage（M2/M3 那条路）
 *
 * 0.9.0 起只有两样东西要存：一份配置、一份按周的归档。
 * 「最近一次会话」那条线整个删掉了 —— 采访流程没了，它也就没有了存在的理由；
 * 而复盘原文本来就一周一份地存在归档里。
 */

export type { AppStore } from './shape'

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

export function loadArchive(): WeekEntry[] {
  return selectStore().loadArchive()
}

export function saveArchive(list: WeekEntry[]): void {
  selectStore().saveArchive(list)
}
