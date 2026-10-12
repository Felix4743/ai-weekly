import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { createInterview, finishAll, openBlock, setDepth, setStateDone } from '../core/interview'
import { STATE_FIELDS } from '../core/stateFields'
import type { ChatMessage, Dimension, InterviewState, Note, StateScores } from '../core/types'
import { ChatPage } from './ChatPage'

/**
 * 采访页（0.9.3）。
 *
 * 0.9.2 的时候星星是挂在「状态那一段的每条回答」下面的；0.9.3 起状态是一张
 * **开场的打分卡**：先打完四项、再定档，然后才进内容块。点星的动作由
 * StateScore 与结果页那两组测试兜住，这里管的是「卡片什么时候出现、
 * 四排星各是哪一项、交卡之后问的是不是定档」。
 */

/**
 * 数「亮着的星星」。
 *
 * 静态渲染看不到 `data-lit`（那是 PeekRating 在 `useLayoutEffect` 里画的），
 * 但每排被选中的那颗带 `aria-checked="true"`，而亮的规则是**分数是几、
 * 这一排的前几颗就亮**，所以数选中那颗前面有几颗、再加它自己。
 */
function litCount(html: string): number {
  const rows = html.split('class="peek-rating"').slice(1)
  let lit = 0
  for (const row of rows) {
    const checked = row.indexOf('aria-checked="true"')
    if (checked === -1) continue
    lit += (row.slice(0, checked).match(/class="peek-rating__glyph"/g) ?? []).length + 1
  }
  return lit
}

function msg(patch: Partial<ChatMessage> & { id: string; role: ChatMessage['role'] }): ChatMessage {
  return { text: '……', ...patch } as ChatMessage
}

const CHAT: ChatMessage[] = [
  msg({ id: 'm1', role: 'ai', dimension: 'event', text: '这周主要忙了些什么？' }),
  msg({ id: 'm2', role: 'user', dimension: 'event', text: '在改客户的方案' }),
]

/** 状态卡还没交：这一屏只有那张卡 */
const ON_CARD = createInterview()
/** 卡交了、档还没定 */
const ON_DEPTH = setStateDone(createInterview())
/** 定完档、正在聊「事情」 */
const IN_BLOCK = openBlock(setDepth(setStateDone(createInterview()), 'mid'), 'event')

function render(options: {
  messages?: ChatMessage[]
  interview?: InterviewState
  stateScores?: StateScores
  stateNote?: string
  busy?: boolean
  missed?: { dim: Dimension; labels: string[] } | null
  /**
   * 这一周的采访开过头没有。默认 **true**：绝大多数用例说的是采访里的样子，
   * 落地页（随心记）那几条自己传 `false`。
   */
  started?: boolean
  notes?: Note[]
}) {
  return renderToStaticMarkup(
    createElement(ChatPage, {
      messages: options.messages ?? [],
      typing: false,
      streamText: '',
      interview: options.interview ?? ON_CARD,
      progress: 0,
      busy: options.busy ?? false,
      sampleText: '',
      hasAnyAnswer: true,
      stateScores: options.stateScores ?? {},
      stateNote: options.stateNote ?? '',
      onOpenBlock: () => {},
      onSend: () => {},
      onPickDepth: () => {},
      onScoreState: () => {},
      onNoteChange: () => {},
      onStateDone: () => {},
      onSkip: () => {},
      missed: options.missed ?? null,
      onReopen: () => {},
      onDismissMissed: () => {},
      onStartFresh: () => {},
      onGenerate: () => {},
      started: options.started ?? true,
      onStartInterview: () => {},
      notes: options.notes ?? [],
      onAddNote: () => {},
      onRemoveNote: () => {},
    }),
  )
}

