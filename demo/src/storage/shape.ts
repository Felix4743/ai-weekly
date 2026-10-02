import { createDefaultConfig, type AppConfig } from '../core/types'
import { ARCHIVE_LIMIT, sortEntries, type WeekEntry } from '../core/archive'
import { toStringList } from '../core/coerce'
import { isWeekKey } from '../core/week'
import { coerceResult, legacyToReview } from '../core/legacy'
import { normalize } from '../core/mergeReview'
import { coerceReview, isReviewEmpty, type Review } from '../core/review'

/**
 * 存储的「形状」与校验。
 *
 * localStorage 与主进程 JSON 文件是两条通路，但「读出来的是什么、坏了怎么兜」
 * 必须是同一套规则 —— 否则同一个文件在两边会解析出不同结果。这里只做纯数据的
 * 归一化，不碰任何环境 API，所以能直接单测。
 */

/** 所有存储实现共同的接口：配置一份、周归档一份，没有别的 */
export interface AppStore {
  loadConfig(): AppConfig | null
  saveConfig(config: AppConfig): void
  /** 按周归档，新的在前 */
  loadArchive(): WeekEntry[]
  saveArchive(list: WeekEntry[]): void
}

/** 缺字段的配置补上默认值；整块不是对象就当没配过 */
export function normalizeConfig(raw: unknown): AppConfig | null {
  if (!raw || typeof raw !== 'object') return null
  const parsed = raw as Partial<AppConfig>
  const base = createDefaultConfig()
  return {
    apiKey: typeof parsed.apiKey === 'string' ? parsed.apiKey : base.apiKey,
    baseUrl: typeof parsed.baseUrl === 'string' ? parsed.baseUrl : base.baseUrl,
    model: typeof parsed.model === 'string' ? parsed.model : base.model,
  }
}

/**
 * 把一条存下来的记录里的复盘读出来。
 *
 * 三条路，按新旧顺序试：0.9.0 的 `review`、0.8 的 `result`（那份采访出来的
 * WeeklyResult，转成新式样）、都没有就是「还没复盘」。
 */
function readReview(raw: unknown): Review | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const obj = raw as Record<string, unknown>
  // 空复盘（比如一个 `{}`）等于「还没复盘」，不能就此打住 —— 旁边可能还有旧版的 result 等着兜底
  const direct = coerceReview(obj.review)
  if (direct && !isReviewEmpty(direct)) return direct
  const legacy = coerceResult(obj.result)
  if (legacy) {
    const converted = legacyToReview(legacy)
    return isReviewEmpty(converted) ? null : converted
  }
  return null
}

/**
 * 读「用户删过哪些条目」。
 *
 * 复用 coerce 里那套字符串列表读法（去掉空白项、读不出来的项丢掉），再按
 * 归一化去重。整个字段坏掉（不是列表）时当没有 —— 但**绝不因此丢整条记录**：
 * 那一周的原文和复盘都还是好的。
 */
function readDropped(raw: unknown): string[] {
  if (!Array.isArray(raw)) return []
  const seen = new Set<string>()
  const out: string[] = []
  for (const text of toStringList(raw)) {
    const key = normalize(text)
    if (seen.has(key)) continue
    seen.add(key)
    out.push(text)
  }
  return out
}

/**
 * 周归档：坏掉的条目**逐条丢掉**，而不是整份丢掉。
 *
 * 和配置不一样 —— 配置是一份、坏一份等于没有；归档是一串，
 * 里面有一周写坏了不该连累另外几十周。丢掉的条目会在下一次写入时自然消失。
 */
export function normalizeArchive(raw: unknown): WeekEntry[] {
  if (!Array.isArray(raw)) return []
  const out: WeekEntry[] = []
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const parsed = item as Partial<WeekEntry>
    if (!isWeekKey(parsed.week)) continue
    const notes = typeof parsed.notes === 'string' ? parsed.notes : ''
    const review = readReview(item)
    const dropped = readDropped(parsed.dropped)
    // 没写原文、也没复盘：那是误点留下的一格空日历，不留
    if (!notes.trim() && !review) continue
    out.push({
      week: parsed.week,
      // 不是个正常的数字（缺了、NaN、Infinity）就当下现在写的 —— 排序与「上次记录」都靠它
      savedAt: Number.isFinite(parsed.savedAt) ? (parsed.savedAt as number) : Date.now(),
      notes,
      review,
      // 没删过东西的记录不带这个字段，存量存档的形状不变
      ...(dropped.length > 0 ? { dropped } : {}),
    })
  }
  // 同一周出现两条时留最后一条（文件被手工编辑过才会这样）
  const byWeek = new Map<string, WeekEntry>()
  for (const item of out) byWeek.set(item.week, item)
  return sortEntries([...byWeek.values()]).slice(0, ARCHIVE_LIMIT)
}
