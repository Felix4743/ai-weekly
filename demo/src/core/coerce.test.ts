import { describe, expect, it } from 'vitest'
import {
  parseJsonObject,
  pick,
  readString,
  sliceJsonObject,
  stripFences,
  toObjectList,
  toStringList,
} from './coerce'

/**
 * 这一层的全部价值在于「模型不听话时不崩，还能尽量把内容认出来」。
 *
 * 所以每个函数都钉三件事：正常的样子、坏输入的样子、以及认不出来时
 * 到底是「跳过这一条」还是「给个空值」—— 三者混掉，上层就会拿一句空话
 * 当成 AI 的结论摆给用户。
 */

describe('coerce · 围栏与 JSON 切片', () => {
  it('```json 围栏剥掉，语言名写不写、大小写都认', () => {
    expect(stripFences('```json\n{"a":1}\n```')).toBe('{"a":1}')
    expect(stripFences('```\n{"a":1}\n```')).toBe('{"a":1}')
    expect(stripFences('```JSON\n{"a":1}\n```')).toBe('{"a":1}')
  })

  it('围栏前后还有客套话时整体原样留着，交给切片去救', () => {
    expect(stripFences('好的，这是结果：\n```json\n{"a":1}\n```')).toBe(
      '好的，这是结果：\n```json\n{"a":1}\n```',
    )
    expect(stripFences('```json\n{"a":1}\n```\n以上。')).toBe('```json\n{"a":1}\n```\n以上。')
  })

  it('围栏后面没换行就不算围栏（模型偶尔写成一整行）', () => {
    expect(stripFences('```json {"a":1}```')).toBe('```json {"a":1}```')
  })

  it('普通文本只做 trim', () => {
    expect(stripFences('  {"a":1}  ')).toBe('{"a":1}')
    expect(stripFences('')).toBe('')
  })

  it('切片取第一个 { 到最后一个 }，前后的话都丢掉', () => {
    expect(sliceJsonObject('好的：{"a":1}，就这样')).toBe('{"a":1}')
    expect(sliceJsonObject('{"a":{"b":1}}')).toBe('{"a":{"b":1}}')
    expect(sliceJsonObject('{}')).toBe('{}')
  })

  it('没有成对的大括号时给 null，不瞎猜', () => {
    expect(sliceJsonObject('一句普通话')).toBeNull()
    expect(sliceJsonObject('{')).toBeNull()
    expect(sliceJsonObject('}{')).toBeNull()
    expect(sliceJsonObject('{"a":1')).toBeNull()
  })
})

describe('coerce · parseJsonObject 的三类失败文案', () => {
  it('空内容与纯空白：模型返回了空内容', () => {
    expect(parseJsonObject('')).toEqual({ value: null, error: '模型返回了空内容' })
    expect(parseJsonObject('   \n  ')).toEqual({ value: null, error: '模型返回了空内容' })
    // 围栏里什么都没有，也算空内容
    expect(parseJsonObject('```json\n\n```')).toEqual({ value: null, error: '模型返回了空内容' })
  })

  it('认不出 JSON：模型返回的内容里没有认出 JSON', () => {
    expect(parseJsonObject('这周挺忙的，先这样吧。')).toEqual({
      value: null,
      error: '模型返回的内容里没有认出 JSON',
    })
    // 切片只认大括号，顶层是数组就捞不出来
    expect(parseJsonObject('[1,2]')).toEqual({
      value: null,
      error: '模型返回的内容里没有认出 JSON',
    })
  })

  it('像 JSON 但坏了：模型返回的 JSON 没能解析出来', () => {
    expect(parseJsonObject('{"a":1,}')).toEqual({
      value: null,
      error: '模型返回的 JSON 没能解析出来',
    })
    expect(parseJsonObject('{a: 1}')).toEqual({
      value: null,
      error: '模型返回的 JSON 没能解析出来',
    })
  })

  it('围栏 + 前缀废话 + 尾随说明，照样读得出来', () => {
    const out = parseJsonObject('好的：\n```json\n{"headline":"这周很忙"}\n```\n希望有帮助')
    expect(out.error).toBeUndefined()
    expect(out.value).toEqual({ headline: '这周很忙' })
  })

  it('永远不抛：怪输入也只是给个 error', () => {
    for (const raw of ['{', '}', '```', '{]', '[{"a":1}', '{{}}', 'null']) {
      expect(() => parseJsonObject(raw)).not.toThrow()
    }
  })
})

