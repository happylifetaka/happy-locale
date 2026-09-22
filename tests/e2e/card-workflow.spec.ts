import { fileURLToPath } from 'node:url'
import { expect, test } from '@playwright/test'

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
    await page.getByRole('button', { name: 'アセット検出', exact: true }).click()
    await page.getByRole('button', { name: '次へ：領域検出・アイコン反映', exact: true }).click()
    const targets = page.getByRole('dialog', { name: '領域・アイコンを反映', exact: true })
    await expect(targets).toBeVisible()
    await targets.getByRole('button', { name: '領域未作成のみ', exact: true }).click()
    await expect(targets.getByRole('checkbox', { name: /one.png/ })).not.toBeChecked()
    await expect(targets.getByRole('checkbox', { name: /two.png/ })).toBeChecked()
    await targets.screenshot({ path: testInfo.outputPath('target-cards.png') })
    await targets.getByRole('button', { name: '選択した1枚に反映', exact: true }).click()
    await expect(page.getByText('1/1枚処理済み', { exact: true })).toBeVisible({ timeout: 45000 })
    await expect(page.getByRole('dialog', { name: '領域検出・アイコン反映', exact: true })).toHaveCount(0)
    await save()
    const firstPass = await saved()
    expect(firstPass.cards[0]!.regions).toEqual(fixture.project.cards[0]!.regions)
    expect(firstPass.cards[1]!.regions[0]!.originalText).toContain('[icon:token]')
    expect(firstPass.cards[1]!.regions[0]!.lastOcrText).toBe(firstPass.cards[1]!.regions[0]!.originalText)

    // 旧データの原文は、単一カードへの再反映でも上書きしない。
    await page.getByRole('button', { name: 'このカードに反映', exact: true }).click()
    await expect(page.getByText('原文保護で保留 1枚', { exact: true })).toBeVisible()
    await page.getByRole('button', { name: '未反映の内容を確認', exact: true }).click()
    const results = page.getByRole('dialog', { name: '未反映の内容', exact: true })
    await expect(results).toContainText('OCR履歴がないため、原文を保護しました')
    await expect(results).toContainText('現在の内容を使うなら操作不要')
    await expect(results.locator('blockquote')).toContainText('Keep the source text.')
    await results.screenshot({ path: testInfo.outputPath('protected-text-result.png') })
    await results.getByRole('button', { name: '変更案を比較', exact: true }).click()
    await expect(results).toHaveCount(0)
    const preview = page.getByRole('dialog', { name: '領域検出・アイコン反映', exact: true })
    await preview.getByRole('button', { name: '領域とアイコンを解析', exact: true }).click()
    await expect(preview.locator('.proposed-text')).toContainText('[icon:token]', { timeout: 45000 })
    await expect(preview.getByRole('checkbox')).toBeChecked()
    await preview.getByRole('button', { name: '選択した領域へ位置と原文を反映', exact: true }).click()
    await expect(preview.getByRole('status')).toContainText('反映しました')
    await preview.getByRole('button', { name: '閉じる', exact: true }).click()
    await save()
    expect((await saved()).cards[0]!.regions[0]!.lastOcrText).toContain('[icon:token]')

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
    await page.getByRole('button', { name: 'このカードに反映', exact: true }).click()
    await page.getByRole('button', { name: '未反映の内容を確認', exact: true }).click()
    await expect(results).toContainText('編集済みの原文を保護しました')
    await results.getByRole('button', { name: '現在の領域を開く', exact: true }).click()
    await expect(results).toHaveCount(0)
    await expect(page.getByLabel('元テキスト', { exact: true })).toHaveValue('Corrected [icon:token] source')
    await page.locator('.card-list-panel').screenshot({ path: testInfo.outputPath('protected-text-issue.png') })
    await save()
    expect((await saved()).cards[0]!.regions[0]!.originalText).toBe('Corrected [icon:token] source')
    expect((await saved()).cards[1]!.regions).toEqual(firstPass.cards[1]!.regions)
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
    await page.getByRole('button', { name: 'このカードに反映', exact: true }).click()
    await page.getByRole('button', { name: '未反映の内容を確認', exact: true }).click()
    const results = page.getByRole('dialog', { name: '未反映の内容', exact: true })
    await expect(results).toContainText('検出・対応付けの問題 1枚')
    await expect(results.locator('.issue-row')).toHaveCount(1)
    await results.getByRole('button', { name: 'アイコン候補を調整', exact: true }).click()
    await expect(results).toHaveCount(0)
    const workspace = page.getByRole('region', { name: 'アセット検出', exact: true })
    await expect(workspace.getByRole('img', { name: 'アイコン候補と周辺の元画像', exact: true })).toBeVisible()
    await expect(workspace.getByLabel('グループ名', { exact: true })).toHaveValue('グループ1')
    await workspace.getByLabel('グループに関連付けるアセット', { exact: true }).selectOption('token')
    await workspace.getByRole('button', { name: 'グループ全体に関連付け', exact: true }).click()
    await workspace.screenshot({ path: testInfo.outputPath('focused-icon-repair.png') })
    await page.getByRole('button', { name: 'カード', exact: true }).click()
    await page.getByRole('button', { name: 'このカードに反映', exact: true }).click()
    await page.getByRole('button', { name: '未反映の内容を確認', exact: true }).click()
    await expect(results.getByRole('button', { name: '変更案を比較', exact: true })).toBeVisible()
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
    for (const card of project.cards) {
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
    await page.getByRole('button', { name: 'まとめて領域検出', exact: true }).click()
    const targets = page.getByRole('dialog', { name: '領域・アイコンを反映', exact: true })
    await targets.getByRole('button', { name: 'すべて', exact: true }).click()
    await expect(targets.getByRole('checkbox')).toHaveCount(37)
    await expect(targets.locator('.plan-summary')).toContainText('既存領域 37件を使用')
    await expect(targets.locator('.plan-summary')).toContainText('割当済みアイコン 29個を照合')
    await expect(targets.locator('fieldset img').first()).toBeVisible()
    await targets.screenshot({ path: testInfo.outputPath('37-card-plan.png') })
    await targets.getByRole('button', { name: '選択した37枚に反映', exact: true }).click()
    await expect(page.getByText('37/37枚処理済み', { exact: true })).toBeVisible({ timeout: 45000 })
    await expect(page.locator('.card-list-panel')).toContainText('原文保護で保留 29枚')
    await expect(page.locator('.card-list-panel')).not.toContainText('検出・対応付けの問題')
    await expect(page.locator('.card-list-panel')).not.toContainText('OCR履歴がないため')
    await page.getByRole('button', { name: '未反映の内容を確認', exact: true }).click()
    const results = page.getByRole('dialog', { name: '未反映の内容', exact: true })
    await expect(results.locator('.card-result')).toHaveCount(29)
    await expect(results).toContainText('原文保護で保留 29枚')
    expect(await results.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true)
    await results.screenshot({ path: testInfo.outputPath('29-card-results.png') })
    await results.getByLabel('表示', { exact: true }).selectOption('problem')
    await expect(results).toContainText('この分類の未反映項目はありません')
    await results.getByLabel('表示', { exact: true }).selectOption('protected')
    await results.getByRole('button', { name: '現在の領域を開く', exact: true }).last().click()
    await expect(results).toHaveCount(0)
    await expect(page.getByLabel('元テキスト', { exact: true })).toHaveValue('Keep the source text.')
  }
  finally {
    await page.evaluate(async name => (await navigator.storage.getDirectory()).removeEntry(name, { recursive: true }), fixture.name)
  }
})
