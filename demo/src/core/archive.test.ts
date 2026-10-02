import { describe, expect, it } from 'vitest'
import {
  ARCHIVE_LIMIT,
  archiveStats,
  findEntry,
  isEmptyEntry,
  lastWrittenAt,
  mainLine,
  moveWeek,
  previousWeekContext,
  recentSlots,
  repeatCount,
  sortEntries,
  updateWeek,
  upsertWeek,
  weekCounts,
  type WeekEntry,
} from './archive'
import { createEmptyReview, type Issue, type Review } from './review'

/**
 * 归档层的规则几乎全是「同一周只留一份」「空条目不留」「不许顶掉别人」这几件事的变体。
 * 这几条错了，日历不会报错，只会安静地显示错的周 —— 所以逐条钉住。
 */

function review(overrides: Partial<Review> = {}): Review {
  return { ...createEmptyReview(), headline: '这周被方案拖着', ...overrides }
}

function issue(key: string, text = '报销拖了两周'): Issue {
  return { text, advice: [], key }
}

/** 一份正常的记录：有原文、也有复盘 */
function entry(week: string, overrides: Partial<Review> = {}, savedAt = 1): WeekEntry {
  return { week, savedAt, notes: '这周改了三版方案', review: review(overrides) }
}

/** 只写了原文、还没复盘的那一条 */
function bare(week: string, notes = '', savedAt = 1): WeekEntry {
  return { week, savedAt, notes, review: null }
}

/** 本地时间，别让测试自己掉进 UTC 的坑 */
function at(y: number, m: number, d: number, h = 12): Date {
  return new Date(y, m - 1, d, h)
}

