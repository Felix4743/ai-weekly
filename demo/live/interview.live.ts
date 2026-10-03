import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { describeError } from '../src/core/aiError'
import type { ChatTransport } from '../src/core/chatTransport'
import { createInterview, isBlockComplete, nextStep, openBlock, setDepth, setStateDone } from '../src/core/interview'
import { createOpenAiClient } from '../src/core/openAiClient'
import { followUpCap, SCRIPT, TOTAL_MAIN_QUESTIONS } from '../src/core/script'
import {
  nextId,
  type AppConfig,
  type ChatMessage,
  type Dimension,
  type InterviewState,
} from '../src/core/types'
import { normalizeConfig } from '../src/storage/shape'
import { createBrowserTransport } from '../src/transport/browserTransport'

/**
 * 真模型试跑台（npm run try:model）
 *
 * 为什么要有它：两百多个用例证明的是「管道通畅」，没证明「模型问得像不像人话」。
 * 后者只能拿真 Key 跑一遍人类看。所以这个台子只做两件事：
 *
 *   1. 用脚本里的假用户回答，把一整场采访真的跑完（含追问），逐轮打出来
 *   2. 跑一次结果生成，把那份 JSON 原样打出来给人判
 *
 * 机械性质（有没有崩、标记认没认出来、四栏齐不齐）在这里断言；
 * 「问题问得对不对、那份热点值不值得看第二遍」留给人 —— 那才是生死线。
 *
 * 它刻意不混进 npm test：要联网、要花钱、还慢。见 vitest.live.config.ts。
 */

const APP_DATA = process.env.APPDATA ?? process.env.HOME ?? ''
const CONFIG_FILES = [
  join(APP_DATA, 'ai-weekly', 'config.json'),
  join(APP_DATA, 'AI周报', 'config.json'),
]

/** 用应用自己那一套归一化读配置，旧配置缺 persona 也不会炸 */
function loadAppConfig(): { config: AppConfig; from: string } | null {
  for (const file of CONFIG_FILES) {
    if (!existsSync(file)) continue
    try {
      const config = normalizeConfig(JSON.parse(readFileSync(file, 'utf8')))
      if (config?.apiKey.trim()) return { config, from: file }
    } catch {
      /* 坏文件跳过，试下一个 */
    }
  }
  return null
}

const found = loadAppConfig()

/**
 * 有细节可挖的假回答。
 *
 * 内容块刻意写满 8 条：第一版只有 4 条、用完了就重复最后一条，结果模型后半个区块
 * 一直在面对同一句话，behavior 读起来像复读机 —— 那是工具的锅，不是模型的。
 * 真实用户不会把同一句答案说八遍。「上周对账」是单题，给 6 条够走完。
 */
