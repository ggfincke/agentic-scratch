// packages/runner/src/browser/debug-runtime-page.ts
// isolate explicit clocks, human controls & bounded post-step debugging from legacy pages

import {
  SELECTED_STATE_PROBE_LIMITS_V1,
  validateSelectedStateProbeV1 as validateProbe,
} from '../development/selected-state.js'
import { installDebugDiagnosticsV1 } from './debug-diagnostics.js'
import {
  DEVELOPMENT_INPUT_POLICY_V2,
  DEVELOPMENT_CHRONOLOGY_POLICY_V2,
  isDevelopmentReleaseSourceV1,
} from '../development/input-policy.js'
import { InputController } from '../scenario/input.js'
import { installDeterminism, type Determinism } from '../policy/determinism.js'
import { readSnapshot, readBoundedSnapshot } from '../observation/snapshot.js'
import {
  createRuntimeObservationBudget,
  DEFAULT_RUNTIME_OBSERVATION_CAPS,
} from '../observation/observation.js'
import type { ScratchVm, ScratchTarget } from '../vm/vm-api.js'
import { readVisual, type PageRenderer } from './visual.js'
import type {
  ProfileAppliedInputEventV2,
  ProfileAppliedInputSourceV1,
  ProfileBrowserLimitsV1,
  ProfileInputV1,
  ProfileRuntimeFrameV1,
  ProfileRuntimeFrameV2,
  ProfileEvidenceBatchV2,
  ProfileRuntimeStatusV1,
  ProfileStateProbeV1,
  ProjectDebugPageApiV1,
} from '../development/profile-browser-types.js'
import {
  validateRuntimeExecutionProfileV1,
  type RuntimeExecutionProfileV1,
} from '../development/execution-profile.js'

export interface ProjectDebugPageHostV1
{
  readonly vm: ScratchVm
  readonly renderer: PageRenderer
  readonly canvas: HTMLCanvasElement
  loadProject(data: ArrayBuffer): Promise<void>
  configureClock(rate: 30 | 60): void
  startNative(): void
  stopNative(): void
  resumeAudioFromHuman?(): Promise<void>
  enableDevicesFromHuman?(): void
  readonly audioEngine?: {
    readonly audioContext: AudioContext
    readonly inputNode: AudioNode
  }
}

function finite(value: number, role: string): number
{
  if (!Number.isFinite(value)) throw new Error(`${role} is nonfinite`)
  return value
}

function boundedText(value: string, role: string, maximum = 256): string
{
  if (
    typeof value !== 'string' ||
    value.length > maximum ||
    value.includes('\0')
  )
    throw new Error(`${role} exceeds its string bound`)
  return value
}

