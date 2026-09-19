import { Fragment, useEffect, useRef, useState } from 'react'
import { dimensionLabel, SCRIPT } from '../core/script'
import type { ChatMessage, InterviewState } from '../core/types'

interface Props {
  messages: ChatMessage[]
  typing: boolean
  interview: InterviewState
  progress: number
  busy: boolean
  sampleText: string
  onSend: (text: string) => void
  onFinish: () => void
}

export function ChatPage({
  messages,
  typing,
  interview,
  progress,
  busy,
  sampleText,
  onSend,
  onFinish,
}: Props) {
  const [draft, setDraft] = useState('')
  const listRef = useRef<HTMLDivElement>(null)
  const taRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    const el = listRef.current
    if (!el) return
    el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' })
  }, [messages, typing])

  useEffect(() => {
    taRef.current?.focus()
  }, [])

  const submit = () => {
    const text = draft.trim()
    if (!text || busy) return
    setDraft('')
    onSend(text)
  }

  const useSample = () => {
    if (!sampleText) return
    setDraft(sampleText)
    taRef.current?.focus()
  }

  const activeDim = messages.length > 0 ? interview : null

  return (
    <main className="page chat">
      <div className="progress-wrap">
        <div className="blocks">
          {SCRIPT.map((d, i) => {
            const state = !activeDim
              ? 'todo'
              : i < interview.dimensionIndex
                ? 'done'
                : i === interview.dimensionIndex
                  ? 'active'
                  : 'todo'
            return (
              <span key={d.key} className={`block-chip ${state}`}>
                {d.label}
              </span>
            )
          })}
          <span className="progress-pct">{progress}%</span>
        </div>
        <div className="progress-track">
          <div className="progress-fill" style={{ width: `${progress}%` }} />
        </div>
      </div>

      <div className="chat-list" ref={listRef}>
        {messages.map((m, i) => {
          const prev = messages[i - 1]
          const showDivider = m.role === 'ai' && (!prev || prev.dimension !== m.dimension)
          return (
            <Fragment key={m.id}>
              {showDivider && (
                <div className="block-divider">
                  <span>{dimensionLabel(m.dimension)}</span>
                </div>
              )}
              <div className={`msg ${m.role}`}>
                {m.role === 'ai' && <span className="avatar" aria-hidden="true" />}
                <div className="bubble">{m.text}</div>
              </div>
            </Fragment>
          )
        })}

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

      <div className="composer">
        {draft.length === 0 && sampleText && !busy && (
          <button className="sample-btn" type="button" onClick={useSample}>
            ✎ 填入示例回答
          </button>
        )}
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
        <div className="composer-actions">
          <button className="btn primary" type="button" disabled={!draft.trim() || busy} onClick={submit}>
            发送
          </button>
          <button className="btn subtle" type="button" disabled={busy} onClick={onFinish}>
            聊够了，看结果
          </button>
          <span className="hint">Enter 发送 · Shift + Enter 换行</span>
        </div>
      </div>
    </main>
  )
}
