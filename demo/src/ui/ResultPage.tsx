import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { resultToMarkdown } from '../core/resultText'
import {
  SECTION_KEYS,
  activeSection,
  buildOutline,
  sectionDomId,
  targetScrollTop,
  type SectionKey,
} from '../core/outline'
import type { ChatMessage, WeeklyResult } from '../core/types'
import { weekRangeText, type WeekKey } from '../core/week'
import { ALL_COLLAPSED, isCollapsible, toggledCollapsed, type CollapsibleKey } from './CollapsibleCard'
import { ResultBody } from './ResultBody'

interface Props {
  result: WeeklyResult
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

export function ResultPage({
  result,
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

  const outline = useMemo(() => buildOutline(result), [result])
  const markdown = resultToMarkdown(result)

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
            看总览
          </button>
          <button className="btn primary" type="button" onClick={copy}>
            {copied ? '已复制 ✓' : '复制全文'}
          </button>
          <button className="btn ghost" type="button" onClick={onRestart}>
            再来一次
          </button>
        </div>
      </div>

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
        <button className="btn ghost" type="button" onClick={onBack}>
          回到对话
        </button>
      </div>
    </main>
  )
}
