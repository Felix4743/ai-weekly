import { useEffect, useRef, useState } from 'react'
import { CONTENT_BLOCKS, DEPTHS, dimensionLabel, dimensionScript } from '../core/script'
import { stateField } from '../core/stateFields'
import {
  answeredInBlock,
  isAllComplete,
  isBlockComplete,
  nextStage,
  questionsInBlock,
} from '../core/interview'
import type { ChatMessage, Depth, Dimension, InterviewState, StateKey, StateScores } from '../core/types'
import { StateScore } from './StateScore'

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
  /** 状态四项的分数：采访里点过的那些，点完还能改 */
  stateScores: StateScores
  onOpenBlock: (dim: Dimension) => void
  onSend: (text: string) => void
  /** 用户点了深度 / 中度 / 快速复盘 */
  onPickDepth: (depth: Depth) => void
  /** 用户在状态那段回答下面点了星 */
  onScoreState: (key: StateKey, value: number | undefined) => void
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
  stateScores,
  onOpenBlock,
  onSend,
  onPickDepth,
  onScoreState,
  onGenerate,
}: Props) {
  const [draft, setDraft] = useState('')
  const bodyRef = useRef<HTMLDivElement>(null)
  const taRef = useRef<HTMLTextAreaElement>(null)

  const active = interview.active
  const script = active ? dimensionScript(active) : undefined
  const blockMessages = active ? messages.filter((m) => m.dimension === active) : []
  const activeComplete = active ? isBlockComplete(interview, active) : false
  const stage = nextStage(interview)
  const nextDim = stage.kind === 'block' ? stage.dim : null
  const allDone = isAllComplete(interview)
  /** 状态聊完、还没定档：这一步由用户点按钮决定，不让模型猜 */
  const showDepth = stage.kind === 'depth'
  /** 发送下面那排「聊一聊XX」：当前这一块不用再跳过去 */
  const otherBlocks = CONTENT_BLOCKS.filter((d) => d.key !== active)

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
      {/* 顶部四个词，点哪一个就整页切到哪一块（「上周对账」是流程里的一步，不占标签） */}
      <nav className="tab-bar" role="tablist">
        {CONTENT_BLOCKS.map((d) => {
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

      {/* 定档：三个按钮，选完才开始往下聊 */}
      {showDepth && (
        <section className="depth-picker">
          <div className="depth-lead">
            状态聊完了。接下来想聊到多细？选一个就行，聊到一半想改也可以。
          </div>
          <div className="depth-options">
            {DEPTHS.map((d) => (
              <button
                key={d.id}
                className="btn depth"
                type="button"
                disabled={busy}
                onClick={() => onPickDepth(d.id)}
              >
                <span className="depth-label">{d.label}</span>
                <span className="depth-meta">
                  约 {d.minutes} 分钟 · 每题最多追问 {d.followUpCap} 次
                </span>
              </button>
            ))}
          </div>
        </section>
      )}

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

          {blockMessages.map((m) => {
            const field = m.stateKey ? stateField(m.stateKey) : undefined
            return (
              <div key={m.id} className="msg-block">
                <div className={`msg ${m.role}`}>
                  {m.role === 'ai' && <span className="avatar" aria-hidden="true" />}
                  <div className="bubble">{m.text}</div>
                </div>
                {/* 状态那一段：问完一项就在自己的回答下面点一次星，翻回去还能改 */}
                {field && (
                  <StateScore
                    label={field.ask}
                    score={stateScores[field.key]}
                    disabled={busy}
                    onChange={(v) => onScoreState(field.key, v)}
                  />
                )}
              </div>
            )
          })}

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

          {activeComplete && nextDim && nextDim !== active && (
            <button
              className="btn subtle"
              type="button"
              disabled={busy}
              onClick={() => onOpenBlock(nextDim)}
            >
              接着聊「{dimensionLabel(nextDim)}」→
            </button>
          )}

          {activeComplete && !nextDim && stage.kind === 'done' && (
            <span className="idle-hint">四块都聊完了</span>
          )}

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
