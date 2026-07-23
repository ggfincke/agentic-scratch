// tests/edit/support/kernel-test-transaction.ts
// unexported deterministic kernel transaction descriptor & executor for the approved Group B gate

import {
  ProjectIR,
  authorizeEditDelta,
  checkPreservation,
  computeProjectDelta,
  createPreservationManifest,
  type DeltaOperationAttribution,
  type ProjectDelta,
} from '@scratch-agent/ir'
import { semanticHashV1 } from '@scratch-agent/ir/edit'
import { inspectSemanticEditArtifact } from '../../../packages/eval/src/artifacts/artifact-preflight.js'
import { packSb3, type ProjectJson } from '@scratch-agent/sb3'
import { sha256Hex } from '@scratch-agent/sb3/crypto-node'

import { editCanonicalSha256V1 } from '../../../packages/edit/src/support/canonical.js'
import { editOperationOccurrenceIdV1 } from '../../../packages/edit/src/lineage/cumulative-attribution.js'
import type { EditKernelTransactionResultV1 } from '../../../packages/edit/src/contracts/kernel-types.js'
import { immutableEditRuntimeProjectionAuthorizationsV1 } from '../../../packages/edit/src/evaluation/runtime-projection-authority.js'
import type { EditTransactionExecutorV1, EditTransactionInputV1 } from '../../../packages/edit/src/transaction/transaction.js'

type KernelTestTransactionOperationV1 =
  | {
      kind: 'kernel.test.constant'
      opId: string
      resultKey: string
      value: number
    }
  | {
      kind: 'kernel.test.setTargetNumber'
      opId: string
      targetIndex: number
      property: 'direction' | 'size' | 'tempo' | 'volume' | 'x' | 'y'
      value:
        | { kind: 'literal'; value: number }
        | { kind: 'result'; opId: string; resultKey: string }
    }

interface KernelTestTransactionV1
{
  schemaVersion: 1
  descriptorKind: 'phase8-group-b-kernel-test-v1'
  operations: readonly KernelTestTransactionOperationV1[]
}

function validateOperationId(value: string): void
{
  if (!/^[a-z][a-z0-9-]{0,63}$/u.test(value))
    throw new TypeError('kernel test operation ID is invalid')
}

function validateTransaction(value: unknown): KernelTestTransactionV1
{
  if (value === null || typeof value !== 'object' || Array.isArray(value))
    throw new TypeError('kernel test transaction is invalid')
  const record = value as Record<string, unknown>
  if (
    record.schemaVersion !== 1 ||
    record.descriptorKind !== 'phase8-group-b-kernel-test-v1' ||
    !Array.isArray(record.operations) ||
    record.operations.length === 0 ||
    record.operations.length > 32
  )
    throw new TypeError('kernel test transaction is invalid')
  const operations = structuredClone(
    record.operations
  ) as KernelTestTransactionOperationV1[]
  const ids = new Set<string>()
  for (const operation of operations)
  {
    if (
      operation === null ||
      typeof operation !== 'object' ||
      Array.isArray(operation) ||
      typeof operation.opId !== 'string'
    )
      throw new TypeError('kernel test operation is invalid')
    validateOperationId(operation.opId)
    if (ids.has(operation.opId))
      throw Object.assign(new Error('duplicate kernel test operation ID'), {
        code: 'edit.duplicate_op_id',
        context: { opId: operation.opId },
      })
    ids.add(operation.opId)
  }
  return Object.freeze({
    schemaVersion: 1,
    descriptorKind: 'phase8-group-b-kernel-test-v1',
    operations: Object.freeze(operations),
  })
}

function dependencyIds(
  operation: KernelTestTransactionOperationV1
): readonly string[]
{
  return operation.kind === 'kernel.test.setTargetNumber' &&
    operation.value.kind === 'result'
    ? [operation.value.opId]
    : []
}

