import { useCallback, useEffect, useRef, useState } from 'react'
import { createMockAi, sampleAnswer } from './core/mockAi'
import {
  createInterview,
  currentDimension,
  forceFinish,
  nextStep,
  progressPercent,
} from './core/interview'
import {
  createDefaultConfig,
  nextId,
  type AppConfig,
  type ChatMessage,
  type Dimension,
  type InterviewState,
  type WeeklyResult,
} from './core/types'
import { loadConfig, loadSession, saveConfig, saveSession } from './storage/localStore'
import { SetupPage } from './ui/SetupPage'
import { ChatPage } from './ui/ChatPage'
import { ResultPage } from './ui/ResultPage'

type Page = 'setup' | 'chat' | 'result'

function aiMessage(text: string, dimension: Dimension): ChatMessage {
  return { id: nextId('a'), role: 'ai', text, dimension, at: Date.now() }
}

export default function App() {
  // Demo 阶段固定使用假 AI；M2 只需在这里换成真实实现
  const aiRef = useRef(createMockAi())
  const ai = aiRef.current

  const [page, setPage] = useState<Page>(() => (loadConfig() ? 'chat' : 'setup'))
  const [config, setConfig] = useState<AppConfig>(() => loadConfig() ?? createDefaultConfig())
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [interview, setInterview] = useState<InterviewState>(() => createInterview())
  const [typing, setTyping] = useState(false)
  const [summarizing, setSummarizing] = useState(false)
  const [result, setResult] = useState<WeeklyResult | null>(null)
  const [restored, setRestored] = useState(false)

  const messagesRef = useRef<ChatMessage[]>([])
  const interviewRef = useRef<InterviewState>(interview)
  const busyRef = useRef(false)

  const commitMessages = useCallback((list: ChatMessage[]) => {
    messagesRef.current = list
    setMessages(list)
  }, [])

  const commitInterview = useCallback((next: InterviewState) => {
    interviewRef.current = next
    setInterview(next)
  }, [])

  const startInterview = useCallback(async () => {
    if (busyRef.current) return
    busyRef.current = true
    commitMessages([])
    commitInterview(createInterview())
    setResult(null)
    setRestored(false)
    setPage('chat')
    setTyping(true)
    const text = await ai.opening()
    setTyping(false)
    commitMessages([aiMessage(text, 'event')])
    busyRef.current = false
  }, [ai, commitMessages, commitInterview])

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
    setSummarizing(true)
    const r = await ai.summarize(messagesRef.current)
    setResult(r)
    saveSession({ messages: messagesRef.current, result: r, savedAt: Date.now() })
    setSummarizing(false)
    setPage('result')
  }, [ai])

  const handleSend = useCallback(
    async (raw: string) => {
      const text = raw.trim()
      if (!text || busyRef.current) return
      busyRef.current = true
      setTyping(true)

      const dimension = currentDimension(interviewRef.current)
      commitMessages([
        ...messagesRef.current,
        { id: nextId('u'), role: 'user', text, dimension, at: Date.now() },
      ])

      const wantsFollowUp = await ai.wantsFollowUp(text, interviewRef.current)
      const advanced = nextStep(interviewRef.current, wantsFollowUp)
      commitInterview(advanced)

      if (advanced.done) {
        setTyping(false)
        busyRef.current = false
        await runSummarize()
        return
      }

      const nextText = await ai.nextMessage(advanced, messagesRef.current)
      commitMessages([
        ...messagesRef.current,
        aiMessage(nextText, currentDimension(advanced)),
      ])
      setTyping(false)
      busyRef.current = false
    },
    [ai, commitInterview, commitMessages, runSummarize],
  )

  const handleFinish = useCallback(async () => {
    if (busyRef.current) return
    busyRef.current = true
    setTyping(false)
    commitInterview(forceFinish(interviewRef.current))
    await runSummarize()
    busyRef.current = false
  }, [commitInterview, runSummarize])

  const handleConfigSubmit = useCallback(
    (next: AppConfig) => {
      setConfig(next)
      saveConfig(next)
      void startInterview()
    },
    [startInterview],
  )

  const handleRestore = useCallback(() => {
    const saved = loadSession()
    if (!saved) return
    setResult(saved.result)
    commitMessages(saved.messages)
    setRestored(true)
    setPage('result')
  }, [commitMessages])

  const handleRestart = useCallback(() => {
    void startInterview()
  }, [startInterview])

  const userAnswerCount = messages.filter((m) => m.role === 'user').length
  const sampleText = sampleAnswer(currentDimension(interview), userAnswerCount)

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true" />
          <span className="brand-name">AI 周报</span>
          <span className="tag">演示模式 · 数据模拟</span>
        </div>
        <div className="topbar-right">
          {page !== 'setup' && (
            <button className="link-btn" type="button" onClick={() => setPage('setup')}>
              设置
            </button>
          )}
        </div>
      </header>

      {page === 'setup' && (
        <SetupPage config={config} onSubmit={handleConfigSubmit} onRestore={handleRestore} />
      )}

      {page === 'chat' && (
        <ChatPage
          messages={messages}
          typing={typing}
          interview={interview}
          progress={progressPercent(interview)}
          busy={summarizing}
          sampleText={sampleText}
          onSend={handleSend}
          onFinish={handleFinish}
        />
      )}

      {page === 'result' && result && (
        <ResultPage
          result={result}
          messages={messages}
          restored={restored}
          onRestart={handleRestart}
          onBack={() => setPage('chat')}
        />
      )}

      {summarizing && (
        <div className="overlay">
          <div className="overlay-card">
            <div className="spinner" aria-hidden="true" />
            <div className="overlay-title">正在整理这一周…</div>
            <div className="overlay-sub">把你说过的内容归纳成清单，再想想下周</div>
          </div>
        </div>
      )}
    </div>
  )
}
