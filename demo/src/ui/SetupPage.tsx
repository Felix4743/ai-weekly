import { useState } from 'react'
import {
  defaultPersonaPrompt,
  matchPersonaPreset,
  personaPreset,
  PERSONA_PRESETS,
} from '../core/persona'
import { createDefaultConfig, type AppConfig, type PersonaPresetId } from '../core/types'
import { loadSession } from '../storage/localStore'
import { IconBack, IconChart, IconCheck, IconRefresh, IconSparkle } from './icons'

interface Props {
  config: AppConfig
  /** 已经有一场采访在进行：这时进来改设置，不该把他的对话清掉 */
  ongoing: boolean
  onSubmit: (config: AppConfig) => void
  onRestore: () => void
  onBackToChat: () => void
}

export function SetupPage({ config, ongoing, onSubmit, onRestore, onBackToChat }: Props) {
  const [draft, setDraft] = useState<AppConfig>(config)
  const [problem, setProblem] = useState<string | null>(null)
  const hasSession = loadSession() !== null

  // 填了 Key 就是真模型；留空则用内置的模拟 AI，什么都不配也能先走一遍
  const live = draft.apiKey.trim().length > 0

  // 还没自己写过就用默认那套，编辑框里看到的和真正发出去的始终是同一段
  const personaPrompt = draft.persona.prompt.trim() ? draft.persona.prompt : defaultPersonaPrompt()
  const activePreset = matchPersonaPreset(personaPrompt)

  const update = (patch: Partial<AppConfig>) => {
    setProblem(null)
    setDraft((prev) => ({ ...prev, ...patch }))
  }

  const setPersonaPrompt = (text: string) =>
    update({ persona: { prompt: text, preset: matchPersonaPreset(text) } })

  const pickPreset = (id: PersonaPresetId) => {
    const preset = personaPreset(id)
    if (preset) update({ persona: { prompt: preset.prompt, preset: preset.id } })
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

    const persona = draft.persona.prompt.trim()
    setProblem(null)
    onSubmit({
      apiKey: draft.apiKey.trim(),
      baseUrl,
      model,
      persona: { prompt: persona, preset: matchPersonaPreset(persona) },
    })
  }

  return (
    <main className="page setup">
      <div className="setup-card">
        <h1 className="setup-title">{ongoing ? '设置' : '开始之前'}</h1>
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

        <h2 className="setup-section-title">模型接口</h2>
        <p className="setup-section-desc">
          填了就用真实模型，不填就一直是演示模式。这三项只存在本机，随时能回来改。
        </p>

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

        <section className="persona">
          <h2 className="persona-title">你的专属采访者</h2>
          <p className="persona-desc">
            下面这段话决定 AI 用什么口气跟你说话。挑一套当起点，然后随便改 ——
            改成什么样都行，改完立刻生效，随时可以回来再改。
          </p>

          <div className="persona-presets">
            {PERSONA_PRESETS.map((preset) => (
              <button
                key={preset.id}
                type="button"
                className={`persona-preset${activePreset === preset.id ? ' active' : ''}`}
                aria-pressed={activePreset === preset.id}
                onClick={() => pickPreset(preset.id)}
              >
                <span className="persona-preset-label">{preset.label}</span>
                <span className="persona-preset-blurb">{preset.blurb}</span>
                {activePreset === preset.id && <IconCheck className="preset-check" size={15} />}
              </button>
            ))}
          </div>

          <textarea
            className="persona-prompt"
            rows={5}
            value={personaPrompt}
            aria-label="采访者人设提示词"
            onChange={(e) => setPersonaPrompt(e.target.value)}
          />

          <div className="persona-actions">
            <button
              type="button"
              className="link-btn"
              onClick={() => setPersonaPrompt(defaultPersonaPrompt())}
            >
              恢复成默认那套
            </button>
            <span className="persona-note">
              {activePreset === 'custom' ? '这段已经是你自己改过的了 · ' : ''}
              一次只问一件事、行首标记这些技术约定固定在里面，不受这段话影响
              {live ? '' : '；演示模式下不生效'}
            </span>
          </div>
        </section>

        {problem && <p className="field-problem">{problem}</p>}

        <div className="setup-actions">
          <button className="btn primary" type="button" onClick={submit}>
            {ongoing ? (
              <>
                <IconCheck />
                保存设置，回到对话
              </>
            ) : (
              <>
                <IconSparkle />
                开始梳理这一周
              </>
            )}
          </button>
          {ongoing && (
            <button className="btn ghost" type="button" onClick={onBackToChat}>
              <IconBack />
              不保存，返回
            </button>
          )}
          {!ongoing && (
            <button
              className="btn ghost"
              type="button"
              onClick={() => {
                setProblem(null)
                setDraft(createDefaultConfig())
              }}
            >
              <IconRefresh />
              恢复默认
            </button>
          )}
          {hasSession && !ongoing && (
            <button className="btn ghost" type="button" onClick={onRestore}>
              <IconChart />
              查看上次的结果
            </button>
          )}
        </div>
      </div>
    </main>
  )
}
