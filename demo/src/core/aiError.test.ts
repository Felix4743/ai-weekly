import { describe, expect, it } from 'vitest'
import { AiError, describeError, describeFailure, extractApiMessage } from './aiError'

describe('错误翻译', () => {
  it('从接口 body 里挖出上游给的说明', () => {
    expect(extractApiMessage('{"error":{"message":"Invalid API key"}}')).toBe('Invalid API key')
    expect(extractApiMessage('{"message":"bad request"}')).toBe('bad request')
    expect(extractApiMessage('就是一句普通文本')).toBe('就是一句普通文本')
    expect(extractApiMessage('')).toBe('')
    expect(extractApiMessage('{"error":{"message":"   "}}')).toBe('{"error":{"message":"   "}}')
  })

  it('过长的非 JSON 说明会被截断，不糊满屏幕', () => {
    const long = 'x'.repeat(500)
    const out = extractApiMessage(long)
    expect(out.length).toBeLessThan(210)
    expect(out.endsWith('…')).toBe(true)
  })

  it('最常见的三种配置错误给的是可操作的提示', () => {
    expect(describeFailure(401, '')).toContain('API Key')
    expect(describeFailure(403, '')).toContain('API Key')
    expect(describeFailure(404, '')).toContain('接口地址')
    expect(describeFailure(429, '')).toContain('额度')
    expect(describeFailure(503, '')).toContain('暂时不可用')
  })

  it('其它状态码带上上游给的原因', () => {
    expect(describeFailure(400, '{"error":{"message":"model not found"}}')).toContain(
      'model not found',
    )
    expect(describeFailure(400, '')).toBe('请求失败（400）')
  })

  it('describeError 把任意异常收敛成一句话', () => {
    expect(describeError(new AiError('连不上'))).toBe('连不上')
    expect(describeError(new Error('炸了'))).toBe('炸了')
    expect(describeError('一个字符串')).toBe('出了点意外，请再试一次')
    expect(describeError(null)).toBe('出了点意外，请再试一次')
  })

  it('AiError 保留原始细节，便于排查', () => {
    const err = new AiError('一句话', '原始堆栈')
    expect(err.message).toBe('一句话')
    expect(err.detail).toBe('原始堆栈')
    expect(err).toBeInstanceOf(Error)
  })
})