function orderedOperations(
  operations: readonly KernelTestTransactionOperationV1[]
): readonly KernelTestTransactionOperationV1[]
{
  const byId = new Map(
    operations.map((operation) => [operation.opId, operation])
  )
  const ordered: KernelTestTransactionOperationV1[] = []
  const active = new Set<string>()
  const visited = new Set<string>()
  const visit = (operation: KernelTestTransactionOperationV1): void =>
  {
    if (visited.has(operation.opId)) return
    if (active.has(operation.opId))
      throw Object.assign(new Error('kernel test dependency cycle'), {
        code: 'edit.graph_cycle',
      })
    active.add(operation.opId)
    for (const dependencyId of dependencyIds(operation))
    {
      const dependency = byId.get(dependencyId)
      if (!dependency)
        throw Object.assign(
          new Error('kernel test result dependency is absent'),
          {
            code: 'edit.created_result_invalid',
            context: { opId: operation.opId },
          }
        )
      visit(dependency)
    }
    active.delete(operation.opId)
    visited.add(operation.opId)
    ordered.push(operation)
  }
  for (const operation of operations) visit(operation)
  return ordered
}

function targetRecord(
  project: ProjectJson,
  targetIndex: number
): Record<string, unknown>
{
  if (
    !Number.isSafeInteger(targetIndex) ||
    targetIndex < 0 ||
    targetIndex >= project.targets.length
  )
    throw Object.assign(new Error('kernel test target is absent'), {
      code: 'edit.selector_no_match',
    })
  return project.targets[targetIndex] as unknown as Record<string, unknown>
}

function asProject(
  preflight: Awaited<ReturnType<typeof inspectSemanticEditArtifact>>
): ProjectIR
{
  if (!preflight.ok || !preflight.project || !preflight.admission)
    throw Object.assign(new Error('kernel test candidate preflight failed'), {
      code: 'edit.graph_failed',
    })
  return preflight.project
}

function resultValue(
  operation: Extract<
    KernelTestTransactionOperationV1,
    { kind: 'kernel.test.setTargetNumber' }
  >,
  results: ReadonlyMap<string, ReadonlyMap<string, number>>
): number
{
  if (operation.value.kind === 'literal') return operation.value.value
  const value = results
    .get(operation.value.opId)
    ?.get(operation.value.resultKey)
  if (value === undefined)
    throw Object.assign(new Error('kernel test result slot is absent'), {
      code: 'edit.created_result_invalid',
      context: { opId: operation.opId },
    })
  return value
}

function deltaAttribution(
  operations: readonly KernelTestTransactionOperationV1[],
  predecessorAcceptedHistorySha256: string
): readonly DeltaOperationAttribution[]
{
  return operations.flatMap((operation) =>
    operation.kind === 'kernel.test.setTargetNumber'
      ? [
          {
            operationId: editOperationOccurrenceIdV1(
              predecessorAcceptedHistorySha256,
              operation.opId
            ),
            targetIndexes: [operation.targetIndex],
            targetProperties: [
              {
                targetIndex: operation.targetIndex,
                property: operation.property,
              },
            ],
          },
        ]
      : []
  )
}

function retainedKernelCumulativeAttribution(
  value: unknown
): readonly DeltaOperationAttribution[]
{
  if (value === null || typeof value !== 'object') return []
  const delta = value as ProjectDelta
  if (!Array.isArray(delta.targets)) return []
  const pathsByOperationId = new Map<string, Set<string>>()
  for (const target of delta.targets)
  {
    const changes = [
      ...target.blockChanges.flatMap((block) => block.changes),
      ...target.declarationChanges,
      ...target.gameplayPropertyChanges,
      ...target.assetMetadataChanges,
      ...target.existingEditorLayoutChanges,
      ...target.structureChanges,
      ...target.unknownChanges,
    ]
    for (const change of changes)
    {
      for (const operationId of change.operationIds)
      {
        const paths = pathsByOperationId.get(operationId) ?? new Set<string>()
        paths.add(change.path)
        pathsByOperationId.set(operationId, paths)
      }
    }
  }
  return [...pathsByOperationId]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([operationId, projectPaths]) => ({
      operationId,
      projectPaths: [...projectPaths].sort(),
    }))
}

function assertMeaningfulDelta(delta: ProjectDelta, operationId: string): void
{
  const summaryTotal = Object.values(delta.summary).reduce(
    (sum, value) => sum + value,
    0
  )
  if (summaryTotal === 0)
    throw Object.assign(
      new Error('kernel test transaction is a semantic no-op'),
      {
        code: 'edit.semantic_noop',
        context: { opId: operationId, semanticSurface: 'target' },
      }
    )
}

