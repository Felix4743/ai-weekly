import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { mainLineOf, type WeekEntry } from '../core/archive'
import { resultToMarkdown } from '../core/resultText'
import {
  SECTION_KEYS,
  activeSection,
  buildOutline,
  sectionDomId,
  targetScrollTop,
  type SectionKey,
} from '../core/outline'
import { SCORE_MAX, scoreText } from '../core/stateScore'
import { STATE_FIELDS } from '../core/stateFields'
import { compareScores, compareText, previousEntry, recurringPatterns } from '../core/trends'
import type { ChatMessage, WeeklyResult } from '../core/types'
import { weekRangeText, type WeekKey } from '../core/week'
import { ALL_COLLAPSED, isCollapsible, toggledCollapsed, type CollapsibleKey } from './CollapsibleCard'
import { FadeIn } from './FadeIn'
import { IconBack, IconChart, IconCheck, IconCopy, IconRefresh } from './icons'
import { ResultBody } from './ResultBody'

interface Props {
  result: WeeklyResult
  /** 归档：跟上一周比、算「反复出现」都从这儿读，只读不写 */
  archive: WeekEntry[]
  messages: ChatMessage[]
  restored: boolean
  refining: boolean
  /** 这份结果记在哪一周，显示在标题下面 —— 让人知道去总览里上哪儿找它 */
  week: WeekKey
  onResultChange: (next: WeeklyResult) => void
  onRefine: (note: string) => void
  onRestart: () => void
  onBack: () => void
  onOpenHistory: () => void
}

/**
 * 结果页的正文（结果页与总览页共用）。
 * 只在「值得停一下」的地方包一层 FadeIn —— 不是每行都动，
 * 是那句「本周主线」与那一排星星，让你进门先看到它。
 */
