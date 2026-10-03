import { describe, expect, it } from 'vitest'
import { mergeRefined } from './refineMerge'
import { createEmptyResult, type WeeklyResult } from './types'

function result(patch: Partial<WeeklyResult>): WeeklyResult {
  return { ...createEmptyResult(), ...patch }
}

describe('重新整理的结果合并', () => {
  it('用户手改过的内容不会被模型改掉', () => {
    const current = result({ events: ['我改过的第一条'], pending: ['我自己加的'] })
    const fromModel = result({ events: ['模型想改成的样子'] })
    const merged = mergeRefined(current, fromModel)
    expect(merged.events[0]).toBe('我改过的第一条')
    expect(merged.pending).toEqual(['我自己加的'])
  })

  it('模型的新内容只追加在末尾，不重排也不删条', () => {
    const merged = mergeRefined(
      result({ events: ['A', 'B'] }),
      result({ events: ['C', 'D'] }),
    )
    expect(merged.events).toEqual(['A', 'B', 'C', 'D'])
  })

  it('重复内容不会被加两遍', () => {
    const merged = mergeRefined(
      result({ things: ['买了个键盘'] }),
      result({ things: ['买了个键盘', '卖掉了旧手机'] }),
    )
    expect(merged.things).toEqual(['买了个键盘', '卖掉了旧手机'])
  })

  it('只有空白差异的内容也算重复', () => {
    const merged = mergeRefined(
      result({ events: ['改了三版方案'] }),
      result({ events: ['  改了三版方案  '] }),
    )
    expect(merged.events).toHaveLength(1)
  })

  it('人名是去重键，同名时以用户改过的备注为准', () => {
    const merged = mergeRefined(
      result({ people: [{ name: '老王', note: '我手写的备注' }] }),
      result({
        people: [
          { name: '老王', note: '模型改写的备注' },
          { name: '小李', note: '新出现的人' },
        ],
      }),
    )
    expect(merged.people).toEqual([
      { name: '老王', note: '我手写的备注' },
      { name: '小李', note: '新出现的人' },
    ])
  })

  it('热点与下周计划用模型重写的结果', () => {
    const merged = mergeRefined(
      result({ highlights: ['旧热点'], nextFocus: ['旧重点'], nextFollowUps: ['旧的人'] }),
      result({ highlights: ['新热点'], nextFocus: ['新重点'], nextFollowUps: ['小李'] }),
    )
    expect(merged.highlights).toEqual(['新热点'])
    expect(merged.nextFocus).toEqual(['新重点'])
    expect(merged.nextFollowUps).toEqual(['小李'])
  })

  it('模型这三项什么都没给时不清空原来的', () => {
    const merged = mergeRefined(
      result({ highlights: ['旧热点'], nextFocus: ['旧重点'], nextFollowUps: ['旧的人'] }),
      createEmptyResult(),
    )
    expect(merged.highlights).toEqual(['旧热点'])
    expect(merged.nextFocus).toEqual(['旧重点'])
    expect(merged.nextFollowUps).toEqual(['旧的人'])
  })

  it('不改动传进来的对象', () => {
    const current = result({ events: ['A'] })
    const fromModel = result({ events: ['B'] })
    mergeRefined(current, fromModel)
    expect(current.events).toEqual(['A'])
    expect(fromModel.events).toEqual(['B'])
  })

  it('点过的星不会被「重新整理」洗掉', () => {
    const current = result({ state: { body: '睡得还行', mood: '', focus: '', growth: '', scores: { body: 4 } } })
    const fromModel = result({ state: { body: '模型重写的身体', mood: '', focus: '', growth: '' } })
    const merged = mergeRefined(current, fromModel)
    // 文字按前几条例子的规矩来，分是界面点的，模型编不出来也不该丢
    expect(merged.state.scores).toEqual({ body: 4 })
  })

  it('一直没点过星时，重新整理后也不多出一个空的 scores', () => {
    const merged = mergeRefined(
      result({ state: { body: '睡得还行', mood: '', focus: '', growth: '' } }),
      createEmptyResult(),
    )
    expect('scores' in merged.state).toBe(false)
  })

  it('空清单一律给空数组，不留 undefined', () => {
    const merged = mergeRefined(createEmptyResult(), createEmptyResult())
    expect(merged.events).toEqual([])
    expect(merged.people).toEqual([])
    expect(merged.highlights).toEqual([])
  })
})
