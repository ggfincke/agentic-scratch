// tests/repair/codex-repair-bench.test.ts
// preserve aggregate evidence when live benchmark setup fails

import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import {
  runCreatedBenchmark,
  type RunPaths,
} from '../../scripts/repair/codex-repair-bench.js'

const EXPECTED_CASE_IDS = ['R1', 'R2', 'R3', 'R4', 'R5']

function testPaths(root: string): RunPaths
{
  return {
    root,
    inputs: join(root, 'inputs'),
    outputs: join(root, 'outputs'),
    controller: join(root, 'controller'),
    verification: join(root, 'verification'),
    traces: join(root, 'traces'),
    messages: join(root, 'messages'),
    workspaces: join(root, 'workspaces'),
    config: join(root, 'config'),
  }
}

test('setup failure writes both failed aggregates without a provider call', async () =>
{
  const temporaryRoot = mkdtempSync(join(tmpdir(), 'codex-repair-bench-'))
  const runRoot = join(temporaryRoot, 'run')
  mkdirSync(runRoot)
  let providerCalls = 0

  try
  {
    const result = await runCreatedBenchmark(
      testPaths(runRoot),
      'injected-setup-failure',
      {
        createdAt: '2026-07-16T00:00:00.000Z',
        startedAt: performance.now(),
        hooks: {
          definitions: () =>
          {
            throw new Error('injected case factory failure')
          },
          executeCase: async () =>
          {
            providerCalls++
            throw new Error('provider must not run')
          },
          codexVersion: () => 'codex-test',
        },
      }
    )

    assert.equal(result.aggregateWritten, true)
    assert.equal(result.report.ok, false)
    assert.equal(result.report.setup.ok, false)
    assert.deepEqual(result.report.setup.expectedCaseIds, EXPECTED_CASE_IDS)
    assert.match(result.report.setup.errors[0] ?? '', /case factory failure/)
    assert.deepEqual(result.report.cases, [])
    assert.deepEqual(result.report.totals, { cases: 0, passed: 0, failed: 0 })
    assert.equal(providerCalls, 0)

    const json = JSON.parse(
      readFileSync(join(runRoot, 'live-report.json'), 'utf8')
    ) as typeof result.report
    assert.equal(json.schemaVersion, 2)
    assert.equal(json.setup.ok, false)
    assert.deepEqual(json.setup.expectedCaseIds, EXPECTED_CASE_IDS)

    const markdown = readFileSync(join(runRoot, 'live-report.md'), 'utf8')
    assert.match(markdown, /\*\*setup:\*\* FAIL/)
    assert.match(markdown, /\*\*expected cases:\*\* R1, R2, R3, R4, R5/)
    assert.match(markdown, /- setup: benchmark setup failed:/)
  }
  finally
  {
    rmSync(temporaryRoot, { recursive: true, force: true })
  }
})
