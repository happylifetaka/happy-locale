import { fileURLToPath } from 'node:url'
import { expect, test } from '@playwright/test'

test('keeps the workspace and zoomed preview in place while adjusting transparency sliders', async ({ page }) => {
  await page.setViewportSize({ width: 600, height: 900 })
  await page.goto('/cards')
  await expect(page.getByRole('button', { name: 'プロジェクトを開く／作成', exact: true })).toBeVisible()
  const url = `/_nuxt/@fs${fileURLToPath(new URL('./helpers/discovery-ui-project.ts', import.meta.url))}`
  const fixture = await page.evaluate(async (url) => {
    const { prepareIconRegionUIProject } = await import(/* @vite-ignore */ url) as typeof import('./helpers/discovery-ui-project')
    return prepareIconRegionUIProject()
  }, url)
  try {
    await page.getByRole('button', { name: 'プロジェクトを開く／作成', exact: true }).click()
    await page.getByRole('button', { name: 'アイコン検出', exact: true }).click()
    const workspace = page.getByRole('region', { name: 'アイコン検出', exact: true })
    await workspace.locator('.group-list button').click()
    await workspace.getByRole('button', { name: '代表画像をアイコンに登録', exact: true }).click()
    const panel = workspace.locator('.asset-creation-panel')
    const zoom = panel.getByRole('combobox', { name: 'プレビューの拡大率', exact: true })
    const preview = panel.getByRole('region', { name: 'アイコン画像の作業範囲', exact: true })
    const positions = () => workspace.evaluate((element) => {
      const preview = element.querySelector('.asset-creation-preview')!
      return [element.scrollTop, element.scrollLeft, preview.scrollTop, preview.scrollLeft, window.scrollY]
    })
    for (const scale of ['fit', '1600']) {
      await zoom.selectOption(scale)
      if (scale === '1600') {
        await preview.evaluate(element => element.scrollTo(30, 80))
        await expect.poll(() => preview.evaluate(element => element.scrollTop)).toBe(80)
      }
      for (const name of [/背景の許容色差/, /境界のぼかし/]) {
        const slider = panel.getByRole('slider', { name })
        await slider.scrollIntoViewIfNeeded()
        await slider.focus()
        const before = await positions()
        const originalValue = Number(await slider.inputValue())
        await slider.press('ArrowRight')
        await expect(slider).toHaveValue(String(originalValue + 1))
        expect(await positions()).toEqual(before)

        const bounds = (await slider.boundingBox())!
        await page.mouse.move(bounds.x + bounds.width * 0.3, bounds.y + bounds.height / 2)
        await page.mouse.down()
        try {
          for (const ratio of [0.4, 0.5, 0.7]) {
            await page.mouse.move(bounds.x + bounds.width * ratio, bounds.y + bounds.height / 2, { steps: 3 })
            expect(await positions()).toEqual(before)
          }
        }
        finally {
          await page.mouse.up()
        }
        const max = Number(await slider.getAttribute('max'))
        expect(Number(await slider.inputValue())).toBeGreaterThan(max * 0.65)
        expect(Number(await slider.inputValue())).toBeLessThan(max * 0.75)
      }
      await expect(zoom).toHaveValue(scale)
    }
  }
  finally {
    await page.evaluate(async (name) => {
      await (await navigator.storage.getDirectory()).removeEntry(name, { recursive: true })
    }, fixture.name)
  }
})

