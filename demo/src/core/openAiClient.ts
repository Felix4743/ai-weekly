import type { AiClient, DeltaHandler, TurnResult } from './aiClient'
import { AiError } from './aiError'
import type { ChatMessagePayload, ChatTransport } from './chatTransport'
import { blockProgress, currentPoint, nextStep } from './interview'
import { degradedResult, parseResultSafe } from './parseResult'
import { resolvePersonaPrompt } from './persona'
import {
  buildClosingPrompt,
  buildOpeningPrompt,
  buildRefinePrompt,
  buildSummarizePrompt,
  buildTurnPrompt,
} from './prompts'
import { mergeRefined } from './refineMerge'
import { followUpCap, spoken } from './script'
import { parseTurnReply, stripMarkerForDisplay } from './turn'
import type {
  AppConfig,
  ChatMessage,
  Dimension,
  InterviewContext,
  InterviewState,
  TurnAction,
  WeeklyResult,
} from './types'

/**
 * 真实模型实现（OpenAI 兼容 /chat/completions）。
 *
 * 这里只做三件事：拼提示词、收流、把结果规整成项目内部的结构。
 * 所有网络细节都在 ChatTransport 后面，所以这份代码在浏览器和 Electron 里完全一样。
 */
export interface OpenAiClientOptions {
  transport: ChatTransport
  config: AppConfig
}

const EMPTY_BLOCK_TAIL = '这一块先到这儿。'

/** 自由聊时模型什么都没说，也别让界面空着 */
const EMPTY_FREE_TAIL = '嗯，还有呢？'

export function createOpenAiClient({ transport, config }: OpenAiClientOptions): AiClient {
  /** 用户自己定的采访者人设；没写过就用默认那套 */
  const persona = resolvePersonaPrompt(config)

  const send = (
    messages: ChatMessagePayload[],
    json: boolean,
    onDelta?: DeltaHandler,
  ): Promise<string> => {
    const baseUrl = config.baseUrl.trim()
    const apiKey = config.apiKey.trim()
    const model = config.model.trim()

    if (!apiKey) throw new AiError('还没有填 API Key')
    if (!baseUrl) throw new AiError('还没有填接口地址')
    if (!model) throw new AiError('还没有填模型名')

    return transport.send({ baseUrl, apiKey, model, messages, json }, onDelta)
  }

  return {
    async nextMessage(
      state: InterviewState,
      dim: Dimension,
      history: ChatMessage[],
      onDelta?: DeltaHandler,
      ctx?: InterviewContext,
    ): Promise<string> {
      const progress = blockProgress(state, dim)
      const messages = progress.complete
        ? buildClosingPrompt(state, dim, persona)
        : buildOpeningPrompt(state, dim, history, persona, ctx)

      if (messages.length === 0) return ''

      const raw = await send(messages, false, onDelta)
      const text = stripMarkerForDisplay(raw, true)
      if (text) return text

      // 模型什么都没说也不能让界面空着：退回那个还没聊到的要点的锚点问法
      return progress.complete
        ? EMPTY_BLOCK_TAIL
        : spoken(currentPoint(state, dim)) || EMPTY_BLOCK_TAIL
    },

    async reply(
      state: InterviewState,
      dim: Dimension,
      history: ChatMessage[],
      onDelta?: DeltaHandler,
    ): Promise<TurnResult> {
      const messages = buildTurnPrompt(state, dim, history, persona)
      if (messages.length === 0) return { action: 'next', message: '' }

      const raw = await send(messages, false, onDelta)
      const parsed = parseTurnReply(raw)

      const progress = blockProgress(state, dim)

      // 状态机才是追问次数的最终裁判：模型说要追问、但次数已经到顶时按换题处理，
      // 否则「下一句话」和「新状态」会对不上。自由聊没有要点要聊，不受这个上限约束。
      const action: TurnAction =
        !progress.complete && parsed.action === 'followup' && progress.followUpCount >= followUpCap(state.depth)
          ? 'next'
          : parsed.action

      let message = parsed.message
      if (!message) {
        // 自由聊时要点都聊完了，只能给一句中性的搭话
        if (progress.complete) message = EMPTY_FREE_TAIL
        else {
          // 退回「还没聊到的那个要点」的锚点问法（状态机不在这里推进，覆盖由 App 决定）
          const advanced = nextStep(state, dim, action, { covered: parsed.covered })
          message = spoken(currentPoint(advanced, dim)) || EMPTY_BLOCK_TAIL
        }
      }

      return { action, message, covered: parsed.covered }
    },

    async summarize(
      history: ChatMessage[],
      ctx?: InterviewContext,
    ): Promise<WeeklyResult> {
      const raw = await send(buildSummarizePrompt(history, ctx), true)
      const outcome = parseResultSafe(raw)
      // 文档要求：解析层必须带容错与降级，不允许崩溃
      return outcome.error ? degradedResult(outcome.error) : outcome.result
    },

    async refine(
      history: ChatMessage[],
      current: WeeklyResult,
      note: string,
    ): Promise<WeeklyResult> {
      const raw = await send(buildRefinePrompt(history, current, note), true)
      const outcome = parseResultSafe(raw)
      if (outcome.error) {
        throw new AiError('模型这次没能返回可解析的结果，请再试一次', outcome.error)
      }
      // 用户手改过的清单在这里被原样保住
      return mergeRefined(current, outcome.result)
    },
  }
}
