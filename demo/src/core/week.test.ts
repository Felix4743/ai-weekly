import { describe, expect, it } from 'vitest'
import {
  addWeeks,
  dateKey,
  dayLabel,
  daysOfWeek,
  inMonth,
  isWeekKey,
  monthLabel,
  monthOf,
  parseWeekKey,
  relationLabel,
  shiftMonth,
  startOfWeek,
  weekKeyOf,
  weekRangeText,
  weekRelation,
  weekTitle,
  weeksBetween,
  weeksInMonth,
} from './week'

/**
 * 周的计算是最容易被「差不多」糊弄过去的一层：周日算哪一周、跨年那一周怎么算、
 * 晚上十一点存的东西会不会跑到第二天去 —— 错了不会崩，只会让日历慢慢变得不可信。
 */

/** 本地时间构造，避免测试自己先掉进 UTC 的坑 */
function at(y: number, m: number, d: number, h = 12, min = 0): Date {
  return new Date(y, m - 1, d, h, min)
}

describe('周 · 一周从周一算起', () => {
  it('周一本身、以及这一周里的每一天，都归到同一个键', () => {
    // 2026-09-21 是周一，2026-09-27 是周日
    expect(weekKeyOf(at(2026, 9, 21))).toBe('2026-09-21')
    expect(weekKeyOf(at(2026, 9, 22))).toBe('2026-09-21')
    expect(weekKeyOf(at(2026, 9, 26))).toBe('2026-09-21')
    expect(weekKeyOf(at(2026, 9, 27))).toBe('2026-09-21')
  })

  it('周日算上一周，不算新的一周', () => {
    // 这是最容易写错的一条：getDay() 里周日是 0
    expect(weekKeyOf(at(2026, 9, 20))).toBe('2026-09-14')
    expect(weekKeyOf(at(2026, 9, 28))).toBe('2026-09-28')
  })

  it('晚上十一点五十九分和当天中午是同一周 —— 全程本地时间，不碰 UTC', () => {
    expect(weekKeyOf(at(2026, 9, 27, 23, 59))).toBe('2026-09-21')
    expect(weekKeyOf(at(2026, 9, 28, 0, 1))).toBe('2026-09-28')
  })

  it('startOfWeek 返回那个周一的零点', () => {
    const monday = startOfWeek(at(2026, 9, 24, 18, 30))
    expect([monday.getFullYear(), monday.getMonth() + 1, monday.getDate()]).toEqual([2026, 9, 21])
    expect([monday.getHours(), monday.getMinutes()]).toEqual([0, 0])
  })

  it('dateKey 补零，方便排序也方便直接给人看', () => {
    expect(dateKey(at(2026, 1, 5))).toBe('2026-01-05')
  })
})

describe('周 · 键的合法性', () => {
  it('只认 YYYY-MM-DD 且那天确实是周一', () => {
    expect(isWeekKey('2026-09-21')).toBe(true)
    expect(isWeekKey('2026-09-22')).toBe(false) // 周二，不是一周的起点
    expect(isWeekKey('2026-9-21')).toBe(false)
    expect(isWeekKey('2026-09-21T00:00:00Z')).toBe(false)
    expect(isWeekKey('')).toBe(false)
    expect(isWeekKey(20260921)).toBe(false)
    expect(isWeekKey(null)).toBe(false)
  })

  it('不存在的日期挡掉，而不是被 Date 悄悄滚到下个月', () => {
    expect(parseWeekKey('2026-02-31')).toBeNull()
    expect(parseWeekKey('2026-13-01')).toBeNull()
  })

  it('坏键进出都不抛异常', () => {
    expect(addWeeks('坏掉的键', 1)).toBe('坏掉的键')
    expect(weeksBetween('坏掉的键', '2026-09-21')).toBeNull()
    expect(daysOfWeek('坏掉的键')).toEqual([])
    expect(weekRangeText('坏掉的键')).toBe('')
    expect(weekTitle('坏掉的键')).toBe('')
  })
})

