/**
 * 卡片上的柔光斑（0.9.10，React Bits 的 Spotlight Card 那一路）。
 *
 * 指针划过卡片时，有一团很淡的青绿光跟着走。做成**两个事件处理器**而不是包一层组件：
 * 现有的卡片带着自己的 `id`、`aria-label`、伪元素，包一层就要动 DOM 结构，
 * 而这里真的只需要在 `<section>` 上多两个 `onPointer*`。
 *
 * 分工：JS 只负责把指针位置写成 `--spot-x / --spot-y` 并挂上 `data-spot="on"`，
 * 光斑长什么样全在 CSS（`.spotlight`）里 —— 这样换主题时不用改一行 JS。
 */

/** 挂到卡片上的类名，CSS 里那份 `.spotlight::after` 认它 */
export const SPOTLIGHT_CLASS = 'spotlight'

type PointerLike = {
  currentTarget: HTMLElement
  clientX: number
  clientY: number
}

/** 指针动：把「相对卡片左上角」的坐标写进 CSS 变量 */
export function trackSpotlight(e: PointerLike) {
  const el = e.currentTarget
  const box = el.getBoundingClientRect()
  el.style.setProperty('--spot-x', `${Math.round(e.clientX - box.left)}px`)
  el.style.setProperty('--spot-y', `${Math.round(e.clientY - box.top)}px`)
  el.dataset.spot = 'on'
}

/** 指针离开：把光斑淡掉（CSS 那边靠 `data-spot` 切换透明度） */
export function clearSpotlight(e: { currentTarget: HTMLElement }) {
  delete e.currentTarget.dataset.spot
}

/**
 * 一串现成的属性，铺到卡片上就行：
 * `<section className={`card spotlight ${SPOTLIGHT_CLASS}`} {...spotlightProps()}>`
 *
 * 注意 `onPointerLeave` 而不是 `onPointerOut` —— 后者在移到子元素上时也会触发，
 * 光斑会一格一格地闪。
 */
export function spotlightProps() {
  return {
    onPointerMove: trackSpotlight,
    onPointerLeave: clearSpotlight,
  }
}
