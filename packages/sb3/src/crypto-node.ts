// packages/sb3/src/crypto-node.ts
// synchronous Node digest & HMAC adapters over caller-owned bytes

import { createHash, createHmac, timingSafeEqual } from 'node:crypto'

export function sha256Bytes(bytes: Uint8Array): Uint8Array
{
  return new Uint8Array(createHash('sha256').update(bytes).digest())
}

export function sha256Hex(bytes: Uint8Array): string
{
  return createHash('sha256').update(bytes).digest('hex')
}

export function hmacSha256Bytes(
  key: Uint8Array,
  bytes: Uint8Array
): Uint8Array
{
  return new Uint8Array(createHmac('sha256', key).update(bytes).digest())
}

export function timingSafeBytesEqual(
  left: Uint8Array,
  right: Uint8Array
): boolean
{
  return left.byteLength === right.byteLength && timingSafeEqual(left, right)
}
