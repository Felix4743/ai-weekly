import { describe, expect, it } from 'vitest'
import type { WeekEntry } from './archive'
import {
  PATTERN_WINDOW,
  compareScores,
  compareText,
  normalizeText,
  patternHitLine,
  patternHitText,
  patternSummary,
  previousEntry,
  recurringPatterns,
  shortWeek,
  similarity,
  type CompareRow,
  type PatternGroup,
} from './trends'
import { createEmptyResult, createEmptyState, type WeeklyResult } from './types'
import type { WeekKey } from './week'

/** 三个连着的好星期（都是周一） */
const W1: WeekKey = '2026-09-21'
const W2: WeekKey = '2026-09-28'
const W3: WeekKey = '2026-10-05'
const W4: WeekKey = '2026-10-12'

function entry(week: WeekKey, result: Partial<WeeklyResult> = {}): WeekEntry {
  return { week, savedAt: 0, result: { ...createEmptyResult(), ...result } }
}

function state(scores: Record<string, number>, note = ''): WeeklyResult['state'] {
  return { ...createEmptyState(), scores, note }
}

function row(over: Partial<CompareRow> = {}): CompareRow {
  return {
    key: 'sleep',
    label: '睡眠',
    current: 4,
    previousTag: '上周',
    previousRange: '9月21日 – 9月27日',
    ...over,
  }
}

describe('normalizeText', () => {
  it('标点和空格都不算数', () => {
    expect(normalizeText('把报价发出去。')).toBe('把报价发出去')
    expect(normalizeText('「张总」，那个  事')).toBe('张总那个事')
    expect(normalizeText('打 Apex，卡在白金 1')).toBe('打apex卡在白金1')
  })

  it('全角数字字母和大小写都归一', () => {
    expect(normalizeText('１２３ ＡＢＣ')).toBe('123abc')
    expect(normalizeText('APEX')).toBe('apex')
  })

  it('汉字留着', () => {
    expect(normalizeText('报销单还没交')).toBe('报销单还没交')
  })
})

describe('similarity', () => {
  it('一模一样是 1', () => {
    expect(similarity('报价发出去', '报价发出去')).toBe(1)
  })

  it('换了个说法还是很像', () => {
    const score = similarity('报价发出去', '报价发出去了')
    expect(score).toBeGreaterThanOrEqual(0.5)
    expect(score).toBeCloseTo(0.89, 2)
  })

  it('同一个动词配不同宾语不该算一件事', () => {
    expect(similarity('把报价发出去', '把简历发出去')).toBeCloseTo(0.4, 6)
  })

  it('毫不相干是 0', () => {
    expect(similarity('写家书', '打apex')).toBe(0)
  })

  it('单字只认完全相同', () => {
    expect(similarity('妈', '妈')).toBe(1)
    expect(similarity('妈', '爸')).toBe(0)
  })
})

describe('previousEntry', () => {
  it('取严格更早的最近一条', () => {
    const archive = [entry(W3), entry(W2), entry(W1)]
    expect(previousEntry(archive, W3)?.week).toBe(W2)
  })

  it('归档乱序也对', () => {
    const archive = [entry(W1), entry(W3), entry(W2)]
    expect(previousEntry(archive, W3)?.week).toBe(W2)
  })

  it('中间缺周就往前找', () => {
    expect(previousEntry([entry(W1), entry(W3)], W3)?.week).toBe(W1)
  })

  it('同周和之后的周都不算', () => {
    expect(previousEntry([entry(W3), entry(W4)], W3)).toBeNull()
  })

  it('没有更早的就是 null', () => {
    expect(previousEntry([], W3)).toBeNull()
    expect(previousEntry([entry(W3)], W3)).toBeNull()
  })
})

