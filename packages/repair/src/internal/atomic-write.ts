// packages/repair/src/internal/atomic-write.ts
// replace files through exclusive temporary writes

import { randomUUID } from 'node:crypto'
import {
  closeSync,
  existsSync,
  openSync,
  renameSync,
  unlinkSync,
} from 'node:fs'
import { dirname, join } from 'node:path'

export function atomicWrite(
  path: string,
  write: (descriptor: number) => void,
  beforeRename: () => void
): void
{
  const temporary = join(dirname(path), `.tmp-${randomUUID()}`)
  let descriptor: number | null = null
  try
  {
    descriptor = openSync(temporary, 'wx', 0o600)
    write(descriptor)
    closeSync(descriptor)
    descriptor = null
    beforeRename()
    renameSync(temporary, path)
  }
  catch (error)
  {
    if (descriptor !== null) closeSync(descriptor)
    if (existsSync(temporary)) unlinkSync(temporary)
    throw error
  }
}
