// tests/runner/development-replay.test.ts
// verify real profile clocks & mandatory assertion coverage without claiming natural equality

import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { pathToFileURL } from 'node:url'

import { chromium } from 'playwright'

import {
  authoringCandidateEvaluationEvidenceSha256V2,
  evaluateAuthoringCandidateV2,
  validateAuthoringCandidateEvaluationV2,
  compareDevelopmentSelectedStateV1,
  developmentReproductionEvidenceSha256V1,
  reproduceDevelopmentMarkV1,
  validateDevelopmentReproductionReportV1,
  type DevelopmentReproductionReportV2,
} from '@scratch-agent/eval'
import { blankProject } from '@scratch-agent/ir'
import { getStandardAuthoritySha256V2 } from '@scratch-agent/ir/edit'
import {
  executeProfileScenarioV1,
  createDevelopmentServiceV1,
  openProfileBrowserEngineV1,
  runScenario,
  type RuntimeExecutionProfileV1,
  type Scenario,
  type DevelopmentArtifactRefV1,
  type DevelopmentTraceV1,
  type DevelopmentTraceV2,
  type DevelopmentViewerModelV1,
  type ProfileAppliedInputEventV1,
  type ProfileBrowserEngineV1,
  type ProfileBrowserLimitsV1,
  type ScratchRuntime,
} from '@scratch-agent/runner'
import { installDeterminism } from '../../packages/runner/src/policy/determinism.js'

