import { describe, expect, it } from 'vitest'
import {
  addItem,
  addPerson,
  removeItem,
  removePerson,
  updateItem,
  updatePerson,
} from './resultEdit'
import { createEmptyResult, type WeeklyResult } from './types'

function base(): WeeklyResult {
  // 从空结果起手再覆盖：以后再加一栏时，这里不用跟着一条条补
  return {
    ...createEmptyResult(),
    events: ['改方案', '整理数据'],
    people: [{ name: '老王', note: '没拍板' }],
    things: ['换键盘'],
    pending: ['报销没交'],
    state: { body: '睡得还行', mood: '有点烦', focus: '', growth: '' },
    highlights: ['方案难产'],
    nextFocus: ['定稿', '联系老王', '留整块时间'],
    nextFollowUps: ['老王'],
  }
}

describe('结果页编辑操作', () => {
  it('修改某一项，且不改变原对象', () => {
    const r = base()
    const next = updateItem(r, 'events', 0, '  改方案（已定稿）  ')
    expect(next.events[0]).toBe('改方案（已定稿）')
    expect(r.events[0]).toBe('改方案')
    expect(next.pending).toEqual(r.pending)
  })

  it('修改越界时不生效，也不抛错', () => {
    const r = base()
    expect(updateItem(r, 'events', 9, 'x')).toBe(r)
    expect(updateItem(r, 'events', -1, 'x')).toBe(r)
  })

  it('删除某一项', () => {
    const r = base()
    expect(removeItem(r, 'events', 0).events).toEqual(['整理数据'])
    expect(removeItem(r, 'events', 5)).toBe(r)
  })

  it('新增一项，空白内容被忽略', () => {
    const r = base()
    expect(addItem(r, 'pending', '体检没预约').pending).toEqual(['报销没交', '体检没预约'])
    expect(addItem(r, 'pending', '   ')).toBe(r)
    expect(addItem(r, 'pending', '')).toBe(r)
  })

  it('修改人际条目', () => {
    const r = base()
    const next = updatePerson(r, 0, { note: '已经拍板了' })
    expect(next.people[0]).toEqual({ name: '老王', note: '已经拍板了' })
    expect(r.people[0].note).toBe('没拍板')
    expect(updatePerson(r, 9, { name: 'x' })).toBe(r)
  })

  it('删除人际条目', () => {
    const r = base()
    expect(removePerson(r, 0).people).toEqual([])
    expect(removePerson(r, 3)).toBe(r)
  })

  it('新增人际条目，没有名字就不生效', () => {
    const r = base()
    const next = addPerson(r, { name: '  小李 ', note: ' 吃了顿饭 ' })
    expect(next.people[1]).toEqual({ name: '小李', note: '吃了顿饭' })
    expect(addPerson(r, { name: '  ', note: 'x' })).toBe(r)
  })

  it('编辑操作覆盖全部列表字段', () => {
    const r = base()
    expect(updateItem(r, 'highlights', 0, 'h').highlights[0]).toBe('h')
    expect(updateItem(r, 'things', 0, '换显示器').things[0]).toBe('换显示器')
    expect(updateItem(r, 'nextFocus', 0, 'f').nextFocus[0]).toBe('f')
    expect(updateItem(r, 'nextFollowUps', 0, 'p').nextFollowUps[0]).toBe('p')
    expect(removeItem(r, 'nextFocus', 0).nextFocus).toEqual(['联系老王', '留整块时间'])
    expect(removeItem(r, 'things', 0).things).toEqual([])
  })

  it('物品一栏和事情一栏互不干扰', () => {
    const r = base()
    const next = addItem(r, 'things', '处理旧手机')
    expect(next.things).toEqual(['换键盘', '处理旧手机'])
    expect(next.events).toEqual(r.events)
  })

  it('清单的增删改都不会碰状态那一栏', () => {
    const r = base()
    expect(addItem(r, 'things', '处理旧手机').state).toEqual(r.state)
    expect(removeItem(r, 'events', 0).state).toEqual(r.state)
    expect(updateItem(r, 'highlights', 0, '改一句').state).toEqual(r.state)
    expect(updatePerson(r, 0, { note: '已经拍板了' }).state).toEqual(r.state)
    expect(removePerson(r, 0).state).toEqual(r.state)
    expect(addPerson(r, { name: '小李', note: '' }).state).toEqual(r.state)
  })
})
