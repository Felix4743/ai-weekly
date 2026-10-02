import { describe, expect, it } from 'vitest'
import { mergeReview, mergeStrings } from './mergeReview'
import { createEmptyReview, type Issue, type Review } from './review'

/**
 * 每一次重新复盘都是拿最新的原文整份重来，而用户可能已经手改过眼前这一份。
 * 合并的规矩分两类：清单一律以用户那份为准、模型只许往里加新的；
 * 判断项（总结 / 提醒 / 上周对账）是 AI 的分析结果，模型非空就说了算。
 *
 * 这里的每一条都在盯「会不会把用户的改动悄悄冲掉或者写重」。
 */

function review(patch: Partial<Review> = {}): Review {
  return { ...createEmptyReview(), ...patch }
}

const issue = (text: string, key = '', advice: string[] = []): Issue => ({ text, key, advice })

describe('合并 · mergeStrings 只追加不重排', () => {
  it('新的追加在后面，原来那条的顺序不动', () => {
    expect(mergeStrings(['写周报', '见客户'], ['把合同发出去'])).toEqual([
      '写周报',
      '见客户',
      '把合同发出去',
    ])
  })

  it('只差首尾空白、大小写、多余空格的算同一条', () => {
    expect(mergeStrings(['写周报'], [' 写周报 '])).toEqual(['写周报'])
    expect(mergeStrings(['Fix Bug'], ['fix bug'])).toEqual(['Fix Bug'])
    expect(mergeStrings(['写 周报'], ['写  周报'])).toEqual(['写 周报'])
  })

  it('中间空格位置不同就是两条 —— 压空格不会把空格压没', () => {
    expect(mergeStrings(['写周报'], ['写 周报'])).toEqual(['写周报', '写 周报'])
  })

  it('带空白的条目丢掉，重复的 incoming 只加一条', () => {
    expect(mergeStrings([], ['  ', '', '见客户', ' 见客户 '])).toEqual(['见客户'])
  })

  it('不改动传进来的两个数组', () => {
    const current = ['写周报']
    const incoming = ['见客户']
    mergeStrings(current, incoming)
    expect(current).toEqual(['写周报'])
    expect(incoming).toEqual(['见客户'])
  })
})

describe('合并 · 清单以用户那份为准', () => {
  it('用户删掉的一条：模型这次又给出来，被 dropped 挡下，不会加回来', () => {
    // 合并函数手里只有「用户现在这份」和「模型这份」，分不出「用户删了」和
    // 「模型这次没提」—— 所以「删过什么」由调用方通过 dropped 递进来
    // （见 reviewEdit.droppedAfter 与 App.editReview）。
    const user = review({ did: ['写了报价单'] })
    const fromModel = review({ did: ['写了报价单', '发周报'] })
    expect(mergeReview(user, fromModel, ['发周报']).did).toEqual(['写了报价单'])
  })

  it('用户只是改了空白或大小写：不会被重复追加', () => {
    const user = review({ did: ['写 周报', 'Fix Bug'] })
    const fromModel = review({ did: ['写  周报', 'fix bug', '见客户'] })
    expect(mergeReview(user, fromModel).did).toEqual(['写 周报', 'Fix Bug', '见客户'])
  })

  it('用户换了个说法：模型那句仍会作为新的一条追加', () => {
    const user = review({ did: ['写周报和复盘'] })
    const fromModel = review({ did: ['写周报'] })
    expect(mergeReview(user, fromModel).did).toEqual(['写周报和复盘', '写周报'])
  })

  it('用户一条都没改过时，就是把模型的新条目接在后面', () => {
    const user = review({ did: ['写周报'] })
    const fromModel = review({ did: ['写周报', '见客户', '把合同发出去'] })
    expect(mergeReview(user, fromModel).did).toEqual(['写周报', '见客户', '把合同发出去'])
  })

  it('计划：同名的不重复，新的带着 when 追加', () => {
    const user = review({ plan: [{ text: '联系客户', when: '周三' }] })
    const fromModel = review({
      plan: [{ text: '联系客户', when: '' }, { text: '把合同发出去', when: ' 周四 ' }],
    })
    expect(mergeReview(user, fromModel).plan).toEqual([
      { text: '联系客户', when: '周三' },
      { text: '把合同发出去', when: '周四' },
    ])
  })

  it('计划：文本为空的条目不进来', () => {
    const user = review({ plan: [{ text: '联系客户', when: '' }] })
    const fromModel = review({ plan: [{ text: '   ', when: '周三' }] })
    expect(mergeReview(user, fromModel).plan).toEqual([{ text: '联系客户', when: '' }])
  })

  it('问题：标签写得不一样但归一是同一条，不重复', () => {
    const user = review({ issues: [issue('报价老拖延', '报价拖延')] })
    const fromModel = review({ issues: [issue('报价还是拖', '报价 拖延！', ['先报价']) ] })
    expect(mergeReview(user, fromModel).issues).toEqual([issue('报价老拖延', '报价拖延')])
  })

  it('问题：没有标签时按同一句话判重（大小写不敏感）', () => {
    const user = review({ issues: [issue('Fix Bug')] })
    const fromModel = review({ issues: [issue('fix bug')] })
    expect(mergeReview(user, fromModel).issues).toEqual([issue('Fix Bug')])
  })

  it('问题：用户那条没标签、模型这条有标签，也按同一句话判重', () => {
    const user = review({ issues: [issue('报价老拖延')] })
    const fromModel = review({ issues: [issue('报价老拖延', '报价拖延')] })
    expect(mergeReview(user, fromModel).issues).toEqual([issue('报价老拖延')])
  })

  it('问题：新问题带着建议一起进来，且不是模型那个数组的引用', () => {
    const modelIssue = issue('报价老拖延', '报价拖延', ['先报价再谈细节'])
    const merged = mergeReview(review(), review({ issues: [modelIssue] }))
    expect(merged.issues).toEqual([issue('报价老拖延', '报价拖延', ['先报价再谈细节'])])
    expect(merged.issues[0].advice).not.toBe(modelIssue.advice)
  })

  it('问题：文本空白、标签是新的也不加', () => {
    const merged = mergeReview(review(), review({ issues: [issue('   ', '新标签')] }))
    expect(merged.issues).toEqual([])
  })
})

