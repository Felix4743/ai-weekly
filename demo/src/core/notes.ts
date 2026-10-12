/**
 * 周中随心记：一周里随手丢进来的一句话。
 *
 * 为什么要有它：这个软件原来是**一次性**的 —— 周末坐下来从头回忆这一周。
 * 于是周三那通电话、想买又没买的椅子，到周末要么凉了、要么觉得「太小不值得说」。
 * 随手记把一周变成「平时攒素材 + 周末收口」：平时不采访、不点评、不打分，
 * 只往抽屉里丢一句话；周末收口时这些碎片是采访的素材。
 *
 * 三条刻意的设计：
 * - **一条只有一句话 + 一个时刻**。没有必填的分类 —— 随手记的全部价值在摩擦低，
 *   一旦要求填东西，周中就不会有人记。
 * - 归类是**客户端猜的**（`guessDim`），只用来在界面上给个提示；
 *   真正「这条该在哪一栏问」由模型在采访时自己判断，猜错了不影响任何东西。
 * - 时间是**记下的那一刻**（`at`），日期由它推出来，全程本地时间、不碰 UTC。
 *
 * 这里全是纯函数（只有 `createNote` 会取一个新 id），所以随手记的规则不用起界面就能测。
 */

import { dateKey } from './week'
import { nextId, type Note, type NoteDim } from './types'

/**
 * 一条最多写多少字。
 *
 * 它是「一句话」，不是日记 —— 超过这个长度的输入截断，而不是拒绝：
 * 用户粘了一大段进来，截断比弹一个错误框友善。
 */
export const NOTE_TEXT_MAX = 200

/**
 * 一周最多留多少条。
 *
 * 一天记三条、记满七天也就二十来条；这个上限是防「粘进来的东西把归档撑大」，
 * 不是产品上的约束。真超了就丢最老的那条。
 */
export const NOTES_PER_WEEK_LIMIT = 100

/** 四块的名字，顺序和 `script.ts` 里 `CONTENT_BLOCKS` 一致 */
export const NOTE_DIMS: readonly NoteDim[] = ['event', 'people', 'thing', 'growth']

const NOTE_DIM_LABELS: Record<NoteDim, string> = {
  event: '事情',
  people: '人际',
  thing: '物品',
  growth: '成长',
}

/**
 * 界面上的短标签。
 *
 * 为什么不用 `script.ts` 的 `dimensionLabel`：那边是给整块做标题的，
 * 「物品与支出」四个字塞进一枚小标签太挤；这里要的是最短的那个词。
 */
export function noteDimLabel(dim: NoteDim): string {
  return NOTE_DIM_LABELS[dim] ?? NOTE_DIM_LABELS.event
}

/**
 * 猜一条随手记属于哪一块。
 *
 * **这是猜，不是判断**：先按「跟谁有关」「是不是买了什么」「是不是在长本事」的
 * 顺序看几条最明显的线索，都不像就归到「事情」—— 那一块最宽，猜错也最不刺眼。
 * 线索刻意写得很窄：宁可漏（归到事情）也不要错认（把「跟张总吃饭花了 300」
 * 认成物品），因为错认会在界面上显得莫名其妙，而漏了只是少一个提示。
 */
const DIM_RULES: readonly { dim: NoteDim; pattern: RegExp }[] = [
  {
    dim: 'people',
    pattern:
      /(妈妈|爸|妈|父母|老婆|老公|爱人|孩子|儿子|女儿|家人|亲戚|朋友|同事|客户|老板|领导|老师|同学|医生|房东|张总|李总|王总|赵总|刘总|陈总)/,
  },
  {
    dim: 'thing',
    pattern:
      /(买|购|下单|付了|付款|花了|花掉|订了|退了|退掉|换了|修了|快递|包裹|价格|块钱|缴费|续费|充值|淘宝|京东|网购)/,
  },
  {
    dim: 'growth',
    pattern: /(学|练|读|看完|课|书|跑步|健身|早起|坚持|想通|明白|体会到|戒|习惯|第一次|尝试|复盘)/,
  },
]

