import type { StateKey } from './types'

/**
 * 状态四行的元数据：身体 / 情绪 / 精力 / 心智。
 *
 * 一份定义三处用：结果页那四行（标签 + 输入框提示）、采访里星星旁边那句问法、
 * 「复制全文」里的小标题。所以放 core 而不是 ui —— 文案散成两三份，
 * 迟早出现「结果页叫精力、导出叫专注」这种事。
 */
export interface StateField {
  key: StateKey
  /** 结果页与导出里的行首标签 */
  label: string
  /** 输入框提示 */
  placeholder: string
  /** 采访里问完这一项，星星旁边那句 */
  ask: string
}

export const STATE_FIELDS: StateField[] = [
  {
    key: 'body',
    label: '身体',
    placeholder: '睡眠、运动、吃饭…',
    ask: '身体这周几分？',
  },
  {
    key: 'mood',
    label: '情绪',
    placeholder: '这周心里怎么样…',
    ask: '心情这周几分？',
  },
  {
    key: 'focus',
    label: '精力',
    placeholder: '什么时候状态最好…',
    ask: '精力这周几分？',
  },
  {
    key: 'growth',
    label: '心智',
    placeholder: '读了什么、学到什么…',
    ask: '这周学到的东西，几分？',
  },
]

export function stateField(key: StateKey): StateField | undefined {
  return STATE_FIELDS.find((f) => f.key === key)
}
