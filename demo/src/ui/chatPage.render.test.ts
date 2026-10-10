import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { createInterview, openBlock, setDepth, setStateDone } from '../core/interview'
import { STATE_FIELDS } from '../core/stateFields'
import type { ChatMessage, InterviewState, StateScores } from '../core/types'
import { ChatPage } from './ChatPage'

/**
 * 采访页（0.9.3）。
 *
 * 0.9.2 的时候星星是挂在「状态那一段的每条回答」下面的；0.9.3 起状态是一张
 * **开场的打分卡**：先打完四项、再定档，然后才进内容块。点星的动作由
 * StateScore 与结果页那两组测试兜住，这里管的是「卡片什么时候出现、
 * 四排星各是哪一项、交卡之后问的是不是定档」。
 */

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
      onStartFresh: () => {},
      onGenerate: () => {},
    }),
  )
}

describe('采访页的状态卡', () => {
  it('一进来先给状态卡：心情、睡眠、运动、饮食各一排星', () => {
    const html = render({})
    expect(html).toContain('class="state-card"')
    expect(html.match(/class="state-score"/g)).toHaveLength(4)
    expect(html.match(/class="star"/g)).toHaveLength(20)
    for (const field of STATE_FIELDS) {
      expect(html).toContain(`>${field.label}<`)
      expect(html).toContain(field.ask)
    }
    // 还没点过：四排都是「未打分」，一颗都不亮
    expect(html.match(/未打分/g)).toHaveLength(4)
    expect(html.match(/class="star on"/g)).toBeNull()
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
    expect(html.match(/class="star on"/g)).toHaveLength(6)
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
    expect(html).not.toContain('class="star"')
    expect(html).toContain('这周主要忙了些什么？')
  })

  it('AI 正在回复时，星和卡片按钮一起禁用', () => {
    const idle = render({})
    expect(idle.match(/class="star"[^>]*disabled/g)).toBeNull()
    const busy = render({ busy: true })
    expect(busy.match(/class="star"[^>]*disabled/g)).toHaveLength(20)
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
