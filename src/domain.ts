import { z } from 'zod'

const memberSchema = z
  .object({
    id: z.string().min(1).max(40),
    name: z.string().trim().min(1).max(24),
    role: z.enum(['rookie', 'host']),
  })
  .strict()
const resultSchema = z
  .object({
    ranks: z.array(z.number().int().min(1).max(4)).length(4),
    title: z.string().trim().min(1).max(60),
  })
  .strict()
const roundSchema = z
  .object({
    id: z.string(),
    players: z.array(z.string()).length(4),
    results: z.array(resultSchema.nullable()).min(1).max(2),
  })
  .strict()
export const eventSchema = z
  .object({
    schemaVersion: z.literal(1),
    title: z.string().trim().min(1).max(60),
    ownerId: z.string().min(1).max(128),
    editorIds: z.array(z.string().min(1).max(128)).min(1).max(2),
    revision: z.number().int().min(0),
    phase: z.enum(['setup', 'playing', 'paused', 'finished']),
    gamesPerRound: z.union([z.literal(1), z.literal(2)]),
    awards: z.union([z.literal(1), z.literal(3)]),
    members: z.array(memberSchema).length(15),
    rounds: z.array(roundSchema).length(15),
    updatedAt: z.string().datetime(),
    history: z
      .array(
        z
          .object({
            at: z.string().datetime(),
            actor: z.string().max(24),
            message: z.string().max(400),
          })
          .strict(),
      )
      .max(100),
  })
  .strict()
export type PartyEvent = z.infer<typeof eventSchema>
export type Member = z.infer<typeof memberSchema>
export type Result = z.infer<typeof resultSchema>
export type Command =
  | {
      type: 'configure'
      title: string
      members: Member[]
      gamesPerRound: 1 | 2
      awards: 1 | 3
    }
  | { type: 'phase'; phase: 'playing' | 'paused' | 'finished' }
  | {
      type: 'result'
      roundId: string
      game: number
      result: Result | null
      expected?: Result | null
    }
  | {
      type: 'swap'
      firstRound: string
      firstMember: string
      secondRound: string
      secondMember: string
    }
  | { type: 'awards'; awards: 1 | 3 }
  | { type: 'editor'; uid: string }

function random(seed: number) {
  let value = seed >>> 0
  return () => {
    value = (Math.imul(value, 1664525) + 1013904223) >>> 0
    return value / 4294967296
  }
}

export function schedule(
  members: Member[],
  gamesPerRound: 1 | 2,
  seed = 42,
): PartyEvent['rounds'] {
  if (
    members.length !== 15 ||
    members.filter((member) => member.role === 'host').length !== 2
  )
    throw new Error('新人13人・講師2人を登録してください。')
  const shuffle = random(seed)
  const rookies = members.filter((member) => member.role === 'rookie')
  for (let index = rookies.length - 1; index > 0; index--) {
    const target = Math.floor(shuffle() * (index + 1))
    ;[rookies[index], rookies[target]] = [rookies[target], rookies[index]]
  }
  const hosts = members.filter((member) => member.role === 'host')
  const ordered = [hosts[0], rookies[0], hosts[1], ...rookies.slice(1)]
  return Array.from({ length: 15 }, (_, index) => ({
    id: `round-${index + 1}`,
    players: [0, 1, 4, 7].map(
      (offset) => ordered[(index * 2 + offset) % 15].id,
    ),
    results: Array.from({ length: gamesPerRound }, () => null),
  }))
}

export function validRanks(ranks: number[]) {
  return (
    ranks.length === 4 &&
    ranks.every(
      (rank) =>
        Number.isInteger(rank) &&
        rank === 1 + ranks.filter((other) => other < rank).length,
    )
  )
}

export function points(ranks: number[]) {
  if (!validRanks(ranks))
    throw new Error('同着の次の順位は飛ばしてください。例：1・1・3・4位。')
  return ranks.map(
    (rank) =>
      5 - rank - (ranks.filter((other) => other === rank).length - 1) / 2,
  )
}

