import type { ChatMessagePayload } from './chatTransport'
import { blockProgress, currentQuestion, nextStep } from './interview'
import { buildInterviewerSystem } from './persona'
import { MAX_FOLLOWUPS_PER_QUESTION, SCRIPT, dimensionScript } from './script'
import type { ChatMessage, Dimension, InterviewState, WeeklyResult } from './types'

/**
 * 提示词构建。全部是纯函数，因此「模型到底被告知了什么」这件事是可测试的 ——
 * 状态机保证覆盖，模型只负责措辞，这个分工必须体现在提示词里，
 * 一旦提示词漏掉进度信息，模型就会自己乱问。
 */

/** 四个区块的名称，按脚本顺序 */
export function dimensionLabels(): string[] {
  return SCRIPT.map((d) => d.label)
}

/**
 * 把对话记录整理成模型好读的样子。
 * 传 dim 就只取那一个区块的，避免模型串台去聊别的块。
 */
export function formatTranscript(history: ChatMessage[], dim?: Dimension): string {
  const list = dim ? history.filter((m) => m.dimension === dim) : history
  if (list.length === 0) return '（暂时还没有对话）'

  const byDim = new Map<Dimension, ChatMessage[]>()
  for (const m of list) {
    const bucket = byDim.get(m.dimension)
    if (bucket) bucket.push(m)
    else byDim.set(m.dimension, [m])
  }

  const sections: string[] = []
  for (const d of SCRIPT) {
    const bucket = byDim.get(d.key)
    if (!bucket || bucket.length === 0) continue
    const lines = bucket.map((m) => `${m.role === 'ai' ? '采访者' : '对方'}：${m.text.trim()}`)
    sections.push(`【${d.label}】\n${lines.join('\n')}`)
  }
  return sections.length > 0 ? sections.join('\n\n') : '（暂时还没有对话）'
}

/** 四个区块各自的进度，让模型知道还有哪些没聊 */
export function formatProgress(state: InterviewState): string {
  const parts = SCRIPT.map((d) => {
    const p = blockProgress(state, d.key)
    if (p.complete) return `${d.label}（已聊完）`
    const total = d.mainQuestions.length
    return `${d.label}（问到第 ${Math.min(p.askIndex + 1, total)}/${total} 题）`
  })
  return parts.join('，')
}

/** 该区块第一次被打开时，让模型给出开场和第一个主问题 */
export function buildOpeningPrompt(
  state: InterviewState,
  dim: Dimension,
  history: ChatMessage[],
  persona: string,
): ChatMessagePayload[] {
  const script = dimensionScript(dim)
  if (!script) return []

  const isVeryFirst = history.filter((m) => m.role === 'ai').length === 0
  const questionList = script.mainQuestions.map((q, i) => `${i + 1}. ${q}`).join('\n')

  const user = [
    `现在要开始聊「${script.label}」这一块。这一块关心的是：${script.hint}。`,
    '',
    `这一块的主问题依次是：`,
    questionList,
    '',
    `四个区块整体进度：${formatProgress(state)}`,
    '',
    isVeryFirst
      ? '这是整场采访的第一个问题。请先用半句话打个招呼，然后问出第 1 个主问题。'
      : `请直接问出第 1 个主问题。`,
    '',
    '要求：只问第 1 个主问题，不要列清单、不要小标题、不要复述区块名称。',
  ].join('\n')

  return [
    { role: 'system', content: buildInterviewerSystem(persona, { marker: false }) },
    { role: 'user', content: user },
  ]
}

