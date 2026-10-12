import { describe, expect, it } from 'vitest'
import {
  SECTION_KEYS,
  activeSection,
  buildOutline,
  countSection,
  sectionDomId,
  targetScrollTop,
} from './outline'
import { attachState } from './stateScore'
import { createEmptyResult, type WeeklyResult } from './types'

function base(): WeeklyResult {
  // 从空结果起手再覆盖：以后再加一栏时，这里不用跟着一条条补
  return {
    ...createEmptyResult(),
    events: ['改方案', '整理数据'],
    people: [{ name: '老王', note: '没拍板' }],
    things: ['换键盘'],
    pending: ['报销没交'],
    growth: ['读完《长日将尽》'],
    // 状态：点过分的那两项各算一条，再写了备注又算一条
    state: attachState({ mood: 4, sleep: 2 }, '这周一直悬着'),
    highlights: ['方案难产'],
    nextFocus: ['定稿', '联系老王', '留整块时间'],
    nextFollowUps: ['老王'],
  }
}

describe('结果页目录', () => {
  it('按固定顺序列出九块，文案和页面标题一致', () => {
    const outline = buildOutline(base())
    expect(outline.map((e) => e.key)).toEqual(SECTION_KEYS)
    // 0.9.5 重排：主线与计划在最前；0.9.6 在未办后面插了「反复出现」
    expect(outline.map((e) => e.label)).toEqual([
      '本周主线',
      '下周计划',
      '事情',
      '人际',
      '物品',
      '未办',
      '反复出现',
      '状态',
      '成长',
    ])
  })

  it('主线与计划在最前，几张清单卡退到后面', () => {
    const keys = buildOutline(base()).map((e) => e.key)
    expect(keys.slice(0, 2)).toEqual(['highlights', 'plan'])
    expect(keys.indexOf('events')).toBeGreaterThan(keys.indexOf('plan'))
    // 清单卡之间的相对顺序：未办 → 反复出现 → 状态 → 成长
    expect(keys.indexOf('pending')).toBeLessThan(keys.indexOf('pattern'))
    expect(keys.indexOf('pattern')).toBeLessThan(keys.indexOf('state'))
    expect(keys.indexOf('growth')).toBeGreaterThan(keys.indexOf('state'))
  })

  it('每一块都带上自己的条数', () => {
    const outline = buildOutline(base())
    // 反复出现那一栏默认 0：它的条数来自归档，不在这份结果里
    expect(outline.map((e) => e.count)).toEqual([1, 4, 2, 1, 1, 1, 0, 3, 1])
  })

  it('空结果时条数全是 0，但目录项一个都不少', () => {
    const outline = buildOutline(createEmptyResult())
    expect(outline).toHaveLength(9)
    expect(outline.every((e) => e.count === 0)).toBe(true)
  })

  // 0.9.6：那一条的条数是「归档里跨周重复了几组」，由调用方算好传进来
  it('反复出现的条数由归档算出来，不写进结果文件', () => {
    expect(countSection(createEmptyResult(), 'pattern')).toBe(0)
    expect(countSection(base(), 'pattern', 3)).toBe(3)
    const outline = buildOutline(base(), 3)
    expect(outline).toHaveLength(9)
    expect(outline.map((e) => e.count)).toEqual([1, 4, 2, 1, 1, 1, 3, 3, 1])
  })

  it('状态一项分没点、备注也空着时算 0 条', () => {
    expect(countSection(createEmptyResult(), 'state')).toBe(0)
    // 备注只有空白也不算写了
    const blank = createEmptyResult()
    blank.state = { note: '  \n ' }
    expect(countSection(blank, 'state')).toBe(0)
  })

  it('状态点一项分算一条，再写备注就加一条', () => {
    const r = createEmptyResult()
    r.state = attachState({ mood: 4 }, '')
    expect(countSection(r, 'state')).toBe(1)
    r.state = attachState({ mood: 4 }, '这周一直悬着')
    expect(countSection(r, 'state')).toBe(2)
  })

  it('四项分全点、备注也写满，最多就是 5 条', () => {
    const r = createEmptyResult()
    r.state = attachState({ mood: 5, sleep: 4, sport: 3, diet: 2 }, '还行')
    expect(countSection(r, 'state')).toBe(5)
    expect(buildOutline(r).find((e) => e.key === 'state')?.count).toBe(5)
  })

  it('成长那一栏按条数算', () => {
    const r = createEmptyResult()
    expect(countSection(r, 'growth')).toBe(0)
    r.growth = ['读完《长日将尽》', '想通了报价为什么难谈']
    expect(countSection(r, 'growth')).toBe(2)
    expect(buildOutline(r).find((e) => e.key === 'growth')?.count).toBe(2)
  })

  it('下周计划把三件重点和要跟进的人一起算', () => {
    const r = createEmptyResult()
    r.nextFocus = ['a', 'b']
    r.nextFollowUps = ['老王']
    expect(countSection(r, 'plan')).toBe(3)
  })

  it('锚点 id 稳定，能被页面直接引用', () => {
    expect(sectionDomId('things')).toBe('section-things')
    // 0.9.5 起重排、0.9.6 插入反复出现（顺序即页面顺序，见 outline.ts 的注释）
    expect(SECTION_KEYS.map(sectionDomId)).toEqual([
      'section-highlights',
      'section-plan',
      'section-events',
      'section-people',
      'section-things',
      'section-pending',
      'section-pattern',
      'section-state',
      'section-growth',
    ])
  })

  it('0.9.5：目录里主线与计划排在最前，清单卡退到后面', () => {
    expect(SECTION_KEYS.slice(0, 2)).toEqual(['highlights', 'plan'])
    expect(SECTION_KEYS.slice(2)).toEqual([
      'events',
      'people',
      'things',
      'pending',
      'pattern',
      'state',
      'growth',
    ])
  })
})

