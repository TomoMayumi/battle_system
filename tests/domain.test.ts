import { describe, expect, it } from 'vitest'
import {
  applyCommand,
  canFinish,
  createEvent,
  csv,
  parseEvent,
  points,
  ranksFromOrder,
  resultOrder,
  substitutionTarget,
  schedule,
  standings,
} from '../src/domain'

describe('公平な対戦表', () => {
  it.each(Array.from({ length: 40 }, (_, index) => index))(
    'seed %i: 全員4回・連続なし・講師が別枠',
    (seed) => {
      const event = createEvent()
      const rounds = schedule(event.members, 2, seed)
      expect(rounds).toHaveLength(15)
      for (const member of event.members)
        expect(
          rounds.filter((round) => round.players.includes(member.id)),
        ).toHaveLength(4)
      rounds.forEach((round, index) => {
        expect(new Set(round.players).size).toBe(4)
        expect(
          round.players.filter(
            (id) =>
              event.members.find((member) => member.id === id)?.role === 'host',
          ).length,
        ).toBeLessThanOrEqual(1)
        if (index > 0)
          expect(
            round.players.filter((id) =>
              rounds[index - 1].players.includes(id),
            ),
          ).toHaveLength(0)
      })
    },
  )
})

describe('採点・保存検証', () => {
  it('未記録対戦の出場者を変更し、実際の出場者へ得点を付ける', () => {
    const event = applyCommand(createEvent(), { type: 'phase', phase: 'playing' })
    const memberId = event.rounds[0].players[0]
    const replacementId = event.rounds[1].players[0]
    const changed = applyCommand(event, { type: 'substitute', roundId: 'round-1', memberId,
      replacementId, adjustFuture: false, expectedPlayers: event.rounds[0].players })
    expect(changed.members).toEqual(event.members)
    expect(changed.rounds[0].players[0]).toBe(replacementId)
    expect(changed.rounds.slice(1)).toEqual(event.rounds.slice(1))
    const recorded = applyCommand(changed, { type: 'result', roundId: 'round-1', game: 0,
      result: { title: '交代後', ranks: [1, 2, 3, 4] }, expectedPlayers: changed.rounds[0].players })
    expect(standings(recorded).find((member) => member.id === replacementId)?.score).toBe(4)
    expect(standings(recorded).find((member) => member.id === memberId)?.played).toBe(0)
    expect(() => applyCommand(recorded, { type: 'substitute', roundId: 'round-1', memberId: replacementId,
      replacementId: memberId, adjustFuture: false, expectedPlayers: recorded.rounds[0].players })).toThrow('記録済み')
  })
  it('交代相手の次の出番を交換し、各人の予定回数を保持する', () => {
    const event = applyCommand(createEvent(), { type: 'phase', phase: 'playing' })
    const memberId = event.rounds[0].players[0]
    const replacementId = event.rounds[1].players[0]
    expect(substitutionTarget(event, 'round-1', memberId, replacementId)?.id).toBe('round-2')
    const changed = applyCommand(event, { type: 'substitute', roundId: 'round-1', memberId,
      replacementId, adjustFuture: true, expectedPlayers: event.rounds[0].players })
    expect(changed.rounds[1].players[0]).toBe(memberId)
    expect(changed.rounds.slice(2)).toEqual(event.rounds.slice(2))
    for (const member of event.members)
      expect(changed.rounds.filter((round) => round.players.includes(member.id)).length)
        .toBe(event.rounds.filter((round) => round.players.includes(member.id)).length)
  })
  it('重複・未登録者・古い出場者の入力・確定後変更を拒否し、交換先がなければ以降を保持する', () => {
    const event = applyCommand(createEvent(), { type: 'phase', phase: 'playing' })
    const command = { type: 'substitute' as const, roundId: 'round-15', memberId: event.rounds[14].players[0],
      replacementId: event.rounds[0].players[0], adjustFuture: true, expectedPlayers: event.rounds[14].players }
    command.replacementId = event.members.find((member) => !event.rounds[14].players.includes(member.id))!.id
    const changed = applyCommand(event, command)
    expect(changed.rounds.slice(0, 14)).toEqual(event.rounds.slice(0, 14))
    expect(changed.history.at(-1)?.message).toContain('以降の対戦は変更なし')
    expect(() => applyCommand(event, { ...command, replacementId: command.expectedPlayers[1] })).toThrow('登録済み')
    expect(() => applyCommand(event, { ...command, replacementId: 'unknown' })).toThrow('登録済み')
    expect(() => applyCommand(changed, command)).toThrow('出場者が変更')
    expect(() => applyCommand(changed, { type: 'result', roundId: 'round-15', game: 0,
      result: { title: '古い入力', ranks: [1, 2, 3, 4] }, expectedPlayers: command.expectedPlayers })).toThrow('出場者が変更')
    const recorded = applyCommand(changed, { type: 'result', roundId: 'round-15', game: 0,
      result: { title: '結果', ranks: [1, 2, 3, 4] } })
    expect(() => applyCommand(applyCommand(recorded, { type: 'end-early' }), command)).toThrow('確定済み')
  })
  it('並び順と同率を元の席順の順位へ変換し、訂正時にも復元できる', () => {
    expect(ranksFromOrder([2, 0, 3, 1], [true, false, false])).toEqual([1, 4, 1, 3])
    expect(ranksFromOrder([0, 1, 2, 3], [false, true, false])).toEqual([1, 2, 2, 4])
    expect(ranksFromOrder([3, 2, 1, 0], [true, true, true])).toEqual([1, 1, 1, 1])
    for (let mask = 0; mask < 8; mask++) {
      const ranks = ranksFromOrder([3, 1, 0, 2], [0, 1, 2].map((bit) => Boolean(mask & (1 << bit))))
      const restored = resultOrder(ranks)
      expect(ranksFromOrder(restored.order, restored.ties)).toEqual(ranks)
      expect(points(ranks).reduce((sum, value) => sum + value, 0)).toBe(10)
    }
    expect(() => ranksFromOrder([0, 0, 2, 3], [false, false, false])).toThrow()
    expect(() => resultOrder([1, 1, 2, 3])).toThrow()
  })
  it('同着でも合計10点になる', () => {
    expect(points([1, 2, 3, 4])).toEqual([4, 3, 2, 1])
    expect(points([1, 1, 3, 4])).toEqual([3.5, 3.5, 2, 1])
    expect(points([1, 2, 2, 4])).toEqual([4, 2.5, 2.5, 1])
    expect(points([1, 1, 1, 1])).toEqual([2.5, 2.5, 2.5, 2.5])
    expect(() => points([1, 1, 2, 3])).toThrow()
    expect(() => points([2, 2, 2, 2])).toThrow()
  })
  it('全結果を入力するまで確定せず、確定後は変更不可', () => {
    let event = applyCommand(createEvent(), { type: 'phase', phase: 'playing' })
    expect(() =>
      applyCommand(event, { type: 'phase', phase: 'finished' }),
    ).toThrow()
    for (const round of event.rounds) {
      for (let game = 0; game < 2; game++)
        event = applyCommand(event, {
          type: 'result',
          roundId: round.id,
          game,
          result: { ranks: [1, 1, 1, 1], title: '同着' },
        })
    }
    expect(canFinish(event)).toBe(true)
    expect(
      standings(event).every(
        (row) => row.played === 8 && row.score === 20 && row.rank === 1,
      ),
    ).toBe(true)
    event = applyCommand(event, { type: 'phase', phase: 'finished' })
    expect(() => applyCommand(event, { type: 'awards', awards: 1 })).toThrow()
  })
  it('訂正・取消と履歴が残る', () => {
    let event = applyCommand(createEvent(), { type: 'phase', phase: 'playing' })
    event = applyCommand(event, {
      type: 'result',
      roundId: 'round-1',
      game: 0,
      result: { ranks: [1, 2, 3, 4], title: 'テスト' },
    })
    expect(standings(event).reduce((sum, row) => sum + row.score, 0)).toBe(10)
    event = applyCommand(event, {
      type: 'result',
      roundId: 'round-1',
      game: 0,
      result: null,
    })
    expect(standings(event).every((row) => row.score === 0)).toBe(true)
    expect(event.history.at(-1)?.message).toContain('取消')
  })
  it('壊れたバックアップ・不公平な表を拒否する', () => {
    const event = createEvent()
    expect(() => parseEvent({ ...event, rounds: [] })).toThrow()
    event.rounds[0].players[0] = event.rounds[0].players[1]
    expect(() => parseEvent(event)).toThrow()
  })
  it('開始後の本数変更と実施済みの交換を拒否', () => {
    let event = applyCommand(createEvent(), { type: 'phase', phase: 'playing' })
    expect(() =>
      applyCommand(event, {
        type: 'configure',
        title: event.title,
        members: event.members,
        gamesPerRound: 1,
        awards: 1,
      }),
    ).toThrow()
    event = applyCommand(event, {
      type: 'result',
      roundId: 'round-1',
      game: 0,
      result: { ranks: [1, 2, 3, 4], title: 'テスト' },
    })
    expect(() =>
      applyCommand(event, {
        type: 'swap',
        firstRound: 'round-1',
        firstMember: event.rounds[0].players[0],
        secondRound: 'round-2',
        secondMember: event.rounds[1].players[0],
      }),
    ).toThrow()
  })
  it('安全な相互交換は参加回数を変えない', () => {
    const source = createEvent()
    let found = false
    for (const first of source.rounds)
      for (const second of source.rounds)
        for (const firstMember of first.players)
          for (const secondMember of second.players) {
            if (found) continue
            try {
              const event = applyCommand(source, {
                type: 'swap',
                firstRound: first.id,
                firstMember,
                secondRound: second.id,
                secondMember,
              })
              expect(
                event.members.every(
                  (member) =>
                    event.rounds.filter((round) =>
                      round.players.includes(member.id),
                    ).length === 4,
                ),
              ).toBe(true)
              found = true
            } catch {
              continue
            }
          }
    expect(found).toBe(true)
  })
  it('CSVの数式実行を防ぐ', () => {
    const event = createEvent()
    event.members[0].name = '=HYPERLINK("bad")'
    expect(csv(event)).toContain("'=HYPERLINK")
  })
})