export function guessDim(text: string): NoteDim {
  const hit = DIM_RULES.find((rule) => rule.pattern.test(text))
  return hit ? hit.dim : 'event'
}

/**
 * 建一条随手记。空的（或者只有空白）返回 `null` —— 空白不该在列表里留一行。
 *
 * `dim` 由 `guessDim` 填；想手工指定（测试、或者以后让用户改）就传第三个参数。
 */
export function createNote(text: string, at: number, dim?: NoteDim): Note | null {
  const trimmed = text.trim().slice(0, NOTE_TEXT_MAX)
  if (!trimmed) return null
  return {
    id: nextId('n'),
    at,
    date: dateKey(new Date(at)),
    text: trimmed,
    dim: dim ?? guessDim(trimmed),
  }
}

/**
 * 加一条，**按时间从早到晚排**（像流水账）。
 *
 * 存的是时间序、界面显示时再倒过来：提示词里要按「周一…周三…」念给模型听，
 * 而列表里最新的一条该在最上面。两处顺序不同是刻意的。
 *
 * **同一个 id 算同一条**（后来的覆盖先前的）：`id` 就是笔记的身份，
 * 重复加同一条不该在列表里出现两遍。
 */
export function addNote(notes: Note[], note: Note): Note[] {
  const kept = notes.filter((n) => n.id !== note.id)
  const next = [...kept, note].sort((a, b) => a.at - b.at)
  // 超上限时丢最老的
  return next.length > NOTES_PER_WEEK_LIMIT ? next.slice(next.length - NOTES_PER_WEEK_LIMIT) : next
}

export function removeNote(notes: Note[], id: string): Note[] {
  return notes.filter((n) => n.id !== id)
}

export function findNote(notes: Note[], id: string): Note | null {
  return notes.find((n) => n.id === id) ?? null
}

/**
 * 从文件里读回来的一条。
 *
 * 归档是给人手改过的，什么都可能在里面：认不出来的整条丢掉（跟 `normalizeArchive`
 * 逐条丢的口径一致），能救的字段救回来 —— 缺 `date` 就拿 `at` 现推。
 */
export function coerceNote(raw: unknown): Note | null {
  if (!raw || typeof raw !== 'object') return null
  const parsed = raw as Partial<Note>
  const text = typeof parsed.text === 'string' ? parsed.text.trim().slice(0, NOTE_TEXT_MAX) : ''
  if (!text) return null
  const at = Number.isFinite(parsed.at) ? (parsed.at as number) : Date.now()
  const rawDate = typeof parsed.date === 'string' ? parsed.date : ''
  const date = /^\d{4}-\d{2}-\d{2}$/.test(rawDate) ? rawDate : dateKey(new Date(at))
  const dim = NOTE_DIMS.includes(parsed.dim as NoteDim) ? (parsed.dim as NoteDim) : guessDim(text)
  const id = typeof parsed.id === 'string' && parsed.id ? parsed.id : nextId('n')
  return { id, at, date, text, dim }
}

/** `9月28日`：列表里每一条前面那个日子 */
export function noteDateLabel(note: Note, now: Date = new Date()): string {
  const matched = /^(\d{4})-(\d{2})-(\d{2})$/.exec(note.date)
  if (!matched) return ''
  const year = Number(matched[1])
  const month = Number(matched[2])
  const day = Number(matched[3])
  const prefix = year === now.getFullYear() ? '' : `${year}年`
  return `${prefix}${month}月${day}日`
}

/** 「记了 3 条」/「还没记过」—— 两处界面说的是同一句话，抽出来免得漂 */
export function notesCountText(count: number): string {
  return count > 0 ? `记了 ${count} 条` : '还没记过'
}

/**
 * 这一周的随手记，写成提示词里那段「素材」。
 *
 * 只给日期和原文，**不给猜出来的分类**：分类是客户端的显示提示，
 * 写进提示词反而会绑住模型的判断（它自己知道「跟张总打电话」该在哪一栏问）。
 */
export function notesForPrompt(notes: Note[], now: Date = new Date()): string[] {
  return notes.map((n) => `${noteDateLabel(n, now)}：${n.text}`)
}
