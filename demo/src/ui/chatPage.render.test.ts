import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { createInterview, openBlock } from '../core/interview'
import { stateField } from '../core/stateFields'
import type { ChatMessage, InterviewState, StateKey, StateScores } from '../core/types'
import { ChatPage } from './ChatPage'

/** 某一项的「点个星？」那句话（拿不到就直接炸，免得断言在空串上假绿） */
function askOf(key: StateKey): string {
  const field = stateField(key)
  if (!field) throw new Error(`状态里没有这一项：${key}`)
  return field.ask
}

/**
 * 采访页那排星（0.9.2）。
 *
 * 这页里有 hooks，所以只能走 `renderToStaticMarkup` 渲染一份 HTML 来看 —— 点星的动作
 * 由 StateScore / 结果页那两组测试兜住，这里管的是「哪条回答下面才挂星、挂的是哪一项」。
 */

function msg(patch: Partial<ChatMessage> & { id: string; role: ChatMessage['role'] }): ChatMessage {
  return { text: '……', ...patch } as ChatMessage
}

const QUESTION = msg({ id: 'm1', role: 'ai', dimension: 'mood', text: '这周身体怎么样？' })
const ANSWER = msg({
  id: 'm2',
  role: 'user',
  dimension: 'mood',
  stateKey: 'mood',
  text: '有点累，睡得晚',
})

function render(options: {
  messages?: ChatMessage[]
  interview?: InterviewState
  stateScores?: StateScores
  busy?: boolean
}) {
  const interview = options.interview ?? openBlock(createInterview(), 'mood')
  return renderToStaticMarkup(
    createElement(ChatPage, {
      messages: options.messages ?? [QUESTION, ANSWER],
      typing: false,
      streamText: '',
      interview,
      progress: 0,
      busy: options.busy ?? false,
      sampleText: '',
      hasAnyAnswer: true,
      stateScores: options.stateScores ?? {},
      onOpenBlock: () => {},
      onSend: () => {},
      onPickDepth: () => {},
      onScoreState: () => {},
      onGenerate: () => {},
    }),
  )
}

describe('采访页的状态评分', () => {
  it('状态那一条回答下面挂一排星，旁边写着问的是哪一项', () => {
    const html = render({})
    expect(html.match(/class="state-score"/g)).toHaveLength(1)
    expect(html.match(/class="star"/g)).toHaveLength(5)
    expect(html).toContain(askOf('mood'))
    // 还没点过：显示「未打分」，一颗都不亮
    expect(html).toContain('未打分')
    expect(html.match(/class="star on"/g)).toBeNull()
  })

  it('别的回答（没挂键的那些）不带星', () => {
    const html = render({
      messages: [
        QUESTION,
        msg({ id: 'm3', role: 'user', dimension: 'mood', text: '就这些' }),
        ANSWER,
      ],
    })
    // 两条用户回答里只有带 stateKey 的那条有星
    expect(html.match(/class="state-score"/g)).toHaveLength(1)
  })

  it('点过的分在采访页也亮着，写着几分', () => {
    const html = render({ stateScores: { mood: 3 } })
    expect(html.match(/class="star on"/g)).toHaveLength(3)
    expect(html).toContain('3 / 5')
    expect(html).not.toContain('未打分')
  })

  it('四项各挂自己那一排，分不会串行', () => {
    const messages = [
      msg({ id: 'a1', role: 'ai', dimension: 'mood', text: '身体？' }),
      msg({ id: 'a2', role: 'user', dimension: 'mood', stateKey: 'body', text: '还行' }),
      msg({ id: 'a3', role: 'ai', dimension: 'mood', text: '情绪？' }),
      msg({ id: 'a4', role: 'user', dimension: 'mood', stateKey: 'mood', text: '有点烦' }),
    ]
    const html = render({ messages, stateScores: { body: 4, mood: 1 } })
    expect(html.match(/class="state-score"/g)).toHaveLength(2)
    expect(html).toContain(askOf('body'))
    expect(html).toContain(askOf('mood'))
    expect(html).not.toContain(askOf('focus'))
    // 4 + 1 颗亮着，「4 / 5」和「1 / 5」各一处
    expect(html.match(/class="star on"/g)).toHaveLength(5)
    expect(html).toContain('4 / 5')
    expect(html).toContain('1 / 5')
  })

  it('AI 正在回复时星星先禁用，免得点在半路上', () => {
    const idle = render({})
    expect(idle.match(/class="star"[^>]*disabled/g)).toBeNull()
    const busy = render({ busy: true })
    expect(busy.match(/class="star"[^>]*disabled/g)).toHaveLength(5)
  })
})
