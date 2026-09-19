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
  const hasSession = loadSession() !== null

  const update = (patch: Partial<AppConfig>) => setDraft((prev) => ({ ...prev, ...patch }))

  return (
    <main className="page setup">
      <div className="setup-card">
        <h1 className="setup-title">开始之前</h1>
        <p className="setup-desc">
          AI 周报会以一问一答的方式，陪你把这一周过一遍，再给你一份属于自己的总结和下周计划。
        </p>

        <div className="notice">
          <strong>当前是演示模式。</strong>
          所有对话与结果都由模拟数据生成，不会真的调用模型，也不需要填 API Key。
          下面这几项先占个位，接入真实模型时才会用到。
        </div>

        <label className="field">
          <span className="field-label">API Key</span>
          <input
            type="password"
            placeholder="留空即可，演示模式不需要"
            value={draft.apiKey}
            onChange={(e) => update({ apiKey: e.target.value })}
          />
        </label>

        <label className="field">
          <span className="field-label">接口地址</span>
          <input
            type="text"
            value={draft.baseUrl}
            onChange={(e) => update({ baseUrl: e.target.value })}
          />
        </label>

        <label className="field">
          <span className="field-label">模型</span>
          <input
            type="text"
            value={draft.model}
            onChange={(e) => update({ model: e.target.value })}
          />
        </label>

        <div className="setup-actions">
          <button className="btn primary" type="button" onClick={() => onSubmit(draft)}>
            开始梳理这一周
          </button>
          <button
            className="btn ghost"
            type="button"
            onClick={() => setDraft(createDefaultConfig())}
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
