// scripts/lib/private-fs.ts
// provides low-level private directory & exclusive file primitives

import { chmodSync, mkdirSync, writeFileSync } from 'node:fs'

export function ensurePrivateDirectory(path: string): void
{
  mkdirSync(path, { recursive: true, mode: 0o700 })
  chmodSync(path, 0o700)
}

export function writeExclusivePrivateFile(
  path: string,
  value: Uint8Array | string
): void
{
  writeFileSync(path, value, { flag: 'wx', mode: 0o600 })
  chmodSync(path, 0o600)
}
