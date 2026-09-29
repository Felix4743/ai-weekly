import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { describeError } from './core/aiError'
import { archiveResult, upsertWeek, type WeekEntry } from './core/archive'
import { createAiClient } from './core/createAiClient'
import {
  coveragePercent,
  createInterview,
  finishAll,
  nextStep,
  openBlock,
} from './core/interview'
import { sampleAnswer } from './core/mockAi'
import { stripMarkerForDisplay } from './core/turn'
import {
  createDefaultConfig,
  nextId,
  type AppConfig,
  type ChatMessage,
  type Dimension,
  type InterviewState,
  type WeeklyResult,
} from './core/types'
import { weekKeyOf, type WeekKey } from './core/week'
import {
  loadArchive,
  loadConfig,
  loadSession,
  saveArchive,
  saveConfig,
  saveSession,
} from './storage'
import { createTransport } from './transport'
import { SetupPage } from './ui/SetupPage'
import { ChatPage } from './ui/ChatPage'
import { ResultPage } from './ui/ResultPage'
import { HistoryPage } from './ui/HistoryPage'

type Page = 'setup' | 'chat' | 'result' | 'history'
type Overlay = { title: string; sub: string } | null

function aiMessage(text: string, dimension: Dimension): ChatMessage {
  return { id: nextId('a'), role: 'ai', text, dimension, at: Date.now() }
}

/**
 * 首次进入时把周归档读出来。
 *
 * 升级上来的用户只存过「最近一次会话」，归档还是空的 —— 那一次的结果
 * 按理也该在日历上占一个位置，所以这里补录一次（只在归档为空时做，
 * 免得以后每次启动都把已经删过的记录又冒出来）。
 */
function bootArchive(): WeekEntry[] {
  const stored = loadArchive()
  if (stored.length > 0) return stored

  const session = loadSession()
  if (!session) return []
  const backfilled = archiveResult([], session.result, session.savedAt, session.week)
  saveArchive(backfilled)
  return backfilled
}

/** 流式刷新间隔：模型吐字很快，攒一下再刷，避免一秒几十次重渲染 */
const STREAM_FLUSH_MS = 60

