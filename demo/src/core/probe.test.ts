import { describe, expect, it } from 'vitest'
import { LOW_SCORE_MAX, lowScoreItems, lowScoreKeys, probeQuestions, scoresLine } from './probe'
import { SCORE_MAX } from './stateScore'
import { STATE_KEYS } from './types'

/**
 * 0.9.4 的新那一步：打完分之后**按分数**决定接着问什么。
 *
 * 用户的原话是「第一步打完分之后就没后续了……我想打完分之后才根据打分情况进行提问」，
 * 举的例子是「睡眠不好是为什么」「运动不够是为什么可以挤时间吗」。
 * 这一组用例盯的就是「哪几项值得追」和「追的时候要问到什么」这两件事。
 */

describe('状态追问 · 哪几项算低分', () => {
  it('分低线是 2 星：2 分及以下都要追', () => {
    expect(LOW_SCORE_MAX).toBe(2)
    expect(lowScoreKeys({ sleep: SCORE_MAX })).toEqual([])
    expect(lowScoreKeys({ sleep: 3 })).toEqual([])
    expect(lowScoreKeys({ sleep: 2 })).toEqual(['sleep'])
    expect(lowScoreKeys({ sleep: 1 })).toEqual(['sleep'])
  })

  it('没打分不算低分 —— 「没点」跟「点了 2 分」是两件事，不能凭空造出一场追问', () => {
    expect(lowScoreKeys({})).toEqual([])
    expect(lowScoreKeys(undefined)).toEqual([])
  })

  it('脏分数当没打分：0 / 6 / 小数 / 字符串一律不追', () => {
    const dirty = { mood: 0, sleep: 6, sport: 3.5, diet: '1' } as never
    expect(lowScoreKeys(dirty)).toEqual([])
  })

  it('多项都低时按打分卡上的顺序（心情 → 睡眠 → 运动 → 饮食）', () => {
    expect(lowScoreKeys({ diet: 1, sport: 2, mood: 2, sleep: 5 })).toEqual([
      'mood',
      'sport',
      'diet',
    ])
    expect(STATE_KEYS).toEqual(['mood', 'sleep', 'sport', 'diet'])
  })
})

describe('状态追问 · 要问到什么', () => {
  it('每一项都给出「要问到什么」加示例，且示例是问句', () => {
    const items = lowScoreItems({ mood: 2, sleep: 1, sport: 2, diet: 2 })
    expect(items).toHaveLength(4)
    for (const item of items) {
      expect(item.label.trim().length).toBeGreaterThan(0)
      expect(item.intent.trim().length).toBeGreaterThan(0)
      expect(item.examples.length).toBeGreaterThan(0)
      expect(item.examples[0].endsWith('？')).toBe(true)
      expect(item.score).toBeGreaterThanOrEqual(1)
      expect(item.score).toBeLessThanOrEqual(LOW_SCORE_MAX)
    }
  })

  it('睡眠问的是「什么挡着」，运动问的是「时间能不能挤出来」（用户点名的两句）', () => {
    const sleep = lowScoreItems({ sleep: 1 })[0]
    expect(sleep.label).toBe('睡眠')
    expect(sleep.intent).toContain('挡')
    expect(sleep.examples.join('')).toContain('睡眠不好是为什么')

    const sport = lowScoreItems({ sport: 2 })[0]
    expect(sport.label).toBe('运动')
    expect(sport.examples.join('')).toContain('挤')
  })

  it('追问落点是原因与腾挪空间，不是评判 —— 一句「为什么没做到」都没有', () => {
    const intents = lowScoreItems({ mood: 1, sleep: 1, sport: 1, diet: 1 }).map((i) => i.intent)
    for (const text of intents) {
      expect(text).not.toContain('为什么没')
      expect(text).not.toContain('应该')
    }
  })

  it('摊成题目时带上项名，一项一道、顺序不变', () => {
    const questions = probeQuestions(['sleep', 'sport'])
    expect(questions).toHaveLength(2)
    expect(questions[0].intent).toContain('睡眠')
    expect(questions[1].intent).toContain('运动')
    expect(questions[0].intent).not.toBe(questions[1].intent)
  })

  it('没有低分项就是零道题 —— 那一步整步不存在', () => {
    expect(probeQuestions([])).toEqual([])
    expect(lowScoreItems(undefined)).toEqual([])
  })

  it('两项都低时，两道题的内容确实不一样（不是同一句念两遍）', () => {
    const [first, second] = probeQuestions(['sleep', 'sport'])
    expect(first.examples).not.toEqual(second.examples)
    expect(first.intent).not.toBe(second.intent)
  })
})

describe('状态追问 · 提示词里那一行分数', () => {
  it('按打分卡顺序列已点的项，写成 `睡眠 2/5`', () => {
    expect(scoresLine({ sleep: 2, mood: 4 }, SCORE_MAX)).toBe('心情 4/5 · 睡眠 2/5')
  })

  it('没点过的项不出现；一项都没点就是空串', () => {
    expect(scoresLine({ sport: 1 }, SCORE_MAX)).toBe('运动 1/5')
    expect(scoresLine({}, SCORE_MAX)).toBe('')
    expect(scoresLine(undefined, SCORE_MAX)).toBe('')
  })
})
