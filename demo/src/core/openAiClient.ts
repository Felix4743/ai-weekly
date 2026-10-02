import type { AppConfig } from './types'
import { AiError } from './aiError'
import type { ChatMessagePayload, ChatTransport } from './chatTransport'
import type { AiClient, DeltaHandler } from './aiClient'
import { buildReviewPrompt, buildReviewSystem } from './prompts'
import { parseReviewSafe } from './review'

/**
 * 真模型那一侧的实现：把提示词发给 OpenAI 兼容的 `/chat/completions`。
 *
 * 只做三件事：校验配置、发请求、把回包解析成复盘。
 * 解析失败**不抛**给界面 —— 它会退回一份「这次没能整理成功」的复盘，
 * 用户看得见发生了什么，也能点「重新复盘」；真正该让人看见的失败只有
 * 网络与配置那几类（那是 AiError，界面会弹出人话）。
 */

export interface OpenAiOptions {
  transport: ChatTransport
  config: AppConfig
}

export function createOpenAiClient({ transport, config }: OpenAiOptions): AiClient {
  const send = (messages: ChatMessagePayload[], onDelta?: DeltaHandler): Promise<string> => {
    const apiKey = config.apiKey.trim()
    if (!apiKey) throw new AiError('还没有填 API Key')
    const baseUrl = config.baseUrl.trim()
    if (!baseUrl) throw new AiError('还没有填接口地址')
    const model = config.model.trim()
    if (!model) throw new AiError('还没有填模型名')

    // 要的是严格 JSON，别让它自由发挥
    return transport.send({ baseUrl, apiKey, model, messages, json: true }, onDelta)
  }

  return {
    async analyze(req, onDelta) {
      const raw = await send(
        [
          { role: 'system', content: buildReviewSystem() },
          { role: 'user', content: buildReviewPrompt(req) },
        ],
        onDelta,
      )
      const parsed = parseReviewSafe(raw)
      return { review: parsed.review, reply: parsed.reply }
    },
  }
}
