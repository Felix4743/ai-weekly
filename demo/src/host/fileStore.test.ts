import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createFileStore, readJson, resolveStorePaths, writeJson } from './fileStore'

/**
 * 主进程的落盘逻辑。用真的临时目录跑，不 mock fs ——
 * 「写坏了怎么办」「目录不存在怎么办」这类问题，只有真写文件才测得出来。
 *
 * 0.9.0 起只有两个文件：配置一份、按周归档一份。会话文件随着采访流程一起删掉了，
 * 这里也要钉住「清一份不会碰到另一份」。
 */

let dir = ''

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'ai-weekly-store-'))
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('本地留存 · 文件布局', () => {
  it('只有配置与周归档两个文件，会话文件随采访流程一起删掉了', () => {
    const paths = resolveStorePaths(dir)
    expect(paths.configFile.endsWith('config.json')).toBe(true)
    expect(paths.archiveFile.endsWith('weeks.json')).toBe(true)
    expect(paths.configFile).not.toBe(paths.archiveFile)
    expect(Object.keys(paths).sort()).toEqual(['archiveFile', 'configFile'])
  })

  it('存储只有四个方法：读配置、写配置、读归档、写归档', () => {
    expect(Object.keys(createFileStore(dir)).sort()).toEqual([
      'loadArchive',
      'loadConfig',
      'saveArchive',
      'saveConfig',
    ])
  })
})

describe('本地留存 · JSON 读写', () => {
  it('写进去再读出来是同一份数据', () => {
    const store = createFileStore(dir)
    store.saveConfig({
      apiKey: 'sk-1',
      baseUrl: 'https://api.deepseek.com/v1',
      model: 'deepseek-chat',
    })
    expect(store.loadConfig()).toEqual({
      apiKey: 'sk-1',
      baseUrl: 'https://api.deepseek.com/v1',
      model: 'deepseek-chat',
    })
  })

  it('从来没写过时给 null，而不是抛异常', () => {
    const store = createFileStore(dir)
    expect(store.loadConfig()).toBeNull()
    expect(store.loadArchive()).toBeNull()
  })

  it('文件被写坏了当成没有，不把应用带崩', () => {
    const store = createFileStore(dir)
    store.saveConfig({ apiKey: 'sk-1', baseUrl: 'x', model: 'y' })
    writeFileSync(resolveStorePaths(dir).configFile, '{"apiKey": "sk-1"', 'utf8')
    expect(store.loadConfig()).toBeNull()
  })

  it('空文件、只有空白、内容是 null 都算没有', () => {
    const file = resolveStorePaths(dir).configFile
    writeFileSync(file, '   \n', 'utf8')
    expect(readJson(file)).toBeNull()
    writeFileSync(file, 'null', 'utf8')
    expect(readJson(file)).toBeNull()
    writeFileSync(file, '', 'utf8')
    expect(readJson(file)).toBeNull()
  })

  it('目录不存在时自己建出来', () => {
    const nested = join(dir, 'a', 'b', 'c')
    writeJson(join(nested, 'x.json'), { ok: true })
    expect(readJson(join(nested, 'x.json'))).toEqual({ ok: true })
  })

  it('写盘用的是「先写临时文件再改名」，不会留下半截文件', () => {
    const file = resolveStorePaths(dir).configFile
    writeJson(file, { apiKey: 'sk-2' })

    // 临时文件已经改名成正式文件，目录里不该再有 .tmp
    expect(readdirSync(dir)).toEqual(['config.json'])

    // 内容必须是完整合法的 JSON，一个字符都不能少，且缩进好读
    const raw = readFileSync(file, 'utf8')
    expect(JSON.parse(raw)).toEqual({ apiKey: 'sk-2' })
    expect(raw.endsWith('\n')).toBe(true)
    expect(raw).toContain('\n  "apiKey"')
  })

  it('再写一次是整份替换，不是追加', () => {
    const file = resolveStorePaths(dir).configFile
    writeJson(file, { apiKey: 'sk-2', model: 'a' })
    writeJson(file, { apiKey: 'sk-3' })
    expect(readJson(file)).toEqual({ apiKey: 'sk-3' })
  })
})

describe('本地留存 · 两份数据互不打扰', () => {
  it('写配置不碰周归档，写归档不碰配置', () => {
    const store = createFileStore(dir)
    const paths = resolveStorePaths(dir)

    store.saveConfig({ apiKey: 'sk-1', baseUrl: 'x', model: 'y' })
    expect(existsSync(paths.archiveFile)).toBe(false)

    store.saveArchive([{ week: '2026-09-21', savedAt: 200, notes: '原文', review: null }])
    expect(readJson(paths.configFile)).toMatchObject({ apiKey: 'sk-1' })
    expect(store.loadArchive()).toHaveLength(1)
  })

  it('周归档能往返：写进 weeks.json，读回来还是那几周', () => {
    const store = createFileStore(dir)
    const weeks = [
      {
        week: '2026-09-21',
        savedAt: 200,
        notes: '这周改了三版方案',
        review: {
          headline: '被方案拖着',
          did: ['改了三版方案'],
          issues: [],
          reconcile: [],
          plan: [],
          nudge: '',
        },
      },
      { week: '2026-09-14', savedAt: 100, notes: '上周的原文', review: null },
    ]
    store.saveArchive(weeks)

    expect(store.loadArchive()).toEqual(weeks)
    expect(existsSync(resolveStorePaths(dir).archiveFile)).toBe(true)
    expect(store.loadConfig()).toBeNull()
  })

  it('归档文件坏了时读回来是 null，别的文件照常读', () => {
    const store = createFileStore(dir)
    store.saveConfig({ apiKey: 'sk-4', baseUrl: 'x', model: 'y' })
    writeFileSync(resolveStorePaths(dir).archiveFile, '[{"week": "2026-09-21"', 'utf8')
    expect(store.loadArchive()).toBeNull()
    expect(store.loadConfig()).toMatchObject({ apiKey: 'sk-4' })
  })
})
