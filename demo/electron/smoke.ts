import { app, type BrowserWindow } from 'electron'

/**
 * 启动冒烟检查。
 *
 * 打包之后最容易翻车的从来不是业务逻辑（那部分有 200 个用例盯着），
 * 而是「窗口起来了、页面是白的」：路径不对、预加载没加载上、渲染进程里
 * 一上来就抛异常。这三件事只有真把应用拉起来才知道。
 *
 * 检查完直接把结论打在 stdout 上，退出码 0/1 —— scripts/smoke.mjs 据此判定。
 */

const SMOKE_TIMEOUT_MS = 30_000

interface ProbeResult {
  hasBridge: boolean
  bridgeShape: string
  mounted: boolean
  text: string
}

export async function runSmokeCheck(win: BrowserWindow): Promise<void> {
  const finish = (ok: boolean, note: string): void => {
    process.stdout.write(ok ? `SMOKE OK: ${note}\n` : `SMOKE FAILED: ${note}\n`)
    app.exit(ok ? 0 : 1)
  }

  const timer = setTimeout(() => finish(false, '等待页面加载超时'), SMOKE_TIMEOUT_MS)

  try {
    await new Promise<void>((resolve, reject) => {
      win.webContents.once('did-finish-load', () => resolve())
      win.webContents.once('did-fail-load', (_event, code, description) => {
        reject(new Error(`页面加载失败（${code} ${description}）`))
      })
    })

    const probe = (await win.webContents.executeJavaScript(`(() => {
      const b = window.aiWeekly
      return {
        hasBridge: typeof b === 'object' && b !== null,
        bridgeShape: b ? Object.keys(b).join(',') : '',
        mounted: (document.getElementById('root')?.children.length ?? 0) > 0,
        text: (document.body.innerText || '').replace(/\\s+/g, ' ').trim().slice(0, 120),
      }
    })()`)) as ProbeResult

    if (!probe.hasBridge) return finish(false, '预加载的桥没有注入到页面里')
    if (probe.bridgeShape !== 'llm,store') return finish(false, `桥的形状不对：${probe.bridgeShape}`)
    if (!probe.mounted) return finish(false, 'React 没有挂上，#root 是空的（多半是页面报错白屏）')
    if (!probe.text.includes('AI 周报')) return finish(false, `页面内容不对：${probe.text}`)

    finish(true, `窗口起来了、页面挂上了、桥也在 —— ${probe.text.slice(0, 60)}`)
  } catch (err) {
    finish(false, err instanceof Error ? err.message : String(err))
  } finally {
    clearTimeout(timer)
  }
}
