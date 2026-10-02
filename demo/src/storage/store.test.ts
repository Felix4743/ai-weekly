import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ARCHIVE_LIMIT, type WeekEntry } from '../core/archive'
import { createEmptyReview, type Review } from '../core/review'
import { createDefaultConfig, type AppConfig } from '../core/types'
import type { AiWeeklyBridge } from '../shared/ipc'
import { selectStore } from './index'
import { createIpcStore } from './ipcStore'
import { createLocalStore } from './localStore'
import { normalizeArchive, normalizeConfig } from './shape'

/**
 * 存储这一层要回答两个问题：
 * 1. 从文件 / localStorage 里读出来的东西坏了怎么办（坏的条目逐条丢，不许崩）
 * 2. 装在哪个壳里就用哪条通路（有桥走主进程 JSON 文件，没桥走 localStorage）
 *
 * 0.9.0 起要存的东西只剩两样：一份配置、一份按周归档。存档的校验规则
 * （空条目丢掉、review 空当 null、旧 result 迁移）全在 shape.ts 里，两边共用。
 */

const GOOD_CONFIG: AppConfig = {
  apiKey: 'sk-1',
  baseUrl: 'https://api.deepseek.com/v1',
  model: 'deepseek-chat',
}

const GOOD_REVIEW: Review = {
  headline: '被方案拖着',
  did: ['改了三版方案'],
  issues: [{ text: '报销拖了两周', advice: ['今天就交'], key: '报销拖延' }],
  reconcile: [{ text: '把报价发出去', state: 'done', note: '周三发了' }],
  plan: [{ text: '把报价发出去', when: '周三' }],
  nudge: '周报别忘了写',
}

const GOOD_ARCHIVE: WeekEntry[] = [
  { week: '2026-09-21', savedAt: 200, notes: '这周改了三版方案', review: GOOD_REVIEW },
  {
    week: '2026-09-14',
    savedAt: 100,
    notes: '上周的原文',
    review: { ...GOOD_REVIEW, headline: '上一周的主线' },
  },
]

