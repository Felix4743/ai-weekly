import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

/**
 * 主进程侧的本地留存：两个 JSON 文件，配置一份、最近一次会话一份。
 *
 * 刻意只做「读一个文件 / 写一个文件 / 删一个文件」这一层，不认识 AppConfig
 * 和 WeeklyResult 长什么样 —— 形状的校验在 storage/shape.ts 里，两边共用。
 * 这样这个模块不需要 Electron 也能测：给一个临时目录就能跑。
 */

export interface StorePaths {
  configFile: string
  sessionFile: string
}

/** 配置与会话分开存放：清会话不该把 API Key 一起清掉 */
export function resolveStorePaths(dir: string): StorePaths {
  return {
    configFile: join(dir, 'config.json'),
    sessionFile: join(dir, 'session.json'),
  }
}

/** 读一个 JSON 文件；不存在、读不动、半截损坏，一律当「没有」 */
export function readJson(file: string): unknown {
  try {
    if (!existsSync(file)) return null
    const raw = readFileSync(file, 'utf8')
    if (!raw.trim()) return null
    return JSON.parse(raw) as unknown
  } catch {
    return null
  }
}

/**
 * 写 JSON 文件。先写临时文件再改名：
 * 直接覆盖写的时候中途断电，会留下一个语法都不合法的半截文件，
 * 下次启动读到的就是永久损坏的配置。
 */
export function writeJson(file: string, value: unknown): void {
  mkdirSync(dirname(file), { recursive: true })
  const tmp = `${file}.tmp`
  writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
  renameSync(tmp, file)
}

export function removeJson(file: string): void {
  try {
    rmSync(file, { force: true })
  } catch {
    /* 删不掉也不算致命：下次写入会覆盖 */
  }
}

export interface FileStore {
  loadConfig(): unknown
  saveConfig(config: unknown): void
  loadSession(): unknown
  saveSession(session: unknown): void
  clearSession(): void
}

export function createFileStore(dir: string): FileStore {
  const paths = resolveStorePaths(dir)
  return {
    loadConfig: () => readJson(paths.configFile),
    saveConfig: (config) => writeJson(paths.configFile, config),
    loadSession: () => readJson(paths.sessionFile),
    saveSession: (session) => writeJson(paths.sessionFile, session),
    clearSession: () => removeJson(paths.sessionFile),
  }
}
