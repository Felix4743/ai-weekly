import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { WeekEntry } from '../core/archive'
import { createEmptyResult, type WeeklyResult } from '../core/types'
import { addWeeks, monthLabel, monthOf, weekKeyOf, weekRangeText } from '../core/week'
import { HistoryPage } from './HistoryPage'

/**
 * 总览页的渲染冒烟。
 *
 * 它不点任何东西，只把页面真渲染一遍 —— 但这一遍能拦住的问题不少：
 * 日历的行列算错、近三周的位置对不上、「没记录的那一周」被跳过、
 * 以及最要命的一种：整页在白屏（组件里有个 undefined 就够）。
 *
 * 「现在」用的是真实今天，所以断言全都相对今天算，不写死日期 ——
 * 写死日期的测试会在某一天突然变红，然后被人顺手改掉，等于白写。
 */

const NOW = new Date()
const THIS_WEEK = weekKeyOf(NOW)
const LAST_WEEK = addWeeks(THIS_WEEK, -1)
const TWO_AGO = addWeeks(THIS_WEEK, -2)

function result(overrides: Partial<WeeklyResult> = {}): WeeklyResult {
  return { ...createEmptyResult(), ...overrides }
}

function entry(week: string, overrides: Partial<WeeklyResult> = {}): WeekEntry {
  return { week, savedAt: NOW.getTime(), result: result(overrides) }
}

function render(archive: WeekEntry[]) {
  return renderToStaticMarkup(
    createElement(HistoryPage, {
      archive,
      onArchiveChange: () => {},
      onBack: () => {},
      onStart: () => {},
    }),
  )
}

describe('总览页渲染', () => {
  it('一份记录都没有时照常打开，说清楚现在是什么状态', () => {
    const html = render([])
    expect(html).toContain('总览')
    expect(html).toContain('还没有记录')
    expect(html).toContain('没留下记录')
    // 日历本身还在，只是没有一行是实心的
    expect(html).toContain(monthLabel(monthOf(NOW)))
    expect(html).not.toContain('全部记录')
  })

  it('上周与上上周的主线直接摆在最上面', () => {
    const html = render([
      entry(LAST_WEEK, { highlights: ['上周被报价拖着走'] }),
      entry(TWO_AGO, { highlights: ['上上周在收尾老项目'] }),
    ])
    expect(html).toContain('上周')
    expect(html).toContain('上上周')
    expect(html).toContain('上周被报价拖着走')
    expect(html).toContain('上上周在收尾老项目')
    expect(html).toContain(weekRangeText(LAST_WEEK))
    expect(html).toContain('全部记录')
  })

  it('本周有记录时：详情里就是这一周的全文，四栏照旧默认收起', () => {
    const html = render([
      entry(THIS_WEEK, {
        highlights: ['这周基本在补债'],
        events: ['把积压的评审都过了'],
        pending: ['报销还没交'],
      }),
    ])
    expect(html).toContain('这周基本在补债')
    expect(html).toContain('事情 1')
    expect(html).toContain('aria-expanded="false"')
    // 收起态：条目本身不出现在首屏 HTML 里
    expect(html).not.toContain('把积压的评审都过了')
    expect(html).not.toContain('报销还没交')
  })

  it('本周还没记录时不装作有，给的是「现在聊一聊」', () => {
    const html = render([entry(LAST_WEEK, { highlights: ['上周的事'] })])
    expect(html).toContain('这周还没聊')
    expect(html).toContain('现在聊一聊')
    expect(html).toContain('这一周还没聊过')
  })

  it('日历里记过的那几行是实心的，没记的是空的', () => {
    const html = render([entry(THIS_WEEK, { highlights: ['有记录'] })])
    // 当月的每一周都画出来了（一行不落），记过的那行带 has-entry
    expect(html).toContain('cal-row has-entry')
    expect((html.match(/cal-row/g) ?? []).length).toBeGreaterThanOrEqual(4)
  })

  it('主线一句都没有时照实说，不显示空白卡片', () => {
    const html = render([entry(THIS_WEEK)])
    expect(html).toContain('（这一周没写主线）')
  })
})
