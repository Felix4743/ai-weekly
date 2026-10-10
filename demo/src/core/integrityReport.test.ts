import { describe, expect, it } from 'vitest'
import {
  integrityFixCommand,
  isIntegritySafe,
  parseIntegrityLevel,
  summarizeIntegrity,
  type IntegrityProbe,
} from './integrityReport'

/**
 * 这些用例的样本**是从出事的那台机器上原样抄下来的 `icacls` 输出**，
 * 不是编的 —— 因为这一层的全部价值就在于「认得出真实输出长什么样」。
 * 一旦 icacls 的格式或本地化变了，这里应该最先红。
 */

/** 真实样本：工作区里的文件，继承到 `Medium Mandatory Level:(I)(NW)` */
const OUTPUT_MEDIUM = [
  'D:\\1ai\\1Project\\ai周报\\mvp\\ai-weekly\\AI周报.exe S-1-4-800813876-404608862:(I)(W,D,DC)',
  '                                            S-1-4-200158995-56063296:(I)(W,D,DC)',
  '                                            NT AUTHORITY\\Authenticated Users:(I)(F)',
  '                                            NT AUTHORITY\\SYSTEM:(I)(F)',
  '                                            BUILTIN\\Administrators:(I)(F)',
  '                                            BUILTIN\\Users:(I)(F)',
  '                                            Mandatory Label\\Medium Mandatory Level:(I)(NW)',
  '',
  'Successfully processed 1 files; Failed processing 0 files',
].join('\n')

/** 真实样本：出事时的工作区根目录 —— Low 标签 + DSH 打的那条 Everyone 拒绝 */
const OUTPUT_LOW = [
  'D:\\1ai\\1Project\\ai周报 Everyone:(CI)(DENY)(DC)',
  '                                Mandatory Label\\Low Mandatory Level:(OI)(CI)(NW)',
  '',
  'Successfully processed 1 files; Failed processing 0 files',
].join('\n')

/** 真实样本：工作区**外**的目录，一条 Mandatory Label 都没有 */
const OUTPUT_NO_LABEL = [
  'D:\\1ai\\1Project S-1-4-200158995-56063296:(OI)(CI)(W,D,DC)',
  '                NT AUTHORITY\\Authenticated Users:(I)(OI)(CI)(F)',
  '                NT AUTHORITY\\SYSTEM:(I)(OI)(CI)(F)',
  '                BUILTIN\\Administrators:(I)(OI)(CI)(F)',
  '                BUILTIN\\Users:(I)(OI)(CI)(F)',
  '',
  'Successfully processed 1 files; Failed processing 0 files',
].join('\n')

/**
 * 真实样本：路径不存在时 icacls 的输出。
 * 注意它**照样有正文**，所以光看文本会误判成「无标签 = 安全」——
 * 这就是为什么调用方必须另外认退出码（这个样本实测 exit=3）。
 */
const OUTPUT_MISSING = [
  'Successfully processed 0 files; Failed processing 1 files',
  'D:\\__不存在__\\x.exe: The system cannot find the path specified.',
].join('\n')

describe('完整性标签 · 读得懂真实 icacls 输出', () => {
  it('认得 Medium（正常状态）', () => {
    expect(parseIntegrityLevel(OUTPUT_MEDIUM)).toBe('Medium')
  })

  it('认得 Low（出事状态）', () => {
    expect(parseIntegrityLevel(OUTPUT_LOW)).toBe('Low')
  })

  it('一条 Mandatory Label 都没有 = 无标签，不是「不认识」', () => {
    expect(parseIntegrityLevel(OUTPUT_NO_LABEL)).toBe('None')
  })

  it('输出为空 = 没测出来，而不是「无标签」', () => {
    // 空输出只可能是命令没跑成（比如 shell 挂了、路径没传对）
    expect(parseIntegrityLevel('')).toBeNull()
    expect(parseIntegrityLevel('   \n  ')).toBeNull()
    expect(parseIntegrityLevel(undefined as unknown as string)).toBeNull()
  })

  it('中文系统上的本地化标签名也认', () => {
    expect(parseIntegrityLevel('强制标签\\低强制级别:(OI)(CI)(NW)')).toBe('Low')
    expect(parseIntegrityLevel('强制标签\\中强制级别:(I)(NW)')).toBe('Medium')
    expect(parseIntegrityLevel('强制标签\\不受信任的强制级别')).toBe('Untrusted')
  })

  it('拿到的如果是 SDDL，就按 SID 认', () => {
    expect(parseIntegrityLevel('Mandatory Label\\S-1-16-4096')).toBe('Low')
    expect(parseIntegrityLevel('S-1-16-8192')).toBe('Medium')
    expect(parseIntegrityLevel('S-1-16-0')).toBe('Untrusted')
  })

  it('路径里带 Low 字样不会被当成标签', () => {
    // 只有 `Mandatory Label\...` 后面那一段才算，路径里的字不算
    expect(parseIntegrityLevel('D:\\Low\\workspace BUILTIN\\Users:(I)(F)')).toBe('None')
  })

  it('认不出来的级别名宁可报「没测出来」，也不要悄悄放行', () => {
    expect(parseIntegrityLevel('Mandatory Label\\Weird Mandatory Level:(I)(NW)')).toBeNull()
  })

  it('窗口里两个标签同时出现时，取第一个（icacls 只会印一条，但这层不该崩）', () => {
    expect(parseIntegrityLevel(`${OUTPUT_LOW}\n${OUTPUT_MEDIUM}`)).toBe('Low')
  })
})