const ANSWERS: Record<Dimension, string[]> = {
  reconcile: [
    '上周说好的报价发出去了，但只发了初稿，对方还没回。',
    '要跟进的张总一直没约上，我总觉得自己还没准备好。',
    '上周定的整理数据没做完，卡在要从三个系统里导。',
    '说好早起运动，只坚持了两天就断了。',
    '本来要写的那份复盘一直拖着，这周还是没动笔。',
    '约小李吃饭吃成了，还聊出两个新想法。',
  ],
  event: [
    '主要在改客户那个方案，来回改了三版还没定，最花时间的是等对方拍板。',
    '本来想把这季度的数据整理一下，一直没腾出时间，卡在数据要从三个系统里导。',
    '有件小事比预想顺利：跟供应商谈价一次就谈下来了。',
    '周四临时插进来一个线上故障，盯了大半天，原来的计划全打乱了。',
    '给下季度做了一个排期表，第一次把三个人的活排在一张表上。',
    '有两个下午都在开评审会，本来以为一小时能完，结果每次都超。',
    '把去年那份产品文档翻出来重写了一遍，删掉了一半内容。',
    '本来答应帮同事看一份简历，一直拖到周五晚上才看。',
  ],
  people: [
    '跟老王对接最多，方案一直卡在他那儿没拍板。',
    '想约张总聊聊明年的方向，一直没敢开口，怕他觉得我越级。',
    '小李帮我顶了两天班，我请他吃了顿饭。',
    '跟财务沟通报销挺费劲，规则来回变，问了三遍才说清楚。',
    '跟产品那边吵了一架，为的是上线时间到底谁说了算。',
    '新来的实习生问了我挺多问题，我发现有些事自己也没想清楚。',
    '跟大学同学约了顿饭，聊到十一点，很久没那么放松了。',
    '我妈打了几次电话，我都说忙，回头想有点过意不去。',
  ],
  thing: [
    '买了个新键盘，纠结了半个月终于下单，手感确实好。',
    '把旧手机挂二手平台卖掉了，比预想多卖了两百。',
    '买了一年的健身卡，去了两次，感觉这钱花得不值。',
    '一直想买个显示器，还在犹豫，主要是桌面放不下。',
    '续了云盘的会员，其实上个月就没怎么用。',
    '把用不上的旧主机拆了，硬盘留下来当移动盘用。',
    '买了两本讲复盘的书，翻了几页就搁在床头了。',
    '给自己换了把好点的椅子，坐久了腰确实舒服些。',
  ],
  growth: [
    '看了一本讲定价的书，里面那个「按价值定价」的说法我用在这周的报价上了。',
    '跟小李吃饭聊到他们怎么带新人，回来我把我们组的交接流程改了一版。',
    '把这周的故障复盘写了一遍，才想明白真正的问题不在代码，在发布流程没人拦。',
    '听了一期播客讲时间管理，没什么新东西，但把我一直拖着的那件事说清楚了。',
    '跟老王吵完那一架，我发现我其实怕的不是他的意见，是怕自己做错。',
    '看了两篇同行的复盘文章，学到一个办法：先把「这周不该做的事」记下来。',
    '没什么特别的，就上面说的这些。',
  ],
}

/**
 * 试跑台固定用中度档：真实使用时这一步是用户点按钮挑的，这里固定住，
 * 追问上限和整场耗时才好横向比较。
 */
const LIVE_DEPTH = 'mid' as const

/**
 * 一个区块最多要回答多少轮：每道主问题都一路追到上限，再加上收尾那几轮。
 * 0.9.1 里最长的内容块（事情）有 6 道主问题，中度档每题最多 1 + 2 轮，
 * 所以按 SCRIPT 自己算出来，以后加题不用回来改这个数。
 */
const MAX_ANSWERS_PER_BLOCK =
  Math.max(...SCRIPT.map((b) => b.mainQuestions.length)) * (1 + followUpCap(LIVE_DEPTH)) + 2

type Marker = '追问' | '换题' | '换块' | '无标记'

interface Turn {
  dim: Dimension
  who: 'ai' | 'me'
  text: string
  marker?: Marker
  ms?: number
}

/** 模型到底有没有按约定在行首表态 —— 技术方案第九节第 2 条一直没验过 */
function markerOf(raw: string): Marker {
  const head = raw.trimStart().slice(0, 6)
  if (head.startsWith('[追问]')) return '追问'
  if (head.startsWith('[换题]')) return '换题'
  if (head.startsWith('[换块]')) return '换块'
  return '无标记'
}

