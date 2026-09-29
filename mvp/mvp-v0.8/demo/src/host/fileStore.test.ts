import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createFileStore, readJson, resolveStorePaths, writeJson } from './fileStore'

/**
 * 主进程的落盘逻辑。用真的临时目录跑，不 mock fs ——
 * 「写坏了怎么办」「目录不存在怎么办」这类问题，只有真写文件才测得出来。
 */

let dir = ''

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'ai-weekly-store-'))
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('本地留存 · 文件布局', () => {
  it('配置、会话、周归档是三个文件，清会话不该把 Key 和几个月的记录一起清掉', () => {
    const paths = resolveStorePaths(dir)
    expect(paths.configFile).not.toBe(paths.sessionFile)
    expect(paths.sessionFile).not.toBe(paths.archiveFile)
    expect(paths.configFile.endsWith('config.json')).toBe(true)
    expect(paths.sessionFile.endsWith('session.json')).toBe(true)
    expect(paths.archiveFile.endsWith('weeks.json')).toBe(true)
  })
})

describe('本地留存 · 读写', () => {
  it('写进去再读出来是同一份数据', () => {
    const store = createFileStore(dir)
    store.saveConfig({ apiKey: 'sk-1', baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat' })
    expect(store.loadConfig()).toEqual({
      apiKey: 'sk-1',
      baseUrl: 'https://api.deepseek.com/v1',
      model: 'deepseek-chat',
    })
  })

  it('从来没写过时给 null，而不是抛异常', () => {
    const store = createFileStore(dir)
    expect(store.loadConfig()).toBeNull()
    expect(store.loadSession()).toBeNull()
    expect(store.loadArchive()).toBeNull()
  })

  it('周归档能往返：写进 weeks.json，读回来还是那几周', () => {
    const store = createFileStore(dir)
    const weeks = [
      { week: '2026-09-21', savedAt: 200, result: { events: ['改方案'], highlights: ['被方案拖着'] } },
      { week: '2026-09-14', savedAt: 100, result: { events: [], highlights: ['上一周'] } },
    ]
    store.saveArchive(weeks)
    expect(store.loadArchive()).toEqual(weeks)
    // 落在自己的文件里，不去碰别的
    expect(existsSync(resolveStorePaths(dir).archiveFile)).toBe(true)
    expect(store.loadSession()).toBeNull()
    expect(store.loadConfig()).toBeNull()
  })

  it('清会话不会把周归档一起清掉', () => {
    const store = createFileStore(dir)
    store.saveArchive([{ week: '2026-09-21', savedAt: 1, result: {} }])
    store.saveSession({ messages: [], result: {}, savedAt: 1 })
    store.clearSession()
    expect(store.loadSession()).toBeNull()
    expect(store.loadArchive()).toHaveLength(1)
  })

  it('目录不存在时自己建出来', () => {
    const nested = join(dir, 'a', 'b', 'c')
    writeJson(join(nested, 'x.json'), { ok: true })
    expect(readJson(join(nested, 'x.json'))).toEqual({ ok: true })
  })

  it('文件被写坏了当成没有，不把应用带崩', () => {
    const store = createFileStore(dir)
    store.saveConfig({ apiKey: 'sk-1', baseUrl: 'x', model: 'y' })
    writeFileSync(resolveStorePaths(dir).configFile, '{"apiKey": "sk-1"', 'utf8')
    expect(store.loadConfig()).toBeNull()
  })

  it('空文件也算没有', () => {
    const store = createFileStore(dir)
    writeFileSync(resolveStorePaths(dir).configFile, '   \n', 'utf8')
    expect(store.loadConfig()).toBeNull()
  })

  it('写盘用的是「先写临时文件再改名」，不会留下半截文件', () => {
    const store = createFileStore(dir)
    store.saveConfig({ apiKey: 'sk-2', baseUrl: 'x', model: 'y' })
    const leftovers = readdirSync(dir).filter((f) => f.endsWith('.tmp'))
    expect(leftovers).toEqual([])
    // 内容必须是完整合法的 JSON，一个字符都不能少
    expect(JSON.parse(readFileSync(resolveStorePaths(dir).configFile, 'utf8'))).toMatchObject({
      apiKey: 'sk-2',
    })
  })
})

describe('本地留存 · 清会话', () => {
  it('只删会话，配置留着', () => {
    const store = createFileStore(dir)
    store.saveConfig({ apiKey: 'sk-3', baseUrl: 'x', model: 'y' })
    store.saveSession({ messages: [], result: {}, savedAt: 1 })
    store.clearSession()

    expect(store.loadSession()).toBeNull()
    expect(store.loadConfig()).toMatchObject({ apiKey: 'sk-3' })
  })

  it('没有会话时清一次也不报错', () => {
    expect(() => createFileStore(dir).clearSession()).not.toThrow()
  })
})
