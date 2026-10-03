import { describe, expect, it } from 'vitest'
import {
  CONTENT_BLOCKS,
  DEFAULT_FOLLOWUP_CAP,
  DEPTHS,
  FOLLOWUP_CAPS,
  RECONCILE_KEY,
  SCRIPT,
  TOTAL_MAIN_QUESTIONS,
  depthSpec,
  dimensionLabel,
  dimensionScript,
  followUpCap,
  isContentBlock,
  questionsInBlock,
  spoken,
} from './script'
import type { Depth, Dimension } from './types'

/** 0.9.3 的题量口径：事情 6 / 人际 4 / 物品与支出 4 / 成长 2；改脚本就会在这里被拦住 */
const MAIN_COUNTS: Record<string, number> = { event: 6, people: 4, thing: 4, growth: 2 }

describe('采访脚本 · 区块与顺序', () => {
  it('顺序是 上周对账 → 事情 → 人际 → 物品与支出 → 成长（状态卡不在脚本里）', () => {
    expect(SCRIPT.map((d) => d.key)).toEqual(['reconcile', 'event', 'people', 'thing', 'growth'])
    expect(SCRIPT.map((d) => d.label)).toEqual([
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

  it('只有「上周对账」是夹在中间的 step，其余四块都是 block', () => {
    expect(dimensionScript('reconcile')?.kind).toBe('step')
    for (const key of ['event', 'people', 'thing', 'growth'] as const) {
      expect(dimensionScript(key)?.kind).toBe('block')
    }
  })

  it('CONTENT_BLOCKS 只收内容块，不含上周对账', () => {
    expect(CONTENT_BLOCKS).toHaveLength(4)
    expect(CONTENT_BLOCKS.map((d) => d.key)).toEqual(['event', 'people', 'thing', 'growth'])
    expect(CONTENT_BLOCKS.every((d) => d.kind === 'block')).toBe(true)
    expect(CONTENT_BLOCKS.some((d) => d.key === RECONCILE_KEY)).toBe(false)
  })

  it('每个区块都有名字、说明和至少一道参考题目', () => {
    const labels = SCRIPT.map((d) => d.label)
    expect(new Set(labels).size).toBe(labels.length)

    for (const d of SCRIPT) {
      expect(d.label.trim().length).toBeGreaterThan(0)
      expect(d.hint.trim().length).toBeGreaterThan(0)
      expect(d.mainQuestions.length).toBeGreaterThan(0)
      // 0.9.3 的题只有「意思 + 示例」：示例是演示模式要念的那一句，不能是空的
      for (const spec of d.mainQuestions) {
        expect(spec.intent.trim().length).toBeGreaterThan(0)
        expect(spec.examples.length).toBeGreaterThan(0)
        expect(spoken(spec).trim().length).toBeGreaterThan(0)
      }
    }
  })

  it('题量按脚本口径：内容块 4/6/4/2，对账只有 1 个', () => {
    for (const [key, count] of Object.entries(MAIN_COUNTS)) {
      expect(dimensionScript(key as Dimension)?.mainQuestions).toHaveLength(count)
    }
    expect(dimensionScript('reconcile')?.mainQuestions).toHaveLength(1)
    // 对账问的是「上周定的事落到了哪儿」（意思在 intent 里）
    expect(dimensionScript('reconcile')?.mainQuestions[0].intent).toContain('落到了哪儿')
  })

  it('参考题目都是问句，而且整份脚本里不重复', () => {
    for (const d of SCRIPT) {
      for (const spec of d.mainQuestions) expect(spoken(spec).endsWith('？')).toBe(true)
    }
    const all = SCRIPT.flatMap((d) => d.mainQuestions).map(spoken)
    expect(new Set(all).size).toBe(all.length)
  })

  it('每个区块都有追问池，人际块另留了一条「聊开了才问」的可选题', () => {
    for (const d of SCRIPT) {
      expect(d.followUps.length).toBeGreaterThan(0)
      for (const spec of d.followUps) {
        expect(spec.intent.trim().length).toBeGreaterThan(0)
        expect(spoken(spec).trim().length).toBeGreaterThan(0)
      }
    }
    expect(dimensionScript('people')?.optionalQuestions).toHaveLength(1)
    expect(dimensionScript('event')?.optionalQuestions).toBeUndefined()
  })
})

describe('采访脚本 · 题量统计', () => {
  it('TOTAL_MAIN_QUESTIONS 只统计四个内容块', () => {
    expect(TOTAL_MAIN_QUESTIONS).toBe(
      CONTENT_BLOCKS.reduce((n, d) => n + d.mainQuestions.length, 0),
    )
    // 事情 6 + 人际 4 + 物品与支出 4 + 成长 2
    expect(TOTAL_MAIN_QUESTIONS).toBe(6 + 4 + 4 + 2)
    expect(TOTAL_MAIN_QUESTIONS).toBe(16)

    const scriptTotal = SCRIPT.reduce((n, d) => n + d.mainQuestions.length, 0)
    // 多出来的那一题就是上周对账，它不占进度
    expect(scriptTotal).toBe(TOTAL_MAIN_QUESTIONS + 1)
  })

  it('questionsInBlock 按区块取题目，未知区块返回空数组', () => {
    expect(questionsInBlock('growth')).toEqual(dimensionScript('growth')?.mainQuestions)
    expect(questionsInBlock('thing')[0]).toBe(dimensionScript('thing')?.mainQuestions[0])
    expect(questionsInBlock('reconcile')).toHaveLength(1)
    expect(questionsInBlock('nope' as Dimension)).toEqual([])
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

  it('RECONCILE_KEY 指向对账那一步', () => {
    expect(RECONCILE_KEY).toBe('reconcile')
    expect(isContentBlock(RECONCILE_KEY)).toBe(false)
    expect(dimensionScript(RECONCILE_KEY)?.kind).toBe('step')
  })
})
