import { spawn } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
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
 *   node scripts/measure-memory.mjs --skip 3     连点 3 次「这题跳过」，看题目是不是真的换了一道
 *   node scripts/measure-memory.mjs --result     走完采访并生成结果，打印结果页区块顺序与页头概览
 *   node scripts/measure-memory.mjs --result --seed <weeks.json> --shot <目录>
 *                                                塞一份真归档进去，并把结果页、总览页截屏存下来
 *                                                （0.9.6 靠它看「上周对比」与「反复出现」真的长什么样）
 *   node scripts/measure-memory.mjs --packaged … 上面任一种都行，但拉的是装好的那一份
 *
 * 用的是一次性 userData（预置一份空 Key 的配置，好让它直接进采访页、走演示模式），
 * 所以不会碰到你真实的配置与会话 —— 验装机版时也一样。`--seed` 是唯一往这份临时目录里
 * 搬东西的开关，而且只读地拷一份归档进去，不动原件。
 */

const WALK_INDEX = process.argv.indexOf('--walk')
const WALK = WALK_INDEX > -1 ? Number(process.argv[WALK_INDEX + 1] ?? 4) : 0
const SKIP_INDEX = process.argv.indexOf('--skip')
const SKIP = SKIP_INDEX > -1 ? Number(process.argv[SKIP_INDEX + 1] ?? 3) : 0
/** `--result`：走完采访并生成结果，用来看结果页（0.9.5 重排过层级）真的长什么样 */
const WANT_RESULT = process.argv.includes('--result')
/**
 * `--seed <weeks.json>`：把一份**真归档**塞进这次的一次性 userData。
 *
 * 「上周对比」和「反复出现」都是从 weeks.json 里算出来的：不给它一份有历史的归档，
 * 结果页上那两处只会是空的 —— 也就等于没验。
 */
const SEED_INDEX = process.argv.indexOf('--seed')
const SEED = SEED_INDEX > -1 ? process.argv[SEED_INDEX + 1] : ''
/** `--shot <目录>`：把结果页与总览页截成 PNG，给这一版新长出来的东西留个证据 */
const SHOT_INDEX = process.argv.indexOf('--shot')
const SHOT = SHOT_INDEX > -1 ? process.argv[SHOT_INDEX + 1] : ''
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
if (SEED) {
  if (existsSync(SEED)) {
    copyFileSync(SEED, join(userData, 'weeks.json'))
    process.stdout.write(`已塞入归档：${SEED}\n`)
  } else {
    process.stdout.write(`（找不到 ${SEED}，这次按空归档跑）\n`)
  }
}
if (SHOT) mkdirSync(SHOT, { recursive: true })

const env = { ...process.env }
// 与 smoke.mjs 同一条坑：它一旦被继承，electron.exe 会以纯 Node 模式启动
delete env.ELECTRON_RUN_AS_NODE
env.AI_WEEKLY_USER_DATA = userData
env.ELECTRON_DISABLE_SECURITY_WARNINGS = '1'

/**
 * `--packaged` 改成拉**装好的那一份**（`D:\AI周报\`）而不是源码。
 *
 * 与 `smoke.mjs` 的两种用法同理：「源码里跑得通」和「装出来那一份跑得通」是两件事。
 * 装机目录在工作区外面（在工作区内会被沙箱打上 Low 完整性标签、打不开），换过位置就设
 * 环境变量 `AI_WEEKLY_INSTALL_DIR`。
 */
const PACKAGED = process.argv.includes('--packaged')
const installDir = process.env.AI_WEEKLY_INSTALL_DIR ?? 'D:\\AI周报'

/** 装机目录里那个应用程序本体：排除 NSIS 自带的 elevate.exe 与卸载器 */
function findInstalledExe() {
  try {
    const exe = readdirSync(installDir).find(
      (f) =>
        f.toLowerCase().endsWith('.exe') &&
        f.toLowerCase() !== 'elevate.exe' &&
        !f.toLowerCase().startsWith('uninstall'),
    )
    return exe ? join(installDir, exe) : null
  } catch {
    return null
  }
}

