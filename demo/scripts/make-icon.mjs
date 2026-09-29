import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { deflateSync, inflateSync } from 'node:zlib'

/**
 * 生成应用图标：build/icon.png（256×256）与 build/icon.ico（7 个尺寸）。
 *
 * 为什么用手算像素：这个仓库刻意不带任何图形依赖（node_modules 只有 101 个包），
 * 为一个图标装 sharp / canvas 不划算。PNG 的规矩很简单 ——
 * 签名 + IHDR + IDAT(zlib 压缩的扫描行) + IEND，每块带一个 CRC32；
 * ICO 更简单 —— 一个头 + 每个尺寸一条 16 字节目录 + 各自的 PNG 原始字节
 * （Vista 之后 ICO 允许直接内嵌 PNG，不必用老的 BMP 格式）。
 *
 * **为什么 .ico 也自己写**：原先只交 PNG，让 electron-builder 自动转 ico。
 * 那个转换会另起一个 node 子进程跑 icons-bundle 里的 icon-tool.js，
 * 而在本机这个环境里子进程分不到内存（实测：堆长到 5MB 就
 * `FATAL ERROR: ... JavaScript heap out of memory`，放大 NODE_OPTIONS 也没用），
 * 于是 `npm run dist` 稳定挂在这一步。自己写 ico 之后，打包这条路不再有子进程。
 *
 * 图案跟界面里的品牌记号一致：圆角方块（--accent #0f766e）+ 一个白色对话气泡。
 * 对话气泡是因为这个产品就是「AI 来问你」。
 *
 * 用法：node scripts/make-icon.mjs
 */

/** 设计稿按 256 画，其它尺寸按比例缩 */
const DESIGN = 256
/** 每个像素取样 N×N 次，边缘才不会有锯齿；小图取多一点 */
const SS_LARGE = 3
const SS_SMALL = 6

/** Windows 上真正会用到的几个尺寸：任务栏 16/24、资源管理器 32/48、大图 256 */
const ICO_SIZES = [16, 24, 32, 48, 64, 128, 256]

const ACCENT_TOP = [18, 137, 127]
const ACCENT_BOTTOM = [11, 93, 87]
const WHITE = [255, 255, 255]

function mix(a, b, t) {
  return [
    Math.round(a[0] + (b[0] - a[0]) * t),
    Math.round(a[1] + (b[1] - a[1]) * t),
    Math.round(a[2] + (b[2] - a[2]) * t),
  ]
}

/** 点是否落在圆角矩形里 */
function inRoundRect(x, y, x0, y0, x1, y1, r) {
  if (x < x0 || x > x1 || y < y0 || y > y1) return false
  const cx = Math.min(Math.max(x, x0 + r), x1 - r)
  const cy = Math.min(Math.max(y, y0 + r), y1 - r)
  const dx = x - cx
  const dy = y - cy
  return dx * dx + dy * dy <= r * r
}

function inCircle(x, y, cx, cy, r) {
  const dx = x - cx
  const dy = y - cy
  return dx * dx + dy * dy <= r * r
}

/** 重心在 (x0,y0) (x1,y1) (x2,y2) 的三角形 */
function inTriangle(x, y, p0, p1, p2) {
  const sign = (a, b, c) => (a[0] - c[0]) * (b[1] - c[1]) - (b[0] - c[0]) * (a[1] - c[1])
  const p = [x, y]
  const d1 = sign(p, p0, p1)
  const d2 = sign(p, p1, p2)
  const d3 = sign(p, p2, p0)
  const hasNeg = d1 < 0 || d2 < 0 || d3 < 0
  const hasPos = d1 > 0 || d2 > 0 || d3 > 0
  return !(hasNeg && hasPos)
}

/**
 * 把设计稿的坐标按比例铺到实际尺寸上。
 * 所有尺寸共用同一份几何 —— 换个尺寸不该是「换一张图」。
 */
function shape(k) {
  const s = (v) => v * k
  return {
    inSquare: (x, y) => inRoundRect(x, y, s(14), s(14), s(242), s(242), s(56)),
    inBubble: (x, y) =>
      inRoundRect(x, y, s(58), s(74), s(198), s(166), s(26)) ||
      inTriangle(x, y, [s(80), s(160)], [s(80), s(202)], [s(118), s(160)]),
    inDot: (x, y) =>
      inCircle(x, y, s(94), s(120), s(11)) ||
      inCircle(x, y, s(128), s(120), s(11)) ||
      inCircle(x, y, s(162), s(120), s(11)),
    gradient: (y) => mix(ACCENT_TOP, ACCENT_BOTTOM, (y - s(14)) / s(228)),
  }
}

