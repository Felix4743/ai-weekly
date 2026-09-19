import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createDefaultConfig, type AppConfig } from '../core/types'
import type { AiWeeklyBridge } from '../shared/ipc'
import { selectStore } from './index'
import { createIpcStore } from './ipcStore'
import { createLocalStore } from './localStore'
import { normalizeConfig, normalizeSession, type SavedSession } from './shape'

/**
 * 存储这一层要回答两个问题：
 * 1. 从文件 / localStorage 里读出来的东西坏了怎么办（一律当没有，不许崩）
 * 2. 装在哪个壳里就用哪条通路（有桥走主进程 JSON 文件，没桥走 localStorage）
 */

const GOOD_CONFIG: AppConfig = {
  apiKey: 'sk-1',
  baseUrl: 'https://api.deepseek.com/v1',
  model: 'deepseek-chat',
}

const GOOD_SESSION: SavedSession = {
  messages: [{ id: 'm1', role: 'user', text: '这周很忙', dimension: 'event', at: 1 }],
  result: {
    events: ['改了三版方案'],
    people: [],
    things: [],
    pending: [],
    highlights: ['方案定了'],
    nextFocus: ['把报价发出去'],
    nextFollowUps: [],
  },
  savedAt: 123,
}

describe('存储 · 形状归一化', () => {
  it('配置缺字段时补默认值而不是整块丢掉', () => {
    expect(normalizeConfig({ apiKey: 'sk-2' })).toEqual({
      apiKey: 'sk-2',
      baseUrl: createDefaultConfig().baseUrl,
      model: createDefaultConfig().model,
    })
  })

  it('整块不是对象时当没配过', () => {
    expect(normalizeConfig(null)).toBeNull()
    expect(normalizeConfig('sk-2')).toBeNull()
    expect(normalizeConfig(42)).toBeNull()
  })

  it('会话至少要有消息数组和结果，否则当没有', () => {
    expect(normalizeSession({ messages: [], result: {} })).toMatchObject({ messages: [] })
    expect(normalizeSession({ result: {} })).toBeNull()
    expect(normalizeSession({ messages: [] })).toBeNull()
    expect(normalizeSession(null)).toBeNull()
  })

  it('缺少时间戳时补一个，界面上不会显示成 1970 年', () => {
    const session = normalizeSession({ messages: [], result: {} })
    expect(typeof session?.savedAt).toBe('number')
    expect(session?.savedAt).toBeGreaterThan(0)
  })
})

describe('存储 · 主进程那条路（IPC）', () => {
  function bridgeWith(overrides: Partial<AiWeeklyBridge['store']> = {}): {
    bridge: AiWeeklyBridge
    written: unknown[]
  } {
    const written: unknown[] = []
    const store: AiWeeklyBridge['store'] = {
      loadConfig: () => GOOD_CONFIG,
      saveConfig: (c) => written.push(c),
      loadSession: () => GOOD_SESSION,
      saveSession: (s) => written.push(s),
      clearSession: () => written.push('cleared'),
      ...overrides,
    }
    return {
      written,
      bridge: { llm: { send: async () => ({ ok: true, text: '' }), abort: () => {} }, store },
    }
  }

  it('读出来的配置与会话经过同一套归一化', () => {
    const store = createIpcStore(bridgeWith().bridge)
    expect(store.loadConfig()).toEqual(GOOD_CONFIG)
    expect(store.loadSession()).toMatchObject({ savedAt: 123 })
  })

  it('写就原样交给主进程落盘', () => {
    const { bridge, written } = bridgeWith()
    const store = createIpcStore(bridge)
    store.saveConfig(GOOD_CONFIG)
    store.saveSession(GOOD_SESSION)
    store.clearSession()
    expect(written).toEqual([GOOD_CONFIG, GOOD_SESSION, 'cleared'])
  })

  it('文件坏了（读回来不是对象）时当没有，不往外抛', () => {
    const store = createIpcStore(bridgeWith({ loadConfig: () => '{半截', loadSession: () => 7 }).bridge)
    expect(store.loadConfig()).toBeNull()
    expect(store.loadSession()).toBeNull()
  })

  it('主进程那边直接抛异常时也不拖垮界面', () => {
    const boom = (): never => {
      throw new Error('IPC 断了')
    }
    const store = createIpcStore(
      bridgeWith({ loadConfig: boom, loadSession: boom, saveConfig: boom, clearSession: boom }).bridge,
    )
    expect(store.loadConfig()).toBeNull()
    expect(store.loadSession()).toBeNull()
    expect(() => store.saveConfig(GOOD_CONFIG)).not.toThrow()
    expect(() => store.clearSession()).not.toThrow()
  })
})

describe('存储 · 浏览器那条路（localStorage）', () => {
  const memory = new Map<string, string>()

  beforeEach(() => {
    memory.clear()
    ;(globalThis as { localStorage?: unknown }).localStorage = {
      getItem: (k: string) => memory.get(k) ?? null,
      setItem: (k: string, v: string) => void memory.set(k, v),
      removeItem: (k: string) => void memory.delete(k),
    }
  })

  afterEach(() => {
    delete (globalThis as { localStorage?: unknown }).localStorage
  })

  it('写进去再读出来是同一份', () => {
    const store = createLocalStore()
    store.saveConfig(GOOD_CONFIG)
    store.saveSession(GOOD_SESSION)
    expect(store.loadConfig()).toEqual(GOOD_CONFIG)
    expect(store.loadSession()).toMatchObject({ savedAt: 123 })
  })

  it('内容坏掉时当没有', () => {
    memory.set('ai-weekly:config', '{{{')
    memory.set('ai-weekly:last-session', 'null')
    const store = createLocalStore()
    expect(store.loadConfig()).toBeNull()
    expect(store.loadSession()).toBeNull()
  })

  it('没有 localStorage（比如被禁用）时静默降级', () => {
    delete (globalThis as { localStorage?: unknown }).localStorage
    const store = createLocalStore()
    expect(store.loadConfig()).toBeNull()
    expect(store.loadSession()).toBeNull()
    expect(() => store.saveConfig(GOOD_CONFIG)).not.toThrow()
    expect(() => store.clearSession()).not.toThrow()
  })
})

describe('存储 · 按环境挑通路', () => {
  afterEach(() => {
    delete (globalThis as { aiWeekly?: unknown }).aiWeekly
  })

  it('没有桥时是 localStorage 那份', () => {
    const store = selectStore()
    expect(store).toEqual(createLocalStore())
  })

  it('有桥时读的是主进程的文件', () => {
    ;(globalThis as { aiWeekly?: unknown }).aiWeekly = {
      llm: { send: async () => ({ ok: true, text: '' }), abort: () => {} },
      store: {
        loadConfig: () => ({ ...GOOD_CONFIG, apiKey: 'sk-from-file' }),
        saveConfig: () => {},
        loadSession: () => null,
        saveSession: () => {},
        clearSession: () => {},
      },
    } satisfies AiWeeklyBridge

    expect(selectStore().loadConfig()).toMatchObject({ apiKey: 'sk-from-file' })
  })
})
