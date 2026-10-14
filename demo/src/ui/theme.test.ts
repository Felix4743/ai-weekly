// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { applyTheme, readTheme, toggleTheme } from './theme'

/**
 * 主题开关（0.9.10）。
 *
 * 这几条守的是「切一次就记住、下次打开还是它」这条承诺 —— 纯逻辑，
 * 但读写的是 localStorage 与 `<html data-theme>`，所以顶上要 jsdom。
 * 真实的颜色长什么样不归测试管，那是 CSS 那一大块 `[data-theme='dark']` 的事。
 */

/** jsdom 默认没有 matchMedia，按需装一个假的系统偏好 */
function stubSystemDark(dark: boolean) {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: dark && query.includes('prefers-color-scheme: dark'),
    media: query,
    addEventListener() {},
    removeEventListener() {},
  }))
}

beforeEach(() => {
  localStorage.clear()
  delete document.documentElement.dataset.theme
  stubSystemDark(false)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('readTheme', () => {
  it('什么都没存、系统也不偏暗时，用亮色', () => {
    expect(readTheme()).toBe('light')
  })

  it('存过就只认存的那份', () => {
    localStorage.setItem('ai-weekly.theme', 'dark')
    expect(readTheme()).toBe('dark')

    // 反过来：存了亮色，系统再偏暗也还是亮色
    localStorage.setItem('ai-weekly.theme', 'light')
    stubSystemDark(true)
    expect(readTheme()).toBe('light')
  })

  it('存的值不认识时当没存过', () => {
    localStorage.setItem('ai-weekly.theme', '柠檬')
    expect(readTheme()).toBe('light')
  })

  it('没存过时跟随系统偏好', () => {
    stubSystemDark(true)
    expect(readTheme()).toBe('dark')
  })
})

describe('applyTheme', () => {
  it('深色挂到 <html data-theme> 上', () => {
    applyTheme('dark')
    expect(document.documentElement.dataset.theme).toBe('dark')
  })

  it('切回亮色时把属性摘掉，不留一个 data-theme="light"', () => {
    applyTheme('dark')
    applyTheme('light')
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false)
  })
})

describe('toggleTheme', () => {
  it('切回来、记下来、也立刻生效', () => {
    expect(toggleTheme('light')).toBe('dark')
    expect(localStorage.getItem('ai-weekly.theme')).toBe('dark')
    expect(document.documentElement.dataset.theme).toBe('dark')

    expect(toggleTheme('dark')).toBe('light')
    expect(localStorage.getItem('ai-weekly.theme')).toBe('light')
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false)
  })

  it('localStorage 写不进去也照样切（顶多这次会话有效，不报错）', () => {
    const broken = {
      getItem: () => {
        throw new Error('拿不到')
      },
      setItem: () => {
        throw new Error('存不下')
      },
      clear: () => {},
    }
    vi.stubGlobal('localStorage', broken)

    expect(readTheme()).toBe('light')
    expect(toggleTheme('light')).toBe('dark')
    expect(document.documentElement.dataset.theme).toBe('dark')
  })
})