export class KernelTestTransactionExecutorV1 implements EditTransactionExecutorV1
{
  async execute(
    input: EditTransactionInputV1
  ): Promise<EditKernelTransactionResultV1>
  {
    const transaction = validateTransaction(input.canonicalTransaction)
    const currentPreflight = await inspectSemanticEditArtifact(
      input.currentBytes
    )
    const sourcePreflight = await inspectSemanticEditArtifact(input.sourceBytes)
    const current = asProject(currentPreflight)
    const source = asProject(sourcePreflight)
    const candidate = ProjectIR.fromProjectJson(
      structuredClone(current.toProjectJson()),
      current.assets.map((asset) => ({
        path: asset.path,
        bytes: new Uint8Array(asset.bytes),
      }))
    )
    const results = new Map<string, Map<string, number>>()
    const operationResults: unknown[] = []
    for (const operation of orderedOperations(transaction.operations))
    {
      if (operation.kind === 'kernel.test.constant')
      {
        if (!Number.isFinite(operation.value) || Object.is(operation.value, -0))
          throw new TypeError('kernel test constant is invalid')
        results.set(
          operation.opId,
          new Map([[operation.resultKey, operation.value]])
        )
        operationResults.push({
          opId: operation.opId,
          resultKind: 'constant',
          resultKey: operation.resultKey,
          value: operation.value,
        })
        continue
      }
      const value = resultValue(operation, results)
      if (!Number.isFinite(value) || Object.is(value, -0))
        throw new TypeError('kernel test target number is invalid')
      const target = targetRecord(
        candidate.toProjectJson(),
        operation.targetIndex
      )
      target[operation.property] = value
      operationResults.push({
        opId: operation.opId,
        resultKind: 'targetPropertySet',
        targetIndex: operation.targetIndex,
        property: operation.property,
        value,
      })
    }
    const candidateBytes = await packSb3(
      JSON.stringify(candidate.toProjectJson()),
      candidate.assets
    )
    if (sha256Hex(candidateBytes) === input.currentHead.candidateSha256)
    {
      const operationId = transaction.operations.at(-1)!.opId
      throw Object.assign(
        new Error('kernel test transaction is a semantic no-op'),
        {
          code: 'edit.semantic_noop',
          context: { opId: operationId, semanticSurface: 'target' },
        }
      )
    }
    const candidatePreflight = await inspectSemanticEditArtifact(candidateBytes)
    const checkedCandidate = asProject(candidatePreflight)
    const attribution = deltaAttribution(
      transaction.operations,
      input.acceptedHistorySha256
    )
    const parentDelta = computeProjectDelta(
      current,
      checkedCandidate,
      attribution
    )
    const cumulativeDelta = computeProjectDelta(source, checkedCandidate, [
      ...retainedKernelCumulativeAttribution(
        input.currentRevision.cumulativeDelta
      ),
      ...attribution,
    ])
    assertMeaningfulDelta(parentDelta, transaction.operations.at(-1)!.opId)
    const allowedTargetProperties = transaction.operations.flatMap(
      (operation) =>
        operation.kind === 'kernel.test.setTargetNumber'
          ? [
              {
                targetIndex: operation.targetIndex,
                property: operation.property,
              },
            ]
          : []
    )
    const preservation = checkPreservation(
      createPreservationManifest(current),
      checkedCandidate,
      { allowedTargetProperties }
    )
    const deltaAuthorization = authorizeEditDelta(
      parentDelta,
      transaction.operations.flatMap((operation) =>
        operation.kind === 'kernel.test.setTargetNumber'
          ? [
              {
                operationId: editOperationOccurrenceIdV1(
                  input.acceptedHistorySha256,
                  operation.opId
                ),
                exactPaths: [
                  `/targets/${operation.targetIndex}/${operation.property}`,
                ],
                pathPrefixes: [],
                changeKinds: ['changed' as const],
                protectedClasses: ['gameplay-configuration' as const],
                entityLineageIds: [],
                allowMandatoryProtectedChange: false,
              },
            ]
          : []
      )
    )
    const predecessorAuthorization = input.currentRevision.authorization
    if (
      predecessorAuthorization === null ||
      typeof predecessorAuthorization !== 'object' ||
      !('futureBindingLedger' in predecessorAuthorization)
    )
      throw Object.assign(
        new Error('kernel test future-binding ledger is absent'),
        { code: 'edit.internal_invariant' }
      )
    const authorization = {
      ...deltaAuthorization,
      futureBindingLedger: structuredClone(
        predecessorAuthorization.futureBindingLedger
      ),
    }
    if (!preservation.preserved || !deltaAuthorization.authorized)
      throw Object.assign(new Error('kernel test authorization failed'), {
        code: 'edit.unauthorized_change',
      })
    const resolvedSemanticBatchSha256 = semanticHashV1(
      'resolved-semantic-batch',
      {
        schemaVersion: 1,
        expectedRevision: {
          sourceArtifactSha256: input.currentHead.sourceArtifactSha256,
          revisionNumber: input.currentHead.revisionNumber,
          revisionId: input.currentHead.revisionId,
          candidateSha256: input.currentHead.candidateSha256,
          assetManifestSha256: input.currentHead.assetManifestSha256,
          changeContractSha256: input.currentHead.changeContractSha256,
          capabilityProfileSha256: input.currentHead.capabilityProfileSha256,
        },
        planningFactSetSha256: editCanonicalSha256V1(transaction),
        resolvedOperations: [],
        resultBindingSetSha256: editCanonicalSha256V1(operationResults),
      }
    )
    const resolvedPlanSha256 = semanticHashV1('resolved-plan', {
      schemaVersion: 1,
      resolvedSemanticBatchSha256,
      predecessorAcceptedHistorySha256: input.acceptedHistorySha256,
      dependencyOrderSha256: editCanonicalSha256V1(
        orderedOperations(transaction.operations).map(
          (operation) => operation.opId
        )
      ),
      operationEffectMappingSha256: editCanonicalSha256V1(attribution),
      resultBindingSetSha256: editCanonicalSha256V1(operationResults),
      creationKeyEntitySetSha256: editCanonicalSha256V1([]),
      allocationReservationStateSha256: editCanonicalSha256V1(
        checkedCandidate.uids.snapshot()
      ),
      authorizationProjectionSha256: editCanonicalSha256V1(authorization),
      preservationProjectionSha256: editCanonicalSha256V1(preservation),
      candidateProjectionSha256: editCanonicalSha256V1({
        candidateSha256: sha256Hex(candidateBytes),
      }),
    })
    return {
      candidateBytes,
      candidateProjectJsonSha256:
        candidatePreflight.semanticSourceIdentity!.projectJsonSha256,
      candidateAssetManifestSha256:
        candidatePreflight.semanticSourceIdentity!.assetManifestSha256,
      canonicalTransaction: transaction,
      operationCount: transaction.operations.length,
      transition: {
        transitionKind: 'apply',
        resolvedSemanticBatchSha256,
        resolvedPlanSha256,
        predecessorHistorySha256: input.acceptedHistorySha256,
        operationEffectMappingSha256: editCanonicalSha256V1(attribution),
      },
      resolvedSemanticBatchSha256,
      resolvedPlanSha256,
      parentDelta,
      cumulativeDelta,
      preservation,
      authorization,
      diagnostics: {
        status: 'passed',
        graph: candidatePreflight.graph,
        static: candidatePreflight.static,
      },
      allocatorState: checkedCandidate.uids.snapshot(),
      activeLineage: input.currentRevision.activeLineage,
      lineageHistory: input.currentRevision.lineageHistory,
      operationResults,
      // the test executor drives the kernel state machine rather than the
      // production dispatchers, so it carries no contract-shaped projection
      operationResultSummaries: [],
      runtimeProjectionAuthorizations:
        immutableEditRuntimeProjectionAuthorizationsV1(
          input.currentRevision.runtimeProjectionAuthorizations
        ),
      operationResultLineageCorrespondenceSha256: editCanonicalSha256V1({
        unchangedLineage: true,
      }),
    }
  }
}

export function defineKernelTestTransactionV1(
  operations: readonly KernelTestTransactionOperationV1[]
): KernelTestTransactionV1
{
  return validateTransaction({
    schemaVersion: 1,
    descriptorKind: 'phase8-group-b-kernel-test-v1',
    operations,
  })
}
