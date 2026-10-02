import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { describeError } from './core/aiError'
import {
  findEntry,
  previousWeekContext,
  updateWeek,
  type WeekEntry,
} from './core/archive'
import { createAiClient } from './core/createAiClient'
import { isDegradedReview, type Review } from './core/review'
import { mergeReview } from './core/mergeReview'
import { droppedAfter, mergeDropped } from './core/reviewEdit'
import { createDefaultConfig, type AppConfig } from './core/types'
import { weekKeyOf, weekRangeText, type WeekKey } from './core/week'
import { loadArchive, loadConfig, saveArchive, saveConfig } from './storage'
import { createTransport } from './transport'
import { HistoryPage } from './ui/HistoryPage'
import { JournalPage } from './ui/JournalPage'
import { SetupPage } from './ui/SetupPage'

type Page = 'setup' | 'journal' | 'history'

/** 原文自动落盘的等待时间：写的人在打字，不该每敲一个字就整份重写一次文件 */
const NOTES_DEBOUNCE_MS = 800

/** 把补充的一句接在原文后面 */
function joinNotes(notes: string, extra: string): string {
  const head = notes.trim()
  const tail = extra.trim()
  if (!tail) return head
  return head ? `${head}\n${tail}` : tail
}

/** 这一次删掉的条目并进这一周已经记着的那些：去重，原来记着的原样留着 */

