import { defineConfig } from 'vitest/config'

/**
 * 真模型试跑台专用配置 —— 刻意**不**混进 npm test。
 *
 * 项目的招牌之一是「266 个用例一个都不依赖网络」。真模型试跑必须联网、要花钱、
 * 还慢，所以它单独一个 include：只有 `npm run try:model` 会碰它。
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['live/**/*.live.ts'],
    // 一整场采访 30 来轮，每轮都是一次真实的流式请求
    testTimeout: 900_000,
    hookTimeout: 120_000,
    // 报告要一行行看清，别被 vitest 的进度条搅乱
    reporters: ['basic'],
  },
})
