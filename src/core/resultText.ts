import type { WeeklyResult } from './types'

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

  lines.push('**悬着**')
  bulletList(lines, r.pending)
  lines.push('')

  lines.push('## 本周热点', '')
  bulletList(lines, r.highlights)
  lines.push('')

  lines.push('## 下周计划', '')
  lines.push('**三件重点**')
  bulletList(lines, r.nextFocus)
  lines.push('')
  lines.push('**要跟进的人**')
  bulletList(lines, r.nextFollowUps)

  return lines.join('\n')
}
