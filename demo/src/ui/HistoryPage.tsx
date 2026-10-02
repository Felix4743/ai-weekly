import { useMemo, useState } from 'react'
import {
  archiveStats,
  findEntry,
  mainLine,
  moveWeek,
  recentSlots,
  updateWeek,
  weekCounts,
  type WeekEntry,
} from '../core/archive'
import { stampText, timeAgo } from '../core/recency'
import { isReviewEmpty, type Review } from '../core/review'
import { droppedAfter, mergeDropped } from '../core/reviewEdit'
import {
  WEEKDAY_NAMES,
  dayLabel,
  daysOfWeek,
  inMonth,
  monthLabel,
  monthOf,
  parseWeekKey,
  relationLabel,
  shiftMonth,
  weekKeyOf,
  weekRangeText,
  weekRelation,
  weeksBetween,
  weeksInMonth,
  weekTitle,
  type WeekKey,
} from '../core/week'
import { CollapsibleCard } from './CollapsibleCard'
import { ReviewBody } from './ReviewBody'

/**
 * 总览页 —— 四年（两百六十周）都要能翻得动。
 *
 * 三块各回答一个问题：上面三张卡是「最近三周怎么样」（一眼看到主线，
 * 没记的那一周也占位，提醒你漏了）；中间月历是「想找哪一周」；
 * 下面是「全都记了什么」。
 *
 * 进页就把 `now` 冻结：翻日历翻到半夜，页面不该自己跳周。
 */

interface Props {
  archive: WeekEntry[]
  onArchiveChange: (next: WeekEntry[]) => void
  onBack: () => void
  /** 去复盘页写/改这一周 */
  onOpenWeek: (week: WeekKey) => void
}

function excerpt(text: string, max = 54): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length <= max ? flat : `${flat.slice(0, max)}…`
}

function savedAtText(at: number): string {
  const date = new Date(at)
  return `${date.getMonth() + 1}月${date.getDate()}日记的`
}

/**
 * 这一周到底复盘过没有 —— 决定列表里空着的那行写「还没复盘」还是「复盘过」。
 *
 * 单看 `mainLine` 分不出来：只剩对账项的复盘主线是空的，但它明明复盘过
 * （对账项是上一周的事，按 `mainLine` 的规矩不该摆到这一周），
 * 写「还没复盘」就跟上面「对账 N 条」自相矛盾。
 */
function reviewedAtAll(entry: WeekEntry | null): boolean {
  return entry?.review ? !isReviewEmpty(entry.review) : false
}

/** 能不能把这一周的记录挪到相邻那一周：有记录、目标周空着、且不挪到未来 */
function canShift(
  archive: WeekEntry[],
  marked: Set<WeekKey>,
  thisWeek: WeekKey,
  from: WeekKey,
  delta: number,
): boolean {
  if (!findEntry(archive, from)) return false
  const target = targetWeek(from, delta)
  if (marked.has(target)) return false
  return (weeksBetween(thisWeek, target) ?? 1) <= 0
}

function targetWeek(from: WeekKey, delta: number): WeekKey {
  const date = parseWeekKey(from) ?? new Date()
  date.setDate(date.getDate() + delta * 7)
  return weekKeyOf(date)
}

