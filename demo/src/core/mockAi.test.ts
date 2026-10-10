import { describe, expect, it } from 'vitest'
import {
  coveredNumbers,
  createMockAi,
  decideAction,
  extractName,
  groupAnswers,
  isNonAnswer,
  personHint,
  sampleAnswer,
  shouldFollowUp,
} from './mockAi'
import {
  createInterview,
  currentPoint,
  finishAll,
  nextStep,
  openBlock,
  setDepth,
} from './interview'
import { DEFAULT_FOLLOWUP_CAP, FOLLOWUP_CAPS, followUpCap, spoken } from './script'
import type { BlockProgress, ChatMessage, Depth, Dimension, InterviewState } from './types'

const ai = createMockAi({ instant: true })

let seq = 0
function msg(role: 'ai' | 'user', text: string, dimension: Dimension): ChatMessage {
  seq += 1
  return { id: `m${seq}`, role, text, dimension, at: seq }
}

/**
 * 只覆盖想改的那几项，其余进度沿用初始值。
 * 档位默认「还没定」，状态打分卡默认已经交了（0.9.3 起交卡才进正式问答）。
 */
function withBlocks(
  patch: Partial<Record<Dimension, Partial<BlockProgress>>>,
  options: { depth?: Depth | null; stateDone?: boolean } = {},
): InterviewState {
  const base = createInterview()
  const blocks = { ...base.blocks }
  for (const [dim, part] of Object.entries(patch)) {
    const key = dim as Dimension
    if (part) blocks[key] = { ...blocks[key], ...part }
  }
  return {
    active: null,
    blocks,
    stateDone: options.stateDone ?? true,
    // 这些用例不碰「状态追问」，所以当它没有低分项（等于这一步不存在）
    lowKeys: [],
    depth: options.depth ?? null,
  }
}

/** 四个内容块一个一个聊过来的历史（对账放最后，跟 SCRIPT 顺序一致） */
const FULL_HISTORY: ChatMessage[] = [
  msg('ai', '好，说说这周都忙了什么。', 'event'),
  msg('user', '在改客户那个方案，改了三版了还没定下来。', 'event'),
  msg('user', '本来想把季度数据整理一下，一直没腾出时间。', 'event'),
  msg('ai', '再说说人。这周跟谁打交道最多？', 'people'),
  msg('user', '主要是跟老王对接方案，还有跟小李吃了顿饭。', 'people'),
  msg('user', '想约张总聊聊明年的方向，但一直没敢开口。', 'people'),
  msg('ai', '最后说说东西和钱 —— 这周买了什么、或者添置了什么东西？', 'thing'),
  msg('user', '买了个新键盘，之前那个手感不行，纠结了半个月终于下单了。', 'thing'),
  msg('user', '没有，这周没顾上这些。', 'thing'),
  msg('ai', '这周看了什么、听了什么，或者跟谁聊出点东西？', 'growth'),
  msg('user', '看了一本讲定价的书，学到先算清成本再谈折扣。', 'growth'),
  msg('ai', '对一下上周说好的，实际落到了哪儿？', 'reconcile'),
  msg('user', '上周说好的报价发出去了，只发了初稿；要跟进的张总一直没约上。', 'reconcile'),
]

/** 别的块已经聊过，但「事情」这一块还没有过 AI 消息 */
const OTHER_BLOCK_HISTORY: ChatMessage[] = [
  msg('ai', '上周定的那几件事，实际落到了哪儿？', 'reconcile'),
  msg('user', '上周说好的报价发出去了，只发了初稿。', 'reconcile'),
  msg('user', '买了个新键盘，之前那个手感不行。', 'thing'),
]

