// packages/runner/src/observation/png-decode.ts
// bounded exact PNG decoding for hash-bound rendered differential evidence

import { PNG } from 'pngjs'

import { MAX_TEMPORAL_BYTES } from './observation.js'

const MAX_RUNTIME_DECODED_RGBA_BYTES = MAX_TEMPORAL_BYTES

interface DecodedRuntimePngRgbaV1
{
  readonly width: number
  readonly height: number
  readonly rgba: Uint8Array
}

function pngDimension(bytes: Uint8Array, offset: number): number
{
  return (
    bytes[offset]! * 0x1000000 +
    bytes[offset + 1]! * 0x10000 +
    bytes[offset + 2]! * 0x100 +
    bytes[offset + 3]!
  )
}

// inspect IHDR before pngjs allocates, then require its decoded layout to
// match the exact bounded dimensions admitted here
export function decodeRuntimePngRgbaV1(
  bytes: Uint8Array
): DecodedRuntimePngRgbaV1
{
  const signature = [137, 80, 78, 71, 13, 10, 26, 10]
  if (
    bytes.byteLength < 33 ||
    bytes.byteLength > MAX_TEMPORAL_BYTES ||
    signature.some((value, index) => bytes[index] !== value) ||
    pngDimension(bytes, 8) !== 13 ||
    String.fromCharCode(...bytes.slice(12, 16)) !== 'IHDR'
  )
    throw new Error('runtime frame is not a bounded canonical PNG payload')
  const width = pngDimension(bytes, 16)
  const height = pngDimension(bytes, 20)
  const rgbaBytes = width * height * 4
  if (
    !Number.isSafeInteger(rgbaBytes) ||
    width < 1 ||
    height < 1 ||
    rgbaBytes > MAX_RUNTIME_DECODED_RGBA_BYTES
  )
    throw new Error('runtime PNG decoded RGBA layout exceeds its frozen cap')
  const decoded = PNG.sync.read(Buffer.from(bytes))
  if (
    decoded.width !== width ||
    decoded.height !== height ||
    decoded.data.byteLength !== rgbaBytes
  )
    throw new Error('runtime PNG decoder disagrees with the admitted IHDR')
  return Object.freeze({
    width,
    height,
    rgba: Uint8Array.from(decoded.data),
  })
}
