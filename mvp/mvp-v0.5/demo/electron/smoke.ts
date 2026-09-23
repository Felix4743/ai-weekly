import { app, type BrowserWindow } from 'electron'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * 启动冒烟检查。
 *
 * 打包之后最容易翻车的从来不是业务逻辑（那部分有 200 多个用例盯着），
 * 而是「窗口起来了、页面是白的」，以及「桥在、但处理器不在」。
 * 这两类问题的症状都很隐蔽：应用看起来启动了，用起来才发现什么都干不了。
 *
 * 所以这里真跑三关：
 *   一、窗口能起来、页面挂得上、预加载的桥在
 *   二、存储真的能落到主进程的 JSON 文件上（存一次、读一次、再验文件）
 *   三、一次真的走 IPC 的请求：打一个必定连不上的地址，
 *       要的是失败被翻译成人话，而不是抛异常、也不是卡在那儿
 *
 * 第三关刻意不依赖真实网络，因此可以稳定地跑。检查完把结论打在 stdout 上，
 * 退出码 0/1 —— scripts/smoke.mjs 据此判定。
 */

const SMOKE_TIMEOUT_MS = 60_000
const CONFIG_FILE = () => join(app.getPath('userData'), 'config.json')

interface BootProbe {
  hasBridge: boolean
  bridgeShape: string
  mounted: boolean
  text: string
}

interface StoreProbe {
  saved: boolean
  readBack: string
}

interface LlmProbe {
  ok: boolean
  message?: string
  detail?: string
}

export async function runSmokeCheck(win: BrowserWindow): Promise<void> {
  const finish = (ok: boolean, note: string): void => {
    process.stdout.write(ok ? `SMOKE OK: ${note}\n` : `SMOKE FAILED: ${note}\n`)
    app.exit(ok ? 0 : 1)
  }

  const timer = setTimeout(() => finish(false, '冒烟检查超时'), SMOKE_TIMEOUT_MS)

  try {
    await new Promise<void>((resolve, reject) => {
      win.webContents.once('did-finish-load', () => resolve())
      win.webContents.once('did-fail-load', (_event, code, description) => {
        reject(new Error(`页面加载失败（${code} ${description}）`))
      })
    })

    /* ---------- 第一关：窗口、页面、桥 ---------- */

    const boot = (await win.webContents.executeJavaScript(`(() => {
      const b = window.aiWeekly
      return {
        hasBridge: typeof b === 'object' && b !== null,
        bridgeShape: b ? Object.keys(b).join(',') : '',
        mounted: (document.getElementById('root')?.children.length ?? 0) > 0,
        text: (document.body.innerText || '').replace(/\\s+/g, ' ').trim().slice(0, 120),
      }
    })()`)) as BootProbe

    if (!boot.hasBridge) return finish(false, '预加载的桥没有注入到页面里')
    if (boot.bridgeShape !== 'llm,store') return finish(false, `桥的形状不对：${boot.bridgeShape}`)
    if (!boot.mounted) return finish(false, 'React 没有挂上，#root 是空的（多半是页面报错白屏）')
    if (!boot.text.includes('AI 周报')) return finish(false, `页面内容不对：${boot.text}`)

    /* ---------- 第二关：存储真的落到文件上了吗 ---------- */
    // 「桥在」只说明 preload 跑过了，不代表 ipcMain 那边注册上了。
    // 少注册一个 handler，症状就是「设置存不下来」，启动时一点看不出来。

    const store = (await win.webContents.executeJavaScript(`(async () => {
      const probe = { apiKey: 'smoke-probe', baseUrl: 'https://example.com/v1', model: 'probe' }
      window.aiWeekly.store.saveConfig(probe)
      await new Promise((r) => setTimeout(r, 300))
      const back = window.aiWeekly.store.loadConfig()
      return { saved: !!back && back.apiKey === 'smoke-probe', readBack: JSON.stringify(back) }
    })()`)) as StoreProbe

    if (!store.saved) return finish(false, `配置没能存下来又读回去：${store.readBack}`)
    if (!existsSync(CONFIG_FILE())) return finish(false, `配置没有落到文件上：${CONFIG_FILE()}`)
    if (!readFileSync(CONFIG_FILE(), 'utf8').includes('smoke-probe')) {
      return finish(false, '配置文件里没有这次探针写进去的内容')
    }

    /* ---------- 第三关：一次真的走 IPC 的请求 ---------- */
    // 打一个必定连不上的地址。要验证的不是「能连上」，而是失败被翻译成
    // 一句用户看得懂的话，而且请求确实是从主进程发出去的。

    const llm = (await win.webContents.executeJavaScript(`(async () => {
      return await window.aiWeekly.llm.send({
        requestId: 'smoke-llm-1',
        baseUrl: 'http://127.0.0.1:1/v1',
        apiKey: 'smoke',
        model: 'smoke',
        messages: [{ role: 'user', content: 'hi' }],
      }, () => {})
    })()`)) as LlmProbe

    if (llm.ok) return finish(false, '打不通的地址居然成功了，说明请求根本没有真的发出去')
    if (!llm.message?.includes('连不上接口地址')) {
      return finish(false, `失败没有被翻译成人话：${JSON.stringify(llm)}`)
    }

    finish(
      true,
      `窗口/页面/桥都正常，配置真的落到了文件，走 IPC 的请求失败也给了人话 —— ${boot.text.slice(0, 50)}`,
    )
  } catch (err) {
    finish(false, err instanceof Error ? err.message : String(err))
  } finally {
    clearTimeout(timer)
  }
}
