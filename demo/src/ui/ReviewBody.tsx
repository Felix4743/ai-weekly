import { useState } from 'react'
import { repeatCount, type WeekEntry } from '../core/archive'
import { RECONCILE_LABELS, type Plan, type Review } from '../core/review'
import { removePlan, setDid, setPlan, updatePlan } from '../core/reviewEdit'
import type { WeekKey } from '../core/week'
import { EditableList } from './EditableList'

/**
 * 一份复盘的正文，五个部分。
 *
 * 顺序就是「先看结论、再看细节」：一句话 → 做了什么 → 问题与建议 →
 * 上周对账 → 下周计划。0.9.0 加进去的「同一件事连续几周出现」和
 * 「上周那条到底做了没有」，都摆在这一屏里，不用再翻别的周。
 *
 * 能改的只有**清单**（做了什么、下周计划）—— 那是「我的周是怎么过的」，
 * 用户比谁都清楚；判断类的几栏留给 AI，改了也留不住（每次复盘都重算）。
 */

interface Props {
  review: Review
  archive: WeekEntry[]
  week: WeekKey
  /** 给了才可编辑；总览页看旧周时只读 */
  onChange?: (review: Review) => void
}

interface PlanForm {
  index: number
  text: string
  when: string
}

export function ReviewBody({ review, archive, week, onChange }: Props) {
  const [form, setForm] = useState<PlanForm | null>(null)

  const commitPlan = () => {
    if (!form || !onChange) return
    const text = form.text.trim()
    const when = form.when.trim()
    if (!text) {
      setForm(null)
      return
    }
    const next: Plan[] = form.index >= review.plan.length
      ? [...review.plan, { text, when }]
      : review.plan.map((item, i) => (i === form.index ? { text, when } : item))
    onChange(setPlan(review, next))
    setForm(null)
  }

  return (
    <div className="review">
      {review.headline && (
        <section className="card headline-card">
          <p className="headline">{review.headline}</p>
        </section>
      )}

      <section className="card">
        <h2 className="card-title">做了什么</h2>
        {onChange ? (
          <EditableList
            items={review.did}
            onChange={(items) => onChange(setDid(review, items))}
            placeholder="这一周做了什么"
            addLabel="补一条"
            emptyText="（这次没写出什么具体的事）"
          />
        ) : (
          <ul className="plain-list">
            {review.did.map((item, i) => (
              <li key={`${i}-${item}`}>{item}</li>
            ))}
            {review.did.length === 0 && <li className="empty">（这次没写出什么具体的事）</li>}
          </ul>
        )}
      </section>

      <section className="card">
        <h2 className="card-title">问题与建议</h2>
        {review.issues.length === 0 ? (
          <p className="empty">这一周没看出明显的问题。</p>
        ) : (
          <ul className="issue-list">
            {review.issues.map((issue, i) => {
              const before = repeatCount(archive, week, issue.key)
              return (
                <li key={`${i}-${issue.text}`} className="issue-row">
                  <div className="issue-head">
                    <span className="issue-text">{issue.text}</span>
                    {issue.key && <span className="issue-key">{issue.key}</span>}
                    {/* 跨周的那一层：同一个标签在前几周也出现过，才说「第几次」 */}
                    {before > 0 && (
                      <span className="issue-repeat" title="前几周也记过同一个标签">
                        第 {before + 1} 次出现
                      </span>
                    )}
                  </div>
                  {issue.advice.length > 0 && (
                    <ul className="advice-list">
                      {issue.advice.map((line, j) => (
                        <li key={j}>{line}</li>
                      ))}
                    </ul>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </section>

      <section className="card">
        <h2 className="card-title">上周对账</h2>
        {review.reconcile.length === 0 ? (
          <p className="empty">上周没留下行动项，这次不用对账。</p>
        ) : (
          <ul className="reconcile-list">
            {review.reconcile.map((item, i) => (
              <li key={`${i}-${item.text}`} className={`reconcile-row ${item.state}`}>
                <span className="reconcile-state">{RECONCILE_LABELS[item.state]}</span>
                <span className="reconcile-text">{item.text}</span>
                {item.note && <span className="reconcile-note">{item.note}</span>}
              </li>
            ))}
          </ul>
        )}
        <p className="card-desc">
          「没提到」多半不等于没做，只是这周没写到 —— 要不要问，你自己拿主意。
        </p>
      </section>

      <section className="card plan-card">
        <h2 className="card-title">下周计划</h2>
        {review.plan.length === 0 && <p className="empty">下周还没定下什么。</p>}

        <ul className="plan-list">
          {review.plan.map((item, i) => (
            <li key={`${i}-${item.text}`} className="plan-row">
              {form?.index === i ? (
                <div className="plan-form">
                  <input
                    className="edit-input"
                    autoFocus
                    value={form.text}
                    placeholder="做什么"
                    onChange={(e) => setForm({ ...form, text: e.target.value })}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') commitPlan()
                      if (e.key === 'Escape') setForm(null)
                    }}
                  />
                  <input
                    className="edit-input when"
                    value={form.when}
                    placeholder="什么时候（可以不写）"
                    onChange={(e) => setForm({ ...form, when: e.target.value })}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') commitPlan()
                      if (e.key === 'Escape') setForm(null)
                    }}
                  />
                  <span className="row-actions always">
                    <button type="button" title="保存" onClick={commitPlan}>
                      ✓
                    </button>
                    <button type="button" title="取消" onClick={() => setForm(null)}>
                      ✕
                    </button>
                  </span>
                </div>
              ) : (
                <>
                  <span className="plan-text">{item.text}</span>
                  {item.when && <span className="plan-when">{item.when}</span>}
                  {onChange && (
                    <span className="row-actions">
                      <button
                        type="button"
                        title="改成什么时候"
                        onClick={() => setForm({ index: i, text: item.text, when: item.when })}
                      >
                        ✎
                      </button>
                      <button
                        type="button"
                        title="删掉"
                        onClick={() => onChange(removePlan(review, i))}
                      >
                        ✕
                      </button>
                    </span>
                  )}
                </>
              )}
            </li>
          ))}

          {form && form.index >= review.plan.length && (
            <li className="plan-row">
              <div className="plan-form">
                <input
                  className="edit-input"
                  autoFocus
                  value={form.text}
                  placeholder="做什么"
                  onChange={(e) => setForm({ ...form, text: e.target.value })}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') commitPlan()
                    if (e.key === 'Escape') setForm(null)
                  }}
                />
                <input
                  className="edit-input when"
                  value={form.when}
                  placeholder="什么时候（可以不写）"
                  onChange={(e) => setForm({ ...form, when: e.target.value })}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') commitPlan()
                    if (e.key === 'Escape') setForm(null)
                  }}
                />
                <span className="row-actions always">
                  <button type="button" title="保存" onClick={commitPlan}>
                    ✓
                  </button>
                  <button type="button" title="取消" onClick={() => setForm(null)}>
                    ✕
                  </button>
                </span>
              </div>
            </li>
          )}
        </ul>

        {onChange && form === null && (
          <button
            className="add-btn"
            type="button"
            onClick={() => setForm({ index: review.plan.length, text: '', when: '' })}
          >
            ＋ 加一条
          </button>
        )}

        <p className="card-desc">
          下周照着这几条对账 —— 每条都写清「做什么」，能写上什么时候更好。
        </p>
      </section>
    </div>
  )
}

/** 给别的页面复用的编辑入口（目前只有复盘页用得到） */
export { updatePlan }
