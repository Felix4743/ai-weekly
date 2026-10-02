import { useEffect, useState } from 'react'
import type { WeekEntry } from '../core/archive'
import type { Review } from '../core/review'
import { relationLabel, weekRelation, weekTitle, type WeekKey } from '../core/week'
import { CollapsibleCard } from './CollapsibleCard'
import { ReviewBody } from './ReviewBody'

/**
 * 复盘页 —— 0.9.0 的主页。
 *
 * 顺序刻意反过来：**你先写，AI 后说**。所以没复盘之前这一页只有一张
 * 大纸和一个「开始复盘」；写完才有结论。复盘出来之后原文自动收起来
 * （它已经读完了），要改可以展开 —— 改完再复盘一次就行。
 *
 * 「接着说」那条路是留给补漏的：事情没写全、这周和谁玩了忘写了，
 * 补一句就能再复盘一次，不用从头写。
 */

interface Props {
  week: WeekKey
  notes: string
  review: Review | null
  reply: string
  archive: WeekEntry[]
  analyzing: boolean
  onNotesChange: (text: string) => void
  onAnalyze: () => void
  onFollowUp: (text: string) => void
  onReviewChange: (review: Review) => void
  onOpenHistory: () => void
}

export function JournalPage({
  week,
  notes,
  review,
  reply,
  archive,
  analyzing,
  onNotesChange,
  onAnalyze,
  onFollowUp,
  onReviewChange,
  onOpenHistory,
}: Props) {
  const now = new Date()
  const relation = relationLabel(weekRelation(week, now))
  const hasReview = review !== null

  const [collapsed, setCollapsed] = useState(true)
  const [followUp, setFollowUp] = useState('')

  // 刚复盘出来时把原文收起来，让位给结论；之后展开/收起听用户的
  useEffect(() => {
    if (hasReview) setCollapsed(true)
  }, [hasReview])

  const sendFollowUp = () => {
    const text = followUp.trim()
    if (!text || analyzing) return
    setFollowUp('')
    onFollowUp(text)
  }

  const notesBox = (
    <>
      <textarea
        className="notes-input"
        value={notes}
        rows={hasReview ? 8 : 16}
        placeholder="这一周都发生了什么？做了什么、卡在哪、想到什么…想到什么写什么，写散了也没关系。"
        onChange={(e) => onNotesChange(e.target.value)}
      />
      <div className="notes-foot">
        <span className="notes-count">
          {notes.trim() ? `${notes.trim().length} 字` : '还没写'}
        </span>
        <button
          className="btn primary"
          type="button"
          disabled={analyzing || !notes.trim()}
          onClick={onAnalyze}
        >
          {analyzing ? '正在复盘…' : hasReview ? '重新复盘' : '开始复盘'}
        </button>
      </div>
    </>
  )

  return (
    <main className="page journal">
      <header className="journal-head">
        <h1 className="journal-title">复盘</h1>
        <span className="journal-week">
          {weekTitle(week, now)}
          {relation && <span className="journal-rel">{relation}</span>}
        </span>
      </header>

      {!hasReview && (
        <section className="card notes-card">
          <h2 className="card-title">这一周发生了什么</h2>
          <p className="card-desc">
            想写多少写多少，不用管顺序 —— 写完点「开始复盘」，整理是 AI 的事。
          </p>
          {notesBox}
        </section>
      )}

      {/* 第一次复盘时按钮自己就写着「正在复盘…」，这张卡留给「已经有结论、又跑了一次」的场合 */}
      {analyzing && hasReview && (
        <section className="card analyzing">
          <span className="spinner" aria-hidden="true" />
          <span className="analyzing-text">正在复盘这一周…</span>
        </section>
      )}

      {hasReview && review && (
        <>
          <CollapsibleCard
            id="notes"
            title="你写的原文"
            desc="改完还能再复盘一次 —— 清单以你改的为准，不用怕被冲掉。"
            count={0}
            collapsed={collapsed}
            onToggle={() => setCollapsed(!collapsed)}
          >
            {notesBox}
          </CollapsibleCard>

          <ReviewBody review={review} archive={archive} week={week} onChange={onReviewChange} />

          {/* 「接着说」那句话是对着他刚补的内容说的，所以摆在新复盘下面 */}
          {reply && <p className="nudge reply">{reply}</p>}

          {review.nudge && <p className="nudge">{review.nudge}</p>}

          <section className="card followup-card">
            <h2 className="card-title">还有要补的吗</h2>
            <p className="card-desc">
              有没写到的（这周和谁玩了、身体怎么样…）补一句就行，AI 会再把这一周过一遍。
            </p>
            <div className="followup-row">
              <input
                className="edit-input"
                value={followUp}
                placeholder="再补一句…"
                disabled={analyzing}
                onChange={(e) => setFollowUp(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    sendFollowUp()
                  }
                }}
              />
              <button
                className="btn"
                type="button"
                disabled={analyzing || !followUp.trim()}
                onClick={sendFollowUp}
              >
                接着说
              </button>
            </div>
          </section>
        </>
      )}

      <div className="journal-actions">
        <button className="link-btn" type="button" onClick={onOpenHistory}>
          看看以前记的
        </button>
      </div>
    </main>
  )
}
