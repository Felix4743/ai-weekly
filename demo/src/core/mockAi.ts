import type { AiClient, DeltaHandler } from './aiClient'
import {
  blockProgress,
  currentFollowUp,
  currentQuestion,
  nextStage,
  nextStep,
} from './interview'
import { SCRIPT, dimensionLabel, followUpCap } from './script'
import {
  createEmptyResult,
  type ChatMessage,
  type Dimension,
  type InterviewContext,
  type InterviewState,
  type PersonNote,
  type TurnAction,
  type WeeklyResult,
  type WeeklyState,
} from './types'

const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

/** 每个区块第一次被打开时的开场语 */
const OPENERS: Record<Dimension, string> = {
  mood: '周末好。我们花几分钟，把这一周过一遍。\n\n先从状态开始 —— ',
  reconcile: '对一下上周说好的。',
  event: '好，说说这周都忙了什么。',
  people: '再说说人。',
  thing: '最后说说东西和钱 —— ',
}

/** 演示用：一键填入的示例回答，让 Demo 可以快速走完 */
const SAMPLE_ANSWERS: Record<Dimension, string[]> = {
  mood: [
    '睡得还行，运动基本没有，吃饭不太规律，中午经常随便对付。',
    '整体有点闷，最消耗情绪的是方案反复改这件事，一直悬着。',
    '上午状态最好，能连着干两小时；下午老被会议切开，很难进入状态。',
    '看了一本讲定价的书，学到一条：先算清成本再谈折扣，下周报价就能用上。',
  ],
  reconcile: ['上周说好的报价发出去了，只发了初稿；要跟进的张总一直没约上。'],
  event: [
    '在改客户那个方案，改了三版了还没定下来。',
    '本来想把季度数据整理一下，一直没腾出时间。',
    '最关键的一个判断是先不接第二个客户，怕两头都做不细；现在看还是对的。',
    '临时被拉进一个救火项目，占了整整两天。',
    '第一次自己动手剪了条短视频，虽然粗糙但挺有意思。',
    '该做的对账一直没做，因为怕看到数字。',
  ],
  people: [
    '主要是跟老王对接方案，还有跟小李吃了顿饭。',
    '想约张总聊聊明年的方向，但一直没敢开口。',
    '跟供应商那次沟通本可以更好，我当时话说得太急，下次先说我要什么再谈价。',
    '有一次我越界了，替同事回了客户消息，后来专门去道了个歉。',
  ],
  thing: [
    '买了个新键盘，之前那个手感不行，纠结了半个月终于下单了。',
    '冲动买了个显示器支架，装上一用发现其实用不上。',
    '该续费的云盘和该备份的照片一直拖着没弄。',
    '这周花了大概两千多，主要是吃饭和交通。',
  ],
}

export function sampleAnswer(dim: Dimension, index: number): string {
  const pool = SAMPLE_ANSWERS[dim] ?? []
  if (pool.length === 0) return ''
  return pool[index % pool.length]
}

/** 把用户回答按区块归类，供结果生成使用 */
export function groupAnswers(history: ChatMessage[]): Record<Dimension, string[]> {
  // 直接照 SCRIPT 建表：以后再加区块，不用回来补这里
  const out = {} as Record<Dimension, string[]>
  for (const d of SCRIPT) out[d.key] = []
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
    state: { ...r.state, scores: r.state.scores ? { ...r.state.scores } : undefined },
  }
}

/**
 * 状态四项：状态块的回答按顺序落进 身体 / 情绪 / 精力 / 心智。
 * 只写文字 —— 分数是用户点出来的，不在模型的活儿里（见 stateScore.ts）。
 */
function buildState(answers: string[]): WeeklyState {
  const clean = answers.filter((t) => !isNonAnswer(t))
  const pick = (i: number) => (clean[i] ? firstSentence(clean[i], 40) : '')
  return { body: pick(0), mood: pick(1), focus: pick(2), growth: pick(3) }
}

