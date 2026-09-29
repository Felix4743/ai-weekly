import { describe, expect, it } from 'vitest'
import { AiError } from '../core/aiError'
import type { ChatRequest } from '../core/chatTransport'
import { fakeResponse, sseEvent } from '../shared/testSupport'
import { forwardChat } from './llmForward'

/**
 * 主进程里发请求的这一段。
 * 与浏览器那份的差别只有一个：直连接口地址，不经过 dev 代理。
 */

const BASE_REQ: ChatRequest = {
  baseUrl: 'https://api.example.com/v1',
  apiKey: 'sk-test',
  model: 'test-model',
  messages: [{ role: 'user', content: 'hi' }],
}

describe('主进程转发 · 请求内容', () => {
  it('直连接口地址，不吃 dev 代理，也不带 x-llm-base', async () => {
    const calls: Array<{ url: string; init: RequestInit }> = []
    const fakeFetch = (async (url: string, init: RequestInit) => {
      calls.push({ url, init })
      return fakeResponse(sseEvent('好'), 'text/event-stream')
    }) as unknown as typeof fetch

    await forwardChat(BASE_REQ, () => {}, { fetchImpl: fakeFetch })

    expect(calls).toHaveLength(1)
    // 主进程不受同源策略约束，所以直接打真实地址
    expect(calls[0].url).toBe('https://api.example.com/v1/chat/completions')

    const headers = calls[0].init.headers as Record<string, string>
    expect(headers.Authorization).toBe('Bearer sk-test')
    expect(headers['x-llm-base']).toBeUndefined()

    const body = JSON.parse(String(calls[0].init.body)) as Record<string, unknown>
    expect(body).toMatchObject({ model: 'test-model', stream: true })
  })

  it('吃掉地址末尾多余的斜杠', async () => {
    const urls: string[] = []
    const fakeFetch = (async (url: string) => {
      urls.push(url)
      return fakeResponse(sseEvent('好'), 'text/event-stream')
    }) as unknown as typeof fetch

    await forwardChat({ ...BASE_REQ, baseUrl: 'https://api.example.com/v1///' }, () => {}, {
      fetchImpl: fakeFetch,
    })
    expect(urls[0]).toBe('https://api.example.com/v1/chat/completions')
  })

  it('要 JSON 时带上 response_format', async () => {
    const bodies: string[] = []
    const fakeFetch = (async (_url: string, init: RequestInit) => {
      bodies.push(String(init.body))
      return fakeResponse(sseEvent('好'), 'text/event-stream')
    }) as unknown as typeof fetch

    await forwardChat({ ...BASE_REQ, json: true }, () => {}, { fetchImpl: fakeFetch })
    expect(JSON.parse(bodies[0]).response_format).toEqual({ type: 'json_object' })
  })
})

describe('主进程转发 · 流式与失败', () => {
  it('边收边把增量交出去，拼起来是完整文本', async () => {
    const wire = sseEvent('周末') + sseEvent('好呀') + 'data: [DONE]\n\n'
    const fakeFetch = (async () =>
      fakeResponse(wire, 'text/event-stream', 7)) as unknown as typeof fetch

    const pieces: string[] = []
    const out = await forwardChat(BASE_REQ, (d) => pieces.push(d), { fetchImpl: fakeFetch })

    expect(out).toBe('周末好呀')
    expect(pieces).toEqual(['周末', '好呀'])
  })

  it('一个汉字被切在两个数据包里也不会变成乱码', async () => {
    const wire = sseEvent('好') + 'data: [DONE]\n\n'
    const fakeFetch = (async () =>
      fakeResponse(wire, 'text/event-stream', 1)) as unknown as typeof fetch
    expect(await forwardChat(BASE_REQ, () => {}, { fetchImpl: fakeFetch })).toBe('好')
  })

  it('401 被翻译成用户看得懂的一句话', async () => {
    const fakeFetch = (async () =>
      fakeResponse('{"error":{"message":"Invalid API key"}}', 'application/json', 4096, 401)) as unknown as typeof fetch
    await expect(forwardChat(BASE_REQ, () => {}, { fetchImpl: fakeFetch })).rejects.toThrow('API Key')
  })

  it('连不上时给出可操作的提示，而不是原始 TypeError', async () => {
    const fakeFetch = (async () => {
      throw new TypeError('fetch failed')
    }) as unknown as typeof fetch
    await expect(forwardChat(BASE_REQ, () => {}, { fetchImpl: fakeFetch })).rejects.toThrow(
      '连不上接口地址',
    )
  })

  it('一个字都没返回时报错，而不是静悄悄给个空串', async () => {
    const fakeFetch = (async () =>
      fakeResponse('data: [DONE]\n\n', 'text/event-stream')) as unknown as typeof fetch
    await expect(forwardChat(BASE_REQ, () => {}, { fetchImpl: fakeFetch })).rejects.toThrow(
      '没有返回任何内容',
    )
  })

  it('外部取消时抛出「已取消」', async () => {
    const controller = new AbortController()
    const fakeFetch = (async (_url: string, _init: RequestInit) => {
      controller.abort()
      // 上游因取消而抛 AbortError，这里照实模拟
      const err = new Error('aborted')
      err.name = 'AbortError'
      throw err
    }) as unknown as typeof fetch

    await expect(
      forwardChat({ ...BASE_REQ, signal: controller.signal }, () => {}, { fetchImpl: fakeFetch }),
    ).rejects.toBeInstanceOf(AiError)
  })
})
