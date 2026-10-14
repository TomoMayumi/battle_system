import { readFile } from 'node:fs/promises'
import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { applyCommand, createEvent } from '../../src/domain'

test.use({ reducedMotion: 'reduce' })

const key = 'party-night:event:local:local-demo'
async function start(page: Page) {
  await page.goto('/?demo=1')
  await page.getByRole('button', { name: '司会', exact: true }).click()
  await page.getByRole('radio', { name: '1本 全員4本' }).check()
  await page.getByRole('button', { name: '保存して開始' }).click()
  await expect(page.getByRole('button', { name: '結果を保存' })).toBeVisible()
}
async function ranks(page: Page, values = ['1', '2', '3', '4']) {
  for (let index = 0; index < 4; index++)
    await page
      .getByRole('combobox', { name: `${index + 1}Pの順位` })
      .selectOption(values[index])
}

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
  await page
    .getByRole('textbox', { name: '参加者1の名前' })
    .fill('同期のテスト')
  await page.getByRole('radio', { name: '1本 全員4本' }).check()
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
  await ranks(page, ['1', '1', '2', '3'])
  await expect(
    page.getByRole('button', { name: '結果を保存', exact: true }),
  ).toBeDisabled()
  await expect(page.getByRole('alert')).toContainText('同着の次の順位')
  await ranks(page, ['1', '1', '3', '4'])
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
    await ranks(page)
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
  await page
    .locator('input[type=file]')
    .setInputFiles({
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
  await expect(page.getByRole('tab', { name: '2本目' })).toHaveAttribute('aria-selected', 'true')
  await expect(page.getByRole('combobox', { name: '入力する対戦' })).toHaveValue('round-1')
  await ranks(page, ['4', '3', '2', '1'])
  await page.getByRole('button', { name: '結果を保存', exact: true }).click()
  await expect(page.getByRole('combobox', { name: '入力する対戦' })).toHaveValue('round-2')
  await expect(page.getByRole('tab', { name: '1本目' })).toHaveAttribute('aria-selected', 'true')
  const event = await page.evaluate(cacheKey => JSON.parse(localStorage.getItem(cacheKey)!), key)
  expect(event.rounds[0].results.filter(Boolean)).toHaveLength(2)
})

test('休憩・再開と出番交換', async ({ page }) => {
  await start(page)
  await page.getByRole('button', { name: '休憩', exact: true }).click()
  await expect(page.getByText('休憩中', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: '再開', exact: true }).click()
  await expect(page.getByText('対戦中', { exact: true })).toBeVisible()
  const source = applyCommand(createEvent(), { type: 'configure', title: createEvent().title, members: createEvent().members, gamesPerRound: 1, awards: 3 })
  let pair: { first: string; second: string } | undefined
  for (const first of source.rounds) {
    if (pair) break
    for (const second of source.rounds) {
      if (pair) break
      for (const firstMember of first.players) {
        if (pair) break
        for (const secondMember of second.players) {
          try {
            applyCommand(source, { type: 'swap', firstRound: first.id, firstMember, secondRound: second.id, secondMember })
            pair = { first: `${first.id}:${firstMember}`, second: `${second.id}:${secondMember}` }
            break
          } catch { continue }
        }
      }
    }
  }
  expect(pair).toBeDefined()
  await page.getByText('出番を交換', { exact: true }).click()
  await page.getByRole('combobox', { name: '交換元' }).selectOption(pair!.first)
  await page.getByRole('combobox', { name: '交換先' }).selectOption(pair!.second)
  await page.getByRole('button', { name: '交換する', exact: true }).click()
  const event = await page.evaluate(cacheKey => JSON.parse(localStorage.getItem(cacheKey)!), key)
  expect(event.history.at(-1).message).toContain('出番を交換')
})
