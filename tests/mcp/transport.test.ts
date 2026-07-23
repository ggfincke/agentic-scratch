// tests/mcp/transport.test.ts
// major real-SDK transport, replay, containment, repair, & export flow

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

import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import {
  getDefaultEnvironment,
  StdioClientTransport,
} from '@modelcontextprotocol/sdk/client/stdio.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import {
  buildRepairBenchmark,
  type AttemptResult,
  type RepairProposal,
  type RepairRequest,
  type RepairSessionSnapshot,
} from '@scratch-agent/repair'

import { createRepairMcpServer } from '@scratch-agent/mcp'

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

function resultEnvelope<T>(
  result: Awaited<ReturnType<Client['callTool']>>,
  tool: string
): ToolEnvelope<T>
{
  assert.ok('content' in result)
  assert.ok(result.structuredContent)
  const content = Array.isArray(result.content) ? result.content : []
  const text = content.find(isTextContent)
  assert.ok(text)
  const envelope = result.structuredContent as ToolEnvelope<T>
  const parsedText = JSON.parse(text.text) as Record<string, unknown>
  assert.deepEqual(parsedText, result.structuredContent)
  assert.equal(envelope.schemaVersion, 1)
  assert.equal(envelope.tool, tool)
  return envelope
}

function errorEnvelope(
  result: Awaited<ReturnType<Client['callTool']>>,
  tool: string,
  expectedCode: string
): void
{
  assert.equal(result.isError, true)
  const envelope = resultEnvelope<never>(result, tool) as unknown as {
    schemaVersion: 1
    tool: string
    error: { code: string; message: string }
  }
  assert.equal(envelope.error.code, expectedCode)
  assert.ok(envelope.error.message.length > 0)
}

