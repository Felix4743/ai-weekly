import type { ChatMessage, InterviewState, WeeklyResult } from './types'

/**
 * AI 能力接口。
 * Demo 阶段由 mockAi 实现；M2 接真实模型时替换为真实实现，上层无需改动。
 */
export interface AiClient {
  /** 开场白 + 第一个问题 */
  opening(): Promise<string>
  /** 就用户刚才的回答，判断是否需要追问（最终是否追问由状态机兜底） */
  wantsFollowUp(userText: string, state: InterviewState): Promise<boolean>
  /** 状态机推进后，生成 AI 的下一句话 */
  nextMessage(state: InterviewState, history: ChatMessage[]): Promise<string>
  /** 汇总全部对话，产出结构化结果 */
  summarize(history: ChatMessage[]): Promise<WeeklyResult>
}
