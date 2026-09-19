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
  /**
   * 用户看过结果、做了修改并补充说明之后，重新整理一遍。
   * 约定：清单内容尊重用户的修改，只重新生成「本周热点」与「下周计划」。
   */
  refine(history: ChatMessage[], current: WeeklyResult, note: string): Promise<WeeklyResult>
}
