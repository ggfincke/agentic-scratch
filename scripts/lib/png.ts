// scripts/lib/png.ts
// shared PNG chunk encoder used by fixtures & harnesses

const PNG_CRC32_TABLE = (() =>
{
  const table = new Uint32Array(256)
  for (let index = 0; index < 256; index += 1)
  {
    let value = index
    for (let bit = 0; bit < 8; bit += 1)
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1
    table[index] = value >>> 0
  }
  return table
})()

function pngCrc32(bytes: Uint8Array): number
{
  let value = 0xffffffff
  for (const byte of bytes)
    value = (PNG_CRC32_TABLE[(value ^ byte) & 0xff] ?? 0) ^ (value >>> 8)
  return (value ^ 0xffffffff) >>> 0
}

export function pngChunk(type: string, payload: Uint8Array): Uint8Array
{
  const bytes = new Uint8Array(12 + payload.byteLength)
  const view = new DataView(bytes.buffer)
  view.setUint32(0, payload.byteLength, false)
  bytes.set(new TextEncoder().encode(type), 4)
  bytes.set(payload, 8)
  view.setUint32(
    8 + payload.byteLength,
    pngCrc32(bytes.subarray(4, 8 + payload.byteLength)),
    false
  )
  return bytes
}
