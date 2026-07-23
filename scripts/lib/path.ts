// scripts/lib/path.ts
// normalizes relative paths for portable artifact metadata

import { relative, sep } from 'node:path'

export function portableRelativePath(base: string, path: string): string
{
  return relative(base, path).split(sep).join('/')
}
