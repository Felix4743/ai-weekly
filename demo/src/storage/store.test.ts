import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { WeekEntry } from '../core/archive'
import { coerceResult } from '../core/parseResult'
import { defaultPersonaPrompt, PERSONA_PRESETS } from '../core/persona'
import { createDefaultConfig, createEmptyResult, createEmptyState, type AppConfig } from '../core/types'
import type { AiWeeklyBridge } from '../shared/ipc'
import { selectStore } from './index'
import { createIpcStore } from './ipcStore'
import { createLocalStore } from './localStore'
import {
  normalizeArchive,
  normalizeConfig,
  normalizePersona,
  normalizeSession,
  type SavedSession,
} from './shape'

/**
 * 存储这一层要回答两个问题：
 * 1. 从文件 / localStorage 里读出来的东西坏了怎么办（一律当没有，不许崩）
 * 2. 装在哪个壳里就用哪条通路（有桥走主进程 JSON 文件，没桥走 localStorage）
 */

const GOOD_CONFIG: AppConfig = {
  apiKey: 'sk-1',
  baseUrl: 'https://api.deepseek.com/v1',
  model: 'deepseek-chat',
  persona: { prompt: '', preset: 'warm' },
}

const GOOD_SESSION: SavedSession = {
  messages: [{ id: 'm1', role: 'user', text: '这周很忙', dimension: 'event', at: 1 }],
  result: {
    // 从空结果起手再覆盖：以后再加一栏时，这里不用跟着一条条补
    ...createEmptyResult(),
    events: ['改了三版方案'],
    highlights: ['方案定了'],
    nextFocus: ['把报价发出去'],
  },
  savedAt: 123,
  week: '2026-09-21',
}

const GOOD_ARCHIVE: WeekEntry[] = [
  {
    week: '2026-09-21',
    savedAt: 200,
    result: { ...GOOD_SESSION.result, pending: ['报销拖了两周'] },
  },
  {
    week: '2026-09-14',
    savedAt: 100,
    result: { ...GOOD_SESSION.result, highlights: ['上一周的主线'] },
  },
]

