import { describe, expect, it } from 'vitest'
import {
  ARCHIVE_LIMIT,
  addWeekNote,
  archiveResult,
  archiveStats,
  findEntry,
  lastWrittenAt,
  mainLine,
  moveWeek,
  notesOf,
  recentSlots,
  removeWeekNote,
  sortEntries,
  updateWeekResult,
  upsertWeek,
  weekCounts,
  type WeekEntry,
} from './archive'
import { createNote } from './notes'
import { createEmptyResult, type WeeklyResult } from './types'

/**
 * 归档层的规则几乎全是「同一周只留一份」和「不许顶掉别人」这两件事的变体。
 * 这两条错了，日历不会报错，只会安静地显示错的周 —— 所以逐条钉住。
 */

function result(overrides: Partial<WeeklyResult> = {}): WeeklyResult {
  return { ...createEmptyResult(), highlights: ['这周被方案拖着'], ...overrides }
}

function entry(week: string, overrides: Partial<WeeklyResult> = {}, savedAt = 1): WeekEntry {
  return { week, savedAt, result: result(overrides), notes: [] }
}

/** 本地时间，别让测试自己掉进 UTC 的坑 */
function at(y: number, m: number, d: number, h = 12): Date {
  return new Date(y, m - 1, d, h)
}

describe('归档 · 写入', () => {
  it('按时间戳落到它所属的那一周', () => {
    // 2026-09-22 是周二，归到 09-21 那一周
    const list = archiveResult([], result(), at(2026, 9, 22).getTime())
    expect(list[0].week).toBe('2026-09-21')
  })

  it('周日晚十一点记的算这一周，周一凌晨记的算下一周', () => {
    const sunday = archiveResult([], result(), at(2026, 9, 27, 23).getTime())
    const monday = archiveResult([], result(), at(2026, 9, 28, 0).getTime())
    expect(sunday[0].week).toBe('2026-09-21')
    expect(monday[0].week).toBe('2026-09-28')
  })

  it('同一周写十遍也只留一份，后来的覆盖先前的', () => {
    let list: WeekEntry[] = []
    for (let i = 0; i < 10; i += 1) {
      list = archiveResult(list, result({ highlights: [`第 ${i} 版`] }), at(2026, 9, 22).getTime())
    }
    expect(list).toHaveLength(1)
    expect(mainLine(list[0])).toBe('第 9 版')
  })

  it('新的在前，方便直接从上往下读', () => {
    const list = [
      entry('2026-09-07'),
      entry('2026-09-28'),
      entry('2026-09-14'),
      entry('2026-09-21'),
    ]
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
      list = upsertWeek(list, entry(addWeeksFrom('2026-01-05', i)))
    }
    expect(list).toHaveLength(ARCHIVE_LIMIT)
    expect(list[0].week).toBe(addWeeksFrom('2026-01-05', ARCHIVE_LIMIT + 19))
    expect(findEntry(list, '2026-01-05')).toBeNull()
  })
})

