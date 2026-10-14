import { useCallback, useMemo, useState } from 'react'
import {
  archiveStats,
  findEntry,
  mainLine,
  moveWeek,
  recentSlots,
  updateWeekResult,
  weekCounts,
  type WeekEntry,
} from '../core/archive'
import { resultToMarkdown } from '../core/resultText'
import { stampText, timeAgo } from '../core/recency'
import { compareScores, previousEntry, recurringPatterns } from '../core/trends'
import {
  WEEKDAY_NAMES,
  addWeeks,
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
  weekTitle,
  weeksBetween,
  weeksInMonth,
  type MonthRef,
  type WeekKey,
} from '../core/week'
import type { WeeklyResult } from '../core/types'
import { ALL_COLLAPSED, toggledCollapsed, type CollapsibleKey } from './CollapsibleCard'
import { BlurText } from './BlurText'
import { CountUp } from './CountUp'
import { FadeIn } from './FadeIn'
import { IconBack, IconCheck, IconChevron, IconCopy, IconSparkle } from './icons'
import { ResultBody } from './ResultBody'

/**
 * 总览：把每一周的主线摊在一个日历上。
 *
 * 这一页要回答的问题只有一个 ——「上周（上上周）我到底在忙什么」。
 * 所以顺序是：近三周先把最想知道的那两句摆出来，日历给全局的「哪几周记了、
 * 哪几周断了」，再下面才是选中那一周的全文（可以直接改，改完存回那一周）。
 *
 * 没记录的那一周**照样占位置**，写「没记」。空着不画只会让人以为那周不存在，
 * 而「上上周忘了记」本身就是要看见的信息。
 */

interface Props {
  archive: WeekEntry[]
  onArchiveChange: (next: WeekEntry[]) => void
  onBack: () => void
  onStart: () => void
}

/** 主线太长时截一句，卡片里放不下整段 */
function excerpt(text: string, max = 54): string {
  const clean = text.replace(/\s+/g, ' ').trim()
  return clean.length > max ? `${clean.slice(0, max)}…` : clean
}

function savedAtText(at: number): string {
  const date = new Date(at)
  return `${date.getMonth() + 1}月${date.getDate()}日记的`
}

