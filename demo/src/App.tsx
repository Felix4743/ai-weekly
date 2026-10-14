import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { describeError } from './core/aiError'
import { archiveResult, addWeekNote, notesOf, removeWeekNote, upsertWeek, type WeekEntry } from './core/archive'
import { createAiClient } from './core/createAiClient'
import {
  coveragePercent,
  createInterview,
  currentPoint,
  currentPointNumber,
  finishAll,
  isBlockComplete,
  nextStage,
  nextStep,
  openBlock,
  planBlockEnd,
  reopenBlock,
  setDepth,
  setStateDone,
} from './core/interview'
import { hasWeekContent, mergeWeekResult, recapLines } from './core/mergeWeek'
import { sampleAnswer } from './core/mockAi'
import { createNote } from './core/notes'
import { spoken } from './core/script'
import { attachState, withScore } from './core/stateScore'
import { stripMarkerForDisplay } from './core/turn'
import {
  createDefaultConfig,
  nextId,
  type AppConfig,
  type ChatMessage,
  type Depth,
  type Dimension,
  type InterviewContext,
  type InterviewState,
  type StateKey,
  type StateScores,
  type WeeklyResult,
} from './core/types'
import { addWeeks, weekKeyOf, type WeekKey } from './core/week'
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
import { IconChart, IconGear, IconMoon, IconSun } from './ui/icons'
import { applyTheme, readTheme, toggleTheme, type Theme } from './ui/theme'

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
  /** 状态四项的分数：采访里那张卡上点出来的，出结果时贴到结果上 */
  const [stateScores, setStateScores] = useState<StateScores>({})
  /**
   * 亮色还是暗色（0.9.10）。只活在界面这一层，不进 config、不进归档 ——
   * 它跟「这周记了什么」无关，见 `ui/theme.ts` 顶上那段说明。
   */
  const [theme, setTheme] = useState<Theme>(() => readTheme())
  /** 状态卡上那一行备注（旧档的四行文字也会并到这里） */
  const [stateNote, setStateNote] = useState('')
  /**
   * 上一次收尾时还差着的要点 —— 只在输入框上方给一条可点掉的提示，**不自动补问**
   * （为什么：见 `handleSend` 里收尾对账那一段）。
   */
  const [missed, setMissed] = useState<{ dim: Dimension; labels: string[] } | null>(null)
  /**
   * 这一周的采访**开过头没有**（0.9.9 随心记）。
   *
   * 没开过头时对话页整页就是那张「随心记」卡：周中打开软件是来记一句话的，
   * 不该先看见打分卡、四个标签和一排按钮。这个开关由 `startInterview` 定：
   * 这一周已经真聊过东西（`hasWeekContent`）就直接进采访，否则先在落地页待着。
   */
  const [interviewStarted, setInterviewStarted] = useState(false)

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
  const stateScoresRef = useRef<StateScores>(stateScores)
  const stateNoteRef = useRef(stateNote)
  /** 这一轮是不是「接着这周上一次补」：生成时要把两份并成一份 */
  const resumeRef = useRef(false)
  /** 这一轮是不是「从头再聊一遍」：开场不复述这周已记下的那些 */
  const freshRef = useRef(false)
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

  const commitScores = useCallback((next: StateScores) => {
    stateScoresRef.current = next
    setStateScores(next)
  }, [])

  const commitStateNote = useCallback((next: string) => {
    stateNoteRef.current = next
    setStateNote(next)
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
        upsertWeek(archiveRef.current, {
          week: resultWeekRef.current,
          savedAt: at,
          result: next,
          // 这一周的随手记接着留着：改结果不该把平时记的东西弄丢
          notes: notesOf(archiveRef.current, resultWeekRef.current),
        }),
      )
    },
    [commitArchive],
  )

  /** 状态卡上的每一次点击与每一笔备注都走这里：分数与备注永远一起改、一起落盘 */
  const commitStateCard = useCallback(
    (scores: StateScores, note: string) => {
      commitScores(scores)
      commitStateNote(note)
      const current = resultRef.current
      // 追问小结要原样带过去：改个分数不该把聊出来的那一段抹掉
      if (current) {
        commitResult({ ...current, state: attachState(scores, note, current.state.followUp) })
      }
    },
    [commitResult, commitScores, commitStateNote],
  )

  /* ---------------- 上周与本周的上下文 ---------------- */

  /**
   * 上一次梳理留下的东西，分两份：
   * - `lastWeek`：上一周定下的重点与要跟进的人 —— 「上周对账」靠它，也决定这一步要不要跳过；
   * - `thisWeek`：**这一周已经记下的内容** —— 一周里聊第二次时，开场先把它复述一句，
   *   再问他今天补什么，别把聊过的再问一遍。
   */
  const interviewContext = useCallback((): InterviewContext => {
    const thisKey = weekKeyOf(new Date())
    const lastKey = addWeeks(thisKey, -1)
    // 打分卡上点的分要发给模型 —— 「状态追问」那一步问的就是它（模型只读、不产分）
    const ctx: InterviewContext = { stateScores: stateScoresRef.current }

    const last = archiveRef.current.find((e) => e.week === lastKey)
    if (last) {
      const { nextFocus, nextFollowUps } = last.result
      if (nextFocus.length > 0 || nextFollowUps.length > 0) {
        ctx.lastWeek = { focus: nextFocus, followUps: nextFollowUps }
        ctx.lastWeekKey = lastKey
      }
    }

    const mine = archiveRef.current.find((e) => e.week === thisKey)
    if (!freshRef.current && mine && hasWeekContent(mine.result)) {
      ctx.thisWeek = { savedAt: mine.savedAt, lines: recapLines(mine.result) }
    }

    // 周中随手记下的碎片：开场带上是让他不用从空白开始回忆（0.9.8）。
    // 「从头再聊一遍」时不带 —— 那条路的语义就是「这周记的都不看」。
    if (!freshRef.current && mine && mine.notes.length > 0) {
      ctx.notes = mine.notes
    }
    return ctx
  }, [])

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

  /**
   * 开一轮梳理。
   *
   * 默认是「接着这周上次补」：这一周要是已经记过东西，状态卡预填上次的分数与备注，
   * 生成时两份并成一份（见 mergeWeek.ts）。`fresh: true` 是「从头再聊一遍」，
   * 不看这周已有的记录，生成时把它换掉。
   *
   * 流程从**状态卡**开始 —— 先在卡片上打完分，再问他要聊到多细。
   * 所以这里不请 AI 说话：第一句提问要等定完档、开第一块的时候。
   */
  const startInterview = useCallback(
    async (options: { fresh?: boolean } = {}) => {
      if (busyRef.current) return
      resetStream()
      commitMessages([])
      const ctx = interviewContext()
      const thisKey = weekKeyOf(new Date())
      const mine = options.fresh ? undefined : archiveRef.current.find((e) => e.week === thisKey)

      resumeRef.current = Boolean(mine && hasWeekContent(mine.result))
      // 「从头再聊一遍」是他明确要开始第二轮，落地页不再拦一道
      setInterviewStarted(options.fresh === true || resumeRef.current)
      // 「从头再聊一遍」连开场那句复述也不要 —— 他要的就是别看这周的旧记录
      freshRef.current = Boolean(options.fresh)
      commitScores(mine?.result.state.scores ?? {})
      commitStateNote(mine?.result.state.note ?? '')

      commitInterview(createInterview({ hasLastWeek: Boolean(ctx.lastWeek) }))
      resultRef.current = null
      setResult(null)
      setRestored(false)
      setMissed(null)
      // 这一轮从今天算起；上一份结果属于哪一周，到这里为止
      commitResultWeek(thisKey)
      setPage('chat')
    },
    [
      commitInterview,
      commitMessages,
      commitResultWeek,
      commitScores,
      commitStateNote,
      interviewContext,
      resetStream,
    ],
  )

  // 首次挂载：若已配置过则直接进入对话
  const bootedRef = useRef(false)
  useEffect(() => {
    if (bootedRef.current) return
    bootedRef.current = true
    if (page === 'chat') void startInterview()
    // 仅在挂载时执行一次
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 主题落到 <html data-theme>：styles.css 里那一整块深色令牌就靠它生效
  useEffect(() => {
    applyTheme(theme)
  }, [theme])

  const runSummarize = useCallback(async () => {
    setOverlay({ title: '正在整理这一周…', sub: '把你说过的内容归纳成清单，再想想下周' })
    try {
      const r = await ai.summarize(messagesRef.current, interviewContext())
      const week = weekKeyOf(new Date())
      // 一周里聊第二次：这一轮的内容并进这周已经记下的那一份，别把上次那份顶掉
      const previous = resumeRef.current
        ? (archiveRef.current.find((e) => e.week === week)?.result ?? null)
        : null
      const merged = mergeWeekResult(r, previous)
      // 分数与备注以界面上真实的点击 / 手写为准：模型压根不产这一项，它自己编的也在这儿被盖掉。
      // 唯一的例外是追问小结 —— 那是模型据追问对话写的，不是分，所以由它带过来。
      const withState: WeeklyResult = {
        ...merged,
        state: attachState(
          stateScoresRef.current,
          stateNoteRef.current,
          merged.state.followUp,
        ),
      }
      // 生成的那一刻定下它属于哪一周 —— 之后再编辑、重新整理都跟着这一周走
      commitResultWeek(week)
      commitResult(withState)
      setError(null)
      setPage('result')
    } catch (err) {
      setError(describeError(err))
    } finally {
      setOverlay(null)
    }
  }, [ai, commitResult, commitResultWeek, interviewContext])

  /** 用户自己点开某一块；如果是第一次打开，让 AI 先开口 */
  const handleOpenBlock = useCallback(
    async (dim: Dimension) => {
      if (busyRef.current) return
      // 状态卡还没交：先打完分、定了档，才轮到他挑块
      if (!interviewRef.current.stateDone) return
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
        const text = await ai.nextMessage(opened, dim, messagesRef.current, pushDelta, interviewContext())
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
    [ai, commitInterview, commitMessages, interviewContext, pushDelta, resetStream],
  )

  /**
   * 用户点了提示里的「接着补」：切回那一栏、把这一块重新打开。
   *
   * 关键是**不替他念锚点**：块退回未完成之后，他打的下一句话会让模型拿到
   * 正常的回合提示词 —— 里面摆着「这一块还没聊到的要点」，模型自己会接。
   */
  const handleReopen = useCallback(() => {
    if (!missed || busyRef.current) return
    commitInterview(reopenBlock(interviewRef.current, missed.dim))
    setMissed(null)
  }, [commitInterview, missed])

  /** 用户点了「算了」：这条提示就过去，不再提 */
  const handleDismissMissed = useCallback(() => setMissed(null), [])

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
        // 一次调用同时拿到「这一轮想干什么」和「下一句话」
        const turn = await ai.reply(interviewRef.current, dim, messagesRef.current, pushDelta)
        let advanced = nextStep(interviewRef.current, dim, turn.action, { covered: turn.covered })

        /**
         * 收尾对账：模型说「这一块聊完了」时**不直接信**，先看还差哪几个要点。
         *
         * 但 0.9.5 起**不自动替它补问**了 —— 真模型实测六个块里四个收尾时都缺要点，
         * 而客户端补问只能念锚点原文（「有件本来想做的事，最后没动？卡在哪一步了？」），
         * 那正是用户嫌「像念稿」的句子，一条条补上去机械感又回来了。
         * 所以这里只记一笔，在输入框上方给一条可点掉的提示，由用户决定要不要回去补两句。
         */
        const plan = turn.action === 'block' ? planBlockEnd(advanced, dim) : null
        if (plan && plan.missing.length > 0) {
          setMissed({ dim, labels: plan.missing.map((p) => p.intent) })
        }

        // 模型判定「这块聊够了」（[换块]）：顺手把流程里的下一块打开，别让他再点一次。
        // 下一步是「定档」或「全聊完了」时不自动往下走，那两种要留给用户决定。
        const stage = turn.action === 'block' ? nextStage(advanced) : null
        const followUpBlock = stage?.kind === 'block' && stage.dim !== dim ? stage.dim : null
        const next = followUpBlock ? openBlock(advanced, followUpBlock) : advanced

        commitInterview(next)
        commitMessages([...messagesRef.current, aiMessage(turn.message, dim)])

        if (followUpBlock) {
          resetStream()
          const opening = await ai.nextMessage(
            next,
            followUpBlock,
            messagesRef.current,
            pushDelta,
            interviewContext(),
          )
          commitMessages([...messagesRef.current, aiMessage(opening, followUpBlock)])
        }
        setError(null)
      } catch (err) {
        setError(describeError(err))
      } finally {
        resetStream()
        setTyping(false)
        busyRef.current = false
      }
    },
    [ai, commitInterview, commitMessages, interviewContext, pushDelta, resetStream],
  )

  /** 用户挑了复盘深度：定档，然后把下一块打开 */
  const handlePickDepth = useCallback(
    async (depth: Depth) => {
      if (busyRef.current) return
      const chosen = setDepth(interviewRef.current, depth)
      commitInterview(chosen)

      const stage = nextStage(chosen)
      if (stage.kind !== 'block' || interviewRef.current.active === stage.dim) return

      busyRef.current = true
      setTyping(true)
      resetStream()
      try {
        const opened = openBlock(chosen, stage.dim)
        commitInterview(opened)
        const text = await ai.nextMessage(
          opened,
          stage.dim,
          messagesRef.current,
          pushDelta,
          interviewContext(),
        )
        commitMessages([...messagesRef.current, aiMessage(text, stage.dim)])
        setError(null)
      } catch (err) {
        setError(describeError(err))
      } finally {
        resetStream()
        setTyping(false)
        busyRef.current = false
      }
    },
    [ai, commitInterview, commitMessages, interviewContext, pushDelta, resetStream],
  )

  /**
   * 用户交了状态卡：流程走到「定档」，接下来交给他点按钮。
   *
   * 分数要一起交进去 —— 「状态追问」问哪几项、问几道题，全看交卡这一刻的分。
   */
  const handleStateDone = useCallback(() => {
    if (busyRef.current) return
    commitInterview(setStateDone(interviewRef.current, stateScoresRef.current))
  }, [commitInterview])

  /**
   * 「这题跳过」：用户提的「我有很多问题是没有感觉的，可以加个没有按键」。
   *
   * 点一下直接推进到下一个要点 —— **不发请求、也不在记录里留「跳过了」这种痕迹**。
   * 跳过 = 「这一点我没什么可说的」，所以顺手把它记成聊到了，否则下一个要点的
   * 锚点问法会把同一句又问一遍。
   *
   * 但**下一个要点得亮出来**：不发请求就没有新文本，屏幕上会一直停着上一句，
   * 点完看着像没反应。所以这里用客户端那句锚点问法（`spoken`）顶上 ——
   * 跟「模型什么都没说」时的兜底是同一句，不是新造一套。
   */
  const handleSkip = useCallback(() => {
    const dim = interviewRef.current.active
    if (!dim || busyRef.current) return

    const wasComplete = isBlockComplete(interviewRef.current, dim)
    const at = currentPointNumber(interviewRef.current, dim)
    const advanced = nextStep(interviewRef.current, dim, 'next', {
      covered: at === undefined ? [] : [at],
    })
    commitInterview(advanced)

    // 要点本来就聊完了（自由聊）没什么可跳的
    if (wasComplete) return

    if (!isBlockComplete(advanced, dim)) {
      const question = spoken(currentPoint(advanced, dim))
      if (question) commitMessages([...messagesRef.current, aiMessage(question, dim)])
      return
    }

    // 跳掉的正好是这一块最后一个要点：跟 [换块] 一样顺手把下一块打开，让它先开口
    const stage = nextStage(advanced)
    if (stage.kind === 'block' && stage.dim !== dim) void handleOpenBlock(stage.dim)
  }, [commitInterview, commitMessages, handleOpenBlock])

  /**
   * 用户在状态卡上点了星 / 写了备注。
   *
   * 改的是「这一轮采访」的那张卡；要是结果已经出来了（从结果页又退回采访接着聊），
   * 同一笔改动也得落到那份结果上，否则两边会不一致。
   */
  const handleScoreState = useCallback(
    (key: StateKey, value: number | undefined) => {
      commitStateCard(withScore(stateScoresRef.current, key, value), stateNoteRef.current)
    },
    [commitStateCard],
  )

  const handleNoteChange = useCallback(
    (text: string) => {
      commitStateCard(stateScoresRef.current, text)
    },
    [commitStateCard],
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
    // 上次点过的星与写过的备注也在那份结果里：恢复出来，采访里接着改才对得上
    commitScores(saved.result.state?.scores ?? {})
    commitStateNote(saved.result.state?.note ?? '')
    setRestored(true)
    setPage('result')
  }, [commitMessages, commitResultWeek, commitScores, commitStateNote])

  const handleRestart = useCallback(() => {
    void startInterview()
  }, [startInterview])

  /** 从头再聊一遍：这周已经记下的那些不看、不并，生成时换掉 */
  const handleStartFresh = useCallback(() => {
    void startInterview({ fresh: true })
  }, [startInterview])

  /* ---------------- 周中随心记（0.9.9） ---------------- */

  /** 这一周的随手记。存在归档里、跟结果分开：记了不等于聊过 */
  const weekNotes = useMemo(() => notesOf(archive, weekKeyOf(new Date())), [archive])

  /**
   * 记一句。
   *
   * 只落归档、**不动结果**：笔记是素材，只有周末真聊到了，模型才会把它写进清单。
   * 空白与超长都由 `createNote` 管（空白返回 null、超长截断）。
   */
  const handleAddNote = useCallback(
    (text: string) => {
      const note = createNote(text, Date.now())
      if (!note) return
      commitArchive(addWeekNote(archiveRef.current, weekKeyOf(new Date()), note))
    },
    [commitArchive],
  )

  const handleRemoveNote = useCallback(
    (id: string) => {
      commitArchive(removeWeekNote(archiveRef.current, weekKeyOf(new Date()), id))
    },
    [commitArchive],
  )

  /** 落地页上那句「开始这周的梳理」：从这一刻起这一屏就是采访了 */
  const handleStartInterview = useCallback(() => setInterviewStarted(true), [])

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
          {/* 主题开关（0.9.10）：一个按钮切亮/暗，点击就存，不占设置页的地方 */}
          <button
            className="btn ghost sm icon-only"
            type="button"
            onClick={() => setTheme(toggleTheme(theme))}
            title={theme === 'dark' ? '切成亮色' : '切成暗色'}
            aria-label={theme === 'dark' ? '切成亮色' : '切成暗色'}
          >
            {theme === 'dark' ? <IconSun /> : <IconMoon />}
          </button>
          {page !== 'setup' && page !== 'history' && (
            <button className="btn ghost sm" type="button" onClick={openHistory}>
              <IconChart />
              总览
            </button>
          )}
          {page !== 'setup' && (
            <button className="btn ghost sm" type="button" onClick={openSetup}>
              <IconGear />
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
          stateScores={stateScores}
          stateNote={stateNote}
          onOpenBlock={handleOpenBlock}
          onSend={handleSend}
          onPickDepth={handlePickDepth}
          onScoreState={handleScoreState}
          onNoteChange={handleNoteChange}
          onStateDone={handleStateDone}
          onSkip={handleSkip}
          missed={missed}
          onReopen={handleReopen}
          onDismissMissed={handleDismissMissed}
          onStartFresh={handleStartFresh}
          onGenerate={handleGenerate}
          started={interviewStarted}
          onStartInterview={handleStartInterview}
          notes={weekNotes}
          onAddNote={handleAddNote}
          onRemoveNote={handleRemoveNote}
        />
      )}

      {page === 'result' && result && (
        <ResultPage
          result={result}
          archive={archive}
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
