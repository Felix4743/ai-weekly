import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { WeekEntry } from '../core/archive'
import { stampText } from '../core/recency'
import { attachState } from '../core/stateScore'
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

function entry(
  week: string,
  overrides: Partial<WeeklyResult> = {},
  savedAt: number = NOW.getTime(),
): WeekEntry {
  return { week, savedAt, result: result(overrides) }
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

/**
 * 从整页 HTML 里切出某一栏那张卡（截到下一栏为止），单看它的先后与徽标。
 * `nextKey` 可以省略 —— 0.9.5 起「成长」是最后一栏，后面没有别的区了。
 */
function cardHtml(html: string, key: string, nextKey?: string) {
  const start = html.indexOf(`id="section-${key}"`)
  expect(start).toBeGreaterThanOrEqual(0)
  if (!nextKey) return html.slice(start)
  const end = html.indexOf(`id="section-${nextKey}"`)
  expect(end).toBeGreaterThan(start)
  return html.slice(start, end)
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

  it('本周有记录时：详情里就是这一周的全文，六栏照旧默认收起', () => {
    const html = render([
      entry(THIS_WEEK, {
        highlights: ['这周基本在补债'],
        events: ['把积压的评审都过了'],
        pending: ['报销还没交'],
        growth: ['读完了《长日将尽》'],
        state: attachState({ mood: 4, sleep: 2 }, '睡得还行'),
      }),
    ])
    expect(html).toContain('这周基本在补债')
    expect(html).toContain('事情 1')
    // 六栏（含 0.9.1 的状态、0.9.3 的成长）都是收起态
    expect(html.match(/aria-expanded="false"/g)).toHaveLength(6)
    // 收起态：条目本身不出现在首屏 HTML 里
    expect(html).not.toContain('把积压的评审都过了')
    expect(html).not.toContain('报销还没交')
    expect(html).not.toContain('读完了《长日将尽》')
    expect(html).not.toContain('睡得还行')
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

  it('写着「上次记录 多久以前」，鼠标停上去能看到具体时刻', () => {
    const at = NOW.getTime() - 3 * 24 * 60 * 60 * 1000
    const html = render([entry(THIS_WEEK, { highlights: ['有记录'] }, at)])
    expect(html).toContain('上次记录')
    expect(html).toContain('3 天前')
    expect(html).toContain(stampText(at)) // title 里的绝对时刻
  })

  it('「上次记录」按最近一次写入算，不是按最近的那一周', () => {
    // 上周那一份是两小时前改的，本周那一份是五天前写的
    const html = render([
      entry(LAST_WEEK, { highlights: ['上周的事'] }, NOW.getTime() - 2 * 60 * 60 * 1000),
      entry(THIS_WEEK, { highlights: ['本周的事'] }, NOW.getTime() - 5 * 24 * 60 * 60 * 1000),
    ])
    expect(html).toContain('上次记录 2 小时前')
    expect(html).not.toContain('5 天前')
  })

  it('归档为空时不编一个「上次记录」出来', () => {
    expect(render([])).not.toContain('上次记录')
  })
})

describe('总览页 · 状态与成长卡（0.9.1 状态 / 0.9.3 成长）', () => {
  it('看存档时也是同一套顺序：主线与计划在前，状态在未办之后、成长之前', () => {
    const html = render([entry(THIS_WEEK, { pending: ['报销还没交'] })])
    const plan = html.indexOf('id="section-plan"')
    const pending = html.indexOf('id="section-pending"')
    const state = html.indexOf('id="section-state"')
    const growth = html.indexOf('id="section-growth"')
    const highlights = html.indexOf('id="section-highlights"')
    expect(highlights).toBeGreaterThanOrEqual(0)
    // 总览页与结果页共用 ResultBody，所以顺序必须一起变（0.9.5 重排）
    expect(highlights).toBeLessThan(plan)
    expect(plan).toBeLessThan(pending)
    expect(pending).toBeLessThan(state)
    expect(state).toBeLessThan(growth)
  })

  it('打了两项分、写了一条备注，卡上数字是 3', () => {
    const html = render([
      entry(THIS_WEEK, {
        highlights: ['有记录'],
        state: attachState({ mood: 4, sleep: 2 }, '睡得还行'),
      }),
    ])
    expect(html).toContain('状态')
    expect(cardHtml(html, 'state', 'growth')).toContain('card-count">3')
  })

  it('一项分没点、备注也空着时不显示数字，卡片本身照旧在', () => {
    const html = render([entry(THIS_WEEK, { highlights: ['有记录'] })])
    expect(cardHtml(html, 'state', 'growth')).not.toContain('card-count')
    expect(html).toContain('id="section-state"')
  })

  it('看存档时成长卡也在，条数对得上', () => {
    const html = render([
      entry(THIS_WEEK, { highlights: ['有记录'], growth: ['读完《长日将尽》'] }),
    ])
    expect(cardHtml(html, 'growth')).toContain('card-count">1')
  })
})
