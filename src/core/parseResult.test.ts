import { describe, expect, it } from 'vitest'
import { parseResult, parseResultSafe } from './parseResult'

const GOOD = {
  events: ['改了三版方案，还没定'],
  people: [{ name: '老王', note: '一直没拍板' }],
  pending: ['报销拖了两周没交'],
  highlights: ['方案难产是这周主线'],
  nextFocus: ['推动方案定稿', '联系老王', '留出整块时间'],
  nextFollowUps: ['老王'],
}

describe('模型结果解析', () => {
  it('解析标准 JSON', () => {
    const r = parseResult(JSON.stringify(GOOD))
    expect(r.events).toEqual(GOOD.events)
    expect(r.people).toEqual(GOOD.people)
    expect(r.nextFocus).toHaveLength(3)
  })

  it('容忍被 markdown 代码块包裹', () => {
    const r = parseResult('```json\n' + JSON.stringify(GOOD) + '\n```')
    expect(r.events).toEqual(GOOD.events)
  })

  it('容忍前后夹带解释文字', () => {
    const r = parseResult(`好的，这是整理结果：\n${JSON.stringify(GOOD)}\n希望有帮助。`)
    expect(r.people[0].name).toBe('老王')
  })

  it('字段缺失时降级为空数组，而不是崩掉', () => {
    const r = parseResult('{"events":["只有这一项"]}')
    expect(r.events).toEqual(['只有这一项'])
    expect(r.people).toEqual([])
    expect(r.pending).toEqual([])
    expect(r.highlights).toEqual([])
    expect(r.nextFocus).toEqual([])
    expect(r.nextFollowUps).toEqual([])
  })

  it('people 允许是字符串数组', () => {
    const r = parseResult('{"people":["老王","小李"]}')
    expect(r.people).toEqual([
      { name: '老王', note: '' },
      { name: '小李', note: '' },
    ])
  })

  it('people 允许使用别名键名', () => {
    const r = parseResult('{"people":[{"who":"老王","detail":"没回消息"}]}')
    expect(r.people).toEqual([{ name: '老王', note: '没回消息' }])
  })

  it('兼容中文键名', () => {
    const r = parseResult('{"事情":["改方案"],"本周热点":["方案难产"],"下周重点":["定稿"]}')
    expect(r.events).toEqual(['改方案'])
    expect(r.highlights).toEqual(['方案难产'])
    expect(r.nextFocus).toEqual(['定稿'])
  })

  it('过滤空字符串与非字符串项', () => {
    const r = parseResult('{"events":["有内容","",null,42]}')
    expect(r.events).toEqual(['有内容', '42'])
  })

  it('完全非法时抛错', () => {
    expect(() => parseResult('完全不是 JSON')).toThrow()
    expect(() => parseResult('')).toThrow()
    expect(() => parseResult('   ')).toThrow()
    expect(() => parseResult('[1,2,3]')).toThrow()
    expect(() => parseResult('{"events": [坏掉的 json}')).toThrow()
  })

  it('parseResultSafe 永不抛错，失败时给出原因并降级', () => {
    const bad = parseResultSafe('完全不是 JSON')
    expect(bad.error).toBeTruthy()
    expect(bad.result.events).toEqual([])
    expect(bad.result.people).toEqual([])

    const good = parseResultSafe(JSON.stringify(GOOD))
    expect(good.error).toBeUndefined()
    expect(good.result.events).toEqual(GOOD.events)
  })
})
