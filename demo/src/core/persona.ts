import { DEFAULT_PERSONA_PRESET, type AppConfig, type PersonaPresetId } from './types'

/**
 * 专属采访者：语气归用户，协议归代码。
 *
 * 这是本模块唯一要守住的边界 —— 用户可以把「采访者是什么样的人」改到任意程度，
 * 但决定程序能不能跑的那些约定（行首的 [追问]/[换题]/[换块]、一次别堆太多问题、
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
 *
 * **0.9.5 改过一条**：原来第一条写的是「只输出你要说的那一句话……不要前缀解释」，
 * 于是模型只能一个接一个地抛问题，像在念表 —— 用户的原话是「问法还是太机械了」。
 * 现在反过来：**要求**先说一句接住对方的话，再往下问；上限从 160 字放到 200 字。
 * 该守的那条没变：不评价、不说教、不替他下结论、不给建议。
 */
const PROTOCOL_RULES = [
  '**先说一句接住他的话**：引他刚说过的词、点一个具体细节、或者顺着他的话往下半句，再问下一句 —— 像一个真在听的人，而不是一条一条念题目。可以问一到三个小问题，但别堆成一长串，不要列清单、不要小标题、不要 markdown、不要 JSON。',
  '整段话不超过 200 字：接话只要一句，别把它写成一段总结。',
  '要点表给的是**要了解到什么**，不是要你念的句子：每一句都用你自己的话问，别照抄锚点示例，也别一周又一周用同一句。',
  '一个话题可以问到复盘的效果为止（他讲清了当时的判断、卡点或结果）再往下走，但别在一个话题上原地打转。',
  '采访阶段保持中立：不说教、不替他下结论、不贴标签，也别急着给建议；只依据给出的对话记录，不要编造对方没说过的事。',
]

const MARKER_RULE =
  '第一行必须**只写**下面三个标记之一（一个中括号加两个字）：' +
  '[追问] = 顺着刚才那句话再问一点；[换题] = 这个话题聊清楚了、换个方向（换哪个方向由你定）；' +
  '[换块] = 这一块的要点都聊到了，可以进下一块 —— **用 [换块] 时必须在同一行报上你聊到的要点序号**，' +
  '写成 [换块] 覆盖:1,3 这样（序号按要点表里的编号，聊到哪个写哪个）。' +
  '第二行开始才是你要说的话，正文里不要出现这些标记。'

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
