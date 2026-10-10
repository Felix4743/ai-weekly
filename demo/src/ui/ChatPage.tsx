import { useEffect, useRef, useState } from 'react'
import { CONTENT_BLOCKS, DEPTHS, dimensionLabel, dimensionScript } from '../core/script'
import {
  coveredInBlock,
  isAllComplete,
  isBlockComplete,
  nextStage,
  pointsInBlock,
} from '../core/interview'
import { STATE_FIELDS } from '../core/stateFields'
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
  /** 状态卡上的四项分数：采访里点过的那些，点完还能改 */
  stateScores: StateScores
  /** 状态卡下面那一行备注 */
  stateNote: string
  onOpenBlock: (dim: Dimension) => void
  onSend: (text: string) => void
  /** 用户点了深度 / 中度 / 快速复盘 */
  onPickDepth: (depth: Depth) => void
  /** 用户在状态卡上点了星 */
  onScoreState: (key: StateKey, value: number | undefined) => void
  /** 用户在状态卡上改了备注 */
  onNoteChange: (text: string) => void
  /** 状态卡交上去了：接下来该定档 */
  onStateDone: () => void
  /** 这题没什么可说的：直接推进到下一个要点（不调模型、不留痕迹） */
  onSkip: () => void
  /**
   * 上一块收尾时还差着的要点 —— 只在输入框上方给一条提示，由用户决定补不补。
   * `null` 表示没有（或者用户已经点掉了）。
   */
  missed: { dim: Dimension; labels: string[] } | null
  /** 用户点了「接着补」：切回那一栏、把块重新打开 */
  onReopen: () => void
  /** 用户点了「算了」 */
  onDismissMissed: () => void
  /** 从头再聊一遍（这周已记的不看、不并） */
  onStartFresh: () => void
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
  stateNote,
  onOpenBlock,
  onSend,
  onPickDepth,
  onScoreState,
  onNoteChange,
  onStateDone,
  onSkip,
  missed,
  onReopen,
  onDismissMissed,
  onStartFresh,
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
  /** 还没交状态卡：这一屏只有那张卡，别的一概先按住 */
  const showState = stage.kind === 'state'
  /** 状态打完了、还没定档：这一步由用户点按钮决定，不让模型猜 */
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
          const done = coveredInBlock(interview, d.key)
          const total = pointsInBlock(interview, d.key)

          return (
            <button
              key={d.key}
              type="button"
              role="tab"
              aria-selected={isActive}
              className={`tab ${status}${isActive ? ' active' : ''}`}
              disabled={busy || showState}
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

      {/* 第一步：状态卡。先打完分，再问要聊多细 —— 顺序由流程保证，不靠提示词求人 */}
      {showState && (
        <section className="state-card">
          <div className="state-lead">
            先从状态开始：心情、睡眠、运动、饮食，各点几颗星。想补一句就写在下面。
          </div>
          <div className="state-form">
            {STATE_FIELDS.map((f) => (
              <div key={f.key} className="state-row">
                <span className="state-label">{f.label}</span>
                <StateScore
                  label={f.ask}
                  ariaLabel={`${f.label}评分`}
                  score={stateScores[f.key]}
                  disabled={busy}
                  onChange={(v) => onScoreState(f.key, v)}
                />
              </div>
            ))}
            <textarea
              className="state-note"
              rows={2}
              value={stateNote}
              disabled={busy}
              placeholder="这周状态想补一句什么…（可以空着）"
              onChange={(e) => onNoteChange(e.target.value)}
            />
          </div>
          <button className="btn primary" type="button" disabled={busy} onClick={onStateDone}>
            打好了，开始聊这周
          </button>
        </section>
      )}

      {/* 定档：三个按钮，选完才开始往下聊 */}
      {showDepth && (
        <section className="depth-picker">
          <div className="depth-lead">
            状态打完了。接下来想聊到多细？选一个就行，聊到一半想改也可以。
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
          {activeComplete && <span className="stage-done">这一块聊完了 · 想继续就说</span>}
        </header>

        <div className="stage-body" ref={bodyRef}>
          {!active && !showState && !showDepth && (
            <p className="block-empty">点上面任意一块，开始聊。</p>
          )}

          {active && blockMessages.length === 0 && !typing && (
            <p className="block-empty">正在准备第一个问题…</p>
          )}

          {blockMessages.map((m) => (
            <div key={m.id} className="msg-block">
              <div className={`msg ${m.role}`}>
                {m.role === 'ai' && <span className="avatar" aria-hidden="true" />}
                <div className="bubble">{m.text}</div>
              </div>
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
        {/* 上一块收尾时还差着的要点：不自动补问，只提示一句，由用户决定。
            点「接着补」会切回那一栏并重新打开这一块，模型下一轮就知道该问什么 */}
        {missed && (
          <div className="missed-hint" role="status">
            <span className="missed-text">
              「{dimensionLabel(missed.dim)}」这块还差 {missed.labels.length} 样没聊到：
              {missed.labels.slice(0, 2).join('；')}
            </span>
            <button className="link-btn" type="button" onClick={onReopen}>
              接着补
            </button>
            <button className="link-btn" type="button" onClick={onDismissMissed}>
              算了
            </button>
          </div>
        )}
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

          {/* 这题没什么可说的就点它：直接过，不发请求、也不在记录里留痕。
              只在「这题还没聊完」时出现 —— 主问题问完之后是自由聊，没有题可跳。
              typing 时也灰掉：App 那边本来就挡着（busyRef），按钮看着能点却没反应最坑 */}
          {active && !activeComplete && (
            <button
              className="btn subtle"
              type="button"
              disabled={busy || typing}
              title="这题没什么可说的，直接问下一题"
              onClick={onSkip}
            >
              这题跳过
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
          {/* 一周里聊第二次是常态：默认接着上次补，想推倒重来说一声 */}
          <button
            className="btn chip"
            type="button"
            disabled={busy}
            onClick={onStartFresh}
          >
            从头再聊一遍
          </button>
        </div>

        {active && <div className="composer-note">Enter 发送 · Shift + Enter 换行</div>}
      </div>
    </main>
  )
}