function buildReport(input: {
  config: AppConfig
  configFrom: string
  turns: Turn[]
  result: Record<string, unknown>
  finishedAt: string
  error?: string
}): string {
  const { config, configFrom, turns, result, finishedAt, error } = input
  const aiTurns = turns.filter((t) => t.who === 'ai' && t.marker)
  const counted = aiTurns.map((t) => t.marker)
  const followed = counted.filter((m) => m !== '无标记').length
  const slowest = aiTurns.reduce((a, b) => ((b.ms ?? 0) > (a.ms ?? 0) ? b : a), aiTurns[0])
  const totalMs = aiTurns.reduce((n, t) => n + (t.ms ?? 0), 0)

  const lines: string[] = []
  lines.push('# 真模型试跑报告', '')
  lines.push(`- 跑完时间：${finishedAt}`)
  lines.push(`- 模型：\`${config.model}\` ｜ 接口：${config.baseUrl}`)
  lines.push(`- 配置来源：\`${configFrom}\`（Key 不落进这份报告）`)
  lines.push(`- 人设：${config.persona.prompt.trim() ? '用户自己写的' : '默认那套（温和朋友）'}`)
  lines.push('')
  lines.push('## 一、机械指标', '')
  lines.push(`- 主问题总数：${TOTAL_MAIN_QUESTIONS}`)
  lines.push(`- 模型发言轮数：${aiTurns.length}`)
  lines.push(
    `- **行首标记遵循率：${followed}/${aiTurns.length}**（${
      aiTurns.length ? Math.round((followed / aiTurns.length) * 100) : 0
    }%）；无标记 ${counted.filter((m) => m === '无标记').length} 轮`,
  )
  lines.push(
    `- 其中 [追问] ${counted.filter((m) => m === '追问').length} 轮，[换题] ${
      counted.filter((m) => m === '换题').length
    } 轮，[换块] ${counted.filter((m) => m === '换块').length} 轮`,
  )
  lines.push(
    `- 单轮耗时：平均 ${aiTurns.length ? Math.round(totalMs / aiTurns.length / 100) / 10 : 0}s，最慢 ${
      slowest ? Math.round((slowest.ms ?? 0) / 100) / 10 : 0
    }s`,
  )
  if (error) lines.push('', `> ⚠️ 中途出错：${error}`)
  lines.push('')
  lines.push('## 二、整场对话原文', '')

  let currentDim: Dimension | null = null
  for (const t of turns) {
    if (t.dim !== currentDim) {
      currentDim = t.dim
      const label = SCRIPT.find((d) => d.key === t.dim)?.label ?? t.dim
      lines.push('', `### 【${label}】`, '')
    }
    if (t.who === 'me') {
      lines.push(`**我**：${t.text}`, '')
    } else {
      const tag = t.marker ? `\`${t.marker}\` ` : ''
      const cost = t.ms ? `（${Math.round(t.ms / 100) / 10}s）` : ''
      lines.push(`**AI**：${tag}${t.text} ${cost}`, '')
    }
  }

  lines.push('', '## 三、生成的结果（原样 JSON）', '')
  lines.push('```json', JSON.stringify(result, null, 2), '```', '')
  lines.push('## 四、留给人判的（机器判不了）', '')
  lines.push('- [ ] 问题像不像人话？有没有哪句读起来像在念问卷')
  lines.push('- [ ] 追问有没有落在对方话里的细节上（时间、结果、卡点），而不是泛泛地「还有呢」')
  lines.push('- [ ] 该换题时换题了吗？还是逮着一个话题问到腻')
  lines.push('- [ ] **本周热点值不值得看第二遍**（产品文档第十一节：这是生死线）')
  lines.push('- [ ] 下周计划具体吗？还是「多沟通、提高效率」这种空话')
  lines.push('')
  return lines.join('\n')
}