describe('周 · 前后挪动与跨年', () => {
  it('加一周会跨过月与年的边界', () => {
    expect(addWeeks('2025-12-29', 1)).toBe('2026-01-05')
    expect(addWeeks('2026-01-05', -1)).toBe('2025-12-29')
    expect(addWeeks('2026-09-28', 1)).toBe('2026-10-05')
  })

  it('跨年那一周仍然是完整的一周', () => {
    // 2025-12-29 是周一，这一周跨到 2026-01-04
    expect(weekRangeText('2025-12-29')).toBe('2025年12月29日 – 2026年1月4日')
    expect(daysOfWeek('2025-12-29').map(dateKey)).toEqual([
      '2025-12-29',
      '2025-12-30',
      '2025-12-31',
      '2026-01-01',
      '2026-01-02',
      '2026-01-03',
      '2026-01-04',
    ])
  })

  it('同一周里的任何一天相减都是 0 周', () => {
    expect(weeksBetween('2026-09-21', '2026-09-21')).toBe(0)
    expect(weeksBetween('2026-09-21', '2026-08-31')).toBe(-3)
    expect(weeksBetween('2026-08-31', '2026-09-21')).toBe(3)
  })

  it('日期区间的写法：同年只写月日，跨年把年份补全', () => {
    expect(weekRangeText('2026-09-21')).toBe('9月21日 – 9月27日')
    expect(weekRangeText('2026-12-28')).toBe('2026年12月28日 – 2027年1月3日')
  })
})

describe('周 · 相对说法', () => {
  const now = at(2026, 9, 30) // 周三，属于 2026-09-28 那一周

  it('本周 / 上周 / 上上周认得出来', () => {
    expect(weekRelation('2026-09-28', now)).toBe('this')
    expect(weekRelation('2026-09-21', now)).toBe('last')
    expect(weekRelation('2026-09-14', now)).toBe('twoAgo')
    expect(relationLabel(weekRelation('2026-09-21', now))).toBe('上周')
    expect(relationLabel(weekRelation('2026-09-14', now))).toBe('上上周')
  })

  it('更早的周不给相对说法，直接说日期', () => {
    expect(weekRelation('2026-09-07', now)).toBe('past')
    expect(relationLabel(weekRelation('2026-09-07', now))).toBe('')
  })

  it('未来的周不会被说成「上周」', () => {
    expect(weekRelation('2026-10-05', now)).toBe('future')
  })

  it('星期天晚上看：上周就是刚结束的那一周', () => {
    // 2026-09-27 是周日，还属于 09-21 那一周
    const sunday = at(2026, 9, 27, 22, 30)
    expect(weekRelation('2026-09-21', sunday)).toBe('this')
    expect(weekRelation('2026-09-14', sunday)).toBe('last')
  })

  it('标题在同一年里不写年份，跨年才写', () => {
    expect(weekTitle('2026-09-21', now)).toBe('9月21日这一周')
    expect(weekTitle('2025-12-29', now)).toBe('2025年12月29日这一周')
  })
})

describe('周 · 月历', () => {
  it('一个月画出来的都是整周，从周一开始', () => {
    const weeks = weeksInMonth({ year: 2026, month: 8 }) // 2026 年 9 月
    expect(weeks).toEqual([
      '2026-08-31',
      '2026-09-07',
      '2026-09-14',
      '2026-09-21',
      '2026-09-28',
    ])
  })

  it('需要六行的时候就是六行，不会被截断', () => {
    // 2026 年 8 月：1 号是周六、31 号是周一，正好铺满六周
    const weeks = weeksInMonth({ year: 2026, month: 7 })
    expect(weeks).toHaveLength(6)
    expect(weeks[0]).toBe('2026-07-27')
    expect(weeks[5]).toBe('2026-08-31')
  })

  it('二月的行数也跟着算对', () => {
    const weeks = weeksInMonth({ year: 2026, month: 1 })
    expect(weeks[0]).toBe('2026-01-26')
    expect(weeks[weeks.length - 1]).toBe('2026-02-23')
  })

  it('翻月份会跨年', () => {
    expect(shiftMonth({ year: 2026, month: 11 }, 1)).toEqual({ year: 2027, month: 0 })
    expect(shiftMonth({ year: 2026, month: 0 }, -1)).toEqual({ year: 2025, month: 11 })
    expect(monthLabel(shiftMonth(monthOf(at(2026, 12, 15)), 1))).toBe('2027年1月')
  })

  it('补齐的那几天能被认出来，界面上要画淡', () => {
    const ref = { year: 2026, month: 8 }
    expect(inMonth(new Date(2026, 8, 1), ref)).toBe(true)
    expect(inMonth(new Date(2026, 7, 31), ref)).toBe(false)
    expect(inMonth(new Date(2026, 9, 1), ref)).toBe(false)
  })

  it('dayLabel 是「几月几日」', () => {
    expect(dayLabel(new Date(2026, 8, 1))).toBe('9月1日')
  })
})