/** 本周主线：从当前清单里挑出最值得记住的几条 */
function buildHighlights(result: WeeklyResult, byDim: Record<Dimension, string[]>): string[] {
  const pool = [...result.events, ...result.pending, ...byDim.mood]
  const highlights: string[] = []

  if (result.events[0]) highlights.push(`${result.events[0]} —— 这是这周精力主要落的地方`)
  const win = pool.find((t) => WIN_RE.test(t))
  if (win) highlights.push(`${firstSentence(win, 36)}，值得记一笔`)
  if (result.pending[0]) highlights.push(`${result.pending[0]} —— 还没办完，下周需要一个交代`)
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
 * 判断要不要追问。
 * 抽成同步纯函数：既给假 AI 用，也让这块判断逻辑可以脱离客户端的异步包装直接测。
 * 真实模型下这个决定由模型自己给（见 turn.ts 的行首标记）。
 * 上限跟着档位走：快速 1 次、中度 2 次、深度 5 次。
 */
export function shouldFollowUp(
  userText: string,
  state: InterviewState,
  dim: Dimension,
): boolean {
  const p = blockProgress(state, dim)
  if (p.followUpCount >= followUpCap(state.depth)) return false
  const t = userText.trim()
  if (t.length === 0) return false
  // 「没有」这类回答没什么可追问的，直接换下一题
  if (isNonAnswer(t)) return false
  // 答得越短、或明显带着卡顿情绪，越值得再问一句
  if (t.length < 20) return true
  if (p.followUpCount < 1 && /卡|拖|没|难|烦|累|等/.test(t)) return true
  return false
}

/** 自由聊里他说「说完了」就收尾换块 */
const DONE_RE = /说完了|没了|聊完了|先这样|够了|差不多了|就到这/

/**
 * 假 AI 的行首动作判定，对应真实模型给 `[追问]/[换题]/[换块]`。
 * 演示里大部分时候靠 `next` 自然走完参考题目，只有自由聊才给 `block`。
 */
export function decideAction(
  userText: string,
  state: InterviewState,
  dim: Dimension,
): TurnAction {
  const p = blockProgress(state, dim)
  if (p.complete) return DONE_RE.test(userText.trim()) ? 'block' : 'followup'
  return shouldFollowUp(userText, state, dim) ? 'followup' : 'next'
}

/**
 * 演示用假 AI。
 * 输出基于用户真实回答拼装，因此看起来像「真的读懂了这一周」，
 * 但完全不联网、不需要 API Key。
 */
export function createMockAi(options: MockAiOptions = {}): AiClient {
  const wait = (ms: number): Promise<void> => (options.instant ? Promise.resolve() : delay(ms))

  /** 假 AI 也走流式，这样不填 API Key 也能看到逐字出现的界面 */
  const streamOut = async (text: string, onDelta?: DeltaHandler): Promise<string> => {
    if (!onDelta || !text) return text
    const size = options.instant ? text.length : 3
    for (let i = 0; i < text.length; i += size) {
      onDelta(text.slice(i, i + size))
      if (!options.instant) await delay(24)
    }
    return text
  }

  /**
   * 一块聊完之后的过渡话：该定档了 / 该换下一块了 / 全聊完了。
   * 分成一个函数是因为「自由聊」和「收尾」两条路都要用它 —— 少一处就少一句自相矛盾的话。
   */
  const transitionMessage = (state: InterviewState, dim: Dimension): string => {
    const stage = nextStage(state)
    if (stage.kind === 'done') return '四块都聊过了。可以生成你的本周梳理了。'
    if (stage.kind === 'depth') {
      return '状态这块聊得差不多了。接下来你想聊到多细 —— 深度复盘（20 分钟）、中度复盘（12 分钟），还是快速复盘（5 分钟）？'
    }
    return `「${dimensionLabel(dim)}」这块差不多了。接着聊聊「${dimensionLabel(stage.dim)}」，还是先挑别的？`
  }

  const nextMessage = async (
    state: InterviewState,
    dim: Dimension,
    history: ChatMessage[],
    onDelta?: DeltaHandler,
    _ctx?: InterviewContext,
  ): Promise<string> => {
    await wait(760)
    const p = blockProgress(state, dim)
    const blockHistory = history.filter((m) => m.dimension === dim)

    // 这一块的主问题已经问完
    if (p.complete) {
      // 自由聊：他还想接着说，就别再催他换块，顺着往下搭一句
      if (p.freeTurns > 0) return streamOut('嗯，还有呢？想到什么说什么。', onDelta)
      return streamOut(transitionMessage(state, dim), onDelta)
    }

    if (p.followUpCount > 0) return streamOut(currentFollowUp(state, dim), onDelta)

    const question = currentQuestion(state, dim)
    const isBlockFirst = blockHistory.filter((m) => m.role === 'ai').length === 0
    if (!isBlockFirst) return streamOut(question, onDelta)
    return streamOut(`${OPENERS[dim]}${question}`, onDelta)
  }

  return {
    nextMessage,

    async reply(
      state: InterviewState,
      dim: Dimension,
      history: ChatMessage[],
      onDelta?: DeltaHandler,
    ) {
      await wait(320)
      const answers = history.filter((m) => m.role === 'user' && m.dimension === dim)
      const last = answers.length > 0 ? answers[answers.length - 1].text : ''
      const action = decideAction(last, state, dim)
      const advanced = nextStep(state, dim, action)
      // 这一块早就聊完、他又说「说完了」：那是想收尾，不是还想接着说。
      // 界面按同一个 action 去开下一块，这里就只给一句过渡，别再回「还有呢」。
      if (blockProgress(state, dim).complete && action === 'block') {
        await wait(760)
        return { action, message: await streamOut(transitionMessage(advanced, dim), onDelta) }
      }
      const message = await nextMessage(advanced, dim, history, onDelta)
      return { action, message }
    },

    async summarize(history: ChatMessage[], _ctx?: InterviewContext): Promise<WeeklyResult> {
      await wait(1500)
      const byDim = groupAnswers(history)
      const all = [
        ...byDim.event,
        ...byDim.people,
        ...byDim.thing,
        ...byDim.mood,
        ...byDim.reconcile,
      ]
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
      // 上周说好的、这周没落地的，写进「未办」并标明来处
      const fromLastWeek = byDim.reconcile
        .filter((t) => !isNonAnswer(t) && PENDING_RE.test(t))
        .map((t) => `上周说好的：${firstSentence(t, 36)}`)
      result.pending = unique([
        ...fromLastWeek,
        ...toItems(
          all.filter((t) => PENDING_RE.test(t)),
          4,
          40,
        ),
      ]).slice(0, 4)

      result.state = buildState(byDim.mood)
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
