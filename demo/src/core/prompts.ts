import type { ChatMessagePayload } from './chatTransport'
import {
  blockProgress,
  currentQuestion,
  nextStage,
  nextStep,
} from './interview'
import { buildInterviewerSystem } from './persona'
import {
  CONTENT_BLOCKS,
  SCRIPT,
  depthSpec,
  dimensionScript,
  followUpCap,
} from './script'
import type {
  ChatMessage,
  Dimension,
  InterviewContext,
  InterviewState,
  WeeklyResult,
} from './types'

/**
 * 提示词构建。全部是纯函数，因此「模型到底被告知了什么」这件事是可测试的 ——
 * 状态机保证兜底与进度，模型负责怎么问、问多深，这个分工必须体现在提示词里，
 * 一旦提示词漏掉进度信息，模型就会自己乱问。
 */

/** 区块名称，按采访顺序 */
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

/** 各区块进度 + 当前档位，让模型知道走到哪儿了 */
export function formatProgress(state: InterviewState): string {
  const parts = CONTENT_BLOCKS.map((d) => {
    const p = blockProgress(state, d.key)
    if (p.complete) return `${d.label}（已聊完）`
    const total = d.mainQuestions.length
    return `${d.label}（问到第 ${Math.min(p.askIndex + 1, total)}/${total} 题）`
  })
  const reconcile = blockProgress(state, 'reconcile')
  parts.push(`上周对账（${reconcile.complete ? '已过' : '还没问'}）`)
  return `${parts.join('，')}；档位：${depthLabel(state)}`
}

function depthLabel(state: InterviewState): string {
  const spec = depthSpec(state.depth)
  return spec ? spec.label : '还没定档'
}

/** 当前档位的节奏要求，写进提问与开场的提示词 */
function depthGuidance(state: InterviewState): string {
  const spec = depthSpec(state.depth)
  if (!spec) return '（档位还没定：先聊状态，聊完再问对方要深度、中度还是快速复盘。）'
  return `本次是**${spec.label}**，大约 ${spec.minutes} 分钟。${spec.guidance}`
}

/** 上周的记录，写成对账那一步能直接念的原文 */
function lastWeekBlock(ctx: InterviewContext): string {
  const focus = ctx.lastWeek?.focus ?? []
  const followUps = ctx.lastWeek?.followUps ?? []
  if (focus.length === 0 && followUps.length === 0) return ''
  const when = ctx.lastWeekKey ? `${ctx.lastWeekKey} 那一周` : '上一周'
  const lines = [`${when}他自己定下来的是：`, `下周重点：${focus.join(' / ') || '（没写）'}`]
  if (followUps.length > 0) lines.push(`要跟进的人：${followUps.join(' / ')}`)
  return lines.join('\n')
}

function questionList(dim: Dimension): string {
  const script = dimensionScript(dim)
  if (!script) return ''
  return script.mainQuestions.map((q, i) => `${i + 1}. ${q}`).join('\n')
}

function poolBlock(dim: Dimension): string {
  const script = dimensionScript(dim)
  if (!script) return ''
  const lines = [`追问池（说到才追，不硬问）：${script.followUps.join(' / ')}`]
  if (script.optionalQuestions?.length) {
    lines.push(`聊开了才问（没聊到就不提）：${script.optionalQuestions.join(' / ')}`)
  }
  return lines.join('\n')
}

