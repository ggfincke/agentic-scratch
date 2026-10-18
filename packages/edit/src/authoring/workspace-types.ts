// packages/edit/src/authoring/workspace-types.ts
// operator permissions & retained identities for whole-project authoring

import { HARD_WORKSPACE_BUILD_LIMITS_V2 } from '@scratch-agent/ir/authoring'
import {
  HARD_SB3_LIMITS,
  type AssetPipelineLimitsV2,
  type AudioPipelineLimitsV1,
  type ConfiguredAudioDecoderV1,
  type EditAdmissionLimits,
  type Sb3Limits,
} from '@scratch-agent/sb3'
import type { AuthoringRuntimeIdentityV2 } from '@scratch-agent/eval'

export const AUTHORING_WORKSPACE_LIMITS_V1 = Object.freeze({
  maxSourceFiles: 4096,
  maxSourceFileBytes: 50 * 1024 * 1024,
  maxSourceJsonBytes: 10 * 1024 * 1024,
  maxTotalSourceBytes: 160 * 1024 * 1024,
  maxPlans: 16,
  maxBuilds: 32,
  maxEvaluations: 32,
  maxRetainedBytes: 1024 * 1024 * 1024,
  maxRetainedArtifacts: 16384,
  maxInspectionPageSize: 64,
  maxArtifactReadBytes: 1024 * 1024,
})

// the most a host may raise each workspace limit to: sources at the hard build &
// admission ceilings, & a retained budget above a worker holding a hard-sized
// archive, its output & twice its assets; record counts stay at their defaults
export const HARD_AUTHORING_WORKSPACE_LIMITS_V1 = Object.freeze({
  ...AUTHORING_WORKSPACE_LIMITS_V1,
  maxSourceFiles: HARD_WORKSPACE_BUILD_LIMITS_V2.maximumSourceFiles,
  maxSourceFileBytes: HARD_SB3_LIMITS.maxCompressedBytes,
  maxSourceJsonBytes: HARD_SB3_LIMITS.maxProjectJsonBytes,
  maxTotalSourceBytes: HARD_WORKSPACE_BUILD_LIMITS_V2.maximumSourceBytes,
  maxRetainedBytes: 8 * 1024 * 1024 * 1024,
})

export interface AuthoringWorkspaceLimitsV1
{
  maxSourceFiles: number
  maxSourceFileBytes: number
  maxSourceJsonBytes: number
  maxTotalSourceBytes: number
  maxPlans: number
  maxBuilds: number
  maxEvaluations: number
  maxRetainedBytes: number
  maxRetainedArtifacts: number
  maxInspectionPageSize: number
  maxArtifactReadBytes: number
}

export interface AuthoringOperatorPermissionsV1
{
  readonly sourceRoots: readonly string[]
  readonly evidenceRoot: string
  readonly outputRoots: readonly string[]
  readonly limits?: Partial<AuthoringWorkspaceLimitsV1>
  readonly archiveLimits?: Partial<Sb3Limits>
  readonly editLimits?: Partial<EditAdmissionLimits>
  readonly preprocessingLimits?: Partial<AssetPipelineLimitsV2>
  readonly audioLimits?: Partial<AudioPipelineLimitsV1>
  readonly ffmpeg?: ConfiguredAudioDecoderV1
}

export interface AuthoringArtifactRefV1
{
  readonly workspaceId: string
  readonly key: string
  readonly path: string
  readonly sha256: string
  readonly byteLength: number
  readonly mimeType: string
}

export interface AuthoringSourceSnapshotV1
{
  readonly logicalPath: string
  readonly canonicalPath: string
  readonly selectedPath: string
  readonly sha256: string
  readonly byteLength: number
  readonly role: 'workspace' | 'baseline' | 'json' | 'asset'
  readonly artifact: AuthoringArtifactRefV1
}

export interface AuthoringToolIdentityV1
{
  readonly semanticAuthorityId: 'standard-v2'
  readonly standardAuthoritySha256: string
  readonly compilerIdentitySha256: string
  readonly executionArtifactsSha256: string
  readonly runtimeIdentities: readonly AuthoringRuntimeIdentityV2[]
  readonly runtimeIdentitiesSha256: string
}

export interface AuthoringWholeBuildContractV2
{
  readonly schemaVersion: 2
  readonly kind: 'whole-project-authoring-v2'
  readonly sourceClosureSha256: string
  readonly preparedAssetsSha256: string
  readonly operationOrderSha256: string
  readonly costsSha256: string
  readonly permissionsSha256: string
  readonly tools: AuthoringToolIdentityV1
  readonly expectedCandidateSha256: string
  readonly contractSha256: string
}

export type AuthoringWorkspaceCollectionV1 =
  | 'status'
  | 'sources'
  | 'assets'
  | 'clips'
  | 'plans'
  | 'builds'
  | 'evaluations'
  | 'exports'
  | 'publications'
  | 'artifacts'
  | 'diff'

export type AuthoringPublicationFaultPointV1 =
  | 'quota-reserved'
  | 'intent-before-state'
  | 'intent-retained'
  | 'prepared-file-created'
  | 'prepared-before-state'
  | 'prepared-retained'
  | 'before-commit'
  | 'after-commit'
  | 'before-receipt'
  | 'after-receipt'
  | 'before-state'
  | 'after-state'

export interface AuthoringPublicationSummaryV1
{
  readonly schemaVersion: 1
  readonly exportId: string
  readonly buildId: string
  readonly candidateSha256: string
  readonly path: string
  readonly phase: 'intent' | 'prepared' | 'published' | 'complete' | 'aborted'
  readonly status:
    'pending' | 'recovery-required' | 'interference' | 'complete' | 'aborted'
  readonly recoverable: boolean
  readonly intent: AuthoringArtifactRefV1
  readonly prepared: AuthoringArtifactRefV1 | null
  readonly receipt: AuthoringArtifactRefV1 | null
  readonly issues: readonly string[]
}

export interface AuthoringPublicationOutcomeV1 extends AuthoringPublicationSummaryV1
{
  readonly workspaceId: string
  readonly sha256: string
  readonly byteLength: number
}

export class AuthoringWorkspaceErrorV1 extends Error
{
  readonly code: string

  constructor(code: string, message: string, options?: ErrorOptions)
  {
    super(message, options)
    this.name = 'AuthoringWorkspaceErrorV1'
    this.code = code
  }
}
