import type { ReactNode } from 'react'
import type { ListKey } from '../core/resultEdit'
import { countSection } from '../core/outline'
import { STATE_FIELDS } from '../core/stateFields'
import { attachState, withScore } from '../core/stateScore'
import type { PersonNote, StateKey, WeeklyResult } from '../core/types'
import { CollapsibleCard, type CollapsibleKey } from './CollapsibleCard'
import { EditableList, EditablePeople } from './EditableList'
import { StateScore } from './StateScore'

/**
 * 一份结果的正文：五栏清单（可折叠）+ 本周主线 + 下周计划。
 *
 * 结果页和总览页共用它 —— 两边看的是同一份结构，区别只在于
 * 「改的是本周」还是「改的是某一周的存档」，以及下周计划卡片底部多不多一块东西。
 */

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
  /**
   * 备注就一行，改它不动分数；**追问小结必须原样带过去** ——
   * `attachState` 只认传进去的那几样，漏一个就等于把那一段抹掉。
   */
  const setStateNote = (note: string) =>
    onResultChange({
      ...result,
      state: attachState(result.state.scores, note, result.state.followUp),
    })
  /** 追问小结同理：改它不动用户自己写的备注 */
  const setStateFollowUp = (text: string) =>
    onResultChange({
      ...result,
      state: attachState(result.state.scores, result.state.note, text),
    })
  /** 点星：再点同一颗就把这一项拿掉；一项都没了就不写 scores 这个键 */
  const setStateScore = (key: StateKey, value: number | undefined) =>
    onResultChange({
      ...result,
      state: attachState(
        withScore(result.state.scores, key, value),
        result.state.note,
        result.state.followUp,
      ),
    })

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
        desc="四项各点几颗星 · 备注与追问小结都能改"
        count={countSection(result, 'state')}
        collapsed={collapsed.state}
        onToggle={() => onToggle('state')}
      >
        <div className="state-form">
          {STATE_FIELDS.map((f) => (
            <div key={f.key} className="state-row">
              <span className="state-label">{f.label}</span>
              <StateScore
                ariaLabel={`${f.label}评分`}
                score={result.state.scores?.[f.key]}
                onChange={(v) => setStateScore(f.key, v)}
              />
            </div>
          ))}
          <textarea
            className="state-note"
            rows={2}
            value={result.state.note}
            placeholder="这周状态想补一句什么…（可以空着）"
            onChange={(e) => setStateNote(e.target.value)}
          />
          {/* 低分那几项聊出来的东西：跟备注同一栏，但分开一格，免得跟用户自己写的那句混起来。
              两个 textarea 共用 state-note 的样式，靠 state-followup 这个类区分谁是谁 */}
          <label className="state-followup">
            <span className="state-followup-label">追问小结</span>
            <textarea
              className="state-note state-followup"
              rows={2}
              value={result.state.followUp ?? ''}
              placeholder="分低的那几项，聊出来是什么挡着的…（没聊到就是空的）"
              onChange={(e) => setStateFollowUp(e.target.value)}
            />
          </label>
        </div>
      </CollapsibleCard>

      <CollapsibleCard
        sectionKey="growth"
        title="成长"
        desc="这周长了什么见识、想通了什么（不打分）"
        count={countSection(result, 'growth')}
        collapsed={collapsed.growth}
        onToggle={() => onToggle('growth')}
      >
        <EditableList
          items={result.growth}
          onChange={setList('growth')}
          placeholder="看了什么、听了什么、想通了什么…"
          addLabel="添加一条"
          emptyText="（这周没聊到成长）"
        />
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
