import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * 分层约束的强制检查。
 *
 * 「core/ 是纯逻辑、可以脱离界面测」这句话如果只写在文档里，迟早会被打破 ——
 * 某个着急的下午就会有人在那里 import 一个 React hook。
 * 这里把它变成测试：core/ 不许碰 React、不许碰网络与浏览器 API、
 * 不许依赖传输层的具体实现。这三条正是「日后换个外壳还能 100% 复用」的前提。
 */

const CORE_DIR = dirname(fileURLToPath(import.meta.url))
const SRC_DIR = join(CORE_DIR, '..')
const TRANSPORT_DIR = join(SRC_DIR, 'transport')
const SHARED_DIR = join(SRC_DIR, 'shared')
const HOST_DIR = join(SRC_DIR, 'host')
const ELECTRON_DIR = join(SRC_DIR, '..', 'electron')

interface Source {
  name: string
  text: string
}

function sourcesIn(dir: string): Source[] {
  return readdirSync(dir)
    .filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'))
    .map((f) => ({ name: f, text: readFileSync(join(dir, f), 'utf8') }))
}

const CORE = sourcesIn(CORE_DIR)

/** 逐个文件报告越界者，失败时一眼能看出是哪个文件坏了规矩 */
function offenders(pattern: RegExp): string[] {
  return CORE.filter((s) => pattern.test(s.text)).map((s) => s.name)
}

describe('分层约束 · core 保持纯净', () => {
  it('先确认真的读到了文件，别让这组测试空跑成假绿', () => {
    const names = CORE.map((s) => s.name)
    expect(CORE.length).toBeGreaterThan(8)
    expect(names).toContain('interview.ts')
    expect(names).toContain('prompts.ts')
    expect(names).toContain('openAiClient.ts')
  })

  it('core/ 里不出现 React', () => {
    expect(offenders(/from\s+['"]react(-dom)?['"]/)).toEqual([])
  })

  it('core/ 里不碰网络与浏览器 API', () => {
    expect(
      offenders(
        /\bfetch\s*\(|localStorage|sessionStorage|XMLHttpRequest|window\.|document\./,
      ),
    ).toEqual([])
  })

  it('core/ 只依赖传输层的接口，不依赖具体实现', () => {
    expect(offenders(/from\s+['"][^'"]*transport\//)).toEqual([])
  })

  it('core/ 不依赖本地存储实现', () => {
    expect(offenders(/from\s+['"][^'"]*storage\//)).toEqual([])
  })
})

describe('分层约束 · 传输层可替换', () => {
  it('目录里有一份实现和它自己的测试', () => {
    const files = readdirSync(TRANSPORT_DIR)
    expect(files).toContain('browserTransport.ts')
    expect(files).toContain('browserTransport.test.ts')
  })

  it('传输层不反过来依赖界面', () => {
    const bad = sourcesIn(TRANSPORT_DIR).filter((s) => /from\s+['"][^'"]*\bui\//.test(s.text))
    expect(bad.map((s) => s.name)).toEqual([])
  })

  it('传输层的接口留在 core，实现在 transport —— 换外壳时只动后者', () => {
    const contract = CORE.find((s) => s.name === 'chatTransport.ts')
    expect(contract).toBeDefined()
    expect(contract?.text).toContain('export interface ChatTransport')
    expect(contract?.text).toContain('export interface ChatRequest')
  })
})

/**
 * M4 加进来的两个目录，约束和 core/ 一样是「由测试强制」：
 * - shared/  主进程与渲染进程共用的契约，必须两边都能用，所以不许认任何一边的环境
 * - host/    主进程侧的逻辑，必须能脱离 Electron 单测，所以不许 import electron
 * 而外壳本身只许接线：一旦有人在 main.ts 里写起业务，前端那 100% 可复用的说法就没了。
 */
describe('分层约束 · shared 只是共用的契约', () => {
  const SHARED = sourcesIn(SHARED_DIR)

  it('先确认真的读到了文件', () => {
    const names = SHARED.map((s) => s.name)
    expect(names).toContain('ipc.ts')
    expect(names).toContain('bridge.ts')
    expect(names).toContain('chatStream.ts')
  })

  it('shared/ 里不出现 React', () => {
    const bad = SHARED.filter((s) => /from\s+['"]react(-dom)?['"]/.test(s.text))
    expect(bad.map((s) => s.name)).toEqual([])
  })

  it('core/ 不反向依赖 shared/ 与 host/ —— 契约不往业务层倒灌', () => {
    expect(offenders(/from\s+['"][^'"]*\b(shared|host|electron)\//)).toEqual([])
  })
})

describe('分层约束 · host 可以脱离 Electron 单测', () => {
  const HOST = sourcesIn(HOST_DIR)

  it('先确认真的读到了文件', () => {
    const names = HOST.map((s) => s.name)
    expect(names).toContain('fileStore.ts')
    expect(names).toContain('llmForward.ts')
    expect(names).toContain('llmService.ts')
  })

  it('host/ 里不出现 electron —— 否则就没法单测了', () => {
    const bad = HOST.filter((s) => /from\s+['"]electron['"]|require\(['"]electron['"]\)/.test(s.text))
    expect(bad.map((s) => s.name)).toEqual([])
  })

  it('host/ 里不出现 React 与界面', () => {
    const bad = HOST.filter((s) =>
      /from\s+['"]react(-dom)?['"]|from\s+['"][^'"]*\bui\//.test(s.text),
    )
    expect(bad.map((s) => s.name)).toEqual([])
  })
})

describe('分层约束 · Electron 外壳只做接线', () => {
  const SHELL = sourcesIn(ELECTRON_DIR)

  it('先确认真的读到了文件', () => {
    const names = SHELL.map((s) => s.name)
    expect(names).toContain('main.ts')
    expect(names).toContain('preload.ts')
  })

  it('外壳自己不发网络请求 —— 那是 src/host 的事', () => {
    const bad = SHELL.filter((s) => /\bfetch\s*\(/.test(s.text))
    expect(bad.map((s) => s.name)).toEqual([])
  })

  it('外壳里不写业务逻辑：不 import core/ 的业务模块', () => {
    const bad = SHELL.filter((s) => /from\s+['"][^'"]*\bcore\//.test(s.text))
    expect(bad.map((s) => s.name)).toEqual([])
  })

  /**
   * 0.9.4 的省内存开关。
   *
   * 这三行必须在 `app.whenReady()` **之前**执行 —— 之后再设就不生效了，
   * 而且失效时界面一切正常，只有内存悄悄涨回去，没有别的症状。
   * 所以拿用例钉住顺序，—— 顺序这种事没有别的症状，只能靠用例钉住。
   */
  it('省内存的三个开关都在，而且都在 app.whenReady 之前', () => {
    const main = SHELL.find((s) => s.name === 'main.ts')
    expect(main).toBeDefined()
    const text = main?.text ?? ''

    for (const call of [
      'app.disableHardwareAcceleration()',
      "app.commandLine.appendSwitch('in-process-gpu')",
      "app.commandLine.appendSwitch('enable-low-end-device-mode')",
    ]) {
      const at = text.indexOf(call)
      expect(at, `少了这一句：${call}`).toBeGreaterThan(-1)
      // 找真正的调用（`void app.whenReady`）而不是注释里提到的那个词
      expect(at, `这一句必须在 whenReady 之前：${call}`).toBeLessThan(
        text.indexOf('void app.whenReady'),
      )
    }
  })
})