test('selected clocks execute exactly while baseline scope and natural diagnostics remain explicit', async (t) =>
{
  // primitive conformance verifies timer cancellation without claiming a gameplay failure
  class Timer
  {
    static nowObj = { now: () => 0 }
    startTime = 0
    start(): void
    {}
    timeElapsed(): number
    {
      return 0
    }
  }
  const runtime = {
    currentMSecs: 0,
    currentStepTime: 1000 / 30,
    updateCurrentMSecs(): void
    {},
    ioDevices: {
      clock: {
        _projectTimer: new Timer(),
        resetProjectTimer(): void
        {},
      },
    },
    sequencer: { timer: new Timer() },
  } as unknown as ScratchRuntime
  const original = {
    setTimeout: globalThis.setTimeout,
    clearTimeout: globalThis.clearTimeout,
    date: globalThis.Date,
    random: Math.random,
    update: runtime.updateCurrentMSecs,
    start: runtime.sequencer.timer.start,
    elapsed: runtime.sequencer.timer.timeElapsed,
    timer: Object.getOwnPropertyDescriptor(Timer, 'nowObj'),
    timezone: process.env.TZ,
    hadTimezone: Object.hasOwn(process.env, 'TZ'),
  }
  const deterministic = installDeterminism(runtime, { fixedDateMs: 0 })
  try
  {
    const fired: string[] = []
    setTimeout(() =>
    {
      fired.push('first')
      clearTimeout(cancelled)
      setTimeout(() => fired.push('deferred'), 0)
    }, 0)
    const cancelled = setTimeout(() => fired.push('cancelled'), 0)
    setTimeout(() => fired.push('same-deadline'), 0)
    setTimeout(() => fired.push('later'), 10)
    deterministic.flushTimers()
    assert.deepEqual(fired, ['first', 'same-deadline'])
    deterministic.flushTimers()
    assert.deepEqual(fired, ['first', 'same-deadline', 'deferred'])
    runtime.updateCurrentMSecs()
    deterministic.flushTimers()
    assert.deepEqual(fired, ['first', 'same-deadline', 'deferred', 'later'])
  }
  finally
  {
    deterministic.restore()
  }
  assert.equal(globalThis.setTimeout, original.setTimeout)
  assert.equal(globalThis.clearTimeout, original.clearTimeout)
  assert.equal(globalThis.Date, original.date)
  assert.equal(Math.random, original.random)
  assert.equal(runtime.updateCurrentMSecs, original.update)
  assert.equal(runtime.sequencer.timer.start, original.start)
  assert.equal(runtime.sequencer.timer.timeElapsed, original.elapsed)
  assert.deepEqual(
    Object.getOwnPropertyDescriptor(Timer, 'nowObj'),
    original.timer
  )
  assert.equal(process.env.TZ, original.timezone)
  assert.equal(Object.hasOwn(process.env, 'TZ'), original.hadTimezone)

  const root = await mkdtemp(join(tmpdir(), 'scratch-development-clock-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const project = blankProject()
  const started = project.stage!.addVariable('started', 0)
  project.stage!.addScript([
    { opcode: 'event_whenflagclicked' },
    {
      opcode: 'data_setvariableto',
      fields: { VARIABLE: ['started', started] },
      inputs: { VALUE: 1 },
    },
    { opcode: 'sound_setvolumeto', inputs: { VOLUME: 100 } },
  ])
  const bytes = await project.toSb3()
  const sourceSha256 = createHash('sha256').update(bytes).digest('hex')
  const scenario: Scenario = {
    seed: 7,
    fixedDateMs: 0,
    maxTicks: 30,
    steps: [
      { do: 'greenFlag' },
      { do: 'wait', ticks: 30 },
      { do: 'snapshot', label: 'after-thirty' },
    ],
  }
  const official: RuntimeExecutionProfileV1 = {
    schemaVersion: 1,
    runtime: 'scratch-official',
    scheduler: 'deterministic',
    tickRate: 30,
  }
  const turbo: RuntimeExecutionProfileV1 = {
    ...official,
    runtime: 'turbowarp',
    tickRate: 60,
  }
  const traces = []
  for (const [index, profile] of [official, official, turbo].entries())
  {
    const trace = await executeProfileScenarioV1(bytes, scenario, {
      profile,
      screenshotDir: join(root, `clock-${index}`),
    })
    assert.equal(trace.ok, true, JSON.stringify(trace.issues))
    assert.deepEqual(trace.executionProfile, profile)
    assert.deepEqual(trace.clock, {
      drive: 'manual',
      tickMs: 1000 / profile.tickRate,
      replay: 'exact',
    })
    assert.equal(trace.observations.sourceSb3Sha256, sourceSha256)
    assert.equal(trace.snapshots[0]!.tick, 30)
    assert.ok(
      Math.abs(trace.snapshots[0]!.timer - 30 / profile.tickRate) < 0.000001
    )
    traces.push(trace)
    if (index !== 1)
    {
      let rejectNextApplied = false
      let deliveredAfterRejection = 0
      const keyboard = await openProfileBrowserEngineV1({
        sb3: bytes,
        profile,
        inputMode: 'human',
        headless: true,
        onAppliedEvent: (event) =>
        {
          if (rejectNextApplied)
          {
            rejectNextApplied = false
            throw new Error('injected applied-input callback rejection')
          }
          if (event.data.key === 'z' && event.data.isDown === false)
            deliveredAfterRejection++
        },
      })
      try
      {
        for (const data of [
          { key: 'b', keyCode: 66, isDown: true },
          { key: 'B', keyCode: 66, isDown: true },
          { key: 'B', keyCode: 66, isDown: false },
          { key: 'ArrowLeft', keyCode: 37, isDown: true },
          { key: 'Left', keyCode: 37, isDown: false },
          { key: ' ', keyCode: 32, isDown: true },
          { key: ' ', keyCode: 32, isDown: false },
        ])
          await keyboard.applyInput({ device: 'keyboard', data })
        assert.deepEqual((await keyboard.status()).heldKeys, [])
        const ordinary = await keyboard.drainEvidence!()
        assert.equal(ordinary.inputs[0]!.data.key, 'b')
        assert.equal(ordinary.inputs[0]!.interpretedKey, 'B')
        assert.deepEqual(ordinary.inputs[2]!.releasedKeys, ['B'])
        assert.deepEqual(ordinary.inputs[4]!.releasedKeys, ['left arrow'])
        assert.deepEqual(ordinary.inputs[6]!.releasedKeys, ['space'])
        await keyboard.applyInput({
          device: 'keyboard',
          data: {
            key: '!',
            keyCode: 49,
            isDown: true,
          },
        })
        await keyboard.applyInput({
          device: 'keyboard',
          data: {
            key: '1',
            keyCode: 49,
            isDown: false,
          },
        })
        assert.deepEqual(
          (await keyboard.status()).heldKeys,
          profile.runtime === 'turbowarp' ? [] : ['!']
        )
        await keyboard.pause()
        assert.deepEqual((await keyboard.status()).heldKeys, [])
        const released = await keyboard.drainEvidence!()
        assert.equal(released.captureComplete, true)
        assert.equal(
          released.inputs.filter((input) => input.source === 'focus-release')
            .length,
          profile.runtime === 'turbowarp' ? 0 : 1
        )
        assert.deepEqual(released.inputs.at(-1)!.releasedKeys, ['!'])
        if (index === 0)
        {
          await keyboard.start()
          const evaluate = keyboard.page.evaluate
          let injected = false
          // keep the sound & input in the same serialized browser drain
          keyboard.page.evaluate = ((operation: unknown, argument: unknown) =>
          {
            if (
              !injected &&
              typeof argument === 'number' &&
              String(operation).includes('.advance(')
            )
            {
              assert.equal(argument, 1)
              injected = true
              return Reflect.apply(evaluate, keyboard.page, [
                `(async () => {
                const api = window.__projectDebug
                const result = await api.advance(1)
                api.applyInput({ device: 'keyboard', data: { key: 'z', isDown: true } })
                return result
              })()`,
              ])
            }
            return Reflect.apply(evaluate, keyboard.page, [operation, argument])
          }) as typeof keyboard.page.evaluate
          try
          {
            rejectNextApplied = true
            await assert.rejects(
              keyboard.advance(1),
              /injected applied-input callback rejection/
            )
          }
          finally
          {
            keyboard.page.evaluate = evaluate
          }
          assert.equal(injected, true)
          await keyboard.applyInput({
            device: 'keyboard',
            data: { key: 'z', isDown: false },
          })
          assert.equal(deliveredAfterRejection, 1)
          const sound = await keyboard.drainSoundEvents()
          assert.equal(sound.observed, 1)
          assert.equal(sound.dropped, 0)
          assert.equal(sound.complete, true)
          assert.deepEqual(
            sound.events.map((event) => [event.ordinal, event.opcode]),
            [[1, 'sound_setvolumeto']]
          )
          assert.deepEqual((await keyboard.drainSoundEvents()).events, [])
        }
      }
      finally
      {
        await keyboard.close()
      }
    }
  }
  assert.deepEqual(
    traces[0]!.snapshots.map(
      ({ tick, timer, variables, lists, stage, answer }) => ({
        tick,
        timer,
        variables,
        lists,
        stage,
        answer,
      })
    ),
    traces[1]!.snapshots.map(
      ({ tick, timer, variables, lists, stage, answer }) => ({
        tick,
        timer,
        variables,
        lists,
        stage,
        answer,
      })
    )
  )
  const legacy = await runScenario(bytes, scenario)
  assert.ok(Math.abs(legacy.snapshots[0]!.timer - 0.5) < 0.000001)

  const request = {
    candidateBytes: bytes,
    candidateSha256: sourceSha256,
    standardAuthoritySha256: getStandardAuthoritySha256V2(),
    compilerIdentitySha256: 'c'.repeat(64),
    runtimeTargets: [official],
    scenarios: [{ id: 'clock', scenario }],
    assertions: [
      {
        scenarioId: 'clock',
        assertion: {
          at: 'after-thirty',
          probe: { on: 'timer' },
          match: { kind: 'closeTo', value: 1, eps: 0.000001 },
        },
      },
    ],
    evidenceRoot: root,
  }
  const accepted = await evaluateAuthoringCandidateV2(request)
  assert.equal(
    accepted.disposition,
    'accepted',
    JSON.stringify(accepted.issues)
  )
  assert.deepEqual(
    validateAuthoringCandidateEvaluationV2(accepted, request),
    []
  )
  const baseline = accepted.lanes.find(
    (cell) => cell.lane === 'officialHeadless'
  )!
  assert.equal(baseline.assertionApplicability, 'baseline-smoke')
  assert.deepEqual(baseline.assertions, [])
  assert.equal(baseline.executionProfile, null)
  const selected = accepted.lanes.find(
    (cell) => cell.lane === 'officialBrowser'
  )!
  assert.equal(selected.assertionApplicability, 'declared')
  assert.equal(selected.assertions.length, 1)
  assert.equal(selected.assertions[0]!.ok, true)
  const omitted = structuredClone(accepted)
  const omittedCell = omitted.lanes.find(
    (cell) => cell.lane === 'officialBrowser'
  )!
  omittedCell.assertions = []
  omittedCell.assertionApplicability = 'baseline-smoke'
  const { evidenceSha256: _oldHash, ...content } = omitted
  omitted.evidenceSha256 = authoringCandidateEvaluationEvidenceSha256V2(content)
  assert.ok(validateAuthoringCandidateEvaluationV2(omitted, request).length > 0)

  const natural = await executeProfileScenarioV1(
    bytes,
    {
      ...scenario,
      maxTicks: 30,
      steps: [
        { do: 'greenFlag' },
        { do: 'wait', ticks: 3 },
        { do: 'snapshot', label: 'native' },
      ],
    },
    {
      profile: { ...turbo, scheduler: 'natural' },
      screenshotDir: join(root, 'natural'),
      maxDurationMs: 10000,
    }
  )
  assert.equal(natural.ok, true, JSON.stringify(natural.issues))
  assert.deepEqual(natural.clock, {
    drive: 'native',
    tickMs: 1000 / 60,
    replay: 'timing-diagnostic',
  })
  assert.equal(natural.naturalDiagnostics?.exactReplay, false)
  assert.ok(natural.snapshots[0]!.timer > 0)
  assert.ok(natural.snapshots[0]!.timer < 2)
  assert.deepEqual(bytes, await project.toSb3())
})

// one authored fixture gives the inspector real clone, list, sound & held-input state
async function inspectorFixture(t: test.TestContext)
{
  const root = await mkdtemp(join(tmpdir(), 'scratch-development-inspector-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const sources = join(root, 'sources')
  const evidence = join(root, 'evidence')
  await Promise.all([mkdir(sources), mkdir(evidence)])
  const project = blankProject()
  const actor = project.addSprite('Actor')
  actor.addCostume({ ...project.stage!.raw.costumes[0]!, name: 'idle' })
  const key = actor.addVariable('instanceKey', 0)
  const list = actor.addList('sequence', [1, 2, 3])
  const wav = Buffer.alloc(44 + 8000 * 2)
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
  wav.writeUInt32LE(wav.length - 44, 40)
  for (let sample = 0; sample < 8000; sample++)
    wav.writeInt16LE(
      Math.round(Math.sin((sample * Math.PI * 2 * 440) / 8000) * 4000),
      44 + sample * 2
    )
  const soundId = createHash('md5').update(wav).digest('hex')
  actor.addSound(
    {
      name: 'tone',
      assetId: soundId,
      md5ext: `${soundId}.wav`,
      dataFormat: 'wav',
      rate: 8000,
      sampleCount: 8000,
    },
    wav
  )
  actor.addScript([
    { opcode: 'event_whenflagclicked' },
    { opcode: 'motion_gotoxy', inputs: { X: 0, Y: 0 } },
    {
      opcode: 'data_setvariableto',
      fields: { VARIABLE: ['instanceKey', key] },
      inputs: { VALUE: 1 },
    },
    { opcode: 'control_create_clone_of', inputs: { CLONE_OPTION: '_myself_' } },
    {
      opcode: 'data_setvariableto',
      fields: { VARIABLE: ['instanceKey', key] },
      inputs: { VALUE: 2 },
    },
    { opcode: 'control_create_clone_of', inputs: { CLONE_OPTION: '_myself_' } },
    {
      opcode: 'data_setvariableto',
      fields: { VARIABLE: ['instanceKey', key] },
      inputs: { VALUE: 0 },
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
                    inputs: { KEY_OPTION: 'a' },
                  },
                },
                SUBSTACK: {
                  substack: [{ opcode: 'motion_changexby', inputs: { DX: 1 } }],
                },
              },
            },
          ],
        },
      },
    },
  ])
  actor.addScript([
    { opcode: 'control_start_as_clone' },
    {
      opcode: 'motion_changexby',
      inputs: { DX: { var: 'instanceKey', id: key } },
    },
  ])
  actor.addScript([
    { opcode: 'event_whenkeypressed', fields: { KEY_OPTION: ['b'] } },
    {
      opcode: 'data_setvariableto',
      fields: { VARIABLE: ['instanceKey', key] },
      inputs: { VALUE: 7 },
    },
  ])
  actor.addScript([
    { opcode: 'event_whenkeypressed', fields: { KEY_OPTION: ['s'] } },
    { opcode: 'sound_play', inputs: { SOUND_MENU: 'tone' } },
  ])
  const bytes = await project.toSb3()
  const sourcePath = join(sources, 'keyed-actor.sb3')
  await writeFile(sourcePath, bytes)
  return {
    root,
    sources,
    evidence,
    sourcePath,
    bytes,
    key,
    list,
    sha256: createHash('sha256').update(bytes).digest('hex'),
  }
}

