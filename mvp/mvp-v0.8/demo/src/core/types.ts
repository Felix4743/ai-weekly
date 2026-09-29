/** 采访区块：事情 / 人际 / 物品 / 状态 */
export type Dimension = 'event' | 'people' | 'thing' | 'mood'

export type Role = 'ai' | 'user'

export interface ChatMessage {
  id: string
  role: Role
  text: string
  /** 这条消息所属的采访区块；用户消息继承所回答问题的区块 */
  dimension: Dimension
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
  /** 当前展开的区块；null 表示回到区块列表 */
  active: Dimension | null
  blocks: BlockProgressMap
}

export interface PersonNote {
  name: string
  note: string
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
