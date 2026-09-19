import { describe, expect, it } from 'vitest'
import {
  defaultPersonaPrompt,
  isPersonaPresetId,
  matchPersonaPreset,
  personaPreset,
  PERSONA_PRESETS,
  resolvePersonaPrompt,
} from './persona'
import { createDefaultConfig, type AppConfig } from './types'

describe('专属采访者 · 预设', () => {
  it('四套预设都有名字、说明和可直接发出的提示词', () => {
    expect(PERSONA_PRESETS).toHaveLength(4)
    for (const preset of PERSONA_PRESETS) {
      expect(preset.label.trim().length).toBeGreaterThan(0)
      expect(preset.blurb.trim().length).toBeGreaterThan(0)
      expect(preset.prompt.trim().length).toBeGreaterThan(10)
    }
  })

  it('预设的 id 不重复，且都能按 id 取回来', () => {
    const ids = PERSONA_PRESETS.map((p) => p.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const id of ids) expect(personaPreset(id)?.id).toBe(id)
  })

  it('默认那套能取到原文，不会是空的', () => {
    expect(defaultPersonaPrompt().length).toBeGreaterThan(10)
  })
})

describe('专属采访者 · 用户自己改的那一份', () => {
  const config = (prompt: string): AppConfig => ({
    ...createDefaultConfig(),
    persona: { prompt, preset: 'custom' },
  })

  it('用户写了就用用户的', () => {
    expect(resolvePersonaPrompt(config('像老同事，讲话短，不爱客套。'))).toBe(
      '像老同事，讲话短，不爱客套。',
    )
  })

  it('没写、只写了空格，都退回默认预设', () => {
    expect(resolvePersonaPrompt(config(''))).toBe(defaultPersonaPrompt())
    expect(resolvePersonaPrompt(config('   \n '))).toBe(defaultPersonaPrompt())
  })

  it('配置是旧版本、压根没有这一项时也不炸', () => {
    const legacy = { apiKey: 'sk-x', baseUrl: 'https://x/v1', model: 'm' } as AppConfig
    expect(resolvePersonaPrompt(legacy)).toBe(defaultPersonaPrompt())
  })
})

describe('专属采访者 · 认得出这是哪一套', () => {
  it('原封不动的预设文案认得出来', () => {
    for (const preset of PERSONA_PRESETS) {
      expect(matchPersonaPreset(preset.prompt)).toBe(preset.id)
    }
  })

  it('改过一个字就算自己改过的，不会再假装是某套预设', () => {
    const fromPreset = `${PERSONA_PRESETS[0].prompt}多问一句细节。`
    expect(matchPersonaPreset(fromPreset)).toBe('custom')
    expect(matchPersonaPreset('')).toBe('custom')
  })

  it('只有已知的预设 id 才算数', () => {
    expect(isPersonaPresetId('warm')).toBe(true)
    expect(isPersonaPresetId('custom')).toBe(true)
    expect(isPersonaPresetId('gpt-5')).toBe(false)
    expect(isPersonaPresetId(undefined)).toBe(false)
  })
})
