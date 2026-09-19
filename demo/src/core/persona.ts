import { DEFAULT_PERSONA_PRESET, type AppConfig, type PersonaPresetId } from './types'

/**
 * 专属采访者：语气归用户，协议归代码。
 *
 * 这是本模块唯一要守住的边界 —— 用户可以把「采访者是什么样的人」改到任意程度，
 * 但决定程序能不能跑的那些约定（行首的 [追问]/[换题]、一次只问一件事、
 * 不许编造）固定在提示词里，不跟着人设一起被改坏。
 *
 * 全部是纯函数，所以「到底把什么发给了模型」这件事可以直接单测。
 */

export interface PersonaPreset {
  id: Exclude<PersonaPresetId, 'custom'>
  label: string
  /** 一句话说明这套是什么口气，给用户挑的时候看 */
  blurb: string
  /** 选中后填进编辑框的原文；用户可以随意改 */
  prompt: string
}

export const PERSONA_PRESETS: PersonaPreset[] = [
  {
    id: 'warm',
    label: '温和朋友',
    blurb: '先接住你那句话，再往下问',
    prompt:
      '你是一个愿意把话听完的朋友，陪人做每周复盘。说话温和、不催促，常常先轻轻接一句对方刚说的内容，再问下一个问题。不评价、不说教，也不急着收尾。',
  },
  {
    id: 'crisp',
    label: '干脆利落',
    blurb: '不寒暄，直接问题目',
    prompt:
      '你是一个话不多的搭档，陪人做每周复盘。不寒暄、不客套、不捧场，直接问你想知道的；每句话尽量短，一次说完，对方答得含糊就点着含糊的地方问。',
  },
  {
    id: 'coach',
    label: '复盘教练',
    blurb: '把一件事拆开问清楚',
    prompt:
      '你是一个帮人把事看清楚的复盘教练。语气沉稳、有推进感，会顺着对方的话把一件事拆开来问（做了什么、卡在哪一步、后来结果怎么样），但不评价值得，也不说教。',
  },
  {
    id: 'playful',
    label: '轻松活泛',
    blurb: '气氛松一点，让人愿意多说',
    prompt:
      '你是一个嘴上没正形、但认真听人说话的朋友，陪人做每周复盘。说话轻松、带点玩笑，先把气氛放松下来，再顺着对方的话往下问。可以调侃，但不挖苦人。',
  },
]

/** 默认那套人设的原文（用户还没写过自己的） */
export function defaultPersonaPrompt(): string {
  return personaPreset(DEFAULT_PERSONA_PRESET)?.prompt ?? ''
}

export function personaPreset(id: PersonaPresetId): PersonaPreset | undefined {
  return PERSONA_PRESETS.find((p) => p.id === id)
}

export function isPersonaPresetId(value: unknown): value is PersonaPresetId {
  if (value === 'custom') return true
  return PERSONA_PRESETS.some((p) => p.id === value)
}

/** 这段提示词正好等于哪一套预设？都不是就算用户自己改过 */
export function matchPersonaPreset(prompt: string): PersonaPresetId {
  const text = prompt.trim()
  const hit = PERSONA_PRESETS.find((p) => p.prompt.trim() === text)
  return hit ? hit.id : 'custom'
}

/** 真正要发出去的那段人设：用户写了就用他的，没写就用默认预设 */
export function resolvePersonaPrompt(config: AppConfig): string {
  return config.persona?.prompt?.trim() || defaultPersonaPrompt()
}

/**
 * 程序必须守住的约定，附在人设之后。
 * 这些不是语气问题，改坏了要么流式界面闪出半个标记，要么整块内容被漏掉。
 */
const PROTOCOL_RULES = [
  '只输出你要说的那一句话，不要前缀、引号、解释，不要 markdown、不要 JSON。',
  '一次只问一件事，不要把几个问题堆在一句话里。',
  '只依据给出的对话记录，不要编造对方没说过的事。',
  '整段话不超过 120 字。',
]

const MARKER_RULE = '第一行必须**只写** [追问] 或 [换题] 这四个字符之一，第二行开始才是你要说的话。'

export interface SystemPromptOptions {
  /** 这一轮需不需要模型用行首标记表态 */
  marker: boolean
}

/** 人设 + 不可更改的约定，拼成 system prompt */
export function buildInterviewerSystem(
  personaPrompt: string,
  options: SystemPromptOptions,
): string {
  const rules = options.marker ? [...PROTOCOL_RULES, MARKER_RULE] : PROTOCOL_RULES
  const numbered = rules.map((rule, i) => `${i + 1}. ${rule}`).join('\n')

  return [
    personaPrompt.trim() || defaultPersonaPrompt(),
    '',
    '以下约定与上面的人设无关，必须遵守，人设里怎么写都不能违反：',
    numbered,
  ].join('\n')
}
