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
    phrase: '我们深度复盘，可以吗？',
    minutes: 20,
    followUpCap: 5,
    guidance:
      '对方状态不错，可以聊深：每块的问题都问，追问到把一件事讲透，鼓励他多说细节和当时的想法。',
  },
  {
    id: 'mid',
    label: '中度复盘',
    phrase: '我们中度复盘，可以吗？',
    minutes: 12,
    followUpCap: 2,
    guidance: '每块都把主要问题问一遍，追问点到为止，一个问题问清了就往下走。',
  },
  {
    id: 'fast',
    label: '快速复盘',
    phrase: '我们快速复盘，可以吗？',
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
      '这周睡眠、运动和吃饭怎么样？',
      '这周整体情绪怎么样？最消耗情绪的一件事是什么？',
      '这周精力最好的时段在做什么？被什么打断最多？',
      '这周有什么输入（看的书、听的课、跟人的对话）？学到的一条能马上用的是什么？',
    ],
    followUps: [
      '主要是被什么影响的？',
      '这种状态持续多久了？',
      '这周有没有哪件事改变了你的看法？',
      '学到的那条，打算怎么用？',
      '那你打算怎么调整？',
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
      '这周主要忙了些什么？',
      '有没有本来打算做、结果没做成的事？卡在哪一步了？',
      '这周你做的最关键的一个判断是什么？当时依据什么，现在回看还成立吗？',
      '有没有突然插进来、打乱你计划的事？',
      '这周有没有做新鲜事？',
      '有没有应该做、但一直没做的事？为什么没做？',
    ],
    followUps: [
      '这件事哪一部分最花时间？',
      '后来结果怎么样了？',
      '当时你是怎么处理的？',
      '时间大致是怎么分配的？哪块投入产出比最低？',
    ],
  },
  {
    key: 'people',
    label: '人际',
    hint: '和谁有关，卡在哪里',
    kind: 'block',
    mainQuestions: [
      '这周跟谁打交道最多？',
      '有没有想联系、但一直没联系的人？有什么原因吗？',
      '有没有一次沟通本可以更好？下次怎么开口？',
      '有没有边界被侵犯、或者自己越界的情况？当时怎么处理的？',
    ],
    followUps: [
      '有没有哪件事卡在对方那里？',
      '后来你们是怎么说的？',
      '这个人最近让你印象最深的是什么？',
      '有没有需要主动开口求助、或者该谢一声的人？',
    ],
    optionalQuestions: ['有没有该维护、但一直没维护的关系（家人、老客户、关键同事）？'],
  },
  {
    key: 'thing',
    label: '物与钱',
    hint: '实物、花销与订阅、该维护的事，都算这块',
    kind: 'block',
    mainQuestions: [
      '这周买了什么、或者添置了什么？用上了吗？',
      '这周有没有买了、但没用上的？当时为什么买？',
      '有没有该续费、该维护、该修的，一直拖着没做的？',
      '这周的支出情况？',
    ],
    followUps: [
      '有没有处理掉、退掉、或者卖掉的东西？',
      '现在回头看，这笔花得值不值？买它是因为什么？',
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
