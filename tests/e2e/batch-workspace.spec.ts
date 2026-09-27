import { fileURLToPath } from 'node:url'
import { expect, test } from '@playwright/test'

test('keeps the card list, reviews detection before adding, and redetects a deleted region without touching the remaining translation', async ({ page }, testInfo) => {
  test.setTimeout(90000)
  page.setDefaultTimeout(15000)
  await page.goto('/cards')
  await expect(page.getByRole('button', { name: 'プロジェクトを開く／作成', exact: true })).toBeVisible()
  const fixture = await page.evaluate(async (url) => {
    const { prepareIconRegionUIProject } = await import(/* @vite-ignore */ url) as typeof import('./helpers/discovery-ui-project')
    const fixture = await prepareIconRegionUIProject(true)
    fixture.project.cards.forEach((card) => {
      card.regions = []
      card.ocrCandidates = []
    })
    fixture.project.assets = []
    delete fixture.project.assetDiscovery
    const directory = await (await navigator.storage.getDirectory()).getDirectoryHandle(fixture.name)
    const writer = await (await directory.getFileHandle('project.json')).createWritable()
    await writer.write(JSON.stringify(fixture.project))
    await writer.close()
    return fixture
  }, `/_nuxt/@fs${fileURLToPath(new URL('./helpers/discovery-ui-project.ts', import.meta.url))}`)
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  const workspace = page.getByRole('region', { name: '領域検出・OCR', exact: true })
  const left = page.locator('.card-list-panel')
  const save = async () => {
    await page.getByRole('button', { name: 'プロジェクト保存', exact: true }).click()
    await expect(page.locator('.save-status')).toHaveText('保存済み')
    return page.evaluate(async name => JSON.parse(await (await (await (await navigator.storage.getDirectory()).getDirectoryHandle(name)).getFileHandle('project.json').then(h => h.getFile())).text()) as import('../../app/types/editor').FolderProjectDocument, fixture.name)
  }
  try {
    await page.getByRole('button', { name: 'プロジェクトを開く／作成', exact: true }).click()
    await left.getByRole('button', { name: '領域検出', exact: true }).click()
    await expect(left).toBeVisible()
    const selection = left.getByRole('combobox', { name: 'カードの選択条件' })
    await expect(selection).toHaveValue('all')
    await selection.selectOption('none')
    await expect(page.locator('.batch-card-check input:checked')).toHaveCount(0)
    await page.locator('.batch-card-check input').last().check()
    await expect(selection).toHaveValue('')
    await expect(workspace.getByRole('button', { name: '1枚の領域を検出', exact: true })).toBeEnabled()
    await page.locator('.card-list-select').first().click()
    await expect(page.locator('.batch-card-check input').last()).toBeChecked()
    await expect(page.locator('.batch-card-check input').first()).not.toBeChecked()
    await selection.selectOption('all')
    await expect(workspace.locator('.batch-card-preview')).toHaveCount(2)
    await expect(workspace.getByRole('button', { name: '対象カードをすべて表示', exact: true })).toHaveCount(0)
    await expect(page.locator('.batch-card-check input:checked')).toHaveCount(2)
    await workspace.getByRole('button', { name: '2枚の領域を検出', exact: true }).click()
    await expect(workspace.getByRole('region', { name: 'OCR結果', exact: true })).toBeVisible()
    const detected = await save()
    expect(detected.cards.every(card => card.regions.length === 0 && card.ocrCandidates!.length > 0)).toBe(true)
    await workspace.getByRole('button', { name: '表示中の候補をすべて選択', exact: true }).click()
    await workspace.getByRole('button', { name: /選択した候補を追加/ }).click()
    await expect(workspace.getByRole('region', { name: 'OCR結果', exact: true })).toBeVisible()
    const added = await save()
    expect(added.cards.every(card => card.regions.length > 0)).toBe(true)
    await workspace.getByRole('button', { name: 'カード編集に戻る', exact: true }).click()
    // Add a separate retained region in a blank area, then delete the detected text region via ordinary controls.
    const actualCanvas = page.locator('canvas').filter({ visible: true }).first()
    const bounds = await actualCanvas.boundingBox()
    expect(bounds).not.toBeNull()
    await page.mouse.move(bounds!.x + 20, bounds!.y + 20)
    await page.mouse.down()
    await page.mouse.move(bounds!.x + 100, bounds!.y + 65)
    await page.mouse.up()
    await page.getByRole('tab', { name: '翻訳', exact: true }).click()
    await page.getByLabel('日本語訳', { exact: true }).fill('保持する訳文')
    await page.getByRole('tab', { name: '領域一覧', exact: true }).click()
    await page.locator('.region-list-remove').first().click()
    await page.getByRole('alertdialog', { name: '領域を削除しますか？' }).getByRole('button', { name: '削除', exact: true }).click()
    const removed = await save()
    expect(removed.cards[0]!.regions).toHaveLength(1)
    expect(removed.cards[0]!.regions[0]!.translatedText).toBe('保持する訳文')
    await left.getByRole('button', { name: '領域検出', exact: true }).click()
    await expect(page.locator('.batch-card-check input:checked')).toHaveCount(2)
    await workspace.getByRole('button', { name: '2枚の領域を検出', exact: true }).click()
    await expect(workspace.getByRole('region', { name: 'OCR結果', exact: true })).toBeVisible()
    const redetected = await save()
    expect(redetected.cards[0]!.regions).toEqual(removed.cards[0]!.regions)
    expect(redetected.cards[1]!.regions).toEqual(added.cards[1]!.regions)
    expect(redetected.cards[0]!.ocrCandidates!.length).toBeGreaterThan(0)
    expect(redetected.cards[1]!.ocrCandidates ?? []).toEqual([])
    await workspace.getByRole('button', { name: '表示中の候補をすべて選択', exact: true }).click()
    await workspace.getByRole('button', { name: /選択した候補を追加/ }).click()
    await expect(workspace.getByRole('region', { name: 'OCR結果', exact: true })).toBeVisible()
    const restored = await save()
    expect(restored.cards[0]!.regions).toHaveLength(2)
    expect(restored.cards[0]!.regions[0]).toEqual(removed.cards[0]!.regions[0])
    await expect(workspace.getByRole('button', { name: /選択した候補を追加/ })).toHaveCount(0)
    await expect(workspace.getByRole('button', { name: '翻訳へ進む', exact: true })).toBeEnabled()
    await workspace.locator('.candidate-card').first().getByRole('button', { name: 'この領域を編集', exact: true }).first().click()
    await page.getByRole('button', { name: 'OCR結果に戻る', exact: true }).click()
    await expect(workspace).toBeVisible()
    await page.setViewportSize({ width: 600, height: 900 })
    await page.locator('.batch-card-check input').first().scrollIntoViewIfNeeded()
    await selection.scrollIntoViewIfNeeded()
    await expect(selection).toBeInViewport()
    await page.screenshot({ path: testInfo.outputPath('batch-workspace-narrow.png'), fullPage: true })
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await expect(left.getByRole('combobox', { name: 'カードの選択条件' })).toBeVisible()
    await expect(workspace.getByRole('button', { name: 'カード編集に戻る', exact: true })).toBeVisible()
    expect(errors).toEqual([])
  }
  finally {
    await page.evaluate(async name => (await navigator.storage.getDirectory()).removeEntry(name, { recursive: true }), fixture.name)
  }
})

