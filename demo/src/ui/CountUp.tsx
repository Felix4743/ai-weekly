import { useEffect, useRef, useState } from 'react'

/**
 * 数字滚上去（0.9.10，React Bits 的 Count Up 那一路）。
 *
 * 用在哪：总览页那句「已经记了 3 周 · 最近连续 2 周」—— 打开时从 0 滚到真值。
 * 只有这一处会动，别处不用（数字一动就抢注意力，这种话只配给「我坚持了多久」）。
 *
 * 三个决定：
 * - 缓出（easeOutCubic）：先快后慢才像「停下来」，匀速看着像进度条。
 * - 系统设了「减少动态效果」就**直接给终值**，不滚 —— 这是无障碍要求，不是可选项。
 * - 组件卸载 / 值变化时取消上一帧的回调，免得几个 rAF 叠着打架。
 */

type Props = {
  value: number
  /** 滚完用多久（毫秒） */
  duration?: number
  className?: string
}

/** 系统是不是要求减少动态效果。拿不到 matchMedia 的环境（老 jsdom）当「不减少」。 */
function prefersReducedMotion(): boolean {
  try {
    return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
  } catch {
    return false
  }
}

/** 先快后慢 */
function easeOutCubic(t: number): number {
  return 1 - (1 - t) ** 3
}

export function CountUp({ value, duration = 900, className }: Props) {
  // 减少动态效果时连初始值都不要是 0：第一帧就得是真值，不能先闪一下 0
  const [shown, setShown] = useState(() => (prefersReducedMotion() ? value : 0))
  /** 上一次动画跑到哪了，`value` 中途变了就从这儿接着跑，不跳回 0 */
  const fromRef = useRef(0)
  /** 当前显示的值的镜子：清理函数里要用最新的那个，不能闭包住旧 state */
  const shownRef = useRef(shown)

  useEffect(() => {
    if (prefersReducedMotion()) {
      setShown(value)
      shownRef.current = value
      fromRef.current = value
      return
    }

    const from = fromRef.current
    if (from === value) return

    let raf = 0
    /**
     * 起点用**第一帧自己的时间戳**，不要用 `performance.now()`：
     * rAF 回调拿到的时间戳与 `performance.now()` 不一定同源（jsdom 下就是两个原点），
     * 混着用会算出「已经过去 -197581 毫秒」这种数，滚出来的值直接飞了。
     */
    let started: number | null = null

    const tick = (now: number) => {
      if (started === null) started = now
      const t = Math.min(1, (now - started) / duration)
      const next = Math.round(from + (value - from) * easeOutCubic(t))
      shownRef.current = next
      setShown(next)
      if (t < 1) raf = requestAnimationFrame(tick)
      else fromRef.current = value
    }
    raf = requestAnimationFrame(tick)

    return () => {
      cancelAnimationFrame(raf)
      // 中途被打断：把当前显示值记成下一段的起点
      fromRef.current = shownRef.current
    }
  }, [value, duration])

  return (
    <span className={`count-up${className ? ` ${className}` : ''}`}>
      {/* 读屏念真值，不念滚到一半的那个数 */}
      <span className="sr-only">{value}</span>
      <span aria-hidden="true">{shown}</span>
    </span>
  )
}