/** 该区块第一次被打开时，让模型给出开场和第一个问题 */
export function buildOpeningPrompt(
  state: InterviewState,
  dim: Dimension,
  history: ChatMessage[],
  persona: string,
  ctx: InterviewContext = {},
): ChatMessagePayload[] {
  const script = dimensionScript(dim)
  if (!script) return []

  const isVeryFirst = history.filter((m) => m.role === 'ai').length === 0

  const head = [`现在要开始聊「${script.label}」这一块。这一块关心的是：${script.hint}。`]

  if (dim === 'reconcile') {
    const week = lastWeekBlock(ctx)
    head.push('', week || '（没有取到上周的内容，按一般问法问就行）')
  } else {
    head.push('', `参考题目（仅供参考，不是必须逐条念）：`, questionList(dim), '', poolBlock(dim))
  }

  head.push('', `整体进度：${formatProgress(state)}`, depthGuidance(state), '')
  head.push(
    isVeryFirst
      ? '这是整场采访的第一个问题。请先用半句话打个招呼，然后问出第 1 个问题。'
      : dim === 'reconcile'
        ? '请把上面上周的内容用他当时的说法复述一遍（不要改写、不要编造），然后问：实际落到了哪儿。'
        : '请用一句自然的话过渡过来，然后问出第 1 个问题。',
  )
  head.push(
    '',
    '要求：一次只说一句话、问一到三个小问题就好，不要列清单、不要小标题、不要复述区块名称；' +
      '不要评价他做得怎么样，也不要替他说结论。',
  )

  return [
    { role: 'system', content: buildInterviewerSystem(persona, { marker: false }) },
    { role: 'user', content: head.join('\n') },
  ]
}

/** 该区块没有靠 [换块] 收尾、而是参考题目问完时的收尾语 */
export function buildClosingPrompt(
  state: InterviewState,
  dim: Dimension,
  persona: string,
): ChatMessagePayload[] {
  const script = dimensionScript(dim)
  if (!script) return []

  const remaining = CONTENT_BLOCKS.filter((d) => !blockProgress(state, d.key).complete)
  const next = nextStage(state)
  const nextLabel = next.kind === 'block' ? dimensionScript(next.dim)?.label ?? '' : ''
  const tail =
    remaining.length === 0
      ? '四个区块都聊过了，告诉他可以生成这周的梳理了。'
      : next.kind === 'depth'
        ? '自然地提一句：接着可以聊后面几块，先问一句「我们深度复盘、中度复盘还是快速复盘，可以吗？」'
        : next.kind === 'block'
          ? `自然地提一下可以接着聊「${nextLabel}」，` +
            '但**只提块的名称，不要替那一块把问题先问了** —— 他切过去之后会正式问一遍，先问就是重复。'
          : '自然地提一句可以接着聊。'

  return [
    { role: 'system', content: buildInterviewerSystem(persona, { marker: false }) },
    {
      role: 'user',
      content: [
        `「${script.label}」这一块聊得差不多了。`,
        tail,
        '',
        '要求：一句话，不超过 45 字，不要总结刚才聊过的内容，不要煽情，不要替下一块提问。' +
          '注意别把话筒收走 —— 对方想继续说，随时可以接着说。',
      ].join('\n'),
    },
  ]
}

