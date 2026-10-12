/**
 * 自绘图标（0.9.7 UI 改造）。
 *
 * 为什么自己画：界面里本来一个图标都没有 —— 展开/收起是纯文字、顶栏两个按钮是纯文字、
 * 「填入示例回答」前面那个箭头是字符 `↳`。换成图形能省掉一半文字，但**不引依赖**是这条
 * 项目的底线（`demo/package.json` 里连一个 UI 库都没有），所以就用 24×24 的线性 SVG 手画几个。
 *
 * 统一约定：`viewBox="0 0 24 24"`、`stroke="currentColor"`、`strokeWidth 1.8`、圆头圆角，
 * 尺寸由调用方给（默认 16，跟 13~15px 的文字并排正好）。颜色一律跟着父级 color 走，
 * 需要变色时改 CSS 的 color 就够，不要在 JSX 里写死颜色。
 */

type IconProps = {
  size?: number
  className?: string
}

/** 所有图标共用的那一堆属性；`aria-hidden` 保证读屏不会把装饰图形念出来。 */
function svgProps(size: number, className?: string) {
  return {
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.8,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    className,
    'aria-hidden': true,
    focusable: false,
  }
}

/** 展开 / 收起用，配合 CSS 转 180°。 */
export function IconChevron({ size = 16, className }: IconProps) {
  return (
    <svg {...svgProps(size, className)}>
      <path d="M6 9.5l6 6 6-6" />
    </svg>
  )
}

/** 总览（顶栏）：柱状图。 */
export function IconChart({ size = 16, className }: IconProps) {
  return (
    <svg {...svgProps(size, className)}>
      <path d="M4 20h16" />
      <path d="M7 20v-6" />
      <path d="M12 20V8" />
      <path d="M17 20v-9" />
    </svg>
  )
}

/** 设置（顶栏）：齿轮。 */
export function IconGear({ size = 16, className }: IconProps) {
  return (
    <svg {...svgProps(size, className)}>
      <circle cx="12" cy="12" r="3.2" />
      <path d="M12 3.5v2M12 18.5v2M4.9 7.8l1.7 1M17.4 15.2l1.7 1M4.9 16.2l1.7-1M17.4 8.8l1.7-1" />
    </svg>
  )
}

/** 复制全文。 */
export function IconCopy({ size = 16, className }: IconProps) {
  return (
    <svg {...svgProps(size, className)}>
      <rect x="9" y="9" width="11" height="11" rx="2.5" />
      <path d="M15 5.5A2.5 2.5 0 0012.5 3H6.5A2.5 2.5 0 004 5.5v6A2.5 2.5 0 006.5 14" />
    </svg>
  )
}

/** 发送。 */
export function IconSend({ size = 16, className }: IconProps) {
  return (
    <svg {...svgProps(size, className)}>
      <path d="M4.5 12h6" />
      <path d="M5.2 5.6l14 6.4-14 6.4 2.2-6.4-2.2-6.4z" />
    </svg>
  )
}

/** 这题跳过：向前跳。 */
export function IconSkip({ size = 16, className }: IconProps) {
  return (
    <svg {...svgProps(size, className)}>
      <path d="M6 6l7 6-7 6" />
      <path d="M18 6v12" />
    </svg>
  )
}

/** 生成梳理：小星星（不是「AI」两个字，但一眼能看出是机器生成的东西）。 */
export function IconSparkle({ size = 16, className }: IconProps) {
  return (
    <svg {...svgProps(size, className)}>
      <path d="M12 3.5l1.6 4.4 4.4 1.6-4.4 1.6L12 15.5l-1.6-4.4L6 9.5l4.4-1.6L12 3.5z" />
      <path d="M18.5 16.5l.7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7.7-1.8z" />
    </svg>
  )
}

/** 加一条 / 加一个人。 */
export function IconPlus({ size = 16, className }: IconProps) {
  return (
    <svg {...svgProps(size, className)}>
      <path d="M12 5.5v13M5.5 12h13" />
    </svg>
  )
}

/** 示例回答 / 建议：一支笔。 */
export function IconWand({ size = 16, className }: IconProps) {
  return (
    <svg {...svgProps(size, className)}>
      <path d="M15.5 4.5l4 4L9 19H5v-4l10.5-10.5z" />
      <path d="M13.5 6.5l4 4" />
    </svg>
  )
}

/** 对勾：聊完一块、保存成功这类状态。 */
export function IconCheck({ size = 16, className }: IconProps) {
  return (
    <svg {...svgProps(size, className)}>
      <path d="M5 12.5l4.5 4.5L19 7" />
    </svg>
  )
}

/** 回到上一页 / 返回。 */
export function IconBack({ size = 16, className }: IconProps) {
  return (
    <svg {...svgProps(size, className)}>
      <path d="M11 5l-7 7 7 7" />
      <path d="M4 12h16" />
    </svg>
  )
}

/** 删掉一条随手记：一个叉。 */
export function IconClose({ size = 16, className }: IconProps) {
  return (
    <svg {...svgProps(size, className)}>
      <path d="M6.5 6.5l11 11M17.5 6.5l-11 11" />
    </svg>
  )
}

/** 重来一次：环形箭头。 */
export function IconRefresh({ size = 16, className }: IconProps) {
  return (
    <svg {...svgProps(size, className)}>
      <path d="M20 12a8 8 0 11-2.6-5.9" />
      <path d="M20 4.5V10h-5.5" />
    </svg>
  )
}