export function ResultPage({
  result,
  archive,
  messages,
  restored,
  refining,
  week,
  onResultChange,
  onRefine,
  onRestart,
  onBack,
  onOpenHistory,
}: Props) {
  const [copied, setCopied] = useState(false)
  const [showLog, setShowLog] = useState(false)
  const [note, setNote] = useState('')
  const [current, setCurrent] = useState<SectionKey>(SECTION_KEYS[0])
  const [collapsed, setCollapsed] = useState<Record<CollapsibleKey, boolean>>(ALL_COLLAPSED)
  /** 目录跳转要同步读到最新的折叠状态，所以除了 state 再留一份 ref */
  const collapsedRef = useRef<Record<CollapsibleKey, boolean>>(ALL_COLLAPSED)

  const scrollerRef = useRef<HTMLElement>(null)
  const navRef = useRef<HTMLElement>(null)
  /** 刚点过目录时钉住的那一项，避免滚动到底后又被判定成最后一块 */
  const pinnedRef = useRef<SectionKey | null>(null)

  /** 跨周反复出现的东西（core/trends.ts）：只读归档，算错最多是少显示一条 */
  const patterns = useMemo(() => recurringPatterns(archive, week), [archive, week])
  /** 跟上次记的那一周比：中间那周没记就往前找，文案也跟着说「上一次」 */
  const comparison = useMemo(
    () => compareScores(result.state.scores, previousEntry(archive, week), week),
    [archive, week, result.state.scores],
  )
  /** 状态那几行后面的小字（`上周 3 ↑1`）：按 key 查一次也顺手给页头用 */
  const beforeByKey = new Map(comparison.rows.map((row) => [row.key, row]))
  const outline = useMemo(() => buildOutline(result, patterns.length), [result, patterns.length])
  const markdown = resultToMarkdown(result)
  /** 页头那条概览：只列**打过分的**项，一项都没打就写一句「这周没打分」 */
  const scoredFields = STATE_FIELDS.filter((f) => result.state.scores?.[f.key] !== undefined)
  const mainLine = mainLineOf(result)

  /** 吸顶目录栏遮住的高度，跳转和判定都以它为准 */
  const navOffset = () => (navRef.current?.offsetHeight ?? 0) + 12

  const toggleCollapsed = useCallback((key: CollapsibleKey) => {
    setCollapsed((prev) => {
      const next = toggledCollapsed(prev, key)
      collapsedRef.current = next
      return next
    })
  }, [])

  const scrollToSection = useCallback((key: SectionKey) => {
    const scroller = scrollerRef.current
    const target = document.getElementById(sectionDomId(key))
    if (!scroller || !target) return
    const top = target.getBoundingClientRect().top - scroller.getBoundingClientRect().top
    pinnedRef.current = key
    scroller.scrollTo({
      top: targetScrollTop(top, scroller.scrollTop, navOffset()),
      behavior: 'smooth',
    })
    setCurrent(key)
  }, [])

  const jumpTo = useCallback(
    (key: SectionKey) => {
      // 跳到收起的那一栏时先把它展开 —— 否则会跳到一个只剩两个字的地方，
      // 得等 React 把 DOM 提交完再量高度，不然量到的还是收起时那一行
      if (isCollapsible(key) && collapsedRef.current[key]) {
        toggleCollapsed(key)
        requestAnimationFrame(() => scrollToSection(key))
        return
      }
      scrollToSection(key)
    },
    [scrollToSection, toggleCollapsed],
  )

  // 滚动时把目录里对应的那一项点亮
  useEffect(() => {
    const scroller = scrollerRef.current
    if (!scroller) return

    const sync = () => {
      // 自己点出来的高亮先留着，等用户真的自己滚动了再交还给滚动判定
      if (pinnedRef.current) return

      const containerTop = scroller.getBoundingClientRect().top
      const offsets = SECTION_KEYS.map((key) => {
        const el = document.getElementById(sectionDomId(key))
        return { key, top: el ? el.getBoundingClientRect().top - containerTop : 0 }
      })
      const scrollable = scroller.scrollHeight - scroller.clientHeight > 4
      const atBottom =
        scrollable && scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 2
      const next = activeSection(offsets, { threshold: navOffset(), atBottom })
      if (next) setCurrent((prev) => (prev === next ? prev : next))
    }

    const release = () => {
      pinnedRef.current = null
    }
    const releaseEvents = ['wheel', 'touchstart', 'pointerdown', 'keydown'] as const

    sync()
    scroller.addEventListener('scroll', sync, { passive: true })
    window.addEventListener('resize', sync)
    for (const type of releaseEvents) {
      window.addEventListener(type, release, { passive: true })
    }
    return () => {
      scroller.removeEventListener('scroll', sync)
      window.removeEventListener('resize', sync)
      for (const type of releaseEvents) {
        window.removeEventListener(type, release)
      }
    }
  }, [])

  const copy = async () => {
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

  const submitNote = () => {
    const text = note.trim()
    if (!text || refining) return
    setNote('')
    onRefine(text)
  }

  return (
    <main className="page result" ref={scrollerRef}>
      <div className="result-head">
        <div>
          <h1 className="result-title">本周梳理</h1>
          <p className="result-sub">
            {restored
              ? '这是上一次保存的结果'
              : `基于 ${messages.filter((m) => m.role === 'user').length} 次回答整理而成`}
            <span className="edit-hint">· 记在 {weekRangeText(week)} · 内容都可以直接改</span>
          </p>
        </div>
        <div className="result-actions">
          <button className="btn ghost" type="button" onClick={onOpenHistory}>
            <IconChart size={15} />
            看总览
          </button>
          <button className="btn ghost" type="button" onClick={copy}>
            {copied ? <IconCheck size={15} /> : <IconCopy size={15} />}
            {copied ? '已复制' : '复制全文'}
          </button>
          <button className="btn ghost" type="button" onClick={onRestart}>
            <IconRefresh size={15} />
            再来一次
          </button>
        </div>
      </div>

      {/* 页头概览（0.9.5）：一眼看到「这周状态怎么样、主线是哪一句」——
          不用先滚过六张卡。都从这份结果里读，改了就跟着变。
          0.9.9 起整个概览带一点入场（FadeIn）：星星在先、主线压一拍 */}
      <FadeIn delay={0.04}>
        <section className="result-brief" aria-label="这周概览">
          <div className="brief-scores">
          {scoredFields.length === 0 ? (
            <span className="brief-empty">这周没打分</span>
          ) : (
            scoredFields.map((f) => {
              const row = beforeByKey.get(f.key)
              const before = row ? compareText(row) : ''
              return (
                <span key={f.key} className="brief-score">
                  <span className="brief-label">{f.label}</span>
                  <span className="stars" aria-hidden="true">
                    {Array.from({ length: SCORE_MAX }, (_, i) => (
                      <span
                        key={i}
                        className={`star${
                          i < (result.state.scores?.[f.key] ?? 0) ? ' on' : ''
                        }`}
                      >
                        ★
                      </span>
                    ))}
                  </span>
                  <span className="brief-value">{scoreText(result.state.scores?.[f.key])}</span>
                  {/* 一眼看到跟上次比是涨了还是掉了 */}
                  {before && (
                    <span
                      className="brief-prev"
                      title={comparison.previousRange ? `上一次记的：${comparison.previousRange}` : undefined}
                    >
                      {before}
                    </span>
                  )}
                </span>
              )
            })
          )}
        </div>
        <FadeIn delay={0.16}>
          <p className="brief-main">
            <span className="brief-label">本周主线</span>
            {mainLine ? (
              <span className="brief-main-text">{mainLine}</span>
            ) : (
              <span className="brief-empty">（还没有主线）</span>
            )}
          </p>
        </FadeIn>
        </section>
      </FadeIn>

      {/* 内容比较长，顶部放一条目录，点一下就跳到对应那一栏 */}
      <nav className="outline-bar" ref={navRef} aria-label="本周梳理目录">
        <span className="outline-hint">快速跳到</span>
        {outline.map((entry) => (
          <button
            key={entry.key}
            type="button"
            className={`outline-item${current === entry.key ? ' active' : ''}${
              entry.count === 0 ? ' blank' : ''
            }`}
            aria-current={current === entry.key ? 'true' : undefined}
            onClick={() => jumpTo(entry.key)}
          >
            {entry.label}
            {entry.count > 0 && <span className="outline-count">{entry.count}</span>}
          </button>
        ))}
      </nav>

      <ResultBody
        result={result}
        onResultChange={onResultChange}
        collapsed={collapsed}
        onToggle={toggleCollapsed}
        compare={comparison}
        patterns={patterns}
        planFooter={
          <div className="refine-box">
            <textarea
              rows={2}
              value={note}
              disabled={refining}
              placeholder="补充一句，比如：下周必须把报价发出去、得找赵总确认预算…"
              onChange={(e) => setNote(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                  e.preventDefault()
                  submitNote()
                }
              }}
            />
            <div className="refine-actions">
              <button
                className="btn primary"
                type="button"
                disabled={!note.trim() || refining}
                onClick={submitNote}
              >
                让 AI 重新整理
              </button>
              <span className="hint">清单内容不会被改动，只重写主线和下周计划</span>
            </div>
          </div>
        }
      />

      <div className="log-toggle">
        <button className="link-btn" type="button" onClick={() => setShowLog((v) => !v)}>
          {showLog ? '收起对话记录' : '查看对话记录'}
        </button>
      </div>

      {showLog && (
        <section className="card log">
          {messages.map((m) => (
            <div key={m.id} className={`log-row ${m.role}`}>
              <span className="log-role">{m.role === 'ai' ? 'AI' : '我'}</span>
              <span className="log-text">{m.text}</span>
            </div>
          ))}
        </section>
      )}

      <div className="footer-actions">
        <button className="btn primary" type="button" onClick={onBack}>
          <IconBack size={15} />
          回到对话
        </button>
      </div>
    </main>
  )
}
