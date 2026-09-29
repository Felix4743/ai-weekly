import type { AiClient } from './aiClient'
import type { ChatTransport } from './chatTransport'
import { createMockAi } from './mockAi'
import { createOpenAiClient } from './openAiClient'
import type { AppConfig } from './types'

/** 当前用的是真模型还是演示用的假 AI */
export type AiMode = 'live' | 'demo'

export interface SelectedAi {
  client: AiClient
  mode: AiMode
}

/**
 * 按配置挑一个 AiClient。
 *
 * 填了 API Key 就走真实模型；没填就用假 AI —— 这样第一次打开的人
 * 什么都不用配也能把整个流程走一遍，填了 Key 立刻切到真模型。
 */
export function createAiClient(config: AppConfig, transport: ChatTransport): SelectedAi {
  if (!config.apiKey.trim()) {
    return { client: createMockAi(), mode: 'demo' }
  }
  return { client: createOpenAiClient({ transport, config }), mode: 'live' }
}