/** 区块已经聊完时的收尾语 */
export function buildClosingPrompt(
  state: InterviewState,
  dim: Dimension,
  persona: string,
): ChatMessagePayload[] {
  const script = dimensionScript(dim)
  if (!script) return []

  const remaining = SCRIPT.filter((d) => !blockProgress(state, d.key).complete)
  const tail =
    remaining.length === 0
      ? '四块都聊过了，告诉他可以生成这周的梳理了。'
      : `还有这些块没聊：${remaining.map((d) => d.label).join('、')}。自然地提一下可以接着聊。`

  return [
    { role: 'system', content: buildInterviewerSystem(persona, { marker: false }) },
    {
      role: 'user',
      content: [
        `「${script.label}」这一块的问题已经问完了。`,
        tail,
        '',
        '要求：一句话，不超过 45 字，不要总结刚才聊过的内容，不要煽情。' +
          '注意别把话筒收走 —— 对方想继续说，随时可以接着说。',
      ].join('\n'),
    },
  ]
}

/** 用户答完一句之后的唯一一次调用：是否追问 + 下一句话 */
export function buildTurnPrompt(
  state: InterviewState,
  dim: Dimension,
  history: ChatMessage[],
  persona: string,
): ChatMessagePayload[] {
  const script = dimensionScript(dim)
  if (!script) return []

  const progress = blockProgress(state, dim)
  const system = buildInterviewerSystem(persona, { marker: true })
  const answers = history.filter((m) => m.role === 'user' && m.dimension === dim)
  const lastAnswer = answers.length > 0 ? answers[answers.length - 1].text.trim() : ''

  /**
   * 主问题已经问完，用户还在说 —— 自由聊。
   * 这里没有题目可以「换」，标记只剩两种含义：还想深挖 / 他说完了。
   */
  if (progress.complete) {
    return [
      { role: 'system', content: system },
      {
        role: 'user',
        content: [
          `当前区块：${script.label}（这一块的主问题已经问完了，现在是自由聊）`,
          '',
          '这一块的对话记录：',
          formatTranscript(history, dim),
          '',
          '刚刚对方的回答：',
          `「${lastAnswer}」`,
          '',
          '请判断该怎么接：',
          '- 如果他还想往下说：用 [追问]，顺着这句话问一个具体的问题，抓他话里的时间、结果、卡点或感受。',
          '- 如果他已经明确表示说完了：用 [换题]，给一句自然的收尾，不要总结，不要煽情。',
          '',
          '注意：这一块已经没有新的主问题了 —— 不要念题目，不要催他去聊别的块，也不要把他说过的总结一遍。',
        ].join('\n'),
      },
    ]
  }

  const question = currentQuestion(state, dim)
  const atFollowUpCap = progress.followUpCount >= MAX_FOLLOWUPS_PER_QUESTION

  // 若不追问，状态机会推进成什么样 —— 这决定了「换题」该说什么
  const advanced = nextStep(state, dim, false)
  const advancedProgress = blockProgress(advanced, dim)
  const blockWillFinish = advancedProgress.complete
  const nextQuestion = blockWillFinish ? '' : currentQuestion(advanced, dim)

  const remaining = SCRIPT.filter((d) => !blockProgress(state, d.key).complete)
  const otherBlocks = remaining.filter((d) => d.key !== dim)

  const advanceInstruction = blockWillFinish
    ? otherBlocks.length > 0
      ? `本区块的主问题已经问完。用一句自然的收尾，并提一下可以接着聊「${otherBlocks[0].label}」。`
      : '四块都聊过了。用一句自然的收尾，告诉他可以生成这周的梳理了。'
    : `自然地过渡到下一个主问题：「${nextQuestion}」。可以顺着刚才的话带过去，不要生硬地念题目。`

  const user = [
    `当前区块：${script.label}（关心的是：${script.hint}）`,
    '',
    '这一块的对话记录：',
    formatTranscript(history, dim),
    '',
    '本区块进度：',
    `- 当前主问题：「${question}」`,
    `- 本题已追问 ${progress.followUpCount} 次，上限 ${MAX_FOLLOWUPS_PER_QUESTION} 次${atFollowUpCap ? '（已达上限，必须换题）' : ''}`,
    `- 四个区块整体进度：${formatProgress(state)}`,
    '',
    '这类追问通常关心：' + script.followUps.join(' / '),
    '',
    `刚刚对方的回答：`,
    `「${lastAnswer}」`,
    '',
    '请判断该怎么接：',
    atFollowUpCap
      ? '- 本题追问次数已到上限，只能用 [换题]。'
      : [
          '- 如果这句话里有具体、值得深挖的细节，用 [追问]，顺着这个细节问一个问题，抓他话里的时间、结果、卡点或情绪。',
          '- 如果对方说得含糊、回答「没有」这类、或者已经说清楚了，用 [换题]。',
        ].join('\n'),
    `- 用 [换题] 时，${advanceInstruction}`,
  ].join('\n')

  return [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ]
}

