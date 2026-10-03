// tests/mcp/workbench-transport.test.ts
// protect actual workbench processes, ordered EOF drain & audit-independent cleanup

import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { execFile, spawn } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { PassThrough } from 'node:stream'
import { clearTimeout, setTimeout } from 'node:timers'
import { setTimeout as delay } from 'node:timers/promises'
import { pathToFileURL } from 'node:url'
import { promisify } from 'node:util'
import test from 'node:test'

import { PNG } from 'pngjs'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { ReadBuffer } from '@modelcontextprotocol/sdk/shared/stdio.js'
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js'
import type { JSONRPCMessage } from '@modelcontextprotocol/sdk/types.js'
import { blankProject } from '@scratch-agent/ir'
import {
  AUDIT_KEY_PURPOSE_V1,
  createAuthoringWorkspaceServiceV1,
  type AuditKeyMaterialV1,
} from '@scratch-agent/edit'
import {
  createEditArtifactStoreHostAdapter,
  evaluateAuthoringCandidateV3,
} from '@scratch-agent/eval'
import {
  BoundedStdioServerTransportV1,
  createAuthoringToolHostV1,
  createDevelopmentToolHostV1,
  createScratchMcpServer,
  createNativeAdmissionBudgetV1,
  authoringArtifactUriV1,
  developmentArtifactUriV1,
  developmentProfileAuthoritySha256V1,
  DurableEditArtifactCatalogueV1,
  DurableToolAuditJournalV1,
  EDIT_STATEFUL_RESPONSE_PROJECTOR_VERSION_V1,
  EditArtifactResourceStoreV1,
  productionEditProfileAuthoritySha256V1,
  verifyWorkbenchCallAuditV1,
  verifyNativeAdmissionBudgetV1,
  WorkbenchCallAuditV1,
  type DevelopmentToolHostV1,
  type AuthoringToolHostV1,
  type JsonlTransportTerminalV1,
} from '@scratch-agent/mcp'
import {
  createDevelopmentServiceV1,
  openProfileBrowserEngineV1,
  type DevelopmentEngineFactoryV1,
  type DevelopmentServiceV1,
  type ProfileBrowserEngineV1,
} from '@scratch-agent/runner'

test(
  'actual SDK snapshot paging verifies once, preserves drifted bytes and bounds live ownership',
  { timeout: 60000 },
  async (t) =>
  {
    const selected = await fixture(t)
    const live = await runtime(selected)
    const closeLive = live.host.closeAll?.bind(live.host)
    assert.ok(closeLive)
    t.after(closeLive)
    const opened = await live.host.call('development_begin', {
      sourcePath: selected.sourcePath,
      visible: false,
      inputMode: 'agent',
    })
    const sessionId = opened.sessionId as string
    const developmentBytes = Buffer.from(
      JSON.stringify({ payload: 'd'.repeat(40000) })
    )
    const developmentArtifact = await live.service.retainEvidence({
      sessionId,
      kind: 'clip',
      bytes: developmentBytes,
      mimeType: 'application/json',
    })
    const authoringEvidence = join(selected.root, 'snapshot-authoring')
    await mkdir(authoringEvidence)
    const manifestPath = join(selected.sources, 'snapshot-workspace.json')
    const manifestBytes = Buffer.from(
      JSON.stringify({
        schemaVersion: 2,
        baseline: { kind: 'greenfield' },
        targets: [{ id: 'stage', kind: 'stage', name: 'Stage' }],
        runtimeTargets: [],
        scenarios: [],
        assertions: [],
      }) + ' '.repeat(40000)
    )
    await writeFile(manifestPath, manifestBytes)
    const workspace = await createAuthoringWorkspaceServiceV1({
      permissions: {
        sourceRoots: [selected.sources],
        evidenceRoot: authoringEvidence,
        outputRoots: [selected.outputRoot],
      },
    })
    const authoring = createAuthoringToolHostV1(workspace)
    const authoringOpen = await authoring.call('authoring_open', {
      manifestPath,
    })
    const workspaceId = authoringOpen.workspaceId as string
    await authoring.call('authoring_plan', { workspaceId })
    const artifacts = await workspace.inspect({
      workspaceId,
      collection: 'artifacts',
    })
    const authoringArtifact = artifacts.items.find(
      (entry) =>
        entry &&
        typeof entry === 'object' &&
        'sha256' in entry &&
        entry.sha256 ===
          createHash('sha256').update(manifestBytes).digest('hex')
    ) as {
      key: string
      path: string
      sha256: string
      byteLength: number
      mimeType: string
    }
    assert.ok(authoringArtifact)
    let developmentLoads = 0,
      authoringLoads = 0,
      now = 1_000_000
    let foreignContinuation: string
    const developmentHost: DevelopmentToolHostV1 = {
      ...live.host,
      selectResourceSnapshot: async (...args) =>
      {
        const selection = await live.host.selectResourceSnapshot!(...args)
        return {
          ...selection,
          load: async () =>
          {
            developmentLoads++
            return selection.load()
          },
        }
      },
    }
    const authoringHost: AuthoringToolHostV1 = {
      ...authoring,
      selectResourceSnapshot: async (...args) =>
      {
        const selection = await authoring.selectResourceSnapshot!(...args)
        return {
          ...selection,
          load: async () =>
          {
            authoringLoads++
            return selection.load()
          },
        }
      },
    }
    const snapshotAudit = await WorkbenchCallAuditV1.create(
      join(selected.root, 'snapshot-audit'),
      developmentProfileAuthoritySha256V1()
    )
    const built = createScratchMcpServer(
      {
        inputRoot: selected.sources,
        outputRoot: selected.outputRoot,
        artifactRoot: selected.artifactRoot,
      },
      {
        profile: 'development-v1',
        developmentHost,
        authoringHost,
        resourceSnapshotClockV1: () => now,
        workbenchAudit: snapshotAudit,
      }
    )
    const client = new Client({
      name: 'verified-snapshot-workflow',
      version: '1',
    })
    const [clientWire, serverWire] = InMemoryTransport.createLinkedPair()
    await built.server.connect(serverWire)
    await client.connect(clientWire)
    const page = async (uri: string) =>
    {
      const result = await client.readResource({ uri })
      const item = result.contents[0]!
      assert.ok('text' in item)
      return JSON.parse(item.text) as {
        offset: number
        bytes: string
        nextUri: string | null
        snapshot: {
          snapshotId: string
          sha256: string
          byteLength: number
          verifiedAt: number
          idleExpiresAt: number
          absoluteExpiresAt: number
        }
      }
    }
    const developmentUri = developmentArtifactUriV1(
      sessionId,
      developmentArtifact.key,
      0,
      'snapshot-v1'
    )
    const authoringUri = authoringArtifactUriV1(
      workspaceId,
      authoringArtifact.key,
      0,
      'snapshot-v1'
    )
    try
    {
      const discovery = await developmentHost.call('development_inspect', {
        sessionId,
        collection: 'artifacts',
      })
      assert.match(JSON.stringify(discovery), /snapshotUri.*read=snapshot-v1/u)
      const starts = await Promise.all([
        page(developmentUri),
        page(authoringUri),
      ])
      foreignContinuation = starts[0]!.nextUri!
      assert.notEqual(
        starts[0]!.snapshot.snapshotId,
        starts[1]!.snapshot.snapshotId
      )
      assert.equal(starts[0]!.snapshot.byteLength, developmentBytes.byteLength)
      assert.equal(
        starts[0]!.snapshot.sha256,
        createHash('sha256').update(developmentBytes).digest('hex')
      )
      await assert.rejects(page(developmentUri), /two snapshots|capacity/u)
      assert.deepEqual([developmentLoads, authoringLoads], [1, 1])
      const mismatched = new URL(starts[0]!.nextUri!)
      mismatched.searchParams.set('offset', '0')
      await assert.rejects(page(mismatched.href), /offset|continuation/u)
      const wrongArtifact = new URL(starts[0]!.nextUri!)
      wrongArtifact.searchParams.set('key', 'other.json')
      await assert.rejects(page(wrongArtifact.href), /continuation|artifact/u)
      await writeFile(
        developmentArtifact.path,
        Buffer.alloc(developmentBytes.length, 120)
      )
      await writeFile(
        authoringArtifact.path,
        Buffer.alloc(manifestBytes.length, 121)
      )
      await assert.rejects(
        page(developmentArtifactUriV1(sessionId, developmentArtifact.key)),
        { data: { code: 'mcp.internal' } }
      )
      await assert.rejects(
        page(authoringArtifactUriV1(workspaceId, authoringArtifact.key)),
        { data: { code: 'mcp.internal' } }
      )
      await assert.rejects(
        live.host.readResource!(
          developmentArtifactUriV1(sessionId, developmentArtifact.key)
        ),
        { code: 'development.artifact_changed' }
      )
      await assert.rejects(
        authoring.readResource!(
          authoringArtifactUriV1(workspaceId, authoringArtifact.key)
        ),
        { code: 'authoring.artifact_changed' }
      )
      for (const [index, start] of starts.entries())
      {
        const chunks = [Buffer.from(start.bytes, 'base64')]
        let nextUri = start.nextUri
        while (nextUri)
        {
          const chunk = await page(nextUri)
          assert.equal(chunk.snapshot.snapshotId, start.snapshot.snapshotId)
          assert.equal(
            chunk.offset,
            chunks.reduce((sum, bytes) => sum + bytes.length, 0)
          )
          chunks.push(Buffer.from(chunk.bytes, 'base64'))
          nextUri = chunk.nextUri
        }
        assert.deepEqual(
          Buffer.concat(chunks),
          index === 0 ? developmentBytes : manifestBytes
        )
      }
      assert.deepEqual([developmentLoads, authoringLoads], [1, 1])
      now += 60_000
      await assert.rejects(page(starts[0]!.nextUri!), /expired/u)
      await writeFile(developmentArtifact.path, developmentBytes)
      await writeFile(authoringArtifact.path, manifestBytes)
      const absolute = await page(developmentUri)
      for (let index = 0; index < 10; index++)
      {
        now += 55_000
        const chunk = await page(absolute.nextUri!)
        assert.equal(
          chunk.snapshot.absoluteExpiresAt,
          absolute.snapshot.absoluteExpiresAt
        )
      }
      now += 50_000
      await assert.rejects(page(absolute.nextUri!), /expired/u)
      assert.deepEqual(await readFile(manifestPath), manifestBytes)
      assert.deepEqual(
        await readFile(selected.sourcePath),
        Buffer.from(selected.bytes)
      )
    }
    finally
    {
      await Promise.all([
        writeFile(developmentArtifact.path, developmentBytes),
        writeFile(authoringArtifact.path, manifestBytes),
      ])
      await client.close()
      await built.server.close()
      assert.equal((await built.closeOwnedResourcesV1()).complete, true)
    }

    // exact-size owned buffers expose payload admission before any expensive allocation
    let largeLoads = 0
    const entered = [deferred<void>(), deferred<void>(), deferred<void>()]
    const permits = [deferred<void>(), deferred<void>(), deferred<void>()]
    const sourceHash = (fill: number) =>
    {
      const hash = createHash('sha256'),
        bytes = Buffer.alloc(1024 * 1024, fill)
      for (let index = 0; index < 64; index++) hash.update(bytes)
      return hash.digest('hex')
    }
    const hashes = [1, 2, 3].map(sourceHash)
    const signals: AbortSignal[] = []
    const largeHost: DevelopmentToolHostV1 = {
      call: async () => ({}),
      selectResourceSnapshot: async (uri, context) =>
      {
        const key = new URL(uri).searchParams.get('key')!
        const index = ['large-a.json', 'large-b.json', 'large-c.json'].indexOf(
          key
        )
        const size =
          key === 'oversized.json' ? 64 * 1024 * 1024 + 1 : 64 * 1024 * 1024
        return {
          artifact: {
            sessionId,
            key,
            sha256: hashes[Math.max(0, index)]!,
            byteLength: size,
            mimeType: 'application/json',
          },
          load: async () =>
          {
            largeLoads++
            const bytes = Buffer.allocUnsafeSlow(size).fill(index + 1)
            signals.push(context!.signal!)
            entered[index]!.done()
            await permits[index]!.promise
            return bytes
          },
        }
      },
    }
    const largeArtifactRoot = join(selected.root, 'large-artifacts')
    await mkdir(largeArtifactRoot)
    const largeAudit = await WorkbenchCallAuditV1.create(
      join(selected.root, 'large-snapshot-audit'),
      developmentProfileAuthoritySha256V1()
    )
    const largeServer = createScratchMcpServer(
      {
        inputRoot: selected.sources,
        outputRoot: selected.outputRoot,
        artifactRoot: largeArtifactRoot,
      },
      {
        profile: 'development-v1',
        developmentHost: largeHost,
        resourceSnapshotClockV1: () => now,
        workbenchAudit: largeAudit,
      }
    )
    const largeClient = new Client({
      name: 'snapshot-capacity-workflow',
      version: '1',
    })
    const [largeClientWire, largeServerWire] =
      InMemoryTransport.createLinkedPair()
    await largeServer.server.connect(largeServerWire)
    await largeClient.connect(largeClientWire)
    const largeUri = (key: string) =>
      developmentArtifactUriV1(sessionId, key, 0, 'snapshot-v1')
    try
    {
      await assert.rejects(
        largeClient.readResource({ uri: largeUri('oversized.json') }),
        /64-MiB|bound/u
      )
      assert.equal(largeLoads, 0)
      const first = largeClient.readResource({ uri: largeUri('large-a.json') })
      const second = largeClient.readResource({ uri: largeUri('large-b.json') })
      await bounded(
        Promise.all([entered[0]!.promise, entered[1]!.promise]),
        5000
      )
      await assert.rejects(
        largeClient.readResource({ uri: largeUri('large-c.json') }),
        /two snapshots|capacity/u
      )
      assert.equal(largeLoads, 2)
      permits[0]!.done()
      permits[1]!.done()
      const results = await Promise.all([first, second])
      const body = results.map((result) =>
        JSON.parse((result.contents[0] as { text: string }).text)
      )
      assert.deepEqual(
        body.map((value) => value.snapshot.byteLength),
        [64 * 1024 * 1024, 64 * 1024 * 1024]
      )
      assert.deepEqual(
        body.map((value) => Buffer.from(value.bytes, 'base64')),
        [Buffer.alloc(16384, 1), Buffer.alloc(16384, 2)]
      )
      await assert.rejects(
        largeClient.readResource({ uri: foreignContinuation }),
        /expired/u
      )
      now += 60_000
      await assert.rejects(
        largeClient.readResource({ uri: body[0].nextUri }),
        /expired/u
      )
      const pending = largeClient
        .readResource({ uri: largeUri('large-c.json') })
        .then(
          (value) => ({ value, error: null }),
          (error: unknown) => ({ value: null, error })
        )
      await bounded(entered[2]!.promise, 5000)
      const cleanup = largeServer.closeOwnedResourcesV1()
      assert.equal(signals[2]!.aborted, true)
      permits[2]!.done()
      assert.equal((await bounded(cleanup)).complete, true)
      const late = await pending
      assert.equal(late.value, null)
      assert.match(String(late.error), /closed|cancel/u)
      assert.equal(largeLoads, 3)
    }
    finally
    {
      for (const permit of permits) permit.done()
      await largeClient.close()
      await largeServer.server.close()
    }
  }
)

