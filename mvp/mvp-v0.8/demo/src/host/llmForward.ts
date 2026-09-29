import { AiError, describeFailure } from '../core/aiError'
import type { ChatRequest } from '../core/chatTransport'
import { readChatResponse } from '../shared/chatStream'

/**
 * 主进程里真正发请求的地方。
 *
 * 与浏览器实现（transport/browserTransport.ts）只差一件事：不经过 dev 代理 ——
 * 主进程不受同源策略约束，也就是说打包之后 Key 不必再流经一条本地链路。
 * 解析响应那一段两边共用 shared/chatStream.ts。
 */

export interface ForwardOptions {
  /** 便于测试注入 */
  fetchImpl?: typeof fetch
  /** 单次请求的总超时 */
  timeoutMs?: number
}

export async function forwardChat(
  req: ChatRequest,
  onDelta: (delta: string) => void,
  options: ForwardOptions = {},
): Promise<string> {
  const doFetch = options.fetchImpl ?? fetch
  const timeoutMs = options.timeoutMs ?? 120_000
  const baseUrl = req.baseUrl.trim().replace(/\/+$/, '')

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  const onOuterAbort = (): void => controller.abort()
  req.signal?.addEventListener('abort', onOuterAbort)

  try {
    let res: Response
    try {
      res = await doFetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${req.apiKey}`,
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
        throw new AiError(`请求超过 ${Math.round(timeoutMs / 1000)} 秒还没有结果，请再试一次`)
      }
      throw new AiError('连不上接口地址，检查一下网络和「接口地址」填得对不对', String(err))
    }

    if (!res.ok) {
      const body = await res.text().catch(() => '')
      throw new AiError(describeFailure(res.status, body), body.slice(0, 400))
    }

    const { text } = await readChatResponse(res, onDelta)
    return text
  } finally {
    clearTimeout(timer)
    req.signal?.removeEventListener('abort', onOuterAbort)
  }
}