/** 自己造一串连着的周一，不依赖被测代码 */
function mondayFrom(start: string, weeks: number): string {
  const [y, m, d] = start.split('-').map(Number)
  const date = new Date(y, m - 1, d + weeks * 7)
  const pad = (n: number) => (n < 10 ? `0${n}` : String(n))
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

describe('存储 · 配置的归一化', () => {
  it('配置缺字段时补默认值而不是整块丢掉', () => {
    expect(normalizeConfig({ apiKey: 'sk-2' })).toEqual({
      apiKey: 'sk-2',
      baseUrl: createDefaultConfig().baseUrl,
      model: createDefaultConfig().model,
    })
  })

  it('字段类型不对时退回默认值，不把坏值带进界面', () => {
    expect(normalizeConfig({ apiKey: 42, baseUrl: null, model: {} })).toEqual(createDefaultConfig())
  })

  it('整块不是对象时当没配过', () => {
    expect(normalizeConfig(null)).toBeNull()
    expect(normalizeConfig(undefined)).toBeNull()
    expect(normalizeConfig('sk-2')).toBeNull()
    expect(normalizeConfig(42)).toBeNull()
  })

  it('存的是一整个数组时读出来是默认配置（数组也是对象，只是没有那几个字段）', () => {
    expect(normalizeConfig([])).toEqual(createDefaultConfig())
  })
})

describe('存储 · 周归档的归一化', () => {
  it('坏掉的条目逐条丢掉，不连累另外几十周', () => {
    const list = normalizeArchive([
      GOOD_ARCHIVE[0],
      null,
      '一整条字符串',
      { week: '2026-09-22', notes: '周二，不是一周的起点' },
      { week: '上周', notes: '压根不是日期' },
      { week: '2026-09-07' }, // 没原文也没复盘
      { week: '2026-08-31', notes: '留着这一条' },
    ])
    expect(list.map((e) => e.week)).toEqual(['2026-09-21', '2026-08-31'])
    expect(list[1]).toMatchObject({ notes: '留着这一条', review: null })
  })

  it('整个文件不是数组时当空存档', () => {
    expect(normalizeArchive(null)).toEqual([])
    expect(normalizeArchive(undefined)).toEqual([])
    expect(normalizeArchive('{半截')).toEqual([])
    expect(normalizeArchive({ week: '2026-09-21' })).toEqual([])
    expect(normalizeArchive(42)).toEqual([])
  })

  it('没写原文也没有复盘的条目丢掉；写了原文就留下（review 为 null）', () => {
    const list = normalizeArchive([
      { week: '2026-09-21', notes: '  \n ' },
      { week: '2026-09-14', notes: '写了一句' },
    ])
    expect(list).toHaveLength(1)
    expect(list[0]).toMatchObject({ week: '2026-09-14', notes: '写了一句', review: null })
    expect(Number.isFinite(list[0].savedAt)).toBe(true)
  })

  it('notes 不是字符串就当成空串，不把数字带进界面', () => {
    const list = normalizeArchive([{ week: '2026-09-21', notes: 42, review: GOOD_REVIEW }])
    expect(list).toHaveLength(1)
    expect(list[0].notes).toBe('')
    expect(list[0].review).toEqual(GOOD_REVIEW)
  })

  it('一份什么都没写出来的复盘当成「还没复盘」', () => {
    const list = normalizeArchive([{ week: '2026-09-21', notes: '原文还在', review: createEmptyReview() }])
    expect(list[0].review).toBeNull()
    expect(list[0].notes).toBe('原文还在')
  })

  it('savedAt 是 NaN / Infinity 时被修成一个有限值，排序也不因此抖动', () => {
    const raw = [
      { week: '2026-09-21', savedAt: Number.NaN, notes: '第一条' },
      { week: '2026-09-14', savedAt: Number.POSITIVE_INFINITY, notes: '第二条' },
      { week: '2026-09-07', savedAt: Number.NEGATIVE_INFINITY, notes: '第三条' },
    ]
    const list = normalizeArchive(raw)
    expect(list.map((e) => e.week)).toEqual(['2026-09-21', '2026-09-14', '2026-09-07'])
    for (const entry of list) {
      expect(Number.isFinite(entry.savedAt)).toBe(true)
      expect(entry.savedAt).toBeGreaterThan(0)
    }
    // 再读一遍还是同一个顺序，不会因为补的是 Date.now() 就把周次排乱
    expect(normalizeArchive(raw).map((e) => e.week)).toEqual(list.map((e) => e.week))
  })

  it('同一周出现两条时留最后那条，不给日历画出两行', () => {
    const list = normalizeArchive([
      { week: '2026-09-21', savedAt: 1, notes: '旧的', review: { headline: '旧的主线' } },
      { week: '2026-09-21', savedAt: 2, notes: '新的', review: { headline: '新的主线' } },
    ])
    expect(list).toHaveLength(1)
    expect(list[0]).toMatchObject({ savedAt: 2, notes: '新的' })
    expect(list[0].review?.headline).toBe('新的主线')
  })

  it('读回来就是新的在前', () => {
    expect(normalizeArchive([...GOOD_ARCHIVE].reverse()).map((e) => e.week)).toEqual([
      '2026-09-21',
      '2026-09-14',
    ])
  })

  it('用户删过的条目跟着记录一起存下来，空白项与重复项丢掉', () => {
    const list = normalizeArchive([
      {
        week: '2026-09-21',
        savedAt: 1,
        notes: '原文',
        review: GOOD_REVIEW,
        dropped: ['发周报', '  ', '发周报', ' 见客户 '],
      },
    ])
    expect(list[0].dropped).toEqual(['发周报', '见客户'])
  })

  it('dropped 坏掉时当没有 —— 但那一周别的都还在，不整条丢掉', () => {
    for (const bad of [42, '发周报', { a: 1 }, null, [null, {}]]) {
      const list = normalizeArchive([
        { week: '2026-09-21', savedAt: 1, notes: '原文', review: GOOD_REVIEW, dropped: bad },
      ])
      expect(list).toHaveLength(1)
      expect(list[0].notes).toBe('原文')
      expect(list[0].review).toEqual(GOOD_REVIEW)
      expect(list[0].dropped).toBeUndefined()
    }
  })

  it('超过上限时截到 ARCHIVE_LIMIT 条，丢的是最旧的', () => {
    const total = ARCHIVE_LIMIT + 5
    const raw = Array.from({ length: total }, (_, i) => ({
      week: mondayFrom('2026-01-05', i),
      savedAt: i,
      notes: `第 ${i} 周的原文`,
    }))
    const list = normalizeArchive(raw)
    expect(list).toHaveLength(ARCHIVE_LIMIT)
    expect(list[0].week).toBe(mondayFrom('2026-01-05', total - 1))
    expect(list.some((e) => e.week === mondayFrom('2026-01-05', 0))).toBe(false)
  })
})

describe('存储 · 旧版的四栏结果迁移成复盘', () => {
  const legacy = {
    highlights: ['方案定了'],
    events: ['改了三版方案'],
    pending: ['报销拖了两周'],
    nextFocus: ['把报价发出去'],
    nextFollowUps: ['找老王对账'],
    people: [{ name: '老王', note: '聊了排期' }],
    things: ['换了键盘'],
  }

  it('主线 + 事情变成「这周做了什么」，未办变成问题，下周重点 + 跟进变成行动项', () => {
    const list = normalizeArchive([{ week: '2026-09-21', savedAt: 1, result: legacy }])
    expect(list).toHaveLength(1)
    expect(list[0].review).toEqual({
      headline: '',
      did: ['方案定了', '改了三版方案'],
      issues: [{ text: '报销拖了两周', advice: [], key: '' }],
      reconcile: [],
      plan: [
        { text: '把报价发出去', when: '' },
        { text: '找老王对账', when: '' },
      ],
      nudge: '',
    })
  })

  it('人际与物品不迁 —— 复盘五段里没有它们的位置', () => {
    const list = normalizeArchive([{ week: '2026-09-21', savedAt: 1, result: legacy }])
    const review = list[0].review
    const text = JSON.stringify(review)
    // 键盘（物品）不迁；老王这条「人际」也不迁 ——
    // 下文里那条「找老王对账」是旧版的「下周跟进」，属于行动项，照迁
    expect(text).not.toContain('换了键盘')
    expect(text).not.toContain('聊了排期')
    expect(review?.did).not.toContain('换了键盘')
  })

  it('旧结果里重复写了两遍的条目只留一条', () => {
    const list = normalizeArchive([
      {
        week: '2026-09-21',
        savedAt: 1,
        result: { highlights: ['方案定了'], events: ['方案定了', '改了三版方案'], pending: ['拖了两周', '拖了两周'] },
      },
    ])
    expect(list[0].review?.did).toEqual(['方案定了', '改了三版方案'])
    expect(list[0].review?.issues).toEqual([{ text: '拖了两周', advice: [], key: '' }])
  })

  it('原文丢了但旧结果还读得出来时，条目照样留下（历史不丢）', () => {
    const list = normalizeArchive([{ week: '2026-09-21', savedAt: 1, result: { events: ['改方案'] } }])
    expect(list).toHaveLength(1)
    expect(list[0]).toMatchObject({ notes: '' })
    expect(list[0].review?.did).toEqual(['改方案'])
  })

  it('旧结果里只有人际和物品时等于什么都没迁出来，条目被丢掉', () => {
    expect(
      normalizeArchive([{ week: '2026-09-21', savedAt: 1, result: { people: [{ name: '老王' }], things: ['键盘'] } }]),
    ).toEqual([])
  })

  it('review 不是对象时退回旧 result，而不是整条丢掉', () => {
    const list = normalizeArchive([
      { week: '2026-09-21', savedAt: 1, notes: '原文', review: '一段字符串', result: { events: ['改方案'] } },
    ])
    expect(list[0].review?.did).toEqual(['改方案'])
  })

  it('新式 review 与旧式 result 同时存在时以 review 为准', () => {
    const list = normalizeArchive([
      { week: '2026-09-21', savedAt: 1, notes: '原文', review: GOOD_REVIEW, result: { events: ['旧事情'] } },
    ])
    expect(list[0].review).toEqual(GOOD_REVIEW)
  })

  it('review 是个空对象，但旁边还有旧 result —— 继续拿旧的那份兜底', () => {
    // coerceReview({}) 成功但内容是空的 → 当成「还没复盘」，接着去试旧版的 result
    const list = normalizeArchive([
      { week: '2026-09-21', savedAt: 1, review: {}, result: { events: ['旧事情'] } },
    ])
    expect(list[0].review?.did).toEqual(['旧事情'])
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
      loadArchive: () => GOOD_ARCHIVE,
      saveArchive: (list) => written.push(list),
      ...overrides,
    }
    return {
      written,
      bridge: { llm: { send: async () => ({ ok: true, text: '' }), abort: () => {} }, store },
    }
  }

  it('读出来的配置与归档经过同一套归一化', () => {
    const store = createIpcStore(bridgeWith().bridge)
    expect(store.loadConfig()).toEqual(GOOD_CONFIG)
    expect(store.loadArchive().map((e) => e.week)).toEqual(['2026-09-21', '2026-09-14'])
    expect(store.loadArchive()[1].review?.headline).toBe('上一周的主线')
  })

  it('dropped 经过主进程那条路也留得住', () => {
    const archive: WeekEntry[] = [
      { week: '2026-09-21', savedAt: 1, notes: '原文', review: GOOD_REVIEW, dropped: ['发周报'] },
    ]
    const store = createIpcStore(bridgeWith({ loadArchive: () => archive }).bridge)
    expect(store.loadArchive()[0].dropped).toEqual(['发周报'])
  })

  it('写就原样交给主进程落盘', () => {
    const { bridge, written } = bridgeWith()
    const store = createIpcStore(bridge)
    store.saveConfig(GOOD_CONFIG)
    store.saveArchive(GOOD_ARCHIVE)
    expect(written).toEqual([GOOD_CONFIG, GOOD_ARCHIVE])
  })

  it('文件坏了（读回来不是该有的形状）时当没有，不往外抛', () => {
    const store = createIpcStore(bridgeWith({ loadConfig: () => '{半截', loadArchive: () => ({}) }).bridge)
    expect(store.loadConfig()).toBeNull()
    expect(store.loadArchive()).toEqual([])
  })

  it('主进程那边直接抛异常时也不拖垮界面', () => {
    const boom = (): never => {
      throw new Error('IPC 断了')
    }
    const store = createIpcStore(
      bridgeWith({ loadConfig: boom, saveConfig: boom, loadArchive: boom, saveArchive: boom }).bridge,
    )
    expect(store.loadConfig()).toBeNull()
    expect(store.loadArchive()).toEqual([])
    expect(() => store.saveConfig(GOOD_CONFIG)).not.toThrow()
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

  it('写进去再读出来是同一份，落在约定的两个键上', () => {
    const store = createLocalStore()
    store.saveConfig(GOOD_CONFIG)
    store.saveArchive(GOOD_ARCHIVE)

    expect([...memory.keys()].sort()).toEqual(['ai-weekly:config', 'ai-weekly:weeks'])
    expect(store.loadConfig()).toEqual(GOOD_CONFIG)
    expect(store.loadArchive().map((e) => e.week)).toEqual(['2026-09-21', '2026-09-14'])
    expect(store.loadArchive()[0].review).toEqual(GOOD_REVIEW)
  })

  it('存进去的是坏形状时当没有 / 当空存档', () => {
    memory.set('ai-weekly:config', '{{{')
    memory.set('ai-weekly:weeks', '{{{')
    const store = createLocalStore()
    expect(store.loadConfig()).toBeNull()
    expect(store.loadArchive()).toEqual([])
  })

  it('写进去再读出来，用户删过的条目还在', () => {
    const store = createLocalStore()
    store.saveArchive([
      { week: '2026-09-21', savedAt: 1, notes: '原文', review: GOOD_REVIEW, dropped: ['发周报'] },
    ])
    expect(store.loadArchive()[0].dropped).toEqual(['发周报'])
  })

  it('内容合法但字段脏时逐条归一化', () => {
    memory.set(
      'ai-weekly:weeks',
      JSON.stringify([{ week: '2026-09-21', savedAt: Number.NaN, notes: 7, review: GOOD_REVIEW }]),
    )
    const list = createLocalStore().loadArchive()
    expect(list).toHaveLength(1)
    expect(list[0].notes).toBe('')
    expect(Number.isFinite(list[0].savedAt)).toBe(true)
    expect(list[0].review).toEqual(GOOD_REVIEW)
  })

  it('没有 localStorage（比如被禁用）时静默降级', () => {
    delete (globalThis as { localStorage?: unknown }).localStorage
    const store = createLocalStore()
    expect(store.loadConfig()).toBeNull()
    expect(store.loadArchive()).toEqual([])
    expect(() => store.saveConfig(GOOD_CONFIG)).not.toThrow()
    expect(() => store.saveArchive(GOOD_ARCHIVE)).not.toThrow()
  })
})

describe('存储 · 按环境挑通路', () => {
  afterEach(() => {
    delete (globalThis as { aiWeekly?: unknown }).aiWeekly
  })

  it('没有桥时是 localStorage 那份', () => {
    expect(selectStore()).toEqual(createLocalStore())
  })

  it('桥只有一半（有 llm 没有 store）时也当没有，退回 localStorage', () => {
    ;(globalThis as { aiWeekly?: unknown }).aiWeekly = {
      llm: { send: async () => ({ ok: true, text: '' }), abort: () => {} },
    }
    expect(selectStore()).toEqual(createLocalStore())
  })

  it('有桥时读的是主进程的文件', () => {
    ;(globalThis as { aiWeekly?: unknown }).aiWeekly = {
      llm: { send: async () => ({ ok: true, text: '' }), abort: () => {} },
      store: {
        loadConfig: () => ({ ...GOOD_CONFIG, apiKey: 'sk-from-file' }),
        saveConfig: () => {},
        loadArchive: () => GOOD_ARCHIVE,
        saveArchive: () => {},
      },
    } satisfies AiWeeklyBridge

    expect(selectStore().loadConfig()).toMatchObject({ apiKey: 'sk-from-file' })
    expect(selectStore().loadArchive()).toHaveLength(2)
  })
})
