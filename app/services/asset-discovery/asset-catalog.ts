import type { AssetFingerprint } from '~/utils/asset-matching'
import { fingerprintImage } from '~/utils/asset-matching'
import { assertImageDimensions, FILE_LIMITS } from '~/utils/file-limits'
import { createImageDigestCache } from './digest'
import { ASSET_DISCOVERY_LIMITS } from './format'

export interface DiscoveryAssetSample {
  readonly assetId: string
  readonly assetDigest: string
  readonly fingerprint: AssetFingerprint
}

/** セッション内だけの派生資源。プロジェクトJSON・Undoへ保存しない。 */
export interface DiscoveryAssetCatalog {
  readonly samples: readonly DiscoveryAssetSample[]
  readonly failures: readonly { assetId: string, message: string }[]
  readonly omittedAssetIds: readonly string[]
}

interface CatalogOptions {
  assets: readonly { id: string }[]
  assetFiles: ReadonlyMap<string, Blob>
  pendingAssetWrites: ReadonlyMap<string, Blob>
  /** プロジェクト・入力コレクションの差替え、取消、破棄も呼出元で照合する。 */
  isCurrent: () => boolean
  maximumAssets?: number
  digestCache?: ReturnType<typeof createImageDigestCache>
}

const sessions = new WeakMap<DiscoveryAssetCatalog, () => boolean>()

export function isDiscoveryAssetCatalogCurrent(catalog: DiscoveryAssetCatalog): boolean {
  return sessions.get(catalog)?.() ?? false
}

/** 元Blobをハッシュしたうえで逐次デコードする。失敗したPNGを「一致しない」と扱わない。 */
export async function prepareDiscoveryAssetCatalog({ assets, assetFiles, pendingAssetWrites, isCurrent, maximumAssets = 256, digestCache = createImageDigestCache() }: CatalogOptions): Promise<DiscoveryAssetCatalog | null> {
  if (!Number.isInteger(maximumAssets) || maximumAssets < 1 || maximumAssets > 1000 || assets.length > FILE_LIMITS.projectAssets
    || new Set(assets.map(asset => asset.id)).size !== assets.length
    || assets.some(asset => !asset.id.trim() || asset.id.length > ASSET_DISCOVERY_LIMITS.identifierLength)) {
    throw new Error('照合アイコンのID・件数上限が不正です。')
  }
  const entries = assets.map(asset => ({ id: asset.id, blob: pendingAssetWrites.get(asset.id) ?? assetFiles.get(asset.id) }))
    .sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
  const originalIds = assets.map(asset => asset.id)
  let invalidated = false
  const current = () => {
    invalidated ||= !isCurrent() || assets.length !== originalIds.length || assets.some((asset, i) => asset.id !== originalIds[i])
      || entries.some(entry => entry.blob !== (pendingAssetWrites.get(entry.id) ?? assetFiles.get(entry.id)))
    return !invalidated
  }
  const samples: DiscoveryAssetSample[] = []
  const failures: { assetId: string, message: string }[] = []
  for (const entry of entries.slice(0, maximumAssets)) {
    if (!current())
      return null
    let bitmap: ImageBitmap | undefined
    try {
      if (!entry.blob)
        throw new Error('アイコン画像が未読込または取得できません。')
      const assetDigest = await digestCache.digest(entry.blob)
      if (!current())
        return null
      bitmap = await createImageBitmap(entry.blob)
      if (!current())
        return null
      assertImageDimensions(bitmap.width, bitmap.height)
      const fingerprint = fingerprintImage(bitmap)
      if (!fingerprint)
        throw new Error('比較できる不透明な画素がありません。')
      samples.push(Object.freeze({ assetId: entry.id, assetDigest, fingerprint }))
    }
    catch (error) {
      if (!current())
        return null
      failures.push({ assetId: entry.id, message: error instanceof Error ? error.message : 'アイコン画像を照合できませんでした。' })
    }
    finally {
      bitmap?.close()
    }
  }
  if (!current())
    return null
  const result: DiscoveryAssetCatalog = Object.freeze({
    samples: Object.freeze(samples),
    failures: Object.freeze(failures.map(item => Object.freeze(item))),
    omittedAssetIds: Object.freeze(entries.slice(maximumAssets).map(entry => entry.id)),
  })
  sessions.set(result, current)
  return result
}
