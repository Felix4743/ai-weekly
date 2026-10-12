import { SCORE_MAX, scoreText } from '../core/stateScore'
import { PeekRating } from './PeekRating'

interface Props {
  /** 星星前面那句话，比如「身体这周几分？」；结果页不写（那一行已经有「身体」这种标签） */
  label?: string
  /** 无障碍名字；默认取 label */
  ariaLabel?: string
  score: number | undefined
  disabled?: boolean
  /** 传 undefined 表示把这颗星点掉了 */
  onChange: (value: number | undefined) => void
}

/**
 * 一排 0–5 星（0.9.8 起换成 PeekRating）。
 *
 * 点第 N 颗 = N 分；**再点同一颗 = 取消**（0 分和没打分在数据里是一回事）。
 * 采访里挂在状态那四段回答下面，结果页挂在状态四行上，两处共用这一个组件 ——
 * 「怎么点」只有一套，省得两边规则悄悄跑偏。
 *
 * 这一层只做一件事：**把「没打分」翻译成组件认的 0**。
 * `stateScore.ts` 里 0 与 undefined 是一回事（都不写这个键），而 PeekRating
 * 只认 0–count，所以这层换算必须有；反过来也一样，组件给 0 就是「取消」。
 * 观感与手势全在 `ui/PeekRating.tsx` 里，这里不许再长别的规则。
 */
export function StateScore({ label, ariaLabel, score, disabled, onChange }: Props) {
  const name = ariaLabel ?? label ?? '评分'
  const value = score === undefined ? 0 : score
  return (
    <div className="state-score">
      {label && <span className="state-score-label">{label}</span>}
      <PeekRating
        value={value}
        count={SCORE_MAX}
        size={22}
        lift={5}
        ariaLabel={name}
        disabled={disabled}
        onChange={(next) => onChange(next === 0 ? undefined : next)}
      />
      <span className="state-score-value">{scoreText(score)}</span>
    </div>
  )
}
