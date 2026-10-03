import type { Depth, Dimension } from './types'

/**
 * 一道参考题：**只给意思，不给成品句子**。
 *
 * 0.9.2 之前这里是一句写死的话，模型照着念，一周又一周都是同一句，
 * 用户的原话是「别跟个人机一样问，谁愿意聊？」。
 * 0.9.3 起每题只写「这一轮要问到什么」+ 一两句示例；措辞交给模型，
 * 客户端仍然管顺序与覆盖面（该问到的没问出来，不许换题）。
 *
 * `examples` 只有两处会用到：提示词里当参考（明确写了别照抄），
 * 以及演示模式（没填 Key）时假 AI 的台词 —— 那台假 AI 不会说话，只能念一句。
 */
export interface QuestionSpec {
  /** 这一轮要问到什么（意思是给模型看的，不是要念的句子） */
  intent: string
  /** 示例问法，只是意思 */
  examples: string[]
}

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
   * 该区块的参考主问题。
   *
   * 什么时候换下一块由模型判定（见 turn.ts 的 `[换块]`），
   * 这份清单只是给模型的目标和兜底。**块内的顺序仍然是固定的** ——
   * 顺序与覆盖面是产品的骨架，怎么说是模型的自由。
   */
  mainQuestions: QuestionSpec[]
  /** 追问池：说到才追，不硬问 */
  followUps: QuestionSpec[]
  /** 聊开了才问的题（可选），没聊到就不提 */
  optionalQuestions?: QuestionSpec[]
}