describe('compareScores', () => {
  it('四项都在，顺序跟状态栏一致', () => {
    const comparison = compareScores({ sleep: 4 }, entry(W2, { state: state({ sleep: 3 }) }), W3)
    expect(comparison.rows.map((r) => r.key)).toEqual(['mood', 'sleep', 'sport', 'diet'])
    expect(comparison.rows.map((r) => r.label)).toEqual(['心情', '睡眠', '运动', '饮食'])
  })

  it('两边都有分才算得出差多少', () => {
    const comparison = compareScores(
      { sleep: 4, mood: 2 },
      entry(W2, { state: state({ sleep: 3, mood: 4, diet: 5 }) }),
      W3,
    )
    const byKey = Object.fromEntries(comparison.rows.map((r) => [r.key, r]))
    expect(byKey.sleep.delta).toBe(1)
    expect(byKey.mood.delta).toBe(-2)
    // 这一周没打饮食：上一周有分也不算差值
    expect(byKey.diet.previous).toBe(5)
    expect(byKey.diet.delta).toBeUndefined()
    expect(byKey.sport.delta).toBeUndefined()
    expect(comparison.up).toBe(1)
    expect(comparison.down).toBe(1)
  })

  it('挨着的一周说「上周」，隔了更久说「上一次」', () => {
    const near = compareScores(undefined, entry(W2, { state: state({ sleep: 3 }) }), W3)
    expect(near.previousTag).toBe('上周')
    expect(near.rows[0].previousTag).toBe('上周')

    const far = compareScores(undefined, entry(W1, { state: state({ sleep: 3 }) }), W3)
    expect(far.previousTag).toBe('上一次')
    expect(far.rows[0].previousTag).toBe('上一次')
    expect(far.previousRange).toContain('9月21日')
    expect(far.previousWeek).toBe(W1)
  })

  it('上一条记录没打分的项，只说没打分', () => {
    const comparison = compareScores({ sleep: 4 }, entry(W2, { state: state({ mood: 3 }) }), W3)
    const sleep = comparison.rows.find((r) => r.key === 'sleep')
    expect(sleep?.previous).toBeUndefined()
    expect(compareText(sleep!)).toBe('上周没打分')
  })

  it('没有更早的记录就什么都不说', () => {
    const comparison = compareScores({ sleep: 4 }, null, W3)
    expect(comparison.previousWeek).toBeNull()
    expect(comparison.previousTag).toBeNull()
    expect(comparison.previousRange).toBe('')
    expect(comparison.up).toBe(0)
    expect(comparison.down).toBe(0)
    expect(comparison.rows.every((r) => r.previousTag === null)).toBe(true)
    expect(compareText(comparison.rows[0])).toBe('')
  })
})

describe('compareText', () => {
  it('涨了掉了持平各说各的', () => {
    expect(compareText(row({ previous: 3, delta: 1 }))).toBe('上周 3 ↑1')
    expect(compareText(row({ previous: 4, delta: -2 }))).toBe('上周 4 ↓2')
    expect(compareText(row({ previous: 3, delta: 0 }))).toBe('上周 3 持平')
    expect(compareText(row({ previous: 5 }))).toBe('上周 5')
  })

  it('没得比就是空串', () => {
    expect(compareText(row({ previousTag: null }))).toBe('')
  })

  it('这一周还没打分的项不跟上次比 —— 免得四行里有两行挂着没用的字', () => {
    expect(compareText(row({ current: undefined, previous: 3, delta: undefined }))).toBe('')
    expect(compareText(row({ current: undefined, previous: undefined, delta: undefined }))).toBe('')
  })
})

describe('卡片上的小字', () => {
  it('日期取到天', () => {
    expect(shortWeek(W1)).toBe('9月21日')
    expect(shortWeek('乱写的')).toBe('乱写的')
  })

  it('每一笔标出是哪一栏', () => {
    expect(patternHitLine({ week: W1, text: 'x', source: 'pending' })).toBe('9月21日 · 未办')
    expect(patternHitLine({ week: W1, text: 'x', source: 'nextFocus' })).toBe('9月21日 · 计划')
    expect(patternHitLine({ week: W1, text: '张总', source: 'people' })).toBe('9月21日 · 提到')
  })

  it('一句话说明挂了几周', () => {
    const stuck: PatternGroup = { kind: 'stuck', text: 'x', hits: [], weeks: 2 }
    const person: PatternGroup = { kind: 'person', text: '张总', hits: [], weeks: 3 }
    expect(patternSummary(stuck)).toBe('2 周都挂着')
    expect(patternSummary(person)).toBe('3 周都提到')
  })

  it('人名那一笔给备注，其余的给原话', () => {
    expect(patternHitText({ week: W1, text: '张总', source: 'people', detail: '那通电话还没回' })).toBe(
      '那通电话还没回',
    )
    expect(patternHitText({ week: W1, text: '报价还没发', source: 'pending' })).toBe('报价还没发')
  })
})

