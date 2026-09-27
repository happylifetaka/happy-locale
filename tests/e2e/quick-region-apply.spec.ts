import { fileURLToPath } from 'node:url'
import { expect, test } from '@playwright/test'

for (const [batch, detectFresh] of [[true, false], [true, true], [false, false]]) {
  test(`adds regions and icons without a confirmation modal (batch=${batch}, detectFresh=${detectFresh})`, async ({ page }, testInfo) => {
    test.setTimeout(90000)
    const errors: string[] = []
    page.on('pageerror', error => errors.push(error.message))
    await page.route('**/*', route => new URL(route.request().url()).origin === 'http://127.0.0.1:3000' ? route.continue() : route.abort())
    await page.goto('/cards')
    await expect(page.getByRole('button', { name: 'プロジェクトを開く／作成', exact: true })).toBeVisible()
    const url = `/_nuxt/@fs${fileURLToPath(new URL('./helpers/discovery-ui-project.ts', import.meta.url))}`
    const fixture = await page.evaluate(async ({ url, batch, detectFresh }) => {
      const { prepareIconRegionUIProject } = await import(/* @vite-ignore */ url) as typeof import('./helpers/discovery-ui-project')
      const formatURL = '/_nuxt/services/project/format.ts'
      const { serializeFolderProject } = await import(/* @vite-ignore */ formatURL) as typeof import('../../app/services/project/format')
      const fixture = await prepareIconRegionUIProject(!batch, true)
      // このケースは未修正のOCR原文。手修正・旧形式の保持はworkflow specで別に検証する。
      for (const card of fixture.project.cards) {
        for (const region of card.regions)
          region.lastOcrText = region.originalText
      }
      const second = fixture.project.cards[1]!
      const region = second.regions[0]!
      second.ocrCandidates = [{ id: 'second-candidate', x: region.x, y: region.y, width: region.width, height: region.height, selected: true, text: 'Gain two tokens', confidence: 90, lines: [] }]
      second.regions = []
      if (detectFresh)
        delete second.ocrCandidates
      const discovery = fixture.project.assetDiscovery!
      discovery.occurrences.push({ ...structuredClone(discovery.occurrences[0]!), id: 'second-icon', cardId: 'two' })
      discovery.groups[0]!.memberIds.push('second-icon')
      const directory = await (await navigator.storage.getDirectory()).getDirectoryHandle(fixture.name)
      const writer = await (await directory.getFileHandle('project.json')).createWritable()
      await writer.write(serializeFolderProject(fixture.project))
      await writer.close()
      return fixture
    }, { url, batch, detectFresh })
    let candidatesBeforeApply = fixture.project.cards[batch ? 1 : 0]!.ocrCandidates ?? []
    const saved = () => page.evaluate(async (name) => {
      const dir = await (await navigator.storage.getDirectory()).getDirectoryHandle(name)
      return JSON.parse(await (await (await dir.getFileHandle('project.json')).getFile()).text()) as import('../../app/types/editor').FolderProjectDocument
    }, fixture.name)
    async function save() {
      await page.getByRole('button', { name: 'プロジェクト保存', exact: true }).click()
      await expect(page.locator('.project-operation-status')).toHaveCount(0)
      await expect(page.locator('.save-status')).toHaveText('保存済み')
    }
    try {
      await page.getByRole('button', { name: 'プロジェクトを開く／作成', exact: true }).click()
      if (batch) {
        await expect(page.getByLabel('追加・アイコン反映まで実行')).toHaveCount(0)
        await page.locator('.card-list-panel').getByRole('button', { name: '領域検出', exact: true }).click()
        const targets = page.getByRole('region', { name: '領域検出・OCR', exact: true })
        await expect(page.locator('.card-list-panel').getByRole('combobox', { name: 'カードの選択条件' })).toHaveValue('uncreated')
        await targets.getByRole('button', { name: '1枚の領域を検出', exact: true }).click()
        await expect(page.getByRole('region', { name: 'OCR結果', exact: true })).toBeVisible()
        await targets.getByRole('button', { name: '表示中の候補をすべて選択', exact: true }).click()
        await save()
        candidatesBeforeApply = (await saved()).cards[1]!.ocrCandidates ?? []
        await targets.getByRole('button', { name: /選択した候補を追加/ }).click()
        await expect(page.getByRole('region', { name: 'OCR結果', exact: true })).toBeVisible({ timeout: 45000 })
        await page.getByRole('button', { name: 'まとめて再OCR', exact: true }).click()
        await page.locator('.card-list-panel').getByRole('combobox', { name: 'カードの選択条件' }).selectOption('all')
        await page.getByRole('button', { name: '2枚を再OCR', exact: true }).click()
        await expect(page.getByRole('region', { name: 'OCR結果', exact: true })).toBeVisible({ timeout: 45000 })
      }
      else {
        await expect(page.getByLabel('アイコンも反映', { exact: true })).toBeChecked()
        await page.locator('.candidate-panel').screenshot({ path: testInfo.outputPath('compact-candidates.png') })
        await page.getByRole('button', { name: '追加・アイコン反映', exact: true }).click()
        await expect(page.getByRole('button', { name: '追加・アイコン反映', exact: true })).toHaveCount(0, { timeout: 45000 })
      }
      await expect(page.getByRole('dialog', { name: '領域検出・アイコン反映', exact: true })).toHaveCount(0)
      await save()
      await expect.poll(async () => (await saved()).cards[0]!.regions[0]?.originalText).toContain('[icon:token]')
      const after = await saved()
      expect(after.cards[0]!.regions[0]!.height).toBe(76)
      expect(after.cards[0]!.regions[0]!.translatedText).toBe(batch ? '既存の訳文' : '')
      expect(after.cards[0]!.regions[0]!.sourceIcons).toHaveLength(1)
      expect(after.assetDiscovery).toEqual(fixture.project.assetDiscovery)
      if (batch) {
        await page.getByRole('button', { name: 'カード編集に戻る', exact: true }).click()
        await page.locator('.card-list-panel').screenshot({ path: testInfo.outputPath('batch-region-controls.png') })
        expect(after.cards[1]!.regions[0]!.originalText).toContain('[icon:token]')
        expect(after.cards[1]!.ocrCandidates ?? []).toEqual([])
        await page.getByRole('button', { name: 'まとめて再OCR', exact: true }).click()
        await page.locator('.card-list-panel').getByRole('combobox', { name: 'カードの選択条件' }).selectOption('all')
        await page.getByRole('button', { name: '2枚を再OCR', exact: true }).click()
        await expect(page.getByRole('region', { name: 'OCR結果', exact: true })).toBeVisible({ timeout: 45000 })
        await page.getByRole('button', { name: 'カード編集に戻る', exact: true }).click()
        await save()
        await expect.poll(async () => (await saved()).cards.map(card => card.regions.length)).toEqual([1, 1])
        await page.locator('[data-card-id="two"] .card-list-select').click()
      }
      if (!batch)
        await page.getByRole('button', { name: 'カード編集に戻る', exact: true }).click()
      await page.getByRole('button', { name: '元に戻す', exact: true }).click()
      await save()
      const index = batch ? 1 : 0
      await expect.poll(async () => (await saved()).cards[index]!.regions).toEqual(fixture.project.cards[index]!.regions)
      expect((await saved()).cards[index]!.ocrCandidates ?? []).toEqual(candidatesBeforeApply)
      await page.getByRole('button', { name: 'やり直す', exact: true }).click()
      await save()
      await expect.poll(async () => (await saved()).cards[index]!.regions).toEqual(after.cards[index]!.regions)
      expect(errors).toEqual([])
    }
    finally {
      await page.evaluate(async name => (await navigator.storage.getDirectory()).removeEntry(name, { recursive: true }), fixture.name)
    }
  })
}
