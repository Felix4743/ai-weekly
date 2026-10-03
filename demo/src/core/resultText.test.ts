import { describe, expect, it } from 'vitest'
import { resultToMarkdown } from './resultText'
import { attachState } from './stateScore'
import { createEmptyResult, createEmptyState, type WeeklyResult } from './types'

const FULL: WeeklyResult = {
  // 从空结果起手再覆盖：以后再加一栏时，这里不用跟着一条条补
  ...createEmptyResult(),
  events: ['改了三版方案，还没定'],
  people: [{ name: '老王', note: '方案卡在他那儿没拍板' }],
  things: ['想换键盘，挑了半个月没定'],
  pending: ['报销拖了两周没交'],
  growth: ['把《长日将尽》读完了', '想通了报价为什么难谈'],
  state: attachState({ mood: 2, sleep: 4 }, '这周一直悬着'),
  highlights: ['方案难产是这周主线'],
  nextFocus: ['推动方案定稿', '联系老王', '留出整块时间'],
  nextFollowUps: ['老王'],
}

const EMPTY: WeeklyResult = createEmptyResult()

/** 「状态」那一节：从它的小标题切到下一节为止，只看它自己的内容 */
function stateSection(md: string): string {
  return md.split('## 状态')[1].split('## 本周主线')[0]
}

describe('结果导出为 Markdown', () => {
  it('包含全部章节标题', () => {
    const md = resultToMarkdown(FULL)
    expect(md).toContain('# 本周梳理')
    expect(md).toContain('## 本周清单')
    expect(md).toContain('## 状态')
    expect(md).toContain('## 本周主线')
    expect(md).toContain('## 下周计划')
    expect(md).toContain('**事**')
    expect(md).toContain('**人**')
    expect(md).toContain('**未办**')
    expect(md).toContain('**物品**')
    expect(md).toContain('**成长**')
    expect(md).toContain('**三件重点**')
    expect(md).toContain('**要跟进的人**')
  })

  it('成长一节排在物品之后、状态之前', () => {
    const md = resultToMarkdown(FULL)
    expect(md.indexOf('**物品**')).toBeLessThan(md.indexOf('**成长**'))
    expect(md.indexOf('**成长**')).toBeLessThan(md.indexOf('## 状态'))
    expect(md).toContain('- 把《长日将尽》读完了')
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
      ...FULL.growth,
      ...FULL.highlights,
      ...FULL.nextFocus,
    ]) {
      expect(md).toContain(item)
    }
  })

  it('状态一节只列打过分的项，一行一项带分数', () => {
    const md = resultToMarkdown(FULL)
    const section = stateSection(md)
    expect(section).toContain('- 心情：2 / 5')
    expect(section).toContain('- 睡眠：4 / 5')
    // 没打分的那两项不出现在稿子里
    expect(section).not.toContain('运动')
    expect(section).not.toContain('饮食')
  })

  it('备注原文另起一段引用，前后空白被剪掉', () => {
    const md = resultToMarkdown({
      ...FULL,
      state: attachState({ mood: 3 }, '  这周一直悬着  '),
    })
    expect(stateSection(md)).toContain('> 这周一直悬着')
    // 引用段前留一个空行，粘到别处不会跟上面的列表黏成一条
    expect(stateSection(md)).toContain('\n\n> 这周一直悬着')
  })

  it('一项分都没点就留一个占位，也不多出引用段', () => {
    const md = resultToMarkdown({ ...FULL, state: createEmptyState() })
    const section = stateSection(md)
    expect(section).toContain('- （无）')
    expect(section).not.toContain('- 心情：')
    expect(section).not.toContain('> ')
  })

  it('只点了分、没写备注：有分的行在，没有引用段', () => {
    const md = resultToMarkdown({ ...FULL, state: attachState({ diet: 5 }, '') })
    const section = stateSection(md)
    expect(section).toContain('- 饮食：5 / 5')
    expect(section).not.toContain('- （无）')
    expect(section).not.toContain('> ')
  })

  it('只写了备注、一项分没点：占位和备注都在', () => {
    const md = resultToMarkdown({ ...FULL, state: attachState(undefined, '这周还行') })
    const section = stateSection(md)
    expect(section).toContain('- （无）')
    expect(section).toContain('> 这周还行')
  })

  it('老结果没有 state 这一栏也不崩，状态一节给占位', () => {
    const legacy = { ...FULL } as Partial<WeeklyResult>
    delete legacy.state
    const md = resultToMarkdown(legacy as WeeklyResult)
    expect(md).toContain('## 状态')
    expect(stateSection(md)).toContain('- （无）')
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
