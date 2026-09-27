import { fileURLToPath } from 'node:url'
import { expect, test } from '@playwright/test'

test('detects regions, collects only confirmed-region icons, registers them and re-OCRs the same frames', async ({ page }, testInfo) => {
  test.setTimeout(90000)
  await page.goto('/cards')
  await expect(page.getByRole('button', { name: 'プロジェクトを開く／作成', exact: true })).toBeVisible()
  const url = `/_nuxt/@fs${fileURLToPath(new URL('./helpers/discovery-ui-project.ts', import.meta.url))}`
  const fixture = await page.evaluate(async (url) => {
    const { prepareIconRegionUIProject } = await import(/* @vite-ignore */ url) as typeof import('./helpers/discovery-ui-project')
    const fixture = await prepareIconRegionUIProject(true)
    fixture.project.cards.splice(1)
    fixture.project.assets = []
    delete fixture.project.assetDiscovery
    const directory = await (await navigator.storage.getDirectory()).getDirectoryHandle(fixture.name)
    const writer = await (await directory.getFileHandle('project.json')).createWritable()
    await writer.write(JSON.stringify(fixture.project))
    await writer.close()
    return fixture
  }, url)
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  async function saveAndRead() {
    await page.getByRole('button', { name: 'プロジェクト保存', exact: true }).click()
    await expect(page.locator('.save-status')).toHaveText('保存済み')
    return page.evaluate(async (name) => {
      const directory = await (await navigator.storage.getDirectory()).getDirectoryHandle(name)
      return JSON.parse(await (await (await directory.getFileHandle('project.json')).getFile()).text()) as import('../../app/types/editor').FolderProjectDocument
    }, fixture.name)
  }
  try {
    await page.getByRole('button', { name: 'プロジェクトを開く／作成', exact: true }).click()
    await expect(page.locator('.toolbar').getByRole('button', { name: '領域・OCR', exact: true })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'このカードに反映', exact: true })).toHaveCount(0)
    await expect(page.getByRole('button', { name: '未反映の内容を確認', exact: true })).toHaveCount(0)
    await page.getByRole('button', { name: 'アイコン検出', exact: true }).click()
    const discovery = page.getByRole('region', { name: 'アイコン検出', exact: true })
    const scope = discovery.getByRole('combobox', { name: 'アイコンの探索範囲', exact: true })
    await expect(scope).toHaveValue('image')
    await scope.selectOption('regions')
    await expect(discovery.getByRole('button', { name: '選択したカードから収集', exact: true })).toBeDisabled()
    await discovery.getByRole('button', { name: '領域検出へ', exact: true }).click()
    const workspace = page.getByRole('region', { name: '領域検出・OCR', exact: true })
    await workspace.getByRole('button', { name: '1枚の領域を検出', exact: true }).click()
    await expect(workspace.getByRole('region', { name: 'OCR結果', exact: true })).toBeVisible({ timeout: 45000 })
    const candidates = await saveAndRead()
    expect(candidates.cards[0]!.regions).toHaveLength(0)
    await workspace.getByRole('button', { name: '表示中の候補をすべて選択', exact: true }).click()
    await workspace.getByRole('button', { name: /選択した候補を追加/ }).click()
    await expect(workspace.getByRole('region', { name: 'OCR結果', exact: true })).toBeVisible()
    const detected = await saveAndRead()
    expect(detected.cards[0]!.regions).toHaveLength(1)
    await page.getByRole('button', { name: 'アイコン検出', exact: true }).click()
    await expect(scope).toHaveValue('regions')
    await discovery.getByRole('button', { name: '選択したカードから収集', exact: true }).click()
    await expect(discovery.getByText(/収集完了：新規1枚/)).toBeVisible({ timeout: 30000 })
    await expect(discovery.locator('.group-list button')).toHaveCount(2)
    for (let index = 0; index < 2; index++) {
      await discovery.locator('.group-list button').nth(index).click()
      await discovery.getByRole('button', { name: '代表画像をアイコンに登録', exact: true }).click()
      const panel = discovery.locator('.asset-creation-panel')
      await panel.getByLabel('アイコン名', { exact: true }).fill(`collected_${index + 1}`)
      await panel.getByRole('button', { name: 'アイコンを確定', exact: true }).click()
      await expect(panel).toHaveCount(0)
    }
    const registered = await saveAndRead()
    expect(registered.cards[0]!.regions).toEqual(detected.cards[0]!.regions)
    expect(registered.assetDiscovery!.occurrences.every(item => item.owner?.kind === 'region')).toBe(true)
    await discovery.getByRole('button', { name: 'まとめて再OCRへ', exact: true }).click()
    await workspace.getByRole('button', { name: '1枚を再OCR', exact: true }).click()
    await expect(workspace.getByRole('region', { name: 'OCR結果', exact: true })).toBeVisible({ timeout: 45000 })
    const result = await saveAndRead()
    const region = result.cards[0]!.regions[0]!
    const before = detected.cards[0]!.regions[0]!
    expect([region.id, region.x, region.y, region.width, region.height]).toEqual([before.id, before.x, before.y, before.width, before.height])
    expect(region.originalText).toContain('[icon:collected_1]')
    expect(region.originalText).toContain('[icon:collected_2]')
    expect(region.sourceIcons).toHaveLength(2)
    expect(result.cards[0]!.ocrCandidates ?? []).toEqual([])
    await workspace.screenshot({ path: testInfo.outputPath('region-first-results.png') })
    await page.setViewportSize({ width: 600, height: 900 })
    await page.getByRole('button', { name: 'まとめて再OCR', exact: true }).click()
    expect(await workspace.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true)
    await workspace.screenshot({ path: testInfo.outputPath('reocr-selection-narrow.png') })
    await workspace.getByRole('button', { name: 'OCR結果', exact: true }).click()
    await page.getByRole('button', { name: 'カード', exact: true }).click()
    await page.getByRole('button', { name: 'まとめて再OCR', exact: true }).click()
    await page.getByRole('button', { name: 'OCR結果', exact: true }).click()
    await expect(workspace.getByRole('region', { name: 'OCR結果', exact: true })).toBeVisible()
    expect(errors).toEqual([])
  }
  finally {
    await page.evaluate(async name => (await navigator.storage.getDirectory()).removeEntry(name, { recursive: true }), fixture.name)
  }
})
