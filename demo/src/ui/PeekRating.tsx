import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { HugeiconsIcon } from '@hugeicons/react'
import { FavouriteIcon, FlashIcon, StarIcon } from '@hugeicons/core-free-icons'

import './PeekRating.css'

/**
 * PeekRating（0.9.8，React Bits 原样搬进来）。
 *
 * 换掉了原来那个「一排字符 ★ 的按钮」。原来那排星只有 hover 放大 1.12 倍，
 * 没有预览、没有整排拖动、键盘也只能一颗一颗点；这个组件把「评分」做成了一次手势：
 *
 * - **预览**：鼠标划到第 N 颗，前 N 颗一起亮、一起抬起来，鼠标正下方那颗再放大一点；
 * - **气泡**：跟着鼠标走的一枚小胶囊，写着这一档叫什么（`labels`）或第几分；
 * - **整排拖动**：按下不放、左右划到哪算哪，松手才落分（触屏上也一样）；
 * - **取消**：再点同一颗，或按 Backspace/Delete，回到「没打分」；
 * - **键盘**：左右/上下箭头 ±1、Home/End 到底、空格/回车选中那一颗。
 *
 * 三条与本项目对接时的约定（改这个文件之前先看）：
 *
 * 1. **`onChange` 收的是 0 而不是 undefined**。「没打分」在本项目里是 `undefined`
 *    （见 `core/stateScore.ts`：0 分和没打分在数据上是一回事，都不写这个键），
 *    组件只认 0–count，所以这层换算放在 `ui/StateScore.tsx` 里做，不要往组件里塞
 *    业务规则 —— 这样它与官方版本仍是一字不差的替换关系。
 * 2. **`readOnly` 只画不看**：只渲染 `<span>`、根节点 `role="img"`、
 *    每颗 `aria-hidden`，一个事件都不挂。留着它是给「只看不改」的位置用的
 *    （结果页页头概览那排小星目前还是自家的老样式，没换过来）。
 * 3. **`data-disabled`** 是本项目加的：原版用根节点的 `aria-disabled` +
 *    `pointer-events: none`，但那样按钮上的 `disabled` 属性就没了，
 *    「AI 回复时点不动」这条测试和读屏都认不出来。所以这里改成给每颗按钮真挂
 *    `disabled`，样式走 `data-disabled`。
 */

const EASE_OUT = 'cubic-bezier(0.23, 1, 0.32, 1)'
const SHAPES = { star: StarIcon, heart: FavouriteIcon, bolt: FlashIcon }

type Shape = keyof typeof SHAPES

interface Props {
  /** 受控分数，0–count；不传就是非受控（内部自己记） */
  value?: number
  /** 非受控时的初始分数 */
  defaultValue?: number
  /** 落分时回调；0 表示「取消了」 */
  onChange?: (value: number) => void
  /** 每划过一档调一次；离开/清空时给 null */
  onPreview?: (value: number | null) => void
  /** 几颗 */
  count?: number
  shape?: Shape
  /** 自绘字形，给了就不用内置的三个 */
  icon?: ReactNode
  /** 每档一句话，缺省显示数字 */
  labels?: string[]
  activeColor?: string
  idleColor?: string
  tipColor?: string
  tipTextColor?: string
  /** 每颗的像素尺寸；间距与气泡都按它算 */
  size?: number
  /** 预览时抬起来几像素；0 = 只变色不抬 */
  lift?: number
  magnify?: number
  riseDuration?: number
  popScale?: number
  showTip?: boolean
  allowClear?: boolean
  readOnly?: boolean
  disabled?: boolean
  ariaLabel?: string
  className?: string
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))
const reducedMotion = () =>
  typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