test('locks targets while detecting, cancels pending work, and clears results on another project', async ({ page }) => {
  test.setTimeout(60000)
  page.setDefaultTimeout(15000)
  await page.goto('/cards')
  await expect(page.getByRole('button', { name: 'プロジェクトを開く／作成', exact: true })).toBeVisible()
  const url = `/_nuxt/@fs${fileURLToPath(new URL('./helpers/discovery-ui-project.ts', import.meta.url))}`
  const name = await page.evaluate(async (url) => {
    const { prepareIconRegionUIProject } = await import(/* @vite-ignore */ url) as typeof import('./helpers/discovery-ui-project')
    const fixture = await prepareIconRegionUIProject(true)
    const base = fixture.project.cards[0]!
    fixture.project.cards = Array.from({ length: 20 }, (_, index) => ({ ...structuredClone(base), id: index ? `card-${index}` : base.id, regions: [], ocrCandidates: [] }))
    fixture.project.assets = []
    delete fixture.project.assetDiscovery
    const directory = await (await navigator.storage.getDirectory()).getDirectoryHandle(fixture.name)
    const writer = await (await directory.getFileHandle('project.json')).createWritable()
    await writer.write(JSON.stringify(fixture.project))
    await writer.close()
    return fixture.name
  }, url)
  const names = [name]
  try {
    await page.getByRole('button', { name: 'プロジェクトを開く／作成', exact: true }).click()
    await page.locator('.card-list-panel').getByRole('button', { name: '領域検出', exact: true }).click()
    await page.getByRole('button', { name: '20枚の領域を検出', exact: true }).click()
    const workspace = page.getByRole('region', { name: '領域検出・OCR', exact: true })
    await expect(page.locator('.batch-card-check input').first()).toBeDisabled()
    await expect(page.locator('.toolbar').getByRole('button', { name: 'カード', exact: true })).toBeDisabled()
    await workspace.getByRole('button', { name: '中止（完了分は保持）', exact: true }).click()
    await expect(workspace.getByRole('region', { name: 'OCR結果', exact: true })).toBeVisible()
    await expect(workspace).toContainText('（中止）')
    await page.getByRole('button', { name: 'プロジェクト保存', exact: true }).click()
    await expect(page.locator('.save-status')).toHaveText('保存済み')
    const next = await page.evaluate(async (url) => {
      const { prepareDiscoveryUIProject } = await import(/* @vite-ignore */ url) as typeof import('./helpers/discovery-ui-project')
      return prepareDiscoveryUIProject()
    }, url)
    names.push(next.name)
    await page.locator('.toolbar-tools summary').click()
    await page.getByRole('button', { name: '別のプロジェクトを開く', exact: true }).click()
    await expect(page.getByRole('button', { name: 'OCR結果を確認', exact: true })).toHaveCount(0)
    await page.locator('.card-list-panel').getByRole('button', { name: '領域検出', exact: true }).click()
    await expect(page.locator('.batch-card-check input')).toHaveCount(2)
    await expect(page.locator('.batch-card-check input:checked')).toHaveCount(0)
    await expect(page.getByRole('combobox', { name: 'カードの選択条件' })).toHaveValue('uncreated')
    await expect(workspace.getByRole('region', { name: 'OCR結果', exact: true })).toHaveCount(0)
  }
  finally {
    for (const folder of names)
      await page.evaluate(async name => (await navigator.storage.getDirectory()).removeEntry(name, { recursive: true }), folder)
  }
})

