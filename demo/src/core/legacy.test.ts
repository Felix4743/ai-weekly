import { describe, expect, it } from 'vitest'
import { coerceResult, createEmptyLegacyResult, legacyToReview } from './legacy'
import { createEmptyReview, isReviewEmpty } from './review'

/**
 * 0.8 那套四栏结果还留在旧归档里，读它的时候不能因为一个字段变了形状就把整周丢掉；
 * 迁到新版复盘时又要克制 —— 只有能对上号的才迁，人际与物品硬塞进去只会更乱。
 */

describe('旧结果 · coerceResult 读七栏', () => {
  it('不是对象就给 null（数组也不算对象）', () => {
    expect(coerceResult(null)).toBeNull()
    expect(coerceResult(undefined)).toBeNull()
    expect(coerceResult('事情：写周报')).toBeNull()
    expect(coerceResult(42)).toBeNull()
    expect(coerceResult([])).toBeNull()
  })

  it('空对象给七栏全空的结果', () => {
    expect(coerceResult({})).toEqual(createEmptyLegacyResult())
  })

  it('英文键照收', () => {
    expect(
      coerceResult({
        events: ['写周报'],
        people: [{ name: '小明', note: '聊了报价' }],
        things: ['打印机'],
        pending: ['报价还没发'],
        highlights: ['主线是报价'],
        nextFocus: ['把合同发出去'],
        nextFollowUps: ['跟进小明'],
      }),
    ).toEqual({
      events: ['写周报'],
      people: [{ name: '小明', note: '聊了报价' }],
      things: ['打印机'],
      pending: ['报价还没发'],
      highlights: ['主线是报价'],
      nextFocus: ['把合同发出去'],
      nextFollowUps: ['跟进小明'],
    })
  })

  it('0.8 的中文键照收', () => {
    expect(
      coerceResult({
        事情: ['写周报'],
        人际: [{ 谁: '小明', 备注: '聊了报价' }],
        物品: ['打印机'],
        未办: ['报价还没发'],
        本周主线: ['主线是报价'],
        下周重点: ['把合同发出去'],
        要跟进的人: ['跟进小明'],
      }),
    ).toEqual({
      events: ['写周报'],
      people: [{ name: '小明', note: '聊了报价' }],
      things: ['打印机'],
      pending: ['报价还没发'],
      highlights: ['主线是报价'],
      nextFocus: ['把合同发出去'],
      nextFollowUps: ['跟进小明'],
    })
  })

  it('同一栏的别名也认（事件 / 悬而未决 / 本周热点）', () => {
    const legacy = coerceResult({
      事件: ['写周报'],
      悬而未决: ['报价还没发'],
      本周热点: ['主线是报价'],
      下周焦点: ['把合同发出去'],
    })
    expect(legacy?.events).toEqual(['写周报'])
    expect(legacy?.pending).toEqual(['报价还没发'])
    expect(legacy?.highlights).toEqual(['主线是报价'])
    expect(legacy?.nextFocus).toEqual(['把合同发出去'])
  })

  it('整栏只给了一个字符串时也算一条', () => {
    expect(coerceResult({ events: '写周报' })?.events).toEqual(['写周报'])
    expect(coerceResult({ pending: '报价还没发' })?.pending).toEqual(['报价还没发'])
  })

  it('数字与布尔被当成文字，空白项丢掉', () => {
    expect(coerceResult({ events: [1, true, '  ', null, ' 写周报 '] })?.events).toEqual([
      '1',
      'true',
      '写周报',
    ])
  })

  it('人际收到纯字符串时只有名字，没有备注', () => {
    expect(coerceResult({ people: ['小明'] })?.people).toEqual([{ name: '小明', note: '' }])
  })

  it('人际里没有名字的条目跳过', () => {
    expect(coerceResult({ people: [{ note: '聊了报价' }, null, 1, { name: '  ' }] })?.people).toEqual(
      [],
    )
  })

  it('一栏坏掉不影响别的栏', () => {
    const legacy = coerceResult({ events: null, pending: ['报价还没发'], things: 42 })
    expect(legacy?.events).toEqual([])
    expect(legacy?.pending).toEqual(['报价还没发'])
    // 单个数字也被当文字收下来
    expect(legacy?.things).toEqual(['42'])
  })
})

