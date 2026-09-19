import { describe, expect, it } from 'vitest'
import { AiError } from '../core/aiError'
import type { ChatRequest } from '../core/chatTransport'
import type { LlmDeltaPayload, LlmSendPayload } from '../shared/ipc'
import { createLlmService } from './llmService'

/**
 * 主进程侧的请求记账：增量往哪发、取消落到哪、失败怎么变成一句人话。
 * 这里一个 Electron API 都不用 —— 注入一个「往外发」的函数就能完整测。
 */

function payload(requestId = 'r1'): LlmSendPayload {
  return {
    requestId,
    baseUrl: 'https://api.example.com/v1',
    apiKey: 'sk-test',
    model: 'm',
    messages: [{ role: 'user', content: 'hi' }],
  }
}

function collector(): { sent: LlmDeltaPayload[]; emit: (c: string, p: LlmDeltaPayload) => void } {
  const sent: LlmDeltaPayload[] = []
  return { sent, emit: (_c, p) => sent.push(p) }
}

describe('主进程请求记账 · 正常一轮', () => {
  it('增量带上请求标识推回渲染进程，并返回完整文本', async () => {
    const { sent, emit } = collector()
    const forward = (async (_req: ChatRequest, onDelta: (d: string) => void) => {
      onDelta('周')
      onDelta('末')
      return '周末'
    }) as unknown as typeof import('./llmForward').forwardChat

    const service = createLlmService({ emit, forward })
    const result = await service.handle(payload())

    expect(result).toEqual({ ok: true, text: '周末' })
    expect(sent).toEqual([
      { requestId: 'r1', delta: '周' },
      { requestId: 'r1', delta: '末' },
    ])
  })

  it('把配置与取消信号一起交给上游', async () => {
    const seen: ChatRequest[] = []
    const forward = (async (req: ChatRequest) => {
      seen.push(req)
      return 'ok'
    }) as unknown as typeof import('./llmForward').forwardChat

    const service = createLlmService({ emit: () => {}, forward })
    await service.handle(payload())

    expect(seen[0]).toMatchObject({
      baseUrl: 'https://api.example.com/v1',
      apiKey: 'sk-test',
      model: 'm',
    })
    expect(seen[0].signal).toBeInstanceOf(AbortSignal)
  })

  it('一轮结束后不留下进行中的请求', async () => {
    const forward = (async () => 'ok') as unknown as typeof import('./llmForward').forwardChat
    const service = createLlmService({ emit: () => {}, forward })

    await service.handle(payload())
    expect(service.inFlightCount()).toBe(0)
  })
})

describe('主进程请求记账 · 失败与取消', () => {
  it('失败变成信封，用户看到的是那句人话，原始细节另放', async () => {
    const forward = (async () => {
      throw new AiError('API Key 不对，或者这个 Key 没有访问该模型的权限', 'HTTP 401')
    }) as unknown as typeof import('./llmForward').forwardChat

    const service = createLlmService({ emit: () => {}, forward })
    const result = await service.handle(payload())

    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('不该走到这里')
    expect(result.message).toContain('API Key')
    expect(result.detail).toBe('HTTP 401')
    expect(service.inFlightCount()).toBe(0)
  })

  it('取消会把信号交给上游，并把这次请求记成「已取消」', async () => {
    let seen: AbortSignal | undefined
    const forward = ((req: ChatRequest, onDelta: (d: string) => void) => {
      seen = req.signal
      onDelta('半句')
      return new Promise<string>((_resolve, reject) => {
        req.signal?.addEventListener('abort', () => reject(new AiError('已取消')))
      })
    }) as unknown as typeof import('./llmForward').forwardChat

    const { sent, emit } = collector()
    const service = createLlmService({ emit, forward })

    const running = service.handle(payload())
    expect(service.inFlightCount()).toBe(1)

    service.abort('r1')
    expect(seen?.aborted).toBe(true)

    const result = await running
    expect(result).toMatchObject({ ok: false, message: '已取消' })
    expect(service.inFlightCount()).toBe(0)
    // 取消前已经吐出来的那半句照旧送达，界面不会卡在中间态
    expect(sent).toEqual([{ requestId: 'r1', delta: '半句' }])
  })

  it('取消一个不存在的请求不会炸', () => {
    const service = createLlmService({ emit: () => {}, forward: (async () => 'ok') as never })
    expect(() => service.abort('没有这个')).not.toThrow()
  })

  it('同一个请求标识重复进来时拒绝，避免增量串台', async () => {
    let release: (text: string) => void = () => {}
    const forward = (() =>
      new Promise<string>((resolve) => {
        release = resolve
      })) as unknown as typeof import('./llmForward').forwardChat

    const service = createLlmService({ emit: () => {}, forward })
    const first = service.handle(payload('same'))
    const second = await service.handle(payload('same'))

    expect(second).toMatchObject({ ok: false })
    release('done')
    await expect(first).resolves.toEqual({ ok: true, text: 'done' })
  })
})
