import { type CSSProperties, type ReactNode, useEffect, useState } from 'react'

/**
 * 一个小小的入场动效（0.9.10 加的，给「值得停一下」的地方用）。
 *
 * 为什么是它而不是动画库：这个项目的约束是「能不引就不引」，
 * 所以淡入淡出这件事自己写 40 行就够 —— 不依赖 keyframes，也不依赖 Framer。
 *
 * 用法：
 *   <FadeIn delay={0.08}>
 *     <Card />
 *   </FadeIn>
 *
 * delay 秒（默认 0.12）：卡片多一点重量，别一上来就全跳出来；
 * once = false 时每次重新挂载都会重播（默认 true，进一屏播一次）。
 *
 * 它会往子元素外面套一层 <span class="fade-in">，不会改结构，
 * 只是把「从无到有」这一下交给 CSS 的 opacity / transform。
 */
interface Props {
  children: ReactNode
  /** 秒；越大越稳，默认 0.12 */
  delay?: number
  /** 只播一次（默认 true）；false 时每次重新挂载都会重播 */
  once?: boolean
  /** 想再改一点就传，平时不用 */
  style?: CSSProperties
  className?: string
}

export function FadeIn({ children, delay = 0.12, once = true, style, className }: Props) {
  const [on, setOn] = useState(false)
  useEffect(() => {
    // 下一帧再触发，给浏览器一个「先渲染再动」的机会，不然 transition 起不来
    const id = requestAnimationFrame(() => setOn(true))
    return () => cancelAnimationFrame(id)
  }, [])
  return (
    <span
      className={['fade-in', on ? 'on' : '', className].filter(Boolean).join(' ')}
      style={{ transitionDelay: `${delay}s`, ...style }}
      data-once={once ? 'true' : undefined}
    >
      {children}
    </span>
  )
}
