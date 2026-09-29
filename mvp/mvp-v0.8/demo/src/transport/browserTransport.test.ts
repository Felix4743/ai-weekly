import { describe, expect, it } from 'vitest'
import { createBrowserTransport, resolveChatUrl } from './browserTransport'
import type { ChatRequest } from '../core/chatTransport'
import { fakeResponse, sseEvent } from '../shared/testSupport'

const BASE_REQ: ChatRequest = {
  baseUrl: 'https://api.example.com/v1',
  apiKey: 'sk-test',
  model: 'test-model',
  messages: [{ role: 'user', content: 'hi' }],
}

/**
 * 手写一个最小的 Response 替身（在 shared/testSupport.ts，与主进程那份共用），
 * 好处是能精确控制「数据包怎么切」—— 真实网络里一个汉字被切在两个 chunk
 * 中间是必然会发生的。
 */
function transportOf(fetchImpl: typeof fetch) {
  return createBrowserTransport({ dev: false, fetchImpl, timeoutMs: 2000 })
}

const evt = sseEvent

describe('传输层 · 地址拼装', () => {
  it('开发期统一走 dev 代理，绕开跨域', () => {
    expect(resolveChatUrl('https://api.deepseek.com/v1', true)).toBe('/llm-proxy/chat/completions')
    expect(resolveChatUrl('https://api.deepseek.com/v1/', true)).toBe('/llm-proxy/chat/completions')
  })

  it('打包后直连真实地址，并吃掉多余的斜杠', () => {
    expect(resolveChatUrl('https://api.deepseek.com/v1/', false)).toBe(
      'https://api.deepseek.com/v1/chat/completions',
    )
  })
})

describe('传输层 · 请求内容', () => {
  it('带上 Key、模型、流式开关与 JSON 开关', async () => {
    const calls: Array<{ url: string; init: RequestInit }> = []
    const fakeFetch = (async (url: string, init: RequestInit) => {
      calls.push({ url, init })
      return fakeResponse(evt('好') + 'data: [DONE]\n\n', 'text/event-stream', 8)
    }) as unknown as typeof fetch

    await transportOf(fakeFetch).send({ ...BASE_REQ, json: true })

    expect(calls).toHaveLength(1)
    expect(calls[0].url).toBe('https://api.example.com/v1/chat/completions')

    const headers = calls[0].init.headers as Record<string, string>
    expect(headers.Authorization).toBe('Bearer sk-test')
    // dev 代理靠这个头决定转发目标，正式环境用不上
    expect(headers['x-llm-base']).toBe('https://api.example.com/v1')

    const body = JSON.parse(String(calls[0].init.body)) as Record<string, unknown>
    expect(body.model).toBe('test-model')
    expect(body.stream).toBe(true)
    expect(body.response_format).toEqual({ type: 'json_object' })
  })

  it('不要求 JSON 时不带 response_format', async () => {
    const calls: Array<{ init: RequestInit }> = []
    const fakeFetch = (async (_url: string, init: RequestInit) => {
      calls.push({ init })
      return fakeResponse(evt('好'), 'text/event-stream')
    }) as unknown as typeof fetch

    await transportOf(fakeFetch).send(BASE_REQ)
    const body = JSON.parse(String(calls[0].init.body)) as Record<string, unknown>
    expect(body.response_format).toBeUndefined()
  })
})

describe('传输层 · 流式解析', () => {
  it('逐块吐出增量，拼起来是完整文本', async () => {
    const wire = evt('周末') + evt('好呀') + 'data: [DONE]\n\n'
    const fakeFetch = (async () =>
      fakeResponse(wire, 'text/event-stream', 7)) as unknown as typeof fetch

    const pieces: string[] = []
    const out = await transportOf(fakeFetch).send(BASE_REQ, (d) => pieces.push(d))

    expect(out).toBe('周末好呀')
    expect(pieces).toEqual(['周末', '好呀'])
  })

  it('一个汉字被切在两个数据包里也不会变成乱码', async () => {
    const wire = evt('好') + 'data: [DONE]\n\n'
    // 每次只给 1 个字节，UTF-8 的汉字必然被切开
    const fakeFetch = (async () =>
      fakeResponse(wire, 'text/event-stream', 1)) as unknown as typeof fetch

    expect(await transportOf(fakeFetch).send(BASE_REQ)).toBe('好')
  })

  it('网关忽略 stream 参数、整段返回 JSON 时也能认', async () => {
    const payload = JSON.stringify({ choices: [{ message: { content: '整段给你' } }] })
    const fakeFetch = (async () =>
      fakeResponse(payload, 'application/json')) as unknown as typeof fetch

    expect(await transportOf(fakeFetch).send(BASE_REQ)).toBe('整段给你')
  })
})

describe('传输层 · 失败处理', () => {
  it('401 被翻译成用户看得懂的一句话', async () => {
    const fakeFetch = (async () =>
      fakeResponse(
        '{"error":{"message":"Invalid API key"}}',
        'application/json',
        4096,
        401,
      )) as unknown as typeof fetch

    await expect(transportOf(fakeFetch).send(BASE_REQ)).rejects.toThrow('API Key')
  })

  it('404 提示地址或模型名不对', async () => {
    const fakeFetch = (async () =>
      fakeResponse('{}', 'application/json', 4096, 404)) as unknown as typeof fetch

    await expect(transportOf(fakeFetch).send(BASE_REQ)).rejects.toThrow('接口地址')
  })

  it('连不上时给出可操作的提示，而不是抛原始 TypeError', async () => {
    const fakeFetch = (async () => {
      throw new TypeError('Failed to fetch')
    }) as unknown as typeof fetch

    await expect(transportOf(fakeFetch).send(BASE_REQ)).rejects.toThrow('连不上接口地址')
  })

  it('模型一个字都没返回时报错，而不是静悄悄返回空串', async () => {
    const fakeFetch = (async () =>
      fakeResponse('data: [DONE]\n\n', 'text/event-stream')) as unknown as typeof fetch

    await expect(transportOf(fakeFetch).send(BASE_REQ)).rejects.toThrow('没有返回任何内容')
  })

  it('错误被塞在流里时照旧抛出', async () => {
    const fakeFetch = (async () =>
      fakeResponse(
        'data: {"error":{"message":"额度不足"}}\n\n',
        'text/event-stream',
      )) as unknown as typeof fetch

    await expect(transportOf(fakeFetch).send(BASE_REQ)).rejects.toThrow('额度不足')
  })
})