describe('演示用假 AI · 对话', () => {
  it('整场采访的第一句：先打招呼，再问出这一块的第一个要点', async () => {
    const s = createInterview()
    const text = await ai.nextMessage(s, 'event', [])
    expect(text).toContain('周末好')
    expect(text).toContain('说说这周都忙了什么')
    expect(text).toContain(spoken(currentPoint(s, 'event')))
  })

  it('这一周已经聊过一次时，开场先复述记下的内容，再问今天补点什么', async () => {
    const s = createInterview()
    const text = await ai.nextMessage(s, 'event', [], undefined, {
      thisWeek: { savedAt: 1, lines: ['在改客户那个方案'] },
    })
    expect(text).toContain('这周你已经聊过一次')
    expect(text).toContain('在改客户那个方案')
    expect(text).toContain('今天补点什么')
  })

  it('不是首次进入时，只加一句开场语，不再打招呼', async () => {
    const s = openBlock(createInterview(), 'event')
    // 别的块已经聊过，但这一块还没有过 AI 消息 —— 这才是「第一次进这一块」
    const text = await ai.nextMessage(s, 'event', OTHER_BLOCK_HISTORY)
    expect(text).not.toContain('周末好')
    expect(text).toBe(`好，说说这周都忙了什么。${spoken(currentPoint(s, 'event'))}`)
  })

  it('追问态返回一句搭话', async () => {
    // 假 AI 的追问不再从池子里挑，就一句搭话；真模型那边这一句由它自己组织
    const s = withBlocks({ event: { followUpCount: 1, complete: false } })
    expect(await ai.nextMessage(s, 'event', FULL_HISTORY)).toBe('嗯，这一点再多说点？')
  })

  it('还没交状态打分卡时，收了这一块也先让他去打分，不往下问', async () => {
    const s = withBlocks({ thing: { complete: true } }, { stateDone: false })
    const text = await ai.nextMessage(s, 'thing', [])
    expect(text).toContain('先在卡片上给这周打个分')
    expect(text).toContain('心情')
    expect(text).not.toContain('东西和钱')
  })

  it('还没定档时，提示用户挑复盘深度', async () => {
    const s = withBlocks({ event: { complete: true } })
    const text = await ai.nextMessage(s, 'event', FULL_HISTORY)
    expect(text).toContain('深度复盘')
    expect(text).toContain('快速复盘')
  })

  it('区块聊完后给出收尾语，并提示下一块', async () => {
    const s = withBlocks(
      { reconcile: { complete: true }, event: { complete: true } },
      { depth: 'mid' },
    )
    const text = await ai.nextMessage(s, 'event', FULL_HISTORY)
    expect(text).toContain('「事情」这块差不多了')
    expect(text).toContain('人际')
  })

  it('四块都聊完后提示可以生成梳理', async () => {
    const s = setDepth(finishAll(createInterview({ hasLastWeek: false })), 'mid')
    const text = await ai.nextMessage(s, 'event', FULL_HISTORY)
    expect(text).toContain('生成')
  })

  it('回答太短就追问，回答完整就换方向', () => {
    const s = createInterview()
    expect(shouldFollowUp('改方案', s, 'event')).toBe(true)
    expect(
      shouldFollowUp(
        '这周主要是在改客户那个方案，来回改了三版，中间还开了很多会，最后终于定下来了。',
        s,
        'event',
      ),
    ).toBe(false)
  })

  it('「没有」这类回答不追问，空回答也不追问', () => {
    const s = createInterview()
    expect(shouldFollowUp('没有，这周没顾上这些。', s, 'thing')).toBe(false)
    expect(shouldFollowUp('   ', s, 'event')).toBe(false)
  })

  it('还没定档时用默认上限，到顶就不再追问', () => {
    expect(followUpCap(null)).toBe(DEFAULT_FOLLOWUP_CAP)
    const s = withBlocks({ thing: { followUpCount: DEFAULT_FOLLOWUP_CAP, complete: false } })
    expect(shouldFollowUp('短', s, 'thing')).toBe(false)
  })

  it('快速档只允许追一次，到顶就不再追问', () => {
    const s = withBlocks(
      { thing: { followUpCount: FOLLOWUP_CAPS.fast, complete: false } },
      { depth: 'fast' },
    )
    expect(shouldFollowUp('短', s, 'thing')).toBe(false)
  })

  it('深度档可以一直追到 5 次，第 5 次之后才停', () => {
    const almost = withBlocks(
      { thing: { followUpCount: FOLLOWUP_CAPS.deep - 1, complete: false } },
      { depth: 'deep' },
    )
    expect(shouldFollowUp('短', almost, 'thing')).toBe(true)

    const atCap = withBlocks(
      { thing: { followUpCount: FOLLOWUP_CAPS.deep, complete: false } },
      { depth: 'deep' },
    )
    expect(shouldFollowUp('短', atCap, 'thing')).toBe(false)
  })

  it('要点都聊完之后接着说，就不再催他换块了', async () => {
    const s = withBlocks({ event: { complete: true, freeTurns: 1 } })
    const text = await ai.nextMessage(s, 'event', FULL_HISTORY)
    expect(text).toContain('还有呢')
  })
})

