import { describe, expect, it } from 'vitest'
import { resultToMarkdown } from './resultText'
import type { WeeklyResult } from './types'

const FULL: WeeklyResult = {
  events: ['改了三版方案，还没定'],
  people: [{ name: '老王', note: '方案卡在他那儿没拍板' }],
  things: ['想换键盘，挑了半个月没定'],
  pending: ['报销拖了两周没交'],
  highlights: ['方案难产是这周主线'],
  nextFocus: ['推动方案定稿', '联系老王', '留出整块时间'],
  nextFollowUps: ['老王'],
}

const EMPTY: WeeklyResult = {
  events: [],
  people: [],
  things: [],
  pending: [],
  highlights: [],
  nextFocus: [],
  nextFollowUps: [],
}

describe('结果导出为 Markdown', () => {
  it('包含全部章节标题', () => {
    const md = resultToMarkdown(FULL)
    expect(md).toContain('# 本周梳理')
    expect(md).toContain('## 本周清单')
    expect(md).toContain('## 本周热点')
    expect(md).toContain('## 下周计划')
    expect(md).toContain('**事**')
    expect(md).toContain('**人**')
    expect(md).toContain('**悬着**')
    expect(md).toContain('**物品**')
    expect(md).toContain('**三件重点**')
    expect(md).toContain('**要跟进的人**')
  })

  it('把人名和备注渲染成一条', () => {
    const md = resultToMarkdown(FULL)
    expect(md).toContain('- 老王 — 方案卡在他那儿没拍板')
  })

  it('热点第一条标成「主线」，其余仍是一条条列出来', () => {
    const md = resultToMarkdown({
      ...FULL,
      highlights: ['这周基本被客户方案拖着', '改了三版还没定', '跟产品吵了一架'],
    })
    expect(md).toContain('**主线**：这周基本被客户方案拖着')
    expect(md).toContain('- 改了三版还没定')
    expect(md).toContain('- 跟产品吵了一架')
    // 主线不该又被当成普通条目列一遍
    expect(md).not.toContain('- 这周基本被客户方案拖着')
  })

  it('只有一条热点时就是主线本身，不出现悬空的列表', () => {
    const md = resultToMarkdown({ ...FULL, highlights: ['这周只有一件事'] })
    expect(md).toContain('**主线**：这周只有一件事')
    expect(md).not.toContain('- 这周只有一件事')
  })

  it('没有备注的人名只渲染名字', () => {
    const md = resultToMarkdown({ ...FULL, people: [{ name: '小李', note: '' }] })
    expect(md).toContain('- 小李')
    expect(md).not.toContain('- 小李 —')
  })

  it('内容原样写入，不丢条目', () => {
    const md = resultToMarkdown(FULL)
    for (const item of [
      ...FULL.events,
      ...FULL.things,
      ...FULL.pending,
      ...FULL.highlights,
      ...FULL.nextFocus,
    ]) {
      expect(md).toContain(item)
    }
  })

  it('空结果用占位符而不是空白，保证可复制', () => {
    const md = resultToMarkdown(EMPTY)
    expect(md).toContain('（无）')
    expect(md.split('\n').length).toBeGreaterThan(10)
  })

  it('始终以一级标题开头，便于直接粘贴', () => {
    expect(resultToMarkdown(FULL).startsWith('# 本周梳理')).toBe(true)
    expect(resultToMarkdown(EMPTY).startsWith('# 本周梳理')).toBe(true)
  })
})
