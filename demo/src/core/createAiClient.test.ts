import { describe, expect, it } from 'vitest'
import type { ReviewRequest } from './aiClient'
import type { ChatRequest, ChatTransport } from './chatTransport'
import { createAiClient } from './createAiClient'
import { createDefaultConfig } from './types'

/**
 * 「谁来干这活」的选择测试。
 *
 * 规则只有一条：填了 Key 就找真模型，没填就用演示的那套假读法。
 * 这条规则决定了第一次打开应用的人看到什么，所以单独钉一钉。
 */

function req(notes = '这周主要在改客户方案。\n下周把报价单发出去。'): ReviewRequest {
  return {
    week: '2026-09-21',
    weekText: '9月21日 – 9月27日',
    notes,
    previous: null,
    isFollowUp: false,
  }
}

/** 假 transport：只记请求，永远回一份够用的 JSON */
function fakeTransport() {
  const calls: ChatRequest[] = []
  const transport: ChatTransport = {
    send: async (request) => {
      calls.push(request)
      return JSON.stringify({ headline: '真模型的复盘。', did: ['改客户方案'] })
    },
  }
  return { calls, transport }
}

describe('挑一个 AI 客户端', () => {
  it('没填 Key 时用演示模式，不说话也能给出一份复盘', async () => {
    const fake = fakeTransport()
    const { client, mode } = createAiClient(createDefaultConfig(), fake.transport)

    expect(mode).toBe('demo')

    const { review } = await client.analyze(req())
    expect(review.headline.length).toBeGreaterThan(0)
    expect(review.did.length).toBeGreaterThan(0)
    // 演示模式就该在本地算完，一次网络请求都不该发
    expect(fake.calls).toHaveLength(0)
  })

  it('只填了空格也算没填，照样是演示模式', () => {
    const fake = fakeTransport()
    const { mode } = createAiClient({ ...createDefaultConfig(), apiKey: '   ' }, fake.transport)
    expect(mode).toBe('demo')
  })

  it('填了 Key 就走真模型，并把它当成 live 模式', async () => {
    const fake = fakeTransport()
    const { client, mode } = createAiClient(
      { apiKey: 'sk-test', baseUrl: 'https://example.test/v1', model: 'test-model' },
      fake.transport,
    )

    expect(mode).toBe('live')

    const { review } = await client.analyze(req())
    expect(review.headline).toBe('真模型的复盘。')
    expect(fake.calls).toHaveLength(1)
  })

  it('走真模型时，配置里的地址与模型名真的传给了 transport', async () => {
    const fake = fakeTransport()
    const config = {
      apiKey: 'sk-live',
      baseUrl: 'https://api.deepseek.com/v1',
      model: 'deepseek-chat',
    }
    const { client } = createAiClient(config, fake.transport)

    await client.analyze(req())

    expect(fake.calls[0].baseUrl).toBe(config.baseUrl)
    expect(fake.calls[0].model).toBe(config.model)
    expect(fake.calls[0].apiKey).toBe(config.apiKey)
  })
})
