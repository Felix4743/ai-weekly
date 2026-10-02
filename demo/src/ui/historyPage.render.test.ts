import * as React from 'react'
import { Fragment, createElement, type ComponentProps, type ReactElement, type ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'
import type { WeekEntry } from '../core/archive'
import { stampText, timeAgo } from '../core/recency'
import type { Review } from '../core/review'
import {
  addWeeks,
  dayLabel,
  daysOfWeek,
  monthOf,
  weekKeyOf,
  weekRangeText,
  weeksInMonth,
  weekTitle,
} from '../core/week'
import { HistoryPage } from './HistoryPage'

/**
 * 总览页的渲染测试。
 *
 * 这个仓库的界面测试原本只有 `react-dom/server` 一条路（`vite.config.ts` 里
 * environment 是 `node`，没装 jsdom / @testing-library），静态 HTML 能验文案、
 * 验不了「点一下会怎样」。总览页最要紧的恰恰是那些「点一下」：翻最近三周、
 * 点月历、点全部记录、挪错周 —— 所以下面搭了一个**最小渲染器**（只认函数组件
 * 与宿主元素，hooks 直接喂给 React，状态按「组件名 + 第几次出现」存着，
 * 重渲染就再走一遍），对外长得像 testing-library：`render` / `screen` / `fireEvent`。
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

/** 函数组件要用到的几个 hook；没实现的（useContext 之类）这个页面也没用 */
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
        // 和 React 一样：设进去的还是同一个值就什么都不做
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
const DAY = 24 * 60 * 60 * 1000
const REPEAT_KEY = '报价拖延'

function entry(week: string, overrides: Partial<WeekEntry> = {}): WeekEntry {
  return { week, savedAt: NOW.getTime(), notes: '那一周写下的原文', review: null, ...overrides }
}

function review(overrides: Partial<Review> = {}): Review {
  return {
    headline: '这周把报价单发出去了',
    did: ['把报价单发出去', '把上周的评审补完'],
    issues: [{ text: '报价又拖到周四才发', advice: ['周二之前定稿'], key: REPEAT_KEY }],
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
function olderWithRepeatKey(week: string): WeekEntry {
  return entry(week, {
    review: review({
      headline: '',
      did: [],
      reconcile: [],
      plan: [],
      nudge: '',
      issues: [{ text: '老问题', advice: [], key: REPEAT_KEY }],
    }),
  })
}

type HistoryProps = ComponentProps<typeof HistoryPage>

function mount(overrides: Partial<HistoryProps> = {}): HistoryProps {
  const props: HistoryProps = {
    archive: [],
    onArchiveChange: vi.fn(),
    onBack: vi.fn(),
    onOpenWeek: vi.fn(),
    ...overrides,
  }
  render(createElement(HistoryPage, props))
  return props
}

describe('总览页', () => {
  it('在总览里删掉一条，也记下「删过什么」—— 下次重新整理不能带回来', () => {
    const props = mount({ archive: [entry(THIS_WEEK, { review: review() })] })

    // 详情里「做了什么」的第一条
    const del = only(
      collect((node) => node.props.title === '删除'),
      '删除按钮',
    )
    fireEvent.click(del)

    expect(props.onArchiveChange).toHaveBeenCalledTimes(1)
    const next = vi.mocked(props.onArchiveChange).mock.calls[0][0]
    const saved = next.find((item) => item.week === THIS_WEEK)
    expect(saved?.review?.did).toEqual(['把上周的评审补完'])
    expect(saved?.dropped).toEqual(['把报价单发出去'])
  })

  it('一份只剩对账项的复盘，不会被说成「还没复盘」', () => {
    mount({
      archive: [
        entry(THIS_WEEK, {
          review: review({
            headline: '',
            did: [],
            issues: [],
            plan: [],
            nudge: '',
            reconcile: [{ text: '把提案写完', state: 'done', note: '周一就交了' }],
          }),
        }),
      ],
    })

    expect(screen.text()).toContain('对账 1 条')
    expect(screen.text()).not.toContain('还没复盘')
  })

  it('一份记录都没有时，说清楚这里为什么还空着', () => {
    const props = mount({ archive: [] })
    expect(screen.text()).toContain('还没有记录。复盘完一周，那一周就会出现在这里')
    expect(screen.getByText('这周写两句，下周就能在这儿看到它。')).toBeTruthy()
    expect(screen.queryByText('找一周')).toBeNull()
    expect(screen.queryByText('全部记录')).toBeNull()

    fireEvent.click(screen.getByText('复盘这周'))
    expect(props.onOpenWeek).toHaveBeenCalledWith(THIS_WEEK)
  })

  it('写着「上次记录 3 天前」，鼠标停上去能看到具体时刻', () => {
    const at = NOW.getTime() - 3 * DAY
    mount({ archive: [entry(LAST_WEEK, { savedAt: at, notes: '上周写了点东西' })] })

    const line = screen.getByText(`上次记录 ${timeAgo(at, NOW.getTime())}`)
    expect(line.props.title).toBe(stampText(at))
    expect(screen.text()).toContain('已经记了 1 周')
  })

  it('点最近三周卡就翻到那一周的详情', () => {
    mount({
      archive: [entry(LAST_WEEK, { review: review() }), entry(TWO_AGO, { notes: '上上周只写了原文' })],
    })
    expect(screen.getByText('这一周没有记录。')).toBeTruthy()

    fireEvent.click(screen.getByText(weekRangeText(LAST_WEEK)))

    expect(screen.getByText('改这一周')).toBeTruthy()
    expect(screen.getByText('做了 2 件')).toBeTruthy()
    expect(screen.queryByText('这一周没有记录。')).toBeNull()
  })

  it('点月历上的某一天也翻到那一周', () => {
    const target = weeksInMonth(monthOf(NOW)).filter((week) => week !== THIS_WEEK)[0]
    mount({ archive: [entry(target, { review: review({ did: ['一', '二', '三'] }) })] })
    expect(screen.getByText('这一周没有记录。')).toBeTruthy()

    fireEvent.click(screen.getByLabel(`${dayLabel(daysOfWeek(target)[0])}（${weekRangeText(target)}）`))

    expect(screen.getByText('做了 3 件')).toBeTruthy()
  })

  it('点全部记录里的一行也翻到那一周', () => {
    const notes =
      '上上周只写了原文，没来得及复盘。这一句写得很长，长到列表里只会露出前面一小截，' +
      '剩下的那半句只有进了详情才看得见。'
    mount({ archive: [entry(THIS_WEEK, { review: review() }), entry(TWO_AGO, { notes })] })

    fireEvent.click(screen.getByText(weekTitle(TWO_AGO, NOW)))

    expect(screen.getByText('这一周只写了原文，还没复盘。')).toBeTruthy()
    expect(screen.getByText(notes)).toBeTruthy()
    expect(screen.getByText('去写这一周')).toBeTruthy()
  })

  it('选中周的详情把复盘的五段都摆出来', () => {
    mount({
      archive: [
        entry(THIS_WEEK, { review: review() }),
        olderWithRepeatKey(LAST_WEEK),
        olderWithRepeatKey(TWO_AGO),
      ],
    })

    expect(screen.getByText('这周把报价单发出去了')).toBeTruthy()
    expect(screen.getByText('把报价单发出去')).toBeTruthy()
    expect(screen.getByText('把上周的评审补完')).toBeTruthy()
    expect(screen.getByText('报价又拖到周四才发')).toBeTruthy()
    expect(screen.getByText(REPEAT_KEY)).toBeTruthy()
    expect(screen.getByText('第 3 次出现')).toBeTruthy()
    expect(screen.getByText('周二之前定稿')).toBeTruthy()
    expect(screen.getByText('做了')).toBeTruthy()
    expect(screen.getByText('做了一半')).toBeTruthy()
    expect(screen.getByText('没提到')).toBeTruthy()
    expect(screen.getByText('把合同定下来')).toBeTruthy()
    expect(screen.getByText('下周三')).toBeTruthy()
    expect(screen.getByText('做了 2 件')).toBeTruthy()
  })

  it('选到没记录的那一周时，就说这一周没有记录', () => {
    mount({ archive: [entry(LAST_WEEK, { review: review() })] })

    expect(screen.getByText(weekTitle(THIS_WEEK, NOW))).toBeTruthy()
    expect(screen.getByText('这一周没有记录。')).toBeTruthy()
    expect(screen.getByText('去写这一周')).toBeTruthy()
  })

  it('点「去写这一周」时交出去的是选中的那一周', () => {
    const props = mount({
      archive: [entry(THIS_WEEK, { review: review() }), entry(TWO_AGO, { notes: '上上周只写了原文' })],
    })

    fireEvent.click(screen.getByText(weekTitle(TWO_AGO, NOW)))
    fireEvent.click(screen.getByText('去写这一周'))

    expect(props.onOpenWeek).toHaveBeenCalledWith(TWO_AGO)
  })

  it('挪到上一周挪成了，就把改写后的归档交出去', () => {
    const props = mount({ archive: [entry(LAST_WEEK, { notes: '上周只写了原文' })] })
    fireEvent.click(screen.getByText(weekRangeText(LAST_WEEK)))

    const up = screen.getByText('挪到上一周')
    expect(up.props.disabled).toBe(false)
    fireEvent.click(up)

    expect(props.onArchiveChange).toHaveBeenCalledWith([
      expect.objectContaining({ week: TWO_AGO, notes: '上周只写了原文', review: null }),
    ])
  })

  it('目标那一周已经有记录时，「挪到上一周」点不动', () => {
    const props = mount({
      archive: [entry(LAST_WEEK, { notes: '上周' }), entry(TWO_AGO, { notes: '上上周' })],
    })
    fireEvent.click(screen.getByText(weekRangeText(LAST_WEEK)))

    const up = screen.getByText('挪到上一周')
    expect(up.props.disabled).toBe(true)
    fireEvent.click(up)

    expect(props.onArchiveChange).not.toHaveBeenCalled()
  })

  it('会挪到未来去的时候，「挪到下一周」点不动', () => {
    const props = mount({ archive: [entry(THIS_WEEK, { notes: '这周' })] })

    const down = screen.getByText('挪到下一周')
    expect(down.props.disabled).toBe(true)
    expect(screen.getByText('挪到上一周').props.disabled).toBe(false)
    fireEvent.click(down)

    expect(props.onArchiveChange).not.toHaveBeenCalled()
  })
})
