/**
 * 从模型返回的那坨文本里，把需要的东西抠出来。
 *
 * 单独抽出来是因为有两处要干同一件事：新的复盘 JSON（review.ts）和
 * 旧版归档里的四栏结果（legacy.ts）。模型给的东西从来不会完全听话 ——
 * 多一层 markdown 围栏、把数组写成一句话、该是字符串的地方给了个对象 ——
 * 这里的原则一律是**尽量认出来，认不出来就跳过这一条**，绝不往外抛。
 */

/** 去掉 ```json 这种围栏；模型很爱加，加了也不算错 */
export function stripFences(raw: string): string {
  const trimmed = raw.trim()
  const matched = /^```[a-zA-Z]*\s*\n([\s\S]*?)\n?```$/.exec(trimmed)
  return matched ? matched[1].trim() : trimmed
}

/** 从一段文本里截出第一个 `{` 到最后一个 `}` —— 前后多几句客套话也能救回来 */
export function sliceJsonObject(raw: string): string | null {
  const start = raw.indexOf('{')
  const end = raw.lastIndexOf('}')
  if (start === -1 || end === -1 || end <= start) return null
  return raw.slice(start, end + 1)
}

export interface JsonOutcome {
  value: unknown
  error?: string
}

/** 把一段模型输出当 JSON 读；永远不会抛 */
export function parseJsonObject(raw: string): JsonOutcome {
  const text = stripFences(raw)
  if (!text) return { value: null, error: '模型返回了空内容' }
  const sliced = sliceJsonObject(text)
  if (!sliced) return { value: null, error: '模型返回的内容里没有认出 JSON' }
  try {
    return { value: JSON.parse(sliced) as unknown }
  } catch {
    return { value: null, error: '模型返回的 JSON 没能解析出来' }
  }
}

/**
 * 取一句话。字符串直接用；数字、布尔转成文字；对象则试着从
 * text / name / title 里取 —— 模型把 `{"text": "..."}` 摆在该放字符串的地方是常事。
 */
export function readString(value: unknown): string {
  if (typeof value === 'string') return value.trim()
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const o = value as Record<string, unknown>
    for (const key of ['text', 'name', 'title', 'value']) {
      const inner = o[key]
      if (typeof inner === 'string') return inner.trim()
    }
  }
  return ''
}

/** 取一组字符串；单个字符串也认（模型偶尔会给一条而不是一列） */
export function toStringList(value: unknown): string[] {
  const items = Array.isArray(value) ? value : value === undefined || value === null ? [] : [value]
  const out: string[] = []
  for (const item of items) {
    const text = readString(item)
    if (text) out.push(text)
  }
  return out
}

/** 对象数组：只留下读得出内容的对象（拿不到内容时退回空数组） */
export function toObjectList(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) return []
  return value.filter(
    (item): item is Record<string, unknown> =>
      !!item && typeof item === 'object' && !Array.isArray(item),
  )
}

/**
 * 在若干个候选键里取第一个**有内容**的值（英文键优先，中文键兜底）。
 *
 * null / undefined / 空串都算「这个键没给东西」：模型把 `headline` 摆成 null、
 * 内容写在 `summary` 里时，不能因为 headline 这个键存在就把后面的兜底键全挡掉
 * —— 那会把本来认得出的内容丢成一句空话。数组与对象不算空（空数组、空对象也
 * 照旧命中，那是不是算有内容是调用方自己的判断）。
 */
export function pick(raw: Record<string, unknown>, keys: string[]): unknown {
  for (const key of keys) {
    if (!(key in raw)) continue
    const value = raw[key]
    if (value === null || value === undefined || value === '') continue
    return value
  }
  return undefined
}
