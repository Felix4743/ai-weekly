import type { Depth, Dimension } from './types'

/**
 * 一个**要点**：聊完这一块时，应该已经知道的东西。
 *
 * 0.9.5 之前这里是「主问题清单」—— 每块 6 / 4 / 4 / 2 道题，按顺序一道一道问，
 * `[换题]` 的语义是「这一题问到了」。用户的原话是「问法还是太机械了」，
 * 具体感受是「它不看我在聊什么，照着自己的清单走」「不该问的题它还是问」。
 * 根不在措辞，在**结构**：固定的条数加固定的顺序，读起来就是一张表单。
 *
 * 现在每块只声明「要了解到这几样」，**顺序、条数、深度全交给模型**：
 * 一句话可能同时答到两个要点，用户聊到哪就跟到哪。客户端只做一件事 ——
 * 这一块收尾时对账：还有哪个要点没聊到。
 *
 * `intent` 是目标（给模型看的，不是台词）；`anchors` 是「帮人想起来」的锚点示例，
 * 只在演示模式与补问兜底时被念出来。
 */
export interface PointSpec {
  /** 稳定标识，收尾对账与用例都用它；给模型看的是它在这一块里的序号（1 起） */
  id: string
  /** 要了解到什么（意思是给模型看的，不是要念的句子） */
  intent: string
  /** 锚点示例，只是意思 */
  anchors: string[]
}

export interface DimensionScript {
  key: Dimension
  label: string
  /** 折叠状态下的一句话说明，让人知道这块是聊什么的 */
  hint: string
  /**
   * `block` = 内容块，界面上有 tab、算进度；
   * `step` = 流程里夹着的一道小题（状态追问 / 上周对账），不占进度。
   */
  kind: 'block' | 'step'
  /**
   * 这一块要聊到的几样。**没有顺序含义** —— 模型自己决定先聊哪个、怎么聊。
   *
   * 0.9.5 的题量口径：事情 4 / 人际 3 / 物品 3 / 成长 2 = 12 个要点。
   * 状态追问那一步的要点按分数现算（见 `probe.ts`），所以这里是空的。
   */
  points: PointSpec[]
  /** 往具体里追的方向（一句话给方向，**不再是可轮取的追问清单**） */
  digInto?: string
}

