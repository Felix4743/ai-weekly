import { describe, expect, it } from 'vitest'
import {
  DEGRADED_PREFIX,
  RECONCILE_LABELS,
  coerceReview,
  createEmptyReview,
  degradedReview,
  isDegradedReview,
  isReviewEmpty,
  normalizeKey,
  parseReview,
  parseReviewSafe,
  repeatCount,
  type ReconcileState,
} from './review'

/**
 * 复盘是 0.9.0 的主语：模型给的每一句话都要么落进某一栏，要么被明确判为「没给」。
 * 这里盯三件事：
 * - 中英文键都认（有的模型会把 schema 翻译一遍再输出）
 * - 坏输入不抛异常，而是给一份说得清失败的复盘
 * - 「第几次出现」这类跨周判断，靠的是标签归一化，差一个标点就全算错
 */

describe('复盘 · 形状与空判断', () => {
  it('空复盘六栏都是空的', () => {
    expect(createEmptyReview()).toEqual({
      headline: '',
      did: [],
      issues: [],
      reconcile: [],
      plan: [],
      nudge: '',
    })
  })

  it('null 与六栏全空的都算「什么都没写出来」', () => {
    expect(isReviewEmpty(null)).toBe(true)
    expect(isReviewEmpty(createEmptyReview())).toBe(true)
  })

  it('只有空白的 headline 还是算空', () => {
    expect(isReviewEmpty({ ...createEmptyReview(), headline: '   \n ' })).toBe(true)
  })

  it('任何一栏有内容就不算空', () => {
    expect(isReviewEmpty({ ...createEmptyReview(), headline: '这周在赶报价' })).toBe(false)
    expect(isReviewEmpty({ ...createEmptyReview(), did: ['写了报价单'] })).toBe(false)
    expect(
      isReviewEmpty({
        ...createEmptyReview(),
        issues: [{ text: '报价老拖延', advice: [], key: '' }],
      }),
    ).toBe(false)
    expect(
      isReviewEmpty({
        ...createEmptyReview(),
        reconcile: [{ text: '跟进客户', state: 'done', note: '' }],
      }),
    ).toBe(false)
    expect(isReviewEmpty({ ...createEmptyReview(), plan: [{ text: '联系客户', when: '' }] })).toBe(
      false,
    )
  })

  it('只有一句补漏提醒时仍被判成空 —— 当前实现不看 nudge', () => {
    expect(isReviewEmpty({ ...createEmptyReview(), nudge: '还没提睡眠' })).toBe(true)
  })

  it('失败的那一份：说清失败、给下一步，且不算空', () => {
    const bad = degradedReview('模型返回了空内容')
    expect(bad).toEqual({
      headline: `${DEGRADED_PREFIX}模型返回了空内容`,
      did: [],
      issues: [],
      reconcile: [],
      plan: [],
      nudge: '可以点「重新复盘」再试一次。',
    })
    expect(isDegradedReview(bad)).toBe(true)
    // 界面靠这个判断别把失败的并进用户已有的复盘，所以它不能是「空」
    expect(isReviewEmpty(bad)).toBe(false)
  })

  it('正常的一份不会被误判成失败', () => {
    expect(isDegradedReview(createEmptyReview())).toBe(false)
    expect(isDegradedReview({ ...createEmptyReview(), headline: '这周在赶报价' })).toBe(false)
  })

  it('三档对账的说法齐全', () => {
    expect(RECONCILE_LABELS).toEqual({ done: '做了', partial: '做了一半', unmentioned: '没提到' })
  })
})

