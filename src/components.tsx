import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import {
  Award,
  Check,
  ChevronRight,
  Download,
  Gamepad2,
  ClipboardPaste,
  List,
  Plus,
  Square,
  Pause,
  Play,
  Save,
  Shuffle,
  Trash2,
  Upload,
  X,
} from 'lucide-react'
import {
  applyCommand,
  canFinish,
  canFinishEarly,
  membersFromText,
  namesFromText,
  plannedGamesFor,
  MIN_MEMBERS,
  MAX_MEMBERS,
  MAX_ROUNDS,
  csv,
  currentRound,
  parseEvent,
  points,
  standings,
  validRanks,
} from './domain'
import type { Member, PartyEvent, Result } from './domain'
import type { PartyStore, StoreState } from './store'
import { download } from './store'

export function Modal({
  title,
  close,
  children,
}: {
  title: string
  close: () => void
  children: ReactNode
}) {
  const reference = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    reference.current?.showModal()
  }, [])
  return (
    <dialog
      ref={reference}
      aria-labelledby="dialog-title"
      onCancel={close}
      onClick={(event) => {
        if (event.target === event.currentTarget) close()
      }}
    >
      <header className="dialog-header">
        <h2 id="dialog-title">{title}</h2>
        <button
          className="icon-button"
          aria-label="閉じる"
          title="閉じる"
          onClick={close}
        >
          <X size={20} />
        </button>
      </header>
      {children}
    </dialog>
  )
}

export function MemberSeats({
  event,
  players,
}: {
  event: PartyEvent
  players: string[]
}) {
  return (
    <div className="seats">
      {players.map((id, index) => {
        const member = event.members.find((candidate) => candidate.id === id)!
        return (
          <article className="seat" data-seat={index} key={id}>
            <span className="seat-number">
              {index + 1}
              <small>P</small>
            </span>
            <span className="role">
              {member.role === 'host' ? '講師' : '新人'}
            </span>
            <h3>{member.name}</h3>
          </article>
        )
      })}
    </div>
  )
}

