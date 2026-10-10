import type { ChatMessagePayload } from './chatTransport'
import {
  blockProgress,
  currentQuestionSpec,
  nextStage,
  nextStep,
} from './interview'
import { buildInterviewerSystem } from './persona'
import { LOW_SCORE_MAX, lowScoreItems, scoresLine } from './probe'
import {
  CONTENT_BLOCKS,
  PROBE_KEY,
  RECONCILE_KEY,
  SCRIPT,
  depthSpec,
  dimensionScript,
  followUpCap,
} from './script'
import { SCORE_MAX } from './stateScore'
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

  // 状态追问在最前面，而且只在真有低分项时才提它 —— 没有低分项这一步压根不存在
  const probe = blockProgress(state, PROBE_KEY)
  const lowCount = (state.lowKeys ?? []).length
  if (lowCount > 0) {
    const n = lowCount
    parts.unshift(
      `状态追问（${probe.complete ? '已问完' : `问到第 ${Math.min(probe.askIndex + 1, n)}/${n} 项`}）`,
    )
  }

  return `${parts.join('，')}；档位：${depthLabel(state)}`
}

function depthLabel(state: InterviewState): string {
  const spec = depthSpec(state.depth)
  return spec ? spec.label : '还没定档'
}

/** 当前档位的节奏要求，写进提问与开场的提示词 */
function depthGuidance(state: InterviewState): string {
  const spec = depthSpec(state.depth)
  if (!spec) return '（档位还没定：先问他要深度、中度还是快速复盘。）'
  return `本次是**${spec.label}**，大约 ${spec.minutes} 分钟。${spec.guidance}`
}

/**
 * 本周已经聊过一次（0.9.3 的「接着上次补」）。
 *
 * 开场要把已经记下的复述一遍，再问今天补点什么 —— 这是用户定的：
 * 一周复盘两次不该把上一次顶掉，第二次是往上加。
 */
