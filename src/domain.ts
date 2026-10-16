import { z } from 'zod'

export const MIN_MEMBERS = 4
export const MAX_MEMBERS = 64
export const MAX_ROUNDS = 200

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
    members: z.array(memberSchema).min(MIN_MEMBERS).max(MAX_MEMBERS),
    rounds: z.array(roundSchema).min(1).max(MAX_ROUNDS),
    endedEarly: z.boolean().optional(),
    updatedAt: z.string().datetime(),
    resultEdit: z.object({
      roundIndex: z.number().int().min(0).max(MAX_ROUNDS - 1),
      game: z.number().int().min(0).max(1),
    }).strict().optional(),
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
      roundCount?: number
    }
  | { type: 'phase'; phase: 'playing' | 'paused' | 'finished' }
  | { type: 'extend'; count: number }
  | { type: 'end-early' }
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
  roundCount = members.length,
  previous: PartyEvent['rounds'] = [],
): PartyEvent['rounds'] {
  validateMembers(members)
  if (
    !Number.isInteger(roundCount) ||
    roundCount < 1 ||
    previous.length + roundCount > MAX_ROUNDS
  )
    throw new Error(`対戦数は1〜${MAX_ROUNDS}の範囲で設定してください。`)
  const shuffle = random(seed)
  const rookies = members.filter((member) => member.role === 'rookie')
  for (let index = rookies.length - 1; index > 0; index--) {
    const target = Math.floor(shuffle() * (index + 1))
    ;[rookies[index], rookies[target]] = [rookies[target], rookies[index]]
  }
  const hosts = members.filter((member) => member.role === 'host')
  const ordered = [...hosts, ...rookies]
  const counts = new Map(members.map((member) => [member.id, 0]))
  const seats = new Map(members.map((member) => [member.id, [0, 0, 0, 0]]))
  const pairs = new Map<string, number>()
  const key = (first: string, second: string) =>
    JSON.stringify([first, second].sort())
  const account = (players: string[]) => {
    players.forEach((id, position) => {
      counts.set(id, counts.get(id)! + 1)
      seats.get(id)![position]++
      players.slice(position + 1).forEach((other) => {
        const pair = key(id, other)
        pairs.set(pair, (pairs.get(pair) ?? 0) + 1)
      })
    })
  }
  previous.forEach((round) => account(round.players))
  let last = previous.at(-1)?.players ?? []
  const usedIds = new Set(previous.map((round) => round.id))
  let sequence = previous.length + 1
  return Array.from({ length: roundCount }, () => {
    const selected: Member[] = []
    while (selected.length < 4) {
      const hasHost = selected.some((member) => member.role === 'host')
      const candidates = ordered.filter((member) => !selected.includes(member))
      const repeats = (member: Member) =>
        selected.reduce(
          (total, other) => total + (pairs.get(key(member.id, other.id)) ?? 0),
          0,
        )
      candidates.sort(
        (first, second) =>
          counts.get(first.id)! - counts.get(second.id)! ||
          Number(last.includes(first.id)) - Number(last.includes(second.id)) ||
          (hasHost
            ? Number(first.role === 'host') - Number(second.role === 'host')
            : Number(second.role === 'host') - Number(first.role === 'host')) ||
          repeats(first) - repeats(second),
      )
      selected.push(candidates[0])
    }
    const remaining = [...selected]
    const players = Array.from({ length: 4 }, (_, position) => {
      remaining.sort(
        (first, second) =>
          seats.get(first.id)![position] - seats.get(second.id)![position],
      )
      return remaining.shift()!.id
    })
    account(players)
    last = players
    while (usedIds.has(`round-${sequence}`)) sequence++
    const id = `round-${sequence++}`
    usedIds.add(id)
    return {
      id,
      players,
      results: Array.from({ length: gamesPerRound }, () => null),
    }
  })
}

function validateMembers(members: Member[]) {
  if (members.length < MIN_MEMBERS || members.length > MAX_MEMBERS)
    throw new Error(
      `参加者は${MIN_MEMBERS}〜${MAX_MEMBERS}人で設定してください。`,
    )
  if (!z.array(memberSchema).safeParse(members).success)
    throw new Error('名前は空欄にせず、1〜24文字で入力してください。')
  if (new Set(members.map((member) => member.id)).size !== members.length)
    throw new Error('参加者IDが重複しています。')
  if (new Set(members.map((member) => member.name)).size !== members.length)
    throw new Error('ニックネームが重複しています。')
}

export function namesFromText(text: string) {
  return text
    .split(/\r\n?|\n/)
    .map((name) => name.trim())
    .filter(Boolean)
}