test('explains an empty detection target and keeps setup, saved candidates and actions distinct', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1280, height: 720 })
  await page.goto('/cards')
  await expect(page.getByRole('button', { name: 'プロジェクトを開く／作成', exact: true })).toBeVisible()
  const fixture = await page.evaluate(async (url) => {
    const { prepareIconRegionUIProject } = await import(/* @vite-ignore */ url) as typeof import('./helpers/discovery-ui-project')
    const fixture = await prepareIconRegionUIProject()
    const directory = await (await navigator.storage.getDirectory()).getDirectoryHandle(fixture.name)
    const images = await directory.getDirectoryHandle('images')
    const png = await (await images.getFileHandle('one.png')).getFile()
    const base = fixture.project.cards[0]!
    for (let i = 3; i <= 37; i++) {
      const imageName = `card-${i}.png`
      fixture.project.cards.push({ ...structuredClone(base), id: `card-${i}`, imageName, imagePath: `images/${imageName}` })
      const writer = await (await images.getFileHandle(imageName, { create: true })).createWritable()
      await writer.write(png)
      await writer.close()
    }
    base.ocrCandidates = [{ id: 'saved', x: 10, y: 20, width: 100, height: 30, text: 'Saved candidate', confidence: 95, selected: true, lines: [] }]
    const writer = await (await directory.getFileHandle('project.json')).createWritable()
    await writer.write(JSON.stringify(fixture.project))
    await writer.close()
    return { name: fixture.name }
  }, `/_nuxt/@fs${fileURLToPath(new URL('./helpers/discovery-ui-project.ts', import.meta.url))}`)
  try {
    await page.getByRole('button', { name: 'プロジェクトを開く／作成', exact: true }).click()
    await page.locator('.card-list-panel').getByRole('button', { name: '領域検出', exact: true }).click()
    const workspace = page.getByRole('region', { name: '領域検出・OCR', exact: true })
    await expect(workspace.getByRole('heading', { name: '領域未作成のカードはありません' })).toBeVisible()
    await expect(workspace.locator('.plan-summary')).toHaveCount(0)
    await expect(workspace.getByRole('button', { name: '対象選択に戻る', exact: true })).toHaveCount(0)
    await expect(workspace.getByRole('region', { name: '領域候補の確認' })).toHaveCount(0)
    await expect(workspace.getByRole('button', { name: '0枚の領域を検出', exact: true })).toBeDisabled()
    await expect(workspace.locator('.workflow-footer')).toBeInViewport()
    await expect(page.locator('.card-list-item').nth(2)).toBeInViewport()
    await page.screenshot({ path: testInfo.outputPath('empty-target-desktop.png') })
    await workspace.getByRole('button', { name: '全カードを選択', exact: true }).click()
    await expect(page.locator('.batch-card-check input:checked')).toHaveCount(37)
    await expect(workspace.getByRole('button', { name: '37枚の領域を検出', exact: true })).toBeEnabled()
    await workspace.getByRole('button', { name: '保存済みの候補を確認（1件）' }).click()
    await expect(workspace.getByText('Saved candidate', { exact: true })).toBeVisible()
    await expect(workspace.getByRole('button', { name: '選択した候補を追加（1件）' })).toBeEnabled()
    await workspace.getByRole('button', { name: '対象選択に戻る', exact: true }).click()
    await expect(workspace.getByRole('region', { name: '領域候補の確認' })).toHaveCount(0)
    await workspace.getByRole('button', { name: '保存済みの候補を確認（1件）' }).click()
    await expect(workspace.getByRole('checkbox', { name: 'one.pngの候補を追加対象にする' })).toBeChecked()
    await workspace.getByRole('button', { name: 'カードで領域・候補を修正', exact: true }).first().click()
    await page.getByRole('button', { name: 'OCR結果に戻る', exact: true }).click()
    await expect(workspace.getByRole('checkbox', { name: 'one.pngの候補を追加対象にする' })).toBeChecked()
    await page.setViewportSize({ width: 390, height: 844 })
    const add = workspace.getByRole('button', { name: '選択した候補を追加（1件）' })
    await add.scrollIntoViewIfNeeded()
    await expect(add).toBeInViewport()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.screenshot({ path: testInfo.outputPath('candidate-actions-narrow.png') })
  }
  finally {
    await page.evaluate(async name => (await navigator.storage.getDirectory()).removeEntry(name, { recursive: true }), fixture.name)
  }
})
