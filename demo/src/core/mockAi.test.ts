import { describe, expect, it } from 'vitest'
import type { ReviewRequest } from './aiClient'
import { createMockAi } from './mockAi'
import type { PreviousWeek } from './review'

/**
 * 假分析器的「读法」测试。
 *
 * 它不追求像真模型，只追求**可预期**：同一段原文读两次结果一样，
 * 什么地方进 did、什么地方进 issues、什么地方进 plan，都由这里钉死。
 * 这组用例同时是「没填 Key 的人看到的那套演示」的说明书。
 */

const instant = createMockAi({ instant: true })

function req(notes: string, patch: Partial<ReviewRequest> = {}): ReviewRequest {
  return {
    week: '2026-09-21',
    weekText: '9月21日 – 9月27日',
    notes,
    previous: null,
    isFollowUp: false,
    ...patch,
  }
}

function previousWeek(patch: Partial<PreviousWeek> = {}): PreviousWeek {
  return {
    week: '2026-09-14',
    weekText: '9月14日 – 9月20日',
    plan: [],
    issues: [],
    ...patch,
  }
}

/** 一段有典型三类的原文：做的事、出的问题、下周打算 */
const NOTES = [
  '这周主要在改客户那个方案，来回改了三版还没定。',
  '周四临时插进来一个线上故障，盯了大半天。',
  '客户方案一直拖着没拍板，我有点烦。',
  '睡眠不太好，平均睡六个多小时。',
  '下周一把报价单发给客户，周三前把线上故障的复盘写完。',
].join('\n')

describe('演示用假 AI · 把原文分成五段', () => {
  it('从一段中文原文里分出做了什么、问题与下周计划', async () => {
    const { review } = await instant.analyze(req(NOTES))

    expect(review.did.join(' ')).toContain('改了三版')
    expect(review.did.join(' ')).toContain('线上故障')
    expect(review.issues.map((i) => i.text).join(' ')).toContain('拖着')
    expect(review.plan.map((p) => p.text).join(' ')).toContain('报价单')

    // 三样互不串台：进过 plan 的那句不该再出现在 did 里
    expect(review.did.join(' ')).not.toContain('报价单')
    expect(review.headline).toContain('这周主要是')
  })

  it('一句话里有「拖延」时，问题带出「拖延」这个 key，建议不为空', async () => {
    const { review } = await instant.analyze(
      req('客户方案一直拖延着没拍板，烦。\n这周开了三次评审会。'),
    )

    const issue = review.issues[0]
    expect(issue.key).toBe('拖延')
    expect(issue.advice.length).toBeGreaterThan(0)
    expect(issue.advice.join(' ')).toContain('拆成两步')
  })

  it('「下周…」这类开头的话进 plan，并且 when 有值', async () => {
    const { review } = await instant.analyze(req('下周把报价单发给客户。'))

    expect(review.plan).toHaveLength(1)
    expect(review.plan[0].text).toContain('报价单')
    expect(review.plan[0].when).toBe('下周')
  })

  it('没写具体的事时，headline 明说这一周没什么内容', async () => {
    const { review } = await instant.analyze(req('客户方案一直拖着没拍板。'))

    expect(review.did).toEqual([])
    expect(review.headline).toBe('这一周没写出什么具体做的事。')
  })
})

describe('演示用假 AI · 和上周对账', () => {
  it('上周的行动项这周提到了，按有没有「做完」判成 done 或 partial', async () => {
    const previous = previousWeek({
      plan: [
        { text: '把方案发给客户', when: '周一' },
        { text: '整理季度数据', when: '' },
        { text: '预约体检', when: '' },
      ],
    })
    const { review } = await instant.analyze(
      // 「已经」是判成做完了的口头信号之一（DONE_HINT），光说「发过去了」还不算
      req('周一就把方案发过去了，已经发到客户手上。\n季度数据整理了一半，还差两个系统。', {
        previous,
      }),
    )

    const byText = new Map(review.reconcile.map((r) => [r.text, r]))
    // 原样照抄上周那条，不重写
    expect([...byText.keys()]).toEqual(['把方案发给客户', '整理季度数据', '预约体检'])
    expect(byText.get('把方案发给客户')?.state).toBe('done')
    expect(byText.get('把方案发给客户')?.note).toBe('这周写到了')
    expect(byText.get('整理季度数据')?.state).toBe('partial')
    expect(byText.get('整理季度数据')?.note).toContain('季度数据')
    expect(byText.get('预约体检')?.state).toBe('unmentioned')
    expect(byText.get('预约体检')?.note).toBe('')
  })

  it('原文里出现「搞定」这类字眼就算做完了', async () => {
    const previous = previousWeek({ plan: [{ text: '把报价发出去', when: '' }] })
    const { review } = await instant.analyze(req('报价的事搞定了，周五就发出去了。', { previous }))

    expect(review.reconcile[0].state).toBe('done')
  })

  it('没有上一周时，对账那一栏是空的，不会硬凑', async () => {
    const { review } = await instant.analyze(req(NOTES))
    expect(review.reconcile).toEqual([])
  })

  it('上周的老问题这周又出现时，nudge 明说「上周也在」', async () => {
    const previous = previousWeek({ issues: [{ text: '客户方案一直拖延着没拍板', key: '拖延' }] })
    const { review } = await instant.analyze(
      req('客户方案又拖着没定，我催了两次也没用。\n这周开了三次评审会。', { previous }),
    )

    expect(review.nudge).toContain('上周也在')
    expect(review.nudge).toContain('这周又碰上了')
  })
})

describe('演示用假 AI · 补漏提醒', () => {
  it('一个字都没提到钱时，nudge 里出现「钱」那一角', async () => {
    const notes = [
      '这周跟老王吃了顿饭，聊得挺放松。',
      '跑了三次步，身体比上周好点。',
      '心情还行，周末看了部电影。',
      '想明白了：先把一件事做完再说。',
    ].join('\n')
    const { review } = await instant.analyze(req(notes))

    expect(review.nudge).toContain('钱')
  })

  it('空原文给出明确的空态 headline，而不是编出一份复盘', async () => {
    const { review } = await instant.analyze(req('   \n  '))

    expect(review.headline).toBe('这一周还没写出什么。')
    expect(review.did).toEqual([])
    expect(review.issues).toEqual([])
    expect(review.plan).toEqual([])
    expect(review.nudge).toContain('先随手写两句')
  })
})

describe('演示用假 AI · 补充与耗时', () => {
  it('补充说明时给一句 reply，第一次整理时是空串', async () => {
    const followUp = await instant.analyze(req(NOTES, { isFollowUp: true }))
    expect(followUp.reply.length).toBeGreaterThan(0)
    expect(followUp.review.headline.length).toBeGreaterThan(0)

    const first = await instant.analyze(req(NOTES))
    expect(first.reply).toBe('')
  })

  it('instant 模式下不等那 900 毫秒', async () => {
    const startedAt = Date.now()
    await instant.analyze(req(NOTES))
    expect(Date.now() - startedAt).toBeLessThan(500)
  })
})
