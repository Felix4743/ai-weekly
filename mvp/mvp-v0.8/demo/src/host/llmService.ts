import { AiError, describeError } from '../core/aiError'
import type { ChatRequest } from '../core/chatTransport'
import { IPC, type LlmDeltaPayload, type LlmSendPayload, type LlmSendResult } from '../shared/ipc'
import { forwardChat } from './llmForward'

/**
 * 主进程侧的一次请求从开始到结束的记账。
 *
 * 抽出来的理由和 core/ 一样：这段逻辑（请求并发、增量往哪发、取消怎么落到
 * AbortController、失败怎么变成一句人话）是纯粹的状态管理，不该跟 Electron 的
 * ipcMain 缠在一起 —— 这里一个 Electron API 都不用，注入一个「往外发」的函数就能测。
 */

export interface LlmServiceDeps {
  /** 把增量文本推回渲染进程（真实实现是 webContents.send） */
  emit: (channel: string, payload: LlmDeltaPayload) => void
  /** 便于测试注入假的上游 */
  forward?: typeof forwardChat
}

export interface LlmService {
  handle(payload: LlmSendPayload): Promise<LlmSendResult>
  abort(requestId: string): void
  /** 当前进行中的请求数，便于测试与排查 */
  inFlightCount(): number
}

export function createLlmService(deps: LlmServiceDeps): LlmService {
  const forward = deps.forward ?? forwardChat
  const inFlight = new Map<string, AbortController>()

  return {
    async handle(payload: LlmSendPayload): Promise<LlmSendResult> {
      if (inFlight.has(payload.requestId)) {
        return { ok: false, message: '这次请求已经在进行中了', detail: payload.requestId }
      }

      const controller = new AbortController()
      inFlight.set(payload.requestId, controller)

      const req: ChatRequest = {
        baseUrl: payload.baseUrl,
        apiKey: payload.apiKey,
        model: payload.model,
        messages: payload.messages,
        json: payload.json,
        signal: controller.signal,
      }

      try {
        const text = await forward(req, (delta) => {
          deps.emit(IPC.llmDelta, { requestId: payload.requestId, delta })
        })
        return { ok: true, text }
      } catch (err) {
        return {
          ok: false,
          message: describeError(err),
          // 原始细节留着排查用，但不上界面
          detail: err instanceof AiError ? err.detail : String(err),
        }
      } finally {
        inFlight.delete(payload.requestId)
      }
    },

    abort(requestId: string): void {
      inFlight.get(requestId)?.abort()
    },

    inFlightCount(): number {
      return inFlight.size
    },
  }
}
