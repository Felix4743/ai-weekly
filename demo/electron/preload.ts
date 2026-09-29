import { contextBridge, ipcRenderer } from 'electron'
import {
  IPC,
  type AiWeeklyBridge,
  type LlmDeltaPayload,
  type LlmSendPayload,
  type LlmSendResult,
} from '../src/shared/ipc'

/**
 * 预加载脚本：渲染进程与主进程之间唯一的门。
 *
 * 只开五个口子（发请求 / 取消 / 读存储 / 写存储），其余一律不给 ——
 * 渲染进程拿不到 Node，也拿不到任意 IPC 通道。
 *
 * 增量文本用「请求标识」过滤：同一时间可能有好几次请求在跑，
 * 谁的增量回给谁，不能串台。
 */

const bridge: AiWeeklyBridge = {
  llm: {
    async send(payload: LlmSendPayload, onDelta: (delta: string) => void): Promise<LlmSendResult> {
      const listener = (_event: unknown, message: LlmDeltaPayload): void => {
        if (message && message.requestId === payload.requestId) onDelta(message.delta)
      }
      ipcRenderer.on(IPC.llmDelta, listener)
      try {
        return (await ipcRenderer.invoke(IPC.llmSend, payload)) as LlmSendResult
      } catch (err) {
        // 走到这里说明连主进程都没接上，属于意外，也给一句人话
        return { ok: false, message: '主进程没能完成这次请求，请再试一次', detail: String(err) }
      } finally {
        ipcRenderer.removeListener(IPC.llmDelta, listener)
      }
    },

    abort(requestId: string): void {
      ipcRenderer.send(IPC.llmAbort, requestId)
    },
  },

  store: {
    loadConfig: (): unknown => ipcRenderer.sendSync(IPC.loadConfig),
    saveConfig: (config: unknown): void => {
      ipcRenderer.send(IPC.saveConfig, config)
    },
    loadSession: (): unknown => ipcRenderer.sendSync(IPC.loadSession),
    saveSession: (session: unknown): void => {
      ipcRenderer.send(IPC.saveSession, session)
    },
    clearSession: (): void => {
      ipcRenderer.send(IPC.clearSession)
    },
    loadArchive: (): unknown => ipcRenderer.sendSync(IPC.loadArchive),
    saveArchive: (list: unknown): void => {
      ipcRenderer.send(IPC.saveArchive, list)
    },
  },
}

contextBridge.exposeInMainWorld('aiWeekly', bridge)