/** 测试里自己造一串连着的周一，别依赖被测代码 */
function mondayFrom(start: string, weeks: number): string {
  const [y, m, d] = start.split('-').map(Number)
  const date = new Date(y, m - 1, d + weeks * 7)
  const pad = (n: number) => (n < 10 ? `0${n}` : String(n))
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

describe('归档 · 写入', () => {
  it('同一周写十遍也只留一份，后来的覆盖先前的', () => {
    let list: WeekEntry[] = []
    for (let i = 0; i < 10; i += 1) {
      list = upsertWeek(list, entry('2026-09-21', { headline: `第 ${i} 版` }, i))
    }
    expect(list).toHaveLength(1)
    expect(mainLine(list[0])).toBe('第 9 版')
    expect(list[0].savedAt).toBe(9)
  })

  it('新的在前，方便直接从上往下读', () => {
    const list = [entry('2026-09-07'), entry('2026-09-28'), entry('2026-09-14'), entry('2026-09-21')]
    expect(sortEntries(list).map((e) => e.week)).toEqual([
      '2026-09-28',
      '2026-09-21',
      '2026-09-14',
      '2026-09-07',
    ])
  })

  it('超过上限时丢掉最旧的，不是丢掉最新的', () => {
    let list: WeekEntry[] = []
    for (let i = 0; i < ARCHIVE_LIMIT + 20; i += 1) {
      list = upsertWeek(list, entry(mondayFrom('2026-01-05', i)))
    }
    expect(list).toHaveLength(ARCHIVE_LIMIT)
    expect(list[0].week).toBe(mondayFrom('2026-01-05', ARCHIVE_LIMIT + 19))
    expect(findEntry(list, '2026-01-05')).toBeNull()
  })

  it('什么都没写的条目算空：没原文也没有复盘', () => {
    expect(isEmptyEntry(bare('2026-09-21'))).toBe(true)
    // 只有空白字符也等于没写 —— 「打开这一周、打了个空格就退了」
    expect(isEmptyEntry(bare('2026-09-21', '   \n  '))).toBe(true)
  })

  it('只要有一句原文、或者有一份复盘，就不算空', () => {
    expect(isEmptyEntry(bare('2026-09-21', '记一笔'))).toBe(false)
    expect(isEmptyEntry(entry('2026-09-21'))).toBe(false)
  })

  it('空条目进不了归档，也不会挤掉别人', () => {
    const list = [entry('2026-09-21')]
    expect(upsertWeek(list, bare('2026-09-14'))).toEqual(list)
    expect(upsertWeek([], bare('2026-09-21'))).toEqual([])
  })

  it('同一周被写成空条目时，先前那一份也一起清掉', () => {
    // 用户把这一周的内容整个删了 —— 留一份「有一周、但什么都没有」的存档没有意义
    expect(upsertWeek([entry('2026-09-21')], bare('2026-09-21'))).toEqual([])
  })

  it('按周查得到就是那一条，查不到就是 null', () => {
    const list = [entry('2026-09-14'), entry('2026-09-21')]
    expect(findEntry(list, '2026-09-21')?.week).toBe('2026-09-21')
    expect(findEntry(list, '2026-09-07')).toBeNull()
    expect(findEntry([], '2026-09-21')).toBeNull()
  })
})

describe('归档 · 改与挪', () => {
  it('改旧的一周：存回原来那一周，另一周一根汗毛都没动', () => {
    const list = [entry('2026-09-14'), entry('2026-09-21')]
    const next = updateWeek(list, '2026-09-14', { notes: '补记一笔' }, 99)
    expect(next).toHaveLength(2)
    expect(findEntry(next, '2026-09-14')).toMatchObject({ notes: '补记一笔', savedAt: 99 })
    expect(findEntry(next, '2026-09-21')).toEqual(entry('2026-09-21'))
  })

  it('只改原文时保留原来的复盘，只改复盘时保留原文', () => {
    const list = [entry('2026-09-21', { headline: '原来的主线' })]

    const onlyNotes = updateWeek(list, '2026-09-21', { notes: '重写了一遍原文' }, 9)
    expect(findEntry(onlyNotes, '2026-09-21')).toMatchObject({
      notes: '重写了一遍原文',
      review: review({ headline: '原来的主线' }),
    })

    const onlyReview = updateWeek(list, '2026-09-21', { review: review({ headline: '换个说法' }) }, 9)
    expect(findEntry(onlyReview, '2026-09-21')).toMatchObject({ notes: '这周改了三版方案' })
    expect(mainLine(findEntry(onlyReview, '2026-09-21'))).toBe('换个说法')
  })

  it('把复盘设成 null 是合法的：只留原文，下次再复盘', () => {
    const next = updateWeek([entry('2026-09-21')], '2026-09-21', { review: null }, 9)
    expect(findEntry(next, '2026-09-21')).toMatchObject({
      notes: '这周改了三版方案',
      review: null,
      savedAt: 9,
    })
  })

  it('改一个还不存在的周时建一条', () => {
    const next = updateWeek([], '2026-09-21', { notes: '第一次写' }, 99)
    expect(next).toEqual([{ week: '2026-09-21', savedAt: 99, notes: '第一次写', review: null }])
  })

  it('用户删过的条目：改原文、换复盘、把复盘设成 null 都跟着留下', () => {
    const list: WeekEntry[] = [{ ...entry('2026-09-21'), dropped: ['发周报'] }]

    const onlyNotes = updateWeek(list, '2026-09-21', { notes: '补记一笔' }, 9)
    expect(findEntry(onlyNotes, '2026-09-21')?.dropped).toEqual(['发周报'])

    const onlyReview = updateWeek(
      list,
      '2026-09-21',
      { review: review({ headline: '换个说法' }) },
      9,
    )
    expect(findEntry(onlyReview, '2026-09-21')?.dropped).toEqual(['发周报'])

    const cleared = updateWeek(list, '2026-09-21', { review: null }, 9)
    expect(findEntry(cleared, '2026-09-21')?.dropped).toEqual(['发周报'])
  })

  it('明确传进一份新的 dropped 时换成新的', () => {
    const list: WeekEntry[] = [{ ...entry('2026-09-21'), dropped: ['发周报'] }]
    const next = updateWeek(list, '2026-09-21', { dropped: ['见客户'] }, 9)
    expect(findEntry(next, '2026-09-21')?.dropped).toEqual(['见客户'])
  })

  it('挪周：记录挪到目标周、盖上新的写入时刻，原文与复盘跟着走', () => {
    const list = [bare('2026-09-28', '周一早上补做的')]
    const moved = moveWeek(list, '2026-09-28', '2026-09-21', 77)
    expect(moved).not.toBe(list)
    expect(moved.map((e) => e.week)).toEqual(['2026-09-21'])
    expect(moved[0]).toMatchObject({ notes: '周一早上补做的', savedAt: 77 })
  })

  it('挪周：目标那一周已经有记录时原样返回（引用相等），绝不顶掉别人的存档', () => {
    const list = [entry('2026-09-21', { headline: '上一周原本的记录' }), entry('2026-09-28')]
    const next = moveWeek(list, '2026-09-28', '2026-09-21', 77)
    expect(next).toBe(list)
    expect(mainLine(findEntry(list, '2026-09-21'))).toBe('上一周原本的记录')
  })

  it('挪到同一周、或者来源周没有记录时，也原样返回', () => {
    const list = [entry('2026-09-28')]
    expect(moveWeek(list, '2026-09-28', '2026-09-28', 5)).toBe(list)
    expect(moveWeek(list, '2026-09-07', '2026-09-14', 5)).toBe(list)
  })
})

describe('归档 · 读出来是什么', () => {
  it('主线先是复盘那句话，一句话没写出来才退到做过的事', () => {
    expect(mainLine(entry('2026-09-21', { headline: '  真正的主线  ' }))).toBe('真正的主线')
    expect(mainLine(entry('2026-09-21', { headline: '   ' }))).toBe('')
    expect(mainLine(entry('2026-09-21', { headline: '', did: ['', ' 把合同签了 '] }))).toBe(
      '把合同签了',
    )
    expect(mainLine(entry('2026-09-21', { headline: '', issues: [issue('报销拖延', '报销拖了两周')] }))).toBe(
      '报销拖了两周',
    )
    expect(
      mainLine(entry('2026-09-21', { headline: '', plan: [{ text: '联系客户', when: '下周三' }] })),
    ).toBe('联系客户')
    expect(mainLine(bare('2026-09-21', '只写了原文'))).toBe('')
    expect(mainLine(null)).toBe('')
  })

  it('只剩对账项时，主线是空的 —— 那是上一周的事，不该摆进这一周', () => {
    expect(
      mainLine(
        entry('2026-09-21', {
          headline: '',
          reconcile: [{ text: '把提案写完', state: 'done', note: '周一就交了' }],
        }),
      ),
    ).toBe('')
  })

  it('条数统计四项都算对', () => {
    const counts = weekCounts(
      review({
        did: ['改了三版方案', '跟老王对齐了排期'],
        issues: [issue('报销拖延')],
        reconcile: [
          { text: '把报价发出去', state: 'done', note: '周三发了' },
          { text: '找老王对账', state: 'partial', note: '约了没成' },
        ],
        plan: [
          { text: '定稿', when: '周一' },
          { text: '报价', when: '' },
          { text: '约老王', when: '' },
        ],
      }),
    )
    expect(counts).toEqual({ did: 2, issues: 1, plan: 3, reconcile: 2 })
  })

  it('还没复盘的那一周，四项全是 0', () => {
    expect(weekCounts(null)).toEqual({ did: 0, issues: 0, plan: 0, reconcile: 0 })
  })

  it('近三周的位置：本周、上周、上上周，没记录的那一周也占着位置', () => {
    const now = at(2026, 9, 30)
    const list = [entry('2026-09-21'), entry('2026-09-07')]
    const slots = recentSlots(list, now)

    expect(slots.map((s) => s.week)).toEqual(['2026-09-28', '2026-09-21', '2026-09-14'])
    expect(slots.map((s) => s.relation)).toEqual(['this', 'last', 'twoAgo'])
    expect(slots.map((s) => s.label)).toEqual(['本周', '上周', '上上周'])
    expect(slots[0].entry).toBeNull() // 本周还没记
    expect(slots[1].entry).not.toBeNull()
    expect(slots[2].entry).toBeNull() // 上上周漏了 —— 这件事要看得见
  })

  it('近三周是按本地时间算的：周日晚算本周，周一凌晨算下一周', () => {
    const sunday = recentSlots([], at(2026, 9, 27, 23))
    const monday = recentSlots([], at(2026, 9, 28, 0))
    expect(sunday[0].week).toBe('2026-09-21')
    expect(monday[0].week).toBe('2026-09-28')
  })

  it('统计：总周数、最近一次、本周记没记', () => {
    const now = at(2026, 9, 30)
    const stats = archiveStats([entry('2026-09-14'), entry('2026-09-21')], now)
    expect(stats.weeks).toBe(2)
    expect(stats.latest).toBe('2026-09-21')
    expect(stats.hasThisWeek).toBe(false)
    expect(archiveStats([entry('2026-09-28')], now).hasThisWeek).toBe(true)
  })

  it('连续周数只数从最近一次往前不断档的那一段', () => {
    const now = at(2026, 9, 30)
    // 09-28、09-21、09-14 连着；09-07 也在，但 08-31 断了
    const list = [
      entry('2026-08-24'),
      entry('2026-09-07'),
      entry('2026-09-14'),
      entry('2026-09-21'),
      entry('2026-09-28'),
    ]
    expect(archiveStats(list, now).streak).toBe(4)
    // 中间断了一周：最近那次往前只连得上两周
    expect(
      archiveStats([entry('2026-09-07'), entry('2026-09-21'), entry('2026-09-28')], now).streak,
    ).toBe(2)
  })

  it('空存档不会算出一条假的连续记录', () => {
    expect(archiveStats([], at(2026, 9, 30))).toEqual({
      weeks: 0,
      streak: 0,
      latest: null,
      hasThisWeek: false,
      lastWritten: null,
    })
  })

  it('「上次记录」取的是最近一次写入，而不是最近的那一周', () => {
    // 三个月前那一周今天被改过：latest 还是那个老周，但上次动手是今天
    const today = at(2026, 9, 30).getTime()
    const list = [entry('2026-06-29', {}, today), entry('2026-09-21', {}, at(2026, 9, 22).getTime())]
    const stats = archiveStats(list, at(2026, 9, 30))
    expect(stats.latest).toBe('2026-09-21')
    expect(stats.lastWritten).toBe(today)
  })

  it('脏时间戳被跳过，不会顶掉真实的那一条', () => {
    const good = at(2026, 9, 22).getTime()
    expect(
      lastWrittenAt([
        bare('2026-09-14', '写了原文', Number.NaN),
        bare('2026-09-21', '写了原文', good),
      ]),
    ).toBe(good)
    expect(lastWrittenAt([bare('2026-09-21', '写了原文', Number.POSITIVE_INFINITY)])).toBeNull()
    expect(lastWrittenAt([bare('2026-09-21', '写了原文', Number.NaN)])).toBeNull()
    expect(lastWrittenAt([])).toBeNull()
  })
})

describe('归档 · 跨周比对', () => {
  /** 09-14 刻意写成「报价 拖延！」，验证归一化 */
  const listed: WeekEntry[] = [
    bare('2026-09-07'), // 只写了原文，没有复盘
    entry('2026-09-14', { issues: [issue('报价 拖延！')] }),
    entry('2026-09-21', { issues: [issue('报价拖延')] }),
    entry('2026-09-28', { issues: [issue('报价拖延')] }),
  ]

  it('「这个问题第几次出现」只数这周之前的周，不含本周、也不看下周', () => {
    expect(repeatCount(listed, '2026-09-07', '报价拖延')).toBe(0)
    expect(repeatCount(listed, '2026-09-21', '报价拖延')).toBe(1)
    expect(repeatCount(listed, '2026-09-28', '报价拖延')).toBe(2)
  })

  it('标签的空格与标点在归一化之后照样认成同一条', () => {
    expect(repeatCount(listed, '2026-09-21', '报价 拖延！')).toBe(1)
    expect(repeatCount(listed, '2026-09-21', '报价、拖延')).toBe(1)
  })

  it('同一周里同一条问题写了两遍，也只算一周', () => {
    const list = [
      entry('2026-09-14', {
        issues: [issue('报销拖延'), issue('报销拖延', '报销还是没交')],
      }),
      bare('2026-09-21', '这一周的原文'),
    ]
    expect(repeatCount(list, '2026-09-21', '报销拖延')).toBe(1)
  })

  it('空标签不参与跨周比对', () => {
    const list = [entry('2026-09-14', { issues: [issue('')] })]
    expect(repeatCount(list, '2026-09-21', '')).toBe(0)
    expect(repeatCount(list, '2026-09-21', '   ')).toBe(0)
  })
})

describe('归档 · 上周语境', () => {
  it('交给模型的上周语境只看紧邻的那一周，不往前翻', () => {
    const list = [
      entry('2026-09-07', { plan: [{ text: '三周前的计划', when: '' }] }),
      entry('2026-09-14', {
        plan: [{ text: '把报价发出去', when: '周三' }],
        issues: [issue('报销拖延')],
      }),
    ]
    expect(previousWeekContext(list, '2026-09-21')).toEqual({
      week: '2026-09-14',
      weekText: '9月14日 – 9月20日',
      plan: [{ text: '把报价发出去', when: '周三' }],
      issues: [{ text: '报销拖了两周', key: '报销拖延' }],
    })
  })

  it('紧邻的那一周没记录就是 null，哪怕再往前几周都记过', () => {
    const list = [entry('2026-09-07'), entry('2026-08-31')]
    expect(previousWeekContext(list, '2026-09-21')).toBeNull()
  })

  it('上一周只写了原文、还没复盘时，语境是空的计划与问题，而不是 null', () => {
    const list = [bare('2026-09-14', '只写了原文')]
    expect(previousWeekContext(list, '2026-09-21')).toEqual({
      week: '2026-09-14',
      weekText: '9月14日 – 9月20日',
      plan: [],
      issues: [],
    })
  })
})
