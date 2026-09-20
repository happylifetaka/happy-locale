import type { IconOccurrence } from '~/types/asset-discovery'
import { createHash } from 'node:crypto'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { isDiscoveryAssetCatalogCurrent, prepareDiscoveryAssetCatalog } from '~/services/asset-discovery/asset-catalog'
import { chooseDiscoveryAssetMatch, matchCardIconsToAssets } from '~/services/asset-discovery/asset-matches'
import { createImageDigestCache } from '~/services/asset-discovery/digest'
import { assetFingerprint, fingerprintImage } from '~/utils/asset-matching'

vi.mock('~/utils/asset-matching', async original => ({ ...await original<typeof import('~/utils/asset-matching')>(), fingerprintImage: vi.fn() }))

function fingerprint(color: number[]) {
  const pixels = new Uint8ClampedArray(20 * 20 * 4)
  for (let y = 3; y < 17; y++) {
    for (let x = 3; x < 17; x++)
      pixels.set([...color, 255], (y * 20 + x) * 4)
  }
  return assetFingerprint(pixels, 20, 20)!
}
const red = fingerprint([220, 20, 20])
const green = fingerprint([20, 220, 20])
const bitmaps: { width: number, height: number, tag: string, close: ReturnType<typeof vi.fn> }[] = []
beforeEach(() => {
  vi.clearAllMocks()
  bitmaps.length = 0
  vi.stubGlobal('createImageBitmap', vi.fn(async (blob: Blob) => {
    const tag = await blob.text()
    if (tag === 'broken')
      throw new Error('Decode failed')
    const source = blob instanceof File
    const bitmap = { width: source ? 200 : 20, height: source ? 240 : 20, tag, close: vi.fn() }
    bitmaps.push(bitmap)
    return bitmap
  }))
  vi.mocked(fingerprintImage).mockImplementation(image => (image as unknown as { tag: string }).tag === 'blank' ? null : (image as unknown as { tag: string }).tag === 'green' ? green : red)
})
afterEach(() => vi.unstubAllGlobals())

async function fixture() {
  const files = new Map([['a-red', new Blob(['red'])], ['b-green', new Blob(['green'])]])
  const writes = new Map<string, Blob>()
  const assets = [...files.keys()].map(id => ({ id }))
  const catalog = (await prepareDiscoveryAssetCatalog({ assets, assetFiles: files, pendingAssetWrites: writes, isCurrent: () => true }))!
  const file = new File(['red'], 'card.png')
  const bounds = { x: 10, y: 20, width: 20, height: 30 }
  const occurrence: IconOccurrence = { id: 'icon', cardId: 'card', imageDigest: createHash('sha256').update('red').digest('hex'), imageSize: { width: 200, height: 240 }, bounds, detectedBounds: { ...bounds }, origin: 'detected', detectorRevision: 'test', decision: 'pending', assetId: null, approval: null, owner: null }
  return { files, writes, assets, catalog, options: { card: { id: 'card', imageWidth: 200, imageHeight: 240 }, file, occurrences: [occurrence], catalog, isCurrent: () => true } }
}

it('proposes current registered PNGs without assigning or approving them, and validates an explicit choice', async () => {
  const s = await fixture()
  const before = structuredClone(s.options.occurrences)
  const result = (await matchCardIconsToAssets(s.options))!
  expect(result.rows[0]).toMatchObject({ occurrenceId: 'icon', status: 'match', matches: [{ assetId: 'a-red', similarity: 1 }] })
  expect(result.comparisons).toBe(2)
  expect(s.options.occurrences).toEqual(before)
  expect(chooseDiscoveryAssetMatch(result, s.options.occurrences[0]!, 'a-red')).toEqual({ occurrenceId: 'icon', assetId: 'a-red', assetDigest: createHash('sha256').update('red').digest('hex') })
  expect(() => chooseDiscoveryAssetMatch(result, s.options.occurrences[0]!, 'b-green')).toThrow('再照合')
  expect(() => chooseDiscoveryAssetMatch(JSON.parse(JSON.stringify(result)), s.options.occurrences[0]!, 'a-red')).toThrow('再照合')
  expect(Object.isFrozen(result.rows[0]!.matches[0])).toBe(true)
  expect(bitmaps.every(bitmap => bitmap.close.mock.calls.length === 1)).toBe(true)
  expect(fingerprintImage).toHaveBeenLastCalledWith(bitmaps.at(-1), before[0]!.bounds)
})

it('uses pending PNG bytes instead of an older file under the same asset ID', async () => {
  const s = await fixture()
  s.writes.set('a-red', new Blob(['green']))
  expect(isDiscoveryAssetCatalogCurrent(s.catalog)).toBe(false)
  const catalog = (await prepareDiscoveryAssetCatalog({ assets: s.assets, assetFiles: s.files, pendingAssetWrites: s.writes, isCurrent: () => true }))!
  expect(catalog.samples.find(item => item.assetId === 'a-red')!.assetDigest).toBe(createHash('sha256').update('green').digest('hex'))
  const result = (await matchCardIconsToAssets({ ...s.options, catalog }))!
  expect(result.rows[0]).toMatchObject({ status: 'no-match', matches: [] })
  expect(await matchCardIconsToAssets(s.options)).toBeNull()
})

