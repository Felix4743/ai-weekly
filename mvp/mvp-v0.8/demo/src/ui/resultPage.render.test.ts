import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { ChatMessage, WeeklyResult } from '../core/types'
import { ResultPage } from './ResultPage'

const result: WeeklyResult = {
  events: ['改了三版方案'],
  people: [{ name: '老王', note: '卡在他那儿' }],
  things: ['买了个键盘'],
  pending: ['报销拖了两周'],
  highlights: ['这周基本被方案拖着', '累的来源是等和反复'],
  nextFocus: ['推动定稿'],
  nextFollowUps: ['老王'],
}

function render() {
  return renderToStaticMarkup(
    createElement(ResultPage, {
      result,
      messages: [] as ChatMessage[],
      restored: false,
      refining: false,
      week: '2026-09-21',
      onResultChange: () => {},
      onRefine: () => {},
      onRestart: () => {},
      onBack: () => {},
      onOpenHistory: () => {},
    }),
  )
}

describe('结果页渲染（临时校验）', () => {
  it('目录与标题用的是新名字', () => {
    const html = render()
    for (const label of ['事情', '人际', '物品', '未办', '本周主线', '下周计划']) {
      expect(html).toContain(label)
    }
    expect(html).not.toContain('悬着')
    expect(html).not.toContain('本周热点')
  })

  it('四栏默认收起：条目不在首屏 HTML 里，且标记为未展开', () => {
    const html = render()
    expect(html).not.toContain('改了三版方案')
    expect(html).not.toContain('报销拖了两周')
    expect(html).not.toContain('卡在他那儿')
    expect(html).not.toContain('买了个键盘')
    expect(html).toContain('aria-expanded="false"')
    expect(html).toContain('展开')
  })

  it('主线与下周计划照常展开，条数徽标在', () => {
    const html = render()
    expect(html).toContain('这周基本被方案拖着')
    expect(html).toContain('推动定稿')
    expect(html).toContain('老王')
    // 事情 1 条、物品 1 条这样的徽标
    expect(html).toContain('card-count')
  })

  it('写清了这份结果记在哪一周，并且有去总览的入口', () => {
    const html = render()
    expect(html).toContain('记在 9月21日 – 9月27日')
    expect(html).toContain('看总览')
  })
})
