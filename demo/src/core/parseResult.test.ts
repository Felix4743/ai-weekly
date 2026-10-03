import { describe, expect, it } from 'vitest'
import { parseResult, parseResultSafe } from './parseResult'

const GOOD = {
  events: ['改了三版方案，还没定'],
  people: [{ name: '老王', note: '一直没拍板' }],
  things: ['想换键盘，没定下来'],
  pending: ['报销拖了两周没交'],
  growth: ['把《长日将尽》读完了'],
  highlights: ['方案难产是这周主线'],
  nextFocus: ['推动方案定稿', '联系老王', '留出整块时间'],
  nextFollowUps: ['老王'],
}

describe('模型结果解析', () => {
  it('解析标准 JSON', () => {
    const r = parseResult(JSON.stringify(GOOD))
    expect(r.events).toEqual(GOOD.events)
    expect(r.people).toEqual(GOOD.people)
    expect(r.growth).toEqual(GOOD.growth)
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
    expect(r.things).toEqual([])
    expect(r.pending).toEqual([])
    expect(r.growth).toEqual([])
    expect(r.highlights).toEqual([])
    expect(r.nextFocus).toEqual([])
    expect(r.nextFollowUps).toEqual([])
  })

  it('老模型的输出里没有 state，读回来是一行空备注而不是 undefined', () => {
    const r = parseResult('{"events":["只有这一项"]}')
    expect(r.state).toEqual({ note: '' })
    expect('scores' in r.state).toBe(false)
  })

  it('老档的四行状态文字并成一行备注，原话照抄', () => {
    const r = parseResult('{"状态":{"body":"睡得还行","mood":"有点悬"}}')
    expect(r.state).toEqual({ note: '身体：睡得还行；情绪：有点悬' })
  })

  it('四行文字都有时按 身体 / 情绪 / 精力 / 心智 的标签顺序拼起来', () => {
    const r = parseResult(
      '{"状态":{"body":"睡得还行","mood":"有点悬","focus":"上午最好","growth":"读了半本书"}}',
    )
    expect(r.state.note).toBe('身体：睡得还行；情绪：有点悬；精力：上午最好；心智：读了半本书')
  })

  it('老档里空掉的那几行直接跳过，不留「情绪：」这种空标签', () => {
    const r = parseResult('{"状态":{"body":"睡得还行","mood":"","focus":"上午最好"}}')
    expect(r.state.note).toBe('身体：睡得还行；精力：上午最好')
  })

  it('有 note / 备注 / 说明 时直接用，不再回头去拼老四行', () => {
    expect(
      parseResult('{"状态":{"note":"就说这一句","body":"睡得还行"}}').state.note,
    ).toBe('就说这一句')
    expect(parseResult('{"状态":{"备注":"中文备注也认"}}').state.note).toBe('中文备注也认')
    expect(parseResult('{"状态":{"说明":"说明也认"}}').state.note).toBe('说明也认')
  })

  it('状态里的分数读得回来，键名 评分 / 打分 都认', () => {
    const r = parseResult('{"状态":{"note":"睡得还行","评分":{"mood":4,"sleep":2}}}')
    expect(r.state.scores).toEqual({ mood: 4, sleep: 2 })
    expect(r.state.note).toBe('睡得还行')

    const s = parseResult('{"状态":{"打分":{"sport":3,"diet":1}}}')
    expect(s.state.scores).toEqual({ sport: 3, diet: 1 })
  })

  it('分数里不是 1–5 的整数就丢掉，备注照留', () => {
    const r = parseResult(
      '{"状态":{"note":"有点悬","scores":{"mood":0,"sleep":9,"sport":3.5,"diet":4}}}',
    )
    expect(r.state.note).toBe('有点悬')
    expect(r.state.scores).toEqual({ diet: 4 })
  })

  it('老档里的 body / focus / growth 不算新分数，只当四行文字读', () => {
    const r = parseResult('{"状态":{"body":"睡得还行","scores":{"body":4,"focus":3,"growth":5}}}')
    expect('scores' in r.state).toBe(false)
    expect(r.state.note).toBe('身体：睡得还行')
  })

  it('没有分数的老档不冒充 0 分：整个键都不出现', () => {
    const r = parseResult('{"状态":{"body":"睡得还行"}}')
    expect('scores' in r.state).toBe(false)
    expect(r.state.note).toBe('身体：睡得还行')
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

  it('兼容中文键名，成长也认', () => {
    const r = parseResult(
      '{"事情":["改方案"],"物品":["换键盘"],"成长":["读了半本书"],"本周热点":["方案难产"],"下周重点":["定稿"]}',
    )
    expect(r.events).toEqual(['改方案'])
    expect(r.things).toEqual(['换键盘'])
    expect(r.growth).toEqual(['读了半本书'])
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
    expect(bad.result.growth).toEqual([])
    expect(bad.result.state).toEqual({ note: '' })

    const good = parseResultSafe(JSON.stringify(GOOD))
    expect(good.error).toBeUndefined()
    expect(good.result.events).toEqual(GOOD.events)
    expect(good.result.growth).toEqual(GOOD.growth)
  })
})