describe('存储 · 形状归一化', () => {
  it('配置缺字段时补默认值而不是整块丢掉', () => {
    expect(normalizeConfig({ apiKey: 'sk-2' })).toEqual({
      apiKey: 'sk-2',
      baseUrl: createDefaultConfig().baseUrl,
      model: createDefaultConfig().model,
      persona: createDefaultConfig().persona,
    })
  })

  it('旧版本的配置（还没有专属采访者这一项）照样能读', () => {
    const legacy = normalizeConfig({ apiKey: 'sk-3', baseUrl: 'https://x/v1', model: 'm' })
    expect(legacy?.persona).toEqual({ prompt: '', preset: 'warm' })
    expect(legacy?.apiKey).toBe('sk-3')
  })

  it('人设写坏了就当他没写过，不往外抛', () => {
    expect(normalizePersona(null)).toEqual({ prompt: '', preset: 'warm' })
    expect(normalizePersona('一段字符串')).toEqual({ prompt: '', preset: 'warm' })
    expect(normalizePersona({ prompt: 42 })).toEqual({ prompt: '', preset: 'warm' })
  })

  it('人设的预设一律从原文推导，不采信存下来的那个值', () => {
    // 存的 preset 说自己是温和朋友，但原文是用户自己写的 —— 不能将错就错
    expect(normalizePersona({ prompt: '像老同事，讲话短。', preset: 'warm' })).toEqual({
      prompt: '像老同事，讲话短。',
      preset: 'custom',
    })
    // 原文正好等于某套预设时，认得出来
    const coach = PERSONA_PRESETS.find((p) => p.id === 'coach')
    expect(normalizePersona({ prompt: coach?.prompt, preset: 'warm' }).preset).toBe('coach')
  })

  it('默认人设与默认配置保持一致', () => {
    expect(createDefaultConfig().persona.prompt).toBe('')
    expect(defaultPersonaPrompt().length).toBeGreaterThan(10)
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

  describe('周归档的归一化', () => {
    it('坏掉的条目逐条丢掉，不连累另外几十周', () => {
      const list = normalizeArchive([
        GOOD_ARCHIVE[0],
        null,
        '一整条字符串',
        { week: '2026-09-22', result: {} }, // 周二，不是一周的起点
        { week: '2026-09-07' }, // 没有 result
        { week: '2026-08-31', result: { events: ['留着'] } },
      ])
      expect(list.map((e) => e.week)).toEqual(['2026-09-21', '2026-08-31'])
      expect(list[1].result.events).toEqual(['留着'])
    })

    it('整个文件不是数组、或者干脆是坏的，都当空存档', () => {
      expect(normalizeArchive(null)).toEqual([])
      expect(normalizeArchive('{半截')).toEqual([])
      expect(normalizeArchive({ week: '2026-09-21' })).toEqual([])
    })

    it('结果字段缺失时补成空数组，而不是让总览页崩掉', () => {
      const list = normalizeArchive([{ week: '2026-09-21', result: { events: ['只有这一项'] } }])
      expect(list[0].result).toMatchObject({
        events: ['只有这一项'],
        people: [],
        highlights: [],
        nextFollowUps: [],
      })
    })

    it('读回来就是新的在前，缺时间戳的补一个', () => {
      const list = normalizeArchive([...GOOD_ARCHIVE].reverse())
      expect(list.map((e) => e.week)).toEqual(['2026-09-21', '2026-09-14'])
      expect(normalizeArchive([{ week: '2026-09-21', result: {} }])[0].savedAt).toBeGreaterThan(0)
    })

    it('时间戳是个坏数字（NaN / Infinity）也当没有，补成现在', () => {
      // 只判 typeof === 'number' 的话 NaN 会溜进来，把排序和「上次记录」一起带坏
      const list = normalizeArchive([
        { week: '2026-09-21', savedAt: Number.NaN, result: {} },
        { week: '2026-09-14', savedAt: Number.POSITIVE_INFINITY, result: {} },
      ])
      expect(list.map((e) => e.week).sort()).toEqual(['2026-09-14', '2026-09-21'])
      for (const entry of list) {
        expect(Number.isFinite(entry.savedAt)).toBe(true)
        expect(entry.savedAt).toBeGreaterThan(0)
      }
    })

    it('同一周出现两条时只留一条，不给日历画出两行', () => {
      const list = normalizeArchive([
        { week: '2026-09-21', savedAt: 1, result: { highlights: ['旧的'] } },
        { week: '2026-09-21', savedAt: 2, result: { highlights: ['新的'] } },
      ])
      expect(list).toHaveLength(1)
      expect(list[0].result.highlights).toEqual(['新的'])
    })
  })

  describe('旧存档（M7 之前没有周归档）', () => {
    it('会话里没有 week 时按保存时间推一个，而不是算到本周头上', () => {
      // 2026-09-22 12:00 保存 → 归到 09-21 那一周
      const at = new Date(2026, 8, 22, 12).getTime()
      expect(normalizeSession({ messages: [], result: {}, savedAt: at })?.week).toBe('2026-09-21')
      // 周日晚上算的还是这一周，不会提前跳到下一周
      const sunday = new Date(2026, 8, 27, 23).getTime()
      expect(normalizeSession({ messages: [], result: {}, savedAt: sunday })?.week).toBe('2026-09-21')
    })

    it('存了个坏掉的 week 时重新推，不采信', () => {
      const at = new Date(2026, 8, 22, 12).getTime()
      expect(normalizeSession({ messages: [], result: {}, savedAt: at, week: '上周' })?.week).toBe(
        '2026-09-21',
      )
    })

    it('归档文件还不存在时返回空数组，总览页照常打得开', () => {
      expect(normalizeArchive(undefined)).toEqual([])
    })
  })

  describe('旧档（0.9.1 之前的结果还没有状态那一栏）', () => {
    const LEGACY_RESULT = {
      events: ['改了三版方案'],
      people: [{ name: '老王', note: '没拍板' }],
      things: ['想换键盘'],
      pending: ['报销没交'],
      highlights: ['方案定了'],
      nextFocus: ['把报价发出去'],
      nextFollowUps: ['老王'],
    }

    it('会话读回来时状态补成空备注，别的内容一字不动', () => {
      const session = normalizeSession({ messages: [], result: LEGACY_RESULT, savedAt: 1 })
      expect(session?.result.state).toEqual({ note: '' })
      expect(session?.result).toMatchObject(LEGACY_RESULT)
    })

    it('周归档读回来时同样补空备注，历史条目不会因为缺一栏被丢掉', () => {
      const list = normalizeArchive([{ week: '2026-09-21', savedAt: 1, result: LEGACY_RESULT }])
      expect(list).toHaveLength(1)
      expect(list[0].result.state).toEqual({ note: '' })
      expect(list[0].result).toMatchObject(LEGACY_RESULT)
    })

    it('老档那四行文字并成一行备注，原话照抄', () => {
      const list = normalizeArchive([
        {
          week: '2026-09-21',
          savedAt: 1,
          result: {
            ...LEGACY_RESULT,
            state: { body: '睡够了', mood: '还行', focus: '', growth: '读了半本书' },
          },
        },
      ])
      expect(list[0].result.state).toEqual({ note: '身体：睡够了；情绪：还行；心智：读了半本书' })
      // 补成备注之后「成长」那一栏还是空的：老档的心智属于状态，不是这一栏
      expect(list[0].result.growth).toEqual([])
    })
  })

  describe('状态那一栏的容错（coerceResult）', () => {
    const stateOf = (raw: unknown) => coerceResult(raw)?.state

    it('0.9.3 的形态：一行备注 + 四项分数', () => {
      expect(stateOf({ state: { note: '  这周睡得少  ', scores: { mood: 4, sleep: 3 } } })).toEqual({
        note: '这周睡得少',
        scores: { mood: 4, sleep: 3 },
      })
      // 一项都没点：不写 scores 这个键，免得上趋势图时被当成 0 分
      expect(stateOf({ state: { note: '' } })).toEqual({ note: '' })
      expect(stateOf({ state: { note: '空着分也行', scores: {} } })).toEqual({ note: '空着分也行' })
    })

    it('老档四行文字：中文键和英文别名都认，空的不写进备注', () => {
      expect(
        stateOf({
          状态: { 身体: '睡得还行', 情绪: '有点烦', 精力: '上午最好', 心智: '读了半本书' },
        }),
      ).toEqual({ note: '身体：睡得还行；情绪：有点烦；精力：上午最好；心智：读了半本书' })

      expect(
        stateOf({
          state: {
            physical: '腰不疼了',
            emotion: '挺平静',
            energy: '下午犯困',
            learning: '看完了两章',
          },
        }),
      ).toEqual({ note: '身体：腰不疼了；情绪：挺平静；精力：下午犯困；心智：看完了两章' })

      // 专注和成长是 0.9.1 才有的说法，照样接得住
      expect(stateOf({ state: { 专注: '早晨最清醒', 成长: '学会拒绝' } })).toEqual({
        note: '精力：早晨最清醒；心智：学会拒绝',
      })
    })

    it('脏值不往外抛：数字和布尔转成文字，别的当没写', () => {
      expect(stateOf({ state: { body: 42, mood: true, focus: null, growth: ['数组'] } })).toEqual({
        note: '身体：42；情绪：true',
      })
      expect(stateOf({ state: { body: '  睡够了  ' } })).toEqual({ note: '身体：睡够了' })
      // 模型偶尔会把一句话写成对象，取出里面的文字
      expect(stateOf({ state: { mood: { text: '心里踏实' } } })).toEqual({ note: '情绪：心里踏实' })
    })

    it('整个状态不是对象时当没写，四项全空，界面不炸', () => {
      const empty = createEmptyState()
      expect(stateOf({ state: '睡得还行' })).toEqual(empty)
      expect(stateOf({ state: [] })).toEqual(empty)
      expect(stateOf({ state: null })).toEqual(empty)
      expect(stateOf({ state: 0 })).toEqual(empty)
      expect(stateOf({})).toEqual(empty)
      expect(stateOf({ 状态: '挺好的' })).toEqual(empty)
    })

    it('结果本身不是对象时仍是 null，调用方照旧能判空', () => {
      expect(coerceResult(null)).toBeNull()
      expect(coerceResult('一段文字')).toBeNull()
      expect(coerceResult([])).toBeNull()
    })
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
      loadArchive: () => GOOD_ARCHIVE,
      saveArchive: (list) => written.push(list),
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

  it('周归档也走同一条路，读回来同样经过归一化', () => {
    const { bridge, written } = bridgeWith()
    const store = createIpcStore(bridge)
    expect(store.loadArchive().map((e) => e.week)).toEqual(['2026-09-21', '2026-09-14'])

    store.saveArchive(GOOD_ARCHIVE)
    expect(written).toEqual([GOOD_ARCHIVE])
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
      bridgeWith({
        loadConfig: boom,
        loadSession: boom,
        saveConfig: boom,
        clearSession: boom,
        loadArchive: boom,
        saveArchive: boom,
      }).bridge,
    )
    expect(store.loadConfig()).toBeNull()
    expect(store.loadSession()).toBeNull()
    expect(store.loadArchive()).toEqual([])
    expect(() => store.saveConfig(GOOD_CONFIG)).not.toThrow()
    expect(() => store.clearSession()).not.toThrow()
    expect(() => store.saveArchive(GOOD_ARCHIVE)).not.toThrow()
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
    store.saveArchive(GOOD_ARCHIVE)
    expect(store.loadConfig()).toEqual(GOOD_CONFIG)
    expect(store.loadSession()).toMatchObject({ savedAt: 123 })
    expect(store.loadArchive().map((e) => e.week)).toEqual(['2026-09-21', '2026-09-14'])
  })

  it('内容坏掉时当没有', () => {
    memory.set('ai-weekly:config', '{{{')
    memory.set('ai-weekly:last-session', 'null')
    memory.set('ai-weekly:weeks', '{{{')
    const store = createLocalStore()
    expect(store.loadConfig()).toBeNull()
    expect(store.loadSession()).toBeNull()
    expect(store.loadArchive()).toEqual([])
  })

  it('没有 localStorage（比如被禁用）时静默降级', () => {
    delete (globalThis as { localStorage?: unknown }).localStorage
    const store = createLocalStore()
    expect(store.loadConfig()).toBeNull()
    expect(store.loadSession()).toBeNull()
    expect(store.loadArchive()).toEqual([])
    expect(() => store.saveConfig(GOOD_CONFIG)).not.toThrow()
    expect(() => store.clearSession()).not.toThrow()
    expect(() => store.saveArchive(GOOD_ARCHIVE)).not.toThrow()
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
        loadArchive: () => GOOD_ARCHIVE,
        saveArchive: () => {},
      },
    } satisfies AiWeeklyBridge

    expect(selectStore().loadConfig()).toMatchObject({ apiKey: 'sk-from-file' })
    expect(selectStore().loadArchive()).toHaveLength(2)
  })
})
