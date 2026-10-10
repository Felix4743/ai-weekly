import { describe, expect, it } from 'vitest'
import { mergeRefined } from './refineMerge'
import { attachState } from './stateScore'
import { createEmptyResult, type WeeklyResult } from './types'

function result(patch: Partial<WeeklyResult>): WeeklyResult {
  return { ...createEmptyResult(), ...patch }
}

describe('重新整理的结果合并', () => {
  it('用户手改过的内容不会被模型改掉', () => {
    const current = result({
      events: ['我改过的第一条'],
      pending: ['我自己加的'],
      growth: ['我把成长那条也改了'],
    })
    const fromModel = result({
      events: ['模型想改成的样子'],
      growth: ['模型想改成的成长'],
    })
    const merged = mergeRefined(current, fromModel)
    expect(merged.events[0]).toBe('我改过的第一条')
    expect(merged.pending).toEqual(['我自己加的'])
    expect(merged.growth[0]).toBe('我把成长那条也改了')
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

  it('成长那一栏和别的清单一个规矩：旧的在前，新的追加', () => {
    const merged = mergeRefined(
      result({ growth: ['读完《长日将尽》'] }),
      result({ growth: ['读完《长日将尽》', '想通了报价为什么难谈'] }),
    )
    expect(merged.growth).toEqual(['读完《长日将尽》', '想通了报价为什么难谈'])
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

  it('状态整组照搬当前那份：点过的星和备注都不会被「重新整理」洗掉', () => {
    const current = result({ state: attachState({ mood: 4, sleep: 2 }, '睡得还行') })
    const fromModel = result({ state: attachState({ mood: 1 }, '模型重写的状态') })
    const merged = mergeRefined(current, fromModel)
    expect(merged.state).toEqual({ scores: { mood: 4, sleep: 2 }, note: '睡得还行' })
  })

  it('模型自己编的分进不来：界面没点就是没点', () => {
    const merged = mergeRefined(
      result({ state: attachState(undefined, '这周还行') }),
      result({ state: attachState({ mood: 5, diet: 3 }, '') }),
    )
    expect(merged.state).toEqual({ note: '这周还行' })
    expect('scores' in merged.state).toBe(false)
  })

  it('一直没点过星时，重新整理后也不多出一个空的 scores', () => {
    const merged = mergeRefined(
      result({ state: attachState(undefined, '睡得还行') }),
      createEmptyResult(),
    )
    expect('scores' in merged.state).toBe(false)
    expect(merged.state.note).toBe('睡得还行')
  })

  it('空清单一律给空数组，不留 undefined', () => {
    const merged = mergeRefined(createEmptyResult(), createEmptyResult())
    expect(merged.events).toEqual([])
    expect(merged.people).toEqual([])
    expect(merged.things).toEqual([])
    expect(merged.pending).toEqual([])
    expect(merged.growth).toEqual([])
    expect(merged.highlights).toEqual([])
    expect(merged.nextFocus).toEqual([])
    expect(merged.nextFollowUps).toEqual([])
  })

  /**
   * 0.9.4：状态那一栏多了「追问小结」。
   *
   * 这一条是**踩过的那类坑的第二次**：`attachState` 只认传进去的几样，
   * 少传一个就等于把那一段抹掉 —— 而「重新整理」一次就发生。
   */
  it('追问小结不会被重新整理洗掉', () => {
    const current = result({
      state: attachState({ sleep: 2 }, '这周还行', '睡眠：躺下停不下来'),
    })
    const merged = mergeRefined(current, result({ highlights: ['模型给的新主线'] }))
    expect(merged.state.followUp).toBe('睡眠：躺下停不下来')
    expect(merged.state.note).toBe('这周还行')
    expect(merged.state.scores).toEqual({ sleep: 2 })
  })

  it('模型就算自己编了 stateFollowUp 也不算数 —— 状态整组以用户那边为准', () => {
    const current = result({ state: attachState({ mood: 4 }, '我写的', '我聊出来的小结') })
    const fromModel = result({
      state: attachState({ mood: 1 }, '模型编的备注', '模型编的小结'),
    })
    const merged = mergeRefined(current, fromModel)
    expect(merged.state).toEqual(attachState({ mood: 4 }, '我写的', '我聊出来的小结'))
  })
})
