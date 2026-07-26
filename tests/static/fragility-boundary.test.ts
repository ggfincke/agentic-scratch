// tests/static/fragility-boundary.test.ts
// verifies pinned vm sources & fragility boundary table invariants

import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

import {
  BUDGET_BURNER_OPCODES_V1,
  NON_BREAKER_SIBLINGS_V1,
  PINNED_SCRATCH_AUDIO_VERSION,
  PINNED_VM_SOURCE_FILES_V1,
  PINNED_VM_VERSION,
  WARP_BREAKERS_V1,
  boundaryTableSha256,
  isBudgetBurner,
  warpBreakerFor,
  type WarpBreakerGroup,
} from '@scratch-agent/static'

const repoRoot = fileURLToPath(new URL('../../', import.meta.url))

test('pinned vm source hashes match installed dependencies', () =>
{
  for (const source of PINNED_VM_SOURCE_FILES_V1)
  {
    const path = join(repoRoot, 'node_modules', source.path)
    const actual = createHash('sha256').update(readFileSync(path)).digest('hex')
    assert.equal(actual, source.sha256, `source hash drifted: ${source.path}`)
  }
})

// read manifests off disk: the vm package's exports map hides ./package.json
function dependencyVersion(name: string): string
{
  const manifest = JSON.parse(
    readFileSync(join(repoRoot, 'node_modules', name, 'package.json'), 'utf8')
  ) as { version: string }
  return manifest.version
}

test('pinned dependency versions match installed dependencies', () =>
{
  assert.equal(dependencyVersion('@scratch/scratch-vm'), PINNED_VM_VERSION)
  assert.equal(dependencyVersion('scratch-audio'), PINNED_SCRATCH_AUDIO_VERSION)
})

test('boundary table invariants hold', () =>
{
  const validGroups = new Set<WarpBreakerGroup>([
    'unconditional',
    'argument-conditional',
    'state-conditional',
    'receiver-conditional',
  ])
  const breakerOpcodes = WARP_BREAKERS_V1.map((entry) => entry.opcode)
  const uniqueOpcodes = new Set(breakerOpcodes)

  assert.equal(WARP_BREAKERS_V1.length, 10)
  assert.equal(uniqueOpcodes.size, WARP_BREAKERS_V1.length)
  for (const opcode of breakerOpcodes)
  {
    assert.equal(BUDGET_BURNER_OPCODES_V1.has(opcode), false)
  }
  for (const opcode of NON_BREAKER_SIBLINGS_V1)
  {
    assert.equal(uniqueOpcodes.has(opcode), false)
  }
  for (const entry of WARP_BREAKERS_V1)
  {
    assert.equal(validGroups.has(entry.group), true)
  }
  assert.equal(warpBreakerFor('sound_play'), undefined)
  assert.equal(isBudgetBurner('control_wait'), true)
})

test('boundary table hash is stable lowercase sha256', () =>
{
  const first = boundaryTableSha256()
  assert.match(first, /^[a-f0-9]{64}$/)
  assert.equal(boundaryTableSha256(), first)
})
