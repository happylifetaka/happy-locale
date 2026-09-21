import { fileURLToPath } from 'node:url'
import { expect, test } from '@playwright/test'

for (const [fresh, protrusion] of [[false, false], [true, false], [false, true], [true, true]]) {
  test(`classified icons become region tags without selecting positions again (fresh=${fresh}, protrusion=${protrusion})`, async ({ page }, testInfo) => {
    test.setTimeout(90000)
    const errors: string[] = []
    page.on('pageerror', error => errors.push(error.message))
    await page.goto('/cards')
    await expect(page.getByRole('button', { name: 'プロジェクトを開く／作成', exact: true })).toBeVisible()
    const url = `/_nuxt/@fs${fileURLToPath(new URL('./helpers/discovery-ui-project.ts', import.meta.url))}`
    const fixture = await page.evaluate(async ({ url, fresh, protrusion }) => {
      const { prepareIconRegionUIProject } = await import(/* @vite-ignore */ url) as typeof import('./helpers/discovery-ui-project')
      return prepareIconRegionUIProject(fresh, protrusion)
    }, { url, fresh, protrusion })
    const read = () => page.evaluate(async (name) => {
      const directory = await (await navigator.storage.getDirectory()).getDirectoryHandle(name)
      return JSON.parse(await (await (await directory.getFileHandle('project.json')).getFile()).text()) as import('../../app/types/editor').FolderProjectDocument
    }, fixture.name)
    try {
      await page.getByRole('button', { name: 'プロジェクトを開く／作成', exact: true }).click()
      async function open() {
        await page.getByRole('button', { name: 'アセット検出', exact: true }).click()
        await page.getByRole('button', { name: '次へ：領域検出・アイコン反映', exact: true }).click()
      }
      await open()
      const dialog = page.getByRole('dialog', { name: '領域検出・アイコン反映', exact: true })
      await dialog.getByRole('button', { name: '領域とアイコンを解析', exact: true }).click()
      await expect(dialog.locator('.proposed-text')).toContainText('[icon:token]', { timeout: 45000 })
      await expect(dialog.getByRole('alert')).toHaveCount(0)
      await expect(dialog.locator('svg rect')).toHaveCount(protrusion ? 3 : 2)
      if (protrusion)
        await expect(dialog.locator('.bounds-adjustment')).toContainText('下へ3px拡張')
      expect((await read()).cards[0]!.regions).toEqual(fixture.project.cards[0]!.regions)
      await dialog.screenshot({ path: testInfo.outputPath('region-icon-preview.png') })
      await dialog.getByRole('combobox', { name: '対象カード', exact: true }).selectOption('two')
      await expect(dialog.locator('.row')).toHaveCount(0)
      await expect(dialog.getByRole('button', { name: '選択した領域へ位置と原文を反映', exact: true })).toBeDisabled()
      await dialog.getByRole('combobox', { name: '対象カード', exact: true }).selectOption('one')
      await expect(dialog.getByRole('button', { name: '領域とアイコンを解析', exact: true })).toBeEnabled()
      await dialog.getByRole('button', { name: '領域とアイコンを解析', exact: true }).click()
      await expect(dialog.locator('.proposed-text')).toContainText('[icon:token]', { timeout: 45000 })
      await dialog.getByRole('button', { name: '選択した領域へ位置と原文を反映', exact: true }).click()
      await expect(dialog.getByRole('status')).toContainText('反映しました')
      await dialog.getByRole('button', { name: '閉じる', exact: true }).click()
      await page.getByRole('button', { name: 'プロジェクト保存', exact: true }).click()
      await expect.poll(async () => (await read()).cards[0]!.regions[0]?.originalText).toContain('[icon:token]')
      const saved = await read()
      const region = saved.cards[0]!.regions[0]!
      expect(region.height).toBe(protrusion ? 76 : 120)
      expect(region.sourceIcons).toMatchObject([{ assetId: 'token', x: 215, y: 34, width: 32, height: 42 }])
      expect(region.translatedText).toBe(fresh ? '' : '既存の訳文')
      expect(saved.assetDiscovery).toEqual(fixture.project.assetDiscovery)
      expect(saved.cards[0]!.ocrCandidates ?? []).toEqual([])
      await page.getByRole('button', { name: '元に戻す', exact: true }).click()
      await page.getByRole('button', { name: 'プロジェクト保存', exact: true }).click()
      await expect.poll(async () => (await read()).cards[0]!.regions).toEqual(fixture.project.cards[0]!.regions)
      expect((await read()).cards[0]!.ocrCandidates ?? []).toEqual(fixture.project.cards[0]!.ocrCandidates ?? [])
      await page.getByRole('button', { name: 'やり直す', exact: true }).click()
      await page.getByRole('button', { name: 'プロジェクト保存', exact: true }).click()
      await expect.poll(async () => (await read()).cards[0]!.regions).toEqual(saved.cards[0]!.regions)
      await open()
      await dialog.getByRole('button', { name: '領域とアイコンを解析', exact: true }).click()
      await expect(dialog.locator('.proposed-text')).toContainText('[icon:token]', { timeout: 45000 })
      expect((await dialog.locator('.proposed-text').textContent())!.match(/\[icon:token\]/g)).toHaveLength(1)
      expect(errors).toEqual([])
    }
    finally {
      await page.evaluate(async (name) => {
        await (await navigator.storage.getDirectory()).removeEntry(name, { recursive: true })
      }, fixture.name)
    }
  })
}