export function parseEvent(input: unknown): PartyEvent {
  const event = eventSchema.parse(input)
  const ids = event.members.map((member) => member.id)
  if (new Set(event.members.map((member) => member.name)).size !== 15)
    throw new Error('ニックネームが重複しています。')
  if (
    new Set(ids).size !== 15 ||
    event.members.filter((member) => member.role === 'host').length !== 2
  )
    throw new Error('参加者の構成が不正です。')
  if (
    !event.editorIds.includes(event.ownerId) ||
    new Set(event.editorIds).size !== event.editorIds.length
  )
    throw new Error('司会者設定が不正です。')
  if (new Set(event.rounds.map((round) => round.id)).size !== 15)
    throw new Error('対戦IDが重複しています。')
  for (const round of event.rounds) {
    if (
      new Set(round.players).size !== 4 ||
      round.players.some((id) => !ids.includes(id)) ||
      round.results.length !== event.gamesPerRound
    )
      throw new Error('対戦表が不正です。')
    if (
      round.players.filter(
        (id) =>
          event.members.find((member) => member.id === id)?.role === 'host',
      ).length > 1
    )
      throw new Error('講師2人の出番は分けてください。')
    round.results.forEach((result) => {
      if (result) points(result.ranks)
    })
  }
  if (
    ids.some(
      (id) =>
        event.rounds.filter((round) => round.players.includes(id)).length !== 4,
    )
  )
    throw new Error('全員の出番を4回に揃えてください。')
  if (
    event.phase === 'setup' &&
    event.rounds.some((round) => round.results.some(Boolean))
  )
    throw new Error('開始前に結果は登録できません。')
  if (event.phase === 'finished' && !canFinish(event))
    throw new Error('全結果が揃っていません。')
  return event
}

export function createEvent(ownerId = 'local-host', seed = 42): PartyEvent {
  const members: Member[] = Array.from({ length: 15 }, (_, index) => ({
    id: `member-${index + 1}`,
    name:
      index < 13
        ? `新人${String(index + 1).padStart(2, '0')}`
        : `講師${index - 12}`,
    role: index < 13 ? 'rookie' : 'host',
  }))
  return {
    schemaVersion: 1,
    title: '新人教育 おつかれさま会',
    ownerId,
    editorIds: [ownerId],
    revision: 0,
    phase: 'setup',
    gamesPerRound: 2,
    awards: 3,
    members,
    rounds: schedule(members, 2, seed),
    updatedAt: new Date().toISOString(),
    history: [],
  }
}

export function standings(event: PartyEvent) {
  const rows = event.members
    .map((member) => {
      let score = 0
      let wins = 0
      let played = 0
      event.rounds.forEach((round) => {
        const position = round.players.indexOf(member.id)
        if (position < 0) return
        round.results.forEach((result) => {
          if (!result) return
          score += points(result.ranks)[position]
          wins += result.ranks[position] === 1 ? 1 : 0
          played++
        })
      })
      return { ...member, score, wins, played, rank: 0 }
    })
    .sort(
      (first, second) =>
        second.score - first.score ||
        second.wins - first.wins ||
        first.id.localeCompare(second.id),
    )
  rows.forEach((row, index) => {
    row.rank =
      index > 0 &&
      row.score === rows[index - 1].score &&
      row.wins === rows[index - 1].wins
        ? rows[index - 1].rank
        : index + 1
  })
  return rows
}

export function canFinish(event: PartyEvent) {
  return (
    event.rounds.every((round) => round.results.every(Boolean)) &&
    standings(event).every((row) => row.played === event.gamesPerRound * 4)
  )
}

export function currentRound(event: PartyEvent) {
  return event.rounds.find((round) => round.results.some((result) => !result))
}

