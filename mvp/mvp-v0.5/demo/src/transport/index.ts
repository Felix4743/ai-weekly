import type { ChatTransport } from '../core/chatTransport'
import { getBridge } from '../shared/bridge'
import { createBrowserTransport } from './browserTransport'
import { createIpcTransport } from './ipcTransport'

/**
 * 传输层的门面：有桥（Electron）就走主进程，没有就走浏览器 fetch。
 *
 * 这正是技术方案里说的那条接缝 —— 换外壳时只改这一处挑选逻辑，
 * core/ 与 ui/ 完全不用动。
 */

export { resolveChatUrl } from './browserTransport'

export function createTransport(): ChatTransport {
  const bridge = getBridge()
  return bridge ? createIpcTransport(bridge) : createBrowserTransport()
}
