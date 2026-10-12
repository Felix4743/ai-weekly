/**
 * 测试入口：把 React 的 `act` 环境打开。
 *
 * 由 `vite.config.ts` 的 `test.setupFiles` 加载，所有测试文件都会跑这一行。
 * 不开的话，用 jsdom 那组测试（`src/ui/peekRating.dom.test.tsx`）每次
 * `act()` 都会打一行 "The current testing environment is not configured to support act(...)"，
 * 而且状态更新不一定被冲刷出来 —— 症状是「点了星但界面没亮」这种假失败。
 */
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