/** 用户答完一句之后的唯一一次调用：接下来怎么走 + 下一句话 */
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
   * 这一块已经聊完了，用户还在说 —— 自由聊。
   * 没有题目可以「换」，标记只剩两种含义：还想深挖 / 他说完了。
   */
  if (progress.complete) {
    const stage = nextStage(state)
    const doneTail =
      stage.kind === 'done'
        ? '用 [换块]，给一句自然的收尾，并告诉他可以生成这周的梳理了。'
        : stage.kind === 'depth'
          ? '用 [换块]，给一句自然的收尾，并问一句「我们深度复盘、中度复盘还是快速复盘，可以吗？」'
          : '用 [换块]，给一句自然的收尾（后面还有没聊的块，但这一块不用再问了）。'
    return [
      { role: 'system', content: system },
      {
        role: 'user',
        content: [
          `当前区块：${script.label}（参考题目都过完了，现在是自由聊）`,
          '',
          '这一块的对话记录：',
          formatTranscript(history, dim),
          '',
          '刚刚对方的回答：',
          `「${lastAnswer}」`,
          '',
          '请判断该怎么接（这一块只用这两个标记）：',
          '- 如果他还想往下说：用 [追问]，顺着这句话问一个具体的问题，抓他话里的时间、结果、卡点或感受。',
          `- 如果他已经说完了：${doneTail}`,
          '',
          '注意：不要念题目、不要催他换话题，也不要把他说过的总结一遍。',
        ].join('\n'),
      },
    ]
  }

  const question = currentQuestion(state, dim)
  const cap = followUpCap(state.depth)
  const atCap = progress.followUpCount >= cap

  // 若不追问，状态机会推进成什么样 —— 这决定了「换题」该说什么
  const advanced = nextStep(state, dim, 'next')
  const advancedProgress = blockProgress(advanced, dim)
  const blockWillFinish = advancedProgress.complete
  const nextQuestion = blockWillFinish ? '' : currentQuestion(advanced, dim)

  const stageAfterBlock = nextStage(nextStep(state, dim, 'block'))
  const blockTail =
    stageAfterBlock.kind === 'done'
      ? '用 [换块] 时，给一句自然的收尾，并告诉他可以生成这周的梳理了。'
      : stageAfterBlock.kind === 'depth'
        ? '用 [换块] 时，这句话末尾要补一句：「我们深度复盘、中度复盘还是快速复盘，可以吗？」然后就停住，等他挑，不要自己替他挑。'
        : `用 [换块] 时，用一句自然的话过渡到「${dimensionScript(stageAfterBlock.dim)?.label ?? '下一块'}」，但不要替那一块把问题先问了。`

  const advanceInstruction = blockWillFinish
    ? blockTail
    : `自然地过渡到下一个参考题目：「${nextQuestion}」。可以顺着刚才的话带过去，不要生硬地念题目。`

  const user = [
    `当前区块：${script.label}（关心的是：${script.hint}）`,
    '',
    '这一块的对话记录：',
    formatTranscript(history, dim),
    '',
    '本区块进度：',
    `- 当前参考题目：「${question}」`,
    `- 本题已追问 ${progress.followUpCount} 次，上限 ${cap} 次${atCap ? '（已达上限，只能换题或换块）' : ''}`,
    `- 整体进度：${formatProgress(state)}`,
    '',
    poolBlock(dim),
    '',
    '这一类问题通常想问到：' + (script.followUps.join(' / ') || '细节、判断依据、卡点、结果'),
    '',
    '刚刚对方的回答：',
    `「${lastAnswer}」`,
    '',
    '请判断接下来怎么走：',
    atCap
      ? '- 本题追问次数已到上限，只能用 [换题] 或 [换块]。'
      : [
          '- [追问]：这句话里有具体、值得挖的细节（判断依据、卡点、结果、感受），顺着它再问一到三个小问题，把这件事问透。',
          '- [换题]：这个话题已经聊清楚了，换到参考题目里的下一个。',
          '- [换块]：这一块的关键都拿到了（他讲了做了什么、卡在哪、当时的判断或感受），可以进下一块了。',
        ].join('\n'),
    `- 用 [换题] 时，${advanceInstruction}`,
    ...(blockWillFinish ? [] : [`- ${blockTail}`]),
    '',
    '要求：一次只说一句话、问一到三个小问题就好，不要堆成一长串；' +
      '采访阶段保持中立，不评价、不说教、不替他下结论。',
  ].join('\n')

  return [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ]
}

const RESULT_SCHEMA = `{
  "events": ["这周做了什么，每条一句话，最多 5 条"],
  "people": [{ "name": "老王", "note": "方案卡在他那儿没拍板" }],
  "things": ["这周买了什么、花了什么、该维护什么，最多 4 条"],
  "pending": ["未办：还没做完、一直拖着的事，最多 4 条"],
  "highlights": [
    "第一条：这一周的主线，一句话，要有取舍有判断",
    "后面 2 到 3 条：清单里看不到的东西 —— 为什么、代价、反复出现的模式、跟上周比的变化"
  ],
  "nextFocus": ["下周重点，正好 3 条"],
  "nextFollowUps": ["下周要跟进的人名，最多 2 个"],
  "state": {
    "body": "身体：睡眠、运动、吃饭怎么样，一句话",
    "mood": "情绪：整体基调、最消耗情绪的一件事，一句话",
    "focus": "精力 / 专注：高峰在做什么、被什么打断最多，一句话",
    "growth": "心智：这周的输入、学到的一条，一句话"
  }
}`