const RESULT_SCHEMA = `{
  "events": ["这周做了什么，每条一句话，最多 4 条"],
  "people": [{ "name": "老王", "note": "方案卡在他那儿没拍板" }],
  "things": ["这周买了什么、处理掉了什么，最多 4 条"],
  "pending": ["悬而未决的事，最多 4 条"],
  "highlights": ["本周热点，3 到 5 条"],
  "nextFocus": ["下周重点，正好 3 条"],
  "nextFollowUps": ["下周要跟进的人名，最多 2 个"]
}`

const RESULT_RULES = `要求：
- 只输出 JSON，不要任何解释，不要 markdown 代码块。
- 每条都要具体，带上对方说的细节，不要写「工作」「生活」这种空泛的词。
- 用对方自己的说法，不要改写成书面语。
- 宁缺毋滥：没有内容就给空数组，绝对不要编造。
- 对方回答「没有」「没什么」这类，不算内容。
- people 的 name 只写人名或称呼，note 写和这个人之间发生了什么。`

/** 汇总全部对话，产出结构化结果 */
export function buildSummarizePrompt(history: ChatMessage[]): ChatMessagePayload[] {
  const answers = history.filter((m) => m.role === 'user' && m.text.trim().length > 0)
  const transcript =
    answers.length > 0
      ? formatTranscript(history)
      : '（对方全程没有给出任何有效回答）'

  return [
    {
      role: 'system',
      content: `你把一段周末采访记录整理成结构化结果。

输出的 JSON 结构：
${RESULT_SCHEMA}

${RESULT_RULES}`,
    },
    {
      role: 'user',
      content: [
        '这是这次周末复盘的采访记录：',
        '',
        transcript,
        '',
        '请按上面的结构整理成 JSON。',
        answers.length === 0
          ? '注意：这一次对方什么都没说，请如实留空，并在 highlights 里说明这一周还没有被梳理过。'
          : '',
      ]
        .filter(Boolean)
        .join('\n'),
    },
  ]
}

/**
 * 用户改过清单、补充一句话之后重新整理。
 * 约定：清单内容尊重用户的修改，只重写「本周热点」和「下周计划」。
 */
export function buildRefinePrompt(
  history: ChatMessage[],
  current: WeeklyResult,
  note: string,
): ChatMessagePayload[] {
  return [
    {
      role: 'system',
      content: `你把一段周末采访记录整理成结构化结果。用户已经看过上一版结果并做了修改。

输出的 JSON 结构：
${RESULT_SCHEMA}

${RESULT_RULES}

这一次的额外约定（重要）：
- events / people / things / pending 这四栏**已经由用户亲手改过**，必须原样保留每一条，一个字都不要改写、不要删除、不要重排。
- 只有当用户的补充里明确提到了**新**的内容时，才可以把新内容**追加**到这四栏末尾。
- 你真正要重写的是 highlights、nextFocus、nextFollowUps 这三项。`,
    },
    {
      role: 'user',
      content: [
        '原始的采访记录：',
        '',
        formatTranscript(history),
        '',
        '用户手改过、需要原样保留的当前结果：',
        '',
        JSON.stringify(current, null, 2),
        '',
        '用户的补充说明：',
        `「${note.trim()}」`,
        '',
        '请结合补充说明，重写「本周热点」和「下周计划」，并按上面的约定返回完整 JSON。',
      ].join('\n'),
    },
  ]
}
