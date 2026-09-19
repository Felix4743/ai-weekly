import type { AiClient } from './aiClient'
import { currentDimension, currentFollowUp, currentQuestion, startsNewBlock } from './interview'
import { MAX_FOLLOWUPS_PER_QUESTION } from './script'
import {
  createEmptyResult,
  type ChatMessage,
  type Dimension,
  type InterviewState,
  type PersonNote,
  type WeeklyResult,
} from './types'

const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

/** 进入新区块时的过渡语，让对话有节奏感 */
const LEADS: Record<Dimension, string> = {
  event: '那我们接着往下。',
  people: '事情先放一放，再聊聊人。',
  mood: '换个角度 —— ',
  closing: '最后 —— ',
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
  mood: [
    '挺累的，主要就是方案反复改这件事拖着，心里一直不踏实。',
    '还行，就是有点被会议切得太碎，很难进入状态。',
  ],
  closing: ['暂时没有了，差不多就这些。', '想到一个：想抽空把桌面和电脑文件清理一下。'],
}

export function sampleAnswer(dim: Dimension, index: number): string {
  const pool = SAMPLE_ANSWERS[dim] ?? []
  if (pool.length === 0) return ''
  return pool[index % pool.length]
}

/** 把用户回答按区块归类，供结果生成使用 */
export function groupAnswers(history: ChatMessage[]): Record<Dimension, string[]> {
  const out: Record<Dimension, string[]> = { event: [], people: [], mood: [], closing: [] }
  for (const m of history) {
    if (m.role !== 'user') continue
    const t = m.text.trim()
    if (t) out[m.dimension].push(t)
  }
  return out
}

function firstSentence(text: string, max = 44): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  const cut = flat.split(/[。！？；\n]/)[0]?.trim() || flat
  return cut.length > max ? `${cut.slice(0, max)}…` : cut
}

/** 从一句话里猜出人名。Demo 用的启发式，接真实模型后由模型直接给出。 */
export function extractName(text: string): string {
  const at = text.match(/@([\w\u4e00-\u9fa5]{1,12})/)
  if (at) return at[1]

  // 张总 / 李老师 / 王经理 —— 取称谓前一个字作姓
  const suffix = text.match(/总|老师|经理|总监|主任|老板/)
  if (suffix && suffix.index !== undefined && suffix.index > 0) {
    const i = suffix.index
    return text.slice(i - 1, i) + suffix[0]
  }

  // 跟老王 / 和小李 —— 常见昵称
  const nick = text.match(/(?:跟|和|与|找|问|约|是|给|让|联系)([老小][\u4e00-\u9fa5])/)
  if (nick) return nick[1]

  const plain = text.match(
    /([\u4e00-\u9fa5]{2,3})(?=(?:那边|那儿|一直|还没|说|让|要|没|不|已经|同意|拍板|给|反馈))/,
  )
  if (plain) return plain[1]

  return firstSentence(text, 6)
}

function unique(list: string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const item of list) {
    if (!item || seen.has(item)) continue
    seen.add(item)
    out.push(item)
  }
  return out
}

const PENDING_RE = /没|拖|卡|忘|还没|来不及|延期|一直|等着|干等|悬/

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
    async opening() {
      await wait(700)
      return '周末好。我们花五分钟，把这一周过一遍就好。\n\n先从最实在的开始 —— 这周主要忙了些什么？'
    },

    async wantsFollowUp(userText: string, state: InterviewState) {
      await wait(320)
      if (state.followUpCount >= MAX_FOLLOWUPS_PER_QUESTION) return false
      const t = userText.trim()
      if (t.length === 0) return false
      // 答得越短、或明显带着卡顿情绪，越值得再问一句
      if (t.length < 20) return true
      if (state.followUpCount < 1 && /卡|拖|没|难|烦|累|等/.test(t)) return true
      return false
    },

    async nextMessage(state: InterviewState, history: ChatMessage[]) {
      await wait(760)
      const dim = currentDimension(state)

      if (state.followUpCount > 0) {
        return currentFollowUp(state)
      }

      const question = currentQuestion(state)
      const entering = startsNewBlock(state)
      const isAbsoluteFirst = history.filter((m) => m.role === 'ai').length === 0

      if (isAbsoluteFirst || !entering) return question
      return `${LEADS[dim]}${question}`
    },

    async summarize(history: ChatMessage[]): Promise<WeeklyResult> {
      await wait(1500)
      const result = createEmptyResult()
      const byDim = groupAnswers(history)
      const all = [...byDim.event, ...byDim.people, ...byDim.mood, ...byDim.closing]

      if (all.length === 0) {
        result.events = ['（这次没有聊到具体的事情）']
        result.highlights = ['这一周还没有被梳理过']
        result.nextFocus = ['找个安静的时间，重新做一次梳理']
        return result
      }

      // 事情
      result.events = unique(byDim.event.map((t) => firstSentence(t, 50))).slice(0, 4)
      if (result.events.length === 0) {
        result.events = unique(byDim.closing.map((t) => firstSentence(t, 50))).slice(0, 2)
      }

      // 人际
      const people: PersonNote[] = []
      for (const t of byDim.people) {
        people.push({ name: extractName(t), note: firstSentence(t, 40) })
        if (people.length >= 3) break
      }
      result.people = people.filter((p, i) => people.findIndex((q) => q.name === p.name) === i)

      // 悬而未决
      result.pending = unique(all.filter((t) => PENDING_RE.test(t)).map((t) => firstSentence(t, 40))).slice(
        0,
        4,
      )

      // 本周热点：从真实回答里挑出最值得记住的几条
      const highlights: string[] = []
      if (result.events[0]) highlights.push(`${result.events[0]} —— 这是这周精力主要落的地方`)
      const win = all.find((t) => /顺利|搞定|完成|通过|终于|解决|拿下|谈成/.test(t))
      if (win) highlights.push(`${firstSentence(win, 36)}，值得记一笔`)
      if (result.pending[0]) highlights.push(`${result.pending[0]} —— 还悬着，下周需要一个交代`)
      if (result.people[0]) highlights.push(`和 ${result.people[0].name} 之间的事没有完全推进`)
      if (byDim.mood[0]) highlights.push(`整体状态：${firstSentence(byDim.mood[0], 32)}`)
      result.highlights = unique(highlights).slice(0, 5)

      // 下周计划
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
      result.nextFocus = unique(focus).slice(0, 3)

      const followUps: string[] = []
      if (result.people[0]) followUps.push(result.people[0].name)
      if (result.people[1]) followUps.push(result.people[1].name)
      result.nextFollowUps = unique(followUps).slice(0, 2)

      return result
    },
  }
}
