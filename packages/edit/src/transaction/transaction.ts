// packages/edit/src/transaction/transaction.ts
// internal shared preview/apply transaction boundary & unavailable injection seam

import type {
  EditSemanticChangeContractV1,
  EditSemanticSourceIdentityHashProjectionV1,
  HeadProjectionV1,
  OperationPlanningChoiceV1,
  OperationPlanningFactValueV1,
  SemanticEditOperationGoalV1,
  SemanticEditOperationV1,
} from '@scratch-agent/ir/edit'

import type {
  AdmittedEditAssetResolverV1,
  AssetMaterializationUsageDeltaV1,
} from '../assets/asset-admission.js'
import type {
  EditKernelRevisionRecordV1,
  EditTransactionResourceLimitsV1,
  EditKernelTransactionResultV1,
} from '../contracts/kernel-types.js'

export interface EditTransactionInputV1
{
  sessionId: string
  sourceBytes: Uint8Array
  currentBytes: Uint8Array
  semanticSourceSha256: string
  semanticSourceIdentity?: EditSemanticSourceIdentityHashProjectionV1
  sourceArtifactSha256: string
  currentHead: HeadProjectionV1
  currentRevision: EditKernelRevisionRecordV1
  acceptedHistorySha256: string
  changeContractSha256: string
  changeContract: EditSemanticChangeContractV1
  resourceLimits: EditTransactionResourceLimitsV1
  canonicalTransaction: unknown
  verifyHandle?: (request: EditHandleVerificationRequestV1) => boolean
  // media add/replace needs the retained bytes behind an admitted asset token;
  // the session owns the store, so the transaction only borrows a lookup
  resolveAdmittedAsset?: AdmittedEditAssetResolverV1
}

interface EditHandleVerificationRequestV1
{
  readonly token: string
  readonly entityKind: string
  readonly entitySubtype: string
  readonly lineageSha256: string
  readonly semanticLocationSha256: string
  readonly semanticFingerprintSha256: string
}

export interface EditTransactionExecutorV1
{
  execute(
    input: EditTransactionInputV1
  ): Promise<EditTransactionExecutionResultV1>
  planOperation?(
    input: EditTransactionInputV1,
    request: EditOperationPlanningRequestV1
  ): Promise<EditOperationPlanningResultV1>
}

// injected non-authoring test executors predate asset accounting, so the shared
// boundary permits an absent zero delta while production returns the strict plan
type EditTransactionExecutionResultV1 = EditKernelTransactionResultV1 & {
  readonly assetMaterializationUsage?: AssetMaterializationUsageDeltaV1
}

export type EditTransactionExecutionPlanV1 = EditKernelTransactionResultV1 & {
  readonly assetMaterializationUsage: AssetMaterializationUsageDeltaV1
}

export interface EditOperationPlanningRequestV1
{
  readonly planningStage: 'enumerateChoices' | 'completeChoices'
  readonly plannedPrefix: readonly SemanticEditOperationV1[]
  readonly goal: SemanticEditOperationGoalV1
  readonly choices: readonly OperationPlanningChoiceV1[]
}

export interface EditOperationPlanningFactV1
{
  readonly destination: string
  readonly value: OperationPlanningFactValueV1
}

export interface EditOperationPlanningResultV1
{
  readonly operationKind: SemanticEditOperationGoalV1['kind']
  readonly planningFactSetSha256: string
  readonly facts: readonly EditOperationPlanningFactV1[]
  readonly choiceSlots?: readonly EditOperationPlanningChoiceSlotV1[]
}

export interface EditOperationPlanningChoiceSlotV1
{
  readonly destination: string
  readonly slotDiscriminator: string
  readonly currentState: string
  readonly evidenceIds: readonly string[]
}

export class UnavailableEditTransactionExecutorV1 implements EditTransactionExecutorV1
{
  async execute(): Promise<EditTransactionExecutionResultV1>
  {
    throw Object.assign(
      new Error('no semantic edit transaction executor is configured'),
      {
        code: 'edit.unsupported_operation',
        context: { opId: 'unsupported-transaction' },
      }
    )
  }
}
