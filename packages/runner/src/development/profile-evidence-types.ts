// packages/runner/src/development/profile-evidence-types.ts
// bounded visual evidence & separately labeled output audio & native timing diagnostics

import type { RendererGeometryV1 } from '../observation/observation.js'
import type { RuntimeExecutionProfileV1 } from './execution-profile.js'
import type { ProfileRuntimeFrameV1 } from './profile-browser-types.js'

export const PROFILE_VISUAL_CAPTURE_DEFAULTS_V1 = Object.freeze({
  maxFrames: 120,
  maxBytes: 25 * 1024 * 1024,
})
export const PROFILE_VISUAL_CAPTURE_MAXIMUMS_V1 = Object.freeze({
  maxFrames: 240,
  maxBytes: 50 * 1024 * 1024,
})
export interface ProfileVisualCaptureOptionsV1
{
  readonly limits?: { readonly maxFrames?: number; readonly maxBytes?: number }
}
export interface ProfileVisualFrameV1
{
  readonly schemaVersion: 1
  readonly ordinal: number
  readonly tick: number
  readonly sourceSha256: string
  readonly runtimeIdentitySha256: string
  readonly profile: RuntimeExecutionProfileV1
  readonly state: ProfileRuntimeFrameV1
  readonly geometry: RendererGeometryV1
  readonly width: number
  readonly height: number
  readonly bytes: Uint8Array
  readonly sha256: string
  readonly byteLength: number
}
export const PROFILE_AUDIO_LIMITS_V1 = Object.freeze({
  defaultDurationMs: 3000,
  maxDurationMs: 10000,
  defaultBytes: 2 * 1024 * 1024,
  maxBytes: 5 * 1024 * 1024,
  maxSoundEvents: 2048,
})
export interface ProfileAudioCaptureOptionsV1
{
  readonly durationMs?: number
  readonly maxBytes?: number
  readonly signal?: AbortSignal
}
export interface ProfileAudioClipV1
{
  readonly schemaVersion: 1
  readonly status: 'available' | 'unavailable'
  readonly diagnosticOnly: true
  readonly origin: 'internal-runtime-output'
  readonly sourceSha256: string
  readonly runtimeIdentitySha256: string
  readonly profile: RuntimeExecutionProfileV1
  readonly tickStart: number
  readonly tickEnd: number
  readonly durationMs: number
  readonly mimeType: 'audio/webm' | null
  readonly bytes: Uint8Array | null
  readonly sha256: string | null
  readonly byteLength: number
  readonly issue: string | null
}
export interface ProfileSoundEventV1
{
  readonly ordinal: number
  readonly tick: number
  readonly elapsedMs: number
  readonly opcode: string
  readonly targetIndex: number | null
  readonly instance: 'original' | 'clone' | 'unavailable'
  readonly cloneKey: string | number | boolean | null
  readonly cloneIdentity:
    'original' | 'declared' | 'unresolved' | 'unavailable' | 'ambiguous'
  readonly args: Readonly<Record<string, string | number | boolean>>
  readonly disposition: 'invoked' | 'threw'
  readonly diagnosticOnly: true
}
export interface ProfileSoundEventsV1
{
  readonly events: readonly ProfileSoundEventV1[]
  readonly observed: number
  readonly dropped: number
  readonly complete: boolean
  readonly diagnosticOnly: true
}
export interface ProfilePerformanceSampleV1
{
  readonly tick: number
  readonly startedElapsedMs: number
  readonly interStepMs: number | null
  readonly vmStepMs: number
  readonly probeMs: number
}
export interface ProfilePerformanceDiagnosticsV1
{
  readonly schemaVersion: 1
  readonly status: 'available' | 'unavailable'
  readonly diagnosticOnly: true
  readonly profile: RuntimeExecutionProfileV1
  readonly sourceSha256: string
  readonly runtimeIdentitySha256: string
  readonly totalSteps: number
  readonly elapsedMs: number
  readonly observedHz: number | null
  readonly meanVmStepMs: number | null
  readonly maxVmStepMs: number | null
  readonly meanProbeMs: number | null
  readonly stepsOverClockBudget: number
  readonly retainedSamples: readonly ProfilePerformanceSampleV1[]
  readonly droppedSamples: number
  readonly issue: string | null
}
export interface ProfilePageAudioClipV1
{
  readonly status: 'available' | 'unavailable'
  readonly tickStart: number
  readonly tickEnd: number
  readonly durationMs: number
  readonly mimeType: 'audio/webm' | null
  readonly base64: string | null
  readonly issue: string | null
}
export type ProfilePagePerformanceV1 = Omit<
  ProfilePerformanceDiagnosticsV1,
  'sourceSha256' | 'runtimeIdentitySha256'
>
