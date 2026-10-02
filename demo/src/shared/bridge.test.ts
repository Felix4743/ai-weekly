import { afterEach, describe, expect, it } from 'vitest'
import { getBridge } from './bridge'
import type { AiWeeklyBridge } from './ipc'

/**
 * 「装在哪个壳里」这件事只由这一处判断决定：
 * 有桥就是 Electron（走主进程，配置与归档都归它管），没桥就是浏览器。
 * 判错了，界面要么发不出请求、要么存不下这一周的复盘，所以单独测。
 */

interface GlobalWithBridge {
  aiWeekly?: unknown
}

function setBridge(value: unknown): void {
  ;(globalThis as GlobalWithBridge).aiWeekly = value
}

function fullBridge(): AiWeeklyBridge {
  return {
    llm: { send: async () => ({ ok: true, text: 'hi' }), abort: () => {} },
    store: {
      loadConfig: () => null,
      saveConfig: () => {},
      loadArchive: () => null,
      saveArchive: () => {},
    },
  }
}

afterEach(() => {
  delete (globalThis as GlobalWithBridge).aiWeekly
})

describe('运行环境探测 · 预加载的桥在不在', () => {
  it('浏览器里没有桥，就自己发请求、自己存', () => {
    expect(getBridge()).toBeNull()
  })

  it('Electron 里桥是完整的，就用它', () => {
    const bridge = fullBridge()
    setBridge(bridge)
    expect(getBridge()).toBe(bridge)
  })

  it('半截的桥当成没有 —— 免得到用的时候才炸', () => {
    setBridge({ llm: fullBridge().llm })
    expect(getBridge()).toBeNull()
    setBridge({ store: fullBridge().store })
    expect(getBridge()).toBeNull()
  })

  it('send 不是函数也算没有', () => {
    const bridge = fullBridge()
    setBridge({ ...bridge, llm: { ...bridge.llm, send: 'nope' } })
    expect(getBridge()).toBeNull()
  })
})
