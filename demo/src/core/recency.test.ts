import { describe, expect, it } from 'vitest'
import { stampText, timeAgo } from './recency'

/**
 * 「多久以前」最容易出的问题是边界：59 分钟和 61 分钟掉进不同的档、
 * 刚好两周时显示成「14 天前」还是「2 周前」。所以这里每条边界都钉死。
 */

const NOW = new Date(2026, 8, 29, 20, 0, 0).getTime() // 2026-09-29 20:00
const ago = (ms: number) => timeAgo(NOW - ms, NOW)

const MIN = 60_000
const HOUR = 60 * MIN
const DAY = 24 * HOUR

describe('多久以前', () => {
  it('一分钟以内是「刚刚」', () => {
    expect(ago(0)).toBe('刚刚')
    expect(ago(59_000)).toBe('刚刚')
  })

  it('分钟档', () => {
    expect(ago(MIN)).toBe('1 分钟前')
    expect(ago(59 * MIN)).toBe('59 分钟前')
  })

  it('小时档', () => {
    expect(ago(HOUR)).toBe('1 小时前')
    expect(ago(23 * HOUR)).toBe('23 小时前')
  })

  it('天档：满 24 小时就是「1 天前」，不按日历天算', () => {
    expect(ago(DAY)).toBe('1 天前')
    expect(ago(13 * DAY)).toBe('13 天前')
  })

  it('满两周换成「周前」，不足两周不给周的说法', () => {
    expect(ago(14 * DAY - 1)).toBe('13 天前')
    expect(ago(14 * DAY)).toBe('2 周前')
    expect(ago(55 * DAY)).toBe('7 周前')
  })

  it('满八周换成「个月前」', () => {
    expect(ago(56 * DAY)).toBe('1 个月前')
    expect(ago(200 * DAY)).toBe('6 个月前')
  })

  it('满一年换成「年前」', () => {
    expect(ago(365 * DAY)).toBe('1 年前')
    expect(ago(800 * DAY)).toBe('2 年前')
  })

  it('时间戳在将来、或者是脏数据时，说的是「刚刚」而不是负数', () => {
    // 系统时钟被改过、或者存档里混进了脏数据时会出现
    expect(timeAgo(NOW + 5 * DAY, NOW)).toBe('刚刚')
    expect(timeAgo(Number.NaN, NOW)).toBe('')
    expect(timeAgo(Number.POSITIVE_INFINITY, NOW)).toBe('')
  })

  it('跨过一整天也还是按流逝的时间说', () => {
    // 写于昨天 23:00，现在 20:00 —— 差 21 小时，说「21 小时前」
    expect(timeAgo(new Date(2026, 8, 28, 23).getTime(), NOW)).toBe('21 小时前')
    // 写于前天 23:00 —— 差 45 小时，跨了两个日历日，但只说「1 天前」
    expect(timeAgo(new Date(2026, 8, 27, 23).getTime(), NOW)).toBe('1 天前')
  })
})

describe('具体时刻的写法', () => {
  it('月日 + 时:分，都补零', () => {
    expect(stampText(new Date(2026, 8, 26, 20, 42).getTime())).toBe('9月26日 20:42')
    expect(stampText(new Date(2026, 0, 5, 9, 7).getTime())).toBe('1月5日 09:07')
  })

  it('脏数据返回空串，不显示成 1970 年', () => {
    expect(stampText(Number.NaN)).toBe('')
  })
})
