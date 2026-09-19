import { AiError } from './aiError'

/**
 * OpenAI 兼容的 SSE（Server-Sent Events）流解析。
 *
 * 全部是纯字符串处理，不碰网络，因此可以脱离真实接口完整测试 ——
 * 尤其是「一个 JSON 被切成两半」「一条 chunk 里塞了好几个事件」这类
 * 真实网络里一定会出现、但手写很容易漏掉的情况。
 */

interface DeltaShape {
  choices?: Array<{
    delta?: { content?: unknown }
    message?: { content?: unknown }
    text?: unknown
  }>
  error?: { message?: unknown }
}

/** 从一条 data 负载里取出增量文本；取不到返回 null，失败抛 AiError */
export function extractDeltaText(payload: string): string | null {
  let data: unknown
  try {
    data = JSON.parse(payload)
  } catch {
    // 心跳、非 JSON 行：忽略即可，不能因为一行看不懂就整场崩掉
    return null
  }
  if (!data || typeof data !== 'object') return null

  const obj = data as DeltaShape
  if (obj.error) {
    const msg = typeof obj.error.message === 'string' ? obj.error.message : '模型接口返回了错误'
    throw new AiError(`模型接口报错：${msg}`)
  }

  const choice = obj.choices?.[0]
  if (!choice) return null

  for (const candidate of [choice.delta?.content, choice.message?.content, choice.text]) {
    if (typeof candidate === 'string' && candidate.length > 0) return candidate
  }
  return null
}

export interface SseParser {
  /** 喂进一段（可能被任意切开的）文本，返回这次新增的增量 */
  push(chunk: string): string[]
  /** 流结束时冲刷缓冲区里剩下的半行 */
  end(): string[]
  readonly done: boolean
}

export function createSseParser(): SseParser {
  let buffer = ''
  let done = false

  const consumeLine = (line: string): string | null => {
    const trimmed = line.endsWith('\r') ? line.slice(0, -1) : line
    // 空行是事件分隔符；以 : 开头的是注释（部分网关用来做心跳）
    if (trimmed.length === 0 || trimmed.startsWith(':')) return null
    if (!trimmed.startsWith('data:')) return null

    const payload = trimmed.slice(5).replace(/^ /, '').trim()
    if (payload.length === 0) return null
    if (payload === '[DONE]') {
      done = true
      return null
    }
    return extractDeltaText(payload)
  }

  return {
    push(chunk: string): string[] {
      buffer += chunk
      const out: string[] = []
      let idx = buffer.indexOf('\n')
      while (!done && idx !== -1) {
        const line = buffer.slice(0, idx)
        buffer = buffer.slice(idx + 1)
        const text = consumeLine(line)
        if (text) out.push(text)
        idx = buffer.indexOf('\n')
      }
      return out
    },

    end(): string[] {
      const out: string[] = []
      if (!done && buffer.length > 0) {
        const text = consumeLine(buffer)
        buffer = ''
        if (text) out.push(text)
      }
      return out
    },

    get done(): boolean {
      return done
    },
  }
}

/**
 * 非流式响应：从完整 body 里取出正文。
 * 有些网关即使 `stream: true` 也会把整段一次性返回，所以这里两种都认。
 */
export function extractMessageText(raw: string): string | null {
  const trimmed = raw.trim()
  if (!trimmed) return null

  // 整段都是 SSE 的情况
  if (trimmed.startsWith('data:') || trimmed.includes('\ndata:')) {
    const parser = createSseParser()
    const all = [...parser.push(`${trimmed}\n`), ...parser.end()]
    return all.length > 0 ? all.join('') : null
  }

  let data: unknown
  try {
    data = JSON.parse(trimmed)
  } catch {
    return null
  }
  if (!data || typeof data !== 'object') return null

  const obj = data as DeltaShape
  if (obj.error) {
    const msg = typeof obj.error.message === 'string' ? obj.error.message : '模型接口返回了错误'
    throw new AiError(`模型接口报错：${msg}`)
  }

  const choice = obj.choices?.[0]
  if (!choice) return null
  for (const candidate of [choice.message?.content, choice.delta?.content, choice.text]) {
    if (typeof candidate === 'string' && candidate.length > 0) return candidate
  }
  return null
}
