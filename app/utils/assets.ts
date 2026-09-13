import type { ImageAsset, RegionDraft } from '~/types/editor'

/** 再切り出し後の名前と切り出し元を更新し、既存のID・配置設定を引き継ぐ。 */
export function updateRecroppedAsset(
  asset: ImageAsset,
  name: string,
  sourceImageId: string,
  sourceRect: RegionDraft,
): ImageAsset {
  return {
    ...asset,
    name,
    sourceImageId,
    sourceRect: { ...sourceRect },
  }
}

/** トークン構文を壊す文字と名前の重複を拒否する。改名中の自分自身は重複対象から外す。 */
export function validateAssetName(
  value: string,
  assets: readonly Pick<ImageAsset, 'id' | 'name'>[],
  excludedId?: string,
): string | null {
  const name = value.trim()
  if (!name)
    return 'アセット名を入力してください。'
  if (/[[\]:\r\n]/u.test(name))
    return 'アセット名に [ ] : や改行は使用できません。'
  if (assets.some(asset => asset.id !== excludedId && asset.name === name))
    return `アセット名「${name}」は既に使用されています。`
  return null
}

/** 本文で参照されている未登録のアイコン名を重複なく返す。 */
export function findUnresolvedAssetNames(
  input: string,
  assets: readonly Pick<ImageAsset, 'name'>[],
): string[] {
  const registered = new Set(assets.map(asset => asset.name))
  const unresolved = new Set<string>()
  for (const match of input.matchAll(/\[icon:([^\]\r\n]+)\]/gu)) {
    const name = match[1]!.trim()
    if (name && !registered.has(name))
      unresolved.add(name)
  }
  return [...unresolved]
}
