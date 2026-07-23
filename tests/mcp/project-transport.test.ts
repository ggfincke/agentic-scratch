// tests/mcp/project-transport.test.ts
// major generic MCP journey for bounded project inspection, execution, & evidence

import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { buildFixtureSb3 } from '@scratch-agent/sb3'

import {
  MAX_MCP_PROJECT_ENVELOPE_BYTES,
  createScratchMcpServer,
} from '@scratch-agent/mcp'
import {
  MAX_PROJECT_TOOL_DATA_BYTES,
  ProjectSessionRegistry,
  type ProjectInspectResult,
  type ProjectOpenResult,
  type ProjectRunResult,
  type ProjectStatusResult,
} from '@scratch-agent/mcp'

interface ToolEnvelope<T>
{
  schemaVersion: 1
  tool: string
  data: T
}

function isTextContent(
  value: unknown
): value is { type: 'text'; text: string }
{
  return (
    value !== null &&
    typeof value === 'object' &&
    (value as { type?: unknown }).type === 'text' &&
    typeof (value as { text?: unknown }).text === 'string'
  )
}

type ToolCallResult = Awaited<ReturnType<Client['callTool']>>

function sha256(value: Uint8Array): string
{
  return createHash('sha256').update(value).digest('hex')
}

function resultEnvelope<T>(
  result: ToolCallResult,
  tool: string
): ToolEnvelope<T>
{
  assert.notEqual(result.isError, true)
  assert.ok(result.structuredContent)
  const data = (result.structuredContent as { data?: unknown }).data
  assert.ok(
    Buffer.byteLength(JSON.stringify(data), 'utf-8') <=
      MAX_PROJECT_TOOL_DATA_BYTES
  )
  assert.ok(
    Buffer.byteLength(JSON.stringify(result.structuredContent), 'utf-8') <=
      MAX_MCP_PROJECT_ENVELOPE_BYTES
  )
  const content = Array.isArray(result.content) ? result.content : []
  const text = content.find(isTextContent)
  assert.ok(text)
  assert.ok(Buffer.byteLength(text.text, 'utf-8') < 8 * 1024)
  assert.deepEqual(JSON.parse(text.text), {
    schemaVersion: 1,
    tool,
    status: 'ok',
    structuredContent: true,
  })
  const envelope = result.structuredContent as ToolEnvelope<T>
  assert.equal(envelope.schemaVersion, 1)
  assert.equal(envelope.tool, tool)
  return envelope
}

function errorEnvelope(
  result: ToolCallResult,
  tool: string,
  expectedCode: string
): void
{
  assert.equal(result.isError, true)
  assert.ok(result.structuredContent)
  const envelope = result.structuredContent as {
    schemaVersion: 1
    tool: string
    error: { code: string; message: string }
  }
  assert.equal(envelope.schemaVersion, 1)
  assert.equal(envelope.tool, tool)
  assert.equal(envelope.error.code, expectedCode)
  assert.ok(envelope.error.message.length > 0)
}

