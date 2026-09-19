import type { AiWeeklyBridge } from './ipc'

/**
 * 取预加载脚本注入的那座桥。
 *
 * 有桥 = 跑在 Electron 里（网络与存储都归主进程）；没桥 = 跑在浏览器里
 * （走 fetch + localStorage，也就是 M2/M3 那条路）。上层据此挑实现，
 * 业务代码完全不需要知道自己被装在哪个壳里。
 */

interface GlobalWithBridge {
  aiWeekly?: Partial<AiWeeklyBridge>
}

export function getBridge(): AiWeeklyBridge | null {
  const g = globalThis as GlobalWithBridge
  const bridge = g.aiWeekly
  // 半截的桥（只有 llm 没有 store）当成没有，免得后面用着用着才炸
  if (!bridge || !bridge.llm || !bridge.store) return null
  if (typeof bridge.llm.send !== 'function') return null
  return bridge as AiWeeklyBridge
}
