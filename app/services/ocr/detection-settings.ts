/** Internal engine settings, not a persisted/importable game profile format. */
export interface RegionDetectionSettings {
  readonly textPixels: {
    readonly enabled: boolean
    readonly minimumLuminance: number
    readonly maximumSaturation: number
    readonly iconMinimumLuminance: number
    readonly iconMinimumSaturation: number
  }
  readonly lightLabels: {
    readonly enabled: boolean
    readonly minimumLuminance: number
    readonly maximumSaturation: number
    readonly minimumWidthRatio: number
    readonly minimumHeightRatio: number
    readonly maximumHeightRatio: number
    readonly minimumAspectRatio: number
    readonly maximumAspectRatio: number
    readonly minimumFillRatio: number
    readonly maximumRequests: number
    readonly minimumConfidence: number
  }
}

// Preserve existing behavior. No game names, vocabulary, images or fixed card coordinates.
export const DEFAULT_REGION_DETECTION_SETTINGS: RegionDetectionSettings = Object.freeze({
  textPixels: Object.freeze({
    enabled: true,
    minimumLuminance: 175,
    maximumSaturation: 100,
    iconMinimumLuminance: 65,
    iconMinimumSaturation: 95,
  }),
  lightLabels: Object.freeze({
    enabled: true,
    minimumLuminance: 145,
    maximumSaturation: 90,
    minimumWidthRatio: 0.12,
    minimumHeightRatio: 0.012,
    maximumHeightRatio: 0.07,
    minimumAspectRatio: 3,
    maximumAspectRatio: 22,
    minimumFillRatio: 0.38,
    maximumRequests: 10,
    minimumConfidence: 50,
  }),
})
