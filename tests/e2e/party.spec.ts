import { readFile } from 'node:fs/promises'
import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { applyCommand, createEvent, standings } from '../../src/domain'

test.use({ reducedMotion: 'reduce' })

const key = 'party-night:event:local:local-demo'
async function start(page: Page) {
  await page.goto('/?demo=1')
  await page.getByRole('button', { name: '司会', exact: true }).click()
  await page.getByRole('radio', { name: /^1本/ }).check()
  await page.getByRole('button', { name: '保存して開始' }).click()
  await expect(page.getByRole('button', { name: '結果を保存' })).toBeVisible()
}
async function ranks(page: Page, values = ['1', '2', '3', '4']) {
  for (const checkbox of await page.locator('.result-tie input').all())
    await checkbox.uncheck()
  const ordered = [0, 1, 2, 3].sort((first, second) => Number(values[first]) - Number(values[second]))
  for (const [position, seat] of ordered.entries()) {
    const current = await page.locator('.result-player').evaluateAll((cards) =>
      cards.map((card) => Number(card.getAttribute('data-seat'))),
    )
    const index = current.indexOf(seat)
    if (index === position) continue
    const handle = page.getByRole('button', { name: `${seat + 1}Pを並べ替え`, exact: true })
    await handle.focus()
    await handle.press('Space')
    for (let step = position; step < index; step++) await handle.press('ArrowLeft')
    await handle.press('Space')
  }
  for (let position = 1; position < 4; position++)
    await page.getByRole('checkbox', { name: `${ordered[position] + 1}Pを前の人と同率`, exact: true })
      .setChecked(values[ordered[position]] === values[ordered[position - 1]])
}

async function expectResultAttributes(page: Page, attribute: string, values: string[]) {
  await expect.poll(() => page.locator('.result-player').evaluateAll(
    (cards, name) => cards.map((card) => card.getAttribute(name)), attribute,
  )).toEqual(values)
}

test('ドラッグ順位・同率・取消・横並び表示', async ({ page }, testInfo) => {
  await start(page)
  const first = await page.getByRole('button', { name: '1Pを並べ替え', exact: true }).boundingBox()
  const last = await page.getByRole('button', { name: '4Pを並べ替え', exact: true }).boundingBox()
  expect(first).not.toBeNull()
  expect(last).not.toBeNull()
  const startX = first!.x + first!.width / 2
  const endX = last!.x + last!.width / 2
  const centerY = first!.y + first!.height / 2
  if (testInfo.project.name !== 'desktop') {
    const session = await page.context().newCDPSession(page)
    await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: startX, y: centerY }] })
    for (let step = 1; step <= 12; step++)
      await session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: startX + (endX - startX) * step / 12, y: centerY }] })
    await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
    await session.detach()
  } else {
    await page.mouse.move(startX, centerY)
    await page.mouse.down()
    await page.mouse.move(startX + 8, centerY)
    await page.mouse.move(endX, centerY, { steps: 12 })
    await page.mouse.up()
  }
  await expectResultAttributes(page, 'data-seat', ['1', '2', '3', '0'])
  await page.getByRole('checkbox', { name: '3Pを前の人と同率', exact: true }).check()
  const cards = page.locator('.result-player')
  await expectResultAttributes(page, 'data-rank', ['1', '1', '3', '4'])
  await expect(cards.locator('.result-points')).toHaveText(['3.5pt', '3.5pt', '2pt', '1pt'])
  const boxes = await cards.evaluateAll((elements) => elements.map((element) => {
    const box = element.getBoundingClientRect()
    return { top: box.top, right: box.right }
  }))
  expect(Math.max(...boxes.map((box) => box.top)) - Math.min(...boxes.map((box) => box.top))).toBeLessThan(1)
  expect(boxes.at(-1)!.right).toBeLessThanOrEqual(page.viewportSize()!.width)
  const overflow = await cards.evaluateAll((elements) => elements.flatMap((element) => {
    const card = element.getBoundingClientRect()
    return [...element.querySelectorAll('button, .player-badge, label, strong')].filter((child) => {
      const bounds = child.getBoundingClientRect()
      return bounds.left < card.left - 1 || bounds.right > card.right + 1
    }).map((child) => child.textContent)
  }))
  expect(overflow).toEqual([])
  await page.screenshot({ path: testInfo.outputPath('drag-results.png'), fullPage: true })
  await page.getByRole('button', { name: '結果を保存', exact: true }).click()
  await page.getByRole('button', { name: '直前の入力を修正' }).click()
  await expectResultAttributes(page, 'data-seat', ['1', '2', '3', '0'])
  await expect(page.getByRole('checkbox', { name: '3Pを前の人と同率', exact: true })).toBeChecked()
  const handle = page.getByRole('button', { name: '1Pを並べ替え', exact: true })
  await handle.focus()
  await handle.press('Space')
  await handle.press('ArrowLeft')
  await handle.press('Escape')
  await expectResultAttributes(page, 'data-seat', ['1', '2', '3', '0'])
  const saved = await page.evaluate((cacheKey) => JSON.parse(localStorage.getItem(cacheKey)!), key)
  expect(saved.rounds[0].results[0].ranks).toEqual([4, 1, 1, 3])
})

