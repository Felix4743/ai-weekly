import type { AiClient, ReviewOutcome, ReviewRequest } from './aiClient'
import { createEmptyReview, type Issue, type Plan, type Reconcile, type Review } from './review'

/**
 * 没填 API Key 时用的假分析器。
 *
 * 它要让人**看得懂流程**：写一段原文 → 出来五段结果 → 下周再写一段会看到
 * 上周那几条被逐条对账。所以规则是死的、可预期的，不追求像真模型。
 *
 * 刻意不做的事：不假装懂没写的东西（原文里没提到的人、钱、心情，
 * 一律进补漏提醒，而不是编出来）。
 */

const PLAN_HINT = /^(下周|下个|明天|后天|接下来|以后|打算|计划|准备|争取|想着)/
const DONE_HINT = /(做完|完成|搞定|已经|交了|发了|谈好|结束)/

const KEYWORDS: { key: string; words: string[] }[] = [
  { key: '拖延', words: ['拖延', '拖了', '拖着', '一直没'] },
  { key: '睡眠', words: ['失眠', '熬夜', '睡不', '睡得太', '困'] },
  { key: '时间', words: ['来不及', '没时间', '太赶', '忙不过'] },
  { key: '进度', words: ['进度', '延期', '没做完', '做不完'] },
  { key: '沟通', words: ['沟通', '没回', '误会', '吵', '不敢说'] },
  { key: '钱', words: ['花超', '开销', '预算', '超支', '花了太多'] },
]

const ISSUE_HINT =
  /(问题|卡住|卡在|卡了|拖延|拖了|拖着|没做完|做不完|来不及|没时间|难|搞不定|不会|焦虑|烦躁|烦|崩|失眠|熬夜|超支|花超|吵|误会|不敢)/

const ADVICE: { match: RegExp; advice: string[] }[] = [
  {
    match: /(拖延|拖了|拖着|一直没)/,
    advice: ['把它拆成两步，明天先做最小的一步', '给它定个具体的时间，写进下周计划'],
  },
  {
    match: /(失眠|熬夜|睡|困|累)/,
    advice: ['先把睡觉的时间固定下来，别的先不动', '这周留一段什么都不干的时间'],
  },
  {
    match: /(来不及|没时间|太赶|忙不过)/,
    advice: ['下周一开始只排一件必须做完的事', '把「可以不做」的挑出来，明说出来'],
  },
  {
    match: /(钱|开销|预算|超支|花超)/,
    advice: ['先把开销记下来，只记不改，一周后再看', '给这一类花销定一个上限'],
  },
  {
    match: /(沟通|没回|误会|吵|不敢说)/,
    advice: ['把想说的话先写下来，再决定要不要发', '主动问一句，别猜对方什么意思'],
  },
]

const ANGLE_WORDS: Record<string, string[]> = {
  people: ['和', '跟', '见', '聊', '朋友', '同事', '客户', '家里', '聚会'],
  body: ['累', '睡', '困', '身体', '感冒', '头疼', '运动', '跑', '吃'],
  mood: ['高兴', '难受', '开心', '崩', '烦', '放松', '爽', '闷'],
  life: ['看', '玩', '剧', '电影', '游戏', '书', '旅', '出去'],
  money: ['钱', '花', '买', '开销', '预算', '工资'],
  learn: ['想明白', '学到', '意识到', '发现', '明白', '想通'],
}

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms))
}

/** 按换行和句读切成短句，去掉空白与重复 */
function toLines(notes: string): string[] {
  const parts = notes
    .split(/[\n。！？；;]+/)
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
  return parts.filter((line, i) => parts.indexOf(line) === i)
}

function short(text: string, max = 60): string {
  return text.length <= max ? text : `${text.slice(0, max)}…`
}

function keywordsOf(text: string): string[] {
  return KEYWORDS.filter((item) => item.words.some((word) => text.includes(word))).map(
    (item) => item.key,
  )
}

function adviceFor(text: string): string[] {
  return ADVICE.find((item) => item.match.test(text))?.advice ?? [
    '下周先盯这一件事，别同时改三样',
    '写下「下次遇到同样的情况我怎么办」，一句话就行',
  ]
}

