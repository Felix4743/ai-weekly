import type { AiClient } from './aiClient'
import {
  blockProgress,
  currentFollowUp,
  currentQuestion,
  nextIncompleteBlock,
} from './interview'
import { MAX_FOLLOWUPS_PER_QUESTION, dimensionLabel } from './script'
import {
  createEmptyResult,
  type ChatMessage,
  type Dimension,
  type InterviewState,
  type PersonNote,
  type WeeklyResult,
} from './types'

const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

/** 每个区块第一次被打开时的开场语 */
const OPENERS: Record<Dimension, string> = {
  event: '周末好。我们花五分钟，把这一周过一遍就好。\n\n先从最实在的开始 —— ',
  people: '好，说说人。',
  thing: '再说说东西 —— ',
  mood: '换个角度。',
}

/** 演示用：一键填入的示例回答，让 Demo 可以快速走完 */
const SAMPLE_ANSWERS: Record<Dimension, string[]> = {
  event: [
    '在改客户那个方案，改了三版了还没定下来。',
    '本来想把季度数据整理一下，一直没腾出时间。',
    '其实主要是开会占了很多时间，真正干活的时间很少。',
    '客户那边一直没给反馈，只能干等着。',
  ],
  people: [
    '主要是跟老王对接方案，还有跟小李吃了顿饭。',
    '想约张总聊聊明年的方向，但一直没敢开口。',
    '老王那边一直没拍板，事情就卡在他那儿了。',
    '好久没联系老同学了，总觉得该问候一下。',
  ],
  thing: [
    '买了个新键盘，之前那个手感不行，纠结了半个月终于下单了。',
    '把旧手机挂二手平台卖掉了，比想象中顺利。',
    '冲动买了个显示器支架，装上一用发现其实用不上。',
    '没有，这周没顾上这些。',
  ],
  mood: [
    '挺累的，主要就是方案反复改这件事拖着，心里一直不踏实。',
    '还行，就是有点被会议切得太碎，很难进入状态。',
  ],
}

export function sampleAnswer(dim: Dimension, index: number): string {
  const pool = SAMPLE_ANSWERS[dim] ?? []
  if (pool.length === 0) return ''
  return pool[index % pool.length]
}

/** 把用户回答按区块归类，供结果生成使用 */
export function groupAnswers(history: ChatMessage[]): Record<Dimension, string[]> {
  const out: Record<Dimension, string[]> = { event: [], people: [], thing: [], mood: [] }
  for (const m of history) {
    if (m.role !== 'user') continue
    const t = m.text.trim()
    if (t) out[m.dimension].push(t)
  }
  return out
}

/** 「没有」「暂时没有」这类回答不是内容，不能当成一条记录 */
const NON_ANSWER_RE = /^(没有|没|无|暂无|暂时没|暂时没有|没什么|没啥|否|还好|都还好|没呢|没有呢|想不起来)/
export function isNonAnswer(text: string): boolean {
  return NON_ANSWER_RE.test(text.trim())
}

function firstSentence(text: string, max = 44): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  const cut = flat.split(/[。！？；\n]/)[0]?.trim() || flat
  return cut.length > max ? `${cut.slice(0, max)}…` : cut
}

function splitSentences(text: string): string[] {
  return text
    .split(/[。！？；\n]/)
    .map((s) => s.trim())
    .filter(Boolean)
}

/** 出现这些词，才认为一句话里可能在说某个人 */
const PERSON_CONTEXT = /跟|和|与|找|问|约|是|给|让|见|聊|联系|沟通|反馈|拍板|同意|回复|对接|汇报/

/**
 * 从一句话里猜人名，猜不出返回 null。
 * Demo 用的启发式；接真实模型后，人名由模型直接给出。
 */
export function personHint(text: string): string | null {
  const at = text.match(/@([\w\u4e00-\u9fa5]{1,12})/)
  if (at) return at[1]

  // 跟老王 / 和小李 —— 常见昵称
  const nick = text.match(/(?:跟|和|与|找|问|约|是|给|让|联系)([老小][\u4e00-\u9fa5])/)
  if (nick) return nick[1]

  // 张总 / 李老师 / 王经理 —— 取称谓前一个字作姓
  if (PERSON_CONTEXT.test(text)) {
    const suffix = text.match(/老师|经理|总监|主任|老板|总/)
    if (suffix && suffix.index !== undefined && suffix.index > 0) {
      const i = suffix.index
      return text.slice(i - 1, i) + suffix[0]
    }
  }

  return null
}

