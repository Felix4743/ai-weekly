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
} from './script'
import type { Depth, Dimension } from './types'

describe('采访脚本 · 区块与顺序', () => {
  it('顺序是 状态 → 上周对账 → 事情 → 人际 → 物与钱', () => {
    expect(SCRIPT.map((d) => d.key)).toEqual(['mood', 'reconcile', 'event', 'people', 'thing'])
    expect(SCRIPT.map((d) => d.label)).toEqual(['状态', '上周对账', '事情', '人际', '物与钱'])
  })

  it('只有「上周对账」是夹在中间的 step，其余四块都是 block', () => {
    expect(dimensionScript('reconcile')?.kind).toBe('step')
    for (const key of ['mood', 'event', 'people', 'thing'] as const) {
      expect(dimensionScript(key)?.kind).toBe('block')
    }
  })

  it('CONTENT_BLOCKS 只收内容块，不含上周对账', () => {
    expect(CONTENT_BLOCKS).toHaveLength(4)
    expect(CONTENT_BLOCKS.map((d) => d.key)).toEqual(['mood', 'event', 'people', 'thing'])
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
    }
  })

  it('内容块的主问题不少于 4 个，对账只有 1 个', () => {
    for (const d of CONTENT_BLOCKS) {
      expect(d.mainQuestions.length).toBeGreaterThanOrEqual(4)
    }
    expect(dimensionScript('reconcile')?.mainQuestions).toHaveLength(1)
    expect(dimensionScript('reconcile')?.mainQuestions[0]).toContain('落到了哪儿')
  })

  it('参考题目都是问句，且整份脚本里不重复', () => {
    for (const d of SCRIPT) {
      for (const q of d.mainQuestions) expect(q.endsWith('？')).toBe(true)
    }
    const all = SCRIPT.flatMap((d) => d.mainQuestions)
    expect(new Set(all).size).toBe(all.length)
  })

  it('每个区块都有追问池，人际块另留了一条「聊开了才问」的可选题', () => {
    for (const d of SCRIPT) {
      expect(d.followUps.length).toBeGreaterThan(0)
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
    expect(TOTAL_MAIN_QUESTIONS).toBe(4 + 6 + 4 + 4)

    const scriptTotal = SCRIPT.reduce((n, d) => n + d.mainQuestions.length, 0)
    // 多出来的那一题就是上周对账，它不占进度
    expect(scriptTotal).toBe(TOTAL_MAIN_QUESTIONS + 1)
  })

  it('questionsInBlock 按区块取题目，未知区块返回空数组', () => {
    expect(questionsInBlock('mood')).toEqual(dimensionScript('mood')?.mainQuestions)
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
    expect(depthSpec('mid')?.phrase).toContain('中度复盘')
    expect(depthSpec('fast')?.phrase).toContain('快速复盘')
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
    expect(dimensionLabel('mood')).toBe('状态')
    expect(dimensionLabel('reconcile')).toBe('上周对账')
    expect(dimensionLabel('thing')).toBe('物与钱')
    expect(dimensionLabel('nope' as Dimension)).toBe('nope')
  })

  it('dimensionScript / isContentBlock 认得对账不是内容块', () => {
    expect(dimensionScript('reconcile')?.label).toBe('上周对账')
    expect(dimensionScript('nope' as Dimension)).toBeUndefined()

    for (const d of CONTENT_BLOCKS) {
      expect(isContentBlock(d.key)).toBe(true)
    }
    expect(isContentBlock('reconcile')).toBe(false)
    expect(isContentBlock('nope' as Dimension)).toBe(false)
  })

  it('RECONCILE_KEY 指向对账那一步', () => {
    expect(RECONCILE_KEY).toBe('reconcile')
    expect(isContentBlock(RECONCILE_KEY)).toBe(false)
    expect(dimensionScript(RECONCILE_KEY)?.kind).toBe('step')
  })
})
