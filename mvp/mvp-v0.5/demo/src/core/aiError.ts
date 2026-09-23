/**
 * AI 调用失败时，统一翻译成「用户看得懂的一句话」。
 * 这一层刻意与网络实现无关，方便单测。
 */

export class AiError extends Error {
  /** 原始细节，用于展开排查，不直接糊到界面上 */
  readonly detail: string

  constructor(message: string, detail = '') {
    super(message)
    this.name = 'AiError'
    this.detail = detail
  }
}

interface ApiErrorBody {
  error?: { message?: unknown; type?: unknown }
  message?: unknown
}

/** 从接口返回的 body 里挖出上游给的错误说明 */
export function extractApiMessage(body: string): string {
  const raw = body.trim()
  if (!raw) return ''
  try {
    const data = JSON.parse(raw) as ApiErrorBody
    const fromError = data?.error?.message
    if (typeof fromError === 'string' && fromError.trim()) return fromError.trim()
    const fromMessage = data?.message
    if (typeof fromMessage === 'string' && fromMessage.trim()) return fromMessage.trim()
  } catch {
    /* 不是 JSON 就退回原文 */
  }
  return raw.length > 200 ? `${raw.slice(0, 200)}…` : raw
}

/**
 * HTTP 状态码 → 一句人话。
 * 401/404/429 是配置类错误里最常见的三种，单独给出可操作的提示。
 */
export function describeFailure(status: number, body: string): string {
  const detail = extractApiMessage(body)
  switch (status) {
    case 401:
    case 403:
      return 'API Key 不对，或者这个 Key 没有访问该模型的权限'
    case 404:
      return '接口地址或模型名不对（404）'
    case 429:
      return '请求太频繁或额度用完了（429），等一会儿再试'
    default:
      if (status >= 500) return `模型服务暂时不可用（${status}），稍后再试`
      return detail ? `请求失败（${status}）：${detail}` : `请求失败（${status}）`
  }
}

/** 把任意异常收敛成一句可展示的话 */
export function describeError(err: unknown): string {
  if (err instanceof AiError) return err.message
  if (err instanceof Error && err.message) return err.message
  return '出了点意外，请再试一次'
}