/** 一个像素的颜色：先画底、再画气泡、最后画点，超采样求平均 */
function pixelAt(px, py, k, ss) {
  const { inSquare, inBubble, inDot, gradient } = shape(k)
  let r = 0
  let g = 0
  let b = 0
  let hits = 0

  for (let sy = 0; sy < ss; sy++) {
    for (let sx = 0; sx < ss; sx++) {
      const x = px + (sx + 0.5) / ss
      const y = py + (sy + 0.5) / ss
      if (!inSquare(x, y)) continue

      hits += 1
      const color = inDot(x, y) || !inBubble(x, y) ? gradient(y) : WHITE
      r += color[0]
      g += color[1]
      b += color[2]
    }
  }

  const total = ss * ss
  if (hits === 0) return [0, 0, 0, 0]
  // 颜色按实际命中的子样本平均，alpha 按覆盖率 —— 这样边缘不会发黑
  const alpha = Math.round((hits / total) * 255)
  return [Math.round(r / hits), Math.round(g / hits), Math.round(b / hits), alpha]
}

function renderRgba(size) {
  const rgba = Buffer.alloc(size * size * 4)
  const k = size / DESIGN
  const ss = size <= 32 ? SS_SMALL : SS_LARGE
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const [r, g, b, a] = pixelAt(x, y, k, ss)
      const at = (y * size + x) * 4
      rgba[at] = r
      rgba[at + 1] = g
      rgba[at + 2] = b
      rgba[at + 3] = a
    }
  }
  return rgba
}

/* ---------------- 最小 PNG / ICO 编码 ---------------- */

const CRC_TABLE = (() => {
  const table = new Int32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c
  }
  return table
})()

function crc32(buf) {
  let c = 0xffffffff
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length, 0)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body), 0)
  return Buffer.concat([length, body, crc])
}

