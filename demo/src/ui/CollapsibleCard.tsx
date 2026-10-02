import type { ReactNode } from 'react'

/**
 * 可以折叠的卡片。
 *
 * 用在两处：复盘页里「你写的原文」那一块（复盘出来之后默认收起，
 * 让位给结论）、总览页里旧周的原文。两边必须是同一套观感
 * （收起时只剩标题、点一下展开），各写一份迟早会长歪。
 */

interface Props {
  /** 用来当 DOM id 后缀，也是 aria 的关节点 */
  id: string
  title: string
  desc: string
  count: number
  collapsed: boolean
  onToggle: () => void
  children: ReactNode
}

export function CollapsibleCard({ id, title, desc, count, collapsed, onToggle, children }: Props) {
  const domId = `section-${id}`

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
