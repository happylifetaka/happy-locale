/** 中央寄せ・淡色地の暗色文字を前提とする内部ポリシー。曖昧な測定を拒否する形状条件は実装内に残す。 */
export interface HeadingPixelSettings {
  readonly policy: 'centered-dark' | 'none'
  readonly maximumInkLuminance: number
  readonly maximumInkSaturation: number
  readonly minimumBackgroundLuminance: number
  readonly minimumFallbackLuminance: number
  readonly minimumFallbackContrast: number
}

export const DEFAULT_HEADING_PIXEL_SETTINGS: HeadingPixelSettings = Object.freeze({
  policy: 'centered-dark',
  maximumInkLuminance: 110,
  maximumInkSaturation: 60,
  minimumBackgroundLuminance: 150,
  minimumFallbackLuminance: 140,
  minimumFallbackContrast: 60,
})

export function headingPixelSettings(overrides?: Partial<HeadingPixelSettings>): HeadingPixelSettings {
  return overrides ? { ...DEFAULT_HEADING_PIXEL_SETTINGS, ...overrides } : DEFAULT_HEADING_PIXEL_SETTINGS
}
