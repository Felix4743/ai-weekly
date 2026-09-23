import { build } from 'esbuild'

/**
 * 把 Electron 的两个入口打出来。
 *
 * 为什么用 esbuild 而不是让 electron 直接读 TypeScript：
 * 主进程要复用 src/host 与 src/shared 里的 TS 代码，跑 tsc 出 CJS 会带出一堆
 * 中间产物与模块后缀问题；esbuild 一次打包成两个文件，产物就是最终要跑的代码。
 *
 * 只打两个入口，不额外引依赖：
 * - main.cjs    主进程（开窗口 + 接线）
 * - preload.cjs 预加载（唯一那座桥）
 * electron 本身由运行时提供，不能打进包里。
 *
 * 后缀用 .cjs 而不是 .js：package.json 里是 "type": "module"，
 * 叫 .js 的话这份 CJS 产物会被 Node 当成 ESM 加载，一启动就报错。
 */

const shared = {
  bundle: true,
  platform: 'node',
  // 与 Electron 自带的 Node 版本对齐，别用太新的语法
  target: 'node20',
  format: 'cjs',
  sourcemap: true,
  logLevel: 'info',
  external: ['electron'],
}

await build({ ...shared, entryPoints: ['electron/main.ts'], outfile: 'dist-electron/main.cjs' })
await build({ ...shared, entryPoints: ['electron/preload.ts'], outfile: 'dist-electron/preload.cjs' })

process.stdout.write('dist-electron/ 已生成：main.cjs + preload.cjs\n')
