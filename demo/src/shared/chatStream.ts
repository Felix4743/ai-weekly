import { AiError } from '../core/aiError'
import { createSseParser, extractMessageText } from '../core/sse'

/**
 * 把一次对话补全的响应读成文本。
 *
 * 浏览器传输层与主进程转发都走这里，「SSE 怎么解析、汉字被切开怎么办、
 * 网关整段返回 JSON 怎么兜」这套规则就只有一份实现、一份测试。
 */

async function readAll(reader: ReadableStreamDefaultReader<Uint8Array>): Promise<Uint8Array> {
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    if (value) {
      chunks.push(value)
      total += value.length
    }
  }
  const out = new Uint8Array(total)
  let at = 0
  for (const c of chunks) {
    out.set(c, at)
    at += c.length
  }
  return out
}

export interface ChatStreamOutcome {
  text: string
  /** 是不是真的边收边给（用于区分「流式」与「整段返回」） */
  streamed: boolean
}

/**
 * 读响应体，边读边把增量交给 onDelta；返回拼好的完整文本。
 * 一个字都没有时抛 AiError —— 静悄悄返回空串比报错更难排查。
 */
export async function readChatResponse(
  res: Response,
  onDelta?: (delta: string) => void,
): Promise<ChatStreamOutcome> {
  const reader = res.body?.getReader?.()
  if (!reader) {
    const full = extractMessageText(await res.text())
    if (!full) throw new AiError('模型没有返回任何内容，请再试一次')
    onDelta?.(full)
    return { text: full, streamed: false }
  }

  const contentType = res.headers?.get?.('content-type') ?? ''
  const decoder = new TextDecoder()

  // 有些网关即使 stream=true 也会把整段一次性返回
  if (!contentType.includes('text/event-stream')) {
    const raw = decoder.decode(await readAll(reader), { stream: false })
    const full = extractMessageText(raw) ?? raw.trim()
    if (!full) throw new AiError('模型没有返回任何内容，请再试一次')
    onDelta?.(full)
    return { text: full, streamed: false }
  }

  const parser = createSseParser()
  let out = ''
  const push = (deltas: string[]): void => {
    for (const d of deltas) {
      out += d
      onDelta?.(d)
    }
  }

  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    // 必须用流式解码：一个汉字可能被切在相邻两个 chunk 里
    if (value) push(parser.push(decoder.decode(value, { stream: true })))
  }
  push(parser.end())

  if (!out) throw new AiError('模型没有返回任何内容，请再试一次')
  return { text: out, streamed: true }
}
