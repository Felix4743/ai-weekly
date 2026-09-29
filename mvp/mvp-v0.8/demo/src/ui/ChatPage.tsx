import { useEffect, useRef, useState } from 'react'
import { SCRIPT, dimensionLabel, dimensionScript } from '../core/script'
import {
  answeredInBlock,
  isAllComplete,
  isBlockComplete,
  nextIncompleteBlock,
  questionsInBlock,
} from '../core/interview'
import type { ChatMessage, Dimension, InterviewState } from '../core/types'

interface Props {
  messages: ChatMessage[]
  typing: boolean
  /** 正在流式吐出的半截回复；还没有内容时是空串 */
  streamText: string
  interview: InterviewState
  progress: number
  busy: boolean
  sampleText: string
  hasAnyAnswer: boolean
  onOpenBlock: (dim: Dimension) => void
  onSend: (text: string) => void
  onGenerate: () => void
}

export function ChatPage({
  messages,
  typing,
  streamText,
  interview,
  progress,
  busy,
  sampleText,
  hasAnyAnswer,
  onOpenBlock,
  onSend,
  onGenerate,
}: Props) {
  const [draft, setDraft] = useState('')
  const bodyRef = useRef<HTMLDivElement>(null)
  const taRef = useRef<HTMLTextAreaElement>(null)

  const active = interview.active
  const script = active ? dimensionScript(active) : undefined
  const blockMessages = active ? messages.filter((m) => m.dimension === active) : []
  const activeComplete = active ? isBlockComplete(interview, active) : false
  const nextDim = nextIncompleteBlock(interview)
  const allDone = isAllComplete(interview)
  /** 发送下面那排「聊一聊XX」：当前这一块不用再跳过去 */
  const otherBlocks = SCRIPT.filter((d) => d.key !== active)

  useEffect(() => {
    const el = bodyRef.current
    if (!el) return
    el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' })
  }, [messages, typing, streamText, active])

  useEffect(() => {
    if (active) taRef.current?.focus()
  }, [active])

  const submit = () => {
    const text = draft.trim()
    // 主问题聊完了也照发 —— 那是用户还想说，不该被拦住
    if (!text || busy || !active) return
    setDraft('')
    onSend(text)
  }

  return (
    <main className="page chat">
      {/* 顶部四个词，点哪一个就整页切到哪一块 */}
      <nav className="tab-bar" role="tablist">
        {SCRIPT.map((d) => {
          const complete = isBlockComplete(interview, d.key)
          const hasAnswer = messages.some((m) => m.dimension === d.key && m.role === 'user')
          const status: 'todo' | 'doing' | 'done' = complete
            ? 'done'
            : hasAnswer
              ? 'doing'
              : 'todo'
          const isActive = active === d.key
          const done = answeredInBlock(interview, d.key)
          const total = questionsInBlock(d.key)

          return (
            <button
              key={d.key}
              type="button"
              role="tab"
              aria-selected={isActive}
              className={`tab ${status}${isActive ? ' active' : ''}`}
              onClick={() => onOpenBlock(d.key)}
            >
              <span className="tab-label">{d.label}</span>
              <span className="tab-state">
                {complete ? '✓' : status === 'doing' ? `${done}/${total}` : ''}
              </span>
            </button>
          )
        })}
      </nav>

      <div className="progress-track">
        <div className="progress-fill" style={{ width: `${progress}%` }} />
      </div>

      <section className="stage">
        <header className="stage-head">
          <span className="stage-title">{script?.label ?? '选一块开始'}</span>
          <span className="stage-hint">{script?.hint ?? ''}</span>
          {activeComplete && <span className="stage-done">主问题聊完了 · 想继续就说</span>}
        </header>

        <div className="stage-body" ref={bodyRef}>
          {!active && <p className="block-empty">点上面任意一块，开始聊。</p>}

          {active && blockMessages.length === 0 && !typing && (
            <p className="block-empty">正在准备第一个问题…</p>
          )}

          {blockMessages.map((m) => (
            <div key={m.id} className={`msg ${m.role}`}>
              {m.role === 'ai' && <span className="avatar" aria-hidden="true" />}
              <div className="bubble">{m.text}</div>
            </div>
          ))}

          {typing && streamText && (
            <div className="msg ai">
              <span className="avatar" aria-hidden="true" />
              <div className="bubble streaming">{streamText}</div>
            </div>
          )}

          {typing && !streamText && (
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
      </section>

      <div className="composer">
        {active && !activeComplete && draft.length === 0 && sampleText && !busy && (
          <button className="sample-btn" type="button" onClick={() => setDraft(sampleText)}>
            ✎ 填入示例回答
          </button>
        )}

        {/* 主问题聊完了输入框也留着：想接着说是用户的事，不是脚本的事 */}
        {active && (
          <textarea
            ref={taRef}
            rows={2}
            value={draft}
            disabled={busy}
            placeholder={
              activeComplete
                ? '还想说什么？接着说我接着问…'
                : '想到什么就说什么，不用组织语言…'
            }
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
          {active && (
            <button
              className="btn primary"
              type="button"
              disabled={!draft.trim() || busy}
              onClick={submit}
            >
              发送
            </button>
          )}

          {activeComplete && nextDim && (
            <button
              className="btn subtle"
              type="button"
              disabled={busy}
              onClick={() => onOpenBlock(nextDim)}
            >
              接着聊「{dimensionLabel(nextDim)}」→
            </button>
          )}

          {activeComplete && !nextDim && <span className="idle-hint">四块都聊完了</span>}

          <button
            className={`btn generate${allDone ? ' primary' : ''}`}
            type="button"
            disabled={!hasAnyAnswer || busy}
            onClick={onGenerate}
          >
            生成我的本周梳理
          </button>
        </div>

        {/* 发送下面：不用回到顶部，随时换一块聊 */}
        <div className="quick-jumps">
          <span className="quick-jumps-label">{active ? '换个话题' : '从哪一块开始'}</span>
          {otherBlocks.map((d) => (
            <button
              key={d.key}
              className="btn chip"
              type="button"
              disabled={busy}
              onClick={() => onOpenBlock(d.key)}
            >
              聊一聊{d.label}
            </button>
          ))}
        </div>

        {active && <div className="composer-note">Enter 发送 · Shift + Enter 换行</div>}
      </div>
    </main>
  )
}
