import { expect, test } from '@playwright/test'

test.use({ storageState: { cookies: [], origins: [] } })

const storageKey = 'happy-locale.translation-settings.v1'
const introduction = '初回のみ、翻訳方式を選んで保存してください。設定は他のプロジェクトでも共通で使います。'

test('first card entry asks for settings once and reuses the existing dialog afterward', async ({ page }, testInfo) => {
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await page.goto('/')
  await page.getByRole('link', { name: 'カード編集を始める', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '翻訳', exact: true })
  await expect(dialog.getByText(introduction, { exact: true })).toBeVisible()
  await expect(dialog.getByRole('radio', { name: '手動', exact: true })).toBeChecked()
  expect(await page.evaluate(key => localStorage.getItem(key), storageKey)).toBeNull()
  await dialog.screenshot({ path: testInfo.outputPath('initial-translation-settings.png') })
  await dialog.getByRole('button', { name: '保存', exact: true }).click()
  await expect(dialog).toBeHidden()
  expect(await page.evaluate(key => JSON.parse(localStorage.getItem(key)!), storageKey)).toMatchObject({ provider: 'manual' })
  await page.getByRole('link', { name: /ホーム/ }).click()
  await page.getByRole('link', { name: 'カード編集を始める', exact: true }).click()
  await expect(page).toHaveURL(/\/cards$/u)
  await expect(page.getByRole('button', { name: 'プロジェクトを開く／作成', exact: true })).toBeVisible()
  await expect(dialog).toBeHidden()
  await page.reload()
  await expect(page.getByRole('button', { name: 'プロジェクトを開く／作成', exact: true })).toBeVisible()
  await expect(dialog).toBeHidden()
  await page.locator('.toolbar-tools summary').click()
  await page.getByRole('button', { name: '翻訳設定', exact: true }).click()
  await expect(dialog).toBeVisible()
  await expect(dialog.getByText(introduction, { exact: true })).toHaveCount(0)
  expect(errors).toEqual([])
})

test('cancelling leaves setup pending on the next visit', async ({ page }) => {
  await page.goto('/cards')
  const dialog = page.getByRole('dialog', { name: '翻訳', exact: true })
  await dialog.getByRole('button', { name: 'キャンセル', exact: true }).click()
  await expect(dialog).toBeHidden()
  expect(await page.evaluate(key => localStorage.getItem(key), storageKey)).toBeNull()
  await page.reload()
  await expect(dialog.getByText(introduction, { exact: true })).toBeVisible()
})

test('demo entry neither opens setup nor saves defaults', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'サンプル（デモ）を開く', exact: true }).click()
  await expect(page.getByLabel('カード編集キャンバス')).toBeVisible()
  await expect(page.getByRole('dialog', { name: '翻訳', exact: true })).toBeHidden()
  expect(await page.evaluate(key => localStorage.getItem(key), storageKey)).toBeNull()
})