function encodePng(rgba, size) {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8 // 每通道 8 位
  ihdr[9] = 6 // RGBA
  ihdr[10] = 0
  ihdr[11] = 0
  ihdr[12] = 0

  // 每一行前面加一个过滤字节（0 = 不过滤）
  const stride = size * 4
  const raw = Buffer.alloc((stride + 1) * size)
  for (let y = 0; y < size; y++) {
    raw[y * (stride + 1)] = 0
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride)
  }

  return Buffer.concat([
    signature,
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

/**
 * ICO 容器：6 字节头 + 每个尺寸一条 16 字节目录 + 各自的 PNG 字节。
 * 宽高字段 0 表示 256（一个字节放不下 256）。
 */
function encodeIco(entries) {
  const header = Buffer.alloc(6)
  header.writeUInt16LE(0, 0) // reserved
  header.writeUInt16LE(1, 2) // 1 = icon
  header.writeUInt16LE(entries.length, 4)

  let offset = 6 + entries.length * 16
  const dirs = []
  for (const { size, png } of entries) {
    const dir = Buffer.alloc(16)
    dir[0] = size >= 256 ? 0 : size
    dir[1] = size >= 256 ? 0 : size
    dir[2] = 0 // 调色板颜色数：真彩色填 0
    dir[3] = 0 // reserved
    dir.writeUInt16LE(1, 4) // 色彩平面
    dir.writeUInt16LE(32, 6) // 每像素位数
    dir.writeUInt32LE(png.length, 8)
    dir.writeUInt32LE(offset, 12)
    offset += png.length
    dirs.push(dir)
  }
  return Buffer.concat([header, ...dirs, ...entries.map((e) => e.png)])
}

/* ---------------- 出图 ---------------- */

const here = dirname(fileURLToPath(import.meta.url))
const buildDir = join(here, '..', 'build')
mkdirSync(buildDir, { recursive: true })

const png256 = encodePng(renderRgba(256), 256)
const pngPath = join(buildDir, 'icon.png')
writeFileSync(pngPath, png256)
console.log(`图标已生成：${pngPath}（256×256，${png256.length} 字节）`)

const entries = ICO_SIZES.map((size) => ({ size, png: encodePng(renderRgba(size), size) }))
const ico = encodeIco(entries)
const icoPath = join(buildDir, 'icon.ico')
writeFileSync(icoPath, ico)
console.log(
  `图标已生成：${icoPath}（${ICO_SIZES.join('/')}，共 ${ICO_SIZES.length} 个尺寸，${ico.length} 字节）`,
)

/* ---------------- 自己验一遍 ---------------- */

/**
 * 把刚写出的文件重新解码回来抽点检查。
 * 不是多此一举：这个脚本手写 PNG 与 ICO 编码，而我又看不见图，
 * 至少得证明「写出来的字节确实能解回我想要的图案」。
 */
function decodePng(buf) {
  let at = 8
  let width = 0
  let height = 0
  const idat = []
  while (at < buf.length) {
    const length = buf.readUInt32BE(at)
    const type = buf.toString('ascii', at + 4, at + 8)
    const data = buf.subarray(at + 8, at + 8 + length)
    if (type === 'IHDR') {
      width = data.readUInt32BE(0)
      height = data.readUInt32BE(4)
    }
    if (type === 'IDAT') idat.push(data)
    at += 12 + length
  }
  const raw = inflateSync(Buffer.concat(idat))
  const stride = width * 4
  const at2 = (x, y) => {
    const base = y * (stride + 1) + 1 + x * 4
    return [raw[base], raw[base + 1], raw[base + 2], raw[base + 3]]
  }
  return { width, height, at: at2 }
}

const isAccent = ([r, g, b, a]) => a > 250 && g > 90 && b > 85 && r < 90
const isWhite = ([r, g, b, a]) => a > 250 && r > 240 && g > 240 && b > 240
const isClear = ([, , , a]) => a === 0

const decoded = decodePng(png256)
const checks = [
  ['四角是透明的', isClear(decoded.at(2, 2)) && isClear(decoded.at(253, 253))],
  ['方块顶部是主色', isAccent(decoded.at(128, 40))],
  ['气泡里是白的', isWhite(decoded.at(128, 95)) && isWhite(decoded.at(128, 150))],
  [
    '三个点在气泡里且是主色',
    isAccent(decoded.at(94, 120)) && isAccent(decoded.at(128, 120)) && isAccent(decoded.at(162, 120)),
  ],
  ['两点之间是白的', isWhite(decoded.at(111, 120))],
  ['气泡下面那个尖角也在', isWhite(decoded.at(96, 180))],
  ['尺寸是 256×256', decoded.width === 256 && decoded.height === 256],
]

/* ---------------- ICO 也要解回来验 ---------------- */

function decodeIco(buf) {
  const count = buf.readUInt16LE(4)
  const items = []
  for (let i = 0; i < count; i++) {
    const base = 6 + i * 16
    const width = buf[base] === 0 ? 256 : buf[base]
    const height = buf[base + 1] === 0 ? 256 : buf[base + 1]
    const bytes = buf.readUInt32LE(base + 8)
    const offset = buf.readUInt32LE(base + 12)
    items.push({ width, height, bytes, offset })
  }
  return { type: buf.readUInt16LE(2), count: items.length, items }
}

const icoDecoded = decodeIco(ico)
checks.push(['ICO 头声明的是图标而不是光标', icoDecoded.type === 1])
checks.push([`ICO 里有 ${ICO_SIZES.length} 个尺寸`, icoDecoded.count === ICO_SIZES.length])

let icoShapesOk = true
ICO_SIZES.forEach((size, i) => {
  const item = icoDecoded.items[i]
  // 目录里写的宽高、内嵌 PNG 自己的宽高、我们要的尺寸，三者必须一致
  const inner = decodePng(ico.subarray(item.offset, item.offset + item.bytes))
  const ok = item.width === size && item.height === size && inner.width === size && inner.height === size
  if (!ok) {
    icoShapesOk = false
    console.error(`  ✗ 第 ${i} 项尺寸对不上：目录 ${item.width}×${item.height}，内嵌 ${inner.width}×${inner.height}`)
  }
})
checks.push([`每个尺寸的目录与内嵌 PNG 都自洽（${ICO_SIZES.join('/')}）`, icoShapesOk])

// 小尺寸也要真的是这个图案，而不是一块糊掉的色块。
// 32×32 上的坐标要按 0.125 折算：气泡在 y≈9~21、三个点在 y=15 那一行，
// 所以取点必须避开点本身（取 y=12 是气泡里的白，取 x=16 y=15 是中间那个点）。
const small = decodePng(
  ico.subarray(icoDecoded.items[2].offset, icoDecoded.items[2].offset + icoDecoded.items[2].bytes),
)
checks.push([
  '32×32 那张也是同一个图案（角透明、气泡里是白、点还在）',
  isClear(small.at(1, 1)) && isWhite(small.at(16, 12)) && isAccent(small.at(16, 15)),
])

let bad = 0
for (const [name, ok] of checks) {
  if (!ok) bad += 1
  console.log(`${ok ? '  ✓' : '  ✗'} ${name}`)
}
if (bad > 0) {
  console.error(`自检没过：${bad} 项`)
  process.exit(1)
}
console.log('自检通过：写出的 PNG 与 ICO 都能解回来，图案落在该落的位置。')
