import type { StateKey } from './types'

/**
 * 状态四项的元数据：心情 / 睡眠 / 运动 / 饮食（用户 2026-10-03 定的四项）。
 *
 * 一份定义三处用：开场打分卡上的四排星、结果页与「复制全文」里的行首标签。
 * 所以放 core 而不是 ui —— 文案散成两三份，迟早出现「结果页叫睡眠、导出叫睡得好不好」。
 *
 * 0.9.2 及以前这里是「身体 / 情绪 / 精力 / 心智」四行文字（输入框 + 提示语）；
 * 0.9.3 起只剩分数，文字那一行收成状态卡上的一句话备注。
 */
export interface StateField {
  key: StateKey
  /** 打分卡与结果页上的行首标签 */
  label: string
  /** 打分卡上这一排星旁边那句问法 */
  ask: string
}

export const STATE_FIELDS: StateField[] = [
  {
    key: 'mood',
    label: '心情',
    ask: '这周心情怎么样？',
  },
  {
    key: 'sleep',
    label: '睡眠',
    ask: '这周睡得怎么样？',
  },
  {
    key: 'sport',
    label: '运动',
    ask: '这周动得够吗？',
  },
  {
    key: 'diet',
    label: '饮食',
    ask: '这周吃得怎么样？',
  },
]

export function stateField(key: StateKey): StateField | undefined {
  return STATE_FIELDS.find((f) => f.key === key)
}