test('MCP transport preserves controller, replay, path, and export boundaries', async (t) =>
{
  const root = mkdtempSync(join(tmpdir(), 'repair-mcp-'))
  const inputRoot = join(root, 'input')
  const outputRoot = join(root, 'output')
  const artifactRoot = join(root, 'artifacts')
  const outsideRoot = join(root, 'outside')
  for (const path of [inputRoot, outputRoot, artifactRoot, outsideRoot])
  {
    mkdirSync(path)
  }
  t.after(() => rmSync(root, { recursive: true, force: true }))

  const benchmark = buildRepairBenchmark('R1')
  const brokenBytes = await benchmark.broken.toSb3()
  const inputPath = join(inputRoot, 'r1-broken.sb3')
  const outsideInput = join(outsideRoot, 'r1-broken.sb3')
  writeFileSync(inputPath, brokenBytes)
  writeFileSync(outsideInput, brokenBytes)

  const built = createRepairMcpServer({
    inputRoot,
    outputRoot,
    artifactRoot,
  })
  const client = new Client({ name: 'repair-transport-test', version: '1' })
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
  assert.deepEqual(
    listed.tools.map((tool) => tool.name),
    [
      'repair_start',
      'repair_next',
      'repair_submit',
      'repair_status',
      'repair_export',
      'project_open',
      'project_inspect',
      'project_run',
      'project_status',
    ]
  )
  for (const tool of listed.tools)
  {
    assert.equal(tool.inputSchema.type, 'object')
    assert.equal(tool.inputSchema.additionalProperties, false)
    const properties = Object.keys(tool.inputSchema.properties ?? {})
    assert.equal(properties.includes('policy'), false)
    assert.equal(properties.includes('inputRoot'), false)
    assert.equal(properties.includes('outputRoot'), false)
    assert.equal(properties.includes('artifactRoot'), false)
  }
  const submitTool = listed.tools.find((tool) => tool.name === 'repair_submit')!
  const proposalSchema = submitTool.inputSchema.properties?.proposal as {
    anyOf?: unknown[]
  }
  assert.ok((proposalSchema.anyOf?.length ?? 0) >= 4)
  assert.ok(
    (submitTool.inputSchema.$defs as Record<string, unknown> | undefined)
      ?.blockRef
  )

  errorEnvelope(
    await client.callTool({
      name: 'repair_start',
      arguments: { inputPath: outsideInput, caseId: 'R1' },
    }),
    'repair_start',
    'mcp.input-outside-root'
  )
  errorEnvelope(
    await client.callTool({
      name: 'repair_start',
      arguments: { inputPath: `/${'a'.repeat(32768)}`, caseId: 'R1' },
    }),
    'repair_start',
    'mcp.arguments-invalid'
  )

  const started = resultEnvelope<{
    sessionId: string
    caseId: string
    repairCaseId: string
    snapshot: RepairSessionSnapshot
  }>(
    await client.callTool({
      name: 'repair_start',
      arguments: { inputPath, caseId: 'R1' },
    }),
    'repair_start'
  ).data
  assert.equal(started.caseId, 'R1')
  assert.equal(started.repairCaseId, benchmark.repairCase.id)
  assert.equal(started.snapshot.state, 'awaiting-proposal')

  const request1 = resultEnvelope<RepairRequest>(
    await client.callTool({
      name: 'repair_next',
      arguments: { sessionId: started.sessionId },
    }),
    'repair_next'
  ).data
  const request1Proposal = benchmark.referenceProposal(request1)
  const predictedRequest2 = `${started.sessionId}-attempt-002`
  const staleProposal: RepairProposal = {
    ...structuredClone(request1Proposal),
    requestId: predictedRequest2,
  }
  const stale = resultEnvelope<AttemptResult>(
    await client.callTool({
      name: 'repair_submit',
      arguments: { sessionId: started.sessionId, proposal: staleProposal },
    }),
    'repair_submit'
  ).data
  assert.equal(stale.attempt.status, 'proposal-rejected')
  assert.equal(stale.terminal, null)

  const request2 = resultEnvelope<RepairRequest>(
    await client.callTool({
      name: 'repair_next',
      arguments: { sessionId: started.sessionId },
    }),
    'repair_next'
  ).data
  assert.equal(request2.requestId, predictedRequest2)
  errorEnvelope(
    await client.callTool({
      name: 'repair_submit',
      arguments: {
        sessionId: started.sessionId,
        proposal: request1Proposal,
      },
    }),
    'repair_submit',
    'mcp.submission-duplicate'
  )
  const pending = resultEnvelope<RepairSessionSnapshot>(
    await client.callTool({
      name: 'repair_status',
      arguments: { sessionId: started.sessionId },
    }),
    'repair_status'
  ).data
  assert.equal(pending.pendingRequestId, request2.requestId)
  assert.equal(pending.attemptsCompleted, 1)

  const repaired = resultEnvelope<AttemptResult>(
    await client.callTool({
      name: 'repair_submit',
      arguments: {
        sessionId: started.sessionId,
        proposal: benchmark.referenceProposal(request2),
      },
    }),
    'repair_submit'
  ).data
  assert.equal(repaired.attempt.status, 'repaired')
  assert.equal(repaired.terminal?.status, 'repaired')

  const terminal = resultEnvelope<RepairSessionSnapshot>(
    await client.callTool({
      name: 'repair_status',
      arguments: { sessionId: started.sessionId },
    }),
    'repair_status'
  ).data
  assert.equal(terminal.state, 'repaired')
  assert.equal(terminal.attemptsCompleted, 2)
  errorEnvelope(
    await client.callTool({
      name: 'repair_submit',
      arguments: {
        sessionId: started.sessionId,
        proposal: benchmark.referenceProposal(request2),
      },
    }),
    'repair_submit',
    'mcp.session-terminal'
  )

  errorEnvelope(
    await client.callTool({
      name: 'repair_export',
      arguments: {
        sessionId: started.sessionId,
        outputPath: join(outsideRoot, 'repaired.sb3'),
      },
    }),
    'repair_export',
    'mcp.output-outside-root'
  )
  const outputPath = join(outputRoot, 'repaired.sb3')
  const exported = resultEnvelope<{
    sessionId: string
    exported: true
    sha256: string
    byteLength: number
    recordedAt: string
  }>(
    await client.callTool({
      name: 'repair_export',
      arguments: { sessionId: started.sessionId, outputPath },
    }),
    'repair_export'
  ).data
  assert.equal(exported.exported, true)
  assert.equal(exported.sha256, terminal.terminal?.accepted?.sha256)
  assert.equal(exported.byteLength, readFileSync(outputPath).byteLength)
  const exportedBytes = readFileSync(outputPath)
  errorEnvelope(
    await client.callTool({
      name: 'repair_export',
      arguments: { sessionId: started.sessionId, outputPath },
    }),
    'repair_export',
    'mcp.output-exists'
  )
  assert.deepEqual(readFileSync(outputPath), exportedBytes)

  errorEnvelope(
    await client.callTool({
      name: 'repair_status',
      arguments: { sessionId: 'unknown-session' },
    }),
    'repair_status',
    'mcp.session-unknown'
  )
  errorEnvelope(
    await client.callTool({
      name: 'repair_status',
      arguments: { sessionId: 's'.repeat(8193) },
    }),
    'repair_status',
    'mcp.arguments-invalid'
  )

  const stdioTransport = new StdioClientTransport({
    command: process.execPath,
    args: [join(process.cwd(), 'packages/mcp/dist/transport/server.js')],
    cwd: process.cwd(),
    env: {
      ...getDefaultEnvironment(),
      SCRATCH_AGENT_INPUT_ROOT: inputRoot,
      SCRATCH_AGENT_OUTPUT_ROOT: outputRoot,
      SCRATCH_AGENT_ARTIFACT_ROOT: artifactRoot,
    },
    stderr: 'pipe',
  })
  let stderr = ''
  stdioTransport.stderr?.on('data', (chunk: Buffer) =>
  {
    stderr += chunk.toString('utf8')
  })
  const stdioClient = new Client({
    name: 'repair-stdio-purity-test',
    version: '1',
  })
  await stdioClient.connect(stdioTransport)
  t.after(() => stdioClient.close())
  const stdioStarted = resultEnvelope<{ caseId: string }>(
    await stdioClient.callTool({
      name: 'repair_start',
      arguments: { inputPath, caseId: 'R1' },
    }),
    'repair_start'
  ).data
  await new Promise<void>((resolve) => setImmediate(resolve))
  assert.equal(stdioStarted.caseId, 'R1')
  assert.doesNotMatch(stderr, /scratch-vm/)
  assert.ok(Buffer.byteLength(stderr, 'utf-8') < 64 * 1024)
})