export function installProjectDebugPageV1(host: ProjectDebugPageHostV1): void
{
  const vm = host.vm
  const runtime = vm.runtime
  const input = new InputController(vm)
  const realSetInterval = window.setInterval.bind(window)
  const realClearInterval = window.clearInterval.bind(window)
  let profile: RuntimeExecutionProfileV1 | null = null
  let inputMode: 'agent' | 'human' = 'agent'
  let limits: Required<ProfileBrowserLimitsV1>
  let determinism: Determinism | null = null
  let status: ProfileRuntimeStatusV1['status'] = 'ready'
  let issue: string | null = null
  let tick = 0
  let drawEpoch = 0
  let startedAt = performance.now()
  let appliedOrdinal = 0
  let captureSequence = 0
  let captureComplete = true
  let inputEvents = 0
  let releaseEvents = 0
  let stateCount = 0
  let stateBytes = 0
  let source: ProfileAppliedInputSourceV1 = 'human'
  let replayProvenance: ProfileAppliedInputSourceV1 | null = null
  let events: ProfileAppliedInputEventV2[] = []
  let frames: ProfileRuntimeFrameV2[] = []
  let probe: ProfileStateProbeV1 = {}
  let authoredTargets: readonly {
    targetIndex: number
    name: string
    isStage: boolean
  }[] = []
  let originalTargets = new Map<number, ScratchTarget>()
  const heldKeys = new Map<string, string>()
  let mouseDown = false
  let mouseData: Record<string, string | number | boolean> = {
    x: 240,
    y: 180,
    canvasWidth: 480,
    canvasHeight: 360,
  }
  let watchdog: number | undefined
  let originalStep = runtime._step
  let originalPost = vm.postIOData
  let originalDraw = host.renderer.draw
  let prepared = false
  let releasing = false
  let captureSuspended = false
  let startInputOrdinal: number | null = null
  let firstStart = true
  let broadcastThreads: unknown[] = []

  const elapsed = () => Math.max(0, performance.now() - startedAt)
  const state = (): ProfileRuntimeStatusV1 => ({
    tick,
    elapsedMs: elapsed(),
    drawEpoch,
    status,
    issue,
    startInputOrdinal,
    heldKeys: [...heldKeys.keys()].sort(),
    mouseDown,
  })

  function withSource<T>(
    value: ProfileAppliedInputSourceV1,
    callback: () => T
  ): T
  {
    const previous = source
    source = value
    try
    {
      return callback()
    }
    finally
    {
      source = previous
    }
  }

  function releaseInputs(reason: 'focus-release' | 'cleanup'): void
  {
    if (releasing) return
    releasing = true
    const previousProvenance = replayProvenance
    replayProvenance = null
    try
    {
      withSource(reason, () =>
      {
        for (const key of [...heldKeys.values()])
          vm.postIOData('keyboard', { key, isDown: false })
        if (mouseDown)
          vm.postIOData('mouse', { ...mouseData, isDown: false, button: 0 })
      })
    }
    finally
    {
      replayProvenance = previousProvenance
      releasing = false
    }
  }

  function applyInput(value: ProfileInputV1): ProfileRuntimeStatusV1
  {
    guard()
    return withSource('agent', () =>
    {
      if ('data' in value) vm.postIOData(value.device, { ...value.data })
      else if (value.device === 'keyboard')
      {
        if (value.isDown) input.pressKey(value.key)
        else input.releaseKey(value.key)
      }
      else if (value.isDown === undefined) input.moveMouse(value.x, value.y)
      else if (value.isDown) input.mouseDown(value.x, value.y)
      else input.mouseUp(value.x, value.y)
      return state()
    })
  }

  function fail(message: string): void
  {
    if (status === 'closed') return
    issue ??= boundedText(String(message), 'runtime issue', 2048)
    status = 'failed'
    diagnostics.pause()
    host.stopNative()
    releaseInputs('cleanup')
  }

  function guard(): void
  {
    if (!prepared || !profile) throw new Error('debug runtime is not prepared')
    if (status === 'closed' || status === 'failed')
      throw new Error(issue ?? `debug runtime is ${status}`)
    if (elapsed() >= limits.maxDurationMs)
    {
      fail('runtime duration budget exhausted')
      throw new Error(issue!)
    }
  }

  function exactInputData(
    device: 'keyboard' | 'mouse',
    data: Record<string, unknown>
  ): Record<string, string | number | boolean>
  {
    const allowed =
      device === 'keyboard'
        ? ['key', 'keyCode', 'isDown']
        : [
            'x',
            'y',
            'canvasWidth',
            'canvasHeight',
            'isDown',
            'button',
            'buttonId',
            'wasDragged',
          ]
    const copied = Object.create(null) as Record<
      string,
      string | number | boolean
    >
    for (const key of Object.keys(data))
    {
      if (!allowed.includes(key))
        throw new Error(`unsupported ${device} input property ${key}`)
      const descriptor = Object.getOwnPropertyDescriptor(data, key)
      if (!descriptor || !('value' in descriptor))
        throw new Error('input accessors cannot be captured')
      const value = descriptor.value as unknown
      if (typeof value === 'number') finite(value, key)
      else if (typeof value === 'string')
        boundedText(value, key, DEVELOPMENT_INPUT_POLICY_V2.maxKeyCodeUnits)
      else if (typeof value !== 'boolean')
        throw new Error('input payload must contain bounded scalar values')
      copied[key] = value as string | number | boolean
    }
    if (device === 'keyboard')
    {
      if (
        typeof copied.key !== 'string' ||
        typeof copied.isDown !== 'boolean' ||
        copied.key.length === 0
      )
        throw new Error(
          'keyboard input must use a bounded DOM key & boolean transition'
        )
      if (
        copied.keyCode !== undefined &&
        (!Number.isSafeInteger(copied.keyCode) ||
          Number(copied.keyCode) < 0 ||
          Number(copied.keyCode) > 255)
      )
        throw new Error('keyboard keyCode is invalid')
    }
    else
    {
      for (const key of ['x', 'y', 'canvasWidth', 'canvasHeight'])
        if (
          typeof copied[key] !== 'number' ||
          Math.abs(Number(copied[key])) > 1_000_000
        )
          throw new Error('mouse coordinates must be finite and bounded')
      if (
        Number(copied.canvasWidth) <= 0 ||
        Number(copied.canvasHeight) <= 0 ||
        (copied.isDown !== undefined && typeof copied.isDown !== 'boolean')
      )
        throw new Error('mouse canvas/transition is invalid')
      if (
        (copied.button !== undefined && copied.button !== 0) ||
        (copied.buttonId !== undefined && copied.buttonId !== 0)
      )
        throw new Error('only the left mouse button is supported')
    }
    return copied
  }

  function observe(
    selected: ProfileStateProbeV1 = probe
  ): ProfileRuntimeFrameV1
  {
    if (!prepared) throw new Error('debug runtime is not prepared')
    const checked = validateProbe(selected)
    const entries: NonNullable<ProfileStateProbeV1['targets']> =
      checked.targets ??
      authoredTargets
        .slice(0, SELECTED_STATE_PROBE_LIMITS_V1.maxTargets)
        .map((target) => ({ targetIndex: target.targetIndex }))
    const rows: ProfileRuntimeFrameV1['targets'][number][] = []
    const issues: string[] = []
    const budget = createRuntimeObservationBudget({
      ...DEFAULT_RUNTIME_OBSERVATION_CAPS,
      scalarSlotsPerSnapshot: 4096,
      snapshotBytes: 128 * 1024,
    })
    budget.beginSnapshot()
    for (const selection of entries)
    {
      const original = originalTargets.get(selection.targetIndex)
      if (!original)
      {
        issues.push(`target ${selection.targetIndex} is unavailable`)
        continue
      }
      const selectedTargets = selection.includeClones
        ? runtime.targets.filter(
            (target) =>
              target === original ||
              (!target.isOriginal && target.sprite === original.sprite)
          )
        : [original]
      const keys = new Map<string, number>()
      for (const target of selectedTargets)
      {
        if (target.isOriginal || selection.cloneKeyVariableId === undefined)
          continue
        const value = target.variables[selection.cloneKeyVariableId]?.value
        const key = JSON.stringify([typeof value, value])
        keys.set(key, (keys.get(key) ?? 0) + 1)
      }
      for (const target of selectedTargets)
      {
        if (rows.length >= 32)
          throw new Error('selected runtime instances exceed 32')
        const variables = Object.create(
          null
        ) as ProfileRuntimeFrameV1['targets'][number]['variables']
        const lists = Object.create(
          null
        ) as ProfileRuntimeFrameV1['targets'][number]['lists']
        for (const id of selection.variableIds ?? [])
        {
          const variable = target.variables[id]
          if (!variable || variable.type !== '')
          {
            issues.push(
              `variable ${id} is unavailable on target ${selection.targetIndex}`
            )
            continue
          }
          if (
            typeof variable.value === 'string' &&
            variable.value.length > 1024
          )
            throw new Error('selected scalar string exceeds 1024 characters')
          ;(variables as Record<string, unknown>)[id] = budget.chargeScalar(
            `variable/${id}`,
            variable.value
          )
        }
        for (const id of selection.listIds ?? [])
        {
          const list = target.variables[id]
          if (!list || list.type !== 'list' || !Array.isArray(list.value))
          {
            issues.push(
              `list ${id} is unavailable on target ${selection.targetIndex}`
            )
            continue
          }
          const items = list.value
            .slice(
              0,
              checked.maxListItems ??
                SELECTED_STATE_PROBE_LIMITS_V1.maxListItems
            )
            .map((value, index) =>
            {
              if (typeof value === 'string' && value.length > 1024)
                throw new Error('selected list string exceeds 1024 characters')
              return budget.chargeScalar(`list/${id}/${index}`, value)
            })
          ;(lists as Record<string, unknown>)[id] = {
            length: list.value.length,
            items,
          }
        }
        let cloneKey: string | number | boolean | null = null
        let cloneIdentity: ProfileRuntimeFrameV1['targets'][number]['cloneIdentity'] =
          'original'
        if (!target.isOriginal)
        {
          cloneIdentity =
            selection.cloneKeyVariableId === undefined
              ? 'unresolved'
              : 'unavailable'
          const declared =
            selection.cloneKeyVariableId === undefined
              ? undefined
              : target.variables[selection.cloneKeyVariableId]
          const value = declared?.value
          if (
            declared?.type === '' &&
            ((typeof value === 'string' &&
              value.length > 0 &&
              value.length <= 256) ||
              (typeof value === 'number' && Number.isFinite(value)) ||
              typeof value === 'boolean')
          )
          {
            const key = JSON.stringify([typeof value, value])
            if (keys.get(key) === 1)
            {
              cloneKey = value as string | number | boolean
              cloneIdentity = 'declared'
            }
            else
            {
              cloneKey = value as string | number | boolean
              cloneIdentity = 'ambiguous'
              issues.push(
                `duplicate declared clone key on target ${selection.targetIndex}`
              )
            }
          }
          else
            issues.push(
              `clone on target ${selection.targetIndex} has no declared stable key`
            )
        }
        rows.push({
          targetIndex: selection.targetIndex,
          name: boundedText(original.getName(), 'target name'),
          instance: target.isOriginal ? 'original' : 'clone',
          cloneKey,
          cloneIdentity,
          x: finite(target.x, 'x'),
          y: finite(target.y, 'y'),
          direction: finite(target.direction, 'direction'),
          size: finite(target.size, 'size'),
          volume: finite(target.volume, 'volume'),
          rotationStyle: boundedText(target.rotationStyle, 'rotation style'),
          draggable: target.draggable,
          effects: Object.fromEntries(
            Object.entries(target.effects).map(([key, value]) => [
              boundedText(key, 'effect name'),
              finite(value, 'effect value'),
            ])
          ),
          visible: target.visible,
          costumeIndexOneBased: target.currentCostume + 1,
          costumeName: boundedText(
            target.getCostumes()[target.currentCostume]?.name ?? '',
            'costume name'
          ),
          variables,
          lists,
        })
      }
    }
    return {
      tick,
      elapsedMs: elapsed(),
      drawEpoch,
      timer: finite(runtime.ioDevices.clock.projectTimer(), 'timer'),
      cloneCounts: {
        total: runtime.targets.filter((target) => !target.isOriginal).length,
        byTarget: entries.map((entry) => ({
          targetIndex: entry.targetIndex,
          count: runtime.targets.filter(
            (target) =>
              !target.isOriginal &&
              target.sprite === originalTargets.get(entry.targetIndex)?.sprite
          ).length,
        })),
      },
      status,
      targets: rows,
      issues,
    }
  }

  function capture(
    kind: ProfileRuntimeFrameV2['captureKind'] = 'post-step',
    selected: ProfileStateProbeV1 = probe
  ): ProfileRuntimeFrameV2 | null
  {
    if (stateCount >= limits.maxStateFrames)
    {
      captureComplete = false
      fail('post-step state frame budget exhausted')
      return null
    }
    try
    {
      const frame: ProfileRuntimeFrameV2 = {
        ...observe(selected),
        captureSequence: captureSequence + 1,
        inputOrdinal: appliedOrdinal,
        startInputOrdinal,
        captureKind: kind,
      }
      const bytes = new TextEncoder().encode(JSON.stringify(frame)).byteLength
      if (stateBytes + bytes > limits.maxStateBytes)
      {
        captureComplete = false
        fail('post-step state byte budget exhausted')
        return null
      }
      captureSequence++
      stateCount++
      stateBytes += bytes
      frames.push(frame)
      return frame
    }
    catch (error)
    {
      captureComplete = false
      fail(
        error instanceof Error ? error.message : 'post-step observation failed'
      )
      return null
    }
  }

  function drainEvidence(): ProfileEvidenceBatchV2
  {
    const batch: ProfileEvidenceBatchV2 = {
      schemaVersion: 2,
      chronologyPolicy: DEVELOPMENT_CHRONOLOGY_POLICY_V2,
      captureComplete,
      inputs: events,
      frames,
      status: state(),
    }
    events = []
    frames = []
    return batch
  }

  const diagnostics = installDebugDiagnosticsV1({
    vm,
    audioEngine: host.audioEngine,
    getProfile: () => profile!,
    getTick: () => tick,
    getElapsed: elapsed,
    identify: (target) =>
    {
      const original = [...originalTargets.entries()].find(
        ([, value]) => value === target || value.sprite === target.sprite
      )
      if (!original)
        return {
          targetIndex: null,
          instance: 'unavailable',
          cloneKey: null,
          cloneIdentity: 'unavailable',
        }
      if (target.isOriginal)
        return {
          targetIndex: original[0],
          instance: 'original',
          cloneKey: null,
          cloneIdentity: 'original',
        }
      const row = observe().targets.find(
        (row) =>
          row.targetIndex === original[0] &&
          row.instance === 'clone' &&
          row.cloneKey ===
            target.variables[
              probe.targets?.find((entry) => entry.targetIndex === original[0])
                ?.cloneKeyVariableId ?? ''
            ]?.value
      )
      return {
        targetIndex: original[0],
        instance: 'clone',
        cloneKey: row?.cloneKey ?? null,
        cloneIdentity: row?.cloneIdentity ?? 'unavailable',
      }
    },
  })
  const api: ProjectDebugPageApiV1 = {
    async load(url)
    {
      const response = await fetch(url)
      if (!response.ok)
        throw new Error(`project load failed: ${response.status}`)
      await host.loadProject(await response.arrayBuffer())
    },
    async prepare(options)
    {
      if (prepared)
        throw new Error(
          'a debug page cannot be reused for a new source segment'
        )
      profile = validateRuntimeExecutionProfileV1(options.profile)
      inputMode = options.inputMode
      limits = {
        ...options.limits,
        maxReleaseEvents:
          options.limits.maxReleaseEvents ??
          DEVELOPMENT_INPUT_POLICY_V2.maxReleaseEvents,
      }
      authoredTargets = options.targets
      host.stopNative()
      host.configureClock(profile.tickRate)
      for (let index = 0; index < 3; index++)
      {
        host.renderer.draw()
        await new Promise<void>((resolve) =>
          requestAnimationFrame(() => resolve())
        )
      }
      const originals = runtime.targets.filter((target) => target.isOriginal)
      originalTargets = new Map(
        authoredTargets.map((declared) =>
        {
          const matches = originals.filter(
            (target) =>
              target.isStage === declared.isStage &&
              target.getName() === declared.name
          )
          if (matches.length !== 1)
            throw new Error(
              `authored target ${declared.targetIndex} cannot be bound uniquely`
            )
          return [declared.targetIndex, matches[0]!] as const
        })
      )
      if (profile.scheduler === 'deterministic')
        determinism = installDeterminism(runtime, {
          seed: options.seed,
          fixedDateMs: options.fixedDateMs,
        })
      runtime.currentStepTime = 1000 / profile.tickRate
      originalDraw = host.renderer.draw
      host.renderer.draw = function (...args)
      {
        drawEpoch++
        return Reflect.apply(originalDraw, this, args)
      }
      originalPost = vm.postIOData
      vm.postIOData = function (device, data)
      {
        if (device !== 'keyboard' && device !== 'mouse')
          return Reflect.apply(originalPost, this, [device, data])
        if (!releasing) guard()
        const captured = exactInputData(device, data)
        const release = isDevelopmentReleaseSourceV1(replayProvenance ?? source)
        if (
          (!release && inputEvents >= limits.maxInputEvents) ||
          (release && releaseEvents >= limits.maxReleaseEvents)
        )
        {
          fail('applied input event budget exhausted')
          throw new Error(issue!)
        }
        if (release && captured.isDown !== false)
          throw new Error('cleanup input must release a held control')
        const keyboard = runtime.ioDevices.keyboard
        const beforeKeys = new Set(keyboard._keysPressed)
        let interpretedKey: string | null = null
        const nextKeys = new Set(beforeKeys)
        if (device === 'keyboard')
        {
          const converted = keyboard._keyStringToScratchKey(
            String(captured.key)
          )
          interpretedKey =
            converted === ''
              ? null
              : converted.length === 1
                ? converted.toUpperCase()
                : converted
          if (interpretedKey !== null)
          {
            boundedText(
              interpretedKey,
              'interpreted key',
              DEVELOPMENT_INPUT_POLICY_V2.maxKeyCodeUnits
            )
            if (captured.isDown) nextKeys.add(interpretedKey)
            else nextKeys.delete(interpretedKey)
            const previous =
              typeof captured.keyCode === 'number'
                ? keyboard._numeralKeyCodesToStringKey?.get(captured.keyCode)
                : undefined
            if (previous !== undefined && previous !== interpretedKey)
              nextKeys.delete(previous)
          }
        }
        if (nextKeys.size > DEVELOPMENT_INPUT_POLICY_V2.maxHeldKeys)
        {
          fail('held input key budget exhausted')
          throw new Error(issue!)
        }
        const nextMouseDown =
          device === 'mouse' && captured.isDown !== undefined
            ? Boolean(captured.isDown)
            : mouseDown
        if (
          releaseEvents +
            Number(release) +
            nextKeys.size +
            Number(nextMouseDown) >
          limits.maxReleaseEvents
        )
        {
          fail('held input release reserve exhausted')
          throw new Error(issue!)
        }
        const result = Reflect.apply(originalPost, this, [device, data])
        if (release) releaseEvents++
        else inputEvents++
        if (device === 'keyboard')
        {
          const actualKeys = new Set(keyboard._keysPressed)
          for (const key of heldKeys.keys())
            if (!actualKeys.has(key)) heldKeys.delete(key)
          if (
            interpretedKey !== null &&
            captured.isDown &&
            actualKeys.has(interpretedKey)
          )
            heldKeys.set(interpretedKey, String(captured.key))
        }
        else
        {
          mouseData = { ...mouseData, ...captured }
          if (captured.isDown !== undefined)
            mouseDown = Boolean(captured.isDown)
        }
        events.push({
          captureSequence: ++captureSequence,
          ordinal: ++appliedOrdinal,
          tick,
          elapsedMs: elapsed(),
          source,
          device,
          data: captured,
          interpretedKey,
          releasedKeys:
            device === 'keyboard'
              ? [...beforeKeys].filter(
                  (key) => !keyboard._keysPressed.includes(key)
                )
              : [],
        })
        return result
      }
      diagnostics.prepare()
      originalStep = runtime._step
      runtime._step = function ()
      {
        if (status === 'closed' || status === 'failed') return
        if (tick >= limits.maxTicks)
        {
          fail('runtime tick budget exhausted')
          return
        }
        const began = performance.now()
        let result: unknown
        try
        {
          result = Reflect.apply(originalStep, this, [])
        }
        catch (error)
        {
          captureComplete = false
          fail(error instanceof Error ? error.message : 'runtime step failed')
          throw error
        }
        const stepped = performance.now()
        determinism?.flushTimers()
        tick++
        capture()
        diagnostics.step(began, stepped, performance.now())
        if (
          profile!.scheduler === 'natural' &&
          tick >= limits.maxTicks &&
          issue === null
        )
        {
          diagnostics.pause()
          host.stopNative()
          status = 'paused'
        }
        return result
      }
      startedAt = performance.now()
      prepared = true
      watchdog = realSetInterval(() =>
      {
        if (elapsed() >= limits.maxDurationMs)
          fail('runtime duration budget exhausted')
      }, 100)
      buildControls()
    },
    start()
    {
      guard()
      if (!firstStart)
        throw new Error(
          'start is single-use; restart requires a fresh source segment'
        )
      firstStart = false
      startInputOrdinal = appliedOrdinal
      vm.greenFlag()
      status = 'running'
      if (profile!.scheduler === 'natural')
      {
        diagnostics.resume()
        host.startNative()
      }
      return state()
    },
    pause()
    {
      guard()
      diagnostics.pause()
      host.stopNative()
      status = 'paused'
      releaseInputs('focus-release')
      return state()
    },
    resume()
    {
      guard()
      if (firstStart)
        throw new Error('resume requires an existing started segment')
      if (tick >= limits.maxTicks)
        throw new Error('runtime tick budget exhausted')
      status = 'running'
      if (profile!.scheduler === 'natural')
      {
        diagnostics.resume()
        host.startNative()
      }
      return state()
    },
    applyInput(value)
    {
      return applyInput(value)
    },
    applyReplayInput(value, provenance)
    {
      if (!['agent', 'human', 'focus-release', 'cleanup'].includes(provenance))
        throw new Error('unsupported archived input provenance')
      const previousProvenance = replayProvenance
      replayProvenance = provenance
      try
      {
        return applyInput(value)
      }
      finally
      {
        replayProvenance = previousProvenance
      }
    },
    async advance(count)
    {
      guard()
      if (status !== 'running')
        throw new Error('advance requires a running deterministic segment')
      if (profile!.scheduler !== 'deterministic')
        throw new Error(
          'natural scheduling cannot be advanced with synthetic ticks'
        )
      if (
        !Number.isSafeInteger(count) ||
        count < 0 ||
        tick + count > limits.maxTicks
      )
        throw new Error('advance exceeds the finite logical tick budget')
      for (let index = 0; index < count; index++)
      {
        runtime._step()
        await Promise.resolve()
        guard()
      }
      return state()
    },
    observe,
    drainEvidence,
    observeEvidence(selected)
    {
      const observed = capture('observation', selected)
      if (!observed)
        throw new Error(issue ?? 'selected state capture unavailable')
      return {
        ...drainEvidence(),
        observedCaptureSequence: observed.captureSequence,
      }
    },
    configureProbe(value)
    {
      guard()
      probe = validateProbe(value)
    },
    drainAppliedEvents()
    {
      const result = events
      events = []
      return result
    },
    drainFrames()
    {
      const result = frames
      frames = []
      return result
    },
    status: state,
    snapshot(label)
    {
      if (!prepared) throw new Error('debug runtime is not prepared')
      boundedText(label, 'snapshot label')
      readBoundedSnapshot(
        runtime,
        createRuntimeObservationBudget(),
        tick,
        label
      )
      const value = readSnapshot(runtime, tick, label)
      const checked = JSON.stringify(value, (_key, entry: unknown) =>
      {
        if (typeof entry === 'number' && !Number.isFinite(entry))
          throw new Error('nonfinite raw snapshot cannot be serialized exactly')
        return entry
      })
      if (new TextEncoder().encode(checked).byteLength > 128 * 1024)
        throw new Error('raw snapshot exceeds its byte bound')
      return value
    },
    draw()
    {
      if (!prepared) throw new Error('debug runtime is not prepared')
      host.renderer.draw()
    },
    recordAudioClip: (options) => diagnostics.recordAudioClip(options),
    cancelAudioClip: () => diagnostics.cancelAudioClip(),
    drainSoundEvents: () => diagnostics.drainSoundEvents(),
    readPerformanceDiagnostics: () => diagnostics.readPerformanceDiagnostics(),
    setCaptureSuspended(suspended)
    {
      if (!prepared || status === 'closed')
        throw new Error('debug runtime is unavailable for capture')
      if (profile!.scheduler !== 'natural') return
      if (suspended)
      {
        captureSuspended = true
        diagnostics.pause()
        host.stopNative()
      }
      else if (captureSuspended)
      {
        captureSuspended = false
        if (status === 'running' && tick < limits.maxTicks)
        {
          diagnostics.resume()
          host.startNative()
        }
      }
    },
    visual()
    {
      if (!prepared) throw new Error('debug runtime is not prepared')
      return readVisual(host.renderer, runtime)
    },
    action(value)
    {
      guard()
      if (value.kind === 'clickSprite')
        input.clickSprite(boundedText(value.value ?? '', 'sprite name'))
      else if (value.kind === 'clickStage') input.clickStage()
      else if (value.kind === 'broadcast')
        input.broadcast(boundedText(value.value ?? '', 'broadcast name'))
      else input.answer(boundedText(value.value ?? '', 'answer', 1024))
    },
    beginBroadcastWait(name)
    {
      guard()
      broadcastThreads =
        runtime.startHats('event_whenbroadcastreceived', {
          BROADCAST_OPTION: boundedText(name, 'broadcast name'),
        }) ?? []
    },
    broadcastRunning()
    {
      return broadcastThreads.some((thread) => runtime.threads.includes(thread))
    },
    close()
    {
      if (status === 'closed') return
      diagnostics.pause()
      host.stopNative()
      releaseInputs('cleanup')
      if (watchdog !== undefined) realClearInterval(watchdog)
      runtime._step = originalStep
      vm.postIOData = originalPost
      host.renderer.draw = originalDraw
      diagnostics.close()
      determinism?.restore()
      status = 'closed'
    },
  }

  function buildControls(): void
  {
    if (inputMode !== 'human') return
    const controls = document.createElement('div')
    controls.style.cssText =
      'font:14px system-ui;padding:8px;display:flex;gap:6px;flex-wrap:wrap;align-items:center'
    const info = document.createElement('span')
    info.textContent = `${profile!.runtime} ${profile!.tickRate} Hz · ${profile!.scheduler}`
    controls.append(info)
    for (const control of [
      'start',
      'pause',
      'resume',
      'restart',
      'close',
    ] as const)
    {
      const button = document.createElement('button')
      button.textContent = control[0]!.toUpperCase() + control.slice(1)
      button.type = 'button'
      button.addEventListener('click', async (event) =>
      {
        try
        {
          if (event.isTrusted && (control === 'start' || control === 'resume'))
            await host.resumeAudioFromHuman?.()
          await (
            window as unknown as {
              __projectDebugControl?: (control: string) => Promise<void>
            }
          ).__projectDebugControl?.(control)
          info.textContent = `${profile!.runtime} ${profile!.tickRate} Hz · ${status} · tick ${tick}`
        }
        catch (error)
        {
          info.textContent =
            error instanceof Error ? error.message : 'control failed'
        }
      })
      controls.append(button)
    }
    const permission = document.createElement('button')
    permission.textContent = 'Allow camera / microphone'
    permission.type = 'button'
    permission.addEventListener('click', (event) =>
    {
      if (!event.isTrusted) return
      host.enableDevicesFromHuman?.()
      permission.textContent = 'Device requests may prompt in the browser'
      permission.disabled = true
    })
    controls.append(permission)
    document.body.append(controls)
  }

  window.addEventListener('blur', () =>
  {
    if (prepared && status !== 'closed') releaseInputs('focus-release')
  })
  document.addEventListener('visibilitychange', () =>
  {
    if (document.hidden && prepared && status !== 'closed')
      releaseInputs('focus-release')
  })
  window.__projectDebug = api
}