function deferred<T>()
{
  let done!: (value: T) => void
  const promise = new Promise<T>((resolveValue) =>
  {
    done = resolveValue
  })
  return { promise, done }
}

async function bounded<T>(operation: Promise<T>, milliseconds = 18000)
{
  let timer: ReturnType<typeof setTimeout> | undefined
  try
  {
    return await Promise.race([
      operation,
      new Promise<never>((_, reject) =>
      {
        timer = setTimeout(
          () =>
            reject(new Error('workbench lifecycle exceeded its test deadline')),
          milliseconds
        )
      }),
    ])
  }
  finally
  {
    if (timer) clearTimeout(timer)
  }
}

async function fixture(t: test.TestContext)
{
  const root = await mkdtemp(join(tmpdir(), 'scratch-workbench-transport-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const sources = join(root, 'sources')
  const evidence = join(root, 'evidence')
  const outputRoot = join(root, 'output')
  const artifactRoot = join(root, 'artifacts')
  await Promise.all(
    [sources, evidence, outputRoot, artifactRoot].map((path) => mkdir(path))
  )
  const project = blankProject()
  const player = project.addSprite('Player')
  player.addCostume({ ...project.stage!.raw.costumes[0]!, name: 'idle' })
  player.addScript([
    { opcode: 'event_whenflagclicked' },
    { opcode: 'motion_changexby', inputs: { DX: 1 } },
  ])
  const bytes = await project.toSb3()
  const sourcePath = join(sources, 'playable.sb3')
  await writeFile(sourcePath, bytes)
  return {
    root,
    sources,
    evidence,
    outputRoot,
    artifactRoot,
    sourcePath,
    bytes,
  }
}

async function runtime(
  selected: Awaited<ReturnType<typeof fixture>>,
  factory?: DevelopmentEngineFactoryV1
)
{
  const engines: ProfileBrowserEngineV1[] = []
  const service = await createDevelopmentServiceV1({
    permissions: {
      sourceRoots: [selected.sources],
      evidenceRoot: selected.evidence,
    },
    engineFactory: async (options) =>
    {
      const engine = await (factory ?? openProfileBrowserEngineV1)(options)
      engines.push(engine)
      return engine
    },
  })
  return { service, engines, host: createDevelopmentToolHostV1(service) }
}

function toolData(result: Awaited<ReturnType<Client['callTool']>>)
{
  assert.notEqual(result.isError, true)
  const envelope = result.structuredContent as {
    ok: boolean
    data: Record<string, unknown>
  }
  assert.equal(envelope.ok, true)
  return envelope.data
}

async function hold(client: Client, sourcePath: string)
{
  const opened = toolData(
    await client.callTool({
      name: 'development_begin',
      arguments: {
        sourcePath,
        visible: false,
        inputMode: 'agent',
        profile: {
          schemaVersion: 1,
          runtime: 'scratch-official',
          scheduler: 'deterministic',
          tickRate: 30,
        },
      },
    })
  )
  assert.equal(typeof opened.sessionId, 'string')
  const sessionId = opened.sessionId as string
  toolData(
    await client.callTool({
      name: 'development_command',
      arguments: { sessionId, command: { kind: 'start' } },
    })
  )
  toolData(
    await client.callTool({
      name: 'development_command',
      arguments: {
        sessionId,
        command: {
          kind: 'input',
          input: { device: 'keyboard', key: 'a', isDown: true },
        },
      },
    })
  )
  return sessionId
}

async function assertReleased(
  service: DevelopmentServiceV1,
  sessionId: string,
  engine: ProfileBrowserEngineV1
)
{
  assert.equal(engine.page.isClosed(), true)
  const retained = await service.retainedTrace({ sessionId })
  const keys = retained.trace.inputs.filter(
    (input) => input.device === 'keyboard'
  )
  assert.ok(keys.some((input) => input.data.isDown === true))
  assert.ok(
    keys.some(
      (input) => input.source === 'cleanup' && input.data.isDown === false
    )
  )
  assert.ok(
    keys.every(
      (input, index) => index === 0 || input.order > keys[index - 1]!.order
    )
  )
  assert.ok(['closed', 'cancelled'].includes(retained.status.status))
}

test(
  'actual CLI profile selection, startup and pending browser work terminate on signals and EOF',
  { timeout: 90000 },
  async (t) =>
  {
    for (const mode of [
      'startup-signal',
      'startup-eof',
      'pending-signal',
      'playtest-default',
      'playtest-profile',
      'playtest-conflict',
    ])
    {
      const playtest = mode.startsWith('playtest')
      const profile =
        mode === 'playtest-profile' || mode === 'playtest-conflict'
          ? {
              schemaVersion: 1,
              runtime: 'turbowarp',
              scheduler: 'deterministic',
              tickRate: 60,
            }
          : {
              schemaVersion: 1,
              runtime: 'scratch-official',
              scheduler:
                mode === 'playtest-default' ? 'natural' : 'deterministic',
              tickRate: 30,
            }
      const selected = await fixture(t)
      const config = join(selected.root, 'operator.json')
      await writeFile(
        config,
        JSON.stringify({
          schemaVersion: 1,
          permissions: {
            sourceRoots: [selected.sources],
            evidenceRoot: selected.evidence,
          },
        })
      )
      const entered = join(selected.root, 'entered')
      const closed = join(selected.root, 'browser-closed')
      const driver = join(selected.root, 'driver.mjs')
      const cliUrl = pathToFileURL(resolve('scripts/development/cli.ts')).href
      await writeFile(
        driver,
        `import {writeFileSync} from 'node:fs';
import {runDevelopmentCliV1} from ${JSON.stringify(cliUrl)};
import {openProfileBrowserEngineV1} from ${JSON.stringify(import.meta.resolve('@scratch-agent/runner'))};
await runDevelopmentCliV1({engineFactory: async options => {
  if (${JSON.stringify(playtest)}) writeFileSync(${JSON.stringify(entered)}, JSON.stringify(options.profile));
  const engine = await openProfileBrowserEngineV1(options);
  engine.page.once('close', () => writeFileSync(${JSON.stringify(closed)}, 'closed'));
  if (${JSON.stringify(mode)}.startsWith('startup')) {
    writeFileSync(${JSON.stringify(entered)}, 'opening');
    await new Promise(() => {});
  }
  const advance = engine.advance.bind(engine);
  return Object.assign(engine, {advance: async ticks => {
    if (ticks === 17) {
      writeFileSync(${JSON.stringify(entered)}, 'advancing');
      await engine.page.evaluate(() => new Promise(() => {}));
    }
    return advance(ticks);
  }});
}}).catch(error => {process.stderr.write(JSON.stringify({ok:false,message:String(error)})+'\\n');process.exitCode=1});
`
      )
      const child = spawn(
        process.execPath,
        [
          '--import',
          'tsx',
          driver,
          playtest ? 'playtest' : 'debug',
          '--input',
          selected.sourcePath,
          '--host-config',
          config,
          '--visible',
          'false',
          ...(mode === 'playtest-default'
            ? []
            : ['--profile', JSON.stringify(profile)]),
          ...(mode === 'playtest-conflict' ? ['--preset', 'official30'] : []),
        ],
        { cwd: process.cwd(), stdio: ['pipe', 'pipe', 'pipe'] }
      )
      const exit = new Promise<{
        code: number | null
        signal: NodeJS.Signals | null
      }>((done, reject) =>
      {
        child.once('error', reject)
        child.once('exit', (code, signal) => done({ code, signal }))
      })
      t.after(() =>
      {
        if (child.exitCode === null && child.signalCode === null)
          child.kill('SIGKILL')
      })
      let output = ''
      let errors = ''
      child.stdout.on('data', (chunk: Buffer) =>
      {
        output += chunk.toString()
        assert.ok(output.length < 1024 * 1024)
      })
      child.stderr.on('data', (chunk: Buffer) =>
      {
        errors += chunk.toString()
        assert.ok(errors.length < 1024 * 1024)
      })
      const session = deferred<string>()
      child.stdout.on('data', () =>
      {
        for (const line of output.split('\n').filter(Boolean))
        {
          try
          {
            const value = JSON.parse(line) as {
              sessionId?: unknown
              status?: unknown
            }
            if (typeof value.sessionId === 'string' && value.status === 'ready')
              session.done(value.sessionId)
          }
          catch
          {
            // wait for the complete stdout line
          }
        }
      })
      let sessionId: string | undefined
      if (mode === 'playtest-conflict')
      {
        const result = await bounded(exit, 10000)
        assert.equal(result.signal, null)
        assert.equal(result.code, 1)
        assert.match(
          errors,
          /begin requires exact source & supported bounded runtime options/u
        )
        assert.doesNotMatch(output, /"status":"ready"/u)
        await assert.rejects(readFile(entered), { code: 'ENOENT' })
        assert.deepEqual(
          await readFile(selected.sourcePath),
          Buffer.from(selected.bytes)
        )
        continue
      }
      if (mode === 'pending-signal' || playtest)
      {
        sessionId = await bounded(session.promise, 10000)
        if (playtest)
          child.stdin.write(`${JSON.stringify({ tool: 'close' })}\n`)
        else
          child.stdin.write(
            `${JSON.stringify({ kind: 'input', input: { device: 'keyboard', key: 'a', isDown: true } })}\n${JSON.stringify({ kind: 'advance', ticks: 17 })}\n`
          )
      }
      await bounded(
        (async () =>
        {
          for (let attempt = 0; attempt < 500; attempt++)
          {
            try
            {
              await readFile(entered)
              return
            }
            catch
            {
              await delay(20)
            }
          }
          throw new Error(
            `child never reached its controlled boundary: ${errors}`
          )
        })(),
        10000
      )
      const started = Date.now()
      if (mode === 'startup-eof') child.stdin.end()
      else if (!playtest)
        child.kill(mode === 'startup-signal' ? 'SIGTERM' : 'SIGINT')
      const result = await bounded(exit)
      assert.equal(result.signal, null)
      assert.ok(Date.now() - started < 17000)
      assert.equal(await readFile(closed, 'utf8'), 'closed')
      if (mode.startsWith('startup'))
      {
        assert.equal(result.code, 1)
        assert.match(errors, /cleanup incomplete|shutdown incomplete/u)
        assert.doesNotMatch(output, /"status":"running"/u)
      }
      else
      {
        assert.equal(result.code, 0, errors)
        assert.ok(sessionId)
        const reader = await createDevelopmentServiceV1({
          permissions: {
            sourceRoots: [selected.sources],
            evidenceRoot: selected.evidence,
          },
        })
        const retained = await reader.retainedTrace({ sessionId })
        const trace = retained.trace
        assert.equal(retained.status.status, playtest ? 'closed' : 'cancelled')
        assert.deepEqual(retained.status.profile, profile)
        assert.equal(retained.status.inputMode, playtest ? 'human' : 'agent')
        if (playtest)
          assert.deepEqual(JSON.parse(await readFile(entered, 'utf8')), profile)
        else
        {
          assert.ok(trace.inputs.some((input) => input.data.isDown === true))
          assert.ok(
            trace.inputs.some(
              (input) =>
                input.source === 'cleanup' && input.data.isDown === false
            )
          )
        }
      }
      assert.deepEqual(
        await readFile(selected.sourcePath),
        Buffer.from(selected.bytes)
      )
    }
    const selected = await fixture(t)
    const live = await runtime(selected)
    const opened = await live.host.call('development_begin', {
      sourcePath: selected.sourcePath,
      visible: false,
      inputMode: 'agent',
      profile: {
        schemaVersion: 1,
        runtime: 'scratch-official',
        scheduler: 'deterministic',
        tickRate: 30,
      },
    })
    const sessionId = opened.sessionId as string
    await live.host.call('development_command', {
      sessionId,
      command: { kind: 'start' },
    })
    const engine = live.engines[0]!
    const browser = engine.page.context().browser()
    assert.ok(browser)
    const originalClose = browser.close.bind(browser)
    browser.close = async () =>
    {
      throw new Error('controlled actual browser close rejection')
    }
    try
    {
      const cleanup = await bounded(live.host.closeAll!())
      assert.ok(cleanup)
      assert.equal(cleanup.complete, false)
      assert.ok(
        cleanup.issues.some((issue) =>
          issue.includes('runner.cleanup.incomplete')
        )
      )
      assert.ok(cleanup.liveSessionIds.includes(sessionId))
      assert.equal(engine.page.isClosed(), true)
      assert.equal(browser.isConnected(), true)
      assert.deepEqual(
        await readFile(selected.sourcePath),
        Buffer.from(selected.bytes)
      )
    }
    finally
    {
      browser.close = originalClose
      await originalClose()
    }
    assert.equal(browser.isConnected(), false)
  }
)

test(
  'real SDK EOF drains responses in request order and cancels hung held-input work',
  { timeout: 25000 },
  async (t) =>
  {
    for (const hung of [false, true])
    {
      const selected = await fixture(t)
      const entered = deferred<void>()
      const live = await runtime(selected, async (options) =>
      {
        const engine = await openProfileBrowserEngineV1(options)
        const advance = engine.advance.bind(engine)
        engine.advance = async (ticks) =>
        {
          if (hung && ticks === 17)
          {
            entered.done()
            await engine.page.evaluate(() => new Promise(() =>
            {}))
          }
          return advance(ticks)
        }
        return engine
      })
      const original = live.host.call.bind(live.host)
      let inspectCalls = 0
      const completionOrder: number[] = []
      const host: DevelopmentToolHostV1 = {
        ...live.host,
        call: async (name, input, context) =>
        {
          const ordinal = name === 'development_inspect' ? ++inspectCalls : 0
          if (ordinal === 1) await delay(150)
          const result = await original(name, input, context)
          if (ordinal) completionOrder.push(ordinal)
          return result
        },
      }
      const audit = await WorkbenchCallAuditV1.create(
        join(selected.root, 'audit'),
        developmentProfileAuthoritySha256V1()
      )
      const built = createScratchMcpServer(
        {
          inputRoot: selected.sources,
          outputRoot: selected.outputRoot,
          artifactRoot: selected.artifactRoot,
        },
        {
          profile: 'development-v1',
          developmentHost: host,
          workbenchAudit: audit,
        }
      )
      const stdin = new PassThrough()
      const stdout = new PassThrough()
      const buffer = new ReadBuffer()
      const messages: JSONRPCMessage[] = []
      const wire: Transport = {
        start: async () =>
        {
          stdout.on('data', (chunk: Buffer) =>
          {
            buffer.append(chunk)
            for (;;)
            {
              const message = buffer.readMessage()
              if (!message) break
              messages.push(message)
              wire.onmessage?.(message)
            }
          })
        },
        send: async (message) =>
        {
          stdin.write(`${JSON.stringify(message)}\n`)
        },
        close: async () =>
        {
          stdin.end()
          wire.onclose?.()
        },
      }
      const terminal = deferred<JsonlTransportTerminalV1>()
      const transport = new BoundedStdioServerTransportV1({
        stdin,
        stdout,
        eofDrainTimeoutMs: hung ? 100 : 600,
        onTerminal: (value) =>
        {
          built.terminalizeAudit(value.reason)
          terminal.done(value)
          wire.onclose?.()
        },
      })
      const client = new Client({ name: 'workbench-eof-test', version: '1' })
      await built.server.connect(transport)
      await client.connect(wire)
      t.after(async () =>
      {
        await client.close()
        await built.server.close()
      })
      const sessionId = await hold(client, selected.sourcePath)
      const before = messages.length
      if (hung)
      {
        const operation = client
          .callTool({
            name: 'development_command',
            arguments: { sessionId, command: { kind: 'advance', ticks: 17 } },
          })
          .then(
            () => 'resolved',
            () => 'rejected'
          )
        await bounded(entered.promise)
        stdin.end()
        const result = await bounded(terminal.promise)
        assert.equal(result.reason, 'stdin-end')
        assert.equal(result.drainTimedOut, true)
        assert.ok(result.pendingResponseCount > 0)
        assert.equal(await bounded(operation), 'rejected')
      }
      else
      {
        const first = client.callTool({
          name: 'development_inspect',
          arguments: { sessionId, collection: 'inputs' },
        })
        const second = client.callTool({
          name: 'development_inspect',
          arguments: { sessionId, collection: 'state' },
        })
        stdin.end()
        await bounded(Promise.all([first, second]))
        const result = await bounded(terminal.promise)
        assert.equal(result.drainTimedOut, false)
        assert.equal(result.pendingResponseCount, 0)
        assert.deepEqual(completionOrder, [2, 1])
        const responses = messages
          .slice(before)
          .filter((message) => 'result' in message)
        assert.equal(responses.length, 2)
        const collections = responses.map((message) =>
        {
          assert.ok('result' in message)
          const content = message.result.structuredContent
          assert.ok(content && typeof content === 'object')
          const data = (content as Record<string, unknown>).data
          assert.ok(data && typeof data === 'object')
          const collection = (data as Record<string, unknown>).collection
          assert.equal(typeof collection, 'string')
          return collection
        })
        assert.deepEqual(collections, ['inputs', 'state'])
      }
      assert.equal(
        (await bounded(built.closeOwnedResourcesV1())).complete,
        true
      )
      await assertReleased(live.service, sessionId, live.engines[0]!)
      assert.deepEqual(
        await readFile(selected.sourcePath),
        Buffer.from(selected.bytes)
      )
    }
  }
)

test(
  'audit capacity and post-effect persistence loss close actual held sessions without audited cleanup',
  { timeout: 25000 },
  async (t) =>
  {
    for (const failure of ['capacity', 'persistence'])
    {
      const selected = await fixture(t)
      const live = await runtime(selected)
      let injectFailure = false
      const audit = await WorkbenchCallAuditV1.create(
        join(selected.root, 'audit'),
        developmentProfileAuthoritySha256V1(),
        {
          ...(failure === 'capacity' ? { limits: { maxRecords: 6 } } : {}),
          beforePersistence: (entry) =>
          {
            if (
              injectFailure &&
              entry.phase === 'head' &&
              entry.kind === 'complete'
            )
              throw new Error(
                'controlled audit head failure after applied input'
              )
          },
        }
      )
      const built = createScratchMcpServer(
        {
          inputRoot: selected.sources,
          outputRoot: selected.outputRoot,
          artifactRoot: selected.artifactRoot,
        },
        {
          profile: 'development-v1',
          developmentHost: live.host,
          workbenchAudit: audit,
        }
      )
      const client = new Client({ name: 'workbench-audit-test', version: '1' })
      const [clientWire, serverWire] = InMemoryTransport.createLinkedPair()
      await built.server.connect(serverWire)
      await client.connect(clientWire)
      t.after(async () =>
      {
        await client.close()
        await built.server.close()
      })
      const sessionId = await hold(client, selected.sourcePath)
      injectFailure = failure === 'persistence'
      const failedCall = client
        .callTool({
          name: 'development_command',
          arguments: {
            sessionId,
            command:
              failure === 'capacity'
                ? { kind: 'pause' }
                : {
                    kind: 'input',
                    input: { device: 'keyboard', key: 'b', isDown: true },
                  },
          },
        })
        .then(
          () => 'resolved',
          () => 'rejected'
        )
      assert.equal(await bounded(failedCall), 'rejected')
      assert.equal(
        (await bounded(built.closeOwnedResourcesV1())).complete,
        true
      )
      await assertReleased(live.service, sessionId, live.engines[0]!)
      const status = audit.statusV1()
      assert.equal(status.failed, failure === 'persistence')
      if (failure === 'capacity')
      {
        assert.equal(status.incompleteCalls.length, 0)
        await verifyWorkbenchCallAuditV1(
          audit.directory,
          developmentProfileAuthoritySha256V1()
        )
      }
      else
      {
        assert.ok(status.incompleteCalls.length > 0)
        await assert.rejects(
          verifyWorkbenchCallAuditV1(
            audit.directory,
            developmentProfileAuthoritySha256V1()
          ),
          /head|tail|chain/u
        )
        const retained = await live.service.retainedTrace({ sessionId })
        assert.ok(
          retained.trace.inputs.some(
            (input) =>
              'interpretedKey' in input &&
              input.interpretedKey === 'B' &&
              input.data.key === 'b' &&
              input.data.isDown === true
          )
        )
      }
      assert.deepEqual(
        await readFile(selected.sourcePath),
        Buffer.from(selected.bytes)
      )
    }
  }
)

test(
  'SDK disconnect and authoring cancellation dispose work without hiding committed outcomes',
  { timeout: 90000 },
  async (t) =>
  {
    const selected = await fixture(t)
    await assertPreparationCancellation(selected)
    await assertCommittedCancellation(selected)
    const authoringEvidence = join(selected.root, 'authoring-evidence')
    await mkdir(authoringEvidence)
    const manifestPath = join(selected.sources, 'workspace.json')
    const manifestBytes = Buffer.from(
      JSON.stringify({
        schemaVersion: 2,
        baseline: { kind: 'greenfield' },
        targets: [{ id: 'stage', kind: 'stage', name: 'Stage' }],
        runtimeTargets: [
          {
            schemaVersion: 1,
            runtime: 'scratch-official',
            scheduler: 'natural',
            tickRate: 30,
          },
        ],
        scenarios: [
          {
            id: 'pending-native-clock',
            scenario: {
              seed: 0,
              maxTicks: 600,
              steps: [
                { do: 'greenFlag' },
                { do: 'wait', ticks: 600 },
                { do: 'snapshot', label: 'after-wait' },
              ],
            },
          },
        ],
        assertions: [],
      })
    )
    await writeFile(manifestPath, manifestBytes)
    let evaluationSignal: AbortSignal | undefined
    const workspace = await createAuthoringWorkspaceServiceV1({
      permissions: {
        sourceRoots: [selected.sources],
        evidenceRoot: authoringEvidence,
        outputRoots: [selected.outputRoot],
      },
      evaluate: (request) =>
      {
        evaluationSignal = request.signal
        return evaluateAuthoringCandidateV3(request)
      },
    })
    const authoring = createAuthoringToolHostV1(workspace)
    const opened = await authoring.call('authoring_open', { manifestPath })
    const workspaceId = opened.workspaceId
    assert.equal(typeof workspaceId, 'string')
    const plan = await authoring.call('authoring_plan', { workspaceId })
    const build = await authoring.call('authoring_build', {
      workspaceId,
      planId: plan.planId,
    })
    const live = await runtime(selected)
    const audit = await WorkbenchCallAuditV1.create(
      join(selected.root, 'audit'),
      developmentProfileAuthoritySha256V1()
    )
    const built = createScratchMcpServer(
      {
        inputRoot: selected.sources,
        outputRoot: selected.outputRoot,
        artifactRoot: selected.artifactRoot,
      },
      {
        profile: 'development-v1',
        developmentHost: live.host,
        authoringHost: authoring,
        workbenchAudit: audit,
      }
    )
    const client = new Client({
      name: 'workbench-authoring-disconnect',
      version: '1',
    })
    const [clientWire, serverWire] = InMemoryTransport.createLinkedPair()
    await built.server.connect(serverWire)
    await client.connect(clientWire)
    const execute = promisify(execFile)
    const browserPids = async () =>
    {
      const { stdout } = await execute('ps', ['-axo', 'pid,ppid,command'], {
        maxBuffer: 1024 * 1024,
      })
      return stdout.split('\n').flatMap((line) =>
      {
        const row = /^\s*(\d+)\s+(\d+)\s+(.+)$/u.exec(line)
        return row &&
          Number(row[2]) === process.pid &&
          /chrom(?:e|ium)|headless_shell/iu.test(row[3]!)
          ? [Number(row[1])]
          : []
      })
    }
    const before = new Set(await browserPids())
    const evaluation = authoring
      .call('authoring_evaluate', { workspaceId, buildId: build.buildId })
      .then(
        (value) => ({ value, error: null }),
        (error: unknown) => ({ value: null, error })
      )
    try
    {
      const browserPid = await bounded(
        (async () =>
        {
          for (let attempt = 0; attempt < 300; attempt++)
          {
            const pid = (await browserPids()).find(
              (value) => !before.has(value)
            )
            if (pid) return pid
            await delay(20)
          }
          throw new Error(
            'default authoring evaluator never opened its actual browser'
          )
        })(),
        10000
      )
      assert.ok(evaluationSignal)
      assert.equal(evaluationSignal.aborted, false)
      await client.close()
      const cleanup = await bounded(built.closeOwnedResourcesV1())
      assert.equal(cleanup.complete, true, cleanup.issues.join('; '))
      assert.equal(evaluationSignal.aborted, true)
      assert.equal((await browserPids()).includes(browserPid), false)
      const outcome = await bounded(evaluation)
      assert.notEqual(outcome.value?.disposition, 'accepted')
      assert.match(
        outcome.error === null
          ? JSON.stringify(outcome.value)
          : String(outcome.error),
        /cancel|abort|clos/u
      )
      const evaluations = await workspace.inspect({
        workspaceId: workspaceId as string,
        collection: 'evaluations',
      })
      for (const value of evaluations.items)
      {
        assert.ok(value && typeof value === 'object')
        const artifact = (value as Record<string, unknown>).artifact
        assert.ok(artifact && typeof artifact === 'object')
        const key = (artifact as Record<string, unknown>).key
        assert.equal(typeof key, 'string')
        const record = await workspace.readArtifact({
          workspaceId: workspaceId as string,
          key: key as string,
          maxBytes: 16 * 1024,
        })
        assert.equal(record.nextOffset, null)
        const retained = JSON.parse(Buffer.from(record.bytes).toString()) as {
          disposition: unknown
        }
        assert.equal(retained.disposition, 'refused')
      }
      assert.equal(
        (
          await workspace.inspect({
            workspaceId: workspaceId as string,
            collection: 'exports',
          })
        ).items.length,
        0
      )
      assert.deepEqual(await readFile(manifestPath), manifestBytes)
      assert.deepEqual(
        await readFile(selected.sourcePath),
        Buffer.from(selected.bytes)
      )
    }
    finally
    {
      await client.close()
      await built.server.close()
    }
  }
)

async function assertPreparationCancellation(
  selected: Awaited<ReturnType<typeof fixture>>
): Promise<void>
{
  const cpuEvidence = join(selected.root, 'cpu-evidence')
  const decoderEvidence = join(selected.root, 'decoder-evidence')
  const openEvidence = join(selected.root, 'open-evidence')
  await Promise.all([
    mkdir(cpuEvidence),
    mkdir(decoderEvidence),
    mkdir(openEvidence),
  ])
  const baseManifest = {
    schemaVersion: 2,
    baseline: { kind: 'greenfield' },
    targets: [{ id: 'stage', kind: 'stage', name: 'Stage' }],
    runtimeTargets: [],
    scenarios: [],
    assertions: [],
  }
  const cpuManifest = join(selected.sources, 'cpu-workspace.json')
  const image = new PNG({ width: 1, height: 1 })
  image.data.fill(255)
  const png = PNG.sync.write(image)
  await writeFile(join(selected.sources, 'cpu.png'), png)
  await writeFile(
    cpuManifest,
    JSON.stringify({
      ...baseManifest,
      assets: [
        {
          id: 'blocked-frame',
          kind: 'costume',
          source: { path: 'cpu.png' },
          pivot: { x: 0, y: 0 },
        },
      ],
    })
  )
  const wav = Buffer.alloc(52)
  wav.write('RIFF', 0)
  wav.writeUInt32LE(wav.length - 8, 4)
  wav.write('WAVEfmt ', 8)
  wav.writeUInt32LE(16, 16)
  wav.writeUInt16LE(1, 20)
  wav.writeUInt16LE(1, 22)
  wav.writeUInt32LE(8000, 24)
  wav.writeUInt32LE(16000, 28)
  wav.writeUInt16LE(2, 32)
  wav.writeUInt16LE(16, 34)
  wav.write('data', 36)
  wav.writeUInt32LE(8, 40)
  await writeFile(join(selected.sources, 'decoder.wav'), wav)
  const decoderManifest = join(selected.sources, 'decoder-workspace.json')
  await writeFile(
    decoderManifest,
    JSON.stringify({
      ...baseManifest,
      assets: [
        {
          id: 'resampled',
          kind: 'sound',
          source: { path: 'decoder.wav' },
          format: 'wav',
          sampleRate: 16000,
        },
      ],
    })
  )
  const decoderPidPath = join(selected.root, 'decoder.pid')
  const decoderPath = join(selected.root, 'bounded-decoder')
  await writeFile(
    decoderPath,
    `#!${process.execPath}
const { writeFileSync } = require('node:fs')
if (process.argv.includes('-version')) process.stdout.write('ffmpeg version bounded-cancellation-fixture\\n')
else {
  writeFileSync(${JSON.stringify(decoderPidPath)}, String(process.pid))
  process.stdin.resume()
  setTimeout(() => process.exit(99), 10000)
}
`,
    { mode: 0o700 }
  )
  const workerHook = join(selected.root, 'worker-cpu-hook.mjs')
  const sb3Url = import.meta.resolve('@scratch-agent/sb3')
  const assetWrapper = `
export * from ${JSON.stringify(sb3Url)}
import { AssetPipelineJobV2 as Original } from ${JSON.stringify(sb3Url)}
export class AssetPipelineJobV2 extends Original {
  async preparePngFrame(input) {
    process.stdout.write('WORKER_CPU_ENTERED\\n')
    const end = Date.now() + 10000
    while (Date.now() < end) {}
    return super.preparePngFrame(input)
  }
}
`
  await writeFile(
    workerHook,
    `
import { registerHooks } from 'node:module'
registerHooks({
  resolve(specifier, context, next) {
    if (specifier === '@scratch-agent/sb3' && context.parentURL?.endsWith('/workspace-worker-entry.js'))
      return { url: ${JSON.stringify(`data:text/javascript,${encodeURIComponent(assetWrapper)}`)}, shortCircuit: true }
    return next(specifier, context)
  }
})
`
  )
  const workerWrapper = `
export * from 'node:worker_threads'
import { Worker as Original } from 'node:worker_threads'
export class Worker extends Original {
  constructor(url, options) {
    const state = globalThis[Symbol.for('authoring-cancellation-fixture')]
    const blocked = options.workerData.request.kind === 'prepare' &&
      options.workerData.request.input.assets.some(({ asset }) => asset.id === 'blocked-frame')
    super(url, blocked ? {
      ...options, stdout: true,
      execArgv: [...(options.execArgv ?? process.execArgv), '--import', ${JSON.stringify(pathToFileURL(workerHook).href)}]
    } : options)
    state.live.add(this)
    this.once('exit', () => {
      state.live.delete(this)
      if (blocked) state.blockedExited = true
    })
    if (blocked) this.stdout.on('data', chunk => {
      if (chunk.toString().includes('WORKER_CPU_ENTERED')) state.entered()
    })
  }
}
`
  const evalUrl = import.meta.resolve('@scratch-agent/eval')
  const retentionWrapper = `
export * from ${JSON.stringify(evalUrl)}
import { createEditArtifactStoreHostAdapter as original } from ${JSON.stringify(evalUrl)}
export function createEditArtifactStoreHostAdapter(...args) {
  const adapter = original(...args)
  const compare = adapter.compareAndSwapPointer.bind(adapter)
  adapter.compareAndSwapPointer = async (...input) => {
    const result = await compare(...input)
    const state = globalThis[Symbol.for('authoring-cancellation-fixture')]
    if (input[0] === 'workspace.json' && input[1] === null && state.openAbort && !state.openCommitted) {
      state.openCommitted = true
      state.openAbort.abort(new Error('opening committed before cancellation'))
      throw new Error('injected post-commit opening I/O failure')
    }
    return result
  }
  return adapter
}
`
  const driverPath = join(selected.root, 'authoring-cancellation.mjs')
  const permissions = {
    sourceRoots: [selected.sources],
    evidenceRoot: cpuEvidence,
    outputRoots: [selected.outputRoot],
  }
  await writeFile(
    driverPath,
    `
import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'
import { registerHooks } from 'node:module'
import { setTimeout as delay } from 'node:timers/promises'
let entered
const entry = new Promise(resolve => { entered = resolve })
const state = { live: new Set(), entered, blockedExited: false, openCommitted: false }
globalThis[Symbol.for('authoring-cancellation-fixture')] = state
const hooks = registerHooks({
  resolve(specifier, context, next) {
    if (specifier === 'node:worker_threads' && context.parentURL?.endsWith('/workspace-worker-owner.js'))
      return { url: ${JSON.stringify(`data:text/javascript,${encodeURIComponent(workerWrapper)}`)}, shortCircuit: true }
    if (specifier === '@scratch-agent/eval' && context.parentURL?.endsWith('/workspace-retention.js'))
      return { url: ${JSON.stringify(`data:text/javascript,${encodeURIComponent(retentionWrapper)}`)}, shortCircuit: true }
    return next(specifier, context)
  }
})
const { createAuthoringWorkspaceServiceV1 } = await import(${JSON.stringify(import.meta.resolve('@scratch-agent/edit'))})
const { createAuthoringToolHostV1 } = await import(${JSON.stringify(import.meta.resolve('@scratch-agent/mcp'))})
const service = await createAuthoringWorkspaceServiceV1({ permissions: ${JSON.stringify(permissions)} })
const host = createAuthoringToolHostV1(service)
let decoderHost
let openHost
let heartbeat = 0
const timer = setInterval(() => heartbeat++, 2)
try {
  const openPermissions = { ...${JSON.stringify(permissions)}, evidenceRoot: ${JSON.stringify(openEvidence)} }
  const openService = await createAuthoringWorkspaceServiceV1({ permissions: openPermissions })
  openHost = createAuthoringToolHostV1(openService)
  state.openAbort = new AbortController()
  const committedOpen = await openHost.call('authoring_open', { manifestPath: ${JSON.stringify(cpuManifest)} }, { signal: state.openAbort.signal })
  assert.equal(state.openCommitted, true)
  assert.equal(state.openAbort.signal.aborted, true)
  assert.equal(typeof committedOpen.workspaceId, 'string')
  const resumed = await createAuthoringWorkspaceServiceV1({ permissions: openPermissions })
  const retainedOpen = await resumed.inspect({ workspaceId: committedOpen.workspaceId })
  assert.equal(retainedOpen.items[0].workspaceId, committedOpen.workspaceId)
  assert.equal(retainedOpen.items[0].closed, false)
  assert.equal(retainedOpen.items[0].plans, 0)
  assert.equal((await openHost.closeAll()).complete, true)

  const opened = await host.call('authoring_open', { manifestPath: ${JSON.stringify(cpuManifest)} })
  const workspaceId = opened.workspaceId
  const preabort = new AbortController()
  preabort.abort(new Error('pre-admission stop'))
  await assert.rejects(host.call('authoring_plan', { workspaceId }, { signal: preabort.signal }), { code: 'authoring.request_cancelled' })
  assert.equal(state.live.size, 0)
  const abort = new AbortController()
  const planning = host.call('authoring_plan', { workspaceId }, { signal: abort.signal })
  const refused = assert.rejects(planning, { code: 'authoring.request_cancelled' })
  await Promise.race([entry, delay(10000, undefined, { ref: false }).then(() => { throw new Error('admitted CPU worker never entered') })])
  const before = heartbeat
  await delay(30)
  assert.ok(heartbeat > before, 'owner event loop must stay responsive during pure CPU work')
  abort.abort(new Error('stop admitted CPU job'))
  await refused
  assert.equal(state.blockedExited, true)
  assert.equal(state.live.size, 0)
  for (const collection of ['plans', 'builds', 'evaluations', 'exports'])
    assert.equal((await service.inspect({ workspaceId, collection })).total, 0)
  await writeFile(${JSON.stringify(cpuManifest)}, JSON.stringify(${JSON.stringify(baseManifest)}))
  const lighter = await host.call('authoring_plan', { workspaceId })
  assert.equal(typeof lighter.planId, 'string')
  assert.equal((await service.inspect({ workspaceId, collection: 'plans' })).total, 1)
  assert.equal(state.live.size, 0)
  assert.equal((await host.closeAll()).complete, true)

  const decoderService = await createAuthoringWorkspaceServiceV1({ permissions: {
    ...${JSON.stringify(permissions)}, evidenceRoot: ${JSON.stringify(decoderEvidence)},
    ffmpeg: { executablePath: ${JSON.stringify(decoderPath)} }
  } })
  decoderHost = createAuthoringToolHostV1(decoderService)
  const decoded = await decoderHost.call('authoring_open', { manifestPath: ${JSON.stringify(decoderManifest)} })
  const decodeAbort = new AbortController()
  const decoding = decoderHost.call('authoring_plan', { workspaceId: decoded.workspaceId }, { signal: decodeAbort.signal })
  const decodeRefused = assert.rejects(decoding, error => /cancel/i.test(String(error)))
  let decoderPid
  for (let attempt = 0; attempt < 500; attempt++) {
    try { decoderPid = Number(await readFile(${JSON.stringify(decoderPidPath)}, 'utf8')); break }
    catch (error) { if (error.code !== 'ENOENT') throw error }
    await delay(10)
  }
  assert.ok(Number.isSafeInteger(decoderPid), 'configured decoder must start')
  assert.equal(state.live.size, 0, 'decoder runs after pure worker disposal')
  process.kill(decoderPid, 0)
  decodeAbort.abort(new Error('stop parent decoder'))
  await decodeRefused
  assert.throws(() => process.kill(decoderPid, 0), { code: 'ESRCH' })
  for (const collection of ['plans', 'builds', 'evaluations', 'exports'])
    assert.equal((await decoderService.inspect({ workspaceId: decoded.workspaceId, collection })).total, 0)
  const cleanup = await decoderHost.closeAll()
  assert.equal(cleanup.complete, true)
  assert.equal(cleanup.pendingCalls, 0)
  process.stdout.write('RESULT ' + JSON.stringify({ openReconciled: state.openCommitted, cpuExited: state.blockedExited, liveWorkers: state.live.size, decoderReaped: true, laterPlan: true }) + '\\n')
} finally {
  clearInterval(timer)
  await host.closeAll()
  await decoderHost?.closeAll()
  await openHost?.closeAll()
  hooks.deregister()
}
`
  )
  const { stdout } = await promisify(execFile)(process.execPath, [driverPath], {
    cwd: process.cwd(),
    timeout: 30000,
    maxBuffer: 64 * 1024,
  })
  const result = stdout.split('\n').find((line) => line.startsWith('RESULT '))
  assert.ok(result)
  assert.deepEqual(JSON.parse(result.slice(7)), {
    openReconciled: true,
    cpuExited: true,
    liveWorkers: 0,
    decoderReaped: true,
    laterPlan: true,
  })
  assert.deepEqual(await readFile(join(selected.sources, 'cpu.png')), png)
  assert.deepEqual(await readFile(join(selected.sources, 'decoder.wav')), wav)
}

async function assertCommittedCancellation(
  selected: Awaited<ReturnType<typeof fixture>>
): Promise<void>
{
  const evidenceRoot = join(selected.root, 'publication-cancellation')
  await mkdir(evidenceRoot)
  const manifestPath = join(selected.sources, 'publication-workspace.json')
  const manifestBytes = Buffer.from(
    JSON.stringify({
      schemaVersion: 2,
      baseline: { kind: 'greenfield' },
      targets: [{ id: 'stage', kind: 'stage', name: 'Stage' }],
      runtimeTargets: [],
      scenarios: [],
      assertions: [],
    })
  )
  await writeFile(manifestPath, manifestBytes)
  let host: AuthoringToolHostV1 | undefined
  let point: string | undefined
  let committed = false
  let interrupted: boolean
  const workspace = await createAuthoringWorkspaceServiceV1({
    permissions: {
      sourceRoots: [selected.sources],
      evidenceRoot,
      outputRoots: [selected.outputRoot],
    },
    publicationFaultHook: (at) =>
    {
      if (at === 'after-commit') committed = true
      if (at !== point || (at === 'after-state' && !committed)) return
      interrupted = true
      point = undefined
      void host!.closeAll!()
    },
  })
  const opened = await workspace.open({ manifestPath })
  const workspaceId = opened.workspaceId
  const plan = await workspace.plan({ workspaceId })
  const build = await workspace.build({ workspaceId, planId: plan.planId })
  const evaluated = await workspace.evaluate({
    workspaceId,
    buildId: build.buildId,
  })
  assert.equal(evaluated.disposition, 'accepted')
  const profileSha256 = productionEditProfileAuthoritySha256V1(
    EDIT_STATEFUL_RESPONSE_PROJECTOR_VERSION_V1,
    'standard-v2'
  )
  const principalSha256 = '1'.repeat(64)
  const editStoreRoot = join(selected.root, 'publication-edit-artifacts')
  const editStore = createEditArtifactStoreHostAdapter(editStoreRoot)
  const capability = await editStore.capability()
  const editArtifacts = new EditArtifactResourceStoreV1({
    principalIdentity: principalSha256,
    resourceSecret: new Uint8Array(32).fill(1),
    listingCursorSecret: new Uint8Array(32).fill(2),
    catalogue: new DurableEditArtifactCatalogueV1({
      storeRoot: editStoreRoot,
      expectedStoreId: capability.storeId,
      expectedOwnershipSha256: capability.ownershipSha256,
      principalIdentity: principalSha256,
    }),
  })
  const auditKey: AuditKeyMaterialV1 = {
    auditKeyId: 'audit_key_commit_cancellation_v1',
    algorithm: 'HMAC-SHA-256' as const,
    algorithmVersion: 1 as const,
    purpose: AUDIT_KEY_PURPOSE_V1,
    secret: new Uint8Array(32).fill(3),
  }
  for (const boundary of [
    'before-commit',
    'after-commit',
    'before-receipt',
    'after-state',
  ])
  {
    host = createAuthoringToolHostV1(workspace)
    const audit = await WorkbenchCallAuditV1.create(
      join(selected.root, `publication-${boundary}-audit`),
      profileSha256
    )
    const editRoot = join(selected.root, `publication-${boundary}-edit`)
    await mkdir(editRoot, { mode: 0o700 })
    const editJournal = await DurableToolAuditJournalV1.create({
      serverRoot: editRoot,
      storeKey: 'commit-cancellation',
      identity: {
        serverInstanceId: `server_${boundary}`,
        runId: `run_cancellation_${boundary}`,
        realmSha256: principalSha256,
        profileSha256,
        boundaryPolicySha256: profileSha256,
        predecessor: { state: 'absent' },
      },
      keys: {
        activeKey: async () => auditKey,
        verificationKey: async () => auditKey,
      },
    })
    const built = createScratchMcpServer(
      {
        inputRoot: selected.sources,
        outputRoot: selected.outputRoot,
        artifactRoot: selected.artifactRoot,
      },
      {
        profile: 'authoring-v1',
        editHost: {
          semanticAuthorityId: 'standard-v2',
          callEditTool: async () =>
            assert.fail('publication workflow must not call edit tools'),
        },
        editJournal,
        editArtifacts,
        authoringHost: host,
        workbenchAudit: audit,
      }
    )
    const client = new Client({
      name: 'authoring-commit-cancellation',
      version: '1',
    })
    const [clientWire, serverWire] = InMemoryTransport.createLinkedPair()
    await built.server.connect(serverWire)
    await client.connect(clientWire)
    const destinationPath = join(selected.outputRoot, `${boundary}.sb3`)
    point = boundary
    committed = false
    interrupted = false
    try
    {
      const outcome = toolData(
        await client.callTool({
          name: 'authoring_export',
          arguments: { workspaceId, buildId: build.buildId, destinationPath },
        })
      )
      assert.equal(interrupted, true)
      const cleanup = await host.closeAll!()
      assert.ok(cleanup)
      assert.equal(cleanup.complete, true)
      assert.equal(cleanup.pendingCalls, 0)
      if (boundary === 'before-commit')
      {
        assert.equal(committed, false)
        assert.equal(outcome.status, 'recovery-required')
        assert.equal(outcome.receipt, null)
        await assert.rejects(readFile(destinationPath), { code: 'ENOENT' })
        const recovered = await workspace.recoverExport({
          workspaceId,
          exportId: outcome.exportId as string,
        })
        assert.equal(recovered.status, 'complete')
      }
      else
      {
        assert.equal(committed, true)
        assert.equal(outcome.status, 'complete')
        assert.ok(outcome.receipt)
      }
      assert.equal(
        createHash('sha256')
          .update(await readFile(destinationPath))
          .digest('hex'),
        build.candidateSha256
      )
      const retained = await workspace.inspect({ workspaceId })
      assert.equal(
        (retained.items[0] as { pendingPublication: string | null })
          .pendingPublication,
        null
      )
      const verified = await verifyWorkbenchCallAuditV1(
        audit.directory,
        profileSha256
      )
      assert.equal(verified.matched, true)
    }
    finally
    {
      point = undefined
      await client.close()
      await built.server.close()
    }
  }
  assert.deepEqual(await readFile(manifestPath), manifestBytes)
}

test(
  'two real MCP processes share sixty-four durable admissions and drain final calls before owned cleanup',
  { timeout: 100000 },
  async (t) =>
  {
    for (const queuedOverflow of [false, true])
    {
      const selected = await fixture(t)
      const startedAtUnixMs = Date.now()
      const budget = await createNativeAdmissionBudgetV1({
        root: join(selected.root, 'native-budget'),
        runId: 'synthetic_native_admission_run_v1',
        startedAtUnixMs,
        workDeadlineUnixMs: startedAtUnixMs + 60000,
        hardDeadlineUnixMs: startedAtUnixMs + 75000,
      })
      const driver = join(selected.root, 'native-budget-server.mjs')
      await writeFile(
        driver,
        `
import assert from 'node:assert/strict'
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { createEditArtifactStoreHostAdapter } from ${JSON.stringify(import.meta.resolve('@scratch-agent/eval'))}
import {
  connectScratchMcpStdioV1, createScratchMcpServer,
  openNativeAdmissionBudgetV1, WorkbenchCallAuditV1,
  productionEditProfileAuthoritySha256V1, developmentProfileAuthoritySha256V1,
  EDIT_STATEFUL_RESPONSE_PROJECTOR_VERSION_V1, DurableToolAuditJournalV1,
  DurableEditArtifactCatalogueV1, EditArtifactResourceStoreV1
} from ${JSON.stringify(import.meta.resolve('@scratch-agent/mcp'))}
const profile = process.argv[2]
const root = process.argv[3]
const authoring = profile === 'authoring-v1'
const profileSha256 = authoring
  ? productionEditProfileAuthoritySha256V1(EDIT_STATEFUL_RESPONSE_PROJECTOR_VERSION_V1, 'standard-v2')
  : developmentProfileAuthoritySha256V1()
for (const name of ['effects', 'completed', 'output', 'artifacts', 'edit'])
  await mkdir(join(root, name), { mode: 0o700 })
const host = {
  async call(name, input, context) {
    const id = input[authoring ? 'workspaceId' : 'sessionId']
    assert.match(id, /^(authoring|development)-[a-f0-9]{32}$/)
    await writeFile(join(root, 'effects', id), JSON.stringify({ name, id }), { flag: 'wx' })
    if (id.endsWith('c'.repeat(32))) {
      assert.ok(context?.signal, 'SDK cancellation signal must reach the host')
      if (!context.signal.aborted)
        await new Promise(resolve => context.signal.addEventListener('abort', resolve, { once: true }))
      await writeFile(join(root, 'completed', id), 'cancelled', { flag: 'wx' })
      throw new Error('synthetic admitted request cancelled after disposal')
    }
    if (id.endsWith('f'.repeat(32))) {
      for (;;) {
        if (context?.signal?.aborted) throw new Error('admitted call was cancelled before release')
        try { await readFile(join(root, 'release')); break }
        catch (error) { if (error.code !== 'ENOENT') throw error }
        await delay(10)
      }
    }
    await writeFile(join(root, 'completed', id), 'complete', { flag: 'wx' })
    return { id, retained: true }
  },
  async closeAll() {
    const effects = await readdir(join(root, 'effects'))
    const completed = await readdir(join(root, 'completed'))
    const result = { complete: effects.length === completed.length, issues: [] }
    await writeFile(join(root, 'cleanup.json'), JSON.stringify({ ...result, effects, completed }))
    return result
  }
}
const workbenchAudit = await WorkbenchCallAuditV1.create(join(root, 'audit'), profileSha256)
const options = {
  profile, workbenchAudit,
  nativeAdmissionBudget: await openNativeAdmissionBudgetV1({
    root: ${JSON.stringify(budget.root)},
    manifestSha256: ${JSON.stringify(budget.manifestSha256)}, profile
  }),
  ...(authoring ? { authoringHost: host } : { developmentHost: host })
}
if (authoring) {
  const principalSha256 = '1'.repeat(64)
  const storeRoot = join(root, 'edit-artifacts')
  const store = createEditArtifactStoreHostAdapter(storeRoot)
  const capability = await store.capability()
  options.editHost = {
    semanticAuthorityId: 'standard-v2',
    callEditTool: async () => assert.fail('budget workflow does not execute semantic edits')
  }
  options.editArtifacts = new EditArtifactResourceStoreV1({
    principalIdentity: principalSha256,
    resourceSecret: new Uint8Array(32).fill(1),
    listingCursorSecret: new Uint8Array(32).fill(2),
    catalogue: new DurableEditArtifactCatalogueV1({
      storeRoot, expectedStoreId: capability.storeId,
      expectedOwnershipSha256: capability.ownershipSha256,
      principalIdentity: principalSha256
    })
  })
  const material = {
    auditKeyId: 'synthetic_native_admission_key', algorithm: 'HMAC-SHA-256',
    algorithmVersion: 1, purpose: 'server-audit-tail', secret: new Uint8Array(32).fill(3)
  }
  options.editJournal = await DurableToolAuditJournalV1.create({
    serverRoot: join(root, 'edit'), storeKey: 'native-budget',
    identity: {
      serverInstanceId: 'synthetic_authoring_server_v1', runId: 'synthetic_native_admission_run_v1',
      realmSha256: principalSha256, profileSha256, boundaryPolicySha256: profileSha256,
      predecessor: { state: 'absent' }
    },
    keys: { activeKey: async () => material, verificationKey: async () => material }
  })
}
const built = createScratchMcpServer({
  inputRoot: ${JSON.stringify(selected.sources)},
  outputRoot: join(root, 'output'), artifactRoot: join(root, 'artifacts')
}, options)
let finish
const terminal = new Promise(resolve => { finish = resolve })
await connectScratchMcpStdioV1(built, { onTerminal: finish })
const closed = await terminal
const cleanup = await built.closeOwnedResourcesV1()
await writeFile(join(root, 'terminal.json'), JSON.stringify({ closed, cleanup, auditDirectory: workbenchAudit.directory }))
await built.server.close()
process.stdin.destroy()
if (!cleanup.complete) process.exitCode = 1
`
      )
      const launch = async (profile: 'authoring-v1' | 'development-v1') =>
      {
        const root = join(selected.root, profile)
        await mkdir(root, { mode: 0o700 })
        const child = spawn(process.execPath, [driver, profile, root], {
          cwd: process.cwd(),
          stdio: ['pipe', 'pipe', 'pipe'],
        })
        const responses = new Map<
          number,
          (value: Record<string, unknown>) => void
        >()
        let serial = 0
        let stdout = ''
        let stderr = ''
        child.stderr.on('data', (chunk: Buffer) =>
        {
          stderr += chunk.toString('utf8')
          assert.ok(stderr.length < 1024 * 1024)
        })
        child.stdout.on('data', (chunk: Buffer) =>
        {
          stdout += chunk.toString('utf8')
          assert.ok(stdout.length < 1024 * 1024)
          for (;;)
          {
            const end = stdout.indexOf('\n')
            if (end < 0) break
            const value = JSON.parse(stdout.slice(0, end)) as Record<
              string,
              unknown
            >
            stdout = stdout.slice(end + 1)
            const response = responses.get(value.id as number)
            if (response)
            {
              responses.delete(value.id as number)
              response(value)
            }
          }
        })
        const exited = new Promise<{
          code: number | null
          signal: string | null
        }>((done) =>
          child.once('close', (code, signal) =>
          {
            for (const respond of responses.values())
              respond({ connectionClosed: true, stderr })
            responses.clear()
            done({ code, signal })
          })
        )
        t.after(async () =>
        {
          if (child.exitCode === null && child.signalCode === null)
            child.kill('SIGKILL')
          await exited
        })
        const batch = (
          requests: readonly { method: string; params?: unknown }[]
        ) =>
        {
          const frames: string[] = []
          const pending = requests.map((request) =>
          {
            const id = ++serial
            frames.push(JSON.stringify({ jsonrpc: '2.0', id, ...request }))
            return new Promise<Record<string, unknown>>((done) =>
              responses.set(id, done)
            )
          })
          child.stdin.write(`${frames.join('\n')}\n`)
          return pending
        }
        const request = (method: string, params?: unknown) =>
          batch([{ method, ...(params === undefined ? {} : { params }) }])[0]!
        const initialization = await bounded(
          request('initialize', {
            protocolVersion: '2024-11-05',
            capabilities: {},
            clientInfo: { name: 'native-budget-regression', version: '1' },
          }),
          15000
        )
        assert.ok(initialization.result, JSON.stringify(initialization))
        child.stdin.write(
          `${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`
        )
        return {
          profile,
          root,
          child,
          request,
          batch,
          exited,
          lastRequestId: () => serial,
          errors: () => stderr,
        }
      }
      const [authoring, development] = await Promise.all([
        launch('authoring-v1'),
        launch('development-v1'),
      ])
      const waitForFile = async (path: string) =>
      {
        for (let attempt = 0; attempt < 500; attempt++)
        {
          try
          {
            return await readFile(path)
          }
          catch (error)
          {
            if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
          }
          await delay(10)
        }
        assert.fail(`bounded child evidence did not arrive: ${path}`)
      }
      for (const server of [authoring, development])
        for (const method of ['ping', 'tools/list', 'resources/list'])
          assert.ok((await server.request(method)).result)
      assert.equal(
        (await verifyNativeAdmissionBudgetV1(budget)).admittedCount,
        0
      )
      const invalid = await authoring.request('tools/call', { name: 42 })
      assert.ok(invalid.error, JSON.stringify(invalid))
      const unknown = await development.request('tools/call', {
        name: 'unknown_tool',
        arguments: {},
      })
      assert.ok(unknown.error, JSON.stringify(unknown))
      const parameters = (server: typeof authoring, suffix: string) =>
      {
        const author = server.profile === 'authoring-v1'
        return {
          name: author ? 'authoring_inspect' : 'development_inspect',
          arguments: {
            collection: 'status',
            [author ? 'workspaceId' : 'sessionId']:
              `${author ? 'authoring' : 'development'}-${suffix}`,
          },
        }
      }
      const cancelled = development.request(
        'tools/call',
        parameters(development, 'c'.repeat(32))
      )
      const cancelledRequestId = development.lastRequestId()
      await waitForFile(
        join(development.root, 'effects', `development-${'c'.repeat(32)}`)
      )
      development.child.stdin.write(
        `${JSON.stringify({
          jsonrpc: '2.0',
          method: 'notifications/cancelled',
          params: {
            requestId: cancelledRequestId,
            reason: 'bounded synthetic cancellation',
          },
        })}\n`
      )
      await waitForFile(
        join(development.root, 'completed', `development-${'c'.repeat(32)}`)
      )
      assert.ok((await bounded(development.request('ping'), 15000)).result)
      const cancelledBudget = await verifyNativeAdmissionBudgetV1(budget)
      assert.equal(cancelledBudget.admittedCount, 3)
      assert.equal(cancelledBudget.completedCount, 3)
      for (let index = 0; index < 59; index++)
      {
        const server = index % 2 === 0 ? authoring : development
        const response = await server.request(
          'tools/call',
          parameters(server, index.toString(16).padStart(32, '0'))
        )
        assert.equal(
          toolData(response.result as Awaited<ReturnType<Client['callTool']>>)
            .retained,
          true
        )
      }
      assert.equal(
        (await verifyNativeAdmissionBudgetV1(budget)).admittedCount,
        62
      )
      const lastAuthoring = authoring.request(
        'tools/call',
        parameters(authoring, 'f'.repeat(32))
      )
      // the first run races both final slots; the second fixes queue order for overflow
      if (queuedOverflow)
        await waitForFile(
          join(authoring.root, 'effects', `authoring-${'f'.repeat(32)}`)
        )
      const finalRequests = [
        {
          method: 'tools/call',
          params: parameters(development, 'f'.repeat(32)),
        },
        ...(queuedOverflow
          ? [
              {
                method: 'tools/call',
                params: parameters(development, 'e'.repeat(32)),
              },
            ]
          : []),
      ]
      const [lastDevelopment, overflow] = development.batch(finalRequests)
      for (const server of [authoring, development])
      {
        const prefix =
          server.profile === 'authoring-v1' ? 'authoring' : 'development'
        await waitForFile(
          join(server.root, 'effects', `${prefix}-${'f'.repeat(32)}`)
        )
        await assert.rejects(readFile(join(server.root, 'cleanup.json')), {
          code: 'ENOENT',
        })
      }
      // budget exhaustion must outlive the ordinary two-second EOF drain
      await delay(2200)
      for (const server of [authoring, development])
        await assert.rejects(readFile(join(server.root, 'cleanup.json')), {
          code: 'ENOENT',
        })
      await Promise.all(
        [authoring, development].map((server) =>
          writeFile(join(server.root, 'release'), 'release')
        )
      )
      const finalReplies = await bounded(
        Promise.all([lastAuthoring, lastDevelopment!]),
        15000
      )
      for (const response of finalReplies)
        assert.equal(
          toolData(response.result as Awaited<ReturnType<Client['callTool']>>)
            .retained,
          true
        )
      if (overflow)
      {
        const rejectedOverflow = await bounded(overflow, 15000)
        assert.ok(rejectedOverflow.error || rejectedOverflow.connectionClosed)
      }
      for (const server of [authoring, development])
      {
        const exit = await bounded(server.exited, 15000)
        assert.equal(exit.signal, null, server.errors())
        assert.equal(exit.code, 0, server.errors())
        const cleanup = JSON.parse(
          await readFile(join(server.root, 'cleanup.json'), 'utf8')
        ) as { complete: boolean; effects: string[]; completed: string[] }
        assert.equal(cleanup.complete, true)
        assert.equal(cleanup.effects.length, 31)
        assert.deepEqual(cleanup.effects.sort(), cleanup.completed.sort())
        const terminal = JSON.parse(
          await readFile(join(server.root, 'terminal.json'), 'utf8')
        ) as {
          cleanup: { complete: boolean }
          auditDirectory: string
          closed: {
            reason: string
            drainTimedOut: boolean
            pendingResponseCount: number
            pendingWriteCount: number
            queuedOutboundFrames: number
            queuedOutboundBytes: number
          }
        }
        assert.equal(terminal.cleanup.complete, true)
        assert.deepEqual(terminal.closed, {
          reason: 'native-budget',
          errorCode: null,
          drainTimedOut: false,
          pendingResponseCount: 0,
          pendingWriteCount: 0,
          queuedOutboundFrames: 0,
          queuedOutboundBytes: 0,
        })
        const profileSha256 =
          server.profile === 'authoring-v1'
            ? productionEditProfileAuthoritySha256V1(
                EDIT_STATEFUL_RESPONSE_PROJECTOR_VERSION_V1,
                'standard-v2'
              )
            : developmentProfileAuthoritySha256V1()
        assert.equal(
          (
            await verifyWorkbenchCallAuditV1(
              terminal.auditDirectory,
              profileSha256
            )
          ).matched,
          true
        )
      }
      assert.equal((await cancelled).connectionClosed, true)
      const verified = await verifyNativeAdmissionBudgetV1(budget)
      assert.equal(verified.admittedCount, 64)
      assert.equal(verified.completedCount, 64)
      assert.equal(verified.overflow, queuedOverflow)
      assert.equal(verified.ok, !queuedOverflow)
      await assert.rejects(
        readFile(
          join(development.root, 'effects', `development-${'e'.repeat(32)}`)
        ),
        { code: 'ENOENT' }
      )
      assert.deepEqual(
        await readFile(selected.sourcePath),
        Buffer.from(selected.bytes)
      )
    }
  }
)
