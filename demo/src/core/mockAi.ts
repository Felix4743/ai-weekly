import type { AiClient, DeltaHandler } from './aiClient'
import {
  blockProgress,
  currentPoint,
  nextStage,
  nextStep,
  pointsFor,
  uncoveredPoints,
} from './interview'
import { SCRIPT, dimensionLabel, followUpCap, spoken } from './script'
import {
  createEmptyResult,
  type ChatMessage,
  type Dimension,
  type InterviewContext,
  type InterviewState,
  type PersonNote,
  type TurnAction,
  type WeeklyResult,
} from './types'

const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

/** 整场采访的第一句话；状态卡是用户在界面上点的，所以开场在状态之后 */
const GREETING = '周末好。我们花几分钟，把这一周过一遍。\n\n'

/** 每个区块第一次被打开时的开场语 */
const OPENERS: Record<Dimension, string> = {
  probe: '先从你打的分说起。',
  reconcile: '对一下上周说好的。',
  event: '好，说说这周都忙了什么。',
  people: '再说说人。',
  thing: '再说说东西和钱 —— ',
  growth: '最后聊聊这周长了点什么 —— ',
}

/** 演示用：一键填入的示例回答，让 Demo 可以快速走完 */
const SAMPLE_ANSWERS: Record<Dimension, string[]> = {
  probe: [
    '睡得太晚了，基本都刷手机刷到一点多；躺下也不容易睡着。',
    '想运动，但每天回到家都快九点，实在挤不出来。',
    '吃得比较凑合，中午基本都是外卖随便对付两口。',
    '心情不太好，主要是方案一直卡着不动，心里悬着。',
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
  growth: [
    '看了一本讲定价的书，学到先算清成本再谈折扣，下周报价就能用上。',
    '跟小李那顿饭聊出点东西：他原来也是先做小样再谈大单，我打算下个客户就这么试。',
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
    growth: [...r.growth],
    highlights: [...r.highlights],
    nextFocus: [...r.nextFocus],
    nextFollowUps: [...r.nextFollowUps],
    state: { ...r.state, scores: r.state.scores ? { ...r.state.scores } : undefined },
  }
}

/** 本周主线：从当前清单里挑出最值得记住的几条 */
function buildHighlights(result: WeeklyResult, byDim: Record<Dimension, string[]>): string[] {
  const pool = [...result.events, ...result.pending, ...byDim.growth]
  const highlights: string[] = []

  if (result.events[0]) highlights.push(`${result.events[0]} —— 这是这周精力主要落的地方`)
  const win = pool.find((t) => WIN_RE.test(t))
  if (win) highlights.push(`${firstSentence(win, 36)}，值得记一笔`)
  if (result.pending[0]) highlights.push(`${result.pending[0]} —— 还没办完，下周需要一个交代`)
  if (result.people[0]) highlights.push(`和 ${result.people[0].name} 之间的事没有完全推进`)
  if (result.things[0]) highlights.push(`${firstSentence(result.things[0], 32)} —— 这周和「东西」有关的一笔`)

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

/**
 * 状态追问聊出来的小结（0.9.4）。
 *
 * 假 AI 写不出真模型的归纳，就照实做一件事：把他在「状态追问」那一步说的话
 * 收成短句拼起来。没聊到低分项时返回空对象 —— 不写这个键，跟真模型那边一致。
 */
function buildFollowUp(probeAnswers: string[]): { followUp?: string } {
  const items = probeAnswers.filter((t) => !isNonAnswer(t)).map((t) => firstSentence(t, 40))
  if (items.length === 0) return {}
  return { followUp: unique(items).slice(0, 3).join('；') }
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
 *
 * 0.9.5 起没有了「主问题清单」，所以这里也换了判据：说「说完了」直接收尾；
 * 要点只剩一个没聊到、又没什么好追的，也收尾（演示模式会把整块要点都报成聊到了）。
 */
export function decideAction(
  userText: string,
  state: InterviewState,
  dim: Dimension,
): TurnAction {
  const p = blockProgress(state, dim)
  if (p.complete) return DONE_RE.test(userText.trim()) ? 'block' : 'followup'
  if (DONE_RE.test(userText.trim())) return 'block'
  if (shouldFollowUp(userText, state, dim)) return 'followup'
  return uncoveredPoints(state, dim).length <= 1 ? 'block' : 'next'
}

/**
 * 演示模式报上来的覆盖序号（对应真模型写在那行 `[换块] 覆盖:1,3` 里的东西）。
 *
 * 换方向时报「当前聊到的那个要点」，收尾时把这一块全报上 —— 这样假 AI 也会
 * 走一遍「收尾对账」那条路，而不是把覆盖当成真模型才有的事。
 */
export function coveredNumbers(
  state: InterviewState,
  dim: Dimension,
  action: TurnAction,
): number[] {
  const points = pointsFor(state, dim)
  if (points.length === 0) return []
  if (action === 'block') return points.map((_, i) => i + 1)
  if (action !== 'next') return []
  const covered = new Set(blockProgress(state, dim).covered ?? [])
  const idx = points.findIndex((p) => !covered.has(p.id))
  return idx >= 0 ? [idx + 1] : []
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
      return '想聊到多细 —— 深度复盘（20 分钟）、中度复盘（12 分钟），还是快速复盘（5 分钟）？'
    }
    if (stage.kind === 'state') {
      return '先在卡片上给这周打个分吧：心情、睡眠、运动、饮食，各点几颗星，然后我们再往下聊。'
    }
    return `「${dimensionLabel(dim)}」这块差不多了。接着聊聊「${dimensionLabel(stage.dim)}」，还是先挑别的？`
  }

  const nextMessage = async (
    state: InterviewState,
    dim: Dimension,
    history: ChatMessage[],
    onDelta?: DeltaHandler,
    ctx?: InterviewContext,
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

    if (p.followUpCount > 0) {
      // 演示模式的追问就一句搭话 —— 真模型那边这一句是它自己组织的
      return streamOut('嗯，这一点再多说点？', onDelta)
    }

    const question = spoken(currentPoint(state, dim))
    const isBlockFirst = blockHistory.filter((m) => m.role === 'ai').length === 0
    if (!isBlockFirst) return streamOut(question, onDelta)

    // 整场第一句：先打个招呼；这一周已经聊过一次的话，把手边的记录复述一句
    if (history.length === 0) {
      const recap = ctx?.thisWeek?.lines?.length
        ? `这周你已经聊过一次，记了这些：${ctx.thisWeek.lines[0]}。今天补点什么？\n\n`
        : ''
      return streamOut(`${GREETING}${recap}${OPENERS[dim]}${question}`, onDelta)
    }
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
      const covered = coveredNumbers(state, dim, action)
      const advanced = nextStep(state, dim, action, { covered })
      // 这一块早就聊完、他又说「说完了」：那是想收尾，不是还想接着说。
      // 界面按同一个 action 去开下一块，这里就只给一句过渡，别再回「还有呢」。
      if (blockProgress(state, dim).complete && action === 'block') {
        await wait(760)
        return {
          action,
          message: await streamOut(transitionMessage(advanced, dim), onDelta),
          covered,
        }
      }
      const message = await nextMessage(advanced, dim, history, onDelta)
      return { action, message, covered }
    },

    async summarize(history: ChatMessage[], _ctx?: InterviewContext): Promise<WeeklyResult> {
      await wait(1500)
      const byDim = groupAnswers(history)
      const all = [
        ...byDim.event,
        ...byDim.people,
        ...byDim.thing,
        ...byDim.growth,
        ...byDim.reconcile,
      ]
      const result = createEmptyResult()
      // 低分项聊出来的小结（0.9.4）：先算出来 —— 它是状态那一段的内容，
      // 不该因为「四个内容块一条都没聊到」而跟着一起丢掉（下面有个提前 return）
      const followUp = buildFollowUp(byDim.probe)
      result.state = { ...result.state, ...followUp }

      if (all.filter((t) => !isNonAnswer(t)).length === 0) {
        result.events = ['（这次没有聊到具体的事情）']
        result.highlights = ['这一周还没有被梳理过']
        result.nextFocus = ['找个安静的时间，重新做一次梳理']
        return result
      }

      result.events = toItems(byDim.event, 4, 50)
      result.people = buildPeople(byDim.people)
      result.things = toItems(byDim.thing, 4)
      result.growth = toItems(byDim.growth, 3, 50)
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

      result.highlights = buildHighlights(result, byDim)
      result.nextFocus = buildNextFocus(result)
      result.nextFollowUps = buildFollowUps(result)
      // 低分项聊出来的小结（0.9.4）：假 AI 也得写上，否则演示模式下这一段永远看不到，
      // 等于这条功能只在接了真模型时才存在
      result.state = { ...result.state, ...buildFollowUp(byDim.probe) }

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
