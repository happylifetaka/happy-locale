import { fileURLToPath } from 'node:url'
import { expect, test } from '@playwright/test'

test('reviews real file OCR, explicitly applies mixed changes, and restores candidates with Undo', async ({ page }, testInfo) => {
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
  const moduleUrl = `/_nuxt/@fs${fileURLToPath(new URL('./helpers/region-review-harness.ts', import.meta.url))}`
  const result = await page.evaluate(async (url) => {
    const { runRegionReviewScenario } = await import(/* @vite-ignore */ url) as typeof import('./helpers/region-review-harness')
    return runRegionReviewScenario()
  }, moduleUrl)
  await testInfo.attach('region-review.json', { body: JSON.stringify(result, null, 2), contentType: 'application/json' })
  expect(result.imageDigest).toMatch(/^[a-f0-9]{64}$/u)
  expect(result.texts).toEqual(['Choose an ally.', 'Draw two cards.', 'Gain three tokens.'])
  expect(result.differences.map(difference => difference.status)).toEqual(['changed', 'changed', 'new'])
  expect(result.choices).toHaveLength(3)
  expect(result.untouchedBeforeApply).toBe(true)
  const card = result.after.cards[0]!
  expect(card.regions).toHaveLength(1)
  expect(card.regions[0]).toMatchObject({ originalText: 'Keep original text', translatedText: '既存の訳', translationStatus: 'reviewed' })
  expect(card.regions[0]!.width).toBeLessThan(470)
  expect(card.ocrCandidates).toHaveLength(2)
  expect(card.ocrCandidates![0]).toMatchObject({ id: 'existing-candidate', text: 'Keep candidate text', confidence: 42, selected: false })
  expect(result.displayedAfterApply).toEqual(card.ocrCandidates)
  expect(result.displayedAfterUndo).toHaveLength(1)
  expect(result.displayedAfterUndo[0]).toMatchObject({ x: 40, y: 285, width: 470, height: 100 })
  expect(result.undoRestoredAll).toBe(true)
  expect(result.redoRestoredAll).toBe(true)
  expect(result.repeatedStatuses).toEqual(['unchanged', 'unchanged', 'unchanged'])
  expect(result.noDuplicateOrTextChanges).toBe(true)
  expect(result.cancelledWithoutWrite).toBe(true)
  expect(result.progressCount).toBeGreaterThan(0)
  expect(errors).toEqual([])
  expect(external).toEqual([])
})
