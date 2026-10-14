// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { BlurText } from './BlurText'
import { CountUp } from './CountUp'
import { SPOTLIGHT_CLASS, clearSpotlight, spotlightProps, trackSpotlight } from './spotlight'

/**
 * 三个「会动的」小组件（0.9.10）。
 *
 * 动效本身（模糊到清晰、光斑长什么样）是 CSS 的活，测试管不着也不该管。
 * 这里守的是三件**错了就出问题**的事：
 * 1. 读屏能不能读到完整的话（逐字拆 span 之后最容易坏的就是这个）；
 * 2. 系统要求减少动态效果时，数字是不是**直接给终值**（而不是从 0 滚一遍）；
 * 3. 指针事件的坐标有没有真的写进 CSS 变量、离开有没有清掉。
 */

let host: HTMLDivElement
let root: Root

beforeEach(() => {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

describe('BlurText', () => {
  it('拆成一个字一个 span，但读屏读到的是完整原话', () => {
    act(() => root.render(<BlurText text="本周梳理" />))

    const chars = host.querySelectorAll('.blur-text__ch')
    expect(Array.from(chars).map((c) => c.textContent)).toEqual(['本', '周', '梳', '理'])

    // 动画那一层整个 aria-hidden，另有一份完整文字给读屏
    const hidden = host.querySelector('[aria-hidden="true"]')
    expect(hidden?.contains(chars[0])).toBe(true)
    expect(host.querySelector('.sr-only')?.textContent).toBe('本周梳理')
    // 页面上看得见的文字合起来还是原标题
    expect(host.textContent).toBe('本周梳理本周梳理')
  })

  it('每个字错开一点，顺序越后等得越久', () => {
    act(() => root.render(<BlurText text="总览" stagger={0.05} delay={0.1} />))

    const delays = Array.from(host.querySelectorAll('.blur-text__ch')).map(
      (c) => (c as HTMLElement).style.animationDelay,
    )
    // jsdom 会把 `0.100s` 归一成 `0.1s`，所以按归一的写法比
    expect(delays).toEqual(['0.1s', '0.15s'])
  })

  it('空格不会被吃掉，词之间留出位置', () => {
    act(() => root.render(<BlurText text="开始 之前" />))

    const words = host.querySelectorAll('.blur-text__word')
    expect(words).toHaveLength(2)
    expect(host.querySelector('.blur-text__space')).not.toBeNull()
    expect(host.querySelector('.sr-only')?.textContent).toBe('开始 之前')
  })
})

describe('CountUp', () => {
  it('系统要减少动态效果时，第一眼就是终值，不从 0 滚', () => {
    const original = window.matchMedia
    // @ts-expect-error 测试里换一个只会说「要减少」的 matchMedia
    window.matchMedia = () => ({ matches: true })
    try {
      act(() => root.render(<CountUp value={7} />))
      expect(host.querySelector('[aria-hidden="true"]')?.textContent).toBe('7')
    } finally {
      window.matchMedia = original
    }
  })

  it('读屏念的始终是真值，不是滚到一半的数', () => {
    act(() => root.render(<CountUp value={12} />))
    expect(host.querySelector('.sr-only')?.textContent).toBe('12')
  })

  it('正常情况从 0 起步，动画跑完落到真值', async () => {
    act(() => root.render(<CountUp value={5} duration={40} />))
    // 第一帧还没跑：显示的是起点
    expect(host.querySelector('[aria-hidden="true"]')?.textContent).toBe('0')

    await act(async () => {
      await new Promise((r) => setTimeout(r, 120))
    })
    expect(host.querySelector('[aria-hidden="true"]')?.textContent).toBe('5')
  })
})

describe('spotlight', () => {
  it('指针坐标写进 --spot-x/--spot-y，并挂上 data-spot', () => {
    const card = document.createElement('section')
    // jsdom 里 getBoundingClientRect 全是 0，于是「相对卡片左上角」就等于页面坐标
    trackSpotlight({ currentTarget: card, clientX: 120, clientY: 48 } as never)

    expect(card.style.getPropertyValue('--spot-x')).toBe('120px')
    expect(card.style.getPropertyValue('--spot-y')).toBe('48px')
    expect(card.dataset.spot).toBe('on')
  })

  it('指针离开就把 data-spot 摘掉（CSS 那边靠它淡出）', () => {
    const card = document.createElement('section')
    trackSpotlight({ currentTarget: card, clientX: 10, clientY: 10 } as never)
    clearSpotlight({ currentTarget: card })
    expect(card.dataset.spot).toBeUndefined()
  })

  it('spotlightProps 给的就是那对处理器，类名另有常量', () => {
    const props = spotlightProps()
    expect(props.onPointerMove).toBe(trackSpotlight)
    expect(props.onPointerLeave).toBe(clearSpotlight)
    expect(SPOTLIGHT_CLASS).toBe('spotlight')
  })
})
