import type { AiClient, DeltaHandler, TurnResult } from './aiClient'
import { AiError } from './aiError'
import type { ChatMessagePayload, ChatTransport } from './chatTransport'
import { blockProgress, currentQuestion, nextStep } from './interview'
import { degradedResult, parseResultSafe } from './parseResult'
import {
  buildClosingPrompt,
  buildOpeningPrompt,
  buildRefinePrompt,
  buildSummarizePrompt,
  buildTurnPrompt,
} from './prompts'
import { mergeRefined } from './refineMerge'
import { MAX_FOLLOWUPS_PER_QUESTION } from './script'
import { parseTurnReply, stripMarkerForDisplay } from './turn'
import type { AppConfig, ChatMessage, Dimension, InterviewState, WeeklyResult } from './types'

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

export function createOpenAiClient({ transport, config }: OpenAiClientOptions): AiClient {
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
    ): Promise<string> {
      const progress = blockProgress(state, dim)
      const messages = progress.complete
        ? buildClosingPrompt(state, dim)
        : buildOpeningPrompt(state, dim, history)

      if (messages.length === 0) return ''

      const raw = await send(messages, false, onDelta)
      const text = stripMarkerForDisplay(raw, true)
      if (text) return text

      // 模型什么都没说也不能让界面空着：退回脚本里的问题
      return progress.complete ? EMPTY_BLOCK_TAIL : currentQuestion(state, dim) || EMPTY_BLOCK_TAIL
    },

    async reply(
      state: InterviewState,
      dim: Dimension,
      history: ChatMessage[],
      onDelta?: DeltaHandler,
    ): Promise<TurnResult> {
      const messages = buildTurnPrompt(state, dim, history)
      if (messages.length === 0) return { wantsFollowUp: false, message: '' }

      const raw = await send(messages, false, onDelta)
      const parsed = parseTurnReply(raw)

      // 状态机才是追问次数的最终裁判：模型说要追问、但次数已经到顶时按换题处理，
      // 否则「下一句话」和「新状态」会对不上。
      const wantsFollowUp =
        parsed.wantsFollowUp &&
        blockProgress(state, dim).followUpCount < MAX_FOLLOWUPS_PER_QUESTION

      let message = parsed.message
      if (!message) {
        const advanced = nextStep(state, dim, wantsFollowUp)
        message = currentQuestion(advanced, dim) || EMPTY_BLOCK_TAIL
      }

      return { wantsFollowUp, message }
    },

    async summarize(history: ChatMessage[]): Promise<WeeklyResult> {
      const raw = await send(buildSummarizePrompt(history), true)
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