test('参加者リンクから入力し直前の入力を修正できる', async ({ page }) => {
  await start(page)
  await page.goto('/?demo=1&view=viewer')
  await expect(page.getByRole('button', { name: '司会', exact: true })).toHaveCount(0)
  await page.getByRole('button', { name: '結果入力', exact: true }).click()
  await expect(page.getByRole('button', { name: '順位を確定', exact: true })).toHaveCount(0)
  await expect(page.getByRole('button', { name: '対戦を追加', exact: true })).toHaveCount(0)
  await expect(page.getByRole('button', { name: '新しいイベント', exact: true })).toHaveCount(0)
  await ranks(page)
  await page.getByRole('button', { name: '結果を保存', exact: true }).click()
  await expect(page.getByRole('combobox', { name: '入力する対戦' })).toHaveValue('round-2')
  await page.getByRole('button', { name: '直前の入力を修正' }).click()
  await expect(page.getByRole('combobox', { name: '入力する対戦' })).toHaveValue('round-1')
  await expect(page.locator('.result-player[data-seat="0"]')).toHaveAttribute('data-rank', '1')
  await ranks(page, ['4', '3', '2', '1'])
  await page.getByRole('button', { name: '結果を訂正', exact: true }).click()
  const event = await page.evaluate(
    (cacheKey) => JSON.parse(localStorage.getItem(cacheKey)!), key,
  )
  expect(event.rounds[0].results[0].ranks).toEqual([4, 3, 2, 1])
  expect(event.rounds[1].results[0]).toBeNull()
  await ranks(page)
  await page.getByRole('button', { name: '結果を保存', exact: true }).click()
  await page.getByRole('combobox', { name: '入力する対戦' }).selectOption('round-1')
  await ranks(page)
  await page.getByRole('button', { name: '結果を訂正', exact: true }).click()
  await page.getByRole('button', { name: '直前の入力を修正' }).click()
  await expect(page.getByRole('combobox', { name: '入力する対戦' })).toHaveValue('round-1')
})

test('一括入力と人数・予定対戦数の設定', async ({ page }) => {
  await page.goto('/?demo=1')
  await page.getByRole('button', { name: '司会', exact: true }).click()
  await page
    .getByRole('textbox', { name: '新人（改行区切り）' })
    .fill(' A\nB\n\nC\nD ')
  await page.getByRole('textbox', { name: '講師（改行区切り）' }).fill('')
  await page.getByRole('spinbutton', { name: '予定対戦数' }).fill('2')
  await page.getByRole('radio', { name: /^1本/ }).check()
  await page.getByRole('button', { name: '保存して開始' }).click()
  await expect(
    page.getByRole('button', { name: '結果を保存', exact: true }),
  ).toBeVisible()
  const event = await page.evaluate(
    (cacheKey) => JSON.parse(localStorage.getItem(cacheKey)!),
    key,
  )
  expect(event.members.map((member: { name: string }) => member.name)).toEqual([
    'A',
    'B',
    'C',
    'D',
  ])
  expect(event.rounds).toHaveLength(2)
  await expect(
    page.getByRole('textbox', { name: '新人（改行区切り）' }),
  ).toHaveCount(0)
  await page.getByRole('button', { name: '進行', exact: true }).click()
  await expect(page.locator('.round-counter')).toContainText('/ 2')
  await expect(page.locator('.event-stats')).toContainText('4人')
})

