import { describe, expect, it } from 'vitest'
import { AiError } from './aiError'
import { createSseParser, extractDeltaText, extractMessageText } from './sse'

/** 造一条 OpenAI 风格的 data 事件 */
const evt = (text: string): string =>
  `data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\n`

describe('SSE 解析 · 分块', () => {
  it('解析单条事件', () => {
    const p = createSseParser()
    expect(p.push(evt('你好'))).toEqual(['你好'])
  })

  it('一条 chunk 里塞了多个事件时全部取出', () => {
    const p = createSseParser()
    expect(p.push(evt('你') + evt('好') + evt('呀'))).toEqual(['你', '好', '呀'])
  })

  it('一个事件被切在两个 chunk 中间也能拼回来', () => {
    const line = evt('周末好')
    const half = Math.floor(line.length / 2)
    const p = createSseParser()
    expect(p.push(line.slice(0, half))).toEqual([])
    expect(p.push(line.slice(half))).toEqual(['周末好'])
  })

  it('半行会留在缓冲区，end() 时冲刷出来', () => {
    const p = createSseParser()
    expect(p.push(evt('结尾').trimEnd())).toEqual([])
    expect(p.end()).toEqual(['结尾'])
  })

  it('识别 [DONE] 并停止，后面的内容不再取', () => {
    const p = createSseParser()
    expect(p.push(evt('完') + 'data: [DONE]\n\n' + evt('不该出现'))).toEqual(['完'])
    expect(p.done).toBe(true)
    expect(p.end()).toEqual([])
  })

  it('忽略注释行、空行和看不懂的行', () => {
    const p = createSseParser()
    expect(p.push(': ping\n\ndata: 不是 json\n\nevent: message\n\n' + evt('好'))).toEqual(['好'])
  })

  it('兼容 \\r\\n 换行', () => {
    const p = createSseParser()
    expect(p.push('data: {"choices":[{"delta":{"content":"好"}}]}\r\n\r\n')).toEqual(['好'])
  })
})

describe('SSE 解析 · 字段容错', () => {
  it('兼容非流式字段与老接口字段', () => {
    expect(extractDeltaText('{"choices":[{"message":{"content":"整段"}}]}')).toBe('整段')
    expect(extractDeltaText('{"choices":[{"text":"老接口"}]}')).toBe('老接口')
  })

  it('空 delta、空 choices、非对象都不算错误', () => {
    expect(extractDeltaText('{"choices":[{"delta":{}}]}')).toBeNull()
    expect(extractDeltaText('{"choices":[]}')).toBeNull()
    expect(extractDeltaText('{"choices":[{"delta":{"content":""}}]}')).toBeNull()
    expect(extractDeltaText('123')).toBeNull()
    expect(extractDeltaText('null')).toBeNull()
  })
})

describe('SSE 解析 · 上游报错', () => {
  it('错误被塞在流里时抛出 AiError，而不是静默当作没内容', () => {
    expect(() =>
      createSseParser().push('data: {"error":{"message":"额度不足"}}\n\n'),
    ).toThrow(AiError)
    expect(() =>
      createSseParser().push('data: {"error":{"message":"额度不足"}}\n\n'),
    ).toThrow('额度不足')
  })

  it('错误没有 message 时也给一句话', () => {
    expect(() => createSseParser().push('data: {"error":{}}\n\n')).toThrow('模型接口返回了错误')
  })
})

describe('非流式响应的正文提取', () => {
  it('认标准 JSON', () => {
    expect(extractMessageText('{"choices":[{"message":{"content":"整段"}}]}')).toBe('整段')
  })

  it('认整段都是 SSE 的情况', () => {
    expect(extractMessageText(evt('你') + evt('好'))).toBe('你好')
  })

  it('取不到内容时返回 null，不抛错', () => {
    expect(extractMessageText('不是 JSON')).toBeNull()
    expect(extractMessageText('')).toBeNull()
    expect(extractMessageText('{"choices":[{"message":{}}]}')).toBeNull()
  })

  it('错误响应照旧抛 AiError', () => {
    expect(() => extractMessageText('{"error":{"message":"bad key"}}')).toThrow(AiError)
  })
})
