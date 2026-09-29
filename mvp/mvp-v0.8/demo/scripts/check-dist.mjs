import { existsSync, readdirSync } from 'node:fs'

/**
 * 构建产物体检：`dist/assets` 里只应该有这一版的一对 js / css。
 *
 * 为什么单独有这么个东西：
 * Vite 的 `emptyOutDir` 是「逐个 rmSync，失败就静默跳过」，而**本工作区里 Node
 * 删不掉工作区内的文件**（我在根目录、dist、dist/assets、dist-electron、live-output
 * 和一个新建目录里各放一个探针验证过：删除调用正常返回、文件依然在；只有系统临时目录能删）。
 * 结果就是每构建一次就往 dist/assets 里再堆一份，而 electron-builder 是按 `dist/**`
 * 全量打包的 —— 安装包里悄悄多出一堆死文件。
 *
 * 更坑的是它会让「在 asar 里按字符串查新代码在不在」这种验证失效：
 * 旧包里恰好有同名文案时，查出来的命中的是旧文件。已经骗过我一次。
 *
 * 这里不负责清理（清理交给删得动的 shell），只负责把沉默的问题变成一条响亮的报错。
 */

const ASSETS = 'dist/assets'
const EXPECTED = /^index-[\w-]+\.(js|css)$/

if (!existsSync(ASSETS)) {
  console.error(`找不到 ${ASSETS} —— 先跑 npm run build`)
  process.exit(1)
}

const files = readdirSync(ASSETS)
const js = files.filter((f) => f.endsWith('.js'))
const css = files.filter((f) => f.endsWith('.css'))
const junk = files.filter((f) => !EXPECTED.test(f))
const duplicates = Math.max(0, js.length - 1) + Math.max(0, css.length - 1)

if (junk.length > 0 || duplicates > 0) {
  console.error('')
  console.error(`✗ dist/assets 里有多余产物：共 ${files.length} 个文件（js ${js.length} / css ${css.length}）`)
  if (duplicates > 0) console.error('  历史构建留下的旧包没被清掉 —— 它们会被一起打进安装包')
  if (junk.length > 0) console.error(`  不认识的产物：${junk.join(', ')}`)
  console.error('')
  console.error('  清掉再重新构建（本工作区里 Node 删不掉，得用 shell）：')
  console.error('    Remove-Item demo/dist -Recurse -Force      # PowerShell')
  console.error('    rmdir /s /q demo\\dist                       # cmd')
  console.error('')
  process.exit(1)
}

console.log(`✓ dist/assets 干净：${js.length} 个 js、${css.length} 个 css`)