/** 猜不出人名时，退化为句子开头，保证界面上不留空 */
export function extractName(text: string): string {
  return personHint(text) ?? firstSentence(text, 6)
}

function unique(list: string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const item of list) {
    const t = item.trim()
    if (!t || seen.has(t)) continue
    seen.add(t)
    out.push(t)
  }
  return out
}

function dedupePeople(list: PersonNote[]): PersonNote[] {
  const seen = new Set<string>()
  const out: PersonNote[] = []
  for (const p of list) {
    const name = p.name.trim()
    if (!name || seen.has(name)) continue
    seen.add(name)
    out.push({ name, note: p.note.trim() })
  }
  return out
}

/** 把一串回答整理成结果里的一条条记录 */
function toItems(answers: string[], max: number, length = 46): string[] {
  return unique(
    answers.filter((t) => !isNonAnswer(t)).map((t) => firstSentence(t, length)),
  ).slice(0, max)
}

const PENDING_RE = /没|拖|卡|忘|还没|来不及|延期|一直|等着|干等|悬/
const WIN_RE = /顺利|搞定|完成|通过|终于|解决|拿下|谈成/
/** 补充内容里出现这些词，认为是在说「买了 / 处理了什么东西」 */
const THING_RE = /买|换|下单|到货|退货|卖|处理掉|扔掉|添置|入手|物件|东西/

function cloneResult(r: WeeklyResult): WeeklyResult {
  return {
    events: [...r.events],
    people: r.people.map((p) => ({ ...p })),
    things: [...r.things],
    pending: [...r.pending],
    highlights: [...r.highlights],
    nextFocus: [...r.nextFocus],
    nextFollowUps: [...r.nextFollowUps],
  }
}

/** 本周热点：从当前清单里挑出最值得记住的几条 */
function buildHighlights(result: WeeklyResult, byDim: Record<Dimension, string[]>): string[] {
  const pool = [...result.events, ...result.pending, ...byDim.mood]
  const highlights: string[] = []

  if (result.events[0]) highlights.push(`${result.events[0]} —— 这是这周精力主要落的地方`)
  const win = pool.find((t) => WIN_RE.test(t))
  if (win) highlights.push(`${firstSentence(win, 36)}，值得记一笔`)
  if (result.pending[0]) highlights.push(`${result.pending[0]} —— 还悬着，下周需要一个交代`)
  if (result.people[0]) highlights.push(`和 ${result.people[0].name} 之间的事没有完全推进`)
  if (result.things[0]) highlights.push(`${firstSentence(result.things[0], 32)} —— 这周和「东西」有关的一笔`)
  if (byDim.mood[0]) highlights.push(`整体状态：${firstSentence(byDim.mood[0], 32)}`)

  return unique(highlights).slice(0, 5)
}

/** 下周计划：基于当前清单给出的建议 */
function buildNextFocus(result: WeeklyResult): string[] {
  const blocker = result.pending[0]
  const focus: string[] = []
  focus.push(
    blocker
      ? `推动「${firstSentence(blocker, 22)}」有一个明确结果`
      : '把手上最占精力的一件事推进到有结论',
  )
  focus.push(
    result.people[0] ? `主动联系 ${result.people[0].name}，把话说开` : '把欠下的那次联系补上',
  )
  focus.push('给自己留一段不被打断的时间，处理一直往后拖的那件事')
  return unique(focus).slice(0, 3)
}

function buildFollowUps(result: WeeklyResult): string[] {
  const names: string[] = []
  if (result.people[0]) names.push(result.people[0].name)
  if (result.people[1]) names.push(result.people[1].name)
  return unique(names).slice(0, 2)
}

/** 从按区块分好的回答里，把人抽出来 */
function buildPeople(answers: string[], max = 3): PersonNote[] {
  const people: PersonNote[] = []
  for (const t of answers) {
    if (isNonAnswer(t)) continue
    const hinted = personHint(t)
    if (!hinted) continue
    people.push({ name: hinted, note: firstSentence(t, 40) })
    if (people.length >= max) break
  }
  return dedupePeople(people)
}

