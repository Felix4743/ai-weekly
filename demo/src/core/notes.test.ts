import { describe, expect, it } from 'vitest'
import {
  addNote,
  coerceNote,
  createNote,
  findNote,
  guessDim,
  noteDateLabel,
  notesCountText,
  notesForPrompt,
  noteDimLabel,
  NOTE_TEXT_MAX,
  NOTES_PER_WEEK_LIMIT,
  removeNote,
} from './notes'
import type { Note } from './types'

/**
 * 随手记这一层的规则只有两类：**猜归类**与**排顺序**。
 *
 * 归类是猜的（猜错了只是界面上一枚标签不对），但「按时间从早到晚存」
 * 与「超上限丢最老的」错了会安静地丢用户记的东西 —— 所以那两条逐条钉住。
 */

/** 本地时间，别让测试自己掉进 UTC 的坑 */
function at(y: number, m: number, d: number, h = 12): number {
  return new Date(y, m - 1, d, h).getTime()
}

function note(text: string, when: number, id = 'x'): Note {
  return { id, at: when, date: '2026-09-28', text, dim: 'event' }
}

describe('随手记 · 猜归类', () => {
  it('有人名或称呼的归到人际', () => {
    expect(guessDim('跟张总通了电话，预算的事没谈拢')).toBe('people')
    expect(guessDim('陪妈妈去医院复查')).toBe('people')
    expect(guessDim('同事说他也要换组')).toBe('people')
  })

  it('买了什么、花了钱的归到物品', () => {
    expect(guessDim('买了把人体工学椅')).toBe('thing')
    expect(guessDim('快递一直没到')).toBe('thing')
    expect(guessDim('把这个月的账单付了')).toBe('thing')
  })

  it('学东西、练身体的归到成长', () => {
    expect(guessDim('开始坚持早起跑步')).toBe('growth')
    expect(guessDim('把《深度工作》看完了')).toBe('growth')
  })

  it('看不出来的归到事情 —— 那一块最宽，猜错也最不刺眼', () => {
    expect(guessDim('方案又被推翻了')).toBe('event')
    // 「总」这种字不能当人名认：一句「总结一下这周」不该被归到人际
    expect(guessDim('总结一下这周')).toBe('event')
    // 「预算」不算花钱：它是事情那一栏的东西
    expect(guessDim('预算还没批下来')).toBe('event')
  })

  it('标签是给界面看的短词', () => {
    expect(noteDimLabel('thing')).toBe('物品')
    expect(noteDimLabel('people')).toBe('人际')
  })
})

describe('随手记 · 建一条', () => {
  it('去掉首尾空白；全是空白就不建', () => {
    expect(createNote('  椅子到了  ', at(2026, 9, 28))?.text).toBe('椅子到了')
    expect(createNote('   ', at(2026, 9, 28))).toBeNull()
    expect(createNote('', at(2026, 9, 28))).toBeNull()
  })

  it('日期由记下的那一刻推出来（本地时间，不碰 UTC）', () => {
    expect(createNote('椅子到了', at(2026, 9, 28))?.date).toBe('2026-09-28')
    // 晚上十一点记的还算今天 —— 用 UTC 会被算到明天去
    expect(createNote('睡前想起来', at(2026, 9, 28, 23))?.date).toBe('2026-09-28')
  })

  it('太长就截断，而不是拒绝 —— 粘一大段进来也比弹错误框友善', () => {
    const long = '啊'.repeat(NOTE_TEXT_MAX + 50)
    expect(createNote(long, at(2026, 9, 28))?.text.length).toBe(NOTE_TEXT_MAX)
  })

  it('每条的 id 不一样', () => {
    const a = createNote('椅子到了', at(2026, 9, 28))
    const b = createNote('椅子到了', at(2026, 9, 28))
    expect(a?.id).not.toBe(b?.id)
  })
})