/** 测试里自己造一串连着的周一，别依赖被测代码 */
function addWeeksFrom(start: string, weeks: number): string {
  const [y, m, d] = start.split('-').map(Number)
  const date = new Date(y, m - 1, d + weeks * 7)
  const pad = (n: number) => (n < 10 ? `0${n}` : String(n))
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

describe('归档 · 改与挪', () => {
  it('改旧的一周：存回原来那一周，不新建、不串周', () => {
    const list = [entry('2026-09-14'), entry('2026-09-21')]
    const next = updateWeekResult(list, '2026-09-14', result({ events: ['补记一笔'] }), 99)
    expect(next).toHaveLength(2)
    expect(findEntry(next, '2026-09-14')?.result.events).toEqual(['补记一笔'])
    expect(findEntry(next, '2026-09-14')?.savedAt).toBe(99)
    // 另一周一根汗毛都没动
    expect(findEntry(next, '2026-09-21')).toEqual(entry('2026-09-21'))
  })

  it('改一周不存在的一周时什么都不做，而不是凭空造一条', () => {
    const list = [entry('2026-09-21')]
    expect(updateWeekResult(list, '2026-09-14', result(), 99)).toBe(list)
  })

  it('挪周：把周一早上补做的复盘挪回上一周', () => {
    const list = [entry('2026-09-28')]
    const moved = moveWeek(list, '2026-09-28', -1)
    expect(moved.map((e) => e.week)).toEqual(['2026-09-21'])
  })

  it('挪周：目标那一周已经有记录时拒绝挪，绝不顶掉别人的存档', () => {
    const list = [entry('2026-09-21', { highlights: ['上一周原本的记录'] }), entry('2026-09-28')]
    expect(moveWeek(list, '2026-09-28', -1)).toBe(list)
    expect(mainLine(findEntry(list, '2026-09-21'))).toBe('上一周原本的记录')
  })

  it('挪 0 周、挪一个不存在的周，都原样返回', () => {
    const list = [entry('2026-09-28')]
    expect(moveWeek(list, '2026-09-28', 0)).toBe(list)
    expect(moveWeek(list, '2026-09-07', 1)).toBe(list)
  })
})

describe('归档 · 读出来是什么', () => {
  it('主线取第一条非空的，空白条目不算数', () => {
    expect(mainLine(entry('2026-09-21', { highlights: ['  ', '真正的主线', '支撑'] }))).toBe(
      '真正的主线',
    )
    expect(mainLine(entry('2026-09-21', { highlights: [] }))).toBe('')
    expect(mainLine(null)).toBe('')
  })

  it('条数统计六项都算对', () => {
    const counts = weekCounts(
      result({
        events: ['a', 'b'],
        people: [{ name: '老王', note: '' }],
        things: ['键盘'],
        pending: [],
        highlights: ['主线', '支撑'],
        nextFocus: ['定稿', '报价'],
        nextFollowUps: ['老王'],
      }),
    )
    expect(counts).toEqual({ events: 2, people: 1, things: 1, pending: 0, highlights: 2, plan: 3 })
  })

  it('近三周的位置：本周、上周、上上周，没记录的那一周也占着位置', () => {
    const now = at(2026, 9, 30)
    const list = [entry('2026-09-21'), entry('2026-09-07')]
    const slots = recentSlots(list, now)

    expect(slots.map((s) => s.week)).toEqual(['2026-09-28', '2026-09-21', '2026-09-14'])
    expect(slots.map((s) => s.label)).toEqual(['本周', '上周', '上上周'])
    expect(slots[0].entry).toBeNull() // 本周还没记
    expect(slots[1].entry).not.toBeNull()
    expect(slots[2].entry).toBeNull() // 上上周漏了 —— 这件事要看得见
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
    expect(archiveStats([entry('2026-09-07'), entry('2026-09-21'), entry('2026-09-28')], now).streak).toBe(2)
  })

  it('空存档不会算出一条假的连续记录', () => {
    const stats = archiveStats([], at(2026, 9, 30))
    expect(stats).toEqual({
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
    const list = [
      entry('2026-06-29', {}, today),
      entry('2026-09-21', {}, at(2026, 9, 22).getTime()),
    ]
    const stats = archiveStats(list, at(2026, 9, 30))
    expect(stats.latest).toBe('2026-09-21')
    expect(stats.lastWritten).toBe(today)
  })

  it('脏时间戳被跳过，不会顶掉真实的那一条', () => {
    const good = at(2026, 9, 22).getTime()
    expect(
      lastWrittenAt([
        { week: '2026-09-14', savedAt: Number.NaN, result: result(), notes: [] },
        { week: '2026-09-21', savedAt: good, result: result(), notes: [] },
      ]),
    ).toBe(good)
    expect(
      lastWrittenAt([{ week: '2026-09-21', savedAt: Number.NaN, result: result(), notes: [] }]),
    ).toBeNull()
    expect(lastWrittenAt([])).toBeNull()
  })
})

describe('归档 · 随手记', () => {
  function note(text: string, when: Date, id = text) {
    const created = createNote(text, when.getTime())
    if (!created) throw new Error('测试里不该建出空的笔记')
    return { ...created, id }
  }

  it('往空存档里记一条：那一周就出现了，结果还是空的', () => {
    const list = addWeekNote([], '2026-09-23', note('想给爸妈打个电话', at(2026, 9, 23)))
    expect(list).toHaveLength(1)
    expect(list[0].week).toBe('2026-09-23')
    expect(list[0].notes.map((n) => n.text)).toEqual(['想给爸妈打个电话'])
    // 结果还是空的：只有随手记的周不该凭空长出主线
    expect(list[0].result.highlights).toEqual([])
    expect(list[0].result.events).toEqual([])
    expect(mainLine(list[0])).toBe('')
  })

  it('归到那一天所属的那一周，不是随手记被创建的那一周', () => {
    // 09-22 是周二，归 09-21 那一周
    const list = addWeekNote([], '2026-09-21', note('椅子到了', at(2026, 9, 22)))
    expect(notesOf(list, '2026-09-21').map((n) => n.date)).toEqual(['2026-09-22'])
  })

  it('同一条记两次只留一份（按 id 覆盖）', () => {
    const one = note('把报价发出去', at(2026, 9, 22), 'n1')
    const twice = note('把报价发出去（改了两个字）', at(2026, 9, 23), 'n1')
    let list = addWeekNote([], '2026-09-21', one, at(2026, 9, 22).getTime())
    list = addWeekNote(list, '2026-09-21', twice, at(2026, 9, 23).getTime())
    expect(list[0].notes).toHaveLength(1)
    expect(list[0].notes[0].text).toBe('把报价发出去（改了两个字）')
  })

  it('删一条：只删这一周里的那一条，别的周不动', () => {
    const list = [
      { ...entry('2026-09-21', {}, at(2026, 9, 21).getTime()), notes: [note('a', at(2026, 9, 21), 'a')] },
      { ...entry('2026-09-28', {}, at(2026, 9, 28).getTime()), notes: [note('b', at(2026, 9, 28), 'b')] },
    ]
    const left = removeWeekNote(list, '2026-09-21', 'a')
    expect(notesOf(left, '2026-09-21')).toEqual([])
    expect(left[0].result.highlights).toEqual(['这周被方案拖着'])
    expect(notesOf(left, '2026-09-28').map((n) => n.text)).toEqual(['b'])
  })

  it('删不存在的周、不存在的 id，都原样返回', () => {
    const list = [entry('2026-09-21')]
    expect(removeWeekNote(list, '2026-01-05', 'a')).toEqual(list)
    expect(removeWeekNote(list, '2026-09-21', '没有这一条')).toEqual(list)
  })

  it('记完结果以后，随手记还在', () => {
    const written = addWeekNote([], '2026-09-21', note('想给爸妈打个电话', at(2026, 9, 22)))
    const done = archiveResult(written, result(), at(2026, 9, 27).getTime())
    expect(done[0].notes.map((n) => n.text)).toEqual(['想给爸妈打个电话'])
    expect(done[0].result.highlights).toEqual(['这周被方案拖着'])
  })

  it('重新生成结果也不会抹掉随手记', () => {
    const written = addWeekNote([], '2026-09-21', note('椅子到了', at(2026, 9, 22)))
    const again = updateWeekResult(
      written,
      '2026-09-21',
      result({ highlights: ['换了一版'] }),
      at(2026, 9, 28).getTime(),
    )
    expect(again[0].notes.map((n) => n.text)).toEqual(['椅子到了'])
    expect(again[0].result.highlights).toEqual(['换了一版'])
  })

  it('挪周时随手记跟着走，不会留在原来那一周', () => {
    const list = addWeekNote([], '2026-09-28', note('周一补记的', at(2026, 9, 29)))
    const moved = moveWeek(list, '2026-09-28', -1)
    expect(notesOf(moved, '2026-09-21').map((n) => n.text)).toEqual(['周一补记的'])
    expect(notesOf(moved, '2026-09-28')).toEqual([])
  })

  it('只有随手记的一周也留得住，upsertWeek 不会把它挤掉', () => {
    const list = addWeekNote([], '2026-09-21', note('一件小事', at(2026, 9, 22)))
    const after = upsertWeek(list, entry('2026-09-28', {}, at(2026, 9, 28).getTime()))
    expect(notesOf(after, '2026-09-21')).toHaveLength(1)
  })

  it('没记过的周读出来是空数组，不是 undefined', () => {
    expect(notesOf([entry('2026-09-21')], '2026-09-21')).toEqual([])
    expect(notesOf([], '2026-09-21')).toEqual([])
  })
})
