// packages/runner/src/development/profile-browser-types.ts
// bounded browser engine ports for applied input & post-step selected state

import type {
  ProfileVisualCaptureOptionsV1,
  ProfileVisualFrameV1,
  ProfileAudioCaptureOptionsV1,
  ProfileAudioClipV1,
  ProfileSoundEventsV1,
  ProfilePerformanceDiagnosticsV1,
  ProfilePageAudioClipV1,
  ProfilePagePerformanceV1,
} from './profile-evidence-types.js'
import type { Page } from 'playwright'
import type { RuntimeDescriptorV1 } from '../lineage/runtime-identity.js'
import type { ObservedRuntimeValueV1 } from '../observation/runtime-observation.js'
import type {
  VmStateSnapshot,
  VisualObservation,
  BrowserConsoleSummary,
} from '../policy/types.js'
import type { RuntimeExecutionProfileV1 } from './execution-profile.js'
import {
  DEVELOPMENT_INPUT_POLICY_V1,
  DEVELOPMENT_CHRONOLOGY_POLICY_V2,
} from './input-policy.js'

export interface ProfileBrowserLimitsV1
{
  readonly maxTicks: number
  readonly maxDurationMs: number
  readonly maxInputEvents: number
  readonly maxReleaseEvents?: number
  readonly maxStateFrames: number
  readonly maxStateBytes: number
}

export const PROFILE_BROWSER_LIMITS_V1: Readonly<
  Required<ProfileBrowserLimitsV1>
> = Object.freeze({
  maxTicks: 10_000,
  maxDurationMs: 30 * 60_000,
  maxInputEvents: DEVELOPMENT_INPUT_POLICY_V1.maxInputEvents,
  maxReleaseEvents: DEVELOPMENT_INPUT_POLICY_V1.maxReleaseEvents,
  maxStateFrames: 10_000,
  maxStateBytes: 16 * 1024 * 1024,
})

export type ProfileAppliedInputSourceV1 =
  'agent' | 'human' | 'focus-release' | 'cleanup'
export interface ProfileAppliedInputEventV1
{
  readonly ordinal: number
  readonly tick: number
  readonly elapsedMs: number
  readonly source: ProfileAppliedInputSourceV1
  readonly device: 'keyboard' | 'mouse'
  readonly data: Readonly<Record<string, string | number | boolean>>
}

export interface ProfileAppliedInputEventV2 extends ProfileAppliedInputEventV1
{
  readonly captureSequence: number
  readonly interpretedKey: string | null
  readonly releasedKeys: readonly string[]
}

export type ProfileInputV1 =
  | {
      readonly device: 'keyboard'
      readonly key: string
      readonly isDown: boolean
    }
  | {
      readonly device: 'mouse'
      readonly x: number
      readonly y: number
      readonly isDown?: boolean
    }
  | {
      readonly device: 'keyboard' | 'mouse'
      readonly data: Readonly<Record<string, string | number | boolean>>
    }

export interface ProfileStateProbeV1
{
  readonly targets?: readonly {
    readonly targetIndex: number
    readonly variableIds?: readonly string[]
    readonly listIds?: readonly string[]
    readonly includeClones?: boolean
    readonly cloneKeyVariableId?: string
  }[]
  readonly maxListItems?: number
}

export interface ProfileRuntimeFrameV1
{
  readonly tick: number
  readonly elapsedMs: number
  readonly drawEpoch: number
  readonly timer: number
  readonly cloneCounts: {
    readonly total: number
    readonly byTarget: readonly {
      readonly targetIndex: number
      readonly count: number
    }[]
  }
  readonly status: 'ready' | 'running' | 'paused' | 'failed' | 'closed'
  readonly targets: readonly {
    readonly targetIndex: number
    readonly name: string
    readonly instance: 'original' | 'clone'
    readonly cloneKey: string | number | boolean | null
    readonly cloneIdentity:
      'original' | 'declared' | 'unresolved' | 'unavailable' | 'ambiguous'
    readonly x: number
    readonly y: number
    readonly direction: number
    readonly size: number
    readonly volume: number
    readonly rotationStyle: string
    readonly draggable: boolean
    readonly effects: Readonly<Record<string, number>>
    readonly visible: boolean
    readonly costumeIndexOneBased: number
    readonly costumeName: string
    readonly variables: Readonly<Record<string, ObservedRuntimeValueV1>>
    readonly lists: Readonly<
      Record<
        string,
        {
          readonly length: number
          readonly items: readonly ObservedRuntimeValueV1[]
        }
      >
    >
  }[]
  readonly issues: readonly string[]
}

export interface ProfileRuntimeFrameV2 extends ProfileRuntimeFrameV1
{
  readonly captureSequence: number
  readonly inputOrdinal: number
  readonly startInputOrdinal: number | null
  readonly captureKind: 'post-step' | 'observation'
}

export interface ProfileEvidenceBatchV2
{
  readonly schemaVersion: 2
  readonly chronologyPolicy: typeof DEVELOPMENT_CHRONOLOGY_POLICY_V2
  readonly captureComplete: boolean
  readonly inputs: readonly ProfileAppliedInputEventV2[]
  readonly frames: readonly ProfileRuntimeFrameV2[]
  readonly status: ProfileRuntimeStatusV1
}

export interface ProfileObservedEvidenceV2 extends ProfileEvidenceBatchV2
{
  readonly observedCaptureSequence: number
}