describe('滚动时判断当前是哪一块', () => {
  // offsets 是各区块相对滚动视口顶部的位置，顺序与页面一致
  const offsets = SECTION_KEYS.map((key, i) => ({ key, top: i * 300 }))

  it('没有区块时返回 null', () => {
    expect(activeSection([])).toBeNull()
  })

  it('还没开始滚时高亮最前面那一个（0.9.5 起是本周主线）', () => {
    expect(activeSection(offsets, { threshold: 60 })).toBe('highlights')
  })

  it('某一块顶到目录栏下方时，就高亮它', () => {
    // offsets 顺序：主线 0、计划 300、事情 600、人际 900、物品 1200、未办 1500…
    // 减掉 1250 之后「物品」进到 60 以内，而「未办」还在 250
    const scrolled = offsets.map((o) => ({ ...o, top: o.top - 1250 }))
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
    // -300 之后：主线 -300、计划 0、事情 300、人际 600
    expect(activeSection(scrolled, { threshold: 0 })).toBe('plan')
    expect(activeSection(scrolled, { threshold: 60 })).toBe('plan')
    expect(activeSection(scrolled, { threshold: 320 })).toBe('events')
    expect(activeSection(scrolled, { threshold: 620 })).toBe('people')
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

/**
 * 0.9.4：状态那一栏多了「追问小结」。
 * 徽标的口径不变 —— 分算几条，文字部分（备注或小结）整体再加一条。
 */
describe('目录徽标 · 状态那一条', () => {
  const stateCount = (state: WeeklyResult['state']) =>
    countSection({ ...base(), state }, 'state')

  it('只打了分：几项分算几条', () => {
    expect(stateCount(attachState({ mood: 4, sleep: 2 }, ''))).toBe(2)
  })

  it('备注与小结都算「文字那一条」，不重复计数', () => {
    expect(stateCount(attachState({ mood: 4 }, '还行'))).toBe(2)
    expect(stateCount(attachState({ mood: 4 }, '', '睡眠：想太多'))).toBe(2)
    expect(stateCount(attachState({ mood: 4 }, '还行', '睡眠：想太多'))).toBe(2)
  })

  it('什么都没有就是 0 条', () => {
    expect(stateCount(attachState(undefined, ''))).toBe(0)
    expect(stateCount(attachState(undefined, '', '   '))).toBe(0)
  })

  it('只有小结也算一条 —— 否则「聊到了但没打分」在目录里看不出来', () => {
    expect(countSection({ ...base(), state: attachState(undefined, '', '运动：挤不出时间') }, 'state')).toBe(1)
  })
})