test('個別入力でも参加人数を増減できる', async ({ page }) => {
  await page.goto('/?demo=1')
  await page.getByRole('button', { name: '司会', exact: true }).click()
  await page.getByRole('tab', { name: '個別', exact: true }).click()
  await page
    .getByRole('textbox', { name: '参加者1の名前' })
    .fill('人数変更でも残す')
  await page.getByRole('spinbutton', { name: '新人の人数' }).fill('0')
  await page.getByRole('spinbutton', { name: '新人の人数' }).fill('6')
  await page.getByRole('spinbutton', { name: '講師の人数' }).fill('0')
  await expect(page.locator('.roster input')).toHaveCount(6)
  await page.getByRole('button', { name: '保存して開始' }).click()
  const event = await page.evaluate(
    (cacheKey) => JSON.parse(localStorage.getItem(cacheKey)!),
    key,
  )
  expect(event.members).toHaveLength(6)
  expect(event.members[0].name).toBe('人数変更でも残す')
  expect(
    event.members.every((member: { role: string }) => member.role === 'rookie'),
  ).toBe(true)
})

test('未記録を残して途中終了・未参加者を表彰しない', async ({ page }) => {
  await page.goto('/?demo=1')
  await page.getByRole('button', { name: '司会', exact: true }).click()
  await page.getByRole('button', { name: '保存して開始' }).click()
  await expect(
    page.getByRole('button', { name: '途中終了', exact: true }),
  ).toBeDisabled()
  await ranks(page)
  await page.getByRole('button', { name: '結果を保存', exact: true }).click()
  await page.getByRole('button', { name: '途中終了', exact: true }).click()
  await expect(page.getByRole('dialog')).toContainText('未参加11人')
  await page
    .getByRole('button', { name: '途中終了して確定', exact: true })
    .click()
  await page.getByRole('button', { name: '進行', exact: true }).click()
  await expect(page.locator('.winner')).toHaveCount(3)
  await expect(page.getByText(/途中終了：記録済み1本/)).toBeVisible()
  const event = await page.evaluate(
    (cacheKey) => JSON.parse(localStorage.getItem(cacheKey)!),
    key,
  )
  expect(event.endedEarly).toBe(true)
  expect(event.rounds).toHaveLength(15)
  expect(event.rounds[0].results[1]).toBeNull()
})

test('記録を保持して対戦を延長できる', async ({ page }) => {
  await start(page)
  await ranks(page)
  await page.getByRole('button', { name: '結果を保存', exact: true }).click()
  const before = await page.evaluate(
    (cacheKey) => JSON.parse(localStorage.getItem(cacheKey)!).rounds,
    key,
  )
  await page.getByRole('spinbutton', { name: '追加対戦数' }).fill('2')
  await page.getByRole('button', { name: '対戦を追加', exact: true }).click()
  const event = await page.evaluate(
    (cacheKey) => JSON.parse(localStorage.getItem(cacheKey)!),
    key,
  )
  expect(event.rounds).toHaveLength(17)
  expect(event.rounds.slice(0, 15)).toEqual(before)
  await page.getByRole('button', { name: '対戦表', exact: true }).click()
  await expect(page.locator('.schedule-row')).toHaveCount(17)
})

