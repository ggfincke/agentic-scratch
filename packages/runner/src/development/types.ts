// packages/runner/src/development/types.ts
// operator boundaries & retained records for live development sessions

import type { RuntimeDescriptorV1 } from '../lineage/runtime-identity.js'
import type { RuntimeExecutionProfileV1 } from './execution-profile.js'
import {
  DEVELOPMENT_INPUT_POLICY_V1,
  DEVELOPMENT_CHRONOLOGY_POLICY_V2,
} from './input-policy.js'
import type {
  ProfileAppliedInputEventV1,
  ProfileAppliedInputEventV2,
  ProfileRuntimeFrameV1,
  ProfileRuntimeFrameV2,
  ProfileStateProbeV1,
} from './profile-browser-types.js'
import type {
  ProfileSoundEventV1,
  ProfilePerformanceDiagnosticsV1,
} from './profile-evidence-types.js'

export const DEVELOPMENT_LIMITS_V1 = Object.freeze({
  maxSourceBytes: 50 * 1024 * 1024,
  maxSessions: 1,
  maxCommands: 1024,
  maxSegments: 16,
  maxTicks: 10000,
  maxDurationMs: 30 * 60 * 1000,
  maxInputEvents: DEVELOPMENT_INPUT_POLICY_V1.maxInputEvents,
  maxReleaseEvents: DEVELOPMENT_INPUT_POLICY_V1.maxReleaseEvents,
  maxStateFrames: 10000,
  maxTraceBytes: 16 * 1024 * 1024,
  maxRetainedBytes: 256 * 1024 * 1024,
  maxRetainedArtifacts: 1024,
  maxMarks: 128,
  maxInspectionPageSize: 64,
  maxArtifactReadBytes: 1024 * 1024,
  maxEvidenceBytes: 100 * 1024 * 1024,
  maxEvidenceArtifacts: 512,
  maxViewerBytes: 64 * 1024 * 1024,
  maxClipSourceBytes: 2 * 1024 * 1024,
  maxClipFrames: 256,
  maxOverlays: 64,
  maxSoundEvents: 2048,
  maxPerformanceSamples: 1200,
})

export interface DevelopmentLimitsV1
{
  maxSourceBytes: number
  maxSessions: number
  maxCommands: number
  maxSegments: number
  maxTicks: number
  maxDurationMs: number
  maxInputEvents: number
  maxReleaseEvents: number
  maxStateFrames: number
  maxTraceBytes: number
  maxRetainedBytes: number
  maxRetainedArtifacts: number
  maxMarks: number
  maxInspectionPageSize: number
  maxArtifactReadBytes: number
  maxEvidenceBytes: number
  maxEvidenceArtifacts: number
  maxViewerBytes: number
  maxClipSourceBytes: number
  maxClipFrames: number
  maxOverlays: number
  maxSoundEvents: number
  maxPerformanceSamples: number
}

export interface DevelopmentOperatorPermissionsV1
{
  readonly sourceRoots: readonly string[]
  readonly evidenceRoot: string
  readonly limits?: Partial<DevelopmentLimitsV1>
  readonly profiles?: readonly RuntimeExecutionProfileV1[]
}

export interface DevelopmentBeginRequestV1
{
  readonly sourcePath: string
  readonly expectedSourceSha256?: string
  readonly profile?: RuntimeExecutionProfileV1
  readonly preset?: 'official30' | 'turboWarp60'
  readonly visible?: boolean
  readonly inputMode?: 'agent' | 'human'
  readonly probe?: ProfileStateProbeV1
  readonly seed?: number
  readonly fixedDateMs?: number
  readonly signal?: AbortSignal
}

export type DevelopmentInputV1 =
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

export type DevelopmentCommandV1 =
  | { readonly kind: 'start' | 'pause' | 'resume' | 'restart' }
  | { readonly kind: 'input'; readonly input: DevelopmentInputV1 }
  | { readonly kind: 'advance'; readonly ticks: number }
  | { readonly kind: 'mark'; readonly label: string }

export type DevelopmentSessionStatusV1 =
  | 'ready'
  | 'running'
  | 'paused'
  | 'exhausted'
  | 'cancelled'
  | 'failed'
  | 'closed'

export interface DevelopmentArtifactRefV1
{
  readonly sessionId: string
  readonly key: string
  readonly path: string
  readonly sha256: string
  readonly byteLength: number
  readonly mimeType: string
}

