import { describe, expect, it } from 'vitest'
import { parseTurnReply, stripMarkerForDisplay } from './turn'

describe('模型行首标记 · 解析', () => {
  it('[追问] 表示要追问，且标记不会留在正文里', () => {
    expect(parseTurnReply('[追问]\n这件事哪一部分最花时间？')).toEqual({
      wantsFollowUp: true,
      message: '这件事哪一部分最花时间？',
    })
  })

  it('[换题] 表示不追问', () => {
    const r = parseTurnReply('[换题]那有没有本来打算做、结果没做成的事？')
    expect(r.wantsFollowUp).toBe(false)
    expect(r.message).toBe('那有没有本来打算做、结果没做成的事？')
  })

  it('没有标记时按换题处理：宁可少追问，也不能漏掉主问题', () => {
    expect(parseTurnReply('那后来呢？')).toEqual({ wantsFollowUp: false, message: '那后来呢？' })
  })

  it('容忍前导空白、全角空格和 BOM', () => {
    expect(parseTurnReply('\uFEFF  \n[追问] 然后呢？').wantsFollowUp).toBe(true)
    expect(parseTurnReply('\u3000[换题]下一题').message).toBe('下一题')
  })

  it('标记漏在正文里也一并清掉', () => {
    expect(parseTurnReply('[追问]然后呢？[换题]').message).toBe('然后呢？')
  })

  it('正文里本来就有方括号时不会被误伤', () => {
    expect(parseTurnReply('[换题]你说的[方案A]后来怎么样了？').message).toBe(
      '你说的[方案A]后来怎么样了？',
    )
  })

  it('空输入、非字符串都不炸', () => {
    expect(parseTurnReply('')).toEqual({ wantsFollowUp: false, message: '' })
    expect(parseTurnReply(undefined as unknown as string)).toEqual({
      wantsFollowUp: false,
      message: '',
    })
  })
})

describe('流式显示时摘掉标记', () => {
  it('收全的标记会被摘掉', () => {
    expect(stripMarkerForDisplay('[追问]然后呢？')).toBe('然后呢？')
    expect(stripMarkerForDisplay('[换题]下一题了')).toBe('下一题了')
  })

  it('标记还没收全时先按住不显示，避免界面闪出「[追」', () => {
    expect(stripMarkerForDisplay('[', false)).toBe('')
    expect(stripMarkerForDisplay('[追', false)).toBe('')
    expect(stripMarkerForDisplay('[追问', false)).toBe('')
  })

  it('收全之后立刻放行', () => {
    expect(stripMarkerForDisplay('[追问]', false)).toBe('')
    expect(stripMarkerForDisplay('[追问]好', false)).toBe('好')
  })

  it('开头是方括号但不是标记时，不会一直被按住', () => {
    expect(stripMarkerForDisplay('[方案A]的进展', false)).toBe('[方案A]的进展')
    expect(stripMarkerForDisplay('[奇怪的东西', false)).toBe('[奇怪的东西')
  })

  it('final 模式直接给结果，不做按住', () => {
    expect(stripMarkerForDisplay('[追问]然后呢？', true)).toBe('然后呢？')
  })
})