const command = PACKAGED ? findInstalledExe() : electronPath
if (!command) {
  process.stderr.write(`找不到装机版：${installDir}（先跑 npm run dist 并装上）\n`)
  process.exit(1)
}
const launchArgs = PACKAGED ? [] : ['.']

/**
 * 拉起应用。
 *
 * 平时用管道收着它的输出（出问题时有东西可看）；但在**被沙箱管住的终端**里
 * 子进程开不了命名管道，`spawn` 会直接抛 `EPERM`。Electron 的输出不看也不影响
 * 这脚本的结论，所以这时候退成 `inherit`（输出直接进当前终端）再来一次。
 */
function launch(command, args, env) {
  const options = { env }
  try {
    return spawn(command, args, { ...options, stdio: ['ignore', 'pipe', 'pipe'] })
  } catch (err) {
    if (err?.code !== 'EPERM') throw err
    process.stdout.write('（开不了管道，改成继承输出启动）\n')
    return spawn(command, args, { ...options, stdio: 'inherit' })
  }
}

const child = launch(command, [...launchArgs, `--remote-debugging-port=${PORT}`], env)

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
    // 0.9.8：亮的颗数改从 aria-checked 上数（原来那个 .star.on 已经不在了；每排最多一颗选中）
    starsOn: document.querySelectorAll('.peek-rating__star[aria-checked="true"]').length,
    // 最后一条 AI 气泡 = 当前这道题；用来验证「跳过一下，题是不是真的换了一道」
    question: (() => {
      const bubbles = [...document.querySelectorAll('.bubble')]
      const last = bubbles[bubbles.length - 1]
      return last ? last.textContent.trim().slice(0, 28) : ''
    })(),
    // 结果页上的区块顺序（0.9.5 把主线与计划提到了最前）
    sections: [...document.querySelectorAll('[id^="section-"]')].map((el) => el.id),
    brief: document.querySelector('.result-brief')?.innerText.replace(/\s+/g, ' ').trim() ?? '',
    // 0.9.6：跟上次比出来的那几行小字（没打分的那几项不该有）
    prevTags: [...document.querySelectorAll('.state-prev, .brief-prev')].map((el) => el.textContent.trim()),
    // 0.9.6：跨周重复的东西（卡片收起时这里是空的 —— 展开之后才看得到）
    patterns: [...document.querySelectorAll('.pattern-item')].map((el) => el.innerText.replace(/\s+/g, ' ').trim()),
    patternEmpty: document.querySelector('.pattern-empty')?.textContent.replace(/\s+/g, ' ').trim() ?? '',
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

/**
 * 等 React 真的把页面挂上去。
 *
 * 打包版有时候比 CDP 的 target 出现得晚：target 有了、`#root` 还是空的，
 * 这时候点星点不到任何东西 —— 表现是「分数没交上去，于是状态追问整步被跳过」，
 * 看起来像功能坏了，其实只是脚本抢跑了。
 */