describe('coerce · readString 取一句话', () => {
  it('字符串直接 trim', () => {
    expect(readString('  写周报  ')).toBe('写周报')
    expect(readString('')).toBe('')
  })

  it('数字与布尔被当成文字（0 也算有内容）', () => {
    expect(readString(42)).toBe('42')
    expect(readString(0)).toBe('0')
    expect(readString(true)).toBe('true')
    expect(readString(false)).toBe('false')
  })

  it('对象从 text / name / title / value 里取第一个字符串', () => {
    expect(readString({ text: '  说明  ' })).toBe('说明')
    expect(readString({ name: '小明' })).toBe('小明')
    expect(readString({ title: '标题' })).toBe('标题')
    expect(readString({ value: '值' })).toBe('值')
    // 固定按 text → name → title → value 的顺序找，与对象里键的书写顺序无关
    expect(readString({ name: '小明', text: '说明' })).toBe('说明')
  })

  it('对象里认不出字符串就给空串', () => {
    expect(readString({ text: 42 })).toBe('')
    expect(readString({})).toBe('')
    expect(readString({ text: { text: '套娃' } })).toBe('')
  })

  it('text 键先命中，哪怕它是个空串 —— 后面的 name 不再看', () => {
    expect(readString({ text: '', name: '小明' })).toBe('')
  })

  it('null / undefined / 数组都当没有内容', () => {
    expect(readString(null)).toBe('')
    expect(readString(undefined)).toBe('')
    expect(readString([1, 2])).toBe('')
    expect(readString(['x'])).toBe('')
  })
})

describe('coerce · toStringList 取一列字符串', () => {
  it('单个字符串也算一条（模型偶尔只给一条）', () => {
    expect(toStringList('写了周报')).toEqual(['写了周报'])
    expect(toStringList('  写了周报  ')).toEqual(['写了周报'])
  })

  it('数组逐条 trim，空白项与读不出来的项直接丢掉', () => {
    expect(toStringList(['a', '  ', ' b '])).toEqual(['a', 'b'])
    expect(toStringList([1, true, null, 'x', { text: 'y' }, ['z']])).toEqual([
      '1',
      'true',
      'x',
      'y',
    ])
  })

  it('undefined / null 给空数组，数字与布尔也当文字', () => {
    expect(toStringList(undefined)).toEqual([])
    expect(toStringList(null)).toEqual([])
    expect(toStringList([])).toEqual([])
    expect(toStringList(0)).toEqual(['0'])
    expect(toStringList(false)).toEqual(['false'])
  })
})

describe('coerce · toObjectList 只留对象', () => {
  it('null、字符串、数字、数组全部过滤掉', () => {
    expect(toObjectList([{ a: 1 }, null, 'x', 2, [1], { b: 2 }])).toEqual([{ a: 1 }, { b: 2 }])
  })

  it('不是数组就给空数组', () => {
    expect(toObjectList({ a: 1 })).toEqual([])
    expect(toObjectList('x')).toEqual([])
    expect(toObjectList(null)).toEqual([])
    expect(toObjectList(undefined)).toEqual([])
  })

  it('留下的是原对象本身，不是复制品', () => {
    const item = { a: 1 }
    expect(toObjectList([item])[0]).toBe(item)
  })
})

describe('coerce · pick 在候选键里取第一个', () => {
  it('按调用方给的顺序取，英文键在前就先取英文', () => {
    expect(pick({ summary: 'en', 总结: '中' }, ['headline', 'summary', '总结'])).toBe('en')
    expect(pick({ 总结: '中' }, ['headline', 'summary', '总结'])).toBe('中')
  })

  it('一个都没有时给 undefined', () => {
    expect(pick({}, ['a', 'b'])).toBeUndefined()
  })

  it('值为 null / undefined / 空串时不算命中，继续往下找兜底键', () => {
    expect(pick({ headline: null, summary: '这周在赶报价' }, ['headline', 'summary'])).toBe(
      '这周在赶报价',
    )
    expect(pick({ a: undefined, b: 2 }, ['a', 'b'])).toBe(2)
    expect(pick({ headline: '', summary: '这周在赶报价' }, ['headline', 'summary'])).toBe(
      '这周在赶报价',
    )
  })

  it('数组与对象不算空，照旧命中（空数组、空对象也一样）', () => {
    expect(pick({ a: [], b: '兜底' }, ['a', 'b'])).toEqual([])
    expect(pick({ a: {}, b: '兜底' }, ['a', 'b'])).toEqual({})
  })

  it('候选键的值全是空时给 undefined', () => {
    expect(pick({ a: null, b: '', c: undefined }, ['a', 'b', 'c'])).toBeUndefined()
  })
})
