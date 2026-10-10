import { createElement, isValidElement, type ReactElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { countSection } from '../core/outline'
import { attachState } from '../core/stateScore'
import { createEmptyResult, createEmptyState, type ChatMessage, type WeeklyResult } from '../core/types'
import { ALL_COLLAPSED } from './CollapsibleCard'
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

function render(current: WeeklyResult = result) {
  return renderToStaticMarkup(
    createElement(ResultPage, {
      result: current,
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
 * 结果页那四排星。
 *
 * 星星按钮在 `StateScore` 里面，元素树走不到（函数组件没被调用），
 * 所以这里按「四排星的组件」认人，点星的动作交给下面那组直接测 StateScore。
 */
function scoreRows(tree: ReactNode): ReactElement[] {
  const out: ReactElement[] = []
  forEachElement(tree, (el) => {
    if (el.type === StateScore) out.push(el)
  })
  return out
}

/** 状态卡下面那一行备注（别的栏目也有 textarea，按 class 认人） */
function stateNoteBox(tree: ReactNode): ReactElement | undefined {
  let found: ReactElement | undefined
  forEachElement(tree, (el) => {
    if (el.type === 'textarea' && el.props.className === 'state-note') found = el
  })
  return found
}

/** 状态卡里的「追问小结」那一格（0.9.4 新加）：样式跟备注共用，靠 state-followup 认人 */
function stateFollowUpBox(tree: ReactNode): ReactElement | undefined {
  let found: ReactElement | undefined
  forEachElement(tree, (el) => {
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
    for (const label of ['事情', '人际', '物品', '未办', '状态', '成长', '本周主线', '下周计划']) {
      expect(html).toContain(label)
    }
    expect(html).not.toContain('悬着')
    expect(html).not.toContain('本周热点')
  })

  it('六栏默认收起：条目不在首屏 HTML 里，且标记为未展开', () => {
    const html = render()
    expect(html).not.toContain('改了三版方案')
    expect(html).not.toContain('报销拖了两周')
    expect(html).not.toContain('卡在他那儿')
    expect(html).not.toContain('买了个键盘')
    // 成长与状态卡也默认收起：里面的条目、星星和备注都不进首屏
    expect(html).not.toContain('读完了《长日将尽》')
    expect(html).not.toContain('这周一直悬着')
    expect(html).not.toContain('未打分')
    expect(html.match(/aria-expanded="false"/g)).toHaveLength(6)
    expect(html).toContain('展开')
  })

  it('目录里本周主线与下周计划排在最前（0.9.5 重排）', () => {
    const html = render()
    const nav = html.slice(html.indexOf('outline-bar'), html.indexOf('</nav>'))
    expect(nav.indexOf('本周主线')).toBeGreaterThanOrEqual(0)
    expect(nav.indexOf('本周主线')).toBeLessThan(nav.indexOf('下周计划'))
    expect(nav.indexOf('下周计划')).toBeLessThan(nav.indexOf('事情'))
    // 六张清单卡之间的相对顺序没动
    expect(nav.indexOf('未办')).toBeLessThan(nav.indexOf('状态'))
    expect(nav.indexOf('状态')).toBeLessThan(nav.indexOf('成长'))
  })

  it('页面上的顺序跟着目录走：主线与计划在六张卡之前', () => {
    const html = render()
    const highlights = html.indexOf('id="section-highlights"')
    const plan = html.indexOf('id="section-plan"')
    const events = html.indexOf('id="section-events"')
    const pending = html.indexOf('id="section-pending"')
    const state = html.indexOf('id="section-state"')
    const growth = html.indexOf('id="section-growth"')
    expect(highlights).toBeGreaterThanOrEqual(0)
    expect(highlights).toBeLessThan(plan)
    expect(plan).toBeLessThan(events)
    expect(events).toBeLessThan(pending)
    expect(pending).toBeLessThan(state)
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
    // 四排各五颗星
    expect(html.match(/class="star[ "]/g)).toHaveLength(20)
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
    expect(rows.map((r) => r.props.score)).toEqual([4, 2, undefined, undefined])
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
    expect(html.match(/class="star"/g)).toHaveLength(20)
    expect(html.match(/class="star on"/g)).toBeNull()
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
    // 4 + 2 颗亮着
    expect(html.match(/class="star on"/g)).toHaveLength(6)
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
    expect(rows[0].props.score).toBe(3)

    rows[0].props.onChange(undefined)

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
    expect(rows.map((r) => r.props.score)).toEqual([
      undefined,
      undefined,
      undefined,
      undefined,
    ])
    const html = renderBody(fresh)
    expect(html.match(/未打分/g)).toHaveLength(4)
    expect(html.match(/class="star on"/g)).toBeNull()
    expect(html).not.toContain('0 / 5')
  })
})

/**
 * 点星这套规则本身（采访页与结果页共用同一个组件）。
 * 组件是函数式的、没有 hooks，所以直接调用它拿元素树来点，不必凑 jsdom。
 */
describe('一排星的点击规则', () => {
  function starButtons(
    score: number | undefined,
    onChange: (value: number | undefined) => void = () => {},
  ): ReactElement[] {
    const tree = StateScore({ label: '这周的心情', score, onChange })
    const out: ReactElement[] = []
    forEachElement(tree, (el) => {
      if (el.type === 'button') out.push(el)
    })
    return out
  }

  it('五颗星都在，名字带上这一项', () => {
    const stars = starButtons(undefined)
    expect(stars).toHaveLength(5)
    expect(stars.map((el) => el.props['aria-label'])).toEqual([
      '这周的心情 1 星',
      '这周的心情 2 星',
      '这周的心情 3 星',
      '这周的心情 4 星',
      '这周的心情 5 星',
    ])
  })

  it('点第 N 颗就传 N 分', () => {
    const calls: (number | undefined)[] = []
    starButtons(undefined, (v) => calls.push(v))[2].props.onClick()
    expect(calls).toEqual([3])
  })

  it('点同一颗是取消，传 undefined 而不是 0', () => {
    const calls: (number | undefined)[] = []
    starButtons(3, (v) => calls.push(v))[2].props.onClick()
    expect(calls).toEqual([undefined])
  })

  it('改点别的颗就是改分', () => {
    const calls: (number | undefined)[] = []
    const stars = starButtons(3, (v) => calls.push(v))
    stars[4].props.onClick()
    stars[0].props.onClick()
    expect(calls).toEqual([5, 1])
  })

  it('传了 disabled 时五颗都点不动', () => {
    const stars = starButtons(2)
    expect(stars.map((el) => el.props.disabled)).toEqual([
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
    ])
    const off = StateScore({ label: '这周的心情', score: 2, disabled: true, onChange: () => {} })
    const disabled: ReactElement[] = []
    forEachElement(off, (el) => {
      if (el.type === 'button') disabled.push(el)
    })
    expect(disabled.map((el) => el.props.disabled)).toEqual([true, true, true, true, true])
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
