import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { build } from 'esbuild'

/**
 * 工作区体检：`AI周报` 双击打不开的那种情况，一条命令查出来。查两件事。
 *
 * 之一，完整性标签为什么会打不开：
 * DSH 的 `workspace-write` 沙箱会给工作区目录打一个**可继承的 Low 完整性标签**
 * （`Mandatory Label\Low Mandatory Level:(OI)(CI)(NW)`），而且**会话结束后不回滚**。
 * 之后工作区里每个 `.exe` 都以 Low 完整性启动，Chromium 在沙箱初始化阶段
 * 直接 CHECK 失败 —— 退出码 `0x80000003`、日志零字节、看起来完全像文件损坏。
 * 这个坑在 2026-10 真的踩过一次，排查花掉的时间远超写这个脚本。
 *
 * 之二，装机版有没有落在工作区里 —— 2026-10-10 它整份（76 个文件 / 373 MB）落在
 * 仓库根目录待过一次，既被上面那个标签波及，又随时可能被 `git add` 进版本库。
 * 所以这里除了量标签，还要点名根目录里那些 Electron 运行时的伴生文件。
 *
 * 判定逻辑全在 `src/core/integrityReport.ts`（纯函数，有用例），
 * 这里只负责「跑 icacls / 读目录 → 喂给它 → 打印结论」。用 esbuild 现打包一次，
 * 免得把那份逻辑在这里抄第二遍。
 */

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(here, '..', '..')

/**
 * 装机版现在住在工作区**外面**（`D:\AI周报\`），故意的：
 * 工作区目录会被 DSH 打上可继承的 Low 标签，装机版搬出去就永远波及不到。
 * 换过位置就设环境变量 `AI_WEEKLY_INSTALL_DIR`。
 */
const installDir = process.env.AI_WEEKLY_INSTALL_DIR ?? 'D:\\AI周报'

/* ---------- 现打包纯函数那层，然后 import ---------- */

const scratch = mkdtempSync(join(tmpdir(), 'ai-weekly-integrity-'))
const bundlePath = join(scratch, 'integrityReport.mjs')

try {
  await build({
    entryPoints: [join(here, '..', 'src', 'core', 'integrityReport.ts')],
    outfile: bundlePath,
    bundle: true,
    platform: 'node',
    target: 'node20',
    format: 'esm',
    logLevel: 'silent',
  })

  const { findStrayInstallArtifacts, parseIntegrityLevel, summarizeIntegrity } = await import(
    pathToFileURL(bundlePath).href
  )

  /* ---------- 查这三条就够：根目录带了可继承标签，底下就全带了 ---------- */

  const targets = [
    { label: '仓库根目录', path: repoRoot },
    { label: 'electron.exe（dev）', path: join(repoRoot, 'demo', 'node_modules', 'electron', 'dist', 'electron.exe') },
    { label: 'AI周报.exe（装机）', path: join(installDir, 'AI周报.exe') },
  ]

  const probes = []
  const skipped = []

  for (const target of targets) {
    if (!existsSync(target.path)) {
      skipped.push(target.label)
      continue
    }
    try {
      const out = execFileSync('icacls', [target.path], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
      probes.push({ label: target.label, path: target.path, level: parseIntegrityLevel(out) })
    } catch {
      // icacls 非零退出（路径不存在、权限不够）都走这里 —— 一律算「没测出来」，不当作通过
      probes.push({ label: target.label, path: target.path, level: null })
    }
  }

  const summary = summarizeIntegrity(probes, repoRoot)

  /**
   * 另一件要查的事：装机版不许落在工作区里。
   *
   * 判名字是纯函数（有用例），这里只负责把根目录读出来 —— 和上面 `icacls` 的分工一样。
   * 它落在工作区里是双重事故：会被 Low 标签波及（打不开），几百 MB 又随时可能进版本库。
   */
  const stray = findStrayInstallArtifacts(readdirSync(repoRoot))

  console.log('')
  for (const line of summary.lines) console.log(`  ${line}`)
  if (skipped.length > 0) {
    console.log('')
    console.log(`  （跳过 ${skipped.join('、')} —— 文件不存在，先 npm install / 先打包）`)
  }
  if (stray.length > 0) {
    console.log('')
    console.log(`  ✗  装机版落在工作区里了：${stray.join('、')}`)
    console.log(`     它该住在工作区外（这里按 ${installDir}）。整份挪出去，不要只加 .gitignore：`)
    console.log('')
    console.log(`       Move-Item -LiteralPath <上面那些> -Destination "${installDir}"`)
    console.log('')
    console.log('     装在工作区里它会被 Low 标签波及而打不开，而且几百 MB 的运行时随时可能')
    console.log('     被提交进版本库。')
  }
  console.log('')

  if (summary.status === 'ok' && stray.length === 0) {
    console.log(`✓ 工作区正常：${probes.length} 条路径不会被 Low 标签坑，根目录也没有装机版`)
    process.exit(0)
  }

  process.exit(1)
} finally {
  rmSync(scratch, { recursive: true, force: true })
}
