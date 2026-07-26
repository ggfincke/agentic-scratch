// tests/static/fragility-probe.test.ts
// require the pinned vm fragility probe to corroborate every warp assumption

import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

interface ProbeCheck
{
  id: string
  corroborated: boolean
}

interface ProbeResult
{
  checks: ProbeCheck[]
  allCorroborated: boolean
}

const expectedCheckIds = [
  'V1-warp-inheritance',
  'V2-promise-resume-warp-loss',
  'V3-encoding',
  'V6-budget',
  'V7C-broadcast-receiver-conditional',
  'V8-wait-burn',
]

test('pinned scratch vm corroborates every warp assumption', () =>
{
  const repoRoot = fileURLToPath(new URL('../..', import.meta.url))
  const stdout = execFileSync(
    'node',
    ['--import', 'tsx', 'scripts/project/fragility-probe.ts'],
    {
      encoding: 'utf8',
      timeout: 120_000,
      cwd: repoRoot,
    }
  )
  const result = JSON.parse(stdout) as ProbeResult
  assert.equal(result.allCorroborated, true)
  assert.equal(result.checks.length, 6)
  const actualCheckIds = new Set(result.checks.map((check) => check.id))
  for (const id of expectedCheckIds) assert.ok(actualCheckIds.has(id))
})