/** 复盘深度：一句话问法 + 大概时长 + 每道主问题最多追问几次 */
export interface DepthSpec {
  id: Depth
  label: string
  /** 状态打分卡交上来之后，原话问出来的那一句 */
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

/** 还没定档时的追问上限（正常流程里定档在打分卡之后、第一块之前，兜底用） */
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

/** 演示模式要念的那一句：取第一条示例 */
export function spoken(spec: QuestionSpec | undefined): string {
  return spec?.examples[0] ?? ''
}

/**
 * 采访脚本。
 *
 * 顺序 = 采访顺序：**上周对账 → 事情 → 人际 → 物品与支出 → 成长**。
 * 更前面还有开场那张状态打分卡（不在 SCRIPT 里，它是客户端的一屏），
 * 成长放最后是用户定的：先把做过的事、跟人的事、钱的事理完，最后聊长了什么见识。
 */
export const SCRIPT: DimensionScript[] = [
  {
    key: 'reconcile',
    label: '上周对账',
    hint: '上周定的事，实际落到了哪儿',
    kind: 'step',
    // 真正的问法由提示词用上一周的「下周重点 / 要跟进的人」现场拼出来
    mainQuestions: [
      {
        intent: '上周定的那几件事实际落到了哪儿',
        examples: ['上周定的那几件事，实际落到了哪儿？'],
      },
    ],
    followUps: [
      { intent: '哪一步卡住了', examples: ['哪一步卡住了？'] },
      { intent: '下周还接着做吗', examples: ['下周还接着做吗？'] },
    ],
  },
  {
    key: 'event',
    label: '事情',
    hint: '这周做了什么、卡在哪',
    kind: 'block',
    mainQuestions: [
      { intent: '这周主要在忙什么', examples: ['这周主要在忙什么？'] },
      {
        intent: '有没有本来打算做、最后没动的事，卡在哪一步',
        examples: ['有没有本来打算做、最后没动的事？卡在哪一步？'],
      },
      {
        intent: '这周有没有一个当时挺拿不准的决定',
        examples: ['这周有没有一个决定，你当时挺拿不准的？'],
      },
      {
        intent: '这周有没有突然插进来、把计划打乱的事',
        examples: ['这周有没有突然插进来、把计划打乱的事？'],
      },
      { intent: '这周有没有干了点新鲜的', examples: ['这周有没有干了点什么新鲜的？'] },
      {
        intent: '有没有一直想做、却一直没动的事，卡在哪儿',
        examples: ['有没有一直想做、却一直没动的事？卡在哪儿了？'],
      },
    ],
    followUps: [
      { intent: '这件事最花时间的是哪一块', examples: ['这件事最花时间的是哪一块？'] },
      { intent: '后来结果怎么样', examples: ['后来结果怎么样？'] },
      { intent: '当时是怎么处理的', examples: ['当时你是怎么处理的？'] },
      {
        intent: '时间大概是怎么分的、哪块最不值',
        examples: ['时间大概是怎么分的？哪块最不值？'],
      },
      { intent: '后来是怎么定的', examples: ['后来是怎么定的？'] },
      { intent: '现在回头看还这么想吗', examples: ['现在回头看，还这么想吗？'] },
    ],
  },
  {
    key: 'people',
    label: '人际',
    hint: '和谁有关，卡在哪里',
    kind: 'block',
    mainQuestions: [
      { intent: '这周跟谁打交道最多', examples: ['这周跟谁打交道最多？'] },
      {
        intent: '有没有想联系、但一直没联系的人，是因为什么',
        examples: ['有没有想联系、但一直没联系的人？是因为什么？'],
      },
      {
        intent: '这周有没有一次沟通事后觉得没说到位，下次会怎么开口',
        examples: ['这周有没有一次沟通，事后觉得没说到位？下次你会怎么开口？'],
      },
      {
        intent: '这周有没有谁的哪句话、哪个做法让他不舒服',
        examples: ['这周有没有谁的哪句话、哪个做法让你不舒服？'],
      },
    ],
    followUps: [
      { intent: '有没有哪件事卡在对方那儿', examples: ['有没有哪件事卡在对方那儿？'] },
      { intent: '后来这事你们怎么说的', examples: ['后来这事你们怎么说的？'] },
      {
        intent: '这个人最近有什么让他印象深的',
        examples: ['这个人最近有什么让你印象深的？'],
      },
      {
        intent: '有没有谁，其实该开口求助或者该谢一声',
        examples: ['有没有谁，你其实该开口求助，或者该谢一声？'],
      },
    ],
    optionalQuestions: [
      {
        intent: '有没有一阵子没联系、其实该问候一声的人',
        examples: ['有没有一阵子没联系、其实该问候一声的人？'],
      },
    ],
  },
  {
    key: 'thing',
    label: '物品与支出',
    hint: '实物、花销与订阅、该维护的事，都算这块',
    kind: 'block',
    mainQuestions: [
      { intent: '这周买了点什么、用上了吗', examples: ['这周买了点什么？用上了吗？'] },
      {
        intent: '有没有买了之后一直没用上的，当时是怎么下的决心',
        examples: ['有没有买了之后一直没用上的？当时是怎么下的决心？'],
      },
      {
        intent: '有没有一直拖着没续、没修、没收拾的',
        examples: ['有没有一直拖着没续、没修、没收拾的？'],
      },
      {
        intent: '这周花钱的地方多吗、有没有哪笔花完有点心疼',
        examples: ['这周花钱的地方多吗？有没有哪笔花完有点心疼？'],
      },
    ],
    followUps: [
      {
        intent: '有没有处理掉、退掉或者卖掉的东西',
        examples: ['有没有处理掉、退掉或者卖掉的东西？'],
      },
      { intent: '现在回头看这笔花得值吗', examples: ['现在回头看，这笔花得值吗？'] },
    ],
  },
  {
    key: 'growth',
    label: '成长',
    hint: '这周长了什么见识、想通了什么',
    kind: 'block',
    mainQuestions: [
      {
        intent: '这周看了什么、听了什么，或者跟谁聊出点东西',
        examples: [
          '这周看了什么、听了什么，或者跟谁聊出点东西？',
          '这周有没有从哪儿学到点什么？',
        ],
      },
      {
        intent: '这周有没有哪件事，让他换了个角度看',
        examples: [
          '这周有没有哪件事，让你换了个角度？',
          '有没有什么事，你现在的看法跟以前不一样了？',
        ],
      },
    ],
    followUps: [
      { intent: '这点打算怎么用上', examples: ['这点你打算怎么用上？'] },
      { intent: '这事以前是怎么看它的', examples: ['这事你以前是怎么看它的？'] },
      { intent: '下周想试点什么', examples: ['下周想试点什么？'] },
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

export function questionsInBlock(dim: Dimension): QuestionSpec[] {
  return dimensionScript(dim)?.mainQuestions ?? []
}

export function isContentBlock(dim: Dimension): boolean {
  return CONTENT_BLOCKS.some((d) => d.key === dim)
}