/** 复盘深度：一句话问法 + 大概时长 + 连续追问最多几次 */
export interface DepthSpec {
  id: Depth
  label: string
  /** 状态打分卡交上来之后，原话问出来的那一句 */
  phrase: string
  /** 大概要多久，写进提示词，让模型自己掌握节奏 */
  minutes: number
  /** 同一个话题最多连着追几次；深度档也不设死，靠「问到效果」判定 */
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
      '对方状态不错，可以聊深：每个要点都聊到，追问到把一件事讲透，鼓励他多说细节和当时的想法。',
  },
  {
    id: 'mid',
    label: '中度复盘',
    phrase: '正常聊，可以吗？',
    minutes: 12,
    followUpCap: 2,
    guidance: '每个要点都过一遍，追问点到为止，一件事问清了就往下走。',
  },
  {
    id: 'fast',
    label: '快速复盘',
    phrase: '今天时间紧，抓重点聊，可以吗？',
    minutes: 5,
    followUpCap: 1,
    guidance:
      '时间紧或状态差：每块只聊最要紧的一两个要点，不追问，对方不想展开就顺势往下走。',
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

/**
 * 一块最多聊几个回合（防打转的兜底）。
 *
 * 没有主问题清单之后，「这一块聊完了没有」全靠模型自己说 `[换块]`。
 * 万一它一直不换、或者用户一直在追同一件事，这里给它一个上限：
 * 到了就收尾，宁可少聊一样，也不要把人按在这儿。
 */
export const MAX_TURNS_PER_BLOCK = 10

/** 收尾对账发现要点没聊到时，客户端最多补问几次；补完仍不齐就放行 */
export const MAX_NUDGES = 2

/** 演示模式要念的那一句：取第一个锚点 */
export function spoken(point: PointSpec | undefined): string {
  return point?.anchors[0] ?? ''
}

/**
 * 采访脚本。
 *
 * 顺序 = 采访顺序：**状态追问 → 上周对账 → 事情 → 人际 → 物品与支出 → 成长**。
 * 更前面还有开场那张状态打分卡（不在 SCRIPT 里，它是客户端的一屏）。
 * 成长放最后是用户定的：先把做过的事、跟人的事、钱的事理完，最后聊长了什么见识。
 *
 * 块与块之间的顺序仍然固定（那是流程），**块内不再有顺序**。
 */
export const SCRIPT: DimensionScript[] = [
  {
    key: 'probe',
    label: '状态追问',
    hint: '分低的那几项，是什么挡着的',
    kind: 'step',
    // 要点按分数现算（≤ 2 星的项各一个），见 probe.ts 的 probePoints
    points: [],
    digInto: '往具体里追：是什么挡着、能不能挪开、以前试过什么办法。',
  },
  {
    key: 'reconcile',
    label: '上周对账',
    hint: '上周定的事，实际落到了哪儿',
    kind: 'step',
    // 真正的问法由提示词用上一周的「下周重点 / 要跟进的人」现场拼出来
    points: [
      {
        id: 'reconcile-kept',
        intent: '上周定下的那几件事实际落到了哪儿',
        anchors: ['上周定的那几件事，实际落到了哪儿？'],
      },
    ],
    digInto: '往具体里追：哪一步卡住了、下周还接着做吗。',
  },
  {
    key: 'event',
    label: '事情',
    hint: '这周做了什么、卡在哪',
    kind: 'block',
    points: [
      {
        id: 'event-focus',
        intent: '这周的时间主要花在哪儿、重心落在哪件事上',
        anchors: ['这周大部分时间都花在哪儿了？', '这周主要忙的是哪一件事？'],
      },
      {
        id: 'event-stuck',
        intent: '有没有本来打算做、最后没动的事，卡在哪一步',
        anchors: ['有件本来想做的事，最后没动？卡在哪一步了？', '这周有什么一直没推进的？'],
      },
      {
        id: 'event-unsure',
        intent: '这周有没有一个当时拿不准的决定，后来是怎么定的',
        anchors: ['这周有没有哪个决定，你当时挺拿不准的？', '后来是怎么定下来的？'],
      },
      {
        id: 'event-interrupt',
        intent: '有没有突然插进来、把计划打乱的事，或者顺手干了点什么新的',
        anchors: ['这周有没有突然插进来、把计划打乱的事？', '有没有顺手干了点新鲜的？'],
      },
    ],
    digInto: '往具体里追：这件事最花时间的是哪一块、后来结果怎么样、当时卡在哪一步。',
  },
  {
    key: 'people',
    label: '人际',
    hint: '和谁有关，卡在哪里',
    kind: 'block',
    points: [
      {
        id: 'people-most',
        intent: '这周跟谁打交道最多，为的是什么事',
        anchors: ['这周跟谁打交道最多？为了什么事？'],
      },
      {
        id: 'people-missed',
        intent: '有没有想联系、但一直没联系的人，是什么挡着',
        anchors: ['有没有想联系、但一直没联系的人？是什么挡着？'],
      },
      {
        id: 'people-awkward',
        intent: '有没有一次沟通事后觉得没说到位，或者谁的哪句话让他不舒服',
        anchors: [
          '这周有没有哪次沟通，事后觉得没说到位？下次会怎么开口？',
          '有没有谁的哪句话，让你不太舒服？',
        ],
      },
    ],
    digInto: '往具体里追：这件事卡在对方哪儿、后来你们怎么说的、你现在怎么看这个人。',
  },
  {
    key: 'thing',
    label: '物品与支出',
    hint: '实物、花销与订阅、该维护的事，都算这块',
    kind: 'block',
    points: [
      {
        id: 'thing-bought',
        intent: '这周买了什么、用上了吗；买了之后一直没用上的也算',
        anchors: ['这周买了点什么？用上了吗？', '有没有买了之后一直没用上的？'],
      },
      {
        id: 'thing-delayed',
        intent: '有没有一直拖着没续、没修、没收拾的事',
        anchors: ['有什么一直拖着没续、没修、没收拾的？'],
      },
      {
        id: 'thing-money',
        intent: '这周的钱主要花在哪儿，有没有哪笔花完有点心疼',
        anchors: ['这周钱主要花在哪儿了？', '有没有哪笔花完有点心疼？'],
      },
    ],
    digInto: '往具体里追：这笔花得值不值、当时是怎么下的决心、拖着没做是因为什么。',
  },
  {
    key: 'growth',
    label: '成长',
    hint: '这周长了什么见识、想通了什么',
    kind: 'block',
    points: [
      {
        id: 'growth-learned',
        intent: '这周看了什么、听了什么，或者跟谁聊出点东西',
        anchors: ['这周看了什么、听了什么，或者跟谁聊出点东西？'],
      },
      {
        id: 'growth-shift',
        intent: '这周有没有哪件事，让他换了个角度看',
        anchors: ['有没有哪件事，你现在的看法跟以前不一样了？', '这事你以前是怎么看它的？'],
      },
    ],
    digInto: '往具体里追：这点你打算怎么用上、以前你是怎么看的。',
  },
]

/** 内容块（有 tab、算进度的那几块） */
export const CONTENT_BLOCKS = SCRIPT.filter((d) => d.kind === 'block')

/** 四个内容块一共几个要点（0.9.5 起是 12） */
export const TOTAL_POINTS = CONTENT_BLOCKS.reduce((n, d) => n + d.points.length, 0)

/** 没有上一周记录时，对账这一步直接跳过 */
export const RECONCILE_KEY: Dimension = 'reconcile'

/** 没有低分项时（或者一项都没打分），状态追问这一步整步跳过 */
export const PROBE_KEY: Dimension = 'probe'

export function dimensionLabel(key: Dimension): string {
  return SCRIPT.find((d) => d.key === key)?.label ?? key
}

export function dimensionScript(key: Dimension): DimensionScript | undefined {
  return SCRIPT.find((d) => d.key === key)
}

export function pointsOf(dim: Dimension): PointSpec[] {
  return dimensionScript(dim)?.points ?? []
}

export function isContentBlock(dim: Dimension): boolean {
  return CONTENT_BLOCKS.some((d) => d.key === dim)
}

/** 给模型看的序号是 1 起的；报覆盖、补问都按这个号走 */
export function pointNumber(index: number): number {
  return index + 1
}

/** 按序号（1 起）取要点；越界返回 undefined，别抛 */
export function pointByNumber(points: readonly PointSpec[], n: number): PointSpec | undefined {
  return points[n - 1]
}