test('予定分を完了した後も確定前なら延長できる', async ({ page }) => {
  await page.goto('/?demo=1')
  await page.getByRole('button', { name: '司会', exact: true }).click()
  await page
    .getByRole('textbox', { name: '新人（改行区切り）' })
    .fill('A\nB\nC\nD')
  await page.getByRole('textbox', { name: '講師（改行区切り）' }).fill('')
  await page.getByRole('spinbutton', { name: '予定対戦数' }).fill('1')
  await page.getByRole('radio', { name: /^1本/ }).check()
  await page.getByRole('button', { name: '保存して開始' }).click()
  await ranks(page)
  await page.getByRole('button', { name: '結果を保存', exact: true }).click()
  await expect(
    page.getByRole('button', { name: '順位を確定', exact: true }),
  ).toBeEnabled()
  await page.getByRole('spinbutton', { name: '追加対戦数' }).fill('1')
  await page.getByRole('button', { name: '対戦を追加', exact: true }).click()
  await expect(
    page.getByRole('combobox', { name: '入力する対戦' }),
  ).toHaveValue('round-2')
  await expect(
    page.getByRole('button', { name: '順位を確定', exact: true }),
  ).toBeDisabled()
  const event = await page.evaluate(
    (cacheKey) => JSON.parse(localStorage.getItem(cacheKey)!),
    key,
  )
  expect(event.rounds[0].results[0].ranks).toEqual([1, 2, 3, 4])
  expect(event.rounds).toHaveLength(2)
})

test('進行・自分の出番・対戦表・閲覧専用', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto('/?demo=1')
  await expect(page.locator('.seat')).toHaveCount(4)
  await page
    .getByRole('combobox', { name: '自分の名前' })
    .selectOption('member-1')
  await expect(page.locator('.personal-strip')).toContainText('新人01')
  await page.getByRole('button', { name: '対戦表', exact: true }).click()
  await expect(page.locator('.schedule-row')).toHaveCount(15)
  await expect(page.locator('.my-round')).toHaveCount(4)
  await page.goto('/?demo=1&view=viewer')
  await expect(
    page.getByRole('button', { name: '司会', exact: true }),
  ).toHaveCount(0)
  expect(errors).toEqual([])
})

test('設定保存・結果入力・再読み込み・順位更新', async ({ page }) => {
  await page.goto('/?demo=1')
  await page.getByRole('button', { name: '司会', exact: true }).click()
  await page.getByRole('tab', { name: '個別', exact: true }).click()
  await page
    .getByRole('textbox', { name: '参加者1の名前' })
    .fill('同期のテスト')
  await page.getByRole('radio', { name: /^1本/ }).check()
  await page.getByRole('button', { name: '保存して開始' }).click()
  await expect(page.getByRole('button', { name: '順位を確定' })).toBeDisabled()
  await ranks(page)
  await page.getByRole('button', { name: '結果を保存', exact: true }).click()
  await expect(
    page.getByRole('combobox', { name: '入力する対戦' }),
  ).toHaveValue('round-2')
  await page.reload()
  await page.getByRole('button', { name: '順位', exact: true }).click()
  await expect(
    page.locator('.ranking tbody tr').filter({ hasText: '講師1' }),
  ).toContainText('4pt')
  await expect(page.locator('.ranking')).toContainText('同期のテスト')
  const saved = await page.evaluate(
    (cacheKey) => JSON.parse(localStorage.getItem(cacheKey)!),
    key,
  )
  expect(saved.members[0].name).toBe('同期のテスト')
  expect(saved.rounds[0].results[0].ranks).toEqual([1, 2, 3, 4])
})

test('同着の入力検証・訂正・取消', async ({ page }) => {
  await start(page)
  await ranks(page, ['1', '1', '3', '4'])
  await expectResultAttributes(page, 'data-rank', ['1', '1', '3', '4'])
  await page.getByRole('button', { name: '結果を保存', exact: true }).click()
  await page
    .getByRole('combobox', { name: '入力する対戦' })
    .selectOption('round-1')
  await ranks(page, ['4', '3', '2', '1'])
  await page.getByRole('button', { name: '結果を訂正' }).click()
  await page
    .getByRole('combobox', { name: '入力する対戦' })
    .selectOption('round-1')
  page.once('dialog', (dialog) => void dialog.accept())
  await page.getByRole('button', { name: '結果を取消' }).click()
  await expect(
    page.getByRole('button', { name: '結果を保存', exact: true }),
  ).toBeVisible()
  const saved = await page.evaluate(
    (cacheKey) => JSON.parse(localStorage.getItem(cacheKey)!),
    key,
  )
  expect(saved.rounds[0].results[0]).toBeNull()
  expect(saved.history.at(-1).message).toContain('取消')
})

