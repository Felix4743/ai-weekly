import { stateField } from './stateFields'
import type { PointSpec } from './script'
import { coerceScore } from './stateScore'
import { STATE_KEYS, type StateKey, type StateScores } from './types'

/**
 * 状态追问：打完分之后，**按分数决定接下来问什么**。
 *
 * 这是用户 2026-10-10 提的第一个问题：
 * 「第一步打完分之后就没后续了……我想打完分之后才根据打分情况进行提问」，
 * 他举的例子是「睡眠不好是为什么」「运动不够是为什么可以挤时间吗」。
 *
 * 分两层：
 * - **哪些项值得追**由这里的 `lowScoreKeys` 定（纯数据，可测）——不是模型自己猜；
 * - **怎么问**交给模型，这里只给「要问到什么」加示例，和别处的题库一个口径。
 *
 * 分数依然是**只读**的：模型能看到分（它就是用来决定问什么的），但产不出分 ——
 * 写回存档的永远只有界面上真实的点击（见 `stateScore.ts` 的 `attachScoreNote`）。
 */

/** 低分线：0–5 星里 ≤ 2 星算「这周这一项没被照顾好」，打完分就针对它追一句 */
export const LOW_SCORE_MAX = 2

/**
 * 一项低分要怎么追。
 *
 * 语气跟题库一致：一句只问一件事、用他会说的词、不问「为什么没做到」而是问
 * 「是什么挡着」。追问的落点是**原因与腾挪空间**，不是评判 —— 所以
 * 「运动」那一条专门把「时间能不能挤出来」摆在明面上，那正是用户的原话。
 */
const PROBE_INTENTS: Record<StateKey, { intent: string; examples: string[] }> = {
  mood: {
    intent: '心情被什么带下去的，跟哪件事或哪个人有关',
    examples: ['这周心情不太好，是被什么带下去的？', '那阵子跟什么事有关？'],
  },
  sleep: {
    intent: '睡不够是什么挡着的（睡不着、醒得早，还是根本没躺下）',
    examples: ['睡眠不好是为什么？', '是躺下睡不着，还是中间会醒？'],
  },
  sport: {
    intent: '没动起来是没时间还是没劲，时间能不能挤出来',
    examples: ['运动不够是为什么？', '是没时间，还是没劲？时间能挤出来吗？'],
  },
  diet: {
    intent: '吃得不好是忙到顾不上，还是一直这样',
    examples: ['吃得不太行是因为什么？', '是忙到顾不上吗？'],
  },
}

export interface LowScoreItem {
  key: StateKey
  /** 行首那个词：心情 / 睡眠 / 运动 / 饮食 */
  label: string
  /** 他打的分（1–5） */
  score: number
  /** 这一项要问到什么 */
  intent: string
  examples: string[]
}

/**
 * 挑出低分的那几项。
 *
 * **没打分不算低分**：一项没点跟「点了 2 分」在数据上本就不同（前者连键都不写），
 * 把「没打分」读成「过得不好」会凭空造出一场追问。顺序按 `STATE_KEYS`，
 * 也就是打分卡上四排星的顺序 —— 追的顺序跟点星的顺序一致，读起来才顺。
 */
export function lowScoreItems(scores: StateScores | undefined): LowScoreItem[] {
  const out: LowScoreItem[] = []
  for (const key of STATE_KEYS) {
    const score = coerceScore(scores?.[key])
    if (score === undefined || score > LOW_SCORE_MAX) continue
    const spec = PROBE_INTENTS[key]
    out.push({
      key,
      label: stateField(key)?.label ?? key,
      score,
      intent: spec.intent,
      examples: spec.examples,
    })
  }
  return out
}

/** 只管「有没有低分项」的那些地方用这个（状态机、要不要跳过这一步） */
export function lowScoreKeys(scores: StateScores | undefined): StateKey[] {
  return lowScoreItems(scores).map((item) => item.key)
}

/**
 * 把低分项摊成这一块要聊的几个**要点**：一项一个，顺序即打分卡上的顺序。
 *
 * 状态机拿它当 `probe` 这一步的要点表 —— 所以「聊到几样算聊完」是算得清的，
 * 而「怎么问、先问哪个」还是模型的事。
 */
export function probePoints(keys: readonly StateKey[]): PointSpec[] {
  return keys.map((key) => {
    const spec = PROBE_INTENTS[key]
    const label = stateField(key)?.label ?? key
    return { id: `probe-${key}`, intent: `${label}：${spec.intent}`, anchors: spec.examples }
  })
}

/** 提示词里那一小段「他给自己打了几分」；一项都没打分就是空串 */
export function scoresLine(scores: StateScores | undefined, max: number): string {
  const parts = STATE_KEYS.map((key) => {
    const n = coerceScore(scores?.[key])
    if (n === undefined) return null
    return `${stateField(key)?.label ?? key} ${n}/${max}`
  }).filter((s): s is string => s !== null)
  return parts.join(' · ')
}
