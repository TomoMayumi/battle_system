import { getApp, getApps, initializeApp } from 'firebase/app'
import {
  getAuth,
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithPopup,
  signInWithRedirect,
  signOut,
} from 'firebase/auth'
import {
  doc,
  getFirestore,
  onSnapshot,
  runTransaction,
} from 'firebase/firestore'
import { applyCommand, parseEvent } from './domain'
import type { Command, PartyEvent } from './domain'

const config = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
}
const app = getApps().length ? getApp() : initializeApp(config)
const auth = getAuth(app)
const database = getFirestore(app)
export type Identity = { uid: string; displayName: string | null }

export function observeIdentity(listener: (identity: Identity | null) => void) {
  return onAuthStateChanged(auth, (user) =>
    listener(user ? { uid: user.uid, displayName: user.displayName } : null),
  )
}
export async function login() {
  try {
    await signInWithPopup(auth, new GoogleAuthProvider())
  } catch (error) {
    if (
      error instanceof Error &&
      'code' in error &&
      error.code === 'auth/popup-blocked'
    )
      await signInWithRedirect(auth, new GoogleAuthProvider())
    else throw error
  }
}
export function logout() {
  return signOut(auth)
}
export function observeEvent(
  id: string,
  listener: (event: PartyEvent | null, cached: boolean) => void,
  onError: (error: Error) => void,
) {
  return onSnapshot(
    doc(database, 'events', id),
    { includeMetadataChanges: true },
    (snapshot) => {
      try {
        listener(
          snapshot.exists() ? parseEvent(snapshot.data()) : null,
          snapshot.metadata.fromCache,
        )
      } catch {
        onError(
          new Error(
            '保存データを読み込めません。バックアップとFirebase設定を確認してください。',
          ),
        )
      }
    },
    onError,
  )
}
export async function createSharedEvent(id: string, event: PartyEvent) {
  const reference = doc(database, 'events', id)
  await runTransaction(database, async (transaction) => {
    if ((await transaction.get(reference)).exists())
      throw new Error('イベントIDが重複しました。再度作成してください。')
    transaction.set(reference, event)
  })
}
export async function commitCommand(
  id: string,
  baseRevision: number,
  command: Command,
  actor: string,
) {
  const reference = doc(database, 'events', id)
  return runTransaction(database, async (transaction) => {
    const snapshot = await transaction.get(reference)
    if (!snapshot.exists()) throw new Error('イベントが見つかりません。')
    const event = parseEvent(snapshot.data())
    if (!auth.currentUser || !event.editorIds.includes(auth.currentUser.uid))
      throw new Error('司会者の権限がありません。')
    if (event.revision !== baseRevision)
      throw new Error(
        '別の端末で更新されています。未送信データを書き出してから、最新結果を確認してください。',
      )
    const next = applyCommand(event, command, actor)
    transaction.set(reference, next)
    return next
  })
}
