import { describe, expect, it } from 'vitest'
import {
  SCORE_MAX,
  attachState,
  coerceScore,
  coerceScores,
  hasAnyScore,
  scoreSuffix,
  scoreText,
  scoresText,
  withScore,
} from './stateScore'
import { STATE_KEYS, createEmptyState } from './types'

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
    expect(coerceScores({ mood: 4, sleep: 0, sport: '2', diet: 5, 别的: 3 })).toEqual({
      mood: 4,
      diet: 5,
    })
  })

  it('不是对象就是空的', () => {
    for (const bad of [null, undefined, '4', 4, [], true]) {
      expect(coerceScores(bad)).toEqual({})
    }
  })

  it('有没有分可用 hasAnyScore 问', () => {
    expect(hasAnyScore({})).toBe(false)
    expect(hasAnyScore(undefined)).toBe(false)
    expect(hasAnyScore({ mood: 0 })).toBe(false)
    expect(hasAnyScore({ sleep: 2 })).toBe(true)
  })

  it('四项的键就是 STATE_KEYS，顺序是打分卡上四排星的顺序', () => {
    expect(STATE_KEYS).toEqual(['mood', 'sleep', 'sport', 'diet'])
    expect(coerceScores({ mood: 1, sleep: 2, sport: 3, diet: 4 })).toEqual({
      mood: 1,
      sleep: 2,
      sport: 3,
      diet: 4,
    })
  })
})

describe('状态评分 · 点星与落盘', () => {
  it('点一颗就写上一项，再点同一颗（传 undefined）就把这一项拿掉', () => {
    const one = withScore(undefined, 'mood', 4)
    expect(one).toEqual({ mood: 4 })
    expect(withScore(one, 'sleep', 2)).toEqual({ mood: 4, sleep: 2 })
    expect(withScore(one, 'mood', undefined)).toEqual({})
    expect(withScore(one, 'mood', 0)).toEqual({})
  })

  it('不在原来的对象上改', () => {
    const before = { mood: 4 }
    const after = withScore(before, 'sleep', 3)
    expect(before).toEqual({ mood: 4 })
    expect(after).toEqual({ mood: 4, sleep: 3 })
  })

  it('贴到状态上：一项都没点就不写 scores 这个键', () => {
    expect('scores' in attachState(undefined, '')).toBe(false)
    expect('scores' in attachState({}, '')).toBe(false)
    // 0 分不算分：不许留下一个空对象让以后分不清「没打分」和「打了 0 分」
    expect('scores' in attachState({ mood: 0 }, '')).toBe(false)

    const scored = attachState({ mood: 4, sleep: 0 }, '  睡得还行  ')
    expect(scored.scores).toEqual({ mood: 4 })
    // 备注掐掉两头空白
    expect(scored.note).toBe('睡得还行')
  })

  it('只贴给进来的那一份：旧分数不参与合并', () => {
    const first = attachState({ mood: 5 }, '睡得还行')
    expect(first).toEqual({ note: '睡得还行', scores: { mood: 5 } })

    // 再贴一次时只认这一次点击 + 这一行备注，上一次的分不会从缝里钻回来
    const second = attachState(undefined, first.note)
    expect(second).toEqual({ note: '睡得还行' })
    expect('scores' in second).toBe(false)
  })

  it('把最后一颗星点掉时，这一项就从状态里消失，备注留着', () => {
    const scores = withScore({ mood: 3 }, 'mood', undefined)
    expect(hasAnyScore(scores)).toBe(false)

    const state = attachState(scores, '睡得还行')
    expect('scores' in state).toBe(false)
    expect(state.note).toBe('睡得还行')
  })

  it('空状态就是「没备注也没分」', () => {
    expect(createEmptyState()).toEqual({ note: '' })
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

  it('scoresText 按 STATE_KEYS 的顺序拼中点号，没点的项不出现', () => {
    expect(scoresText(undefined)).toBe('')
    expect(scoresText({})).toBe('')
    expect(scoresText({ mood: 0 })).toBe('')
    expect(scoresText({ mood: 4 })).toBe('心情 4/5')
    // 跟点击顺序无关，永远按四项的固定顺序排
    expect(scoresText({ sleep: 3, mood: 4 })).toBe('心情 4/5 · 睡眠 3/5')
    expect(scoresText({ mood: 4, sleep: 0, sport: 5, diet: 2 })).toBe(
      '心情 4/5 · 运动 5/5 · 饮食 2/5',
    )
  })
})
