import { app, BrowserWindow, ipcMain, shell } from 'electron'
import { join } from 'node:path'
import { createFileStore } from '../src/host/fileStore'
import { createLlmService } from '../src/host/llmService'
import { IPC, type LlmSendPayload } from '../src/shared/ipc'
import { runSmokeCheck } from './smoke'

/**
 * Electron 主进程 —— 刻意写得很薄。
 *
 * 这里只有三件事：开窗口、接线（IPC 转发）、读写文件。
 * 没有一行业务逻辑：发请求在 src/host/llmForward.ts，请求记账在 src/host/llmService.ts，
 * 落盘在 src/host/fileStore.ts，全是可单测的纯 Node 代码。
 * 这样做是为了日后换成 Tauri 时，前端那 100% 的代码能原样搬走。
 */

/** 开发期由 vite 提供页面；打包后读 dist/index.html */
const DEV_SERVER = process.env.AI_WEEKLY_DEV_SERVER?.trim() ?? ''
/** 冒烟测试用：不显示窗口，起来自检完就退出（见 scripts/smoke.mjs） */
const SMOKE = process.env.AI_WEEKLY_SMOKE === '1'

// 冒烟测试要一个一次性的数据目录，免得污染真实配置
const USER_DATA = process.env.AI_WEEKLY_USER_DATA?.trim()
if (USER_DATA) app.setPath('userData', USER_DATA)

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1120,
    height: 840,
    minWidth: 900,
    minHeight: 620,
    show: !SMOKE,
    title: 'AI 周报',
    backgroundColor: '#0f1115',
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, 'preload.cjs'),
      // 渲染进程不碰 Node，要用什么由 preload 明确地开一个口子
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  // 页面里的外链交给系统浏览器，不在应用窗口里打开
  win.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url)
    return { action: 'deny' }
  })

  if (DEV_SERVER) {
    void win.loadURL(DEV_SERVER)
  } else {
    void win.loadFile(join(__dirname, '..', 'dist', 'index.html'))
  }

  return win
}

/** 把渲染进程要的能力接到 src/host 的那些实现上 */
function wireIpc(): void {
  const store = createFileStore(app.getPath('userData'))
  const llm = createLlmService({
    emit: (channel, payload) => {
      for (const win of BrowserWindow.getAllWindows()) {
        if (!win.isDestroyed()) win.webContents.send(channel, payload)
      }
    },
  })

  ipcMain.handle(IPC.llmSend, (_event, payload: LlmSendPayload) => llm.handle(payload))
  ipcMain.on(IPC.llmAbort, (_event, requestId: string) => llm.abort(requestId))

  // 读用 sendSync：总览页要一进去就画得出来
  ipcMain.on(IPC.loadConfig, (event) => {
    event.returnValue = store.loadConfig()
  })
  ipcMain.on(IPC.loadArchive, (event) => {
    event.returnValue = store.loadArchive()
  })

  // 写不需要回执，不阻塞界面
  ipcMain.on(IPC.saveConfig, (_event, config: unknown) => store.saveConfig(config))
  ipcMain.on(IPC.saveArchive, (_event, list: unknown) => store.saveArchive(list))
}

void app.whenReady().then(() => {
  wireIpc()
  const win = createWindow()
  if (SMOKE) void runSmokeCheck(win)

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