export function applyCommand(
  source: PartyEvent,
  command: Command,
  actor = '司会',
  now = new Date().toISOString(),
): PartyEvent {
  if (source.phase === 'finished')
    throw new Error('確定済みの結果は変更できません。')
  const event = structuredClone(source)
  let message: string
  switch (command.type) {
    case 'configure':
      if (event.phase !== 'setup')
        throw new Error('参加者と対戦本数は開始前のみ変更できます。')
      event.title = command.title.trim()
      event.members = command.members.map((member) => ({
        ...member,
        name: member.name.trim(),
      }))
      if (new Set(event.members.map((member) => member.name)).size !== 15)
        throw new Error('ニックネームは重複しないようにしてください。')
      event.gamesPerRound = command.gamesPerRound
      event.awards = command.awards
      event.rounds = schedule(event.members, command.gamesPerRound)
      message = '参加者・対戦本数を設定'
      break
    case 'phase':
      if (command.phase === 'paused' && event.phase !== 'playing')
        throw new Error('対戦中のみ休憩にできます。')
      if (command.phase === 'finished' && !canFinish(event))
        throw new Error('全員の結果が揃ってから確定してください。')
      event.phase = command.phase
      message =
        command.phase === 'finished'
          ? '最終順位を確定'
          : command.phase === 'paused'
            ? '休憩に切替'
            : '対戦開始・再開'
      break
    case 'result': {
      if (event.phase !== 'playing' && event.phase !== 'paused')
        throw new Error('対戦を開始してから入力してください。')
      const round = event.rounds.find(
        (candidate) => candidate.id === command.roundId,
      )
      if (
        !round ||
        !Number.isInteger(command.game) ||
        command.game < 0 ||
        command.game >= event.gamesPerRound
      )
        throw new Error('対戦が見つかりません。')
      const previous = round.results[command.game]
      if (
        'expected' in command &&
        JSON.stringify(command.expected) !== JSON.stringify(previous)
      )
        throw new Error(
          'この結果は別の司会者が変更しました。対戦を選び直して確認してください。',
        )
      round.results[command.game] = command.result
      message = `${round.id} ${command.game + 1}本目: ${previous ? `${previous.ranks.join('/')} → ` : ''}${command.result ? command.result.ranks.join('/') : '取消'}${command.result ? ` (${command.result.title})` : ''}`
      break
    }
    case 'swap': {
      const first = event.rounds.find(
        (round) => round.id === command.firstRound,
      )
      const second = event.rounds.find(
        (round) => round.id === command.secondRound,
      )
      if (
        !first ||
        !second ||
        first === second ||
        first.results.some(Boolean) ||
        second.results.some(Boolean)
      )
        throw new Error('未実施の別の対戦同士で交換してください。')
      const firstIndex = first.players.indexOf(command.firstMember)
      const secondIndex = second.players.indexOf(command.secondMember)
      if (
        firstIndex < 0 ||
        secondIndex < 0 ||
        command.firstMember === command.secondMember
      )
        throw new Error('交換する参加者を選んでください。')
      first.players[firstIndex] = command.secondMember
      second.players[secondIndex] = command.firstMember
      message = `${first.id}・${second.id} の出番を交換`
      break
    }
    case 'awards':
      event.awards = command.awards
      message = '表彰人数を変更'
      break
    case 'editor':
      if (actor !== '主催者')
        throw new Error('主催者のみ司会者を追加できます。')
      event.editorIds = command.uid.trim()
        ? [event.ownerId, command.uid.trim()]
        : [event.ownerId]
      message = '司会者の権限を変更'
      break
  }
  event.revision++
  event.updatedAt = now
  event.history = [...event.history, { at: now, actor, message }].slice(-100)
  return parseEvent(event)
}

export function csv(event: PartyEvent) {
  const cell = (value: string | number) =>
    `"${String(value)
      .replace(/^[=+@\-\t\r]/, "'$&")
      .replaceAll('"', '""')}"`
  return (
    '\uFEFF' +
    [
      ['順位', '名前', '得点', '1位回数', '実施本数'],
      ...standings(event).map((row) => [
        row.rank,
        row.name,
        row.score,
        row.wins,
        row.played,
      ]),
    ]
      .map((row) => row.map(cell).join(','))
      .join('\r\n')
  )
}