describe('演示用假 AI · 行首动作判定', () => {
  it('没聊完、回答太短：接着追', () => {
    expect(decideAction('改方案', createInterview(), 'event')).toBe('followup')
  })

  it('没聊完、回答已经够完整：换个方向', () => {
    expect(
      decideAction(
        '这周主要是在改客户那个方案，来回改了三版，中间还开了很多会，最后终于定下来了。',
        createInterview(),
        'event',
      ),
    ).toBe('next')
  })

  it('只剩一个要点没聊到、又没什么好追的：直接收尾', () => {
    // 0.9.5 起没有「主问题清单」了，收尾的判据换成「这一块还差几样」
    const s = withBlocks({
      event: { covered: ['event-focus', 'event-stuck', 'event-unsure'], complete: false },
    })
    expect(
      decideAction(
        '这周主要是在改客户那个方案，来回改了三版，中间还开了很多会，最后终于定下来了。',
        s,
        'event',
      ),
    ).toBe('block')
  })

  it('自由聊里他说「说完了」：换块', () => {
    const s = withBlocks({ event: { complete: true, freeTurns: 2 } })
    expect(decideAction('差不多了，就说完了。', s, 'event')).toBe('block')
  })

  it('自由聊里他还想接着说：继续追', () => {
    const s = withBlocks({ event: { complete: true, freeTurns: 2 } })
    expect(decideAction('还有件事，周五那个评审会也挺折腾的。', s, 'event')).toBe('followup')
  })
})

describe('演示用假 AI · 报覆盖', () => {
  it('收尾时把这一块的要点全报上，换方向时报「还没聊到的第一个」', () => {
    const s = createInterview()
    expect(coveredNumbers(s, 'event', 'block')).toEqual([1, 2, 3, 4])
    expect(coveredNumbers(s, 'event', 'next')).toEqual([1])
    // 追问那一轮不报覆盖：它不算「聊到了一个要点」
    expect(coveredNumbers(s, 'event', 'followup')).toEqual([])
  })

  it('已经聊到两个时，换方向报的是第三个的序号', () => {
    const s = withBlocks({ event: { covered: ['event-focus', 'event-stuck'] } })
    expect(coveredNumbers(s, 'event', 'next')).toEqual([3])
  })

  it('没有要点的步骤（状态追问没挑出低分项）报空数组', () => {
    expect(coveredNumbers(createInterview(), 'probe', 'block')).toEqual([])
    expect(coveredNumbers(createInterview(), 'nope' as Dimension, 'next')).toEqual([])
  })

  it('reply 报的覆盖接上状态机，一块要点就记齐了', async () => {
    const s = openBlock(createInterview(), 'event')
    const history = [
      msg('ai', '这周主要在忙什么？', 'event'),
      msg(
        'user',
        '这周主要是在改客户那个方案，来回改了三版，中间还开了很多会，最后终于定下来了。',
        'event',
      ),
    ]
    const turn = await ai.reply(s, 'event', history)
    expect(turn.covered).toEqual([1])

    const advanced = nextStep(s, 'event', turn.action, { covered: turn.covered })
    expect(advanced.blocks.event.covered).toEqual(['event-focus'])
  })
})

