import type { ChatMessage, Dimension, InterviewState, WeeklyResult } from './types'

/**
 * AI 能力接口。
 * Demo 阶段由 mockAi 实现；M2 接真实模型时替换为真实实现，上层无需改动。
 */
export interface AiClient {
  /** 就用户刚才的回答，判断是否需要追问（最终是否追问由状态机兜底） */
  wantsFollowUp(userText: string, state: InterviewState, dim: Dimension): Promise<boolean>
  /**
   * 生成该区块的下一句话。
   * history 是完整对话记录，实现方自行按 dim 过滤。
   * 区块首次被打开时，这里负责给出开场白和第一个问题；
   * 区块已经聊完时，这里给出收尾语。
   */
  nextMessage(state: InterviewState, dim: Dimension, history: ChatMessage[]): Promise<string>
  /** 汇总全部对话，产出结构化结果 */
  summarize(history: ChatMessage[]): Promise<WeeklyResult>
  /**
   * 用户看过结果、做了修改并补充说明之后，重新整理一遍。
   * 约定：清单内容尊重用户的修改，只重新生成「本周热点」与「下周计划」。
   */
  refine(history: ChatMessage[], current: WeeklyResult, note: string): Promise<WeeklyResult>
}
