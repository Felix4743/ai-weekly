import type { CSSProperties } from 'react'

/**
 * 大标题逐字浮现（0.9.10，React Bits 的 Blur Text 那一路）。
 *
 * 做法：把标题拆成一个字一个 `<span>`，每个字带一点 `animation-delay`，
 * CSS 里从「模糊 + 透明 + 下沉」走到清晰。**不用动画库**（跟 FadeIn 同一个理由：
 * 这个项目连 UI 依赖都不引），也不需要 state —— 纯 CSS 动画，挂上去就自己跑完。
 *
 * 两个必要的讲究：
 * 1. 读屏。一个字一个 span 会被逐字念出来，所以在动画层上写 `aria-hidden`，
 *    另放一份 `.sr-only` 的完整文字给它念。
 * 2. 按词切。每个词包一层 `inline-block`，断行只会发生在词与词之间 ——
 *    中文标题本来就没有空格（「本周梳理」「总览」「设置」），也就是整句不换行；
 *    这几处标题都只有三五个字，不怕。真正的长句别用它。
 */

type Props = {
  text: string
  /** 每个字之间错开多久（秒） */
  stagger?: number
  /** 头一个字等多久（秒） */
  delay?: number
  className?: string
  style?: CSSProperties
}

export function BlurText({ text, stagger = 0.04, delay = 0, className, style }: Props) {
  /** 先把整句按空格切成词，每个词再拆成字 —— 词内不断行，词间才有断点 */
  const words = text.split(' ')
  let index = 0

  return (
    <span className={`blur-text${className ? ` ${className}` : ''}`} style={style}>
      <span className="sr-only">{text}</span>
      <span aria-hidden="true">
        {words.map((word, w) => (
          <span className="blur-text__word" key={`${word}-${w}`}>
            {Array.from(word).map((ch) => {
              const at = index
              index += 1
              return (
                <span
                  className="blur-text__ch"
                  key={`${ch}-${at}`}
                  style={{ animationDelay: `${(delay + at * stagger).toFixed(3)}s` }}
                >
                  {ch}
                </span>
              )
            })}
            {/* 词之间的空格：真的空格在拆字之后会被吃掉，这里补回来 */}
            {w < words.length - 1 ? <span className="blur-text__space"> </span> : null}
          </span>
        ))}
      </span>
    </span>
  )
}
