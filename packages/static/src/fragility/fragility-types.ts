// packages/static/src/fragility/fragility-types.ts
// shared result types for fragility analysis

export type FragilitySignatureId =
  | 'fragility.warp-break'
  | 'fragility.startup-write-race'
  | 'fragility.warp-probe-restore'
  | 'fragility.timing-barrier-wait'
  | 'fragility.declaration-shadowing'
export type FragilityClass = 'flagged' | 'advisory'
export type FragilitySeverity = 'high' | 'medium' | 'low'
export type FragilityConfidence = 'high' | 'medium' | 'low'
export type FragilityVerdict = 'witnessed' | 'indeterminate'
export type FragilityIndeterminateReason =
  | 'malformed-warp'
  | 'mixed-warp-callers'
  | 'unresolved-closure'
  | 'unresolved-receivers'
  | 'unsupported-feature'

export interface FragilityEvidenceBlock
{
  targetName: string
  blockId: string
  opcode: string
  role: string
  detail: string
}

export interface FragilityFinding
{
  signature: FragilitySignatureId
  class: FragilityClass
  severity: FragilitySeverity
  confidence: FragilityConfidence
  verdict: FragilityVerdict
  indeterminateReason: FragilityIndeterminateReason | null
  targetName: string
  topBlockId: string | null
  message: string
  evidence: FragilityEvidenceBlock[]
  counterEvidence: string[]
}

export interface FragilitySignatureCoverage
{
  signature: FragilitySignatureId
  ran: boolean
  findingCount: number
  indeterminateCount: number
}

export interface FragilityBoundaryIdentity
{
  pinnedVmVersion: string
  boundaryTableSha256: string
}

export interface FragilityAnalysis
{
  findings: FragilityFinding[]
  advisories: FragilityFinding[]
  omitted: {
    findings: number
    advisories: number
  }
  coverage: FragilitySignatureCoverage[]
  boundaryModel: FragilityBoundaryIdentity
}
