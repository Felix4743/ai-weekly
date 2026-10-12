import { createElement, isValidElement, type ReactElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { WeekEntry } from '../core/archive'
import { countSection } from '../core/outline'
import { attachState, SCORE_MAX } from '../core/stateScore'
import { compareScores, previousEntry, recurringPatterns } from '../core/trends'
import { createEmptyResult, createEmptyState, type ChatMessage, type WeeklyResult } from '../core/types'
import { ALL_COLLAPSED } from './CollapsibleCard'
import { PeekRating } from './PeekRating'
import { StateScore } from './StateScore'
import { ResultBody } from './ResultBody'
import { ResultPage } from './ResultPage'

const result: WeeklyResult = {
  // 从空结果起手再覆盖：以后再加一栏时，这里不用跟着一条条补
  ...createEmptyResult(),
  events: ['改了三版方案'],
  people: [{ name: '老王', note: '卡在他那儿' }],
  things: ['买了个键盘'],
  pending: ['报销拖了两周'],
  growth: ['读完了《长日将尽》'],
  // 点了两项分，另外写了一条备注
  state: attachState({ mood: 4, sleep: 2 }, '这周一直悬着'),
  highlights: ['这周基本被方案拖着', '累的来源是等和反复'],
  nextFocus: ['推动定稿'],
  nextFollowUps: ['老王'],
}

/** 状态那四项的标签，顺序就是界面上的顺序 */
const STATE_LABELS = ['心情', '睡眠', '运动', '饮食']

/** 默认不给归档：没有更早的记录时，「上周对比」和「反复出现」都该什么都不显示 */
function render(current: WeeklyResult = result, archive: WeekEntry[] = []) {
  return renderToStaticMarkup(
    createElement(ResultPage, {
      result: current,
      archive,
      messages: [] as ChatMessage[],
      restored: false,
      refining: false,
      week: '2026-09-21',
      onResultChange: () => {},
      onRefine: () => {},
      onRestart: () => {},
      onBack: () => {},
      onOpenHistory: () => {},
    }),
  )
}

/**
 * 从整页 HTML 里切出某一栏那张卡（截到下一栏为止），单看它的先后与徽标。
 * `nextKey` 可以省略 —— 0.9.5 起「成长」是最后一栏，后面没有别的区了。
 */
function cardHtml(html: string, key: string, nextKey?: string) {
  const start = html.indexOf(`id="section-${key}"`)
  expect(start).toBeGreaterThanOrEqual(0)
  if (!nextKey) return html.slice(start)
  const end = html.indexOf(`id="section-${nextKey}"`)
  expect(end).toBeGreaterThan(start)
  return html.slice(start, end)
}

/** 递归走一遍元素树 —— 这套测试没有 jsdom，交互只能靠直接调组件给出的 onChange */
function forEachElement(node: ReactNode, visit: (el: ReactElement) => void): void {
  if (Array.isArray(node)) {
    for (const child of node) forEachElement(child as ReactNode, visit)
    return
  }
  if (!isValidElement(node)) return
  visit(node)
  forEachElement(node.props.children as ReactNode, visit)
}

/**
 * 往下钻一层：把树里的**函数组件就地跑一遍**，把它们的输出摊平进树里。
 *
 * 为什么需要它：`forEachElement` 只顺着 `props.children` 走，遇到没被渲染的
 * 函数组件（比如 `<StateScore />`、`<CollapsibleCard />`）就停在那儿 ——
 * 组件里面的星星、备注框都走不到。0.9.8 之前这条路上只有 `StateScore`，
 * 星星按钮是它直接返回的，所以没这个问题；现在星星藏在 PeekRating 里，
 * 就得先把 StateScore 跑出来。
 *
 * 这不是「渲染」：不碰 DOM、也不新增 jsdom，只是把组件函数调一次拿到元素树，
 * 所以本文件仍然跑在 node 环境里（真手势在 `peekRating.dom.test.tsx` 里测）。
 */
function called(node: ReactNode): ReactNode {
  const cache = new Map<string, ReactNode>()
  const walk = (n: ReactNode): ReactNode => {
    if (Array.isArray(n)) return n.map((child) => walk(child as ReactNode))
    if (!isValidElement(n)) return n
    const el = n as ReactElement
    if (typeof el.type === 'function') {
      // 同一种组件、不同 props（比如四排星各是一个分数）必须是不同的输出，
      // 所以键要带上 props —— 这些都是简单值，JSON 一下就够
      const key = `${(el.type as { name?: string }).name}|${JSON.stringify(el.props)}`
      if (cache.has(key)) return cache.get(key)
      let out: ReactNode
      try {
        out = walk((el.type as (props: unknown) => ReactNode)(el.props))
      } catch {
        // 带着 hooks 的组件（PeekRating 自己）不能这么调：就停在它这一层
        // —— 这个文件要的是它的 props，不是它里面的按钮
        return el
      }
      cache.set(key, out)
      return out
    }
    if (!el.props || !('children' in el.props)) return el
    return { ...el, props: { ...el.props, children: walk(el.props.children as ReactNode) } } as ReactElement
  }
  return walk(node)
}

/**
 * 结果页那四排星。
 *
 * 0.9.8 起那一排星的按钮在 `PeekRating` 里面，而 `StateScore` 只是一层换算
 * （undefined ↔ 0）。四排星的分数得从 `PeekRating` 的 `value` 上读，
 * 所以这里按「PeekRating 组件」认人。
 */
function scoreRows(tree: ReactNode): ReactElement[] {
  const out: ReactElement[] = []
  forEachElement(called(tree), (el) => {
    if (el.type === PeekRating) out.push(el)
  })
  return out
}

/**
 * 数「亮着的星星」。
 *
 * 静态渲染看不到 `data-lit`（那是 PeekRating 在 `useLayoutEffect` 里画的），
 * 但每颗按钮身上都有 `title="3 of 5"`（第几颗、共几颗），而亮的规则跟
 * 组件里一致：**分数是几，这一排的前几颗就亮**。分数从
 * `aria-checked="true"` 那颗的位置读出来。
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

/** 状态卡下面那一行备注（别的栏目也有 textarea，按 class 认人） */
function stateNoteBox(tree: ReactNode): ReactElement | undefined {
  let found: ReactElement | undefined
  forEachElement(called(tree), (el) => {
    if (el.type === 'textarea' && el.props.className === 'state-note') found = el
  })
  return found
}

/** 状态卡里的「追问小结」那一格（0.9.4 新加）：样式跟备注共用，靠 state-followup 认人 */
function stateFollowUpBox(tree: ReactNode): ReactElement | undefined {
  let found: ReactElement | undefined
  forEachElement(called(tree), (el) => {
    const cls = String(el.props.className ?? '')
    if (el.type === 'textarea' && cls.includes('state-followup')) found = el
  })
  return found
}

function renderBody(current: WeeklyResult) {
  return renderToStaticMarkup(
    createElement(ResultBody, {
      result: current,
      onResultChange: () => {},
      collapsed: { ...ALL_COLLAPSED, state: false },
      onToggle: () => {},
    }),
  )
}

function bodyTree(current: WeeklyResult, onChange: (next: WeeklyResult) => void = () => {}) {
  return ResultBody({
    result: current,
    onResultChange: onChange,
    collapsed: { ...ALL_COLLAPSED, state: false },
    onToggle: () => {},
  })
}

describe('结果页渲染（临时校验）', () => {
  it('目录与标题用的是新名字', () => {
    const html = render()
    for (const label of ['事情', '人际', '物品', '未办', '反复出现', '状态', '成长', '本周主线', '下周计划']) {
      expect(html).toContain(label)
    }
    expect(html).not.toContain('悬着')
    expect(html).not.toContain('本周热点')
  })

  it('七栏默认收起：条目不在首屏 HTML 里，且标记为未展开', () => {
    const html = render()
    expect(html).not.toContain('改了三版方案')
    expect(html).not.toContain('报销拖了两周')
    expect(html).not.toContain('卡在他那儿')
    expect(html).not.toContain('买了个键盘')
    // 成长、状态、反复出现也默认收起：里面的条目、星星和备注都不进首屏
    expect(html).not.toContain('读完了《长日将尽》')
    expect(html).not.toContain('这周一直悬着')
    expect(html).not.toContain('未打分')
    expect(html.match(/aria-expanded="false"/g)).toHaveLength(7)
    expect(html).toContain('展开')
  })

  it('目录里本周主线与下周计划排在最前（0.9.5 重排，0.9.6 加了反复出现）', () => {
    const html = render()
    const nav = html.slice(html.indexOf('outline-bar'), html.indexOf('</nav>'))
    expect(nav.indexOf('本周主线')).toBeGreaterThanOrEqual(0)
    expect(nav.indexOf('本周主线')).toBeLessThan(nav.indexOf('下周计划'))
    expect(nav.indexOf('下周计划')).toBeLessThan(nav.indexOf('事情'))
    // 清单卡之间的相对顺序：未办 → 反复出现 → 状态 → 成长
    expect(nav.indexOf('未办')).toBeLessThan(nav.indexOf('反复出现'))
    expect(nav.indexOf('反复出现')).toBeLessThan(nav.indexOf('状态'))
    expect(nav.indexOf('状态')).toBeLessThan(nav.indexOf('成长'))
  })

  it('页面上的顺序跟着目录走：主线与计划在几张卡之前', () => {
    const html = render()
    const at = (key: string) => {
      const index = html.indexOf(`id="section-${key}"`)
      expect(index).toBeGreaterThanOrEqual(0)
      return index
    }
    const highlights = at('highlights')
    const plan = at('plan')
    const events = at('events')
    const pending = at('pending')
    const pattern = at('pattern')
    const state = at('state')
    const growth = at('growth')
    expect(highlights).toBeLessThan(plan)
    expect(plan).toBeLessThan(events)
    expect(events).toBeLessThan(pending)
    // 反复出现讲的就是「上几周这些东西一直挂着」，紧跟在未办后面
    expect(pending).toBeLessThan(pattern)
    expect(pattern).toBeLessThan(state)
    expect(state).toBeLessThan(growth)
  })

  it('状态卡上的数字 = 打过分的项 + 一条备注', () => {
    const html = render()
    // 点了心情和睡眠两项，外加一条备注
    expect(countSection(result, 'state')).toBe(3)
    expect(cardHtml(html, 'state', 'growth')).toContain('card-count">3')
  })

  it('状态一项分没点、备注也空着时卡上不显示数字', () => {
    const blank: WeeklyResult = { ...result, state: createEmptyState() }
    // 状态全空时目录里那一项也是空的小字，不冒充有内容
    expect(countSection(blank, 'state')).toBe(0)
    const html = render(blank)
    expect(cardHtml(html, 'state', 'growth')).not.toContain('card-count')
    // 卡片本身还在，只是没有数字
    expect(html).toContain('id="section-state"')
  })

  it('成长卡按条数给徽标', () => {
    const html = render()
    expect(countSection(result, 'growth')).toBe(1)
    expect(cardHtml(html, 'growth')).toContain('card-count">1')

    const bare: WeeklyResult = { ...result, growth: [] }
    const empty = render(bare)
    expect(cardHtml(empty, 'growth')).not.toContain('card-count')
    expect(empty).toContain('id="section-growth"')
  })

  it('主线与下周计划照常展开，条数徽标在', () => {
    const html = render()
    expect(html).toContain('这周基本被方案拖着')
    expect(html).toContain('推动定稿')
    expect(html).toContain('老王')
    // 事情 1 条、物品 1 条这样的徽标
    expect(html).toContain('card-count')
  })

  it('写清了这份结果记在哪一周，并且有去总览的入口', () => {
    const html = render()
    expect(html).toContain('记在 9月21日 – 9月27日')
    expect(html).toContain('看总览')
  })
})

describe('状态卡（0.9.3 起的四项打分 + 一行备注）', () => {
  it('展开后是四排星 + 一行备注，值和结果里的一致', () => {
    const html = renderBody(result)
    expect(html).toContain('state-form')
    expect(html.match(/class="state-row"/g)).toHaveLength(4)
    for (const label of STATE_LABELS) {
      expect(html).toContain(`class="state-label">${label}<`)
    }
    // 四排各五颗星（0.9.8 起是 PeekRating 的字形，不再是字符 ★）
    expect(html.match(/class="peek-rating__glyph"/g)).toHaveLength(20)
    expect(html).toContain('class="state-note"')
    expect(html).toContain('想补一句什么')
    // 点过的分数与备注都渲染出来
    expect(html).toContain('4 / 5')
    expect(html).toContain('2 / 5')
    const note = html.slice(html.indexOf('class="state-note"'))
    expect(note.slice(0, note.indexOf('</textarea>'))).toContain('这周一直悬着')
  })

  it('没打分的项写「未打分」，备注空着时靠占位提示撑着', () => {
    const html = renderBody({ ...result, state: createEmptyState() })
    expect(html.match(/class="state-row"/g)).toHaveLength(4)
    expect(html.match(/未打分/g)).toHaveLength(4)
    expect(html).toContain('想补一句什么')
    const note = html.slice(html.indexOf('class="state-note"'))
    expect(note.slice(0, note.indexOf('</textarea>'))).not.toContain('这周一直悬着')
  })

  it('四排星顺序就是心情、睡眠、运动、饮食', () => {
    const rows = scoreRows(bodyTree(result))
    expect(rows.map((r) => r.props.ariaLabel)).toEqual([
      '心情评分',
      '睡眠评分',
      '运动评分',
      '饮食评分',
    ])
    // PeekRating 只认 0–5：「没打分」到它这儿是 0
    expect(rows.map((r) => r.props.value)).toEqual([4, 2, 0, 0])
  })

  it('改备注只动备注，分数和别的栏目一动不动', () => {
    const calls: WeeklyResult[] = []
    const box = stateNoteBox(bodyTree(result, (next) => calls.push(next)))
    expect(box).toBeDefined()
    box?.props.onChange({ target: { value: '这周睡得不错' } })

    expect(calls).toHaveLength(1)
    expect(calls[0].state).toEqual({ scores: { mood: 4, sleep: 2 }, note: '这周睡得不错' })
    expect(calls[0].events).toEqual(result.events)
    expect(calls[0].growth).toEqual(result.growth)
    expect(calls[0].highlights).toEqual(result.highlights)
    expect(calls[0].nextFocus).toEqual(result.nextFocus)
  })

  it('备注清空（只留空白）时分数照留', () => {
    const calls: WeeklyResult[] = []
    const box = stateNoteBox(bodyTree(result, (next) => calls.push(next)))
    box?.props.onChange({ target: { value: '   ' } })

    expect(calls).toHaveLength(1)
    expect(calls[0].state).toEqual({ scores: { mood: 4, sleep: 2 }, note: '' })
  })

  it('一项分没点时改备注，不会凭空多出一个空的 scores', () => {
    const bare: WeeklyResult = { ...result, state: createEmptyState() }
    const calls: WeeklyResult[] = []
    const box = stateNoteBox(bodyTree(bare, (next) => calls.push(next)))
    box?.props.onChange({ target: { value: '睡得还行' } })

    expect(calls).toHaveLength(1)
    expect(calls[0].state.note).toBe('睡得还行')
    expect('scores' in calls[0].state).toBe(false)
  })

  // 0.9.4：「追问小结」是状态那一栏里的第二格，跟备注各改各的、谁也不许把谁抹掉
  it('状态卡里有「追问小结」那一格，空的时候是空串', () => {
    expect(stateFollowUpBox(bodyTree(result))?.props.value).toBe('')
    const html = renderBody({
      ...result,
      state: attachState({ sleep: 2 }, '还行', '睡眠：躺下停不下来'),
    })
    expect(html).toContain('追问小结')
    expect(html).toContain('睡眠：躺下停不下来')
  })

  it('改追问小结：不动备注、不动分数', () => {
    const calls: WeeklyResult[] = []
    const withDigest = {
      ...result,
      state: attachState({ mood: 4, sleep: 2 }, '这周还行', '旧小结'),
    }
    const box = stateFollowUpBox(bodyTree(withDigest, (next) => calls.push(next)))
    box?.props.onChange({ target: { value: '睡眠：躺下停不下来' } })

    expect(calls).toHaveLength(1)
    expect(calls[0].state.followUp).toBe('睡眠：躺下停不下来')
    expect(calls[0].state.note).toBe('这周还行')
    expect(calls[0].state.scores).toEqual({ mood: 4, sleep: 2 })
  })

  it('改备注：追问小结原样留着（漏了这条约定，改一个错字就把小结抹了）', () => {
    const calls: WeeklyResult[] = []
    const withDigest = {
      ...result,
      state: attachState({ sleep: 2 }, '旧备注', '睡眠：躺下停不下来'),
    }
    const box = stateNoteBox(bodyTree(withDigest, (next) => calls.push(next)))
    box?.props.onChange({ target: { value: '新备注' } })

    expect(calls).toHaveLength(1)
    expect(calls[0].state.note).toBe('新备注')
    expect(calls[0].state.followUp).toBe('睡眠：躺下停不下来')
  })

  it('点星：追问小结也留着', () => {
    const calls: WeeklyResult[] = []
    const withDigest = {
      ...result,
      state: attachState({ sleep: 2 }, '还行', '睡眠：躺下停不下来'),
    }
    const row = scoreRows(bodyTree(withDigest, (next) => calls.push(next)))[0]
    row?.props.onChange(5)

    expect(calls).toHaveLength(1)
    expect(calls[0].state.scores).toEqual({ mood: 5, sleep: 2 })
    expect(calls[0].state.followUp).toBe('睡眠：躺下停不下来')
  })
})

describe('状态评分（结果页上的星星）', () => {
  it('四项各一排五颗星，没打分时写「未打分」，一颗都不亮', () => {
    const html = renderBody({ ...result, state: createEmptyState() })
    expect(html.match(/class="peek-rating__glyph"/g)).toHaveLength(20)
    expect(litCount(html)).toBe(0)
    expect(html.match(/未打分/g)).toHaveLength(4)
    // 每排 5 颗，按钮上的名字带得出是哪一项
    for (const label of STATE_LABELS) {
      expect(html).toContain(`aria-label="${label}评分 5 星"`)
    }
  })

  it('点过的项点亮对应颗数，并把分数写在旁边', () => {
    const html = renderBody({
      ...result,
      state: attachState({ mood: 4, sport: 2 }, ''),
    })
    // 4 + 2 颗亮着（静态渲染拿不到 data-lit，那是 useLayoutEffect 里画的，
    // 所以按「选中那颗的位置」往回数亮了几颗）
    expect(litCount(html)).toBe(6)
    expect(html).toContain('4 / 5')
    expect(html).toContain('2 / 5')
    // 另外两项还是「未打分」
    expect(html.match(/未打分/g)).toHaveLength(2)
  })

  it('点第 N 颗就是 N 分，只动这一项，备注不动', () => {
    const calls: WeeklyResult[] = []
    const rows = scoreRows(bodyTree(result, (next) => calls.push(next)))
    expect(rows).toHaveLength(4)
    // 第二排是「睡眠」
    rows[1].props.onChange(3)

    expect(calls).toHaveLength(1)
    expect(calls[0].state).toEqual({ scores: { mood: 4, sleep: 3 }, note: '这周一直悬着' })
    expect(calls[0].events).toEqual(result.events)
    expect(calls[0].highlights).toEqual(result.highlights)
  })

  it('再点同一颗取消：这一项的分数整个不出现，而不是变成 0 分', () => {
    const scored: WeeklyResult = { ...result, state: attachState({ mood: 3 }, '这周一直悬着') }
    const calls: WeeklyResult[] = []
    const rows = scoreRows(bodyTree(scored, (next) => calls.push(next)))
    expect(rows[0].props.value).toBe(3)

    // PeekRating 取消时给的是 0（它的口径），StateScore 负责翻成「没打分」
    rows[0].props.onChange(0)

    expect(calls).toHaveLength(1)
    expect('scores' in calls[0].state).toBe(false)
    // 备注一直留着，不受点星影响
    expect(calls[0].state.note).toBe('这周一直悬着')
  })

  it('四排星各认自己那一项，分不会串行', () => {
    const calls: WeeklyResult[] = []
    const rows = scoreRows(bodyTree(result, (next) => calls.push(next)))

    rows[3].props.onChange(5)
    expect(calls[0].state.scores).toEqual({ mood: 4, sleep: 2, diet: 5 })
    expect(calls[0].state.scores?.mood).toBe(4)
  })

  it('没点过分的档：四排星都还是「没点过」的样子', () => {
    const fresh: WeeklyResult = { ...result, state: createEmptyState() }
    const rows = scoreRows(bodyTree(fresh))
    // 没打过分的项在 StateScore 里被翻成 0，一颗都不亮（不是 undefined：
    // PeekRating 只认 0–5，undefined 会让它变成非受控）
    expect(rows.map((r) => r.props.value)).toEqual([0, 0, 0, 0])
    const html = renderBody(fresh)
    expect(html.match(/未打分/g)).toHaveLength(4)
    expect(litCount(html)).toBe(0)
    expect(html).not.toContain('0 / 5')
  })
})

/**
 * StateScore 这一层只做一件事：把「没打分」（undefined）翻成 PeekRating 认的 0。
 *
 * 真正的手势（点、拖、键盘、取消）在 `peekRating.dom.test.tsx` 里用 jsdom 测 ——
 * 那些规则必须真跑一遍事件才知道对不对，光看元素树看不出来。
 */
describe('StateScore 与 PeekRating 的接缝', () => {
  function ratingOf(score: number | undefined, disabled = false): ReactElement {
    let found: ReactElement | undefined
    forEachElement(
      StateScore({ label: '这周的心情', score, disabled, onChange: () => {} }),
      (el) => {
        if (el.type === PeekRating) found = el
      },
    )
    expect(found).toBeDefined()
    return found!
  }

  it('没打分时给 PeekRating 的是 0 —— 给 undefined 会被它当成非受控，自己记分', () => {
    expect(ratingOf(undefined).props.value).toBe(0)
  })

  it('打过分就把分数原样给它，那颗星的名字带上这一项', () => {
    const rating = ratingOf(4)
    expect(rating.props.value).toBe(4)
    expect(rating.props.ariaLabel).toBe('这周的心情')
    expect(rating.props.count).toBe(SCORE_MAX)
  })

  it('禁用也照样往下传（AI 正在回复时四排星一起点不动）', () => {
    expect(ratingOf(2, true).props.disabled).toBe(true)
  })
})

/**
 * 0.9.5 的页头概览。
 *
 * 原来的问题是：最该被看见的「本周主线 + 下周计划」排在第 7、8 位，前面压着六张卡。
 * 概览把「这周什么状态、主线是哪一句」提到最上面，不用先滚过一屏。
 */
describe('结果页页头概览', () => {
  /** 只截概览那一块（页面别处也有「心情」这类字样） */
  const brief = (current: WeeklyResult = result) => {
    const html = render(current)
    return html.slice(html.indexOf('class="result-brief"'), html.indexOf('outline-bar'))
  }

  it('摆在目录栏之前，先给状态与主线', () => {
    const html = render()
    expect(html.indexOf('class="result-brief"')).toBeGreaterThan(-1)
    expect(html.indexOf('class="result-brief"')).toBeLessThan(html.indexOf('outline-bar'))

    const block = brief()
    expect(block).toContain('心情')
    expect(block).toContain('4 / 5')
    expect(block).toContain('睡眠')
    expect(block).toContain('2 / 5')
    expect(block).toContain('这周基本被方案拖着')
  })

  it('只列打过分的项 —— 没打分的两项不占位置', () => {
    const block = brief()
    expect(block).not.toContain('运动')
    expect(block).not.toContain('饮食')
    expect(block).not.toContain('未打分')
  })

  it('概览里的星是只读的：不是按钮，点不动', () => {
    const block = brief()
    expect(block).toContain('class="star on"')
    expect(block).not.toContain('<button')
  })

  it('一项都没打分就说「这周没打分」，不摆四排空格', () => {
    const block = brief({ ...result, state: createEmptyState() })
    expect(block).toContain('这周没打分')
    expect(block).not.toContain('未打分')
    // 主线照样在
    expect(block).toContain('这周基本被方案拖着')
  })

  it('没有主线时照实说，但概览还在', () => {
    const block = brief({ ...result, highlights: [] })
    expect(block).toContain('（还没有主线）')
    expect(block).toContain('心情')
  })

  it('主线取第一条非空的那句（与总览页、归档同一个口径）', () => {
    const block = brief({ ...result, highlights: ['   ', '第二句才是主线'] })
    expect(block).toContain('第二句才是主线')
    expect(block).not.toContain('这周基本被方案拖着')
  })

  it('总览页看旧周时没有这条概览（它只属于当前这份结果）', () => {
    // 总览页用的是 ResultBody，页头是另一套（周与周统计），所以这里不该出现概览
    const html = renderToStaticMarkup(
      createElement(ResultBody, {
        result,
        onResultChange: () => {},
        collapsed: ALL_COLLAPSED,
        onToggle: () => {},
      }),
    )
    expect(html).not.toContain('result-brief')
  })
})

/**
 * 0.9.6：把归档用起来。
 *
 * 两件事都只读 weeks.json —— 状态那四行后面挂一句「上周 3 ↑1」，
 * 以及「未办」后面多出来的那一栏「反复出现」（跨周重复的未办/计划/人名）。
 * 这一页的结果记在 2026-09-21 那一周，上一周是 2026-09-14。
 */
describe('把归档用起来（0.9.6）', () => {
  const WEEK = '2026-09-21'
  const LAST = '2026-09-14'

  function entry(week: string, over: Partial<WeeklyResult> = {}): WeekEntry {
    return {
      week,
      savedAt: Date.parse(`${week}T20:00:00`),
      result: { ...createEmptyResult(), ...over },
    }
  }

  /** 上一周：心情 3、睡眠 4（这一周是 4 和 2 —— 一个涨了、一个掉了） */
  const lastWeek = entry(LAST, { state: attachState({ mood: 3, sleep: 4 }, '上周还行') })

  /** 跨两周挂着的一件事 */
  const stale = [
    entry('2026-08-31', { nextFocus: ['把报价发出去'] }),
    entry('2026-09-07', { pending: ['报价还是没发出去'] }),
  ]

  /** 展开「状态」与「反复出现」两栏，把算好的对比与重复模式交给 ResultBody 渲染 */
  const renderOpen = (current: WeeklyResult, archive: WeekEntry[]) =>
    renderToStaticMarkup(
      createElement(ResultBody, {
        result: current,
        onResultChange: () => {},
        collapsed: { ...ALL_COLLAPSED, state: false, pattern: false },
        onToggle: () => {},
        compare: compareScores(current.state.scores, previousEntry(archive, WEEK), WEEK),
        patterns: recurringPatterns(archive, WEEK),
      }),
    )

  it('状态那几行后面挂一句跟上次比：涨了、掉了各说各的', () => {
    const html = renderOpen(result, [lastWeek])
    expect(html.match(/class="state-prev"/g)).toHaveLength(2)
    // 心情 4 比上周 3 涨 1；睡眠 2 比上周 4 掉 2
    expect(html).toContain('上周 3 ↑1')
    expect(html).toContain('上周 4 ↓2')
    // 这一周没打分的两项后面不挂小字（整页里只有两处 state-prev）
    const sport = html.slice(html.indexOf('state-label">运动'), html.indexOf('state-label">饮食'))
    expect(sport).not.toContain('state-prev')
    expect(html).not.toContain('上周没打分')
  })

  it('上次那周没打分时照实说「上周没打分」', () => {
    const blank = entry(LAST, { state: createEmptyState() })
    const html = renderOpen(result, [blank])
    expect(html.match(/class="state-prev"/g)).toHaveLength(2)
    expect(html.match(/上周没打分/g)).toHaveLength(2)
  })

  it('归档里没有更早的一周时，这一句一句都不多说', () => {
    const html = renderOpen(result, [])
    expect(html).not.toContain('state-prev')
    expect(html).not.toContain('上周')
    // 反复出现那一栏还在，只是写着「还没看出重复」
    expect(html).toContain('还没看出重复')
    expect(html).not.toContain('pattern-item')
  })

  it('反复出现那一栏：一条一件事，按周列出，说清挂了几周', () => {
    const html = renderOpen(result, stale)
    expect(html).toContain('2 周都挂着')
    expect(html).toContain('把报价发出去')
    expect(html).toContain('8月31日 · 计划')
    expect(html).toContain('9月7日 · 未办')
    expect(html).toContain('报价还是没发出去')
  })

  it('连着两周提到的人也算一条，带上那两周的备注', () => {
    const archive = [
      entry('2026-09-07', { people: [{ name: '张总', note: '电话还没回' }] }),
      entry(LAST, { people: [{ name: '张总', note: '方案又催了一次' }] }),
    ]
    const html = renderOpen(result, archive)
    expect(html).toContain('2 周都提到')
    expect(html).toContain('电话还没回')
    expect(html).toContain('方案又催了一次')
  })

  it('页头概览里也带上这句：一眼看出跟上次比是涨了还是掉了', () => {
    const html = render(result, [lastWeek])
    const block = html.slice(html.indexOf('class="result-brief"'), html.indexOf('outline-bar'))
    expect(block).toContain('class="brief-prev"')
    expect(block).toContain('上周 3 ↑1')
    expect(block).toContain('上周 4 ↓2')
  })

  it('目录里「反复出现」的条数来自归档，没有重复时那一项是空的', () => {
    const navOf = (archive: WeekEntry[]) => {
      const html = render(result, archive)
      const nav = html.slice(html.indexOf('outline-bar'), html.indexOf('</nav>'))
      return nav.slice(nav.indexOf('反复出现'), nav.indexOf('状态'))
    }
    expect(navOf(stale)).toContain('outline-count">1')
    expect(navOf([])).toContain('反复出现</button>')
  })

  it('反复出现那张卡按条数给徽标，条数为 0 时不显示数字', () => {
    expect(cardHtml(render(result, stale), 'pattern', 'state')).toContain('card-count">1')
    const empty = render(result, [])
    expect(cardHtml(empty, 'pattern', 'state')).not.toContain('card-count')
    // 卡片本身还在：没有重复也要说一句「还没看出重复」
    expect(empty).toContain('id="section-pattern"')
  })
})