function thisWeekBlock(ctx: InterviewContext): string {
  const t = ctx.thisWeek
  if (!t || t.lines.length === 0) return ''
  return [
    '这周他已经聊过一次了，今天是接着上次补（不是从头再来）：',
    ...t.lines.map((l) => `- ${l}`),
    '开场先把他这周已经记下的用一句话复述出来（不要改写、不要编造、不要评价），',
    '然后问一句今天想补点什么 —— 别把已经聊过的再问一遍。',
  ].join('\n')
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

/**
 * 状态追问那一步：把「他打了几分」和「低分那几项要问到什么」交给模型。
 *
 * 这一步是 0.9.4 加的，起因是用户那句「打完分之后就没后续了」。
 *
 * **它推翻了 0.9.3 的一条约定**：那时提示词里连 `scores` 这个词都没有，分数刻意不给模型看。
 * 现在必须给 —— 不问分数就问不出「睡眠 2/5 是为什么」。边界没变：
 * 分仍然只由界面写，模型写不了它（生成与重新整理都会用界面上的真实点击盖掉）。
 */
function probeBlock(ctx: InterviewContext): string {
  const items = lowScoreItems(ctx.stateScores)
  if (items.length === 0) return ''
  const line = scoresLine(ctx.stateScores, SCORE_MAX)
  return [
    line ? `他给自己打的分：${line}。` : '',
    `其中 ${items.length} 项偏低（≤ ${LOW_SCORE_MAX}/5），这一轮要把它们**逐项**问到：`,
    ...items.map(
      (item, i) =>
        `${i + 1}. ${item.label}（${item.score}/${SCORE_MAX}）—— 要问到：${item.intent}` +
        `（示例：「${item.examples.join('」「')}」，只是意思，用你自己的话问）`,
    ),
    '一次只问一项：这一项问清了再问下一项，全部问完才用 [换块]。',
    '分寸：不要评判他为什么没做到，也别急着给方案；只帮他把「是什么挡着、能不能挪开」看清楚。',
  ]
    .filter(Boolean)
    .join('\n')
}

/**
 * 区块的参考题目：**只给要问到什么 + 示例，不给成品句子**。
 *
 * 0.9.3 起措辞交给模型（用户嫌一周又一周同一句「跟个人机一样」），
 * 客户端只管顺序与覆盖面 —— 所以这里写的是目标，不是台词。
 */
function questionList(dim: Dimension): string {
  const script = dimensionScript(dim)
  if (!script) return ''
  return script.mainQuestions
    .map((q, i) => `${i + 1}. 要问到：${q.intent}（示例：「${q.examples.join('」「')}」）`)
    .join('\n')
}

function poolBlock(dim: Dimension): string {
  const script = dimensionScript(dim)
  if (!script) return ''
  const lines = [
    `追问的方向（说到才追，不硬问，用你自己的话问）：${script.followUps.map((f) => f.intent).join(' / ')}`,
  ]
  if (script.optionalQuestions?.length) {
    lines.push(
      `聊开了才问（没聊到就不提）：${script.optionalQuestions.map((q) => q.intent).join(' / ')}`,
    )
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
  const thisWeek = thisWeekBlock(ctx)

  const head = [`现在要开始聊「${script.label}」这一块。这一块关心的是：${script.hint}。`]

  if (dim === PROBE_KEY) {
    // 状态追问：题目按他打的分现算，所以这里给的不是题库，是「哪几项、要问到什么」
    head.push('', probeBlock(ctx) || '（没有取到分数，按一般问法问就行）')
  } else if (dim === RECONCILE_KEY) {
    const week = lastWeekBlock(ctx)
    head.push('', week || '（没有取到上周的内容，按一般问法问就行）')
  } else {
    head.push(
      '',
      `参考题目（给的是**要问到什么**，不是要你念的句子；用你自己的话说）：`,
      questionList(dim),
      '',
      poolBlock(dim),
    )
  }

  if (thisWeek) head.push('', thisWeek)

  head.push('', `整体进度：${formatProgress(state)}`, depthGuidance(state), '')
  head.push(
    isVeryFirst
      ? thisWeek
        ? '这是接着上次补的第一句话：先用半句话打个招呼，再按上面说的把他这周已经记下的复述一句，然后问今天想补点什么。'
        : '这是整场采访的第一个问题。请先用半句话打个招呼，然后问出第 1 个问题。'
      : dim === 'reconcile'
        ? '请把上面上周的内容用他当时的说法复述一遍（不要改写、不要编造），然后问：实际落到了哪儿。'
        : '请用一句自然的话过渡过来，然后问出第 1 个问题。',
  )
  head.push(
    '',
    '要求：一次只说一句话（问一到三个小问题也行，别堆成一长串），不要列清单、不要小标题、不要复述区块名称；' +
      '不要评价他做得怎么样，也不要替他说结论；**不要照抄示例问法**，那是意思不是台词。',
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
      : next.kind === 'state'
        ? '提醒他先在卡片上把状态打完分（心情、睡眠、运动、饮食），打完再往下聊。'
        : next.kind === 'depth'
          ? '自然地提一句：接着可以聊后面几块，先问一句「想聊细一点、正常聊，还是今天时间紧抓重点？」'
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
          ? '用 [换块]，给一句自然的收尾，并问一句「想聊细一点、正常聊，还是今天时间紧抓重点？」'
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

  const question = currentQuestionSpec(state, dim)
  const cap = followUpCap(state.depth)
  const atCap = progress.followUpCount >= cap

  // 若不追问，状态机会推进成什么样 —— 这决定了「换题」该说什么
  const advanced = nextStep(state, dim, 'next')
  const advancedProgress = blockProgress(advanced, dim)
  const blockWillFinish = advancedProgress.complete
  const nextQuestion = blockWillFinish ? undefined : currentQuestionSpec(advanced, dim)

  const stageAfterBlock = nextStage(nextStep(state, dim, 'block'))
  const blockTail =
    stageAfterBlock.kind === 'done'
      ? '用 [换块] 时，给一句自然的收尾，并告诉他可以生成这周的梳理了。'
      : stageAfterBlock.kind === 'depth'
        ? '用 [换块] 时，这句话末尾要补一句：「想聊细一点、正常聊，还是今天时间紧抓重点？」然后就停住，等他挑，不要自己替他挑。'
        : stageAfterBlock.kind === 'state'
          ? '用 [换块] 时提醒他先在卡片上把状态打完分（心情、睡眠、运动、饮食），别替他往下问。'
          : `用 [换块] 时，用一句自然的话过渡到「${dimensionScript(stageAfterBlock.dim)?.label ?? '下一块'}」，但不要替那一块把问题先问了。`

  const advanceInstruction = blockWillFinish
    ? blockTail
    : `自然地过渡到下一个要问到的：${nextQuestion?.intent ?? ''}` +
      (nextQuestion ? `（示例：「${nextQuestion.examples.join('」「')}」，只是意思，用你自己的话说）` : '') +
      `。可以顺着刚才的话带过去，不要生硬地念题目。`

  const user = [
    `当前区块：${script.label}（关心的是：${script.hint}）`,
    '',
    '这一块的对话记录：',
    formatTranscript(history, dim),
    '',
    '本区块进度：',
    `- 这一轮要问到：${question?.intent ?? ''}`,
    ...(question
      ? [`- 示例问法（只是意思，用你自己的话说，别照抄）：「${question.examples.join('」「')}」`]
      : []),
    `- 本题已追问 ${progress.followUpCount} 次，上限 ${cap} 次${atCap ? '（已达上限，只能换题或换块）' : ''}`,
    `- 整体进度：${formatProgress(state)}`,
    '',
    poolBlock(dim),
    '',
    '刚刚对方的回答：',
    `「${lastAnswer}」`,
    '',
    '请判断接下来怎么走：',
    atCap
      ? '- 本题追问次数已到上限，只能用 [换题] 或 [换块]。'
      : [
          '- [追问]：这句话里有具体、值得挖的细节（判断依据、卡点、结果、感受），顺着它再问一到三个小问题，把这件事问透。',
          `- [换题]：**先确认这一轮要问到的（${question?.intent ?? ''}）他真的答到了**，答到了才换；没答到就换个说法再问一次，不许跳过。`,
          '- [换块]：这一块的关键都拿到了（他讲了做了什么、卡在哪、当时的判断或感受），可以进下一块了。',
        ].join('\n'),
    `- 用 [换题] 时，${advanceInstruction}`,
    ...(blockWillFinish ? [] : [`- ${blockTail}`]),
    '',
    '要求：一次只说一句话（问一到三个小问题也行），不要堆成一长串；' +
      '采访阶段保持中立，不评价、不说教、不替他下结论；' +
      '**措辞由你定，但前面「要问到」的那件事必须问到**，换个说法接着问也算。',
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
  "growth": ["成长：这周看了什么、听了什么、想通了什么，每条一句话，最多 3 条"],
  "highlights": [
    "第一条：这一周的主线，一句话，要有取舍有判断",
    "后面 2 到 3 条：清单里看不到的东西 —— 为什么、代价、反复出现的模式、跟上周比的变化"
  ],
  "nextFocus": ["下周重点，正好 3 条"],
  "nextFollowUps": ["下周要跟进的人名，最多 2 个"],
  "stateFollowUp": "分低那几项聊出来的小结：是什么挡着、能不能挪开，一到三句，用他自己的说法；没聊到低分项就写空字符串"
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
- growth 是**这周长了什么**：看了什么、听了什么、跟谁聊出点东西、对哪件事的看法变了，
  最多 3 条；**不要写成「做了什么」**（那是 events 那一栏的活），也不要写成感想口号。
- 状态（心情 / 睡眠 / 运动 / 饮食的分数与备注）**不由你产出**：那一段是用户在界面上自己点的，
  别在 JSON 里编这一项，编了也会被界面上的真实数据覆盖。
- 唯一归你写的是 stateFollowUp：**分低那几项**（≤ 2 星）聊出来的小结 —— 是什么挡着、
  能不能挪开。一到三句，用他自己的说法，不要写成建议清单；这一轮没聊到低分项就写空字符串。
- pending 里如果包含对上一周承诺的交代（这次问过对账才会有）：文字里带上「上周说好的」字样，
  例如「上周说好的把报价发出去 —— 只发了初稿」；做到的事不用单列，它本来就在 events 里。
- highlights 的第一条是**这一周的主线**：一句话说清这周到底是怎么回事、重心落在哪，
  要有取舍和判断（比如「这周基本被客户方案拖着，其他事都是插空做的」），
  不要罗列，不要写成「做了 A、也做了 B」。
- highlights 后面 2 到 3 条，只写**清单里看不到的东西**：为什么是这样、代价是什么、
  什么在反复出现、跟上周比有什么变化。**不要写「做了什么」** —— 那是 events / things 那一栏的活。
- 可以评价（哪件事做得值、哪里是反复掉的坑），但**对事不对人**：不说教、不贴标签、不替他下结论。
- 判断标准：如果某条支撑能在 events / people / things / pending / growth 里找到意思相近的一句，
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
  // 他打的分要给模型看：`stateFollowUp` 那一段小结写的就是低分项为什么低
  const scores = scoresLine(ctx.stateScores, SCORE_MAX)

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
        ...(scores
          ? [`他在打分卡上给自己打的分：${scores}。（分低的那几项，小结写在 stateFollowUp 里。）`, '']
          : []),
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
- events / people / things / pending / growth 这几栏**已经由用户亲手改过**，必须原样保留每一条，一个字都不要改写、不要删除、不要重排。
- 只有当用户的补充里明确提到了**新**的内容时，才可以把新内容**追加**到这些栏的末尾。
- 状态（四项分数、备注、追问小结）不归你管，别动它。
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
