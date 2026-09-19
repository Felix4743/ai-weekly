import { useState } from 'react'
import { createDefaultConfig, type AppConfig } from '../core/types'
import { loadSession } from '../storage/localStore'

interface Props {
  config: AppConfig
  onSubmit: (config: AppConfig) => void
  onRestore: () => void
}

export function SetupPage({ config, onSubmit, onRestore }: Props) {
  const [draft, setDraft] = useState<AppConfig>(config)
  const [problem, setProblem] = useState<string | null>(null)
  const hasSession = loadSession() !== null

  // 填了 Key 就是真模型；留空则用内置的模拟 AI，什么都不配也能先走一遍
  const live = draft.apiKey.trim().length > 0

  const update = (patch: Partial<AppConfig>) => {
    setProblem(null)
    setDraft((prev) => ({ ...prev, ...patch }))
  }

  const submit = () => {
    const baseUrl = draft.baseUrl.trim().replace(/\/+$/, '')
    const model = draft.model.trim()

    if (live) {
      if (!/^https?:\/\//i.test(baseUrl)) {
        setProblem('接口地址要以 http:// 或 https:// 开头')
        return
      }
      if (!model) {
        setProblem('请填一下模型名，比如 deepseek-chat')
        return
      }
    }

    setProblem(null)
    onSubmit({ apiKey: draft.apiKey.trim(), baseUrl, model })
  }

  return (
    <main className="page setup">
      <div className="setup-card">
        <h1 className="setup-title">开始之前</h1>
        <p className="setup-desc">
          AI 周报会以一问一答的方式，陪你把这一周过一遍，再给你一份属于自己的总结和下周计划。
        </p>

        <div className={`notice${live ? ' live' : ''}`}>
          {live ? (
            <>
              <strong>将使用真实模型。</strong>
              对话与梳理都会调用你填的接口，模型是
              <code>{draft.model.trim() || '（还没填）'}</code>。API Key 只存在本机。
            </>
          ) : (
            <>
              <strong>当前是演示模式。</strong>
              不填 API Key 也能把整个流程走一遍 —— 对话与结果由内置的模拟数据生成，
              不联网、不花钱。想用真实模型，把下面的 Key 填上即可。
            </>
          )}
        </div>

        <label className="field">
          <span className="field-label">API Key</span>
          <input
            type="password"
            placeholder="留空则使用演示模式"
            value={draft.apiKey}
            onChange={(e) => update({ apiKey: e.target.value })}
          />
        </label>

        <label className="field">
          <span className="field-label">接口地址</span>
          <input
            type="text"
            placeholder="https://api.deepseek.com/v1"
            value={draft.baseUrl}
            onChange={(e) => update({ baseUrl: e.target.value })}
          />
        </label>

        <label className="field">
          <span className="field-label">模型</span>
          <input
            type="text"
            placeholder="deepseek-chat"
            value={draft.model}
            onChange={(e) => update({ model: e.target.value })}
          />
        </label>

        <p className="field-hint">
          只要支持 OpenAI 兼容的 <code>/chat/completions</code> 就能用，换模型不用改代码。
        </p>

        {problem && <p className="field-problem">{problem}</p>}

        <div className="setup-actions">
          <button className="btn primary" type="button" onClick={submit}>
            开始梳理这一周
          </button>
          <button
            className="btn ghost"
            type="button"
            onClick={() => {
              setProblem(null)
              setDraft(createDefaultConfig())
            }}
          >
            恢复默认
          </button>
          {hasSession && (
            <button className="btn ghost" type="button" onClick={onRestore}>
              查看上次的结果
            </button>
          )}
        </div>
      </div>
    </main>
  )
}
