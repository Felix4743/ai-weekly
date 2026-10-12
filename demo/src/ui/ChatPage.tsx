import { useEffect, useRef, useState } from 'react'
import { CONTENT_BLOCKS, DEPTHS, dimensionLabel, dimensionScript } from '../core/script'
import {
  coveredInBlock,
  isAllComplete,
  isBlockComplete,
  nextStage,
  pointsInBlock,
} from '../core/interview'
import { NOTE_TEXT_MAX, noteDateLabel, noteDimLabel, notesCountText } from '../core/notes'
import { STATE_FIELDS } from '../core/stateFields'
import type {
  ChatMessage,
  Depth,
  Dimension,
  InterviewState,
  Note,
  StateKey,
  StateScores,
} from '../core/types'
import { StateScore } from './StateScore'
import { IconClose, IconPlus, IconSend, IconSkip, IconSparkle, IconWand } from './icons'

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
  /**
   * 这一周的采访**有没有开过头**（0.9.9 随心记）。
   *
   * 没开过头时整页就是那张「随心记」卡 —— 周中打开软件是来记一句话的，
   * 不该先看见状态卡、四个标签和「生成梳理」。由 `App.tsx` 拿着这个开关，
   * 所以这一页仍然是「props 进来、事件出去」的纯组件，起界面就能测。
   */
  started: boolean
  /** 点了「开始这周的梳理」：这一轮采访正式开始 */
  onStartInterview: () => void
  /** 这一周的随手记，存的是时间序（早→晚） */
  notes: Note[]
  /** 记下一句（空白由 `core/notes.ts` 拦掉，这里不判断） */
  onAddNote: (text: string) => void
  onRemoveNote: (id: string) => void
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
  started,
  onStartInterview,
  notes,
  onAddNote,
  onRemoveNote,
}: Props) {
  const [draft, setDraft] = useState('')
  const [noteDraft, setNoteDraft] = useState('')
  /** 采访里那句「记一句」把随心记卡当抽屉拉出来 —— 落地页上它是整页 */
  const [notesOpen, setNotesOpen] = useState(false)
  const bodyRef = useRef<HTMLDivElement>(null)
  const taRef = useRef<HTMLTextAreaElement>(null)

  const active = interview.active
  const script = active ? dimensionScript(active) : undefined
  const blockMessages = active ? messages.filter((m) => m.dimension === active) : []
  const activeComplete = active ? isBlockComplete(interview, active) : false
  const stage = nextStage(interview)
  const nextDim = stage.kind === 'block' ? stage.dim : null
  const allDone = isAllComplete(interview)
  /** 随心记列表：存的是时间序，界面上最新的一条在最上面 */
  const newestFirst = [...notes].sort((a, b) => b.at - a.at)
  /** 还没交状态卡：这一屏只有那张卡，别的一概先按住 */
  const showState = stage.kind === 'state'
  /** 状态打完了、还没定档：这一步由用户点按钮决定，不让模型猜 */
  const showDepth = stage.kind === 'depth'
  /** 发送下面那排「聊一聊XX」：当前这一块不用再跳过去 */
  const otherBlocks = CONTENT_BLOCKS.filter((d) => d.key !== active)
  /**
   * 第一屏（0.9.9）：这一周的采访还没开过头，也没有哪一块正开着 —— 整页只有「随心记」。
   * 「有没有开过头」由 `App.tsx` 按「这周是不是已经真聊过东西」算出来，这里只看开关。
   */
  const landing = !started && !active && stage.kind === 'state'
  /**
   * 打分卡 / 定档这两步，**当前这一步就是上面那张卡** —— 下面那块空的对话区整个不画。
   * 0.9.8 之前这里挂着一张 250px 高的白卡，标题写着「还差一步」，看着像漏了东西。
   */
  const showStage = !(showState || showDepth)

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

  /** 记一句（空白不提交，输入框留着不动） */
  const submitNote = () => {
    const text = noteDraft.trim()
    if (!text) return
    setNoteDraft('')
    onAddNote(text)
  }

  /**
   * 那张随心记卡。落地页整页就是它；采访里点「记一句」时它再以抽屉的样子出现 ——
   * 两处共用同一份，改文案只改这里。
   *
   * `compact` 是抽屉模式：说明句收起来、列表自己滚、底下那句「开始这周的梳理」不画
   * （都进采访了，再摆一个开始按钮没道理），右上角换个「收起来」的叉。
   *
   * 存的是时间序（提示词要按周一→周日念），界面倒过来：最新的一条在最上面。
   */
  const notesCard = (compact: boolean) => (
    <section className={`notes-card${compact ? ' compact' : ''}`}>
      <header className="notes-head">
        <span className="notes-title">
          <IconWand size={17} />
          随心记
        </span>
        <span className="notes-count">
          {notesCountText(notes.length)}
          {compact && (
            <button
              className="note-close"
              type="button"
              title="收起来"
              aria-label="收起来"
              onClick={() => setNotesOpen(false)}
            >
              <IconClose size={14} />
            </button>
          )}
        </span>
      </header>
      <p className="notes-desc">
        周中想到什么就记一句 —— 不聊、不评、不打分。周末坐下来梳理的时候，这些会当线索带上。
      </p>

      <div className="note-composer">
        <input
          className="note-input"
          type="text"
          value={noteDraft}
          maxLength={NOTE_TEXT_MAX}
          placeholder="现在想到什么，记一句…"
          onChange={(e) => setNoteDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') submitNote()
          }}
        />
        <button
          className="btn primary"
          type="button"
          disabled={noteDraft.trim().length === 0}
          onClick={submitNote}
        >
          <IconPlus size={15} />
          记下
        </button>
      </div>

      {newestFirst.length === 0 ? (
        <p className="notes-empty">这周还什么都没记。想到一句就写在这儿，别等周末。</p>
      ) : (
        <ul className="note-list">
          {newestFirst.map((n) => (
            <li key={n.id} className="note-item">
              <span className="note-date">{noteDateLabel(n)}</span>
              <span className="note-text">{n.text}</span>
              <span className="note-tag">{noteDimLabel(n.dim)}</span>
              <button
                className="note-del"
                type="button"
                title="删掉这条"
                aria-label="删掉这条"
                onClick={() => onRemoveNote(n.id)}
              >
                <IconClose size={14} />
              </button>
            </li>
          ))}
        </ul>
      )}

      {!compact && (
        <div className="notes-foot">
          <button className="btn ink" type="button" disabled={busy} onClick={onStartInterview}>
            <IconSparkle size={15} />
            开始这周的梳理
          </button>
          <span className="notes-foot-hint">开始之后随时可以回来接着记</span>
        </div>
      )}
    </section>
  )

  if (landing) {
    return <main className="page chat">{notesCard(false)}</main>
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

      {/* 采访里也能随手记（0.9.9）：想到一件还没轮到的事，先记下来，别打断当下这一块 */}
      {notesOpen && <div className="notes-drawer">{notesCard(true)}</div>}

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

      {showStage && (
      <section className="stage">
        <header className="stage-head">
          <span className="stage-title">{script?.label ?? '选一块开始'}</span>
          <span className="stage-hint">{script?.hint ?? ''}</span>
          {activeComplete && <span className="stage-done">这一块聊完了 · 想继续就说</span>}
        </header>

        <div className="stage-body" ref={bodyRef}>
          {!active && (
            <div className="stage-empty">
              <span className="stage-empty-mark" aria-hidden="true">
                <IconSparkle size={20} />
              </span>
              <p className="block-empty">点上面任意一块，开始聊。</p>
              <p className="stage-empty-note">一次只聊一块，聊完再换下一块。</p>
            </div>
          )}

          {active && blockMessages.length === 0 && !typing && (
            <p className="block-empty">正在准备第一个问题…</p>
          )}

          {blockMessages.map((m) => (
            <div key={m.id} className="msg-block">
              <div className={`msg ${m.role}`}>
                {m.role === 'ai' && (
                  <span className="avatar" aria-hidden="true">
                    <IconSparkle size={15} />
                  </span>
                )}
                <div className="bubble">{m.text}</div>
              </div>
            </div>
          ))}

          {typing && streamText && (
            <div className="msg ai">
              <span className="avatar" aria-hidden="true">
                <IconSparkle size={15} />
              </span>
              <div className="bubble streaming">{streamText}</div>
            </div>
          )}

          {typing && !streamText && (
            <div className="msg ai">
              <span className="avatar" aria-hidden="true">
                <IconSparkle size={15} />
              </span>
              <div className="bubble typing">
                <i />
                <i />
                <i />
              </div>
            </div>
          )}
        </div>
      </section>
      )}

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
            <IconWand size={14} />
            填入示例回答
          </button>
        )}

        {/* 输入框与按钮同在一个描边容器里：这一屏谁是主角一眼看得出来 */}
        <div className="composer-bar">
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
              <IconSend />
              发送
            </button>
          )}

          {/* 这题没什么可说的就点它：直接过，不发请求、也不在记录里留痕。
              只在「这题还没聊完」时出现 —— 主问题问完之后是自由聊，没有题可跳。
              typing 时也灰掉：App 那边本来就挡着（busyRef），按钮看着能点却没反应最坑 */}
          {active && !activeComplete && (
            <button
              className="btn ghost"
              type="button"
              disabled={busy || typing}
              title="这题没什么可说的，直接问下一题"
              onClick={onSkip}
            >
              <IconSkip />
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

          {/* 这一屏真正的出口：还没聊完时是墨色实心，四块都聊完了转成主色 */}
          <button
            className={`btn generate${allDone ? ' primary' : ' ink'}`}
            type="button"
            disabled={!hasAnyAnswer || busy}
            onClick={onGenerate}
          >
            <IconSparkle />
            生成我的本周梳理
          </button>
        </div>
        </div>

        <div className="composer-foot">
          {/* 发送下面：不用回到顶部，随时换一块聊 */}
          <div className="quick-jumps">
            <span className="quick-jumps-label">{active ? '换个话题' : '从哪一块开始'}</span>
            {/* 想到一件还没轮到的事，先记下来 —— 记完接着聊，不打断这一块 */}
            <button
              className={`btn chip${notesOpen ? ' on' : ''}`}
              type="button"
              aria-expanded={notesOpen}
              onClick={() => setNotesOpen((v) => !v)}
            >
              <IconPlus size={14} />
              记一句
            </button>
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
      </div>
    </main>
  )
}
