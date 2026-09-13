import type { ImageDpi } from '~/types/editor'

/** PNGの単位換算で使う、1メートル当たりのインチ数。 */
const INCHES_PER_METRE = 39.37007874015748

/** 実寸換算に使用できる範囲のDPIか判定する。 */
function validDpi(value: number) {
  return Number.isFinite(value) && value >= 10 && value <= 9600
}

/** 縦横の値を検証し、有効ならDPI情報として返す。 */
function imageDpi(x: number, y: number): ImageDpi | null {
  return validDpi(x) && validDpi(y) ? { x, y } : null
}

/** 画素寸法と実寸mmから縦横のDPIを算出する。 */
export function dpiFromPhysicalSize(
  imageWidth: number,
  imageHeight: number,
  widthMm: number,
  heightMm: number,
): ImageDpi | null {
  if (
    !Number.isFinite(imageWidth)
    || !Number.isFinite(imageHeight)
    || !Number.isFinite(widthMm)
    || !Number.isFinite(heightMm)
    || imageWidth <= 0
    || imageHeight <= 0
    || widthMm <= 0
    || heightMm <= 0
  ) {
    return null
  }
  return imageDpi(
    imageWidth / widthMm * 25.4,
    imageHeight / heightMm * 25.4,
  )
}

/** PNGの解像度メタデータからDPIを読み取る。 */
function pngDpi(view: DataView): ImageDpi | null {
  if (view.byteLength < 8 || view.getUint32(0) !== 0x89504E47)
    return null
  let offset = 8
  while (offset + 12 <= view.byteLength) {
    const length = view.getUint32(offset)
    const type = view.getUint32(offset + 4)
    if (type === 0x70485973 && length >= 9 && offset + 17 <= view.byteLength) {
      if (view.getUint8(offset + 16) !== 1)
        return null
      return imageDpi(
        view.getUint32(offset + 8) / INCHES_PER_METRE,
        view.getUint32(offset + 12) / INCHES_PER_METRE,
      )
    }
    offset += 12 + length
  }
  return null
}

/** JPEGの解像度メタデータからDPIを読み取る。 */
function jpegDpi(view: DataView): ImageDpi | null {
  if (view.byteLength < 4 || view.getUint16(0) !== 0xFFD8)
    return null
  let offset = 2
  let jfif: ImageDpi | null = null
  while (offset + 4 <= view.byteLength) {
    if (view.getUint8(offset) !== 0xFF)
      return null
    const marker = view.getUint8(offset + 1)
    if (marker === 0xDA || marker === 0xD9)
      break
    const length = view.getUint16(offset + 2)
    if (length < 2 || offset + 2 + length > view.byteLength)
      return null
    if (
      marker === 0xE0
      && length >= 16
      && view.getUint32(offset + 4) === 0x4A464946
      && view.getUint8(offset + 8) === 0
    ) {
      const unit = view.getUint8(offset + 11)
      const x = view.getUint16(offset + 12)
      const y = view.getUint16(offset + 14)
      if (unit === 1)
        jfif = imageDpi(x, y)
      if (unit === 2)
        jfif = imageDpi(x * 2.54, y * 2.54)
    }
    if (
      marker === 0xE1
      && length >= 16
      && view.getUint32(offset + 4) === 0x45786966
      && view.getUint16(offset + 8) === 0
    ) {
      const tiff = offset + 10
      const byteOrder = view.getUint16(tiff)
      const littleEndian = byteOrder === 0x4949
      if (littleEndian || byteOrder === 0x4D4D) {
        const ifd = tiff + view.getUint32(tiff + 4, littleEndian)
        if (ifd + 2 <= view.byteLength) {
          const count = view.getUint16(ifd, littleEndian)
          let x: number | null = null
          let y: number | null = null
          let unit = 2
          for (let index = 0; index < count; index += 1) {
            const entry = ifd + 2 + index * 12
            if (entry + 12 > view.byteLength)
              break
            const tag = view.getUint16(entry, littleEndian)
            if (tag === 0x0128)
              unit = view.getUint16(entry + 8, littleEndian)
            if (tag !== 0x011A && tag !== 0x011B)
              continue
            const rational = tiff + view.getUint32(entry + 8, littleEndian)
            if (rational + 8 > view.byteLength)
              continue
            const numerator = view.getUint32(rational, littleEndian)
            const denominator = view.getUint32(rational + 4, littleEndian)
            const resolution = denominator === 0 ? 0 : numerator / denominator
            if (tag === 0x011A)
              x = resolution
            else y = resolution
          }
          if (x && y) {
            const exif = imageDpi(
              unit === 3 ? x * 2.54 : x,
              unit === 3 ? y * 2.54 : y,
            )
            if (exif)
              return exif
          }
        }
      }
    }
    offset += 2 + length
  }
  return jfif
}

/** PNG・JPEGのメタデータから実寸換算用DPIを読む。利用できる情報がなければnullを返す。 */
export async function readImageDpi(file: Blob): Promise<ImageDpi | null> {
  const view = new DataView(await file.slice(0, 256 * 1024).arrayBuffer())
  return pngDpi(view) ?? jpegDpi(view)
}