export function PeekRating({
  value: valueProp,
  defaultValue = 0,
  onChange,
  onPreview,
  count = 5,
  shape = 'star',
  icon,
  labels = [],
  activeColor,
  idleColor,
  tipColor = '#27272a',
  tipTextColor = '#f5f5f5',
  size = 28,
  lift = 6,
  magnify = 1.15,
  riseDuration = 320,
  popScale = 1.3,
  showTip = true,
  allowClear = true,
  readOnly = false,
  disabled = false,
  ariaLabel = '评分',
  className = '',
}: Props) {
  const [inner, setInner] = useState(defaultValue)
  const value = clamp(valueProp ?? inner, 0, count)
  const interactive = !readOnly && !disabled

  const rootRef = useRef<HTMLDivElement>(null)
  const rowRef = useRef<HTMLDivElement>(null)
  const tipEl = useRef<HTMLSpanElement>(null)
  const starEls = useRef<(HTMLElement | null)[]>([])
  const liftEls = useRef<(HTMLSpanElement | null)[]>([])
  const glyphEls = useRef<(HTMLSpanElement | null)[]>([])
  const st = useRef({
    hover: null as number | null,
    pressing: false,
    pointerId: null as number | null,
    settled: false,
    rect: null as DOMRect | null,
    rtl: false,
  })

  const paint = () => {
    const { hover, settled, rtl } = st.current
    const previewing = hover !== null && !settled
    const shown = previewing ? hover + 1 : value
    const still = reducedMotion()

    for (let i = 0; i < count; i++) {
      const liftEl = liftEls.current[i]
      const glyphEl = glyphEls.current[i]
      if (!liftEl || !glyphEl) continue
      const lifted = previewing && !still && i <= hover
      liftEl.style.transform = lifted
        ? `translateY(${-lift}px) scale(${i === hover ? magnify : 1})`
        : 'translateY(0px) scale(1)'
      glyphEl.dataset.lit = String(i < shown)
    }

    const tip = tipEl.current
    if (!tip) return
    if (previewing && showTip) {
      const row = rowRef.current
      const slot = row ? row.clientWidth / count : size
      const visual = rtl ? count - 1 - hover : hover
      const wasHidden = tip.dataset.show !== 'true'
      if (wasHidden) tip.style.transition = 'none'
      tip.textContent = labels[hover] ?? String(hover + 1)
      tip.style.transform = `translate(calc(${slot * (visual + 0.5)}px - 50%), 0)`
      if (wasHidden) {
        void tip.offsetWidth
        tip.style.transition = ''
      }
      tip.dataset.show = 'true'
    } else {
      tip.dataset.show = 'false'
    }
  }
  useLayoutEffect(paint)

  const setHover = (index: number | null) => {
    if (index === st.current.hover) return
    st.current.hover = index
    if (index !== null) st.current.settled = false
    paint()
    onPreview?.(index === null ? null : index + 1)
  }
  const setHoverRef = useRef(setHover)
  setHoverRef.current = setHover

  const measure = () => {
    const row = rowRef.current
    if (!row) return
    st.current.rect = row.getBoundingClientRect()
    st.current.rtl = getComputedStyle(row).direction === 'rtl'
  }

  const indexAt = (x: number, y: number) => {
    const { rect, pressing, rtl } = st.current
    if (!rect || !rect.width) return null
    if (pressing && (y < rect.top - size || y > rect.bottom + size)) return null
    const index = clamp(Math.floor(((x - rect.left) / rect.width) * count), 0, count - 1)
    return rtl ? count - 1 - index : index
  }

  const commit = (next: number, pop = true) => {
    if (valueProp === undefined) setInner(next)
    onChange?.(next)
    st.current.settled = true
    paint()
    const glyph = glyphEls.current[next - 1]
    if (
      pop &&
      next > 0 &&
      popScale > 1 &&
      glyph &&
      typeof glyph.animate === 'function' &&
      !reducedMotion()
    ) {
      glyph.getAnimations().forEach((animation) => animation.cancel())
      glyph.animate(
        [
          { transform: 'scale(1)', easing: EASE_OUT },
          { transform: `scale(${popScale})`, offset: 0.35, easing: EASE_OUT },
          { transform: 'scale(1)' },
        ],
        { duration: 300 },
      )
    }
  }

  const handlePointerEnter = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!interactive || e.pointerType !== 'mouse') return
    rootRef.current?.removeAttribute('data-instant')
    measure()
  }

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!interactive || e.button !== 0 || st.current.pointerId !== null) return
    rootRef.current?.removeAttribute('data-instant')
    try {
      e.currentTarget.setPointerCapture(e.pointerId)
    } catch {
      /* jsdom 与老浏览器没有这个 API：抓不住指针也只是拖出元素后不跟手，不该炸 */
    }
    st.current.pointerId = e.pointerId
    st.current.pressing = true
    measure()
    setHover(indexAt(e.clientX, e.clientY))
  }

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!interactive) return
    const { pressing, pointerId } = st.current
    if (e.pointerType !== 'mouse' && !pressing) return
    if (pressing && e.pointerId !== pointerId) return
    if (!pressing && !st.current.rect) measure()
    setHover(indexAt(e.clientX, e.clientY))
  }

  const endPress = (e: React.PointerEvent<HTMLDivElement>) => {
    const { pressing, pointerId, hover } = st.current
    if (!pressing || e.pointerId !== pointerId) return
    st.current.pressing = false
    st.current.pointerId = null
    if (e.type === 'pointerup' && hover !== null) {
      const next = hover + 1
      commit(allowClear && next === value ? 0 : next)
    }
    if (e.pointerType !== 'mouse') setHover(null)
  }

  const handlePointerLeave = () => {
    if (!st.current.pressing) setHover(null)
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (!interactive) return
    const min = allowClear ? 0 : 1
    let next: number
    switch (e.key) {
      case 'ArrowRight':
      case 'ArrowUp':
        next = clamp(value + 1, min, count)
        break
      case 'ArrowLeft':
      case 'ArrowDown':
        next = clamp(value - 1, min, count)
        break
      case 'Home':
        next = 1
        break
      case 'End':
        next = count
        break
      case 'Backspace':
      case 'Delete':
        if (!allowClear) return
        next = 0
        break
      case ' ':
      case 'Enter': {
        const index = starEls.current.indexOf(e.target as HTMLElement)
        if (index === -1) return
        next = allowClear && index + 1 === value ? 0 : index + 1
        break
      }
      default:
        return
    }
    e.preventDefault()
    rootRef.current?.setAttribute('data-instant', 'true')
    st.current.hover = null
    commit(next, false)
    starEls.current[Math.max(next, 1) - 1]?.focus()
  }

  useEffect(() => {
    const reset = () => {
      st.current.pressing = false
      st.current.pointerId = null
      setHoverRef.current(null)
    }
    const onVisibility = () => {
      if (document.hidden) reset()
    }
    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('blur', reset)
    return () => {
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('blur', reset)
    }
  }, [])

  const Star = readOnly ? 'span' : 'button'
  const shapeIcon = SHAPES[shape] || SHAPES.star
  const tipRoom = interactive && showTip ? Math.round(size * 0.9) : 0

  return (
    <div
      ref={rootRef}
      role={readOnly ? 'img' : 'radiogroup'}
      aria-label={readOnly ? `${value} of ${count}` : ariaLabel}
      data-disabled={disabled || undefined}
      className={`peek-rating${className ? ` ${className}` : ''}`}
      style={
        {
          '--pr-active': activeColor,
          '--pr-idle': idleColor,
          '--pr-tip': tipColor,
          '--pr-tip-text': tipTextColor,
          '--pr-size': `${size}px`,
          '--pr-gap': `${Math.round(size * 0.22)}px`,
          '--pr-room': `${lift + tipRoom}px`,
          '--pr-rise': `${riseDuration}ms`,
        } as React.CSSProperties
      }
      onKeyDown={readOnly ? undefined : handleKeyDown}
    >
      <div
        ref={rowRef}
        className="peek-rating__row"
        onPointerEnter={handlePointerEnter}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={endPress}
        onPointerCancel={endPress}
        onLostPointerCapture={endPress}
        onPointerLeave={handlePointerLeave}
      >
        {interactive && showTip ? (
          <span ref={tipEl} className="peek-rating__tip" aria-hidden="true" />
        ) : null}
        {Array.from({ length: count }, (_, i) => {
          const checked = value === i + 1
          const label = labels[i] ? `${i + 1} of ${count}, ${labels[i]}` : `${i + 1} of ${count}`
          return (
            <Star
              key={i}
              ref={(el: HTMLElement | null) => {
                starEls.current[i] = el
              }}
              type={readOnly ? undefined : 'button'}
              className="peek-rating__star"
              role={readOnly ? undefined : 'radio'}
              aria-checked={readOnly ? undefined : checked}
              aria-label={readOnly ? undefined : `${ariaLabel} ${i + 1} 星`}
              aria-hidden={readOnly || undefined}
              title={readOnly ? undefined : label}
              disabled={readOnly ? undefined : disabled || undefined}
              tabIndex={!interactive ? -1 : (value === 0 ? i === 0 : checked) ? 0 : -1}
            >
              <span
                ref={(el) => {
                  liftEls.current[i] = el
                }}
                className="peek-rating__lift"
              >
                <span
                  ref={(el) => {
                    glyphEls.current[i] = el
                  }}
                  className="peek-rating__glyph"
                >
                  {icon ?? (
                    <HugeiconsIcon icon={shapeIcon} size={size} fill="currentColor" strokeWidth={1.5} />
                  )}
                </span>
              </span>
            </Star>
          )
        })}
      </div>
    </div>
  )
}

export default PeekRating