describe('复盘 · coerceReview 认得中英文键', () => {
  it('不是对象就返回 null（数组也不算）', () => {
    expect(coerceReview(null)).toBeNull()
    expect(coerceReview(undefined)).toBeNull()
    expect(coerceReview('一段话')).toBeNull()
    expect(coerceReview(42)).toBeNull()
    expect(coerceReview(true)).toBeNull()
    expect(coerceReview([])).toBeNull()
    expect(coerceReview([{ headline: 'x' }])).toBeNull()
  })

  it('空对象给一份六栏全空的复盘，而不是 null', () => {
    expect(coerceReview({})).toEqual(createEmptyReview())
  })

  it('英文键照收', () => {
    expect(
      coerceReview({
        headline: '这周在赶报价',
        did: ['写报价单', '见客户'],
        issues: [{ text: '报价老拖延', advice: ['先报价再谈细节'], key: '报价拖延' }],
        reconcile: [{ text: '跟进客户', state: 'done', note: '客户签了' }],
        plan: [{ text: '把合同发出去', when: '周三' }],
        nudge: '睡眠还没提',
      }),
    ).toEqual({
      headline: '这周在赶报价',
      did: ['写报价单', '见客户'],
      issues: [{ text: '报价老拖延', advice: ['先报价再谈细节'], key: '报价拖延' }],
      reconcile: [{ text: '跟进客户', state: 'done', note: '客户签了' }],
      plan: [{ text: '把合同发出去', when: '周三' }],
      nudge: '睡眠还没提',
    })
  })

  it('中文键照收（模型把 schema 翻译了一遍）', () => {
    expect(
      coerceReview({
        一句话: '这周在赶报价',
        做了什么: ['写报价单'],
        问题: [{ 问题: '报价老拖延', 建议: ['先报价再谈细节'], 标签: '报价拖延' }],
        对账: [{ 上周: '跟进客户', 状态: '做了一半', 说明: '客户还没回' }],
        下周计划: [{ 做什么: '把合同发出去', 什么时候: '周三' }],
        提醒: '睡眠还没提',
      }),
    ).toEqual({
      headline: '这周在赶报价',
      did: ['写报价单'],
      issues: [{ text: '报价老拖延', advice: ['先报价再谈细节'], key: '报价拖延' }],
      reconcile: [{ text: '跟进客户', state: 'partial', note: '客户还没回' }],
      plan: [{ text: '把合同发出去', when: '周三' }],
      nudge: '睡眠还没提',
    })
  })

  it('英文键在前，中英混着给时以英文为准', () => {
    const review = coerceReview({ summary: '英文这句', 总结: '中文这句' })
    expect(review?.headline).toBe('英文这句')
  })

  it('did 收到单个字符串时也算一条', () => {
    expect(coerceReview({ done: '只做了一件事' })?.did).toEqual(['只做了一件事'])
  })

  it('数字与布尔被当成文字写进清单', () => {
    const review = coerceReview({ headline: 42, did: [1, true, null] })
    expect(review?.headline).toBe('42')
    expect(review?.did).toEqual(['1', 'true'])
  })

  it('issues 收字符串条目：没有建议也没有标签', () => {
    expect(coerceReview({ issues: ['报价老拖延'] })?.issues).toEqual([
      { text: '报价老拖延', advice: [], key: '' },
    ])
  })

  it('issues 里读不出内容的条目跳过，不占位', () => {
    expect(coerceReview({ issues: ['  ', null, 1, [], {}, { text: '   ' }] })?.issues).toEqual([])
  })

  it('issues 不是数组时给空数组', () => {
    expect(coerceReview({ issues: '报价老拖延' })?.issues).toEqual([])
    expect(coerceReview({ issues: null })?.issues).toEqual([])
  })

  it('对账三档中英写法都认得', () => {
    const cases: Array<[string, ReconcileState]> = [
      ['done', 'done'],
      ['做了', 'done'],
      ['完成', 'done'],
      ['完成了', 'done'],
      ['已完成', 'done'],
      ['partial', 'partial'],
      ['部分', 'partial'],
      ['做了一半', 'partial'],
      ['没做完', 'partial'],
      ['在做', 'partial'],
      ['unmentioned', 'unmentioned'],
      ['没提到', 'unmentioned'],
      ['未提到', 'unmentioned'],
      ['没提', 'unmentioned'],
      ['不知道', 'unmentioned'],
    ]
    for (const [written, expected] of cases) {
      expect(coerceReview({ reconcile: [{ text: '上周说的那件事', state: written }] })?.reconcile).toEqual(
        [{ text: '上周说的那件事', state: expected, note: '' }],
      )
    }
  })

  it('大写与多余空格也认（DONE / Partial）', () => {
    expect(coerceReview({ reconcile: [{ text: 'x', state: 'DONE' }] })?.reconcile[0].state).toBe(
      'done',
    )
    expect(coerceReview({ reconcile: [{ text: 'x', state: ' Partial ' }] })?.reconcile[0].state).toBe(
      'partial',
    )
  })

  it('没见过的 state 一律按「没提到」，不瞎猜', () => {
    expect(coerceReview({ reconcile: [{ text: 'x', state: '大概吧' }] })?.reconcile[0].state).toBe(
      'unmentioned',
    )
    expect(coerceReview({ reconcile: [{ text: 'x', state: 42 }] })?.reconcile[0].state).toBe(
      'unmentioned',
    )
    expect(coerceReview({ reconcile: [{ text: 'x' }] })?.reconcile[0].state).toBe('unmentioned')
  })

  it('对账收到纯字符串条目时，状态按「没提到」算', () => {
    expect(coerceReview({ 上周: ['跟进客户'] })?.reconcile).toEqual([
      { text: '跟进客户', state: 'unmentioned', note: '' },
    ])
  })

  it('plan 收到字符串条目时 when 是空串', () => {
    expect(coerceReview({ plan: ['把合同发出去'] })?.plan).toEqual([
      { text: '把合同发出去', when: '' },
    ])
  })

  it('nudge 的中英别名都认', () => {
    expect(coerceReview({ reminder: '睡眠还没提' })?.nudge).toBe('睡眠还没提')
    expect(coerceReview({ 补漏: '睡眠还没提' })?.nudge).toBe('睡眠还没提')
  })

  it('空字符串不会被当成内容', () => {
    expect(coerceReview({ headline: '   ', nudge: '' })).toEqual(createEmptyReview())
  })

  it('英文键写成了 null 时，继续往下看中文兜底键 —— 内容不再丢', () => {
    // pick 把 null / undefined / 空串都当成「这个键里没东西」，于是继续往下找
    expect(coerceReview({ headline: null, summary: '这周在赶报价' })?.headline).toBe('这周在赶报价')
    // 没写 headline 这个键时，中文/替代键同样生效
    expect(coerceReview({ summary: '这周在赶报价' })?.headline).toBe('这周在赶报价')
  })
})

