import { describe, expect, it } from 'vitest'
import {
  applyCommand,
  canFinish,
  createEvent,
  csv,
  parseEvent,
  points,
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
