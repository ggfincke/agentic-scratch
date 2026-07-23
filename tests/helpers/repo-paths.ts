// tests/helpers/repo-paths.ts
// resolve committed fixture paths from the repo root via this module's url

import { fileURLToPath } from 'node:url'

export function fixturePath(name: string): string
{
  return fileURLToPath(new URL(`../../fixtures/${name}`, import.meta.url))
}
