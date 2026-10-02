import { describe, expect, it } from 'vitest'
import { createEmptyReview, type Issue, type Plan, type Review } from './review'
import { addPlan, droppedAfter, removePlan, setDid, setPlan, updatePlan } from './reviewEdit'

/**
 * 用户在复盘上手动改清单，是「改一次丢一次」最容易发生的地方：
 * 一个不小心直接改了原对象，或者把别的栏一起换了，界面上的表现会非常怪。
 * 所以这里每一条都同时盯两件事：新的那份对不对、旧的那份有没有被动过。
 */

function base(): Review {
  return {
    ...createEmptyReview(),
    headline: '这周在赶报价',
    did: ['写报价单'],
    plan: [
      { text: '联系客户', when: '周三' },
      { text: '把合同发出去', when: '' },
    ],
  }
}

function snapshot(review: Review): Review {
  return JSON.parse(JSON.stringify(review)) as Review
}

const issue = (text: string, key = ''): Issue => ({ text, key, advice: [] })

describe('复盘编辑 · 整栏换掉', () => {
  it('setDid 只换 did 这一栏，别的栏一个字不动', () => {
    const review = base()
    const next = setDid(review, ['写报价单', '见客户'])
    expect(next.did).toEqual(['写报价单', '见客户'])
    expect(next.headline).toBe('这周在赶报价')
    expect(next.plan).toEqual(review.plan)
    // 没改的栏保持同一个引用，界面不必重画
    expect(next.issues).toBe(review.issues)
  })

  it('setPlan 只换 plan 这一栏', () => {
    const review = base()
    const plan: Plan[] = [{ text: '只留这一条', when: '周五' }]
    const next = setPlan(review, plan)
    expect(next.plan).toEqual([{ text: '只留这一条', when: '周五' }])
    expect(next.did).toEqual(['写报价单'])
    expect(next.headline).toBe('这周在赶报价')
  })

  it('返回的是新对象，原对象原封不动', () => {
    const review = base()
    const before = snapshot(review)
    expect(setDid(review, ['见客户'])).not.toBe(review)
    expect(setPlan(review, [])).not.toBe(review)
    expect(review).toEqual(before)
  })
})

describe('复盘编辑 · 加一条计划', () => {
  it('文本与时间都 trim 之后再放进去', () => {
    const next = addPlan(base(), '  确认发票  ', '  周四 ')
    expect(next.plan).toEqual([
      { text: '联系客户', when: '周三' },
      { text: '把合同发出去', when: '' },
      { text: '确认发票', when: '周四' },
    ])
  })

  it('这一层不去重：同样的文本再点一次「加」就再加一条', () => {
    const next = addPlan(base(), '联系客户', '周三')
    expect(next.plan).toHaveLength(3)
    expect(next.plan[2]).toEqual({ text: '联系客户', when: '周三' })
  })

  it('不写时间时 when 是空串', () => {
    expect(addPlan(createEmptyReview(), '联系客户').plan).toEqual([
      { text: '联系客户', when: '' },
    ])
  })

  it('空文本与纯空白不加，而且原对象原样返回', () => {
    const review = base()
    expect(addPlan(review, '')).toBe(review)
    expect(addPlan(review, '   ')).toBe(review)
    expect(addPlan(review, '\n\t ')).toBe(review)
    expect(review.plan).toHaveLength(2)
  })

  it('追加不改动原来的计划数组', () => {
    const review = base()
    const before = snapshot(review)
    const next = addPlan(review, '把合同发出去')
    expect(review).toEqual(before)
    expect(next.plan).not.toBe(review.plan)
    expect(next.plan[0]).toBe(review.plan[0])
  })
})

