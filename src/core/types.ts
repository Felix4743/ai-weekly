/** 采访区块：事情 / 人际 / 状态 / 收尾 */
export type Dimension = 'event' | 'people' | 'mood' | 'closing'

export type Role = 'ai' | 'user'

export interface ChatMessage {
  id: string
  role: Role
  text: string
  /** 这条消息所属的采访区块；用户消息继承所回答问题的区块 */
  dimension: Dimension
  at: number
}

/** 采访进度状态机。纯数据，便于单测。 */
export interface InterviewState {
  /** 当前处在第几个区块 */
  dimensionIndex: number
  /** 当前区块内问到了第几个主问题 */
  askIndex: number
  /** 当前主问题上已经追问了几次 */
  followUpCount: number
  done: boolean
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
    pending: [],
    highlights: [],
    nextFocus: [],
    nextFollowUps: [],
  }
}

export interface AppConfig {
  apiKey: string
  baseUrl: string
  model: string
}

export function createDefaultConfig(): AppConfig {
  return {
    apiKey: '',
    baseUrl: 'https://api.deepseek.com/v1',
    model: 'deepseek-chat',
  }
}

let seq = 0
export function nextId(prefix = 'm'): string {
  seq += 1
  return `${prefix}_${Date.now().toString(36)}_${seq}`
}
