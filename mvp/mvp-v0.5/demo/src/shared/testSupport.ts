/**
 * 测试里手写的最小 Response 替身。
 *
 * 用假响应而不是真网络，是为了能精确控制「数据包怎么切」—— 真实网络里
 * 一个汉字被切在两个 chunk 中间是必然会发生的，而这一刻最容易写错。
 * 放在 shared/ 里是因为浏览器传输层与主进程转发都要用它。
 */
export function fakeResponse(
  text: string,
  contentType: string,
  splitEvery = 4096,
  status = 200,
): Response {
  const bytes = new TextEncoder().encode(text)
  const size = Math.max(1, splitEvery)
  const chunks: Uint8Array[] = []
  for (let i = 0; i < bytes.length; i += size) chunks.push(bytes.slice(i, i + size))

  let at = 0
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: {
      get: (name: string) => (name.toLowerCase() === 'content-type' ? contentType : null),
    },
    body: {
      getReader: () => ({
        read: async () =>
          at < chunks.length ? { done: false, value: chunks[at++] } : { done: true, value: undefined },
      }),
    },
    text: async () => text,
  } as unknown as Response
}

/** 一条 SSE 事件（OpenAI 兼容的增量格式） */
export function sseEvent(text: string): string {
  return `data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\n`
}
