import { AiError, describeFailure } from '../core/aiError'
import type { ChatRequest, ChatTransport } from '../core/chatTransport'
import { readChatResponse } from '../shared/chatStream'

/**
 * 浏览器实现：用 fetch 直接打接口，边收边解析 SSE。
 *
 * 开发期统一走 dev server 的 /llm-proxy（见 vite.config.ts）由它代为转发，
 * 浏览器就不会撞上跨域；而且代理的目标地址来自请求头，所以设置页里
 * 换成任何 OpenAI 兼容接口都能用。
 *
 * M4 接 Electron 时，只需要再写一个走主进程 IPC 的实现替换掉它，
 * core/ 里的业务逻辑一行都不用改。
 */

export interface BrowserTransportOptions {
  /** 是否走 dev 代理；默认取 Vite 的 DEV 标记 */
  dev?: boolean
  /** 便于测试注入 */
  fetchImpl?: typeof fetch
  /** 单次请求的总超时；流式响应只要还在吐字就不会触发 */
  timeoutMs?: number
}

/** 拼出真正要请求的地址 */
export function resolveChatUrl(baseUrl: string, dev: boolean): string {
  const base = baseUrl.trim().replace(/\/+$/, '')
  if (dev) return '/llm-proxy/chat/completions'
  return `${base}/chat/completions`
}

export function createBrowserTransport(options: BrowserTransportOptions = {}): ChatTransport {
  const dev = options.dev ?? Boolean(import.meta.env?.DEV)
  const doFetch = options.fetchImpl ?? fetch
  const timeoutMs = options.timeoutMs ?? 120_000

  return {
    async send(req: ChatRequest, onDelta?: (delta: string) => void): Promise<string> {
      const baseUrl = req.baseUrl.trim().replace(/\/+$/, '')
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), timeoutMs)
      const onOuterAbort = () => controller.abort()
      req.signal?.addEventListener('abort', onOuterAbort)

      try {
        let res: Response
        try {
          res = await doFetch(resolveChatUrl(baseUrl, dev), {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${req.apiKey}`,
              // dev 代理据此决定转发到哪台机器；正式环境用不上这个头
              'x-llm-base': baseUrl,
            },
            body: JSON.stringify({
              model: req.model,
              messages: req.messages,
              stream: true,
              ...(req.json ? { response_format: { type: 'json_object' } } : {}),
            }),
            signal: controller.signal,
          })
        } catch (err) {
          if ((err as Error)?.name === 'AbortError') {
            if (req.signal?.aborted) throw new AiError('已取消')
            throw new AiError(
              `请求超过 ${Math.round(timeoutMs / 1000)} 秒还没有结果，请再试一次`,
            )
          }
          throw new AiError('连不上接口地址，检查一下网络和「接口地址」填得对不对', String(err))
        }

        if (!res.ok) {
          const body = await res.text().catch(() => '')
          throw new AiError(describeFailure(res.status, body), body.slice(0, 400))
        }

        // 响应怎么读（SSE 逐段 / 网关整段返回 JSON）与主进程那份共用一套规则，
        // 「一个汉字被切在两个包里」这类坑只需要在一个地方处理对
        const { text } = await readChatResponse(res, onDelta)
        return text
      } finally {
        clearTimeout(timer)
        req.signal?.removeEventListener('abort', onOuterAbort)
      }
    },
  }
}
