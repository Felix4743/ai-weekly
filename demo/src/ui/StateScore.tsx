import { SCORE_MAX, scoreText } from '../core/stateScore'

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
 * 一排 0–5 星。
 *
 * 点第 N 颗 = N 分；**再点同一颗 = 取消**（0 分和没打分在数据里是一回事）。
 * 采访里挂在状态那四段回答下面，结果页挂在状态四行上，两处共用这一个组件 ——
 * 「怎么点」只有一套，省得两边规则悄悄跑偏。
 */
export function StateScore({ label, ariaLabel, score, disabled, onChange }: Props) {
  const name = ariaLabel ?? label ?? '评分'
  return (
    <div className="state-score">
      {label && <span className="state-score-label">{label}</span>}
      <span className="stars" role="group" aria-label={name}>
        {Array.from({ length: SCORE_MAX }, (_, i) => i + 1).map((n) => {
          const on = score !== undefined && n <= score
          return (
            <button
              key={n}
              type="button"
              className={`star${on ? ' on' : ''}`}
              aria-pressed={on}
              aria-label={`${name} ${n} 星`}
              title={n === score ? '再点一下取消' : `${n} 星`}
              disabled={disabled}
              onClick={() => onChange(n === score ? undefined : n)}
            >
              ★
            </button>
          )
        })}
      </span>
      <span className="state-score-value">{scoreText(score)}</span>
    </div>
  )
}