describe('复盘编辑 · 改一条计划', () => {
  it('只改命中的那一条，别的条目还是原来那个对象', () => {
    const review = base()
    const next = updatePlan(review, 1, { text: '把合同发出去', when: '周四' })
    expect(next.plan).toEqual([
      { text: '联系客户', when: '周三' },
      { text: '把合同发出去', when: '周四' },
    ])
    expect(next.plan[0]).toBe(review.plan[0])
    expect(next.plan[1]).not.toBe(review.plan[1])
  })

  it('只给 when 时文本不动，只给文本时 when 不动', () => {
    const review = base()
    expect(updatePlan(review, 0, { when: '周五' }).plan[0]).toEqual({
      text: '联系客户',
      when: '周五',
    })
    expect(updatePlan(review, 0, { text: '联系老客户' }).plan[0]).toEqual({
      text: '联系老客户',
      when: '周三',
    })
  })

  it('空 patch 不会把内容改坏', () => {
    const review = base()
    expect(updatePlan(review, 0, {})).toEqual(review)
  })

  it('下标越界时内容不变，也不抛', () => {
    const review = base()
    expect(updatePlan(review, 9, { text: '改不到' })).toEqual(review)
    expect(updatePlan(review, -1, { text: '改不到' })).toEqual(review)
  })

  it('不改动原对象', () => {
    const review = base()
    const before = snapshot(review)
    updatePlan(review, 0, { text: '联系老客户', when: '周五' })
    expect(review).toEqual(before)
  })
})

describe('复盘编辑 · 删一条计划', () => {
  it('删掉命中的那条，剩下的顺序不变', () => {
    const review = base()
    const next = removePlan(review, 0)
    expect(next.plan).toEqual([{ text: '把合同发出去', when: '' }])
    expect(review.plan).toHaveLength(2)
  })

  it('删到一条不剩也是允许的', () => {
    const one = setPlan(base(), [{ text: '联系客户', when: '周三' }])
    expect(removePlan(one, 0).plan).toEqual([])
  })

  it('下标越界时什么都不删，也不抛', () => {
    const review = base()
    expect(removePlan(review, 9).plan).toEqual(review.plan)
    expect(removePlan(review, -1).plan).toEqual(review.plan)
  })

  it('返回新对象，原对象与原来的数组都不动', () => {
    const review = base()
    const before = snapshot(review)
    const next = removePlan(review, 1)
    expect(next).not.toBe(review)
    expect(next.plan).not.toBe(review.plan)
    expect(review).toEqual(before)
  })
})

describe('复盘编辑 · 记下用户删掉了什么', () => {
  it('删掉一条 did：返回那一条（归一化之后）', () => {
    expect(droppedAfter(base(), setDid(base(), []))).toEqual(['写报价单'])
  })

  it('删掉一条计划：返回那条计划的文本，没被删的不算', () => {
    const previous = base()
    expect(droppedAfter(previous, removePlan(previous, 0))).toEqual(['联系客户'])
    expect(droppedAfter(previous, setPlan(previous, []))).toEqual(['联系客户', '把合同发出去'])
  })

  it('删掉一条问题：有标签按标签算，没标签按文本算', () => {
    const previous: Review = {
      ...base(),
      issues: [issue('报销拖了两周', '报销拖延'), issue('会议室老是订不到')],
    }
    expect(droppedAfter(previous, { ...previous, issues: [] })).toEqual([
      '报销拖延',
      '会议室老是订不到',
    ])
  })

  it('什么都没删时返回空数组 —— 只是换了空白或大小写不算删', () => {
    const previous = base()
    expect(droppedAfter(previous, base())).toEqual([])
    expect(droppedAfter(previous, setDid(previous, [' 写报价单 ']))).toEqual([])
    expect(
      droppedAfter(previous, setPlan(previous, [{ text: ' 联系客户 ', when: '周天' }, previous.plan[1]])),
    ).toEqual([])
  })

  it('两个入参都不被改动', () => {
    const previous = base()
    const next = setPlan(previous, [])
    const beforePrevious = snapshot(previous)
    const beforeNext = snapshot(next)

    droppedAfter(previous, next)

    expect(previous).toEqual(beforePrevious)
    expect(next).toEqual(beforeNext)
  })
})
