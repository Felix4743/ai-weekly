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

/**
 * 0.9.4：状态那一栏多了「追问小结」（低分项聊出来的那一段）。
 *
 * 它跟备注是**两个字段**：备注是用户自己写的字，小结是模型据追问写的。
 * 混成一个字段的话，「接着补」的第二轮会把上一轮的小结原样再抄一遍。
 */
describe('状态 · 追问小结', () => {
  it('给了小结就写进 followUp，跟备注并存', () => {
    expect(attachState({ sleep: 2 }, '这周还行', '睡眠：躺下睡不着')).toEqual({
      scores: { sleep: 2 },
      note: '这周还行',
      followUp: '睡眠：躺下睡不着',
    })
  })

  it('没有小结就不写这个键 —— 空串不该在存档里留一个空字段', () => {
    expect(attachState({ sleep: 2 }, '这周还行')).toEqual({
      scores: { sleep: 2 },
      note: '这周还行',
    })
    expect('followUp' in attachState(undefined, '只有备注', '   ')).toBe(false)
  })

  it('只有小结、没有备注和分数也算一份状态（一项都没点就不写 scores）', () => {
    const state = attachState(undefined, '', '运动：回到家太晚，挤不出时间')
    expect(state.followUp).toBe('运动：回到家太晚，挤不出时间')
    expect(state.note).toBe('')
    expect('scores' in state).toBe(false)
  })

  it('小结前后的空白会被剪掉', () => {
    expect(attachState(undefined, '', '  睡眠不好是因为刷手机  ').followUp).toBe(
      '睡眠不好是因为刷手机',
    )
  })

  it('不传小结就等于清掉它 —— 所以每个「只改别处」的调用都得把它带回来', () => {
    const before = attachState({ mood: 3 }, '备注', '小结')
    expect(before.followUp).toBe('小结')
    // 改分数时如果忘了带上 followUp，这一段就没了（refineMerge / ResultBody 都靠这条约定）
    expect(attachState(before.scores, before.note).followUp).toBeUndefined()
  })
})