export default function App() {
  // 传输层只建一次；装在 Electron 里自动走主进程 IPC，在浏览器里走 fetch。
  // 「换外壳」这件事到此为止 —— 下面全是业务代码，不认壳。
  const transportRef = useRef(createTransport())

  const [config, setConfig] = useState<AppConfig>(() => loadConfig() ?? createDefaultConfig())
  const [page, setPage] = useState<Page>(() => (loadConfig() ? 'journal' : 'setup'))
  const [archive, setArchive] = useState<WeekEntry[]>(() => loadArchive())
  /** 正在复盘哪一周。默认是刚过完的这周；点开旧周就从那一周接着做 */
  const [week, setWeek] = useState<WeekKey>(() => weekKeyOf(new Date()))
  // 首屏就把这一周的原文读出来（只读一次归档，别再单独 load 一遍）
  const [notes, setNotes] = useState(() => findEntry(archive, week)?.notes ?? '')
  const [reply, setReply] = useState('')
  const [analyzing, setAnalyzing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  /** 从哪一页点进设置的：回去时要还给他，改设置不该等于重开 */
  const [cameFrom, setCameFrom] = useState<Page | null>(null)

  // 填了 Key 就是真模型，没填就用假分析器走通流程
  const { client: ai, mode } = useMemo(
    () => createAiClient(config, transportRef.current),
    [config],
  )

  const archiveRef = useRef<WeekEntry[]>(archive)
  const weekRef = useRef<WeekKey>(week)
  const notesRef = useRef(notes)
  const notesTimer = useRef<number | null>(null)
  const busyRef = useRef(false)

  const commitArchive = useCallback((next: WeekEntry[]) => {
    archiveRef.current = next
    setArchive(next)
    saveArchive(next)
  }, [])

  /** 把原文写进那一周（会刷新 savedAt ——「上次记录」说的就是这种写入） */
  const writeNotes = useCallback(
    (target: WeekKey, text: string) => {
      commitArchive(updateWeek(archiveRef.current, target, { notes: text }, Date.now()))
    },
    [commitArchive],
  )

  const clearNotesTimer = useCallback(() => {
    if (notesTimer.current !== null) {
      window.clearTimeout(notesTimer.current)
      notesTimer.current = null
    }
  }, [])

  /** 立刻把手上这段原文落盘（切周、离开页面、开始复盘之前都要先来一下） */
  const flushNotes = useCallback(() => {
    clearNotesTimer()
    writeNotes(weekRef.current, notesRef.current)
  }, [clearNotesTimer, writeNotes])

  const changeNotes = useCallback(
    (text: string) => {
      notesRef.current = text
      setNotes(text)
      clearNotesTimer()
      notesTimer.current = window.setTimeout(() => {
        notesTimer.current = null
        writeNotes(weekRef.current, notesRef.current)
      }, NOTES_DEBOUNCE_MS)
    },
    [clearNotesTimer, writeNotes],
  )

  /** 把原文直接设成这一段并立刻落盘（补写、切周时用） */
  const applyNotes = useCallback(
    (text: string) => {
      notesRef.current = text
      setNotes(text)
      flushNotes()
    },
    [flushNotes],
  )

  /* ---------------- 复盘 ---------------- */

  const analyze = useCallback(
    async (isFollowUp: boolean) => {
      if (busyRef.current) return
      const text = notesRef.current.trim()
      if (!text) return

      busyRef.current = true
      setAnalyzing(true)
      setError(null)
      try {
        // 先把原文落到那一周：万一请求失败，写的东西也不会丢
        flushNotes()
        const target = weekRef.current
        const outcome = await ai.analyze({
          week: target,
          weekText: weekRangeText(target),
          notes: text,
          previous: previousWeekContext(archiveRef.current, target),
          isFollowUp,
        })
        setReply(outcome.reply)

        // 失败那一份不落盘、也不并进已有的：一次网络抖动不该把理好的复盘换掉
        if (isDegradedReview(outcome.review)) {
          setError(outcome.review.headline)
          return
        }

        const entry = findEntry(archiveRef.current, target)
        const existing = entry?.review ?? null
        const merged = existing
          ? mergeReview(existing, outcome.review, entry?.dropped ?? [])
          : outcome.review
        commitArchive(updateWeek(archiveRef.current, target, { review: merged }, Date.now()))
      } catch (err) {
        setError(describeError(err))
      } finally {
        setAnalyzing(false)
        busyRef.current = false
      }
    },
    [ai, commitArchive, flushNotes],
  )

  const followUp = useCallback(
    (text: string) => {
      applyNotes(joinNotes(notesRef.current, text))
      setReply('')
      void analyze(true)
    },
    [analyze, applyNotes],
  )

  /** 用户在复盘里手改清单 —— 改的就是眼前这一周 */
  const editReview = useCallback(
    (next: Review) => {
      const target = weekRef.current
      const entry = findEntry(archiveRef.current, target)
      const previous = entry?.review ?? null
      // 这一版比上一版少掉的条目记到这一周头上：下一次重新复盘时照着它拦，
      // 删了才算数（没删过就只是把原来记着的那份原样带下去）
      const dropped = mergeDropped(
        entry?.dropped ?? [],
        previous ? droppedAfter(previous, next) : [],
      )
      commitArchive(updateWeek(archiveRef.current, target, { review: next, dropped }, Date.now()))
    },
    [commitArchive],
  )

  /* ---------------- 页面切换 ---------------- */

  /** 打开某一周：先把手上这段原文存档，再换周、换原文 */
  const openWeek = useCallback(
    (target: WeekKey) => {
      if (target === weekRef.current) {
        setPage('journal')
        return
      }
      flushNotes()
      weekRef.current = target
      setWeek(target)
      const entry = findEntry(archiveRef.current, target)
      notesRef.current = entry?.notes ?? ''
      setNotes(entry?.notes ?? '')
      setReply('')
      setPage('journal')
    },
    [flushNotes],
  )

  const openSetup = useCallback(() => {
    setCameFrom(page)
    setPage('setup')
  }, [page])

  const leaveSetup = useCallback(() => {
    setPage(cameFrom && cameFrom !== 'setup' ? cameFrom : 'journal')
    setCameFrom(null)
  }, [cameFrom])

  const openHistory = useCallback(() => {
    setCameFrom(page)
    setPage('history')
  }, [page])

  const leaveHistory = useCallback(() => {
    setPage(cameFrom && cameFrom !== 'history' ? cameFrom : 'journal')
    setCameFrom(null)
  }, [cameFrom])

  const handleConfigSubmit = useCallback(
    (next: AppConfig) => {
      setConfig(next)
      saveConfig(next)
      leaveSetup()
    },
    [leaveSetup],
  )

  // 离开页面（含关窗）时把没落盘的那一段原文补上
  useEffect(() => flushNotes, [flushNotes])

  const currentReview = findEntry(archive, week)?.review ?? null

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
          {page === 'journal' && (
            <button className="link-btn" type="button" onClick={openHistory}>
              总览
            </button>
          )}
          {page === 'history' && (
            <button className="link-btn" type="button" onClick={() => openWeek(week)}>
              回到复盘
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
        <SetupPage config={config} onSubmit={handleConfigSubmit} onBack={leaveSetup} />
      )}

      {page === 'journal' && (
        <JournalPage
          week={week}
          notes={notes}
          review={currentReview}
          reply={reply}
          archive={archive}
          analyzing={analyzing}
          onNotesChange={changeNotes}
          onAnalyze={() => void analyze(false)}
          onFollowUp={followUp}
          onReviewChange={editReview}
          onOpenHistory={openHistory}
        />
      )}

      {page === 'history' && (
        <HistoryPage
          archive={archive}
          onArchiveChange={commitArchive}
          onBack={leaveHistory}
          onOpenWeek={openWeek}
        />
      )}
    </div>
  )
}
