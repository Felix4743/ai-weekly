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
const TRANSPORT_DIR = join(CORE_DIR, '..', 'transport')

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
