import { expect, test } from '@playwright/test'

test('drags regions in both directions and restores order with undo and redo', async ({ page }) => {
  await page.goto('/cards?demo=1')
  const canvas = page.getByLabel('カード編集キャンバス')
  await expect(canvas).toBeVisible()
  const box = (await canvas.boundingBox())!
  for (const offset of [30, 140, 250]) {
    await page.mouse.move(box.x + 30, box.y + offset)
    await page.mouse.down()
    await page.mouse.move(box.x + 180, box.y + offset + 60, { steps: 8 })
    await page.mouse.up()
  }
  await page.getByRole('tab', { name: '領域一覧', exact: true }).click()
  const rows = page.locator('.region-list-item')
  await expect(rows).toHaveCount(3)
  const names = rows.locator('strong')
  const original = await names.allTextContents()
  const lastBox = (await rows.nth(2).boundingBox())!
  await rows.nth(0).locator('.region-list-drag-handle').dragTo(rows.nth(2), {
    targetPosition: { x: 40, y: lastBox.height - 4 },
  })
  await expect(names).toHaveText([original[1]!, original[2]!, original[0]!])
  await page.getByRole('button', { name: '元に戻す', exact: true }).click()
  await expect(names).toHaveText(original)
  await page.getByRole('button', { name: 'やり直す', exact: true }).click()
  await expect(names).toHaveText([original[1]!, original[2]!, original[0]!])
  await rows.nth(2).locator('.region-list-drag-handle').dragTo(rows.nth(0), {
    targetPosition: { x: 40, y: 4 },
  })
  await expect(names).toHaveText(original)
  await rows.nth(0).locator('.region-list-drag-handle').focus()
  await page.keyboard.press('ArrowDown')
  await expect(names).toHaveText([original[1]!, original[0]!, original[2]!])
})
