import { describe, expect, it } from 'vitest'
import {
  CONTENT_BLOCKS,
  DEFAULT_FOLLOWUP_CAP,
  DEPTHS,
  FOLLOWUP_CAPS,
  MAX_NUDGES,
  MAX_TURNS_PER_BLOCK,
  PROBE_KEY,
  RECONCILE_KEY,
  SCRIPT,
  TOTAL_POINTS,
  depthSpec,
  dimensionLabel,
  dimensionScript,
  followUpCap,
  isContentBlock,
  pointByNumber,
  pointNumber,
  pointsOf,
  spoken,
} from './script'
import type { Depth, Dimension } from './types'

/** 0.9.5 的要点口径：事情 4 / 人际 3 / 物品与支出 3 / 成长 2；改脚本就会在这里被拦住 */
const POINT_COUNTS: Record<string, number> = { event: 4, people: 3, thing: 3, growth: 2 }

describe('采访脚本 · 区块与顺序', () => {
  it('顺序是 状态追问 → 上周对账 → 事情 → 人际 → 物品与支出 → 成长（状态卡不在脚本里）', () => {
    expect(SCRIPT.map((d) => d.key)).toEqual([
      'probe',
      'reconcile',
      'event',
      'people',
      'thing',
      'growth',
    ])
    expect(SCRIPT.map((d) => d.label)).toEqual([
      '状态追问',
      '上周对账',
      '事情',
      '人际',
      '物品与支出',
      '成长',
    ])
  })

  it('状态不是采访块：mood 既不在脚本里，也不是内容块', () => {
    expect(SCRIPT.some((d) => (d.key as string) === 'mood')).toBe(false)
    expect(dimensionScript('mood' as Dimension)).toBeUndefined()
    expect(isContentBlock('mood' as Dimension)).toBe(false)
  })

  it('「状态追问」与「上周对账」是夹在中间的 step，其余四块都是 block', () => {
    expect(dimensionScript('probe')?.kind).toBe('step')
    expect(dimensionScript('reconcile')?.kind).toBe('step')
    for (const key of ['event', 'people', 'thing', 'growth'] as const) {
      expect(dimensionScript(key)?.kind).toBe('block')
    }
  })

  it('状态追问的要点不写死在这儿 —— 它按分数现算（见 probe.ts）', () => {
    expect(dimensionScript('probe')?.points).toEqual([])
    expect(pointsOf('probe')).toEqual([])
  })

  it('CONTENT_BLOCKS 只收内容块，不含状态追问与上周对账', () => {
    expect(CONTENT_BLOCKS).toHaveLength(4)
    expect(CONTENT_BLOCKS.map((d) => d.key)).toEqual(['event', 'people', 'thing', 'growth'])
    expect(CONTENT_BLOCKS.every((d) => d.kind === 'block')).toBe(true)
    expect(CONTENT_BLOCKS.some((d) => d.key === RECONCILE_KEY)).toBe(false)
    expect(CONTENT_BLOCKS.some((d) => d.key === PROBE_KEY)).toBe(false)
  })

  it('每个区块都有名字、说明和至少一个要点（状态追问例外，它的要点按分数现算）', () => {
    const labels = SCRIPT.map((d) => d.label)
    expect(new Set(labels).size).toBe(labels.length)

    for (const d of SCRIPT) {
      expect(d.label.trim().length).toBeGreaterThan(0)
      expect(d.hint.trim().length).toBeGreaterThan(0)
      if (d.key === PROBE_KEY) continue
      expect(d.points.length).toBeGreaterThan(0)
      // 要点只有「要了解到什么 + 锚点示例」：锚点是演示模式要念的那一句，不能是空的
      for (const p of d.points) {
        expect(p.id.trim().length).toBeGreaterThan(0)
        expect(p.intent.trim().length).toBeGreaterThan(0)
        expect(p.anchors.length).toBeGreaterThan(0)
        for (const anchor of p.anchors) expect(anchor.trim().length).toBeGreaterThan(0)
        expect(spoken(p).trim().length).toBeGreaterThan(0)
      }
    }
  })

  it('要点量按脚本口径：内容块 4/3/3/2，对账只有 1 个', () => {
    for (const [key, count] of Object.entries(POINT_COUNTS)) {
      expect(pointsOf(key as Dimension)).toHaveLength(count)
    }
    expect(pointsOf('reconcile')).toHaveLength(1)
    // 对账问的是「上周定的事落到了哪儿」（意思在 intent 里）
    expect(pointsOf('reconcile')[0].intent).toContain('落到了哪儿')
  })

  it('要点 id 唯一，锚点都是问句、而且整份脚本里不重复', () => {
    const ids = SCRIPT.flatMap((d) => d.points).map((p) => p.id)
    expect(new Set(ids).size).toBe(ids.length)

    for (const d of SCRIPT) {
      for (const p of d.points) {
        for (const anchor of p.anchors) expect(anchor.endsWith('？')).toBe(true)
      }
    }
    const anchors = SCRIPT.flatMap((d) => d.points).flatMap((p) => p.anchors)
    expect(new Set(anchors).size).toBe(anchors.length)
  })

  it('每一块都留了「往具体里追」的方向，而且只是一句话（不再是可轮取的追问池）', () => {
    for (const d of SCRIPT) {
      expect(typeof d.digInto).toBe('string')
      expect(d.digInto?.trim().length ?? 0).toBeGreaterThan(10)
      // 方向是给模型看的意思，不是一道道的题：里面不带序号
      expect(d.digInto?.match(/\d+\s*[.、]/)).toBeNull()
    }
  })
})