describe('演示用假 AI · 一轮回复', () => {
  const shortAnswer = [msg('ai', '这周主要在忙什么？', 'event'), msg('user', '改方案', 'event')]
  const longAnswer = [
    msg('ai', '这周主要在忙什么？', 'event'),
    msg(
      'user',
      '这周主要是在改客户那个方案，来回改了三版，中间还开了很多会，最后终于定下来了。',
      'event',
    ),
  ]

  it('reply 一次就同时给出「接下来怎么走」和下一句话', async () => {
    const s = openBlock(createInterview(), 'event')
    const turn = await ai.reply(s, 'event', shortAnswer)
    expect(turn.action).toBe('followup')
    expect(turn.message.length).toBeGreaterThan(0)
  })

  it('不需要追问时，reply 的话术正好是状态机推进后「还没聊到的那个要点」的锚点', async () => {
    const s = openBlock(createInterview(), 'event')
    const turn = await ai.reply(s, 'event', longAnswer)
    expect(turn.action).toBe('next')
    const advanced = nextStep(s, 'event', 'next', { covered: turn.covered })
    expect(turn.message).toBe(spoken(currentPoint(advanced, 'event')))
  })

  it('reply 会通过 onDelta 把内容吐出去，拼起来等于完整回复', async () => {
    const s = openBlock(createInterview(), 'event')
    const pieces: string[] = []
    const turn = await ai.reply(s, 'event', longAnswer, (d) => pieces.push(d))
    expect(pieces.length).toBeGreaterThan(0)
    expect(pieces.join('')).toBe(turn.message)
  })

  it('非 instant 模式下是分多次吐字，而不是一次性给完', async () => {
    const slow = createMockAi()
    const s = openBlock(createInterview(), 'event')
    const pieces: string[] = []
    const turn = await slow.reply(s, 'event', longAnswer, (d) => pieces.push(d))
    expect(pieces.length).toBeGreaterThan(1)
    expect(pieces.join('')).toBe(turn.message)
  })

  it('已经聊完的块里他说「说完了」：回的是收尾，不是「还有呢」', async () => {
    // 界面拿到同一个 action 就会去开下一块，这里再回一句「还有呢」就自相矛盾了
    const s = withBlocks({ event: { complete: true, freeTurns: 1 } }, { depth: 'mid' })
    const turn = await ai.reply(s, 'event', [
      msg('ai', '还有别的吗？', 'event'),
      msg('user', '差不多了，就说完了。', 'event'),
    ])
    expect(turn.action).toBe('block')
    expect(turn.message).not.toContain('还有呢')
    expect(turn.message).toContain('接着聊聊')
  })

  it('追问次数到顶时，reply 不再追问', async () => {
    const s = withBlocks({ event: { followUpCount: DEFAULT_FOLLOWUP_CAP, complete: false } })
    const turn = await ai.reply(s, 'event', shortAnswer)
    expect(turn.action).toBe('next')
  })
})

describe('演示用假 AI · 推进状态机', () => {
  it('模型说「这块聊够了」时，nextStep 立刻把这一块标成已完成，并记下报的覆盖', () => {
    const s = withBlocks({ event: { asked: 1, followUpCount: 2, complete: false } })
    const advanced = nextStep(s, 'event', 'block', { covered: [1, 2] })
    expect(advanced.blocks.event.complete).toBe(true)
    expect(advanced.blocks.event.covered).toEqual(['event-focus', 'event-stuck'])
  })
})

describe('演示用假 AI · 人名与归类', () => {
  it('能从中文句子里猜出人名', () => {
    expect(extractName('@张三 那边还没给反馈')).toBe('张三')
    expect(extractName('想约张总聊聊明年的方向，但一直没敢开口。')).toBe('张总')
    expect(extractName('主要是跟老王对接方案，还有跟小李吃了顿饭。')).toBe('老王')
  })

  it('猜不出人名时返回 null，避免把普通句子当成人', () => {
    expect(personHint('要把季度数据整理完')).toBeNull()
    expect(personHint('给自己留出整块时间')).toBeNull()
    expect(personHint('写个总结')).toBeNull()
  })

  it('能识别「没有」这类非回答', () => {
    expect(isNonAnswer('暂时没有，这周没顾上这些。')).toBe(true)
    expect(isNonAnswer('没什么')).toBe(true)
    expect(isNonAnswer('想换个键盘')).toBe(false)
  })

  it('按区块归类用户回答，四个内容块加对账各归各的', () => {
    const grouped = groupAnswers(FULL_HISTORY)
    expect(grouped.event).toHaveLength(2)
    expect(grouped.people).toHaveLength(2)
    expect(grouped.thing).toHaveLength(2)
    expect(grouped.growth).toHaveLength(1)
    expect(grouped.reconcile).toHaveLength(1)
  })

  it('示例回答覆盖全部五个区块，并且按下标循环取值', () => {
    for (const dim of ['reconcile', 'event', 'people', 'thing', 'growth'] as Dimension[]) {
      expect(sampleAnswer(dim, 0).length).toBeGreaterThan(0)
      expect(sampleAnswer(dim, 1).length).toBeGreaterThan(0)
    }
    expect(sampleAnswer('event', 6)).toBe(sampleAnswer('event', 0))
    expect(sampleAnswer('growth', 2)).toBe(sampleAnswer('growth', 0))
  })
})

