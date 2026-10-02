import type { ReactNode } from 'react'
import type { ListKey } from '../core/resultEdit'
import { countSection } from '../core/outline'
import type { PersonNote, WeeklyResult, WeeklyState } from '../core/types'
import { CollapsibleCard, type CollapsibleKey } from './CollapsibleCard'
import { EditableList, EditablePeople } from './EditableList'

/**
 * 一份结果的正文：五栏清单（可折叠）+ 本周主线 + 下周计划。
 *
 * 结果页和总览页共用它 —— 两边看的是同一份结构，区别只在于
 * 「改的是本周」还是「改的是某一周的存档」，以及下周计划卡片底部多不多一块东西。
 */

/** 状态那一段的四行：0.9.1 只存文字，不打分 */
const STATE_FIELDS: { key: keyof WeeklyState; label: string; placeholder: string }[] = [
  { key: 'body', label: '身体', placeholder: '睡眠、运动、吃饭…' },
  { key: 'mood', label: '情绪', placeholder: '这周心里怎么样…' },
  { key: 'focus', label: '精力', placeholder: '什么时候状态最好…' },
  { key: 'growth', label: '心智', placeholder: '读了什么、学到什么…' },
]

interface Props {
  result: WeeklyResult
  onResultChange: (next: WeeklyResult) => void
  collapsed: Record<CollapsibleKey, boolean>
  onToggle: (key: CollapsibleKey) => void
  /** 下周计划卡片底部附加的内容：结果页放「重新整理」，看存档时什么都不放 */
  planFooter?: ReactNode
}

export function ResultBody({
  result,
  onResultChange,
  collapsed,
  onToggle,
  planFooter,
}: Props) {
  const setList = (key: ListKey) => (items: string[]) => onResultChange({ ...result, [key]: items })
  const setPeople = (people: PersonNote[]) => onResultChange({ ...result, people })
  const setStateField = (key: keyof WeeklyState, value: string) =>
    onResultChange({ ...result, state: { ...result.state, [key]: value } })

  return (
    <>
      <CollapsibleCard
        sectionKey="events"
        title="事情"
        desc="这周都忙了些什么"
        count={countSection(result, 'events')}
        collapsed={collapsed.events}
        onToggle={() => onToggle('events')}
      >
        <EditableList
          items={result.events}
          onChange={setList('events')}
          placeholder="这周做了什么…"
          addLabel="添加一件事"
          emptyText="（这次没有聊到具体的事）"
        />
      </CollapsibleCard>

      <CollapsibleCard
        sectionKey="people"
        title="人际"
        desc="这周和谁有关，卡在了哪里"
        count={countSection(result, 'people')}
        collapsed={collapsed.people}
        onToggle={() => onToggle('people')}
      >
        <EditablePeople items={result.people} onChange={setPeople} />
      </CollapsibleCard>

      <CollapsibleCard
        sectionKey="things"
        title="物品"
        desc="这周买了什么、处理掉了什么"
        count={countSection(result, 'things')}
        collapsed={collapsed.things}
        onToggle={() => onToggle('things')}
      >
        <EditableList
          items={result.things}
          onChange={setList('things')}
          placeholder="买了什么、卖掉了什么…"
          addLabel="添加一样东西"
          emptyText="（这周没有添置或处理东西）"
        />
      </CollapsibleCard>

      <CollapsibleCard
        sectionKey="pending"
        title="未办"
        desc="还没做完、一直拖着的事"
        count={countSection(result, 'pending')}
        collapsed={collapsed.pending}
        onToggle={() => onToggle('pending')}
      >
        <EditableList
          items={result.pending}
          onChange={setList('pending')}
          placeholder="还有什么没办完…"
          addLabel="添加一条"
          emptyText="（没有未办的事）"
        />
      </CollapsibleCard>

      <CollapsibleCard
        sectionKey="state"
        title="状态"
        desc="身体、情绪、精力、心智各一句 · 想改就直接改"
        count={countSection(result, 'state')}
        collapsed={collapsed.state}
        onToggle={() => onToggle('state')}
      >
        <div className="state-form">
          {STATE_FIELDS.map((f) => (
            <label key={f.key} className="state-row">
              <span className="state-label">{f.label}</span>
              <input
                className="edit-input"
                value={result.state[f.key]}
                placeholder={f.placeholder}
                onChange={(e) => setStateField(f.key, e.target.value)}
              />
            </label>
          ))}
        </div>
      </CollapsibleCard>

      <section className="card highlight-card" id="section-highlights">
        <h2 className="card-title">本周主线</h2>
        <p className="card-desc">
          第一条是这一周的判断，后面几条只写清单里没有的东西 · 都可以直接改
        </p>
        <EditableList
          items={result.highlights}
          onChange={setList('highlights')}
          placeholder="这周到底是怎么回事…"
          addLabel="添加一条"
          emptyText="（还没有主线）"
          leadFirst
        />
      </section>

      <section className="card plan-card" id="section-plan">
        <h2 className="card-title">
          下周计划
          <span className="badge-ai">AI 建议</span>
        </h2>
        <p className="card-desc">
          下面是 AI 根据这周的情况给出的建议，你可以直接改。想到什么它没考虑到的，写在下面，让它重新整理一遍。
        </p>

        <div className="plan-grid">
          <div>
            <h3 className="col-title">三件重点</h3>
            <EditableList
              items={result.nextFocus}
              onChange={setList('nextFocus')}
              placeholder="下周的重点…"
              addLabel="添加一条"
            />
          </div>
          <div>
            <h3 className="col-title">要跟进的人</h3>
            <EditableList
              items={result.nextFollowUps}
              onChange={setList('nextFollowUps')}
              placeholder="要联系谁…"
              addLabel="添加一个人"
              emptyText="（这次没有提到具体的人）"
            />
          </div>
        </div>

        {planFooter}
      </section>
    </>
  )
}
