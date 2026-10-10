import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import electronPath from 'electron'

/**
 * 内存体检：真的把应用拉起来，问它现在占了多少、页面上挂了多少东西。
 *
 * 为什么单独有这么个脚本：0.9.4 之前这个应用空闲就要 296 MB 工作集，
 * 而它只是个一问一答的文本工具。要优化就得先量 —— 光看任务管理器分不清
 * 「Chromium 自己的固定开销」与「我们自己的代码在涨」。
 *
 * 用法：
 *   node scripts/measure-memory.mjs              只量空闲（停在开场那张状态卡）
 *   node scripts/measure-memory.mjs --walk 6     再走几步：交卡 → 定档 → 发 6 轮回答
 *
 * 用的是一次性 userData（预置一份空 Key 的配置，好让它直接进采访页、走演示模式），
 * 所以不会碰到你真实的配置与会话。
 */

const WALK_INDEX = process.argv.indexOf('--walk')
const WALK = WALK_INDEX > -1 ? Number(process.argv[WALK_INDEX + 1] ?? 4) : 0
const SKIP_INDEX = process.argv.indexOf('--skip')
const SKIP = SKIP_INDEX > -1 ? Number(process.argv[SKIP_INDEX + 1] ?? 3) : 0
const PORT = 9333
const TIMEOUT_MS = 180_000

const userData = mkdtempSync(join(tmpdir(), 'ai-weekly-mem-'))
writeFileSync(
  join(userData, 'config.json'),
  JSON.stringify({
    apiKey: '',
    baseUrl: 'https://api.deepseek.com/v1',
    model: 'deepseek-chat',
    persona: { prompt: '', preset: 'warm' },
  }),
)

const env = { ...process.env }
// 与 smoke.mjs 同一条坑：它一旦被继承，electron.exe 会以纯 Node 模式启动
delete env.ELECTRON_RUN_AS_NODE
env.AI_WEEKLY_USER_DATA = userData
env.ELECTRON_DISABLE_SECURITY_WARNINGS = '1'

const child = spawn(electronPath, ['.', `--remote-debugging-port=${PORT}`], {
  stdio: ['ignore', 'pipe', 'pipe'],
  env,
})