it('retains failed assets and capped assets as incomplete, not a confident no-match', async () => {
  const s = await fixture()
  s.assets.push({ id: 'c-broken' }, { id: 'd-blank' }, { id: 'e-missing' }, { id: 'f-omitted' })
  s.files.set('c-broken', new Blob(['broken']))
  s.files.set('d-blank', new Blob(['blank']))
  const catalog = (await prepareDiscoveryAssetCatalog({ assets: s.assets, assetFiles: s.files, pendingAssetWrites: s.writes, maximumAssets: 5, isCurrent: () => true }))!
  expect(catalog.failures.map(item => item.assetId)).toEqual(['c-broken', 'd-blank', 'e-missing'])
  expect(catalog.omittedAssetIds).toEqual(['f-omitted'])
  const result = (await matchCardIconsToAssets({ ...s.options, catalog }))!
  expect(result.rows[0]!.status).toBe('incomplete')
  expect(chooseDiscoveryAssetMatch(result, s.options.occurrences[0]!, 'a-red').assetId).toBe('a-red')
  expect(bitmaps.every(bitmap => bitmap.close.mock.calls.length === 1)).toBe(true)
})

it('reports ties without selecting an asset, with stable IDs and at most five suggestions', async () => {
  const s = await fixture()
  const assets = Array.from({ length: 7 }, (_, i) => ({ id: `asset-${6 - i}` }))
  const files = new Map(assets.map(asset => [asset.id, new Blob(['red'])]))
  const catalog = (await prepareDiscoveryAssetCatalog({ assets, assetFiles: files, pendingAssetWrites: s.writes, isCurrent: () => true }))!
  const result = (await matchCardIconsToAssets({ ...s.options, catalog }))!
  expect(result.rows[0]!.status).toBe('ambiguous')
  expect(result.rows[0]!.matches.map(item => item.assetId)).toEqual(['asset-0', 'asset-1', 'asset-2', 'asset-3', 'asset-4'])
  expect(result.comparisons).toBe(7)
  expect(s.options.occurrences[0]!.assetId).toBeNull()
})

it('bounds comparison work and retains all rows after the limit', async () => {
  const s = await fixture()
  s.options.occurrences.push({ ...structuredClone(s.options.occurrences[0]!), id: 'other' })
  const result = (await matchCardIconsToAssets({ ...s.options, maximumComparisons: 1 }))!
  expect(result).toMatchObject({ comparisons: 1, truncated: true })
  expect(result.rows.map(row => row.status)).toEqual(['incomplete', 'incomplete'])
  expect(result.rows[0]!.matches).toHaveLength(1)
  expect(result.rows[1]!.matches).toEqual([])
})

it('keeps excluded and unavailable crops distinct, and uses the current adjusted crop', async () => {
  const s = await fixture()
  const excluded = { ...structuredClone(s.options.occurrences[0]!), id: 'excluded', decision: 'excluded' as const }
  s.options.occurrences.push(excluded)
  s.options.occurrences[0]!.bounds.x = 40
  vi.mocked(fingerprintImage).mockClear().mockReturnValue(null)
  const result = (await matchCardIconsToAssets(s.options))!
  expect(result.rows.map(row => row.status)).toEqual(['excluded', 'unavailable'])
  expect(fingerprintImage).toHaveBeenCalledOnce()
  expect(fingerprintImage).toHaveBeenCalledWith(bitmaps.at(-1), { x: 40, y: 20, width: 20, height: 30 })
  expect(result.comparisons).toBe(0)
})

it.each(['bounds', 'asset', 'excluded', 'source-scope', 'asset-file'] as const)('rejects a delayed choice after %s changes', async (kind) => {
  const s = await fixture()
  let current = true
  const result = (await matchCardIconsToAssets({ ...s.options, isCurrent: () => current }))!
  const occurrence = s.options.occurrences[0]!
  if (kind === 'bounds')
    occurrence.bounds.x++
  if (kind === 'asset')
    occurrence.assetId = 'b-green'
  if (kind === 'excluded')
    occurrence.decision = 'excluded'
  if (kind === 'source-scope')
    current = false
  if (kind === 'asset-file')
    s.files.set('a-red', new Blob(['green']))
  expect(() => chooseDiscoveryAssetMatch(result, occurrence, 'a-red')).toThrow('再照合')
})

it('discards a changed crop while its source digest is pending', async () => {
  const s = await fixture()
  const count = bitmaps.length
  const pending = matchCardIconsToAssets(s.options)
  s.options.occurrences[0]!.bounds.x++
  expect(await pending).toBeNull()
  expect(bitmaps).toHaveLength(count)
})