describe('采访脚本 · 要点统计', () => {
  it('TOTAL_POINTS 只统计四个内容块', () => {
    expect(TOTAL_POINTS).toBe(CONTENT_BLOCKS.reduce((n, d) => n + d.points.length, 0))
    // 事情 4 + 人际 3 + 物品与支出 3 + 成长 2
    expect(TOTAL_POINTS).toBe(4 + 3 + 3 + 2)
    expect(TOTAL_POINTS).toBe(12)

    const scriptTotal = SCRIPT.reduce((n, d) => n + d.points.length, 0)
    // 多出来的那一个就是上周对账，它不占进度
    expect(scriptTotal).toBe(TOTAL_POINTS + 1)
  })

  it('pointsOf 按区块取要点，未知区块返回空数组', () => {
    expect(pointsOf('growth')).toEqual(dimensionScript('growth')?.points)
    expect(pointsOf('thing')[0]).toBe(dimensionScript('thing')?.points[0])
    expect(pointsOf('reconcile')).toHaveLength(1)
    expect(pointsOf('nope' as Dimension)).toEqual([])
  })

  it('pointNumber 是 1 起的序号，pointByNumber 越界给 undefined、不抛', () => {
    expect(pointNumber(0)).toBe(1)
    expect(pointNumber(3)).toBe(4)

    const points = pointsOf('event')
    expect(pointByNumber(points, 1)).toBe(points[0])
    expect(pointByNumber(points, 4)).toBe(points[3])
    expect(pointByNumber(points, 0)).toBeUndefined()
    expect(pointByNumber(points, 5)).toBeUndefined()
    expect(() => pointByNumber(points, 99)).not.toThrow()
  })

  it('spoken 取第一个锚点，没有要点时给空串', () => {
    expect(spoken(pointsOf('event')[0])).toBe('这周大部分时间都花在哪儿了？')
    expect(spoken(undefined)).toBe('')
  })

  it('防打转的兜底常量写在脚本里：一块最多 10 个回合，收尾最多补问 2 次', () => {
    expect(MAX_TURNS_PER_BLOCK).toBe(10)
    expect(MAX_NUDGES).toBe(2)
  })
})

