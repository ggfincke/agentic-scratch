// packages/ir/src/repair/repair-types.ts
// serializable contracts for guarded semantic Scratch repairs

import type {
  TargetProperty,
  TargetPropertyValues,
} from '../project/target-properties.js'

export interface TargetRef
{
  targetIndex: number
  name: string
  isStage: boolean
}

export interface BlockRef
{
  target: TargetRef
  blockId: string
}

export interface ScriptRef
{
  target: TargetRef
  topBlockId: string
}

export interface VariableRef
{
  kind: 'variable'
  declarationTarget: TargetRef
  id: string
  name: string
}

export interface ListRef
{
  kind: 'list'
  declarationTarget: TargetRef
  id: string
  name: string
}

export interface BroadcastRef
{
  kind: 'broadcast'
  declarationTarget: TargetRef
  id: string
  name: string
}

export type DeclarationRef = VariableRef | ListRef | BroadcastRef

export type NumericLiteralKind =
  'number' | 'positive-number' | 'positive-integer' | 'integer' | 'angle'

export type RepairLiteral =
  | {
      kind: NumericLiteralKind
      value: string | number
    }
  | {
      kind: 'color'
      value: string
    }
  | {
      kind: 'text'
      value: string | number
    }

export type RepairInput =
  | RepairLiteral
  | DeclarationRef
  | {
      kind: 'reporter' | 'boolean'
      block: RepairBlockSpec
    }
  | {
      kind: 'substack'
      blocks: RepairBlockSpec[]
    }

export type RepairField = string | number | null | DeclarationRef

export interface RepairBlockSpec
{
  opcode: string
  inputs?: Record<string, RepairInput>
  fields?: Record<string, RepairField>
}

interface RepairOpBase
{
  opId: string
}

interface ReplaceLiteralOp extends RepairOpBase
{
  kind: 'replaceLiteral'
  block: BlockRef
  inputName: string
  expectedOpcode: string
  from: RepairLiteral
  to: RepairLiteral
}

interface ReplaceCompatibleOpcodeOp extends RepairOpBase
{
  kind: 'replaceCompatibleOpcode'
  block: BlockRef
  fromOpcode: string
  toOpcode: string
}

export interface ReferenceSite
{
  container: 'input' | 'field'
  name: string
}

interface ReplaceVariableRefOp extends RepairOpBase
{
  kind: 'replaceVariableRef'
  block: BlockRef
  expectedOpcode: string
  site: ReferenceSite
  from: VariableRef
  to: VariableRef
}

interface ReplaceBroadcastRefOp extends RepairOpBase
{
  kind: 'replaceBroadcastRef'
  block: BlockRef
  expectedOpcode: string
  site: ReferenceSite
  from: BroadcastRef
  to: BroadcastRef
}

interface InsertStatementsAfterOp extends RepairOpBase
{
  kind: 'insertStatementsAfter'
  anchor: BlockRef
  expectedOpcode: string
  statements: RepairBlockSpec[]
}

interface DeleteStatementOp extends RepairOpBase
{
  kind: 'deleteStatement'
  statement: BlockRef
  expectedOpcode: string
}

interface AddScriptOp extends RepairOpBase
{
  kind: 'addScript'
  target: TargetRef
  statements: RepairBlockSpec[]
}

type SetTargetPropertyOp = {
  [K in TargetProperty]: RepairOpBase & {
    kind: 'setTargetProperty'
    target: TargetRef
    property: K
    from: TargetPropertyValues[K]
    to: TargetPropertyValues[K]
  }
}[TargetProperty]

export type RepairOp =
  | ReplaceLiteralOp
  | ReplaceCompatibleOpcodeOp
  | ReplaceVariableRefOp
  | ReplaceBroadcastRefOp
  | InsertStatementsAfterOp
  | DeleteStatementOp
  | AddScriptOp
  | SetTargetPropertyOp

export type RepairOpKind = RepairOp['kind']

export interface SemanticPatch
{
  schemaVersion: 1
  baseArtifactSha256: string
  operations: RepairOp[]
}

export interface RepairResourceLimits
{
  maxProposalBytes: number
  maxStringBytes: number
  maxDepth: number
  maxMembers: number
}

export const DEFAULT_REPAIR_RESOURCE_LIMITS: RepairResourceLimits = {
  maxProposalBytes: 64 * 1024,
  maxStringBytes: 8 * 1024,
  maxDepth: 20,
  maxMembers: 128,
}

export interface RepairIntentLimits
{
  maxOpsPerProposal: number
  maxNewBlocksPerProposal: number
  allowedOpKinds: readonly RepairOpKind[]
}

export interface RepairImpactLimits
{
  maxTouchedTargets: number
  maxTouchedScripts: number
  maxChangedAuthoredBlocks: number
  maxChangedBlockRecords: number
}

export interface RepairPreservationPolicy
{
  allowAssetChanges: boolean
  allowExistingEditorLayoutChanges: boolean
  allowMetadataChanges: boolean
  allowTargetStructureChanges: boolean
  allowedTargetProperties: readonly TargetProperty[]
}

export interface RepairTransactionOptions
{
  baselineArtifactBytes?: Uint8Array
  resourceLimits?: Partial<RepairResourceLimits>
  intentLimits?: Partial<RepairIntentLimits>
  impactLimits?: Partial<RepairImpactLimits>
  preservation?: Partial<RepairPreservationPolicy>
}

export const DEFAULT_REPAIR_INTENT_LIMITS: RepairIntentLimits = {
  maxOpsPerProposal: 4,
  maxNewBlocksPerProposal: 16,
  allowedOpKinds: [
    'replaceLiteral',
    'replaceCompatibleOpcode',
    'replaceVariableRef',
    'replaceBroadcastRef',
    'insertStatementsAfter',
    'deleteStatement',
    'addScript',
  ],
}

export const DEFAULT_REPAIR_IMPACT_LIMITS: RepairImpactLimits = {
  maxTouchedTargets: 2,
  maxTouchedScripts: 3,
  maxChangedAuthoredBlocks: 8,
  maxChangedBlockRecords: 12,
}

export const DEFAULT_REPAIR_PRESERVATION_POLICY: RepairPreservationPolicy = {
  allowAssetChanges: false,
  allowExistingEditorLayoutChanges: false,
  allowMetadataChanges: false,
  allowTargetStructureChanges: false,
  allowedTargetProperties: [],
}

type RepairViolationCode =
  | 'invalid-payload'
  | 'resource-limit'
  | 'stale-base'
  | 'duplicate-op-id'
  | 'intent-budget'
  | 'unsupported-operation'
  | 'target-not-found'
  | 'target-mismatch'
  | 'block-not-found'
  | 'opcode-mismatch'
  | 'literal-mismatch'
  | 'declaration-not-found'
  | 'declaration-mismatch'
  | 'invalid-literal-site'
  | 'incompatible-opcode'
  | 'invalid-reference-site'
  | 'invalid-statement'
  | 'invalid-script'
  | 'graph-edit'
  | 'impact-budget'
  | 'preservation'
  | 'unattributed-change'
  | 'internal-invariant'

export interface RepairViolation
{
  code: RepairViolationCode
  message: string
  opId?: string
  location?: BlockRef | TargetRef
}
