// packages/localize/src/structural/report-types.ts
// serializable deterministic localization inputs, candidates, & context

import type {
  BlockRef,
  DeclarationRef,
  ProjectIR,
  ScriptRef,
} from '@scratch-agent/ir'
import type {
  DiagnosticFailure,
  NormalizedFailure,
  RepairTestSpec,
} from '@scratch-agent/eval'

type LocalizationReasonCode =
  | 'exact-diagnostic-block'
  | 'exact-runtime-block'
  | 'declaration-writer'
  | 'broadcast-edge'
  | 'procedure-edge'
  | 'related-symbol-script'
  | 'target-named'
  | 'supporting-static-warning'
  | 'prior-patch-new-failure'
  | 'dynamic-covered'

export interface LocalizationReason
{
  code: LocalizationReasonCode
  score: number
  failureFingerprint: string
  occurrences: number
  detail: string
  relatedBlocks: BlockRef[]
  declaration: DeclarationRef | null
}

export type LocalizationConfidence = 'high' | 'medium' | 'low'

export interface ReadableInput
{
  name: string
  value: string
}

export interface ReadableField
{
  name: string
  value: string
  id: string | null
}

export interface ReadableBlockContext
{
  block: BlockRef
  opcode: string | null
  relation: 'implicated' | 'ancestor' | 'dependency' | 'context'
  parentBlockId: string | null
  nextBlockId: string | null
  inputs: ReadableInput[]
  fields: ReadableField[]
  omittedInputCount: number
  omittedFieldCount: number
  truncatedScalarCount: number
}

export interface ScriptContext
{
  script: ScriptRef
  hatOpcode: string | null
  centeredOnBlockId: string | null
  blocks: ReadableBlockContext[]
  omittedBlockCount: number
  truncated: boolean
  truncationReasons: string[]
}

export interface LocalizationCandidate
{
  rank: number
  score: number
  confidence: LocalizationConfidence
  script: ScriptRef
  implicatedBlock: BlockRef | null
  reasons: LocalizationReason[]
  sourceFailureFingerprints: string[]
  context: ScriptContext
}

export interface UnresolvedLocalizationSignal
{
  source:
    | 'failure'
    | 'supporting-diagnostic'
    | 'dynamic'
    | 'prior-patch'
    | 'index'
    | 'test-context'
  sourceFingerprint: string | null
  reasonCode: string
  detail: string
  relatedBlocks: BlockRef[]
  relatedScripts: ScriptRef[]
}

interface DynamicCoverageSignal
{
  schemaVersion: 1
  baselineArtifactSha256: string
  testId: string
  failureFingerprint: string
  provider: { id: string; version: string }
  complete: boolean
  truncated: boolean
  coveredBlocks: readonly BlockRef[]
}

export interface PriorRejectedBlockSignal
{
  baselineArtifactSha256: string
  attemptId: string
  block: BlockRef
  introducedFailureFingerprints: readonly string[]
}

interface LocalizationOptions
{
  maxCandidates?: number
  maxContextBlocks?: number
  diagnostics?: readonly DiagnosticFailure[]
  dynamicCoverage?: readonly DynamicCoverageSignal[]
  priorRejectedBlocks?: readonly PriorRejectedBlockSignal[]
}

export interface LocalizationInput extends LocalizationOptions
{
  project: ProjectIR
  baselineArtifactSha256: string
  failures: readonly NormalizedFailure[]
  tests: readonly RepairTestSpec[]
}

export interface LocalizationReport
{
  schemaVersion: 1
  baselineArtifactSha256: string
  failures: string[]
  diagnostics: string[]
  candidates: LocalizationCandidate[]
  unresolved: UnresolvedLocalizationSignal[]
  dynamicProviders: Array<{ id: string; version: string }>
  limits: { maxCandidates: number; maxContextBlocks: number }
  omittedCandidateCount: number
}
