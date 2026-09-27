import type { Page } from '@playwright/test'
import { fileURLToPath } from 'node:url'
import { expect, test } from '@playwright/test'

async function reocrCurrent(page: Page) {
  await page.getByRole('button', { name: 'まとめて再OCR', exact: true }).click()
  const targets = page.getByRole('region', { name: '領域検出・OCR', exact: true })
  await page.locator('.card-list-panel').getByRole('combobox', { name: 'カードの選択条件' }).selectOption('none')
  await page.locator('.card-list-item').filter({ has: page.locator('[aria-current="true"]') }).getByRole('checkbox').check()
  await targets.getByRole('button', { name: '1枚を再OCR', exact: true }).click()
  await expect(page.getByRole('region', { name: 'OCR結果', exact: true })).toBeVisible({ timeout: 45000 })
}

test('discovery leads to selected-card application and preserves corrected originals on re-entry', async ({ page }, testInfo) => {
  test.setTimeout(90000)
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await page.goto('/cards')
  await expect(page.getByRole('button', { name: 'プロジェクトを開く／作成', exact: true })).toBeVisible()
  const url = `/_nuxt/@fs${fileURLToPath(new URL('./helpers/discovery-ui-project.ts', import.meta.url))}`
  const fixture = await page.evaluate(async (url) => {
    const { prepareIconRegionUIProject } = await import(/* @vite-ignore */ url) as typeof import('./helpers/discovery-ui-project')
    const fixture = await prepareIconRegionUIProject()
    const second = fixture.project.cards[1]!
    const region = second.regions[0]!
    second.ocrCandidates = [{ id: 'second-candidate', x: region.x, y: region.y, width: region.width, height: region.height, text: 'Gain two tokens', confidence: 95, selected: true, lines: [] }]
    second.regions = []
    fixture.project.assetDiscovery!.occurrences.push({ ...structuredClone(fixture.project.assetDiscovery!.occurrences[0]!), id: 'second-icon', cardId: second.id })
    fixture.project.assetDiscovery!.groups[0]!.memberIds.push('second-icon')
    const directory = await (await navigator.storage.getDirectory()).getDirectoryHandle(fixture.name)
    const writer = await (await directory.getFileHandle('project.json')).createWritable()
    await writer.write(JSON.stringify(fixture.project))
    await writer.close()
    return fixture
  }, url)
  const saved = () => page.evaluate(async (name) => {
    const directory = await (await navigator.storage.getDirectory()).getDirectoryHandle(name)
    return JSON.parse(await (await (await directory.getFileHandle('project.json')).getFile()).text()) as import('../../app/types/editor').FolderProjectDocument
  }, fixture.name)
  async function save() {
    await page.getByRole('button', { name: 'プロジェクト保存', exact: true }).click()
    await expect(page.locator('.project-operation-status')).toHaveCount(0)
    await expect(page.locator('.save-status')).toHaveText('保存済み')
  }
  try {
    await page.getByRole('button', { name: 'プロジェクトを開く／作成', exact: true }).click()
    await page.getByRole('button', { name: 'アイコン検出', exact: true }).click()
    await page.getByRole('button', { name: '領域検出へ', exact: true }).click()
    const targets = page.getByRole('region', { name: '領域検出・OCR', exact: true })
    await expect(targets).toBeVisible()
    await page.locator('.card-list-panel').getByRole('combobox', { name: 'カードの選択条件' }).selectOption('uncreated')
    await expect(page.locator('.card-list-panel').getByRole('checkbox', { name: /one.png/ })).not.toBeChecked()
    await expect(page.locator('.card-list-panel').getByRole('checkbox', { name: /two.png/ })).toBeChecked()
    await targets.screenshot({ path: testInfo.outputPath('target-cards.png') })
    await targets.getByRole('button', { name: '1枚の領域を検出', exact: true }).click()
    await expect(page.getByRole('region', { name: 'OCR結果', exact: true })).toBeVisible()
    await targets.getByRole('button', { name: '表示中の候補をすべて選択', exact: true }).click()
    await targets.getByRole('button', { name: /選択した候補を追加/ }).click()
    await expect(page.getByRole('region', { name: 'OCR結果', exact: true })).toBeVisible({ timeout: 45000 })
    await expect(page.getByRole('dialog', { name: '領域検出・アイコン反映', exact: true })).toHaveCount(0)
    await save()
    const firstPass = await saved()
    expect(firstPass.cards[0]!.regions).toEqual(fixture.project.cards[0]!.regions)
    expect(firstPass.cards[1]!.regions[0]!.originalText).toContain('[icon:token]')
    expect(firstPass.cards[1]!.regions[0]!.lastOcrText).toBe(firstPass.cards[1]!.regions[0]!.originalText)

    // 旧データの原文は、単一カードへの再反映でも上書きしない。
    await reocrCurrent(page)
    await expect(page.getByRole('region', { name: 'OCR結果', exact: true })).toContainText('原文保護で保留 1枚')
    const results = page.getByRole('region', { name: '領域検出・OCR', exact: true })
    await expect(results).toContainText('OCR履歴がないため、原文を保護しました')
    await expect(results).toContainText('現在の内容を使う場合は操作不要')
    await expect(results.locator('.existing-region .candidate-text')).toContainText('Keep the source text.')
    await results.screenshot({ path: testInfo.outputPath('protected-text-result.png') })
    await results.getByRole('button', { name: 'OCR結果と比較', exact: true }).click()
    await expect(results).toBeHidden()
    const preview = page.getByRole('dialog', { name: 'OCR結果の比較', exact: true })
    await preview.getByRole('button', { name: '変更後の原文を読み取る', exact: true }).click()
    await expect(preview.locator('.proposed-text')).toContainText('[icon:token]', { timeout: 45000 })
    await expect(preview.getByRole('checkbox')).toBeChecked()
    await preview.getByRole('button', { name: '選択した領域へ位置と原文を反映', exact: true }).click()
    await expect(preview.getByRole('status')).toContainText('反映しました')
    await preview.getByRole('button', { name: '閉じる', exact: true }).click()
    await save()
    expect((await saved()).cards[0]!.regions[0]!.lastOcrText).toContain('[icon:token]')

    await page.getByRole('button', { name: 'OCR結果に戻る', exact: true }).click()
    await expect(results).toBeVisible()
    await results.getByRole('button', { name: 'この領域を編集', exact: true }).click()

    // 手修正を保存・再読込しても保護する。要確認からその領域へ移動できる。
    await page.getByRole('tab', { name: '領域一覧', exact: true }).click()
    await page.locator('.region-list-select').first().click()
    await page.locator('#inspector-tab-text').click()
    await page.getByLabel('元テキスト', { exact: true }).fill('Corrected [icon:token] source')
    await page.getByLabel('元テキスト', { exact: true }).press('Tab')
    await save()
    await page.reload()
    await page.evaluate(async (name) => {
      const directory = await (await navigator.storage.getDirectory()).getDirectoryHandle(name)
      Object.assign(window, { showDirectoryPicker: async () => directory })
    }, fixture.name)
    await page.getByRole('button', { name: 'プロジェクトを開く／作成', exact: true }).click()
    await reocrCurrent(page)
    await expect(results).toContainText('編集済みの原文を保護しました')
    await results.getByRole('button', { name: 'この領域を編集', exact: true }).click()
    await expect(results).toBeHidden()
    await expect(page.getByLabel('元テキスト', { exact: true })).toHaveValue('Corrected [icon:token] source')
    await page.locator('.card-list-panel').screenshot({ path: testInfo.outputPath('protected-text-issue.png') })
    await save()
    expect((await saved()).cards[0]!.regions[0]!.originalText).toBe('Corrected [icon:token] source')
    expect((await saved()).cards[1]!.regions).toEqual(firstPass.cards[1]!.regions)
    // 読み込めないカードも同じ一覧に残し、保留と処理失敗を区別する。
    await page.evaluate(async (name) => {
      const directory = await (await navigator.storage.getDirectory()).getDirectoryHandle(name)
      await (await directory.getDirectoryHandle('images')).removeEntry('two.png')
    }, fixture.name)
    await page.getByRole('button', { name: 'まとめて再OCR', exact: true }).click()
    await page.getByRole('combobox', { name: 'カードの選択条件' }).selectOption('all')
    await targets.getByRole('button', { name: '2枚を再OCR', exact: true }).click()
    await expect(targets.getByRole('region', { name: 'OCR結果', exact: true })).toContainText('処理完了 1枚 ／ 失敗 1枚 ／ 原文保護で保留 1枚')
    const failedCard = targets.locator('.candidate-card').filter({ has: page.getByRole('heading', { name: 'two.png', exact: true }) })
    await expect(failedCard.locator('.card-status')).toContainText('処理失敗')
    await expect(failedCard.locator('.card-issues li')).toHaveCount(1)
    await expect(failedCard.locator('.existing-region')).toHaveCount(1)
    expect(errors).toEqual([])
  }
  finally {
    await page.evaluate(async name => (await navigator.storage.getDirectory()).removeEntry(name, { recursive: true }), fixture.name)
  }
})

