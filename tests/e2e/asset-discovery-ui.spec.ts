import { fileURLToPath } from 'node:url'
import { expect, test } from '@playwright/test'

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
    await page.getByText('ツール', { exact: true }).click()
    await page.getByRole('button', { name: 'アイコン候補を収集・確認', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: 'アイコン候補の収集・確認', exact: true })
    const navigation = dialog.getByRole('navigation', { name: 'グループのページ' })
    const list = dialog.locator('.group-list')
    await expect(dialog.getByRole('heading', { name: 'グループ（32）', exact: true })).toBeVisible()
    await expect(navigation).toContainText('1–8 / 32件')
    await expect(list.getByRole('button')).toHaveCount(8)
    await expect(dialog.getByLabel('候補の移動先').locator('option')).not.toContainText(['internal-'])
    for (let pageIndex = 0; pageIndex < 4; pageIndex++) {
      for (let index = 1; index <= 8; index++) {
        const number = pageIndex * 8 + index
        await list.getByRole('button', { name: new RegExp(`^グループ${number}：`) }).click()
        await expect(dialog.getByLabel('グループ名', { exact: true })).toHaveValue(`グループ${number}`)
      }
      if (pageIndex < 3)
        await navigation.getByRole('button', { name: '次へ', exact: true }).click()
    }
    await expect(navigation).toContainText('25–32 / 32件')
    await expect(navigation.getByRole('button', { name: '次へ', exact: true })).toBeDisabled()
    const name = dialog.getByLabel('グループ名', { exact: true })
    await name.fill('防御アイコン')
    await name.press('Tab')
    await expect(list.getByRole('button', { name: /^防御アイコン：/ })).toBeVisible()
    await expect(dialog.getByLabel('候補の移動先').locator('option[value="internal-31"]')).toHaveText('防御アイコンへ統合・移動')
    await dialog.getByRole('button', { name: '候補編集を戻す', exact: true }).click()
    await expect(name).toHaveValue('グループ32')
    await dialog.getByRole('button', { name: '候補編集をやり直す', exact: true }).click()
    await expect(name).toHaveValue('防御アイコン')
    await dialog.screenshot({ path: testInfo.outputPath('32-groups.png') })
    await dialog.getByRole('button', { name: '閉じる', exact: true }).click()
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
      await page.getByText('ツール', { exact: true }).click()
      await page.getByRole('button', { name: 'アイコン候補を収集・確認', exact: true }).click()
    }
    await openReview()
    const dialog = page.getByRole('dialog', { name: 'アイコン候補の収集・確認', exact: true })
    await expect(dialog).toBeVisible()
    const collect = dialog.getByRole('button', { name: '選択したカードから収集', exact: true })
    await expect(collect).toBeDisabled()
    await dialog.getByRole('button', { name: 'すべて対象にする', exact: true }).click()
    await dialog.getByLabel('アイコン候補を収集する（追加のOCRを実行）').check()
    await collect.click()
    await expect(dialog.getByText(/収集完了：新規2枚、比較待ち0枚/)).toBeVisible({ timeout: 30000 })
    await expect(dialog.locator('.occurrence')).toHaveCount(4)
    await expect(dialog.getByRole('heading', { name: 'グループ（2）', exact: true })).toBeVisible()
    await dialog.locator('.occurrence button').filter({ hasText: 'one.png' }).first().click()
    const width = dialog.getByRole('spinbutton', { name: '候補の幅', exact: true })
    const originalWidth = Number(await width.inputValue())
    await width.fill(String(originalWidth + 1))
    await dialog.getByRole('button', { name: '範囲の変更を保存', exact: true }).click()
    await dialog.getByRole('button', { name: '候補編集を戻す', exact: true }).click()
    await expect(width).toHaveValue(String(originalWidth))
    await dialog.getByRole('button', { name: '誤検出として除外', exact: true }).click()
    await expect(dialog.getByRole('button', { name: '未確認に戻す', exact: true })).toBeVisible()
    await dialog.getByRole('button', { name: '候補編集を戻す', exact: true }).click()
    await dialog.getByRole('button', { name: /の名前を編集$/ }).click()
    await dialog.getByLabel('グループ名', { exact: true }).fill('Shared token')
    await dialog.getByLabel('グループ名', { exact: true }).press('Tab')
    await dialog.getByRole('button', { name: 'この候補から新規アセット登録', exact: true }).click()
    await dialog.getByLabel('アセット名', { exact: true }).fill('review_token')
    await dialog.getByLabel('背景を透明化', { exact: true }).uncheck()
    await dialog.getByRole('button', { name: 'アセットを確定', exact: true }).click()
    await expect(dialog.getByText('アセットを登録し、この候補だけに関連付けました。承認・原文への適用は別操作です。')).toBeVisible()
    await dialog.getByRole('button', { name: 'この出現箇所を承認', exact: true }).click()
    await dialog.getByRole('button', { name: 'すべての候補', exact: true }).click()
    await expect(dialog.locator('.occurrence button').filter({ hasText: '承認済み' })).toHaveCount(1)
    await dialog.screenshot({ path: testInfo.outputPath('icon-review-desktop.png') })
    await dialog.getByRole('button', { name: '閉じる', exact: true }).click()
    await page.getByRole('button', { name: 'プロジェクト保存', exact: true }).click()
    await expect.poll(async () => (await readSaved()).assetDiscovery?.occurrences.length).toBe(4)
    const saved = await readSaved()
    expect(saved.cards.map(card => card.regions)).toEqual(fixture.regions)
    expect(saved.assets.map(asset => asset.name)).toEqual(['review_token'])
    expect(saved.assetDiscovery!.occurrences.filter(item => item.decision === 'accepted')).toHaveLength(1)
    expect(saved.assetDiscovery!.groups.some(group => group.name === 'Shared token')).toBe(true)
    await openReview()
    await expect(dialog.locator('.occurrence')).toHaveCount(4)
    await dialog.getByText('収集するカードを選ぶ', { exact: true }).click()
    await expect(collect).toBeDisabled()
    await dialog.getByLabel('アイコン候補を収集する（追加のOCRを実行）').check()
    await collect.click()
    await expect(dialog.getByText(/収集完了：新規0枚、比較待ち1枚/)).toBeVisible({ timeout: 30000 })
    await dialog.getByRole('button', { name: 'one.pngの案を比較', exact: true }).click()
    await expect(dialog.locator('.difference')).toHaveCount(2)
    await expect(dialog.locator('.difference')).toContainText(['変更なし', '変更なし'])
    await expect(dialog.getByRole('button', { name: '選択した再収集案を採用', exact: true })).toBeDisabled()
    await dialog.getByRole('button', { name: '閉じる', exact: true }).click()
    await expect(dialog.getByRole('button', { name: '再収集案を破棄して閉じる', exact: true })).toBeVisible()
    await dialog.getByRole('button', { name: '再収集案を破棄して閉じる', exact: true }).click()
    expect(errors).toEqual([])
    expect(external).toEqual([])
  }
  finally {
    await page.evaluate(async (name) => {
      await (await navigator.storage.getDirectory()).removeEntry(name, { recursive: true })
    }, fixture.name)
  }
})
