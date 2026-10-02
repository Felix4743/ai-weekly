import { useRef, useState } from 'react'

/* ---------------- 单值列表：可改、可删、可加 ---------------- */

interface EditableListProps {
  items: string[]
  onChange: (items: string[]) => void
  placeholder?: string
  addLabel?: string
  emptyText?: string
  /** 第一条是「主线」：界面上给它一点分量，别看起来跟别的条目一样 */
  leadFirst?: boolean
}

/**
 * 一串可以就地改的短句。
 *
 * 交出去的是**整个新数组**，不是「第几条改成了什么」—— 调用方拿到的
 * 就是该存下来的东西，少一层「按索引改回原对象」的转换，也就少一处会串位的地方。
 */
export function EditableList({
  items,
  onChange,
  placeholder = '写一条…',
  addLabel = '添加一条',
  emptyText = '（这次没有提到）',
  leadFirst = false,
}: EditableListProps) {
  const [editing, setEditing] = useState<number | null>(null)
  const [draft, setDraft] = useState('')
  // 取消编辑后可能还会触发一次 blur，用它挡掉，避免把取消当成提交
  const skipCommitRef = useRef(false)

  const start = (index: number, value: string) => {
    skipCommitRef.current = false
    setEditing(index)
    setDraft(value)
  }

  const add = () => {
    skipCommitRef.current = false
    setEditing(items.length)
    setDraft('')
  }

  const cancel = () => {
    skipCommitRef.current = true
    setEditing(null)
    setDraft('')
  }

  const commit = () => {
    if (skipCommitRef.current) {
      skipCommitRef.current = false
      return
    }
    if (editing === null) return

    const text = draft.trim()
    const next = [...items]
    if (editing >= items.length) {
      if (text) next.push(text)
    } else if (text) {
      next[editing] = text
    } else {
      next.splice(editing, 1)
    }
    onChange(next)
    setEditing(null)
    setDraft('')
  }

  const isAdding = editing !== null && editing >= items.length

  return (
    <div className="editable">
      {items.length === 0 && editing === null && <p className="empty">{emptyText}</p>}

      <ul className="edit-list">
        {items.map((item, i) => (
          <li key={`${i}-${item}`} className={`edit-row${leadFirst && i === 0 ? ' lead' : ''}`}>
            {editing === i ? (
              <input
                className="edit-input"
                autoFocus
                value={draft}
                placeholder={placeholder}
                onChange={(e) => setDraft(e.target.value)}
                onBlur={commit}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    e.currentTarget.blur()
                  }
                  if (e.key === 'Escape') {
                    e.preventDefault()
                    cancel()
                  }
                }}
              />
            ) : (
              <>
                <button className="edit-text" type="button" onClick={() => start(i, item)}>
                  {item}
                </button>
                <span className="row-actions">
                  <button type="button" title="编辑" onClick={() => start(i, item)}>
                    ✎
                  </button>
                  <button
                    type="button"
                    title="删除"
                    onClick={() => onChange(items.filter((_, k) => k !== i))}
                  >
                    ✕
                  </button>
                </span>
              </>
            )}
          </li>
        ))}

        {isAdding && (
          <li className="edit-row">
            <input
              className="edit-input"
              autoFocus
              value={draft}
              placeholder={placeholder}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={commit}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  e.currentTarget.blur()
                }
                if (e.key === 'Escape') {
                  e.preventDefault()
                  cancel()
                }
              }}
            />
          </li>
        )}
      </ul>

      {editing === null && (
        <button className="add-btn" type="button" onClick={add}>
          ＋ {addLabel}
        </button>
      )}
    </div>
  )
}
