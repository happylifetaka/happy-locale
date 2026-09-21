import { fileURLToPath } from 'node:url'
import { expect, test } from '@playwright/test'

test('visually compares new and changed icons and adopts only checked proposals', async ({ page }, testInfo) => {
  await page.goto('/cards')
  await expect(page.getByRole('button', { name: 'プロジェクトを開く／作成', exact: true })).toBeVisible()
  const url = `/_nuxt/@fs${fileURLToPath(new URL('./helpers/discovery-ui-project.ts', import.meta.url))}`
  const fixture = await page.evaluate(async (url) => {
    const { prepareIconRegionUIProject } = await import(/* @vite-ignore */ url) as typeof import('./helpers/discovery-ui-project')
    return prepareIconRegionUIProject()
  }, url)
  try {
    await page.getByRole('button', { name: 'プロジェクトを開く／作成', exact: true }).click()
    await page.getByRole('button', { name: 'アセット検出', exact: true }).click()
    const workspace = page.getByRole('region', { name: 'アセット検出', exact: true })
    await workspace.getByText('収集するカードを選ぶ', { exact: true }).click()
    await workspace.getByLabel('アイコン候補を収集する（追加のOCRを実行）').check()
    await workspace.getByRole('button', { name: '選択したカードから収集', exact: true }).click()
    await expect(workspace.getByText(/収集完了：新規0枚、比較待ち1枚/)).toBeVisible({ timeout: 30000 })
    await workspace.getByRole('button', { name: 'one.pngの案を比較', exact: true }).click()
    const comparison = workspace.getByRole('region', { name: '再収集候補の画像比較', exact: true })
    const changed = comparison.locator('.difference').filter({ hasText: '枠の変更' })
    const added = comparison.locator('.difference').filter({ hasText: '新しい候補' })
    await expect(changed).toHaveCount(1)
    await expect(added).toHaveCount(1)
    await changed.scrollIntoViewIfNeeded()
    await expect(changed.locator('.snapshot img')).toHaveCount(2)
    await added.scrollIntoViewIfNeeded()
    await expect(added.locator('.snapshot img')).toHaveCount(1)
    await changed.getByRole('button', { name: '位置と枠を確認', exact: true }).click()
    await expect(changed.locator('.change-summary')).toContainText('px拡張')
    await comparison.screenshot({ path: testInfo.outputPath('changed-and-new-comparison.png') })
    await added.getByRole('button', { name: '位置と枠を確認', exact: true }).click()
    await expect(changed.locator('svg')).toHaveCount(0)
    await page.setViewportSize({ width: 500, height: 900 })
    await expect(added.getByRole('img', { name: '候補周辺の拡大比較', exact: true })).toBeVisible()
    expect(await comparison.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true)
    await added.screenshot({ path: testInfo.outputPath('new-comparison-narrow.png') })
    await page.setViewportSize({ width: 1440, height: 1000 })
    await added.getByRole('checkbox').check()
    await workspace.getByRole('button', { name: '選択した再収集案を採用', exact: true }).click()
    await expect(comparison).toHaveCount(0)
    await expect(workspace.locator('.occurrence')).toHaveCount(2)
    await page.getByRole('button', { name: 'プロジェクト保存', exact: true }).click()
    const saved = () => page.evaluate(async (name) => {
      const directory = await (await navigator.storage.getDirectory()).getDirectoryHandle(name)
      return JSON.parse(await (await (await directory.getFileHandle('project.json')).getFile()).text()) as import('../../app/types/editor').FolderProjectDocument
    }, fixture.name)
    await expect.poll(async () => (await saved()).assetDiscovery!.occurrences.length).toBe(2)
    const result = await saved()
    expect(result.assetDiscovery!.occurrences[0]).toEqual(fixture.project.assetDiscovery!.occurrences[0])
    expect(result.assetDiscovery!.occurrences[1]!.assetId).toBeNull()
    expect(result.cards).toEqual(fixture.project.cards)
    expect(result.assetDiscovery!.groups).toEqual(fixture.project.assetDiscovery!.groups)
  }
  finally {
    await page.evaluate(async (name) => {
      await (await navigator.storage.getDirectory()).removeEntry(name, { recursive: true })
    }, fixture.name)
  }
})