async function retainedJson<T>(artifact: DevelopmentArtifactRefV1): Promise<T>
{
  const bytes = await readFile(artifact.path)
  assert.equal(
    createHash('sha256').update(bytes).digest('hex'),
    artifact.sha256
  )
  return JSON.parse(bytes.toString('utf8')) as T
}

function assertFinalTraceReservation(
  service: Awaited<ReturnType<typeof createDevelopmentServiceV1>>,
  sessionId: string
): void
{
  const session = (
    service as unknown as {
      sessions: Map<
        string,
        { trace(): unknown; finalTraceByteLength(): number }
      >
    }
  ).sessions.get(sessionId)!
  assert.equal(
    session.finalTraceByteLength(),
    Buffer.byteLength(JSON.stringify(session.trace()), 'utf8')
  )
}

test(
  'full input capacity preserves cleanup provenance, refreshed history and exact same-tick mark inspection',
  { timeout: 90000 },
  async (t) =>
  {
    const selected = await inspectorFixture(t)
    const engines: ProfileBrowserEngineV1[] = []
    const openedLimits: Partial<ProfileBrowserLimitsV1>[] = []
    t.after(async () =>
    {
      await Promise.all(engines.map((engine) => engine.close().catch(() =>
      {})))
    })
    const permissions = {
      sourceRoots: [selected.sources],
      evidenceRoot: selected.evidence,
    }
    const service = await createDevelopmentServiceV1({
      permissions,
      engineFactory: async (options) =>
      {
        openedLimits.push({ ...options.limits })
        const engine = await openProfileBrowserEngineV1(options)
        engines.push(engine)
        return engine
      },
    })
    const reader = await createDevelopmentServiceV1({ permissions })
    const profile: RuntimeExecutionProfileV1 = {
      schemaVersion: 1,
      runtime: 'turbowarp',
      scheduler: 'deterministic',
      tickRate: 60,
    }
    const begun = await service.begin({
      sourcePath: selected.sourcePath,
      profile,
      inputMode: 'human',
      visible: false,
      probe: {
        targets: [
          {
            targetIndex: 1,
            variableIds: [selected.key],
            includeClones: true,
            cloneKeyVariableId: selected.key,
          },
        ],
      },
    })
    const sessionId = begun.sessionId
    const original = engines[0]!
    await service.command({ sessionId, command: { kind: 'start' } })
    await original.page.evaluate(`(async () => {
      const api = window.__projectDebug
      await api.advance(1)
      api.applyInput({ device: 'keyboard', data: { key: 'z', keyCode: 90, isDown: true } })
      api.applyInput({ device: 'keyboard', data: { key: 'Z', keyCode: 90, isDown: false } })
      await api.advance(2)
    })()`)

    // use the real input boundary in one browser task, without thousands of host commands
    await original.page.evaluate(`(() => {
      const api = window.__projectDebug
      for (let count = 0; count < 255; count++) {
        api.applyInput({ device: 'keyboard', key: 'a', isDown: true })
        api.pause()
        api.resume()
      }
    })()`)
    await original.status()
    const held = await service.command({
      sessionId,
      command: {
        kind: 'input',
        input: { device: 'keyboard', key: 'a', isDown: true },
      },
    })
    assert.equal(held.usage.releaseEvents, 255)
    const first = await service.command({
      sessionId,
      command: { kind: 'mark', label: 'held-before-same-tick-inputs' },
    })
    assert.ok(first.markId)
    assertFinalTraceReservation(service, sessionId)
    const cachedFirst = await reader.retainedTrace({ sessionId })
    assert.equal(cachedFirst.trace.schemaVersion, 2)
    assert.equal(cachedFirst.trace.marks.length, 1)
    if (cachedFirst.trace.schemaVersion !== 2)
      throw new Error('expected v2 capture')
    assert.equal(cachedFirst.trace.captureComplete, true)
    assert.deepEqual(
      cachedFirst.trace.frames
        .slice(0, 3)
        .map((frame) => [frame.tick, frame.inputOrdinal]),
      [
        [1, 0],
        [2, 2],
        [3, 2],
      ]
    )
    assert.equal(cachedFirst.trace.inputs.length, first.usage.inputEvents + 255)
    const remaining = 4096 - first.usage.inputEvents
    assert.ok(remaining > 0)
    await original.page.evaluate(`(() => {
      for (let count = 0; count < ${remaining}; count++)
        window.__projectDebug.applyInput({ device: 'keyboard', key: 'A', isDown: true })
    })()`)
    await original.status()
    const paused = await service.command({
      sessionId,
      command: { kind: 'pause' },
    })
    assert.equal(paused.usage.inputEvents, 4096)
    assert.equal(paused.usage.releaseEvents, 256)
    assert.deepEqual((await original.status()).heldKeys, [])
    const last = await service.command({
      sessionId,
      command: { kind: 'mark', label: 'released-after-same-tick-inputs Ω' },
    })
    assert.ok(last.markId)
    assertFinalTraceReservation(service, sessionId)
    assert.equal(last.tick, first.tick)
    const cachedLast = await reader.retainedTrace({ sessionId })
    assert.equal(cachedLast.trace.schemaVersion, 2)
    if (cachedLast.trace.schemaVersion !== 2)
      throw new Error('expected v2 capture')
    assert.equal(cachedLast.trace.marks.length, 2)
    assert.deepEqual(
      [...cachedLast.trace.inputs, ...cachedLast.trace.frames]
        .map((row) => row.captureSequence)
        .sort((left, right) => left - right),
      Array.from(
        {
          length:
            cachedLast.trace.inputs.length + cachedLast.trace.frames.length,
        },
        (_, index) => index + 1
      )
    )
    assert.equal(cachedLast.trace.inputs.length, 4352)
    const release = cachedLast.trace.inputs.at(-1)!
    assert.equal(release.ordinal, 4352)
    assert.equal(release.source, 'focus-release')
    assert.equal(release.data.key, 'A')
    assert.equal(release.data.isDown, false)
    assert.equal(
      cachedLast.trace.inputs.filter(
        (input) => input.source === 'focus-release'
      ).length,
      256
    )
    assert.ok(
      cachedLast.trace.inputs.every(
        (input, index) => input.ordinal === index + 1
      )
    )
    const replayApplications: ProfileAppliedInputEventV1[] = []
    const reproduced = await reproduceDevelopmentMarkV1(
      { service, sessionId, markId: last.markId },
      {
        engineFactory: (options) =>
          openProfileBrowserEngineV1({
            ...options,
            onAppliedEvent: (event) =>
            {
              replayApplications.push(event)
            },
          }),
      }
    )
    assert.equal(
      reproduced.disposition,
      'matched',
      JSON.stringify(reproduced.issues)
    )
    const report = await retainedJson<DevelopmentReproductionReportV2>(
      reproduced.result
    )
    assert.deepEqual(validateDevelopmentReproductionReportV1(report), [])
    assert.equal(report.schemaVersion, 2)
    assert.equal(report.captureComplete, true)
    assert.equal(report.inputApplicationVerified, true)
    assert.deepEqual(
      report.checkpoints.map((point) => [
        point.captureSequence,
        point.inputOrdinal,
      ]),
      cachedLast.trace.frames.map((frame) => [
        frame.captureSequence,
        frame.inputOrdinal,
      ])
    )
    assert.equal(report.prefix.length, 4352)
    assert.deepEqual(report.prefix, cachedLast.trace.inputs)
    assert.equal(replayApplications.length, 4352)
    assert.ok(replayApplications.every((input) => input.source === 'agent'))
    assert.deepEqual(
      replayApplications.map(({ ordinal, tick, device, data }) => ({
        ordinal,
        tick,
        device,
        data,
      })),
      cachedLast.trace.inputs.map(({ ordinal, tick, device, data }) => ({
        ordinal,
        tick,
        device,
        data,
      }))
    )
    let unsupportedEngine: ProfileBrowserEngineV1 | undefined
    let unsupportedApplications = 0
    const unsupported = await reproduceDevelopmentMarkV1(
      { service, sessionId, markId: last.markId },
      {
        engineFactory: async (options) =>
        {
          unsupportedEngine = await openProfileBrowserEngineV1({
            ...options,
            onAppliedEvent: () =>
            {
              unsupportedApplications++
            },
          })
          const { applyReplayInput: _replayOnly, ...legacyEngine } =
            unsupportedEngine
          return legacyEngine
        },
      }
    )
    assert.equal(unsupported.disposition, 'unavailable')
    assert.match(
      unsupported.issues.join(';'),
      /does not support archived cleanup-release input provenance/
    )
    assert.equal(unsupportedApplications, 0)
    assert.equal(unsupportedEngine!.page.isClosed(), true)
    const missingChronology = await reproduceDevelopmentMarkV1(
      { service, sessionId, markId: last.markId },
      {
        engineFactory: async () =>
        {
          const {
            evidencePolicy: _policy,
            drainEvidence: _drain,
            observeEvidence: _observe,
            ...legacyEngine
          } = unsupportedEngine!
          return legacyEngine
        },
      }
    )
    assert.equal(missingChronology.disposition, 'unavailable')
    assert.match(missingChronology.issues.join(';'), /atomic browser evidence/)
    assert.equal(unsupportedApplications, 0)

    const cursor = await reader.inspect({
      sessionId,
      collection: 'inputs',
      limit: 1,
    })
    assert.ok(cursor.nextCursor)
    const restarted = await service.command({
      sessionId,
      command: { kind: 'restart' },
    })
    assert.equal(restarted.usage.inputEvents, 4096)
    assert.equal(restarted.usage.releaseEvents, 256)
    assert.equal(openedLimits.at(-1)!.maxInputEvents, 0)
    assert.equal(openedLimits.at(-1)!.maxReleaseEvents, 0)
    const closed = await service.close({ sessionId })
    assert.equal(closed.status, 'closed')
    assert.ok(closed.trace)
    const final = await reader.retainedTrace({ sessionId })
    assert.equal(final.status.status, 'closed')
    assert.deepEqual(
      final.trace,
      await retainedJson<DevelopmentTraceV2>(closed.trace)
    )
    assert.deepEqual(final.trace.inputs, cachedLast.trace.inputs)
    await assert.rejects(
      reader.inspect({
        sessionId,
        collection: 'inputs',
        limit: 1,
        cursor: cursor.nextCursor!,
      }),
      (error: unknown) =>
        error instanceof Error &&
        'code' in error &&
        error.code === 'development.stale_cursor'
    )

    const viewed = await reader.view({ sessionId })
    const model = await retainedJson<{
      primary: { trace: DevelopmentTraceV2 }
    }>(viewed.model)
    const early = model.primary.trace.marks.find(
      (mark) => mark.markId === first.markId
    )!
    const late = model.primary.trace.marks.find(
      (mark) => mark.markId === last.markId
    )!
    assert.equal(early.tick, late.tick)
    assert.ok(early.frame.order < late.frame.order)
    const frames = model.primary.trace.frames.filter(
      (frame) => frame.segmentId === early.segmentId
    )
    const browser = await chromium.launch({ headless: true })
    try
    {
      const page = await browser.newPage()
      const errors: string[] = []
      page.on('pageerror', (error) => errors.push(error.message))
      await page.goto(pathToFileURL(viewed.viewer.path).href)
      const inputs = page.locator('section').filter({
        has: page.getByRole('heading', {
          name: 'Applied inputs',
          exact: true,
        }),
      })
      await page.locator(`#mark-${first.markId}`).click()
      assert.equal(
        await page.locator('#history-range').inputValue(),
        String(frames.findIndex((frame) => frame.order === early.frame.order))
      )
      assert.match(
        (await inputs.textContent()) ?? '',
        /Held keys after recorded inputs: A/
      )
      const earlyRows = await inputs
        .locator('tbody tr td:first-child')
        .allTextContents()
      assert.ok(earlyRows.length > 0)
      assert.equal(earlyRows.at(-1), `${early.inputOrdinal} / ${early.tick}`)
      assert.ok(
        earlyRows.every(
          (value) => Number(value.split(' / ')[0]) <= early.inputOrdinal
        )
      )
      await page.locator(`#mark-${last.markId}`).click()
      assert.equal(
        await page.locator('#history-range').inputValue(),
        String(frames.findIndex((frame) => frame.order === late.frame.order))
      )
      assert.match(
        (await inputs.textContent()) ?? '',
        /Held keys after recorded inputs: none/
      )
      const lateRows = await inputs
        .locator('tbody tr td:first-child')
        .allTextContents()
      assert.equal(lateRows.at(-1), `4352 / ${late.tick}`)
      assert.deepEqual(errors, [])
    }
    finally
    {
      await browser.close()
    }

    assert.deepEqual(
      await readFile(selected.sourcePath),
      Buffer.from(selected.bytes)
    )
  }
)

