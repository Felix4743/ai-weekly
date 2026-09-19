/**
 * 传输层：整个项目里**唯一**与网络打交道的地方。
 *
 * 为什么单独抽出来：主进程发请求是最终的形态，但 M2/M3 还在浏览器里跑。
 * 上层（core/ 的业务逻辑）只依赖这个接口，等 M4 换 Electron 时，
 * 把实现从「浏览器 fetch」换成「主进程 IPC」，上面的代码一行都不用动。
 */

/** 一条发给模型的消息（OpenAI 兼容格式） */
export interface ChatMessagePayload {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export interface ChatRequest {
  /** 接口地址，形如 https://api.deepseek.com/v1 */
  baseUrl: string
  apiKey: string
  model: string
  messages: ChatMessagePayload[]
  /** 要求模型返回 JSON 对象（用于生成与重新整理） */
  json?: boolean
  signal?: AbortSignal
}

export interface ChatTransport {
  /**
   * 发送一次对话补全请求。
   * onDelta 收到的是**增量**文本（可能被调用很多次）；返回值为拼好的完整文本。
   * 失败时抛 AiError。
   */
  send(req: ChatRequest, onDelta?: (delta: string) => void): Promise<string>
}
