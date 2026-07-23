// packages/eval/src/core/sha256.ts
// compute one-shot sha-256 digests for internal eval data

import { createHash } from 'node:crypto'

export function sha256(value: Uint8Array | string): string
{
  return createHash('sha256').update(value).digest('hex')
}
