import { describe, expect, it } from 'vitest'
import { AiError } from './aiError'
import type { ReviewRequest } from './aiClient'
import type { ChatRequest, ChatTransport } from './chatTransport'
import { createOpenAiClient } from './openAiClient'
import { isDegradedReview } from './review'

/**
 * 真模型这一侧的读法测试。
 *
 * 这里不联网：`ChatTransport` 就是个接口，我们自己塞一个假的进去，
 * 于是「怎么发请求」「模型乱答时怎么办」「没配好配置时怎么办」都能当场复现。
 * 三条底线：请求要带全配置；模型乱来**不许抛**，只降级；配置没填**要抛**，且话说得能看懂。
 */

const CONFIG = {
  apiKey: 'sk-test',
  baseUrl: 'https://example.test/v1',
  model: 'test-model',
}

const NOTES = '这周主要在改客户方案。\n下周把报价单发出去。'

function req(patch: Partial<ReviewRequest> = {}): ReviewRequest {
  return {
    week: '2026-09-21',
    weekText: '9月21日 – 9月27日',
    notes: NOTES,
    previous: null,
    isFollowUp: false,
    ...patch,
  }
}

/** 一台假 transport：记下每次请求，按你给的脚本回答（或按你给的错炸掉） */
function fakeTransport(script: { raw?: string; fail?: Error } = {}) {
  const calls: ChatRequest[] = []
  const transport: ChatTransport = {
    send: async (request) => {
      calls.push(request)
      if (script.fail) throw script.fail
      return script.raw ?? ''
    },
  }
  return { calls, transport }
}

/** 模型正常回答时的样子 */
const GOOD_JSON = JSON.stringify({
  headline: '改稿占了主要精力，进度被卡住了。',
  did: ['改客户方案', '开了两次评审会'],
  issues: [{ text: '方案拖着没拍板', advice: ['先把两个选项写出来让客户选'], key: '拖延' }],
  reconcile: [],
  plan: [{ text: '把报价单发给客户', when: '下周' }],
  nudge: '没写钱，这周有花得值或者后悔的吗？',
  reply: '',
})

describe('真模型客户端 · 怎么发请求', () => {
  it('一条 system 加一条 user，带 json 与配置里的地址、Key、模型', async () => {
    const fake = fakeTransport({ raw: GOOD_JSON })
    const client = createOpenAiClient({ transport: fake.transport, config: CONFIG })

    await client.analyze(req())

    expect(fake.calls).toHaveLength(1)
    const call = fake.calls[0]
    expect(call.messages.map((m) => m.role)).toEqual(['system', 'user'])
    expect(call.messages[0].content).toContain('周复盘')
    expect(call.messages[1].content).toContain('这周主要在改客户方案')
    expect(call.json).toBe(true)
    expect(call.baseUrl).toBe(CONFIG.baseUrl)
    expect(call.apiKey).toBe(CONFIG.apiKey)
    expect(call.model).toBe(CONFIG.model)
  })

  it('留白也当没填：配置前后有空格照样能发出去', async () => {
    const fake = fakeTransport({ raw: GOOD_JSON })
    const client = createOpenAiClient({
      transport: fake.transport,
      config: { apiKey: '  sk-test  ', baseUrl: ' https://example.test/v1 ', model: ' test-model ' },
    })

    await client.analyze(req())

    expect(fake.calls[0].apiKey).toBe('sk-test')
    expect(fake.calls[0].baseUrl).toBe('https://example.test/v1')
    expect(fake.calls[0].model).toBe('test-model')
  })

  it('转发流式增量：模型吐一段就交一段出去', async () => {
    const seen: string[] = []
    const transport: ChatTransport = {
      send: async (_request, onDelta) => {
        onDelta?.('{"headline":"改稿')
        onDelta?.('占了主要精力。","did":[]}')
        return '{"headline":"改稿占了主要精力。","did":[]}'
      },
    }
    const client = createOpenAiClient({ transport, config: CONFIG })

    await client.analyze(req(), (delta) => seen.push(delta))

    expect(seen.join('')).toContain('改稿')
    expect(seen).toHaveLength(2)
  })
})

