import type {
  ChatMessage,
  Dimension,
  InterviewContext,
  InterviewState,
  TurnAction,
  WeeklyResult,
} from './types'

/** 流式增量回调：模型每吐出一小段就调一次 */
export type DeltaHandler = (delta: string) => void

/** 用户答完一句之后，模型这一轮的产出 */
export interface TurnResult {
  /** 接下来怎么走：接着追 / 换个方向 / 这一块收尾换下一块 */
  action: TurnAction
  /** 接下来要说的话（已经去掉行首标记与覆盖声明） */
  message: string
  /**
   * `[换块]` 那行报上来的要点序号（1 起）。只有收尾时才报 ——
   * 块内怎么聊是模型的自由，客户端只需要知道「这一块收尾时还差哪几样」。
   */
  covered?: number[]
}

/**
 * AI 能力接口。
 *
 * 上层（App / UI）只依赖这个接口，因此假 AI 与真实模型可以互换。
 * 注意分工：**兜底与进度由状态机保证，这里只负责怎么问、问多深**。
 */
export interface AiClient {
  /**
   * 区块第一次被打开、或已聊完时，给出这一句话。
   * 调用方传进来的 state 已经包含当前进度。
   */
  nextMessage(
    state: InterviewState,
    dim: Dimension,
    history: ChatMessage[],
    onDelta?: DeltaHandler,
    ctx?: InterviewContext,
  ): Promise<string>

  /**
   * 用户答完一句之后的**唯一一次**调用：同时给出「接下来怎么走」和「下一句话」。
   * 真实模型下这就是一次请求 —— 分成两次会让每轮多一倍延迟和花费。
   */
  reply(
    state: InterviewState,
    dim: Dimension,
    history: ChatMessage[],
    onDelta?: DeltaHandler,
    ctx?: InterviewContext,
  ): Promise<TurnResult>

  /** 汇总全部对话，产出结构化结果 */
  summarize(history: ChatMessage[], ctx?: InterviewContext): Promise<WeeklyResult>

  /**
   * 用户看过结果、做了修改并补充说明之后，重新整理一遍。
   * 约定：清单内容尊重用户的修改，只重新生成「本周热点」与「下周计划」。
   */
  refine(history: ChatMessage[], current: WeeklyResult, note: string): Promise<WeeklyResult>
}
