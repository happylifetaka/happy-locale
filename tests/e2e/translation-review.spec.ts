import { expect, test } from '@playwright/test'

test('reviews a dense list without losing the current row when expanding images', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1280, height: 650 })
  await page.goto('/cards?demo=1')
  await page.locator('.card-list-panel').getByRole('button', { name: '領域検出', exact: true }).click()
  await page.getByRole('button', { name: '5枚の領域を検出', exact: true }).click()
  await page.getByRole('button', { name: '表示中の候補をすべて選択', exact: true }).click()
  await page.getByRole('button', { name: /選択した候補を追加/ }).click()
  await page.getByRole('button', { name: 'まとめて翻訳', exact: true }).click()
  const dialog = page.getByRole('region', { name: '翻訳をまとめて確認', exact: true })
  await expect(dialog.getByRole('status').first()).toHaveText(/^20件の候補を取得（既存訳\d+件）、失敗0件。候補を確認して反映してください。$/u)
  await expect(page.locator('p.notice')).toHaveCount(0, { timeout: 10000 })
  await page.screenshot({ path: testInfo.outputPath('translation-workspace-desktop.png') })
  const rows = dialog.locator('.review-row')
  const body = dialog.locator('.review-body')
  await expect(rows).toHaveCount(20)
  await expect.poll(() => body.evaluate((element) => {
    const bottom = element.getBoundingClientRect().bottom
    return [...element.querySelectorAll('.review-row')].filter(row => row.getBoundingClientRect().bottom <= bottom).length
  })).toBeGreaterThanOrEqual(3)

  const header = dialog.locator('.review-column-head')
  const headerTop = (await header.boundingBox())!.y
  await body.evaluate(element => element.scrollTop = element.scrollHeight)
  await expect.poll(async () => (await header.boundingBox())!.y).toBeCloseTo(headerTop, 0)
  const last = rows.last()
  const image = last.getByRole('button', { name: /の原画像を拡大$/ })
  await image.click()
  await expect(image).toHaveAttribute('aria-expanded', 'true')
  await expect(last.locator('.review-expanded-image')).toBeVisible()
  await expect.poll(() => body.evaluate(element => element.scrollTop)).toBeGreaterThan(500)
  // The source and translation remain below the sticky headings, alongside the expanded image.
  const headBottom = (await header.boundingBox())!
  expect((await last.boundingBox())!.y).toBeGreaterThanOrEqual(headBottom.y + headBottom.height - 1)
  const panel = (await last.locator('.review-expanded-image').boundingBox())!
  const bounds = (await body.boundingBox())!
  // Long translations and warnings can exceed the viewport together with the image.
  // Reveal the beginning of the image without scrolling the source text behind the header.
  expect(panel.y).toBeLessThan(bounds.y + bounds.height - 32)
  await last.getByRole('button', { name: '拡大を閉じる' }).click()
  await expect(image).toBeFocused()
  await expect(last.locator('.review-expanded-image')).toHaveCount(0)
  await image.click()
  await image.press('Escape')
  await expect(last.locator('.review-expanded-image')).toHaveCount(0)
  await expect(dialog).toBeVisible()

  // Filtering resets the scroll and selection includes every matching row, not only those on screen.
  await dialog.getByRole('checkbox', { name: '絞り込み結果をすべて選択' }).uncheck()
  await page.locator('.card-list-select').filter({ hasText: '05-bridge.png' }).click()
  await expect(rows).toHaveCount(4)
  await expect.poll(() => body.evaluate(element => element.scrollTop)).toBe(0)
  const selectAll = dialog.getByRole('checkbox', { name: '絞り込み結果をすべて選択' })
  await selectAll.check()
  await expect(dialog.getByText('4件を選択中（変更 4件）', { exact: true })).toBeVisible()
  await rows.first().getByRole('checkbox').uncheck()
  await expect(selectAll).toBeChecked({ indeterminate: true })
  await rows.first().getByLabel('日本語訳', { exact: true }).fill('橋の名前を編集')
  await expect(selectAll).toBeChecked()
  await dialog.getByRole('button', { name: '選択した変更4件を反映', exact: true }).click()
  await expect(dialog).toBeHidden()
  await expect(page.getByRole('button', { name: 'カード', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await page.getByRole('button', { name: 'まとめて翻訳', exact: true }).click()
  await expect(dialog.getByRole('status').first()).toContainText('4件を反映しました。')
  await expect(rows.first().getByLabel('日本語訳', { exact: true })).toHaveValue('橋の名前を編集')

  await rows.first().getByLabel('日本語訳', { exact: true }).fill('往復で保持する下書き')
  await rows.first().getByRole('button', { name: 'カードで修正', exact: true }).click()
  await expect(dialog).toBeHidden()
  await page.getByRole('button', { name: '翻訳確認に戻る', exact: true }).click()
  await expect(rows.first().getByLabel('日本語訳', { exact: true })).toHaveValue('往復で保持する下書き')
  await page.setViewportSize({ width: 390, height: 844 })
  await expect.poll(() => body.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true)
  await expect(page.locator('.card-list-panel')).toBeVisible()
  await expect(rows.first().getByLabel('日本語訳', { exact: true })).toBeVisible()
  const applyButton = dialog.getByRole('button', { name: '選択した変更1件を反映', exact: true })
  await applyButton.scrollIntoViewIfNeeded()
  await expect(applyButton).toBeInViewport()
  await expect(page.locator('p.notice')).toHaveCount(0, { timeout: 10000 })
  await page.screenshot({ path: testInfo.outputPath('translation-workspace-narrow.png') })
})
