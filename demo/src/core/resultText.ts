import { createEmptyState, type WeeklyResult } from './types'
import { STATE_FIELDS } from './stateFields'
import { scoreText } from './stateScore'

function bulletList(lines: string[], items: string[], empty = '（无）'): void {
  if (items.length === 0) {
    lines.push(`- ${empty}`)
    return
  }
  for (const item of items) lines.push(`- ${item}`)
}

/** 把结果渲染成可复制的 Markdown 全文 */
export function resultToMarkdown(r: WeeklyResult): string {
  const lines: string[] = []

  lines.push('# 本周梳理', '')

  lines.push('## 本周清单', '')

  lines.push('**事**')
  bulletList(lines, r.events)
  lines.push('')

  lines.push('**人**')
  if (r.people.length === 0) {
    lines.push('- （无）')
  } else {
    for (const p of r.people) {
      lines.push(p.note ? `- ${p.name} — ${p.note}` : `- ${p.name}`)
    }
  }
  lines.push('')

  lines.push('**未办**')
  bulletList(lines, r.pending)
  lines.push('')

  lines.push('**物品**')
  bulletList(lines, r.things)
  lines.push('')

  lines.push('**成长**')
  bulletList(lines, r.growth)
  lines.push('')

  lines.push('## 状态', '')
  // 0.9.1 才有的第八栏（0.9.3 起只剩四项分数 + 一行备注）。旧结果从归档读回来时
  // 字段会缺，这里再兜一次底，免得「复制全文」在一个老对象上崩掉。
  const st = r.state ?? createEmptyState()
  const rows = STATE_FIELDS.map((f) => ({
    label: f.label,
    score: st.scores?.[f.key],
  })).filter((row) => row.score !== undefined)

  if (rows.length === 0) {
    lines.push('- （无）')
  } else {
    for (const row of rows) lines.push(`- ${row.label}：${scoreText(row.score)}`)
  }
  if ((st.note ?? '').trim()) {
    lines.push('')
    lines.push(`> ${st.note.trim()}`)
  }
  // 低分项聊出来的小结（0.9.4）：跟备注挨着放，但明说是追问来的，
  // 免得粘到别处之后它跟用户自己写的那句混成一句
  const followUp = (st.followUp ?? '').trim()
  if (followUp) {
    lines.push('')
    lines.push(`> **追问**：${followUp}`)
  }
  lines.push('')

  lines.push('## 本周主线', '')
  if (r.highlights.length === 0) {
    lines.push('- （无）')
  } else {
    // 第一条是这一周的主线。导出出去的东西也要让人一眼看出
    // 哪一句是判断、哪几条是支撑，否则粘到别处就退化成一串并列条目
    lines.push(`**主线**：${r.highlights[0]}`)
    if (r.highlights.length > 1) {
      lines.push('')
      bulletList(lines, r.highlights.slice(1))
    }
  }
  lines.push('')

  lines.push('## 下周计划', '')
  lines.push('**三件重点**')
  bulletList(lines, r.nextFocus)
  lines.push('')
  lines.push('**要跟进的人**')
  bulletList(lines, r.nextFollowUps)

  return lines.join('\n')
}
