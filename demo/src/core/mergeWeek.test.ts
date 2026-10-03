import { describe, expect, it } from 'vitest'
import {
  hasWeekContent,
  mergeNewFirst,
  mergePeopleNewFirst,
  mergeWeekResult,
  recapLines,
} from './mergeWeek'
import { createEmptyResult, createEmptyState } from './types'
import type { PersonNote, WeeklyResult } from './types'

/**
 * 一周里聊第二次的合并（0.9.3）。
 *
 * 用户在讨论里定的是「接着上次补，并进同一份」：归档同一周只有一条，
 * 所以第二次梳理生成时要把两份并起来，而不是覆盖。这里钉住三类规矩 ——
 * 清单并集新的在前、主线与计划新的优先、状态以新一轮为准。
 */

function result(patch: Partial<WeeklyResult> = {}): WeeklyResult {
  return { ...createEmptyResult(), ...patch }
}

const person = (name: string, note = ''): PersonNote => ({ name, note })

describe('mergeNewFirst', () => {
  it('新的排前面，旧的接在后面', () => {
    expect(mergeNewFirst(['旧的'], ['新的'])).toEqual(['新的', '旧的'])
  })

  it('内容一样只留一条（新的那份的写法），空串一律丢掉', () => {
    expect(mergeNewFirst(['  把方案改完  ', ''], ['把方案改完', '  '])).toEqual(['把方案改完'])
  })

  it('两边都没有就是空数组', () => {
    expect(mergeNewFirst([], [])).toEqual([])
  })
})

describe('mergePeopleNewFirst', () => {
  it('人名当去重键：新一轮的人在前面，备注跟着自己那条走', () => {
    const current = [person('老王', '方案卡在他那儿'), person('小李', '帮我顶了两天班')]
    const incoming = [person('小李', '请他吃了顿饭'), person('张总', '没敢开口')]
    expect(mergePeopleNewFirst(current, incoming)).toEqual([
      person('小李', '请他吃了顿饭'),
      person('张总', '没敢开口'),
      person('老王', '方案卡在他那儿'),
    ])
  })

  it('名字是空的丢掉', () => {
    expect(mergePeopleNewFirst([person('老王')], [person('  ')])).toEqual([person('老王')])
  })
})

describe('mergeWeekResult', () => {
  it('这周之前没记录：原样返回新一轮那份', () => {
    const fresh = result({ events: ['改方案'] })
    expect(mergeWeekResult(fresh, null)).toBe(fresh)
    expect(mergeWeekResult(fresh, undefined)).toBe(fresh)
  })

  it('清单并集：新的在前，旧的照样留着', () => {
    const previous = result({
      events: ['上周写的方案'],
      people: [person('老王')],
      things: ['买了个键盘'],
      pending: ['报销还没交'],
      growth: ['看了本讲定价的书'],
    })
    const fresh = result({
      events: ['这周改的三版方案'],
      people: [person('小李')],
      things: ['续了云盘会员'],
      pending: ['数据还没导'],
      growth: ['跟小李聊出交接流程要改'],
    })
    const merged = mergeWeekResult(fresh, previous)
    expect(merged.events).toEqual(['这周改的三版方案', '上周写的方案'])
    expect(merged.people.map((p) => p.name)).toEqual(['小李', '老王'])
    expect(merged.things).toEqual(['续了云盘会员', '买了个键盘'])
    expect(merged.pending).toEqual(['数据还没导', '报销还没交'])
    expect(merged.growth).toEqual(['跟小李聊出交接流程要改', '看了本讲定价的书'])
  })

  it('同一件事在两次里都说了：只留一条，用新的写法', () => {
    const previous = result({ events: ['把报价单发出去'] })
    const fresh = result({ events: ['  把报价单发出去 '] })
    expect(mergeWeekResult(fresh, previous).events).toEqual(['把报价单发出去'])
  })

  it('主线与下周计划：新一轮给了就用新的，没给才留旧的', () => {
    const previous = result({
      highlights: ['上周的主线'],
      nextFocus: ['上周定的事'],
      nextFollowUps: ['上周要跟进的人'],
    })
    const freshAll = result({
      highlights: ['本周主线'],
      nextFocus: ['下周要做的事'],
      nextFollowUps: ['下周要跟进的事'],
    })
    const merged = mergeWeekResult(freshAll, previous)
    expect(merged.highlights).toEqual(['本周主线'])
    expect(merged.nextFocus).toEqual(['下周要做的事'])
    expect(merged.nextFollowUps).toEqual(['下周要跟进的事'])

    const freshEmpty = result()
    const kept = mergeWeekResult(freshEmpty, previous)
    expect(kept.highlights).toEqual(['上周的主线'])
    expect(kept.nextFocus).toEqual(['上周定的事'])
    expect(kept.nextFollowUps).toEqual(['上周要跟进的人'])
  })

  it('状态整组以新一轮为准（分数是用户这次点的）', () => {
    const previous = result({ state: { scores: { mood: 5 }, note: '上次写的' } })
    const fresh = result({ state: { scores: { mood: 2 }, note: '' } })
    expect(mergeWeekResult(fresh, previous).state).toEqual({ scores: { mood: 2 }, note: '' })
  })
})

describe('recapLines', () => {
  it('把这周已经记下的东西说成几行（每类都限条数）', () => {
    const lines = recapLines(
      result({
        events: ['一', '二', '三', '四'],
        people: [person('老王', '方案'), person('小李', '吃饭'), person('张总', '没约上')],
        things: ['键盘', '椅子', '会员'],
        pending: ['报销', '数据', '邮件'],
        growth: ['定价书', '播客', '复盘文章'],
        highlights: ['这周主要在改方案', '第二条主线'],
      }),
    )
    expect(lines).toEqual([
      '事情：一；二；三',
      '人际：老王、小李',
      '物品与支出：键盘；椅子',
      '未办：报销；数据',
      '成长：定价书；播客',
      '本周主线：这周主要在改方案',
    ])
  })

  it('什么都没有就是空的（不硬凑一句）', () => {
    expect(recapLines(result())).toEqual([])
  })
})

describe('hasWeekContent', () => {
  it('有一栏有内容就算聊过了', () => {
    expect(hasWeekContent(result({ events: ['改方案'] }))).toBe(true)
    expect(hasWeekContent(result({ growth: ['看了本书'] }))).toBe(true)
    expect(hasWeekContent(result({ highlights: ['主线'] }))).toBe(true)
  })

  it('全空就是没聊过；只有状态分不算聊过内容', () => {
    expect(hasWeekContent(result())).toBe(false)
    expect(
      hasWeekContent(result({ state: { ...createEmptyState(), scores: { mood: 3 }, note: '还行' } })),
    ).toBe(false)
  })
})