test('keeps legacy approval data while omitting approval controls and badges', async ({ page }) => {
  await page.goto('/cards')
  await expect(page.getByRole('button', { name: 'プロジェクトを開く／作成', exact: true })).toBeVisible()
  const url = `/_nuxt/@fs${fileURLToPath(new URL('./helpers/discovery-ui-project.ts', import.meta.url))}`
  const fixture = await page.evaluate(async (url) => {
    const { prepareIconRegionUIProject } = await import(/* @vite-ignore */ url) as typeof import('./helpers/discovery-ui-project')
    const fixture = await prepareIconRegionUIProject()
    const dir = await (await navigator.storage.getDirectory()).getDirectoryHandle(fixture.name)
    const png = await (await (await dir.getDirectoryHandle('assets')).getFileHandle('token.png')).getFile()
    const assetDigest = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', await png.arrayBuffer())), byte => byte.toString(16).padStart(2, '0')).join('')
    const occurrence = fixture.project.assetDiscovery!.occurrences[0]!
    occurrence.decision = 'accepted'
    occurrence.approval = { imageDigest: occurrence.imageDigest, assetDigest, assetId: occurrence.assetId!, bounds: { ...occurrence.bounds } }
    const writer = await (await dir.getFileHandle('project.json')).createWritable()
    await writer.write(JSON.stringify(fixture.project))
    await writer.close()
    return fixture
  }, url)
  try {
    await page.getByRole('button', { name: 'プロジェクトを開く／作成', exact: true }).click()
    await page.getByRole('button', { name: 'アセット検出', exact: true }).click()
    const dialog = page.getByRole('region', { name: 'アセット検出', exact: true })
    await dialog.locator('.occurrence button').first().click()
    await expect(dialog.getByRole('button', { name: /承認/ })).toHaveCount(0)
    await expect(dialog.locator('.occurrence button')).toContainText('候補')
    await expect(dialog.locator('.occurrence button')).not.toContainText('承認済み')
    await dialog.locator('.group-list button').first().click()
    await dialog.getByLabel('グループ名', { exact: true }).fill('Legacy group preserved')
    await dialog.getByLabel('グループ名', { exact: true }).press('Tab')
    fixture.project.assetDiscovery!.groups[0]!.name = 'Legacy group preserved'
    await page.getByRole('button', { name: 'プロジェクト保存', exact: true }).click()
    await expect.poll(() => page.evaluate(async (name) => {
      const dir = await (await navigator.storage.getDirectory()).getDirectoryHandle(name)
      return JSON.parse(await (await (await dir.getFileHandle('project.json')).getFile()).text()).assetDiscovery
    }, fixture.name)).toEqual(fixture.project.assetDiscovery)
  }
  finally {
    await page.evaluate(async (name) => {
      await (await navigator.storage.getDirectory()).removeEntry(name, { recursive: true })
    }, fixture.name)
  }
})

