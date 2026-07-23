// tests/eval/multimodal/multimodal-agent-workflow.test.ts
// durable run-level evidence for a failed native-agent judgment

import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import {
  loadMultimodalAgentRecordReport,
  loadValidatedMultimodalHistoricalAgentRun,
  recordMultimodalAgent,
} from '../../../scripts/multimodal/live-workflow.js'
import {
  multimodalExecutionArtifactSnapshot,
  verifyMultimodalRetainedSourceIdentity,
} from '@scratch-agent/eval'
import {
  CodexExecVlmAdapter,
  type CodexExecProcessResult,
} from '../../../scripts/multimodal/codex-adapter.js'

function sha256(path: string): string
{
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}

function failedProcess(): CodexExecProcessResult
{
  const trace = [
    { type: 'thread.started', thread_id: 'thread-workflow-failure' },
    { type: 'turn.started' },
    { type: 'error', message: 'synthetic account-capacity failure' },
    {
      type: 'turn.failed',
      error: { message: 'synthetic account-capacity failure' },
    },
  ]
  return {
    exitCode: 1,
    signal: null,
    timedOut: false,
    aborted: false,
    stdoutLimitExceeded: false,
    stderrLimitExceeded: false,
    settlementTimedOut: false,
    spawnError: null,
    trace: Buffer.from(
      trace.map((event) => JSON.stringify(event)).join('\n') + '\n'
    ),
    stderr: Buffer.from('synthetic failure'),
    finalMessage: Buffer.alloc(0),
  }
}

test('native-agent workflow finalizes the first failed execution exactly once', async (t) =>
{
  const runsRoot = mkdtempSync(
    join(tmpdir(), 'agentic-scratch-agent-workflow-')
  )
  t.after(() => rmSync(runsRoot, { recursive: true, force: true }))
  let processCalls = 0
  const result = await recordMultimodalAgent({
    model: 'test-codex-model',
    reasoningEffort: 'medium',
    runsRoot,
    adapterFactory: (options) =>
      new CodexExecVlmAdapter({
        ...options,
        cliVersion: 'codex-cli test-v1',
        loginStatus: 'Logged in using ChatGPT',
        processRunner: async () =>
        {
          processCalls++
          return failedProcess()
        },
      }),
  })

  assert.equal(processCalls, 1)
  assert.equal(result.report.mode, 'blocked')
  assert.equal(result.report.failure?.code, 'agent-judgment-failed')
  assert.equal(result.report.failure?.execution?.outcome, 'failed')
  assert.equal(result.report.agentExecution.expectedExecutions, 12)
  assert.equal(result.report.agentExecution.auditedExecutions, 1)
  assert.equal(result.report.agentExecution.authoritative, false)
  assert.equal(result.report.corpus.judgments.length, 0)
  assert.equal(result.report.replayStore.recordCount, 0)
  assert.equal(result.report.source.stableBeforeAgent, true)
  assert.equal(result.report.source.stableAtCompletion, true)

  const retained = [
    'source-manifest-start.json',
    'source-manifest-pre-agent.json',
    'source-manifest-completion.json',
    'execution-artifacts-start.json',
    'execution-artifacts-pre-agent.json',
    'execution-artifacts-completion.json',
    'multimodal-agent-record.json',
    'multimodal-agent-record.md',
    join(
      'agent-executions',
      result.report.failure!.execution!.evidence.executionRelativePath
    ),
  ]
  for (const path of retained)
    assert.equal(existsSync(join(result.runRoot, path)), true, path)
  assert.equal(
    new Set(
      retained.slice(0, 3).map((path) => sha256(join(result.runRoot, path)))
    ).size,
    1
  )

  const loaded = loadMultimodalAgentRecordReport(result.runRoot)
  assert.equal(
    verifyMultimodalRetainedSourceIdentity(result.runRoot, loaded.source),
    true
  )
  assert.equal(
    loaded.failure?.execution?.requestKey,
    loaded.failure?.requestKey
  )
  await assert.rejects(
    loadValidatedMultimodalHistoricalAgentRun(result.runRoot),
    /mode blocked has no retained agent records/
  )

  const liveJson = join(
    result.runRoot,
    result.report.failure!.liveReportJsonRelativePath!
  )
  const liveMarkdown = join(
    result.runRoot,
    result.report.failure!.liveReportMarkdownRelativePath!
  )
  const retainedJson = readFileSync(liveJson)
  const retainedMarkdown = readFileSync(liveMarkdown)
  rmSync(liveJson)
  assert.throws(
    () => loadMultimodalAgentRecordReport(result.runRoot),
    /ENOENT|no such file/i
  )
  writeFileSync(liveJson, retainedJson, { mode: 0o600 })
  writeFileSync(
    liveMarkdown,
    Buffer.concat([retainedMarkdown, Buffer.from('x')])
  )
  assert.throws(
    () => loadMultimodalAgentRecordReport(result.runRoot),
    /retained serialization is not exact/
  )
  writeFileSync(liveMarkdown, retainedMarkdown)
  assert.doesNotThrow(() => loadMultimodalAgentRecordReport(result.runRoot))
})

test('native-agent authority rejects executable artifact drift before dispatch', async (t) =>
{
  const runsRoot = mkdtempSync(
    join(tmpdir(), 'agentic-scratch-agent-artifact-drift-')
  )
  t.after(() => rmSync(runsRoot, { recursive: true, force: true }))
  const start = multimodalExecutionArtifactSnapshot()
  assert.equal(start.issue, null)
  assert.ok(start.entries.length > 0)
  const changed = structuredClone(start)
  changed.entries[0]!.sha256 = 'f'.repeat(64)
  changed.treeSha256 = createHash('sha256')
    .update(JSON.stringify(changed.entries))
    .digest('hex')
  let snapshotCalls = 0
  let processCalls = 0
  const result = await recordMultimodalAgent({
    model: 'test-codex-model',
    reasoningEffort: 'medium',
    runsRoot,
    executionArtifactSnapshot: () =>
    {
      snapshotCalls++
      return structuredClone(snapshotCalls === 1 ? start : changed)
    },
    adapterFactory: (options) =>
      new CodexExecVlmAdapter({
        ...options,
        cliVersion: 'codex-cli test-v1',
        loginStatus: 'Logged in using ChatGPT',
        processRunner: async () =>
        {
          processCalls++
          return failedProcess()
        },
      }),
  })

  assert.equal(processCalls, 0)
  assert.equal(result.report.mode, 'blocked')
  assert.equal(result.report.failure?.code, 'workflow-blocked')
  assert.match(
    result.report.failure?.message ?? '',
    /executable artifact identity/
  )
  assert.equal(result.report.agentExecution.authoritative, false)
  assert.equal(result.report.source.stableBeforeAgent, false)
  assert.equal(result.report.source.executionArtifacts.stableBeforeAgent, false)
  assert.equal(result.report.agentExecution.auditedExecutions, 0)
})