describe('演示用假 AI · 结果生成', () => {
  it('事情、人际、物品、成长四块都归纳出内容', async () => {
    const r = await ai.summarize(FULL_HISTORY)

    expect(r.events.join(' ')).toContain('客户那个方案')
    expect(r.people.map((p) => p.name)).toEqual(expect.arrayContaining(['老王', '张总']))
    expect(r.things.join(' ')).toContain('键盘')
    expect(r.growth.join(' ')).toContain('定价')
  })

  it('「没有」这类回答不会被当成一条物品记录', async () => {
    const r = await ai.summarize(FULL_HISTORY)
    expect(r.things.join(' ')).not.toContain('没有')
  })

  it('状态不再由假 AI 编出来：分数和备注一律留空，等界面点星覆盖', async () => {
    const history: ChatMessage[] = [
      msg('user', '睡得还行，运动基本没有，吃饭不太规律。', 'event'),
      msg('user', '看了一本讲定价的书，学到先算清成本再谈折扣。', 'growth'),
    ]
    const r = await ai.summarize(history)
    expect(r.state.scores).toBeUndefined()
    expect(r.state.note).toBe('')
    // 成长单独成栏，不再混进状态里
    expect(r.growth.join(' ')).toContain('定价')
  })

  it('对账里没办成的事带着「上周说好的」前缀写进未办', async () => {
    const r = await ai.summarize(FULL_HISTORY)
    expect(r.pending[0]).toContain('上周说好的：')
    expect(r.pending.join(' ')).toContain('初稿')
  })

  it('给出热点与三条下周建议', async () => {
    const r = await ai.summarize(FULL_HISTORY)
    expect(r.highlights.length).toBeGreaterThan(0)
    expect(r.nextFocus).toHaveLength(3)
    expect(r.nextFollowUps.length).toBeGreaterThan(0)
  })

  it('完全没聊到内容时给出兜底结果', async () => {
    const r = await ai.summarize([])
    expect(r.events.length).toBeGreaterThan(0)
    expect(r.highlights.length).toBeGreaterThan(0)
    expect(r.nextFocus.length).toBeGreaterThan(0)
  })

  it('全部回答都是「没有」时也走兜底，不编造内容', async () => {
    const empty: ChatMessage[] = [
      msg('user', '没有。', 'event'),
      msg('user', '暂时没有。', 'people'),
      msg('user', '没什么。', 'thing'),
      msg('user', '还好。', 'growth'),
    ]
    const r = await ai.summarize(empty)
    expect(r.events).toEqual(['（这次没有聊到具体的事情）'])
    expect(r.things).toEqual([])
    expect(r.growth).toEqual([])
  })
})

