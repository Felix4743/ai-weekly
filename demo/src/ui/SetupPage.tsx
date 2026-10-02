import { useState } from 'react'
import { createDefaultConfig, type AppConfig } from '../core/types'

/**
 * 设置页。
 *
 * 0.9.0 起这里只放「连哪个模型」这一件事 —— 人设那套（挑采访者、改提示词）
 * 跟着采访模式一起删了：AI 现在是分析方，不是提问方，用户没机会看它怎么说话。
 * 「上次的结果」那个入口也删了：总览页就在顶栏，那边看得更全。
 */

interface Props {
  config: AppConfig
  onSubmit: (config: AppConfig) => void
  onBack: () => void
}

export function SetupPage({ config, onSubmit, onBack }: Props) {
  const [draft, setDraft] = useState<AppConfig>(config)
  const [problem, setProblem] = useState<string | null>(null)

  // 填了 Key 就是真模型；留空则用内置的假分析器，什么都不配也能把流程走一遍
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
        <h1 className="setup-title">设置</h1>
        <p className="setup-desc">
          用之前先把接口填上。复盘是让模型读你写的这一周，再给出总结、问题和下周计划 ——
          AI 周报不问你问题，你写完它才开口。
        </p>

        <div className={`notice${live ? ' live' : ''}`}>
          {live ? (
            <>
              <strong>将使用真实模型。</strong>
              复盘会调用你填的接口，模型是
              <code>{draft.model.trim() || '（还没填）'}</code>。API Key 只存在本机。
            </>
          ) : (
            <>
              <strong>当前是演示模式。</strong>
              不填 API Key 也能把整个流程走一遍 —— 复盘由内置的假分析器按规则生成，
              不联网、不花钱，但结论只是规则的产物，别当真。想用真实模型，把下面的 Key 填上即可。
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
            保存
          </button>
          <button className="btn ghost" type="button" onClick={onBack}>
            不保存，返回
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
        </div>
      </div>
    </main>
  )
}
