import { spawn } from 'node:child_process'
import { mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import electronPath from 'electron'

/**
 * 启动冒烟测试：真的把应用拉起来，看它是不是真的起来了。
 *
 * 打包之后最容易翻车的从来不是业务逻辑（那部分有 200+ 个用例盯着），
 * 而是「窗口起来了、页面是白的」：路径不对、预加载没注入、渲染进程一上来就抛异常。
 * 这三件事只有真启动一次才知道 —— 这就是这个脚本存在的全部理由。
 * （第一次跑就抓到了一个真问题：vite 默认输出绝对路径，loadFile 下全 404。）
 *
 * 两种用法：
 *   node scripts/smoke.mjs             跑源码（用 node_modules 里的 Electron）
 *   node scripts/smoke.mjs --packaged  跑 release/win-unpacked 里打好的那个 exe
 *
 * 两种都用一次性的 userData 目录，不会碰到你真实的配置与会话。
 */

const PACKAGED = process.argv.includes('--packaged')
const TIMEOUT_MS = 60_000
const PROJECT_DIR = process.cwd()
const UNPACKED_DIR = join(PROJECT_DIR, 'release', 'win-unpacked')

/** 打包目录里那个应用程序本体：排除掉 NSIS 自带的 elevate.exe */
function findPackagedExe() {
  try {
    const exe = readdirSync(UNPACKED_DIR).find(
      (f) => f.toLowerCase().endsWith('.exe') && f.toLowerCase() !== 'elevate.exe',
    )
    return exe ? join(UNPACKED_DIR, exe) : null
  } catch {
    return null
  }
}

const command = PACKAGED ? findPackagedExe() : electronPath
if (!command) {
  process.stderr.write(
    `找不到打包产物。先跑 npm run dist，再来验证：${UNPACKED_DIR}\n`,
  )
  process.exit(1)
}

const userData = mkdtempSync(join(tmpdir(), 'ai-weekly-smoke-'))

const env = { ...process.env }
/**
 * 必须清掉这个变量。
 *
 * 它一旦被继承，electron.exe 会以「纯 Node」模式启动：不会开窗口，
 * `require('electron')` 也只会拿到 npm 包导出的那个路径字符串，
 * 于是 main.cjs 一上来就在 app.setPath 上炸掉，而报错看起来像代码写错了。
 * 从 Node 脚本里拉起 Electron 时都要清一次（有的环境里它默认就带着）。
 */
delete env.ELECTRON_RUN_AS_NODE
env.AI_WEEKLY_SMOKE = '1'
env.AI_WEEKLY_USER_DATA = userData
env.ELECTRON_DISABLE_SECURITY_WARNINGS = '1'

const child = spawn(command, PACKAGED ? [] : ['.'], {
  stdio: ['ignore', 'pipe', 'pipe'],
  env,
})

let out = ''
let err = ''
child.stdout.on('data', (b) => {
  out += String(b)
  process.stdout.write(b)
})
child.stderr.on('data', (b) => {
  err += String(b)
})

const timer = setTimeout(() => {
  child.kill()
}, TIMEOUT_MS)

child.on('close', (code) => {
  clearTimeout(timer)
  rmSync(userData, { recursive: true, force: true })

  const ok = code === 0 && out.includes('SMOKE OK')
  if (!ok) {
    process.stderr.write(`\n冒烟测试失败（退出码 ${code}）\n`)
    if (err.trim()) process.stderr.write(`stderr:\n${err.trim()}\n`)
    process.exit(1)
  }
  process.stdout.write(
    `\n冒烟测试通过（${PACKAGED ? '打包产物' : '源码'}）：窗口起来了、页面挂上了、桥在、` +
      '配置真的落到了文件、走 IPC 的请求失败也给了人话。\n',
  )
})
