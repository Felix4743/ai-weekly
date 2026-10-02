import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { describeError } from '../src/core/aiError'
import type { AiClient, ReviewOutcome, ReviewRequest } from '../src/core/aiClient'
import type { ChatTransport } from '../src/core/chatTransport'
import { createOpenAiClient } from '../src/core/openAiClient'
import { isDegradedReview, type PreviousWeek } from '../src/core/review'
import { createDefaultConfig, type AppConfig } from '../src/core/types'
import { normalizeConfig } from '../src/storage/shape'
import { createBrowserTransport } from '../src/transport/browserTransport'

/**
 * 真模型试跑台（npm run try:model）
 *
 * 为什么要有它：单测证明的是「管道通畅」（解析、降级、配置校验），
 * 没证明「模型整理出来的五段像不像人话」。后者只能拿真 Key 跑一遍、人来判。
 *
 * 这里做的是新版本唯一的主流程：把一周的原文一口气喂进去（`analyze` 一次调用），
 * 把 headline / did / issues / reconcile / plan / nudge 六段逐段打出来。
 * 跑两遍：一遍不带上周（模拟第一次用），一遍带上周的行动项与问题标签
 * （模拟第二周，才看得到 reconcile 与 nudge 里「上周也在」这类判断）。
 *
 * 机械性质（有没有崩、五段齐不齐、是不是降级）在这里断言；
 * 「写没写到点上、建议能不能照着做」留给人看报告 —— 那才是生死线。
 *
 * 它刻意不混进 npm test：要联网、要花钱、还慢。见 vitest.live.config.ts。
 */

const APP_DATA = process.env.APPDATA ?? process.env.HOME ?? ''
const CONFIG_FILES = [
  join(APP_DATA, 'ai-weekly', 'config.json'),
  join(APP_DATA, 'AI周报', 'config.json'),
]

/**
 * 拿真配置，两条来源：
 *   1. 应用自己存的那份（在设置页填过 Key 就有），用同一套归一化读，坏文件跳过
 *   2. 环境变量 AI_WEEKLY_LIVE_API_KEY / BASE_URL / MODEL，方便临时换一个 Key 试
 * 环境变量优先，且只要给了 Key 就算找到，没给的就落回默认值。
 */