const RESULT_RULES = `要求：
- 只输出 JSON，不要任何解释，不要 markdown 代码块。
- 每条都要具体，带上对方说的细节，不要写「工作」「生活」这种空泛的词。
- 用对方自己的说法，不要改写成书面语。
- 宁缺毋滥：没有内容就给空数组 / 空字符串，绝对不要编造。
- 对方回答「没有」「没什么」这类，不算内容。
- people 的 name 只写人名或称呼，note 写和这个人之间发生了什么。
- things 这一栏的范围比他以为的宽：实物（工具、设备、家居）、花销与订阅（续费、会员、数字资产）、
  该维护的事（备份、保修、体检、清理）都算。
- state 四项各一句话（身体 / 情绪 / 精力专注 / 心智成长），**不要写分数、不要写「几分」**；
  哪一项这周没聊到就留空字符串，别拿别的项来补。
- pending 里如果包含对上一周承诺的交代（这次问过对账才会有）：文字里带上「上周说好的」字样，
  例如「上周说好的把报价发出去 —— 只发了初稿」；做到的事不用单列，它本来就在 events 里。
- highlights 的第一条是**这一周的主线**：一句话说清这周到底是怎么回事、重心落在哪，
  要有取舍和判断（比如「这周基本被客户方案拖着，其他事都是插空做的」），
  不要罗列，不要写成「做了 A、也做了 B」。
- highlights 后面 2 到 3 条，只写**清单里看不到的东西**：为什么是这样、代价是什么、
  什么在反复出现、跟上周比有什么变化。**不要写「做了什么」** —— 那是 events / things 那一栏的活。
- 可以评价（哪件事做得值、哪里是反复掉的坑），但**对事不对人**：不说教、不贴标签、不替他下结论。
- 判断标准：如果某条支撑能在 events / people / things / pending 里找到意思相近的一句，
  就重写它；重写不出来就宁可少写一条。`

/** 汇总全部对话，产出结构化结果 */
export function buildSummarizePrompt(
  history: ChatMessage[],
  ctx: InterviewContext = {},
): ChatMessagePayload[] {
  const answers = history.filter((m) => m.role === 'user' && m.text.trim().length > 0)
  const transcript =
    answers.length > 0 ? formatTranscript(history) : '（对方全程没有给出任何有效回答）'
  const week = lastWeekBlock(ctx)

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
        ...(week
          ? [
              '他上一周定下来的是：',
              week,
              '（对账的内容在【上周对账】那一段里；没做到 / 只做了一半的写进 pending。）',
              '',
            ]
          : []),
        '这是这次周末复盘的采访记录：',
        '',
        transcript,
        '',
        '请按上面的结构整理成 JSON。',
        ...(answers.length === 0
          ? [
              '注意：这一次对方什么都没说，请如实留空，并在 highlights 里说明这一周还没有被梳理过。',
            ]
          : []),
      ].join('\n'),
    },
  ]
}

/**
 * 用户改过清单、补充一句话之后重新整理。
 * 约定：清单内容尊重用户的修改，只重写「本周主线」和「下周计划」。
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
- events / people / things / pending / state 这几栏**已经由用户亲手改过**，必须原样保留每一条，一个字都不要改写、不要删除、不要重排。
- 只有当用户的补充里明确提到了**新**的内容时，才可以把新内容**追加**到这些栏的末尾。
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
        '请结合补充说明，重写「本周主线」和「下周计划」，并按上面的约定返回完整 JSON。',
      ].join('\n'),
    },
  ]
}