let ws
async function cleanup(code) {
  try {
    ws?.close()
  } catch {
    /* 关不掉就算了，进程马上就没了 */
  }
  // 必须等它真的退出了再删 userData —— 提前删会被占用，EPERM
  await new Promise((resolve) => {
    if (child.exitCode !== null) return resolve()
    child.once('close', resolve)
    child.kill()
    setTimeout(resolve, 5000)
  })
  try {
    rmSync(userData, { recursive: true, force: true })
  } catch {
    /* 临时目录删不掉不影响结论 */
  }
  process.exit(code)
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** 等 CDP 把页面 target 挂出来 */
async function findPageTarget() {
  const deadline = Date.now() + 30_000
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/json/list`)
      const list = await res.json()
      const page = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl)
      if (page) return page
    } catch {
      /* 还没起来，继续等 */
    }
    await sleep(300)
  }
  throw new Error('CDP 一直没挂出页面 target')
}

/** 极简 CDP 客户端：只需要 Runtime.evaluate */
function connect(url) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url)
    let id = 0
    const pending = new Map()
    socket.addEventListener('message', (event) => {
      const msg = JSON.parse(event.data)
      const item = pending.get(msg.id)
      if (!item) return
      pending.delete(msg.id)
      if (msg.error) item.reject(new Error(msg.error.message))
      else item.resolve(msg.result)
    })
    socket.addEventListener('error', reject)
    socket.addEventListener('open', () => {
      resolve({
        socket,
        send(method, params) {
          id += 1
          const current = id
          return new Promise((res, rej) => {
            pending.set(current, { resolve: res, reject: rej })
            socket.send(JSON.stringify({ id: current, method, params }))
          })
        },
      })
    })
  })
}

/** 在页面里求值一段表达式，拿到 JSON 化的结果（包一层 async，表达式里可以 await） */
async function evaluate(client, expression) {
  const result = await client.send('Runtime.evaluate', {
    expression: `(async () => { ${expression} })()`,
    returnByValue: true,
    awaitPromise: true,
  })
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.exception?.description ?? '页面里求值失败')
  }
  return result.result.value
}

const PROBE = `
  const m = performance.memory
  return {
    heapUsedMB: m ? +(m.usedJSHeapSize / 1048576).toFixed(2) : null,
    heapTotalMB: m ? +(m.totalJSHeapSize / 1048576).toFixed(2) : null,
    heapLimitMB: m ? +(m.jsHeapSizeLimit / 1048576).toFixed(2) : null,
    domNodes: document.querySelectorAll('*').length,
    bubbles: document.querySelectorAll('.bubble').length,
    label: document.querySelector('.stage-title')?.textContent ?? '',
    page: document.querySelector('.page')?.className ?? '(没有 .page)',
    starsOn: document.querySelectorAll('.star.on').length,
    // 最后一条 AI 气泡 = 当前这道题；用来验证「跳过一下，题是不是真的换了一道」
    question: (() => {
      const bubbles = [...document.querySelectorAll('.bubble')]
      const last = bubbles[bubbles.length - 1]
      return last ? last.textContent.trim().slice(0, 28) : ''
    })(),
  }
`

/** 点一下「这题跳过」（按文字找，免得为测试改组件里的 class） */
async function skip(client) {
  return evaluate(
    client,
    `const btn = [...document.querySelectorAll('.composer-actions .btn')]
       .find((b) => b.textContent.trim() === '这题跳过')
     if (!btn || btn.disabled) return false
     btn.click()
     return true`,
  )
}

/** 等界面不忙了（没有打字/流式气泡、没有遮罩） */
async function settle(client, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    // 注意别拿「发送按钮 disabled」当忙：草稿为空时它本来就是灰的，那样永远等不到
    const busy = await evaluate(
      client,
      `return Boolean(document.querySelector('.bubble.typing')) ||
              Boolean(document.querySelector('.bubble.streaming')) ||
              Boolean(document.querySelector('.overlay'))`,
    )
    if (!busy) return true
    await sleep(250)
  }
  return false
}

/** 点一下 selector 选中的元素 */
async function click(client, selector, index = 0) {
  return evaluate(
    client,
    `const els = [...document.querySelectorAll(${JSON.stringify(selector)})]
     if (!els[${index}]) return false
     els[${index}].click()
     return true`,
  )
}

/** 往输入框里塞一句话并发送（React 受控组件得走原生 setter + input 事件） */
async function say(client, text) {
  return evaluate(
    client,
    `const ta = document.querySelector('.composer textarea')
     if (!ta) return false
     const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set
     setter.call(ta, ${JSON.stringify(text)})
     ta.dispatchEvent(new Event('input', { bubbles: true }))
     await new Promise((r) => setTimeout(r, 60))
     const send = document.querySelector('.composer-actions .btn.primary')
     if (!send || send.disabled) return false
     send.click()
     return true`,
  )
}

const rows = []
async function snap(client, label) {
  const data = await evaluate(client, PROBE)
  rows.push({ 时点: label, ...data })
  return data
}

async function main() {
  const target = await findPageTarget()
  const client = await connect(target.webSocketDebuggerUrl)
  ws = client.socket
  await client.send('Runtime.enable')
  await settle(client)

  await snap(client, '空闲（开场状态卡）')

  if (WALK > 0) {
    // 交状态卡：给两项低分，好让「状态追问」那一步真的出现
    await click(client, '.state-card .star', 1) // 心情 2 星
    await click(client, '.state-card .star', 6) // 睡眠 2 星
    await click(client, '.state-card .star', 11) // 运动 1 星
    await sleep(300)
    await snap(client, '点完三颗低分星')
    await click(client, '.state-card .btn.primary')
    await sleep(400)
    await click(client, '.btn.depth', 1) // 中度复盘
    await settle(client)
    await snap(client, '交卡 + 定档之后')

    for (let i = 1; i <= WALK; i += 1) {
      const ok = await say(client, `第 ${i} 轮回答：这周主要在改客户的方案，来回三版还没定。`)
      if (!ok) break
      await settle(client)
      await snap(client, `第 ${i} 轮回答之后`)
    }
  }

  /**
   * `--skip N`：连点 N 次「这题跳过」，看题目是不是真的换了一道、有没有多出气泡。
   *
   * App 层没有单测（整份 App.tsx 没有测试），而「点一下是不是真的推进了」
   * 正是这一版加的东西，所以拿真实界面验一次 —— 跟 smoke 的理由一样。
   */
  if (SKIP > 0) {
    await click(client, '.state-card .star', 6) // 睡眠 2 星 → 让状态追问出现
    await sleep(200)
    await click(client, '.state-card .btn.primary')
    await sleep(400)
    await click(client, '.btn.depth', 1)
    await settle(client)
    await snap(client, '跳过之前')

    for (let i = 1; i <= SKIP; i += 1) {
      const ok = await skip(client)
      if (!ok) {
        process.stdout.write(`（第 ${i} 次没找到可点的「这题跳过」——可能正在等模型回话）\n`)
        await settle(client)
        continue
      }
      // 跳过一整块的最后一题会顺手打开下一块（那时会有一次 AI 开口），所以要等它安定
      await settle(client)
      await snap(client, `跳过第 ${i} 次之后`)
    }
  }

  process.stdout.write('\n')
  process.stdout.write(
    `${'时点'.padEnd(22)} ${'JS 堆'.padStart(9)} ${'DOM'.padStart(6)} ${'气泡'.padStart(5)} ${'亮星'.padStart(5)}  ${'当前步骤'.padEnd(10)} 当前这道题\n`,
  )
  for (const row of rows) {
    process.stdout.write(
      `${String(row.时点).padEnd(22)} ${String(row.heapUsedMB + ' MB').padStart(9)} ` +
        `${String(row.domNodes).padStart(6)} ${String(row.bubbles).padStart(5)} ` +
        `${String(row.starsOn).padStart(5)}  ${String(row.label).padEnd(10)} ${row.question}\n`,
    )
  }
  const first = rows[0]
  const last = rows[rows.length - 1]
  if (rows.length > 1) {
    process.stdout.write(
      `\n从「${first.时点}」到「${last.时点}」：JS 堆 ` +
        `${(last.heapUsedMB - first.heapUsedMB).toFixed(2)} MB，` +
        `DOM 节点 ${last.domNodes - first.domNodes}\n`,
    )
  }
  process.stdout.write('\n（进程的工作集与私有内存由调用方另外量，见 npm run measure:memory）\n')

  cleanup(0)
}

main().catch((err) => {
  process.stderr.write(`内存体检失败：${err.message}\n`)
  cleanup(1)
})

setTimeout(() => {
  process.stderr.write('内存体检超时\n')
  cleanup(1)
}, TIMEOUT_MS)