test('project MCP opens, paginates, runs, reports, and rejects policy bypasses', async (t) =>
{
  const root = mkdtempSync(join(tmpdir(), 'project-mcp-'))
  const inputRoot = join(root, 'input')
  const outputRoot = join(root, 'output')
  const artifactRoot = join(root, 'artifacts')
  const outsideRoot = join(root, 'outside')
  for (const path of [inputRoot, outputRoot, artifactRoot, outsideRoot])
  {
    mkdirSync(path)
  }
  t.after(() => rmSync(root, { recursive: true, force: true }))

  const fixture = await buildFixtureSb3()
  const inputPath = join(inputRoot, 'generated-project.sb3')
  const outsidePath = join(outsideRoot, 'outside-project.sb3')
  const symlinkPath = join(inputRoot, 'linked-project.sb3')
  writeFileSync(inputPath, fixture.sb3)
  writeFileSync(outsidePath, fixture.sb3)
  symlinkSync(inputPath, symlinkPath)
  const sourceBytes = readFileSync(inputPath)
  const sourceSha256 = sha256(sourceBytes)

  const built = createScratchMcpServer(
    { inputRoot, outputRoot, artifactRoot },
    { project: { maxSessions: 1, maxRunsPerSession: 2 } }
  )
  const client = new Client({ name: 'project-transport-test', version: '1' })
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair()
  await built.server.connect(serverTransport)
  await client.connect(clientTransport)
  t.after(async () =>
  {
    await client.close()
    await built.server.close()
  })

  const listed = await client.listTools()
  const projectTools = listed.tools.filter((tool) =>
    tool.name.startsWith('project_')
  )
  assert.deepEqual(
    projectTools.map((tool) => tool.name),
    ['project_open', 'project_inspect', 'project_run', 'project_status']
  )
  for (const tool of projectTools)
  {
    assert.equal(tool.inputSchema.additionalProperties, false)
    assert.equal(tool.outputSchema?.additionalProperties, false)
    assert.equal(tool.annotations?.openWorldHint, false)
    assert.equal(tool.execution?.taskSupport, 'forbidden')
    const schema = JSON.stringify(tool.inputSchema)
    assert.doesNotMatch(schema, /allowNetwork|allowedOrigins/)
    assert.doesNotMatch(schema, /inputRoot|outputRoot|artifactRoot/)
  }

  errorEnvelope(
    await client.callTool({
      name: 'project_open',
      arguments: { inputPath: outsidePath },
    }),
    'project_open',
    'mcp.input-outside-root'
  )
  errorEnvelope(
    await client.callTool({
      name: 'project_open',
      arguments: { inputPath: symlinkPath },
    }),
    'project_open',
    'mcp.input-symlink'
  )

  const openedCall = await client.callTool({
    name: 'project_open',
    arguments: { inputPath },
  })
  const firstOpened = resultEnvelope<ProjectOpenResult>(
    openedCall,
    'project_open'
  ).data
  assert.equal(firstOpened.state, 'ready')
  assert.equal(firstOpened.canRun, true)
  assert.equal(firstOpened.input.displayName, 'generated-project.sb3')
  assert.equal(firstOpened.input.sha256, sourceSha256)
  assert.equal(firstOpened.input.byteLength, sourceBytes.byteLength)
  assert.equal(firstOpened.limits.network, 'denied')
  assert.equal(firstOpened.limits.video, false)
  assert.equal(firstOpened.limits.hardKillTimeout, false)

  errorEnvelope(
    await client.callTool({
      name: 'project_open',
      arguments: { inputPath: outsidePath },
    }),
    'project_open',
    'mcp.input-outside-root'
  )
  const retained = resultEnvelope<ProjectStatusResult>(
    await client.callTool({
      name: 'project_status',
      arguments: { sessionId: firstOpened.sessionId },
    }),
    'project_status'
  ).data
  assert.equal(retained.sessionId, firstOpened.sessionId)

  const reopenedCall = await client.callTool({
    name: 'project_open',
    arguments: { inputPath },
  })
  const opened = resultEnvelope<ProjectOpenResult>(
    reopenedCall,
    'project_open'
  ).data
  errorEnvelope(
    await client.callTool({
      name: 'project_status',
      arguments: { sessionId: firstOpened.sessionId },
    }),
    'project_status',
    'mcp.project-session-unknown'
  )
  assert.equal(existsSync(join(artifactRoot, firstOpened.sessionId)), false)
  assert.equal(existsSync(join(artifactRoot, opened.sessionId)), true)

  const firstTargets = resultEnvelope<ProjectInspectResult>(
    await client.callTool({
      name: 'project_inspect',
      arguments: {
        sessionId: opened.sessionId,
        query: { kind: 'targets' },
        pageSize: 1,
      },
    }),
    'project_inspect'
  ).data
  assert.equal(firstTargets.page.total, 2)
  assert.equal(firstTargets.page.returned, 1)
  assert.ok(firstTargets.page.nextCursor)
  const targetCursor = firstTargets.page.nextCursor

  const secondTargets = resultEnvelope<ProjectInspectResult>(
    await client.callTool({
      name: 'project_inspect',
      arguments: {
        sessionId: opened.sessionId,
        query: { kind: 'targets' },
        cursor: targetCursor,
        pageSize: 1,
      },
    }),
    'project_inspect'
  ).data
  assert.equal(secondTargets.page.returned, 1)
  assert.equal(secondTargets.page.nextCursor, null)

  errorEnvelope(
    await client.callTool({
      name: 'project_inspect',
      arguments: {
        sessionId: opened.sessionId,
        query: { kind: 'scripts' },
        cursor: targetCursor,
      },
    }),
    'project_inspect',
    'mcp.project-cursor-mismatch'
  )
  errorEnvelope(
    await client.callTool({
      name: 'project_inspect',
      arguments: {
        sessionId: opened.sessionId,
        query: { kind: 'declarations', declarationKind: 'sprite' },
      },
    }),
    'project_inspect',
    'mcp.arguments-invalid'
  )

  const inspectQuery = { kind: 'scripts' as const, targetIndex: 1 }
  const inspected = resultEnvelope<ProjectInspectResult>(
    await client.callTool({
      name: 'project_inspect',
      arguments: { sessionId: opened.sessionId, query: inspectQuery },
    }),
    'project_inspect'
  ).data
  assert.equal(inspected.queryKind, inspectQuery.kind)
  assert.equal(inspected.untrustedProjectData, true)
  assert.ok(inspected.budget.returnedBytes <= inspected.budget.maxBytes)

  errorEnvelope(
    await client.callTool({
      name: 'project_run',
      arguments: {
        sessionId: opened.sessionId,
        scenario: {
          profile: 'custom',
          scenario: { maxTicks: 601, steps: [] },
        },
      },
    }),
    'project_run',
    'project.scenario.ticks-exceeded'
  )
  errorEnvelope(
    await client.callTool({
      name: 'project_run',
      arguments: {
        sessionId: opened.sessionId,
        scenario: {
          profile: 'custom',
          scenario: { maxTicks: 0, steps: [], allowNetwork: true },
        },
      },
    }),
    'project_run',
    'project.scenario.network-field-forbidden'
  )
  const beforeRun = resultEnvelope<ProjectStatusResult>(
    await client.callTool({
      name: 'project_status',
      arguments: { sessionId: opened.sessionId },
    }),
    'project_status'
  ).data
  assert.equal(beforeRun.runCount, 0)

  const run = resultEnvelope<ProjectRunResult>(
    await client.callTool({
      name: 'project_run',
      arguments: {
        sessionId: opened.sessionId,
        lanes: ['vm'],
        scenario: { profile: 'default-smoke' },
      },
    }),
    'project_run'
  ).data
  assert.equal(run.status, 'passed')
  assert.deepEqual(run.lanes, ['vm'])
  assert.equal(run.vm?.snapshotCount, 3)
  assert.equal(run.browser, null)
  assert.ok(run.artifacts.length >= 3)

  errorEnvelope(
    await client.callTool({
      name: 'project_inspect',
      arguments: {
        sessionId: opened.sessionId,
        query: { kind: 'targets' },
        cursor: targetCursor,
      },
    }),
    'project_inspect',
    'mcp.project-cursor-stale'
  )

  const snapshots = resultEnvelope<ProjectInspectResult>(
    await client.callTool({
      name: 'project_inspect',
      arguments: {
        sessionId: opened.sessionId,
        query: { kind: 'snapshots', runId: run.runId, lane: 'vm' },
      },
    }),
    'project_inspect'
  ).data
  assert.equal(snapshots.page.total, 3)
  const state = resultEnvelope<ProjectInspectResult>(
    await client.callTool({
      name: 'project_inspect',
      arguments: {
        sessionId: opened.sessionId,
        query: {
          kind: 'snapshot-state',
          runId: run.runId,
          lane: 'vm',
          snapshotIndex: 2,
        },
      },
    }),
    'project_inspect'
  ).data
  assert.equal(state.page.total, 1)

  const statusCall = await client.callTool({
    name: 'project_status',
    arguments: { sessionId: opened.sessionId },
  })
  const status = resultEnvelope<ProjectStatusResult>(
    statusCall,
    'project_status'
  ).data
  assert.equal(status.runCount, 1)
  assert.equal(status.latestRun?.runId, run.runId)
  assert.equal(status.retention.runsUsed, 1)

  const resources = await client.listResources()
  assert.ok(resources.resources.length >= 5)
  assert.ok(
    resources.resources.every(
      (resource) =>
        !resource.name.includes('retained-input') &&
        !resource.name.includes('inspection-catalog')
    )
  )
  const reportResource = resources.resources.find((resource) =>
    resource.name.includes('project-open-report')
  )
  assert.ok(reportResource)
  const read = await client.readResource({ uri: reportResource.uri })
  assert.equal(read.contents.length, 1)
  const content = read.contents[0]
  assert.ok(content && 'text' in content)
  if (!content || !('text' in content)) throw new Error('text resource missing')
  assert.equal(JSON.parse(content.text).sessionId, opened.sessionId)

  const quotaArtifactRoot = join(root, 'quota-artifacts')
  mkdirSync(quotaArtifactRoot)
  const quotaRegistry = new ProjectSessionRegistry(
    { inputRoot, outputRoot, artifactRoot: quotaArtifactRoot },
    {
      maxSessions: 1,
      maxRunsPerSession: 1,
      artifactByteLimit: beforeRun.retention.artifactBytes + 1024,
    }
  )
  const quotaOpened = await quotaRegistry.open(inputPath)
  const quotaBefore = quotaRegistry.status(quotaOpened.sessionId)
  await assert.rejects(
    () =>
      quotaRegistry.run(quotaOpened.sessionId, ['browser'], {
        profile: 'default-smoke',
      }),
    (error: unknown) =>
      error instanceof Error &&
      'code' in error &&
      error.code === 'mcp.project-session-artifact-limit'
  )
  const quotaAfter = quotaRegistry.status(quotaOpened.sessionId)
  assert.equal(quotaAfter.runCount, 0)
  assert.equal(
    quotaAfter.retention.artifactBytes,
    quotaBefore.retention.artifactBytes
  )
  assert.equal(
    existsSync(join(quotaArtifactRoot, quotaOpened.sessionId, 'runs/run-001')),
    false
  )

  const transcript = JSON.stringify([
    openedCall.structuredContent,
    reopenedCall.structuredContent,
    firstTargets,
    secondTargets,
    run,
    statusCall.structuredContent,
  ])
  assert.doesNotMatch(
    transcript,
    new RegExp(root.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  )
  assert.doesNotMatch(
    transcript,
    new RegExp(process.cwd().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  )
  const openReportPath = join(
    artifactRoot,
    opened.sessionId,
    'project-open.json'
  )
  unlinkSync(openReportPath)
  symlinkSync(outsidePath, openReportPath)
  assert.throws(
    () => built.projectRegistry.readResource(reportResource.uri),
    (error: unknown) =>
      error instanceof Error &&
      'code' in error &&
      error.code === 'mcp.project-artifact-read-failed'
  )
  assert.deepEqual(readFileSync(inputPath), sourceBytes)
  assert.equal(sha256(readFileSync(inputPath)), sourceSha256)
})