export function Ranking({
  event,
  self = '',
}: {
  event: PartyEvent
  self?: string
}) {
  const rows = standings(event)
  return (
    <div className="ranking-wrap">
      <table className="ranking">
        <thead>
          <tr>
            <th>順位</th>
            <th>参加者</th>
            <th>平均点</th>
            <th>1位率</th>
            <th>本数</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id} className={row.id === self ? 'is-me' : ''}>
              <td>
                <span
                  className={`rank-number ${row.played && row.rank <= 3 ? 'rank-top' : ''}`}
                >
                  {row.played ? row.rank : '-'}
                </span>
              </td>
              <th scope="row">
                <span>{row.name}</span>
                {row.id === self && <small className="me-tag">自分</small>}
                <small className="member-role">
                  {row.role === 'host' ? '講師' : ''}
                </small>
              </th>
              <td className="score">
                {row.played ? row.average.toFixed(2) : '-'}
                <small>pt</small>
                <small className="score-total">計{row.score}pt</small>
              </td>
              <td className="win-rate" title={`${row.wins}/${row.played}本`}>
                {row.played ? `${(row.winRate * 100).toFixed(1)}%` : '-'}
                <small className="wins-total">{row.wins}回</small>
              </td>
              <td>
                {row.played}
                <small>/{plannedGamesFor(event, row.id)}</small>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export function Queue({
  event,
  self,
  projection = false,
}: {
  event: PartyEvent
  self: string
  projection?: boolean
}) {
  const current = currentRound(event)
  const index = current ? event.rounds.indexOf(current) : event.rounds.length
  const appearances = event.members.map(
    (member) =>
      event.rounds.filter((round) => round.players.includes(member.id)).length,
  )
  const complete = event.rounds
    .flatMap((round) => round.results)
    .filter(Boolean).length
  const personal = event.members.find((member) => member.id === self)
  const nextPersonal = event.rounds.find(
    (round) =>
      round.players.includes(self) && round.results.some((result) => !result),
  )
  const personalScore = standings(event).find((member) => member.id === self)
  if (event.phase === 'finished')
    return (
      <section className="award-section">
        <div className="section-heading">
          <div>
            <span className="eyebrow">FINAL RESULTS</span>
            <h2>おつかれさまでした！</h2>
          </div>
          <Award size={32} />
        </div>
        <div className="podium">
          {standings(event)
            .filter((row) => row.played > 0 && row.rank <= event.awards)
            .map((row) => (
              <article key={row.id} className="winner">
                <Award size={38} />
                <span className="winner-rank">{row.rank}位</span>
                <h3>{row.name}</h3>
                <strong>
                  {row.average.toFixed(2)}
                  <small>pt</small>
                </strong>
                <p className="muted">
                  平均点 · {row.played}本 · 合計{row.score}pt
                </p>
              </article>
            ))}
        </div>
        {event.endedEarly && (
          <p className="notice">
            途中終了：記録済み{complete}
            本の平均得点で集計。未参加者は順位対象外です。
          </p>
        )}
        <Ranking event={event} self={self} />
      </section>
    )
  return (
    <div className={`queue-layout ${projection ? 'projection-queue' : ''}`}>
      <section className="stage">
        <div className="section-heading">
          <div>
            <span className="eyebrow">
              {event.phase === 'paused'
                ? 'BREAK TIME'
                : event.phase === 'setup'
                  ? 'READY TO PLAY'
                  : 'NOW PLAYING'}
            </span>
            <h2>
              {event.phase === 'paused'
                ? 'ひと休み'
                : event.phase === 'setup'
                  ? '最初の対戦'
                  : current
                    ? `第${index + 1}対戦`
                    : 'すべての対戦が終了'}
            </h2>
          </div>
          {current && (
            <span className="round-counter">
              <b>{String(index + 1).padStart(2, '0')}</b>
              <span>/ {event.rounds.length}</span>
            </span>
          )}
        </div>
        {current && (
          <>
            <MemberSeats event={event} players={current.players} />
            <div className="game-status">
              {current.results.map((result, game) => (
                <span key={game} className={result ? 'game-done' : ''}>
                  {result ? <Check size={16} /> : <Gamepad2 size={16} />}
                  {game + 1}本目{result ? ' 記録済み' : ' 未記録'}
                </span>
              ))}
            </div>
          </>
        )}
        {!current && (
          <div className="empty-stage">
            <Check size={48} />
            <p>最終順位の確定待ち</p>
          </div>
        )}
        {!projection && personal && (
          <section className="personal-strip">
            <div>
              <span className="eyebrow">YOUR NEXT TURN</span>
              <h3>{personal.name}</h3>
            </div>
            <div>
              <strong>
                {nextPersonal
                  ? `第${event.rounds.indexOf(nextPersonal) + 1}対戦`
                  : '出番終了'}
              </strong>
              <span>
                {personalScore?.played ?? 0}/{plannedGamesFor(event, self)}本 ·
                平均 {(personalScore?.average ?? 0).toFixed(2)}pt
              </span>
            </div>
          </section>
        )}
        <section className="upcoming">
          <div className="section-heading">
            <h3>次の出番</h3>
            <span className="muted">交代メンバー</span>
          </div>
          {event.rounds
            .slice(index + 1, index + (projection ? 2 : 3))
            .map((round, offset) => (
              <article className="upcoming-row" key={round.id}>
                <span className="upcoming-number">
                  {String(index + offset + 2).padStart(2, '0')}
                </span>
                <div>
                  {round.players.map((id) => (
                    <span key={id}>
                      {event.members.find((member) => member.id === id)?.name}
                    </span>
                  ))}
                </div>
                <ChevronRight size={18} />
              </article>
            ))}
          {index >= event.rounds.length - 1 && (
            <p className="muted">次の対戦はありません</p>
          )}
        </section>
      </section>
      {!projection && (
        <aside className="side-summary">
          <section>
            <div className="section-heading">
              <h3>本日の進行</h3>
              <span className="live-dot" />
            </div>
            <div className="progress-number">
              <strong>{complete}</strong>
              <span>/ {event.rounds.length * event.gamesPerRound}本</span>
            </div>
            <progress
              value={complete}
              max={event.rounds.length * event.gamesPerRound}
              aria-label="記録済みの本数"
            />
            <div className="summary-facts">
              <span>
                参加者<strong>{event.members.length}人</strong>
              </span>
              <span>
                1人の出番
                <strong>
                  {Math.min(...appearances) === Math.max(...appearances)
                    ? Math.min(...appearances)
                    : `${Math.min(...appearances)}〜${Math.max(...appearances)}`}
                  枠
                </strong>
              </span>
            </div>
          </section>
          <section className="scoring">
            <h3>得点</h3>
            <div>
              {[4, 3, 2, 1].map((point, position) => (
                <span key={point}>
                  <small>{position + 1}位</small>
                  <strong>
                    {point}
                    <small>pt</small>
                  </strong>
                </span>
              ))}
            </div>
            <p>
              同着は該当順位の平均点。順位は平均得点、同点なら1位率で決定。未参加者は順位対象外。
            </p>
          </section>
        </aside>
      )}
    </div>
  )
}

export function Schedule({ event, self }: { event: PartyEvent; self: string }) {
  return (
    <section>
      <div className="section-heading">
        <div>
          <span className="eyebrow">MATCH SCHEDULE</span>
          <h2>対戦表</h2>
        </div>
        <span className="muted">
          {event.rounds.length}対戦 · {event.members.length}人
        </span>
      </div>
      <div className="schedule-list">
        {event.rounds.map((round, index) => (
          <article
            key={round.id}
            className={`schedule-row ${round.players.includes(self) ? 'my-round' : ''}`}
          >
            <span className="schedule-number">
              {String(index + 1).padStart(2, '0')}
            </span>
            <div className="schedule-members">
              {round.players.map((id, seat) => (
                <span data-seat={seat} key={id}>
                  {event.members.find((member) => member.id === id)?.name}
                </span>
              ))}
            </div>
            <span
              className={`completion ${round.results.every(Boolean) ? 'complete' : ''}`}
            >
              {round.results.filter(Boolean).length}/{event.gamesPerRound}
              {event.endedEarly && !round.results.every(Boolean)
                ? ' 打切り'
                : ''}
              <Check size={14} />
            </span>
          </article>
        ))}
      </div>
    </section>
  )
}

function Setup({
  event,
  store,
  disabled,
}: {
  event: PartyEvent
  store: PartyStore
  disabled: boolean
}) {
  const [title, setTitle] = useState(event.title)
  const [members, setMembers] = useState<Member[]>(event.members)
  const memberPool = useRef({
    rookie: event.members.filter((member) => member.role === 'rookie'),
    host: event.members.filter((member) => member.role === 'host'),
  })
  const [games, setGames] = useState<1 | 2>(event.gamesPerRound)
  const [awards, setAwards] = useState<1 | 3>(event.awards)
  const [roundCount, setRoundCount] = useState(event.rounds.length)
  const [inputMode, setInputMode] = useState<'bulk' | 'individual'>('bulk')
  const [rookieText, setRookieText] = useState(
    event.members
      .filter((member) => member.role === 'rookie')
      .map((member) => member.name)
      .join('\n'),
  )
  const [hostText, setHostText] = useState(
    event.members
      .filter((member) => member.role === 'host')
      .map((member) => member.name)
      .join('\n'),
  )
  let configuredMembers = members
  let memberError = ''
  try {
    if (inputMode === 'bulk')
      configuredMembers = membersFromText(rookieText, hostText, members)
    else if (members.length < MIN_MEMBERS || members.length > MAX_MEMBERS)
      memberError = `参加者は${MIN_MEMBERS}〜${MAX_MEMBERS}人で設定してください。`
    else if (
      new Set(members.map((member) => member.name.trim())).size !==
      members.length
    )
      memberError = 'ニックネームが重複しています。'
  } catch (error) {
    memberError =
      error instanceof Error ? error.message : '名前を確認してください。'
  }
  const total =
    inputMode === 'bulk'
      ? namesFromText(rookieText).length + namesFromText(hostText).length
      : members.length
  const minimum = total ? Math.floor((roundCount * 4) / total) : 0
  const maximum = total ? Math.ceil((roundCount * 4) / total) : 0
  const synchronize = (next: Member[]) => {
    for (const role of ['rookie', 'host'] as const) {
      const visible = next.filter((member) => member.role === role)
      memberPool.current[role] = [
        ...visible,
        ...memberPool.current[role].slice(visible.length),
      ]
    }
    setMembers(next)
    setRookieText(
      next
        .filter((member) => member.role === 'rookie')
        .map((member) => member.name)
        .join('\n'),
    )
    setHostText(
      next
        .filter((member) => member.role === 'host')
        .map((member) => member.name)
        .join('\n'),
    )
  }
  const resize = (role: Member['role'], count: number) => {
    if (!Number.isInteger(count) || count < 0 || count > MAX_MEMBERS) return
    const group = memberPool.current[role]
    const others = members.filter((member) => member.role !== role)
    const names = new Set(members.map((member) => member.name))
    const resized = Array.from({ length: count }, (_, index) => {
      if (group[index]) return group[index]
      const base = `${role === 'host' ? '講師' : '新人'}${String(index + 1).padStart(2, '0')}`
      let name = base
      let suffix = 1
      while (names.has(name)) name = `${base}-${suffix++}`
      names.add(name)
      return { id: crypto.randomUUID(), name, role }
    })
    synchronize(
      role === 'rookie' ? [...resized, ...others] : [...others, ...resized],
    )
  }
  return (
    <form
      className="setup-form"
      onSubmit={async (submission) => {
        submission.preventDefault()
        const begin =
          (submission.nativeEvent as SubmitEvent).submitter?.getAttribute(
            'value',
          ) === 'begin'
        if (
          (await store.submit({
            type: 'configure',
            title,
            members: configuredMembers,
            gamesPerRound: games,
            awards,
            roundCount,
          })) &&
          begin
        )
          await store.submit({ type: 'phase', phase: 'playing' })
      }}
    >
      <fieldset disabled={disabled}>
        <label className="field">
          イベント名
          <input
            value={title}
            maxLength={60}
            required
            onChange={(change) => setTitle(change.target.value)}
          />
        </label>
        <label className="field round-count-field">
          予定対戦数
          <input
            type="number"
            min={1}
            max={MAX_ROUNDS}
            required
            value={roundCount}
            onChange={(change) => setRoundCount(Number(change.target.value))}
          />
        </label>
        <div className="setup-options">
          <fieldset>
            <legend>1枠のミニゲーム本数</legend>
            <div className="radio-group">
              {([1, 2] as const).map((value) => (
                <label key={value}>
                  <input
                    type="radio"
                    name="games"
                    checked={games === value}
                    onChange={() => setGames(value)}
                  />
                  {value}本{' '}
                  <small>
                    {minimum === maximum
                      ? `全員${value * minimum}本`
                      : `${value * minimum}〜${value * maximum}本/人`}
                  </small>
                </label>
              ))}
            </div>
          </fieldset>
          <fieldset>
            <legend>表彰</legend>
            <div className="radio-group">
              {([1, 3] as const).map((value) => (
                <label key={value}>
                  <input
                    type="radio"
                    name="awards"
                    checked={awards === value}
                    onChange={() => setAwards(value)}
                  />
                  上位{value}人
                </label>
              ))}
            </div>
          </fieldset>
        </div>
        <div className="section-heading">
          <h3>参加者 · {total}人</h3>
          <span className="muted">
            {MIN_MEMBERS}〜{MAX_MEMBERS}人 · 開始後は変更不可
          </span>
        </div>
        <div
          className="game-tabs name-input-tabs"
          role="tablist"
          aria-label="名前入力方法"
        >
          <button
            type="button"
            role="tab"
            aria-selected={inputMode === 'bulk'}
            onClick={() => {
              if (inputMode !== 'bulk') {
                synchronize(members)
                setInputMode('bulk')
              }
            }}
          >
            <ClipboardPaste size={16} />
            一括
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={inputMode === 'individual'}
            onClick={() => {
              if (inputMode === 'bulk' && !memberError) {
                synchronize(configuredMembers)
                setInputMode('individual')
              }
            }}
          >
            <List size={16} />
            個別
          </button>
        </div>
        {inputMode === 'bulk' ? (
          <div className="bulk-members">
            <label className="field">
              新人（改行区切り）
              <textarea
                rows={10}
                maxLength={4000}
                value={rookieText}
                onChange={(change) => setRookieText(change.target.value)}
              />
            </label>
            <label className="field">
              講師（改行区切り）
              <textarea
                rows={10}
                maxLength={4000}
                value={hostText}
                onChange={(change) => setHostText(change.target.value)}
              />
            </label>
          </div>
        ) : (
          <>
            <div className="participant-counts">
              <label className="field">
                新人の人数
                <input
                  type="number"
                  min={0}
                  max={MAX_MEMBERS}
                  value={
                    members.filter((member) => member.role === 'rookie').length
                  }
                  onChange={(change) =>
                    resize('rookie', Number(change.target.value))
                  }
                />
              </label>
              <label className="field">
                講師の人数
                <input
                  type="number"
                  min={0}
                  max={MAX_MEMBERS}
                  value={
                    members.filter((member) => member.role === 'host').length
                  }
                  onChange={(change) =>
                    resize('host', Number(change.target.value))
                  }
                />
              </label>
            </div>
            <div className="roster">
              {members.map((member, index) => (
                <label className="field" key={member.id}>
                  <span>
                    <b>{String(index + 1).padStart(2, '0')}</b>
                    {member.role === 'host' ? '講師' : '新人'}
                  </span>
                  <input
                    aria-label={`参加者${index + 1}の名前`}
                    value={member.name}
                    maxLength={24}
                    required
                    onChange={(change) =>
                      synchronize(
                        members.map((candidate) =>
                          candidate.id === member.id
                            ? { ...candidate, name: change.target.value }
                            : candidate,
                        ),
                      )
                    }
                  />
                </label>
              ))}
            </div>
          </>
        )}
        {memberError && (
          <p className="inline-error" role="alert">
            {memberError}
          </p>
        )}
        {!memberError && minimum === 0 && (
          <p className="notice">
            この予定対戦数では未参加になる人がいます。未参加者は順位対象外です。
          </p>
        )}
        <div className="form-actions">
          <button className="button" type="submit" disabled={!!memberError}>
            <Save size={18} />
            設定を保存
          </button>
          <button
            className="button primary"
            type="submit"
            value="begin"
            disabled={!!memberError}
          >
            <Play size={18} />
            保存して開始
          </button>
        </div>
      </fieldset>
    </form>
  )
}

function ResultForm({
  event,
  roundId,
  game,
  store,
  disabled,
  onSaved,
}: {
  event: PartyEvent
  roundId: string
  game: number
  store: PartyStore
  disabled: boolean
  onSaved: () => void
}) {
  const round = event.rounds.find((candidate) => candidate.id === roundId)!
  const [original] = useState(round.results[game])
  const [ranks, setRanks] = useState<string[]>(
    original?.ranks.map(String) ?? ['', '', '', ''],
  )
  const [title, setTitle] = useState(original?.title ?? 'ミニゲーム')
  const numeric = ranks.map(Number)
  const valid = ranks.every(Boolean) && validRanks(numeric)
  const score = valid ? points(numeric) : null
  return (
    <form
      onSubmit={async (submission) => {
        submission.preventDefault()
        if (!valid) return
        const result: Result = { ranks: numeric, title }
        if (
          await store.submit({
            type: 'result',
            roundId,
            game,
            result,
            expected: original,
          })
        )
          onSaved()
      }}
    >
      <fieldset disabled={disabled}>
        <label className="field">
          ゲーム名
          <input
            value={title}
            maxLength={60}
            required
            onChange={(change) => setTitle(change.target.value)}
          />
        </label>
        <div className="result-players">
          {round.players.map((id, index) => (
            <label className="result-player" data-seat={index} key={id}>
              <span className="player-badge">{index + 1}P</span>
              <strong>
                {event.members.find((member) => member.id === id)?.name}
              </strong>
              <select
                aria-label={`${index + 1}Pの順位`}
                value={ranks[index]}
                onChange={(change) =>
                  setRanks(
                    ranks.map((rank, position) =>
                      position === index ? change.target.value : rank,
                    ),
                  )
                }
              >
                <option value="">順位</option>
                {[1, 2, 3, 4].map((rank) => (
                  <option value={rank} key={rank}>
                    {rank}位
                  </option>
                ))}
              </select>
              <span className="result-points">
                {score ? `${score[index]}pt` : '-'}
              </span>
            </label>
          ))}
        </div>
        {ranks.every(Boolean) && !valid && (
          <p className="inline-error" role="alert">
            同着の次の順位は飛ばしてください。例：1・1・3・4位。
          </p>
        )}
        <div className="form-actions">
          <button
            className="button primary"
            type="submit"
            disabled={!valid || !title.trim()}
          >
            <Save size={18} />
            {original ? '結果を訂正' : '結果を保存'}
          </button>
          {original && (
            <button
              type="button"
              className="button danger"
              onClick={async () => {
                if (
                  confirm('この結果を取り消しますか？訂正履歴は残ります。') &&
                  (await store.submit({
                    type: 'result',
                    roundId,
                    game,
                    result: null,
                    expected: original,
                  }))
                )
                  onSaved()
              }}
            >
              <Trash2 size={18} />
              結果を取消
            </button>
          )}
        </div>
      </fieldset>
    </form>
  )
}

function Swap({
  event,
  store,
  disabled,
}: {
  event: PartyEvent
  store: PartyStore
  disabled: boolean
}) {
  const rounds = event.rounds.filter((round) =>
    round.results.every((result) => !result),
  )
  const choices = rounds.flatMap((round) =>
    round.players.map((id) => ({
      value: `${round.id}:${id}`,
      label: `第${event.rounds.indexOf(round) + 1}対戦 · ${event.members.find((member) => member.id === id)?.name}`,
    })),
  )
  const [first, setFirst] = useState('')
  const [second, setSecond] = useState('')
  const [firstRound, firstMember] = first.split(':')
  const [secondRound, secondMember] = second.split(':')
  const command = {
    type: 'swap' as const,
    firstRound,
    firstMember,
    secondRound,
    secondMember,
  }
  let error = ''
  if (first && second) {
    try {
      applyCommand(event, command)
    } catch (failure) {
      error = failure instanceof Error ? failure.message : '交換できません。'
    }
  }
  return (
    <details className="admin-details">
      <summary>
        <Shuffle size={18} />
        出番を交換
      </summary>
      <fieldset disabled={disabled}>
        <div className="swap-fields">
          {[
            { name: '交換元', value: first, change: setFirst },
            { name: '交換先', value: second, change: setSecond },
          ].map((control) => (
            <label className="field" key={control.name}>
              {control.name}
              <select
                value={control.value}
                onChange={(change) => control.change(change.target.value)}
              >
                <option value="">出番を選択</option>
                {choices.map((choice) => (
                  <option key={choice.value} value={choice.value}>
                    {choice.label}
                  </option>
                ))}
              </select>
            </label>
          ))}
        </div>
        {error && <p className="inline-error">{error}</p>}
        <button
          className="button"
          disabled={!first || !second || !!error}
          onClick={() => void store.submit(command)}
        >
          <Shuffle size={16} />
          交換する
        </button>
      </fieldset>
    </details>
  )
}

export function Backups({
  store,
  state,
}: {
  store: PartyStore
  state: StoreState
}) {
  const file = useRef<HTMLInputElement>(null)
  const importFile = async (input: File) => {
    try {
      if (input.size > 1_000_000)
        throw new Error('バックアップは1MB以下にしてください。')
      const data = JSON.parse(await input.text())
      if (data.format !== 'party-night-v1')
        throw new Error('対応していないバックアップです。')
      if (data.unsent)
        throw new Error(
          '未送信入力を含むバックアップです。元の端末で再送または取消してから書き出してください。',
        )
      const event = parseEvent(data.event)
      if (
        confirm(
          state.cloud
            ? 'バックアップから別のイベントを新規作成しますか？元のイベントは変更しません。'
            : 'この端末の試用データをバックアップで置き換えますか？',
        )
      )
        await store.create(event)
    } catch (error) {
      store.report(error)
    } finally {
      if (file.current) file.current.value = ''
    }
  }
  return (
    <div className="backup-actions">
      {state.event && (
        <>
          <button
            className="button"
            onClick={() => download('party-night-backup.json', store.backup())}
          >
            <Download size={17} />
            バックアップ
          </button>
          <button
            className="button"
            onClick={() =>
              download(
                'party-night-ranking.csv',
                csv(state.event!),
                'text/csv;charset=utf-8',
              )
            }
          >
            <Download size={17} />
            順位CSV
          </button>
        </>
      )}
      <button
        className="button"
        disabled={state.saving || !!state.pending || !state.user}
        onClick={() => file.current?.click()}
      >
        <Upload size={17} />
        バックアップ読込
      </button>
      <input
        ref={file}
        type="file"
        accept=".json,application/json"
        hidden
        onChange={(change) => {
          if (change.target.files?.[0]) void importFile(change.target.files[0])
        }}
      />
    </div>
  )
}

export function Admin({
  store,
  state,
}: {
  store: PartyStore
  state: StoreState
}) {
  const event = state.event!
  const [selectedRound, setSelectedRound] = useState(
    currentRound(event)?.id ?? event.rounds[0].id,
  )
  const [game, setGame] = useState(0)
  const [formVersion, setFormVersion] = useState(0)
  const [finish, setFinish] = useState<'normal' | 'early' | null>(null)
  const [additionalRounds, setAdditionalRounds] = useState(
    Math.max(
      1,
      Math.min(
        Math.ceil(event.members.length / 4),
        MAX_ROUNDS - event.rounds.length,
      ),
    ),
  )
  const [editor, setEditor] = useState(
    event.editorIds.find((id) => id !== event.ownerId) ?? '',
  )
  const round =
    event.rounds.find((candidate) => candidate.id === selectedRound) ??
    event.rounds[0]
  const disabled = state.saving || !!state.pending || event.phase === 'finished'
  const next = () => {
    setFormVersion((value) => value + 1)
    const latest = store.getSnapshot().event!
    const same = latest.rounds.find(
      (candidate) => candidate.id === selectedRound,
    )!
    const missing = same.results.findIndex((result) => !result)
    if (missing >= 0) setGame(missing)
    else {
      const upcoming = currentRound(latest)
      if (upcoming) {
        setSelectedRound(upcoming.id)
        setGame(upcoming.results.findIndex((result) => !result))
      }
    }
  }
  return (
    <section className="admin">
      <div className="section-heading">
        <div>
          <span className="eyebrow">HOST DESK</span>
          <h2>司会</h2>
        </div>
        <div className="phase-actions">
          {event.phase !== 'finished' && event.phase !== 'setup' && (
            <>
              <button
                className="button primary"
                disabled={disabled}
                onClick={() =>
                  void store.submit({
                    type: 'phase',
                    phase: event.phase === 'playing' ? 'paused' : 'playing',
                  })
                }
              >
                {event.phase === 'playing' ? (
                  <Pause size={18} />
                ) : (
                  <Play size={18} />
                )}
                {event.phase === 'playing' ? '休憩' : '再開'}
              </button>
              <button
                className="button"
                disabled={disabled || !canFinish(event)}
                onClick={() => setFinish('normal')}
              >
                <Award size={18} />
                順位を確定
              </button>
              {!canFinish(event) && (
                <button
                  className="button danger"
                  disabled={disabled || !canFinishEarly(event)}
                  onClick={() => setFinish('early')}
                >
                  <Square size={18} />
                  途中終了
                </button>
              )}
            </>
          )}
        </div>
      </div>
      {event.phase === 'setup' ? (
        <Setup
          key={event.revision}
          event={event}
          store={store}
          disabled={disabled}
        />
      ) : event.phase === 'finished' ? (
        <p className="final-notice">
          <Check size={20} />
          最終順位は確定済みです。
        </p>
      ) : (
        <section className="result-section">
          <div className="result-picker">
            <label className="field">
              対戦
              <select
                aria-label="入力する対戦"
                value={round.id}
                disabled={disabled}
                onChange={(change) => {
                  setSelectedRound(change.target.value)
                  setGame(0)
                }}
              >
                {event.rounds.map((candidate, index) => (
                  <option value={candidate.id} key={candidate.id}>
                    第{index + 1}対戦{' '}
                    {candidate.results.every(Boolean) ? '記録済み' : '未記録'}
                  </option>
                ))}
              </select>
            </label>
            <div className="game-tabs" role="tablist" aria-label="結果の本数">
              {round.results.map((result, index) => (
                <button
                  key={index}
                  role="tab"
                  aria-selected={game === index}
                  disabled={disabled}
                  onClick={() => setGame(index)}
                >
                  {result && <Check size={15} />}
                  {index + 1}本目
                </button>
              ))}
            </div>
          </div>
          <ResultForm
            key={`${round.id}-${game}-${formVersion}`}
            event={event}
            roundId={round.id}
            game={game}
            store={store}
            disabled={disabled}
            onSaved={next}
          />
        </section>
      )}
      {event.phase !== 'finished' && (
        <>
          {event.phase !== 'setup' && (
            <section className="extension-section">
              <h3>対戦を追加</h3>
              <form
                onSubmit={async (submission) => {
                  submission.preventDefault()
                  const hadCurrent = currentRound(event)
                  if (
                    (await store.submit({
                      type: 'extend',
                      count: additionalRounds,
                    })) &&
                    !hadCurrent
                  ) {
                    const upcoming = currentRound(store.getSnapshot().event!)
                    if (upcoming) {
                      setSelectedRound(upcoming.id)
                      setGame(0)
                      setFormVersion((value) => value + 1)
                    }
                  }
                }}
              >
                <fieldset
                  disabled={disabled || event.rounds.length >= MAX_ROUNDS}
                >
                  <label className="field">
                    追加対戦数
                    <input
                      type="number"
                      min={1}
                      max={MAX_ROUNDS - event.rounds.length}
                      required
                      value={additionalRounds}
                      onChange={(change) =>
                        setAdditionalRounds(Number(change.target.value))
                      }
                    />
                  </label>
                  <button className="button" type="submit">
                    <Plus size={18} />
                    対戦を追加
                  </button>
                </fieldset>
              </form>
              <p className="muted">
                現在{event.rounds.length}対戦 · 最大{MAX_ROUNDS}対戦 ·
                記録済み結果は変更しません
              </p>
            </section>
          )}
          <Swap event={event} store={store} disabled={disabled} />
          <details className="admin-details">
            <summary>
              <Award size={18} />
              表彰人数
            </summary>
            <fieldset disabled={disabled} className="radio-group">
              {([1, 3] as const).map((value) => (
                <label key={value}>
                  <input
                    type="radio"
                    name="award-edit"
                    checked={event.awards === value}
                    onChange={() =>
                      void store.submit({ type: 'awards', awards: value })
                    }
                  />
                  上位{value}人
                </label>
              ))}
            </fieldset>
          </details>
        </>
      )}
      <details className="admin-details">
        <summary>
          <Download size={18} />
          結果の保存・読込
        </summary>
        <Backups store={store} state={state} />
        <button
          className="button new-event"
          disabled={state.saving || !!state.pending}
          onClick={() => {
            if (
              confirm(
                '新しいイベントを作成しますか？ローカル試用では現在のデータが置き換わります。',
              )
            )
              void store.create()
          }}
        >
          <Play size={16} />
          新しいイベント
        </button>
      </details>
      {state.cloud &&
        state.user?.uid === event.ownerId &&
        event.phase !== 'finished' && (
          <details className="admin-details">
            <summary>
              <Gamepad2 size={18} />
              もう1人の司会者
            </summary>
            <form
              onSubmit={(submission) => {
                submission.preventDefault()
                void store.submit({ type: 'editor', uid: editor })
              }}
            >
              <fieldset disabled={disabled}>
                <label className="field">
                  司会者のUID
                  <input
                    value={editor}
                    maxLength={128}
                    onChange={(change) => setEditor(change.target.value)}
                  />
                </label>
                <button className="button" type="submit">
                  <Save size={16} />
                  権限を保存
                </button>
              </fieldset>
            </form>
          </details>
        )}
      <details className="admin-details">
        <summary>
          変更履歴 <span>{event.history.length}</span>
        </summary>
        <ol className="history-list">
          {event.history
            .slice()
            .reverse()
            .map((entry, index) => (
              <li key={`${entry.at}-${index}`}>
                <time>
                  {new Date(entry.at).toLocaleTimeString('ja-JP', {
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </time>
                <span>{entry.message}</span>
                <small>{entry.actor}</small>
              </li>
            ))}
        </ol>
      </details>
      {finish && (
        <Modal
          title={finish === 'early' ? '途中終了を確定' : '最終順位を確定'}
          close={() => setFinish(null)}
        >
          <p>
            {finish === 'early'
              ? `記録済み${event.rounds.flatMap((round) => round.results).filter(Boolean).length}本で終了し、未記録の対戦を打ち切ります。`
              : '予定したすべての結果が揃っています。'}
            平均得点、同点なら1位率で順位を決めます。未参加
            {standings(event).filter((row) => row.played === 0).length}
            人は順位対象外です。確定後は結果の訂正・延長・表彰人数の変更ができません。
          </p>
          <Ranking event={event} />
          <button
            className="button primary wide"
            disabled={disabled}
            onClick={async () => {
              if (
                await store.submit(
                  finish === 'early'
                    ? { type: 'end-early' }
                    : { type: 'phase', phase: 'finished' },
                )
              )
                setFinish(null)
            }}
          >
            <Award size={18} />
            {finish === 'early' ? '途中終了して確定' : 'この順位で確定する'}
          </button>
        </Modal>
      )}
    </section>
  )
}
