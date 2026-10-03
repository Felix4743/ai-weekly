import { describe, expect, it } from 'vitest'
import {
  SCORE_MAX,
  attachScores,
  coerceScore,
  coerceScores,
  hasAnyScore,
  scoreSuffix,
  scoreText,
  withScore,
} from './stateScore'
import { createEmptyState } from './types'

describe('状态评分 · 什么算一个合法的分', () => {
  it('只认 1–5 的整数', () => {
    expect(coerceScore(1)).toBe(1)
    expect(coerceScore(5)).toBe(5)
    expect(coerceScore(3)).toBe(3)
    expect(SCORE_MAX).toBe(5)
  })

  it('0 分和「没打分」是一回事，6 分以上、小数、字符串都当没打分', () => {
    for (const bad of [0, 6, 99, 3.5, -1, '3', null, undefined, true, NaN, {}, []]) {
      expect(coerceScore(bad)).toBeUndefined()
    }
  })
})

describe('状态评分 · 收一组合法的分', () => {
  it('四项里合法的留下，不合法的丢掉，别的键不管', () => {
    expect(
      coerceScores({ body: 4, mood: 0, focus: '2', growth: 5, 别的: 3 }),
    ).toEqual({ body: 4, growth: 5 })
  })

  it('不是对象就是空的', () => {
    for (const bad of [null, undefined, '4', 4, [], true]) {
      expect(coerceScores(bad)).toEqual({})
    }
  })

  it('有没有分可用 hasAnyScore 问', () => {
    expect(hasAnyScore({})).toBe(false)
    expect(hasAnyScore(undefined)).toBe(false)
    expect(hasAnyScore({ body: 0 })).toBe(false)
    expect(hasAnyScore({ mood: 2 })).toBe(true)
  })
})

describe('状态评分 · 点星与落盘', () => {
  it('点一颗就写上一项，再点同一颗（传 undefined）就把这一项拿掉', () => {
    const one = withScore(undefined, 'mood', 4)
    expect(one).toEqual({ mood: 4 })
    expect(withScore(one, 'body', 2)).toEqual({ mood: 4, body: 2 })
    expect(withScore(one, 'mood', undefined)).toEqual({})
    expect(withScore(one, 'mood', 0)).toEqual({})
  })

  it('不在原来的对象上改', () => {
    const before = { mood: 4 }
    const after = withScore(before, 'body', 3)
    expect(before).toEqual({ mood: 4 })
    expect(after).toEqual({ mood: 4, body: 3 })
  })

  it('贴到状态上：一项都没点就不写 scores 这个键', () => {
    const state = createEmptyState()
    expect('scores' in attachScores(state, undefined)).toBe(false)
    expect('scores' in attachScores(state, {})).toBe(false)
    // 0 分不算分：不许留下一个空对象让以后分不清「没打分」和「打了 0 分」
    expect('scores' in attachScores(state, { mood: 0 })).toBe(false)

    const scored = attachScores(state, { body: 3, mood: 0 })
    expect(scored.scores).toEqual({ body: 3 })
    // 文字原样带过去
    expect(scored.body).toBe('')
  })

  it('贴分数时不改原来那份状态', () => {
    const state = createEmptyState()
    attachScores(state, { body: 3 })
    expect('scores' in state).toBe(false)
  })

  it('把最后一颗星点掉时，旧分数也跟着拿掉', () => {
    const scored = { ...createEmptyState(), scores: { mood: 3 } }
    expect('scores' in attachScores(scored, {})).toBe(false)
    expect('scores' in attachScores(scored, { mood: 0 })).toBe(false)
    // 文字照旧带过去
    const withText = { body: '睡得还行', mood: '', focus: '', growth: '', scores: { body: 4 } }
    const cleared = attachScores(withText, {})
    expect(cleared.body).toBe('睡得还行')
    expect('scores' in cleared).toBe(false)
  })
})

describe('状态评分 · 界面文案', () => {
  it('分数写成「3 / 5」，没打分就写「未打分」', () => {
    expect(scoreText(3)).toBe('3 / 5')
    expect(scoreText(0)).toBe('未打分')
    expect(scoreText(undefined)).toBe('未打分')
  })

  it('跟在一句文字后面的分数带括号，没有就是空串', () => {
    expect(scoreSuffix(4)).toBe('（4 / 5）')
    expect(scoreSuffix(undefined)).toBe('')
  })
})
