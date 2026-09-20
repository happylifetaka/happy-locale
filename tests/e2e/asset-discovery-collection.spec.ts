import { fileURLToPath } from 'node:url'
import { expect, test } from '@playwright/test'

test('collects real icons into persistent review data and keeps repeated detections separate', async ({ page }, testInfo) => {
  test.setTimeout(60000)
  const errors: string[] = []
  const external: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url())
    if (url.protocol.startsWith('http') && url.hostname !== '127.0.0.1') {
      external.push(url.href)
      await route.abort()
    }
    else {
      await route.continue()
    }
  })
  await page.goto('/cards')
  await expect(page.getByRole('button', { name: 'プロジェクトを開く／作成', exact: true })).toBeVisible()
  const moduleUrl = `/_nuxt/@fs${fileURLToPath(new URL('./helpers/icon-collection-harness.ts', import.meta.url))}`
  const result = await page.evaluate(async (url) => {
    const { runIconCollectionScenario } = await import(/* @vite-ignore */ url) as typeof import('./helpers/icon-collection-harness')
    return runIconCollectionScenario()
  }, moduleUrl)
  await testInfo.attach('icon-collection.json', { body: JSON.stringify(result, null, 2), contentType: 'application/json' })
  expect(result.first.staged.map(item => [item.cardId, item.status, item.addedIds.length])).toEqual([['one', 'stored', 2], ['two', 'stored', 2]])
  expect(result.first.failures).toEqual([{ cardId: 'missing', message: 'Synthetic missing image' }])
  expect(result.first.groupingError).toBeNull()
  expect(result.first.limits).toEqual([[], []])
  expect(result.stored!.occurrences).toHaveLength(4)
  expect(result.stored!.occurrences.every(item => item.decision === 'pending' && item.approval === null && item.assetId === null)).toBe(true)
  expect(result.stored!.groups).toHaveLength(2)
  expect(result.stored!.groups.map(group => group.memberIds.length)).toEqual([2, 2])
  expect(result.roundtripPreserved).toBe(true)
  expect(result.cardsAfterCollection).toEqual(result.cardsBefore)
  expect(result.cardsAfterRepeat).toEqual(result.cardsBefore)
  expect(result.second.staged.map(item => item.status)).toEqual(['review', 'review'])
  expect(result.second.groupingError).toBeNull()
  expect(result.repeatDidNotWrite).toBe(true)
  expect(result.comparisonStatuses).toEqual(['unchanged', 'unchanged', 'unchanged', 'unchanged'])
  expect(result.loadOrder).toEqual(['one', 'two', 'missing', 'one', 'two', 'missing'])
  expect(errors).toEqual([])
  expect(external).toEqual([])
})
