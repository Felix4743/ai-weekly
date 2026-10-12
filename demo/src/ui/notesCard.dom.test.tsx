// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { createInterview, finishAll, openBlock, setDepth, setStateDone } from '../core/interview'
import type { ChatMessage, Note } from '../core/types'
import { ChatPage } from './ChatPage'

/**
 * 随心记那张卡上的动手部分（0.9.9）。
 *
 * 别处那些 `.render.test.ts` 是静态字符串比对，看不出「敲字回车是不是真的记下了」。
 * 这里要的是 React 的状态与事件，所以跟 `peekRating.dom.test.tsx` 一样顶上写
 * `@vitest-environment jsdom`。
 *
 * 落地页与采访里的抽屉是**同一张卡**：落地页整页就是它，采访里点「记一句」拉出来。
 */

const NOTE: Note = { id: 'n1', at: 1, date: '2026-09-28', text: '椅子到了', dim: 'thing' }

const CHAT: ChatMessage[] = [
  { id: 'm1', role: 'ai', dimension: 'event', text: '这周主要忙了些什么？', at: 1 },
  { id: 'm2', role: 'user', dimension: 'event', text: '在改客户的方案', at: 2 },
] as ChatMessage[]

/** 定完档、正在聊「事情」 */
const IN_BLOCK = openBlock(setDepth(setStateDone(createInterview()), 'mid'), 'event')

let host: HTMLDivElement
let root: Root

