import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { deflateSync, inflateSync } from 'node:zlib'

/**
 * 生成应用图标（build/icon.png，256×256）。
 *
 * 为什么用手算像素：这个仓库刻意不带任何图形依赖（node_modules 只有 101 个包），
 * 为一个图标装 sharp / canvas 不划算。PNG 的规矩很简单 ——
 * 签名 + IHDR + IDAT(zlib 压缩的扫描行) + IEND，每块带一个 CRC32。
 *
 * 图案跟界面里的品牌记号一致：圆角方块（--accent #0f766e）+ 一个白色对话气泡。
 * 对话气泡是因为这个产品就是「AI 来问你」。
 *
 * 用法：node scripts/make-icon.mjs
 * 产物 build/icon.png 由 electron-builder 自动转成 Windows 的 .ico。
 */

const SIZE = 256
/** 每个像素取样 3×3 次，边缘才不会有锯齿 */
const SS = 3

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

const TAIL = [
  [80, 160],
  [80, 202],
  [118, 160],
]

function inBubble(x, y) {
  return inRoundRect(x, y, 58, 74, 198, 166, 26) || inTriangle(x, y, TAIL[0], TAIL[1], TAIL[2])
}

function inDot(x, y) {
  return inCircle(x, y, 94, 120, 11) || inCircle(x, y, 128, 120, 11) || inCircle(x, y, 162, 120, 11)
}

/** 一个像素的颜色：先画底、再画气泡、最后画点，超采样求平均 */
function pixel(px, py) {
  let r = 0
  let g = 0
  let b = 0
  let hits = 0

  for (let sy = 0; sy < SS; sy++) {
    for (let sx = 0; sx < SS; sx++) {
      const x = px + (sx + 0.5) / SS
      const y = py + (sy + 0.5) / SS
      if (!inRoundRect(x, y, 14, 14, 242, 242, 56)) continue

      hits += 1
      let color
      if (inDot(x, y)) {
        color = mix(ACCENT_TOP, ACCENT_BOTTOM, (y - 14) / 228)
      } else if (inBubble(x, y)) {
        color = WHITE
      } else {
        color = mix(ACCENT_TOP, ACCENT_BOTTOM, (y - 14) / 228)
      }
      r += color[0]
      g += color[1]
      b += color[2]
    }
  }

  const total = SS * SS
  if (hits === 0) return [0, 0, 0, 0]
  // 颜色按实际命中的子样本平均，alpha 按覆盖率 —— 这样边缘不会发黑
  const alpha = Math.round((hits / total) * 255)
  return [Math.round(r / hits), Math.round(g / hits), Math.round(b / hits), alpha]
}

/* ---------------- 最小 PNG 编码 ---------------- */

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

/* ---------------- 出图 ---------------- */

const rgba = Buffer.alloc(SIZE * SIZE * 4)
for (let y = 0; y < SIZE; y++) {
  for (let x = 0; x < SIZE; x++) {
    const [r, g, b, a] = pixel(x, y)
    const at = (y * SIZE + x) * 4
    rgba[at] = r
    rgba[at + 1] = g
    rgba[at + 2] = b
    rgba[at + 3] = a
  }
}

const here = dirname(fileURLToPath(import.meta.url))
const out = join(here, '..', 'build', 'icon.png')
mkdirSync(dirname(out), { recursive: true })
const png = encodePng(rgba, SIZE)
writeFileSync(out, png)
console.log(`图标已生成：${out}（${SIZE}×${SIZE}，${png.length} 字节）`)

/* ---------------- 自己验一遍 ---------------- */

/**
 * 把刚写出的文件重新解码回来抽点检查。
 * 不是多此一举：这个脚本手写 PNG 编码，而我又看不见图，
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

const decoded = decodePng(png)
const isAccent = ([r, g, b, a]) => a > 250 && g > 90 && b > 85 && r < 90
const isWhite = ([r, g, b, a]) => a > 250 && r > 240 && g > 240 && b > 240
const isClear = ([, , , a]) => a === 0

const checks = [
  ['四角是透明的', isClear(decoded.at(2, 2)) && isClear(decoded.at(253, 253))],
  ['方块顶部是主色', isAccent(decoded.at(128, 40))],
  ['气泡里是白的', isWhite(decoded.at(128, 95)) && isWhite(decoded.at(128, 150))],
  ['三个点在气泡里且是主色', isAccent(decoded.at(94, 120)) && isAccent(decoded.at(128, 120)) && isAccent(decoded.at(162, 120))],
  ['两点之间是白的', isWhite(decoded.at(111, 120))],
  ['气泡下面那个尖角也在', isWhite(decoded.at(96, 180))],
  ['尺寸是 256×256', decoded.width === 256 && decoded.height === 256],
]

let bad = 0
for (const [name, ok] of checks) {
  if (!ok) bad += 1
  console.log(`${ok ? '  ✓' : '  ✗'} ${name}`)
}
if (bad > 0) {
  console.error(`自检没过：${bad} 项`)
  process.exit(1)
}
console.log('自检通过：写出的 PNG 能解回来，图案落在该落的位置。')