test('全15対戦から表彰・同率優勝・確定ロック', async ({ page }) => {
  await start(page)
  for (let index = 0; index < 15; index++) {
    await expect(
      page.getByRole('combobox', { name: '入力する対戦' }),
    ).toHaveValue(`round-${index + 1}`)
    await ranks(page, ['1', '1', '1', '1'])
    await page.getByRole('button', { name: '結果を保存', exact: true }).click()
  }
  await expect(page.getByRole('button', { name: '順位を確定' })).toBeEnabled()
  await page.getByRole('button', { name: '順位を確定' }).click()
  await page.getByRole('button', { name: 'この順位で確定する' }).click()
  await expect(page.getByText('最終順位は確定済みです。')).toBeVisible()
  await page.getByRole('button', { name: '進行', exact: true }).click()
  await expect(
    page.getByRole('heading', { name: 'おつかれさまでした！' }),
  ).toBeVisible()
  await expect(page.locator('.winner')).toHaveCount(15)
  expect(
    await page.evaluate(
      (cacheKey) => JSON.parse(localStorage.getItem(cacheKey)!).phase,
      key,
    ),
  ).toBe('finished')
  await page.reload()
  await page.getByRole('button', { name: '司会', exact: true }).click()
  await expect(page.locator('.result-player')).toHaveCount(0)
})

test('バックアップとCSVの書き出し', async ({ page }) => {
  await start(page)
  await ranks(page)
  await page.getByRole('button', { name: '結果を保存', exact: true }).click()
  await page.getByText('結果の保存・読込', { exact: true }).click()
  const downloaded = page.waitForEvent('download')
  await page.getByRole('button', { name: 'バックアップ', exact: true }).click()
  const file = await downloaded
  const data = JSON.parse(await readFile((await file.path())!, 'utf8'))
  expect(data.format).toBe('party-night-v1')
  expect(data.event.rounds[0].results[0].ranks).toEqual([1, 2, 3, 4])
  expect(data.unsent).toBeNull()
  const csvDownload = page.waitForEvent('download')
  await page.getByRole('button', { name: '順位CSV' }).click()
  expect(await readFile((await (await csvDownload).path())!, 'utf8')).toContain(
    '得点',
  )
})

test('長い名前・QR共有・投影画面の表示', async ({ page }, info) => {
  const event = createEvent()
  event.title = '新人教育おつかれさま会・金曜日のミニゲーム大会'
  event.members = event.members.map((member, index) => ({
    ...member,
    name: `${index + 1}あいうえおかきくけこさしすせそたちつてと`,
  }))
  await page.addInitScript(
    ({ saved, cacheKey }) =>
      localStorage.setItem(cacheKey, JSON.stringify(saved)),
    { saved: event, cacheKey: key },
  )
  await page.goto('/?demo=1')
  await page.evaluate(() => document.fonts.ready)
  const seats = await page
    .locator('.seat')
    .evaluateAll((elements) =>
      elements.map((element) => ({
        top: element.getBoundingClientRect().top,
        left: element.getBoundingClientRect().left,
      })),
    )
  expect(new Set(seats.map((seat) => seat.top)).size).toBe(1)
  expect(
    seats.every(
      (seat, index) => index === 0 || seat.left > seats[index - 1].left,
    ),
  ).toBe(true)
  const upcoming = await page
    .locator('.upcoming-row')
    .first()
    .locator('div > span')
    .evaluateAll((elements) =>
      elements.map((element) => element.getBoundingClientRect().top),
    )
  expect(new Set(upcoming).size).toBe(1)
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true)
  expect(
    await page
      .locator('.seat h3')
      .evaluateAll((elements) =>
        elements.every((element) => element.scrollWidth <= element.clientWidth),
      ),
  ).toBe(true)
  await page.screenshot({ path: info.outputPath('queue.png'), fullPage: true })
  await page.getByRole('button', { name: '順位', exact: true }).click()
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true)
  await page.screenshot({
    path: info.outputPath('ranking.png'),
    fullPage: true,
  })
  await page.getByRole('button', { name: '共有QRコード' }).click()
  await expect(page.getByRole('dialog')).toBeVisible()
  await expect(page.locator('.share-qr svg')).toBeVisible()
  await page.screenshot({ path: info.outputPath('share.png') })
  await page.getByRole('button', { name: '閉じる', exact: true }).click()
  await page.goto('/?demo=1&display=1')
  await expect(page.locator('.projection')).toBeVisible()
  await expect(
    page.getByRole('button', { name: '司会', exact: true }),
  ).toHaveCount(0)
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true)
  await page.screenshot({
    path: info.outputPath('projection.png'),
    fullPage: true,
  })
})

