import type { Page } from '@playwright/test'
import { expect, test } from '@playwright/test'
import { canvasRegion } from '../fixtures/canvas'

const base = '/happy-locale-public/'

async function observe(page: Page) {
  const errors: string[] = []
  const requests: string[] = []
  const failed: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  page.on('console', (message) => {
    // The WASM engine writes this informational DPI estimate to stderr on successful OCR.
    if (message.location().url.includes(`${base}ocr/core/`) && /^Estimating resolution as \d+$/u.test(message.text()))
      return
    if (message.type() === 'error' || /hydration/i.test(message.text()))
      errors.push(message.text())
  })
  page.context().on('request', request => requests.push(request.url()))
  page.context().on('response', (response) => {
    if (response.status() >= 400)
      failed.push(`${response.status()} ${response.url()}`)
  })
  await page.context().route('**/*', (route) => {
    const url = new URL(route.request().url())
    return url.protocol.startsWith('http') && url.origin !== 'http://127.0.0.1:3101'
      ? route.abort()
      : route.continue()
  })
  return {
    errors,
    failed,
    requests,
    assertLocal() {
      expect(requests.filter(url => /^https?:/u.test(url) && !url.startsWith(`http://127.0.0.1:3101${base}`))).toEqual([])
      expect(errors).toEqual([])
      expect(failed).toEqual([])
    },
  }
}

test('hydrates static routes and preserves the configured subpath across navigation', async ({ page, request }) => {
  const events = await observe(page)
  // A missing asset must not silently succeed with index.html.
  expect((await request.get(`${base}missing.js`)).status()).toBe(404)
  expect((await request.get('/ocr/worker/worker.min.js')).status()).toBe(404)
  await page.goto('./')
  await expect(page.getByRole('heading', { name: 'カード翻訳支援ツール', exact: true })).toBeVisible()
  // Nuxt discards window.__NUXT__ after hydration. Check the served config and its live UI effects below.
  const config = (await page.locator('script').allTextContents()).find(text => text.includes('window.__NUXT__.config='))
  expect(config).toContain(`baseURL:"${base}"`)
  expect(config).toContain('translationEndpointEnabled:false')
  await page.getByRole('link', { name: 'カード編集を始める', exact: true }).click()
  await expect(page).toHaveURL(new RegExp(`${base}cards$`))
  await expect(page.getByRole('button', { name: 'プロジェクトを開く／作成', exact: true })).toBeVisible()
  await page.getByRole('link', { name: /ホーム/ }).click()
  await expect(page).toHaveURL(new RegExp(`${base}$`))
  await page.goto('pdf')
  await expect(page.getByRole('heading', { name: 'PDF翻訳は準備中です' })).toBeVisible()
  await page.getByRole('link', { name: 'カード編集を始める', exact: true }).click()
  await expect(page).toHaveURL(new RegExp(`${base}cards$`))
  await page.reload()
  await expect(page.getByRole('button', { name: 'プロジェクトを開く／作成', exact: true })).toBeVisible()
  events.assertLocal()
})