it('closes a decoded bitmap after cancellation and discards a late decode error', async () => {
  const s = await fixture()
  let current = true
  const bitmap = { width: 200, height: 240, tag: 'red', close: vi.fn() }
  vi.mocked(createImageBitmap).mockImplementationOnce(async () => {
    current = false
    return bitmap as unknown as ImageBitmap
  })
  expect(await matchCardIconsToAssets({ ...s.options, isCurrent: () => current })).toBeNull()
  expect(bitmap.close).toHaveBeenCalledOnce()
  current = true
  vi.mocked(createImageBitmap).mockImplementationOnce(async () => {
    current = false
    throw new Error('Late failure')
  })
  expect(await matchCardIconsToAssets({ ...s.options, isCurrent: () => current })).toBeNull()
})

it('discards a catalog changed during hashing, without decoding stale PNG bytes', async () => {
  const files = new Map([['asset', new Blob(['red'])]])
  const cache = createImageDigestCache()
  const pending = prepareDiscoveryAssetCatalog({ assets: [{ id: 'asset' }], assetFiles: files, pendingAssetWrites: new Map(), isCurrent: () => true, digestCache: cache })
  files.set('asset', new Blob(['green']))
  expect(await pending).toBeNull()
  expect(createImageBitmap).not.toHaveBeenCalled()
})

it('never revives an invalidated catalog or match proposal when old values return', async () => {
  const s = await fixture()
  const result = (await matchCardIconsToAssets(s.options))!
  const occurrence = s.options.occurrences[0]!
  occurrence.bounds.x++
  expect(() => chooseDiscoveryAssetMatch(result, occurrence, 'a-red')).toThrow('再照合')
  occurrence.bounds.x--
  expect(() => chooseDiscoveryAssetMatch(result, occurrence, 'a-red')).toThrow('再照合')
  const file = s.files.get('a-red')!
  s.files.set('a-red', new Blob(['green']))
  expect(isDiscoveryAssetCatalogCurrent(s.catalog)).toBe(false)
  s.files.set('a-red', file)
  expect(isDiscoveryAssetCatalogCurrent(s.catalog)).toBe(false)
  expect(await matchCardIconsToAssets(s.options)).toBeNull()
})

it('closes a decoded catalog image on cancellation, without publishing partial samples', async () => {
  let current = true
  const bitmap = { width: 20, height: 20, close: vi.fn() }
  vi.mocked(createImageBitmap).mockImplementationOnce(async () => {
    current = false
    return bitmap as unknown as ImageBitmap
  })
  expect(await prepareDiscoveryAssetCatalog({ assets: [{ id: 'a' }], assetFiles: new Map([['a', new Blob(['red'])]]), pendingAssetWrites: new Map(), isCurrent: () => current })).toBeNull()
  expect(bitmap.close).toHaveBeenCalledOnce()
  expect(fingerprintImage).not.toHaveBeenCalled()
})

it.each(['limit', 'duplicate', 'empty-id'] as const)('rejects invalid catalog %s before decoding', async (kind) => {
  const assets = kind === 'duplicate' ? [{ id: 'a' }, { id: 'a' }] : [{ id: kind === 'empty-id' ? ' ' : 'a' }]
  await expect(prepareDiscoveryAssetCatalog({ assets, assetFiles: new Map(), pendingAssetWrites: new Map(), isCurrent: () => true, maximumAssets: kind === 'limit' ? 1001 : 256 })).rejects.toThrow('不正')
  expect(createImageBitmap).not.toHaveBeenCalled()
})

it('rejects a different source with the same filename and closes wrong-sized source bitmaps', async () => {
  const s = await fixture()
  await expect(matchCardIconsToAssets({ ...s.options, file: new File(['green'], 'card.png') })).rejects.toThrow('元画像が変わっています')
  const wrongSize = { width: 201, height: 240, close: vi.fn() }
  vi.mocked(createImageBitmap).mockResolvedValueOnce(wrongSize as unknown as ImageBitmap)
  await expect(matchCardIconsToAssets(s.options)).rejects.toThrow('寸法')
  expect(wrongSize.close).toHaveBeenCalledOnce()
})

it.each(['budget', 'threshold', 'margin', 'duplicate', 'bounds', 'card'] as const)('rejects invalid %s requests before source decoding', async (kind) => {
  const s = await fixture()
  const count = bitmaps.length
  if (kind === 'duplicate')
    s.options.occurrences.push(s.options.occurrences[0]!)
  if (kind === 'bounds')
    s.options.occurrences[0]!.bounds.x = -1
  if (kind === 'card')
    s.options.occurrences[0]!.cardId = 'other'
  await expect(matchCardIconsToAssets({ ...s.options, maximumComparisons: kind === 'budget' ? 0 : 10000, minimumSimilarity: kind === 'threshold' ? Number.NaN : 0.9, ambiguityMargin: kind === 'margin' ? -1 : 0.03 })).rejects.toThrow()
  expect(bitmaps).toHaveLength(count)
})