function loadLiveConfig(): { config: AppConfig; from: string } | null {
  const envKey = process.env.AI_WEEKLY_LIVE_API_KEY
  if (envKey?.trim()) {
    const fallback = createDefaultConfig()
    return {
      config: {
        apiKey: envKey.trim(),
        baseUrl: process.env.AI_WEEKLY_LIVE_BASE_URL?.trim() || fallback.baseUrl,
        model: process.env.AI_WEEKLY_LIVE_MODEL?.trim() || fallback.model,
      },
      from: '环境变量 AI_WEEKLY_LIVE_API_KEY',
    }
  }

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

const found = loadLiveConfig()

/** 一段像真用户会写的原文：口语、零散、三类混在一起 */
const WEEK_NOTES = [
  '这周基本都在改客户那个方案，来回改了三版还没定，最花时间的是等老王拍板。',
  '周二临时插进来一个线上故障，盯了大半天，原来的计划全打乱了。',
  '跟产品那边吵了一架，为的是上线时间到底谁说了算。',
  '睡眠不太好，平均睡六个多小时，早上起来还是困。',
  '周五下班去跑了五公里，跑完整个人轻快多了。',
  '想明白一件事：方案卡住不是能力问题，是我一直没把选项摆出来给对方选。',
  '下周一把报价单发给客户，周三前把线上故障的复盘写完。',
].join('\n')

/** 第二遍用的「上周」：一条该被认成做完了、一条该被认成没提、一个老问题 */
const LAST_WEEK: PreviousWeek = {
  week: '2026-09-14',
  weekText: '9月14日 – 9月20日',
  plan: [
    { text: '把方案发给客户', when: '周一' },
    { text: '预约体检', when: '' },
  ],
  issues: [{ text: '跟客户沟通一直没回音', key: '沟通' }],
}

const SECOND_WEEK = [
  '方案周一就发给老王了，他说周五给回复，结果还是拖着。',
  '这周基本都在等他回话，别的活也推进不下去。',
  '跟老王沟通还是费劲，问了三遍才说清要什么。',
  '这周没什么想说的了。',
].join('\n')

interface Call {
  /** 提示词里带没带上原文 —— 用来确认发出去的确实是这一版提示词 */
  hasNotes: boolean
  ms: number
  chars: number
}

/** 给真传输层加一层计时与留痕：不改变行为，只记录 */
function instrument(base: ChatTransport, calls: Call[], notes: string): ChatTransport {
  return {
    async send(req, onDelta) {
      const t0 = Date.now()
      const raw = await base.send(req, onDelta)
      calls.push({
        hasNotes: req.messages.some((m) => m.content.includes(notes.slice(0, 12))),
        ms: Date.now() - t0,
        chars: raw.length,
      })
      return raw
    },
  }
}

interface ReviewLike {
  headline: string
  did: string[]
  issues: { text: string; key: string; advice: string[] }[]
  reconcile: { text: string; state: string; note: string }[]
  plan: { text: string; when: string }[]
  nudge: string
}

function renderReview(label: string, outcome: ReviewOutcome | null, call: Call | undefined): string[] {
  const lines: string[] = []
  lines.push(`### ${label}`, '')

  if (!outcome) {
    lines.push('> ⚠️ 这一次调用没有成功返回，看下面「出错」一节。', '')
    return lines
  }

  const review = outcome.review as ReviewLike
  const degraded = isDegradedReview(outcome.review)
  lines.push(`- 耗时：${call ? Math.round(call.ms / 100) / 10 : '?'}s ｜ 模型回包：${call?.chars ?? 0} 字`)
  lines.push(`- 是不是降级的一份：${degraded ? '**是**（模型没给出能解析的 JSON）' : '不是'}`)
  lines.push('')
  lines.push(`**headline**：${review.headline}`, '')

  lines.push('**did**：')
  for (const item of review.did) lines.push(`- ${item}`)
  if (!review.did.length) lines.push('- （空）')
  lines.push('')

  lines.push('**issues**：')
  for (const issue of review.issues) {
    lines.push(`- [${issue.key}] ${issue.text}`)
    for (const advice of issue.advice) lines.push(`  - 建议：${advice}`)
  }
  if (!review.issues.length) lines.push('- （空）')
  lines.push('')

  lines.push('**reconcile**：')
  for (const row of review.reconcile) lines.push(`- \`${row.state}\` ${row.text} ${row.note ? `— ${row.note}` : ''}`)
  if (!review.reconcile.length) lines.push('- （空）')
  lines.push('')

  lines.push('**plan**：')
  for (const item of review.plan) lines.push(`- ${item.text}${item.when ? `（${item.when}）` : ''}`)
  if (!review.plan.length) lines.push('- （空）')
  lines.push('')

  lines.push('**nudge**：' + (review.nudge || '（空）'), '')
  lines.push('**reply**：' + (outcome.reply || '（空）'), '')
  return lines
}

function buildReport(input: {
  config: AppConfig
  configFrom: string
  firstWeek: ReviewOutcome | null
  secondWeek: ReviewOutcome | null
  calls: Call[]
  finishedAt: string
  error?: string
}): string {
  const { config, configFrom, firstWeek, secondWeek, calls, finishedAt, error } = input

  const lines: string[] = []
  lines.push('# 真模型试跑报告 · 复盘流程', '')
  lines.push(`- 跑完时间：${finishedAt}`)
  lines.push(`- 模型：\`${config.model}\` ｜ 接口：${config.baseUrl}`)
  lines.push(`- 配置来源：\`${configFrom}\`（Key 不落进这份报告）`)
  lines.push(`- 调用次数：${calls.length}`)
  lines.push(
    `- 单次耗时：平均 ${
      calls.length ? Math.round(calls.reduce((n, c) => n + c.ms, 0) / calls.length / 100) / 10 : 0
    }s ｜ 最慢 ${calls.length ? Math.round(Math.max(...calls.map((c) => c.ms)) / 100) / 10 : 0}s`,
  )
  if (error) lines.push('', `> ⚠️ 中途出错：${error}`)
  lines.push('')

  lines.push('## 一、第一次整理（不带上周）', '')
  lines.push('原文：', '', '```', WEEK_NOTES, '```', '')
  lines.push(...renderReview('结果', firstWeek, calls[0]))

  lines.push('## 二、第二周（带上周的行动项与问题标签）', '')
  lines.push('原文：', '', '```', SECOND_WEEK, '```', '')
  lines.push('', '上周给的行动项：')
  for (const item of LAST_WEEK.plan) lines.push(`- ${item.text}${item.when ? `（原本打算${item.when}）` : ''}`)
  lines.push(`- 上周的问题标签：${LAST_WEEK.issues.map((i) => i.key).join('、')}`, '')
  lines.push(...renderReview('结果', secondWeek, calls[1]))

  lines.push('## 三、留给人判的（机器判不了）', '')
  lines.push('- [ ] headline 是不是一句话说清了这一周？有没有写成口号')
  lines.push('- [ ] did 有没有替用户拔高，或者补了他没说过的事')
  lines.push('- [ ] issues 的建议是不是「明天就能做的一步」，而不是「要调整心态」')
  lines.push('- [ ] **reconcile 有没有认出来**：上周那两条，一条该是 done、一条该是 unmentioned')
  lines.push('- [ ] plan 是不是能一条条对着看（有 text、有 when），而不是「继续推进」')
  lines.push('- [ ] nudge 有没有补上他没写到的角度（人 / 钱 / 工作以外…），且只是一句提醒')
  lines.push('- [ ] 整段读下来像不像一个认真看过他原文的人，而不是模板填空')
  lines.push('')
  return lines.join('\n')
}

interface Case {
  notes: string
  previous: PreviousWeek | null
  isFollowUp: boolean
}

const CASES: Case[] = [
  {
    notes: WEEK_NOTES,
    previous: null,
    isFollowUp: false,
  },
  {
    notes: SECOND_WEEK,
    previous: LAST_WEEK,
    isFollowUp: false,
  },
]

describe('真模型试跑台 · 复盘流程', () => {
  it.runIf(!found)('没有可用的 Key 时，告诉人怎么配', () => {
    console.log(
      [
        '',
        '没找到带 API Key 的配置。任选一条：',
        '  1) 打开应用 → 设置 → 填 API Key（推荐，填完存在本机）',
        '  2) 直接写配置文件：',
        ...CONFIG_FILES.map((f) => `       ${f}`),
        '  3) 或者临时给环境变量：AI_WEEKLY_LIVE_API_KEY（可再加 _BASE_URL / _MODEL）',
        '',
      ].join('\n'),
    )
    expect(found).toBeNull()
  })

  it.skipIf(!found)(
    '把两周的原文各喂一次，把五段结果打出来给人看',
    async () => {
      const { config, from } = found!
      const base = createBrowserTransport({ dev: false })
      const calls: Call[] = []

      /** 跑一个用例：把这一周的原文喂进去，拿回五段结果（失败返回 null） */
      const runOnce = async (patch: Omit<ReviewRequest, 'weekText' | 'isFollowUp'>): Promise<ReviewOutcome | null> => {
        const request: ReviewRequest = {
          weekText: '9月21日 – 9月27日',
          isFollowUp: false,
          ...patch,
        }
        const ai: AiClient = createOpenAiClient({
          transport: instrument(base, calls, patch.notes),
          config,
        })
        try {
          return await ai.analyze(request)
        } catch (err) {
          console.log(`\n⚠️ 调用失败：${describeError(err)}\n`)
          return null
        }
      }

      const first = await runOnce({ week: '2026-09-21', notes: WEEK_NOTES, previous: null })
      const second = await runOnce({ week: '2026-09-28', notes: SECOND_WEEK, previous: LAST_WEEK })

      const finishedAt = new Date().toLocaleString('zh-CN')
      const report = buildReport({
        config,
        configFrom: from,
        firstWeek: first,
        secondWeek: second,
        calls,
        finishedAt,
      })

      const dir = join(process.cwd(), 'live-output')
      mkdirSync(dir, { recursive: true })
      const stamp = new Date().toISOString().replace(/[:.]/g, '-')
      const file = join(dir, `live-${stamp}.md`)
      writeFileSync(file, report, 'utf8')

      // 顺手把两段结果打在终端上，等 vitest 跑完就能直接看
      console.log(
        [
          '',
          ...renderReview('第一次整理', first, calls[0]),
          ...renderReview('第二周', second, calls[1]),
          `报告写到：${file}`,
          '',
        ].join('\n'),
      )

      // 只断言机械性质；质量留给人看报告
      for (const outcome of [first, second]) {
        expect(outcome).not.toBeNull()
        const review = outcome!.review as unknown as ReviewLike
        expect(typeof review.headline).toBe('string')
        expect(review.headline.length).toBeGreaterThan(0)
        expect(Array.isArray(review.did)).toBe(true)
        expect(Array.isArray(review.issues)).toBe(true)
        expect(Array.isArray(review.reconcile)).toBe(true)
        expect(Array.isArray(review.plan)).toBe(true)
        expect(typeof review.nudge).toBe('string')
      }
      // 两次调用都该带上原文，而且第二次要带上周信息才谈得上对账
      expect(calls).toHaveLength(CASES.length)
      expect(calls.every((c) => c.hasNotes)).toBe(true)
      const secondReview = second!.review as unknown as ReviewLike
      expect(secondReview.reconcile.length).toBeGreaterThanOrEqual(LAST_WEEK.plan.length)
    },
    900_000,
  )
})
