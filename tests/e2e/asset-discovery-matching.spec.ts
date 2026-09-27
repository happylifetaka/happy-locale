import { expect, test } from '@playwright/test'

test('compares actual registered PNGs with current crops without automatic assignment', async ({ page }) => {
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
  await expect(page.getByRole('button', { name: 'プロジェクトを開く／作成', exact: true })).toBeVisible()
  const result = await page.evaluate(async () => {
    const load = (path: string) => import(/* @vite-ignore */ `/_nuxt/${path}`)
    const { prepareDiscoveryAssetCatalog } = await load('services/asset-discovery/asset-catalog.ts') as typeof import('../../app/services/asset-discovery/asset-catalog')
    const { matchCardIconsToAssets, chooseDiscoveryAssetMatch } = await load('services/asset-discovery/asset-matches.ts') as typeof import('../../app/services/asset-discovery/asset-matches')
    const { createImageDigestCache } = await load('services/asset-discovery/digest.ts') as typeof import('../../app/services/asset-discovery/digest')
    const png = (canvas: HTMLCanvasElement) => new Promise<Blob>((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('PNG encoding failed')), 'image/png'))
    const icon = (color: string) => {
      const canvas = document.createElement('canvas')
      canvas.width = canvas.height = 96
      const ctx = canvas.getContext('2d')!
      ctx.fillStyle = '#e5c530'
      ctx.beginPath()
      ctx.arc(48, 48, 28, 0, Math.PI * 2)
      ctx.fill()
      ctx.fillStyle = color
      ctx.fillRect(34, 34, 28, 28)
      return canvas
    }
    const red = icon('#e03030')
    const green = icon('#20d060')
    const source = document.createElement('canvas')
    source.width = source.height = 240
    const ctx = source.getContext('2d')!
    ctx.fillStyle = '#182028'
    ctx.fillRect(0, 0, 240, 240)
    ctx.drawImage(red, 80, 100)
    try {
      const file = new File([await png(source)], 'synthetic-card.png', { type: 'image/png' })
      const files = new Map([['red', await png(red)], ['green', await png(green)]])
      const writes = new Map<string, Blob>()
      const assets = [{ id: 'red' }, { id: 'green' }]
      const cache = createImageDigestCache()
      const imageDigest = await cache.digest(file)
      const occurrence: import('../../app/types/asset-discovery').IconOccurrence = {
        id: 'icon',
        cardId: 'card',
        imageDigest,
        imageSize: { width: 240, height: 240 },
        bounds: { x: 80, y: 100, width: 96, height: 96 },
        detectedBounds: { x: 80, y: 100, width: 96, height: 96 },
        origin: 'manual',
        detectorRevision: 'manual',
        decision: 'pending',
        assetId: null,
        approval: null,
        owner: null,
      }
      const catalogOptions = { assets, assetFiles: files, pendingAssetWrites: writes, isCurrent: () => true }
      const catalog = await prepareDiscoveryAssetCatalog(catalogOptions)
      if (!catalog)
        throw new Error('Catalog cancelled')
      const options = { card: { id: 'card', imageWidth: 240, imageHeight: 240 }, file, occurrences: [occurrence], catalog, isCurrent: () => true }
      const before = JSON.stringify(occurrence)
      const matched = await matchCardIconsToAssets(options)
      if (!matched)
        throw new Error('Matching cancelled')
      const choice = chooseDiscoveryAssetMatch(matched, occurrence, 'red')
      const unchanged = before === JSON.stringify(occurrence)
      // A tighter manually adjusted crop must be measured from the current source.
      occurrence.bounds = { x: 110, y: 130, width: 36, height: 36 }
      let staleCropRejected = false
      try {
        chooseDiscoveryAssetMatch(matched, occurrence, 'red')
      }
      catch {
        staleCropRejected = true
      }
      const adjusted = await matchCardIconsToAssets(options)
      occurrence.bounds = { ...occurrence.detectedBounds! }
      const fresh = await matchCardIconsToAssets(options)
      if (!fresh)
        throw new Error('Fresh matching cancelled')
      // The asset ID stays the same while the pending PNG has different content.
      writes.set('red', files.get('green')!)
      let staleAssetRejected = false
      try {
        chooseDiscoveryAssetMatch(fresh, occurrence, 'red')
      }
      catch {
        staleAssetRejected = true
      }
      const updated = await prepareDiscoveryAssetCatalog(catalogOptions)
      if (!updated)
        throw new Error('Updated catalog cancelled')
      const afterReplacement = await matchCardIconsToAssets({ ...options, catalog: updated })
      return { matched, choice, unchanged, staleCropRejected, adjusted, staleAssetRejected, afterReplacement, pendingDigest: updated.samples.find(item => item.assetId === 'red')!.assetDigest, greenDigest: await cache.digest(files.get('green')!) }
    }
    finally {
      for (const canvas of [red, green, source])
        canvas.width = canvas.height = 1
    }
  })
  expect(result.matched.rows[0]!.status).toBe('match')
  expect(result.matched.rows[0]!.matches.map(item => item.assetId)).toEqual(['red'])
  expect(result.choice.assetId).toBe('red')
  expect(result.choice.assetDigest).toMatch(/^[a-f0-9]{64}$/u)
  expect(result.unchanged).toBe(true)
  expect(result.staleCropRejected).toBe(true)
  expect(result.adjusted!.rows[0]!.bounds).toEqual({ x: 110, y: 130, width: 36, height: 36 })
  expect(result.adjusted!.rows[0]!.matches).toEqual([])
  expect(result.staleAssetRejected).toBe(true)
  expect(result.pendingDigest).toBe(result.greenDigest)
  expect(result.afterReplacement!.rows[0]).toMatchObject({ status: 'no-match', matches: [] })
  expect(errors).toEqual([])
  expect(external).toEqual([])
})
