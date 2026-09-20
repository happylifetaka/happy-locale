import { expect, test } from '@playwright/test'

test('round trips icon review through real browser file handles and preserves version-3 data on migration', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await page.goto('/cards')
  await expect(page.getByRole('button', { name: 'プロジェクトを開く／作成', exact: true })).toBeVisible()
  const result = await page.evaluate(async () => {
    const load = (path: string) => import(/* @vite-ignore */ `/_nuxt/${path}`)
    const { createFolderProject, saveFolderProject, openFolderProject } = await load('services/project/folder.ts') as typeof import('../../app/services/project/folder')
    const { parseFolderProject } = await load('services/project/format.ts') as typeof import('../../app/services/project/format')
    const root = await navigator.storage.getDirectory()
    const testDirectoryName = `discovery-test-${crypto.randomUUID()}`
    const directory = await root.getDirectoryHandle(testDirectoryName, { create: true })
    const canvas = document.createElement('canvas')
    canvas.width = 100
    canvas.height = 140
    canvas.getContext('2d')!.fillRect(10, 10, 20, 20)
    const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error('PNG failed'))))
    const source = new File([blob], 'synthetic.png', { type: 'image/png' })
    const legacy = {
      version: 3,
      name: 'Synthetic',
      activeCardId: 'card',
      cards: [{ id: 'card', imageName: 'synthetic.png', imagePath: 'images/card.png', imageWidth: 100, imageHeight: 140, regions: [], printArea: null, sourceDpi: null }],
      assets: [],
      fonts: [],
      ocrDictionary: [],
      glossary: [],
      printSettings: { columns: 3, marginMm: 10, gapMm: 4, cutMarks: true },
    }
    try {
      const project = parseFolderProject(JSON.stringify(legacy))
      project.assetDiscovery = {
        occurrences: [{
          id: 'icon',
          cardId: 'card',
          imageDigest: 'a'.repeat(64),
          imageSize: { width: 100, height: 140 },
          bounds: { x: 10, y: 10, width: 20, height: 20 },
          detectedBounds: null,
          origin: 'manual',
          detectorRevision: 'synthetic',
          decision: 'pending',
          assetId: null,
          approval: null,
          owner: null,
        }],
        groups: [{ id: 'group', name: 'Synthetic', memberIds: ['icon'], representativeId: 'icon', proposedAssetId: null }],
      }
      const first = await createFolderProject(directory, project.cards[0]!, source, 'card', [], [], [], new Map(), [], undefined, project.assetDiscovery)
      const firstJSON = await (await (await directory.getFileHandle('project.json')).getFile()).text()
      const opened = await openFolderProject(directory)
      const firstReview = structuredClone(opened.document.assetDiscovery)
      opened.document.assetDiscovery!.occurrences[0]!.decision = 'excluded'
      await saveFolderProject(directory, opened.document, opened.card, [], [], [], new Map())
      const reopened = await openFolderProject(directory)
      const backup = await (await (await directory.getFileHandle('project.backup.json')).getFile()).text()
      const restoredBytes = new Uint8Array(await opened.imageFile.arrayBuffer())
      const sourceBytes = new Uint8Array(await source.arrayBuffer())
      return {
        migrated: project.version,
        migratedCards: project.cards,
        legacyCards: legacy.cards,
        version: first.version,
        firstReview,
        reopenedReview: reopened.document.assetDiscovery,
        expectedReview: project.assetDiscovery,
        backupMatches: firstJSON === backup,
        sourceBytesMatch: restoredBytes.length === sourceBytes.length && restoredBytes.every((byte, index) => byte === sourceBytes[index]),
      }
    }
    finally {
      // Only the uniquely named OPFS directory created by this test is removed.
      await root.removeEntry(testDirectoryName, { recursive: true })
      canvas.width = canvas.height = 1
    }
  })
  expect(result.migrated).toBe(4)
  expect(result.version).toBe(4)
  expect(result.migratedCards).toEqual(result.legacyCards)
  expect(result.firstReview).toEqual(result.expectedReview)
  expect(result.reopenedReview!.occurrences[0]!.decision).toBe('excluded')
  expect(result.backupMatches).toBe(true)
  expect(result.sourceBytesMatch).toBe(true)
  expect(errors).toEqual([])
})
