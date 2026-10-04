// tests/runner/development-lifecycle.test.ts
// protect physical multiplayer input, fresh restart & retained cancellation cleanup

import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import { promises as fsPromises } from 'node:fs'
import {
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  writeFile,
} from 'node:fs/promises'
import { syncBuiltinESMExports } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { blankProject } from '@scratch-agent/ir'
import {
  DEVELOPMENT_TOOLS_V1,
  createDevelopmentToolHostV1,
  validateClosedJsonSchemaValueV1,
} from '@scratch-agent/mcp'
import {
  createDevelopmentServiceV1,
  DEVELOPMENT_LIMITS_V1,
  DevelopmentErrorV1,
  openProfileBrowserEngineV1,
  validateSelectedStateProbeV1,
  type DevelopmentInputRecordV1,
  type DevelopmentSegmentV1,
  type DevelopmentTraceV1,
  type DevelopmentTraceV2,
  type DevelopmentStatusV1,
  type ProfileBrowserEngineV1,
  type ProfileStateProbeV1,
  type RuntimeExecutionProfileV1,
} from '@scratch-agent/runner'

async function fixture(t: test.TestContext)
{
  const root = await mkdtemp(join(tmpdir(), 'scratch-development-lifecycle-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const sources = join(root, 'sources')
  const evidence = join(root, 'evidence')
  await Promise.all([mkdir(sources), mkdir(evidence)])
  const project = blankProject()
  const selectedVariables = Array.from({ length: 63 }, (_, index) =>
    project.stage!.addVariable(`probe-${index}`, index)
  )
  const selectedList = project.stage!.addList(
    'probe-items',
    Array.from({ length: 40 }, (_, index) => index)
  )
  const stageCostume = project.stage!.raw.costumes[0]!
  for (const [name, key] of [
    ['Player1', 'a'],
    ['Player2', 'right arrow'],
  ])
  {
    const actor = project.addSprite(name!)
    actor.addCostume({ ...stageCostume, name: 'idle' })
    actor.addScript([
      { opcode: 'event_whenflagclicked' },
      {
        opcode: 'motion_gotoxy',
        inputs: { X: 0, Y: 0 },
      },
      {
        opcode: 'control_forever',
        inputs: {
          SUBSTACK: {
            substack: [
              {
                opcode: 'control_if',
                inputs: {
                  CONDITION: {
                    boolean: {
                      opcode: 'sensing_keypressed',
                      inputs: { KEY_OPTION: key! },
                    },
                  },
                  SUBSTACK: {
                    substack: [
                      { opcode: 'motion_changexby', inputs: { DX: 1 } },
                    ],
                  },
                },
              },
            ],
          },
        },
      },
    ])
  }
  const bytes = await project.toSb3()
  const sourcePath = join(sources, 'two-local-players.sb3')
  await writeFile(sourcePath, bytes)
  return {
    sourcePath,
    sources,
    evidence,
    selectedVariables,
    selectedList,
    bytes,
    sha256: createHash('sha256').update(bytes).digest('hex'),
  }
}

async function positions(engine: ProfileBrowserEngineV1)
{
  const frame = await engine.observe()
  return ['Player1', 'Player2'].map((name) =>
  {
    const target = frame.targets.find((value) => value.name === name)
    assert.ok(target)
    return target.x
  })
}

test('both real clocks preserve simultaneous physical input, focus releases and fresh segments', async (t) =>
{
  const selected = await fixture(t)
  const traceLimit = DEVELOPMENT_LIMITS_V1.maxTraceBytes
  const terminalReserve = 2 * traceLimit + 1024 * 1024
  const startupHeadroom = 512 * 1024
  const retainedLimit =
    selected.bytes.byteLength + terminalReserve + 2 * startupHeadroom
  const engines: ProfileBrowserEngineV1[] = []
  t.after(async () =>
  {
    await Promise.all(engines.map((engine) => engine.close().catch(() =>
    {})))
  })
  for (const limits of [
    { maxRetainedArtifacts: 4 },
    {
      maxRetainedBytes:
        selected.bytes.byteLength + terminalReserve + startupHeadroom - 1,
    },
  ])
  {
    const insufficient = await createDevelopmentServiceV1({
      permissions: {
        sourceRoots: [selected.sources],
        evidenceRoot: selected.evidence,
        limits,
      },
      engineFactory: async () =>
        assert.fail(
          'undersized retention must refuse before browser acquisition'
        ),
    })
    await assert.rejects(
      insufficient.begin({ sourcePath: selected.sourcePath }),
      (error: unknown) =>
        error instanceof DevelopmentErrorV1 &&
        error.code === 'development.retention_budget_exceeded' &&
        error.message.includes(String(terminalReserve)) &&
        error.message.includes(String(startupHeadroom))
    )
  }
  const service = await createDevelopmentServiceV1({
    permissions: {
      sourceRoots: [selected.sources],
      evidenceRoot: selected.evidence,
      limits: { maxRetainedBytes: retainedLimit, maxRetainedArtifacts: 32 },
    },
    engineFactory: async (options) =>
    {
      const engine = await openProfileBrowserEngineV1(options)
      engines.push(engine)
      return engine
    },
  })
  const host = createDevelopmentToolHostV1(service)
  t.after(() => host.closeAll?.())
  const beginSchema = DEVELOPMENT_TOOLS_V1.find(
    (tool) => tool.name === 'development_begin'
  )!.inputSchema
  const boundaryProbe: ProfileStateProbeV1 = {
    maxListItems: 32,
    targets: [
      {
        targetIndex: 0,
        variableIds: selected.selectedVariables,
        listIds: [selected.selectedList],
      },
    ],
  }
  const targetBoundary: ProfileStateProbeV1 = {
    targets: Array.from({ length: 32 }, (_, targetIndex) => ({ targetIndex })),
  }
  for (const probe of [
    boundaryProbe,
    targetBoundary,
    { targets: [{ targetIndex: 999 }] },
  ])
  {
    assert.deepEqual(validateSelectedStateProbeV1(probe), probe)
    assert.deepEqual(
      validateClosedJsonSchemaValueV1(beginSchema, {
        sourcePath: selected.sourcePath,
        probe,
      }),
      []
    )
  }
  const invalidProbes: readonly {
    probe: ProfileStateProbeV1
    schemaRefuses: boolean
    code: 'development.invalid_probe' | 'development.invalid_shape'
  }[] = [
    {
      probe: { maxListItems: 33 },
      schemaRefuses: true,
      code: 'development.invalid_probe',
    },
    {
      probe: {
        targets: Array.from({ length: 33 }, (_, targetIndex) => ({
          targetIndex,
        })),
      },
      schemaRefuses: true,
      code: 'development.invalid_probe',
    },
    {
      probe: { targets: [{ targetIndex: 1000 }] },
      schemaRefuses: true,
      code: 'development.invalid_probe',
    },
    {
      probe: {
        targets: [
          {
            targetIndex: 0,
            variableIds: [
              selected.selectedVariables[0]!,
              selected.selectedVariables[0]!,
            ],
          },
        ],
      },
      schemaRefuses: true,
      code: 'development.invalid_probe',
    },
    {
      probe: { targets: [{ targetIndex: 0 }, { targetIndex: 0 }] },
      schemaRefuses: false,
      code: 'development.invalid_probe',
    },
    {
      probe: { targets: [{ targetIndex: 0, variableIds: ['\0'] }] },
      schemaRefuses: true,
      code: 'development.invalid_probe',
    },
    {
      probe: { targets: [{ targetIndex: 0, variableIds: [''] }] },
      schemaRefuses: true,
      code: 'development.invalid_probe',
    },
    {
      probe: {
        targets: [
          {
            targetIndex: 0,
            variableIds: selected.selectedVariables,
            listIds: [selected.selectedList],
          },
          { targetIndex: 1, variableIds: ['extra'] },
        ],
      },
      schemaRefuses: false,
      code: 'development.invalid_probe',
    },
    {
      probe: JSON.parse('null') as ProfileStateProbeV1,
      schemaRefuses: true,
      code: 'development.invalid_shape',
    },
    {
      probe: JSON.parse('{"maxListItems":null}') as ProfileStateProbeV1,
      schemaRefuses: true,
      code: 'development.invalid_probe',
    },
  ]
  for (const { probe, schemaRefuses, code } of invalidProbes)
  {
    assert.equal(
      validateClosedJsonSchemaValueV1(beginSchema, {
        sourcePath: selected.sourcePath,
        probe,
      }).length > 0,
      schemaRefuses
    )
    await assert.rejects(
      service.begin({ sourcePath: selected.sourcePath, probe }),
      (error: unknown) =>
        error instanceof DevelopmentErrorV1 && error.code === code
    )
  }
  assert.equal(engines.length, 0)
  let recordedStatus: DevelopmentStatusV1 | null = null
  for (const [runtime, tickRate] of [
    ['scratch-official', 30],
    ['turbowarp', 60],
  ] as const)
  {
    const profile: RuntimeExecutionProfileV1 = {
      schemaVersion: 1,
      runtime,
      scheduler: 'deterministic',
      tickRate,
    }
    const beginRequest = {
      sourcePath: selected.sourcePath,
      expectedSourceSha256: selected.sha256,
      profile,
      inputMode: 'human' as const,
      visible: false,
    }
    const begin =
      runtime === 'turbowarp'
        ? ((await host.call(
            'development_begin',
            beginRequest
          )) as unknown as DevelopmentStatusV1)
        : await service.begin(beginRequest)
    const sessionId = begin.sessionId
    let engine = engines.at(-1)!
    await engine.configureProbe(boundaryProbe)
    const selectedState = await engine.observe()
    assert.equal(selectedState.targets.length, 1)
    assert.equal(Object.keys(selectedState.targets[0]!.variables).length, 63)
    assert.equal(
      selectedState.targets[0]!.lists[selected.selectedList]!.length,
      40
    )
    assert.equal(
      selectedState.targets[0]!.lists[selected.selectedList]!.items.length,
      32
    )
    for (const { probe } of invalidProbes)
    {
      await assert.rejects(engine.configureProbe(probe))
      await assert.rejects(engine.observe(probe))
    }
    const unchangedState = await engine.observe()
    assert.equal(unchangedState.tick, selectedState.tick)
    assert.equal(unchangedState.drawEpoch, selectedState.drawEpoch)
    assert.deepEqual(unchangedState.targets, selectedState.targets)
    await engine.configureProbe({})
    await engine.page
      .getByRole('button', { name: 'Start', exact: true })
      .click()
    await engine.page.waitForFunction(
      "window.__projectDebug.status().status === 'running'"
    )
    await engine.page.locator('canvas').first().click()
    await service.command({ sessionId, command: { kind: 'advance', ticks: 1 } })
    await engine.page.keyboard.down('a')
    await engine.page.keyboard.down('ArrowRight')
    const advanced = await service.command({
      sessionId,
      command: { kind: 'advance', ticks: 6 },
    })
    assert.equal(advanced.tick, 7)
    const moved = await positions(engine)
    assert.ok(moved[0]! > 0)
    assert.equal(moved[0], moved[1])
    const inputPage = await service.inspect({ sessionId, collection: 'inputs' })
    const humanPresses = (
      inputPage.items as readonly DevelopmentInputRecordV1[]
    ).filter(
      (value) =>
        value.source === 'human' &&
        value.device === 'keyboard' &&
        value.data.isDown === true
    )
    assert.equal(humanPresses.length, 2)
    assert.equal(humanPresses[0]!.data.key, 'a')
    assert.equal(humanPresses[0]!.data.keyCode, 65)
    assert.equal(humanPresses[1]!.data.key, 'ArrowRight')
    assert.equal(humanPresses[1]!.data.keyCode, 39)
    assert.ok(humanPresses[0]!.order < humanPresses[1]!.order)
    assert.equal(humanPresses[0]!.tick, 1)
    assert.equal(humanPresses[1]!.tick, 1)
    await engine.page.evaluate("window.dispatchEvent(new Event('blur'))")
    await service.command({ sessionId, command: { kind: 'advance', ticks: 3 } })
    assert.deepEqual(await positions(engine), moved)
    const released = await service.inspect({ sessionId, collection: 'inputs' })
    assert.equal(
      (released.items as readonly DevelopmentInputRecordV1[]).filter(
        (value) =>
          value.source === 'focus-release' && value.data.isDown === false
      ).length,
      2
    )
    assert.deepEqual((await engine.status()).heldKeys, [])
    await engine.page
      .getByRole('button', { name: 'Pause', exact: true })
      .click()
    await engine.page.waitForFunction(
      "window.__projectDebug.status().status === 'paused'"
    )
    await assert.rejects(
      service.command({
        sessionId,
        command: { kind: 'advance', ticks: 1 },
      })
    )
    await engine.page
      .getByRole('button', { name: 'Resume', exact: true })
      .click()
    await engine.page.waitForFunction(
      "window.__projectDebug.status().status === 'running'"
    )
    const oldPage = engine.page
    const restarted = await service.command({
      sessionId,
      command: { kind: 'restart' },
    })
    assert.equal(restarted.status, 'running')
    assert.equal(restarted.tick, 0)
    assert.equal(oldPage.isClosed(), true)
    engine = engines.at(-1)!
    assert.deepEqual(await positions(engine), [0, 0])
    const segments = await service.inspect({
      sessionId,
      collection: 'segments',
    })
    assert.equal(segments.items.length, 2)
    const segmentRecords = segments.items as readonly DevelopmentSegmentV1[]
    assert.notEqual(segmentRecords[0]!.segmentId, segmentRecords[1]!.segmentId)
    assert.ok(
      segmentRecords.every(
        (segment) => segment.sourceSha256 === selected.sha256
      )
    )
    await engine.page.keyboard.down('a')
    await service.inspect({ sessionId })
    const sessionEvidenceRoot = await realpath(
      join(selected.evidence, sessionId)
    )
    const catalogPath = join(sessionEvidenceRoot, 'index.json')
    const readCatalog = async () =>
      JSON.parse(await readFile(catalogPath, 'utf8')) as {
        schemaVersion: number
        policy: {
          limits: {
            maxTraceBytes: number
            maxRetainedBytes: number
            maxRetainedArtifacts: number
          }
        }
        terminal: {
          slots: number
          bytes: number
          state: string
          checkpointKey: string | null
        }
        artifacts: { key: string; byteLength: number }[]
      }
    const beforeFill = await readCatalog()
    assert.equal(beforeFill.schemaVersion, 2)
    assert.equal(beforeFill.terminal.state, 'reserved')
    assert.equal(beforeFill.terminal.slots, 3)
    assert.equal(beforeFill.terminal.bytes, terminalReserve)
    const writers = await Promise.all(
      [0, 1].map(() =>
        createDevelopmentServiceV1({
          permissions: {
            sourceRoots: [selected.sources],
            evidenceRoot: selected.evidence,
            limits: { maxTraceBytes: traceLimit / 2 },
          },
        })
      )
    )
    const evidence = (bytes: number) =>
    {
      const value = Buffer.alloc(bytes, 'x')
      value[0] = 34
      value[bytes - 1] = 34
      return {
        sessionId,
        kind: 'clip' as const,
        mimeType: 'application/json' as const,
        bytes: value,
      }
    }
    let parts: readonly number[]
    if (runtime === 'scratch-official')
    {
      const remaining =
        retainedLimit -
        terminalReserve -
        beforeFill.artifacts.reduce((sum, ref) => sum + ref.byteLength, 0)
      parts = [Math.floor(remaining / 2), remaining - Math.floor(remaining / 2)]
    }
    else
    {
      const ordinarySlots = 32 - 3 - beforeFill.artifacts.length
      assert.ok(ordinarySlots >= 2)
      for (let index = 0; index < ordinarySlots - 2; index++)
        await writers[index % 2]!.retainEvidence(evidence(2))
      parts = [2, 2]
    }
    const requests = parts.map(evidence)
    const writes = await Promise.allSettled(
      writers.map((writer, index) => writer.retainEvidence(requests[index]!))
    )
    for (const [index, outcome] of writes.entries())
      if (outcome.status === 'rejected')
      {
        assert.ok(outcome.reason instanceof DevelopmentErrorV1)
        assert.equal(outcome.reason.code, 'development.evidence_writer_busy')
        await writers[index]!.retainEvidence(requests[index]!)
      }
    await assert.rejects(
      writers[0]!.retainEvidence(evidence(2)),
      (error: unknown) =>
        error instanceof DevelopmentErrorV1 &&
        error.code === 'development.retention_budget_exceeded'
    )
    const filled = await readCatalog()
    assert.equal(filled.terminal.state, 'reserved')
    assert.equal(filled.policy.limits.maxTraceBytes, traceLimit)
    assert.equal(filled.terminal.bytes, terminalReserve)
    const originalRename = fsPromises.rename
    const originalUnlink = fsPromises.unlink
    let reconciledRename = false
    let refusedLockCleanup = false
    if (runtime === 'turbowarp')
    {
      fsPromises.rename = async (from, to) =>
      {
        await originalRename(from, to)
        if (
          String(to) === catalogPath &&
          (await readCatalog()).terminal.state === 'committed'
        )
        {
          reconciledRename = true
          throw new Error('injected failure after terminal catalog rename')
        }
      }
      fsPromises.unlink = async (path) =>
      {
        if (
          reconciledRename &&
          String(path) === join(sessionEvidenceRoot, '.writer.lock')
        )
        {
          refusedLockCleanup = true
          throw new Error('injected terminal writer cleanup failure')
        }
        return originalUnlink(path)
      }
      syncBuiltinESMExports()
    }
    let closed: DevelopmentStatusV1
    try
    {
      closed =
        runtime === 'turbowarp'
          ? ((await host.call('development_close', {
              sessionId,
            })) as unknown as DevelopmentStatusV1)
          : await service.close({ sessionId })
    }
    finally
    {
      fsPromises.rename = originalRename
      fsPromises.unlink = originalUnlink
      syncBuiltinESMExports()
    }
    if (runtime === 'turbowarp')
    {
      assert.equal(reconciledRename, true)
      assert.equal(refusedLockCleanup, true)
      assert.ok(
        closed.issues.some((issue) =>
          issue.startsWith('private evidence writer cleanup incomplete:')
        )
      )
      const cleanup = await host.closeAll?.()
      assert.equal(cleanup?.complete, false)
      assert.ok(
        cleanup?.issues.some((issue) =>
          issue.includes('private evidence writer cleanup incomplete:')
        )
      )
    }
    const finalCatalog = await readCatalog()
    assert.equal(finalCatalog.terminal.state, 'committed')
    assert.deepEqual(
      finalCatalog.artifacts
        .slice(filled.artifacts.length)
        .map((ref) => ref.key),
      [finalCatalog.terminal.checkpointKey, 'trace.json', 'session.json']
    )
    assert.ok(
      finalCatalog.artifacts.find((ref) => ref.key === 'trace.json')!
        .byteLength <= traceLimit
    )
    assert.ok(
      finalCatalog.artifacts.find((ref) => ref.key === 'session.json')!
        .byteLength <= startupHeadroom
    )
    assert.ok(
      finalCatalog.artifacts.find(
        (ref) => ref.key === finalCatalog.terminal.checkpointKey
      )!.byteLength <=
        traceLimit + startupHeadroom
    )
    assert.equal(closed.status, 'closed')
    recordedStatus = closed
    assert.equal(engine.page.isClosed(), true)
    assert.ok(closed.trace)
    const trace = JSON.parse(
      await readFile(closed.trace.path, 'utf8')
    ) as DevelopmentTraceV2
    assert.equal(trace.schemaVersion, 2)
    assert.equal(trace.captureComplete, true)
    assert.equal(trace.sourceSha256, selected.sha256)
    assert.equal(trace.segments.length, 2)
    assert.ok(
      trace.inputs.some(
        (input) =>
          input.source === 'cleanup' &&
          input.data.key === 'a' &&
          input.data.isDown === false
      )
    )
    assert.equal(
      trace.inputs.length,
      closed.usage.inputEvents + closed.usage.releaseEvents
    )
    const reopened = await createDevelopmentServiceV1({
      permissions: {
        sourceRoots: [selected.sources],
        evidenceRoot: selected.evidence,
      },
    })
    const retained = await reopened.retainedTrace({ sessionId })
    assert.equal(retained.status.status, 'closed')
    assert.deepEqual(retained.trace, trace)
    assert.deepEqual(
      Buffer.from(retained.sourceBytes),
      Buffer.from(selected.bytes)
    )
    const chunk = await reopened.readArtifact({
      sessionId,
      key: closed.trace.key,
      maxBytes: 128,
    })
    assert.equal(chunk.sha256, closed.trace.sha256)
    assert.equal(chunk.nextOffset, 128)
    assert.deepEqual(
      Buffer.from(chunk.bytes),
      (await readFile(closed.trace.path)).subarray(0, 128)
    )
    assert.deepEqual(
      (await reopened.inspect({ sessionId, collection: 'inputs' })).items,
      trace.inputs
    )
    assert.deepEqual(
      await readFile(selected.sourcePath),
      Buffer.from(selected.bytes)
    )
    await assert.rejects(
      service.command({ sessionId, command: { kind: 'start' } })
    )
  }
  assert.ok(recordedStatus)
  const legacyId = randomUUID()
  const legacyRoot = join(await realpath(selected.evidence), legacyId)
  await mkdir(legacyRoot)
  const legacyRef = (key: string, bytes: Uint8Array, mimeType: string) => ({
    sessionId: legacyId,
    key,
    path: join(legacyRoot, key),
    sha256: createHash('sha256').update(bytes).digest('hex'),
    byteLength: bytes.byteLength,
    mimeType,
  })
  const sourceRef = legacyRef(
    'source.sb3',
    selected.bytes,
    'application/x.scratch.sb3'
  )
  const legacyCheckpoint = Buffer.from(
    JSON.stringify({
      schemaVersion: 1,
      sessionId: legacyId,
      sequence: 0,
      status: {
        ...recordedStatus,
        sessionId: legacyId,
        source: sourceRef,
        status: 'ready',
        trace: null,
        segmentId: null,
        runtimeIdentitySha256: null,
        runtimeDescriptor: null,
        tick: 0,
        issues: [],
        usage: {
          commands: 0,
          segments: 0,
          ticks: 0,
          inputEvents: 0,
          releaseEvents: 0,
          stateFrames: 0,
          marks: 0,
          traceBytes: 0,
          retainedBytes: selected.bytes.byteLength,
        },
      },
      segments: [],
      inputs: [],
      frames: [],
      commands: [],
      marks: [],
    })
  )
  const legacyIndex = Buffer.from(
    JSON.stringify({
      schemaVersion: 1,
      sessionId: legacyId,
      artifacts: [
        sourceRef,
        legacyRef(
          'checkpoint-000000.json',
          legacyCheckpoint,
          'application/json'
        ),
      ],
    })
  )
  await Promise.all([
    writeFile(sourceRef.path, selected.bytes),
    writeFile(join(legacyRoot, 'checkpoint-000000.json'), legacyCheckpoint),
    writeFile(join(legacyRoot, 'index.json'), legacyIndex),
  ])
  const legacyReader = await createDevelopmentServiceV1({
    permissions: {
      sourceRoots: [selected.sources],
      evidenceRoot: selected.evidence,
    },
  })
  const legacy = await legacyReader.retainedTrace({ sessionId: legacyId })
  assert.equal(legacy.trace.schemaVersion, 1)
  assert.equal(legacy.status.status, 'failed')
  assert.ok(
    legacy.status.issues.some((issue) => issue.includes('legacy chronology'))
  )
  await assert.rejects(
    legacyReader.retainEvidence({
      sessionId: legacyId,
      kind: 'clip',
      bytes: Buffer.from('{}'),
      mimeType: 'application/json',
    }),
    (error: unknown) =>
      error instanceof DevelopmentErrorV1 &&
      error.code === 'development.legacy_read_only'
  )
  assert.deepEqual(await readFile(join(legacyRoot, 'index.json')), legacyIndex)
  assert.deepEqual(
    await readFile(join(legacyRoot, 'checkpoint-000000.json')),
    legacyCheckpoint
  )
})

test(
  'cancelling a hung real held-input session closes its browser and retains cleanup truth',
  { timeout: 15000 },
  async (t) =>
  {
    const selected = await fixture(t)
    let engine: ProfileBrowserEngineV1 | undefined
    t.after(async () =>
    {
      if (engine && !engine.page.isClosed())
        await engine.page
          .context()
          .close()
          .catch(() =>
          {})
      await engine?.close().catch(() =>
      {})
    })
    const service = await createDevelopmentServiceV1({
      permissions: {
        sourceRoots: [selected.sources],
        evidenceRoot: selected.evidence,
      },
      engineFactory: async (options) =>
      {
        engine = await openProfileBrowserEngineV1(options)
        return engine
      },
    })
    const host = createDevelopmentToolHostV1(service)
    const controller = new AbortController()
    const begin = await host.call('development_begin', {
      sourcePath: selected.sourcePath,
      profile: {
        schemaVersion: 1,
        runtime: 'turbowarp',
        scheduler: 'deterministic',
        tickRate: 60,
      },
      inputMode: 'human',
      visible: false,
    })
    const sessionId = begin.sessionId as string
    await service.command({
      sessionId,
      command: { kind: 'start' },
    })
    await engine!.page.keyboard.down('a')
    await engine!.page.evaluate(`(() => {
    window.__projectDebug.advance = () => {
      window.__testAdvanceStarted = true
      return new Promise(() => {})
    }
  })()`)
    const pending = host.call(
      'development_command',
      {
        sessionId,
        command: { kind: 'advance', ticks: 1 },
      },
      { signal: controller.signal }
    )
    const rejected = assert.rejects(pending, /(abort|cancel|closed)/i)
    await engine!.page.waitForFunction(
      'window.__testAdvanceStarted === true',
      undefined,
      { timeout: 5000 }
    )
    const abortTime = Date.now()
    controller.abort()
    const cleanup = host.closeAll!()
    assert.equal(host.closeAll!(), cleanup)
    await rejected
    const cleanupResult = await cleanup
    assert.ok(cleanupResult)
    assert.equal(cleanupResult.complete, true)
    assert.equal(cleanupResult.pendingCalls, 0)
    assert.deepEqual(cleanupResult.liveSessionIds, [])
    await assert.rejects(
      host.call('development_inspect', { sessionId }),
      /closing/
    )
    const cancelled = (await service.inspect({ sessionId })).items[0]!
    assert.ok(Date.now() - abortTime < 8000)
    assert.equal(cancelled.status, 'cancelled')
    assert.equal(engine!.page.isClosed(), true)
    assert.ok(cancelled.trace)
    const trace = JSON.parse(
      await readFile(cancelled.trace.path, 'utf8')
    ) as DevelopmentTraceV1
    assert.ok(
      trace.inputs.some(
        (input) =>
          input.source === 'human' &&
          input.data.key === 'a' &&
          input.data.isDown === true
      )
    )
    const releaseConfirmed = trace.inputs.some(
      (input) =>
        input.source === 'cleanup' &&
        input.data.key === 'a' &&
        input.data.isDown === false
    )
    assert.ok(
      releaseConfirmed ||
        trace.issues.some((issue) =>
          /release.*(unavailable|unconfirmed|failed|capture)/i.test(issue)
        )
    )
    assert.equal(trace.segments[0]!.status, 'cancelled')
    assert.deepEqual(
      await readFile(selected.sourcePath),
      Buffer.from(selected.bytes)
    )

    let openingSignal: AbortSignal | undefined
    let announceOpening!: () => void
    let releaseOpening!: () => void
    const openingReady = new Promise<void>((resolve) =>
    {
      announceOpening = resolve
    })
    const openingGate = new Promise<void>((resolve) =>
    {
      releaseOpening = resolve
    })
    const openingService = await createDevelopmentServiceV1({
      permissions: {
        sourceRoots: [selected.sources],
        evidenceRoot: selected.evidence,
      },
      engineFactory: async (options) =>
      {
        openingSignal = options.signal
        engine = await openProfileBrowserEngineV1(options)
        announceOpening()
        await openingGate
        return engine
      },
    })
    const openingHost = createDevelopmentToolHostV1(openingService)
    t.after(async () =>
    {
      releaseOpening()
      await openingHost.closeAll!()
    })
    const opening = openingHost.call('development_begin', {
      sourcePath: selected.sourcePath,
      inputMode: 'agent',
    })
    const openingRejected = assert.rejects(opening, /(abort|cancel|closed)/i)
    await openingReady
    const browserClosed = engine!.page.waitForEvent('close', { timeout: 5000 })
    const openingCleanup = openingHost.closeAll!()
    assert.equal(openingSignal!.aborted, true)
    assert.equal(openingHost.closeAll!(), openingCleanup)
    await browserClosed
    releaseOpening()
    await openingRejected
    const openingResult = await openingCleanup
    assert.ok(openingResult)
    assert.equal(openingResult.complete, true)
    assert.equal(openingResult.pendingCalls, 0)
    assert.deepEqual(openingResult.liveSessionIds, [])
    assert.equal(engine!.page.isClosed(), true)
  }
)
