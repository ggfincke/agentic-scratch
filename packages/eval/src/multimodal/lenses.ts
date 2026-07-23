// packages/eval/src/multimodal/lenses.ts
// finite-scope behavioral lens contracts & strict aggregate verdicts

import type {
  MultimodalEvidenceLocator,
  MultimodalVerdict,
} from './multimodal-contracts.js'
import { MULTIMODAL_SCHEMA_VERSION } from './multimodal-contracts.js'
import type { RuntimeDescriptorV1 } from '@scratch-agent/runner'

type BehavioralLensKind =
  | 'final-state'
  | 'labeled-trace'
  | 'visual-keyframes'
  | 'runtime-outcome'
  | 'clone-count-trace'

interface BehavioralLensSpecBaseV1
{
  schemaVersion: typeof MULTIMODAL_SCHEMA_VERSION
  id: string
  required: boolean
  appliesTo: 'baseline-candidate' | 'runtime-runtime' | 'both'
}

export type BehavioralLensSpecV1 =
  | (BehavioralLensSpecBaseV1 & {
      kind: 'final-state'
      absoluteNumericTolerance: number
      numericToleranceByPath?: Record<string, number>
    })
  | (BehavioralLensSpecBaseV1 & {
      kind: 'labeled-trace'
      labels: string[]
      absoluteNumericTolerance: number
      numericToleranceByPath?: Record<string, number>
    })
  | (BehavioralLensSpecBaseV1 & {
      kind: 'visual-keyframes'
      frameIds: string[]
      maxMeanRgbDelta: number
      maxNormalizedRectDelta: number
    })
  | (BehavioralLensSpecBaseV1 & {
      kind: 'runtime-outcome'
    })
  | (BehavioralLensSpecBaseV1 & {
      kind: 'clone-count-trace'
      ticks: number[]
    })

type LensVerdict = 'agree' | 'diverge' | 'inconclusive'

export type DifferentialRuntimePair =
  | 'official-headless-vs-turbowarp-browser'
  | 'official-browser-vs-turbowarp-browser'
  | 'custom-runtime-pair'

export type DifferentialCapabilityKind =
  | 'renderer'
  | 'audio'
  | 'network'
  | 'extension'
  | 'video'
  | 'hardware'
  | 'external-input'

export interface DifferentialCapabilityUseV1
{
  kind: DifferentialCapabilityKind
  support: 'supported' | 'unsupported'
  reason: string | null
  opcodes: string[]
  omittedOpcodeCount: number
  details: string[]
  omittedDetailCount: number
}

export interface DifferentialCapabilityAssessmentV1
{
  schemaVersion: typeof MULTIMODAL_SCHEMA_VERSION
  status: 'classified' | 'assessed' | 'not-assessed'
  runtimePair: DifferentialRuntimePair
  classification: 'comparable' | 'unsupported' | 'unknown'
  sourceSb3Sha256: string | null
  leftRuntimeDescriptorSha256: string | null
  rightRuntimeDescriptorSha256: string | null
  declaredExtensions: string[]
  omittedDeclaredExtensionCount: number
  inventory: {
    costumeCount: number
    soundCount: number
    cloudVariableCount: number
  }
  capabilities: DifferentialCapabilityUseV1[]
}

export interface DifferentialCapabilityRequirementV1
{
  specId: string
  capability: 'renderer'
  support: 'supported' | 'unsupported'
  reason: string | null
}

export type LensInconclusiveReason =
  | 'observation-unavailable'
  | 'observation-incomplete'
  | 'unsupported-feature'
  | 'runtime-failure'
  | 'infrastructure-failure'
  | 'invalid-specification'
  | 'capability-not-assessed'
  | 'capability-binding-mismatch'
  | 'not-applicable'

export interface LensDifference
{
  path: string
  left: string
  right: string
  detail: string
  evidence: MultimodalEvidenceLocator[]
}

export interface LensResultV1
{
  schemaVersion: typeof MULTIMODAL_SCHEMA_VERSION
  specId: string
  kind: BehavioralLensKind
  required: boolean
  verdict: LensVerdict
  inconclusiveReason: LensInconclusiveReason | null
  differences: LensDifference[]
  omittedDifferenceCount: number
  evidence: MultimodalEvidenceLocator[]
}

export interface DifferentialRunBindingV1
{
  artifactSha256: string
  runtimeDescriptor: RuntimeDescriptorV1
  runtimeDescriptorSha256: string
  scenarioSha256: string
  seed: number | null
  fixedDateMs: number | null
  labels: string[]
}

export interface DifferentialReportV1
{
  schemaVersion: typeof MULTIMODAL_SCHEMA_VERSION
  comparisonKind: 'baseline-candidate' | 'runtime-runtime'
  left: DifferentialRunBindingV1
  right: DifferentialRunBindingV1
  capabilityAssessment: DifferentialCapabilityAssessmentV1
  capabilityRequirements: DifferentialCapabilityRequirementV1[]
  specs: BehavioralLensSpecV1[]
  results: LensResultV1[]
  verdict: MultimodalVerdict
  claimScope: string
}

export function aggregateLensResults(
  results: readonly LensResultV1[]
): MultimodalVerdict
{
  const required = results.filter((result) => result.required)
  if (required.length === 0)
    throw new Error('at least one required lens is needed')
  if (required.some((result) => result.verdict === 'diverge')) return 'failed'
  if (required.every((result) => result.verdict === 'agree')) return 'passed'
  return 'inconclusive'
}
