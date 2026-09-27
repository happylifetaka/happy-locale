import { fileURLToPath } from 'node:url'
import { expect, test } from '@playwright/test'

test('previews real source-icon OCR without writes and applies text/masks with one Undo', async ({ page }, testInfo) => {
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
  const moduleUrl = `/_nuxt/@fs${fileURLToPath(new URL('./helpers/source-icon-ocr-harness.ts', import.meta.url))}`
  const result = await page.evaluate(async (url) => {
    const { runSourceIconOCRScenario } = await import(/* @vite-ignore */ url) as typeof import('./helpers/source-icon-ocr-harness')
    return runSourceIconOCRScenario()
  }, moduleUrl)
  await testInfo.attach('source-icon-ocr.json', { body: JSON.stringify(result, null, 2), contentType: 'application/json' })
  expect(result.imageDigest).toMatch(/^[a-f0-9]{64}$/u)
  expect(result.assetDigest).toMatch(/^[a-f0-9]{64}$/u)
  expect(result.originalText).toBe('Gain +2 [icon:gem] tokens.')
  expect(result.progressCount).toBeGreaterThan(0)
  expect(result.previewDidNotWrite).toBe(true)
  expect(result.proposedRenderingDiffers).toBe(true)
  expect(result.appliedRenderingMatches).toBe(true)
  expect(result.applied.cards[0]!.regions[0]).toMatchObject({ originalText: result.originalText, translatedText: 'Saved translation.', translationStatus: 'draft', sourceIcons: [{ assetId: 'gem', x: 170, y: 36, width: 28, height: 28 }] })
  expect(result.undoRestoredAll).toBe(true)
  expect(result.redoRestoredAll).toBe(true)
  expect(result.cancelledWithoutWrite).toBe(true)
  expect(result.missingWordsRefusedWithoutWrite).toBe(true)
  expect(result.sharedAssetsUnchanged).toBe(true)
  expect(result.assetPixelsUnchanged).toBe(true)
  expect(result.sourcePixelsUnchanged).toBe(true)
  expect(errors).toEqual([])
  expect(external).toEqual([])
})
