import type { Depth, Dimension } from './types'

export interface DimensionScript {
  key: Dimension
  label: string
  /** 折叠状态下的一句话说明，让人知道这块是聊什么的 */
  hint: string
  /**
   * `block` = 内容块，界面上有 tab、算进度；
   * `step` = 流程里夹着的一道小题（目前只有「上周对账」），不占进度。
   */
  kind: 'block' | 'step'
  /**
   * 该区块的**参考**主问题。
   *
   * 0.9.1 起题目不再是「问完才算过」的脚本：什么时候换下一块由模型判定
   * （见 turn.ts 的 `[换块]`），这份清单只是给模型的参考和兜底。
   */
  mainQuestions: string[]
  /** 追问池：说到才追，不硬问 */
  followUps: string[]
  /** 聊开了才问的题（可选），没聊到就不提 */
  optionalQuestions?: string[]
}

/** 复盘深度：一句话问法 + 大概时长 + 每道主问题最多追问几次 */
export interface DepthSpec {
  id: Depth
  label: string
  /** 状态块聊完之后，原话问出来的那一句 */
  phrase: string
  /** 大概要多久，写进提示词，让模型自己掌握节奏 */
  minutes: number
  /** 每道主问题最多追问几次；深度档也不设死，靠「问到效果」判定 */
  followUpCap: number
  /** 这块节奏怎么把握 */
  guidance: string
}

export const DEPTHS: DepthSpec[] = [
  {
    id: 'deep',
    label: '深度复盘',
    phrase: '我们聊细一点，可以吗？',
    minutes: 20,
    followUpCap: 5,
    guidance:
      '对方状态不错，可以聊深：每块的问题都问，追问到把一件事讲透，鼓励他多说细节和当时的想法。',
  },
  {
    id: 'mid',
    label: '中度复盘',
    phrase: '正常聊，可以吗？',
    minutes: 12,
    followUpCap: 2,
    guidance: '每块都把主要问题问一遍，追问点到为止，一个问题问清了就往下走。',
  },
  {
    id: 'fast',
    label: '快速复盘',
    phrase: '今天时间紧，抓重点聊，可以吗？',
    minutes: 5,
    followUpCap: 1,
    guidance:
      '时间紧或状态差：每块只抓一两个关键问题，不追问，对方不想展开就顺势往下走。',
  },
]

/** 定档之前（状态块还在聊）用的追问上限 */
export const DEFAULT_FOLLOWUP_CAP = 2

export const FOLLOWUP_CAPS: Record<Depth, number> = {
  deep: 5,
  mid: 2,
  fast: 1,
}

export function followUpCap(depth: Depth | null): number {
  return depth ? FOLLOWUP_CAPS[depth] : DEFAULT_FOLLOWUP_CAP
}

export function depthSpec(depth: Depth | null): DepthSpec | undefined {
  return DEPTHS.find((d) => d.id === depth)
}

/**
 * 采访脚本。
 *
 * 顺序 = 采访顺序：状态 → 上周对账 → 事情 → 人际 → 物与钱。
 * 状态放最前，是因为它最轻、最好开口，而且答案决定了后面能问多深。
 */
export const SCRIPT: DimensionScript[] = [
  {
    key: 'mood',
    label: '状态',
    hint: '这周过得怎么样、身体和心气如何',
    kind: 'block',
    mainQuestions: [
      '这周身体怎么样？睡得够吗？',
      '这周心情怎么样？有没有哪件事一直挂在你心上？',
      '这周什么时候状态最好？又是什么最常把你打断？',
      '这周看了什么、听了什么，或者跟谁聊出点东西来？',
    ],
    followUps: [
      '你觉得是什么影响了它？',
      '这状态有多久了？',
      '这周有没有哪件事，让你换了个角度看？',
      '聊到的那点，打算怎么用上？',
      '下周想怎么调一调？',
    ],
  },
  {
    key: 'reconcile',
    label: '上周对账',
    hint: '上周定的事，实际落到了哪儿',
    kind: 'step',
    // 真正的问法由提示词用上一周的「下周重点 / 要跟进的人」现场拼出来
    mainQuestions: ['上周定的那几件事，实际落到了哪儿？'],
    followUps: ['哪一步卡住了？', '下周还接着做吗？'],
  },
  {
    key: 'event',
    label: '事情',
    hint: '这周做了什么、卡在哪',
    kind: 'block',
    mainQuestions: [
      '这周主要在忙什么？',
      '有没有本来打算做、最后没动的事？卡在哪一步？',
      '这周有没有一个决定，你当时挺拿不准的？',
      '这周有没有突然插进来、把计划打乱的事？',
      '这周有没有干了点什么新鲜的？',
      '有没有一直想做、却一直没动的事？卡在哪儿了？',
    ],
    followUps: [
      '这件事最花时间的是哪一块？',
      '后来结果怎么样？',
      '当时你是怎么处理的？',
      '时间大概是怎么分的？哪块最不值？',
      '后来是怎么定的？',
      '现在回头看，还这么想吗？',
    ],
  },
  {
    key: 'people',
    label: '人际',
    hint: '和谁有关，卡在哪里',
    kind: 'block',
    mainQuestions: [
      '这周跟谁打交道最多？',
      '有没有想联系、但一直没联系的人？是因为什么？',
      '这周有没有一次沟通，事后觉得没说到位？下次你会怎么开口？',
      '这周有没有谁的哪句话、哪个做法让你不舒服？',
    ],
    followUps: [
      '有没有哪件事卡在对方那儿？',
      '后来这事你们怎么说的？',
      '这个人最近有什么让你印象深的？',
      '有没有谁，你其实该开口求助，或者该谢一声？',
    ],
    optionalQuestions: ['有没有一阵子没联系、其实该问候一声的人？'],
  },
  {
    key: 'thing',
    label: '物与钱',
    hint: '实物、花销与订阅、该维护的事，都算这块',
    kind: 'block',
    mainQuestions: [
      '这周买了点什么？用上了吗？',
      '有没有买了之后一直没用上的？当时是怎么下的决心？',
      '有没有一直拖着没续、没修、没收拾的？',
      '这周花钱的地方多吗？有没有哪笔花完有点心疼？',
    ],
    followUps: [
      '有没有处理掉、退掉或者卖掉的东西？',
      '现在回头看，这笔花得值吗？',
    ],
  },
]

/** 内容块（有 tab、算进度的那几块） */
export const CONTENT_BLOCKS = SCRIPT.filter((d) => d.kind === 'block')

export const TOTAL_MAIN_QUESTIONS = CONTENT_BLOCKS.reduce(
  (n, d) => n + d.mainQuestions.length,
  0,
)

/** 没有上一周记录时，对账这一步直接跳过 */
export const RECONCILE_KEY: Dimension = 'reconcile'

export function dimensionLabel(key: Dimension): string {
  return SCRIPT.find((d) => d.key === key)?.label ?? key
}

export function dimensionScript(key: Dimension): DimensionScript | undefined {
  return SCRIPT.find((d) => d.key === key)
}

export function questionsInBlock(dim: Dimension): string[] {
  return dimensionScript(dim)?.mainQuestions ?? []
}

export function isContentBlock(dim: Dimension): boolean {
  return CONTENT_BLOCKS.some((d) => d.key === dim)
}