test('バックアップ復元', async ({ page }) => {
  await page.goto('/?demo=1')
  await page.getByRole('button', { name: '司会', exact: true }).click()
  await page.getByText('結果の保存・読込', { exact: true }).click()
  const event = applyCommand(createEvent(), { type: 'phase', phase: 'playing' })
  page.once('dialog', (dialog) => void dialog.accept())
  await page.locator('input[type=file]').setInputFiles({
    name: 'backup.json',
    mimeType: 'application/json',
    buffer: Buffer.from(
      JSON.stringify({ format: 'party-night-v1', event, unsent: null }),
    ),
  })
  await expect(
    page.getByRole('button', { name: '結果を保存', exact: true }),
  ).toBeVisible()
})

test('1枠2本の記録と自動切替', async ({ page }) => {
  await page.goto('/?demo=1')
  await page.getByRole('button', { name: '司会', exact: true }).click()
  await page.getByRole('button', { name: '保存して開始' }).click()
  await ranks(page)
  await page.getByRole('button', { name: '結果を保存', exact: true }).click()
  await expect(page.getByRole('tab', { name: '2本目' })).toHaveAttribute(
    'aria-selected',
    'true',
  )
  await expect(
    page.getByRole('combobox', { name: '入力する対戦' }),
  ).toHaveValue('round-1')
  await ranks(page, ['4', '3', '2', '1'])
  await page.getByRole('button', { name: '結果を保存', exact: true }).click()
  await expect(
    page.getByRole('combobox', { name: '入力する対戦' }),
  ).toHaveValue('round-2')
  await expect(page.getByRole('tab', { name: '1本目' })).toHaveAttribute(
    'aria-selected',
    'true',
  )
  const event = await page.evaluate(
    (cacheKey) => JSON.parse(localStorage.getItem(cacheKey)!),
    key,
  )
  expect(event.rounds[0].results.filter(Boolean)).toHaveLength(2)
})

test('出場者を交代して記録し、以降の出番も交換する', async ({ page }) => {
  await start(page)
  const before = await page.evaluate((cacheKey) => JSON.parse(localStorage.getItem(cacheKey)!), key)
  const memberId = before.rounds[0].players[0]
  const replacementId = before.rounds[1].players[0]
  const replacementName = before.members.find((member: { id: string }) => member.id === replacementId).name
  await page.getByText('この対戦の出場者を変更', { exact: true }).click()
  await page.getByRole('combobox', { name: '交代する参加者', exact: true }).selectOption(memberId)
  await page.getByRole('combobox', { name: '代わりに出場する参加者', exact: true }).selectOption(replacementId)
  await expect(page.getByText('第2対戦の出番も交換します。', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: '出場者を変更', exact: true }).click()
  await expect(page.locator('.result-player[data-seat="0"] strong')).toHaveText(replacementName)
  await ranks(page)
  await page.getByRole('button', { name: '結果を保存', exact: true }).click()
  const recorded = await page.evaluate((cacheKey) => JSON.parse(localStorage.getItem(cacheKey)!), key)
  expect(recorded.members).toEqual(before.members)
  expect(recorded.rounds[0].players[0]).toBe(replacementId)
  expect(recorded.rounds[1].players[0]).toBe(memberId)
  expect(recorded.rounds.slice(2)).toEqual(before.rounds.slice(2))
  expect(standings(recorded).find((member) => member.id === replacementId)?.score).toBe(4)
  expect(standings(recorded).find((member) => member.id === memberId)?.played).toBe(0)
  await page.getByRole('combobox', { name: '入力する対戦' }).selectOption('round-1')
  await page.getByText('この対戦の出場者を変更', { exact: true }).click()
  await expect(page.getByText('1本でも記録済みの対戦は出場者を変更できません。', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: '出場者を変更', exact: true })).toHaveCount(0)
})

