import { describe, expect, it } from 'vitest'
import {
  buildInterviewerSystem,
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

describe('专属采访者 · 改不掉的约定', () => {
  const withMarker = () => buildInterviewerSystem('你是一个测试人设。', { marker: true })
  const withoutMarker = () => buildInterviewerSystem('你是一个测试人设。', { marker: false })

  it('要标记的那几轮，三个标记和各自的意思都交代了', () => {
    const text = withMarker()
    expect(text).toContain('第一行必须')
    expect(text).toContain('[追问]')
    expect(text).toContain('[换题]')
    expect(text).toContain('[换块]')
    expect(text).toContain('第二行开始才是你要说的话')
  })

  it('不需要表态的那几轮，就不提标记这回事', () => {
    const text = withoutMarker()
    expect(text).not.toContain('[追问]')
    expect(text).not.toContain('[换块]')
    expect(text).not.toContain('第一行必须')
  })

  it('一次别把问题堆成长串，也不要 markdown 和 JSON', () => {
    const text = withoutMarker()
    expect(text).toContain('只输出你要说的那一句话')
    expect(text).toContain('可以问一到三个小问题')
    expect(text).toContain('不要堆成一长串')
    expect(text).toContain('不要列清单')
    expect(text).toContain('不要 markdown')
  })

  it('一个话题要问到复盘的效果为止，但不能原地打转', () => {
    const text = withoutMarker()
    expect(text).toContain('问到复盘的效果为止')
    expect(text).toContain('别在一个话题上原地打转')
  })

  it('采访阶段保持中立：不说教、不贴标签、不编造', () => {
    const text = withoutMarker()
    expect(text).toContain('不说教、不替对方下结论、不贴标签')
    expect(text).toContain('不要编造对方没说过的事')
  })

  it('整段话有长度上限', () => {
    expect(withoutMarker()).toContain('不超过 160 字')
  })

  it('约定一共四条并按序号排好，标记规则接在最后当第五条', () => {
    const plain = withoutMarker()
    expect(plain).toContain('1. ')
    expect(plain).toContain('4. ')
    expect(plain).not.toContain('5. ')

    const marked = withMarker()
    expect(marked).toContain('5. ')
    expect(marked.indexOf('5. ')).toBeGreaterThan(marked.indexOf('4. '))
  })

  it('约定排在整段 system 的最后，人设盖不住它', () => {
    const persona = '我是一个人设。'
    const text = buildInterviewerSystem(persona, { marker: false })
    expect(text.indexOf('必须遵守')).toBeGreaterThan(text.indexOf(persona))
  })
})
