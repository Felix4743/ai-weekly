/**
 * 采访区块。内容是四块（事情 / 人际 / 物品与支出 / 成长），
 * 另外两道夹在流程里的单题：`probe`（状态追问）与 `reconcile`（上周对账）。
 * 顺序就是 `script.ts` 里 `SCRIPT` 的顺序。
 *
 * - `probe`（0.9.4 新加）：打完分之后，**按打分**追着低分那几项问。
 *   几道题由分数决定（≤ 2 星才算低分），四项都还行就整步跳过。
 * - `reconcile`：只在上周有记录时才问。
 *
 * 「状态」本身仍然不是问答块 —— 它是开场一张打分卡（四项 0–5 星 + 一行备注），
 * 不进 `SCRIPT`，也不占 AI 轮次。`probe` 追问的是这张卡上的分数，不是卡本身。
 */
export type Dimension = 'probe' | 'reconcile' | 'event' | 'people' | 'thing' | 'growth'

/** 复盘深度：深度 / 中度 / 快速，由用户在状态打分卡之后自己挑 */
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
  at: number
}

/**
 * 单个区块的进度。
 *
 * 0.9.5 起这里**没有「题号」了**：块内没有固定题序，「问到第几题」这个概念被
 * 「哪几个要点已经聊到」取代（见 `script.ts` 的 `PointSpec`）。
 */
export interface BlockProgress {
  /**
   * 这一块聊了几个回合。
   * 只用于防打转的兜底（`MAX_TURNS_PER_BLOCK`），不代表「问到第几题」。
   */
  asked: number
  /** 同一个话题连着追了几次；换题 / 换块时归零（防审讯的上限，跟着档位走） */
  followUpCount: number
  /** 这一块收尾了没有 */
  complete: boolean
  /**
   * 收尾之后，用户自己主动接着说下去的轮数。
   * 刻意不计入覆盖率：该聊的都聊过了，后面是用户想多聊，不该让进度条倒着走。
   */
  freeTurns: number
  /** 已经聊到的要点 id；收尾对账靠它算出「还差哪几样」 */
  covered: string[]
  /**
   * 收尾时发现要点没聊到、于是客户端补问了几次。
   * 补满 `MAX_NUDGES` 次还不齐就放行 —— 宁可少聊一样，也不要变成审讯。
   */
  nudges: number
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
   * 开场那张状态打分卡交上来了没有。
   *
   * 打分卡是客户端的一屏（四项点星 + 一行备注），不占 AI 轮次，
   * 所以它用一个显式开关表示，而不是像别的步骤那样用区块进度。
   */
  stateDone: boolean
  /**
   * 交卡那一刻挑出来的低分项（≤ 2 星），也就是 `probe` 那一步要问的几项。
   *
   * 放在这里而不是每次现算，是因为**流程要据此决定问几道题、要不要整步跳过**：
   * 卡一交、分数就定了，之后在结果页改分不该把已经问过的追问倒回去。
   */
  lowKeys: StateKey[]
  /**
   * 复盘深度档位；null 表示还没挑。
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

/**
 * 本周已经聊过一次时的摘要（0.9.3 的「接着上次补」）。
 *
 * 只带已经记下来的条目：开场要说一句「这周你已经聊过一次，记了这些…」，
 * 模型据此避开重复提问，也知道今天该往哪儿补。
 */
export interface ThisWeekSummary {
  /** 上次写盘的时间 */
  savedAt: number
  /** 已经记下的条目，已经拼成人话，按块分组 */
  lines: string[]
}

/** 构建提示词时可能要带的上下文 */
export interface InterviewContext {
  lastWeek?: LastWeekPlan
  /** 上一周是哪个周，写进提示词里，模型可以自然地说「上周」 */
  lastWeekKey?: string
  /** 本周已经有记录了；有就走「接着上次补」 */
  thisWeek?: ThisWeekSummary
  /**
   * 他在这周打分卡上点的分（0.9.4 起）。
   *
   * 给模型看是**只读**的用途：`probe` 那一步要据此问「睡眠 2/5 是为什么」，
   * 模型看得见分才问得准。但它**写不了分** —— 落盘的永远是界面上真实的点击。
   */
  stateScores?: StateScores
}

/**
 * 状态四项的键；**顺序 = 打分卡上四排星的顺序**（用户 2026-10-03 定的四项）。
 *
 * 0.9.2 及以前是「身体 / 情绪 / 精力 / 心智」四行文字 + 每行一颗星；
 * 0.9.3 起状态只剩这四项的分数 + 一行备注。
 */
export const STATE_KEYS = ['mood', 'sleep', 'sport', 'diet'] as const

export type StateKey = (typeof STATE_KEYS)[number]

/**
 * 状态打分：每项 1–5 星，**没打分就没有这个键**（再点同一颗星 = 取消）。
 *
 * 分数只由界面产生 —— 提示词里没有状态这一栏，模型碰不到它；
 * 生成那一步用界面上真实的点击覆盖（见 `stateScore.attachState`）。
 */
export type StateScores = Partial<Record<StateKey, number>>

/**
 * 状态那一段：四项各一个 0–5 星的分，外加一行备注，外加一段追问小结。
 *
 * 分数可以不点（未打分），备注可以留空 —— 两个都空就是「没说状态」。
 */
export interface WeeklyState {
  /**
   * 四项各一个 1–5 星的分；一项都没点整个键不出现。
   *
   * 旧档（0.9.2 及以前）这里没有分数，四行文字读进 `note`（见 `parseResult.ts` 的 `toState`、
   * 读档入口 `storage/shape.ts`）。
   */
  scores?: StateScores
  /** 想补一句就写在这儿；旧档那四行状态文字也并到这一行 */
  note: string
  /**
   * 低分项聊出来的小结（0.9.4 新加，可选）。
   *
   * 为什么不并进 `note`：`note` 是**用户自己写的字**，而这一段是模型据追问对话写的。
   * 两者混在一个字段里，「接着补」的第二轮就会把上一轮的小结原样再抄一遍，
   * 而且用户改过的那句话会被顶掉。分开存之后，界面上仍然是「状态那一栏里的两行」，
   * 导出也挨在一起，但谁是谁一目了然 —— 老档没有这个键，读回来就是空。
   */
  followUp?: string
}

export function createEmptyState(): WeeklyState {
  return { note: '' }
}

export function isStateEmpty(state: WeeklyState): boolean {
  return !state.note && !hasAnyScore(state)
}

/** 内部小工具：这一份状态里有没有点过分 */
function hasAnyScore(state: WeeklyState): boolean {
  return STATE_KEYS.some((key) => typeof state.scores?.[key] === 'number')
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
  /** 成长（0.9.3 新开的一栏，纯文字、不打分） */
  growth: string[]
  /** 本周热点 */
  highlights: string[]
  /** 下周重点 */
  nextFocus: string[]
  /** 下周要跟进的人 */
  nextFollowUps: string[]
  /** 状态：四项分数 + 一行备注 */
  state: WeeklyState
}

export function createEmptyResult(): WeeklyResult {
  return {
    events: [],
    people: [],
    things: [],
    pending: [],
    growth: [],
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
