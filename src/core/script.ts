import type { Dimension } from './types'

export interface DimensionScript {
  key: Dimension
  label: string
  /** 该区块的主问题；每个主问题最多追问 MAX_FOLLOWUPS_PER_QUESTION 次 */
  mainQuestions: string[]
  /** 追问话术池，按顺序循环取用 */
  followUps: string[]
}

/** 追问上限：到顶就换下一题，避免变成审讯 */
export const MAX_FOLLOWUPS_PER_QUESTION = 2

/** 采访脚本（首版）—— 状态机据此保证覆盖，AI 只负责措辞 */
export const SCRIPT: DimensionScript[] = [
  {
    key: 'event',
    label: '事情',
    mainQuestions: ['这周主要忙了些什么？', '有没有本来打算做、结果没做成的事？'],
    followUps: ['这件事哪一部分最花时间？', '后来结果怎么样了？', '这件事卡在哪一步？'],
  },
  {
    key: 'people',
    label: '人际',
    mainQuestions: ['这周跟谁打交道最多？', '有没有想联系、但一直没联系的人？'],
    followUps: ['有没有哪件事卡在对方那里？', '为什么一直没联系？', '这个人最近让你印象最深的是什么？'],
  },
  {
    key: 'mood',
    label: '状态',
    mainQuestions: ['这周整体感觉怎么样，累不累？'],
    followUps: ['主要是被什么影响的？', '这种状态持续多久了？'],
  },
  {
    key: 'closing',
    label: '收尾',
    mainQuestions: ['还有什么我没问到、但你想说的？'],
    followUps: ['再多说一点？'],
  },
]

export const TOTAL_MAIN_QUESTIONS = SCRIPT.reduce((n, d) => n + d.mainQuestions.length, 0)

export function dimensionLabel(key: Dimension): string {
  return SCRIPT.find((d) => d.key === key)?.label ?? key
}

export function dimensionScript(key: Dimension): DimensionScript | undefined {
  return SCRIPT.find((d) => d.key === key)
}
