// packages/runner/src/report/run-dir.ts
// create a runs/<id>/ artifact tree & hash run artifacts

import { createHash } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'

interface RunDir
{
  id: string
  root: string
  screenshots: string
  videos: string
  traces: string
  diffs: string
}

// filesystem-safe, sortable run id from the wall clock
export function newRunId(): string
{
  return new Date().toISOString().replace(/[:.]/g, '-')
}

export function createRunDir(
  runsRoot: string,
  id: string = newRunId()
): RunDir
{
  const root = join(runsRoot, id)
  const dir: RunDir = {
    id,
    root,
    screenshots: join(root, 'screenshots'),
    videos: join(root, 'videos'),
    traces: join(root, 'traces'),
    diffs: join(root, 'diffs'),
  }
  for (const path of [
    dir.root,
    dir.screenshots,
    dir.videos,
    dir.traces,
    dir.diffs,
  ])
  {
    mkdirSync(path, { recursive: true })
  }
  return dir
}

export function sha256(buf: Uint8Array): string
{
  return createHash('sha256').update(buf).digest('hex')
}
