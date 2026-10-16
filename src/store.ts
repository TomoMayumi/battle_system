import { applyCommand, createEvent, parseEvent } from './domain'
import type { Command, PartyEvent } from './domain'
import type { Identity } from './firebase'

export function download(name: string, content: string, type = 'application/json') {
  const url = URL.createObjectURL(new Blob([content], { type }))
  const link = document.createElement('a')
  link.href = url
  link.download = name
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

type Pending = {
  baseRevision: number
  command: Command
  actor: string
  uid: string
}
export type StoreState = {
  event: PartyEvent | null
  user: Identity | null
  loading: boolean
  online: boolean
  saving: boolean
  pending: Pending | null
  error: string
  cached: boolean
  cloud: boolean
}
const params = new URLSearchParams(location.search)
const values = [
  import.meta.env.VITE_FIREBASE_API_KEY,
  import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  import.meta.env.VITE_FIREBASE_PROJECT_ID,
  import.meta.env.VITE_FIREBASE_APP_ID,
]
const configured = values.every(
  (value) =>
    typeof value === 'string' && value.trim() && !value.includes('YOUR_'),
)
export const cloudMode = configured && params.get('demo') !== '1'
export const invalidConfig = values.some(Boolean) && !configured
export const eventId = cloudMode ? params.get('event') : 'local-demo'
export const validEventId =
  !cloudMode || !eventId || /^[a-f0-9]{32}$/.test(eventId)
const cacheKey = `party-night:event:${cloudMode ? 'cloud' : 'local'}:${eventId}`
const pendingKey = `${cacheKey}:pending`

function readCache(): PartyEvent | null {
  try {
    const raw = localStorage.getItem(cacheKey)
    return raw ? parseEvent(JSON.parse(raw)) : null
  } catch {
    return null
  }
}
function readPending(): Pending | null {
  try {
    const raw = localStorage.getItem(pendingKey)
    if (!raw) return null
    const value = JSON.parse(raw) as Pending
    if (
      !Number.isInteger(value.baseRevision) ||
      typeof value.uid !== 'string' ||
      typeof value.actor !== 'string' ||
      !value.command ||
      typeof value.command.type !== 'string'
    )
      return null
    return value
  } catch {
    return null
  }
}
function explanation(error: unknown) {
  if (error instanceof Error) {
    if ('code' in error) {
      if (error.code === 'permission-denied')
        return '権限がありません。ログインしたアカウントとFirestoreルールを確認してください。'
      if (error.code === 'unavailable')
        return '通信できません。接続を戻して再送してください。'
      if (error.code === 'auth/unauthorized-domain')
        return 'このURLからのログインが許可されていません。Firebaseの承認済みドメインを確認してください。'
    }
    return error.message
  }
  return '処理できませんでした。接続と入力内容を確認してください。'
}

export class PartyStore {
  private listeners = new Set<() => void>()
  private services: typeof import('./firebase') | null = null
  private latest: PartyEvent | null = null
  private generation = 0
  private state: StoreState
  constructor() {
    let event = eventId ? readCache() : null
    const pending = cloudMode && eventId ? readPending() : null
    this.latest = event
    if (!cloudMode && !event) event = createEvent()
    if (pending && event && pending.baseRevision === event.revision) {
      try {
        event = applyCommand(event, pending.command, pending.actor)
      } catch {
        event = this.latest
      }
    }
    this.state = {
      event,
      user: cloudMode
        ? null
        : { uid: 'local-host', displayName: 'ローカル司会' },
      loading: cloudMode && !!eventId && validEventId,
      online: navigator.onLine,
      saving: false,
      pending,
      error: validEventId ? '' : 'イベントURLが不正です。',
      cached: cloudMode && !!event,
      cloud: cloudMode,
    }
  }
  subscribe = (listener: () => void) => {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }
  getSnapshot = () => this.state
  private update(update: Partial<StoreState>) {
    this.state = { ...this.state, ...update }
    this.listeners.forEach((listener) => listener())
  }
  report = (error: unknown) => {
    this.update({ error: explanation(error), loading: false })
  }
  clearError = () => this.update({ error: '' })
  get editable() {
    return (
      !!this.state.event &&
      !!this.state.user &&
      this.state.event.editorIds.includes(this.state.user.uid) &&
      params.get('view') !== 'viewer' &&
      params.get('display') !== '1'
    )
  }
  get resultsEditable() {
    return !!this.state.event &&
      ['playing', 'paused'].includes(this.state.event.phase) &&
      params.get('display') !== '1'
  }
  start = () => {
    const generation = ++this.generation
    const disposers: (() => void)[] = []
    const online = () => this.update({ online: navigator.onLine })
    window.addEventListener('online', online)
    window.addEventListener('offline', online)
    disposers.push(() => {
      window.removeEventListener('online', online)
      window.removeEventListener('offline', online)
    })
    if (!cloudMode) {
      try {
        if (this.state.event)
          localStorage.setItem(cacheKey, JSON.stringify(this.state.event))
      } catch {
        this.report(
          new Error(
            '端末に保存できません。ブラウザーのストレージ設定を確認してください。',
          ),
        )
      }
      const listener = (change: StorageEvent) => {
        if (change.key === cacheKey) {
          const event = readCache()
          if (event) this.update({ event })
        }
      }
      window.addEventListener('storage', listener)
      disposers.push(() => window.removeEventListener('storage', listener))
    } else if (validEventId) {
      void import('./firebase')
        .then((services) => {
          if (generation !== this.generation) return
          this.services = services
          disposers.push(
            services.observeIdentity((user) => this.update({ user })),
          )
          if (eventId)
            disposers.push(
              services.observeEvent(
                eventId,
                (event, cached) => {
                  if (cached && !event) {
                    this.update({ loading: false, cached: true })
                    return
                  }
                  this.latest = event
                  if (event) {
                    try {
                      localStorage.setItem(cacheKey, JSON.stringify(event))
                    } catch {
                      this.report(
                        new Error(
                          '端末キャッシュに保存できません。結果を書き出して保管してください。',
                        ),
                      )
                    }
                  }
                  this.update({
                    ...(this.state.pending ? {} : { event }),
                    loading: false,
                    cached,
                  })
                },
                this.report,
              ),
            )
        })
        .catch(this.report)
    }
    return () => {
      this.generation++
      disposers.forEach((dispose) => dispose())
    }
  }
  login = async () => {
    try {
      const services = this.services ?? (await import('./firebase'))
      await services.login()
    } catch (error) {
      this.report(error)
    }
  }
  logout = async () => {
    try {
      await this.services?.logout()
    } catch (error) {
      this.report(error)
    }
  }
  submit = async (command: Command): Promise<boolean> => {
    try {
      if (!this.state.event || !(command.type === 'result' ? this.resultsEditable : this.editable))
        throw new Error('この操作の権限がありません。')
      if (this.state.pending || this.state.saving)
        throw new Error('未送信の入力を処理してから続けてください。')
      const source = this.state.event
      const actor = this.editable
        ? this.state.user?.uid === source.ownerId ? '主催者' : '司会'
        : '参加者'
      const event = applyCommand(source, command, actor)
      if (!cloudMode) {
        const stored = readCache()
        if (stored && stored.revision !== source.revision)
          throw new Error(
            '別のタブで更新されました。再読み込みして確認してください。',
          )
        localStorage.setItem(cacheKey, JSON.stringify(event))
        this.latest = event
        this.update({ event, error: '' })
        return true
      }
      const pending: Pending = {
        baseRevision: source.revision,
        command,
        actor,
        uid: command.type === 'result' ? '' : this.state.user!.uid,
      }
      localStorage.setItem(pendingKey, JSON.stringify(pending))
      this.update({ event, pending, error: '' })
      return await this.retry()
    } catch (error) {
      this.report(error)
      return false
    }
  }
  retry = async (): Promise<boolean> => {
    const pending = this.state.pending
    if (!pending || !eventId || !this.services || this.state.saving)
      return false
    if (pending.command.type !== 'result' && this.state.user?.uid !== pending.uid) {
      this.report(
        new Error('入力した司会者のアカウントでログインしてください。'),
      )
      return false
    }
    if (!navigator.onLine) {
      this.report(
        new Error('通信切断中です。未送信の入力はこの端末に残っています。'),
      )
      return false
    }
    this.update({ saving: true, error: '' })
    try {
      const event = await this.services.commitCommand(
        eventId,
        pending.baseRevision,
        pending.command,
        pending.actor,
      )
      this.latest = event
      this.update({ event, pending: null, cached: false })
      try {
        localStorage.removeItem(pendingKey)
        localStorage.setItem(cacheKey, JSON.stringify(event))
      } catch {
        this.report(
          new Error(
            '共有先には保存済みですが端末保存に失敗しました。バックアップを書き出してください。',
          ),
        )
      }
      return true
    } catch (error) {
      this.report(error)
      return false
    } finally {
      this.update({ saving: false })
    }
  }
  discard = () => {
    if (this.state.saving) return
    try {
      localStorage.removeItem(pendingKey)
      this.update({ event: this.latest, pending: null, error: '' })
    } catch (error) {
      this.report(error)
    }
  }
  create = async (backup?: PartyEvent) => {
    if (this.state.saving) return
    try {
      if (!this.state.user)
        throw new Error('Googleアカウントでログインしてください。')
      if (!navigator.onLine && cloudMode)
        throw new Error('接続を戻してから作成してください。')
      this.update({ saving: true, error: '' })
      const event = backup
        ? parseEvent({
            ...backup,
            ownerId: this.state.user.uid,
            editorIds: [this.state.user.uid],
            revision: 0,
            updatedAt: new Date().toISOString(),
          })
        : createEvent(
            this.state.user.uid,
            crypto.getRandomValues(new Uint32Array(1))[0],
          )
      if (!cloudMode) {
        localStorage.setItem(cacheKey, JSON.stringify(event))
        this.latest = event
        this.update({ event, pending: null })
      } else {
        const services = this.services ?? (await import('./firebase'))
        const id = Array.from(
          crypto.getRandomValues(new Uint8Array(16)),
          (value) => value.toString(16).padStart(2, '0'),
        ).join('')
        await services.createSharedEvent(id, event)
        location.assign(`${location.pathname}?event=${id}`)
      }
    } catch (error) {
      this.report(error)
    } finally {
      this.update({ saving: false })
    }
  }
  backup = () =>
    JSON.stringify(
      {
        format: 'party-night-v1',
        event: this.state.event,
        unsent: this.state.pending,
      },
      null,
      2,
    )
}