test(
  'retained mark reproduction binds keyed clones, exact input, real frames & separate output diagnostics',
  { timeout: 30000 },
  async (t) =>
  {
    const selected = await inspectorFixture(t)
    let engine: ProfileBrowserEngineV1 | undefined
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
    t.after(async () =>
    {
      await engine?.close().catch(() =>
      {})
    })
    const profile: RuntimeExecutionProfileV1 = {
      schemaVersion: 1,
      runtime: 'turbowarp',
      scheduler: 'deterministic',
      tickRate: 60,
    }
    const begin = await service.begin({
      sourcePath: selected.sourcePath,
      expectedSourceSha256: selected.sha256,
      profile,
      inputMode: 'human',
      visible: false,
      probe: {
        targets: [
          {
            targetIndex: 1,
            variableIds: [selected.key],
            listIds: [selected.list],
            includeClones: true,
            cloneKeyVariableId: selected.key,
          },
        ],
        maxListItems: 2,
      },
    })
    const sessionId = begin.sessionId
    const original = engine!
    const prestart = await service.command({
      sessionId,
      command: { kind: 'mark', label: 'before-green-flag' },
    })
    assert.ok(prestart.markId)
    const suspended = await original.recordAudioClip({ durationMs: 20 })
    assert.equal(suspended.diagnosticOnly, true)
    if (suspended.status === 'unavailable')
      assert.match(suspended.issue!, /suspend|gesture|audio/i)
    await original.page
      .getByRole('button', { name: 'Start', exact: true })
      .click()
    await original.page.waitForFunction(
      'window.__projectDebug.status().status === "running"',
      undefined,
      { timeout: 5000 }
    )
    await service.inspect({ sessionId })
    await service.command({ sessionId, command: { kind: 'advance', ticks: 3 } })
    await original.page.locator('canvas').click()
    await original.page.keyboard.down('a')
    await service.command({ sessionId, command: { kind: 'advance', ticks: 3 } })
    const before = await original.observe()
    assert.equal(before.cloneCounts.total, 2)
    assert.deepEqual(
      before.targets
        .filter((target) => target.instance === 'clone')
        .map((target) => target.cloneKey)
        .sort(),
      [1, 2]
    )
    assert.equal(before.targets[0]!.lists[selected.list]!.length, 3)
    assert.equal(before.targets[0]!.lists[selected.list]!.items.length, 2)
    const unassociated = await original.observe({
      targets: [{ targetIndex: 1, includeClones: true }],
    })
    assert.equal(
      compareDevelopmentSelectedStateV1(unassociated, unassociated).disposition,
      'unavailable'
    )
    const frame = await original.captureVisualFrame({
      limits: { maxFrames: 1, maxBytes: 1024 * 1024 },
    })
    const after = await original.observe()
    assert.equal(
      compareDevelopmentSelectedStateV1(before, after).disposition,
      'matched'
    )
    assert.equal(frame.width, 480)
    assert.equal(frame.height, 360)
    assert.deepEqual(
      [...frame.bytes.slice(0, 8)],
      [137, 80, 78, 71, 13, 10, 26, 10]
    )
    await assert.rejects(
      original.captureVisualFrame({
        limits: { maxFrames: 1, maxBytes: 1024 * 1024 },
      }),
      /budget|frame|capture/i
    )
    const intermediate = await service.command({
      sessionId,
      command: { kind: 'mark', label: 'same-tick-intermediate' },
    })
    const marked = await service.command({
      sessionId,
      command: { kind: 'mark', label: 'keyed-state' },
    })
    assert.ok(marked.markId)
    const reproduced = await reproduceDevelopmentMarkV1({
      service,
      sessionId,
      markId: marked.markId,
    })
    assert.equal(
      reproduced.disposition,
      'matched',
      JSON.stringify(reproduced.issues)
    )
    const report = await retainedJson<DevelopmentReproductionReportV2>(
      reproduced.result
    )
    assert.deepEqual(validateDevelopmentReproductionReportV1(report), [])
    assert.equal(report.inputApplicationVerified, true)
    assert.equal(report.originalPaused, true)
    assert.equal(report.frames.length, 7)
    assert.equal(report.frames.at(-1)!.tick, marked.tick)
    assert.ok(report.clip)
    assert.equal(report.soundDiagnostics?.diagnosticOnly, true)
    assert.equal(report.schemaVersion, 2)
    assert.equal(report.kind, 'development-reproduction-v2')
    const viewed = await service.view({
      sessionId,
      reproductionArtifactKey: reproduced.result.key,
    })
    const viewerModel = await retainedJson<DevelopmentViewerModelV1>(
      viewed.model
    )
    assert.deepEqual(viewerModel.reproduction, report)
    assert.deepEqual(
      viewerModel.media,
      report.frames.map((frame) => ({
        artifact: frame.image,
        tick: frame.tick,
        segmentId: frame.segmentId,
        state: frame.state,
        geometry: frame.geometry,
      }))
    )
    const viewerBytes = await readFile(viewed.viewer.path)
    assert.equal(
      createHash('sha256').update(viewerBytes).digest('hex'),
      viewed.viewer.sha256
    )
    const embeddedData = viewerBytes
      .toString('utf8')
      .match(
        /<script id="viewer-data" type="application\/json">([\s\S]*?)<\/script>/
      )
    assert.ok(embeddedData)
    const embedded = JSON.parse(embeddedData[1]!) as DevelopmentViewerModelV1
    assert.deepEqual(embedded.reproduction, report)
    assert.deepEqual(
      embedded.media.map(({ dataUrl: _url, ...media }) => media),
      viewerModel.media
    )
    for (const [index, retainedFrame] of report.frames.entries())
    {
      const image = await readFile(retainedFrame.image.path)
      assert.equal(
        createHash('sha256').update(image).digest('hex'),
        retainedFrame.image.sha256
      )
      assert.equal(
        embedded.media[index]!.dataUrl,
        `data:image/png;base64,${image.toString('base64')}`
      )
    }
    const mismatchedVersion = await service.retainEvidence({
      sessionId,
      kind: 'reproduction',
      bytes: Buffer.from(JSON.stringify({ ...report, schemaVersion: 1 })),
      mimeType: 'application/json',
    })
    await assert.rejects(
      service.view({
        sessionId,
        reproductionArtifactKey: mismatchedVersion.key,
      }),
      (error: unknown) =>
        error instanceof Error &&
        'code' in error &&
        error.code === 'development.invalid_reproduction'
    )
    const reordered = {
      ...report.replayMarkState!,
      targets: [...report.replayMarkState!.targets].reverse(),
    }
    assert.equal(
      compareDevelopmentSelectedStateV1(report.mark!.frame, reordered)
        .disposition,
      'matched'
    )
    const moved = {
      ...structuredClone(report.replayMarkState!),
      targets: [...structuredClone(report.replayMarkState!).targets],
    }
    moved.targets[0] = { ...moved.targets[0]!, x: moved.targets[0]!.x + 1 }
    const divergence = compareDevelopmentSelectedStateV1(
      report.mark!.frame,
      moved
    )
    assert.equal(divergence.disposition, 'diverged')
    assert.equal(divergence.firstDivergence!.tick, marked.tick)
    assert.match(divergence.firstDivergence!.path, /targets.*x/)
    const tampered = {
      ...structuredClone(report),
      prefix: [...structuredClone(report).prefix],
    }
    tampered.prefix[0] = { ...tampered.prefix[0]!, tick: 999 }
    const { evidenceSha256: _old, ...content } = tampered
    tampered.evidenceSha256 = developmentReproductionEvidenceSha256V1(content)
    assert.ok(validateDevelopmentReproductionReportV1(tampered).length > 0)
    // every retained observation participates even when the final state still matches
    const retained = await service.retainedTrace({ sessionId })
    assert.equal(retained.trace.schemaVersion, 2)
    if (retained.trace.schemaVersion !== 2)
      throw new Error('expected v2 capture')
    const exactTrace = retained.trace
    assert.deepEqual(
      report.checkpoints.map((point) => point.captureSequence),
      exactTrace.frames
        .filter(
          (frame) => frame.captureSequence <= report.mark!.frame.captureSequence
        )
        .map((frame) => frame.captureSequence)
    )
    assert.equal(report.checkpoints[0]!.tick, 0)
    assert.equal(report.checkpoints[0]!.startInputOrdinal, null)
    const intermediateFrame = exactTrace.marks.find(
      (mark) => mark.markId === intermediate.markId
    )!.frame
    const changedFrame = {
      ...intermediateFrame,
      targets: intermediateFrame.targets.map((target, index) =>
        index === 0 ? { ...target, x: target.x + 1 } : target
      ),
    }
    const intermediateDiverged = await reproduceDevelopmentMarkV1({
      sessionId,
      markId: marked.markId!,
      service: {
        retainedTrace: async () => ({
          ...retained,
          trace: {
            ...exactTrace,
            frames: exactTrace.frames.map((frame) =>
              frame.captureSequence === changedFrame.captureSequence
                ? changedFrame
                : frame
            ),
            marks: exactTrace.marks.map((mark) =>
              mark.markId === intermediate.markId
                ? { ...mark, frame: changedFrame }
                : mark
            ),
          },
        }),
        command: service.command.bind(service),
        retainEvidence: service.retainEvidence.bind(service),
      },
    })
    assert.equal(
      intermediateDiverged.disposition,
      'diverged',
      JSON.stringify(intermediateDiverged.issues)
    )
    const intermediateReport =
      await retainedJson<DevelopmentReproductionReportV2>(
        intermediateDiverged.result
      )
    assert.equal(
      intermediateReport.checkpoints.find(
        (point) => point.captureSequence === intermediateFrame.captureSequence
      )!.disposition,
      'diverged'
    )
    assert.equal(intermediateReport.checkpoints.at(-1)!.disposition, 'matched')
    const {
      chronologyPolicy: _chronology,
      captureComplete: _complete,
      ...legacyBase
    } = exactTrace
    const legacyFrames = exactTrace.frames.map(
      ({
        captureSequence: _sequence,
        inputOrdinal: _input,
        startInputOrdinal: _start,
        captureKind: _kind,
        ...frame
      }) => frame
    )
    const legacyTrace: DevelopmentTraceV1 = {
      ...legacyBase,
      schemaVersion: 1,
      kind: 'development-trace-v1',
      inputs: exactTrace.inputs.map(
        ({
          captureSequence: _sequence,
          interpretedKey: _key,
          releasedKeys: _released,
          ...input
        }) => input
      ),
      frames: legacyFrames,
      marks: exactTrace.marks.map((mark) => ({
        ...mark,
        frame: legacyFrames.find((frame) => frame.order === mark.frame.order)!,
      })),
    }
    const legacyBytes = JSON.stringify(legacyTrace)
    let refusedLaunches = 0
    let legacyWrites = 0
    const refuseEngine = async (): Promise<ProfileBrowserEngineV1> =>
    {
      refusedLaunches++
      throw new Error(
        'incomplete chronology must refuse before browser admission'
      )
    }
    await assert.rejects(
      reproduceDevelopmentMarkV1(
        {
          sessionId,
          markId: marked.markId!,
          service: {
            retainedTrace: async () => ({ ...retained, trace: legacyTrace }),
            command: service.command.bind(service),
            retainEvidence: async () =>
            {
              legacyWrites++
              throw new Error('legacy catalog must remain read-only')
            },
          },
        },
        { engineFactory: refuseEngine }
      ),
      (error: unknown) =>
        error instanceof Error &&
        'code' in error &&
        error.code === 'development.legacy_read_only' &&
        /chronology/.test(error.message)
    )
    assert.equal(legacyWrites, 0)
    const unavailableChronology = await reproduceDevelopmentMarkV1(
      {
        sessionId,
        markId: marked.markId!,
        service: {
          retainedTrace: async () => ({
            ...retained,
            trace: { ...exactTrace, captureComplete: false },
          }),
          command: service.command.bind(service),
          retainEvidence: service.retainEvidence.bind(service),
        },
      },
      { engineFactory: refuseEngine }
    )
    assert.equal(unavailableChronology.disposition, 'unavailable')
    assert.match(unavailableChronology.issues.join(';'), /chronology/)
    assert.equal(refusedLaunches, 0)
    assert.equal(JSON.stringify(legacyTrace), legacyBytes)
    // replay a deliberately corrupted retained key against unchanged state checkpoints
    const changedInputs = retained.trace.inputs.map((input) =>
      input.device === 'keyboard' &&
      input.data.key === 'a' &&
      input.data.isDown === true
        ? {
            ...input,
            interpretedKey: 'D',
            data: { ...input.data, key: 'd', keyCode: 68 },
          }
        : input
    )
    assert.notDeepEqual(changedInputs, retained.trace.inputs)
    const prefixDiverged = await reproduceDevelopmentMarkV1({
      sessionId,
      markId: marked.markId,
      service: {
        retainedTrace: async () => ({
          ...retained,
          trace: { ...exactTrace, inputs: changedInputs },
        }),
        command: service.command.bind(service),
        retainEvidence: service.retainEvidence.bind(service),
      },
    })
    assert.equal(
      prefixDiverged.disposition,
      'diverged',
      JSON.stringify(prefixDiverged.issues)
    )
    assert.ok(prefixDiverged.firstDivergence!.tick < marked.tick)
    assert.match(prefixDiverged.firstDivergence!.path, /targets.*x/)
    const divergenceReport =
      await retainedJson<DevelopmentReproductionReportV2>(prefixDiverged.result)
    assert.deepEqual(
      validateDevelopmentReproductionReportV1(divergenceReport),
      []
    )
    const bounded = await reproduceDevelopmentMarkV1({
      service,
      sessionId,
      markId: marked.markId,
      denseCapture: { maxFrames: 2, maxBytes: 1 },
    })
    assert.equal(bounded.disposition, 'unavailable')
    assert.match(bounded.issues.join(';'), /byte|budget|capture/i)
    await original.page
      .getByRole('button', { name: 'Resume', exact: true })
      .click()
    await original.page.waitForFunction(
      'window.__projectDebug.status().status === "running"',
      undefined,
      { timeout: 5000 }
    )
    await service.inspect({ sessionId })
    await original.page.locator('canvas').click()
    await original.page.keyboard.press('s')
    await service.command({ sessionId, command: { kind: 'advance', ticks: 1 } })
    const sound = await service.inspect({ sessionId, collection: 'sounds' })
    assert.ok(
      sound.items.some(
        (event) =>
          event.opcode === 'sound_play' && event.disposition === 'invoked'
      ),
      JSON.stringify(sound)
    )
    assertFinalTraceReservation(service, sessionId)
    const audio = await original.recordAudioClip({ durationMs: 100 })
    assert.equal(
      audio.status,
      'available',
      audio.issue ?? 'internal audio unavailable'
    )
    assert.equal(audio.origin, 'internal-runtime-output')
    assert.equal(audio.mimeType, 'audio/webm')
    assert.ok(audio.bytes!.length > 0)
    assert.equal(
      createHash('sha256').update(audio.bytes!).digest('hex'),
      audio.sha256
    )
    await original.page.keyboard.press('b')
    await service.command({ sessionId, command: { kind: 'advance', ticks: 1 } })
    const ambiguous = await original.observe()
    assert.equal(
      ambiguous.targets.filter((target) => target.cloneIdentity === 'ambiguous')
        .length,
      2
    )
    assert.equal(
      compareDevelopmentSelectedStateV1(ambiguous, ambiguous).disposition,
      'unavailable'
    )
    const ambiguousMark = await service.command({
      sessionId,
      command: { kind: 'mark', label: 'duplicate-keys' },
    })
    const unavailable = await reproduceDevelopmentMarkV1({
      service,
      sessionId,
      markId: ambiguousMark.markId!,
    })
    assert.equal(unavailable.disposition, 'unavailable')
    assert.match(
      unavailable.issues.join(';'),
      /clone association|ambiguous|duplicate declared clone/
    )
    await service.close({ sessionId })
    assert.deepEqual(
      await readFile(selected.sourcePath),
      Buffer.from(selected.bytes)
    )

    const native = await service.begin({
      sourcePath: selected.sourcePath,
      preset: 'turboWarp60',
      inputMode: 'human',
      visible: false,
      probe: {
        targets: [
          {
            targetIndex: 1,
            variableIds: [selected.key],
            listIds: [selected.list],
            includeClones: true,
            cloneKeyVariableId: selected.key,
          },
        ],
        maxListItems: 2,
      },
    })
    const nativeEngine = engine!
    await nativeEngine.page
      .getByRole('button', { name: 'Start', exact: true })
      .click()
    await nativeEngine.page.waitForFunction(
      'window.__projectDebug.status().tick >= 4'
    )
    const nativeMarked = await service.command({
      sessionId: native.sessionId,
      command: { kind: 'mark', label: 'native-clock' },
    })
    const converted = await reproduceDevelopmentMarkV1({
      service,
      sessionId: native.sessionId,
      markId: nativeMarked.markId!,
    })
    assert.notEqual(
      converted.disposition,
      'unavailable',
      JSON.stringify(converted.issues)
    )
    const convertedReport = await retainedJson<DevelopmentReproductionReportV2>(
      converted.result
    )
    assert.equal(
      convertedReport.schedulerConversion,
      'natural-to-deterministic'
    )
    assert.equal(convertedReport.exactNaturalScheduling, false)
    assert.ok(convertedReport.excludedPaths.includes('timer'))
    assert.equal(
      typeof convertedReport.timingDiagnostics.recordedTimer,
      'number'
    )
    assert.equal(typeof convertedReport.timingDiagnostics.replayTimer, 'number')
    assert.deepEqual(
      validateDevelopmentReproductionReportV1(convertedReport),
      []
    )
    const perf = await nativeEngine.readPerformanceDiagnostics()
    assert.equal(perf.diagnosticOnly, true)
    assert.equal(perf.status, 'available')
    assert.ok(perf.totalSteps >= 4)
    await service.close({ sessionId: native.sessionId })
    // a small operator quota must retain refusal identities even after partial capture
    const limited = await createDevelopmentServiceV1({
      permissions: {
        sourceRoots: [selected.sources],
        evidenceRoot: selected.evidence,
        limits: { maxEvidenceBytes: 16 * 1024 },
      },
      engineFactory: async (options) =>
      {
        engine = await openProfileBrowserEngineV1(options)
        return engine
      },
    })
    const small = await limited.begin({
      sourcePath: selected.sourcePath,
      profile,
      inputMode: 'human',
      visible: false,
      probe: {
        targets: [
          {
            targetIndex: 1,
            variableIds: [selected.key],
            includeClones: true,
            cloneKeyVariableId: selected.key,
          },
        ],
      },
    })
    await engine!.page
      .getByRole('button', { name: 'Start', exact: true })
      .click()
    await engine!.page.waitForFunction(
      'window.__projectDebug.status().status === "running"',
      undefined,
      { timeout: 5000 }
    )
    await limited.inspect({ sessionId: small.sessionId })
    await limited.command({
      sessionId: small.sessionId,
      command: { kind: 'advance', ticks: 6 },
    })
    const smallMark = await limited.command({
      sessionId: small.sessionId,
      command: { kind: 'mark', label: 'evidence-budget' },
    })
    const exactSnapshot = await limited.retainedTrace({
      sessionId: small.sessionId,
    })
    const exactTraceSha256 = createHash('sha256')
      .update(JSON.stringify(exactSnapshot.trace))
      .digest('hex')
    const exactMark = exactSnapshot.trace.marks.find(
      (mark) => mark.markId === smallMark.markId
    )!
    const exactPrefixSha256 = createHash('sha256')
      .update(
        JSON.stringify(
          exactSnapshot.trace.inputs.filter(
            (input) =>
              input.segmentId === exactMark.segmentId &&
              input.ordinal <= exactMark.inputOrdinal
          )
        )
      )
      .digest('hex')
    const refusal = await reproduceDevelopmentMarkV1({
      service: limited,
      sessionId: small.sessionId,
      markId: smallMark.markId!,
    })
    assert.equal(refusal.disposition, 'unavailable')
    const compact = await retainedJson<DevelopmentReproductionReportV2>(
      refusal.result
    )
    assert.equal(compact.inlineEvidence, 'omitted-budget-refusal')
    assert.match(compact.issues.join(';'), /byte\/artifact budget/)
    assert.equal(compact.sourceSha256, selected.sha256)
    assert.equal(compact.recordedTraceSha256, exactTraceSha256)
    assert.equal(compact.inputPrefixSha256, exactPrefixSha256)
    assert.ok(compact.markBoundary)
    assert.deepEqual(compact.frames, [])
    assert.deepEqual(compact.prefix, [])
    assert.equal(compact.inputApplicationVerified, false)
    assert.deepEqual(validateDevelopmentReproductionReportV1(compact), [])
    assert.ok(refusal.result.byteLength < 16 * 1024)
    assert.ok(refusal.frames.length > 0)
    await limited.close({ sessionId: small.sessionId })
  }
)