test('all 32 groups are reachable and share editable human-readable names', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1280, height: 800 })
  await page.goto('/cards')
  const moduleUrl = `/_nuxt/@fs${fileURLToPath(new URL('./helpers/discovery-ui-project.ts', import.meta.url))}`
  const fixture = await page.evaluate(async (url) => {
    const { prepareDiscoveryUIProject } = await import(/* @vite-ignore */ url) as typeof import('./helpers/discovery-ui-project')
    return prepareDiscoveryUIProject(32)
  }, moduleUrl)
  try {
    await page.getByRole('button', { name: 'プロジェクトを開く／作成', exact: true }).click()
    await page.getByRole('button', { name: 'アセット検出', exact: true }).click()
    const dialog = page.getByRole('region', { name: 'アセット検出', exact: true })
    const list = dialog.locator('.group-list')
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'アセット検出', exact: true })).toHaveAttribute('aria-pressed', 'true')
    await page.keyboard.press('Escape')
    await expect(dialog).toBeVisible()
    await expect(dialog.getByRole('heading', { name: 'グループ（32）', exact: true })).toBeVisible()
    await expect(dialog.getByRole('navigation', { name: 'グループのページ' })).toHaveCount(0)
    await expect(list.getByRole('button')).toHaveCount(32)
    await expect(dialog.getByLabel('候補の移動先').locator('option')).toHaveText([
      '移動先グループを選択',
      '新しいグループへ分ける',
      '未分類に戻す',
      ...Array.from({ length: 32 }, (_, index) => `グループ${index + 1}へ統合・移動`),
    ])
    const selectAll = dialog.getByRole('checkbox', { name: /すべて選択/ })
    await selectAll.check()
    await expect(dialog.getByRole('button', { name: '選択32件を移動', exact: true })).toBeDisabled()
    await dialog.getByLabel('候補の移動先').selectOption('internal-0')
    await expect(dialog.getByRole('button', { name: '選択32件を移動', exact: true })).toBeEnabled()
    await dialog.getByRole('navigation', { name: '候補のページ', exact: true }).getByRole('button', { name: '次へ', exact: true }).click()
    await expect(dialog.locator('.occurrence input:checked')).toHaveCount(8)
    await dialog.locator('.occurrence input').first().uncheck()
    await expect(selectAll).toHaveJSProperty('indeterminate', true)
    await selectAll.check()
    await selectAll.uncheck()
    await expect(dialog.locator('.occurrence input:checked')).toHaveCount(0)
    for (let number = 1; number <= 32; number++) {
      await list.getByRole('button', { name: new RegExp(`^グループ${number}：`) }).click()
      await expect(dialog.getByLabel('グループ名', { exact: true })).toHaveValue(`グループ${number}`)
      await expect(selectAll).not.toBeChecked()
    }
    const name = dialog.getByLabel('グループ名', { exact: true })
    await name.fill('防御アイコン')
    await name.press('Tab')
    await expect(list.getByRole('button', { name: /^防御アイコン：/ })).toBeVisible()
    await expect(dialog.getByLabel('候補の移動先').locator('option[value="internal-31"]')).toHaveText('防御アイコンへ統合・移動')
    await dialog.getByRole('button', { name: '候補編集を戻す', exact: true }).click()
    await expect(name).toHaveValue('グループ32')
    await dialog.getByRole('button', { name: '候補編集をやり直す', exact: true }).click()
    await expect(name).toHaveValue('防御アイコン')
    await selectAll.check()
    await page.getByRole('button', { name: 'アセット編集', exact: true }).click()
    await expect(dialog).toBeHidden()
    await page.getByRole('button', { name: 'カード', exact: true }).click()
    await expect(page.getByLabel('カード編集キャンバス')).toBeVisible()
    await page.getByRole('button', { name: 'アセット検出', exact: true }).click()
    await expect(name).toHaveValue('防御アイコン')
    await expect(list.getByRole('button')).toHaveCount(32)
    await expect(selectAll).toBeChecked()
    await page.screenshot({ path: testInfo.outputPath('asset-detection-workspace.png') })
    await page.setViewportSize({ width: 800, height: 900 })
    await expect(dialog).toBeVisible()
    await expect(page.getByRole('button', { name: 'アセット検出', exact: true })).toBeVisible()
    expect(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true)
    await dialog.evaluate(element => element.scrollTop = 0)
    await page.screenshot({ path: testInfo.outputPath('asset-detection-narrow.png') })
    await page.setViewportSize({ width: 1280, height: 800 })
    await expect(dialog.getByRole('button', { name: '選択1件を移動', exact: true })).toBeVisible()
    await dialog.locator('.occurrence button').first().click()
    await dialog.getByRole('button', { name: '複数のアイコンを2候補に分割', exact: true }).click()
    await dialog.getByRole('button', { name: '分割をキャンセル', exact: true }).click()
    await expect(dialog.locator('.occurrence')).toHaveCount(1)
    await dialog.getByRole('button', { name: '複数のアイコンを2候補に分割', exact: true }).click()
    await dialog.getByLabel('分割方向', { exact: true }).selectOption('vertical')
    await dialog.getByLabel('分割位置', { exact: true }).focus()
    await dialog.getByLabel('分割位置', { exact: true }).press('ArrowRight')
    await expect(dialog.locator('.bounds-editor svg rect')).toHaveCount(2)
    await dialog.locator('.bounds-editor').screenshot({ path: testInfo.outputPath('split-preview.png') })
    await dialog.getByRole('button', { name: '2候補への分割を確定', exact: true }).click()
    await expect(dialog.getByText(/2つの未分類候補に分割しました/)).toBeVisible()
    await expect(dialog.locator('.occurrence')).toHaveCount(2)
    await expect(dialog.locator('.occurrence button')).toContainText(['候補', '候補'])
    await expect(dialog.locator('.occurrence button')).toContainText(['アセット未割当', 'アセット未割当'])
    await dialog.getByRole('button', { name: '候補編集を戻す', exact: true }).click()
    await expect(dialog.locator('.occurrence')).toHaveCount(0)
    await expect(dialog.getByRole('heading', { name: 'グループ（32）', exact: true })).toBeVisible()
    await dialog.screenshot({ path: testInfo.outputPath('32-groups.png') })
    await page.getByRole('button', { name: 'プロジェクト保存', exact: true }).click()
    await expect.poll(() => page.evaluate(async (folder) => {
      const directory = await (await navigator.storage.getDirectory()).getDirectoryHandle(folder)
      const saved = JSON.parse(await (await (await directory.getFileHandle('project.json')).getFile()).text())
      return saved.assetDiscovery?.groups[31]
    }, fixture.name)).toMatchObject({ id: 'internal-31', name: '防御アイコン' })
  }
  finally {
    await page.evaluate(async (name) => {
      await (await navigator.storage.getDirectory()).removeEntry(name, { recursive: true })
    }, fixture.name)
  }
})