describe('随手记 · 排序与上限', () => {
  it('按时间从早到晚排 —— 提示词里要照着念成「周一…周三…」', () => {
    const list = addNote(
      addNote([], note('第二件', at(2026, 9, 30), 'n2')),
      note('第一件', at(2026, 9, 28), 'n1'),
    )
    expect(list.map((n) => n.text)).toEqual(['第一件', '第二件'])
  })

  it('同一个 id 算同一条，不会在列表里出现两遍', () => {
    const list = addNote(addNote([], note('改了两个字之前', at(2026, 9, 28), 'n1')), note('改了两个字之后', at(2026, 9, 28), 'n1'))
    expect(list).toHaveLength(1)
    expect(list[0].text).toBe('改了两个字之后')
  })

  it('超过一周上限就丢最老的，而不是丢新的', () => {
    let list: Note[] = []
    for (let i = 0; i < NOTES_PER_WEEK_LIMIT + 5; i += 1) {
      list = addNote(list, note(`第 ${i} 条`, at(2026, 9, 28) + i * 1000, `n${i}`))
    }
    expect(list.length).toBe(NOTES_PER_WEEK_LIMIT)
    expect(list[0].text).toBe('第 5 条')
    expect(list[list.length - 1].text).toBe(`第 ${NOTES_PER_WEEK_LIMIT + 4} 条`)
  })

  it('删一条只删那一条', () => {
    const list = [note('一', 1, 'a'), note('二', 2, 'b')]
    expect(removeNote(list, 'a').map((n) => n.id)).toEqual(['b'])
    expect(removeNote(list, '不存在')).toHaveLength(2)
    expect(findNote(list, 'b')?.text).toBe('二')
    expect(findNote(list, '不存在')).toBeNull()
  })
})

describe('随手记 · 从文件里读回来', () => {
  it('不是个对象、没有文字的都丢掉', () => {
    expect(coerceNote(null)).toBeNull()
    expect(coerceNote('一句字符串')).toBeNull()
    expect(coerceNote({ at: 1 })).toBeNull()
    expect(coerceNote({ text: '   ', at: 1 })).toBeNull()
  })

  it('缺日期就拿 at 现推；分类认不出来就重新猜', () => {
    const note = coerceNote({ text: '买了把椅子', at: at(2026, 9, 28), dim: '乱写的' })
    expect(note?.date).toBe('2026-09-28')
    expect(note?.dim).toBe('thing')
  })

  it('缺 at 的用当下兜底，别让一条坏时间把整个列表排乱', () => {
    const note = coerceNote({ text: '椅子到了' })
    expect(Number.isFinite(note?.at)).toBe(true)
    expect(note?.date).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  it('认出来的字段原样留着（手改过的归档不该被重写）', () => {
    const note = coerceNote({ id: 'keep-me', text: '椅子到了', at: 5, date: '2026-09-28', dim: 'thing' })
    expect(note).toEqual({ id: 'keep-me', text: '椅子到了', at: 5, date: '2026-09-28', dim: 'thing' })
  })
})

describe('随手记 · 给人看与给模型看', () => {
  it('今年的日子不带年份，往年的带上', () => {
    const now = new Date(2026, 9, 12)
    expect(noteDateLabel(note('一', 1), now)).toBe('9月28日')
    expect(noteDateLabel({ ...note('一', 1), date: '2025-09-28' }, now)).toBe('2025年9月28日')
    expect(noteDateLabel({ ...note('一', 1), date: '坏掉的' }, now)).toBe('')
  })

  it('「记了 3 条」/「还没记过」两处说的是同一句', () => {
    expect(notesCountText(3)).toBe('记了 3 条')
    expect(notesCountText(0)).toBe('还没记过')
  })

  it('提示词里给的是日期 + 原文，不给猜出来的分类', () => {
    const now = new Date(2026, 9, 12)
    const list = [
      { ...note('跟张总通了电话', 1, 'a'), date: '2026-09-28', dim: 'people' as const },
      { ...note('椅子到了', 2, 'b'), date: '2026-09-30', dim: 'thing' as const },
    ]
    expect(notesForPrompt(list, now)).toEqual([
      '9月28日：跟张总通了电话',
      '9月30日：椅子到了',
    ])
  })
})