export interface ProfileNumericSelectorV1
{
  readonly targetIndex: number
  readonly instance?:
    'original' | { readonly cloneKey: string | number | boolean }
  readonly property:
    | 'x'
    | 'y'
    | 'direction'
    | 'size'
    | 'volume'
    | 'costumeIndexOneBased'
    | { readonly variableId: string }
}
export interface ProfileNumericProbeResultV1
{
  readonly status: 'available' | 'unavailable' | 'ambiguous'
  readonly value: number | null
  readonly issue: string | null
}

export interface ProfileRuntimeStatusV1
{
  readonly startInputOrdinal: number | null
  readonly tick: number
  readonly elapsedMs: number
  readonly drawEpoch: number
  readonly status: ProfileRuntimeFrameV1['status']
  readonly issue: string | null
  readonly heldKeys: readonly string[]
  readonly mouseDown: boolean
}

export interface OpenProfileBrowserEngineOptionsV1
{
  readonly sb3: Uint8Array
  readonly profile: RuntimeExecutionProfileV1
  readonly headless: boolean
  readonly inputMode: 'agent' | 'human'
  readonly seed?: number
  readonly fixedDateMs?: number
  readonly limits?: Partial<ProfileBrowserLimitsV1>
  readonly signal?: AbortSignal
  readonly onAppliedEvent?: (
    event: ProfileAppliedInputEventV1
  ) => void | Promise<void>
  readonly onControl?: (
    control: 'start' | 'pause' | 'resume' | 'restart' | 'close'
  ) => void | Promise<void>
}

export interface ProfileBrowserEngineV1
{
  readonly evidencePolicy?: typeof DEVELOPMENT_CHRONOLOGY_POLICY_V2
  readonly sourceSha256: string
  readonly profile: RuntimeExecutionProfileV1
  readonly runtimeDescriptor: RuntimeDescriptorV1
  readonly page: Page
  start(): Promise<ProfileRuntimeStatusV1>
  pause(): Promise<ProfileRuntimeStatusV1>
  resume(): Promise<ProfileRuntimeStatusV1>
  applyInput(input: ProfileInputV1): Promise<ProfileRuntimeStatusV1>
  applyReplayInput?(
    input: ProfileInputV1,
    provenance: ProfileAppliedInputSourceV1
  ): Promise<ProfileRuntimeStatusV1>
  advance(ticks: number): Promise<ProfileRuntimeStatusV1>
  observe(probe?: ProfileStateProbeV1): Promise<ProfileRuntimeFrameV1>
  drainEvidence?(): Promise<ProfileEvidenceBatchV2>
  observeEvidence?(
    probe?: ProfileStateProbeV1
  ): Promise<ProfileObservedEvidenceV2>
  configureProbe(probe: ProfileStateProbeV1): Promise<void>
  drainAppliedEvents(): Promise<readonly ProfileAppliedInputEventV1[]>
  drainFrames(): Promise<readonly ProfileRuntimeFrameV1[]>
  status(): Promise<ProfileRuntimeStatusV1>
  snapshot(label: string): Promise<VmStateSnapshot>
  draw(): Promise<void>
  captureVisualFrame(
    options?: ProfileVisualCaptureOptionsV1
  ): Promise<ProfileVisualFrameV1>
  recordAudioClip(
    options?: ProfileAudioCaptureOptionsV1
  ): Promise<ProfileAudioClipV1>
  drainSoundEvents(): Promise<ProfileSoundEventsV1>
  readPerformanceDiagnostics(): Promise<ProfilePerformanceDiagnosticsV1>
  diagnostics(): {
    errors: readonly string[]
    consoleLog: readonly string[]
    consoleSummary: BrowserConsoleSummary
  }
  close(): Promise<void>
}

export interface ProjectDebugPageApiV1
{
  load(url: string): Promise<void>
  prepare(input: {
    profile: RuntimeExecutionProfileV1
    inputMode: 'agent' | 'human'
    seed: number
    fixedDateMs: number
    limits: ProfileBrowserLimitsV1
    targets: readonly { targetIndex: number; name: string; isStage: boolean }[]
  }): Promise<void>
  start(): ProfileRuntimeStatusV1
  pause(): ProfileRuntimeStatusV1
  resume(): ProfileRuntimeStatusV1
  applyInput(input: ProfileInputV1): ProfileRuntimeStatusV1
  applyReplayInput(
    input: ProfileInputV1,
    provenance: ProfileAppliedInputSourceV1
  ): ProfileRuntimeStatusV1
  advance(ticks: number): Promise<ProfileRuntimeStatusV1>
  observe(probe?: ProfileStateProbeV1): ProfileRuntimeFrameV1
  drainEvidence(): ProfileEvidenceBatchV2
  observeEvidence(probe?: ProfileStateProbeV1): ProfileObservedEvidenceV2
  configureProbe(probe: ProfileStateProbeV1): void
  drainAppliedEvents(): readonly ProfileAppliedInputEventV1[]
  drainFrames(): readonly ProfileRuntimeFrameV1[]
  status(): ProfileRuntimeStatusV1
  snapshot(label: string): VmStateSnapshot
  draw(): void
  setCaptureSuspended(suspended: boolean): void
  recordAudioClip(
    options: ProfileAudioCaptureOptionsV1
  ): Promise<ProfilePageAudioClipV1>
  cancelAudioClip(): void
  drainSoundEvents(): ProfileSoundEventsV1
  readPerformanceDiagnostics(): ProfilePagePerformanceV1
  visual(): VisualObservation
  action(input: {
    kind: 'clickSprite' | 'clickStage' | 'broadcast' | 'answer'
    value?: string
  }): void
  beginBroadcastWait(name: string): void
  broadcastRunning(): boolean
  close(): void
}

declare global
{
  interface Window
  {
    __projectDebug?: ProjectDebugPageApiV1
  }
}
