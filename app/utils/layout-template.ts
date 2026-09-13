import type { CardProject, LayoutTemplate, TextRegion } from '~/types/editor'

/** 雛形に含めない原文・訳文と文字単位の設定を空にする。 */
export function clearTemplateText(region: TextRegion): TextRegion {
  return {
    ...region,
    originalText: '',
    translatedText: '',
    translationStatus: 'untranslated',
    textStyles: [],
    inlineAssetStyles: [],
  }
}

/** 選択領域の配置と見た目だけを保存し、原文・訳文や文字単位の書式は雛形に持ち込まない。 */
export function createLayoutTemplate(
  name: string,
  project: CardProject,
  selectedIds: readonly string[],
): LayoutTemplate {
  const regions = project.regions.filter(region => selectedIds.includes(region.id))
  if (!name.trim() || !regions.length || project.imageWidth <= 0 || project.imageHeight <= 0)
    throw new Error('雛形の名前と保存する領域を指定してください。')
  return JSON.parse(JSON.stringify({
    id: crypto.randomUUID(),
    name: name.trim(),
    imageWidth: project.imageWidth,
    imageHeight: project.imageHeight,
    regions: regions.map(clearTemplateText),
  })) as LayoutTemplate
}

/** 画像サイズ比で座標を変換する。文字・筆幅は縦横比の小さい方を使い、過大な拡大を避ける。 */
export function placeLayoutTemplate(
  template: LayoutTemplate,
  imageWidth: number,
  imageHeight: number,
  offsetX = 0,
  offsetY = 0,
  scale = 1,
): TextRegion[] {
  if (![imageWidth, imageHeight, template.imageWidth, template.imageHeight, scale].every(value => Number.isFinite(value) && value > 0)
    || ![offsetX, offsetY].every(Number.isFinite)) {
    return []
  }
  const sx = imageWidth / template.imageWidth * scale
  const sy = imageHeight / template.imageHeight * scale
  const unit = Math.min(sx, sy)
  return template.regions.map(region => ({
    ...clearTemplateText(region),
    x: region.x * sx + offsetX,
    y: region.y * sy + offsetY,
    width: region.width * sx,
    height: region.height * sy,
    fontSize: region.fontSize * unit,
    ...(region.rubyFontSize !== undefined ? { rubyFontSize: region.rubyFontSize * unit } : {}),
    ...(region.rubyGap !== undefined ? { rubyGap: region.rubyGap * sy } : {}),
    textStrokeWidth: region.textStrokeWidth * unit,
    ...(region.sourceIcons
      ? { sourceIcons: region.sourceIcons.map(icon => ({
          ...icon,
          x: icon.x * sx,
          y: icon.y * sy,
          width: icon.width * sx,
          height: icon.height * sy,
        })) }
      : {}),
    exclusionAreas: region.exclusionAreas.map(area => ({
      ...area,
      x: area.x * sx,
      y: area.y * sy,
      width: area.width * sx,
      height: area.height * sy,
    })),
    manualMaskStrokes: region.manualMaskStrokes.map(stroke => ({
      ...stroke,
      brushSize: stroke.brushSize * unit,
      points: stroke.points.map(point => ({ x: point.x * sx, y: point.y * sy })),
    })),
  }))
}

/** 領域が有効な寸法で画像内に収まっているか判定する。 */
export function fitsImage(region: TextRegion, width: number, height: number) {
  return [region.x, region.y, region.width, region.height].every(Number.isFinite)
    && region.x >= 0 && region.y >= 0 && region.width > 0 && region.height > 0
    && region.x + region.width <= width && region.y + region.height <= height
}
