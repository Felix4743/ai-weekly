/**
 * 采访每一轮里，模型先表态「要不要追问」，再给出一句话。
 *
 * 为什么不直接用 JSON：JSON 没法边收边显示，一上流式就会看到半截花括号。
 * 所以约定模型用**行首标记**表态，正文照常流式输出，界面上看不到标记。
 */

export const FOLLOW_UP_TOKEN = '[追问]'
export const ADVANCE_TOKEN = '[换题]'

/** 标记最长就是这个长度，用于判断流式时「开头是不是还没收全的标记」 */
const MARKER_MAX = Math.max(FOLLOW_UP_TOKEN.length, ADVANCE_TOKEN.length)

export interface TurnReply {
  wantsFollowUp: boolean
  message: string
}

/** 把可能散落在文本里的标记清干净，避免漏到界面上 */
function stripTokens(text: string): string {
  return text.split(FOLLOW_UP_TOKEN).join('').split(ADVANCE_TOKEN).join('').trim()
}

/**
 * 解析模型这一轮的完整回复。
 *
 * 没有标记时按「换题」处理：状态机本来就靠推进来保证四个区块都被覆盖，
 * 少追问一次只是损失一点深度，漏掉一个主问题才是产品层面的失效。
 */
export function parseTurnReply(raw: string): TurnReply {
  if (typeof raw !== 'string') return { wantsFollowUp: false, message: '' }

  const trimmed = raw.replace(/^\uFEFF/, '').replace(/^[\s\u3000]+/, '')

  if (trimmed.startsWith(FOLLOW_UP_TOKEN)) {
    return { wantsFollowUp: true, message: stripTokens(trimmed.slice(FOLLOW_UP_TOKEN.length)) }
  }
  if (trimmed.startsWith(ADVANCE_TOKEN)) {
    return { wantsFollowUp: false, message: stripTokens(trimmed.slice(ADVANCE_TOKEN.length)) }
  }
  return { wantsFollowUp: false, message: stripTokens(trimmed) }
}

/**
 * 流式显示用：把行首标记摘掉。
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

  if (trimmed.startsWith(FOLLOW_UP_TOKEN)) {
    return stripTokens(trimmed.slice(FOLLOW_UP_TOKEN.length))
  }
  if (trimmed.startsWith(ADVANCE_TOKEN)) {
    return stripTokens(trimmed.slice(ADVANCE_TOKEN.length))
  }
  return stripTokens(trimmed)
}
