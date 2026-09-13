import { describe, expect, it } from 'vitest'
import { dpiFromPhysicalSize, readImageDpi } from '~/utils/image-dpi'

describe('image DPI metadata', () => {
  it('calculates independent axes from known physical dimensions', () => {
    const dpi = dpiFromPhysicalSize(744, 1027, 63.5, 88)

    expect(dpi?.x).toBeCloseTo(297.6, 5)
    expect(dpi?.y).toBeCloseTo(296.43, 2)
  })

  it('reads PNG pixels-per-metre metadata', async () => {
    const bytes = new Uint8Array(29)
    const view = new DataView(bytes.buffer)
    view.setUint32(0, 0x89504E47)
    view.setUint32(8, 9)
    view.setUint32(12, 0x70485973)
    view.setUint32(16, 11811)
    view.setUint32(20, 11811)
    view.setUint8(24, 1)

    const dpi = await readImageDpi(new Blob([bytes]))

    expect(dpi?.x).toBeCloseTo(300, 1)
    expect(dpi?.y).toBeCloseTo(300, 1)
  })

  it('reads JPEG JFIF dots-per-inch metadata', async () => {
    const bytes = new Uint8Array([
      0xFF,
      0xD8,
      0xFF,
      0xE0,
      0x00,
      0x10,
      0x4A,
      0x46,
      0x49,
      0x46,
      0x00,
      0x01,
      0x01,
      0x01,
      0x01,
      0x2C,
      0x01,
      0x2C,
      0x00,
      0x00,
      0xFF,
      0xD9,
    ])

    await expect(readImageDpi(new Blob([bytes]))).resolves.toEqual({
      x: 300,
      y: 300,
    })
  })

  it('returns null when physical resolution is absent', async () => {
    await expect(readImageDpi(new Blob([new Uint8Array([1, 2, 3])]))).resolves.toBeNull()
  })

  it('prefers JPEG EXIF resolution metadata', async () => {
    const bytes = new Uint8Array(80)
    const view = new DataView(bytes.buffer)
    view.setUint16(0, 0xFFD8)
    view.setUint16(2, 0xFFE1)
    view.setUint16(4, 76)
    view.setUint32(6, 0x45786966)
    view.setUint16(10, 0)
    const tiff = 12
    view.setUint16(tiff, 0x4D4D)
    view.setUint16(tiff + 2, 42)
    view.setUint32(tiff + 4, 8)
    const ifd = tiff + 8
    view.setUint16(ifd, 3)
    view.setUint16(ifd + 2, 0x011A)
    view.setUint16(ifd + 4, 5)
    view.setUint32(ifd + 6, 1)
    view.setUint32(ifd + 10, 50)
    view.setUint16(ifd + 14, 0x011B)
    view.setUint16(ifd + 16, 5)
    view.setUint32(ifd + 18, 1)
    view.setUint32(ifd + 22, 58)
    view.setUint16(ifd + 26, 0x0128)
    view.setUint16(ifd + 28, 3)
    view.setUint32(ifd + 30, 1)
    view.setUint16(ifd + 34, 2)
    view.setUint32(tiff + 50, 600)
    view.setUint32(tiff + 54, 2)
    view.setUint32(tiff + 58, 600)
    view.setUint32(tiff + 62, 2)

    await expect(readImageDpi(new Blob([bytes]))).resolves.toEqual({
      x: 300,
      y: 300,
    })
  })
})
