// scripts/lib/hash.ts
// provides the shared node sha-256 primitive for scripts

import { createHash } from 'node:crypto'

export function sha256Hex(value: Uint8Array | string): string
{
  return createHash('sha256').update(value).digest('hex')
}