export interface DevelopmentInputRecordV1 extends ProfileAppliedInputEventV1
{
  readonly segmentId: string
  readonly order: number
}

export interface DevelopmentFrameRecordV1 extends ProfileRuntimeFrameV1
{
  readonly segmentId: string
  readonly order: number
}

export interface DevelopmentInputRecordV2 extends ProfileAppliedInputEventV2
{
  readonly segmentId: string
  readonly order: number
}

export interface DevelopmentFrameRecordV2 extends ProfileRuntimeFrameV2
{
  readonly segmentId: string
  readonly order: number
}

export interface DevelopmentSoundRecordV1 extends ProfileSoundEventV1
{
  readonly segmentId: string
  readonly order: number
}

export interface DevelopmentPerformanceRecordV1
{
  readonly segmentId: string
  readonly performance: ProfilePerformanceDiagnosticsV1
}

export interface DevelopmentCommandRecordV1
{
  readonly kind: 'command'
  readonly order: number
  readonly segmentId: string
  readonly tick: number
  readonly command: DevelopmentCommandV1
  readonly disposition: 'applied' | 'refused'
  readonly issue?: string
}

export interface DevelopmentMarkV1
{
  readonly markId: string
  readonly label: string
  readonly segmentId: string
  readonly tick: number
  readonly inputOrdinal: number
  readonly startInputOrdinal: number | null
  readonly order: number
  readonly frame: DevelopmentFrameRecordV1
}

export interface DevelopmentMarkV2 extends Omit<DevelopmentMarkV1, 'frame'>
{
  readonly frame: DevelopmentFrameRecordV2
}

export interface DevelopmentSegmentV1
{
  readonly segmentId: string
  readonly ordinal: number
  readonly sourceSha256: string
  readonly runtimeIdentitySha256: string
  readonly runtimeDescriptor: RuntimeDescriptorV1
  readonly profile: RuntimeExecutionProfileV1
  readonly seed: number
  readonly fixedDateMs: number
  readonly openedAt: string
  closedAt: string | null
  finalTick: number
  inputEvents: number
  startInputOrdinal: number | null
  status: DevelopmentSessionStatusV1
}

export interface DevelopmentTraceV1
{
  readonly schemaVersion: 1
  readonly kind: 'development-trace-v1'
  readonly sessionId: string
  readonly sourceSha256: string
  readonly profile: RuntimeExecutionProfileV1
  readonly inputMode: 'agent' | 'human'
  readonly probe?: ProfileStateProbeV1
  readonly segments: readonly DevelopmentSegmentV1[]
  readonly inputs: readonly DevelopmentInputRecordV1[]
  readonly commands: readonly DevelopmentCommandRecordV1[]
  readonly frames: readonly DevelopmentFrameRecordV1[]
  readonly marks: readonly DevelopmentMarkV1[]
  readonly issues: readonly string[]
  readonly sounds?: readonly DevelopmentSoundRecordV1[]
  readonly soundCoverage?: {
    readonly observed: number
    readonly dropped: number
    readonly complete: boolean
    readonly diagnosticOnly: true
  }
  readonly diagnostics?: readonly DevelopmentPerformanceRecordV1[]
}

export interface DevelopmentTraceV2 extends Omit<
  DevelopmentTraceV1,
  'schemaVersion' | 'kind' | 'inputs' | 'frames' | 'marks'
>
{
  readonly schemaVersion: 2
  readonly kind: 'development-trace-v2'
  readonly chronologyPolicy: typeof DEVELOPMENT_CHRONOLOGY_POLICY_V2
  readonly captureComplete: boolean
  readonly inputs: readonly DevelopmentInputRecordV2[]
  readonly frames: readonly DevelopmentFrameRecordV2[]
  readonly marks: readonly DevelopmentMarkV2[]
}

export type DevelopmentTrace = DevelopmentTraceV1 | DevelopmentTraceV2

export type DevelopmentCollectionV1 =
  | 'status'
  | 'events'
  | 'inputs'
  | 'segments'
  | 'marks'
  | 'state'
  | 'artifacts'
  | 'trace'
  | 'sounds'
  | 'diagnostics'

export class DevelopmentErrorV1 extends Error
{
  readonly code: string

  constructor(code: string, message: string, options?: ErrorOptions)
  {
    super(message, options)
    this.name = 'DevelopmentErrorV1'
    this.code = code
  }
}