test('別タブの出場者変更で順位入力を保持し、以降の組み合わせを変更せず交代する', async ({ page, context }) => {
  await start(page)
  const before = await page.evaluate((cacheKey) => JSON.parse(localStorage.getItem(cacheKey)!), key)
  await page.getByRole('button', { name: '結果入力', exact: true }).click()
  await page.getByRole('textbox', { name: 'ゲーム名' }).fill('未保存の入力')
  const other = await context.newPage()
  await other.goto('/?demo=1')
  await other.getByRole('button', { name: '司会', exact: true }).click()
  await other.getByText('この対戦の出場者を変更', { exact: true }).click()
  await other.getByRole('combobox', { name: '交代する参加者', exact: true }).selectOption(before.rounds[0].players[0])
  await other.getByRole('combobox', { name: '代わりに出場する参加者', exact: true }).selectOption(before.rounds[1].players[0])
  await other.getByRole('checkbox', { name: '以降の出番も調整' }).uncheck()
  await other.getByRole('button', { name: '出場者を変更', exact: true }).click()
  const changed = await other.evaluate((cacheKey) => JSON.parse(localStorage.getItem(cacheKey)!), key)
  expect(changed.rounds.slice(1)).toEqual(before.rounds.slice(1))
  await expect(page.getByRole('alert')).toContainText('出場者が変更されました')
  await expect(page.getByRole('textbox', { name: 'ゲーム名' })).toHaveValue('未保存の入力')
  await expect(page.getByRole('button', { name: '結果を保存', exact: true })).toBeDisabled()
  page.once('dialog', (dialog) => void dialog.accept())
  await page.getByRole('button', { name: '出場者の変更を反映' }).click()
  await expect(page.getByRole('alert')).toHaveCount(0)
  await expect(page.getByRole('button', { name: '結果を保存', exact: true })).toBeEnabled()
  await other.close()
})

test('休憩・再開と出番交換', async ({ page }) => {
  await start(page)
  await page.getByRole('button', { name: '休憩', exact: true }).click()
  await expect(page.getByText('休憩中', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: '再開', exact: true }).click()
  await expect(page.getByText('対戦中', { exact: true })).toBeVisible()
  const source = applyCommand(createEvent(), {
    type: 'configure',
    title: createEvent().title,
    members: createEvent().members,
    gamesPerRound: 1,
    awards: 3,
  })
  let pair: { first: string; second: string } | undefined
  for (const first of source.rounds) {
    if (pair) break
    for (const second of source.rounds) {
      if (pair) break
      for (const firstMember of first.players) {
        if (pair) break
        for (const secondMember of second.players) {
          try {
            applyCommand(source, {
              type: 'swap',
              firstRound: first.id,
              firstMember,
              secondRound: second.id,
              secondMember,
            })
            pair = {
              first: `${first.id}:${firstMember}`,
              second: `${second.id}:${secondMember}`,
            }
            break
          } catch {
            continue
          }
        }
      }
    }
  }
  expect(pair).toBeDefined()
  await page.getByText('出番を交換', { exact: true }).click()
  await page.getByRole('combobox', { name: '交換元' }).selectOption(pair!.first)
  await page
    .getByRole('combobox', { name: '交換先' })
    .selectOption(pair!.second)
  await page.getByRole('button', { name: '交換する', exact: true }).click()
  const event = await page.evaluate(
    (cacheKey) => JSON.parse(localStorage.getItem(cacheKey)!),
    key,
  )
  expect(event.history.at(-1).message).toContain('出番を交換')
})