export function HistoryPage({ archive, onArchiveChange, onBack, onStart }: Props) {
  // 「现在」在进这一页时定住：翻日历的过程中不该因为跨过零点就跳周
  const now = useMemo(() => new Date(), [])
  const thisWeek = weekKeyOf(now)

  const stats = useMemo(() => archiveStats(archive, now), [archive, now])
  const slots = useMemo(() => recentSlots(archive, now), [archive, now])
  const marked = useMemo(() => new Set(archive.map((e) => e.week)), [archive])

  const [selected, setSelected] = useState<WeekKey>(thisWeek)
  const [month, setMonth] = useState<MonthRef>(() => monthOf(now))
  const [collapsed, setCollapsed] = useState(ALL_COLLAPSED)
  const [copied, setCopied] = useState(false)

  const entry = findEntry(archive, selected)
  const relation = weekRelation(selected, now)
  const weeks = useMemo(() => weeksInMonth(month), [month])
  /** 反复出现与上周对比都按「选中那一周」算 —— 看旧周时不该拿后来的周说事 */
  const patterns = useMemo(() => recurringPatterns(archive, selected), [archive, selected])
  const comparison = useMemo(
    () => compareScores(entry?.result.state.scores, previousEntry(archive, selected), selected),
    [archive, entry, selected],
  )

  const select = useCallback((week: WeekKey) => setSelected(week), [])

  const toggleCollapsed = useCallback((key: CollapsibleKey) => {
    setCollapsed((prev) => toggledCollapsed(prev, key))
  }, [])

  /* ---------------- 改的就是那一周的存档 ---------------- */

  /**
   * 这里改的就是那一周的存档本身（不像结果页改的是「本周」这一份）。
   * 靠 updateWeekResult 把它写回同一个 week 键上，所以改多少遍都不会串周。
   */
  const editResult = useCallback(
    (next: WeeklyResult) => {
      onArchiveChange(updateWeekResult(archive, selected, next, Date.now()))
    },
    [archive, onArchiveChange, selected],
  )

  /** 挪到前后几周；目标那一周已经有记录时不允许挪（宁可不挪，也不顶掉别人的存档） */
  const shift = (delta: number) => {
    const target = addWeeks(selected, delta)
    if (!entry || !canShift(archive, marked, thisWeek, selected, delta)) return
    onArchiveChange(moveWeek(archive, selected, delta))
    setSelected(target)
    const targetDate = parseWeekKey(target)
    if (targetDate) setMonth(monthOf(targetDate))
  }

  const copy = async () => {
    if (!entry) return
    const markdown = resultToMarkdown(entry.result)
    try {
      await navigator.clipboard.writeText(markdown)
    } catch {
      const ta = document.createElement('textarea')
      ta.value = markdown
      ta.style.position = 'fixed'
      ta.style.opacity = '0'
      document.body.appendChild(ta)
      ta.select()
      document.execCommand('copy')
      ta.remove()
    }
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1800)
  }

  const counts = entry ? weekCounts(entry.result) : null

  return (
    <main className="page history">
      <div className="result-head">
        <div>
          <h1 className="result-title">
            <BlurText text="总览" />
          </h1>
          <p className="result-sub">
            {stats.weeks === 0 ? (
              '还没有记录。聊完一次，那一周就会出现在这里'
            ) : (
              <>
                {/* 鼠标停上去能看到具体到分钟的时刻；平时只写相对说法，一眼就知道多久没记了 */}
                {stats.lastWritten !== null && (
                  <>
                    <span className="last-written" title={stampText(stats.lastWritten)}>
                      上次记录 {timeAgo(stats.lastWritten, now.getTime())}
                    </span>
                    {' · '}
                  </>
                )}
                {/* 0.9.10：两个数字滚上去 —— 这一句是全页唯一值得动的地方 */}
                {'已经记了 '}
                <CountUp value={stats.weeks} />
                {' 周 · 最近连续 '}
                <CountUp value={stats.streak} />
                {` 周${stats.hasThisWeek ? '' : ' · 这周还没记'}`}
              </>
            )}
          </p>
        </div>
        <div className="result-actions">
          {!stats.hasThisWeek && (
            <button className="btn primary" type="button" onClick={onStart}>
              <IconSparkle size={15} />
              聊这周
            </button>
          )}
          <button className="btn ghost" type="button" onClick={onBack}>
            <IconBack size={15} />
            返回
          </button>
        </div>
      </div>

      {/* 近三周：最想知道的就是这两三句，先摆出来（0.9.9：三张卡依次轻轻浮出） */}
      <div className="recent-grid">
        {slots.map((slot, i) => {
          const line = mainLine(slot.entry)
          return (
            <FadeIn key={slot.week} delay={0.04 + i * 0.06}>
              <button
                type="button"
                className={`recent-card${slot.week === selected ? ' active' : ''}${
                  slot.entry ? '' : ' blank'
                }`}
                onClick={() => select(slot.week)}
              >
                <span className="recent-head">
                  <span className="recent-label">{slot.label}</span>
                  <span className="recent-range">{weekRangeText(slot.week)}</span>
                </span>
                <span className="recent-line">
                  {line ? excerpt(line) : slot.week === thisWeek ? '这周还没聊' : '这周没留下记录'}
                </span>
              </button>
            </FadeIn>
          )
        })}
      </div>

      {/* 月历：一行就是一周，从周一开始，和 weekKey 的口径一致 */}
      <section className="card cal-card">
        <div className="cal-head">
          <h2 className="card-title">日历</h2>
          <div className="cal-nav">
            <button
              className="btn ghost"
              type="button"
              onClick={() => setMonth(shiftMonth(month, -1))}
              aria-label="上个月"
            >
              <IconChevron size={15} className="chev-prev" />
            </button>
            <span className="cal-month">{monthLabel(month)}</span>
            <button
              className="btn ghost"
              type="button"
              onClick={() => setMonth(shiftMonth(month, 1))}
              aria-label="下个月"
            >
              <IconChevron size={15} className="chev-next" />
            </button>
            <button
              className="btn ghost sm"
              type="button"
              onClick={() => {
                setMonth(monthOf(now))
                setSelected(thisWeek)
              }}
            >
              回到本周
            </button>
          </div>
        </div>

        <p className="card-desc">
          实心的那一行是记过的一周，点任意一天就能看那一周 · 灰色的是这个月以外的日子
        </p>

        <div className="cal-weekdays" aria-hidden="true">
          {WEEKDAY_NAMES.map((name) => (
            <span key={name} className="cal-weekday">
              {name}
            </span>
          ))}
        </div>

        <div className="cal-grid">
          {weeks.map((week) => {
            const has = marked.has(week)
            const line = mainLine(findEntry(archive, week))
            const classes = [
              'cal-row',
              has ? 'has-entry' : '',
              week === selected ? 'selected' : '',
              week === thisWeek ? 'this-week' : '',
            ]
              .filter(Boolean)
              .join(' ')
            return (
              <div
                key={week}
                className={classes}
                title={has ? `${weekTitle(week, now)}：${line || '没写主线'}` : weekTitle(week, now)}
              >
                {daysOfWeek(week).map((day) => (
                  <button
                    key={day.getTime()}
                    type="button"
                    className={`cal-day${inMonth(day, month) ? '' : ' outside'}`}
                    aria-pressed={week === selected}
                    aria-label={`${day.getMonth() + 1}月${day.getDate()}日，${weekRangeText(week)}`}
                    onClick={() => select(week)}
                  >
                    {day.getDate()}
                  </button>
                ))}
              </div>
            )
          })}
        </div>
      </section>

      {/* 选中那一周的全文：可以直接改，改完就存在那一周名下 */}
      <section className="card week-detail">
        <div className="result-head">
          <div>
            <h2 className="card-title">
              {weekTitle(selected, now)}
              {relationLabel(relation) && (
                <span className="week-rel">{relationLabel(relation)}</span>
              )}
            </h2>
            <p className="card-desc">
              {weekRangeText(selected)}
              {entry ? ` · ${savedAtText(entry.savedAt)}` : ' · 这一周没有记录'}
              {entry && ' · 下面改的就是这一周存下来的内容'}
            </p>
          </div>
          <div className="result-actions">
            {entry ? (
              <>
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
                <button className="btn ghost" type="button" onClick={copy}>
                  {copied ? <IconCheck size={15} /> : <IconCopy size={15} />}
                  {copied ? '已复制' : '复制全文'}
                </button>
              </>
            ) : selected === thisWeek ? (
              <button className="btn primary" type="button" onClick={onStart}>
                <IconSparkle size={15} />
                现在聊一聊
              </button>
            ) : null}
          </div>
        </div>

        {entry && counts ? (
          <>
            <p className="week-counts">
              事情 {counts.events} · 人际 {counts.people} · 物品 {counts.things} · 未办{' '}
              {counts.pending} · 主线 {counts.highlights} · 计划 {counts.plan}
            </p>
            <ResultBody
              result={entry.result}
              onResultChange={editResult}
              collapsed={collapsed}
              onToggle={toggleCollapsed}
              compare={comparison}
              patterns={patterns}
            />
          </>
        ) : (
          <p className="empty">
            {relation === 'future'
              ? '这一周还没到。'
              : selected === thisWeek
                ? '这一周还没聊过。聊完之后，它就会出现在这张日历上。'
                : '这一周没留下记录。补不了当时的对话了，但空白本身也是信息 —— 从这里能看出哪几周断过。'}
          </p>
        )}
      </section>

      {/* 全部记录：日历看的是「哪几周」，这里看的是「都记了些什么」 */}
      {archive.length > 0 && (
        <section className="card">
          <h2 className="card-title">全部记录</h2>
          <p className="card-desc">新的在前 · 点一条就跳到那一周</p>
          <ul className="week-list">
            {archive.map((item) => {
              const line = mainLine(item)
              const rel = relationLabel(weekRelation(item.week, now))
              return (
                <li key={item.week}>
                  <button
                    type="button"
                    className={`week-row${item.week === selected ? ' active' : ''}`}
                    onClick={() => {
                      select(item.week)
                      const date = parseWeekKey(item.week)
                      if (date) setMonth(monthOf(date))
                    }}
                  >
                    <span className="week-when">
                      {weekRangeText(item.week)}
                      {rel && <span className="week-rel">{rel}</span>}
                    </span>
                    <span className="week-line">{line ? excerpt(line, 70) : '（这一周没写主线）'}</span>
                  </button>
                </li>
              )
            })}
          </ul>
        </section>
      )}
    </main>
  )
}

/** 能不能挪：有记录、目标周空着、而且不挪到未来 */
function canShift(
  archive: WeekEntry[],
  marked: Set<WeekKey>,
  thisWeek: WeekKey,
  from: WeekKey,
  delta: number,
): boolean {
  if (!findEntry(archive, from)) return false
  const target = addWeeks(from, delta)
  if (marked.has(target)) return false
  return (weeksBetween(thisWeek, target) ?? 1) <= 0
}
