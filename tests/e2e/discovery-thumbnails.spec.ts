import { fileURLToPath } from 'node:url'
import { expect, test } from '@playwright/test'

test('lazy group and occurrence thumbnails preserve original pixels for unselected cards and update after bounds edits', async ({ page }, testInfo) => {
  test.setTimeout(90000)
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await page.goto('/cards')
  await expect(page.getByRole('button', { name: 'プロジェクトを開く／作成', exact: true })).toBeVisible()
  const url = `/_nuxt/@fs${fileURLToPath(new URL('./helpers/discovery-ui-project.ts', import.meta.url))}`
  const fixture = await page.evaluate(async (url) => {
    const { prepareDiscoveryThumbnailUIProject } = await import(/* @vite-ignore */ url) as typeof import('./helpers/discovery-ui-project')
    return prepareDiscoveryThumbnailUIProject()
  }, url)
  try {
    await page.getByRole('button', { name: 'プロジェクトを開く／作成', exact: true }).click()
    await page.getByRole('button', { name: 'アセット検出', exact: true }).click()
    const workspace = page.getByRole('region', { name: 'アセット検出', exact: true })
    const groups = workspace.locator('.group-list')
    const last = groups.getByRole('button', { name: /^グループ32：/ })
    await expect(groups.getByRole('button')).toHaveCount(32)
    await expect(last.locator('img')).toHaveCount(0)
    await last.scrollIntoViewIfNeeded()
    const thumbnail = last.locator('img')
    await expect(thumbnail).toBeVisible()
    await expect(thumbnail).toHaveJSProperty('naturalWidth', 32)
    await expect(thumbnail).toHaveJSProperty('naturalHeight', 42)
    const pixels = await thumbnail.evaluate(async (img: HTMLImageElement) => {
      const canvas = document.createElement('canvas')
      canvas.width = img.naturalWidth
      canvas.height = img.naturalHeight
      const ctx = canvas.getContext('2d')!
      ctx.drawImage(img, 0, 0)
      return { pixels: [...ctx.getImageData(0, 0, 2, 1).data], type: (await (await fetch(img.src)).blob()).type }
    })
    expect(pixels).toEqual({ pixels: [0, 0, 0, 255, 255, 255, 255, 255], type: 'image/png' })
    const cacheFile = () => page.evaluate(async ({ name, cacheName }) => {
      const directory = await (await navigator.storage.getDirectory()).getDirectoryHandle(name)
      const cache = await (await directory.getDirectoryHandle('temp')).getDirectoryHandle('asset-thumbnails')
      const file = await (await cache.getFileHandle(cacheName)).getFile()
      const project = JSON.parse(await (await (await directory.getFileHandle('project.json')).getFile()).text())
      return { size: file.size, modified: file.lastModified, project }
    }, fixture)
    const cached = await cacheFile()
    expect(cached.size).toBeGreaterThan(24)
    expect(cached.project).toEqual(fixture.project)
    async function reopen() {
      await page.reload()
      await page.evaluate(async (name) => {
        const directory = await (await navigator.storage.getDirectory()).getDirectoryHandle(name)
        Object.assign(window, { showDirectoryPicker: async () => directory })
      }, fixture.name)
      await page.getByRole('button', { name: 'プロジェクトを開く／作成', exact: true }).click()
      await page.getByRole('button', { name: 'アセット検出', exact: true }).click()
      await last.scrollIntoViewIfNeeded()
      await expect(thumbnail).toHaveJSProperty('naturalWidth', 32)
    }
    await reopen()
    expect(await cacheFile()).toEqual(cached) // reuse, no rewrite on reopen
    await page.evaluate(async ({ name, cacheName }) => {
      const directory = await (await navigator.storage.getDirectory()).getDirectoryHandle(name)
      const cache = await (await directory.getDirectoryHandle('temp')).getDirectoryHandle('asset-thumbnails')
      const writer = await (await cache.getFileHandle(cacheName)).createWritable()
      await writer.write('broken cache')
      await writer.close()
    }, fixture)
    await reopen()
    expect((await cacheFile()).size).toBe(cached.size)
    await page.evaluate(async (name) => {
      const directory = await (await navigator.storage.getDirectory()).getDirectoryHandle(name)
      await directory.removeEntry('temp', { recursive: true })
    }, fixture.name)
    await reopen()
    expect((await cacheFile()).size).toBe(cached.size)
    // Browsing a group preview must not select that card or mutate the project.
    await page.getByRole('button', { name: 'カード', exact: true }).click()
    await expect(page.getByLabel('カード編集キャンバス')).toBeVisible()
    await page.getByRole('button', { name: 'アセット検出', exact: true }).click()
    await last.click()
    const occurrence = workspace.locator('.occurrence button')
    await occurrence.scrollIntoViewIfNeeded()
    await expect(occurrence.locator('img')).toHaveJSProperty('naturalWidth', 32)
    await occurrence.click()
    const width = workspace.getByRole('spinbutton', { name: '候補の幅', exact: true })
    await width.fill('24')
    await workspace.getByRole('button', { name: '範囲の変更を保存', exact: true }).click()
    await occurrence.scrollIntoViewIfNeeded()
    await expect(occurrence.locator('img')).toHaveJSProperty('naturalWidth', 24)
    await workspace.getByRole('button', { name: '候補編集を戻す', exact: true }).click()
    await occurrence.scrollIntoViewIfNeeded()
    await expect(occurrence.locator('img')).toHaveJSProperty('naturalWidth', 32)
    await page.screenshot({ path: testInfo.outputPath('original-resolution-thumbnails.png') })
    expect(errors).toEqual([])
  }
  finally {
    await page.evaluate(async (name) => {
      await (await navigator.storage.getDirectory()).removeEntry(name, { recursive: true })
    }, fixture.name)
  }
})