describe('recurringPatterns', () => {
  it('上周计划里说要发的报价，这周还挂在未办里', () => {
    const groups = recurringPatterns(
      [entry(W3, { pending: ['报价还是没发出去'] }), entry(W2, { nextFocus: ['把报价发出去'] })],
      W3,
    )
    expect(groups).toHaveLength(1)
    expect(groups[0].kind).toBe('stuck')
    // 代表说法取最早那一周的原话
    expect(groups[0].text).toBe('把报价发出去')
    expect(groups[0].weeks).toBe(2)
    expect(groups[0].hits.map((hit) => hit.week)).toEqual([W2, W3])
    expect(groups[0].hits.map((hit) => hit.source)).toEqual(['nextFocus', 'pending'])
  })

  it('两周未办说的是同一件事就并成一条', () => {
    const groups = recurringPatterns(
      [entry(W1, { pending: ['报销单还没交'] }), entry(W2, { pending: ['报销单还没交上去'] })],
      W2,
    )
    expect(groups).toHaveLength(1)
    expect(groups[0].hits.map((hit) => hit.text)).toEqual(['报销单还没交', '报销单还没交上去'])
  })

  it('同一个人连着两周提到就算一条，带上那两周的备注', () => {
    const groups = recurringPatterns(
      [
        entry(W1, { people: [{ name: '张总', note: '那通电话还没回' }] }),
        entry(W2, { people: [{ name: '张总 ', note: '方案又催了一次' }] }),
      ],
      W2,
    )
    expect(groups).toHaveLength(1)
    expect(groups[0].kind).toBe('person')
    expect(groups[0].text).toBe('张总')
    expect(patternHitText(groups[0].hits[0])).toBe('那通电话还没回')
    expect(patternHitText(groups[0].hits[1])).toBe('方案又催了一次')
  })

  it('名字像但不是同一个人，不并', () => {
    // 「张总好」和「李总好」按相似度是 0.5，正好卡在阈值上 —— 人名只认完全一样
    expect(similarity('张总好', '李总好')).toBeCloseTo(0.5, 6)
    const groups = recurringPatterns(
      [
        entry(W1, { people: [{ name: '张总好', note: '' }] }),
        entry(W2, { people: [{ name: '李总好', note: '' }] }),
      ],
      W2,
    )
    expect(groups).toEqual([])
  })

  it('只出现过一周的不算反复', () => {
    expect(
      recurringPatterns([entry(W1, { pending: ['报销单还没交'] })], W1),
    ).toEqual([])
  })

  it('三周都挂着就说三周', () => {
    const groups = recurringPatterns(
      [
        entry(W1, { pending: ['报销单还没交'] }),
        entry(W2, { pending: ['报销单还没交'] }),
        entry(W3, { pending: ['报销单还没交'] }),
      ],
      W3,
    )
    expect(groups).toHaveLength(1)
    expect(groups[0].weeks).toBe(3)
  })

  it('同一周里只记一笔', () => {
    const groups = recurringPatterns(
      [
        entry(W1, { pending: ['报销单还没交'], nextFocus: ['报销单还没交'] }),
        entry(W2, { pending: ['报销单还没交'] }),
      ],
      W2,
    )
    expect(groups).toHaveLength(1)
    expect(groups[0].weeks).toBe(2)
    expect(groups[0].hits.map((hit) => hit.week)).toEqual([W1, W2])
  })

  it('这一周之后的归档不参与', () => {
    expect(
      recurringPatterns(
        [entry(W2, { nextFocus: ['把报价发出去'] }), entry(W3, { pending: ['报价还是没发出去'] })],
        W2,
      ),
    ).toEqual([])
  })

  it('只看最近这么多条记录', () => {
    const archive = [
      entry(W1, { pending: ['报销单还没交'] }),
      entry(W2, { pending: ['报销单还没交'] }),
    ]
    expect(recurringPatterns(archive, W2, { window: 1 })).toEqual([])
    expect(recurringPatterns(archive, W2, { window: PATTERN_WINDOW })).toHaveLength(1)
  })

  it('出现周数多的排前面', () => {
    const groups = recurringPatterns(
      [
        entry(W1, { pending: ['报销单还没交'] }),
        entry(W2, { pending: ['报销单还没交'], nextFocus: ['把报价发出去'] }),
        entry(W3, { pending: ['报销单还没交'], nextFocus: ['把报价发出去'] }),
      ],
      W3,
    )
    expect(groups[0].text).toBe('报销单还没交')
    expect(groups[0].weeks).toBe(3)
    expect(groups[1].text).toBe('把报价发出去')
    expect(groups[1].weeks).toBe(2)
  })

  it('门槛可以调：minWeeks 放宽到 1 就单周也列', () => {
    const archive = [entry(W1, { pending: ['报销单还没交'] })]
    expect(recurringPatterns(archive, W1, { minWeeks: 1 })).toHaveLength(1)
  })

  it('门槛可以调：相似度要求提到 0.99 就不并了', () => {
    const archive = [
      entry(W1, { pending: ['报销单还没交'] }),
      entry(W2, { pending: ['报销单还没交上去'] }),
    ]
    expect(recurringPatterns(archive, W2, { minSimilarity: 0.99 })).toEqual([])
  })

  it('一个字两句话判不出来，跳过；人名例外', () => {
    expect(
      recurringPatterns([entry(W1, { pending: ['钱'] }), entry(W2, { pending: ['钱'] })], W2),
    ).toEqual([])
    const people = recurringPatterns(
      [entry(W1, { people: [{ name: '妈', note: '' }] }), entry(W2, { people: [{ name: '妈', note: '' }] })],
      W2,
    )
    expect(people).toHaveLength(1)
    expect(people[0].weeks).toBe(2)
  })

  it('空白条目直接忽略', () => {
    expect(
      recurringPatterns([entry(W1, { pending: ['   '] }), entry(W2, { pending: ['  '] })], W2),
    ).toEqual([])
  })
})
