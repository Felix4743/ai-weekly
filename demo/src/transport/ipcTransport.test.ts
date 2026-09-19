import { describe, expect, it } from 'vitest'
import type { ChatRequest } from '../core/chatTransport'
import { createTransport } from './index'
import { createIpcTransport } from './ipcTransport'
import type { AiWeeklyBridge, LlmSendPayload } from '../shared/ipc'

/**
 * Electron 那条路：渲染进程不碰网络，请求交给主进程，增量由主进程推回来。
 * 这里用一座假的桥，既能断言「到底发了什么出去」，也能模拟流式与失败。
 */

const BASE_REQ: ChatRequest = {
  baseUrl: 'https://api.example.com/v1/',
  apiKey: 'sk-test',
  model: 'test-model',
  messages: [{ role: 'user', content: 'hi' }],
}

interface FakeBridgeState {
  sent: LlmSendPayload[]
  aborted: string[]
}

function fakeBridge(
  reply: (payload: LlmSendPayload, onDelta: (d: string) => void) => Promise<unknown>,
): { bridge: AiWeeklyBridge; state: FakeBridgeState } {
  const state: FakeBridgeState = { sent: [], aborted: [] }
  return {
    state,
    bridge: {
      llm: {
        send: (payload, onDelta) => {
          state.sent.push(payload)
          return reply(payload, onDelta) as ReturnType<AiWeeklyBridge['llm']['send']>
        },
        abort: (requestId) => state.aborted.push(requestId),
      },
      store: {
        loadConfig: () => null,
        saveConfig: () => {},
        loadSession: () => null,
        saveSession: () => {},
        clearSession: () => {},
      },
    },
  }
}

describe('传输层 · 主进程那条路', () => {
  it('把请求原样交给主进程，并把末尾斜杠吃掉', async () => {
    const { bridge, state } = fakeBridge(async () => ({ ok: true, text: '好' }))
    await createIpcTransport(bridge).send(BASE_REQ)

    expect(state.sent).toHaveLength(1)
    expect(state.sent[0]).toMatchObject({
      baseUrl: 'https://api.example.com/v1',
      apiKey: 'sk-test',
      model: 'test-model',
    })
    // 请求标识由渲染端生成，主进程靠它把增量对回来
    expect(state.sent[0].requestId).toBeTruthy()
  })

  it('主进程推回来的增量照旧一段段给到界面', async () => {
    const { bridge } = fakeBridge(async (_payload, onDelta) => {
      onDelta('周末')
      onDelta('好呀')
      return { ok: true, text: '周末好呀' }
    })

    const pieces: string[] = []
    const out = await createIpcTransport(bridge).send(BASE_REQ, (d) => pieces.push(d))

    expect(out).toBe('周末好呀')
    expect(pieces).toEqual(['周末', '好呀'])
  })

  it('两次请求的标识不一样，增量不会串台', async () => {
    const { bridge, state } = fakeBridge(async () => ({ ok: true, text: '好' }))
    const transport = createIpcTransport(bridge)
    await transport.send(BASE_REQ)
    await transport.send(BASE_REQ)
    expect(state.sent[0].requestId).not.toBe(state.sent[1].requestId)
  })

  it('失败信封被还原成 AiError，那句人话原样保留', async () => {
    const { bridge } = fakeBridge(async () => ({
      ok: false,
      message: 'API Key 不对，或者这个 Key 没有访问该模型的权限',
      detail: 'HTTP 401',
    }))

    await expect(createIpcTransport(bridge).send(BASE_REQ)).rejects.toThrow('API Key')
  })

  it('外部取消时把取消转达给主进程', async () => {
    const { bridge, state } = fakeBridge(
      (payload) =>
        new Promise((resolve) => {
          payload.requestId // 保持引用，模拟请求还在飞
          resolve({ ok: true, text: '好' })
        }),
    )

    const controller = new AbortController()
    const running = createIpcTransport(bridge).send({ ...BASE_REQ, signal: controller.signal })
    controller.abort()
    await running

    expect(state.aborted).toEqual([state.sent[0].requestId])
  })
})

describe('传输层 · 按环境挑实现', () => {
  it('有桥（Electron）时走主进程，不碰 fetch', async () => {
    const { bridge, state } = fakeBridge(async () => ({ ok: true, text: '来自主进程' }))
    const original = (globalThis as { aiWeekly?: unknown }).aiWeekly
    ;(globalThis as { aiWeekly?: unknown }).aiWeekly = bridge
    try {
      expect(await createTransport().send(BASE_REQ)).toBe('来自主进程')
      expect(state.sent).toHaveLength(1)
    } finally {
      ;(globalThis as { aiWeekly?: unknown }).aiWeekly = original
    }
  })

  it('没有桥（浏览器）时用 fetch 那份实现', async () => {
    delete (globalThis as { aiWeekly?: unknown }).aiWeekly
    const transport = createTransport()
    // 浏览器实现会真去打接口，这里只确认挑到的是它：没有桥时不该抛别的错
    await expect(transport.send({ ...BASE_REQ, baseUrl: 'http://127.0.0.1:1/v1' })).rejects.toThrow()
  })
})