test('loads local OCR assets and saves candidates in a non-demo project while stale endpoint settings stay disabled', async ({ page }) => {
  const events = await observe(page)
  await page.addInitScript((region) => {
    localStorage.setItem('happy-locale.translation-settings.v1', JSON.stringify({ provider: 'local', endpoint: 'https://translation.invalid' }))
    // Only the OS picker is substituted. All file reads/writes use Chromium's isolated OPFS.
    Object.defineProperty(window, 'showDirectoryPicker', { value: async () => {
      const directory = await navigator.storage.getDirectory()
      let exists = true
      try {
        await directory.getFileHandle('project.json')
      }
      catch { exists = false }
      if (!exists) {
        const canvas = document.createElement('canvas')
        canvas.width = 600
        canvas.height = 400
        const ctx = canvas.getContext('2d')!
        ctx.fillStyle = '#ffffff'
        ctx.fillRect(0, 0, 600, 400)
        ctx.fillStyle = '#000000'
        ctx.font = 'bold 36px serif'
        ctx.fillText('Synthetic Card', 100, 130)
        ctx.font = '28px serif'
        ctx.fillText('Choose an ally.', 120, 230)
        const image = await new Promise<Blob>(resolve => canvas.toBlob(value => resolve(value!)))
        const images = await directory.getDirectoryHandle('images', { create: true })
        const writeImage = await (await images.getFileHandle('synthetic.png', { create: true })).createWritable()
        await writeImage.write(image)
        await writeImage.close()
        const project = {
          version: 3,
          name: 'Synthetic',
          activeCardId: 'synthetic',
          cards: [{ id: 'synthetic', imagePath: 'images/synthetic.png', imageName: 'synthetic.png', imageWidth: 600, imageHeight: 400, regions: [region], printArea: null, sourceDpi: null }],
          assets: [],
          fonts: [],
          ocrDictionary: [],
          glossary: [],
          printSettings: { columns: 3, marginMm: 10, gapMm: 4, cutMarks: true },
        }
        const writeProject = await (await directory.getFileHandle('project.json', { create: true })).createWritable()
        await writeProject.write(JSON.stringify(project))
        await writeProject.close()
      }
      return directory
    } })
  }, { ...canvasRegion(), x: 100, y: 95, width: 300, height: 45, originalText: 'Synthetic Card', translatedText: '', manualMaskStrokes: [], exclusionAreas: [] })
  await page.goto('cards')
  const open = page.getByRole('button', { name: 'プロジェクトを開く／作成', exact: true })
  await open.click()
  await expect(page.getByLabel('カード編集キャンバス')).toBeVisible()
  const thumbnail = page.locator('.card-thumbnail img').first()
  await expect.poll(() => thumbnail.evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0)).toBe(true)
  await page.locator('.region-list-select').first().click()
  await page.locator('#inspector-tab-text').click()
  await expect(page.getByLabel('元テキスト', { exact: true })).toHaveValue('Synthetic Card')
  await expect(page.getByRole('button', { name: '翻訳候補を取得', exact: true })).toHaveCount(0)
  // This opens manual/CSV review even when no translation provider is enabled.
  await page.getByRole('button', { name: 'まとめて翻訳', exact: true }).click()
  const review = page.getByRole('dialog', { name: '翻訳をまとめて確認', exact: true })
  await expect(review.getByRole('button', { name: '翻訳', exact: true })).toBeDisabled()
  await expect(review.getByRole('button', { name: '選択した行を翻訳', exact: true })).toHaveCount(0)
  await review.press('Escape')
  await page.locator('.toolbar-tools summary').click()
  await page.getByRole('button', { name: '翻訳設定', exact: true }).click()
  const settings = page.getByRole('dialog', { name: '翻訳', exact: true })
  await expect(settings).toBeVisible()
  await expect(settings.getByRole('radio', { name: /Translation Endpoint/ })).toHaveCount(0)
  await expect(settings.getByRole('radio', { name: /ブラウザ内翻訳/ })).toBeVisible()
  await settings.getByRole('button', { name: 'キャンセル', exact: true }).click()
  await expect(settings).toBeHidden()
  await page.locator('#inspector-tab-ocr').click()
  await page.getByRole('button', { name: '領域候補を表示', exact: true }).click()
  await expect(page.getByRole('button', { name: '選択した候補を追加', exact: true })).toBeVisible({ timeout: 30000 })
  await expect(page.locator('.candidate-panel')).toContainText('Choose an ally.')
  expect(page.workers()).toHaveLength(1)
  expect(page.workers()[0]!.url()).toBe(`http://127.0.0.1:3101${base}ocr/worker/worker.min.js`)
  const save = page.getByRole('button', { name: 'プロジェクト保存', exact: true })
  await save.click()
  await expect(page.getByText('保存済み', { exact: true })).toBeVisible()
  const saved = await page.evaluate(async () => {
    const directory = await navigator.storage.getDirectory()
    const file = await (await directory.getFileHandle('project.json')).getFile()
    return JSON.parse(await file.text()) as { cards: { ocrCandidates: { text: string }[] }[] }
  })
  expect(saved.cards[0]!.ocrCandidates.map(candidate => candidate.text)).toContain('Choose an ally.')
  await page.getByRole('link', { name: /ホーム/ }).click()
  await expect(page).toHaveURL(new RegExp(`${base}$`))
  await expect.poll(() => page.workers().length).toBe(0)
  await page.goto('cards')
  await open.click()
  await page.locator('#inspector-tab-ocr').click()
  await expect.poll(() => thumbnail.evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0)).toBe(true)
  await expect(page.getByRole('button', { name: '選択した候補を追加', exact: true })).toBeVisible()
  await expect(page.locator('.candidate-panel')).toContainText('Choose an ally.')
  await page.getByRole('link', { name: /ホーム/ }).click()
  await expect(page).toHaveURL(new RegExp(`${base}$`))
  expect(events.requests.some(url => url.endsWith(`${base}ocr/worker/worker.min.js`))).toBe(true)
  expect(events.requests.some(url => url.includes(`${base}ocr/core/`) && url.includes('.wasm'))).toBe(true)
  expect(events.requests.some(url => url.endsWith(`${base}ocr/lang/eng.traineddata.gz`))).toBe(true)
  events.assertLocal()
})