test('a single-card project can repair the exact unassigned occurrence from an apply issue', async ({ page }, testInfo) => {
  await page.goto('/cards')
  await expect(page.getByRole('button', { name: 'プロジェクトを開く／作成', exact: true })).toBeVisible()
  const url = `/_nuxt/@fs${fileURLToPath(new URL('./helpers/discovery-ui-project.ts', import.meta.url))}`
  const fixture = await page.evaluate(async (url) => {
    const { prepareIconRegionUIProject } = await import(/* @vite-ignore */ url) as typeof import('./helpers/discovery-ui-project')
    const fixture = await prepareIconRegionUIProject()
    fixture.project.cards.splice(1)
    fixture.project.assetDiscovery!.occurrences[0]!.assetId = null
    const directory = await (await navigator.storage.getDirectory()).getDirectoryHandle(fixture.name)
    const writer = await (await directory.getFileHandle('project.json')).createWritable()
    await writer.write(JSON.stringify(fixture.project))
    await writer.close()
    return fixture
  }, url)
  try {
    await page.getByRole('button', { name: 'プロジェクトを開く／作成', exact: true }).click()
    await reocrCurrent(page)
    const results = page.getByRole('region', { name: '領域検出・OCR', exact: true })
    await expect(results).toContainText('処理上の問題 1枚')
    await expect(results.locator('.card-issues li')).toHaveCount(1)
    await results.getByRole('button', { name: 'アイコン候補を調整', exact: true }).click()
    await expect(results).toBeHidden()
    const workspace = page.getByRole('region', { name: 'アイコン検出', exact: true })
    await expect(workspace.getByRole('img', { name: 'アイコン候補と周辺の元画像', exact: true })).toBeVisible()
    await expect(workspace.getByLabel('グループ名', { exact: true })).toHaveValue('グループ1')
    await expect(workspace.getByText('登録済みのアイコンを使う・変更する', { exact: true })).toBeVisible()
    await expect(workspace.locator('.existing-asset')).toHaveAttribute('open')
    await workspace.getByLabel('グループに関連付けるアイコン', { exact: true }).selectOption('token')
    await workspace.getByRole('button', { name: 'グループ全体に関連付け', exact: true }).click()
    await workspace.screenshot({ path: testInfo.outputPath('focused-icon-repair.png') })
    await page.getByRole('button', { name: 'カード', exact: true }).click()
    await reocrCurrent(page)
    await expect(results.getByRole('button', { name: 'OCR結果と比較', exact: true })).toBeVisible()
    await expect(results.getByRole('button', { name: 'アイコン候補を調整', exact: true })).toHaveCount(0)
  }
  finally {
    await page.evaluate(async name => (await navigator.storage.getDirectory()).removeEntry(name, { recursive: true }), fixture.name)
  }
})

