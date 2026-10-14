import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import {
  Award,
  Check,
  ChevronRight,
  Download,
  Gamepad2,
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
            <th>得点</th>
            <th>1位</th>
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
                {row.score}
                <small>pt</small>
              </td>
              <td>{row.wins}</td>
              <td>
                {row.played}
                <small>/{event.gamesPerRound * 4}</small>
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
  const index = current ? event.rounds.indexOf(current) : 15
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
            .filter((row) => row.rank <= event.awards)
            .map((row) => (
              <article key={row.id} className="winner">
                <Award size={38} />
                <span className="winner-rank">{row.rank}位</span>
                <h3>{row.name}</h3>
                <strong>
                  {row.score}
                  <small>pt</small>
                </strong>
              </article>
            ))}
        </div>
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
              <span>/ 15</span>
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
                {personalScore?.played ?? 0}/{event.gamesPerRound * 4}本 ·{' '}
                {personalScore?.score ?? 0}pt
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
          {index >= 14 && <p className="muted">次の対戦はありません</p>}
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
              <span>/ {15 * event.gamesPerRound}本</span>
            </div>
            <progress
              value={complete}
              max={15 * event.gamesPerRound}
              aria-label="記録済みの本数"
            />
            <div className="summary-facts">
              <span>
                参加者<strong>15人</strong>
              </span>
              <span>
                1人の出番<strong>4枠</strong>
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
            <p>同着は該当順位の平均点。総得点が同じなら1位回数で決定。</p>
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
        <span className="muted">15対戦 · 1人4枠</span>
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
  const [games, setGames] = useState<1 | 2>(event.gamesPerRound)
  const [awards, setAwards] = useState<1 | 3>(event.awards)
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
            members,
            gamesPerRound: games,
            awards,
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
                  {value}本 <small>全員{value * 4}本</small>
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
        <h3>参加者</h3>
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
                  setMembers(
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
        <div className="form-actions">
          <button className="button" type="submit">
            <Save size={18} />
            設定を保存
          </button>
          <button className="button primary" type="submit" value="begin">
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
  const [finish, setFinish] = useState(false)
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
                onClick={() => setFinish(true)}
              >
                <Award size={18} />
                順位を確定
              </button>
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
        <Modal title="最終順位を確定" close={() => setFinish(false)}>
          <p>
            全員{event.gamesPerRound * 4}
            本の結果が揃っています。確定後は結果と表彰人数を変更できません。
          </p>
          <Ranking event={event} />
          <button
            className="button primary wide"
            disabled={disabled}
            onClick={async () => {
              if (await store.submit({ type: 'phase', phase: 'finished' }))
                setFinish(false)
            }}
          >
            <Award size={18} />
            この順位で確定する
          </button>
        </Modal>
      )}
    </section>
  )
}
