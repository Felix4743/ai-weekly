import { createEmptyState, type WeeklyResult } from './types'

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

  lines.push('## 状态', '')
  // 0.9.1 才有的第八栏。旧结果从归档读回来时会被补成四个空串，
  // 这里再兜一次底，免得「复制全文」在一个老对象上崩掉。
  const st = r.state ?? createEmptyState()
  const stateRows: [string, string][] = [
    ['身体', st.body],
    ['情绪', st.mood],
    ['精力', st.focus],
    ['心智', st.growth],
  ]
  const filled = stateRows.filter(([, text]) => text.trim().length > 0)
  if (filled.length === 0) {
    lines.push('- （无）')
  } else {
    for (const [label, text] of filled) lines.push(`- ${label}：${text.trim()}`)
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
