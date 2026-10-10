import { coerceScore } from './stateScore'
import { STATE_KEYS, type WeeklyResult } from './types'

/**
 * 结果页的八个区块，**顺序即页面上的先后顺序**。
 *
 * 0.9.5 起重排：本周主线与下周计划搬到最前面。理由是这一页有两个读者时刻 ——
 * 「我就想看看这周到底怎么回事」（主角是主线与下周计划）与「我要动手改某一条」
 * （才需要那六张清单卡）。原来六张卡压在主线前面，最该看第二遍的两句要滚过一屏才出现。
 * 顺序一变，目录栏与滚动高亮都跟着变（它们都从这一个数组读），所以只改这一处。
 */
export type SectionKey =
  | 'events'
  | 'people'
  | 'things'
  | 'pending'
  | 'state'
  | 'growth'
  | 'highlights'
  | 'plan'

export const SECTION_KEYS: SectionKey[] = [
  'highlights',
  'plan',
  'events',
  'people',
  'things',
  'pending',
  'state',
  'growth',
]

const SECTION_LABELS: Record<SectionKey, string> = {
  events: '事情',
  people: '人际',
  things: '物品',
  pending: '未办',
  state: '状态',
  growth: '成长',
  highlights: '本周主线',
  plan: '下周计划',
}

/** 目录里的一项 */
export interface OutlineEntry {
  key: SectionKey
  label: string
  /** 这一块现在有几条内容；0 表示还没写到 */
  count: number
}

/** 区块在页面上的锚点 id */
export function sectionDomId(key: SectionKey): string {
  return `section-${key}`
}

/** 某一块现在有多少条内容 */
export function countSection(result: WeeklyResult, key: SectionKey): number {
  switch (key) {
    case 'events':
      return result.events.length
    case 'people':
      return result.people.length
    case 'things':
      return result.things.length
    case 'pending':
      return result.pending.length
    // 状态：点了几项分算几条，写了备注或有一段追问小结再加一条。
    // 用 coerceScore 判分而不是 typeof === 'number' —— 界面上的星只认 1–5，
    // 脏值（0 / 6 / 小数）界面上是「未打分」，目录也不该算它一条。
    case 'state':
      return (
        STATE_KEYS.filter((key) => coerceScore(result.state.scores?.[key]) !== undefined).length +
        (result.state.note.trim() || (result.state.followUp ?? '').trim() ? 1 : 0)
      )
    case 'growth':
      return result.growth.length
    case 'highlights':
      return result.highlights.length
    case 'plan':
      return result.nextFocus.length + result.nextFollowUps.length
  }
}

/** 结果页顶部目录的内容 */
export function buildOutline(result: WeeklyResult): OutlineEntry[] {
  return SECTION_KEYS.map((key) => ({
    key,
    label: SECTION_LABELS[key],
    count: countSection(result, key),
  }))
}

/** 某个区块相对滚动视口顶部的位置 */
export interface SectionOffset {
  key: SectionKey
  /** 相对滚动容器视口顶部的像素偏移；已经滚过去时是负数 */
  top: number
}

export interface ActiveSectionOptions {
  /** 顶部被吸顶目录栏遮住的高度，落到这个范围内的区块算「当前」 */
  threshold?: number
  /** 是否已经滚到底 */
  atBottom?: boolean
}

/**
 * 判断当前该高亮目录里的哪一项。
 * 取最后一个已经顶到目录栏下方的区块；都没到时就是第一块。
 */
export function activeSection(
  offsets: SectionOffset[],
  options: ActiveSectionOptions = {},
): SectionKey | null {
  if (offsets.length === 0) return null
  if (options.atBottom) return offsets[offsets.length - 1].key

  const threshold = options.threshold ?? 0
  let current = offsets[0].key
  for (const offset of offsets) {
    if (offset.top <= threshold) current = offset.key
    else break
  }
  return current
}

/**
 * 算出跳转到某一块时，滚动容器应该设置的 scrollTop。
 * @param sectionTop 该区块相对滚动视口顶部的偏移
 * @param scrollTop 滚动容器当前的 scrollTop
 * @param offset 吸顶目录栏占掉的高度，避免标题被压在目录底下
 */
export function targetScrollTop(sectionTop: number, scrollTop: number, offset: number): number {
  return Math.max(0, Math.round(scrollTop + sectionTop - offset))
}
