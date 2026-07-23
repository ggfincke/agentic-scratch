// tests/edit/evaluation/semantic-live-workflow.test.ts
// live acceptance & replay output path regressions

import assert from 'node:assert/strict'
import { mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import {
  semanticEditLiveAcceptanceFailures,
  type SemanticEditLiveAcceptanceTool,
} from '../../../scripts/semantic-edit/live-workflow.js'
import { replaySemanticEditRunV1 } from '@scratch-agent/edit'

const HISTORICAL_REVISION = 'a'.repeat(64)
const CURRENT_REVISION = 'b'.repeat(64)

function successfulTool(
  name: string,
  data: Readonly<Record<string, unknown>> = {}
): SemanticEditLiveAcceptanceTool
{
  return Object.freeze({
    name,
    request: Object.freeze({}),
    outcome: Object.freeze({ ok: true, data }),
    isError: false,
  })
}

function successfulExport(): SemanticEditLiveAcceptanceTool
{
  return successfulTool('edit_export', {
    exportedRevision: { revisionId: CURRENT_REVISION },
    identity: { postHead: { revisionId: CURRENT_REVISION } },
  })
}

test('refused project inspection cannot satisfy live acceptance', () =>
{
  const refusedInspect: SemanticEditLiveAcceptanceTool = Object.freeze({
    name: 'project_inspect',
    request: Object.freeze({}),
    outcome: Object.freeze({ ok: false }),
    isError: true,
  })

  assert.deepEqual(
    semanticEditLiveAcceptanceFailures({
      tools: [refusedInspect, successfulExport()],
      finalRevisionSha256: CURRENT_REVISION,
      acceptedRevisionSha256s: [CURRENT_REVISION],
    }),
    ['Codex did not complete a successful project_inspect call']
  )
})

test('historical revision cannot replace the exported current head', () =>
{
  assert.deepEqual(
    semanticEditLiveAcceptanceFailures({
      tools: [successfulTool('project_inspect'), successfulExport()],
      finalRevisionSha256: HISTORICAL_REVISION,
      acceptedRevisionSha256s: [HISTORICAL_REVISION, CURRENT_REVISION],
    }),
    ['final revision differs from the exported current post-head revision']
  )
})

test('semantic replay rejects an output root equal to its read-only run root', async (t) =>
{
  const runRoot = mkdtempSync(
    join(tmpdir(), 'agentic-scratch-replay-equal-root-')
  )
  t.after(() => rmSync(runRoot, { recursive: true, force: true }))

  await assert.rejects(
    replaySemanticEditRunV1({ runRoot, outRoot: runRoot }),
    /--out may not write inside the run root being replayed/u
  )
  assert.deepEqual(readdirSync(runRoot), [])
})
