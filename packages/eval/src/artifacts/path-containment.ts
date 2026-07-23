// packages/eval/src/artifacts/path-containment.ts
// classify paths beneath a root by path components instead of string prefixes

import { isAbsolute, relative, sep } from 'node:path'

interface PathContainmentOptionsV1
{
  readonly allowEqual?: boolean
}

export function isPathWithinRootV1(
  root: string,
  candidate: string,
  options: PathContainmentOptionsV1 = {}
): boolean
{
  const relation = relative(root, candidate)
  if (
    relation === '..' ||
    relation.startsWith(`..${sep}`) ||
    isAbsolute(relation)
  )
    return false
  return relation !== '' || options.allowEqual !== false
}
