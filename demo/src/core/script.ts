import type { Dimension } from './types'

export interface DimensionScript {
  key: Dimension
  label: string
  /** 折叠状态下的一句话说明，让人知道这块是聊什么的 */
  hint: string
  /** 该区块的主问题；每个主问题最多追问 MAX_FOLLOWUPS_PER_QUESTION 次 */
  mainQuestions: string[]
  /** 追问话术池，按顺序循环取用 */
  followUps: string[]
}

/**
 * 追问上限：到顶就换下一题，避免变成审讯。
 *
 * 这个数字只管到「主问题有没有被问完」为止。问完之后用户还想说，
 * 走的是自由聊（见 interview.ts 的 freeTurns），不再受这个上限约束 ——
 * 主动开口的人不该被一个计数器拦住。
 */
export const MAX_FOLLOWUPS_PER_QUESTION = 3

/** 采访脚本 —— 状态机据此保证每个区块都能被覆盖，AI 只负责措辞 */
export const SCRIPT: DimensionScript[] = [
  {
    key: 'event',
    label: '事情',
    hint: '这周做了什么',
    mainQuestions: [
      '这周主要忙了些什么？',
      '有没有本来打算做、结果没做成的事？',
      '有没有哪件事比预想的顺利，或者比预想的费劲？',
      '这周有没有突然插进来、打乱你计划的事？',
    ],
    followUps: [
      '这件事哪一部分最花时间？',
      '后来结果怎么样了？',
      '这件事卡在哪一步？',
      '当时你是怎么处理的？',
    ],
  },
  {
    key: 'people',
    label: '人际',
    hint: '和谁有关，卡在哪里',
    mainQuestions: [
      '这周跟谁打交道最多？',
      '有没有想联系、但一直没联系的人？',
      '有没有谁帮了你、或者你帮了谁的忙？',
      '这周有没有哪次沟通，让你觉得挺费劲的？',
    ],
    followUps: [
      '有没有哪件事卡在对方那里？',
      '为什么一直没联系？',
      '这个人最近让你印象最深的是什么？',
      '后来你们是怎么说的？',
    ],
  },
  {
    key: 'thing',
    label: '物品',
    hint: '这周买了什么、处理掉了什么',
    mainQuestions: [
      '这周买了什么、或者添置了什么东西？',
      '有没有处理掉、退掉、或者卖掉的东西？',
      '这周有没有花得不太值的一笔钱？',
      '有没有一直想买、但还没下手的东西？',
    ],
    followUps: [
      '买它是因为什么？',
      '用下来感觉怎么样？',
      '现在回头看，这笔值不值？',
      '是什么让你迟迟没定下来？',
    ],
  },
  {
    key: 'mood',
    label: '状态',
    hint: '这周过得怎么样',
    mainQuestions: [
      '这周整体感觉怎么样，累不累？',
      '睡眠和精神头怎么样？',
      '这周有没有哪个瞬间让你觉得挺舒服、挺值的？',
      '还有什么我没问到、但你想说的？',
    ],
    followUps: ['主要是被什么影响的？', '这种状态持续多久了？', '那你打算怎么调整？'],
  },
]

export const TOTAL_MAIN_QUESTIONS = SCRIPT.reduce((n, d) => n + d.mainQuestions.length, 0)

export function dimensionLabel(key: Dimension): string {
  return SCRIPT.find((d) => d.key === key)?.label ?? key
}

export function dimensionScript(key: Dimension): DimensionScript | undefined {
  return SCRIPT.find((d) => d.key === key)
}
