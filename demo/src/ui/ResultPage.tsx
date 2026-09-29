import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { resultToMarkdown } from '../core/resultText'
import type { ListKey } from '../core/resultEdit'
import {
  SECTION_KEYS,
  activeSection,
  buildOutline,
  sectionDomId,
  targetScrollTop,
  type SectionKey,
} from '../core/outline'
import type { ChatMessage, PersonNote, WeeklyResult } from '../core/types'
import { EditableList, EditablePeople } from './EditableList'

interface Props {
  result: WeeklyResult
  messages: ChatMessage[]
  restored: boolean
  refining: boolean
  onResultChange: (next: WeeklyResult) => void
  onRefine: (note: string) => void
  onRestart: () => void
  onBack: () => void
}

export function ResultPage({
  result,
  messages,
  restored,
  refining,
  onResultChange,
  onRefine,
  onRestart,
  onBack,
}: Props) {
  const [copied, setCopied] = useState(false)
  const [showLog, setShowLog] = useState(false)
  const [note, setNote] = useState('')
  const [current, setCurrent] = useState<SectionKey>(SECTION_KEYS[0])

  const scrollerRef = useRef<HTMLElement>(null)
  const navRef = useRef<HTMLElement>(null)
  /** 刚点过目录时钉住的那一项，避免滚动到底后又被判定成最后一块 */
  const pinnedRef = useRef<SectionKey | null>(null)

  const outline = useMemo(() => buildOutline(result), [result])
  const markdown = resultToMarkdown(result)

  /** 吸顶目录栏遮住的高度，跳转和判定都以它为准 */
  const navOffset = () => (navRef.current?.offsetHeight ?? 0) + 12

  const jumpTo = useCallback((key: SectionKey) => {
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

  const setList = (key: ListKey) => (items: string[]) => onResultChange({ ...result, [key]: items })
  const setPeople = (people: PersonNote[]) => onResultChange({ ...result, people })

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
            <span className="edit-hint">· 内容都可以直接改</span>
          </p>
        </div>
        <div className="result-actions">
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

      <section className="card" id={sectionDomId('events')}>
        <h2 className="card-title">事情</h2>
        <p className="card-desc">这周都忙了些什么</p>
        <EditableList
          items={result.events}
          onChange={setList('events')}
          placeholder="这周做了什么…"
          addLabel="添加一件事"
          emptyText="（这次没有聊到具体的事）"
        />
      </section>

      <section className="card" id={sectionDomId('people')}>
        <h2 className="card-title">人际</h2>
        <p className="card-desc">这周和谁有关，卡在了哪里</p>
        <EditablePeople items={result.people} onChange={setPeople} />
      </section>

      <section className="card" id={sectionDomId('things')}>
        <h2 className="card-title">物品</h2>
        <p className="card-desc">这周买了什么、处理掉了什么</p>
        <EditableList
          items={result.things}
          onChange={setList('things')}
          placeholder="买了什么、卖掉了什么…"
          addLabel="添加一样东西"
          emptyText="（这周没有添置或处理东西）"
        />
      </section>

      <section className="card" id={sectionDomId('pending')}>
        <h2 className="card-title">悬着</h2>
        <p className="card-desc">还没做完、一直拖着的事</p>
        <EditableList
          items={result.pending}
          onChange={setList('pending')}
          placeholder="什么还悬着…"
          addLabel="添加一条"
          emptyText="（没有悬着的事）"
        />
      </section>

      <section className="card highlight-card" id={sectionDomId('highlights')}>
        <h2 className="card-title">本周热点</h2>
        <p className="card-desc">
          第一条是这周的主线，后面几条是支撑它的事 · 都可以直接改
        </p>
        <EditableList
          items={result.highlights}
          onChange={setList('highlights')}
          placeholder="想记住什么…"
          addLabel="添加一条"
          emptyText="（还没有热点）"
          leadFirst
        />
      </section>

      <section className="card plan-card" id={sectionDomId('plan')}>
        <h2 className="card-title">
          下周计划
          <span className="badge-ai">AI 建议</span>
        </h2>
        <p className="card-desc">
          下面是 AI 根据这周的情况给出的建议，你可以直接改。想到什么它没考虑到的，写在下面，让它重新整理一遍。
        </p>

        <div className="plan-grid">
          <div>
            <h3 className="col-title">三件重点</h3>
            <EditableList
              items={result.nextFocus}
              onChange={setList('nextFocus')}
              placeholder="下周的重点…"
              addLabel="添加一条"
            />
          </div>
          <div>
            <h3 className="col-title">要跟进的人</h3>
            <EditableList
              items={result.nextFollowUps}
              onChange={setList('nextFollowUps')}
              placeholder="要联系谁…"
              addLabel="添加一个人"
              emptyText="（这次没有提到具体的人）"
            />
          </div>
        </div>

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
            <span className="hint">清单内容不会被改动，只重写热点和下周计划</span>
          </div>
        </div>
      </section>

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
