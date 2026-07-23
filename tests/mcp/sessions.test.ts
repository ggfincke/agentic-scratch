// tests/mcp/sessions.test.ts
// focused heavy-session retention, capacity, release, & snapshot lifecycle gate

import assert from 'node:assert/strict'
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { buildRepairBenchmark } from '@scratch-agent/repair'

import { RepairMcpBoundaryError } from '@scratch-agent/mcp'
import { RepairSessionRegistry } from '@scratch-agent/mcp'

function errorCode(code: string): (error: unknown) => boolean
{
  return (error: unknown): boolean =>
  {
    assert.ok(error instanceof RepairMcpBoundaryError)
    assert.equal(error.code, code)
    return true
  }
}

test('registry bounds heavy sessions while retaining exact detached status', async (t) =>
{
  const root = mkdtempSync(join(tmpdir(), 'repair-mcp-sessions-'))
  const inputRoot = join(root, 'input')
  const outputRoot = join(root, 'output')
  const artifactRoot = join(root, 'artifacts')
  for (const path of [inputRoot, outputRoot, artifactRoot]) mkdirSync(path)
  t.after(() => rmSync(root, { recursive: true, force: true }))

  const config = { inputRoot, outputRoot, artifactRoot }
  assert.throws(
    () => new RepairSessionRegistry(config, { maxLiveSessions: 0 }),
    errorCode('mcp.session-capacity-invalid')
  )
  const registry = new RepairSessionRegistry(config, { maxLiveSessions: 1 })
  const benchmark = buildRepairBenchmark('R1')
  const invalidPath = join(inputRoot, 'invalid.sb3')
  const healthyPath = join(inputRoot, 'healthy.sb3')
  writeFileSync(invalidPath, 'not an sb3')
  writeFileSync(healthyPath, await benchmark.healthy.toSb3())

  for (let index = 0; index < 3; index++)
  {
    const started = await registry.start(invalidPath, 'R1')
    assert.ok(started.snapshot.terminal)
    assert.equal(started.snapshot.terminal.accepted, null)
    assert.deepEqual(registry.status(started.sessionId), started.snapshot)
  }
  assert.deepEqual(registry.retentionStats(), {
    maxLiveSessions: 1,
    liveSessionCount: 0,
    startingSessionCount: 0,
    detachedSessionCount: 3,
    totalRecordCount: 3,
  })

  const acceptedStart = registry.start(healthyPath, 'R1')
  assert.equal(registry.retentionStats().startingSessionCount, 1)
  await assert.rejects(
    registry.start(join(inputRoot, 'missing.sb3'), 'R1'),
    errorCode('mcp.session-capacity-exhausted')
  )
  const accepted = await acceptedStart
  assert.equal(accepted.snapshot.state, 'already-passing')
  assert.ok(accepted.snapshot.terminal?.accepted)
  assert.deepEqual(registry.retentionStats(), {
    maxLiveSessions: 1,
    liveSessionCount: 1,
    startingSessionCount: 0,
    detachedSessionCount: 3,
    totalRecordCount: 4,
  })
  await assert.rejects(
    registry.start(invalidPath, 'R1'),
    errorCode('mcp.session-capacity-exhausted')
  )

  const statusBeforeExport = registry.status(accepted.sessionId)
  const outputPath = join(outputRoot, 'accepted.sb3')
  const exported = registry.export(accepted.sessionId, outputPath)
  assert.equal(exported.sha256, statusBeforeExport.terminal?.accepted?.sha256)
  assert.equal(exported.byteLength, readFileSync(outputPath).byteLength)
  assert.deepEqual(registry.retentionStats(), {
    maxLiveSessions: 1,
    liveSessionCount: 0,
    startingSessionCount: 0,
    detachedSessionCount: 4,
    totalRecordCount: 4,
  })
  assert.deepEqual(registry.status(accepted.sessionId), statusBeforeExport)
  assert.throws(
    () => registry.export(accepted.sessionId, join(outputRoot, 'released.sb3')),
    errorCode('mcp.export-unavailable-released')
  )

  const releasedCapacity = await registry.start(invalidPath, 'R1')
  assert.deepEqual(
    registry.status(releasedCapacity.sessionId),
    releasedCapacity.snapshot
  )
  assert.deepEqual(registry.retentionStats(), {
    maxLiveSessions: 1,
    liveSessionCount: 0,
    startingSessionCount: 0,
    detachedSessionCount: 5,
    totalRecordCount: 5,
  })
})
