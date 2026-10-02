import type { Issue, Plan, Review } from './review'
import { normalizeKey } from './review'
import { normalize } from './mergeReview'

/**
 * 用户手动改一份复盘 —— 全是纯函数，返回新的 Review。
 *
 * 只有**清单**能改：做了什么、下周计划。判断类的几栏（一句话总结、
 * 问题与建议、上周对账、补漏提醒）是 AI 的分析结果，不给改 ——
 * 那些改起来也不会影响下一次复盘（模型每次都重算），改了反而让人以为留住了。
 */

export function setDid(review: Review, did: string[]): Review {
  return { ...review, did }
}

export function setPlan(review: Review, plan: Plan[]): Review {
  return { ...review, plan }
}

/** 新增一条计划；空文本不算 */
export function addPlan(review: Review, text: string, when = ''): Review {
  const clean = text.trim()
  if (!clean) return review
  return setPlan(review, [...review.plan, { text: clean, when: when.trim() }])
}

export function updatePlan(review: Review, index: number, patch: Partial<Plan>): Review {
  const next = review.plan.map((item, i) => (i === index ? { ...item, ...patch } : item))
  return setPlan(review, next)
}

export function removePlan(review: Review, index: number): Review {
  return setPlan(
    review,
    review.plan.filter((_, i) => i !== index),
  )
}

/**
 * 这一版比上一版**少掉了哪些条目** —— 逐栏比 did / plan / issues。
 *
 * 为什么要有它：重新复盘是拿最新的原文整份重来，模型很可能又把用户删掉的
 * 那条推出来。合并函数手里只有「用户现在这份」和「模型这份」，看不出少过
 * 什么，所以每次手改都先记一笔，交给 mergeReview 在追加之前拦掉。
 *
 * 问题那一栏**标签优先**（模型被要求同一个问题照抄上周的标签），没有标签
 * 才按文本认。返回的是归一化之后的条目，两个入参都不改动。
 */
export function droppedAfter(previous: Review, next: Review): string[] {
  const out: string[] = []
  const seen = new Set<string>()

  const push = (text: string): void => {
    const key = normalize(text)
    if (!key || seen.has(key)) return
    seen.add(key)
    out.push(key)
  }

  const nextDid = new Set(next.did.map(normalize))
  for (const item of previous.did) {
    const key = normalize(item)
    if (!key || nextDid.has(key)) continue
    push(key)
  }

  const nextPlan = new Set(next.plan.map((item) => normalize(item.text)))
  for (const item of previous.plan) {
    const key = normalize(item.text)
    if (!key || nextPlan.has(key)) continue
    push(key)
  }

  const nextIssues = new Set(next.issues.map(issueIdentity).filter(Boolean))
  for (const item of previous.issues) {
    const id = issueIdentity(item)
    if (!id || nextIssues.has(id)) continue
    push(id)
  }

  return out
}

/** 一条问题的身份：有标签就用标签，没有才用文本 */
function issueIdentity(issue: Issue): string {
  return normalizeKey(issue.key) || normalize(issue.text)
}

/**
 * 把这一次删掉的并进这一周已经记着的那些：去重，原来记着的原样留着。
 *
 * 手工改复盘的地方有两处（复盘页与总览页），两边都要往同一份 `dropped` 上累加 ——
 * 累加这一步只写一遍，省得哪天多一个入口就漏一处。
 */
export function mergeDropped(kept: string[], added: string[]): string[] {
  const seen = new Set(kept.map(normalize))
  const out = [...kept]
  for (const item of added) {
    const key = normalize(item)
    if (!key || seen.has(key)) continue
    seen.add(key)
    out.push(item)
  }
  return out
}
