// tests/eval/project-check/project-check.test.ts
// generic project-check composition & best-available report retention

import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import { buildFixtureSb3 } from '@scratch-agent/sb3'

import { PROJECT_CHECK_ISSUE_CODES } from '@scratch-agent/eval'
import { runProjectCheck } from '@scratch-agent/eval'

test('project check composes all gates & retains earlier evidence on a late failure', async () =>
{
  const temp = mkdtempSync(join(tmpdir(), 'agentic-scratch-project-check-'))
  try
  {
    const fixture = await buildFixtureSb3()
    const successRoot = join(temp, 'success')
    const success = await runProjectCheck({
      input: { bytes: fixture.sb3, displayName: 'generated-project.sb3' },
      run: { id: 'generated-success', root: successRoot },
      profile: 'full',
    })
    assert.equal(success.report.overall.status, 'passed')
    assert.deepEqual(
      Object.values(success.report.stages).map((stage) => stage.status),
      ['passed', 'passed', 'passed', 'passed', 'passed', 'passed', 'passed']
    )
    assert.equal(success.report.stages.roundTrip.evidence?.contentExact, true)
    assert.equal(success.report.stages.vmSmoke.evidence?.snapshotCount, 3)
    assert.equal(
      success.report.stages.browserSmoke.evidence?.visual.nonblank,
      true
    )
    assert.equal(
      success.report.stages.browserSmoke.evidence?.screenshotCount,
      3
    )
    assert.ok(
      success.report.artifacts.every(
        (artifact) =>
          !artifact.path.startsWith('/') && !artifact.path.includes('..')
      )
    )
    assert.doesNotMatch(JSON.stringify(success.report), new RegExp(temp))
    assert.doesNotMatch(
      JSON.stringify(success.report),
      new RegExp(process.cwd().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    )
    assert.ok(existsSync(join(successRoot, 'project-check.json')))

    const partialRoot = join(temp, 'partial')
    const partial = await runProjectCheck({
      input: { bytes: fixture.sb3, displayName: 'generated-project.sb3' },
      run: { id: 'generated-partial', root: partialRoot },
      profile: 'core',
      scenario: {
        maxTicks: 1,
        steps: [
          { do: 'snapshot', label: 'before' },
          { do: 'clickSprite', sprite: 'missing-target' },
          { do: 'snapshot', label: 'after' },
        ],
      },
    })
    assert.deepEqual(
      [
        partial.report.stages.admission.status,
        partial.report.stages.schema.status,
        partial.report.stages.graph.status,
        partial.report.stages.static.status,
        partial.report.stages.roundTrip.status,
      ],
      ['passed', 'passed', 'passed', 'passed', 'passed']
    )
    assert.equal(partial.report.stages.vmSmoke.status, 'failed')
    assert.equal(partial.report.stages.browserSmoke.status, 'not-run')
    assert.equal(
      partial.report.stages.browserSmoke.notRunReason?.kind,
      'not-requested'
    )
    assert.equal(
      partial.report.overall.stopReason?.code,
      PROJECT_CHECK_ISSUE_CODES.vmFailed
    )
    const persisted = JSON.parse(
      readFileSync(join(partialRoot, 'project-check.json'), 'utf-8')
    ) as typeof partial.report
    assert.equal(persisted.stages.roundTrip.status, 'passed')
    assert.equal(persisted.stages.vmSmoke.status, 'failed')
    assert.equal(persisted.overall.status, 'failed')
  }
  finally
  {
    rmSync(temp, { recursive: true, force: true })
  }
})
