import type { RegionApplyIssue } from './apply-issues'
import type { AssetDiscoveryState, IconOccurrence } from '~/types/asset-discovery'
import type { ImageAsset, TextRegion } from '~/types/editor'
import { intersectionArea } from './geometry'
import { groupAssetState } from './group-asset'
import { fitIconRegions } from './region-fit'
import { approveOccurrence, containsBounds } from './review'

/** 所属IDは信用せず、元画像上の位置を現在の領域へ毎回対応付ける。 */
export function mapDiscoveryToRegions(state: AssetDiscoveryState, cardId: string, regions: readonly TextRegion[], imageDigest: string, imageSize: { width: number, height: number }, assets: readonly ImageAsset[], assetDigests: ReadonlyMap<string, string>) {
  const mapped = new Map<string, IconOccurrence[]>()
  const blocked = new Set<string>()
  const warnings: string[] = []
  const issues: RegionApplyIssue[] = []
  const items = state.occurrences.filter(item => item.cardId === cardId && item.decision !== 'excluded')
  const eligible = items.filter((item) => {
    const group = state.groups.find(group => group.memberIds.includes(item.id))
    const assignment = group ? groupAssetState(state, group) : null
    return item.imageDigest === imageDigest && item.imageSize.width === imageSize.width && item.imageSize.height === imageSize.height
      && assignment?.assetId && !assignment.needsSync && assets.some(asset => asset.id === assignment.assetId) && assetDigests.has(assignment.assetId)
  })
  const fitted = fitIconRegions(regions.map(withoutTransferredIcons), eligible, imageSize)
  for (const item of items) {
    const touching = fitted.regions.filter(region => intersectionArea(region, item.bounds) > 0)
    const owners = touching.filter(region => containsBounds(region, item.bounds))
    const group = state.groups.find(group => group.memberIds.includes(item.id))
    const assignment = group ? groupAssetState(state, group) : null
    let problem = ''
    if (item.imageDigest !== imageDigest || item.imageSize.width !== imageSize.width || item.imageSize.height !== imageSize.height)
      problem = '元画像が検出時から変更されています'
    else if (!assignment?.assetId || assignment.needsSync || !assets.some(asset => asset.id === assignment.assetId) || !assetDigests.has(assignment.assetId))
      problem = 'グループのアイコン割当・画像を確認してください'
    else if (fitted.reasons.has(item.id))
      problem = fitted.reasons.get(item.id)!
    else if (touching.length > 1)
      problem = '複数の領域に重なっています'
    else if (owners.length !== 1)
      problem = touching.length ? 'アイコン全体が領域の枠に収まっていません' : '対応する領域がありません'
    if (problem) {
      const name = assets.find(asset => asset.id === item.assetId)?.name || group?.name || '未割当アイコン'
      warnings.push(`${name} (${Math.round(item.bounds.x)}, ${Math.round(item.bounds.y)}): ${problem}。候補は保持しています。`)
      issues.push({ message: `${name}: ${problem}`, occurrenceId: item.id, regionId: touching[0]?.id })
      touching.forEach(region => blocked.add(region.id))
      continue
    }
    const owner = owners[0]!
    // 作業コピーだけで承認を準備する。保存候補は変更せず、プレビューの明示適用を要する。
    const occurrence = approveOccurrence({ ...item, owner: { kind: 'region', id: owner.id } }, imageDigest, assetDigests.get(item.assetId!)!)
    mapped.set(owner.id, [...mapped.get(owner.id) ?? [], occurrence])
  }
  return { mapped, blocked, warnings, issues, regions: fitted.regions }
}

/** 自動反映した古い相対座標だけを外す。手動指定は残して重複・衝突を検証する。 */
export function withoutTransferredIcons(region: TextRegion): TextRegion {
  return { ...region, sourceIcons: (region.sourceIcons ?? []).filter(icon => !icon.id.startsWith('discovery-')) }
}
