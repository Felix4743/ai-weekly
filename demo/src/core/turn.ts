/**
 * 采访每一轮里，模型先表态「接下来怎么走」，再给出一句话。
 *
 * 为什么不直接用 JSON：JSON 没法边收边显示，一上流式就会看到半截花括号。
 * 所以约定模型用**行首标记**表态，正文照常流式输出，界面上看不到标记。
 *
 * 0.9.5 起 `[换块]` 那一行还要**报一次覆盖**：`[换块] 覆盖:1,3`。
 * 为什么只在换块时报：块内怎么聊、聊几轮完全自由，客户端不需要知道；
 * 只有「这一块收尾时还差哪几个要点没聊到」需要算得清。中途每轮都报，
 * 等于给模型每句话都加一道格式化作业 —— 那正是要治的机械感。
 */

import type { TurnAction } from './types'

export const FOLLOW_UP_TOKEN = '[追问]'
export const NEXT_TOKEN = '[换题]'
export const BLOCK_TOKEN = '[换块]'

/** 标记最长就是这个长度，用于判断流式时「开头是不是还没收全的标记」 */
const MARKER_MAX = Math.max(
  FOLLOW_UP_TOKEN.length,
  NEXT_TOKEN.length,
  BLOCK_TOKEN.length,
)

export interface TurnReply {
  action: TurnAction
  message: string
  /**
   * 这一块已经聊到的要点序号（1 起）。只有 `[换块]` 那一行会报；
   * 没报或者报得不认识就是空数组 —— 客户端会退化成「按你问过的算」。
   */
  covered: number[]
}

const MARKERS: Array<{ token: string; action: TurnAction }> = [
  { token: FOLLOW_UP_TOKEN, action: 'followup' },
  { token: NEXT_TOKEN, action: 'next' },
  { token: BLOCK_TOKEN, action: 'block' },
]

/** `覆盖:1,3` / `覆盖：1、3` / `覆盖: 1 3` 都认 */
const COVERAGE_RE = /覆盖\s*[：:]\s*([\d\s,，、]*)/

/** 从文本里挖出报上来的要点序号；认不出来就是空数组，不抛 */
export function parseCoverage(text: string): number[] {
  const hit = COVERAGE_RE.exec(text)
  if (!hit) return []
  const out: number[] = []
  for (const part of hit[1].split(/[,，、\s]+/)) {
    if (!part) continue
    const n = Number.parseInt(part, 10)
    // 序号从 1 起；0 与负数都是模型乱写的，丢掉
    if (Number.isInteger(n) && n >= 1) out.push(n)
  }
  // 去重，保持原有顺序
  return [...new Set(out)]
}

/** 把可能散落在文本里的标记与覆盖声明清干净，避免漏到界面上 */
function stripTokens(text: string): string {
  let out = COVERAGE_RE.test(text) ? text.replace(COVERAGE_RE, '') : text
  for (const { token } of MARKERS) out = out.split(token).join('')
  return out.trim()
}

/**
 * 解析模型这一轮的完整回复。
 *
 * 没有标记时按「换题」处理：聊到哪儿由模型说了算，但**至少要往下走**，
 * 不能因为漏了一个标记就原地不动。
 */
export function parseTurnReply(raw: string): TurnReply {
  if (typeof raw !== 'string') return { action: 'next', message: '', covered: [] }

  const trimmed = raw.replace(/^\uFEFF/, '').replace(/^[\s\u3000]+/, '')
  const covered = parseCoverage(trimmed)

  for (const { token, action } of MARKERS) {
    if (trimmed.startsWith(token)) {
      return { action, message: stripTokens(trimmed.slice(token.length)), covered }
    }
  }
  return { action: 'next', message: stripTokens(trimmed), covered }
}

/**
 * 流式显示用：把行首标记与覆盖声明摘掉。
 *
 * final 为 false 时，如果开头看起来还是「没收全的标记」（比如只收到了「[追」），
 * 就先返回空串按住不显示 —— 否则界面上会闪一下「[追」再消失。
 */
export function stripMarkerForDisplay(text: string, final = false): string {
  if (typeof text !== 'string') return ''

  const trimmed = text.replace(/^\uFEFF/, '').replace(/^[\s\u3000]+/, '')
  if (!final && trimmed.startsWith('[') && !trimmed.includes(']') && trimmed.length < MARKER_MAX) {
    return ''
  }

  for (const { token } of MARKERS) {
    if (trimmed.startsWith(token)) {
      return stripTokens(trimmed.slice(token.length))
    }
  }
  return stripTokens(trimmed)
}
