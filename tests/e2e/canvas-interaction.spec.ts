import type { Page } from '@playwright/test'
import { expect, test } from '@playwright/test'

async function dragImagePoints(page: Page, start: [number, number], end: [number, number]) {
  const canvas = page.getByLabel('カード編集キャンバス')
  const layout = await canvas.evaluate((element: HTMLCanvasElement) => {
    const bounds = element.getBoundingClientRect()
    return { x: bounds.x, y: bounds.y, scaleX: bounds.width / element.width, scaleY: bounds.height / element.height }
  })
  await page.mouse.move(layout.x + start[0] * layout.scaleX, layout.y + start[1] * layout.scaleY)
  await page.mouse.down()
  await page.mouse.move(layout.x + end[0] * layout.scaleX, layout.y + end[1] * layout.scaleY, { steps: 12 })
  await page.mouse.up()
}

for (const zoom of [50, 100, 150]) {
  test(`creates, moves and resizes at ${zoom}% with one history entry per gesture`, async ({ page }) => {
    await page.goto('/cards?demo=1')
    await expect(page.getByLabel('カード編集キャンバス')).toBeVisible()
    await page.getByRole('combobox', { name: '表示倍率', exact: true }).selectOption(String(zoom))
    await dragImagePoints(page, [60, 180], [220, 280])
    await page.locator('#inspector-tab-region').click()
    const coordinates = page.locator('.region-coordinates dd')
    await expect(coordinates).toHaveText(['60', '180', '160', '100'])

    await dragImagePoints(page, [110, 220], [130, 240])
    await expect(coordinates).toHaveText(['80', '200', '160', '100'])
    await dragImagePoints(page, [240, 300], [270, 320])
    await expect(coordinates).toHaveText(['80', '200', '190', '120'])

    const undo = page.getByRole('button', { name: '元に戻す', exact: true })
    await undo.click()
    await expect(coordinates).toHaveText(['80', '200', '160', '100'])
    await undo.click()
    await expect(coordinates).toHaveText(['60', '180', '160', '100'])
    await undo.click()
    await page.locator('#inspector-tab-list').click()
    await expect(page.locator('.region-list-item')).toHaveCount(0)
    await expect(undo).toBeDisabled()
  })
}
