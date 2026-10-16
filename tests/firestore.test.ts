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
import {
  applyCommand,
  createEvent,
  membersFromText,
  schedule,
} from '../src/domain'

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
  it('司会は出場者を変更して記録できるが、公開リンクからの出場者変更は拒否', async () => {
    const event = applyCommand(createEvent('owner'), { type: 'phase', phase: 'playing' })
    await environment.withSecurityRulesDisabled(async (context) =>
      setDoc(doc(context.firestore(), 'events', id), event),
    )
    const next = applyCommand(event, { type: 'substitute', roundId: 'round-1',
      memberId: event.rounds[0].players[0], replacementId: event.rounds[1].players[0],
      adjustFuture: true, expectedPlayers: event.rounds[0].players })
    await assertFails(setDoc(doc(environment.unauthenticatedContext().firestore(), 'events', id), next))
    await assertFails(setDoc(doc(identity('stranger'), 'events', id), next))
    await assertSucceeds(setDoc(doc(identity('owner'), 'events', id), next))
    const recorded = applyCommand(next, { type: 'result', roundId: 'round-1', game: 0,
      result: { title: '交代後', ranks: [1, 2, 3, 4] }, expectedPlayers: next.rounds[0].players }, '参加者')
    await assertSucceeds(setDoc(doc(environment.unauthenticatedContext().firestore(), 'events', id), recorded))
  })
  it('未ログインで1本ずつ入力・訂正・取消でき、同着にも対応する', async () => {
    let event = applyCommand(createEvent('owner'), { type: 'phase', phase: 'playing' })
    await environment.withSecurityRulesDisabled(async (context) =>
      setDoc(doc(context.firestore(), 'events', id), event),
    )
    const reference = doc(environment.unauthenticatedContext().firestore(), 'events', id)
    for (const result of [
      { title: '入力', ranks: [1, 2, 3, 4] },
      { title: '訂正', ranks: [1, 1, 3, 4] },
      null,
    ]) {
      event = applyCommand(event, { type: 'result', roundId: 'round-1', game: 0, result }, '参加者')
      await assertSucceeds(setDoc(reference, event))
    }
    event = applyCommand(event, { type: 'result', roundId: 'round-2', game: 1,
      result: { title: '別の本', ranks: [1, 1, 1, 1] } }, '参加者')
    await assertSucceeds(setDoc(reference, event))
  })
  it('公開入力による設定・対戦表・他の結果・履歴の改変と不正な順位を拒否', async () => {
    const before = applyCommand(createEvent('owner'), { type: 'phase', phase: 'playing' })
    await environment.withSecurityRulesDisabled(async (context) =>
      setDoc(doc(context.firestore(), 'events', id), before),
    )
    const next = applyCommand(before, { type: 'result', roundId: 'round-1', game: 0,
      result: { title: '入力', ranks: [1, 2, 3, 4] } }, '参加者')
    const reference = doc(environment.unauthenticatedContext().firestore(), 'events', id)
    const changes = [
      { phase: 'finished' }, { awards: 1 }, { ownerId: 'stranger' },
      { editorIds: ['owner', 'stranger'] }, { title: '変更' },
      { members: before.members.slice(0, 4) }, { gamesPerRound: 1 },
      { revision: before.revision }, { endedEarly: true },
      { resultEdit: { roundIndex: 99, game: 0 } },
      { history: [{ at: next.updatedAt, actor: '参加者', message: '履歴置換' }] },
    ]
    for (const change of changes) await assertFails(setDoc(reference, { ...next, ...change }))
    for (const tamper of [
      (event: typeof next) => { event.rounds[0].players.reverse() },
      (event: typeof next) => { event.rounds[0].id = '変更' },
      (event: typeof next) => { event.rounds[0].results[1] = event.rounds[0].results[0] },
      (event: typeof next) => { event.rounds[1].results[0] = event.rounds[0].results[0] },
      (event: typeof next) => { event.rounds.reverse() },
      (event: typeof next) => { event.rounds[0].results[0]!.ranks = [1, 1, 2, 4] },
      (event: typeof next) => { event.rounds[0].results[0]!.ranks = [0, 2, 3, 4] },
      (event: typeof next) => { event.rounds[0].results[0]!.title = '' },
    ]) {
      const changed = structuredClone(next)
      tamper(changed)
      await assertFails(setDoc(reference, changed))
    }
    await assertSucceeds(setDoc(reference, next))
    await assertFails(setDoc(reference, next))
  })
  it('公開入力でも100件の履歴上限と確定後の不変性を守る', async () => {
    let event = applyCommand(createEvent('owner'), { type: 'phase', phase: 'playing' })
    for (let index = 0; index < 101; index++)
      event = applyCommand(event, { type: 'result', roundId: 'round-1', game: 0,
        result: { title: `入力${index}`, ranks: [1, 2, 3, 4] } }, '参加者',
        new Date(Date.UTC(2026, 9, 16, 0, 0, index)).toISOString())
    await environment.withSecurityRulesDisabled(async (context) =>
      setDoc(doc(context.firestore(), 'events', id), event),
    )
    const reference = doc(environment.unauthenticatedContext().firestore(), 'events', id)
    const next = applyCommand(event, { type: 'result', roundId: 'round-1', game: 0,
      result: { title: '最新', ranks: [4, 3, 2, 1] } }, '参加者')
    await assertSucceeds(setDoc(reference, next))
    const finished = applyCommand(next, { type: 'end-early' })
    await assertSucceeds(setDoc(doc(identity('owner'), 'events', id), finished))
    await assertFails(setDoc(reference, { ...next, revision: finished.revision + 1, phase: 'finished' }))
  })
  it.each([4, 10, 16, 64])(
    '%i人・可変対戦数のイベントを作成できる',
    async (count) => {
      const event = createEvent('owner')
      event.members = membersFromText(
        Array.from({ length: count }, (_, index) => `参加者${index + 1}`).join(
          '\n',
        ),
        '',
      )
      event.rounds = schedule(event.members, 2, 42, 3)
      await assertSucceeds(setDoc(doc(identity('owner'), 'events', id), event))
    },
  )
  it('人数・対戦数の範囲外と不正な終了フラグを拒否', async () => {
    const event = createEvent('owner')
    const reference = doc(identity('owner'), 'events', id)
    await assertFails(
      setDoc(reference, { ...event, members: event.members.slice(0, 3) }),
    )
    await assertFails(
      setDoc(reference, {
        ...event,
        members: Array.from({ length: 65 }, (_, index) => ({
          id: `person-${index}`,
          name: `人${index}`,
          role: 'rookie',
        })),
      }),
    )
    await assertFails(setDoc(reference, { ...event, rounds: [] }))
    await assertFails(
      setDoc(reference, {
        ...event,
        rounds: Array.from({ length: 201 }, () => event.rounds[0]),
      }),
    )
    await assertFails(setDoc(reference, { ...event, endedEarly: 'yes' }))
  })
  it('開始後の延長と途中終了を許可し、確定後の延長は拒否', async () => {
    const reference = doc(identity('owner'), 'events', id)
    let event = createEvent('owner')
    await setDoc(reference, event)
    event = applyCommand(event, { type: 'phase', phase: 'playing' })
    await assertSucceeds(setDoc(reference, event))
    event = applyCommand(event, {
      type: 'result',
      roundId: 'round-1',
      game: 0,
      result: { ranks: [1, 2, 3, 4], title: 'ゲーム' },
    })
    await assertSucceeds(setDoc(reference, event))
    event = applyCommand(event, { type: 'extend', count: 3 })
    await assertSucceeds(setDoc(reference, event))
    event = applyCommand(event, { type: 'end-early' })
    await assertSucceeds(setDoc(reference, event))
    await assertFails(
      setDoc(reference, {
        ...event,
        phase: 'playing',
        revision: event.revision + 1,
      }),
    )
  })
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