describe('复盘 · parseReview 与失败时的兜底', () => {
  it('正常 JSON：读出复盘和一句回应', () => {
    const out = parseReview('{"headline":"这周在赶报价","did":["写报价单"],"reply":"补上了睡眠"}')
    expect(out.error).toBeUndefined()
    expect(out.reply).toBe('补上了睡眠')
    expect(out.review?.headline).toBe('这周在赶报价')
    expect(out.review?.did).toEqual(['写报价单'])
  })

  it('reply 的中英别名都认', () => {
    expect(parseReview('{"headline":"x","回应":"好"}').reply).toBe('好')
    expect(parseReview('{"headline":"x","response":"ok"}').reply).toBe('ok')
  })

  it('没有 reply 就是空串', () => {
    expect(parseReview('{"headline":"x"}').reply).toBe('')
  })

  it('围栏 + 前缀废话照样读得出来', () => {
    const out = parseReview('好的，我整理了一下：\n```json\n{"headline":"这周在赶报价"}\n```')
    expect(out.error).toBeUndefined()
    expect(out.review?.headline).toBe('这周在赶报价')
  })

  it('认不出来时 review 是 null，错误文案来自 coerce', () => {
    expect(parseReview('')).toEqual({ review: null, reply: '', error: '模型返回了空内容' })
    expect(parseReview('这周挺忙的。')).toEqual({
      review: null,
      reply: '',
      error: '模型返回的内容里没有认出 JSON',
    })
    expect(parseReview('{"headline":"x",}')).toEqual({
      review: null,
      reply: '',
      error: '模型返回的 JSON 没能解析出来',
    })
  })

  it('顶层是数组也没关系：切片先把里面的对象捞出来', () => {
    const out = parseReview('[{"headline":"这周在赶报价"}]')
    expect(out.error).toBeUndefined()
    expect(out.review?.headline).toBe('这周在赶报价')
  })

  it('parseReviewSafe：坏输入不抛，给一份说得清失败的复盘', () => {
    const out = parseReviewSafe('这周挺忙的。')
    expect(out.reply).toBe('')
    expect(isDegradedReview(out.review)).toBe(true)
    expect(out.review.headline).toBe(`${DEGRADED_PREFIX}模型返回的内容里没有认出 JSON`)
    expect(out.review.nudge).toBe('可以点「重新复盘」再试一次。')
  })

  it('parseReviewSafe：空输入也点得明失败原因', () => {
    expect(parseReviewSafe('').review.headline).toBe(`${DEGRADED_PREFIX}模型返回了空内容`)
  })

  it('parseReviewSafe：好输入原样返回，不套那层壳', () => {
    const out = parseReviewSafe('{"headline":"这周在赶报价","reply":"补上了睡眠"}')
    expect(isDegradedReview(out.review)).toBe(false)
    expect(out.review.headline).toBe('这周在赶报价')
    expect(out.reply).toBe('补上了睡眠')
    expect(out.error).toBeUndefined()
  })

  it('parseReviewSafe：各种怪输入都不抛', () => {
    for (const raw of ['', '```json\n\n```', '{"a":1,}', '{', 'null', '[]', '{}']) {
      expect(() => parseReviewSafe(raw)).not.toThrow()
    }
    // 认得出 JSON 但里面没有复盘字段时，是一份空复盘而不是失败
    expect(isDegradedReview(parseReviewSafe('{}').review)).toBe(false)
  })
})

