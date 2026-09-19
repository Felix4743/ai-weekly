import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import electronPath from 'electron'

/**
 * 启动冒烟测试：真的把 Electron 拉起来，加载已经构建好的页面。
 *
 * 打包之后最容易翻车的从来不是业务逻辑（那部分有 200+ 个用例盯着），
 * 而是「窗口起来了、页面是白的」：路径不对、预加载没注入、渲染进程一上来就抛异常。
 * 这三件事只有真启动一次才知道 —— 这就是这个脚本存在的全部理由。
 *
 * 用一次性的 userData 目录，不会碰到你真实的配置与会话。
 */

const TIMEOUT_MS = 60_000
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

const child = spawn(electronPath, ['.'], {
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
  process.stdout.write('\n冒烟测试通过：应用能启动、页面能挂上、桥在。\n')
})