export function membersFromText(
  rookies: string,
  hosts: string,
  previous: Member[] = [],
): Member[] {
  const usedIds = new Set(previous.map((member) => member.id))
  let sequence = 1
  const members = (['rookie', 'host'] as const).flatMap((role) => {
    const names = namesFromText(role === 'rookie' ? rookies : hosts)
    const existing = previous.filter((member) => member.role === role)
    return names.map((name, index) => {
      let id = existing[index]?.id
      if (!id) {
        while (usedIds.has(`member-${sequence}`)) sequence++
        id = `member-${sequence++}`
        usedIds.add(id)
      }
      return { id, name, role }
    })
  })
  validateMembers(members)
  return members
}

export function plannedGamesFor(event: PartyEvent, id: string) {
  return (
    event.rounds.filter((round) => round.players.includes(id)).length *
    event.gamesPerRound
  )
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
  validateMembers(event.members)
  const ids = event.members.map((member) => member.id)
  if (
    !event.editorIds.includes(event.ownerId) ||
    new Set(event.editorIds).size !== event.editorIds.length
  )
    throw new Error('司会者設定が不正です。')
  if (
    new Set(event.rounds.map((round) => round.id)).size !== event.rounds.length
  )
    throw new Error('対戦IDが重複しています。')
  for (const round of event.rounds) {
    if (
      new Set(round.players).size !== 4 ||
      round.players.some((id) => !ids.includes(id)) ||
      round.results.length !== event.gamesPerRound
    )
      throw new Error('対戦表が不正です。')
    round.results.forEach((result) => {
      if (result) points(result.ranks)
    })
  }
  if (event.endedEarly && event.phase !== 'finished')
    throw new Error('途中終了は順位確定時のみ設定できます。')
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
      return {
        ...member,
        score,
        wins,
        played,
        average: played ? score / played : 0,
        winRate: played ? wins / played : 0,
        rank: 0,
      }
    })
    .sort(
      (first, second) =>
        Number(second.played > 0) - Number(first.played > 0) ||
        second.score * first.played - first.score * second.played ||
        second.wins * first.played - first.wins * second.played ||
        first.id.localeCompare(second.id),
    )
  rows.forEach((row, index) => {
    row.rank =
      row.played === 0
        ? 0
        : index > 0 &&
            row.score * rows[index - 1].played ===
              rows[index - 1].score * row.played &&
            row.wins * rows[index - 1].played ===
              rows[index - 1].wins * row.played
          ? rows[index - 1].rank
          : index + 1
  })
  return rows
}

export function canFinish(event: PartyEvent) {
  const recorded = event.rounds.some((round) => round.results.some(Boolean))
  return (
    recorded &&
    (event.endedEarly === true ||
      event.rounds.every((round) => round.results.every(Boolean)))
  )
}

export function canFinishEarly(event: PartyEvent) {
  return (
    (event.phase === 'playing' || event.phase === 'paused') &&
    event.rounds.some((round) => round.results.some(Boolean))
  )
}

export function currentRound(event: PartyEvent) {
  if (event.phase === 'finished') return undefined
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
      validateMembers(event.members)
      event.gamesPerRound = command.gamesPerRound
      event.awards = command.awards
      event.rounds = schedule(
        event.members,
        command.gamesPerRound,
        42,
        command.roundCount ?? event.rounds.length,
      )
      message = '参加者・対戦本数を設定'
      break
    case 'extend': {
      if (event.phase !== 'playing' && event.phase !== 'paused')
        throw new Error('開始後・確定前に対戦を追加できます。')
      event.rounds.push(
        ...schedule(
          event.members,
          event.gamesPerRound,
          42,
          command.count,
          event.rounds,
        ),
      )
      message = `${command.count}対戦を追加（合計${event.rounds.length}対戦）`
      break
    }
    case 'end-early':
      if (!canFinishEarly(event))
        throw new Error('1本以上記録してから途中終了してください。')
      event.endedEarly = true
      event.phase = 'finished'
      message = '残りの未記録対戦を打ち切り、平均得点で最終順位を確定'
      break
    case 'phase':
      if (command.phase === 'paused' && event.phase !== 'playing')
        throw new Error('対戦中のみ休憩にできます。')
      if (command.phase === 'finished' && !canFinish(event))
        throw new Error(
          '未記録があります。すべて記録するか、途中終了を選択してください。',
        )
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
      event.resultEdit = { roundIndex: event.rounds.indexOf(round), game: command.game }
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
      ['順位', '名前', '平均得点', '合計得点', '1位回数', '実施本数'],
      ...standings(event).map((row) => [
        row.played ? row.rank : '',
        row.name,
        row.played ? row.average.toFixed(3) : '',
        row.score,
        row.wins,
        row.played,
      ]),
    ]
      .map((row) => row.map(cell).join(','))
      .join('\r\n')
  )
}
