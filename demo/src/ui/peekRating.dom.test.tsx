// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { PeekRating } from './PeekRating'
import { StateScore } from './StateScore'

/**
 * PeekRating 的手势与键盘（0.9.8 从 React Bits 搬进来的那一排星）。
 *
 * 为什么这个文件要 jsdom：这排星的本事全在「指针划到哪儿、按下拖动、松手落分」上，
 * 光看元素树看不出来。别处的渲染测试仍然是不用 DOM 的静态字符串比对，
 * 只有这个文件顶上写了 `@vitest-environment jsdom`（其余文件按 vite.config.ts 的
 * `environment: 'node'` 跑）。
 *
 * jsdom 的三个坑写在这里省得下次再踩：
 * 1) 没有 `PointerEvent`，得用 MouseEvent 拼一个，补上 pointerId/pointerType；
 * 2) `getBoundingClientRect()` 一律是 0，得自己把这一排的宽度 stub 出来，
 *    否则「划到第几颗」算出来永远是第 1 颗；
 * 3) React 18 的 `act` 环境还得在测试入口打开（见 `src/test-setup.ts`），
 *    不开只是警告，但状态更新会不被冲刷。
 *
 * 另外：**受控**（传 `value`）时组件自己不记分，落的分只在 `onChange` 里，
 * 要让「点完就亮」看得见，得用非受控（`defaultValue`）——下面按这个规矩写。
 */

/** 一排五颗、每颗 30px：把这一排的宽度按 150 报给组件 */
const ROW_WIDTH = 150
const COUNT = 5
const STAR_PX = ROW_WIDTH / COUNT

function pointerEvent(type: string, x: number) {
  const event = new MouseEvent(type, { clientX: x, clientY: 40, bubbles: true, button: 0 })
  Object.assign(event, { pointerId: 1, pointerType: 'mouse' })
  return event
}

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

function stubRowWidth() {
  const row = host.querySelector<HTMLElement>('.peek-rating__row')
  if (!row) throw new Error('没渲染出 .peek-rating__row')
  row.getBoundingClientRect = () =>
    ({
      left: 0,
      top: 0,
      right: ROW_WIDTH,
      bottom: 30,
      width: ROW_WIDTH,
      height: 30,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    }) as DOMRect
  return row
}

function renderRating(props: Partial<Parameters<typeof PeekRating>[0]> = {}) {
  act(() => {
    root.render(<PeekRating ariaLabel="心情" {...props} />)
  })
  return { row: stubRowWidth(), rootEl: host.querySelector<HTMLElement>('.peek-rating')! }
}

/** 第 index 颗星身上的横坐标 */
const xOf = (index: number) => index * STAR_PX + 5

function press(row: HTMLElement, from: number, to: number = from) {
  act(() => {
    row.dispatchEvent(pointerEvent('pointerenter', xOf(from)))
    row.dispatchEvent(pointerEvent('pointerdown', xOf(from)))
    if (to !== from) row.dispatchEvent(pointerEvent('pointermove', xOf(to)))
    row.dispatchEvent(pointerEvent('pointerup', xOf(to)))
  })
}

const glyphStates = () =>
  Array.from(host.querySelectorAll<HTMLElement>('.peek-rating__glyph')).map((el) => el.dataset.lit)

describe('PeekRating · 点与拖', () => {
  it('点第 3 颗就落 3 分，前三颗跟着亮', () => {
    const calls: number[] = []
    const { row } = renderRating({ defaultValue: 0, onChange: (v) => calls.push(v) })
    press(row, 2)
    expect(calls).toEqual([3])
    expect(glyphStates()).toEqual(['true', 'true', 'true', 'false', 'false'])
  })

  it('按下后划到哪儿算哪儿，松手才落分（拖动整排）', () => {
    const calls: number[] = []
    const { row } = renderRating({ defaultValue: 0, onChange: (v) => calls.push(v) })
    act(() => {
      row.dispatchEvent(pointerEvent('pointerenter', xOf(0)))
      row.dispatchEvent(pointerEvent('pointerdown', xOf(0)))
      row.dispatchEvent(pointerEvent('pointermove', xOf(4)))
    })
    // 还没松手：一分没落，但预览已经亮到第 5 颗
    expect(calls).toEqual([])
    expect(glyphStates()).toEqual(['true', 'true', 'true', 'true', 'true'])
    act(() => {
      row.dispatchEvent(pointerEvent('pointerup', xOf(4)))
    })
    expect(calls).toEqual([5])
  })

  it('鼠标划过去只预览，不落分', () => {
    const calls: number[] = []
    const previews: (number | null)[] = []
    const { row } = renderRating({
      defaultValue: 2,
      onChange: (v) => calls.push(v),
      onPreview: (v) => previews.push(v),
    })
    act(() => {
      row.dispatchEvent(pointerEvent('pointerenter', xOf(0)))
      row.dispatchEvent(pointerEvent('pointermove', xOf(3)))
    })
    expect(calls).toEqual([])
    expect(previews).toEqual([4])
    expect(glyphStates()).toEqual(['true', 'true', 'true', 'true', 'false'])
  })

  it('再点同一颗就取消，回调收到 0，星星全灭', () => {
    const calls: number[] = []
    const { row } = renderRating({ defaultValue: 3, onChange: (v) => calls.push(v) })
    press(row, 2)
    expect(calls).toEqual([0])
    expect(glyphStates()).toEqual(['false', 'false', 'false', 'false', 'false'])
  })

  it('受控时自己不改分：落的分只在 onChange 里', () => {
    const calls: number[] = []
    const { row } = renderRating({ value: 2, onChange: (v) => calls.push(v) })
    press(row, 4)
    expect(calls).toEqual([5])
    // 外面没把 5 传回来，所以这一排还停在 2
    expect(glyphStates()).toEqual(['true', 'true', 'false', 'false', 'false'])
  })
})