describe('合并 · dropped：用户删掉的条目不回来', () => {
  it('被删的那条不回来，模型给的全新条目照常追加在后面', () => {
    const user = review({ did: ['写了报价单'] })
    const fromModel = review({ did: ['写了报价单', '发周报', '见客户'] })
    expect(mergeReview(user, fromModel, ['发周报']).did).toEqual(['写了报价单', '见客户'])
  })

  it('不带 dropped（默认参数）时和以前完全一样：就是照单全收', () => {
    const user = review({ did: ['写了报价单'] })
    const fromModel = review({ did: ['写了报价单', '发周报'] })
    expect(mergeReview(user, fromModel).did).toEqual(['写了报价单', '发周报'])
    expect(mergeReview(user, fromModel, []).did).toEqual(['写了报价单', '发周报'])
  })

  it('命中是按归一化比的：大小写与多余空白不影响', () => {
    const user = review({ did: ['Fix Bug'] })
    const fromModel = review({ did: ['fix bug'] })
    expect(mergeReview(user, fromModel, ['FIX   BUG']).did).toEqual(['Fix Bug'])
  })

  it('dropped 只拦模型那份：用户手上还留着的条目不因此消失', () => {
    const user = review({ did: ['写周报'] })
    const fromModel = review({ did: ['写周报'] })
    expect(mergeReview(user, fromModel, ['写周报']).did).toEqual(['写周报'])
  })

  it('计划：被删的那条不回来，别的照常带着 when 追加', () => {
    const user = review({ plan: [{ text: '联系客户', when: '周三' }] })
    const fromModel = review({
      plan: [
        { text: '联系客户', when: '' },
        { text: '把合同发出去', when: ' 周四 ' },
      ],
    })
    expect(mergeReview(user, fromModel, ['把合同发出去']).plan).toEqual([
      { text: '联系客户', when: '周三' },
    ])
  })

  it('问题：标签命中（去掉空白与标点之后）就不回来', () => {
    const fromModel = review({ issues: [issue('报价还是拖', '报价 拖延！', ['先报价'])] })
    expect(mergeReview(review(), fromModel, ['报价拖延']).issues).toEqual([])
  })

  it('问题：标签对不上时，按同一句话命中', () => {
    const fromModel = review({ issues: [issue('报价老拖延', '这次换了个标签')] })
    expect(mergeReview(review(), fromModel, ['报价老拖延']).issues).toEqual([])
  })
})

describe('合并 · 判断项模型说了算', () => {
  it('一句话总结：模型非空就用模型的，空白才留用户那份', () => {
    expect(
      mergeReview(review({ headline: '用户写的' }), review({ headline: '模型写的' })).headline,
    ).toBe('模型写的')
    expect(mergeReview(review({ headline: '用户写的' }), review({ headline: '   ' })).headline).toBe(
      '用户写的',
    )
    expect(mergeReview(review({ headline: '用户写的' }), review()).headline).toBe('用户写的')
  })

  it('补漏提醒：同上', () => {
    expect(mergeReview(review({ nudge: '旧的' }), review({ nudge: '新的' })).nudge).toBe('新的')
    expect(mergeReview(review({ nudge: '旧的' }), review({ nudge: '' })).nudge).toBe('旧的')
  })

  it('上周对账：模型非空就整栏换成模型的，不跟用户那份合并', () => {
    const user = review({ reconcile: [{ text: '跟进客户', state: 'partial', note: '用户在跟' }] })
    const fromModel = review({ reconcile: [{ text: '跟进客户', state: 'done', note: '签了' }] })
    expect(mergeReview(user, fromModel).reconcile).toEqual([
      { text: '跟进客户', state: 'done', note: '签了' },
    ])
  })

  it('上周对账：模型这栏是空的，才留用户那份', () => {
    const user = review({ reconcile: [{ text: '跟进客户', state: 'partial', note: '' }] })
    expect(mergeReview(user, review()).reconcile).toEqual([
      { text: '跟进客户', state: 'partial', note: '' },
    ])
  })
})

describe('合并 · 纯函数', () => {
  it('两份输入都不被改动', () => {
    const user = review({
      headline: '用户的总结',
      did: ['写周报'],
      issues: [issue('报价老拖延', '报价拖延')],
      plan: [{ text: '联系客户', when: '周三' }],
    })
    const fromModel = review({
      headline: '模型的总结',
      did: ['见客户'],
      issues: [issue('沟通不清', '沟通', ['先确认'])],
      plan: [{ text: '把合同发出去', when: '周四' }],
    })
    const userBefore = JSON.parse(JSON.stringify(user))
    const modelBefore = JSON.parse(JSON.stringify(fromModel))

    mergeReview(user, fromModel)

    expect(user).toEqual(userBefore)
    expect(fromModel).toEqual(modelBefore)
  })

  it('两边都空时合并出来还是一份空复盘', () => {
    expect(mergeReview(createEmptyReview(), createEmptyReview())).toEqual(createEmptyReview())
  })
})
