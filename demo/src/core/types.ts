/**
 * 采访区块。前四个是内容块（状态 / 事情 / 人际 / 物与钱），
 * `reconcile`（上周对账）是夹在状态与事情之间的一道单题，只在上周有记录时问。
 * 顺序就是 `script.ts` 里 `SCRIPT` 的顺序。
 */
export type Dimension = 'mood' | 'reconcile' | 'event' | 'people' | 'thing'

/** 复盘深度：深度 / 中度 / 快速，由用户在状态块之后自己挑 */
export type Depth = 'deep' | 'mid' | 'fast'

/**
 * 模型这一轮想干什么：接着追（`[追问]`）/ 换下一题（`[换题]`）/
 * 这块聊够了换下一块（`[换块]`）。
 */
export type TurnAction = 'followup' | 'next' | 'block'

export type Role = 'ai' | 'user'

export interface ChatMessage {
  id: string
  role: Role
  text: string
  /** 这条消息所属的采访区块；用户消息继承所回答问题的区块 */
  dimension: Dimension
  /**
   * 这条回答对应状态四项里的哪一项。只在状态块里有值。
   *
   * 界面据此把一排星星挂在这条回答下面 —— 「问完一段就点一次」，
   * 分数跟的是**那条回答**，所以换了块、翻回去看历史都还能改。
   */
  stateKey?: StateKey
  at: number
}

/** 单个区块的进度 */
export interface BlockProgress {
  /** 当前问到该区块的第几个主问题 */
  askIndex: number
  /** 当前主问题上已经追问了几次 */
  followUpCount: number
  /** 该区块的主问题是否已经问完 */
  complete: boolean
  /**
   * 主问题问完之后，用户自己主动接着说下去的轮数。
   * 刻意不计入覆盖率：该聊的都聊过了，后面是用户想多聊，不该让进度条倒着走。
   */
  freeTurns: number
}

export type BlockProgressMap = Record<Dimension, BlockProgress>

/**
 * 采访进度状态机。纯数据，便于单测。
 * 与线性流程的区别：每个区块各记各的进度，用户可以自由选择先聊哪一块。
 */
export interface InterviewState {
  /** 当前展开的区块；null 表示还没开始 */
  active: Dimension | null
  blocks: BlockProgressMap
  /**
   * 复盘深度档位；null 表示状态块还没聊完、用户还没挑。
   * 挑档位是客户端的三个按钮，不是让模型去猜 —— 确定性才算得清覆盖率。
   */
  depth: Depth | null
}

export interface PersonNote {
  name: string
  note: string
}

/**
 * 上一周的结果摘要，只在「上周对账」这一步用。
 *
 * 只带两样：下周重点、要跟进的人 —— 对账问的就是这两样落到了哪儿。
 */
export interface LastWeekPlan {
  focus: string[]
  followUps: string[]
}

/** 构建提示词时可能要带的上下文 */
export interface InterviewContext {
  lastWeek?: LastWeekPlan
  /** 上一周是哪个周，写进提示词里，模型可以自然地说「上周」 */
  lastWeekKey?: string
}

/**
 * 状态四项的键；**顺序 = 状态块四道主问题的顺序**
 * （见 `script.ts` 里 `mood.mainQuestions`，script.test.ts 钉着这两边等长）。
 */
export const STATE_KEYS = ['body', 'mood', 'focus', 'growth'] as const

export type StateKey = (typeof STATE_KEYS)[number]

/**
 * 状态打分：每项 1–5 星，**没打分就没有这个键**（0 星 = 用户点掉了那颗星）。
 *
 * 分数只由界面产生 —— 提示词里没让模型打分，就算它自己编了一组，
 * 生成那一步也会被界面上真实的点击覆盖掉（见 `stateScore.attachScores`）。
 */
export type StateScores = Partial<Record<StateKey, number>>

/**
 * 状态那一段：四项各一句文字（0.9.2 起每项还可以点一个 0–5 星的分）。
 */
export interface WeeklyState {
  /** 身体 */
  body: string
  /** 情绪 */
  mood: string
  /** 精力 / 专注 */
  focus: string
  /** 心智（成长） */
  growth: string
  /**
   * 四项各一个 1–5 星的分；一项都没打分时整个键不出现。
   *
   * 旧档（0.9.1 及以前）没有这个键，读回来就是 undefined —— 界面显示「未打分」，
   * 不冒充 0 分。
   */
  scores?: StateScores
}

export function createEmptyState(): WeeklyState {
  return { body: '', mood: '', focus: '', growth: '' }
}

export function isStateEmpty(state: WeeklyState): boolean {
  return !state.body && !state.mood && !state.focus && !state.growth
}

export interface WeeklyResult {
  /** 事情 */
  events: string[]
  /** 人际 */
  people: PersonNote[]
  /** 物品 */
  things: string[]
  /** 悬而未决 */
  pending: string[]
  /** 本周热点 */
  highlights: string[]
  /** 下周重点 */
  nextFocus: string[]
  /** 下周要跟进的人 */
  nextFollowUps: string[]
  /** 状态：身体 / 情绪 / 精力 / 心智 各一句 */
  state: WeeklyState
}

export function createEmptyResult(): WeeklyResult {
  return {
    events: [],
    people: [],
    things: [],
    pending: [],
    highlights: [],
    nextFocus: [],
    nextFollowUps: [],
    state: createEmptyState(),
  }
}

/** 采访者人设的预设；'custom' 表示这段提示词已经被用户手改过 */
export type PersonaPresetId = 'warm' | 'crisp' | 'coach' | 'playful' | 'custom'

/** 用户没挑预设时用哪一套 */
export const DEFAULT_PERSONA_PRESET: PersonaPresetId = 'warm'

/**
 * 专属采访者：语气由用户自己定。
 *
 * 存的是**完整的人设提示词原文**，不是预设编号 —— 这样用户改一个字都算数，
 * 而且换版本、换预设之后，他自己写过的那份不会被悄悄顶掉。
 */
export interface PersonaConfig {
  /** 生效的人设提示词；空串表示还没写过，用默认预设 */
  prompt: string
  /** 界面上高亮哪一套，仅用于显示 */
  preset: PersonaPresetId
}

export interface AppConfig {
  apiKey: string
  baseUrl: string
  model: string
  persona: PersonaConfig
}

export function createDefaultConfig(): AppConfig {
  return {
    apiKey: '',
    baseUrl: 'https://api.deepseek.com/v1',
    model: 'deepseek-chat',
    persona: { prompt: '', preset: DEFAULT_PERSONA_PRESET },
  }
}

let seq = 0
export function nextId(prefix = 'm'): string {
  seq += 1
  return `${prefix}_${Date.now().toString(36)}_${seq}`
}
