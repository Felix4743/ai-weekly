import * as React from 'react'
import { Fragment, createElement, type ComponentProps, type ReactElement, type ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'
import type { WeekEntry } from '../core/archive'
import type { Review } from '../core/review'
import { addWeeks, weekKeyOf } from '../core/week'
import { JournalPage } from './JournalPage'

/**
 * 复盘页的渲染测试。
 *
 * 这个仓库的界面测试原本只有 `react-dom/server` 一条路（`vite.config.ts` 里
 * environment 是 `node`，没装 jsdom / @testing-library），静态 HTML 能验文案、
 * 验不了「点一下会怎样」。复盘页最要紧的恰恰是那些「点一下」：写原文、接着说、
 * 改清单 —— 所以下面搭了一个**最小渲染器**（只认函数组件与宿主元素，
 * hooks 直接喂给 React，状态按「组件名 + 第几次出现」存着，重渲染就再走一遍），
 * 对外长得像 testing-library：`render` / `screen` / `fireEvent`。
 *
 * 一条规矩：断言只写用户看得见的东西 —— 文案、可点性、disabled、交出去的回调参数。
 * 类名只在「同一句话页面上出现了好几次」时用来定位。
 */

/* ---------------- 最小渲染器 ---------------- */

interface TreeNode {
  tag: string
  props: Record<string, unknown>
  children: TreeNode[]
  parent: TreeNode | null
  text: string
}

interface Cell {
  value?: unknown
  deps?: readonly unknown[]
}

const store = new Map<string, Cell[]>()
const counters = new Map<string, number>()
let pendingEffects: (() => void)[] = []
let dirty = false
let rootElement: ReactElement | null = null
let tree: TreeNode[] = []

const ReactInternals = (
  React as unknown as {
    __SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED: {
      ReactCurrentDispatcher: { current: unknown }
    }
  }
).__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED

function sameDeps(prev: readonly unknown[] | undefined, next: readonly unknown[] | undefined): boolean {
  if (!prev || !next || prev.length !== next.length) return false
  return prev.every((value, index) => Object.is(value, next[index]))
}

/** 函数组件要用到的几个 hook；没实现的（useContext 之类）这两个页面也没用 */
function dispatcherFor(cells: Cell[]) {
  let cursor = 0
  const next = (): Cell => {
    const index = cursor++
    const cell = cells[index] ?? {}
    cells[index] = cell
    return cell
  }

  return {
    useState(initial: unknown) {
      const cell = next()
      if (!('value' in cell)) {
        cell.value = typeof initial === 'function' ? (initial as () => unknown)() : initial
      }
      const set = (update: unknown) => {
        const value =
          typeof update === 'function' ? (update as (prev: unknown) => unknown)(cell.value) : update
        // 和 React 一样：设进去的还是同一个值就什么都不做，免得 effect 里死循环
        if (Object.is(value, cell.value)) return
        cell.value = value
        dirty = true
      }
      return [cell.value, set]
    },
    useMemo(factory: () => unknown, deps?: readonly unknown[]) {
      const cell = next()
      if (!sameDeps(cell.deps, deps)) {
        cell.value = factory()
        cell.deps = deps
      }
      return cell.value
    },
    useRef(initial: unknown) {
      const cell = next()
      if (!('value' in cell)) cell.value = { current: initial }
      return cell.value
    },
    useEffect(effect: () => void, deps?: readonly unknown[]) {
      const cell = next()
      if (!sameDeps(cell.deps, deps)) {
        cell.deps = deps
        pendingEffects.push(effect)
      }
    },
  }
}

function renderComponent(
  component: (props: Record<string, unknown>) => ReactNode,
  props: Record<string, unknown>,
): ReactNode {
  const name = component.name || '匿名组件'
  const index = counters.get(name) ?? 0
  counters.set(name, index + 1)
  const key = `${name}#${index}`
  const cells = store.get(key) ?? []
  store.set(key, cells)

  const previous = ReactInternals.ReactCurrentDispatcher.current
  ReactInternals.ReactCurrentDispatcher.current = dispatcherFor(cells)
  try {
    return component(props)
  } finally {
    ReactInternals.ReactCurrentDispatcher.current = previous
  }
}

function expand(node: ReactNode, parent: TreeNode | null, out: TreeNode[]): void {
  if (node === null || node === undefined || typeof node === 'boolean') return
  if (Array.isArray(node)) {
    for (const child of node) expand(child as ReactNode, parent, out)
    return
  }
  if (typeof node === 'string' || typeof node === 'number') {
    out.push({ tag: '#text', props: {}, children: [], parent, text: String(node) })
    return
  }

  const element = node as ReactElement<Record<string, unknown>>
  if (element.type === Fragment) {
    expand(element.props.children as ReactNode, parent, out)
    return
  }
  if (typeof element.type === 'function') {
    const rendered = renderComponent(
      element.type as (props: Record<string, unknown>) => ReactNode,
      element.props,
    )
    expand(rendered, parent, out)
    return
  }

  const box: TreeNode = { tag: String(element.type), props: element.props, children: [], parent, text: '' }
  out.push(box)
  expand(element.props.children as ReactNode, box, box.children)
}

function pass(): void {
  counters.clear()
  pendingEffects = []
  dirty = false
  tree = []
  if (rootElement) expand(rootElement, null, tree)
  const running = pendingEffects
  pendingEffects = []
  for (const effect of running) effect()
}

function settle(): void {
  let guard = 0
  while (dirty && guard++ < 20) pass()
}

function render(ui: ReactElement): void {
  store.clear()
  rootElement = ui
  pass()
  settle()
}

function flat(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

/** 一个元素自己那段字（不含子元素里的），这样才能精确到「就是这一句话」 */
function ownText(node: TreeNode): string {
  if (node.tag === '#text') return node.text
  return node.children
    .filter((child) => child.tag === '#text')
    .map((child) => child.text)
    .join('')
}

function textOf(nodes: TreeNode[]): string {
  return nodes.map((node) => (node.tag === '#text' ? node.text : textOf(node.children))).join('')
}

function collect(predicate: (node: TreeNode) => boolean): TreeNode[] {
  const found: TreeNode[] = []
  const walk = (nodes: TreeNode[]) => {
    for (const node of nodes) {
      if (predicate(node)) found.push(node)
      walk(node.children)
    }
  }
  walk(tree)
  return found
}

function byText(text: string): TreeNode[] {
  return collect((node) => node.tag !== '#text' && flat(ownText(node)) === flat(text))
}

function only(hits: TreeNode[], what: string): TreeNode {
  if (hits.length === 0) throw new Error(`页面上找不到${what}`)
  return hits[0]
}

const screen = {
  /** 整页看得见的字（收起的那部分不在里面，和真渲染一致） */
  text: (): string => flat(textOf(tree)),
  getByText(text: string): TreeNode {
    return only(byText(text), `「${text}」`)
  },
  queryByText(text: string): TreeNode | null {
    return byText(text)[0] ?? null
  },
  getByTag(tag: string): TreeNode {
    return only(
      collect((node) => node.tag === tag),
      `<${tag}>`,
    )
  },
  getByPlaceholder(text: string): TreeNode {
    return only(
      collect((node) => node.props.placeholder === text),
      `占位符为「${text}」的输入框`,
    )
  },
  getByLabel(label: string): TreeNode {
    return only(
      collect((node) => node.props['aria-label'] === label),
      `aria-label 为「${label}」的控件`,
    )
  },
}

function fire(target: TreeNode, name: string, event: unknown): void {
  let node: TreeNode | null = target
  while (node && typeof node.props[name] !== 'function') node = node.parent
  if (!node) throw new Error(`「${flat(ownText(target)) || target.tag}」上没有 ${name}`)
  // 真浏览器里禁用按钮根本不派发点击
  if (name === 'onClick' && node.props.disabled === true) return
  ;(node.props[name] as (event: unknown) => void)(event)
  settle()
}

const fireEvent = {
  click(target: TreeNode): void {
    fire(target, 'onClick', { preventDefault() {}, stopPropagation() {} })
  },
  change(target: TreeNode, value: string): void {
    fire(target, 'onChange', { target: { value } })
  },
  keyDown(target: TreeNode, key: string): void {
    fire(target, 'onKeyDown', {
      key,
      preventDefault() {},
      stopPropagation() {},
      // 真浏览器里 blur() 会派发 onBlur —— 清单编辑正是靠它提交的
      currentTarget: { blur: () => fire(target, 'onBlur', {}) },
    })
  },
}

/* ---------------- 夹具 ---------------- */

const NOW = new Date()
const THIS_WEEK = weekKeyOf(NOW)
const LAST_WEEK = addWeeks(THIS_WEEK, -1)
const TWO_AGO = addWeeks(THIS_WEEK, -2)

const REPEAT_KEY = '报价拖延'

function review(overrides: Partial<Review> = {}): Review {
  return {
    headline: '这周把报价单发出去了',
    did: ['把报价单发出去', '把上周的评审补完'],
    issues: [
      { text: '报价又拖到周四才发', advice: ['周二之前定稿'], key: REPEAT_KEY },
    ],
    reconcile: [
      { text: '把提案写完', state: 'done', note: '周一就交了' },
      { text: '整理评审记录', state: 'partial', note: '只理了一半' },
      { text: '给客户回电话', state: 'unmentioned', note: '' },
    ],
    plan: [{ text: '把合同定下来', when: '下周三' }],
    nudge: '这周身体怎么样？',
    ...overrides,
  }
}

/** 前两周都记过同一个标签，所以这周是「第 3 次出现」 */
function archiveWithRepeat(): WeekEntry[] {
  const past = (week: string, savedAt: number): WeekEntry => ({
    week,
    savedAt,
    notes: '那一周也写了原文',
    review: review({
      headline: '',
      did: [],
      reconcile: [],
      plan: [],
      nudge: '',
      issues: [{ text: '老问题', advice: [], key: REPEAT_KEY }],
    }),
  })
  return [past(LAST_WEEK, NOW.getTime()), past(TWO_AGO, NOW.getTime())]
}

type JournalProps = ComponentProps<typeof JournalPage>

function mount(overrides: Partial<JournalProps> = {}): JournalProps {
  const props: JournalProps = {
    week: THIS_WEEK,
    notes: '',
    review: null,
    reply: '',
    archive: [],
    analyzing: false,
    onNotesChange: vi.fn(),
    onAnalyze: vi.fn(),
    onFollowUp: vi.fn(),
    onReviewChange: vi.fn(),
    onOpenHistory: vi.fn(),
    ...overrides,
  }
  render(createElement(JournalPage, props))
  return props
}

describe('复盘页', () => {
  it('还没复盘时，是一张写原文的大纸加一个「开始复盘」', () => {
    mount()
    expect(screen.text()).toContain('这一周发生了什么')
    expect(screen.getByText('开始复盘')).toBeTruthy()
    expect(screen.getByTag('textarea').props.value).toBe('')
  })

  it('原文空着时「开始复盘」点不动，写了原文才交出去', () => {
    const props = mount()
    expect(screen.getByText('开始复盘').props.disabled).toBe(true)

    fireEvent.change(screen.getByTag('textarea'), '这周把报价单发出去了')
    expect(props.onNotesChange).toHaveBeenCalledWith('这周把报价单发出去了')

    mount({ notes: '已经写了两句' })
    expect(screen.getByText('开始复盘').props.disabled).toBe(false)
    expect(screen.text()).toContain('6 字')
  })

  it('第一次复盘时按钮自己写着「正在复盘…」，不让人再点一下', () => {
    mount({ notes: '写了两句', analyzing: true })
    expect(screen.getByText('正在复盘…').props.disabled).toBe(true)
  })

  it('已经有结论又跑了一次时，另起一张卡说明正在复盘这一周', () => {
    mount({ review: review(), notes: '这周的原文', analyzing: true })
    expect(screen.text()).toContain('正在复盘这一周…')
  })

  it('复盘出来之后，一句话、做了什么、问题与建议都摆出来', () => {
    mount({ review: review(), notes: '这周的原文' })
    expect(screen.text()).toContain('这周把报价单发出去了')
    expect(screen.getByText('把报价单发出去')).toBeTruthy()
    expect(screen.getByText('把上周的评审补完')).toBeTruthy()
    expect(screen.getByText('报价又拖到周四才发')).toBeTruthy()
    expect(screen.getByText('周二之前定稿')).toBeTruthy()
  })

  it('同一个问题标签前两周都出现过时，说清楚这是第几次', () => {
    mount({ review: review(), archive: archiveWithRepeat(), notes: '这周的原文' })
    expect(screen.getByText(REPEAT_KEY)).toBeTruthy()
    expect(screen.getByText('第 3 次出现')).toBeTruthy()
  })

  it('上周对账的三条状态说的是中文', () => {
    mount({ review: review(), notes: '这周的原文' })
    expect(screen.getByText('做了')).toBeTruthy()
    expect(screen.getByText('做了一半')).toBeTruthy()
    expect(screen.getByText('没提到')).toBeTruthy()
    expect(screen.getByText('把提案写完')).toBeTruthy()
  })

  it('下周计划连「什么时候」一起摆着', () => {
    mount({ review: review(), notes: '这周的原文' })
    expect(screen.getByText('把合同定下来')).toBeTruthy()
    expect(screen.getByText('下周三')).toBeTruthy()
  })

  it('AI 的回应和补漏提醒都摆出来', () => {
    mount({ review: review(), reply: '好，那我把这一段也记上了', notes: '这周的原文' })
    expect(screen.getByText('好，那我把这一段也记上了')).toBeTruthy()
    expect(screen.getByText('这周身体怎么样？')).toBeTruthy()
  })

  it('复盘出来之后原文先收起来，点一下还能展开', () => {
    mount({ review: review(), notes: '这周的原文' })
    expect(screen.text()).toContain('你写的原文')
    expect(screen.text()).not.toContain('这周的原文')

    fireEvent.click(screen.getByText('你写的原文'))
    expect(screen.getByTag('textarea').props.value).toBe('这周的原文')
  })

  it('「接着说」写一句回车，就把这一句交出去', () => {
    const props = mount({ review: review(), notes: '这周的原文' })
    fireEvent.change(screen.getByPlaceholder('再补一句…'), '这周还和同事吃了顿饭')
    fireEvent.keyDown(screen.getByPlaceholder('再补一句…'), 'Enter')
    expect(props.onFollowUp).toHaveBeenCalledWith('这周还和同事吃了顿饭')
    // 交出去之后输入框自己清空，接着还能再补
    expect(screen.getByPlaceholder('再补一句…').props.value).toBe('')
  })

  it('改「做了什么」里的一条，交出去的是改过的那一份复盘', () => {
    const props = mount({ review: review(), notes: '这周的原文' })

    fireEvent.click(screen.getByText('把报价单发出去'))
    fireEvent.change(screen.getByPlaceholder('这一周做了什么'), '把报价单发出去并且抄送了老板')
    fireEvent.keyDown(screen.getByPlaceholder('这一周做了什么'), 'Enter')

    expect(props.onReviewChange).toHaveBeenCalledWith({
      ...review(),
      did: ['把报价单发出去并且抄送了老板', '把上周的评审补完'],
    })
  })
})
