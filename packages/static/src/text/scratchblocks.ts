// packages/static/src/text/scratchblocks.ts
// deterministic whole-project scratchblocks text export via parse-sb3-blocks

import { createRequire } from 'node:module'

import type { BlockEntry, ProjectJson, Target } from '@scratch-agent/sb3'

type ToScratchblocks = (
  scriptId: string,
  blocks: Record<string, BlockEntry>,
  locale?: string,
  opts?: Record<string, unknown>
) => string

// parse-sb3-blocks is CJS w/o type declarations; narrow surface here
const requireCjs = createRequire(import.meta.url)
const { toScratchblocks } = requireCjs('parse-sb3-blocks') as {
  toScratchblocks: ToScratchblocks
}

export interface ScratchblocksTargetText
{
  name: string
  scripts: string[]
}

// ids that are pure numbers sort numerically (Scratch's script ordering); rest lexicographically
function compareScriptIds(a: string, b: string): number
{
  const na = Number(a)
  const nb = Number(b)
  if (a !== '' && b !== '' && Number.isFinite(na) && Number.isFinite(nb))
  {
    return na - nb || (a < b ? -1 : a > b ? 1 : 0)
  }
  return a < b ? -1 : a > b ? 1 : 0
}

function topLevelScriptIds(target: Target): string[]
{
  const ids: string[] = []
  for (const [id, entry] of Object.entries(target.blocks))
  {
    // array entries are bare top-level variable/list reporters, not scripts
    if (
      !Array.isArray(entry) &&
      entry.topLevel === true &&
      entry.shadow !== true
    )
    {
      ids.push(id)
    }
  }
  return ids.sort(compareScriptIds)
}

export function emitProjectScratchblocks(project: ProjectJson): {
  targets: ScratchblocksTargetText[]
}
{
  return {
    targets: project.targets.map((target) =>
    {
      const scripts = topLevelScriptIds(target).map((id) =>
        toScratchblocks(id, target.blocks)
      )
      return { name: target.name, scripts }
    }),
  }
}