test('37 cards show a concrete plan and 29 protected cards are distinct from detection errors', async ({ page }, testInfo) => {
  test.setTimeout(90000)
  await page.setViewportSize({ width: 1280, height: 900 })
  await page.goto('/cards')
  await expect(page.getByRole('button', { name: 'プロジェクトを開く／作成', exact: true })).toBeVisible()
  const url = `/_nuxt/@fs${fileURLToPath(new URL('./helpers/discovery-ui-project.ts', import.meta.url))}`
  const fixture = await page.evaluate(async (url) => {
    const { prepareIconRegionUIProject } = await import(/* @vite-ignore */ url) as typeof import('./helpers/discovery-ui-project')
    const fixture = await prepareIconRegionUIProject()
    const { project } = fixture
    const base = project.cards[0]!
    const directory = await (await navigator.storage.getDirectory()).getDirectoryHandle(fixture.name)
    const images = await directory.getDirectoryHandle('images')
    const png = await (await images.getFileHandle('one.png')).getFile()
    project.cards = Array.from({ length: 37 }, (_, index) => {
      const id = `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`
      return { ...structuredClone(base), id, imageName: `${id}.png`, imagePath: `images/${id}.png` }
    })
    project.activeCardId = project.cards[0]!.id
    const occurrence = project.assetDiscovery!.occurrences[0]!
    project.assetDiscovery!.occurrences = project.cards.slice(0, 29).map((card, index) => ({ ...structuredClone(occurrence), id: `icon-${index}`, cardId: card.id }))
    project.assetDiscovery!.groups[0]!.memberIds = project.assetDiscovery!.occurrences.map(item => item.id)
    project.assetDiscovery!.groups[0]!.representativeId = 'icon-0'
    project.assets[0]!.sourceImageId = project.activeCardId
    for (const [index, card] of project.cards.entries()) {
      if (index >= 29)
        card.regions[0]!.lastOcrText = card.regions[0]!.originalText
      const writer = await (await images.getFileHandle(card.imageName, { create: true })).createWritable()
      await writer.write(png)
      await writer.close()
    }
    const writer = await (await directory.getFileHandle('project.json')).createWritable()
    await writer.write(JSON.stringify(project))
    await writer.close()
    return { name: fixture.name }
  }, url)
  try {
    await page.getByRole('button', { name: 'プロジェクトを開く／作成', exact: true }).click()
    await page.getByRole('button', { name: 'まとめて再OCR', exact: true }).click()
    const targets = page.getByRole('region', { name: '領域検出・OCR', exact: true })
    await page.locator('.card-list-panel').getByRole('combobox', { name: 'カードの選択条件' }).selectOption('all')
    await expect(page.locator('.batch-card-check input')).toHaveCount(37)
    await expect(targets.locator('.plan-summary')).toContainText('設定済みの領域 37か所')
    await expect(targets.locator('.plan-summary')).toContainText('使うアイコン 29個')
    await expect(targets.locator('.batch-card-preview img').first()).toBeVisible()
    await targets.screenshot({ path: testInfo.outputPath('37-card-plan.png') })
    await targets.getByRole('button', { name: '37枚を再OCR', exact: true }).click()
    await expect(page.getByRole('region', { name: 'OCR結果', exact: true })).toBeVisible({ timeout: 45000 })
    await expect(page.getByRole('region', { name: '領域検出・OCR', exact: true })).toContainText('原文保護で保留 29枚')
    await page.getByRole('button', { name: 'カード編集に戻る', exact: true }).click()
    await expect(page.locator('.card-list-panel')).not.toContainText('原文保護で保留 29枚')
    await expect(page.locator('.card-list-panel')).not.toContainText('検出・対応付けの問題')
    await expect(page.locator('.card-list-panel')).not.toContainText('OCR履歴がないため')
    await expect(page.locator('.card-list-panel ol')).not.toContainText('反映済み')
    await expect(page.locator('.card-list-select .card-ocr-state')).toHaveCount(29)
    await expect(page.locator('.card-list-select .card-ocr-state').first()).toHaveText('要確認 1件')
    await expect(page.locator('.card-list-select .card-progress')).toHaveCount(8)
    for (const [width, fontSize] of [[1280, 16], [1024, 20]] as const) {
      await page.setViewportSize({ width, height: 900 })
      await page.evaluate(size => document.documentElement.style.fontSize = `${size}px`, fontSize)
      const overflow = await page.locator('.card-list-select').evaluateAll(cards => cards.flatMap((card) => {
        const text = card.querySelector('.card-list-text')!
        const bounds = text.getBoundingClientRect()
        return [...text.querySelectorAll('strong, .card-ocr-state, .card-progress small')].filter((element) => {
          const rect = element.getBoundingClientRect()
          return rect.left < bounds.left - 1 || rect.right > bounds.right + 1
            || (element.matches('small') && element.scrollWidth > element.clientWidth + 1)
        }).map(element => element.textContent)
      }))
      expect(overflow, `card labels fit at ${width}px with ${fontSize}px text`).toEqual([])
      await page.locator('.card-list-item').first().scrollIntoViewIfNeeded()
      await page.locator('.card-list-panel').screenshot({ path: testInfo.outputPath(`card-list-${width}-${fontSize}.png`) })
    }
    await page.evaluate(() => document.documentElement.style.removeProperty('font-size'))
    await page.setViewportSize({ width: 1280, height: 900 })
    await page.getByRole('button', { name: 'まとめて再OCR', exact: true }).click()
    await page.getByRole('button', { name: 'OCR結果', exact: true }).click()
    const results = page.getByRole('region', { name: '領域検出・OCR', exact: true })
    await expect(results.locator('.candidate-card')).toHaveCount(37)
    await expect(results.locator('.card-issues')).toHaveCount(29)
    await expect(results).toContainText('原文保護で保留 29枚')
    expect(await results.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true)
    await results.screenshot({ path: testInfo.outputPath('29-card-results.png') })
    await expect(results.getByRole('combobox')).toHaveCount(0)
    await results.locator('.candidate-card').filter({ has: page.getByRole('list', { name: 'このカードの確認事項' }) }).last().getByRole('button', { name: 'この領域を編集', exact: true }).click()
    await expect(results).toBeHidden()
    await expect(page.getByLabel('元テキスト', { exact: true })).toHaveValue('Keep the source text.')
  }
  finally {
    await page.evaluate(async name => (await navigator.storage.getDirectory()).removeEntry(name, { recursive: true }), fixture.name)
  }
})
