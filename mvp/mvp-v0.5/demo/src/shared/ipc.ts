/**
 * 主进程 ↔ 渲染进程的 IPC 契约。
 *
 * 只放通道名与消息形状，不放实现：主进程、预加载脚本、渲染端的传输层与存储
 * 都从这里取同一份定义，省得两边各写一遍字符串、然后慢慢对不上。
 *
 * 也正因为它被三边共用，这里必须保持环境无关 —— 不碰 Electron、Node、React。
 */

import type { ChatMessagePayload } from '../core/chatTransport'

export const IPC = {
  /** 发起一次对话补全（真正发请求的是主进程） */
  llmSend: 'llm:send',
  /** 主进程把增量文本推回渲染进程 */
  llmDelta: 'llm:delta',
  /** 取消进行中的请求 */
  llmAbort: 'llm:abort',
  loadConfig: 'store:load-config',
  saveConfig: 'store:save-config',
  loadSession: 'store:load-session',
  saveSession: 'store:save-session',
  clearSession: 'store:clear-session',
} as const

export interface LlmSendPayload {
  /** 渲染端生成，用来把 delta 事件对回到本次请求上 */
  requestId: string
  baseUrl: string
  apiKey: string
  model: string
  messages: ChatMessagePayload[]
  json?: boolean
}

export interface LlmDeltaPayload {
  requestId: string
  delta: string
}

/**
 * 结果用信封包一层，而不是直接 throw：
 * `invoke` 抛出时 Electron 会在消息前面糊一截「Error invoking remote method」，
 * 而这里要的是原样保留那句给用户看的人话。
 */
export type LlmSendResult =
  | { ok: true; text: string }
  | { ok: false; message: string; detail: string }

/** 预加载脚本挂到 window 上的桥；渲染端只认这个接口，不认 Electron */
export interface AiWeeklyBridge {
  llm: {
    send(payload: LlmSendPayload, onDelta: (delta: string) => void): Promise<LlmSendResult>
    abort(requestId: string): void
  }
  store: {
    /** 同步读：首屏要在第一次渲染前就决定进设置页还是对话页 */
    loadConfig(): unknown
    saveConfig(config: unknown): void
    loadSession(): unknown
    saveSession(session: unknown): void
    clearSession(): void
  }
}
