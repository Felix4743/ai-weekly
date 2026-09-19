import { useState } from 'react'
import { resultToMarkdown } from '../core/resultText'
import type { ChatMessage, WeeklyResult } from '../core/types'

interface Props {
  result: WeeklyResult
  messages: ChatMessage[]
  restored: boolean
  onRestart: () => void
  onBack: () => void
}

function List({ items, empty = '（这次没有聊到）' }: { items: string[]; empty?: string }) {
  if (items.length === 0) return <p className="empty">{empty}</p>
  return (
    <ul className="result-list">
      {items.map((item, i) => (
        <li key={`${i}-${item}`}>{item}</li>
      ))}
    </ul>
  )
}

export function ResultPage({ result, messages, restored, onRestart, onBack }: Props) {
  const [copied, setCopied] = useState(false)
  const [showLog, setShowLog] = useState(false)
  const markdown = resultToMarkdown(result)

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(markdown)
    } catch {
      const ta = document.createElement('textarea')
      ta.value = markdown
      ta.style.position = 'fixed'
      ta.style.opacity = '0'
      document.body.appendChild(ta)
      ta.select()
      document.execCommand('copy')
      ta.remove()
    }
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1800)
  }

  return (
    <main className="page result">
      <div className="result-head">
        <div>
          <h1 className="result-title">本周梳理</h1>
          <p className="result-sub">
            {restored ? '这是上一次保存的结果' : `基于 ${messages.filter((m) => m.role === 'user').length} 次回答整理而成`}
          </p>
        </div>
        <div className="result-actions">
          <button className="btn primary" type="button" onClick={copy}>
            {copied ? '已复制 ✓' : '复制全文'}
          </button>
          <button className="btn ghost" type="button" onClick={onRestart}>
            再来一次
          </button>
        </div>
      </div>

      <section className="card">
        <h2 className="card-title">本周清单</h2>
        <div className="grid-3">
          <div className="col">
            <h3 className="col-title">事</h3>
            <List items={result.events} />
          </div>
          <div className="col">
            <h3 className="col-title">人</h3>
            {result.people.length === 0 ? (
              <p className="empty">（这次没有聊到）</p>
            ) : (
              <ul className="result-list">
                {result.people.map((p, i) => (
                  <li key={`${i}-${p.name}`}>
                    <b>{p.name}</b>
                    {p.note && <span className="person-note">{p.note}</span>}
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className="col">
            <h3 className="col-title">悬着</h3>
            <List items={result.pending} />
          </div>
        </div>
      </section>

      <section className="card highlight-card">
        <h2 className="card-title">本周热点</h2>
        <p className="card-desc">这一周真正值得记住的几件事</p>
        <List items={result.highlights} />
      </section>

      <section className="card">
        <h2 className="card-title">下周计划</h2>
        <div className="grid-2">
          <div className="col">
            <h3 className="col-title">三件重点</h3>
            <List items={result.nextFocus} />
          </div>
          <div className="col">
            <h3 className="col-title">要跟进的人</h3>
            <List items={result.nextFollowUps} empty="（这次没有提到具体的人）" />
          </div>
        </div>
      </section>

      <div className="log-toggle">
        <button className="link-btn" type="button" onClick={() => setShowLog((v) => !v)}>
          {showLog ? '收起对话记录' : '查看对话记录'}
        </button>
      </div>

      {showLog && (
        <section className="card log">
          {messages.map((m) => (
            <div key={m.id} className={`log-row ${m.role}`}>
              <span className="log-role">{m.role === 'ai' ? 'AI' : '我'}</span>
              <span className="log-text">{m.text}</span>
            </div>
          ))}
        </section>
      )}

      <div className="footer-actions">
        <button className="btn ghost" type="button" onClick={onBack}>
          回到对话
        </button>
      </div>
    </main>
  )
}