describe('PeekRating · 键盘', () => {
  function keydown(rootEl: HTMLElement, key: string) {
    act(() => {
      rootEl.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }))
    })
  }

  it('方向键 ±1、Home/End 到底', () => {
    const calls: number[] = []
    const { rootEl } = renderRating({ defaultValue: 2, onChange: (v) => calls.push(v) })
    keydown(rootEl, 'ArrowRight')
    keydown(rootEl, 'ArrowUp')
    keydown(rootEl, 'End')
    keydown(rootEl, 'Home')
    keydown(rootEl, 'ArrowLeft')
    expect(calls).toEqual([3, 4, 5, 1, 0])
  })

  it('Backspace 与 Delete 都是取消', () => {
    const calls: number[] = []
    const { rootEl } = renderRating({ defaultValue: 4, onChange: (v) => calls.push(v) })
    keydown(rootEl, 'Backspace')
    keydown(rootEl, 'Delete')
    expect(calls).toEqual([0, 0])
  })

  it('选完分焦点跟着落到那一颗上（键盘能接着按）', () => {
    const { rootEl } = renderRating({ defaultValue: 0 })
    keydown(rootEl, 'End')
    expect(document.activeElement).toBe(host.querySelectorAll('.peek-rating__star')[4])
  })
})

describe('PeekRating · 只读与禁用', () => {
  it('readOnly：只画不响应，报出自己的分数', () => {
    renderRating({ value: 3, readOnly: true })
    const rootEl = host.querySelector<HTMLElement>('.peek-rating')!
    expect(host.querySelectorAll('button')).toHaveLength(0)
    expect(host.querySelectorAll('.peek-rating__star')).toHaveLength(COUNT)
    expect(host.querySelectorAll('.peek-rating__glyph')).toHaveLength(COUNT)
    expect(rootEl.getAttribute('role')).toBe('img')
    expect(rootEl.getAttribute('aria-label')).toBe('3 of 5')
    expect(glyphStates()).toEqual(['true', 'true', 'true', 'false', 'false'])
  })

  it('disabled：五颗按钮真的带上 disabled，键盘也不响应', () => {
    const calls: number[] = []
    const { rootEl } = renderRating({ value: 2, disabled: true, onChange: (v) => calls.push(v) })
    expect(
      Array.from(host.querySelectorAll<HTMLButtonElement>('.peek-rating__star')).map(
        (el) => el.disabled,
      ),
    ).toEqual([true, true, true, true, true])
    act(() => {
      rootEl.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))
    })
    expect(calls).toEqual([])
  })
})

describe('StateScore · 与「没打分」的换算', () => {
  /**
   * 这一层是 PeekRating 与本项目数据口径的接缝：
   * 组件认 0（取消了），`core/stateScore.ts` 认 undefined（这一项不写键）。
   */
  function renderScore(score: number | undefined, onChange: (v: number | undefined) => void) {
    act(() => {
      root.render(<StateScore ariaLabel="心情评分" score={score} onChange={onChange} />)
    })
    return stubRowWidth()
  }

  it('没打分时一颗都不亮，写「未打分」', () => {
    renderScore(undefined, () => {})
    expect(glyphStates()).toEqual(['false', 'false', 'false', 'false', 'false'])
    expect(host.textContent).toContain('未打分')
  })

  it('点第 4 颗 → 传 4', () => {
    const calls: (number | undefined)[] = []
    press(renderScore(undefined, (v) => calls.push(v)), 3)
    expect(calls).toEqual([4])
  })

  it('再点同一颗 → 传 undefined（不是 0）', () => {
    const calls: (number | undefined)[] = []
    press(renderScore(4, (v) => calls.push(v)), 3)
    expect(calls).toEqual([undefined])
  })
})
