import { createElement, isValidElement, type ReactElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { countSection } from '../core/outline'
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
  state: { body: '睡得还行', mood: '有点烦', focus: '', growth: '' },
  highlights: ['这周基本被方案拖着', '累的来源是等和反复'],
  nextFocus: ['推动定稿'],
  nextFollowUps: ['老王'],
}

/** 状态那四项的标签与占位提示，顺序就是界面上的顺序 */
const STATE_LABELS = ['身体', '情绪', '精力', '心智']
const STATE_PLACEHOLDERS = [
  '睡眠、运动、吃饭…',
  '这周心里怎么样…',
  '什么时候状态最好…',
  '读了什么、学到什么…',
]

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

/** 从整页 HTML 里切出某一栏那张卡（截到下一栏为止），单看它的先后与徽标 */
function cardHtml(html: string, key: string, nextKey: string) {
  const start = html.indexOf(`id="section-${key}"`)
  const end = html.indexOf(`id="section-${nextKey}"`)
  expect(start).toBeGreaterThanOrEqual(0)
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

/** 只看状态那四行输入框（别的栏目也有输入框，按占位提示认人） */
function stateInputs(tree: ReactNode): ReactElement[] {
  const out: ReactElement[] = []
  forEachElement(tree, (el) => {
    if (el.type === 'input' && STATE_PLACEHOLDERS.includes(String(el.props.placeholder))) out.push(el)
  })
  return out
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

describe('结果页渲染（临时校验）', () => {
  it('目录与标题用的是新名字', () => {
    const html = render()
    for (const label of ['事情', '人际', '物品', '未办', '状态', '本周主线', '下周计划']) {
      expect(html).toContain(label)
    }
    expect(html).not.toContain('悬着')
    expect(html).not.toContain('本周热点')
  })

  it('五栏默认收起：条目不在首屏 HTML 里，且标记为未展开', () => {
    const html = render()
    expect(html).not.toContain('改了三版方案')
    expect(html).not.toContain('报销拖了两周')
    expect(html).not.toContain('卡在他那儿')
    expect(html).not.toContain('买了个键盘')
    // 状态卡也默认收起：里面的输入框不进首屏
    expect(html).not.toContain('睡得还行')
    expect(html.match(/aria-expanded="false"/g)).toHaveLength(5)
    expect(html).toContain('展开')
  })

  it('目录里状态排在未办与本周主线之间', () => {
    const html = render()
    const nav = html.slice(html.indexOf('outline-bar'), html.indexOf('</nav>'))
    expect(nav.indexOf('未办')).toBeGreaterThanOrEqual(0)
    expect(nav.indexOf('未办')).toBeLessThan(nav.indexOf('状态'))
    expect(nav.indexOf('状态')).toBeLessThan(nav.indexOf('本周主线'))
  })

  it('状态卡落在未办之后、本周主线之前', () => {
    const html = render()
    const pending = html.indexOf('id="section-pending"')
    const state = html.indexOf('id="section-state"')
    const highlights = html.indexOf('id="section-highlights"')
    expect(pending).toBeGreaterThanOrEqual(0)
    expect(pending).toBeLessThan(state)
    expect(state).toBeLessThan(highlights)
  })

  it('状态卡上的数字只数写了的那几项', () => {
    const html = render()
    // 只写了身体和情绪
    expect(countSection(result, 'state')).toBe(2)
    expect(cardHtml(html, 'state', 'highlights')).toContain('card-count">2')
  })

  it('状态四项都没写时卡上不显示数字', () => {
    const blank: WeeklyResult = { ...result, state: createEmptyState() }
    // 状态全空时目录里那一项也是空的小字，不冒充有内容
    expect(countSection(blank, 'state')).toBe(0)
    const html = render(blank)
    expect(cardHtml(html, 'state', 'highlights')).not.toContain('card-count')
    // 卡片本身还在，只是没有数字
    expect(html).toContain('id="section-state"')
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

describe('状态卡（0.9.1 新增的第八栏）', () => {
  it('展开后是四行：中文标签 + 输入框，值就是结果里的文字', () => {
    const html = renderBody(result)
    expect(html).toContain('state-form')
    expect(html.match(/class="state-row"/g)).toHaveLength(4)
    for (const label of STATE_LABELS) {
      expect(html).toContain(`class="state-label">${label}<`)
    }
    for (const placeholder of STATE_PLACEHOLDERS) {
      expect(html).toContain(`placeholder="${placeholder}"`)
    }
    expect(html).toContain('value="睡得还行"')
    expect(html).toContain('value="有点烦"')
  })

  it('四项都没写时靠占位提示撑着，不塞「（…）」占位文本', () => {
    const html = renderBody({ ...result, state: createEmptyState() })
    expect(html.match(/class="state-row"/g)).toHaveLength(4)
    for (const label of STATE_LABELS) {
      expect(html).toContain(`class="state-label">${label}<`)
    }
    for (const placeholder of STATE_PLACEHOLDERS) {
      expect(html).toContain(`placeholder="${placeholder}"`)
    }
    expect(html).not.toContain('value="睡得还行"')
  })

  it('输入框顺序就是身体、情绪、精力、心智', () => {
    const tree = ResultBody({
      result,
      onResultChange: () => {},
      collapsed: { ...ALL_COLLAPSED, state: false },
      onToggle: () => {},
    })
    const inputs = stateInputs(tree)
    expect(inputs.map((el) => el.props.placeholder)).toEqual(STATE_PLACEHOLDERS)
    expect(inputs.map((el) => el.props.value)).toEqual(['睡得还行', '有点烦', '', ''])
  })

  it('改其中一项时把整份结果回传，另外三项一动不动', () => {
    const calls: WeeklyResult[] = []
    const tree = ResultBody({
      result,
      onResultChange: (next) => calls.push(next),
      collapsed: { ...ALL_COLLAPSED, state: false },
      onToggle: () => {},
    })

    const bodyInput = stateInputs(tree).find((el) => el.props.placeholder === STATE_PLACEHOLDERS[0])
    expect(bodyInput).toBeDefined()
    bodyInput?.props.onChange({ target: { value: '这周睡得不错' } })

    expect(calls).toHaveLength(1)
    expect(calls[0]).toEqual({ ...result, state: { ...result.state, body: '这周睡得不错' } })
    // 另外三项、以及别的栏目都得原样带回去
    expect(calls[0].state.mood).toBe('有点烦')
    expect(calls[0].state.focus).toBe('')
    expect(calls[0].state.growth).toBe('')
    expect(calls[0].events).toEqual(result.events)
    expect(calls[0].highlights).toEqual(result.highlights)
    expect(calls[0].nextFocus).toEqual(result.nextFocus)
  })

  it('改的是哪一行就只动哪一行', () => {
    const calls: WeeklyResult[] = []
    const tree = ResultBody({
      result,
      onResultChange: (next) => calls.push(next),
      collapsed: { ...ALL_COLLAPSED, state: false },
      onToggle: () => {},
    })

    const growthInput = stateInputs(tree).find(
      (el) => el.props.placeholder === STATE_PLACEHOLDERS[3],
    )
    growthInput?.props.onChange({ target: { value: '把《长日将尽》读完了' } })

    expect(calls).toHaveLength(1)
    expect(calls[0].state).toEqual({
      body: '睡得还行',
      mood: '有点烦',
      focus: '',
      growth: '把《长日将尽》读完了',
    })
  })
})

describe('状态评分（0.9.2 的星星）', () => {
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

  function bodyTree(current: WeeklyResult, onChange: (next: WeeklyResult) => void = () => {}) {
    return ResultBody({
      result: current,
      onResultChange: onChange,
      collapsed: { ...ALL_COLLAPSED, state: false },
      onToggle: () => {},
    })
  }

  it('四项各一排五颗星，没打分时写「未打分」，一颗都不亮', () => {
    const html = renderBody(result)
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
      state: { ...result.state, scores: { body: 4, focus: 2 } },
    })
    // 4 + 2 颗亮着
    expect(html.match(/class="star on"/g)).toHaveLength(6)
    expect(html).toContain('4 / 5')
    expect(html).toContain('2 / 5')
    // 另外两项还是「未打分」
    expect(html.match(/未打分/g)).toHaveLength(2)
  })

  it('点第 N 颗就是 N 分，只动这一项，文字不动', () => {
    const calls: WeeklyResult[] = []
    const rows = scoreRows(bodyTree(result, (next) => calls.push(next)))
    expect(rows).toHaveLength(4)
    // 第二排是「情绪」
    rows[1].props.onChange(3)

    expect(calls).toHaveLength(1)
    expect(calls[0].state).toEqual({
      body: '睡得还行',
      mood: '有点烦',
      focus: '',
      growth: '',
      scores: { mood: 3 },
    })
    expect(calls[0].events).toEqual(result.events)
    expect(calls[0].highlights).toEqual(result.highlights)
  })

  it('再点同一颗取消：这一项的分数整个不出现，而不是变成 0 分', () => {
    const scored: WeeklyResult = {
      ...result,
      state: { ...result.state, scores: { mood: 3 } },
    }
    const calls: WeeklyResult[] = []
    const rows = scoreRows(bodyTree(scored, (next) => calls.push(next)))
    expect(rows[1].props.score).toBe(3)

    rows[1].props.onChange(undefined)

    expect(calls).toHaveLength(1)
    expect('scores' in calls[0].state).toBe(false)
    // 文字一直留着，不受点星影响
    expect(calls[0].state.mood).toBe('有点烦')
  })

  it('四排星各认自己那一项，分不会串行', () => {
    const calls: WeeklyResult[] = []
    const rows = scoreRows(bodyTree(result, (next) => calls.push(next)))
    expect(rows.map((r) => r.props.ariaLabel)).toEqual([
      '身体评分',
      '情绪评分',
      '精力评分',
      '心智评分',
    ])

    rows[3].props.onChange(5)
    expect(calls[0].state.scores).toEqual({ growth: 5 })
    expect(calls[0].state.scores?.body).toBeUndefined()
  })

  it('旧档没有分数：四排星都还是「没点过」的样子', () => {
    const legacy: WeeklyResult = { ...result, state: createEmptyState() }
    const rows = scoreRows(bodyTree(legacy))
    expect(rows.map((r) => r.props.score)).toEqual([
      undefined,
      undefined,
      undefined,
      undefined,
    ])
    const html = renderBody(legacy)
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
    const tree = StateScore({ label: '这周的情绪', score, onChange })
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
      '这周的情绪 1 星',
      '这周的情绪 2 星',
      '这周的情绪 3 星',
      '这周的情绪 4 星',
      '这周的情绪 5 星',
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
    const off = StateScore({ label: '这周的情绪', score: 2, disabled: true, onChange: () => {} })
    const disabled: ReactElement[] = []
    forEachElement(off, (el) => {
      if (el.type === 'button') disabled.push(el)
    })
    expect(disabled.map((el) => el.props.disabled)).toEqual([true, true, true, true, true])
  })
})