test('collects, reviews, registers and saves icons through the ordinary UI without editing original text', async ({ page }, testInfo) => {
  test.setTimeout(90000)
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
  const moduleUrl = `/_nuxt/@fs${fileURLToPath(new URL('./helpers/discovery-ui-project.ts', import.meta.url))}`
  const fixture = await page.evaluate(async (url) => {
    const { prepareDiscoveryUIProject } = await import(/* @vite-ignore */ url) as typeof import('./helpers/discovery-ui-project')
    return prepareDiscoveryUIProject()
  }, moduleUrl)
  const readSaved = () => page.evaluate(async (name) => {
    const directory = await (await navigator.storage.getDirectory()).getDirectoryHandle(name)
    return JSON.parse(await (await (await directory.getFileHandle('project.json')).getFile()).text()) as import('../../app/types/editor').FolderProjectDocument
  }, fixture.name)
  try {
    await page.getByRole('button', { name: 'プロジェクトを開く／作成', exact: true }).click()
    await expect(page.getByLabel('カード編集キャンバス')).toBeVisible()
    async function openReview() {
      await page.getByRole('button', { name: 'アセット検出', exact: true }).click()
    }
    await openReview()
    const dialog = page.getByRole('region', { name: 'アセット検出', exact: true })
    await expect(dialog).toBeVisible()
    const collect = dialog.getByRole('button', { name: '選択したカードから収集', exact: true })
    await expect(collect).toBeDisabled()
    await dialog.getByRole('button', { name: 'すべて対象にする', exact: true }).click()
    await dialog.getByLabel('アイコン候補を収集する（追加のOCRを実行）').check()
    await collect.click()
    await expect(dialog.getByText(/収集完了：新規2枚、比較待ち0枚/)).toBeVisible({ timeout: 30000 })
    await expect(dialog.locator('.occurrence')).toHaveCount(4)
    await expect(dialog.getByRole('heading', { name: 'グループ（2）', exact: true })).toBeVisible()
    await dialog.locator('.occurrence button').filter({ hasText: 'two.png' }).first().click()
    await expect(dialog.getByRole('spinbutton', { name: '候補の幅', exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'アセット検出', exact: true })).toHaveAttribute('aria-pressed', 'true')
    await dialog.locator('.occurrence button').filter({ hasText: 'one.png' }).first().click()
    const width = dialog.getByRole('spinbutton', { name: '候補の幅', exact: true })
    const originalWidth = Number(await width.inputValue())
    await width.fill(String(originalWidth + 1))
    await dialog.getByRole('button', { name: '範囲の変更を保存', exact: true }).click()
    await dialog.getByRole('button', { name: '候補編集を戻す', exact: true }).click()
    await expect(width).toHaveValue(String(originalWidth))
    await dialog.getByRole('button', { name: '誤検出として除外', exact: true }).click()
    await expect(dialog.getByRole('button', { name: '除外を取り消す', exact: true })).toBeVisible()
    await dialog.getByRole('button', { name: '候補編集を戻す', exact: true }).click()
    await dialog.getByRole('button', { name: /の名前を編集$/ }).click()
    await dialog.getByLabel('グループ名', { exact: true }).fill('Shared token')
    await dialog.getByLabel('グループ名', { exact: true }).press('Tab')
    await expect(dialog.getByLabel('関連付けるアセット', { exact: true })).toHaveCount(0)
    await expect(dialog.getByLabel('グループに関連付けるアセット', { exact: true })).toHaveCount(1)
    await dialog.getByRole('button', { name: '代表候補からグループ用アセットを登録', exact: true }).click()
    await dialog.getByLabel('アセット名', { exact: true }).fill('review_token')
    await dialog.getByLabel('背景を透明化', { exact: true }).uncheck()
    await dialog.getByRole('button', { name: 'アセットを確定', exact: true }).click()
    await expect(dialog.getByText('アセットを登録し、グループ全体に関連付けました。「次へ：領域検出・アイコン反映」で位置と原文を確認してください。')).toBeVisible()
    await expect(dialog.locator('.occurrence button').filter({ hasText: 'review_token' })).toHaveCount(2)
    await dialog.screenshot({ path: testInfo.outputPath('group-asset-assignment.png') })
    await dialog.getByLabel('グループに関連付けるアセット', { exact: true }).selectOption('')
    await dialog.getByRole('button', { name: 'グループ全体に関連付け', exact: true }).click()
    await expect(dialog.locator('.occurrence button').filter({ hasText: 'アセット未割当' })).toHaveCount(2)
    await dialog.getByLabel('グループに関連付けるアセット', { exact: true }).selectOption({ label: 'review_token' })
    await dialog.getByRole('button', { name: 'グループ全体に関連付け', exact: true }).click()
    await expect(dialog.locator('.occurrence button').filter({ hasText: 'review_token' })).toHaveCount(2)
    await expect(dialog.getByRole('button', { name: /承認/ })).toHaveCount(0)
    await dialog.getByRole('button', { name: 'すべての候補', exact: true }).click()
    await expect(dialog.locator('.occurrence button').filter({ hasText: /承認済み|未確認/ })).toHaveCount(0)
    await dialog.screenshot({ path: testInfo.outputPath('icon-review-desktop.png') })
    await page.getByRole('button', { name: 'プロジェクト保存', exact: true }).click()
    await expect.poll(async () => (await readSaved()).assetDiscovery?.occurrences.length).toBe(4)
    const saved = await readSaved()
    expect(saved.cards.map(card => card.regions)).toEqual(fixture.regions)
    expect(saved.assets.map(asset => asset.name)).toEqual(['review_token'])
    expect(saved.assetDiscovery!.occurrences.every(item => item.decision === 'pending')).toBe(true)
    expect(saved.assetDiscovery!.groups.some(group => group.name === 'Shared token')).toBe(true)
    const registeredGroup = saved.assetDiscovery!.groups.find(group => group.name === 'Shared token')!
    expect(registeredGroup.proposedAssetId).toBe(saved.assets[0]!.id)
    expect(saved.assetDiscovery!.occurrences.filter(item => registeredGroup.memberIds.includes(item.id)).every(item => item.assetId === saved.assets[0]!.id)).toBe(true)
    await page.getByRole('button', { name: 'カード', exact: true }).click()
    await openReview()
    await expect(dialog.locator('.occurrence')).toHaveCount(4)
    await dialog.getByText('収集するカードを選ぶ', { exact: true }).click()
    await expect(collect).toBeEnabled()
    await dialog.getByRole('button', { name: '現在のカードだけ', exact: true }).click()
    await collect.click()
    await expect(dialog.getByText(/収集完了：新規0枚、比較待ち1枚/)).toBeVisible({ timeout: 30000 })
    await dialog.getByRole('button', { name: /^(one|two)\.pngの案を比較$/ }).click()
    await expect(dialog.locator('.difference')).toHaveCount(2)
    await expect(dialog.locator('.difference')).toContainText(['変更なし', '変更なし'])
    const comparison = dialog.getByRole('region', { name: '再収集候補の画像比較', exact: true })
    const difference = comparison.locator('.difference').first()
    await expect(difference.locator('.snapshot img')).toHaveCount(2)
    await difference.getByRole('button', { name: '位置と枠を確認', exact: true }).click()
    await expect(difference.getByRole('img', { name: 'カード全体での候補位置', exact: true })).toBeVisible()
    await expect(difference.getByRole('img', { name: '候補周辺の拡大比較', exact: true })).toBeVisible()
    await expect(difference.locator('.coordinate-details')).not.toHaveAttribute('open')
    await difference.screenshot({ path: testInfo.outputPath('recollection-visual-comparison.png') })
    await expect(dialog.getByRole('button', { name: '選択した再収集案を採用', exact: true })).toBeDisabled()
    await page.getByRole('button', { name: 'アセット編集', exact: true }).click()
    await expect(dialog).toBeHidden()
    await openReview()
    await expect(dialog.locator('.difference')).toHaveCount(2)
    await dialog.getByRole('button', { name: '再収集案をすべて破棄', exact: true }).click()
    await dialog.getByRole('button', { name: '確認に戻る', exact: true }).click()
    await expect(dialog.locator('.difference')).toHaveCount(2)
    await dialog.getByRole('button', { name: '再収集案をすべて破棄', exact: true }).click()
    await dialog.getByRole('button', { name: '再収集案を破棄', exact: true }).click()
    await expect(dialog.locator('.difference')).toHaveCount(0)
    await expect(dialog.locator('.occurrence')).toHaveCount(4)
    expect(errors).toEqual([])
    expect(external).toEqual([])
  }
  finally {
    await page.evaluate(async (name) => {
      await (await navigator.storage.getDirectory()).removeEntry(name, { recursive: true })
    }, fixture.name)
  }
})
