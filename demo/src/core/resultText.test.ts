import { describe, expect, it } from 'vitest'
import { resultToMarkdown } from './resultText'
import { createEmptyResult, type WeeklyResult } from './types'

const FULL: WeeklyResult = {
  // 从空结果起手再覆盖：以后再加一栏时，这里不用跟着一条条补
  ...createEmptyResult(),
  events: ['改了三版方案，还没定'],
  people: [{ name: '老王', note: '方案卡在他那儿没拍板' }],
  things: ['想换键盘，挑了半个月没定'],
  pending: ['报销拖了两周没交'],
  state: { body: '睡得还行', mood: '这周一直悬着', focus: '上午最好', growth: '读了半本书' },
  highlights: ['方案难产是这周主线'],
  nextFocus: ['推动方案定稿', '联系老王', '留出整块时间'],
  nextFollowUps: ['老王'],
}

const EMPTY: WeeklyResult = createEmptyResult()

describe('结果导出为 Markdown', () => {
  it('包含全部章节标题', () => {
    const md = resultToMarkdown(FULL)
    expect(md).toContain('# 本周梳理')
    expect(md).toContain('## 本周清单')
    expect(md).toContain('## 本周主线')
    expect(md).toContain('## 下周计划')
    expect(md).toContain('**事**')
    expect(md).toContain('**人**')
    expect(md).toContain('**未办**')
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

  it('状态四项写进「状态」一节，一行一项', () => {
    const md = resultToMarkdown(FULL)
    expect(md).toContain('## 状态')
    expect(md).toContain('- 身体：睡得还行')
    expect(md).toContain('- 情绪：这周一直悬着')
    expect(md).toContain('- 精力：上午最好')
    expect(md).toContain('- 心智：读了半本书')
  })

  it('状态四项都没写时留一个占位，不留空标题', () => {
    const md = resultToMarkdown({ ...FULL, state: { body: '', mood: '  ', focus: '', growth: '' } })
    const section = md.split('## 状态')[1].split('## 本周主线')[0]
    expect(section).toContain('- （无）')
    expect(section).not.toContain('- 身体：')
  })

  it('老结果没有 state 这一栏也不崩，状态一节给占位', () => {
    const legacy = { ...FULL } as Partial<WeeklyResult>
    delete legacy.state
    const md = resultToMarkdown(legacy as WeeklyResult)
    expect(md).toContain('## 状态')
    expect(md.split('## 状态')[1].split('## 本周主线')[0]).toContain('- （无）')
  })

  it('点过星的那几项，分数跟在文字后面', () => {
    const md = resultToMarkdown({
      ...FULL,
      state: { ...FULL.state, scores: { body: 4, growth: 5 } },
    })
    expect(md).toContain('- 身体：睡得还行（4 / 5）')
    expect(md).toContain('- 心智：读了半本书（5 / 5）')
    // 没打分的那两项不硬编一个分
    expect(md).toContain('- 情绪：这周一直悬着')
    expect(md).toContain('- 精力：上午最好')
    expect(md).not.toContain('- 情绪：这周一直悬着（')
  })

  it('只点了星、一个字没写的那项也留在导出的稿子里', () => {
    const md = resultToMarkdown({
      ...FULL,
      state: { body: '', mood: '  ', focus: '', growth: '', scores: { mood: 3 } },
    })
    const section = md.split('## 状态')[1].split('## 本周主线')[0]
    expect(section).toContain('- 情绪：3 / 5')
    expect(section).not.toContain('- （无）')
    // 既没文字也没分的那几项不出现
    expect(section).not.toContain('- 身体：')
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
