import { useRef, useState } from 'react'
import type { PersonNote } from '../core/types'

/* ---------------- 单值列表：可改、可删、可加 ---------------- */

interface EditableListProps {
  items: string[]
  onChange: (items: string[]) => void
  placeholder?: string
  addLabel?: string
  emptyText?: string
}

export function EditableList({
  items,
  onChange,
  placeholder = '写一条…',
  addLabel = '添加一条',
  emptyText = '（这次没有聊到）',
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
          <li key={`${i}-${item}`} className="edit-row">
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

/* ---------------- 人际列表：名字 + 一句话备注 ---------------- */

interface EditablePeopleProps {
  items: PersonNote[]
  onChange: (items: PersonNote[]) => void
}

interface PersonDraft {
  index: number
  name: string
  note: string
}

export function EditablePeople({ items, onChange }: EditablePeopleProps) {
  const [draft, setDraft] = useState<PersonDraft | null>(null)

  const start = (index: number) => {
    const existing = items[index]
    setDraft({ index, name: existing?.name ?? '', note: existing?.note ?? '' })
  }

  const commit = () => {
    if (!draft) return
    const name = draft.name.trim()
    const note = draft.note.trim()
    const next = [...items]

    if (draft.index >= items.length) {
      if (name) next.push({ name, note })
    } else if (name) {
      next[draft.index] = { name, note }
    } else {
      next.splice(draft.index, 1)
    }
    onChange(next)
    setDraft(null)
  }

  const isAdding = draft !== null && draft.index >= items.length

  return (
    <div className="editable">
      {items.length === 0 && draft === null && <p className="empty">（这次没有聊到具体的人）</p>}

      <ul className="edit-list people">
        {items.map((person, i) => (
          <li key={`${i}-${person.name}`} className="edit-row">
            {draft?.index === i ? (
              <div className="person-form">
                <input
                  className="edit-input"
                  autoFocus
                  value={draft.name}
                  placeholder="谁"
                  onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') commit()
                    if (e.key === 'Escape') setDraft(null)
                  }}
                />
                <input
                  className="edit-input"
                  value={draft.note}
                  placeholder="关于他/她，一句话"
                  onChange={(e) => setDraft({ ...draft, note: e.target.value })}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') commit()
                    if (e.key === 'Escape') setDraft(null)
                  }}
                />
                <span className="row-actions always">
                  <button type="button" title="保存" onClick={commit}>
                    ✓
                  </button>
                  <button type="button" title="取消" onClick={() => setDraft(null)}>
                    ✕
                  </button>
                </span>
              </div>
            ) : (
              <>
                <button className="edit-text person" type="button" onClick={() => start(i)}>
                  <b>{person.name}</b>
                  {person.note && <span className="person-note">{person.note}</span>}
                </button>
                <span className="row-actions">
                  <button type="button" title="编辑" onClick={() => start(i)}>
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

        {isAdding && draft && (
          <li className="edit-row">
            <div className="person-form">
              <input
                className="edit-input"
                autoFocus
                value={draft.name}
                placeholder="谁"
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') commit()
                  if (e.key === 'Escape') setDraft(null)
                }}
              />
              <input
                className="edit-input"
                value={draft.note}
                placeholder="关于他/她，一句话"
                onChange={(e) => setDraft({ ...draft, note: e.target.value })}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') commit()
                  if (e.key === 'Escape') setDraft(null)
                }}
              />
              <span className="row-actions always">
                <button type="button" title="保存" onClick={commit}>
                  ✓
                </button>
                <button type="button" title="取消" onClick={() => setDraft(null)}>
                  ✕
                </button>
              </span>
            </div>
          </li>
        )}
      </ul>

      {draft === null && (
        <button
          className="add-btn"
          type="button"
          onClick={() => setDraft({ index: items.length, name: '', note: '' })}
        >
          ＋ 添加一个人
        </button>
      )}
    </div>
  )
}