describe('真模型试跑台', () => {
  it.runIf(!found)('没有可用的 Key 时，告诉人怎么配', () => {
    console.log(
      [
        '',
        '没找到带 API Key 的配置。任选一条：',
        '  1) 打开应用 → 设置 → 填 API Key（推荐，填完存在本机）',
        '  2) 直接写配置文件：',
        ...CONFIG_FILES.map((f) => `       ${f}`),
        '',
      ].join('\n'),
    )
    expect(found).toBeNull()
  })

  it.skipIf(!found)(
    '把一整场采访真的跑完，并生成结果',
    async () => {
      const { config, from } = found!
      const base = createBrowserTransport({ dev: false })

      /** 记下每次请求的原文与耗时：标记遵循率与延迟都从这里来 */
      const calls: { raw: string; ms: number }[] = []
      const transport: ChatTransport = {
        async send(req, onDelta) {
          const t0 = Date.now()
          const raw = await base.send(req, onDelta)
          calls.push({ raw, ms: Date.now() - t0 })
          return raw
        },
      }

      const ai = createOpenAiClient({ transport, config })
      const turns: Turn[] = []
      let state: InterviewState = createInterview()
      let history: ChatMessage[] = []
      let result: Record<string, unknown> = {}
      let failure: string | undefined

      const say = (role: 'ai' | 'me', text: string, dim: Dimension) => {
        history = [
          ...history,
          {
            id: nextId(role === 'ai' ? 'a' : 'u'),
            role: role === 'ai' ? 'ai' : 'user',
            text,
            dimension: dim,
            at: Date.now(),
          },
        ]
      }

      /**
       * 0.9.3 的流程：先交状态卡（分数由界面点出来，试跑台不点），再定档，
       * 然后才是「上周对账 → 事情 → 人际 → 物品与支出 → 成长」。
       */
      state = setStateDone(state)
      state = setDepth(state, LIVE_DEPTH)

      try {
        for (const block of SCRIPT) {
          state = openBlock(state, block.key)
          const dim = block.key
          const openingFrom = calls.length
          const opening = await ai.nextMessage(state, dim, history)
          turns.push({ dim, who: 'ai', text: opening, ms: calls[openingFrom]?.ms })
          say('ai', opening, dim)

          let answered = 0
          while (!isBlockComplete(state, dim) && answered < MAX_ANSWERS_PER_BLOCK) {
            const bank = ANSWERS[dim]
            // 用完了才绕回去。8 条一般够一整块聊完，但中度档下模型要是每题都追满，
            // 最长的块会绕回开头重样 —— 试跑台只求把流程真的走完，重样不影响判定。
            const answer = bank[answered % bank.length]
            turns.push({ dim, who: 'me', text: answer })
            say('me', answer, dim)

            const callFrom = calls.length
            const turn = await ai.reply(state, dim, history)
            const call = calls[callFrom]
            turns.push({
              dim,
              who: 'ai',
              text: turn.message,
              marker: markerOf(call?.raw ?? ''),
              ms: call?.ms,
            })
            state = nextStep(state, dim, turn.action)
            say('ai', turn.message, dim)
            answered += 1
          }
        }

        const r = await ai.summarize(history)
        result = r as unknown as Record<string, unknown>
      } catch (err) {
        failure = describeError(err)
      }

      const finishedAt = new Date().toLocaleString('zh-CN')
      const report = buildReport({ config, configFrom: from, turns, result, finishedAt, error: failure })

      const dir = join(process.cwd(), 'live-output')
      mkdirSync(dir, { recursive: true })
      const stamp = new Date().toISOString().replace(/[:.]/g, '-')
      const file = join(dir, `interview-${stamp}.md`)
      writeFileSync(file, report, 'utf8')

      const aiTurns = turns.filter((t) => t.who === 'ai' && t.marker)
      const unmarked = aiTurns.filter((t) => t.marker === '无标记').length
      console.log(
        [
          '',
          `跑完了：模型发言 ${aiTurns.length} 轮，无标记 ${unmarked} 轮`,
          `报告写到：${file}`,
          '',
        ].join('\n'),
      )

      // 只断言机械性质；质量留给人看报告
      expect(failure, `中途失败：${failure}`).toBeUndefined()
      expect(aiTurns.length).toBeGreaterThan(8)
      expect(Array.isArray(result.highlights)).toBe(true)
      expect((result.highlights as unknown[]).length).toBeGreaterThan(0)
      for (const d of SCRIPT) expect(isBlockComplete(state, d.key)).toBe(true)
    },
    900_000,
  )
})
