import { useEffect, useState, useSyncExternalStore } from 'react'
import {
  Award,
  Check,
  Copy,
  Expand,
  Gamepad2,
  ListOrdered,
  LogIn,
  LogOut,
  QrCode,
  RefreshCw,
  Settings2,
  Trophy,
  UserRound,
  UsersRound,
  Wifi,
  WifiOff,
  X,
} from 'lucide-react'
import { QRCodeSVG } from 'qrcode.react'
import { Admin, Backups, Modal, Queue, Ranking, Schedule } from './components'
import { currentRound } from './domain'
import {
  PartyStore,
  cloudMode,
  eventId,
  invalidConfig,
  download,
} from './store'

const query = new URLSearchParams(location.search)
const projection = query.get('display') === '1'
const phaseNames = {
  setup: '開始前',
  playing: '対戦中',
  paused: '休憩中',
  finished: '確定済み',
}
const tabs = [
  { id: 'queue', label: '進行', icon: Gamepad2 },
  { id: 'ranking', label: '順位', icon: ListOrdered },
  { id: 'schedule', label: '対戦表', icon: UsersRound },
  { id: 'admin', label: '司会', icon: Settings2 },
] as const

export default function App() {
  const [store] = useState(() => new PartyStore())
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot)
  useEffect(() => store.start(), [store])
  const [tab, setTab] = useState<(typeof tabs)[number]['id']>('queue')
  const [share, setShare] = useState(false)
  const [account, setAccount] = useState(false)
  const [copied, setCopied] = useState(false)
  const [self, setSelf] = useState(() => {
    try {
      return localStorage.getItem(`party-night:self:${eventId}`) ?? ''
    } catch {
      return ''
    }
  })
  const event = state.event
  const completed =
    event?.rounds.flatMap((round) => round.results).filter(Boolean).length ?? 0
  const current = event ? currentRound(event) : null
  const visibleTab = tab === 'admin' && !store.editable ? 'queue' : tab
  const viewerURL = new URL(location.pathname, location.origin)
  if (cloudMode && eventId) viewerURL.searchParams.set('event', eventId)
  if (!cloudMode) viewerURL.searchParams.set('demo', '1')
  viewerURL.searchParams.set('view', 'viewer')
  const displayURL = new URL(viewerURL)
  displayURL.searchParams.set('display', '1')
  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      store.report(
        new Error('コピーできません。URLを選択して共有してください。'),
      )
    }
  }
  return (
    <div className={`app ${projection ? 'projection' : ''}`}>
      <header className="topbar">
        <a className="brand" href={location.pathname + location.search}>
          <img src="/party-mark.svg" alt="" width={38} height={38} />
          <span>
            おつかれさま杯<small>FRIDAY GAME NIGHT</small>
          </span>
        </a>
        <div className="top-actions">
          <span
            className={`connection ${state.pending || !state.online || state.cached ? 'connection-warning' : ''}`}
            role="status"
          >
            {state.online ? <Wifi size={15} /> : <WifiOff size={15} />}
            <span>
              {state.saving
                ? '保存中'
                : state.pending
                  ? '未送信あり'
                  : !state.cloud
                    ? 'この端末のみ'
                    : !state.online
                      ? '通信切断'
                      : state.cached
                        ? '接続確認中'
                        : '共有接続'}
            </span>
          </span>
          {!projection && event && (
            <button
              className="icon-button"
              title="共有QRコード"
              aria-label="共有QRコード"
              onClick={() => setShare(true)}
            >
              <QrCode size={21} />
            </button>
          )}
          {projection ? (
            <button
              className="icon-button"
              title="全画面表示"
              aria-label="全画面表示"
              onClick={() => {
                void document.documentElement
                  .requestFullscreen()
                  .catch(store.report)
              }}
            >
              <Expand size={21} />
            </button>
          ) : (
            state.cloud && (
              <button
                className="icon-button"
                title={state.user ? 'アカウント' : '司会者ログイン'}
                aria-label={state.user ? 'アカウント' : '司会者ログイン'}
                onClick={() => {
                  if (state.user) setAccount(true)
                  else void store.login()
                }}
              >
                {state.user ? <UserRound size={21} /> : <LogIn size={21} />}
              </button>
            )
          )}
        </div>
      </header>
      <main>
        {invalidConfig && (
          <p className="notice" role="alert">
            Firebase設定が未完成のためローカル試用中です。
          </p>
        )}
        {state.error && (
          <div className="error-banner" role="alert">
            <span>{state.error}</span>
            <button
              className="icon-button"
              aria-label="通知を閉じる"
              title="通知を閉じる"
              onClick={store.clearError}
            >
              <X size={18} />
            </button>
          </div>
        )}
        {state.pending && (
          <section className="pending-banner">
            <strong>この端末に未送信の入力があります</strong>
            <div>
              <button
                className="button"
                disabled={state.saving}
                onClick={() => void store.retry()}
              >
                <RefreshCw size={16} />
                再送
              </button>
              <button
                className="button"
                onClick={() =>
                  download('party-night-unsent.json', store.backup())
                }
              >
                <Copy size={16} />
                書き出し
              </button>
              <button
                className="button danger"
                disabled={state.saving}
                onClick={() => {
                  if (
                    confirm(
                      '未送信の入力を取り消し、共有済みの結果に戻しますか？',
                    )
                  )
                    store.discard()
                }}
              >
                <X size={16} />
                入力を取消
              </button>
            </div>
          </section>
        )}
        {state.loading && !event ? (
          <div className="empty-state">
            <RefreshCw size={32} className="loading-icon" />
            <h1>結果を読み込み中</h1>
          </div>
        ) : !event ? (
          <section className="event-create">
            <div className="section-heading">
              <div>
                <span className="eyebrow">HOST DESK</span>
                <h1>
                  {eventId ? 'イベントが見つかりません' : 'イベントを準備'}
                </h1>
              </div>
              <Trophy size={36} />
            </div>
            {state.user ? (
              <>
                <button
                  className="button primary"
                  disabled={state.saving}
                  onClick={() => void store.create()}
                >
                  <Gamepad2 size={20} />
                  イベントを作成
                </button>
                <Backups store={store} state={state} />
              </>
            ) : (
              <button
                className="button primary"
                onClick={() => void store.login()}
              >
                <LogIn size={20} />
                Googleで司会者ログイン
              </button>
            )}
          </section>
        ) : (
          <>
            <section className="event-heading">
              <div>
                <div className="event-label">
                  <span className="eyebrow">PARTY NIGHT</span>
                  <span className={`phase phase-${event.phase}`}>
                    {phaseNames[event.phase]}
                  </span>
                </div>
                <h1>{event.title}</h1>
              </div>
              <div className="event-stats">
                <span>
                  <UsersRound size={16} />
                  {event.members.length}人
                </span>
                <span>
                  <Gamepad2 size={16} />
                  {completed}/{event.rounds.length * event.gamesPerRound}本
                  {event.endedEarly ? ' · 途中終了' : ''}
                </span>
              </div>
            </section>
            {!projection && (
              <nav className="tabs" aria-label="表示切替">
                {tabs
                  .filter(
                    (candidate) => candidate.id !== 'admin' || store.editable,
                  )
                  .map((candidate) => (
                    <button
                      key={candidate.id}
                      aria-current={
                        visibleTab === candidate.id ? 'page' : undefined
                      }
                      className={visibleTab === candidate.id ? 'active' : ''}
                      onClick={() => setTab(candidate.id)}
                    >
                      <candidate.icon size={19} />
                      <span>{candidate.label}</span>
                    </button>
                  ))}
              </nav>
            )}
            {!projection && visibleTab !== 'admin' && (
              <div className="viewer-tools">
                <label>
                  <UserRound size={16} />
                  <select
                    aria-label="自分の名前"
                    value={self}
                    onChange={(change) => {
                      setSelf(change.target.value)
                      try {
                        localStorage.setItem(
                          `party-night:self:${eventId}`,
                          change.target.value,
                        )
                      } catch {
                        store.report(
                          new Error('自分の選択を端末に保存できません。'),
                        )
                      }
                    }}
                  >
                    <option value="">自分の名前</option>
                    {event.members.map((member) => (
                      <option value={member.id} key={member.id}>
                        {member.name}
                      </option>
                    ))}
                  </select>
                </label>
                <span>
                  {current
                    ? `現在：第${event.rounds.indexOf(current) + 1}対戦`
                    : '全対戦終了'}
                </span>
              </div>
            )}
            {projection || visibleTab === 'queue' ? (
              <>
                <Queue event={event} self={self} projection={projection} />
                {!projection && store.resultsEditable && (
                  <Admin store={store} state={state} resultsOnly />
                )}
              </>
            ) : visibleTab === 'ranking' ? (
              <section>
                <div className="section-heading">
                  <div>
                    <span className="eyebrow">LEADERBOARD</span>
                    <h2>
                      {event.phase === 'finished' ? '最終順位' : '現在の順位'}
                    </h2>
                  </div>
                  <Award size={26} />
                </div>
                <Ranking event={event} self={self} />
              </section>
            ) : visibleTab === 'schedule' ? (
              <Schedule event={event} self={self} />
            ) : (
              <Admin store={store} state={state} />
            )}
            <footer>
              <span>
                {event.phase === 'finished' ? 'FINAL RESULTS' : 'PARTY NIGHT'} ·
                おつかれさま杯
              </span>
              <span>
                {state.cloud
                  ? `最終保存 ${new Date(event.updatedAt).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' })}`
                  : 'ローカル試用 · 他の端末とは共有されません'}
              </span>
            </footer>
          </>
        )}
      </main>
      {share && (
        <Modal title="参加者に共有" close={() => setShare(false)}>
          <div className="share-qr">
            <QRCodeSVG value={viewerURL.href} size={220} marginSize={2} />
            <p>{event?.title}</p>
          </div>
          {!state.cloud && (
            <p className="notice">
              ローカル試用中のため、別端末では結果を共有できません。
            </p>
          )}
          <label className="field">
            参加者URL
            <input
              readOnly
              value={viewerURL.href}
              onFocus={(focus) => focus.target.select()}
            />
          </label>
          <div className="share-actions">
            <button
              className="button primary"
              onClick={() => void copy(viewerURL.href)}
            >
              {copied ? <Check size={18} /> : <Copy size={18} />}
              {copied ? 'コピー済み' : 'URLをコピー'}
            </button>
            <a
              className="button"
              href={displayURL.href}
              target="_blank"
              rel="noreferrer"
            >
              <Expand size={18} />
              投影画面
            </a>
          </div>
        </Modal>
      )}
      {account && (
        <Modal title="司会者アカウント" close={() => setAccount(false)}>
          <p>{state.user?.displayName}</p>
          <label className="field">
            UID
            <input
              readOnly
              value={state.user?.uid ?? ''}
              onFocus={(focus) => focus.target.select()}
            />
          </label>
          <div className="share-actions">
            <button
              className="button"
              onClick={() => void copy(state.user?.uid ?? '')}
            >
              <Copy size={17} />
              UIDをコピー
            </button>
            <button
              className="button"
              onClick={() => {
                void store.logout()
                setAccount(false)
              }}
            >
              <LogOut size={17} />
              ログアウト
            </button>
          </div>
        </Modal>
      )}
    </div>
  )
}