async function waitForApp(client, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const ready = await evaluate(
      client,
      `return Boolean(document.querySelector('.page') || document.querySelector('.setup-card'))`,
    )
    if (ready) return true
    await sleep(200)
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

/**
 * 点状态卡里某一排（心情 / 睡眠 / 运动 / 饮食）的第 n 颗星。
 *
 * 0.9.8 起那排星在 `PeekRating` 里面，class 从 `.star` 换成了
 * `.peek-rating__star`，而且四排各自嵌套一层 —— 原来那种
 * `.state-card .star` 按**全局下标**数（1 = 心情第二颗、6 = 睡眠第二颗、
 * 11 = 运动第一颗）的写法已经指不准了。所以这里按「哪一排的第几颗」来点，
 * 排是按 `.state-label` 的中文名找的 —— 太窄的窗口下标签会长出括号备注，
 * 所以用「包含」而不是「等于」。
 */
async function clickStateStar(client, rowLabel, starIndex) {
  return evaluate(
    client,
    `const label = [...document.querySelectorAll('.state-row .state-label')]
       .find((el) => el.textContent.includes(${JSON.stringify(rowLabel)}))
     const buttons = label
       ? [...label.parentElement.querySelectorAll('.peek-rating__star')]
       : []
     if (!buttons[${starIndex}]) return false
     buttons[${starIndex}].click()
     return true`,
  )
}

/**
 * 按文字点一个按钮：`selector` 圈范围，`text` 是按钮上的一句话（用「包含」找）。
 *
 * 这几屏的按钮都没有稳定的类名可挑（「开始这周的梳理」在 `.notes-foot` 里、
 * 「记一句」混在那排换块的芯片里），按文字找最省事，也不怕以后挪位置。
 */
async function clickText(client, selector, text) {
  return evaluate(
    client,
    `const b = [...document.querySelectorAll(${JSON.stringify(selector)})]
       .find((x) => x.textContent.includes(${JSON.stringify(text)}))
     if (!b) return false
     b.click()
     return true`,
  )
}

/**
 * 0.9.9 起，周中打开软件先看到的是「随心记」落地页：四栏标签、打分卡、生成按钮都不在，
 * 只有那张卡和一句「开始这周的梳理」。要走到打分卡，得先在落地页上点这一下。
 *
 * 这一周要是已经开过头（或者刚才已经点过），落地页不在了，返回 false —— 调用方不用管。
 */
async function startInterview(client) {
  const clicked = await clickText(client, '.notes-foot .btn', '开始这周的梳理')
  if (clicked) {
    await sleep(300)
    await settle(client)
  }
  return clicked
}

/**
 * 在随心记落地页上记一句（只有截图流程会用到）。
 *
 * 输入框是 React 管的受控组件：直接改 `input.value` 它不认，得走原生 setter 再补一个
 * `input` 事件，React 才看得到这次改动。然后点「记下」。
 */
async function addNote(client, text) {
  return evaluate(
    client,
    `const input = document.querySelector('.note-input')
     if (!input) return false
     const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
     setter.call(input, ${JSON.stringify(text)})
     input.dispatchEvent(new Event('input', { bubbles: true }))
     const btn = [...document.querySelectorAll('.note-composer .btn')]
       .find((b) => b.textContent.includes('记下'))
     if (!btn) return false
     btn.click()
     return true`,
  )
}

/**
 * 往当前焦点上敲一个键（截图用：键盘是那排星正经支持的一条路）。
 *
 * 走 CDP 的 `Input.dispatchKeyEvent` 而不是 `el.dispatchEvent` —— 后者造出来的
 * 事件 `isTrusted` 是 false，React 那层收不到。
 */
async function press(client, key) {
  const common = { key, code: key, windowsVirtualKeyCode: key === 'Backspace' ? 8 : 39, nativeVirtualKeyCode: key === 'Backspace' ? 8 : 39 }
  await client.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', ...common })
  await client.send('Input.dispatchKeyEvent', { type: 'keyUp', ...common })
}

/**
 * 截一张图（`--shot <目录>`）。
 *
 * 为什么要有：0.9.6 新加的「上次对比」与「反复出现」纯粹是排版活儿，
 * 光看 DOM 里的文字说明不了它长得对不对 —— 得真的看一眼。
 */
async function shot(client, name) {
  if (!SHOT) return
  await client.send('Page.enable')
  const { data } = await client.send('Page.captureScreenshot', { format: 'png' })
  const file = join(SHOT, `${name}.png`)
  writeFileSync(file, Buffer.from(data, 'base64'))
  process.stdout.write(`已截图：${file}\n`)
}

/** 把某一块滚到屏幕中间再截一张（结果页比一屏长） */
async function scrollShot(client, selector, name) {
  const ok = await evaluate(
    client,
    `const el = document.querySelector(${JSON.stringify(selector)})
     if (!el) return false
     el.scrollIntoView({ block: 'center' })
     return true`,
  )
  if (!ok) return
  await sleep(400)
  await shot(client, name)
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
  await waitForApp(client)
  await settle(client)

  await snap(client, '空闲（开场状态卡）')

  /**
   * `--shot <目录>` 会顺手把与结果页无关的几屏也留一张（开场状态卡、设置页、对话页）。
   *
   * 为什么：结果页那几张是 0.9.6 加的，只有那一页有截屏；改界面时其余三页反而只能靠脑补。
   * 设置页那一下放在**整个流程最后**才走 —— 早走会把后面的步骤带偏（进设置等于换了一页）。
   */
  if (SHOT) {
    // 0.9.9 的第一屏：随心记。空着的样子先留一张，再记三条留一张「记过东西的」，
    // 最后才点进采访 —— 点进去这一屏就没了
    await shot(client, 'chat-notes-landing')
    for (const text of [
      '跟张总通了电话，预算的事他还是没松口。',
      '椅子终于下单了，等周末到货。',
      '这周开始早起跑步，第三天就有点习惯了。',
    ]) {
      await addNote(client, text)
      await sleep(150)
    }
    await shot(client, 'chat-notes-filled')
    await startInterview(client)
    await shot(client, 'chat-state-card')
    /**
     * 采访里也能补记：发送框下面那颗「记一句」把同一张卡当抽屉拉出来。
     * 留一张之后收回去 —— 开着会挡住下面几步要点的东西。
     */
    if (await clickText(client, '.quick-jumps .btn', '记一句')) {
      await sleep(200)
      await shot(client, 'chat-notes-drawer')
      await clickText(client, '.quick-jumps .btn', '记一句')
      await sleep(200)
    }
    /**
     * 再留一张「打过分的」——0.9.8 那排星换成 PeekRating 之后，光是「没打分」那一张
     * 看不出亮起来是什么样。这里用**键盘**打分：合成的 pointer 事件在 CDP 下不生效
     * （`pointerType` 不是 `mouse`），而方向键是组件正经支持的一条路。
     */
    // 键盘事件打给**焦点**，而 `el.click()` 不给焦点，所以先真点一下、再把焦点按上去
    const rated = await click(client, '.state-card .state-row .peek-rating__star', 0)
    if (rated) {
      await evaluate(
        client,
        `const star = document.querySelector('.state-card .state-row .peek-rating__star')
         if (!star) return false
         star.focus()
         return document.activeElement === star`,
      )
      // 键盘事件是打进**焦点**的，先确认焦点真落在第一颗星上，再敲
      const focused = await evaluate(
        client,
        `return document.activeElement?.className ?? ''`,
      )
      process.stdout.write(`（键盘打分前焦点在：${focused}）\n`)
      await press(client, 'ArrowRight')
      await press(client, 'ArrowRight')
      await press(client, 'ArrowRight')
      await sleep(200)
      const checked = await evaluate(
        client,
        `return document.querySelectorAll('.peek-rating__star[aria-checked="true"]').length`,
      )
      process.stdout.write(`（敲了三下方向键，选中的颗数：${checked}）\n`)
      await shot(client, 'chat-state-card-rated')
      await press(client, 'Backspace') // 评回「没打分」，别影响后面几步
      await sleep(200)
    } else {
      process.stdout.write('（第一颗星没点到，跳过「打过分」那张）\n')
    }
  }

  if (WALK > 0) {
    // 交状态卡：给两项低分，好让「状态追问」那一步真的出现
    await startInterview(client)
    await clickStateStar(client, '心情', 1) // 心情 2 星
    await clickStateStar(client, '睡眠', 1) // 睡眠 2 星
    await clickStateStar(client, '运动', 0) // 运动 1 星
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

    if (SHOT) {
      await scrollShot(client, '.bubble', 'chat-top')
      await scrollShot(client, '.composer', 'chat-bottom')
    }
  }

  /**
   * `--skip N`：连点 N 次「这题跳过」，看题目是不是真的换了一道、有没有多出气泡。
   *
   * App 层没有单测（整份 App.tsx 没有测试），而「点一下是不是真的推进了」
   * 正是这一版加的东西，所以拿真实界面验一次 —— 跟 smoke 的理由一样。
   */
  if (SKIP > 0) {
    await startInterview(client)
    await clickStateStar(client, '睡眠', 1) // 睡眠 2 星 → 让状态追问出现
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

  if (WANT_RESULT) {
    // 交卡（给一项低分，好让状态追问也走一遍）→ 定档 → 说一句 → 生成
    await startInterview(client)
    await clickStateStar(client, '睡眠', 1) // 睡眠 2 星
    await sleep(200)
    await click(client, '.state-card .btn.primary')
    await sleep(400)
    await click(client, '.btn.depth', 1)
    await settle(client)
    await say(client, '这周主要在改客户的方案，来回三版还没定，卡在等对方拍板。')
    await settle(client)
    await click(client, '.composer-actions .btn.generate')
    await settle(client, 60_000)
    await sleep(500)
    await snap(client, '生成之后（结果页）')

    if (SHOT) {
      await shot(client, 'result-top')
      // 展开「状态」与「反复出现」两栏 —— 0.9.6 新长的东西都在这两栏里
      await click(client, '#section-state .card-head')
      await click(client, '#section-pattern .card-head')
      await sleep(400)
      await snap(client, '展开状态与反复出现之后')
      await scrollShot(client, '#section-pattern', 'result-pattern')
      await scrollShot(client, '#section-state', 'result-state')
      // 总览页（同一套对比也长在里面）
      const opened = await evaluate(
        client,
        `const b = [...document.querySelectorAll('.result-actions .btn')]
           .find((x) => x.textContent.includes('看总览'))
         if (!b) return false
         b.click()
         return true`,
      )
      if (opened) {
        await settle(client)
        await sleep(500)
        await shot(client, 'history')
        await snap(client, '总览页')
      }
    }
  }

  // 设置页：进得去也要出得来（点「不保存，返回」原路回去），截完就走，免得干扰上面的时点表
  if (SHOT) {
    const toSetup = await evaluate(
      client,
      `const b = [...document.querySelectorAll('.topbar-right button, .topbar-right .btn')]
         .find((x) => x.textContent.includes('设置'))
       if (!b) return false
       b.click()
       return true`,
    )
    if (toSetup) {
      await settle(client)
      await sleep(300)
      await shot(client, 'setup')
      await evaluate(
        client,
        `const b = [...document.querySelectorAll('button')].find((x) => x.textContent.includes('不保存'))
         if (!b) return false
         b.click()
         return true`,
      )
      await sleep(300)
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

  // 结果页那一条：把区块顺序与页头概览直接印出来，省得靠猜
  const withSections = rows.filter((row) => row.sections?.length > 0)
  for (const row of withSections) {
    process.stdout.write(`\n${row.时点} 的区块顺序：\n  ${row.sections.join(' → ')}\n`)
    if (row.brief) process.stdout.write(`页头概览：${row.brief}\n`)
  }

  // 0.9.6 那两条：跨周算出来的东西到底有没有出现在界面上
  const withTrends = rows.filter(
    (row) => row.prevTags?.length > 0 || row.patterns?.length > 0 || row.patternEmpty,
  )
  for (const row of withTrends) {
    process.stdout.write(`\n${row.时点} 的跨周线索：\n`)
    if (row.prevTags?.length) process.stdout.write(`  与上次对比：${row.prevTags.join(' / ')}\n`)
    if (row.patterns?.length) {
      process.stdout.write(`  反复出现：\n${row.patterns.map((p) => `    ${p}`).join('\n')}\n`)
    } else if (row.patternEmpty) {
      process.stdout.write(`  反复出现：${row.patternEmpty}\n`)
    }
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
