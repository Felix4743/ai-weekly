/**
 * 「多久以前」的说法。
 *
 * 只按**流逝的时间**算，不按日历天：25 小时前就是「1 天前」，
 * 哪怕跨了两个日历日 —— 混着用会得到「昨天」和「1 天前」互相打架的结果，
 * 而这种自相矛盾在界面上看着像 bug。
 *
 * 纯函数，不认环境；`now` 显式传进来，所以边界能被钉死着测。
 */

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR
const WEEK = 7 * DAY
/** 一个月按 365/12 天算，这样 11、12 个月的边界不会互相打架 */
const MONTH = (365 * DAY) / 12
const YEAR = 365 * DAY

/**
 * 相对说法：刚刚 / 12 分钟前 / 3 小时前 / 3 天前 / 2 周前 / 1 个月前 / 1 年前。
 *
 * 时间戳在将来（系统时钟被改过、存档里混进脏数据）时返回「刚刚」，
 * 不当着用户的面说「-3 天前」；时间戳根本不是个数时返回空串，让调用方自己决定怎么兜。
 */
export function timeAgo(at: number, now: number = Date.now()): string {
  if (!Number.isFinite(at)) return ''
  const delta = now - at
  if (delta < MINUTE) return '刚刚'
  if (delta < HOUR) return `${Math.floor(delta / MINUTE)} 分钟前`
  if (delta < DAY) return `${Math.floor(delta / HOUR)} 小时前`
  if (delta < 2 * WEEK) return `${Math.floor(delta / DAY)} 天前`
  if (delta < 8 * WEEK) return `${Math.floor(delta / WEEK)} 周前`
  if (delta < YEAR) return `${Math.floor(delta / MONTH)} 个月前`
  return `${Math.floor(delta / YEAR)} 年前`
}

function pad(n: number): string {
  return n < 10 ? `0${n}` : String(n)
}

/** 具体到分钟的时刻：`9月26日 20:42`。给鼠标停上去看的那种地方用 */
export function stampText(at: number): string {
  if (!Number.isFinite(at)) return ''
  const date = new Date(at)
  return `${date.getMonth() + 1}月${date.getDate()}日 ${pad(date.getHours())}:${pad(date.getMinutes())}`
}
