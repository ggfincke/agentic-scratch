// packages/eval/src/fragility-check/fragility-check-contract.ts
// public report, issue, boundary, & claim contracts for fragility checks

import type { RunVersions } from '@scratch-agent/runner'
import type {
  FragilityFinding,
  FragilitySignatureCoverage,
} from '@scratch-agent/static'

export const FRAGILITY_CHECK_ISSUE_CODES = {
  inputReadFailed: 'FRAGILITY_CHECK_INPUT_READ_FAILED',
  admissionFailed: 'FRAGILITY_CHECK_ADMISSION_FAILED',
  analysisFailed: 'FRAGILITY_CHECK_ANALYSIS_FAILED',
  internalFailed: 'FRAGILITY_CHECK_INTERNAL_FAILED',
} as const

export type FragilityCheckIssueCode =
  (typeof FRAGILITY_CHECK_ISSUE_CODES)[keyof typeof FRAGILITY_CHECK_ISSUE_CODES]

export interface FragilityCheckIssue
{
  code: string
  message: string
  stage?: string
}

export interface FragilityCheckReport
{
  schemaVersion: 1
  runId: string
  sourceRevision: string
  createdAt: string
  completedAt: string | null
  input: {
    displayName: string
    sha256: string | null
    byteLength: number | null
  }
  host: {
    platform: string
    architecture: string
    cpuModel: string
    logicalCpuCount: number
    totalMemoryBytes: number
  }
  versions: RunVersions
  conversionProvenance: {
    semver: string | null
    vm: string | null
    agent: string | null
    origin: string | null
    inference:
      | 'consistent-with-conversion'
      | 'consistent-with-native-authoring'
      | 'unknown'
  }
  boundaryModel: {
    pinnedVmVersion: string
    boundaryTableSha256: string
    corroboratedBy: {
      probeScriptSha256: string
    }
  }
  findings: FragilityFinding[]
  advisories: FragilityFinding[]
  signatureCoverage: FragilitySignatureCoverage[]
  truncation: {
    findingsOmitted: number
    advisoriesOmitted: number
    evidenceOmittedPerFinding: number
    counterEvidenceOmittedPerFinding: number
    textValuesTruncated: number
    textBytesOmitted: number
  }
  issues: FragilityCheckIssue[]
  overall: {
    status: 'passed' | 'failed'
    failOnSeverity: 'high' | 'medium' | 'low' | null
    gatedFindingCount: number
  }
  claims: {
    proves: string[]
    doesNotProve: string[]
    claimScope: string
  }
}

export const FRAGILITY_CLAIM_SCOPE =
  'Finite static evidence may support only: the named fragility signatures were or were not witnessed in this artifact block graph, under the pinned scratch-vm semantics recorded in the boundary model. It is not a claim that the project is correct, incorrect, converted, or runtime-broken, and it makes no claim about Scratch 2 behavior.'

export const MAX_REPORT_FINDINGS = 200
export const MAX_REPORT_ADVISORIES = 200
export const MAX_EVIDENCE_PER_FINDING = 12
export const MAX_COUNTER_EVIDENCE_PER_FINDING = 12
export const MAX_REPORT_TEXT_VALUE_BYTES = 192
export const MAX_FRAGILITY_REPORT_ARTIFACT_BYTES = 32 * 1024 * 1024