describe('真模型客户端 · 正常回答', () => {
  it('模型给了完整 JSON，就得到一份五段复盘', async () => {
    const fake = fakeTransport({ raw: GOOD_JSON })
    const client = createOpenAiClient({ transport: fake.transport, config: CONFIG })

    const { review, reply } = await client.analyze(req())

    expect(isDegradedReview(review)).toBe(false)
    expect(review.headline).toBe('改稿占了主要精力，进度被卡住了。')
    expect(review.did).toEqual(['改客户方案', '开了两次评审会'])
    expect(review.issues[0].key).toBe('拖延')
    expect(review.issues[0].advice).toEqual(['先把两个选项写出来让客户选'])
    expect(review.plan[0].when).toBe('下周')
    expect(reply).toBe('')
  })

  it('模型回了 reply 就原样带到结果里', async () => {
    const fake = fakeTransport({
      raw: JSON.stringify({ headline: '补完之后的样子。', reply: '好，把这段并进去了。' }),
    })
    const client = createOpenAiClient({ transport: fake.transport, config: CONFIG })

    const { review, reply } = await client.analyze(req({ isFollowUp: true }))

    expect(reply).toBe('好，把这段并进去了。')
    // reply 是外壳字段，不该混进五段正文里
    expect(review.headline).toBe('补完之后的样子。')
  })

  it('模型把 JSON 包在 ```json 围栏里也认得出', async () => {
    const fake = fakeTransport({ raw: '```json\n' + GOOD_JSON + '\n```' })
    const client = createOpenAiClient({ transport: fake.transport, config: CONFIG })

    const { review } = await client.analyze(req())

    expect(isDegradedReview(review)).toBe(false)
    expect(review.headline).toBe('改稿占了主要精力，进度被卡住了。')
  })

  it('JSON 前后有废话时，只挑中间那段', async () => {
    const fake = fakeTransport({
      raw: `好的，我先说明一下思路：\n${GOOD_JSON}\n希望这份复盘对你有帮助。`,
    })
    const client = createOpenAiClient({ transport: fake.transport, config: CONFIG })

    const { review } = await client.analyze(req())

    expect(isDegradedReview(review)).toBe(false)
    expect(review.did).toEqual(['改客户方案', '开了两次评审会'])
  })
})

describe('真模型客户端 · 模型乱答时不抛，只降级', () => {
  async function expectDegraded(raw: string) {
    const fake = fakeTransport({ raw })
    const client = createOpenAiClient({ transport: fake.transport, config: CONFIG })

    const { review } = await client.analyze(req())

    expect(isDegradedReview(review)).toBe(true)
    expect(review.headline.startsWith('这次没能整理成功：')).toBe(true)
    expect(review.headline.length).toBeGreaterThan('这次没能整理成功：'.length)
    expect(review.nudge).toContain('重新复盘')
    return review
  }

  it('回了空串时降级，还能再点一次重新复盘', async () => {
    await expectDegraded('')
  })

  it('回了坏 JSON 时降级', async () => {
    await expectDegraded('{"headline": "没写完就断了')
  })

  it('回了一大段没有 JSON 的话时降级', async () => {
    await expectDegraded('这周你挺不容易的，先歇一会儿吧。')
  })

  it('传输层说人话地失败了（断网、超时、401），就把那句人话交给界面', async () => {
    // 真实的两条传输层实现都会把网络失败包成 AiError 再往上抛
    // （见 browserTransport.ts:71「连不上接口地址…」、ipcTransport.ts:44），
    // 所以这里模拟的是它们真正的行为。
    const fake = fakeTransport({
      fail: new AiError('连不上接口地址，检查一下网络和「接口地址」填得对不对', 'fetch failed'),
    })
    const client = createOpenAiClient({ transport: fake.transport, config: CONFIG })

    await expect(client.analyze(req())).rejects.toThrow('连不上接口地址')
    expect(fake.calls).toHaveLength(1)
  })
})

describe('真模型客户端 · 配置没填就明说', () => {
  it('没填 API Key 时抛那句中文，也不去打扰网络', async () => {
    const fake = fakeTransport({ raw: GOOD_JSON })
    const client = createOpenAiClient({ transport: fake.transport, config: { ...CONFIG, apiKey: '   ' } })

    await expect(client.analyze(req())).rejects.toThrow('还没有填 API Key')
    expect(fake.calls).toHaveLength(0)
  })

  it('没填接口地址时抛那句中文', async () => {
    const fake = fakeTransport({ raw: GOOD_JSON })
    const client = createOpenAiClient({ transport: fake.transport, config: { ...CONFIG, baseUrl: '' } })

    await expect(client.analyze(req())).rejects.toThrow('还没有填接口地址')
    expect(fake.calls).toHaveLength(0)
  })

  it('没填模型名时抛那句中文', async () => {
    const fake = fakeTransport({ raw: GOOD_JSON })
    const client = createOpenAiClient({ transport: fake.transport, config: { ...CONFIG, model: '' } })

    await expect(client.analyze(req())).rejects.toThrow('还没有填模型名')
    expect(fake.calls).toHaveLength(0)
  })

  it('抛出来的是 AiError，界面才分得清「是配置问题」还是别的', async () => {
    const fake = fakeTransport({ raw: GOOD_JSON })
    const client = createOpenAiClient({ transport: fake.transport, config: { ...CONFIG, apiKey: '' } })

    await expect(client.analyze(req())).rejects.toBeInstanceOf(AiError)
  })
})