describe('采访页的状态卡', () => {
  it('一进来先给状态卡：心情、睡眠、运动、饮食各一排星', () => {
    const html = render({})
    expect(html).toContain('class="state-card"')
    expect(html.match(/class="state-score"/g)).toHaveLength(4)
    expect(html.match(/class="peek-rating__glyph"/g)).toHaveLength(20)
    for (const field of STATE_FIELDS) {
      expect(html).toContain(`>${field.label}<`)
      expect(html).toContain(field.ask)
    }
    // 还没点过：四排都是「未打分」，一颗都不亮（亮不亮是 useLayoutEffect 画的，
    // 静态渲染看不到 data-lit，所以按「第几颗被选中」来数）
    expect(html.match(/未打分/g)).toHaveLength(4)
    expect(litCount(html)).toBe(0)
    expect(html).toContain('打好了，开始聊这周')
  })

  it('状态卡没交之前，顶上四块先不让点（顺序不靠用户自觉）', () => {
    const html = render({})
    // 四个 tab 全带 disabled；这一屏只有卡上那个备注框，没有聊天输入框
    expect(html.match(/class="tab [^"]*"[^>]*disabled/g)).toHaveLength(4)
    expect(html.match(/<textarea/g)).toHaveLength(1)
    expect(html).toContain('class="state-note"')
  })

  it('点过的分在卡上亮着，四排各挂自己那一项', () => {
    const html = render({ stateScores: { sleep: 4, diet: 2 } })
    expect(litCount(html)).toBe(6)
    expect(html).toContain('4 / 5')
    expect(html).toContain('2 / 5')
    // 另外两项还是「未打分」
    expect(html.match(/未打分/g)).toHaveLength(2)
  })

  it('备注原样待在框里，位置在四排星下面', () => {
    const html = render({ stateNote: '睡得少，白天靠咖啡顶着' })
    expect(html).toContain('class="state-note"')
    expect(html).toContain('睡得少，白天靠咖啡顶着')
    expect(html.indexOf('class="state-form"')).toBeLessThan(html.indexOf('class="state-note"'))
  })

  it('卡交了以后，问的是聊多细（三个按钮），卡片收起来', () => {
    const html = render({ interview: ON_DEPTH })
    expect(html).not.toContain('class="state-card"')
    expect(html).toContain('class="depth-picker"')
    expect(html.match(/class="btn depth"/g)).toHaveLength(3)
    expect(html).toContain('深度复盘')
    expect(html).toContain('中度复盘')
    expect(html).toContain('快速复盘')
  })

  it('进了内容块以后，采访页不再出现星星（星星只在卡片和结果页上）', () => {
    const html = render({ interview: IN_BLOCK, messages: CHAT })
    expect(html).not.toContain('class="state-card"')
    expect(html).not.toContain('class="state-score"')
    expect(html).not.toContain('peek-rating')
    expect(html).toContain('这周主要忙了些什么？')
  })

  it('AI 正在回复时，星和卡片按钮一起禁用', () => {
    const idle = render({})
    expect(idle.match(/class="peek-rating__star"[^>]*disabled/g)).toBeNull()
    const busy = render({ busy: true })
    expect(busy.match(/class="peek-rating__star"[^>]*disabled/g)).toHaveLength(20)
  })

  it('「从头再聊一遍」一直摆在下面（一周聊两次是常态）', () => {
    for (const interview of [ON_CARD, ON_DEPTH, IN_BLOCK]) {
      expect(render({ interview })).toContain('从头再聊一遍')
    }
  })
})

/**
 * 0.9.4：打完分之后接着问 —— 用户提的第一个问题就是「打完分之后就没后续了」。
 *
 * 分低的项会先聊一轮「状态追问」，然后才轮到上周对账与四个内容块；
 * 四项都还行的话这一步整步不存在，用户看不到多出来的一屏。
 */
describe('采访页的状态追问', () => {
  /** 交卡（睡眠 2、运动 1 都算低）→ 定档 */
  const LOW_SCORES = { mood: 4, sleep: 2, sport: 1, diet: 3 }
  const ready = (scores: Record<string, number>) =>
    setDepth(setStateDone(createInterview(), scores), 'mid')

  it('有低分项时：卡收起来，接着是「状态追问」这一步', () => {
    const html = render({ interview: openBlock(ready(LOW_SCORES), 'probe') })
    expect(html).not.toContain('class="state-card"')
    expect(html).toContain('状态追问')
    expect(html).toContain('分低的那几项，是什么挡着的')
  })

  it('它不占顶部标签：四个词还是四个，状态追问不在其中', () => {
    const html = render({ interview: openBlock(ready(LOW_SCORES), 'probe') })
    expect(html.match(/role="tab"/g)).toHaveLength(4)
    const tabs = html.match(/class="tab-label">([^<]+)</g) ?? []
    expect(tabs.join(' ')).not.toContain('状态追问')
  })

  it('四项都还行：这一步不出现，直接是「上周对账」', () => {
    const html = render({
      interview: openBlock(ready({ mood: 4, sleep: 5, sport: 3, diet: 4 }), 'reconcile'),
    })
    expect(html).not.toContain('状态追问')
    expect(html).toContain('上周对账')
  })

  it('一项都没打分也算「都还行」—— 不能凭空造出一场追问', () => {
    const html = render({ interview: openBlock(ready({}), 'reconcile') })
    expect(html).not.toContain('状态追问')
    expect(html).toContain('上周对账')
  })
})

/**
 * 0.9.5：「这题跳过」。
 *
 * 用户的原话是「我有很多问题是没有感觉的，可以加个没有按键」——
 * 点一下直接过，不发请求、也不在对话里留痕。
 */
describe('采访页的「这题跳过」', () => {
  it('正在聊某一块、这题还没聊完时，按钮就在发送旁边', () => {
    const html = render({ interview: IN_BLOCK })
    expect(html).toContain('这题跳过')
    // 跟「发送」同一排
    const actions = html.slice(
      html.indexOf('class="composer-actions"'),
      html.indexOf('class="quick-jumps"'),
    )
    expect(actions).toContain('这题跳过')
    expect(actions).toContain('发送')
  })

  it('状态卡还没交时不出现（那一屏没有题可跳）', () => {
    expect(render({ interview: ON_CARD })).not.toContain('这题跳过')
  })

  it('定档那一步也不出现', () => {
    expect(render({ interview: ON_DEPTH })).not.toContain('这题跳过')
  })

  it('主问题聊完了就不出现 —— 那时候是自由聊，没有题可跳', () => {
    const done = finishAll(IN_BLOCK)
    expect(render({ interview: done })).not.toContain('这题跳过')
  })

  it('AI 正在回复时按钮是灰的', () => {
    const html = render({ interview: IN_BLOCK, busy: true })
    const at = html.indexOf('这题跳过')
    const button = html.slice(html.lastIndexOf('<button', at), at)
    expect(button).toContain('disabled')
  })

  it('跳过的按钮不写进对话：它只推进状态，不产生气泡', () => {
    // 这一条是渲染层的保证 —— 按钮只是个 button，不会自己往 messages 里塞东西
    const html = render({ interview: IN_BLOCK, messages: CHAT })
    expect(html.match(/class="bubble"/g)).toHaveLength(CHAT.length)
  })
})

/**
 * 0.9.5 后半程：收尾时还差着要点，**不自动补问**，只在输入框上方提示一句。
 *
 * 为什么：真模型实测六个块里四个收尾时都缺要点，而客户端补问只能念锚点原文
 * —— 那正是用户嫌「像念稿」的句子。改成让用户决定。
 */
describe('采访页的「这块还差几样」提示', () => {
  const missed = { dim: 'event' as Dimension, labels: ['有没有一个当时拿不准的决定'] }

  it('提示摆在输入框上方，写清是哪一块、还差几样', () => {
    const html = render({ interview: IN_BLOCK, missed })
    expect(html).toContain('class="missed-hint"')
    expect(html).toContain('「事情」')
    expect(html).toContain('还差 1 样没聊到')
    expect(html).toContain('有没有一个当时拿不准的决定')
    // 位置在 composer 里、输入框之前
    expect(html.indexOf('missed-hint')).toBeLessThan(html.indexOf('<textarea'))
  })

  it('给两个出口：接着补 / 算了', () => {
    const html = render({ interview: IN_BLOCK, missed })
    expect(html).toContain('接着补')
    expect(html).toContain('算了')
  })

  it('没有要补的时候整条不出现', () => {
    expect(render({ interview: IN_BLOCK })).not.toContain('missed-hint')
  })

  it('要补的多于两条时只列前两条，不把提示撑成一长串', () => {
    const html = render({
      interview: IN_BLOCK,
      missed: { dim: 'event', labels: ['要点一', '要点二', '要点三'] },
    })
    expect(html).toContain('还差 3 样没聊到')
    expect(html).toContain('要点一；要点二')
    expect(html).not.toContain('要点三')
  })
})

/**
 * 0.9.9：周中随心记。
 *
 * 用户的原话是「把上面的四栏和下面的还差一步，还有本周梳理可以删掉，然后补充个随心记」——
 * 这一周的采访还没开过头时，对话页整页只有那张随心记卡；开了头就一切照旧。
 */
describe('采访页的随心记落地页', () => {
  const note = (id: string, text: string, at: number): Note => ({
    id,
    at,
    date: '2026-09-28',
    text,
    dim: 'event',
  })

  it('还没开过头：整页只有随心记，四栏 / 打分卡 / 生成按钮一概不在', () => {
    const html = render({ started: false })
    expect(html).toContain('class="notes-card"')
    expect(html).toContain('随心记')
    expect(html).not.toContain('role="tab"')
    expect(html).not.toContain('class="state-card"')
    expect(html).not.toContain('class="stage"')
    expect(html).not.toContain('class="composer"')
    expect(html).not.toContain('生成我的本周梳理')
    expect(html).toContain('开始这周的梳理')
  })

  it('一条都还没记：给一句空态，而不是一张空列表', () => {
    const html = render({ started: false })
    expect(html).toContain('class="notes-empty"')
    expect(html).not.toContain('class="note-item"')
    expect(html).toContain('还没记过')
  })

  it('记过的按最新在上排，每条带日子、原文与自动归的类', () => {
    const html = render({
      started: false,
      notes: [note('n1', '周一那句', 1), note('n2', '周三那句', 3)],
    })
    expect(html).toContain('记了 2 条')
    expect(html.indexOf('周三那句')).toBeLessThan(html.indexOf('周一那句'))
    expect(html).toContain('9月28日')
    expect(html).toContain('class="note-tag"')
    expect(html.match(/class="note-del"/g)).toHaveLength(2)
  })

  it('采访已经开头了就不再回落地页（哪怕一条都没记）', () => {
    const html = render({ started: true })
    expect(html).not.toContain('class="notes-card"')
    expect(html).toContain('class="state-card"')
  })

  it('正在聊某一块时也不出现', () => {
    const html = render({ started: false, interview: IN_BLOCK, messages: CHAT })
    expect(html).not.toContain('class="notes-card"')
    expect(html).toContain('这周主要忙了些什么？')
  })

  it('打分卡与定档这两步不再挂那块空对话区（原来的「还差一步」）', () => {
    for (const interview of [ON_CARD, ON_DEPTH]) {
      const html = render({ interview })
      expect(html).not.toContain('class="stage"')
      expect(html).not.toContain('还差一步')
    }
  })
})
