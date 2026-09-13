/** ファイル容量の上限をMiBからバイトへ換算する係数。 */
const MIB = 1024 * 1024

// ファイル展開・Canvas確保・JSON処理の前に使う上限。各入力経路で共通の基準にする。
export const FILE_LIMITS = {
  imageBytes: 50 * MIB,
  imagePixels: 100_000_000,
  imageDimension: 32_768,
  pdfBytes: 100 * MIB,
  pdfPageDimension: 14_400,
  textBytes: 20 * MIB,
  csvRows: 100_000,
  fontBytes: 20 * MIB,
  projectCards: 10_000,
  projectAssets: 10_000,
  projectRegionsPerCard: 10_000,
  projectStringLength: 1_000_000,
} as const

/** バイト数をMiB単位に換算する。 */
function mebibytes(bytes: number): number {
  return bytes / MIB
}

/** ファイル容量が入力経路の上限内か検証する。 */
export function assertFileSize(
  file: Pick<File, 'size'>,
  maximumBytes: number,
  label: string,
): void {
  if (file.size > maximumBytes) {
    throw new Error(
      `${label}は${mebibytes(maximumBytes)} MiB以下のファイルを選択してください。`,
    )
  }
}

/** 画像の辺長と画素数が処理可能な上限内か検証する。 */
export function assertImageDimensions(
  width: number,
  height: number,
  label = '画像',
): void {
  if (
    !Number.isFinite(width)
    || !Number.isFinite(height)
    || width <= 0
    || height <= 0
    || width > FILE_LIMITS.imageDimension
    || height > FILE_LIMITS.imageDimension
    || width * height > FILE_LIMITS.imagePixels
  ) {
    throw new Error(
      `${label}は一辺${FILE_LIMITS.imageDimension}px以下、合計${FILE_LIMITS.imagePixels / 1_000_000}メガピクセル以下にしてください。`,
    )
  }
}

/** PDFページの寸法が処理可能な範囲内か検証する。 */
export function assertPdfPageDimensions(width: number, height: number): void {
  if (
    !Number.isFinite(width)
    || !Number.isFinite(height)
    || width <= 0
    || height <= 0
    || width > FILE_LIMITS.pdfPageDimension
    || height > FILE_LIMITS.pdfPageDimension
  ) {
    throw new Error(
      `PDFのページ寸法は一辺${FILE_LIMITS.pdfPageDimension}ポイント以下にしてください。`,
    )
  }
}

/** CSVのUTF-8バイト数が容量上限内か検証する。行数はCSV解析側で検証する。 */
export function assertCsvTextLimits(csv: string): void {
  if (new Blob([csv]).size > FILE_LIMITS.textBytes)
    throw new Error('CSVは20 MiB以下にしてください。')
}