export function HistoryPage({ archive, onArchiveChange, onBack, onOpenWeek }: Props) {
  const now = useMemo(() => new Date(), [])
  const thisWeek = weekKeyOf(now)

  const [selected, setSelected] = useState<WeekKey>(thisWeek)
  const [month, setMonth] = useState(() => monthOf(now))
  const [notesOpen, setNotesOpen] = useState(false)

  const stats = archiveStats(archive, now)
  const slots = recentSlots(archive, now)
  const marked = useMemo(() => new Set(archive.map((entry) => entry.week)), [archive])
  const entry = findEntry(archive, selected)
  const counts = weekCounts(entry?.review ?? null)
  const weeks = useMemo(() => weeksInMonth(month), [month])

  const pick = (week: WeekKey) => {
    setSelected(week)
    setNotesOpen(false)
    const date = parseWeekKey(week)
    if (date) setMonth(monthOf(date))
  }

  const shift = (delta: number) => {
    const target = targetWeek(selected, delta)
    const next = moveWeek(archive, selected, target, Date.now())
    if (next === archive) return
    onArchiveChange(next)
    setSelected(target)
  }

  const editReview = (review: Review) => {
    const entry = findEntry(archive, selected)
    // 手改也要记下「这一轮删掉了什么」：下次重新整理时，模型不能把它们带回来
    const dropped = mergeDropped(
      entry?.dropped ?? [],
      entry?.review ? droppedAfter(entry.review, review) : [],
    )
    onArchiveChange(updateWeek(archive, selected, { review, dropped }, Date.now()))
  }

  return (
    <main className="page history">
      <header className="result-head">
        <h1 className="result-title">总览</h1>
        <p className="result-sub">
          {archive.length === 0 ? (
            '还没有记录。复盘完一周，那一周就会出现在这里'
          ) : (
            <>
              {stats.lastWritten !== null && (
                <>
                  <span className="last-written" title={stampText(stats.lastWritten)}>
                    上次记录 {timeAgo(stats.lastWritten, now.getTime())}
                  </span>
                  {' · '}
                </>
              )}
              {`已经记了 ${stats.weeks} 周 · 最近连续 ${stats.streak} 周`}
              {stats.hasThisWeek ? '' : ' · 这周还没记'}
            </>
          )}
        </p>
        <div className="result-actions">
          <button className="btn primary" type="button" onClick={() => onOpenWeek(thisWeek)}>
            复盘这周
          </button>
          <button className="btn ghost" type="button" onClick={onBack}>
            返回
          </button>
        </div>
      </header>

      {archive.length === 0 ? (
        <section className="card empty-card">
          <p className="empty">这周写两句，下周就能在这儿看到它。</p>
        </section>
      ) : (
        <>
          <div className="recent-grid">
            {slots.map((slot) => {
              const line = mainLine(slot.entry)
              return (
                <button
                  key={slot.week}
                  className={`recent-card${slot.entry ? '' : ' blank'}${
                    slot.week === selected ? ' active' : ''
                  }`}
                  type="button"
                  onClick={() => pick(slot.week)}
                >
                  <span className="recent-head">
                    <span className="recent-label">{slot.label}</span>
                    <span className="recent-range">{weekRangeText(slot.week)}</span>
                  </span>
                  <span className="recent-line">
                    {line ||
                      (slot.entry
                        ? reviewedAtAll(slot.entry)
                          ? '复盘过，没抽出一句话'
                          : '这周还没复盘'
                        : '这周没留下记录')}
                  </span>
                </button>
              )
            })}
          </div>

          <section className="card cal-card">
            <div className="cal-head">
              <span className="card-title" role="heading" aria-level={2}>
                找一周
              </span>
              <span className="cal-nav">
                <button
                  className="btn ghost"
                  type="button"
                  aria-label="上个月"
                  onClick={() => setMonth(shiftMonth(month, -1))}
                >
                  ‹
                </button>
                <span className="cal-month">{monthLabel(month)}</span>
                <button
                  className="btn ghost"
                  type="button"
                  aria-label="下个月"
                  onClick={() => setMonth(shiftMonth(month, 1))}
                >
                  ›
                </button>
                <button className="link-btn" type="button" onClick={() => pick(thisWeek)}>
                  回到本周
                </button>
              </span>
            </div>
            <p className="card-desc">有记录的那一周会亮起来，点一下就翻到下面。</p>

            <div className="cal-weekdays">
              {WEEKDAY_NAMES.map((name) => (
                <span key={name} className="cal-weekday">
                  {name}
                </span>
              ))}
            </div>

            <div className="cal-grid">
              {weeks.map((week) => {
                const rowEntry = findEntry(archive, week)
                const head = mainLine(rowEntry)
                return (
                  <div
                    key={week}
                    className={`cal-row${rowEntry ? ' has-entry' : ''}${
                      week === selected ? ' selected' : ''
                    }${week === thisWeek ? ' this-week' : ''}`}
                  >
                    {daysOfWeek(week).map((day) => (
                      <button
                        key={day.getTime()}
                        className={`cal-day${inMonth(day, month) ? '' : ' outside'}`}
                        type="button"
                        aria-label={`${dayLabel(day)}（${weekRangeText(week)}）`}
                        title={`${weekTitle(week, now)}${
                          head
                            ? ` · ${head}`
                            : rowEntry
                              ? reviewedAtAll(rowEntry)
                                ? ' · 复盘过，没抽出一句话'
                                : ' · 还没复盘'
                              : ' · 没记录'
                        }`}
                        onClick={() => pick(week)}
                      >
                        {day.getDate()}
                      </button>
                    ))}
                  </div>
                )
              })}
            </div>
          </section>

          <section className="card week-detail">
            <div className="result-head">
              <h2 className="card-title">{weekTitle(selected, now)}</h2>
              <span className="week-rel">{relationLabel(weekRelation(selected, now))}</span>
              <p className="card-desc">
                {weekRangeText(selected)}
                {entry ? ` · ${savedAtText(entry.savedAt)}` : ' · 没有记录'}
              </p>
            </div>

            <div className="result-actions">
              <button
                className="btn ghost"
                type="button"
                disabled={!canShift(archive, marked, thisWeek, selected, -1)}
                onClick={() => shift(-1)}
              >
                挪到上一周
              </button>
              <button
                className="btn ghost"
                type="button"
                disabled={!canShift(archive, marked, thisWeek, selected, 1)}
                onClick={() => shift(1)}
              >
                挪到下一周
              </button>
              <button className="btn primary" type="button" onClick={() => onOpenWeek(selected)}>
                {entry?.review ? '改这一周' : '去写这一周'}
              </button>
            </div>

            {entry && (
              <p className="week-counts">
                {counts.did > 0 && <span>{`做了 ${counts.did} 件`}</span>}
                {counts.issues > 0 && <span>{`问题 ${counts.issues} 个`}</span>}
                {counts.plan > 0 && <span>{`计划 ${counts.plan} 条`}</span>}
                {counts.reconcile > 0 && <span>{`对账 ${counts.reconcile} 条`}</span>}
                {!counts.did && !counts.issues && !counts.plan && !counts.reconcile && <span>还没复盘</span>}
              </p>
            )}

            {entry?.review ? (
              <>
                {entry.notes.trim() && (
                  <CollapsibleCard
                    id="week-notes"
                    title="那一周写的原文"
                    desc="留着对照用 —— 结论就是从这段话里来的。"
                    count={0}
                    collapsed={!notesOpen}
                    onToggle={() => setNotesOpen(!notesOpen)}
                  >
                    <p className="notes-read">{entry.notes}</p>
                  </CollapsibleCard>
                )}
                <ReviewBody
                  review={entry.review}
                  archive={archive}
                  week={selected}
                  onChange={editReview}
                />
              </>
            ) : entry ? (
              <>
                <p className="empty">这一周只写了原文，还没复盘。</p>
                <p className="notes-read">{excerpt(entry.notes, 400)}</p>
              </>
            ) : (
              <p className="empty">这一周没有记录。</p>
            )}
          </section>

          <section className="card">
            <h2 className="card-title">全部记录</h2>
            <p className="card-desc">{`一共 ${stats.weeks} 周，新的在最上面。`}</p>
            <ul className="week-list">
              {archive.map((item) => (
                <li key={item.week}>
                  <button
                    className={`week-row${item.week === selected ? ' active' : ''}`}
                    type="button"
                    onClick={() => pick(item.week)}
                  >
                    <span className="week-when">
                      {weekTitle(item.week, now)}
                      {relationLabel(weekRelation(item.week, now)) && (
                        <span className="week-rel">
                          {relationLabel(weekRelation(item.week, now))}
                        </span>
                      )}
                    </span>
                    <span className="week-line">
                      {excerpt(mainLine(item) || item.notes || '（空的）')}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        </>
      )}
    </main>
  )
}
