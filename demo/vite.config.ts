import http from 'node:http'
import type { IncomingMessage, ServerResponse } from 'node:http'
import https from 'node:https'
import react from '@vitejs/plugin-react'
import type { Plugin } from 'vite'
import { defineConfig } from 'vitest/config'

const DEFAULT_LLM_BASE = 'https://api.deepseek.com/v1'

function firstHeader(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value[0] ?? ''
  return value ?? ''
}

/**
 * 开发期的模型接口代理。
 *
 * 浏览器直连 DeepSeek 这类接口会撞上跨域，这里由 dev server 代为转发。
 * 目标地址来自请求头 x-llm-base，所以设置页里换成任何 OpenAI 兼容接口都能用，
 * 不需要改配置重启。
 *
 * 只作用于 dev（apply: 'serve'）。M4 换 Electron 主进程发请求之后，这一层就删掉。
 */
function llmProxy(): Plugin {
  return {
    name: 'ai-weekly:llm-proxy',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/llm-proxy', (req: IncomingMessage, res: ServerResponse) => {
        const rawBase = firstHeader(req.headers['x-llm-base']) || DEFAULT_LLM_BASE
        const suffix = req.url && req.url !== '/' ? req.url : '/chat/completions'

        let target: URL
        try {
          target = new URL(rawBase.replace(/\/+$/, '') + suffix)
        } catch {
          res.writeHead(400, { 'Content-Type': 'application/json' })
          res.end(
            JSON.stringify({ error: { message: `接口地址不是合法的 URL：${rawBase}` } }),
          )
          return
        }

        const headers: http.OutgoingHttpHeaders = { ...req.headers }
        // 这几个头是发给 dev server 的，不能原样带给上游
        delete headers['x-llm-base']
        delete headers['origin']
        delete headers['referer']
        delete headers['connection']
        delete headers['host']
        // 不带上游压缩，避免 SSE 被压住看不出流式
        delete headers['accept-encoding']
        headers['host'] = target.host

        const isHttps = target.protocol === 'https:'
        const mod = isHttps ? https : http
        const upstream = mod.request(
          {
            protocol: target.protocol,
            hostname: target.hostname,
            port: target.port || (isHttps ? 443 : 80),
            path: `${target.pathname}${target.search}`,
            method: req.method,
            headers,
          },
          (up) => {
            res.writeHead(up.statusCode ?? 502, {
              ...up.headers,
              'cache-control': 'no-cache',
              'x-accel-buffering': 'no',
            })
            // 直接 pipe：SSE 的每一小段都会立刻到达浏览器，不会被攒起来
            up.pipe(res)
          },
        )

        upstream.on('error', (err: Error) => {
          if (res.headersSent) {
            res.end()
            return
          }
          res.writeHead(502, { 'Content-Type': 'application/json' })
          res.end(
            JSON.stringify({ error: { message: `开发代理转发失败：${err.message}` } }),
          )
        })

        req.pipe(upstream)
      })
    },
  }
}

export default defineConfig({
  // 打包后页面是用 loadFile（file://）加载的，绝对路径 /assets/... 会直接 404，
  // 症状就是「窗口起来了、页面全白」—— 冒烟测试第一次跑就抓到了这个。
  // 改成相对路径后，dev server 与 Electron 两种加载方式都成立。
  base: './',
  build: {
    /**
     * 必须显式写这个开关。
     *
     * 默认那份「outDir 在 root 里就清空」的判断，在相对 outDir（'dist'）下没有生效：
     * 实测连着构建多次，dist/assets 里堆了二十来份历史产物，而 electron-builder
     * 是按 dist/** 全量打包的 —— 每一版安装包里都塞着一堆死文件；更麻烦的是
     * 「在 asar 里按字符串查新代码在不在」这种验证，会被旧包里的同名文案骗过（已经骗过一次）。
     * 命令行加 --emptyOutDir 也没用，只有写进配置才真的清。
     */
    emptyOutDir: true,
  },
  plugins: [react(), llmProxy()],
  server: {
    host: '127.0.0.1',
    port: 5199,
    strictPort: false,
  },
  test: {
    environment: 'node',
    // .tsx：0.9.8 起 PeekRating 的手势测试要真 DOM，单独在那个文件顶上写
    // `@vitest-environment jsdom`，其余文件照旧跑 node（没有 DOM，快得多）
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    // 打开 React 的 act 环境（见 src/test-setup.ts 里的说明）
    setupFiles: ['src/test-setup.ts'],
  },
})
