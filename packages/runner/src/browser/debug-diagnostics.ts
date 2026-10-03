// packages/runner/src/browser/debug-diagnostics.ts
// tap bounded internal audio output & measure native execution without exact-certificate claims

import type { ScratchVm, ScratchTarget } from '../vm/vm-api.js'
import type { RuntimeExecutionProfileV1 } from '../development/execution-profile.js'
import {
  PROFILE_AUDIO_LIMITS_V1,
  type ProfileAudioCaptureOptionsV1,
  type ProfilePageAudioClipV1,
  type ProfileSoundEventV1,
  type ProfilePerformanceSampleV1,
  type ProfilePagePerformanceV1,
} from '../development/profile-evidence-types.js'

interface DiagnosticsHostV1
{
  readonly vm: ScratchVm
  readonly audioEngine?: {
    readonly audioContext: AudioContext
    readonly inputNode: AudioNode
  }
  getProfile(): RuntimeExecutionProfileV1
  getTick(): number
  getElapsed(): number
  identify(
    target: ScratchTarget
  ): Pick<
    ProfileSoundEventV1,
    'targetIndex' | 'instance' | 'cloneKey' | 'cloneIdentity'
  >
}
export function installDebugDiagnosticsV1(host: DiagnosticsHostV1)
{
  const setRealTimeout = window.setTimeout.bind(window)
  const clearRealTimeout = window.clearTimeout.bind(window)
  const originals = new Map<string, (...args: unknown[]) => unknown>()
  let events: ProfileSoundEventV1[] = []
  let soundObserved = 0
  let soundDropped = 0
  const samples: ProfilePerformanceSampleV1[] = []
  let totalSteps = 0
  let vmTotal = 0
  let vmMaximum = 0
  let probeTotal = 0
  let overBudget = 0
  let previousStart: number | null = null
  let activeSince: number | null = null
  let activeElapsedMs = 0
  let activeStop: ((issue: string) => void) | null = null

  function event(
    opcode: string,
    args: unknown,
    util: unknown,
    disposition: 'invoked' | 'threw'
  ): void
  {
    soundObserved++
    if (soundObserved > PROFILE_AUDIO_LIMITS_V1.maxSoundEvents)
    {
      soundDropped++
      return
    }
    const values: Record<string, string | number | boolean> = Object.create(
      null
    ) as Record<string, string | number | boolean>
    if (args && typeof args === 'object')
      for (const key of Object.keys(args).slice(0, 16))
      {
        if (key.length > 64) continue
        const value = (args as Record<string, unknown>)[key]
        if (typeof value === 'string') values[key] = value.slice(0, 128)
        else if (
          (typeof value === 'number' && Number.isFinite(value)) ||
          typeof value === 'boolean'
        )
          values[key] = value
      }
    let identity: Pick<
      ProfileSoundEventV1,
      'targetIndex' | 'instance' | 'cloneKey' | 'cloneIdentity'
    > = {
      targetIndex: null,
      instance: 'unavailable',
      cloneKey: null,
      cloneIdentity: 'unavailable',
    }
    try
    {
      const target = (util as { target?: ScratchTarget } | undefined)?.target
      if (target) identity = host.identify(target)
    }
    catch
    {
      // a missing debug association must not change sound execution
    }
    events.push({
      ordinal: soundObserved,
      tick: host.getTick(),
      elapsedMs: host.getElapsed(),
      opcode,
      ...identity,
      args: values,
      disposition,
      diagnosticOnly: true,
    })
  }
  function unavailable(
    issue: string,
    tickStart = host.getTick()
  ): ProfilePageAudioClipV1
  {
    return {
      status: 'unavailable',
      tickStart,
      tickEnd: host.getTick(),
      durationMs: 0,
      mimeType: null,
      base64: null,
      issue,
    }
  }
  return {
    prepare(): void
    {
      for (const [opcode, primitive] of Object.entries(
        host.vm.runtime._primitives
      ))
      {
        if (!opcode.startsWith('sound_') && !opcode.startsWith('music_'))
          continue
        originals.set(opcode, primitive)
        host.vm.runtime._primitives[opcode] = function (...args: unknown[])
        {
          try
          {
            const result = Reflect.apply(primitive, this, args)
            event(opcode, args[0], args[1], 'invoked')
            return result
          }
          catch (error)
          {
            event(opcode, args[0], args[1], 'threw')
            throw error
          }
        }
      }
    },
    drainSoundEvents()
    {
      const result = events
      events = []
      return {
        events: result,
        observed: soundObserved,
        dropped: soundDropped,
        complete: soundDropped === 0,
        diagnosticOnly: true as const,
      }
    },
    resume(): void
    {
      if (host.getProfile().scheduler !== 'natural' || activeSince !== null)
        return
      activeSince = performance.now()
      previousStart = null
    },
    pause(): void
    {
      if (activeSince !== null)
        activeElapsedMs += Math.max(0, performance.now() - activeSince)
      activeSince = null
      previousStart = null
    },
    step(began: number, stepped: number, ended: number): void
    {
      if (host.getProfile().scheduler !== 'natural') return
      totalSteps++
      const vmStepMs = Math.max(0, stepped - began)
      const probeMs = Math.max(0, ended - stepped)
      vmTotal += vmStepMs
      vmMaximum = Math.max(vmMaximum, vmStepMs)
      probeTotal += probeMs
      if (ended - began > 1000 / host.getProfile().tickRate) overBudget++
      const sample = {
        tick: host.getTick(),
        startedElapsedMs: host.getElapsed() - (ended - began),
        interStepMs:
          previousStart === null ? null : Math.max(0, began - previousStart),
        vmStepMs,
        probeMs,
      }
      previousStart = began
      if (samples.length === 1200) samples.shift()
      samples.push(sample)
    },
    readPerformanceDiagnostics(): ProfilePagePerformanceV1
    {
      const available = host.getProfile().scheduler === 'natural'
      const elapsedMs =
        activeElapsedMs +
        (activeSince === null
          ? 0
          : Math.max(0, performance.now() - activeSince))
      return {
        schemaVersion: 1,
        status: available ? 'available' : 'unavailable',
        diagnosticOnly: true,
        profile: host.getProfile(),
        totalSteps,
        elapsedMs,
        observedHz:
          totalSteps > 1 && elapsedMs > 0
            ? (totalSteps * 1000) / elapsedMs
            : null,
        meanVmStepMs: totalSteps ? vmTotal / totalSteps : null,
        maxVmStepMs: totalSteps ? vmMaximum : null,
        meanProbeMs: totalSteps ? probeTotal / totalSteps : null,
        stepsOverClockBudget: overBudget,
        retainedSamples: [...samples],
        droppedSamples: Math.max(0, totalSteps - samples.length),
        issue: available
          ? null
          : 'performance diagnostics require the natural scheduler',
      }
    },
    async recordAudioClip(
      options: ProfileAudioCaptureOptionsV1
    ): Promise<ProfilePageAudioClipV1>
    {
      if (
        !options ||
        typeof options !== 'object' ||
        Object.keys(options).some(
          (key) => !['durationMs', 'maxBytes'].includes(key)
        )
      )
        throw new Error('invalid output audio capture options')
      const durationMs =
        options.durationMs ?? PROFILE_AUDIO_LIMITS_V1.defaultDurationMs
      const maxBytes = options.maxBytes ?? PROFILE_AUDIO_LIMITS_V1.defaultBytes
      if (
        !Number.isSafeInteger(durationMs) ||
        durationMs < 1 ||
        durationMs > PROFILE_AUDIO_LIMITS_V1.maxDurationMs ||
        !Number.isSafeInteger(maxBytes) ||
        maxBytes < 1 ||
        maxBytes > PROFILE_AUDIO_LIMITS_V1.maxBytes
      )
        throw new Error(
          'output audio capture exceeds its duration or byte limit'
        )
      if (activeStop)
        throw new Error('an output audio capture is already active')
      const audio = host.audioEngine
      if (!audio)
        return unavailable('internal runtime audio engine is unavailable')
      if (audio.audioContext.state !== 'running')
        return unavailable(
          `internal audio context is ${audio.audioContext.state}; activate audio through the physical playtest controls`
        )
      if (
        typeof MediaRecorder === 'undefined' ||
        !MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
      )
        return unavailable(
          'this browser cannot record internal WebM/Opus output'
        )
      const tickStart = host.getTick()
      const began = performance.now()
      const destination = audio.audioContext.createMediaStreamDestination()
      audio.inputNode.connect(destination)
      const chunks: Blob[] = []
      let bytes = 0
      let failure: string | null = null
      let timer: number | undefined
      let finishTimer: number | undefined
      let recorder: MediaRecorder | undefined
      try
      {
        recorder = new MediaRecorder(destination.stream, {
          mimeType: 'audio/webm;codecs=opus',
          audioBitsPerSecond: 128000,
        })
        const result = await new Promise<ProfilePageAudioClipV1>((resolve) =>
        {
          let resolved = false
          const settle = (value: ProfilePageAudioClipV1) =>
          {
            if (!resolved)
            {
              resolved = true
              resolve(value)
            }
          }
          const stop = () =>
          {
            if (finishTimer !== undefined) return
            if (recorder!.state !== 'inactive') recorder!.stop()
            finishTimer = setRealTimeout(
              () =>
                settle(
                  unavailable(
                    failure ?? 'output recorder did not finalize in time',
                    tickStart
                  )
                ),
              2000
            )
          }
          activeStop = (issue) =>
          {
            failure = issue
            stop()
          }
          recorder!.addEventListener('dataavailable', (event) =>
          {
            if (event.data.size === 0) return
            if (bytes + event.data.size > maxBytes)
            {
              failure = 'output audio byte budget exhausted'
              stop()
              return
            }
            bytes += event.data.size
            chunks.push(event.data)
          })
          recorder!.addEventListener('error', () =>
          {
            failure = 'internal output recorder failed'
            stop()
          })
          recorder!.addEventListener('stop', async () =>
          {
            if (failure)
            {
              settle(unavailable(failure, tickStart))
              return
            }
            const blob = new Blob(chunks, { type: 'audio/webm' })
            if (blob.size === 0)
            {
              settle(
                unavailable(
                  'internal output recorder produced no bytes',
                  tickStart
                )
              )
              return
            }
            const array = new Uint8Array(await blob.arrayBuffer())
            let encoded = ''
            for (let index = 0; index < array.length; index += 0x8000)
              encoded += String.fromCharCode(
                ...array.subarray(index, index + 0x8000)
              )
            settle({
              status: 'available',
              tickStart,
              tickEnd: host.getTick(),
              durationMs: Math.max(0, performance.now() - began),
              mimeType: 'audio/webm',
              base64: btoa(encoded),
              issue: null,
            })
          })
          recorder!.start(100)
          timer = setRealTimeout(stop, durationMs)
        })
        return result
      }
      catch (error)
      {
        return unavailable(
          error instanceof Error
            ? error.message
            : 'internal output recording failed',
          tickStart
        )
      }
      finally
      {
        if (timer !== undefined) clearRealTimeout(timer)
        if (finishTimer !== undefined) clearRealTimeout(finishTimer)
        if (recorder?.state === 'recording') recorder.stop()
        audio.inputNode.disconnect(destination)
        for (const track of destination.stream.getTracks()) track.stop()
        activeStop = null
      }
    },
    cancelAudioClip(): void
    {
      activeStop?.('output audio capture cancelled')
    },
    close(): void
    {
      activeStop?.('output capture interrupted by runtime closure')
      for (const [opcode, primitive] of originals)
        host.vm.runtime._primitives[opcode] = primitive
      originals.clear()
    },
  }
}