beforeEach(() => {
  // jsdom 没有 scrollTo，而 ChatPage 一挂载就会把消息区滚到底 —— 不补上直接炸
  Element.prototype.scrollTo = (() => {}) as typeof Element.prototype.scrollTo
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

type Hooks = {
  added: string[]
  removed: string[]
  started: number
}

function mount(options: { started?: boolean; notes?: Note[]; interview?: typeof IN_BLOCK } = {}) {
  const hooks: Hooks = { added: [], removed: [], started: 0 }
  act(() => {
    root.render(
      <ChatPage
        messages={CHAT}
        typing={false}
        streamText=""
        interview={options.interview ?? createInterview()}
        progress={0}
        busy={false}
        sampleText=""
        hasAnyAnswer
        stateScores={{}}
        stateNote=""
        onOpenBlock={() => {}}
        onSend={() => {}}
        onPickDepth={() => {}}
        onScoreState={() => {}}
        onNoteChange={() => {}}
        onStateDone={() => {}}
        onSkip={() => {}}
        missed={null}
        onReopen={() => {}}
        onDismissMissed={() => {}}
        onStartFresh={() => {}}
        onGenerate={() => {}}
        started={options.started ?? false}
        onStartInterview={() => {
          hooks.started += 1
        }}
        notes={options.notes ?? []}
        onAddNote={(text) => hooks.added.push(text)}
        onRemoveNote={(id) => hooks.removed.push(id)}
      />,
    )
  })
  return hooks
}

function need<T extends Element>(selector: string): T {
  const el = host.querySelector<T>(selector)
  if (!el) throw new Error(`没渲染出 ${selector}`)
  return el
}

/** 往受控输入框里敲字：React 认的是原生 setter + input 事件 */
function type(el: HTMLInputElement, text: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
  act(() => {
    setter?.call(el, text)
    el.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

function press(el: Element, key: string) {
  act(() => {
    el.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }))
  })
}

describe('随心记 · 落地页上手', () => {
  it('敲一句回车就记下了，输入框随之清空', () => {
    const hooks = mount()
    const input = need<HTMLInputElement>('.note-input')

    type(input, '  跟张总通了电话  ')
    press(input, 'Enter')

    expect(hooks.added).toEqual(['跟张总通了电话'])
    expect(need<HTMLInputElement>('.note-input').value).toBe('')
  })

  it('空着的时候「记下」是灰的，敲了字才点得动', () => {
    const hooks = mount()
    const button = need<HTMLButtonElement>('.note-composer .btn')
    expect(button.disabled).toBe(true)

    type(need<HTMLInputElement>('.note-input'), '椅子到了')
    expect(need<HTMLButtonElement>('.note-composer .btn').disabled).toBe(false)

    act(() => need<HTMLButtonElement>('.note-composer .btn').click())
    expect(hooks.added).toEqual(['椅子到了'])
  })

  it('只敲空格不算一条，回车也不提交', () => {
    const hooks = mount()
    const input = need<HTMLInputElement>('.note-input')
    type(input, '   ')
    press(input, 'Enter')
    expect(hooks.added).toEqual([])
  })

  it('每条后面的叉点了就把那一条删掉，删的是它的 id', () => {
    const hooks = mount({ notes: [NOTE, { ...NOTE, id: 'n2', text: '快递到了' }] })
    const kills = host.querySelectorAll<HTMLButtonElement>('.note-del')
    expect(kills).toHaveLength(2)

    act(() => kills[1].click())
    expect(hooks.removed).toEqual(['n2'])
  })

  it('「开始这周的梳理」点一下就进采访', () => {
    const hooks = mount()
    const start = [...host.querySelectorAll<HTMLButtonElement>('.notes-foot .btn')][0]
    act(() => start.click())
    expect(hooks.started).toBe(1)
  })
})

describe('随心记 · 采访里的抽屉', () => {
  it('采访页默认没有那张卡，四栏与发送框都在', () => {
    mount({ started: true, interview: IN_BLOCK })
    expect(host.querySelector('.notes-card')).toBeNull()
    expect(host.querySelector('.notes-drawer')).toBeNull()
    expect(host.querySelectorAll('[role="tab"]').length).toBe(4)
    expect(host.querySelector('.composer')).not.toBeNull()
  })

  it('点「记一句」拉出来，再点收回去，并记下展开状态', () => {
    mount({ started: true, interview: IN_BLOCK })
    const chip = [...host.querySelectorAll<HTMLButtonElement>('.quick-jumps .btn')].find((b) =>
      b.textContent?.includes('记一句'),
    )
    expect(chip).toBeTruthy()

    act(() => chip!.click())
    expect(host.querySelector('.notes-drawer .notes-card')).not.toBeNull()
    expect(chip!.getAttribute('aria-expanded')).toBe('true')

    act(() => chip!.click())
    expect(host.querySelector('.notes-drawer')).toBeNull()
    expect(chip!.getAttribute('aria-expanded')).toBe('false')
  })

  it('抽屉里记的那一句，跟落地页走的是同一条路', () => {
    const hooks = mount({ started: true, interview: IN_BLOCK, notes: [NOTE] })
    const chip = [...host.querySelectorAll<HTMLButtonElement>('.quick-jumps .btn')].find((b) =>
      b.textContent?.includes('记一句'),
    )
    act(() => chip!.click())

    // 抽屉里那一句已经在了
    expect(need('.notes-drawer .note-text').textContent).toBe('椅子到了')
    type(need<HTMLInputElement>('.notes-drawer .note-input'), '顺手记一条')
    press(need('.notes-drawer .note-input'), 'Enter')
    expect(hooks.added).toEqual(['顺手记一条'])
  })

  it('抽屉里那份是「紧凑版」：底下不再摆开始按钮，右上角换成收起来', () => {
    mount({ started: true, interview: IN_BLOCK, notes: [NOTE] })
    const chip = [...host.querySelectorAll<HTMLButtonElement>('.quick-jumps .btn')].find((b) =>
      b.textContent?.includes('记一句'),
    )
    act(() => chip!.click())

    expect(host.querySelector('.notes-drawer .notes-foot')).toBeNull()
    expect(host.querySelector('.notes-drawer')?.textContent).not.toContain('开始这周的梳理')

    act(() => need<HTMLButtonElement>('.note-close').click())
    expect(host.querySelector('.notes-drawer')).toBeNull()
  })

  it('聊完了四块，抽屉还能拉出来（这一周里随时能补记）', () => {
    mount({ started: true, interview: finishAll(IN_BLOCK) })
    const chip = [...host.querySelectorAll<HTMLButtonElement>('.quick-jumps .btn')].find((b) =>
      b.textContent?.includes('记一句'),
    )
    act(() => chip!.click())
    expect(host.querySelector('.notes-drawer .notes-card')).not.toBeNull()
  })
})
