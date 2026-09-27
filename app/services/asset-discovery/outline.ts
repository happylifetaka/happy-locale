import type { PixelRegion } from '~/services/ocr/pixel-regions'

/** 薄い外周は補完するが、十分大きな強い輪郭から片側だけ伸びた影は採用しない。 */
export function chooseIconOutline(strong: PixelRegion | undefined, weak: PixelRegion | undefined, typical: number): PixelRegion | undefined {
  if (!strong)
    return weak
  if (!weak || weak.area <= strong.area)
    return strong
  // 強い成分が中心の小片しかない場合は、偏った位置にあっても外周を回収する。
  if (strong.width * strong.height < weak.width * weak.height * 0.5)
    return weak
  const left = Math.max(0, strong.x - weak.x)
  const right = Math.max(0, weak.x + weak.width - strong.x - strong.width)
  const top = Math.max(0, strong.y - weak.y)
  const bottom = Math.max(0, weak.y + weak.height - strong.y - strong.height)
  const imbalance = Math.max(Math.abs(left - right), Math.abs(top - bottom))
  return imbalance > Math.max(2, typical * 0.2) ? strong : weak
}