test('zooms small icons and applies broad or precise brushes in original pixels through PNG export', async ({ page }, testInfo) => {
  await page.goto('/cards')
  await expect(page.getByRole('button', { name: 'プロジェクトを開く／作成', exact: true })).toBeVisible()
  const url = `/_nuxt/@fs${fileURLToPath(new URL('./helpers/discovery-ui-project.ts', import.meta.url))}`
  const fixture = await page.evaluate(async (url) => {
    const { prepareIconRegionUIProject } = await import(/* @vite-ignore */ url) as typeof import('./helpers/discovery-ui-project')
    return prepareIconRegionUIProject()
  }, url)
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  try {
    await page.getByRole('button', { name: 'プロジェクトを開く／作成', exact: true }).click()
    await page.getByRole('button', { name: 'アイコン検出', exact: true }).click()
    const workspace = page.getByRole('region', { name: 'アイコン検出', exact: true })
    await workspace.locator('.group-list button').click()
    await workspace.getByRole('button', { name: '代表画像をアイコンに登録', exact: true }).click()
    const panel = workspace.locator('.asset-creation-panel')
    const canvas = panel.getByLabel('背景透明化プレビュー', { exact: true })
    const viewport = panel.getByRole('region', { name: 'アイコン画像の作業範囲', exact: true })
    const zoom = panel.getByRole('combobox', { name: 'プレビューの拡大率', exact: true })
    const alpha = (x: number, y: number) => canvas.evaluate((element, { x, y }) => (element as HTMLCanvasElement).getContext('2d')!.getImageData(x, y, 1, 1).data[3], { x, y })
    const paintAt = async (x: number, y: number) => {
      await viewport.scrollIntoViewIfNeeded()
      await viewport.evaluate(element => element.scrollTo(0, 0))
      const bounds = (await canvas.boundingBox())!
      await page.mouse.click(bounds.x + x * bounds.width / 32, bounds.y + y * bounds.height / 42)
    }
    await expect(canvas).toHaveJSProperty('width', 32)
    await expect(canvas).toHaveJSProperty('height', 42)
    await expect.poll(() => canvas.evaluate(element => element.getBoundingClientRect().width)).toBeGreaterThan(96)
    await panel.getByRole('radio', { name: '色を指定', exact: true }).check()
    await expect.poll(() => alpha(16, 21)).toBe(255)
    await zoom.selectOption('400')
    await expect.poll(() => canvas.evaluate(element => element.getBoundingClientRect().width)).toBe(128)
    await panel.getByRole('button', { name: 'ブラシで補正', exact: true }).click()
    const size = panel.getByRole('spinbutton', { name: 'ブラシサイズ（元画像px）', exact: true })
    await size.fill('8')
    await size.press('Tab')
    await paintAt(16, 21)
    await expect.poll(() => alpha(16, 21)).toBe(0)
    await expect.poll(() => alpha(1, 1)).toBe(255)
    await expect(panel.locator('.asset-brush-cursor')).toHaveCSS('width', '32px')
    await panel.getByRole('button', { name: '元に戻す', exact: true }).click()
    await paintAt(16, 21)
    await expect.poll(() => alpha(16, 21)).toBe(255)
    await panel.getByRole('button', { name: '1画戻す', exact: true }).click()
    await expect.poll(() => alpha(16, 21)).toBe(0)
    await panel.getByRole('button', { name: '1画戻す', exact: true }).click()
    await expect.poll(() => alpha(16, 21)).toBe(255)
    await panel.getByRole('button', { name: '透明にする', exact: true }).click()
    await viewport.scrollIntoViewIfNeeded()
    const edgeBounds = (await canvas.boundingBox())!
    await page.mouse.move(edgeBounds.x - 5, edgeBounds.y + edgeBounds.height / 2)
    await expect(panel.locator('.asset-brush-cursor')).toBeVisible()
    await expect(panel.locator('.asset-brush-cursor')).toHaveCSS('left', '-5px')
    await paintAt(-2, 21) // 画像外から円が重なる端だけを削り、中心を画像内に押し戻さない。
    await expect.poll(() => alpha(0, 21)).toBe(0)
    await expect.poll(() => alpha(2, 21)).toBe(255)
    await viewport.screenshot({ path: testInfo.outputPath('brush-outside-image.png') })
    await panel.getByRole('button', { name: '1画戻す', exact: true }).click()
    await expect.poll(() => alpha(0, 21)).toBe(255)
    await size.fill('80') // 元の短辺32pxより大きいブラシも使える。
    await size.press('Tab')
    const scrollExtent = () => viewport.evaluate(element => [element.scrollWidth, element.scrollHeight])
    const extentBefore = await scrollExtent()
    await paintAt(16, 21)
    await expect.poll(() => alpha(1, 1)).toBe(0)
    expect(await scrollExtent()).toEqual(extentBefore)
    await panel.getByRole('button', { name: '補正をクリア', exact: true }).click()
    await expect.poll(() => alpha(1, 1)).toBe(255)
    await page.setViewportSize({ width: 600, height: 900 })
    await zoom.selectOption('1600')
    await expect.poll(() => canvas.evaluate(element => element.getBoundingClientRect().width)).toBe(512)
    await expect.poll(() => viewport.evaluate(element => element.scrollWidth > element.clientWidth && element.scrollHeight > element.clientHeight)).toBe(true)
    await size.fill('8')
    await size.press('Tab')
    await paintAt(8, 10)
    await expect.poll(() => alpha(8, 10)).toBe(0)
    await expect.poll(() => alpha(16, 21)).toBe(255)
    expect(await panel.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true)
    await panel.screenshot({ path: testInfo.outputPath('zoomed-brush-narrow.png') })
    await zoom.selectOption('fit')
    await expect(canvas).toHaveJSProperty('width', 32)
    await expect(canvas).toHaveJSProperty('height', 42)
    await expect.poll(() => alpha(8, 10)).toBe(0)
    await page.setViewportSize({ width: 1440, height: 1000 })
    await panel.screenshot({ path: testInfo.outputPath('zoomed-brush-desktop.png') })
    await panel.getByLabel('アイコン名', { exact: true }).fill('brush_test')
    await panel.getByRole('button', { name: 'アイコンを確定', exact: true }).click()
    await expect(panel).toHaveCount(0)
    await page.getByRole('button', { name: 'プロジェクト保存', exact: true }).click()
    await expect(page.getByRole('status').filter({ hasText: '保存済み' })).toBeVisible()
    const exported = await page.evaluate(async (name) => {
      const directory = await (await navigator.storage.getDirectory()).getDirectoryHandle(name)
      const project = JSON.parse(await (await (await directory.getFileHandle('project.json')).getFile()).text()) as import('../../app/types/editor').FolderProjectDocument
      const asset = project.assets.find(asset => asset.name === 'brush_test')!
      const png = await (await (await directory.getDirectoryHandle('assets')).getFileHandle(asset.imagePath!.split('/').at(-1)!)).getFile()
      const image = await createImageBitmap(png)
      const canvas = document.createElement('canvas')
      canvas.width = image.width
      canvas.height = image.height
      const ctx = canvas.getContext('2d')!
      ctx.drawImage(image, 0, 0)
      image.close()
      return { size: [canvas.width, canvas.height], cleared: ctx.getImageData(8, 10, 1, 1).data[3], preserved: [...ctx.getImageData(16, 21, 1, 1).data] }
    }, fixture.name)
    expect(exported).toEqual({ size: [32, 42], cleared: 0, preserved: [238, 48, 48, 255] })
    expect(errors).toEqual([])
  }
  finally {
    await page.evaluate(async (name) => {
      await (await navigator.storage.getDirectory()).removeEntry(name, { recursive: true })
    }, fixture.name)
  }
})