describe('复盘 · 标签归一化与跨周计数', () => {
  it('空白（含全角空格）与标点都去掉', () => {
    expect(normalizeKey('报价 拖延！')).toBe('报价拖延')
    expect(normalizeKey('报价\u3000拖延')).toBe('报价拖延')
    expect(normalizeKey(' 报价、拖延。 ')).toBe('报价拖延')
    expect(normalizeKey('「报价拖延」')).toBe('报价拖延')
    expect(normalizeKey('报价-拖延')).toBe('报价拖延')
  })

  it('大小写归一，方便同一个标签跨周对上', () => {
    expect(normalizeKey('Quote Delay')).toBe('quotedelay')
    expect(normalizeKey('QUOTE-DELAY')).toBe(normalizeKey('quote delay'))
  })

  it('只剩标点时是空串（空标签不参与跨周比对）', () => {
    expect(normalizeKey('！！！')).toBe('')
    expect(normalizeKey('   ')).toBe('')
  })

  it('repeatCount 只数传进来的那几周', () => {
    expect(repeatCount([['报价拖延'], ['报价 拖延！'], ['别的问题']], '报价拖延')).toBe(2)
    expect(repeatCount([['别的问题']], '报价拖延')).toBe(0)
    expect(repeatCount([], '报价拖延')).toBe(0)
    // 传两周就最多数出两周，不会替调用方去翻历史
    expect(repeatCount([['报价拖延'], ['报价拖延']], '报价拖延')).toBe(2)
  })

  it('同一周里同一个标签出现两次，也只算一周', () => {
    expect(repeatCount([['报价拖延', '报价拖延']], '报价拖延')).toBe(1)
    expect(repeatCount([['报价拖延', '报价 拖延']], '报价拖延')).toBe(1)
  })

  it('空标签与空历史都给 0', () => {
    expect(repeatCount([['']], '')).toBe(0)
    expect(repeatCount([['报价拖延']], '   ')).toBe(0)
    expect(repeatCount([['报价拖延']], '、。')).toBe(0)
  })

  it('问的标签写法不同，照样能对上历史', () => {
    expect(repeatCount([['报价延迟']], '报价-延迟！')).toBe(1)
  })
})