export interface MockAiOptions {
  /** 测试时关闭模拟延迟，避免拖慢用例 */
  instant?: boolean
}

/**
 * 演示用假 AI。
 * 输出基于用户真实回答拼装，因此看起来像「真的读懂了这一周」，
 * 但完全不联网、不需要 API Key。
 */
export function createMockAi(options: MockAiOptions = {}): AiClient {
  const wait = (ms: number): Promise<void> => (options.instant ? Promise.resolve() : delay(ms))

  return {
    async wantsFollowUp(userText: string, state: InterviewState, dim: Dimension) {
      await wait(320)
      const p = blockProgress(state, dim)
      if (p.followUpCount >= MAX_FOLLOWUPS_PER_QUESTION) return false
      const t = userText.trim()
      if (t.length === 0) return false
      // 「没有」这类回答没什么可追问的，直接换下一题
      if (isNonAnswer(t)) return false
      // 答得越短、或明显带着卡顿情绪，越值得再问一句
      if (t.length < 20) return true
      if (p.followUpCount < 1 && /卡|拖|没|难|烦|累|等/.test(t)) return true
      return false
    },

    async nextMessage(state: InterviewState, dim: Dimension, history: ChatMessage[]) {
      await wait(760)
      const p = blockProgress(state, dim)
      const blockHistory = history.filter((m) => m.dimension === dim)

      // 这一块已经聊完
      if (p.complete) {
        const remaining = nextIncompleteBlock(state)
        if (!remaining) return '四块都聊过了。可以生成你的本周梳理了。'
        return `「${dimensionLabel(dim)}」这块差不多了。接着聊聊「${dimensionLabel(remaining)}」，还是先挑别的？`
      }

      if (p.followUpCount > 0) return currentFollowUp(state, dim)

      const question = currentQuestion(state, dim)
      const isBlockFirst = blockHistory.filter((m) => m.role === 'ai').length === 0
      if (!isBlockFirst) return question
      return `${OPENERS[dim]}${question}`
    },

    async summarize(history: ChatMessage[]): Promise<WeeklyResult> {
      await wait(1500)
      const byDim = groupAnswers(history)
      const all = [...byDim.event, ...byDim.people, ...byDim.thing, ...byDim.mood]
      const result = createEmptyResult()

      if (all.filter((t) => !isNonAnswer(t)).length === 0) {
        result.events = ['（这次没有聊到具体的事情）']
        result.highlights = ['这一周还没有被梳理过']
        result.nextFocus = ['找个安静的时间，重新做一次梳理']
        return result
      }

      result.events = toItems(byDim.event, 4, 50)
      result.people = buildPeople(byDim.people)
      result.things = toItems(byDim.thing, 4)
      result.pending = toItems(
        all.filter((t) => PENDING_RE.test(t)),
        4,
        40,
      )

      result.highlights = buildHighlights(result, byDim)
      result.nextFocus = buildNextFocus(result)
      result.nextFollowUps = buildFollowUps(result)

      return result
    },

    async refine(
      history: ChatMessage[],
      current: WeeklyResult,
      note: string,
    ): Promise<WeeklyResult> {
      await wait(1300)
      const byDim = groupAnswers(history)
      // 以用户改过的版本为起点，尊重手工编辑
      const result = cloneResult(current)

      for (const part of splitSentences(note)) {
        if (isNonAnswer(part)) continue

        const person = personHint(part)
        if (person) {
          result.people.push({ name: person, note: firstSentence(part, 40) })
          continue
        }

        const item = firstSentence(part, 46)
        if (PENDING_RE.test(part)) {
          result.pending.push(item)
          continue
        }
        if (THING_RE.test(part)) {
          result.things.push(item)
          continue
        }
        result.events.push(item)
      }

      result.events = unique(result.events)
      result.pending = unique(result.pending)
      result.things = unique(result.things)
      result.people = dedupePeople(result.people)

      // 只重新生成「本周热点」和「下周计划」，清单内容保留用户的修改
      result.highlights = buildHighlights(result, byDim)
      result.nextFocus = buildNextFocus(result)
      result.nextFollowUps = buildFollowUps(result)

      return result
    },
  }
}
