import type { Issue, Plan, Reconcile, Review } from './review'
import { normalizeKey } from './review'

/**
 * 把「模型刚给的一份复盘」并进「用户手上那一份」。
 *
 * 为什么要有这一步：每一次重新复盘都是拿最新的原文整份重来，而用户
 * **可能已经手改过**——删掉某条、改了他的说法、补了一条。如果直接采用模型的新结果，
 * 这些手改会被悄悄冲掉（改一次丢一次，用户很快就会不敢改）。
 *
 * 规则分两类，和 0.8 那套「清单合并」是同一个思路：
 * - 清单（做了什么 / 下周计划 / 问题）：用户手上的为准，模型只能往里**加**新的
 * - 判断（一句话总结 / 补漏提醒 / 上周对账）：模型说了算 —— 那是它的分析结果，
 *   用户改的是「我的周是怎么过的」，不是「AI 怎么看这一周」
 *
 * 但「用户手上这份」本身就少掉了用户删过的东西，光看它分不出「用户删了」
 * 和「模型这次没提」——被删的那条只要模型再说一次就又回来了。所以调用方
 * 把「用户删过什么」（dropped，见 reviewEdit.droppedAfter）一起递进来，
 * 追加之前先按它把命中模型的条目滤掉。
 */

/** 归一化：去掉首尾空白、把连续空白压成一个空格、大小写不敏感 */
export function normalize(text: string): string {
  return text.trim().replace(/\s+/g, ' ').toLowerCase()
}

/** 保住 current 的顺序，把 incoming 里没出现过的追加到后面 */
export function mergeStrings(current: string[], incoming: string[]): string[] {
  const seen = new Set(current.map(normalize))
  const out = [...current]
  for (const item of incoming) {
    const text = item.trim()
    if (!text) continue
    const key = normalize(text)
    if (seen.has(key)) continue
    seen.add(key)
    out.push(text)
  }
  return out
}

function mergePlans(current: Plan[], incoming: Plan[]): Plan[] {
  const seen = new Set(current.map((p) => normalize(p.text)))
  const out = [...current]
  for (const item of incoming) {
    const text = item.text.trim()
    if (!text) continue
    const key = normalize(text)
    if (seen.has(key)) continue
    seen.add(key)
    out.push({ text, when: item.when.trim() })
  }
  return out
}

function mergeIssues(current: Issue[], incoming: Issue[]): Issue[] {
  const keys = new Set(current.map((i) => normalizeKey(i.key)).filter(Boolean))
  const texts = new Set(current.map((i) => normalize(i.text)))
  const out = [...current]
  for (const item of incoming) {
    const text = item.text.trim()
    if (!text) continue
    const key = normalizeKey(item.key)
    // 同一个标签、或者同一句话，都算已经在了
    if (key && keys.has(key)) continue
    if (texts.has(normalize(text))) continue
    if (key) keys.add(key)
    texts.add(normalize(text))
    out.push({ text, advice: [...item.advice], key: item.key.trim() })
  }
  return out
}

/** 判断项：模型给了就用模型的；模型这一栏空着，才留原来的 */
function preferIncoming<T>(current: T, incoming: T): T {
  if (typeof incoming === 'string') return (incoming.trim() ? incoming : current) as T
  if (Array.isArray(incoming)) return (incoming.length > 0 ? incoming : current) as T
  return incoming
}

/**
 * 这条模型给的问题，是不是用户删过的那一条？
 * 标签命中（去掉空白与标点之后）或者同一句话命中，都算 ——
 * 模型下次可能照抄了标签却换了说法，也可能反过来。
 */
function isDroppedIssue(drop: Set<string>, issue: Issue): boolean {
  const key = normalizeKey(issue.key)
  if (key && drop.has(key)) return true
  return drop.has(normalize(issue.text))
}

export function mergeReview(current: Review, fromModel: Review, dropped: string[] = []): Review {
  // 用户删过的条目（归一化后）。默认空数组：不传 dropped 的调用点行为一个字不变
  const drop = new Set(dropped.map(normalize).filter(Boolean))
  // 追加之前先滤掉模型这边命中 dropped 的条目；用户手上还留着的那些一律不动
  const did = fromModel.did.filter((text) => !drop.has(normalize(text)))
  const plan = fromModel.plan.filter((item) => !drop.has(normalize(item.text)))
  const issues = fromModel.issues.filter((issue) => !isDroppedIssue(drop, issue))
  return {
    headline: preferIncoming(current.headline, fromModel.headline),
    did: mergeStrings(current.did, did),
    issues: mergeIssues(current.issues, issues),
    reconcile: preferIncoming<Reconcile[]>(current.reconcile, fromModel.reconcile),
    plan: mergePlans(current.plan, plan),
    nudge: preferIncoming(current.nudge, fromModel.nudge),
  }
}
