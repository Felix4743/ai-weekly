/**
 * 主题开关（0.9.10）。
 *
 * 为什么单独一个文件：主题是**纯界面偏好**，不进 `core/types.ts` 那份 WeeklyResult，
 * 也不进设置里那份 config —— 那两处一改就要动提示词、归档格式和一堆测试，
 * 而「界面亮还是暗」跟这周记了什么一点关系都没有。
 * 所以它只活在渲染进程里：`localStorage` 存一个字符串，`<html data-theme>` 供 CSS 认。
 *
 * 分层：这个文件用 document / localStorage，属于 ui 层，core 里不许出现它。
 */

export type Theme = 'light' | 'dark'

/** localStorage 的键。带上项目前缀，免得跟同域别的东西撞。 */
const KEY = 'ai-weekly.theme'

/**
 * 读出当前该用哪套主题。
 *
 * 顺序：存过的 → 系统偏好 → 亮色。
 * 第一次打开时跟随系统（`prefers-color-scheme`），用户一旦手动切过就只认存的那份。
 * 读不到一律当亮色 —— 这个工具的默认样子就是暖纸色。
 */
export function readTheme(): Theme {
  try {
    const saved = localStorage.getItem(KEY)
    if (saved === 'light' || saved === 'dark') return saved
  } catch {
    // 隐私模式之类拿不到 localStorage：不影响使用，当没存过
  }
  try {
    if (window.matchMedia?.('(prefers-color-scheme: dark)').matches) return 'dark'
  } catch {
    // matchMedia 都没有的环境（老 jsdom）也照常走亮色
  }
  return 'light'
}

/**
 * 把主题落到 `<html data-theme>` 上，CSS 里那一整块 `[data-theme='dark']` 就生效了。
 * 传 'light' 时把属性摘掉 —— 亮色是 :root 的默认值，不留属性也让 DOM 干净些。
 */
export function applyTheme(theme: Theme) {
  const root = document.documentElement
  if (theme === 'dark') root.dataset.theme = 'dark'
  else delete root.dataset.theme
}

/** 切换并记下来，返回切换后的值。 */
export function toggleTheme(current: Theme): Theme {
  const next: Theme = current === 'dark' ? 'light' : 'dark'
  try {
    localStorage.setItem(KEY, next)
  } catch {
    // 存不下就只在这次会话里生效，不报错、不打断
  }
  applyTheme(next)
  return next
}
