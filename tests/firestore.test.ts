import { readFileSync } from 'node:fs'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
} from '@firebase/rules-unit-testing'
import type { RulesTestEnvironment } from '@firebase/rules-unit-testing'
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  setDoc,
} from 'firebase/firestore'
import { applyCommand, createEvent } from '../src/domain'

let environment: RulesTestEnvironment
const id = '12345678901234567890123456789012'
const identity = (uid: string) =>
  environment.authenticatedContext(uid, { email_verified: true }).firestore()
beforeAll(async () => {
  environment = await initializeTestEnvironment({
    projectId: 'demo-party-night',
    firestore: {
      host: '127.0.0.1',
      port: 8088,
      rules: readFileSync('firestore.rules', 'utf8'),
    },
  })
})
beforeEach(async () => {
  await environment.clearFirestore()
})
afterAll(async () => {
  await environment?.cleanup()
})

describe('Firestore権限', () => {
  it('主催者だけが自分のイベントを作成できる', async () => {
    await assertSucceeds(
      setDoc(doc(identity('owner'), 'events', id), createEvent('owner')),
    )
    const stranger = doc(
      identity('stranger'),
      'events',
      'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    )
    await assertFails(setDoc(stranger, createEvent('owner')))
    await assertFails(
      setDoc(
        doc(
          environment.unauthenticatedContext().firestore(),
          'events',
          'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
        ),
        createEvent('owner'),
      ),
    )
  })
  it('URLを知る参加者は閲覧できるが、一覧取得・書込・削除は不可', async () => {
    const event = createEvent('owner')
    await setDoc(doc(identity('owner'), 'events', id), event)
    const anonymous = environment.unauthenticatedContext().firestore()
    expect(
      (await assertSucceeds(getDoc(doc(anonymous, 'events', id)))).exists(),
    ).toBe(true)
    await assertFails(getDocs(collection(anonymous, 'events')))
    await assertFails(
      setDoc(
        doc(anonymous, 'events', id),
        applyCommand(event, { type: 'phase', phase: 'playing' }),
      ),
    )
    await assertFails(deleteDoc(doc(identity('owner'), 'events', id)))
  })
  it('他人の更新、主催者変更、無効なrevisionを拒否', async () => {
    const event = createEvent('owner')
    await setDoc(doc(identity('owner'), 'events', id), event)
    const next = applyCommand(event, { type: 'phase', phase: 'playing' })
    await assertFails(setDoc(doc(identity('stranger'), 'events', id), next))
    await assertFails(
      setDoc(doc(identity('owner'), 'events', id), {
        ...next,
        ownerId: 'stranger',
      }),
    )
    await assertFails(
      setDoc(doc(identity('owner'), 'events', id), { ...next, revision: 5 }),
    )
    await assertSucceeds(setDoc(doc(identity('owner'), 'events', id), next))
  })
  it('追加された司会者は入力できるが、権限を変更できない', async () => {
    const event = createEvent('owner')
    await setDoc(doc(identity('owner'), 'events', id), event)
    const added = applyCommand(
      event,
      { type: 'editor', uid: 'second' },
      '主催者',
    )
    await assertSucceeds(setDoc(doc(identity('owner'), 'events', id), added))
    const next = applyCommand(added, { type: 'phase', phase: 'playing' })
    await assertSucceeds(setDoc(doc(identity('second'), 'events', id), next))
    await assertFails(
      setDoc(doc(identity('second'), 'events', id), {
        ...next,
        revision: next.revision + 1,
        editorIds: ['owner', 'stranger'],
      }),
    )
  })
  it('開始後に参加者・本数を変更できない', async () => {
    const event = applyCommand(createEvent('owner'), {
      type: 'phase',
      phase: 'playing',
    })
    await environment.withSecurityRulesDisabled(async (context) =>
      setDoc(doc(context.firestore(), 'events', id), event),
    )
    await assertFails(
      setDoc(doc(identity('owner'), 'events', id), {
        ...event,
        revision: event.revision + 1,
        gamesPerRound: 1,
      }),
    )
    await assertFails(
      setDoc(doc(identity('owner'), 'events', id), {
        ...event,
        revision: event.revision + 1,
        members: event.members.map((member) => ({ ...member, name: '変更' })),
      }),
    )
  })
  it('確定後は主催者でも変更できない', async () => {
    let event = applyCommand(createEvent('owner'), {
      type: 'phase',
      phase: 'playing',
    })
    for (const round of event.rounds)
      for (let game = 0; game < 2; game++)
        event = applyCommand(event, {
          type: 'result',
          roundId: round.id,
          game,
          result: { title: 'テスト', ranks: [1, 2, 3, 4] },
        })
    event = applyCommand(event, { type: 'phase', phase: 'finished' })
    await environment.withSecurityRulesDisabled(async (context) =>
      setDoc(doc(context.firestore(), 'events', id), event),
    )
    await assertFails(
      setDoc(doc(identity('owner'), 'events', id), {
        ...event,
        revision: event.revision + 1,
        phase: 'playing',
      }),
    )
    await assertFails(
      setDoc(doc(identity('owner'), 'events', id), {
        ...event,
        revision: event.revision + 1,
        awards: 1,
      }),
    )
  })
})
