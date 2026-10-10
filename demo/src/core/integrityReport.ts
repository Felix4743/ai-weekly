/**
 * 「工作区里的 Electron 为什么打不开」的判定逻辑。纯函数，不认环境。
 *
 * 背景是 2026-10 台机器上真实踩过的一次：
 * DSH 的 `workspace-write` 沙箱会给工作区目录打一个**可继承的 Low 完整性标签**
 * （`Mandatory Label\Low Mandatory Level:(OI)(CI)(NW)`），而它**在会话结束后不会回滚**——
 * DSH 自己的 README 写着「常驻 Low 标签的生命期长于 DSH……工作区的可继承标签在会话结束后依然存在」。
 *
 * 后果：工作区里每一个 `.exe` 都以 Low 完整性启动，Chromium 在沙箱初始化阶段发现
 * 「浏览器进程已经不高于 Low」就直接 CHECK 失败，退出码 `0x80000003`（STATUS_BREAKPOINT），
 * `--enable-logging` 一行日志都没有——看起来完全像文件损坏。
 * 而同一个二进制复制到工作区外（哪怕路径全中文）就一切正常。
 *
 * 这一层只做一件事：把 `icacls` 的**文本输出**翻译成「这条路安不安全」。
 * 这样 `npm run check:integrity` 和它的用例都不需要真的去改 ACL。
 */

/**
 * 强制完整性级别。
 * `None` = icacls 跑成功了、但这条路径没有显式标签（走系统默认，等同于安全）。
 */
export type IntegrityLevel = 'Untrusted' | 'Low' | 'Medium' | 'High' | 'System' | 'None'

/** 不高于 Low 的进程开不了 Chromium 沙箱，`--no-sandbox` 除外 */
const UNSAFE_LEVELS: ReadonlySet<IntegrityLevel> = new Set<IntegrityLevel>(['Untrusted', 'Low'])

/** icacls 印的是名字；万一拿到的是 SDDL（`S-1-16-4096` 这种），也认 */
const SID_LEVELS: Record<string, IntegrityLevel> = {
  's-1-16-0': 'Untrusted',
  's-1-16-4096': 'Low',
  's-1-16-8192': 'Medium',
  's-1-16-12288': 'High',
  's-1-16-16384': 'System',
}

/** 英文 `Mandatory Label\Low Mandatory Level`；中文系统上是 `强制标签\低强制级别` */
const NAME_LEVELS: Record<string, IntegrityLevel> = {
  untrusted: 'Untrusted',
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  system: 'System',
  不受信任: 'Untrusted',
  不受信任的: 'Untrusted',
  低: 'Low',
  中: 'Medium',
  高: 'High',
  系统: 'System',
}

const EN_LABEL = /Mandatory Label\\([^:\\]+?)Mandatory Level/i
const ZH_LABEL = /强制标签\\([^:\\]+?)强制级别/
const SID_LABEL = /S-1-16-\d+/i

/**
 * 从一段 `icacls` 输出里读出完整性级别。
 *
 * 返回 `null` 表示**没测出来**（输出为空 = 命令根本没跑成），调用方不该把它当成通过；
 * 返回 `'None'` 表示命令跑成了、只是这条路径没有显式标签。
 * 认不出来的标签名也返回 `null`——宁可报「没测出来」，也不要悄悄放过一条可疑的路径。
 */
export function parseIntegrityLevel(icaclsOutput: string): IntegrityLevel | null {
  const text = typeof icaclsOutput === 'string' ? icaclsOutput : ''
  if (text.trim() === '') return null

  const en = EN_LABEL.exec(text)
  if (en) return NAME_LEVELS[en[1].trim().toLowerCase()] ?? null

  const zh = ZH_LABEL.exec(text)
  if (zh) return NAME_LEVELS[zh[1].trim()] ?? null

  // SDDL 形式只会在名字解析不出来时出现，所以放在最后
  const sid = SID_LABEL.exec(text)
  if (sid) return SID_LEVELS[sid[0].toLowerCase()] ?? null

  return 'None'
}

/** 这个级别能不能让 Chromium 沙箱正常起来；`null`（没测出来）不算安全 */
export function isIntegritySafe(level: IntegrityLevel | null): boolean {
  if (level === null) return false
  return !UNSAFE_LEVELS.has(level)
}

/** 一条待查的路径 */
export interface IntegrityProbe {
  /** 给人看的名字，比如 `仓库根目录` */
  label: string
  path: string
  /** `null` = 没测出来（命令没跑成 / 文件不存在） */
  level: IntegrityLevel | null
}

export type IntegrityStatus = 'ok' | 'broken' | 'unknown'

export interface IntegritySummary {
  status: IntegrityStatus
  /** 带 Low / Untrusted 标签的，就是它们在坑 Electron */
  broken: IntegrityProbe[]
  /** 没测出来的，需要人看一眼 */
  unknown: IntegrityProbe[]
  /** 修一条命令就能好的那个命令 */
  fixCommand: string
  /** 直接给终端用的一行行文本 */
  lines: string[]
}

const LEVEL_TEXT: Record<IntegrityLevel, string> = {
  Untrusted: 'Untrusted（不受信任）',
  Low: 'Low（低）',
  Medium: 'Medium（中）',
  High: 'High（高）',
  System: 'System（系统）',
  None: '无标签（走系统默认）',
}

/**
 * 把所有路径的标签提回 Medium。
 * 只改标签、不动 ACL，所以不用担心把权限改坏；1.7 万个文件约 7 秒。
 */
export function integrityFixCommand(workspaceRoot: string): string {
  return `icacls "${workspaceRoot}" /setintegritylevel "(OI)(CI)Medium" /T /C /Q`
}

function renderLine(probe: IntegrityProbe): string {
  const pad = probe.label.padEnd(22, ' ')
  if (probe.level === null) return `?  ${pad}没测出来（命令没跑成，或者文件不存在）`
  if (isIntegritySafe(probe.level)) return `✓  ${pad}${LEVEL_TEXT[probe.level]}`
  return `✗  ${pad}${LEVEL_TEXT[probe.level]}  ← 就是它，Electron 会在这里崩`
}

/** 把一组探测结果收成「能不能开」+「怎么修」 */
export function summarizeIntegrity(
  probes: IntegrityProbe[],
  workspaceRoot: string,
): IntegritySummary {
  const broken = probes.filter((probe) => !isIntegritySafe(probe.level) && probe.level !== null)
  const unknown = probes.filter((probe) => probe.level === null)
  const status: IntegrityStatus = broken.length > 0 ? 'broken' : unknown.length > 0 ? 'unknown' : 'ok'
  const fixCommand = integrityFixCommand(workspaceRoot)

  const lines = probes.map(renderLine)
  if (status === 'broken') {
    lines.push('')
    lines.push('工作区被打了 Low 完整性标签 —— 里面的 .exe 都以 Low 启动，Chromium 沙箱会直接自杀。')
    lines.push('跑这一条修好（约 7 秒，只改标签不动权限）：')
    lines.push('')
    lines.push(`  ${fixCommand}`)
  } else if (status === 'unknown') {
    lines.push('')
    lines.push('有路径没测出来，先确认它存在，再重新跑一次。')
  }

  return { status, broken, unknown, fixCommand, lines }
}
