import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { applyCommand, createEvent } from '../src/domain'
import type { PartyEvent } from '../src/domain'

const mocks = vi.hoisted(() => ({
  observeIdentity: vi.fn(),
  observeEvent: vi.fn(),
  commitCommand: vi.fn(),
  login: vi.fn(),
  logout: vi.fn(),
  createSharedEvent: vi.fn(),
}))
vi.mock('../src/firebase', () => mocks)
const id = '12345678901234567890123456789012'
const cacheKey = `party-night:event:cloud:${id}`
let remote: PartyEvent
let callbacks: Set<(event: PartyEvent | null, cached: boolean) => void>
let network: { onLine: boolean }
let storage: Map<string, string>

beforeEach(() => {
  vi.resetModules()
  vi.clearAllMocks()
  vi.stubEnv('VITE_FIREBASE_API_KEY', 'test-key')
  vi.stubEnv('VITE_FIREBASE_AUTH_DOMAIN', 'demo-party-night.firebaseapp.com')
  vi.stubEnv('VITE_FIREBASE_PROJECT_ID', 'demo-party-night')
  vi.stubEnv('VITE_FIREBASE_APP_ID', 'test-app')
  network = { onLine: true }
  storage = new Map()
  vi.stubGlobal('navigator', network)
  vi.stubGlobal('location', {
    search: `?event=${id}`,
    pathname: '/',
    origin: 'http://test.local',
    assign: vi.fn(),
  })
  vi.stubGlobal('window', new EventTarget())
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
  })
  remote = applyCommand(createEvent('owner'), {
    type: 'phase',
    phase: 'playing',
  })
  callbacks = new Set()
  mocks.observeIdentity.mockImplementation((listener) => {
    listener({ uid: 'owner', displayName: '主催者' })
    return () => {}
  })
  mocks.observeEvent.mockImplementation((_id, listener) => {
    callbacks.add(listener)
    listener(remote, false)
    return () => callbacks.delete(listener)
  })
  mocks.commitCommand.mockImplementation(
    async (_id, revision, command, actor) => {
      if (remote.revision !== revision)
        throw new Error('別の端末で更新されています。')
      remote = applyCommand(remote, command, actor)
      callbacks.forEach((listener) => listener(remote, false))
      return remote
    },
  )
})
afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

async function startStore() {
  const { PartyStore } = await import('../src/store')
  const store = new PartyStore()
  const stop = store.start()
  await vi.waitFor(() => expect(store.getSnapshot().user?.uid).toBe('owner'))
  return { store, stop }
}

describe('共有保存と通信障害', () => {
  it('ログインなしの参加者は結果を入力・訂正でき、司会操作はできない', async () => {
    mocks.observeIdentity.mockImplementation((listener) => {
      listener(null)
      return () => {}
    })
    const { PartyStore } = await import('../src/store')
    const store = new PartyStore()
    const stop = store.start()
    await vi.waitFor(() => expect(store.getSnapshot().loading).toBe(false))
    expect(store.editable).toBe(false)
    expect(store.resultsEditable).toBe(true)
    const command = { type: 'result' as const, roundId: 'round-1', game: 0,
      result: { ranks: [1, 2, 3, 4], title: 'ミニゲーム' }, expected: null }
    expect(await store.submit(command)).toBe(true)
    expect(remote.resultEdit).toEqual({ roundIndex: 0, game: 0 })
    expect(await store.submit({ ...command, expected: command.result,
      result: { ranks: [4, 3, 2, 1], title: '訂正' } })).toBe(true)
    expect(remote.rounds[0].results[0]?.title).toBe('訂正')
    expect(await store.submit({ type: 'awards', awards: 1 })).toBe(false)
    network.onLine = false
    expect(await store.submit({ ...command, game: 1 })).toBe(false)
    expect(store.getSnapshot().pending).not.toBeNull()
    network.onLine = true
    expect(await store.retry()).toBe(true)
    expect(remote.rounds[0].results[1]?.title).toBe('ミニゲーム')
    remote = applyCommand(remote, { type: 'end-early' })
    callbacks.forEach((listener) => listener(remote, false))
    expect(store.resultsEditable).toBe(false)
    expect(await store.submit(command)).toBe(false)
    stop()
  })
  it('保存後に未送信データが消え、1度だけ更新される', async () => {
    const { store, stop } = await startStore()
    expect(await store.submit({ type: 'awards', awards: 1 })).toBe(true)
    expect(store.getSnapshot().pending).toBeNull()
    expect(remote.revision).toBe(2)
    expect(storage.has(`${cacheKey}:pending`)).toBe(false)
    stop()
  })
  it('通信切断時に未送信入力を保持し、再起動後に再送できる', async () => {
    const first = await startStore()
    network.onLine = false
    expect(await first.store.submit({ type: 'awards', awards: 1 })).toBe(false)
    expect(first.store.getSnapshot().pending).not.toBeNull()
    expect(first.store.getSnapshot().event?.awards).toBe(1)
    expect(mocks.commitCommand).not.toHaveBeenCalled()
    first.stop()
    const second = await startStore()
    expect(second.store.getSnapshot().event?.awards).toBe(1)
    network.onLine = true
    expect(await second.store.retry()).toBe(true)
    expect(remote.awards).toBe(1)
    expect(second.store.getSnapshot().pending).toBeNull()
    second.stop()
  })
  it('別端末が更新した場合は未送信入力で上書きしない', async () => {
    const first = await startStore()
    network.onLine = false
    await first.store.submit({ type: 'awards', awards: 1 })
    network.onLine = true
    remote = applyCommand(remote, { type: 'phase', phase: 'paused' })
    callbacks.forEach((listener) => listener(remote, false))
    expect(await first.store.retry()).toBe(false)
    expect(first.store.getSnapshot().pending).not.toBeNull()
    expect(remote.awards).toBe(3)
    first.store.discard()
    expect(first.store.getSnapshot().event?.phase).toBe('paused')
    expect(first.store.getSnapshot().pending).toBeNull()
    first.stop()
  })
  it('Firebaseの空キャッシュ通知でも端末の保存済み結果を表示する', async () => {
    storage.set(cacheKey, JSON.stringify(remote))
    mocks.observeEvent.mockImplementation((_id, listener) => {
      listener(null, true)
      return () => {}
    })
    const { store, stop } = await startStore()
    expect(store.getSnapshot().event?.revision).toBe(1)
    expect(store.getSnapshot().cached).toBe(true)
    stop()
  })
  it('保存完了後に端末容量が不足しても再送扱いにしない', async () => {
    const { store, stop } = await startStore()
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => {
        if (key === cacheKey) throw new Error('quota')
        storage.set(key, value)
      },
      removeItem: (key: string) => storage.delete(key),
    })
    expect(await store.submit({ type: 'awards', awards: 1 })).toBe(true)
    expect(store.getSnapshot().pending).toBeNull()
    expect(store.getSnapshot().error).toContain('共有先には保存済み')
    expect(remote.awards).toBe(1)
    stop()
  })
  it('結果フォームが古い場合、別司会者の訂正を上書きしない', async () => {
    remote = applyCommand(remote, {
      type: 'result',
      roundId: 'round-1',
      game: 0,
      result: { ranks: [1, 2, 3, 4], title: '最初' },
    })
    const { store, stop } = await startStore()
    expect(
      await store.submit({
        type: 'result',
        roundId: 'round-1',
        game: 0,
        result: { ranks: [4, 3, 2, 1], title: '古い入力' },
        expected: null,
      }),
    ).toBe(false)
    expect(remote.rounds[0].results[0]?.title).toBe('最初')
    stop()
  })
})
