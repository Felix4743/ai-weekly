import { useEffect, useRef, useState } from 'react'
import { SCRIPT } from '../core/script'
import { answeredInBlock, isAllComplete, isBlockComplete, questionsInBlock } from '../core/interview'
import type { ChatMessage, Dimension, InterviewState } from '../core/types'

interface Props {
  messages: ChatMessage[]
  typing: boolean
  interview: InterviewState
  progress: number
  busy: boolean
  sampleText: string
  hasAnyAnswer: boolean
  onOpenBlock: (dim: Dimension) => void
  onCloseBlock: () => void
  onSend: (text: string) => void
  onGenerate: () => void
}

function statusText(status: 'todo' | 'doing' | 'done', done: number, total: number): string {
  if (status === 'done') return '已聊完'
  if (status === 'doing') return `${done}/${total}`
  return '未开始'
}

export function ChatPage({
  messages,
  typing,
  interview,
  progress,
  busy,
  sampleText,
  hasAnyAnswer,
  onOpenBlock,
  onCloseBlock,
  onSend,
  onGenerate,
}: Props) {
  const [draft, setDraft] = useState('')
  const listRef = useRef<HTMLDivElement>(null)
  const activeRef = useRef<HTMLElement | null>(null)
  const taRef = useRef<HTMLTextAreaElement>(null)

  const active = interview.active
  const allDone = isAllComplete(interview)

  useEffect(() => {
    const el = listRef.current
    if (!el) return
    el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' })
  }, [messages, typing, active])

  useEffect(() => {
    if (active) taRef.current?.focus()
  }, [active])

  const submit = () => {
    const text = draft.trim()
    if (!text || busy || !active) return
    setDraft('')
    onSend(text)
  }

  return (
    <main className="page chat">
      <div className="progress-wrap">
        <div className="progress-head">
          <span className="progress-label">
            本周梳理
            <span className="progress-note">四块都可以单独聊，顺序随你</span>
          </span>
          <span className="progress-pct">{progress}%</span>
        </div>
        <div className="progress-track">
          <div className="progress-fill" style={{ width: `${progress}%` }} />
        </div>
      </div>

      <div className="block-list" ref={listRef}>
        {SCRIPT.map((d) => {
          const isActive = active === d.key
          const complete = isBlockComplete(interview, d.key)
          const blockMessages = messages.filter((m) => m.dimension === d.key)
          const status: 'todo' | 'doing' | 'done' = complete
            ? 'done'
            : blockMessages.length > 0
              ? 'doing'
              : 'todo'
          const done = answeredInBlock(interview, d.key)
          const total = questionsInBlock(d.key)

          return (
            <section
              key={d.key}
              ref={isActive ? activeRef : null}
              className={`block-card ${status}${isActive ? ' active' : ''}`}
            >
              <button
                className="block-head"
                type="button"
                onClick={() => (isActive ? onCloseBlock() : onOpenBlock(d.key))}
              >
                <span className={`block-dot ${status}`} aria-hidden="true" />
                <span className="block-main">
                  <span className="block-label">{d.label}</span>
                  <span className="block-hint">{d.hint}</span>
                </span>
                <span className="block-meta">
                  <span className={`block-status ${status}`}>
                    {statusText(status, done, total)}
                  </span>
                  <span className="block-arrow" aria-hidden="true">
                    {isActive ? '▾' : '▸'}
                  </span>
                </span>
              </button>

              {isActive && (
                <div className="block-body">
                  {blockMessages.length === 0 && !typing && (
                    <p className="block-empty">正在准备第一个问题…</p>
                  )}

                  {blockMessages.map((m) => (
                    <div key={m.id} className={`msg ${m.role}`}>
                      {m.role === 'ai' && <span className="avatar" aria-hidden="true" />}
                      <div className="bubble">{m.text}</div>
                    </div>
                  ))}

                  {typing && (
                    <div className="msg ai">
                      <span className="avatar" aria-hidden="true" />
                      <div className="bubble typing">
                        <i />
                        <i />
                        <i />
                      </div>
                    </div>
                  )}
                </div>
              )}
            </section>
          )
        })}
      </div>

      <div className="composer">
        {active && draft.length === 0 && sampleText && !busy && (
          <button className="sample-btn" type="button" onClick={() => setDraft(sampleText)}>
            ✎ 填入示例回答
          </button>
        )}

        {active && (
          <textarea
            ref={taRef}
            rows={2}
            value={draft}
            disabled={busy}
            placeholder="想到什么就说什么，不用组织语言…"
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                submit()
              }
            }}
          />
        )}

        <div className="composer-actions">
          {active ? (
            <>
              <button
                className="btn primary"
                type="button"
                disabled={!draft.trim() || busy}
                onClick={submit}
              >
                发送
              </button>
              <button className="btn ghost" type="button" disabled={busy} onClick={onCloseBlock}>
                收起这块
              </button>
              <span className="hint">Enter 发送 · Shift + Enter 换行</span>
            </>
          ) : (
            <>
              <span className="idle-hint">
                {allDone ? '四块都聊完了' : '点开上面任意一块，接着聊'}
              </span>
              <button
                className={`btn generate${allDone ? ' primary' : ''}`}
                type="button"
                disabled={!hasAnyAnswer || busy}
                onClick={onGenerate}
              >
                生成我的本周梳理
              </button>
            </>
          )}
        </div>
      </div>
    </main>
  )
}