/** 两段文字有没有「说同一件事」：看有没有两字以上的重合片段 */
function overlaps(a: string, b: string): boolean {
  const clean = (text: string) => text.replace(/[^\u4e00-\u9fa5A-Za-z0-9]/g, '')
  const left = clean(a)
  const right = clean(b)
  if (!left || !right) return false
  for (let i = 0; i + 2 <= left.length; i += 1) {
    if (right.includes(left.slice(i, i + 2))) return true
  }
  return false
}

function buildReconcile(req: ReviewRequest, lines: string[]): Reconcile[] {
  const plan = req.previous?.plan ?? []
  return plan.map((item) => {
    const hit = lines.find((line) => overlaps(line, item.text)) ?? ''
    if (hit && DONE_HINT.test(hit)) {
      return { text: item.text, state: 'done' as const, note: '这周写到了' }
    }
    if (hit) return { text: item.text, state: 'partial' as const, note: short(hit, 20) }
    return { text: item.text, state: 'unmentioned' as const, note: '' }
  })
}

function buildNudge(lines: string[]): string {
  const text = lines.join(' ')
  const missing = Object.keys(ANGLE_WORDS).filter(
    (key) => !ANGLE_WORDS[key].some((word) => text.includes(word)),
  )
  // 「工作以外」几乎总能沾上（看、吃、买都算），排最后兜底，别抢在人和心情前面
  const ordered = missing.filter((key) => key !== 'life')
  const key = ordered[0] ?? missing[0] ?? ''
  return key ? keyOfAngle(key) : ''
}

function keyOfAngle(key: string): string {
  const table: Record<string, string> = {
    people: '这周好像没提过见谁、跟谁聊过 —— 有没有人的事值得记一笔？',
    body: '没写到状态：这周精力和身体怎么样？',
    mood: '没写到心情：这周最高兴和最难受的各是什么？',
    life: '工作以外呢？看了什么、玩了什么，也算这一周。',
    money: '一个字都没提钱 —— 这周有花得值或者后悔的吗？',
    learn: '有没有哪件事让你想明白了点什么？',
  }
  return table[key] ?? ''
}

/** 把原文分类成 did / issues / plan，并组装一份完整的复盘 */
function analyzeNotes(req: ReviewRequest): Review {
  const lines = toLines(req.notes)
  if (lines.length === 0) {
    const empty = createEmptyReview()
    return {
      ...empty,
      headline: '这一周还没写出什么。',
      nudge: '先随手写两句这一周发生了什么，再来复盘。',
    }
  }

  const did: string[] = []
  const issues: Issue[] = []
  const plan: Plan[] = []

  for (const line of lines) {
    if (PLAN_HINT.test(line)) {
      const when = /下周/.test(line) ? '下周' : /明天|后天/.test(line) ? '这两天' : ''
      plan.push({ text: short(line), when })
      continue
    }
    if (ISSUE_HINT.test(line)) {
      const [key = ''] = keywordsOf(line)
      issues.push({ text: short(line), advice: adviceFor(line), key })
      continue
    }
    did.push(short(line))
  }

  const first = did[0] ?? ''
  const headline = first
    ? did.length > 1
      ? `这周主要是 ${short(first, 24)}，另外还有 ${did.length - 1} 件事。`
      : `这周主要是 ${short(first, 24)}。`
    : '这一周没写出什么具体做的事。'

  const review: Review = {
    headline,
    did,
    issues,
    reconcile: buildReconcile(req, lines),
    plan,
    nudge: '',
  }

  // 同一件事上周也出现过 —— 这条比「你还没写什么」更值得说，所以优先
  const previousIssues = (req.previous?.issues ?? []).map((item) => item.text)
  const repeated = previousIssues.find((text) => overlaps(joinText(issues), text))
  review.nudge = repeated
    ? `「${short(repeated, 16)}」上周也在，这周又碰上了。`
    : buildNudge(lines)

  return review
}

function joinText(issues: Issue[]): string {
  return issues.map((issue) => issue.text).join(' ')
}

export function createMockAi(options: { instant?: boolean } = {}): AiClient {
  const { instant = false } = options

  return {
    async analyze(req: ReviewRequest): Promise<ReviewOutcome> {
      if (!instant) await sleep(900)
      const review = analyzeNotes(req)
      const reply = req.isFollowUp
        ? '好，把这段并进去了 —— 上面就是加上你说的之后的样子。'
        : ''
      return { review, reply }
    },
  }
}
