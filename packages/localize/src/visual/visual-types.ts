// packages/localize/src/visual/visual-types.ts
// artifact-bound visual symptom localization contracts & exact IR identities

import type { DeclarationRef, ScriptRef, TargetRef } from '@scratch-agent/ir'
import type { RendererGeometryV1 } from '@scratch-agent/runner'
import type { VisualSymptom } from '@scratch-agent/eval'

export const VISUAL_LOCALIZATION_SCHEMA_VERSION = 1 as const
export const MAX_VISUAL_LOCALIZATION_SYMPTOMS = 32
export const MAX_VISUAL_LOCALIZATION_FRAMES = 120
export const MAX_VISUAL_LOCALIZATION_TARGETS_PER_FRAME = 512
export const DEFAULT_VISUAL_LOCALIZATION_CANDIDATES = 16
export const MAX_VISUAL_LOCALIZATION_CANDIDATES = 64

export interface VisualLocalizationEvidenceFrameV1
{
  evidenceId: string
  frameId: string
  tick: number
  geometry: RendererGeometryV1
}

export interface VisualLocalizationEvidenceSetV1
{
  schemaVersion: typeof VISUAL_LOCALIZATION_SCHEMA_VERSION
  artifactSha256: string
  frames: readonly VisualLocalizationEvidenceFrameV1[]
}

export interface VisualSymptomLocalizationInputV1
{
  schemaVersion: typeof VISUAL_LOCALIZATION_SCHEMA_VERSION
  artifactSha256: string
  artifactBytes: Uint8Array
  symptoms: readonly VisualSymptom[]
  evidence: VisualLocalizationEvidenceSetV1 | null
  maxCandidatesPerSymptom?: number
}

export interface MonitorRefV1
{
  monitorIndex: number
  id: string
  opcode: string
  spriteName: string | null
}

export interface CostumeRefV1
{
  target: TargetRef
  costumeIndex: number
  name: string
  assetId: string
  dataFormat: string
  md5ext: string | null
  assetPath: string
}

export interface AssetRefV1
{
  assetIndex: number
  path: string
  byteLength: number
  sha256: string
}

export type VisualLocalizationIdentityV1 =
  | { kind: 'target'; target: TargetRef }
  | { kind: 'script'; script: ScriptRef }
  | {
      kind: 'declaration'
      declaration: DeclarationRef
      monitor: MonitorRefV1
    }
  | { kind: 'costume'; costume: CostumeRefV1 }
  | { kind: 'asset'; asset: AssetRefV1 }

type VisualLocalizationReasonCode =
  | 'exact-subject-target'
  | 'exact-monitor-declaration'
  | 'exact-asset-name'
  | 'exact-costume-asset'
  | 'region-overlap'
  | 'visual-opcode-script'
  | 'exact-asset-script'
  | 'monitor-writer-script'
  | 'monitor-reader-script'

export interface VisualLocalizationReasonV1
{
  code: VisualLocalizationReasonCode
  score: number
  detail: string
  evidenceIndexes: number[]
}

export interface VisualLocalizationCandidateV1
{
  rank: number
  score: number
  identitySha256: string
  identity: VisualLocalizationIdentityV1
  provenance: {
    artifactSha256: string
    symptomId: string
    symptomSha256: string
  }
  reasons: VisualLocalizationReasonV1[]
}

type VisualSymptomResolutionStatus =
  'resolved' | 'partial' | 'unresolved'

type VisualLocalizationUnresolvedCode =
  | 'subject-unknown'
  | 'target-hint-not-found'
  | 'target-hint-ambiguous'
  | 'stage-not-unique'
  | 'monitor-owner-not-found'
  | 'monitor-owner-ambiguous'
  | 'monitor-record-not-found'
  | 'monitor-record-ambiguous'
  | 'monitor-declaration-not-found'
  | 'monitor-declaration-ambiguous'
  | 'asset-hint-not-found'
  | 'asset-hint-ambiguous'
  | 'asset-file-not-found'
  | 'asset-file-ambiguous'
  | 'evidence-unavailable'
  | 'evidence-locator-not-found'
  | 'evidence-locator-ambiguous'
  | 'region-target-not-found'
  | 'region-target-ambiguous'
  | 'region-subject-conflict'

export interface VisualLocalizationUnresolvedV1
{
  code: VisualLocalizationUnresolvedCode
  detail: string
  blocking: boolean
  evidenceIndexes: number[]
  candidateIdentitySha256s: string[]
}

export interface VisualSymptomSelectionsV1
{
  target: TargetRef | null
  script: ScriptRef | null
  declaration: {
    declaration: DeclarationRef
    monitor: MonitorRefV1
  } | null
  costume: CostumeRefV1 | null
  asset: AssetRefV1 | null
}

export interface VisualSymptomLocalizationV1
{
  symptomId: string
  symptomSha256: string
  status: VisualSymptomResolutionStatus
  selected: VisualSymptomSelectionsV1
  candidates: VisualLocalizationCandidateV1[]
  omittedCandidateCount: number
  unresolved: VisualLocalizationUnresolvedV1[]
}

export interface VisualSymptomLocalizationReportV1
{
  schemaVersion: typeof VISUAL_LOCALIZATION_SCHEMA_VERSION
  artifactSha256: string
  symptomsSha256: string
  evidenceSha256: string | null
  inputSha256: string
  reportSha256: string
  localizer: { id: 'scratch-agent-visual-localizer'; version: '1' }
  limits: {
    maxSymptoms: number
    maxEvidenceFrames: number
    maxEvidenceBytes: number
    maxTargetsPerFrame: number
    maxArtifactBytes: number
    maxCandidatesPerSymptom: number
  }
  counts: {
    symptoms: number
    resolved: number
    partial: number
    unresolved: number
    candidates: number
    omittedCandidates: number
  }
  symptoms: VisualSymptomLocalizationV1[]
}

export interface VisualSymptomLocalizationIssue
{
  path: string
  code:
    | 'invalid-type'
    | 'invalid-value'
    | 'missing-key'
    | 'unknown-key'
    | 'limit-exceeded'
    | 'duplicate-id'
  message: string
}

export class VisualSymptomLocalizationError extends Error
{
  readonly issues: readonly VisualSymptomLocalizationIssue[]

  constructor(issues: readonly VisualSymptomLocalizationIssue[])
  {
    super(
      `Visual symptom localization failed: ${issues
        .map((issue) => `${issue.path} ${issue.message}`)
        .join('; ')}`
    )
    this.name = 'VisualSymptomLocalizationError'
    this.issues = Object.freeze(
      issues.map((issue) => Object.freeze({ ...issue }))
    )
  }
}
