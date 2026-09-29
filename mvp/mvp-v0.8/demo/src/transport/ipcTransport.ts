import { AiError } from '../core/aiError'
import type { ChatRequest, ChatTransport } from '../core/chatTransport'
import type { AiWeeklyBridge } from '../shared/ipc'

/**
 * Electron 里的传输层实现：真正的 HTTP 请求由主进程发。
 *
 * 好处有两个，都是实打实的：
 * 1. 渲染进程不碰网络，API Key 不进页面上下文，也不再有跨域这回事
 * 2. 流式仍然是流式 —— 主进程每收到一段就推一次增量，界面照旧逐字出现
 *
 * 这一份和 browserTransport 实现的是同一个接口，所以 core/ 与 ui/ 一行没动。
 */

let seq = 0

/** 本次请求的标识：主进程靠它把增量对回到对的那一次请求上 */
function nextRequestId(): string {
  seq += 1
  return `req_${Date.now().toString(36)}_${seq}`
}

export function createIpcTransport(bridge: AiWeeklyBridge): ChatTransport {
  return {
    async send(req: ChatRequest, onDelta?: (delta: string) => void): Promise<string> {
      const requestId = nextRequestId()
      const onOuterAbort = (): void => bridge.llm.abort(requestId)
      req.signal?.addEventListener('abort', onOuterAbort)

      try {
        const res = await bridge.llm.send(
          {
            requestId,
            baseUrl: req.baseUrl.trim().replace(/\/+$/, ''),
            apiKey: req.apiKey,
            model: req.model,
            messages: req.messages,
            json: req.json,
          },
          (delta) => onDelta?.(delta),
        )

        // 主进程把失败包成了信封，为的是原样保留那句给人看的话
        if (!res.ok) throw new AiError(res.message, res.detail)
        return res.text
      } finally {
        req.signal?.removeEventListener('abort', onOuterAbort)
      }
    },
  }
}
