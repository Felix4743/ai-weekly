import { describe, expect, it } from 'vitest'
import {
  SECTION_KEYS,
  activeSection,
  buildOutline,
  countSection,
  sectionDomId,
  targetScrollTop,
} from './outline'
import { createEmptyResult, type WeeklyResult } from './types'

function base(): WeeklyResult {
  // 从空结果起手再覆盖：以后再加一栏时，这里不用跟着一条条补
  return {
    ...createEmptyResult(),
    events: ['改方案', '整理数据'],
    people: [{ name: '老王', note: '没拍板' }],
    things: ['换键盘'],
    pending: ['报销没交'],
    state: { body: '睡得还行', mood: '有点烦', focus: '', growth: '' },
    highlights: ['方案难产'],
    nextFocus: ['定稿', '联系老王', '留整块时间'],
    nextFollowUps: ['老王'],
  }
}

describe('结果页目录', () => {
  it('按固定顺序列出七块，文案和页面标题一致', () => {
    const outline = buildOutline(base())
    expect(outline.map((e) => e.key)).toEqual(SECTION_KEYS)
    expect(outline.map((e) => e.label)).toEqual([
      '事情',
      '人际',
      '物品',
      '未办',
      '状态',
      '本周主线',
      '下周计划',
    ])
  })

  it('状态排在未办之后、本周主线之前', () => {
    const keys = buildOutline(base()).map((e) => e.key)
    expect(keys.indexOf('state')).toBeGreaterThan(keys.indexOf('pending'))
    expect(keys.indexOf('state')).toBeLessThan(keys.indexOf('highlights'))
  })

  it('每一块都带上自己的条数', () => {
    const outline = buildOutline(base())
    expect(outline.map((e) => e.count)).toEqual([2, 1, 1, 1, 2, 1, 4])
  })

  it('空结果时条数全是 0，但目录项一个都不少', () => {
    const outline = buildOutline(createEmptyResult())
    expect(outline).toHaveLength(7)
    expect(outline.every((e) => e.count === 0)).toBe(true)
  })

  it('状态四项都没写时算 0 条', () => {
    expect(countSection(createEmptyResult(), 'state')).toBe(0)
    // 只填了空白也不算写了
    const blank = createEmptyResult()
    blank.state = { body: ' ', mood: '\n', focus: '', growth: '   ' }
    expect(countSection(blank, 'state')).toBe(0)
  })

  it('状态写了几项就算几条', () => {
    const r = createEmptyResult()
    r.state = { body: '睡得还行', mood: '有点烦', focus: '', growth: '' }
    expect(countSection(r, 'state')).toBe(2)
    r.state.focus = '上午最好'
    expect(countSection(r, 'state')).toBe(3)
  })

  it('状态四项都写了就是 4 条', () => {
    const r = createEmptyResult()
    r.state = { body: '睡得还行', mood: '有点烦', focus: '上午最好', growth: '读了半本书' }
    expect(countSection(r, 'state')).toBe(4)
    expect(buildOutline(r).find((e) => e.key === 'state')?.count).toBe(4)
  })

  it('下周计划把三件重点和要跟进的人一起算', () => {
    const r = createEmptyResult()
    r.nextFocus = ['a', 'b']
    r.nextFollowUps = ['老王']
    expect(countSection(r, 'plan')).toBe(3)
  })

  it('锚点 id 稳定，能被页面直接引用', () => {
    expect(sectionDomId('things')).toBe('section-things')
    expect(SECTION_KEYS.map(sectionDomId)).toEqual([
      'section-events',
      'section-people',
      'section-things',
      'section-pending',
      'section-state',
      'section-highlights',
      'section-plan',
    ])
  })
})

describe('滚动时判断当前是哪一块', () => {
  // offsets 是各区块相对滚动视口顶部的位置，顺序与页面一致
  const offsets = SECTION_KEYS.map((key, i) => ({ key, top: i * 300 }))

  it('没有区块时返回 null', () => {
    expect(activeSection([])).toBeNull()
  })

  it('还没开始滚时高亮第一块', () => {
    expect(activeSection(offsets, { threshold: 60 })).toBe('events')
  })

  it('某一块顶到目录栏下方时，就高亮它', () => {
    // 物品（top 600）已经进到 620 以内，但悬着（top 900）还没有
    const scrolled = offsets.map((o) => ({ ...o, top: o.top - 620 }))
    expect(activeSection(scrolled, { threshold: 60 })).toBe('things')
  })

  it('取的是最后一个越过分界线的区块，而不是第一个匹配的', () => {
    const scrolled = [
      { key: 'events' as const, top: -700 },
      { key: 'people' as const, top: -400 },
      { key: 'things' as const, top: -100 },
      { key: 'pending' as const, top: 200 },
      { key: 'highlights' as const, top: 500 },
      { key: 'plan' as const, top: 800 },
    ]
    expect(activeSection(scrolled, { threshold: 60 })).toBe('things')
  })

  it('滚到底时高亮最后一块，哪怕它还没顶到目录栏', () => {
    const scrolled = [
      { key: 'events' as const, top: -900 },
      { key: 'people' as const, top: -600 },
      { key: 'things' as const, top: -300 },
      { key: 'pending' as const, top: 0 },
      { key: 'highlights' as const, top: 300 },
      { key: 'plan' as const, top: 600 },
    ]
    expect(activeSection(scrolled, { threshold: 60, atBottom: true })).toBe('plan')
  })

  it('目录栏越高，越早把下一块算成当前', () => {
    const scrolled = offsets.map((o) => ({ ...o, top: o.top - 300 }))
    expect(activeSection(scrolled, { threshold: 0 })).toBe('people')
    expect(activeSection(scrolled, { threshold: 60 })).toBe('people')
    expect(activeSection(scrolled, { threshold: 320 })).toBe('things')
  })
})

describe('点击目录跳转的滚动位置', () => {
  it('把目标区块滚到目录栏下方', () => {
    // 目标区块当前在视口下方 500px，目录栏占 60px
    expect(targetScrollTop(500, 0, 60)).toBe(440)
  })

  it('叠加当前滚动位置', () => {
    expect(targetScrollTop(500, 1200, 60)).toBe(1640)
  })

  it('往上跳时不会滚成负数', () => {
    expect(targetScrollTop(-200, 100, 60)).toBe(0)
    expect(targetScrollTop(0, 0, 60)).toBe(0)
  })

  it('结果取整，避免半像素抖动', () => {
    expect(targetScrollTop(100.4, 0.2, 60)).toBe(41)
  })
})
