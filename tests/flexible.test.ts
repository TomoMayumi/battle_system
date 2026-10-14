import { describe, expect, it } from 'vitest'
import {
  applyCommand,
  canFinish,
  createEvent,
  membersFromText,
  parseEvent,
  schedule,
  standings,
} from '../src/domain'

describe('可変人数・対戦数', () => {
  it.each([4, 5, 7, 8, 9, 13, 15, 16, 20, 32, 64])(
    '%i人でも重複なく出番を均等に割当',
    (count) => {
      const members = membersFromText(
        Array.from(
          { length: count - 2 },
          (_, index) => `新人${index + 1}`,
        ).join('\n'),
        '講師1\n講師2',
      )
      for (const length of [1, 3, count, count + 2, 200]) {
        const rounds = schedule(members, 1, 42, length)
        expect(rounds).toHaveLength(length)
        const appearances = members.map(
          (member) =>
            rounds.filter((round) => round.players.includes(member.id)).length,
        )
        expect(
          Math.max(...appearances) - Math.min(...appearances),
        ).toBeLessThanOrEqual(1)
        expect(rounds.every((round) => new Set(round.players).size === 4)).toBe(
          true,
        )
      }
    },
  )
  it('改行と空行を処理し、IDを保持、重複や範囲外を拒否', () => {
    const members = membersFromText(
      ' A\r\n\r\nB \n C\nD ',
      '',
      createEvent().members,
    )
    expect(members.map((member) => member.name)).toEqual(['A', 'B', 'C', 'D'])
    expect(members[0].id).toBe('member-1')
    expect(() => membersFromText('A\nA\nB\nC', '')).toThrow()
    expect(() => membersFromText('A\nB\nC', '')).toThrow()
    expect(() =>
      membersFromText(
        Array.from({ length: 65 }, (_, index) => `人${index}`).join('\n'),
        '',
      ),
    ).toThrow()
  })
  it('追加しても既存の対戦・記録を変えない', () => {
    let event = applyCommand(createEvent(), { type: 'phase', phase: 'playing' })
    event = applyCommand(event, {
      type: 'result',
      roundId: 'round-1',
      game: 0,
      result: { title: 'ゲーム', ranks: [1, 2, 3, 4] },
    })
    const before = structuredClone(event.rounds)
    event = applyCommand(event, { type: 'extend', count: 5 })
    expect(event.rounds).toHaveLength(20)
    expect(event.rounds.slice(0, 15)).toEqual(before)
    expect(new Set(event.rounds.map((round) => round.id)).size).toBe(20)
    expect(() => applyCommand(event, { type: 'extend', count: 181 })).toThrow()
    expect(parseEvent(event)).toEqual(event)
  })
  it('途中終了では未記録を保持し、未参加者を順位から除外', () => {
    let event = applyCommand(createEvent(), { type: 'phase', phase: 'playing' })
    expect(() => applyCommand(event, { type: 'end-early' })).toThrow()
    event = applyCommand(event, {
      type: 'result',
      roundId: 'round-1',
      game: 0,
      result: { title: 'ゲーム', ranks: [1, 2, 3, 4] },
    })
    expect(canFinish(event)).toBe(false)
    event = applyCommand(event, { type: 'end-early' })
    expect(event.phase).toBe('finished')
    expect(event.endedEarly).toBe(true)
    expect(event.rounds[0].results[1]).toBeNull()
    expect(standings(event).filter((row) => row.rank > 0)).toHaveLength(4)
    expect(standings(event).filter((row) => row.rank === 0)).toHaveLength(11)
    expect(parseEvent(event)).toEqual(event)
    expect(() => applyCommand(event, { type: 'extend', count: 1 })).toThrow()
  })
  it('本数に差があっても平均点・1位率で比較する', () => {
    let event = applyCommand(createEvent(), { type: 'phase', phase: 'playing' })
    event = applyCommand(event, {
      type: 'result',
      roundId: 'round-1',
      game: 0,
      result: { title: 'ゲーム', ranks: [2, 1, 3, 4] },
    })
    event = applyCommand(event, {
      type: 'result',
      roundId: 'round-1',
      game: 1,
      result: { title: 'ゲーム', ranks: [2, 1, 3, 4] },
    })
    const firstPlayer = event.rounds[0].players[0]
    const unused = event.members.find(
      (member) => !event.rounds[0].players.includes(member.id),
    )!
    const target = event.rounds.find(
      (round) =>
        round.players.includes(unused.id) &&
        !round.players.includes(firstPlayer),
    )!
    const ranks = target.players.map((id) => (id === unused.id ? 1 : 3))
    const otherIds = target.players.filter((id) => id !== unused.id)
    ranks[target.players.indexOf(otherIds[0])] = 2
    ranks[target.players.indexOf(otherIds[2])] = 4
    event = applyCommand(event, {
      type: 'result',
      roundId: target.id,
      game: 0,
      result: { title: 'ゲーム', ranks },
    })
    const rows = standings(event)
    expect(rows.find((row) => row.id === firstPlayer)?.score).toBe(6)
    expect(rows.find((row) => row.id === firstPlayer)?.average).toBe(3)
    expect(rows.find((row) => row.id === unused.id)?.score).toBe(4)
    expect(rows.find((row) => row.id === unused.id)!.rank).toBeLessThan(
      rows.find((row) => row.id === firstPlayer)!.rank,
    )
  })
  it('旧15人の保存データをそのまま読み込める', () => {
    const event = createEvent()
    expect(parseEvent(JSON.parse(JSON.stringify(event)))).toEqual(event)
  })
})