export default function App() {
  // 传输层只建一次；装在 Electron 里自动走主进程 IPC，在浏览器里走 fetch。
  // 「换外壳」这件事到此为止 —— 下面全是业务代码，不认壳。
  const transportRef = useRef(createTransport())

  const [page, setPage] = useState<Page>(() => (loadConfig() ? 'chat' : 'setup'))
  const [config, setConfig] = useState<AppConfig>(() => loadConfig() ?? createDefaultConfig())
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [interview, setInterview] = useState<InterviewState>(() => createInterview())
  const [typing, setTyping] = useState(false)
  const [streamText, setStreamText] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [overlay, setOverlay] = useState<Overlay>(null)
  const [result, setResult] = useState<WeeklyResult | null>(null)
  const [restored, setRestored] = useState(false)
  /** 按周归档的结果，总览页与「这份结果记在哪一周」都从这里读 */
  const [archive, setArchive] = useState<WeekEntry[]>(() => bootArchive())
  /** 当前这份结果属于哪一周；生成那一刻定下来，之后编辑、重新整理都跟着它走 */
  const [resultWeek, setResultWeek] = useState<WeekKey>(() => weekKeyOf(new Date()))
  /** 从哪一页点进设置的：回去时要还给他，改设置不该等于重开 */
  const [cameFrom, setCameFrom] = useState<Page | null>(null)

  // 填了 Key 就是真模型，没填就用假 AI 走通流程
  const { client: ai, mode } = useMemo(
    () => createAiClient(config, transportRef.current),
    [config],
  )

  const messagesRef = useRef<ChatMessage[]>([])
  const interviewRef = useRef<InterviewState>(interview)
  const resultRef = useRef<WeeklyResult | null>(null)
  const archiveRef = useRef<WeekEntry[]>(archive)
  const resultWeekRef = useRef<WeekKey>(resultWeek)
  const busyRef = useRef(false)
  const streamRef = useRef('')
  const flushTimer = useRef<number | null>(null)

  const commitMessages = useCallback((list: ChatMessage[]) => {
    messagesRef.current = list
    setMessages(list)
  }, [])

  const commitInterview = useCallback((next: InterviewState) => {
    interviewRef.current = next
    setInterview(next)
  }, [])

  const commitArchive = useCallback((next: WeekEntry[]) => {
    archiveRef.current = next
    setArchive(next)
    saveArchive(next)
  }, [])

  const commitResultWeek = useCallback((week: WeekKey) => {
    resultWeekRef.current = week
    setResultWeek(week)
  }, [])

  /**
   * 结果一改就落两处：最近一次会话（刷新不丢）+ 它所属那一周的归档（总览看得到）。
   * 两道落盘都在这儿，是因为「结果变了」只有一个入口，散出去必然漏一处。
   */
  const commitResult = useCallback(
    (next: WeeklyResult) => {
      resultRef.current = next
      setResult(next)
      const at = Date.now()
      saveSession({
        messages: messagesRef.current,
        result: next,
        savedAt: at,
        week: resultWeekRef.current,
      })
      commitArchive(
        upsertWeek(archiveRef.current, { week: resultWeekRef.current, savedAt: at, result: next }),
      )
    },
    [commitArchive],
  )

  /* ---------------- 流式累积 ---------------- */

  const resetStream = useCallback(() => {
    streamRef.current = ''
    if (flushTimer.current !== null) {
      window.clearTimeout(flushTimer.current)
      flushTimer.current = null
    }
    setStreamText('')
  }, [])

  const pushDelta = useCallback((delta: string) => {
    streamRef.current += delta
    if (flushTimer.current !== null) return
    flushTimer.current = window.setTimeout(() => {
      flushTimer.current = null
      // 行首的 [追问]/[换题] 标记不给人看；还没收全时先按住，免得闪一下
      setStreamText(stripMarkerForDisplay(streamRef.current, false))
    }, STREAM_FLUSH_MS)
  }, [])

  /* ---------------- 流程 ---------------- */

  const startInterview = useCallback(async () => {
    if (busyRef.current) return
    busyRef.current = true
    resetStream()
    commitMessages([])
    const fresh = openBlock(createInterview(), 'event')
    commitInterview(fresh)
    resultRef.current = null
    setResult(null)
    setRestored(false)
    // 新的一轮从今天算起；上一份结果属于哪一周，到这里为止
    commitResultWeek(weekKeyOf(new Date()))
    setPage('chat')
    setTyping(true)
    try {
      const text = await ai.nextMessage(fresh, 'event', [], pushDelta)
      commitMessages([aiMessage(text, 'event')])
      setError(null)
    } catch (err) {
      setError(describeError(err))
    } finally {
      resetStream()
      setTyping(false)
      busyRef.current = false
    }
  }, [ai, commitInterview, commitMessages, commitResultWeek, pushDelta, resetStream])

  // 首次挂载：若已配置过则直接进入对话
  const bootedRef = useRef(false)
  useEffect(() => {
    if (bootedRef.current) return
    bootedRef.current = true
    if (page === 'chat') void startInterview()
    // 仅在挂载时执行一次
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const runSummarize = useCallback(async () => {
    setOverlay({ title: '正在整理这一周…', sub: '把你说过的内容归纳成清单，再想想下周' })
    try {
      const r = await ai.summarize(messagesRef.current)
      // 生成的那一刻定下它属于哪一周 —— 之后再编辑、重新整理都跟着这一周走
      commitResultWeek(weekKeyOf(new Date()))
      commitResult(r)
      setError(null)
      setPage('result')
    } catch (err) {
      setError(describeError(err))
    } finally {
      setOverlay(null)
    }
  }, [ai, commitResult, commitResultWeek])

  /** 用户自己点开某一块；如果是第一次打开，让 AI 先开口 */
  const handleOpenBlock = useCallback(
    async (dim: Dimension) => {
      if (busyRef.current) return
      if (interviewRef.current.active === dim) return

      const opened = openBlock(interviewRef.current, dim)
      commitInterview(opened)

      const alreadyAsked = messagesRef.current.some(
        (m) => m.dimension === dim && m.role === 'ai',
      )
      if (alreadyAsked) return

      busyRef.current = true
      setTyping(true)
      resetStream()
      try {
        const text = await ai.nextMessage(opened, dim, messagesRef.current, pushDelta)
        commitMessages([...messagesRef.current, aiMessage(text, dim)])
        setError(null)
      } catch (err) {
        setError(describeError(err))
      } finally {
        resetStream()
        setTyping(false)
        busyRef.current = false
      }
    },
    [ai, commitInterview, commitMessages, pushDelta, resetStream],
  )

  const handleSend = useCallback(
    async (raw: string) => {
      const dim = interviewRef.current.active
      const text = raw.trim()
      if (!dim || !text || busyRef.current) return
      busyRef.current = true
      setTyping(true)
      resetStream()

      commitMessages([
        ...messagesRef.current,
        { id: nextId('u'), role: 'user', text, dimension: dim, at: Date.now() },
      ])

      try {
        // 一次调用同时拿到「要不要追问」和「下一句话」
        const turn = await ai.reply(interviewRef.current, dim, messagesRef.current, pushDelta)
        commitInterview(nextStep(interviewRef.current, dim, turn.wantsFollowUp))
        commitMessages([...messagesRef.current, aiMessage(turn.message, dim)])
        setError(null)
      } catch (err) {
        setError(describeError(err))
      } finally {
        resetStream()
        setTyping(false)
        busyRef.current = false
      }
    },
    [ai, commitInterview, commitMessages, pushDelta, resetStream],
  )

  const handleGenerate = useCallback(async () => {
    if (busyRef.current) return
    busyRef.current = true
    setTyping(false)
    commitInterview(finishAll(interviewRef.current))
    await runSummarize()
    busyRef.current = false
  }, [commitInterview, runSummarize])

  const handleRefine = useCallback(
    async (note: string) => {
      const current = resultRef.current
      if (!current || busyRef.current) return
      busyRef.current = true
      setOverlay({ title: '正在重新整理…', sub: '结合你的补充，重写主线和下周计划' })
      try {
        commitResult(await ai.refine(messagesRef.current, current, note))
        setError(null)
      } catch (err) {
        setError(describeError(err))
      } finally {
        setOverlay(null)
        busyRef.current = false
      }
    },
    [ai, commitResult],
  )

  const handleConfigSubmit = useCallback(
    (next: AppConfig) => {
      setConfig(next)
      saveConfig(next)
      // 中途进来改设置（比如换一套采访口气）：保存完原路返回，对话一行都不动
      if (cameFrom) {
        setPage(cameFrom)
        setCameFrom(null)
        return
      }
      void startInterview()
    },
    [cameFrom, startInterview],
  )

  const openSetup = useCallback(() => {
    setCameFrom(page)
    setPage('setup')
  }, [page])

  const openHistory = useCallback(() => {
    // 和设置一样记住来路：从结果页点进总览的，返回时该回到结果页
    setCameFrom(page)
    setPage('history')
  }, [page])

  const leaveHistory = useCallback(() => {
    setPage(cameFrom && cameFrom !== 'history' ? cameFrom : 'chat')
    setCameFrom(null)
  }, [cameFrom])

  const leaveSetup = useCallback(() => {
    setPage(cameFrom ?? 'chat')
    setCameFrom(null)
  }, [cameFrom])

  const handleRestore = useCallback(() => {
    const saved = loadSession()
    if (!saved) return
    resultRef.current = saved.result
    setResult(saved.result)
    // 恢复的是哪一周的结果，就接着算哪一周：否则改两笔就会串到本周名下
    commitResultWeek(saved.week)
    commitMessages(saved.messages)
    setRestored(true)
    setPage('result')
  }, [commitMessages, commitResultWeek])

  const handleRestart = useCallback(() => {
    void startInterview()
  }, [startInterview])

  const activeDim = interview.active
  const sampleText = activeDim
    ? sampleAnswer(
        activeDim,
        messages.filter((m) => m.role === 'user' && m.dimension === activeDim).length,
      )
    : ''
  const hasAnyAnswer = messages.some((m) => m.role === 'user')

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true" />
          <span className="brand-name">AI 周报</span>
          <span className={`tag ${mode}`}>
            {mode === 'live' ? `真实模型 · ${config.model || '未填模型'}` : '演示模式 · 数据模拟'}
          </span>
        </div>
        <div className="topbar-right">
          {page !== 'setup' && page !== 'history' && (
            <button className="link-btn" type="button" onClick={openHistory}>
              总览
            </button>
          )}
          {page !== 'setup' && (
            <button className="link-btn" type="button" onClick={openSetup}>
              设置
            </button>
          )}
        </div>
      </header>

      {error && (
        <div className="error-bar" role="alert">
          <span className="error-text">{error}</span>
          <button className="link-btn" type="button" onClick={() => setError(null)}>
            知道了
          </button>
        </div>
      )}

      {page === 'setup' && (
        <SetupPage
          config={config}
          ongoing={messages.length > 0 || result !== null}
          onSubmit={handleConfigSubmit}
          onRestore={handleRestore}
          onBackToChat={leaveSetup}
        />
      )}

      {page === 'chat' && (
        <ChatPage
          messages={messages}
          typing={typing}
          streamText={streamText}
          interview={interview}
          progress={coveragePercent(interview)}
          busy={overlay !== null}
          sampleText={sampleText}
          hasAnyAnswer={hasAnyAnswer}
          onOpenBlock={handleOpenBlock}
          onSend={handleSend}
          onGenerate={handleGenerate}
        />
      )}

      {page === 'result' && result && (
        <ResultPage
          result={result}
          messages={messages}
          restored={restored}
          refining={overlay !== null}
          week={resultWeek}
          onResultChange={commitResult}
          onRefine={handleRefine}
          onRestart={handleRestart}
          onBack={() => setPage('chat')}
          onOpenHistory={openHistory}
        />
      )}

      {page === 'history' && (
        <HistoryPage
          archive={archive}
          onArchiveChange={commitArchive}
          onBack={leaveHistory}
          onStart={handleRestart}
        />
      )}

      {overlay && (
        <div className="overlay">
          <div className="overlay-card">
            <div className="spinner" aria-hidden="true" />
            <div className="overlay-title">{overlay.title}</div>
            <div className="overlay-sub">{overlay.sub}</div>
          </div>
        </div>
      )}
    </div>
  )
}