describe('旧结果 · legacyToReview 只迁能对上号的', () => {
  it('主线排在最前面，事情跟在后面', () => {
    const review = legacyToReview({
      ...createEmptyLegacyResult(),
      highlights: ['主线是报价'],
      events: ['写周报', '见客户'],
    })
    expect(review.did).toEqual(['主线是报价', '写周报', '见客户'])
  })

  it('主线与事情里重复的一条只留一次，位置按先出现的算', () => {
    const review = legacyToReview({
      ...createEmptyLegacyResult(),
      highlights: ['写周报'],
      events: ['写周报', '见客户'],
    })
    expect(review.did).toEqual(['写周报', '见客户'])
  })

  it('去重只做 trim：大小写与中间空格不同仍算不同条目', () => {
    const review = legacyToReview({
      ...createEmptyLegacyResult(),
      events: ['Fix Bug', 'fix bug', '写 周报', '写  周报', ' 写周报 '],
    })
    expect(review.did).toEqual(['Fix Bug', 'fix bug', '写 周报', '写  周报', '写周报'])
  })

  it('未办变成问题：没有建议，也没有跨周标签', () => {
    const review = legacyToReview({
      ...createEmptyLegacyResult(),
      pending: ['报价还没发', '报价还没发'],
    })
    expect(review.issues).toEqual([{ text: '报价还没发', advice: [], key: '' }])
  })

  it('下周重点与下周跟进合成计划，when 一律空', () => {
    const review = legacyToReview({
      ...createEmptyLegacyResult(),
      nextFocus: ['把合同发出去'],
      nextFollowUps: ['跟进小明'],
    })
    expect(review.plan).toEqual([
      { text: '把合同发出去', when: '' },
      { text: '跟进小明', when: '' },
    ])
  })

  it('人际与物品不迁移', () => {
    const review = legacyToReview({
      ...createEmptyLegacyResult(),
      people: [{ name: '小明', note: '聊了报价' }],
      things: ['打印机'],
      events: ['写周报'],
    })
    expect(review.did).toEqual(['写周报'])
    const text = JSON.stringify(review)
    expect(text).not.toContain('小明')
    expect(text).not.toContain('聊了报价')
    expect(text).not.toContain('打印机')
  })

  it('对账、总结、提醒这几栏一律空', () => {
    const review = legacyToReview({
      ...createEmptyLegacyResult(),
      highlights: ['主线是报价'],
      pending: ['报价还没发'],
      nextFocus: ['把合同发出去'],
    })
    expect(review.headline).toBe('')
    expect(review.reconcile).toEqual([])
    expect(review.nudge).toBe('')
  })

  it('空的一份迁出来就是空复盘', () => {
    expect(legacyToReview(createEmptyLegacyResult())).toEqual(createEmptyReview())
  })

  it('只有人际与物品时，迁出来仍是「什么都没写出来」', () => {
    const review = legacyToReview({
      ...createEmptyLegacyResult(),
      people: [{ name: '小明', note: '聊了报价' }],
      things: ['打印机'],
    })
    expect(isReviewEmpty(review)).toBe(true)
  })

  it('不修改传进来的旧结果', () => {
    const legacy = {
      ...createEmptyLegacyResult(),
      highlights: ['主线是报价'],
      events: ['写周报'],
      pending: ['报价还没发'],
    }
    const before = JSON.parse(JSON.stringify(legacy))
    legacyToReview(legacy)
    expect(legacy).toEqual(before)
  })
})
