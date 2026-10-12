import type { ReactNode } from 'react'
import { sectionDomId, type SectionKey } from '../core/outline'
import { IconChevron } from './icons'

/**
 * 可以折叠的清单卡片。
 *
 * 抽出来是因为它现在有两个使用者：结果页看本周，总览页看旧周 ——
 * 两边必须是同一套观感（收起时只剩标题那两个字、点一下展开），
 * 各写一份迟早会长歪。
 */

/** 收起时整块只剩两个字的那七栏 */
export type CollapsibleKey =
  | 'events'
  | 'people'
  | 'things'
  | 'pending'
  | 'pattern'
  | 'state'
  | 'growth'

export const COLLAPSIBLE_KEYS: CollapsibleKey[] = [
  'events',
  'people',
  'things',
  'pending',
  'pattern',
  'state',
  'growth',
]

/** 默认全部收起：进来先看见目录、主线和下周计划，要看某一栏再点开 */
export const ALL_COLLAPSED: Record<CollapsibleKey, boolean> = {
  events: true,
  people: true,
  things: true,
  pending: true,
  pattern: true,
  state: true,
  growth: true,
}

export function isCollapsible(key: SectionKey): key is CollapsibleKey {
  return (COLLAPSIBLE_KEYS as SectionKey[]).includes(key)
}

export function toggledCollapsed(
  state: Record<CollapsibleKey, boolean>,
  key: CollapsibleKey,
): Record<CollapsibleKey, boolean> {
  return { ...state, [key]: !state[key] }
}

interface Props {
  sectionKey: CollapsibleKey
  title: string
  desc: string
  count: number
  collapsed: boolean
  onToggle: () => void
  children: ReactNode
}

/**
 * 收起时整块只留标题那两个字 —— 想改的时候点一下展开，看完再点一下收起。
 * 标题本身就是要点的那个按钮，所以点哪儿都行。
 */
export function CollapsibleCard({
  sectionKey,
  title,
  desc,
  count,
  collapsed,
  onToggle,
  children,
}: Props) {
  const domId = sectionDomId(sectionKey)

  return (
    <section className={`card list-card${collapsed ? ' collapsed' : ''}`} id={domId}>
      <button
        className="card-head"
        type="button"
        aria-expanded={!collapsed}
        aria-controls={`${domId}-body`}
        onClick={onToggle}
      >
        <span className="card-title" role="heading" aria-level={2}>
          {title}
        </span>
        {count > 0 && <span className="card-count">{count}</span>}
        <span className="card-toggle" aria-hidden="true">
          {collapsed ? '展开' : '收起'}
          <IconChevron size={15} />
        </span>
      </button>

      {!collapsed && (
        <div className="card-body" id={`${domId}-body`}>
          <p className="card-desc">{desc}</p>
          {children}
        </div>
      )}
    </section>
  )
}