describe('完整性标签 · 安不安全', () => {
  it('Low 与 Untrusted 不安全 —— 它们开不了 Chromium 沙箱', () => {
    expect(isIntegritySafe('Low')).toBe(false)
    expect(isIntegritySafe('Untrusted')).toBe(false)
  })

  it('Medium / High / System / 无标签都安全', () => {
    expect(isIntegritySafe('Medium')).toBe(true)
    expect(isIntegritySafe('High')).toBe(true)
    expect(isIntegritySafe('System')).toBe(true)
    expect(isIntegritySafe('None')).toBe(true)
  })

  it('没测出来**不算**安全 —— 否则探测失败会被读成「一切正常」', () => {
    expect(isIntegritySafe(null)).toBe(false)
  })
})

function probe(label: string, level: IntegrityProbe['level']): IntegrityProbe {
  return { label, path: `D:\\1ai\\1Project\\ai周报\\${label}`, level }
}

const ROOT = 'D:\\1ai\\1Project\\ai周报'

describe('完整性标签 · 汇总与结论', () => {
  it('全部 Medium = ok，不给修复命令', () => {
    const s = summarizeIntegrity([probe('仓库根目录', 'Medium'), probe('AI周报.exe', 'Medium')], ROOT)
    expect(s.status).toBe('ok')
    expect(s.broken).toEqual([])
    expect(s.unknown).toEqual([])
    expect(s.lines.join('\n')).not.toContain('icacls')
  })

  it('出现 Low = broken，并且把带 Low 的那几条都点出来（不只是一条）', () => {
    const s = summarizeIntegrity(
      [probe('仓库根目录', 'Low'), probe('AI周报.exe', 'Medium'), probe('electron.exe', 'Low')],
      ROOT,
    )
    expect(s.status).toBe('broken')
    expect(s.broken.map((p) => p.label)).toEqual(['仓库根目录', 'electron.exe'])
    expect(s.lines.some((l) => l.includes('Low'))).toBe(true)
  })

  it('broken 的结论里带上修一条就好的命令', () => {
    const s = summarizeIntegrity([probe('仓库根目录', 'Low')], ROOT)
    expect(s.fixCommand).toBe(integrityFixCommand(ROOT))
    expect(s.lines).toContain(`  ${s.fixCommand}`)
    expect(s.fixCommand).toContain('/setintegritylevel "(OI)(CI)Medium" /T /C /Q')
  })

  it('只有「没测出来」时是 unknown，不是 ok 也不是 broken', () => {
    const s = summarizeIntegrity([probe('仓库根目录', 'Medium'), probe('AI周报.exe', null)], ROOT)
    expect(s.status).toBe('unknown')
    expect(s.unknown.map((p) => p.label)).toEqual(['AI周报.exe'])
    expect(s.broken).toEqual([])
    expect(s.lines.some((l) => l.startsWith('?'))).toBe(true)
  })

  it('broken 优先于 unknown —— 已经抓到问题就别再说「资料不足」', () => {
    const s = summarizeIntegrity([probe('仓库根目录', 'Low'), probe('AI周报.exe', null)], ROOT)
    expect(s.status).toBe('broken')
  })

  it('每条路径都有一行，长度和输入一致', () => {
    const probes = [probe('仓库根目录', 'Medium'), probe('AI周报.exe', 'Low'), probe('electron.exe', null)]
    const s = summarizeIntegrity(probes, ROOT)
    expect(s.lines.slice(0, 3)).toHaveLength(3)
    expect(s.lines[1]).toContain('就是它')
    expect(s.lines[0].startsWith('✓')).toBe(true)
    expect(s.lines[2].startsWith('?')).toBe(true)
  })

  it('空输入不崩，也不会误报成 ok 之外的结论', () => {
    const s = summarizeIntegrity([], ROOT)
    expect(s.status).toBe('ok')
    expect(s.lines).toEqual([])
  })
})

describe('完整性标签 · 不存在的路径这个坑', () => {
  it('路径不存在时 icacls 的正文会被读成「无标签」，所以调用方必须另认退出码', () => {
    // 记下这个陷阱：这一层的文本解析**没有能力**区分「无标签」和「没这个文件」。
    // demo\scripts\check-integrity.mjs 里是靠 existsSync + 退出码挡住的。
    expect(parseIntegrityLevel(OUTPUT_MISSING)).toBe('None')
    expect(isIntegritySafe(parseIntegrityLevel(OUTPUT_MISSING))).toBe(true)
  })
})

describe('完整性标签 · 修复命令', () => {
  it('路径带空格也安全，且只改标签不动权限', () => {
    const cmd = integrityFixCommand('D:\\含 空格 的\\工作区')
    expect(cmd).toBe('icacls "D:\\含 空格 的\\工作区" /setintegritylevel "(OI)(CI)Medium" /T /C /Q')
  })
})