describe('演示用假 AI · 用户补充后重新整理', () => {
  it('尊重用户已经手工做过的修改', async () => {
    const initial = await ai.summarize(FULL_HISTORY)
    const edited = {
      ...initial,
      events: ['我自己改过的事情', ...initial.events],
      people: [...initial.people, { name: '手工加的人', note: '我加的' }],
    }

    const next = await ai.refine(FULL_HISTORY, edited, '下周要跟赵总确认一下预算。')

    expect(next.events).toContain('我自己改过的事情')
    expect(next.people.map((p) => p.name)).toContain('手工加的人')
  })

  it('把补充内容分别识别成人、物品和未办的事', async () => {
    const initial = await ai.summarize(FULL_HISTORY)
    const next = await ai.refine(
      FULL_HISTORY,
      initial,
      '下周要跟赵总确认预算。想换个显示器。体检还一直没预约。',
    )

    expect(next.people.map((p) => p.name)).toContain('赵总')
    expect(next.things.join(' ')).toContain('显示器')
    expect(next.pending.join(' ')).toContain('体检')
  })

  it('补充后重新给出热点与三条建议', async () => {
    const initial = await ai.summarize(FULL_HISTORY)
    const next = await ai.refine(FULL_HISTORY, initial, '下周要跟赵总确认预算。')

    expect(next.highlights.length).toBeGreaterThan(0)
    expect(next.nextFocus).toHaveLength(3)
    expect(next.nextFollowUps.length).toBeGreaterThan(0)
  })

  it('补充为空时不会破坏原有结果', async () => {
    const initial = await ai.summarize(FULL_HISTORY)
    const next = await ai.refine(FULL_HISTORY, initial, '   ')
    expect(next.events).toEqual(initial.events)
    expect(next.things).toEqual(initial.things)
    expect(next.nextFocus).toEqual(initial.nextFocus)
  })

  it('重复补充不会产生重复条目', async () => {
    const initial = await ai.summarize(FULL_HISTORY)
    const once = await ai.refine(FULL_HISTORY, initial, '下周要跟赵总确认一下预算。')
    const twice = await ai.refine(FULL_HISTORY, once, '下周要跟赵总确认一下预算。')
    expect(twice.people.filter((p) => p.name === '赵总')).toHaveLength(1)
  })
})

/**
 * 0.9.4 的「状态追问」在演示模式里也要走通。
 *
 * 不填 API Key 时用的是假 AI —— 如果它不认这一步，用户没配 Key 就看不到新功能，
 * 等于这条功能只在接了真模型时才存在。
 */
describe('演示用假 AI · 状态追问', () => {
  it('每一步都能念出一句示例回答，状态追问也不例外', () => {
    const text = sampleAnswer('probe', 0)
    expect(text.trim().length).toBeGreaterThan(0)
    expect(text).toContain('睡')
  })

  it('追问聊出来的话会写进状态的追问小结里', async () => {
    const history = [
      ...FULL_HISTORY,
      msg('ai', '睡眠不好是为什么？', 'probe'),
      msg('user', '睡得太晚了，基本都刷手机刷到一点多。', 'probe'),
      msg('user', '想运动，但每天回到家都快九点，实在挤不出来。', 'probe'),
    ]
    const result = await ai.summarize(history)
    expect(result.state.followUp).toBeTruthy()
    expect(result.state.followUp).toContain('睡得太晚')
    expect(result.state.followUp).toContain('挤不出来')
  })

  it('没聊到低分项时不写这个键 —— 跟真模型那边同一种形状', async () => {
    const result = await ai.summarize(FULL_HISTORY)
    expect('followUp' in result.state).toBe(false)
  })

  it('「没有」这类回答不进小结（不算内容）', async () => {
    const history = [
      ...FULL_HISTORY,
      msg('ai', '睡眠不好是为什么？', 'probe'),
      msg('user', '没有', 'probe'),
    ]
    const result = await ai.summarize(history)
    expect('followUp' in result.state).toBe(false)
  })

  it('只在状态追问里说过话时，小结也不会跟着一起丢掉', async () => {
    // 四个内容块一条都没有 → 会走「这一周还没有被梳理过」那条占位分支；
    // 小结是状态那一段的内容，不该被那个提前 return 顺手丢掉
    const history = [
      msg('ai', '睡眠不好是为什么？', 'probe'),
      msg('user', '躺下之后脑子停不下来，一般一点多才睡。', 'probe'),
    ]
    const result = await ai.summarize(history)
    expect(result.highlights).toEqual(['这一周还没有被梳理过'])
    expect(result.state.followUp).toContain('躺下之后')
  })
})