describe('采访脚本 · 三档深度', () => {
  it('三档分别是 深度 / 中度 / 快速，时长与追问上限依次递减', () => {
    expect(DEPTHS.map((d) => d.id)).toEqual(['deep', 'mid', 'fast'])
    expect(DEPTHS.map((d) => d.label)).toEqual(['深度复盘', '中度复盘', '快速复盘'])

    expect(depthSpec('deep')?.minutes).toBe(20)
    expect(depthSpec('mid')?.minutes).toBe(12)
    expect(depthSpec('fast')?.minutes).toBe(5)

    expect(depthSpec('deep')?.followUpCap).toBe(5)
    expect(depthSpec('mid')?.followUpCap).toBe(2)
    expect(depthSpec('fast')?.followUpCap).toBe(1)
    expect(depthSpec('deep')?.followUpCap ?? 0).toBeGreaterThan(depthSpec('mid')?.followUpCap ?? 0)
    expect(depthSpec('mid')?.followUpCap ?? 0).toBeGreaterThan(depthSpec('fast')?.followUpCap ?? 0)
  })

  it('每一档都有可以直接念出来的问法和节奏说明', () => {
    for (const d of DEPTHS) {
      expect(d.phrase.endsWith('吗？')).toBe(true)
      expect(d.guidance.trim().length).toBeGreaterThan(10)
      expect(d.minutes).toBeGreaterThan(0)
      expect(d.followUpCap).toBeGreaterThan(0)
    }
    expect(depthSpec('deep')?.phrase).toContain('聊细')
    expect(depthSpec('mid')?.phrase).toContain('正常聊')
    expect(depthSpec('fast')?.phrase).toContain('抓重点')
  })

  it('FOLLOWUP_CAPS 与 DEPTHS 里写的上限完全一致', () => {
    for (const d of DEPTHS) {
      expect(FOLLOWUP_CAPS[d.id]).toBe(d.followUpCap)
    }
    expect(DEFAULT_FOLLOWUP_CAP).toBe(2)
  })

  it('followUpCap 没定档时用默认值，定了档就用那一档', () => {
    expect(followUpCap(null)).toBe(DEFAULT_FOLLOWUP_CAP)
    expect(followUpCap('deep')).toBe(FOLLOWUP_CAPS.deep)
    expect(followUpCap('mid')).toBe(FOLLOWUP_CAPS.mid)
    expect(followUpCap('fast')).toBe(FOLLOWUP_CAPS.fast)
  })

  it('depthSpec 按档位取，取不到给 undefined', () => {
    expect(depthSpec('deep')?.id).toBe('deep')
    expect(depthSpec(null)).toBeUndefined()
    expect(depthSpec('nope' as Depth)).toBeUndefined()
  })
})

describe('采访脚本 · 查询函数', () => {
  it('dimensionLabel 给出中文名，未知区块退回 key 本身', () => {
    expect(dimensionLabel('thing')).toBe('物品与支出')
    expect(dimensionLabel('growth')).toBe('成长')
    expect(dimensionLabel('reconcile')).toBe('上周对账')
    expect(dimensionLabel('nope' as Dimension)).toBe('nope')
  })

  it('dimensionScript / isContentBlock 认得对账不是内容块', () => {
    expect(dimensionScript('reconcile')?.label).toBe('上周对账')
    expect(dimensionScript('nope' as Dimension)).toBeUndefined()

    for (const d of CONTENT_BLOCKS) {
      expect(isContentBlock(d.key)).toBe(true)
    }
    expect(isContentBlock('growth')).toBe(true)
    expect(isContentBlock('reconcile')).toBe(false)
    expect(isContentBlock('nope' as Dimension)).toBe(false)
  })

  it('RECONCILE_KEY 指向对账那一步，PROBE_KEY 指向状态追问', () => {
    expect(RECONCILE_KEY).toBe('reconcile')
    expect(isContentBlock(RECONCILE_KEY)).toBe(false)
    expect(dimensionScript(RECONCILE_KEY)?.kind).toBe('step')

    expect(PROBE_KEY).toBe('probe')
    expect(isContentBlock(PROBE_KEY)).toBe(false)
    expect(dimensionScript(PROBE_KEY)?.kind).toBe('step')
  })
})
