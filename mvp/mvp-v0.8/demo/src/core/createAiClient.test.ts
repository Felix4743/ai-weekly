import { describe, expect, it } from 'vitest'
import type { ChatRequest, ChatTransport } from './chatTransport'
import { createAiClient } from './createAiClient'
import { createInterview, openBlock } from './interview'
import { createDefaultConfig, type AppConfig } from './types'

/** 只记录「有没有被调用」的传输层 */
function spyTransport() {
  const seen: ChatRequest[] = []
  const transport: ChatTransport = {
    async send(req) {
      seen.push(req)
      return '{}'
    },
  }
  return { transport, seen }
}

const LIVE: AppConfig = { ...createDefaultConfig(), apiKey: 'sk-1' }

describe('按配置挑选 AI 实现', () => {
  it('没填 Key 时用假 AI，一个请求都不发', async () => {
    const { transport, seen } = spyTransport()
    const { client, mode } = createAiClient({ ...createDefaultConfig(), apiKey: '' }, transport)
    expect(mode).toBe('demo')
    await client.nextMessage(openBlock(createInterview(), 'event'), 'event', [])
    expect(seen).toHaveLength(0)
  })

  it('只有空白的 Key 也算演示模式', () => {
    const { transport } = spyTransport()
    expect(createAiClient({ ...createDefaultConfig(), apiKey: '   ' }, transport).mode).toBe('demo')
  })

  it('填了 Key 就走真实模型，请求真的发出去', async () => {
    const { transport, seen } = spyTransport()
    const { client, mode } = createAiClient(LIVE, transport)
    expect(mode).toBe('live')
    await client.reply(openBlock(createInterview(), 'event'), 'event', [])
    expect(seen).toHaveLength(1)
    expect(seen[0].apiKey).toBe('sk-1')
  })
})
