// tests/edit/session/session.test.ts
// durable edit-session lifecycle, group c inspection, idempotency, & replay contract

import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { deflateSync } from 'node:zlib'

import {
  SEMANTICALLY_VALID_CHANGE_CONTRACT_SAMPLE,
  DEFAULT_PHASE_8_RESOURCE_POLICY,
  blockEntityEvidenceSetV1,
  boundedDisplayStringV1,
  activeOrderedSemanticLineages,
  applyTargetOperationV1,
  assertCreatedTargetsAreCostumedV1,
  blockInputFingerprintV1,
  buildSemanticReferenceIndex,
  commentMapStateV1,
  commentSetSha256V1,
  commentEntityEvidenceSetV1,
  commentSemanticFingerprintV1,
  commentTextSha256V1,
  currentCostumeStateV1,
  mediaTargetCreationContentFingerprintForResultV1,
  mediaNameActivationEvidenceV1,
  mediaOrderEvidenceV1,
  mediaReachabilityEvidenceV1,
  mediaRecordEntityEvidenceSetV1,
  mediaDomainOrderPolicyV1,
  mediaReferenceEvidenceV1,
  type ContractScopeV1,
  type MediaTargetCreationBindingDescriptorV1,
  type MediaRecordEntityEvidenceV1,
  declarationItemsFingerprintV1,
  declarationNameActivationEvidenceV1,
  declarationEntityEvidenceSetV1,
  declarationReferenceEvidenceV1,
  declarationValueFingerprintV1,
  expectedDeclarationNameIdentityV1,
  commentCreationContentFingerprintV1,
  declarationCreationContentFingerprintV1,
  scriptBlockCreationContentFingerprintForResultV1,
  procedureCreationContentFingerprintForResultV1,
  optionalCollectionContainerStateV1,
  parameterEntityEvidenceSetV1,
  parseSemanticChangeContractV1,
  procedureCallSitesV1,
  procedureEntityEvidenceSetV1,
  prospectiveProcedureCollisionSetSha256V1,
  prospectiveProcedureCollisionSetV1,
  resolveProcedureRecordV1,
  scenarioPolicyValueSemanticSha256V1,
  semanticHashV1,
  scriptEntityEvidenceSetV1,
  targetBoundedLocationProjectionV1,
  targetDualOrderSnapshotV1,
  targetEntityEvidenceSetV1,
  targetExpectedStringIdentityV1,
  targetInboundReferenceSetV1,
  targetOwnedSurfaceSha256V1,
  targetProspectiveNameActivationV1,
  type EditApplyRequestV1,
  type EditBeginRequestV1,
  type EditChangeContractRegistrationV1,
  type EditCheckpointRequestV1,
  type EditCloseRequestV1,
  type EditRollbackRequestV1,
  type EditScenarioPolicyV1,
  type EditUndoRequestV1,
  type ScriptBlockCreationBindingDescriptorV1,
  type ProcedureCreationBindingDescriptorV1,
  type SemanticEditOperationV1,
  type SemanticLineageSnapshot,
  type TargetOperationV1,
} from '@scratch-agent/ir/edit'
import {
  ProjectIR,
  captureProjectOrderedHeadEvidence,
  computeProjectDelta,
  type ProjectDelta,
  type UidSnapshot,
} from '@scratch-agent/ir'
import {
  buildFixtureSb3,
  deriveAuthoringMediaIdentity,
  packSb3,
  resolveEditAdmissionLimits,
} from '@scratch-agent/sb3'
import { inspectSemanticEditArtifact } from '../../../packages/eval/src/artifacts/artifact-preflight.js'
import { canonicalJsonBytesV1 } from '@scratch-agent/sb3/canonical-json'
import { sha256Hex } from '@scratch-agent/sb3/crypto-node'

import { EditChangeContractRegistryV1, type BoundChangeContractV1 } from '../../../packages/edit/src/contracts/change-contracts.js'
import { combineAssetMaterializationUsageDeltasV1, EMPTY_ASSET_MATERIALIZATION_USAGE_DELTA_V1, SessionAssetStoreV1, type AdmittedEditAssetResolverV1, type AssetMaterializationUsageDeltaV1 } from '../../../packages/edit/src/assets/asset-admission.js'
import { editCanonicalBytesV1, editCanonicalSha256V1 } from '../../../packages/edit/src/support/canonical.js'
import { composeCumulativeProjectDeltaAttributionV1, editOperationOccurrenceIdV1 } from '../../../packages/edit/src/lineage/cumulative-attribution.js'
import { CommentProductionOperationDispatcherV1, DeclarationProductionOperationDispatcherV1, ScriptWorkspaceProductionOperationDispatcherV1, exactBlockRef, productionCommentPlanningFactSetSha256V1, productionDeclarationPlanningFactSetSha256V1, productionScriptWorkspacePlanningFactSetSha256V1 } from '../../../packages/edit/src/dispatch/target-dispatchers.js'
import { scriptBlockProductionOperationDispatchersV1, productionScriptBlockPlanningFactSetSha256V1 } from '../../../packages/edit/src/dispatch/script-block-dispatchers.js'
import { procedureProductionOperationDispatchersV1, productionProcedurePlanningFactSetSha256V1 } from '../../../packages/edit/src/dispatch/procedure-dispatchers.js'
import { exactMediaRefV1, mediaTargetProductionOperationDispatchersV1, productionMediaTargetPlanningFactSetSha256V1, productionMediaTargetSpritePlanningFactSetSha256V1 } from '../../../packages/edit/src/dispatch/media-target-dispatchers.js'
import { emptyFutureBindingLedgerV1, existingBindingOwnerLineageResolverV1, futureBindingKeySha256V1 } from '../../../packages/edit/src/lineage/future-binding-ledger.js'
import { PINNED_GREENFIELD_TEMPLATE_ARTIFACT_SHA256_V1, assertPinnedGreenfieldTemplateIdentityV1, assertTemplateBackingFileIsNotAnOutputV1, buildGreenfieldTemplateArtifactV1, greenfieldTemplateSourceIntakeV1 } from '../../../packages/edit/src/assets/greenfield-template.js'
import { verifyEditHandleV1 } from '../../../packages/edit/src/session/handles.js'
import { buildSourceLineageV1 } from '../../../packages/edit/src/lineage/lineage.js'
import type { EditArtifactStorePort, EditClockPort, EditEntropyPort, HostInvocationContextV1 } from '../../../packages/edit/src/transaction/ports.js'
import { ProductionTransactionExecutorV1, TargetProductionOperationDispatcherV1, advanceProductionFutureBindingLedgerV1, mergeProductionLineageHistoryV1, productionEntityDeltaContentSha256V1, productionFutureBindingLedgerV1, productionTargetPlanningFactSetSha256V1, productionContractScopeSha256V1, productionOperationChangeFingerprintV1, productionTargetVisualPositionSha256V1, type ProductionOperationContextV1, type ProductionOperationDispatcherV1 } from '../../../packages/edit/src/transaction/production-transaction.js'
import { verifyEditSessionReplayV1 } from '../../../packages/edit/src/replay/replay.js'
import { historyProjectionV1 } from '../../../packages/edit/src/session/revision.js'
import { EditSessionErrorV1, createEditSessionRegistryForExecutorV1, type EditAssetAdmitDomainResultV1, type EditInspectDomainResultV1, type EditSessionV1 } from '../../../packages/edit/src/session/session.js'
import type { EditSourceIntakeV1 } from '../../../packages/edit/src/session/source-intake.js'
import type { EditTransactionExecutorV1, EditTransactionInputV1 } from '../../../packages/edit/src/transaction/transaction.js'
import {
  KernelTestTransactionExecutorV1,
  defineKernelTestTransactionV1,
} from '../support/kernel-test-transaction.js'
import { createEditArtifactStoreHostAdapter } from '../../../packages/eval/src/artifacts/durable-artifacts.js'
import {
  HOST_DEFAULT_LIMITS,
  HOST_HARD_LIMITS,
  expectedHeadRequest,
  planningHead,
  unchangedTargetCorrespondence,
} from '../../helpers/edit-host.js'
import { pngChunk as pngChunk } from '../../helpers/png.js'

const HASH_A = 'a'.repeat(64)
const HASH_B = 'b'.repeat(64)
const HASH_C = 'c'.repeat(64)
const HASH_D = 'd'.repeat(64)
const HASH_E = 'e'.repeat(64)
const RETAINED_SCENARIO_POLICY = Object.freeze({
  scenarioId: 'scenario',
  applicability: 'baselineAndCandidate',
  seed: 0,
  fixedDateMs: 0,
  maxTicks: 1,
  steps: Object.freeze([{ do: 'greenFlag' as const }]),
}) satisfies EditScenarioPolicyV1

type MutableRetainedPolicyContract = {
  policyBindings: Array<{
    kind: string
    semanticSha256: string
    retainedArtifactSha256: string
  }>
  evaluationPlans: Array<{ scenarioPolicySha256s: string[] }>
}

function attachRetainedPolicyFixturesV1(
  contract: MutableRetainedPolicyContract
): readonly Uint8Array[]
{
  const scenarioBytes = canonicalJsonBytesV1(RETAINED_SCENARIO_POLICY)
  const runtimeBytes = canonicalJsonBytesV1({
    policyKind: 'runtime',
    schemaVersion: 1,
  })
  const lensBytes = canonicalJsonBytesV1({
    policyKind: 'lens',
    schemaVersion: 1,
  })
  const bytesByKind = new Map<string, Uint8Array>([
    ['scenario', scenarioBytes],
    ['runtime', runtimeBytes],
    ['lens', lensBytes],
  ])
  const scenarioSemanticSha256 = scenarioPolicyValueSemanticSha256V1(
    RETAINED_SCENARIO_POLICY
  )
  for (const binding of contract.policyBindings)
  {
    const bytes = bytesByKind.get(binding.kind)
    assert.ok(bytes, `test policy bytes are missing for ${binding.kind}`)
    binding.retainedArtifactSha256 = sha256Hex(bytes)
    if (binding.kind === 'scenario')
      binding.semanticSha256 = scenarioSemanticSha256
  }
  for (const plan of contract.evaluationPlans)
    plan.scenarioPolicySha256s = [scenarioSemanticSha256]
  return Object.freeze([scenarioBytes, runtimeBytes, lensBytes])
}
const GROUP_C_RENAMED_SPRITE = 'Group C Hero'
const GROUP_C_UPDATED_COMMENT = 'inspection evidence updated'
const GROUP_C_RENAMED_VARIABLE = 'RenamedBatchVariable'
const GROUP_C_RENAMED_LIST = 'RenamedBatchList'
const GROUP_C_RENAMED_REFERENCED_VARIABLE = 'points'
const GROUP_C_FUTURE_BINDING_KEYS = Object.freeze([
  'created-variable-binding',
  'created-list-binding',
  'created-broadcast-binding',
  'created-comment-binding',
])

type UnplannedSemanticEditOperationV1 =
  SemanticEditOperationV1 extends infer Operation
    ? Operation extends SemanticEditOperationV1
      ? Omit<Operation, 'expectedPlanningFactSetSha256'> & {
          readonly expectedPlanningFactSetSha256?: string
        }
      : never
    : never

function tempRoot(t: test.TestContext): string
{
  const container = mkdtempSync(join(tmpdir(), 'phase-8-group-b-session-'))
  t.after(() => rmSync(container, { recursive: true, force: true }))
  return join(container, 'durable-store')
}

function deterministicEntropy(seed: number): EditEntropyPort
{
  let sequence = seed
  return {
    randomBytes(byteLength: number): Uint8Array
    {
      const bytes = new Uint8Array(byteLength)
      for (let index = 0; index < byteLength; index += 1)
        bytes[index] = (sequence + index * 29) & 0xff
      sequence += byteLength + 17
      return bytes
    },
  }
}

function deterministicClock(start: number): EditClockPort
{
  let now = start
  return {
    nowEpochMs(): number
    {
      now += 1
      return now
    },
  }
}

function invocation(ordinal: number): HostInvocationContextV1
{
  return {
    boundaryKind: 'directHost',
    invocationSha256: ordinal.toString(16).padStart(64, '0'),
    principalSha256: HASH_E,
  }
}

function reverseListingStore(
  store: EditArtifactStorePort
): EditArtifactStorePort
{
  return {
    capability: () => store.capability(),
    createImmutable: (key, bytes) => store.createImmutable(key, bytes),
    createOrVerifyImmutable: (key, bytes) =>
      store.createOrVerifyImmutable(key, bytes),
    readImmutable: (key) => store.readImmutable(key),
    hashImmutable: (key) => store.hashImmutable(key),
    sizeImmutable: (key) => store.sizeImmutable(key),
    listImmutable: async (prefix) =>
      [...(await store.listImmutable(prefix))].reverse(),
    compareAndSwapPointer: (key, expectedSha256, bytes) =>
      store.compareAndSwapPointer(key, expectedSha256, bytes),
    reconcilePointer: (key, expectedOldSha256, bytes) =>
      store.reconcilePointer(key, expectedOldSha256, bytes),
    reserveQuota: (reservationId, byteLength) =>
      store.reserveQuota(reservationId, byteLength),
    releaseQuota: (reservationId) => store.releaseQuota(reservationId),
    settleQuota: (reservationId, actualByteLength) =>
      store.settleQuota(reservationId, actualByteLength),
    quotaOutcome: (reservationId) => store.quotaOutcome(reservationId),
    cleanupProvenTemp: (proof) => store.cleanupProvenTemp(proof),
    removeEvictable: (key, expectedSha256) =>
      store.removeEvictable(key, expectedSha256),
  }
}

function tamperedFutureBindingLedgerStore(
  store: EditArtifactStorePort,
  revisionManifestKey: string
): EditArtifactStorePort
{
  return {
    capability: () => store.capability(),
    createImmutable: (key, bytes) => store.createImmutable(key, bytes),
    createOrVerifyImmutable: (key, bytes) =>
      store.createOrVerifyImmutable(key, bytes),
    readImmutable: async (key) =>
    {
      const bytes = await store.readImmutable(key)
      if (key !== revisionManifestKey) return bytes
      const record = JSON.parse(new TextDecoder().decode(bytes)) as {
        authorization?: {
          futureBindingLedger?: {
            realizations?: { bindingKeySha256?: string }[]
          }
        }
      }
      const row = record.authorization?.futureBindingLedger?.realizations?.[0]
      assert.ok(row)
      row.bindingKeySha256 = '0'.repeat(64)
      return canonicalJsonBytesV1(record)
    },
    hashImmutable: (key) => store.hashImmutable(key),
    sizeImmutable: (key) => store.sizeImmutable(key),
    listImmutable: (prefix) => store.listImmutable(prefix),
    compareAndSwapPointer: (key, expectedSha256, bytes) =>
      store.compareAndSwapPointer(key, expectedSha256, bytes),
    reconcilePointer: (key, expectedOldSha256, bytes) =>
      store.reconcilePointer(key, expectedOldSha256, bytes),
    reserveQuota: (reservationId, byteLength) =>
      store.reserveQuota(reservationId, byteLength),
    releaseQuota: (reservationId) => store.releaseQuota(reservationId),
    settleQuota: (reservationId, actualByteLength) =>
      store.settleQuota(reservationId, actualByteLength),
    quotaOutcome: (reservationId) => store.quotaOutcome(reservationId),
    cleanupProvenTemp: (proof) => store.cleanupProvenTemp(proof),
    removeEvictable: (key, expectedSha256) =>
      store.removeEvictable(key, expectedSha256),
  }
}

async function inventory(
  store: EditArtifactStorePort,
  prefix: string
): Promise<readonly { key: string; sha256: string; byteLength: number }[]>
{
  return [...(await store.listImmutable(prefix))]
    .map(({ key, sha256, byteLength }) => ({ key, sha256, byteLength }))
    .sort((left, right) => left.key.localeCompare(right.key))
}

function immutableSessionEvidence(
  entries: readonly { readonly key: string; readonly byteLength: number }[]
): readonly { readonly key: string; readonly byteLength: number }[]
{
  return entries.filter(
    (entry) =>
      !entry.key.endsWith('/head.json') &&
      !entry.key.endsWith('/current-report.json') &&
      !entry.key.endsWith('/idempotency-index.json') &&
      !entry.key.endsWith('/quota-state.json')
  )
}

function newlyRetainedEvidenceBytes(
  before: readonly { readonly key: string; readonly byteLength: number }[],
  after: readonly { readonly key: string; readonly byteLength: number }[]
): number
{
  const previousKeys = new Set(before.map((entry) => entry.key))
  return after
    .filter((entry) => !previousKeys.has(entry.key))
    .reduce((total, entry) => total + entry.byteLength, 0)
}

function spriteBindingRef()
{
  return {
    contractRefKind: 'existing',
    entityKind: 'target',
    entitySubtype: 'sprite',
    bindingKey: 'sprite-binding',
  } as const
}

function spriteXContractScope()
{
  return {
    scopeSubjectKind: 'entity',
    operationKind: 'target.setSpriteProperties',
    entityKind: 'target',
    entitySubtype: 'sprite',
    locationScope: {
      scopeKind: 'exactEntity',
      entity: spriteBindingRef(),
    },
    allowedPropertyPaths: [{ surface: 'target', property: 'x' }],
  } as const
}

async function requiredTargetChangeEvidence(input: {
  sourceProject: ProjectIR
  sourceBytes: Uint8Array
  nextX: number
  targetIndex?: number
  includeGroupCTargetCoverage?: boolean
}): Promise<{
  readonly semanticScopeSha256: string
  readonly semanticChangeFingerprint: string
  readonly targetCoverage?: {
    readonly renamedSprite: string
    readonly newVisualLayerOrdinal: number
    readonly beforeReferenceSetSha256: string
    readonly afterReferenceSetSha256: string
    readonly referencedDeclarationReferenceSetSha256: string
    readonly beforeVisualPositionSha256: string
    readonly afterVisualPositionSha256: string
  }
}>
{
  const targetIndex = input.targetIndex ?? 1
  const preflight = await inspectSemanticEditArtifact(input.sourceBytes)
  assert.ok(preflight.ok && preflight.semanticSourceSha256)
  const semanticSourceSha256 = preflight.semanticSourceSha256
  const lineage = buildSourceLineageV1(
    input.sourceProject,
    semanticSourceSha256
  ).active
  const candidate = ProjectIR.fromProjectJson(
    structuredClone(input.sourceProject.toProjectJson()),
    input.sourceProject.assets.map((asset) => ({
      path: asset.path,
      bytes: new Uint8Array(asset.bytes),
    }))
  )
  candidate.uids.restoreMonotonic(input.sourceProject.uids.snapshot())
  const evidence = targetEntityEvidenceSetV1(input.sourceProject.json).find(
    (entry) => entry.targetIndex === targetIndex
  )
  const sprite = input.sourceProject.json.targets[targetIndex]
  if (
    !evidence ||
    evidence.targetKind !== 'sprite' ||
    !sprite ||
    sprite.isStage
  )
    assert.fail('fixture sprite evidence is absent')
  if (typeof sprite.x !== 'number') assert.fail('fixture sprite x is absent')
  const target = {
    entityKind: 'target',
    refKind: 'structural',
    selectorKind: 'exactLocation',
    location: targetBoundedLocationProjectionV1(
      evidence,
      `required-target-${evidence.semanticLocationSha256.slice(0, 32)}`
    ),
    expectedFullLocationSha256: evidence.semanticLocationSha256,
    expectedSemanticFingerprint: evidence.semanticFingerprintSha256,
    expectedContextFingerprint: evidence.contextFingerprintSha256,
  } as const
  const provisional = {
    kind: 'target.setSpriteProperties',
    opId: 'move-sprite-x',
    target,
    edits: [
      {
        property: 'x',
        expected: { state: 'value', value: sprite.x },
        value: input.nextX,
      },
    ],
    expectedPlanningFactSetSha256: HASH_A,
  } as const
  const operation = {
    ...provisional,
    expectedPlanningFactSetSha256: productionTargetPlanningFactSetSha256V1(
      input.sourceProject,
      provisional,
      evidence.targetIndex,
      lineage
    ),
  } as const
  const applied = applyTargetOperationV1(candidate, {
    operation,
    targetIndex: evidence.targetIndex,
    activeLineage: lineage,
  })
  const candidateBytes = await packSb3(
    JSON.stringify(candidate.toProjectJson()),
    candidate.assets
  )
  const correspondence = unchangedTargetCorrespondence(
    '0'.repeat(64),
    sha256Hex(candidateBytes),
    semanticSourceSha256,
    lineage
  )
  const delta = computeProjectDelta(
    input.sourceProject,
    candidate,
    [applied.attribution],
    {
      correspondence,
      correspondenceEvidence: {
        before: captureProjectOrderedHeadEvidence(
          input.sourceProject,
          correspondence,
          'before',
          {
            revisionIdentity: correspondence.beforeRevisionIdentity,
            semanticSourceSha256,
            lineageSnapshot: lineage,
          }
        ),
        after: captureProjectOrderedHeadEvidence(
          candidate,
          correspondence,
          'after',
          {
            revisionIdentity: correspondence.afterRevisionIdentity,
            semanticSourceSha256,
            lineageSnapshot: applied.activeLineage,
          }
        ),
      },
    }
  )
  let targetCoverage:
    | {
        readonly renamedSprite: string
        readonly newVisualLayerOrdinal: number
        readonly beforeReferenceSetSha256: string
        readonly afterReferenceSetSha256: string
        readonly referencedDeclarationReferenceSetSha256: string
        readonly beforeVisualPositionSha256: string
        readonly afterVisualPositionSha256: string
      }
    | undefined
  if (input.includeGroupCTargetCoverage)
  {
    const coverageCandidate = ProjectIR.fromProjectJson(
      structuredClone(input.sourceProject.toProjectJson()),
      input.sourceProject.assets.map((asset) => ({
        path: asset.path,
        bytes: new Uint8Array(asset.bytes),
      }))
    )
    coverageCandidate.uids.restoreMonotonic(input.sourceProject.uids.snapshot())
    const coverageSet = applyTargetOperationV1(coverageCandidate, {
      operation,
      targetIndex,
      activeLineage: lineage,
    })
    const inbound = targetInboundReferenceSetV1(
      coverageCandidate,
      buildSemanticReferenceIndex(coverageCandidate),
      targetIndex
    )
    const activation = targetProspectiveNameActivationV1(
      coverageCandidate,
      buildSemanticReferenceIndex(coverageCandidate),
      GROUP_C_RENAMED_SPRITE
    )
    const renamed = applyTargetOperationV1(coverageCandidate, {
      operation: {
        kind: 'target.renameSprite',
        opId: 'rename-group-c-sprite',
        target,
        expectedName: targetExpectedStringIdentityV1(sprite.name),
        newName: GROUP_C_RENAMED_SPRITE,
        expectedInboundReferenceSetSha256: inbound.referenceSetSha256,
        newNameActivation: {
          expectedActivationSetSha256: activation.activationSetSha256,
          requireProspectiveActivationCount: 0,
        },
        expectedPlanningFactSetSha256: HASH_A,
      },
      targetIndex,
      activeLineage: coverageSet.activeLineage,
    })
    const beforeReorder = targetDualOrderSnapshotV1(
      coverageCandidate.json,
      renamed.activeLineage
    )
    const newVisualLayerOrdinal = coverageCandidate.json.targets.filter(
      (targetEntry) => !targetEntry.isStage
    ).length
    const selectedAfterRename = coverageCandidate.json.targets[targetIndex]
    if (
      !selectedAfterRename ||
      selectedAfterRename.isStage ||
      typeof selectedAfterRename.layerOrder !== 'number' ||
      selectedAfterRename.layerOrder === newVisualLayerOrdinal
    )
      assert.fail('Group C target coverage requires a movable sprite')
    const reordered = applyTargetOperationV1(coverageCandidate, {
      operation: {
        kind: 'target.reorderSprite',
        opId: 'reorder-group-c-sprite',
        target,
        expectedVisualLayerOrdinal: selectedAfterRename.layerOrder,
        newVisualLayerOrdinal,
        expectedVisualLayerOrderSha256: beforeReorder.visualLayerOrderSha256,
        expectedPlanningFactSetSha256: HASH_A,
      },
      targetIndex,
      activeLineage: renamed.activeLineage,
    })
    const afterReferenceSetSha256 =
      renamed.postcondition.inboundReferenceSetSha256
    assert.ok(afterReferenceSetSha256)
    const referencedDeclarationAfterTargetRename =
      declarationEntityEvidenceSetV1(coverageCandidate).find(
        (entry) =>
          entry.declarationKind === 'variable' && entry.rawRef.name === 'score'
      )
    assert.ok(referencedDeclarationAfterTargetRename)
    const referencedDeclarationReferenceSetSha256 =
      declarationReferenceEvidenceV1(
        coverageCandidate,
        referencedDeclarationAfterTargetRename.rawRef
      ).expectedReferenceSetSha256
    targetCoverage = {
      renamedSprite: GROUP_C_RENAMED_SPRITE,
      newVisualLayerOrdinal,
      beforeReferenceSetSha256: inbound.referenceSetSha256,
      afterReferenceSetSha256,
      referencedDeclarationReferenceSetSha256,
      beforeVisualPositionSha256: productionTargetVisualPositionSha256V1(
        reordered.beforeOrder,
        reordered.targetLineageId
      ),
      afterVisualPositionSha256: productionTargetVisualPositionSha256V1(
        reordered.afterOrder,
        reordered.targetLineageId
      ),
    }
  }
  return {
    semanticScopeSha256: productionContractScopeSha256V1(
      spriteXContractScope()
    ),
    semanticChangeFingerprint: productionOperationChangeFingerprintV1(
      'parent-child',
      delta,
      operation.opId
    ),
    ...(targetCoverage ? { targetCoverage } : {}),
  }
}

function registeredContract(
  sourceArtifactSha256: string,
  sourceProject: ProjectIR,
  requiredTargetChange?: {
    readonly semanticScopeSha256: string
    readonly semanticChangeFingerprint: string
    readonly targetCoverage?: {
      readonly renamedSprite: string
      readonly newVisualLayerOrdinal: number
      readonly beforeReferenceSetSha256: string
      readonly afterReferenceSetSha256: string
      readonly referencedDeclarationReferenceSetSha256: string
      readonly beforeVisualPositionSha256: string
      readonly afterVisualPositionSha256: string
    }
  },
  targetOptions?: {
    readonly spriteTargetIndex?: number
    readonly removableSpriteTargetIndex?: number
  }
): {
  registry: EditChangeContractRegistryV1
  bound: BoundChangeContractV1
}
{
  const candidate = structuredClone(SEMANTICALLY_VALID_CHANGE_CONTRACT_SAMPLE)
  candidate.sourceConstraint = {
    kind: 'exactArtifact',
    sourceArtifactSha256,
  }
  if (!requiredTargetChange)
  {
    const stage = targetEntityEvidenceSetV1(sourceProject.json).find(
      (entry) => entry.targetKind === 'stage'
    )!
    candidate.entityBindings = [
      {
        bindingKey: 'stage',
        bindingKind: 'existing',
        entityKind: 'target',
        entitySubtype: 'stage',
        expectedMatchCount: 1,
        sourceLocationSha256: stage.semanticLocationSha256,
        expectedSourceSemanticFingerprint: stage.semanticFingerprintSha256,
        expectedSourceContextFingerprint: stage.contextFingerprintSha256,
      },
    ]
  }
  if (requiredTargetChange)
  {
    const spriteTargetIndex = targetOptions?.spriteTargetIndex ?? 1
    const targets = targetEntityEvidenceSetV1(sourceProject.json)
    const declaration = declarationEntityEvidenceSetV1(sourceProject).find(
      (entry) => entry.rawRef.name === 'obsolete'
    )!
    const referencedDeclaration = declarationEntityEvidenceSetV1(
      sourceProject
    ).find(
      (entry) =>
        entry.declarationKind === 'variable' && entry.rawRef.name === 'score'
    )!
    const referencedDeclarationReferences = declarationReferenceEvidenceV1(
      sourceProject,
      referencedDeclaration.rawRef
    )
    const scripts = scriptEntityEvidenceSetV1(sourceProject)
    const script = scripts.find(
      (entry) => entry.targetIndex === spriteTargetIndex
    )!
    const blocks = blockEntityEvidenceSetV1(sourceProject, undefined, scripts)
    const comment = commentEntityEvidenceSetV1(
      sourceProject,
      undefined,
      blocks
    ).find((entry) => entry.targetIndex === spriteTargetIndex)!
    const block = blocks.find(
      (entry) =>
        entry.targetIndex === comment.targetIndex &&
        entry.blockId === comment.attachedBlockId
    )!
    const stage = targets.find((entry) => entry.targetKind === 'stage')!
    const sprite = targets.find(
      (entry) => entry.targetIndex === spriteTargetIndex
    )!
    const removableSprite =
      targetOptions?.removableSpriteTargetIndex === undefined
        ? undefined
        : targets.find(
            (entry) =>
              entry.targetIndex === targetOptions.removableSpriteTargetIndex
          )
    const spriteContractRef = spriteBindingRef()
    const referencedDeclarationContractRef = {
      contractRefKind: 'existing',
      entityKind: 'declaration',
      entitySubtype: 'variable',
      bindingKey: 'referenced-declaration-binding',
    } as const
    const stageContractRef = {
      contractRefKind: 'existing',
      entityKind: 'target',
      entitySubtype: 'stage',
      bindingKey: 'stage-binding',
    } as const
    const targetCoverage = requiredTargetChange.targetCoverage
    const futureVariableDescriptor = {
      bindingKind: 'future',
      entityKind: 'declaration',
      entitySubtype: 'variable',
      expectedCreatorOperationKind: 'declaration.addVariable',
      expectedCreationRole: {
        roleKind: 'fixed',
        name: 'declaration',
        entityKind: 'declaration',
        entitySubtype: 'variable',
      },
      expectedCreationScope: {
        scopeKind: 'targetAndOwnedDescendants',
        target: spriteContractRef,
      },
    } as const
    const futureVariableContentSha256 =
      declarationCreationContentFingerprintV1(
        {
          kind: 'declaration.addVariable',
          name: 'BatchVariable',
          cloud: false,
          initialValue: 1,
        },
        futureVariableDescriptor
      )
    const futureListDescriptor = {
      bindingKind: 'future',
      entityKind: 'declaration',
      entitySubtype: 'list',
      expectedCreatorOperationKind: 'declaration.addList',
      expectedCreationRole: {
        roleKind: 'fixed',
        name: 'declaration',
        entityKind: 'declaration',
        entitySubtype: 'list',
      },
      expectedCreationScope: {
        scopeKind: 'targetAndOwnedDescendants',
        target: spriteContractRef,
      },
    } as const
    const futureListContentSha256 =
      declarationCreationContentFingerprintV1(
        {
          kind: 'declaration.addList',
          name: 'BatchList',
          initialItems: ['seed'],
        },
        futureListDescriptor
      )
    const futureBroadcastRole = {
      roleKind: 'fixed',
      name: 'declaration',
      entityKind: 'declaration',
      entitySubtype: 'broadcast',
    } as const
    const futureBroadcastScope = {
      scopeKind: 'projectEntityCollection',
      collection: 'broadcasts',
    } as const
    const futureBroadcastDescriptor = {
      bindingKind: 'future',
      entityKind: 'declaration',
      entitySubtype: 'broadcast',
      expectedCreatorOperationKind: 'declaration.addBroadcast',
      expectedCreationRole: futureBroadcastRole,
      expectedCreationScope: futureBroadcastScope,
    } as const
    const futureBroadcastContentSha256 =
      declarationCreationContentFingerprintV1(
        { kind: 'declaration.addBroadcast', name: 'LaunchSignal' },
        futureBroadcastDescriptor
      )
    const futureCommentRole = {
      roleKind: 'fixed',
      name: 'comment',
      entityKind: 'comment',
      entitySubtype: 'unspecialized',
    } as const
    const futureCommentScope = {
      scopeKind: 'targetAndOwnedDescendants',
      target: spriteContractRef,
    } as const
    const futureCommentDescriptor = {
      bindingKind: 'future',
      entityKind: 'comment',
      entitySubtype: 'unspecialized',
      expectedCreatorOperationKind: 'comment.add',
      expectedCreationRole: futureCommentRole,
      expectedCreationScope: futureCommentScope,
    } as const
    const futureCommentContentSha256 =
      commentCreationContentFingerprintV1(
        {
          kind: 'comment.add',
          text: 'keep score mutation visible',
          layout: {
            x: 120,
            y: 80,
            width: 180,
            height: 90,
            minimized: false,
          },
          attachment: { kind: 'detached' },
        },
        futureCommentDescriptor,
        { kind: 'detached' }
      )
    candidate.entityBindings = [
      {
        bindingKey: 'stage-binding',
        bindingKind: 'existing',
        entityKind: 'target',
        entitySubtype: 'stage',
        expectedMatchCount: 1,
        sourceLocationSha256: stage.semanticLocationSha256,
        expectedSourceSemanticFingerprint: stage.semanticFingerprintSha256,
        expectedSourceContextFingerprint: stage.contextFingerprintSha256,
      },
      {
        bindingKey: 'sprite-binding',
        bindingKind: 'existing',
        entityKind: 'target',
        entitySubtype: 'sprite',
        expectedMatchCount: 1,
        sourceLocationSha256: sprite.semanticLocationSha256,
        expectedSourceSemanticFingerprint: sprite.semanticFingerprintSha256,
        expectedSourceContextFingerprint: sprite.contextFingerprintSha256,
      },
      ...(removableSprite
        ? [
            {
              bindingKey: 'removable-sprite-binding',
              bindingKind: 'existing' as const,
              entityKind: 'target' as const,
              entitySubtype: 'sprite' as const,
              expectedMatchCount: 1 as const,
              sourceLocationSha256: removableSprite.semanticLocationSha256,
              expectedSourceSemanticFingerprint:
                removableSprite.semanticFingerprintSha256,
              expectedSourceContextFingerprint:
                removableSprite.contextFingerprintSha256,
            },
          ]
        : []),
      {
        bindingKey: 'declaration-binding',
        bindingKind: 'existing',
        entityKind: 'declaration',
        entitySubtype: declaration.declarationKind,
        expectedMatchCount: 1,
        sourceLocationSha256: declaration.semanticLocationSha256,
        expectedSourceSemanticFingerprint:
          declaration.semanticFingerprintSha256,
        expectedSourceContextFingerprint: declaration.contextFingerprintSha256,
      },
      {
        bindingKey: 'referenced-declaration-binding',
        bindingKind: 'existing',
        entityKind: 'declaration',
        entitySubtype: 'variable',
        expectedMatchCount: 1,
        sourceLocationSha256: referencedDeclaration.semanticLocationSha256,
        expectedSourceSemanticFingerprint:
          referencedDeclaration.semanticFingerprintSha256,
        expectedSourceContextFingerprint:
          referencedDeclaration.contextFingerprintSha256,
      },
      {
        bindingKey: 'script-binding',
        bindingKind: 'existing',
        entityKind: 'script',
        entitySubtype: 'unspecialized',
        expectedMatchCount: 1,
        sourceLocationSha256: script.semanticLocationSha256,
        expectedSourceSemanticFingerprint: script.semanticFingerprintSha256,
        expectedSourceContextFingerprint: script.contextFingerprintSha256,
      },
      {
        bindingKey: 'block-binding',
        bindingKind: 'existing',
        entityKind: 'block',
        entitySubtype: 'unspecialized',
        expectedMatchCount: 1,
        sourceLocationSha256: block.semanticLocationSha256,
        expectedSourceSemanticFingerprint: block.semanticFingerprintSha256,
        expectedSourceContextFingerprint: block.contextFingerprintSha256,
      },
      {
        bindingKey: 'comment-binding',
        bindingKind: 'existing',
        entityKind: 'comment',
        entitySubtype: 'unspecialized',
        expectedMatchCount: 1,
        sourceLocationSha256: comment.semanticLocationSha256,
        expectedSourceSemanticFingerprint: comment.semanticFingerprintSha256,
        expectedSourceContextFingerprint: comment.contextFingerprintSha256,
      },
      {
        bindingKey: 'created-broadcast-binding',
        ...futureBroadcastDescriptor,
        expectedCreationContentFingerprintSha256: futureBroadcastContentSha256,
      },
      {
        bindingKey: 'created-variable-binding',
        ...futureVariableDescriptor,
        expectedCreationContentFingerprintSha256: futureVariableContentSha256,
      },
      {
        bindingKey: 'created-list-binding',
        ...futureListDescriptor,
        expectedCreationContentFingerprintSha256: futureListContentSha256,
      },
      {
        bindingKey: 'created-comment-binding',
        ...futureCommentDescriptor,
        expectedCreationContentFingerprintSha256: futureCommentContentSha256,
      },
    ]
    const scriptContractRef = {
      contractRefKind: 'existing',
      entityKind: 'script',
      entitySubtype: 'unspecialized',
      bindingKey: 'script-binding',
    } as const
    candidate.allowedOperationKinds = [
      'target.setSpriteProperties',
      ...(targetCoverage
        ? ([
            'target.renameSprite',
            'target.reorderSprite',
            'target.setStageProperties',
          ] as const)
        : []),
      ...(removableSprite ? (['target.removeSprite'] as const) : []),
      'declaration.addVariable',
      'declaration.addList',
      'declaration.addBroadcast',
      'declaration.rename',
      'declaration.setVariableInitialValue',
      'declaration.setListInitialItems',
      'declaration.remove',
      'comment.add',
      'comment.updateText',
      'comment.move',
      'comment.attach',
      'comment.detach',
      'comment.remove',
      'script.moveWorkspace',
    ]
    candidate.allowedSemanticScopes = [
      spriteXContractScope(),
      ...(targetCoverage
        ? [
            {
              scopeSubjectKind: 'entity' as const,
              operationKind: 'target.renameSprite' as const,
              entityKind: 'target' as const,
              entitySubtype: 'sprite' as const,
              locationScope: {
                scopeKind: 'exactEntity' as const,
                entity: spriteContractRef,
              },
              allowedPropertyPaths: [
                { surface: 'target' as const, property: 'name' as const },
              ],
            },
            {
              scopeSubjectKind: 'entity' as const,
              operationKind: 'target.reorderSprite' as const,
              entityKind: 'target' as const,
              entitySubtype: 'sprite' as const,
              locationScope: {
                scopeKind: 'exactEntity' as const,
                entity: spriteContractRef,
              },
              allowedPropertyPaths: [
                {
                  surface: 'target' as const,
                  property: 'layerOrder' as const,
                },
              ],
            },
            {
              scopeSubjectKind: 'entity' as const,
              operationKind: 'target.setStageProperties' as const,
              entityKind: 'target' as const,
              entitySubtype: 'stage' as const,
              locationScope: {
                scopeKind: 'exactEntity' as const,
                entity: stageContractRef,
              },
              allowedPropertyPaths: [
                { surface: 'target' as const, property: 'tempo' as const },
              ],
            },
          ]
        : []),
      ...(removableSprite
        ? [
            {
              scopeSubjectKind: 'entity' as const,
              operationKind: 'target.removeSprite' as const,
              entityKind: 'target' as const,
              entitySubtype: 'sprite' as const,
              locationScope: {
                scopeKind: 'exactEntity' as const,
                entity: {
                  contractRefKind: 'existing' as const,
                  entityKind: 'target' as const,
                  entitySubtype: 'sprite' as const,
                  bindingKey: 'removable-sprite-binding',
                },
              },
              allowedPropertyPaths: [
                { surface: 'target' as const, property: 'name' as const },
              ],
            },
          ]
        : []),
      ...['declaration.addVariable', 'declaration.remove'].map(
        (operationKind) => ({
          scopeSubjectKind: 'entity' as const,
          operationKind,
          entityKind: 'declaration' as const,
          entitySubtype: 'variable' as const,
          locationScope: {
            scopeKind: 'targetAndOwnedDescendants' as const,
            target: spriteContractRef,
          },
          allowedPropertyPaths: [
            { surface: 'declaration' as const, property: 'name' as const },
            {
              surface: 'declaration' as const,
              property: 'initialValue' as const,
            },
          ],
        })
      ),
      {
        scopeSubjectKind: 'entity',
        operationKind: 'declaration.setVariableInitialValue',
        entityKind: 'declaration',
        entitySubtype: 'variable',
        locationScope: {
          scopeKind: 'exactEntity',
          entity: {
            contractRefKind: 'future',
            entityKind: 'declaration',
            entitySubtype: 'variable',
            bindingKey: 'created-variable-binding',
          },
        },
        allowedPropertyPaths: [
          { surface: 'declaration', property: 'initialValue' },
        ],
      },
      {
        scopeSubjectKind: 'entity',
        operationKind: 'declaration.rename',
        entityKind: 'declaration',
        entitySubtype: 'variable',
        locationScope: {
          scopeKind: 'exactEntity',
          entity: {
            contractRefKind: 'future',
            entityKind: 'declaration',
            entitySubtype: 'variable',
            bindingKey: 'created-variable-binding',
          },
        },
        allowedPropertyPaths: [{ surface: 'declaration', property: 'name' }],
      },
      {
        scopeSubjectKind: 'entity',
        operationKind: 'declaration.rename',
        entityKind: 'declaration',
        entitySubtype: 'variable',
        locationScope: {
          scopeKind: 'exactEntity',
          entity: referencedDeclarationContractRef,
        },
        allowedPropertyPaths: [{ surface: 'declaration', property: 'name' }],
      },
      ...[
        'declaration.addBroadcast',
        'declaration.rename',
        'declaration.remove',
      ].map((operationKind) => ({
        scopeSubjectKind: 'entity' as const,
        operationKind,
        entityKind: 'declaration' as const,
        entitySubtype: 'broadcast' as const,
        locationScope: {
          scopeKind: 'projectEntityCollection' as const,
          collection: 'broadcasts' as const,
        },
        allowedPropertyPaths: [
          { surface: 'declaration' as const, property: 'name' as const },
        ],
      })),
      ...['declaration.addList'].map((operationKind) => ({
        scopeSubjectKind: 'entity' as const,
        operationKind,
        entityKind: 'declaration' as const,
        entitySubtype: 'list' as const,
        locationScope: {
          scopeKind: 'targetAndOwnedDescendants' as const,
          target: spriteContractRef,
        },
        allowedPropertyPaths: [
          { surface: 'declaration' as const, property: 'name' as const },
          {
            surface: 'declaration' as const,
            property: 'initialItems' as const,
          },
        ],
      })),
      ...[
        {
          scopeSubjectKind: 'entity' as const,
          operationKind: 'declaration.setListInitialItems' as const,
          entityKind: 'declaration' as const,
          entitySubtype: 'list' as const,
          locationScope: {
            scopeKind: 'exactEntity' as const,
            entity: {
              contractRefKind: 'future' as const,
              entityKind: 'declaration' as const,
              entitySubtype: 'list' as const,
              bindingKey: 'created-list-binding',
            },
          },
          allowedPropertyPaths: [
            {
              surface: 'declaration' as const,
              property: 'initialItems' as const,
            },
          ],
        },
        {
          scopeSubjectKind: 'entity' as const,
          operationKind: 'declaration.rename' as const,
          entityKind: 'declaration' as const,
          entitySubtype: 'list' as const,
          locationScope: {
            scopeKind: 'exactEntity' as const,
            entity: {
              contractRefKind: 'future' as const,
              entityKind: 'declaration' as const,
              entitySubtype: 'list' as const,
              bindingKey: 'created-list-binding',
            },
          },
          allowedPropertyPaths: [
            { surface: 'declaration' as const, property: 'name' as const },
          ],
        },
      ],
      ...[
        'comment.add',
        'comment.updateText',
        'comment.attach',
        'comment.detach',
        'comment.remove',
      ].map((operationKind) => ({
        scopeSubjectKind: 'entity' as const,
        operationKind,
        entityKind: 'comment' as const,
        entitySubtype: 'unspecialized' as const,
        locationScope: {
          scopeKind: 'targetAndOwnedDescendants' as const,
          target: spriteContractRef,
        },
        allowedPropertyPaths: [
          { surface: 'comment' as const, property: 'text' as const },
          { surface: 'comment' as const, property: 'attachment' as const },
          { surface: 'comment' as const, property: 'x' as const },
          { surface: 'comment' as const, property: 'y' as const },
          { surface: 'comment' as const, property: 'width' as const },
          { surface: 'comment' as const, property: 'height' as const },
          { surface: 'comment' as const, property: 'minimized' as const },
        ],
      })),
      ...[
        {
          contractRefKind: 'existing' as const,
          bindingKey: 'comment-binding',
        },
        {
          contractRefKind: 'future' as const,
          bindingKey: 'created-comment-binding',
        },
      ].map((entity) => ({
        scopeSubjectKind: 'entity' as const,
        operationKind: 'comment.move' as const,
        entityKind: 'comment' as const,
        entitySubtype: 'unspecialized' as const,
        locationScope: {
          scopeKind: 'exactEntity' as const,
          entity: {
            ...entity,
            entityKind: 'comment' as const,
            entitySubtype: 'unspecialized' as const,
          },
        },
        allowedPropertyPaths: [
          { surface: 'comment' as const, property: 'x' as const },
          { surface: 'comment' as const, property: 'y' as const },
          { surface: 'comment' as const, property: 'width' as const },
          { surface: 'comment' as const, property: 'height' as const },
          { surface: 'comment' as const, property: 'minimized' as const },
        ],
      })),
      {
        scopeSubjectKind: 'entity',
        operationKind: 'script.moveWorkspace',
        entityKind: 'script',
        entitySubtype: 'unspecialized',
        locationScope: {
          scopeKind: 'exactEntity',
          entity: scriptContractRef,
        },
        allowedPropertyPaths: [
          { surface: 'script', property: 'workspaceX' },
          { surface: 'script', property: 'workspaceY' },
        ],
      },
    ]
    const removedDeclaration =
      sourceProject.json.targets[
        declaration.rawRef.declarationTarget.targetIndex
      ]?.variables[declaration.declarationId]
    const removedComment =
      sourceProject.json.targets[comment.targetIndex]?.comments?.[
        comment.commentId
      ]
    assert.ok(removedDeclaration && removedComment)
    const expectedRemovedComment = {
      ...removedComment,
      text: GROUP_C_UPDATED_COMMENT,
      x: 34,
      minimized: true,
    }
    candidate.allowedStructuralChanges = [
      ...(targetCoverage
        ? [
            {
              allowanceId: 'rename-sprite-references',
              kind: 'referencePropagation' as const,
              owner: spriteContractRef,
              beforeReferenceSetSha256: targetCoverage.beforeReferenceSetSha256,
              afterReferenceSetSha256: targetCoverage.afterReferenceSetSha256,
            },
            {
              allowanceId: 'reorder-sprite-visual-layer',
              kind: 'entityMove' as const,
              collection: 'visualLayers' as const,
              entity: spriteContractRef,
              beforePositionSha256: targetCoverage.beforeVisualPositionSha256,
              afterPositionSha256: targetCoverage.afterVisualPositionSha256,
            },
          ]
        : []),
      {
        allowanceId: 'rename-referenced-declaration-references',
        kind: 'referencePropagation',
        owner: referencedDeclarationContractRef,
        beforeReferenceSetSha256:
          targetCoverage?.referencedDeclarationReferenceSetSha256 ??
          referencedDeclarationReferences.expectedReferenceSetSha256,
        afterReferenceSetSha256:
          targetCoverage?.referencedDeclarationReferenceSetSha256 ??
          referencedDeclarationReferences.expectedReferenceSetSha256,
      },
      {
        allowanceId: 'add-created-variable',
        kind: 'entityAddition',
        candidate: {
          contractRefKind: 'future',
          entityKind: 'declaration',
          entitySubtype: 'variable',
          bindingKey: 'created-variable-binding',
        },
        expectedAddedContentSha256: futureVariableContentSha256,
      },
      {
        allowanceId: 'add-created-list',
        kind: 'entityAddition',
        candidate: {
          contractRefKind: 'future',
          entityKind: 'declaration',
          entitySubtype: 'list',
          bindingKey: 'created-list-binding',
        },
        expectedAddedContentSha256: futureListContentSha256,
      },
      {
        allowanceId: 'add-created-broadcast',
        kind: 'entityAddition',
        candidate: {
          contractRefKind: 'future',
          entityKind: 'declaration',
          entitySubtype: 'broadcast',
          bindingKey: 'created-broadcast-binding',
        },
        expectedAddedContentSha256: futureBroadcastContentSha256,
      },
      {
        allowanceId: 'remove-source-declaration',
        kind: 'entityRemoval',
        source: {
          contractRefKind: 'existing',
          entityKind: 'declaration',
          entitySubtype: 'variable',
          bindingKey: 'declaration-binding',
        },
        expectedRemovedContentSha256: productionEntityDeltaContentSha256V1({
          state: 'value',
          value: removedDeclaration,
        }),
      },
      {
        allowanceId: 'add-created-comment',
        kind: 'entityAddition',
        candidate: {
          contractRefKind: 'future',
          entityKind: 'comment',
          entitySubtype: 'unspecialized',
          bindingKey: 'created-comment-binding',
        },
        expectedAddedContentSha256: futureCommentContentSha256,
      },
      {
        allowanceId: 'remove-source-comment',
        kind: 'entityRemoval',
        source: {
          contractRefKind: 'existing',
          entityKind: 'comment',
          entitySubtype: 'unspecialized',
          bindingKey: 'comment-binding',
        },
        expectedRemovedContentSha256: productionEntityDeltaContentSha256V1({
          state: 'value',
          value: expectedRemovedComment,
        }),
      },
      ...(removableSprite
        ? [
            {
              allowanceId: 'remove-source-sprite',
              kind: 'entityRemoval' as const,
              source: {
                contractRefKind: 'existing' as const,
                entityKind: 'target' as const,
                entitySubtype: 'sprite' as const,
                bindingKey: 'removable-sprite-binding',
              },
              expectedRemovedContentSha256: targetOwnedSurfaceSha256V1(
                sourceProject.json.targets[removableSprite.targetIndex]!
              ),
            },
          ]
        : []),
    ]
    candidate.requiredStructuralChanges = [
      {
        objectiveId: 'required-target-delta',
        kind: 'deltaContains',
        direction: 'parent-child',
        operationKind: 'target.setSpriteProperties',
        semanticScopeSha256: requiredTargetChange.semanticScopeSha256,
        semanticChangeFingerprint:
          requiredTargetChange.semanticChangeFingerprint,
      },
    ]
  }
  const retainedPolicyArtifacts = attachRetainedPolicyFixturesV1(
    candidate as unknown as MutableRetainedPolicyContract
  )
  const parsed = parseSemanticChangeContractV1(candidate)
  assert.equal(
    parsed.ok,
    true,
    parsed.ok ? undefined : JSON.stringify(parsed.issues)
  )
  if (!parsed.ok) throw new Error('test change contract is not semantic')
  const provenance = {
    authorityId: 'phase-8-host-authority',
    hostConfigurationSha256: HASH_A,
    provenanceArtifactSha256: HASH_B,
    registeredAt: '2026-07-20T00:00:00.000Z',
  }
  const displayObjective = boundedDisplayStringV1(
    'exercise the complete durable Group B lifecycle'
  ) as EditChangeContractRegistrationV1['displayObjective']
  const registrationWithoutDisplayHash = {
    schemaVersion: 1 as const,
    registrationId: 'phase-8-group-b-contract',
    semanticContract: parsed.value,
    semanticContractSha256: semanticHashV1('change-contract', parsed.value),
    bindingDisplayEvidence: [],
    displayObjective,
    provenance,
  }
  const registration: EditChangeContractRegistrationV1 = {
    ...registrationWithoutDisplayHash,
    displayEvidenceSha256: sha256Hex(
      canonicalJsonBytesV1({
        bindingDisplayEvidence:
          registrationWithoutDisplayHash.bindingDisplayEvidence,
        displayObjective,
        provenance,
      })
    ),
  }
  const registry = new EditChangeContractRegistryV1({
    hostDefaultLimits: HOST_DEFAULT_LIMITS,
    hostHardLimits: HOST_HARD_LIMITS,
  })
  registry.registerBytes(
    canonicalJsonBytesV1(registration),
    retainedPolicyArtifacts
  )
  registry.seal()
  return {
    registry,
    bound: registry.bind({
      registrationId: registration.registrationId,
      expectedSemanticContractSha256: registration.semanticContractSha256,
      source: { kind: 'exactArtifact', sourceArtifactSha256 },
      existingBindings: registration.semanticContract.entityBindings.flatMap(
        (binding) =>
          binding.bindingKind === 'existing'
            ? [
                {
                  bindingKey: binding.bindingKey,
                  entityKind: binding.entityKind,
                  sourceLocationSha256: binding.sourceLocationSha256,
                },
              ]
            : []
      ),
    }),
  }
}

const GROUP_D_FUTURE_BINDING_KEYS = Object.freeze([
  'group-d-created-script',
  'group-d-created-root',
  'group-d-created-say',
  'group-d-inserted-root',
])

function registeredScriptBlockContracts(
  sourceArtifactSha256: string,
  sourceProject: ProjectIR
): {
  readonly registry: EditChangeContractRegistryV1
  readonly valid: BoundChangeContractV1
  readonly tampered: BoundChangeContractV1
  readonly scriptAdd: UnplannedSemanticEditOperationV1
  readonly createdSayRef: Extract<
    SemanticEditOperationV1,
    { kind: 'block.setInput' }
  >['block']
  readonly futureContentSha256s: readonly string[]
}
{
  const sprite = targetEntityEvidenceSetV1(sourceProject.json).find(
    (entry) => entry.targetKind === 'sprite'
  )
  assert.ok(sprite)
  const spriteContractRef = spriteBindingRef()
  const createdScriptContractRef = {
    contractRefKind: 'future',
    entityKind: 'script',
    entitySubtype: 'unspecialized',
    bindingKey: 'group-d-created-script',
  } as const
  const createdSayContractRef = {
    contractRefKind: 'future',
    entityKind: 'block',
    entitySubtype: 'unspecialized',
    bindingKey: 'group-d-created-say',
  } as const
  const targetRef = {
    entityKind: 'target',
    refKind: 'structural',
    selectorKind: 'exactLocation',
    location: targetBoundedLocationProjectionV1(
      sprite,
      `group-d-target-${sprite.semanticLocationSha256.slice(0, 32)}`
    ),
    expectedFullLocationSha256: sprite.semanticLocationSha256,
    expectedSemanticFingerprint: sprite.semanticFingerprintSha256,
    expectedContextFingerprint: sprite.contextFingerprintSha256,
  } as const
  const scriptAdd = {
    kind: 'script.add',
    opId: 'group-d-add-authored-script',
    target: targetRef,
    workspace: { x: 640, y: 80 },
    root: {
      rootKind: 'eventScript',
      hat: {
        nodeKind: 'ordinary',
        opcode: 'event_whenflagclicked',
        fields: [],
        inputs: [],
      },
      body: {
        blocks: [
          {
            nodeKind: 'ordinary',
            opcode: 'control_if',
            fields: [],
            inputs: [
              {
                name: 'CONDITION',
                value: {
                  valueKind: 'block',
                  value: {
                    nodeKind: 'ordinary',
                    opcode: 'operator_equals',
                    fields: [],
                    inputs: [
                      {
                        name: 'OPERAND1',
                        value: {
                          valueKind: 'block',
                          value: {
                            nodeKind: 'ordinary',
                            opcode: 'motion_xposition',
                            fields: [],
                            inputs: [],
                          },
                        },
                      },
                      {
                        name: 'OPERAND2',
                        value: { valueKind: 'literal', value: 'right' },
                      },
                    ],
                  },
                },
              },
              {
                name: 'SUBSTACK',
                value: {
                  valueKind: 'statementSequence',
                  value: {
                    blocks: [
                      {
                        nodeKind: 'ordinary',
                        opcode: 'looks_show',
                        fields: [],
                        inputs: [],
                      },
                    ],
                  },
                },
              },
            ],
          },
          {
            nodeKind: 'ordinary',
            localAlias: 'say',
            opcode: 'looks_say',
            fields: [],
            inputs: [
              {
                name: 'MESSAGE',
                value: { valueKind: 'literal', value: 'hello' },
              },
            ],
          },
        ],
      },
    },
  } as const satisfies UnplannedSemanticEditOperationV1
  const createdSayRef = {
    entityKind: 'block',
    refKind: 'created',
    opId: scriptAdd.opId,
    slot: { slotKind: 'blockAlias', alias: 'say' },
  } as const
  const scriptDescriptor = {
    bindingKind: 'future',
    entityKind: 'script',
    entitySubtype: 'unspecialized',
    expectedCreatorOperationKind: 'script.add',
    expectedCreationRole: {
      roleKind: 'fixed',
      name: 'script',
      entityKind: 'script',
      entitySubtype: 'unspecialized',
    },
    expectedCreationScope: {
      scopeKind: 'targetAndOwnedDescendants',
      target: spriteContractRef,
    },
  } as const satisfies ScriptBlockCreationBindingDescriptorV1
  const rootDescriptor = {
    bindingKind: 'future',
    entityKind: 'block',
    entitySubtype: 'unspecialized',
    expectedCreatorOperationKind: 'script.add',
    expectedCreationRole: {
      roleKind: 'fixed',
      name: 'rootBlock',
      entityKind: 'block',
      entitySubtype: 'unspecialized',
    },
    expectedCreationScope: {
      scopeKind: 'scriptClosure',
      script: createdScriptContractRef,
    },
  } as const satisfies ScriptBlockCreationBindingDescriptorV1
  const sayDescriptor = {
    bindingKind: 'future',
    entityKind: 'block',
    entitySubtype: 'unspecialized',
    expectedCreatorOperationKind: 'script.add',
    expectedCreationRole: {
      roleKind: 'dynamic',
      name: 'blockAlias',
      entityKind: 'block',
      entitySubtype: 'unspecialized',
    },
    expectedCreationScope: {
      scopeKind: 'scriptClosure',
      script: createdScriptContractRef,
    },
  } as const satisfies ScriptBlockCreationBindingDescriptorV1
  const insertedDescriptor = {
    bindingKind: 'future',
    entityKind: 'block',
    entitySubtype: 'unspecialized',
    expectedCreatorOperationKind: 'block.insertAfter',
    expectedCreationRole: {
      roleKind: 'fixed',
      name: 'rootBlock',
      entityKind: 'block',
      entitySubtype: 'unspecialized',
    },
    expectedCreationScope: {
      scopeKind: 'scriptClosure',
      script: createdScriptContractRef,
    },
  } as const satisfies ScriptBlockCreationBindingDescriptorV1
  const insertAfter = {
    kind: 'block.insertAfter',
    opId: 'group-d-insert-after-created-alias',
    anchor: createdSayRef,
    tree: {
      blocks: [
        {
          nodeKind: 'ordinary',
          opcode: 'looks_show',
          fields: [],
          inputs: [],
        },
      ],
    },
  } as const satisfies UnplannedSemanticEditOperationV1
  const resolveContractEntityRef = () => spriteContractRef
  const creationFingerprint = (
    operation: typeof scriptAdd | typeof insertAfter,
    descriptor: ScriptBlockCreationBindingDescriptorV1,
    resultRole: {
      readonly roleKind: 'fixed' | 'dynamic'
      readonly name: 'script' | 'rootBlock' | 'blockAlias'
      readonly alias?: string
    }
  ): string =>
    scriptBlockCreationContentFingerprintForResultV1({
      project: sourceProject,
      targetIndex: sprite.targetIndex,
      operation: {
        ...operation,
        expectedPlanningFactSetSha256: HASH_A,
      } as Extract<
        SemanticEditOperationV1,
        { kind: 'script.add' | 'block.insertAfter' }
      >,
      descriptor,
      resultRole,
      selectedSource:
        operation.kind === 'block.insertAfter'
          ? { scriptTopBlockId: 'future-authored-script' }
          : {},
      resolveContractEntityRef: (request) =>
        request.sourceKind === 'rawScript'
          ? createdScriptContractRef
          : resolveContractEntityRef(),
    })
  const scriptContentSha256 = creationFingerprint(scriptAdd, scriptDescriptor, {
    roleKind: 'fixed',
    name: 'script',
  })
  const rootContentSha256 = creationFingerprint(scriptAdd, rootDescriptor, {
    roleKind: 'fixed',
    name: 'rootBlock',
  })
  const sayContentSha256 = creationFingerprint(scriptAdd, sayDescriptor, {
    roleKind: 'dynamic',
    name: 'blockAlias',
    alias: 'say',
  })
  const insertedContentSha256 = creationFingerprint(
    insertAfter,
    insertedDescriptor,
    { roleKind: 'fixed', name: 'rootBlock' }
  )
  const base = structuredClone(SEMANTICALLY_VALID_CHANGE_CONTRACT_SAMPLE)
  base.sourceConstraint = { kind: 'exactArtifact', sourceArtifactSha256 }
  base.entityBindings = [
    {
      bindingKey: spriteContractRef.bindingKey,
      bindingKind: 'existing',
      entityKind: 'target',
      entitySubtype: 'sprite',
      expectedMatchCount: 1,
      sourceLocationSha256: sprite.semanticLocationSha256,
      expectedSourceSemanticFingerprint: sprite.semanticFingerprintSha256,
      expectedSourceContextFingerprint: sprite.contextFingerprintSha256,
    },
    {
      bindingKey: createdScriptContractRef.bindingKey,
      ...scriptDescriptor,
      expectedCreationContentFingerprintSha256: scriptContentSha256,
    },
    {
      bindingKey: 'group-d-created-root',
      ...rootDescriptor,
      expectedCreationContentFingerprintSha256: rootContentSha256,
    },
    {
      bindingKey: createdSayContractRef.bindingKey,
      ...sayDescriptor,
      expectedCreationContentFingerprintSha256: sayContentSha256,
    },
    {
      bindingKey: 'group-d-inserted-root',
      ...insertedDescriptor,
      expectedCreationContentFingerprintSha256: insertedContentSha256,
    },
  ]
  base.allowedOperationKinds = [
    'script.add',
    'block.insertAfter',
    'block.setInput',
  ]
  const scriptAddScope = {
    scopeSubjectKind: 'entity',
    operationKind: 'script.add',
    entityKind: 'script',
    entitySubtype: 'unspecialized',
    locationScope: {
      scopeKind: 'targetAndOwnedDescendants',
      target: spriteContractRef,
    },
    allowedPropertyPaths: [
      { surface: 'script', property: 'workspaceX' },
      { surface: 'script', property: 'workspaceY' },
    ],
  } as const
  base.allowedSemanticScopes = [
    scriptAddScope,
    {
      scopeSubjectKind: 'entity',
      operationKind: 'block.insertAfter',
      entityKind: 'block',
      entitySubtype: 'unspecialized',
      locationScope: {
        scopeKind: 'scriptClosure',
        script: createdScriptContractRef,
      },
      allowedPropertyPaths: [],
    },
    {
      scopeSubjectKind: 'entity',
      operationKind: 'block.setInput',
      entityKind: 'block',
      entitySubtype: 'unspecialized',
      locationScope: {
        scopeKind: 'exactEntity',
        entity: createdSayContractRef,
      },
      allowedPropertyPaths: [
        { surface: 'blockInput', descriptorName: 'MESSAGE' },
      ],
    },
  ]
  base.allowedStructuralChanges = [
    {
      allowanceId: 'group-d-add-script',
      kind: 'entityAddition',
      candidate: createdScriptContractRef,
      expectedAddedContentSha256: scriptContentSha256,
    },
    {
      allowanceId: 'group-d-add-root',
      kind: 'entityAddition',
      candidate: {
        contractRefKind: 'future',
        entityKind: 'block',
        entitySubtype: 'unspecialized',
        bindingKey: 'group-d-created-root',
      },
      expectedAddedContentSha256: rootContentSha256,
    },
    {
      allowanceId: 'group-d-add-say',
      kind: 'entityAddition',
      candidate: createdSayContractRef,
      expectedAddedContentSha256: sayContentSha256,
    },
    {
      allowanceId: 'group-d-add-inserted-root',
      kind: 'entityAddition',
      candidate: {
        contractRefKind: 'future',
        entityKind: 'block',
        entitySubtype: 'unspecialized',
        bindingKey: 'group-d-inserted-root',
      },
      expectedAddedContentSha256: insertedContentSha256,
    },
  ]
  base.requiredStructuralChanges = [
    {
      objectiveId: 'group-d-required-script-add',
      kind: 'deltaContains',
      direction: 'parent-child',
      operationKind: 'script.add',
      semanticScopeSha256: productionContractScopeSha256V1(scriptAddScope),
      semanticChangeFingerprint: HASH_D,
    },
  ]
  const retainedPolicyArtifacts = attachRetainedPolicyFixturesV1(
    base as unknown as MutableRetainedPolicyContract
  )
  const parsed = parseSemanticChangeContractV1(base)
  assert.equal(
    parsed.ok,
    true,
    parsed.ok ? undefined : JSON.stringify(parsed.issues)
  )
  if (!parsed.ok) assert.fail('Group D contract did not parse')
  // the tampered variant drops one entityAddition allowance; deriving it from the
  // parsed contract keeps the allowance rows typed rather than bare JSON
  const tamperedContract = {
    ...parsed.value,
    allowedStructuralChanges: parsed.value.allowedStructuralChanges.filter(
      (entry) => entry.allowanceId !== 'group-d-add-root'
    ),
  }
  const parsedTampered = parseSemanticChangeContractV1(tamperedContract)
  assert.equal(
    parsedTampered.ok,
    true,
    parsedTampered.ok ? undefined : JSON.stringify(parsedTampered.issues)
  )
  if (!parsedTampered.ok) assert.fail('tampered Group D contract did not parse')
  const registry = new EditChangeContractRegistryV1({
    hostDefaultLimits: HOST_DEFAULT_LIMITS,
    hostHardLimits: HOST_HARD_LIMITS,
  })
  const register = (
    registrationId: string,
    semanticContract: typeof parsed.value
  ): EditChangeContractRegistrationV1 =>
  {
    const provenance = {
      authorityId: 'phase-8-group-d-authority',
      hostConfigurationSha256: HASH_A,
      provenanceArtifactSha256: HASH_B,
      registeredAt: '2026-07-20T00:00:00.000Z',
    }
    const displayObjective = boundedDisplayStringV1(
      'exercise Group D production graph authoring atomically'
    ) as EditChangeContractRegistrationV1['displayObjective']
    const withoutDisplayHash = {
      schemaVersion: 1 as const,
      registrationId,
      semanticContract,
      semanticContractSha256: semanticHashV1(
        'change-contract',
        semanticContract
      ),
      bindingDisplayEvidence: [],
      displayObjective,
      provenance,
    }
    return {
      ...withoutDisplayHash,
      displayEvidenceSha256: sha256Hex(
        canonicalJsonBytesV1({
          bindingDisplayEvidence: [],
          displayObjective,
          provenance,
        })
      ),
    }
  }
  const validRegistration = register('phase-8-group-d-valid', parsed.value)
  const tamperedRegistration = register(
    'phase-8-group-d-tampered',
    parsedTampered.value
  )
  registry.registerBytes(
    canonicalJsonBytesV1(validRegistration),
    retainedPolicyArtifacts
  )
  registry.registerBytes(
    canonicalJsonBytesV1(tamperedRegistration),
    retainedPolicyArtifacts
  )
  registry.seal()
  const bind = (registration: EditChangeContractRegistrationV1) =>
    registry.bind({
      registrationId: registration.registrationId,
      expectedSemanticContractSha256: registration.semanticContractSha256,
      source: { kind: 'exactArtifact', sourceArtifactSha256 },
      existingBindings: [
        {
          bindingKey: spriteContractRef.bindingKey,
          entityKind: 'target',
          sourceLocationSha256: sprite.semanticLocationSha256,
        },
      ],
    })
  return {
    registry,
    valid: bind(validRegistration),
    tampered: bind(tamperedRegistration),
    scriptAdd,
    createdSayRef,
    futureContentSha256s: [
      scriptContentSha256,
      rootContentSha256,
      sayContentSha256,
      insertedContentSha256,
    ],
  }
}

function handleRef<
  Kind extends EditInspectDomainResultV1['items'][number]['entityKind'],
>(
  item: EditInspectDomainResultV1['items'][number],
  expectedKind: Kind
): {
  readonly entityKind: Kind
  readonly expectedSemanticFingerprint: string
  readonly refKind: 'handle'
  readonly token: string
}
{
  assert.ok(item.handle)
  assert.equal(item.entityKind, expectedKind)
  return {
    entityKind: expectedKind,
    expectedSemanticFingerprint: item.semanticFingerprintSha256,
    refKind: 'handle',
    token: item.handle,
  }
}

async function assertEditRefusal(
  action: () => Promise<unknown>,
  code: string
): Promise<void>
{
  await assert.rejects(
    action,
    (error: unknown) =>
      error instanceof EditSessionErrorV1 && error.code === code
  )
}

function operationIdArrays(value: unknown): readonly (readonly string[])[]
{
  const arrays: string[][] = []
  const visit = (entry: unknown): void =>
  {
    if (Array.isArray(entry))
    {
      for (const child of entry) visit(child)
      return
    }
    if (entry === null || typeof entry !== 'object') return
    for (const [key, child] of Object.entries(entry))
    {
      if (
        key === 'operationIds' &&
        Array.isArray(child) &&
        child.every((item) => typeof item === 'string')
      )
        arrays.push(child)
      visit(child)
    }
  }
  visit(value)
  return arrays
}

function assertRestoreLineageHistoryInvariant(revision: {
  activeLineage: unknown
  lineageHistory: unknown
}): void
{
  type RecordProjection = {
    lineageId: string
    status: string
    canonicalOrdinal: number | null
  }
  const active = revision.activeLineage as {
    records: readonly RecordProjection[]
  }
  const history = revision.lineageHistory as {
    records: readonly RecordProjection[]
  }
  const activeById = new Map(
    active.records.map((record) => [record.lineageId, record])
  )
  const historyById = new Map(
    history.records.map((record) => [record.lineageId, record])
  )
  for (const record of history.records)
  {
    const selected = activeById.get(record.lineageId)
    if (!selected) assert.equal(record.status, 'tombstoned')
    else
      assert.deepEqual(
        {
          status: record.status,
          canonicalOrdinal: record.canonicalOrdinal,
        },
        {
          status: selected.status,
          canonicalOrdinal: selected.canonicalOrdinal,
        }
      )
  }
  for (const record of active.records)
    assert.equal(historyById.has(record.lineageId), true)
}

function retainedFutureBindingLedger(revision: { authorization: unknown }): {
  readonly schemaVersion: 1
  readonly changeContractSha256: string
  readonly realizations: readonly {
    readonly bindingKeySha256: string
    readonly bindingDescriptorSha256: string
    readonly creationProjectionSha256: string
    readonly creatorOperationOccurrenceId: string
    readonly resultLineageId: string
    readonly ownerLineageId: string | null
    readonly resultCorrespondenceSha256: string
  }[]
}
{
  assert.ok(
    revision.authorization !== null &&
      typeof revision.authorization === 'object' &&
      'futureBindingLedger' in revision.authorization
  )
  return revision.authorization.futureBindingLedger as ReturnType<
    typeof retainedFutureBindingLedger
  >
}

function assertHashOnlyFutureBindingRows(
  rows: ReturnType<typeof retainedFutureBindingLedger>['realizations'],
  bindingKeys: readonly string[] = GROUP_C_FUTURE_BINDING_KEYS
): void
{
  const rowKeys = [
    'bindingDescriptorSha256',
    'bindingKeySha256',
    'creationProjectionSha256',
    'creatorOperationOccurrenceId',
    'ownerLineageId',
    'resultCorrespondenceSha256',
    'resultLineageId',
  ]
  for (const row of rows)
  {
    assert.deepEqual(Object.keys(row).sort(), rowKeys)
    for (const [key, value] of Object.entries(row))
    {
      if (key === 'ownerLineageId' && value === null) continue
      assert.match(String(value), /^[a-f0-9]{64}$/u)
    }
    const serialized = JSON.stringify(row)
    for (const bindingKey of bindingKeys)
      assert.equal(serialized.includes(bindingKey), false)
  }
}

class ProductionBatchPlannerV1
{
  readonly #dispatchers: ReadonlyMap<string, ProductionOperationDispatcherV1>
  readonly #input: EditTransactionInputV1
  readonly #source: ProjectIR
  readonly #preBatch: ProjectIR
  readonly #candidate: ProjectIR
  readonly #contract: BoundChangeContractV1
  readonly #operations: SemanticEditOperationV1[] = []
  readonly #assetMaterializationUsage: AssetMaterializationUsageDeltaV1[] = []
  readonly #operationResults = new Map<string, unknown>()
  readonly #preBatchLineage: ProductionOperationContextV1['preBatchLineage']
  #activeLineage: ProductionOperationContextV1['activeLineage']
  #lineageHistory: ProductionOperationContextV1['activeLineage']
  #futureBindingLedger: ProductionOperationContextV1['futureBindingLedger']
  readonly #resolveOwnerLineageId: ReturnType<
    typeof existingBindingOwnerLineageResolverV1
  >

  private constructor(input: {
    source: ProjectIR
    current: ProjectIR
    transactionInput: EditTransactionInputV1
    contract: BoundChangeContractV1
  })
  {
    this.#source = input.source
    this.#preBatch = input.current
    this.#candidate = ProjectIR.fromProjectJsonWithUidSnapshot(
      structuredClone(input.current.toProjectJson()),
      input.current.assets.map((asset) => ({
        path: asset.path,
        bytes: new Uint8Array(asset.bytes),
      })),
      input.transactionInput.currentRevision.allocatorState as UidSnapshot
    )
    this.#input = input.transactionInput
    this.#contract = input.contract
    this.#preBatchLineage = input.transactionInput.currentRevision
      .activeLineage as ProductionOperationContextV1['preBatchLineage']
    this.#activeLineage = this.#preBatchLineage
    this.#lineageHistory = input.transactionInput.currentRevision
      .lineageHistory as ProductionOperationContextV1['activeLineage']
    this.#resolveOwnerLineageId = existingBindingOwnerLineageResolverV1(
      this.#source,
      this.#contract.registration.semanticContract,
      buildSourceLineageV1(this.#source, this.#input.semanticSourceSha256)
        .active
    )
    this.#futureBindingLedger = productionFutureBindingLedgerV1(
      this.#input,
      this.#contract.registration.semanticContract,
      this.#resolveOwnerLineageId
    )
    const dispatchers: readonly ProductionOperationDispatcherV1[] = [
      new TargetProductionOperationDispatcherV1(),
      new DeclarationProductionOperationDispatcherV1(),
      new CommentProductionOperationDispatcherV1(),
      new ScriptWorkspaceProductionOperationDispatcherV1(),
      ...scriptBlockProductionOperationDispatchersV1(),
      ...procedureProductionOperationDispatchersV1(),
      ...mediaTargetProductionOperationDispatchersV1(),
    ]
    this.#dispatchers = new Map(
      dispatchers.flatMap((dispatcher) =>
        dispatcher.operationKinds.map((kind) => [kind, dispatcher] as const)
      )
    )
  }

  static async create(input: {
    source: ProjectIR
    sourceBytes: Uint8Array
    session: EditSessionV1
    store: EditArtifactStorePort
    contract: BoundChangeContractV1
    inspection: EditInspectDomainResultV1
    resolveAdmittedAsset?: AdmittedEditAssetResolverV1
  }): Promise<ProductionBatchPlannerV1>
  {
    const currentRevision = input.session.revisions.at(-1)!
    const currentBytes = await input.store.readImmutable(
      currentRevision.candidateKey
    )
    const current = await ProjectIR.fromSb3(currentBytes)
    return new ProductionBatchPlannerV1({
      source: input.source,
      current,
      contract: input.contract,
      transactionInput: {
        sessionId: input.session.sessionId,
        sourceBytes: input.sourceBytes,
        currentBytes,
        semanticSourceSha256: input.session.semanticSourceSha256,
        sourceArtifactSha256: input.session.head.sourceArtifactSha256,
        currentHead: input.session.head,
        currentRevision,
        acceptedHistorySha256: historyProjectionV1(
          input.session.semanticSourceSha256,
          input.session.revisions
        ).sha256,
        changeContractSha256: input.session.head.changeContractSha256,
        changeContract: input.contract.registration.semanticContract,
        resourceLimits: {
          activeMatchCandidates:
            input.contract.effectiveLimits.activeMatchCandidateLimit,
          describedBlockNodes: input.contract.effectiveLimits.intentBudgetLimit,
          touchedBlockRecords: input.contract.effectiveLimits.impactBudgetLimit,
          touchedTargets:
            DEFAULT_PHASE_8_RESOURCE_POLICY.targetsTouchedPerBatch,
          touchedScripts:
            DEFAULT_PHASE_8_RESOURCE_POLICY.scriptsTouchedPerBatch,
          touchedDeclarations:
            DEFAULT_PHASE_8_RESOURCE_POLICY.declarationsTouchedPerBatch,
          touchedComments:
            DEFAULT_PHASE_8_RESOURCE_POLICY.commentsTouchedPerBatch,
          touchedMedia: DEFAULT_PHASE_8_RESOURCE_POLICY.mediaTouchedPerBatch,
        },
        canonicalTransaction: null,
        ...(input.resolveAdmittedAsset === undefined
          ? {}
          : { resolveAdmittedAsset: input.resolveAdmittedAsset }),
        verifyHandle: (request) =>
          input.inspection.items.some(
            (item) =>
              item.handle === request.token &&
              item.entityKind === request.entityKind &&
              item.entitySubtype === request.entitySubtype &&
              item.semanticLocationSha256 === request.semanticLocationSha256 &&
              item.semanticFingerprintSha256 ===
                request.semanticFingerprintSha256
          ),
      },
    })
  }

  get candidate(): ProjectIR
  {
    return this.#candidate
  }

  get futureBindingRealizations(): readonly {
    readonly bindingKeySha256: string
    readonly resultLineageId: string
  }[]
  {
    return this.#futureBindingLedger.realizations as readonly {
      readonly bindingKeySha256: string
      readonly resultLineageId: string
    }[]
  }

  get changeContractSha256(): string
  {
    return this.#input.changeContractSha256
  }

  get assetMaterializationUsage(): AssetMaterializationUsageDeltaV1
  {
    return combineAssetMaterializationUsageDeltasV1(
      this.#assetMaterializationUsage
    )
  }

  add(operation: UnplannedSemanticEditOperationV1): SemanticEditOperationV1
  {
    const planned = this.plan(operation)
    const dispatcher = this.#dispatchers.get(planned.kind)
    assert.ok(dispatcher)
    const dispatched = dispatcher.execute(this.#context(), planned)
    const priorLineageHistory = this.#lineageHistory
    this.#activeLineage = dispatched.activeLineage
    this.#lineageHistory = mergeProductionLineageHistoryV1(
      this.#lineageHistory,
      this.#activeLineage
    )
    this.#futureBindingLedger = advanceProductionFutureBindingLedgerV1({
      ledger: this.#futureBindingLedger,
      changeContractSha256: this.#input.changeContractSha256,
      contract: this.#contract.registration.semanticContract,
      priorLineageHistory,
      lineageHistory: this.#lineageHistory,
      creatorOperationOccurrenceId: editOperationOccurrenceIdV1(
        this.#input.acceptedHistorySha256,
        planned.opId
      ),
      predecessorAcceptedHistorySha256: this.#input.acceptedHistorySha256,
      creatorOperationId: planned.opId,
      creatorOperationKind: planned.kind,
      candidates: dispatched.futureBindingRealizationCandidates ?? [],
      resolveOwnerLineageId: this.#resolveOwnerLineageId,
    })
    this.#operationResults.set(planned.opId, dispatched.result)
    this.#assetMaterializationUsage.push(
      dispatched.assetMaterializationUsage ??
        EMPTY_ASSET_MATERIALIZATION_USAGE_DELTA_V1
    )
    this.#operations.push(planned)
    return planned
  }

  plan(operation: UnplannedSemanticEditOperationV1): SemanticEditOperationV1
  {
    const context = this.#context()
    const provisional = {
      ...operation,
      expectedPlanningFactSetSha256: HASH_A,
    } as SemanticEditOperationV1
    // sprite creation names no existing target, so it projects its facts through
    // the Group F creation projection rather than the target-selector one
    const expectedPlanningFactSetSha256 =
      provisional.kind === 'target.addSprite'
        ? productionMediaTargetSpritePlanningFactSetSha256V1(context, provisional)
        : provisional.kind.startsWith('target.')
          ? productionTargetPlanningFactSetSha256V1(
              this.#preBatch,
              provisional as TargetOperationV1,
              this.#targetIndex(provisional),
              this.#preBatchLineage
            )
          : provisional.kind.startsWith('declaration.')
            ? productionDeclarationPlanningFactSetSha256V1(
                context,
                provisional as Extract<
                  SemanticEditOperationV1,
                  { kind: `declaration.${string}` }
                >
              )
            : provisional.kind.startsWith('comment.')
              ? productionCommentPlanningFactSetSha256V1(
                  context,
                  provisional as Extract<
                    SemanticEditOperationV1,
                    { kind: `comment.${string}` }
                  >
                )
              : provisional.kind === 'script.moveWorkspace'
                ? productionScriptWorkspacePlanningFactSetSha256V1(
                    context,
                    provisional
                  )
                : provisional.kind.startsWith('script.') ||
                    provisional.kind.startsWith('block.')
                  ? productionScriptBlockPlanningFactSetSha256V1(
                      context,
                      provisional as Exclude<
                        Extract<
                          SemanticEditOperationV1,
                          { kind: `script.${string}` | `block.${string}` }
                        >,
                        { kind: 'script.moveWorkspace' }
                      >
                    )
                  : provisional.kind.startsWith('procedure.')
                    ? productionProcedurePlanningFactSetSha256V1(
                        context,
                        provisional as Extract<
                          SemanticEditOperationV1,
                          { kind: `procedure.${string}` }
                        >
                      )
                    : provisional.kind.startsWith('media.')
                      ? productionMediaTargetPlanningFactSetSha256V1(
                          context,
                          provisional as Extract<
                            SemanticEditOperationV1,
                            { kind: `media.${string}` }
                          >
                        )
                      : assert.fail(
                          `unplanned production operation ${provisional.kind}`
                        )
    const planned = {
      ...provisional,
      expectedPlanningFactSetSha256,
    } as SemanticEditOperationV1
    return planned
  }

  batch(): {
    readonly schemaVersion: 1
    readonly expected: ReturnType<typeof planningHead>
    readonly operations: readonly SemanticEditOperationV1[]
  }
  {
    return {
      schemaVersion: 1,
      expected: planningHead(this.#input.currentHead, this.#input.sessionId),
      operations: Object.freeze([...this.#operations]),
    }
  }

  #context(): ProductionOperationContextV1
  {
    return {
      input: this.#input,
      source: this.#source,
      preBatch: this.#preBatch,
      candidate: this.#candidate,
      contract: this.#contract.registration.semanticContract,
      operationResultsById: this.#operationResults,
      preBatchLineage: this.#preBatchLineage,
      activeLineage: this.#activeLineage,
      futureBindingLedger: this.#futureBindingLedger,
    }
  }

  #targetIndex(operation: SemanticEditOperationV1): number
  {
    if (!('target' in operation)) assert.fail('target operation has no target')
    const reference = operation.target
    if (reference.refKind === 'structural')
    {
      if (reference.selectorKind !== 'exactLocation')
        assert.fail('test planner requires an exact target ref')
      return reference.location.serializedTargetOrdinal
    }
    if (reference.refKind === 'handle')
    {
      const evidence = targetEntityEvidenceSetV1(this.#preBatch.json).find(
        (candidate) =>
          this.#input.verifyHandle?.({
            token: reference.token,
            entityKind: 'target',
            entitySubtype: candidate.targetKind,
            lineageSha256: activeOrderedSemanticLineages(
              this.#preBatchLineage,
              'target',
              null
            )[candidate.targetIndex]!.lineageId,
            semanticLocationSha256: candidate.semanticLocationSha256,
            semanticFingerprintSha256: candidate.semanticFingerprintSha256,
          })
      )
      assert.ok(evidence)
      const selectedLineage = activeOrderedSemanticLineages(
        this.#preBatchLineage,
        'target',
        null
      )[evidence.targetIndex]
      assert.ok(selectedLineage)
      const candidateIndex = activeOrderedSemanticLineages(
        this.#activeLineage,
        'target',
        null
      ).findIndex((record) => record.lineageId === selectedLineage.lineageId)
      assert.notEqual(candidateIndex, -1)
      return candidateIndex
    }
    return assert.fail('Group C does not create targets')
  }
}

test('Group B retains one exact lifecycle and replays it after a fresh restart', async (t) =>
{
  const root = tempRoot(t)
  const fixture = await buildFixtureSb3()
  const sourceProject = await ProjectIR.fromSb3(fixture.sb3)
  const inspectedSprite = sourceProject.json.targets[1]
  if (!inspectedSprite || inspectedSprite.isStage)
    throw new Error('fixture sprite is absent')
  inspectedSprite.variables.cloudScore = ['cloud total', 0, true]
  inspectedSprite.variables.identicalA = ['identical declaration', 0]
  inspectedSprite.variables.identicalB = ['identical declaration', 0]
  inspectedSprite.comments ??= {}
  inspectedSprite.comments.inspectComment = {
    blockId: 'hat1',
    x: 24,
    y: 36,
    width: 180,
    height: 90,
    minimized: false,
    text: 'inspection evidence',
  }
  const inspectedHat = inspectedSprite.blocks.hat1
  if (!inspectedHat || Array.isArray(inspectedHat))
    throw new Error('fixture hat unexpectedly uses primitive tuple form')
  inspectedHat.comment = 'inspectComment'
  const sourceBytes = await sourceProject.toSb3()
  const sourceArtifactSha256 = sha256Hex(sourceBytes)
  const { registry: contracts, bound } = registeredContract(
    sourceArtifactSha256,
    sourceProject
  )
  const durableAdapter = createEditArtifactStoreHostAdapter(root)
  const store = durableAdapter
  const capability = await durableAdapter.capability()
  const identity = {
    realmSha256: HASH_A,
    profileSha256: HASH_B,
    pinnedScratchRuntimeSourceSha256: HASH_C,
    retentionPolicySha256: HASH_D,
    policyConfigVersion: 1,
  }
  const handleSecret = new Uint8Array(32).fill(0x31)
  const sessions = createEditSessionRegistryForExecutorV1(
    {
      artifactStore: store,
      changeContracts: contracts,
      identity,
      clock: deterministicClock(1_753_056_000_000),
      entropy: deterministicEntropy(11),
      handleSecret,
    },
    new KernelTestTransactionExecutorV1()
  )
  const beginRequest: EditBeginRequestV1 = {
    schemaVersion: 1,
    requestId: 'begin-group-b-lifecycle',
    baseline: {
      kind: 'projectSession',
      projectSessionId: 'phase-8-project-session',
      expectedSourceArtifactSha256: sourceArtifactSha256,
    },
    changeContractRegistrationId: bound.registration.registrationId,
    expectedSemanticContractSha256: bound.registration.semanticContractSha256,
  }
  const source: EditSourceIntakeV1 = {
    bytes: sourceBytes,
    displayName: 'phase-8-group-b-fixture.sb3',
    expectedArtifactSha256: sourceArtifactSha256,
    provenance: {
      kind: 'projectSession',
      projectSessionId: 'phase-8-project-session',
      selectedDisplayName: 'phase-8-group-b-fixture.sb3',
      canonicalRealpath: '/virtual/phase-8-group-b-fixture.sb3',
      device: 'test-device',
      inode: 'test-inode',
      byteLength: sourceBytes.byteLength,
      modifiedAtNanoseconds: '1753056000000000000',
      sourceInspectionPolicySha256: HASH_A,
      diagnosticPolicySha256: HASH_B,
      runtimePolicySha256: HASH_C,
      provenanceRegistrationSha256: HASH_D,
    },
    recheck: async () => ({
      ok: true,
      observedArtifactSha256: sourceArtifactSha256,
    }),
  }
  const begun = await sessions.begin(beginRequest, source, invocation(1))
  const session = sessions.session(begun.sessionId)
  const sessionPrefix = `sessions/${session.manifest.sessionKey}`
  const revisionZero = session.revisions[0]!
  const initialReport = session.reports[0]!
  const initialReportArtifactSha256 = sha256Hex(
    editCanonicalBytesV1(initialReport)
  )
  assert.equal(begun.state, 'active')
  assert.deepEqual(begun.head, revisionZero.head)
  assert.deepEqual(
    (await store.listImmutable(sessionPrefix)).map((entry) => entry.key).sort(),
    [
      `${sessionPrefix}/authority/bound-change-contract.json`,
      `${sessionPrefix}/authority/capability-profile.json`,
      `${sessionPrefix}/authority/change-contract-registration.json`,
      `${sessionPrefix}/current-report.json`,
      `${sessionPrefix}/events/000000-${begun.eventSha256}.json`,
      `${sessionPrefix}/head.json`,
      `${sessionPrefix}/recovery/begin-authority-v1.json`,
      `${sessionPrefix}/reports/${initialReportArtifactSha256}/manifest.json`,
      revisionZero.candidateKey,
      revisionZero.manifestKey,
      `${sessionPrefix}/reports/${initialReportArtifactSha256}/report.json`,
      `${sessionPrefix}/reports/${initialReportArtifactSha256}/report.md`,
      `${sessionPrefix}/reports/${initialReportArtifactSha256}/semantic-projection.json`,
      ...[
        'allocator.json',
        'authorization.json',
        'batch.json',
        'capability-snapshot.json',
        'cumulative-delta.json',
        'diagnostics.json',
        'lineage-history.json',
        'lineage.json',
        'operation-results.json',
        'preservation.json',
        'previous-delta.json',
        'resolved-plan.json',
      ].map((name) => revisionZero.manifestKey.replace('manifest.json', name)),
      `${sessionPrefix}/session.json`,
      `${sessionPrefix}/source/admission.json`,
      `${sessionPrefix}/source/input.sb3`,
      `${sessionPrefix}/source/provenance.json`,
      `${sessionPrefix}/source/semantic-identity.json`,
    ].sort()
  )
  assert.deepEqual(
    await store.readImmutable(`${sessionPrefix}/source/input.sb3`),
    sourceBytes
  )
  assert.deepEqual(
    await store.readImmutable(revisionZero.candidateKey),
    sourceBytes
  )
  assert.equal(revisionZero.head.revisionNumber, 0)
  assert.equal(revisionZero.head.candidateSha256, sourceArtifactSha256)
  const retainedBoundContract = JSON.parse(
    new TextDecoder().decode(
      await store.readImmutable(
        `${sessionPrefix}/authority/bound-change-contract.json`
      )
    )
  ) as { existingBindings: readonly { bindingKey: string }[] }
  assert.deepEqual(
    retainedBoundContract.existingBindings.map((entry) => entry.bindingKey),
    ['stage']
  )

  const beforeInspect = await inventory(store, sessionPrefix)
  const firstInspect = await session.inspect({ issueHandles: true })
  const secondInspect = await session.inspect({ issueHandles: true })
  assert.deepEqual(secondInspect, firstInspect)
  assert.deepEqual(
    firstInspect.items.map((item) => item.entityKind),
    [
      'target',
      'target',
      'declaration',
      'declaration',
      'declaration',
      'declaration',
      'script',
      'block',
      'block',
      'block',
      'comment',
      'media',
      'media',
    ]
  )
  assert.equal(firstInspect.handlesIssued, true)
  assert.equal(new Set(firstInspect.items.map((item) => item.handle)).size, 13)
  const identicalDeclarations = firstInspect.items.filter(
    (item) =>
      item.entityKind === 'declaration' &&
      item.entitySubtype === 'variable' &&
      item.location.name.displayKind === 'inline' &&
      item.location.name.value === 'identical declaration'
  )
  assert.equal(identicalDeclarations.length, 2)
  assert.equal(
    identicalDeclarations[0]!.semanticLocationSha256,
    identicalDeclarations[1]!.semanticLocationSha256
  )
  assert.equal(
    identicalDeclarations[0]!.semanticFingerprintSha256,
    identicalDeclarations[1]!.semanticFingerprintSha256
  )
  assert.notEqual(
    identicalDeclarations[0]!.handle,
    identicalDeclarations[1]!.handle
  )
  const identicalLineages = (
    revisionZero.activeLineage as {
      readonly records: readonly {
        readonly lineageId: string
        readonly rawIdentity: string
      }[]
    }
  ).records.filter(
    (record) =>
      record.rawIdentity === 'variable:identicalA' ||
      record.rawIdentity === 'variable:identicalB'
  )
  assert.equal(identicalLineages.length, 2)
  const resolvedLineages = identicalDeclarations.map((item) =>
  {
    assert.ok(item.handle)
    const matches = identicalLineages.filter((lineage) =>
      verifyEditHandleV1(
        item.handle!,
        {
          sessionId: session.sessionId,
          revisionId: revisionZero.head.revisionId,
          revisionNumber: revisionZero.head.revisionNumber,
          entityKind: item.entityKind,
          entitySubtype: item.entitySubtype,
          lineageSha256: lineage.lineageId,
          semanticLocationSha256: item.semanticLocationSha256,
          semanticFingerprintSha256: item.semanticFingerprintSha256,
          handleEpoch: 0,
        },
        handleSecret
      )
    )
    assert.equal(matches.length, 1)
    return matches[0]!.lineageId
  })
  assert.equal(new Set(resolvedLineages).size, 2)
  const inspectedCloudVariable = firstInspect.items.find(
    (item) =>
      item.entityKind === 'declaration' &&
      item.entitySubtype === 'variable' &&
      'name' in item.location &&
      item.location.name.displayKind === 'inline' &&
      item.location.name.value === 'cloud total'
  )
  const inspectedLocalVariable = firstInspect.items.find(
    (item) =>
      item.entityKind === 'declaration' &&
      item.entitySubtype === 'variable' &&
      'name' in item.location &&
      item.location.name.displayKind === 'inline' &&
      item.location.name.value === 'score'
  )
  assert.ok(inspectedCloudVariable && 'cloud' in inspectedCloudVariable)
  assert.ok(inspectedLocalVariable && 'cloud' in inspectedLocalVariable)
  assert.equal(inspectedCloudVariable.cloud, true)
  assert.equal(inspectedLocalVariable.cloud, false)
  for (const item of firstInspect.items)
  {
    assert.equal(item.handle?.length, 87)
    assert.match(item.handle!, /^[A-Za-z0-9_-]{87}$/u)
    assert.match(item.semanticLocationSha256, /^[a-f0-9]{64}$/u)
    assert.match(item.semanticFingerprintSha256, /^[a-f0-9]{64}$/u)
    assert.match(item.contextFingerprintSha256, /^[a-f0-9]{64}$/u)
    assert.equal(item.location.fullLocationSha256, item.semanticLocationSha256)
    assert.equal(
      item.location.semanticFingerprint,
      item.semanticFingerprintSha256
    )
    assert.match(
      item.location.retainedLocationArtifactId,
      /^(?:target|declaration|script|block|comment|media)-location-[a-f0-9]{32}$/u
    )
    const publicProjection = JSON.stringify(item)
    for (const rawIdProperty of [
      'targetIndex',
      'declarationId',
      'topBlockId',
      'blockId',
      'commentId',
      'rawRef',
    ])
      assert.equal(publicProjection.includes(`"${rawIdProperty}"`), false)
  }
  const tokenFreeInspect = await session.inspect({ issueHandles: false })
  assert.equal(tokenFreeInspect.handlesIssued, false)
  assert.equal(
    tokenFreeInspect.items.every((item) => item.handle === undefined),
    true
  )
  assert.notEqual(tokenFreeInspect.querySha256, firstInspect.querySha256)
  await assert.rejects(
    () =>
      session.inspect({
        revisionId: revisionZero.head.revisionId,
        issueHandles: false,
      }),
    (error: unknown) =>
      error instanceof EditSessionErrorV1 &&
      error.code === 'edit.invalid_payload'
  )
  assert.deepEqual(await inventory(store, sessionPrefix), beforeInspect)

  const dependentTransaction = defineKernelTestTransactionV1([
    {
      kind: 'kernel.test.setTargetNumber',
      opId: 'set-stage-volume',
      targetIndex: 0,
      property: 'volume',
      value: {
        kind: 'result',
        opId: 'produce-volume',
        resultKey: 'volume',
      },
    },
    {
      kind: 'kernel.test.constant',
      opId: 'produce-volume',
      resultKey: 'volume',
      value: 72,
    },
  ])
  const firstPreview = await session.preview(
    {
      requestId: 'preview-dependent-stage-volume',
      expectedHead: session.head,
      canonicalTransaction: dependentTransaction,
    },
    invocation(2)
  )
  assert.deepEqual(firstPreview.preview.operationResults, [
    {
      opId: 'produce-volume',
      resultKind: 'constant',
      resultKey: 'volume',
      value: 72,
    },
    {
      opId: 'set-stage-volume',
      resultKind: 'targetPropertySet',
      targetIndex: 0,
      property: 'volume',
      value: 72,
    },
  ])
  const firstApplyRequest: EditApplyRequestV1 = {
    schemaVersion: 1,
    sessionId: session.sessionId,
    requestId: 'apply-dependent-stage-volume',
    ...expectedHeadRequest(firstPreview.preview.expectedHead),
    previewId: firstPreview.preview.previewId,
    applyGuardSha256: firstPreview.preview.applyGuardSha256,
    expectedResolvedPlanSha256: firstPreview.preview.resolvedPlanSha256,
  }
  const firstApply = await session.apply(firstApplyRequest, invocation(3))
  assert.equal(firstApply.head.revisionNumber, 1)
  assert.equal(
    firstApply.head.candidateSha256,
    firstPreview.preview.predictedCandidateSha256
  )
  assert.deepEqual(
    firstApply.operationResults,
    firstPreview.preview.operationResults
  )
  const historicalInspect = await session.inspect({
    revisionNumber: revisionZero.head.revisionNumber,
    revisionId: revisionZero.head.revisionId,
    issueHandles: false,
  })
  assert.equal(historicalInspect.revision.revisionNumber, 0)
  assert.equal(
    historicalInspect.items.every((item) => item.handle === undefined),
    true
  )
  await assert.rejects(
    () =>
      session.inspect({
        revisionNumber: revisionZero.head.revisionNumber,
        revisionId: revisionZero.head.revisionId,
        issueHandles: true,
      }),
    (error: unknown) =>
      error instanceof EditSessionErrorV1 &&
      error.code === 'edit.stale_revision'
  )
  const afterFirstApply = await inventory(store, sessionPrefix)
  assert.deepEqual(
    await session.apply(firstApplyRequest, invocation(3)),
    firstApply
  )
  assert.deepEqual(await inventory(store, sessionPrefix), afterFirstApply)

  const checkpointRequest: EditCheckpointRequestV1 = {
    schemaVersion: 1,
    sessionId: session.sessionId,
    requestId: 'checkpoint-stage-volume',
    label: 'stage-volume-applied',
    note: 'rollback authority after the first accepted apply',
    ...expectedHeadRequest(session.head),
  }
  const checkpoint = await session.checkpoint(checkpointRequest, invocation(4))
  assert.equal(checkpoint.revision.revisionId, firstApply.revisionId)
  assert.equal(checkpoint.revision.revisionNumber, 1)

  const evaluation = await session.recordEvaluationUnavailable(
    'evaluate-unavailable-group-b',
    invocation(5)
  )
  assert.equal(evaluation.state, 'unavailable')
  assert.deepEqual(session.status(), {
    ...session.status(),
    state: 'active',
    evaluationState: 'unavailable',
    exportState: 'unavailable',
    exportReady: false,
  })

  const secondTransaction = defineKernelTestTransactionV1([
    {
      kind: 'kernel.test.setTargetNumber',
      opId: 'set-sprite-x',
      targetIndex: 1,
      property: 'x',
      value: { kind: 'literal', value: 44 },
    },
  ])
  const secondPreview = await session.preview(
    {
      requestId: 'preview-second-apply',
      expectedHead: session.head,
      canonicalTransaction: secondTransaction,
    },
    invocation(6)
  )
  const secondApplyRequest: EditApplyRequestV1 = {
    schemaVersion: 1,
    sessionId: session.sessionId,
    requestId: 'apply-sprite-x',
    ...expectedHeadRequest(secondPreview.preview.expectedHead),
    previewId: secondPreview.preview.previewId,
    applyGuardSha256: secondPreview.preview.applyGuardSha256,
    expectedResolvedPlanSha256: secondPreview.preview.resolvedPlanSha256,
  }
  const secondApply = await session.apply(secondApplyRequest, invocation(7))
  assert.equal(secondApply.head.revisionNumber, 2)
  assert.notEqual(
    secondApply.head.candidateSha256,
    firstApply.head.candidateSha256
  )

  const undoRequest: EditUndoRequestV1 = {
    schemaVersion: 1,
    sessionId: session.sessionId,
    requestId: 'undo-second-apply',
    ...expectedHeadRequest(session.head),
    expectedUndoableApplyRevisionId: secondApply.revisionId,
  }
  const undo = await session.undo(undoRequest, invocation(8))
  assert.equal(undo.head.revisionNumber, 3)
  assert.equal(undo.restoreKind, 'undo')
  assert.equal(undo.selectedRevision.revisionId, firstApply.revisionId)
  assert.equal(undo.head.candidateSha256, firstApply.head.candidateSha256)

  const rollbackRequest: EditRollbackRequestV1 = {
    schemaVersion: 1,
    sessionId: session.sessionId,
    requestId: 'rollback-first-checkpoint',
    ...expectedHeadRequest(session.head),
    target: {
      kind: 'checkpoint',
      checkpointId: checkpoint.checkpointId,
      expectedCheckpointSha256: checkpoint.checkpointSha256,
    },
  }
  const rollback = await session.rollback(rollbackRequest, invocation(9))
  assert.equal(rollback.head.revisionNumber, 4)
  assert.equal(rollback.restoreKind, 'rollback')
  assert.equal(rollback.selectedRevision.revisionId, firstApply.revisionId)
  assert.equal(rollback.head.candidateSha256, firstApply.head.candidateSha256)

  const closeRequest: EditCloseRequestV1 = {
    schemaVersion: 1,
    sessionId: session.sessionId,
    requestId: 'close-unexported-group-b',
    reason: 'Group B lifecycle contract completed without export authority',
    ...expectedHeadRequest(session.head),
  }
  const closed = await session.close(closeRequest, invocation(10))
  assert.equal(closed.terminalState, 'closed-unexported')
  assert.equal(session.status().state, 'closed-unexported')
  assert.equal(session.status().evaluationState, 'unavailable')
  assert.equal(session.status().exportState, 'unavailable')
  assert.equal(session.status().exportReady, false)
  const afterClose = await inventory(store, sessionPrefix)
  await assert.rejects(
    () =>
      session.preview(
        {
          requestId: 'preview-after-close',
          expectedHead: session.head,
          canonicalTransaction: secondTransaction,
        },
        invocation(11)
      ),
    (error: unknown) =>
      error instanceof EditSessionErrorV1 &&
      error.code === 'edit.session_closed'
  )
  assert.deepEqual(await inventory(store, sessionPrefix), afterClose)

  assert.equal(session.revisions.length, 5)
  assert.deepEqual(
    session.revisions.map((revision) => revision.head.revisionNumber),
    [0, 1, 2, 3, 4]
  )
  assert.deepEqual(
    await store.readImmutable(revisionZero.candidateKey),
    sourceBytes
  )
  assert.deepEqual(
    await store.readImmutable(`${sessionPrefix}/source/input.sb3`),
    sourceBytes
  )
  assert.equal(
    await store.hashImmutable(`${sessionPrefix}/source/input.sb3`),
    sourceArtifactSha256
  )
  assert.equal(
    session.revisions[3]!.head.candidateSha256,
    firstApply.head.candidateSha256
  )
  assert.equal(
    session.revisions[4]!.head.candidateSha256,
    firstApply.head.candidateSha256
  )

  assert.deepEqual(
    session.events.map((event) => event.projection.eventKind),
    [
      'session-begun',
      'preview-recorded',
      'transition-prepared',
      'transition-committed',
      'checkpoint-recorded',
      'evaluation-recorded',
      'preview-recorded',
      'transition-prepared',
      'transition-committed',
      'transition-prepared',
      'transition-committed',
      'transition-prepared',
      'transition-committed',
      'session-closed',
    ]
  )
  for (const [index, event] of session.events.entries())
  {
    assert.equal(event.projection.sequence, index)
    assert.equal(
      event.projection.previousEventSha256,
      index === 0 ? undefined : session.events[index - 1]!.eventSha256
    )
    assert.equal(
      event.eventSha256,
      semanticHashV1('semantic-event', event.projection)
    )
  }
  assert.equal(session.reports.length, 7)
  for (const [index, report] of session.reports.entries())
  {
    assert.equal(report.reportSequence, index)
    assert.equal(
      report.semanticProjectionSha256,
      semanticHashV1('semantic-report-projection', report.semanticProjection)
    )
  }
  const reportEntries = (
    await store.listImmutable(`${sessionPrefix}/reports`)
  ).filter((entry) => entry.key.endsWith('/report.json'))
  assert.equal(reportEntries.length, 11)
  for (const entry of reportEntries)
  {
    const bytes = await store.readImmutable(entry.key)
    const report = JSON.parse(new TextDecoder().decode(bytes)) as {
      semanticProjection: unknown
      semanticProjectionSha256: string
    }
    assert.equal(entry.sha256, sha256Hex(bytes))
    assert.ok(entry.key.includes(entry.sha256))
    assert.equal(
      report.semanticProjectionSha256,
      semanticHashV1('semantic-report-projection', report.semanticProjection)
    )
  }

  const reopenedAdapter = createEditArtifactStoreHostAdapter(root, {
    mode: 'read-only',
    expectedStoreId: capability.storeId,
    expectedOwnershipSha256: capability.ownershipSha256,
  })
  const reopenedStore = reverseListingStore(reopenedAdapter)
  const reversedEntries = await reopenedStore.listImmutable(sessionPrefix)
  for (const entry of reversedEntries)
    assert.equal(
      sha256Hex(await reopenedStore.readImmutable(entry.key)),
      entry.sha256
    )
  const restartedRegistry = createEditSessionRegistryForExecutorV1(
    {
      artifactStore: reopenedStore,
      changeContracts: contracts,
      identity,
      clock: deterministicClock(1_753_056_900_000),
      entropy: deterministicEntropy(197),
      handleSecret: new Uint8Array(32).fill(0xc7),
    },
    new KernelTestTransactionExecutorV1()
  )
  assert.deepEqual(restartedRegistry.sessions(), [])
  const replay = await verifyEditSessionReplayV1({
    artifactStore: reopenedStore,
    sessionKey: session.manifest.sessionKey,
    boundChangeContract: bound,
    transactionExecutor: new KernelTestTransactionExecutorV1(),
  })
  assert.deepEqual(replay.failures, [])
  assert.equal(replay.ok, true)
  assert.equal(replay.state, 'closed-unexported')
  assert.equal(replay.sessionId, session.sessionId)
  assert.equal(replay.verifiedRevisionCount, 5)
  assert.equal(replay.verifiedEventCount, 14)
  assert.equal(replay.verifiedReportCount, 11)
  assert.deepEqual(replay.finalHead, session.head)
  assert.equal(replay.semanticReportSha256, session.status().reportSha256)
})

test('Group C target scope selection refuses overlapping scopes independent of order', async () =>
{
  const fixture = await buildFixtureSb3()
  const source = await ProjectIR.fromSb3(fixture.sb3)
  const sprite = source.json.targets[1]
  if (!sprite || sprite.isStage || typeof sprite.x !== 'number')
    assert.fail('fixture sprite position is absent')
  sprite.variables.obsoleteVariable = ['obsolete', 0]
  sprite.comments ??= {}
  sprite.comments.scopeFixtureComment = {
    blockId: 'hat1',
    x: 24,
    y: 36,
    width: 180,
    height: 90,
    minimized: false,
    text: 'scope fixture',
  }
  const hat = sprite.blocks.hat1
  if (!hat || Array.isArray(hat)) assert.fail('fixture hat is absent')
  hat.comment = 'scopeFixtureComment'
  const sourceBytes = await source.toSb3()
  const sourceArtifactSha256 = sha256Hex(sourceBytes)
  const requiredChange = await requiredTargetChangeEvidence({
    sourceProject: source,
    sourceBytes,
    nextX: sprite.x + 1,
  })
  const { bound } = registeredContract(
    sourceArtifactSha256,
    source,
    requiredChange
  )
  const contractInput = structuredClone(bound.registration.semanticContract)
  const parsedContract = parseSemanticChangeContractV1({
    ...contractInput,
    allowedSemanticScopes: [
      ...contractInput.allowedSemanticScopes,
      {
        scopeSubjectKind: 'entity',
        operationKind: 'target.setSpriteProperties',
        entityKind: 'target',
        entitySubtype: 'sprite',
        locationScope: {
          scopeKind: 'projectEntityCollection',
          collection: 'targets',
        },
        allowedPropertyPaths: [{ surface: 'target', property: 'x' }],
      },
    ],
  })
  assert.equal(
    parsedContract.ok,
    true,
    parsedContract.ok ? undefined : JSON.stringify(parsedContract.issues)
  )
  if (!parsedContract.ok) assert.fail('overlapping scope contract is invalid')
  const inspected = await inspectSemanticEditArtifact(sourceBytes)
  assert.ok(inspected.ok && inspected.semanticSourceSha256)
  const activeLineage = buildSourceLineageV1(
    source,
    inspected.semanticSourceSha256
  ).active
  const selected = targetEntityEvidenceSetV1(source.json).find(
    (entry) => entry.targetIndex === 1
  )
  assert.ok(selected && selected.targetKind === 'sprite')
  const operation: TargetOperationV1 = {
    kind: 'target.setSpriteProperties',
    opId: 'reject-ambiguous-target-scope',
    target: {
      entityKind: 'target',
      refKind: 'structural',
      selectorKind: 'exactLocation',
      location: targetBoundedLocationProjectionV1(
        selected,
        `target-location-${selected.semanticLocationSha256.slice(0, 32)}`
      ),
      expectedFullLocationSha256: selected.semanticLocationSha256,
      expectedSemanticFingerprint: selected.semanticFingerprintSha256,
      expectedContextFingerprint: selected.contextFingerprintSha256,
    },
    edits: [
      {
        property: 'x',
        expected: { state: 'value', value: sprite.x },
        value: sprite.x + 1,
      },
    ],
    expectedPlanningFactSetSha256: HASH_A,
  }
  const dispatcher = new TargetProductionOperationDispatcherV1()
  for (const contract of [
    parsedContract.value,
    {
      ...parsedContract.value,
      allowedSemanticScopes: Object.freeze(
        [...parsedContract.value.allowedSemanticScopes].reverse()
      ),
    },
  ])
  {
    const candidate = await ProjectIR.fromSb3(sourceBytes)
    const before = JSON.stringify(candidate.json)
    assert.throws(
      () =>
        dispatcher.execute(
          {
            input: {
              resourceLimits: {
                activeMatchCandidates:
                  bound.effectiveLimits.activeMatchCandidateLimit,
                describedBlockNodes: bound.effectiveLimits.intentBudgetLimit,
                touchedBlockRecords: bound.effectiveLimits.impactBudgetLimit,
                touchedTargets:
                  DEFAULT_PHASE_8_RESOURCE_POLICY.targetsTouchedPerBatch,
                touchedScripts:
                  DEFAULT_PHASE_8_RESOURCE_POLICY.scriptsTouchedPerBatch,
                touchedDeclarations:
                  DEFAULT_PHASE_8_RESOURCE_POLICY.declarationsTouchedPerBatch,
                touchedComments:
                  DEFAULT_PHASE_8_RESOURCE_POLICY.commentsTouchedPerBatch,
                touchedMedia:
                  DEFAULT_PHASE_8_RESOURCE_POLICY.mediaTouchedPerBatch,
              },
            } as EditTransactionInputV1,
            source,
            preBatch: source,
            candidate,
            contract,
            operationResultsById: new Map(),
            preBatchLineage: activeLineage,
            activeLineage,
            futureBindingLedger: emptyFutureBindingLedgerV1(
              semanticHashV1('change-contract', contract)
            ),
          },
          operation
        ),
      (error: unknown) =>
        error instanceof Error &&
        'code' in error &&
        error.code === 'edit.unauthorized_change' &&
        error.message.includes('found 2')
    )
    assert.equal(JSON.stringify(candidate.json), before)
  }
})

test('Group C production session refuses an admitted hidden block name channel', async (t) =>
{
  const root = tempRoot(t)
  const fixture = await buildFixtureSb3()
  const sourceProject = await ProjectIR.fromSb3(fixture.sb3)
  const sprite = sourceProject.json.targets[1]
  if (!sprite || sprite.isStage || typeof sprite.x !== 'number')
    assert.fail('fixture sprite position is absent')
  sprite.variables.obsoleteVariable = ['obsolete', 0]
  sprite.comments ??= {}
  sprite.comments.hiddenChannelComment = {
    blockId: 'hat1',
    x: 24,
    y: 36,
    width: 180,
    height: 90,
    minimized: false,
    text: 'hidden channel fixture',
  }
  const hat = sprite.blocks.hat1
  if (!hat || Array.isArray(hat)) assert.fail('fixture hat is absent')
  hat.comment = 'hiddenChannelComment'
  const topologyPeer = structuredClone(sprite)
  topologyPeer.name = 'Hidden Channel Peer'
  topologyPeer.x = sprite.x - 120
  topologyPeer.layerOrder =
    Math.max(
      ...sourceProject.json.targets.map((target) => target.layerOrder ?? 0)
    ) + 1
  topologyPeer.variables = {}
  topologyPeer.lists = {}
  topologyPeer.broadcasts = {}
  topologyPeer.blocks = {}
  topologyPeer.comments = {}
  sourceProject.json.targets.push(topologyPeer)
  const coverageBytes = await sourceProject.toSb3()
  const coverageProject = await ProjectIR.fromSb3(coverageBytes)
  Object.defineProperty(hat, 'linkedTarget', {
    configurable: true,
    enumerable: true,
    value: sprite.name,
    writable: true,
  })
  const sourceBytes = await sourceProject.toSb3()
  const sourceArtifactSha256 = sha256Hex(sourceBytes)
  const sourcePreflight = await inspectSemanticEditArtifact(sourceBytes)
  assert.equal(sourcePreflight.ok, true, JSON.stringify(sourcePreflight))
  const requiredTargetChange = await requiredTargetChangeEvidence({
    sourceProject: coverageProject,
    sourceBytes: coverageBytes,
    nextX: sprite.x + 1,
    includeGroupCTargetCoverage: true,
  })
  const { registry: contracts, bound } = registeredContract(
    sourceArtifactSha256,
    sourceProject,
    requiredTargetChange
  )
  const store = createEditArtifactStoreHostAdapter(root)
  const sessions = createEditSessionRegistryForExecutorV1(
    {
      artifactStore: store,
      changeContracts: contracts,
      identity: {
        realmSha256: HASH_A,
        profileSha256: HASH_B,
        pinnedScratchRuntimeSourceSha256: HASH_C,
        retentionPolicySha256: HASH_D,
        policyConfigVersion: 1,
      },
      clock: deterministicClock(1_753_055_900_000),
      entropy: deterministicEntropy(91),
      handleSecret: new Uint8Array(32).fill(0x5a),
    },
    new ProductionTransactionExecutorV1([
      new TargetProductionOperationDispatcherV1(),
    ])
  )
  const projectSessionId = 'phase-8-hidden-block-channel'
  const begun = await sessions.begin(
    {
      schemaVersion: 1,
      requestId: 'begin-hidden-block-channel',
      baseline: {
        kind: 'projectSession',
        projectSessionId,
        expectedSourceArtifactSha256: sourceArtifactSha256,
      },
      changeContractRegistrationId: bound.registration.registrationId,
      expectedSemanticContractSha256: bound.registration.semanticContractSha256,
    },
    {
      bytes: sourceBytes,
      displayName: 'phase-8-hidden-block-channel.sb3',
      expectedArtifactSha256: sourceArtifactSha256,
      provenance: {
        kind: 'projectSession',
        projectSessionId,
        selectedDisplayName: 'phase-8-hidden-block-channel.sb3',
        canonicalRealpath: '/virtual/phase-8-hidden-block-channel.sb3',
        device: 'test-device',
        inode: 'hidden-block-channel-inode',
        byteLength: sourceBytes.byteLength,
        modifiedAtNanoseconds: '1753055900000000000',
        sourceInspectionPolicySha256: HASH_A,
        diagnosticPolicySha256: HASH_B,
        runtimePolicySha256: HASH_C,
        provenanceRegistrationSha256: HASH_D,
      },
      recheck: async () => ({
        ok: true,
        observedArtifactSha256: sourceArtifactSha256,
      }),
    },
    invocation(1)
  )
  const session = sessions.session(begun.sessionId)
  const inspection = await session.inspect({ issueHandles: true })
  const targetItem = inspection.items.find(
    (item) => item.entityKind === 'target' && item.serializedTargetOrdinal === 1
  )
  assert.ok(targetItem && targetItem.entityKind === 'target')
  const planner = await ProductionBatchPlannerV1.create({
    source: sourceProject,
    sourceBytes,
    session,
    store,
    contract: bound,
    inspection,
  })
  const targetIndex = targetItem.serializedTargetOrdinal
  const index = buildSemanticReferenceIndex(planner.candidate)
  const inbound = targetInboundReferenceSetV1(
    planner.candidate,
    index,
    targetIndex
  )
  const activation = targetProspectiveNameActivationV1(
    planner.candidate,
    index,
    requiredTargetChange.targetCoverage!.renamedSprite
  )
  const before = JSON.stringify(planner.candidate.json)
  const planned = planner.plan({
    kind: 'target.renameSprite',
    opId: 'reject-hidden-block-channel',
    target: handleRef(targetItem, 'target'),
    expectedName: targetExpectedStringIdentityV1(sprite.name),
    newName: requiredTargetChange.targetCoverage!.renamedSprite,
    expectedInboundReferenceSetSha256: inbound.referenceSetSha256,
    newNameActivation: {
      expectedActivationSetSha256: activation.activationSetSha256,
      requireProspectiveActivationCount: 0,
    },
  })
  await assertEditRefusal(
    () =>
      session.preview(
        {
          requestId: 'preview-hidden-block-channel',
          expectedHead: session.head,
          canonicalTransaction: {
            ...planner.batch(),
            operations: [planned],
          },
        },
        invocation(2)
      ),
    'edit.unsupported_opcode'
  )
  assert.equal(JSON.stringify(planner.candidate.json), before)
  assert.equal(session.head.revisionNumber, 0)
})

test('Group C production apply and replay preserve an empty Stage-owned monitor', async (t) =>
{
  const root = tempRoot(t)
  const fixture = await buildFixtureSb3()
  const sourceProject = await ProjectIR.fromSb3(fixture.sb3)
  const sprite = sourceProject.json.targets[1]
  if (!sprite || sprite.isStage || typeof sprite.x !== 'number')
    assert.fail('fixture sprite position is absent')
  sprite.name = ''
  sprite.variables.obsoleteVariable = ['obsolete', 0]
  sprite.blocks.obsoleteReporter = [12, 'obsolete', 'obsoleteVariable', 480, 0]
  sprite.comments ??= {}
  sprite.comments.emptyOwnerComment = {
    blockId: 'hat1',
    x: 24,
    y: 36,
    width: 180,
    height: 90,
    minimized: false,
    text: 'empty monitor ownership fixture',
  }
  const hat = sprite.blocks.hat1
  if (!hat || Array.isArray(hat)) assert.fail('fixture hat is absent')
  hat.comment = 'emptyOwnerComment'
  const topologyPeer = structuredClone(sprite)
  topologyPeer.name = 'Empty Monitor Peer'
  topologyPeer.x = sprite.x - 120
  topologyPeer.layerOrder =
    Math.max(
      ...sourceProject.json.targets.map((target) => target.layerOrder ?? 0)
    ) + 1
  topologyPeer.variables = {}
  topologyPeer.lists = {}
  topologyPeer.broadcasts = {}
  topologyPeer.blocks = {}
  topologyPeer.comments = {}
  sourceProject.json.targets.push(topologyPeer)
  sourceProject.json.monitors = [
    {
      id: 'empty-owner-monitor',
      mode: 'default',
      opcode: 'motion_xposition',
      params: {},
      spriteName: '',
      value: sprite.x,
    },
  ]
  const sourceBytes = await sourceProject.toSb3()
  const sourceArtifactSha256 = sha256Hex(sourceBytes)
  const sourcePreflight = await inspectSemanticEditArtifact(sourceBytes)
  assert.equal(sourcePreflight.ok, true, JSON.stringify(sourcePreflight))
  const requiredTargetChange = await requiredTargetChangeEvidence({
    sourceProject,
    sourceBytes,
    nextX: sprite.x + 1,
    includeGroupCTargetCoverage: true,
  })
  const { registry: contracts, bound } = registeredContract(
    sourceArtifactSha256,
    sourceProject,
    requiredTargetChange
  )
  const store = createEditArtifactStoreHostAdapter(root)
  const dispatchers = [new TargetProductionOperationDispatcherV1()]
  const sessions = createEditSessionRegistryForExecutorV1(
    {
      artifactStore: store,
      changeContracts: contracts,
      identity: {
        realmSha256: HASH_A,
        profileSha256: HASH_B,
        pinnedScratchRuntimeSourceSha256: HASH_C,
        retentionPolicySha256: HASH_D,
        policyConfigVersion: 1,
      },
      clock: deterministicClock(1_753_055_950_000),
      entropy: deterministicEntropy(101),
      handleSecret: new Uint8Array(32).fill(0x6b),
    },
    new ProductionTransactionExecutorV1(dispatchers)
  )
  const projectSessionId = 'phase-8-empty-monitor-owner'
  const begun = await sessions.begin(
    {
      schemaVersion: 1,
      requestId: 'begin-empty-monitor-owner',
      baseline: {
        kind: 'projectSession',
        projectSessionId,
        expectedSourceArtifactSha256: sourceArtifactSha256,
      },
      changeContractRegistrationId: bound.registration.registrationId,
      expectedSemanticContractSha256: bound.registration.semanticContractSha256,
    },
    {
      bytes: sourceBytes,
      displayName: 'phase-8-empty-monitor-owner.sb3',
      expectedArtifactSha256: sourceArtifactSha256,
      provenance: {
        kind: 'projectSession',
        projectSessionId,
        selectedDisplayName: 'phase-8-empty-monitor-owner.sb3',
        canonicalRealpath: '/virtual/phase-8-empty-monitor-owner.sb3',
        device: 'test-device',
        inode: 'empty-monitor-owner-inode',
        byteLength: sourceBytes.byteLength,
        modifiedAtNanoseconds: '1753055950000000000',
        sourceInspectionPolicySha256: HASH_A,
        diagnosticPolicySha256: HASH_B,
        runtimePolicySha256: HASH_C,
        provenanceRegistrationSha256: HASH_D,
      },
      recheck: async () => ({
        ok: true,
        observedArtifactSha256: sourceArtifactSha256,
      }),
    },
    invocation(1)
  )
  const session = sessions.session(begun.sessionId)
  const inspection = await session.inspect({ issueHandles: true })
  const targetItem = inspection.items.find(
    (item) => item.entityKind === 'target' && item.serializedTargetOrdinal === 1
  )
  assert.ok(targetItem && targetItem.entityKind === 'target')
  const planner = await ProductionBatchPlannerV1.create({
    source: sourceProject,
    sourceBytes,
    session,
    store,
    contract: bound,
    inspection,
  })
  const targetIndex = targetItem.serializedTargetOrdinal
  const sourceIndex = buildSemanticReferenceIndex(planner.candidate)
  assert.equal(sourceIndex.monitors[0]?.targetStatus, 'unique')
  assert.equal(sourceIndex.monitors[0]?.target?.targetIndex, 0)
  const inbound = targetInboundReferenceSetV1(
    planner.candidate,
    sourceIndex,
    targetIndex
  )
  assert.equal(
    inbound.references.some((reference) => reference.kind === 'monitor-target'),
    false
  )
  planner.add({
    kind: 'target.setSpriteProperties',
    opId: 'move-empty-name-sprite-x',
    target: handleRef(targetItem, 'target'),
    edits: [
      {
        property: 'x',
        expected: { state: 'value', value: sprite.x },
        value: sprite.x + 1,
      },
    ],
  })
  const renameIndex = buildSemanticReferenceIndex(planner.candidate)
  const renameInbound = targetInboundReferenceSetV1(
    planner.candidate,
    renameIndex,
    targetIndex
  )
  assert.equal(
    renameInbound.references.some(
      (reference) => reference.kind === 'monitor-target'
    ),
    false
  )
  const activation = targetProspectiveNameActivationV1(
    planner.candidate,
    renameIndex,
    requiredTargetChange.targetCoverage!.renamedSprite
  )
  planner.add({
    kind: 'target.renameSprite',
    opId: 'rename-empty-name-sprite',
    target: handleRef(targetItem, 'target'),
    expectedName: targetExpectedStringIdentityV1(''),
    newName: requiredTargetChange.targetCoverage!.renamedSprite,
    expectedInboundReferenceSetSha256: renameInbound.referenceSetSha256,
    newNameActivation: {
      expectedActivationSetSha256: activation.activationSetSha256,
      requireProspectiveActivationCount: 0,
    },
  })
  assert.equal(planner.candidate.json.monitors?.[0]?.spriteName, '')
  const preview = await session.preview(
    {
      requestId: 'preview-empty-monitor-owner',
      expectedHead: session.head,
      canonicalTransaction: planner.batch(),
    },
    invocation(2)
  )
  const apply = await session.apply(
    {
      schemaVersion: 1,
      sessionId: session.sessionId,
      requestId: 'apply-empty-monitor-owner',
      ...expectedHeadRequest(preview.preview.expectedHead),
      previewId: preview.preview.previewId,
      applyGuardSha256: preview.preview.applyGuardSha256,
      expectedResolvedPlanSha256: preview.preview.resolvedPlanSha256,
    },
    invocation(3)
  )
  assert.equal(
    apply.head.candidateSha256,
    preview.preview.predictedCandidateSha256
  )
  const accepted = session.revisions.at(-1)!
  const candidate = await ProjectIR.fromSb3(
    await store.readImmutable(accepted.candidateKey)
  )
  const candidateSprite = candidate.json.targets[targetIndex]
  assert.ok(candidateSprite && !candidateSprite.isStage)
  assert.equal(candidateSprite.name, GROUP_C_RENAMED_SPRITE)
  assert.equal(candidateSprite.x, sprite.x + 1)
  assert.equal(candidate.json.monitors?.[0]?.spriteName, '')
  await session.close(
    {
      schemaVersion: 1,
      sessionId: session.sessionId,
      requestId: 'close-empty-monitor-owner',
      reason: 'empty Stage-owned monitor preservation is replay-verified',
      ...expectedHeadRequest(session.head),
    },
    invocation(4)
  )
  const replay = await verifyEditSessionReplayV1({
    artifactStore: store,
    sessionKey: session.manifest.sessionKey,
    boundChangeContract: bound,
    transactionExecutor: new ProductionTransactionExecutorV1(dispatchers),
  })
  assert.deepEqual(replay.failures, [])
  assert.equal(replay.ok, true)
  assert.equal(replay.verifiedRevisionCount, session.revisions.length)
  assert.deepEqual(replay.finalHead, session.head)
})

test('Group C production lifecycle applies, restores, and exactly replays every admitted family', async (t) =>
{
  const root = tempRoot(t)
  const fixture = await buildFixtureSb3()
  const sourceProject = await ProjectIR.fromSb3(fixture.sb3)
  const sprite = sourceProject.json.targets[1]
  if (!sprite || sprite.isStage) assert.fail('fixture sprite is absent')
  if (typeof sprite.x !== 'number' || typeof sprite.y !== 'number')
    assert.fail('fixture sprite position is absent')
  sprite.variables.obsoleteVariable = ['obsolete', 0]
  sprite.comments ??= {}
  sprite.comments.inspectComment = {
    blockId: 'hat1',
    x: 24,
    y: 36,
    width: 180,
    height: 90,
    minimized: false,
    text: 'inspection evidence',
  }
  const hat = sprite.blocks.hat1
  if (!hat || Array.isArray(hat)) assert.fail('fixture hat is absent')
  hat.comment = 'inspectComment'
  const topologyPeer = structuredClone(sprite)
  topologyPeer.name = 'Topology Peer'
  topologyPeer.x = sprite.x - 120
  topologyPeer.layerOrder =
    Math.max(
      ...sourceProject.json.targets.map((target) => target.layerOrder ?? 0)
    ) + 1
  topologyPeer.variables = {}
  topologyPeer.lists = {}
  topologyPeer.broadcasts = {}
  topologyPeer.comments = {}
  topologyPeer.blocks = {
    topologyPeerHat: {
      opcode: 'event_whenflagclicked',
      next: null,
      parent: null,
      inputs: {},
      fields: {},
      shadow: false,
      topLevel: true,
      x: 44,
      y: 55,
    },
    groupCTargetSource: {
      opcode: 'motion_goto',
      next: null,
      parent: null,
      inputs: { TO: [1, 'groupCTargetMenu'] },
      fields: {},
      shadow: false,
      topLevel: true,
      x: 144,
      y: 55,
    },
    groupCTargetMenu: {
      opcode: 'motion_goto_menu',
      next: null,
      parent: 'groupCTargetSource',
      inputs: {},
      fields: { TO: [sprite.name, null] },
      shadow: true,
      topLevel: false,
    },
    groupCTargetSourceOneSlot: {
      opcode: 'motion_goto',
      next: null,
      parent: null,
      inputs: { TO: [1, 'groupCTargetMenuOneSlot'] },
      fields: {},
      shadow: false,
      topLevel: true,
      x: 244,
      y: 55,
    },
    groupCTargetMenuOneSlot: {
      opcode: 'motion_goto_menu',
      next: null,
      parent: 'groupCTargetSourceOneSlot',
      inputs: {},
      fields: { TO: [sprite.name] },
      shadow: true,
      topLevel: false,
    },
    groupCEventTargetSource: {
      opcode: 'event_whentouchingobject',
      next: null,
      parent: null,
      inputs: {
        TOUCHINGOBJECTMENU: [1, 'groupCEventTargetMenu'],
      },
      fields: {},
      shadow: false,
      topLevel: true,
      x: 344,
      y: 55,
    },
    groupCEventTargetMenu: {
      opcode: 'event_touchingobjectmenu',
      next: null,
      parent: 'groupCEventTargetSource',
      inputs: {},
      fields: { TOUCHINGOBJECTMENU: [sprite.name, null] },
      shadow: true,
      topLevel: false,
    },
  }
  sourceProject.json.targets.push(topologyPeer)
  sprite.blocks.scoreReporter = [12, 'score', 'scoreVarId', 244, 55]
  sourceProject.json.monitors ??= []
  sourceProject.json.monitors.push({
    id: 'group-c-renamed-sprite-monitor',
    mode: 'default',
    opcode: 'motion_xposition',
    params: {},
    spriteName: sprite.name,
    value: 0,
  })
  sourceProject.json.monitors.push({
    id: 'scoreVarId',
    mode: 'default',
    opcode: 'data_variable',
    params: { VARIABLE: 'score' },
    spriteName: sprite.name,
    value: 0,
  })
  const sourceBytes = await sourceProject.toSb3()
  const sourceArtifactSha256 = sha256Hex(sourceBytes)
  const nextX = sprite.x + 47
  const requiredTargetChange = await requiredTargetChangeEvidence({
    sourceProject,
    sourceBytes,
    nextX,
    includeGroupCTargetCoverage: true,
  })
  const { registry: contracts, bound } = registeredContract(
    sourceArtifactSha256,
    sourceProject,
    requiredTargetChange
  )
  const store = createEditArtifactStoreHostAdapter(root)
  const dispatchers: readonly ProductionOperationDispatcherV1[] = [
    new TargetProductionOperationDispatcherV1(),
    new DeclarationProductionOperationDispatcherV1(),
    new CommentProductionOperationDispatcherV1(),
    new ScriptWorkspaceProductionOperationDispatcherV1(),
  ]
  const sessions = createEditSessionRegistryForExecutorV1(
    {
      artifactStore: store,
      changeContracts: contracts,
      identity: {
        realmSha256: HASH_A,
        profileSha256: HASH_B,
        pinnedScratchRuntimeSourceSha256: HASH_C,
        retentionPolicySha256: HASH_D,
        policyConfigVersion: 1,
      },
      clock: deterministicClock(1_753_056_000_000),
      entropy: deterministicEntropy(101),
      handleSecret: new Uint8Array(32).fill(0x61),
    },
    new ProductionTransactionExecutorV1(dispatchers)
  )
  const projectSessionId = 'phase-8-group-c-production'
  const begun = await sessions.begin(
    {
      schemaVersion: 1,
      requestId: 'begin-group-c-production',
      baseline: {
        kind: 'projectSession',
        projectSessionId,
        expectedSourceArtifactSha256: sourceArtifactSha256,
      },
      changeContractRegistrationId: bound.registration.registrationId,
      expectedSemanticContractSha256: bound.registration.semanticContractSha256,
    },
    {
      bytes: sourceBytes,
      displayName: 'phase-8-group-c-production.sb3',
      expectedArtifactSha256: sourceArtifactSha256,
      provenance: {
        kind: 'projectSession',
        projectSessionId,
        selectedDisplayName: 'phase-8-group-c-production.sb3',
        canonicalRealpath: '/virtual/phase-8-group-c-production.sb3',
        device: 'test-device',
        inode: 'group-c-production-inode',
        byteLength: sourceBytes.byteLength,
        modifiedAtNanoseconds: '1753056000000000000',
        sourceInspectionPolicySha256: HASH_A,
        diagnosticPolicySha256: HASH_B,
        runtimePolicySha256: HASH_C,
        provenanceRegistrationSha256: HASH_D,
      },
      recheck: async () => ({
        ok: true,
        observedArtifactSha256: sourceArtifactSha256,
      }),
    },
    invocation(1)
  )
  const session = sessions.session(begun.sessionId)
  const inspection = await session.inspect({ issueHandles: true })
  const spriteItem = inspection.items.find(
    (item) => item.entityKind === 'target' && item.entitySubtype === 'sprite'
  )
  const sourceCommentItem = inspection.items.find(
    (item) => item.entityKind === 'comment'
  )
  const initialStageItem = inspection.items.find(
    (item) => item.entityKind === 'target' && item.entitySubtype === 'stage'
  )
  const initialStage = sourceProject.json.targets[0]
  assert.ok(
    spriteItem &&
      sourceCommentItem &&
      initialStageItem &&
      initialStage?.isStage &&
      typeof initialStage.tempo === 'number'
  )
  const initialStagePlanner = await ProductionBatchPlannerV1.create({
    source: sourceProject,
    sourceBytes,
    session,
    store,
    contract: bound,
    inspection,
  })
  initialStagePlanner.add({
    kind: 'target.setStageProperties',
    opId: 'establish-pending-required-state',
    target: handleRef(initialStageItem, 'target'),
    edits: [
      {
        property: 'tempo',
        expected: { state: 'value', value: initialStage.tempo },
        value: initialStage.tempo + 1,
      },
    ],
  })
  const initialStagePreview = await session.preview(
    {
      requestId: 'preview-group-c-required-pending',
      expectedHead: session.head,
      canonicalTransaction: initialStagePlanner.batch(),
    },
    invocation(2)
  )
  const initialStageApply = await session.apply(
    {
      schemaVersion: 1,
      sessionId: session.sessionId,
      requestId: 'apply-group-c-required-pending',
      ...expectedHeadRequest(initialStagePreview.preview.expectedHead),
      previewId: initialStagePreview.preview.previewId,
      applyGuardSha256: initialStagePreview.preview.applyGuardSha256,
      expectedResolvedPlanSha256:
        initialStagePreview.preview.resolvedPlanSha256,
    },
    invocation(3)
  )
  assert.equal(initialStageApply.head.revisionNumber, 1)
  const pendingAuthorization = session.revisions[1]!.authorization as {
    contractAuthorization: {
      pendingObjectiveIds: readonly string[]
      satisfiedObjectiveIds: readonly string[]
    }
  }
  assert.deepEqual(
    pendingAuthorization.contractAuthorization.pendingObjectiveIds,
    ['required-target-delta']
  )
  assert.deepEqual(
    pendingAuthorization.contractAuthorization.satisfiedObjectiveIds,
    []
  )

  const targetInspection = await session.inspect({ issueHandles: true })
  const currentTargetItem = targetInspection.items.find(
    (item) => item.entityKind === 'target' && item.serializedTargetOrdinal === 1
  )
  const currentStageItem = targetInspection.items.find(
    (item) => item.entityKind === 'target' && item.entitySubtype === 'stage'
  )
  const referencedScoreItem = targetInspection.items.find(
    (item) =>
      item.entityKind === 'declaration' &&
      item.entitySubtype === 'variable' &&
      'name' in item.location &&
      item.location.name.displayKind === 'inline' &&
      item.location.name.value === 'score'
  )
  if (
    !currentTargetItem ||
    currentTargetItem.entityKind !== 'target' ||
    !currentStageItem ||
    currentStageItem.entityKind !== 'target' ||
    !referencedScoreItem
  )
    assert.fail('target coverage inspection is incomplete')
  const targetCoverage = requiredTargetChange.targetCoverage
  assert.ok(targetCoverage)
  const planner = await ProductionBatchPlannerV1.create({
    source: sourceProject,
    sourceBytes,
    session,
    store,
    contract: bound,
    inspection: targetInspection,
  })
  planner.add({
    kind: 'target.setSpriteProperties',
    opId: 'move-sprite-x',
    target: handleRef(currentTargetItem, 'target'),
    edits: [
      {
        property: 'x',
        expected: { state: 'value', value: sprite.x },
        value: nextX,
      },
    ],
  })
  const targetIndex = currentTargetItem.serializedTargetOrdinal
  const targetInbound = targetInboundReferenceSetV1(
    planner.candidate,
    buildSemanticReferenceIndex(planner.candidate),
    targetIndex
  )
  const targetNameActivation = targetProspectiveNameActivationV1(
    planner.candidate,
    buildSemanticReferenceIndex(planner.candidate),
    targetCoverage.renamedSprite
  )
  planner.add({
    kind: 'target.renameSprite',
    opId: 'rename-group-c-sprite',
    target: handleRef(currentTargetItem, 'target'),
    expectedName: targetExpectedStringIdentityV1(
      planner.candidate.json.targets[targetIndex]!.name
    ),
    newName: targetCoverage.renamedSprite,
    expectedInboundReferenceSetSha256: targetInbound.referenceSetSha256,
    newNameActivation: {
      expectedActivationSetSha256: targetNameActivation.activationSetSha256,
      requireProspectiveActivationCount: 0,
    },
  })
  const targetInboundAfterRename = targetInboundReferenceSetV1(
    planner.candidate,
    buildSemanticReferenceIndex(planner.candidate),
    targetIndex
  )
  const targetOrder = targetDualOrderSnapshotV1(
    planner.candidate.json,
    session.revisions.at(-1)!
      .activeLineage as ProductionOperationContextV1['activeLineage']
  )
  const renamedTarget = planner.candidate.json.targets[targetIndex]
  if (
    !renamedTarget ||
    renamedTarget.isStage ||
    typeof renamedTarget.layerOrder !== 'number'
  )
    assert.fail('renamed target is not a layered sprite')
  planner.add({
    kind: 'target.reorderSprite',
    opId: 'reorder-group-c-sprite',
    target: handleRef(currentTargetItem, 'target'),
    expectedVisualLayerOrdinal: renamedTarget.layerOrder,
    newVisualLayerOrdinal: targetCoverage.newVisualLayerOrdinal,
    expectedVisualLayerOrderSha256: targetOrder.visualLayerOrderSha256,
  })
  const planningTargetStage = planner.candidate.json.targets.find(
    (target) => target.isStage
  )
  if (
    !planningTargetStage ||
    !planningTargetStage.isStage ||
    typeof planningTargetStage.tempo !== 'number'
  )
    assert.fail('planning stage tempo is absent')
  const nextTempo = planningTargetStage.tempo + 12
  planner.add({
    kind: 'target.setStageProperties',
    opId: 'set-group-c-stage-tempo',
    target: handleRef(currentStageItem, 'target'),
    edits: [
      {
        property: 'tempo',
        expected: { state: 'value', value: planningTargetStage.tempo },
        value: nextTempo,
      },
    ],
  })
  const referencedScoreEvidence = declarationEntityEvidenceSetV1(
    planner.candidate
  ).find(
    (entry) =>
      entry.declarationKind === 'variable' && entry.rawRef.name === 'score'
  )
  assert.ok(referencedScoreEvidence)
  const referencedScoreReferences = declarationReferenceEvidenceV1(
    planner.candidate,
    referencedScoreEvidence.rawRef
  )
  assert.deepEqual(
    {
      referenceCount: referencedScoreReferences.referenceCount,
      propagatableReferenceCount:
        referencedScoreReferences.propagatableReferenceCount,
      monitorCount: referencedScoreReferences.monitorCount,
      hasDynamicReference: referencedScoreReferences.hasDynamicReference,
    },
    {
      referenceCount: 3,
      propagatableReferenceCount: 3,
      monitorCount: 1,
      hasDynamicReference: false,
    }
  )
  const referencedScoreActivation = declarationNameActivationEvidenceV1(
    planner.candidate,
    'variable',
    referencedScoreEvidence.rawRef.declarationTarget,
    GROUP_C_RENAMED_REFERENCED_VARIABLE,
    referencedScoreEvidence.rawRef
  )
  planner.add({
    kind: 'declaration.rename',
    opId: 'rename-referenced-score',
    declaration: handleRef(referencedScoreItem, 'declaration'),
    expectedName: expectedDeclarationNameIdentityV1(
      referencedScoreEvidence.rawRef
    ),
    expectedReferenceSetSha256:
      referencedScoreReferences.expectedReferenceSetSha256,
    newName: GROUP_C_RENAMED_REFERENCED_VARIABLE,
    newNameActivation: {
      expectedActivationSetSha256:
        referencedScoreActivation.activationSetSha256,
      requireProspectiveActivationCount: 0,
    },
  })
  assert.equal(
    targetInbound.referenceSetSha256,
    targetCoverage.beforeReferenceSetSha256
  )
  assert.equal(
    targetInboundAfterRename.referenceSetSha256,
    targetCoverage.afterReferenceSetSha256
  )
  const preview = await session.preview(
    {
      requestId: 'preview-group-c-target',
      expectedHead: session.head,
      canonicalTransaction: planner.batch(),
    },
    invocation(4)
  )
  assert.equal(preview.preview.operationCount, 5)
  assert.match(preview.preview.resolvedPlanSha256, /^[a-f0-9]{64}$/u)
  const apply = await session.apply(
    {
      schemaVersion: 1,
      sessionId: session.sessionId,
      requestId: 'apply-group-c-target',
      ...expectedHeadRequest(preview.preview.expectedHead),
      previewId: preview.preview.previewId,
      applyGuardSha256: preview.preview.applyGuardSha256,
      expectedResolvedPlanSha256: preview.preview.resolvedPlanSha256,
    },
    invocation(5)
  )
  assert.equal(
    apply.head.candidateSha256,
    preview.preview.predictedCandidateSha256
  )
  assert.deepEqual(apply.operationResults, preview.preview.operationResults)
  const referencedRenameResult = (
    apply.operationResults as readonly {
      opId: string
      selectedLineageIds: readonly string[]
      fixedSlots: readonly unknown[]
      postconditionSha256: string
    }[]
  ).find((result) => result.opId === 'rename-referenced-score')
  assert.ok(referencedRenameResult)
  assert.equal(referencedRenameResult.selectedLineageIds.length, 1)
  assert.deepEqual(referencedRenameResult.fixedSlots, [])
  assert.match(referencedRenameResult.postconditionSha256, /^[a-f0-9]{64}$/u)
  const accepted = session.revisions.at(-1)!
  assert.equal(accepted.head.revisionNumber, 2)
  assert.equal(
    JSON.stringify(accepted.transitionDescriptor).includes(
      currentTargetItem.handle!
    ),
    false
  )
  assert.equal(
    JSON.stringify(accepted.transitionDescriptor).includes(
      '"refKind":"handle"'
    ),
    false
  )
  const candidate = await ProjectIR.fromSb3(
    await store.readImmutable(accepted.candidateKey)
  )
  const candidateSprite = candidate.json.targets[1]
  assert.ok(candidateSprite && !candidateSprite.isStage)
  assert.equal(candidateSprite.x, nextX)
  assert.equal(candidateSprite.name, targetCoverage.renamedSprite)
  assert.equal(candidateSprite.layerOrder, targetCoverage.newVisualLayerOrdinal)
  const renamedMenu = candidate.json.targets[2]?.blocks.groupCTargetMenu
  assert.deepEqual(
    Array.isArray(renamedMenu) ? undefined : renamedMenu?.fields?.TO,
    [targetCoverage.renamedSprite, null]
  )
  const renamedOneSlotMenu =
    candidate.json.targets[2]?.blocks.groupCTargetMenuOneSlot
  assert.deepEqual(
    Array.isArray(renamedOneSlotMenu)
      ? undefined
      : renamedOneSlotMenu?.fields?.TO,
    [targetCoverage.renamedSprite]
  )
  const renamedEventTargetMenu =
    candidate.json.targets[2]?.blocks.groupCEventTargetMenu
  assert.deepEqual(
    Array.isArray(renamedEventTargetMenu)
      ? undefined
      : renamedEventTargetMenu?.fields?.TOUCHINGOBJECTMENU,
    [targetCoverage.renamedSprite, null]
  )
  assert.equal(
    candidate.json.monitors?.find(
      (monitor) => monitor.id === 'group-c-renamed-sprite-monitor'
    )?.spriteName,
    targetCoverage.renamedSprite
  )
  const renamedReferencedVariable = Object.values(
    candidateSprite.variables
  ).find((entry) => entry[0] === GROUP_C_RENAMED_REFERENCED_VARIABLE)
  assert.deepEqual(renamedReferencedVariable, [
    GROUP_C_RENAMED_REFERENCED_VARIABLE,
    0,
  ])
  const renamedScoreField = candidateSprite.blocks.setvar1
  assert.equal(
    Array.isArray(renamedScoreField)
      ? undefined
      : renamedScoreField?.fields?.VARIABLE?.[0],
    GROUP_C_RENAMED_REFERENCED_VARIABLE
  )
  const renamedScoreReporter = candidateSprite.blocks.scoreReporter
  assert.ok(Array.isArray(renamedScoreReporter))
  assert.equal(
    Array.isArray(renamedScoreReporter) ? renamedScoreReporter[1] : undefined,
    GROUP_C_RENAMED_REFERENCED_VARIABLE
  )
  const renamedScoreMonitor = candidate.json.monitors?.find(
    (monitor) => monitor.id === 'scoreVarId'
  )
  assert.equal(
    renamedScoreMonitor?.params.VARIABLE,
    GROUP_C_RENAMED_REFERENCED_VARIABLE
  )
  assert.equal(renamedScoreMonitor?.spriteName, targetCoverage.renamedSprite)
  const candidateStage = candidate.json.targets[0]
  assert.ok(candidateStage?.isStage)
  if (!candidateStage?.isStage) assert.fail('candidate stage is absent')
  assert.equal(candidateStage.tempo, nextTempo)
  const targetAuthorization = accepted.authorization as {
    contractAuthorization: {
      matchedStructuralAllowanceIds: readonly string[]
      operationScopeEvidence: readonly {
        opId: string
        occurrenceId: string
        operationKind: string
        semanticScopeSha256: string
      }[]
    }
  }
  assert.deepEqual(
    [
      ...targetAuthorization.contractAuthorization
        .matchedStructuralAllowanceIds,
    ].sort(),
    [
      'rename-sprite-references',
      'reorder-sprite-visual-layer',
      'rename-referenced-declaration-references',
    ].sort()
  )
  const targetOperationIds = [
    'move-sprite-x',
    'rename-group-c-sprite',
    'reorder-group-c-sprite',
    'set-group-c-stage-tempo',
    'rename-referenced-score',
  ]
  const targetOccurrences =
    targetAuthorization.contractAuthorization.operationScopeEvidence.filter(
      (entry) => targetOperationIds.includes(entry.opId)
    )
  assert.deepEqual(
    targetOccurrences.map((entry) => entry.opId).sort(),
    [...targetOperationIds].sort()
  )
  const targetParentOperationIds = operationIdArrays(
    accepted.parentDelta
  ).flat()
  for (const occurrence of targetOccurrences)
  {
    assert.match(occurrence.occurrenceId, /^[a-f0-9]{64}$/u)
    assert.equal(
      targetParentOperationIds.includes(occurrence.occurrenceId),
      true,
      `${occurrence.opId} is absent from the target parent delta`
    )
  }
  const referencedRenameOccurrence = targetOccurrences.find(
    (occurrence) => occurrence.opId === 'rename-referenced-score'
  )
  assert.ok(referencedRenameOccurrence)
  assert.equal(
    referencedRenameOccurrence.semanticScopeSha256,
    productionContractScopeSha256V1({
      scopeSubjectKind: 'entity',
      operationKind: 'declaration.rename',
      entityKind: 'declaration',
      entitySubtype: 'variable',
      locationScope: {
        scopeKind: 'exactEntity',
        entity: {
          contractRefKind: 'existing',
          entityKind: 'declaration',
          entitySubtype: 'variable',
          bindingKey: 'referenced-declaration-binding',
        },
      },
      allowedPropertyPaths: [{ surface: 'declaration', property: 'name' }],
    })
  )
  const targetParentDelta = accepted.parentDelta as ProjectDelta
  const referencedRenameAttributedPaths = [
    ...targetParentDelta.targets.flatMap((target) => [
      ...target.declarationChanges,
      ...target.blockChanges.flatMap((block) => block.changes),
    ]),
    ...targetParentDelta.projectChanges.map((change) => change.change),
  ]
    .filter((change) =>
      change.operationIds.includes(referencedRenameOccurrence.occurrenceId)
    )
    .map((change) => change.path)
    .sort()
  assert.deepEqual(referencedRenameAttributedPaths, [
    '/monitors/1/params/VARIABLE',
    '/targets/1/blocks/scoreReporter/1',
    '/targets/1/blocks/setvar1/fields/VARIABLE/0',
    '/targets/1/variables/scoreVarId/0',
  ])
  const targetPreservation = accepted.preservation as {
    status: string
    protectedSurfaceResultSha256: string
    preservationLensResultSha256: string
  }
  assert.equal(targetPreservation.status, 'passed')
  assert.match(
    targetPreservation.protectedSurfaceResultSha256,
    /^[a-f0-9]{64}$/u
  )
  assert.match(
    targetPreservation.preservationLensResultSha256,
    /^[a-f0-9]{64}$/u
  )
  assert.equal(
    (
      accepted.authorization as {
        contractAuthorization?: { authorized: boolean }
      }
    ).contractAuthorization?.authorized,
    true
  )
  const satisfiedAuthorization = accepted.authorization as {
    contractAuthorization: {
      pendingObjectiveIds: readonly string[]
      satisfiedObjectiveIds: readonly string[]
    }
  }
  assert.deepEqual(
    satisfiedAuthorization.contractAuthorization.pendingObjectiveIds,
    []
  )
  assert.deepEqual(
    satisfiedAuthorization.contractAuthorization.satisfiedObjectiveIds,
    ['required-target-delta']
  )
  const productionCheckpoint = await session.checkpoint(
    {
      schemaVersion: 1,
      sessionId: session.sessionId,
      requestId: 'checkpoint-group-c-target',
      label: 'target-edit-accepted',
      note: 'stable rollback point before declaration and comment edits',
      ...expectedHeadRequest(session.head),
    },
    invocation(6)
  )

  const declarationInspection = await session.inspect({ issueHandles: true })
  const declarationPlanner = await ProductionBatchPlannerV1.create({
    source: sourceProject,
    sourceBytes,
    session,
    store,
    contract: bound,
    inspection: declarationInspection,
  })
  const standaloneVariablePlanner = await ProductionBatchPlannerV1.create(
    {
      source: sourceProject,
      sourceBytes,
      session,
      store,
      contract: bound,
      inspection: declarationInspection,
    }
  )
  const standaloneVariableTarget = declarationInspection.items.find(
    (item) => item.entityKind === 'target' && item.serializedTargetOrdinal === 1
  )
  assert.ok(standaloneVariableTarget)
  const standaloneVariableActivation = declarationNameActivationEvidenceV1(
    standaloneVariablePlanner.candidate,
    'variable',
    {
      targetIndex: 1,
      name: standaloneVariablePlanner.candidate.json.targets[1]!.name,
      isStage: false,
    },
    'BatchVariable'
  )
  standaloneVariablePlanner.add({
    kind: 'declaration.addVariable',
    opId: 'add-batch-variable',
    scope: handleRef(standaloneVariableTarget, 'target'),
    name: 'BatchVariable',
    cloud: false,
    initialValue: 1,
    nameActivation: {
      expectedActivationSetSha256:
        standaloneVariableActivation.activationSetSha256,
      requireProspectiveActivationCount: 0,
    },
  })
  const headBeforeStandaloneVariableRefusal = structuredClone(session.head)
  await assertEditRefusal(
    () =>
      session.preview(
        {
          requestId: 'reject-standalone-unused-group-c-variable',
          expectedHead: session.head,
          canonicalTransaction: standaloneVariablePlanner.batch(),
        },
        invocation(701)
      ),
    'edit.static_regression'
  )
  assert.deepEqual(session.head, headBeforeStandaloneVariableRefusal)
  const planningStage = declarationPlanner.candidate.json.targets[0]
  const declarationTargetItem = declarationInspection.items.find(
    (item) => item.entityKind === 'target' && item.serializedTargetOrdinal === 1
  )
  const obsoleteDeclarationItem = declarationInspection.items.find(
    (item) =>
      item.entityKind === 'declaration' &&
      item.entitySubtype === 'variable' &&
      'name' in item.location &&
      item.location.name.displayKind === 'inline' &&
      item.location.name.value === 'obsolete'
  )
  assert.ok(
    planningStage?.isStage && declarationTargetItem && obsoleteDeclarationItem
  )
  const variableActivation = declarationNameActivationEvidenceV1(
    declarationPlanner.candidate,
    'variable',
    {
      targetIndex: 1,
      name: declarationPlanner.candidate.json.targets[1]!.name,
      isStage: false,
    },
    'BatchVariable'
  )
  declarationPlanner.add({
    kind: 'declaration.addVariable',
    opId: 'add-batch-variable',
    scope: handleRef(declarationTargetItem, 'target'),
    name: 'BatchVariable',
    cloud: false,
    initialValue: 1,
    nameActivation: {
      expectedActivationSetSha256: variableActivation.activationSetSha256,
      requireProspectiveActivationCount: 0,
    },
  })
  const createdVariableRef = {
    entityKind: 'declaration',
    refKind: 'created',
    opId: 'add-batch-variable',
    slot: { slotKind: 'fixed', name: 'declaration' },
  } as const
  declarationPlanner.add({
    kind: 'declaration.setVariableInitialValue',
    opId: 'set-created-batch-variable',
    declaration: createdVariableRef,
    expectedValueFingerprintSha256: declarationValueFingerprintV1(1),
    newValue: 2,
  })
  const createdVariableEvidence = declarationEntityEvidenceSetV1(
    declarationPlanner.candidate
  ).find(
    (entry) =>
      entry.declarationKind === 'variable' &&
      entry.rawRef.name === 'BatchVariable'
  )
  assert.ok(createdVariableEvidence)
  const createdVariableReferences = declarationReferenceEvidenceV1(
    declarationPlanner.candidate,
    createdVariableEvidence.rawRef
  )
  const createdVariableRenameActivation = declarationNameActivationEvidenceV1(
    declarationPlanner.candidate,
    'variable',
    createdVariableEvidence.rawRef.declarationTarget,
    GROUP_C_RENAMED_VARIABLE,
    createdVariableEvidence.rawRef
  )
  declarationPlanner.add({
    kind: 'declaration.rename',
    opId: 'rename-created-batch-variable',
    declaration: createdVariableRef,
    expectedName: expectedDeclarationNameIdentityV1(
      createdVariableEvidence.rawRef
    ),
    expectedReferenceSetSha256:
      createdVariableReferences.expectedReferenceSetSha256,
    newName: GROUP_C_RENAMED_VARIABLE,
    newNameActivation: {
      expectedActivationSetSha256:
        createdVariableRenameActivation.activationSetSha256,
      requireProspectiveActivationCount: 0,
    },
  })
  const obsoleteDeclarationEvidence = declarationEntityEvidenceSetV1(
    declarationPlanner.candidate
  ).find((entry) => entry.rawRef.name === 'obsolete')
  assert.ok(obsoleteDeclarationEvidence)
  const obsoleteDeclarationReferences = declarationReferenceEvidenceV1(
    declarationPlanner.candidate,
    obsoleteDeclarationEvidence.rawRef
  )
  declarationPlanner.add({
    kind: 'declaration.remove',
    opId: 'remove-obsolete-variable',
    declaration: handleRef(obsoleteDeclarationItem, 'declaration'),
    expectedReferenceSetSha256:
      obsoleteDeclarationReferences.expectedReferenceSetSha256,
    expectedMonitorSetSha256:
      obsoleteDeclarationReferences.expectedMonitorSetSha256,
    requireFinalReferenceCount: 0,
    requireFinalMonitorCount: 0,
  })
  const planningDeclarationTarget = declarationPlanner.candidate.json.targets[1]
  assert.ok(planningDeclarationTarget && !planningDeclarationTarget.isStage)
  const listActivation = declarationNameActivationEvidenceV1(
    declarationPlanner.candidate,
    'list',
    {
      targetIndex: 1,
      name: planningDeclarationTarget.name,
      isStage: false,
    },
    'BatchList'
  )
  declarationPlanner.add({
    kind: 'declaration.addList',
    opId: 'add-batch-list',
    scope: handleRef(declarationTargetItem, 'target'),
    name: 'BatchList',
    initialItems: ['seed'],
    nameActivation: {
      expectedActivationSetSha256: listActivation.activationSetSha256,
      requireProspectiveActivationCount: 0,
    },
    expectedListMapState: optionalCollectionContainerStateV1(
      planningDeclarationTarget.lists
    ),
  })
  const createdListRef = {
    entityKind: 'declaration',
    refKind: 'created',
    opId: 'add-batch-list',
    slot: { slotKind: 'fixed', name: 'declaration' },
  } as const
  declarationPlanner.add({
    kind: 'declaration.setListInitialItems',
    opId: 'set-created-batch-list',
    declaration: createdListRef,
    expectedItemsSha256: declarationItemsFingerprintV1(['seed']),
    newItems: ['seed', 'next'],
  })
  const createdListEvidence = declarationEntityEvidenceSetV1(
    declarationPlanner.candidate
  ).find(
    (entry) =>
      entry.declarationKind === 'list' && entry.rawRef.name === 'BatchList'
  )
  assert.ok(createdListEvidence)
  const createdListReferences = declarationReferenceEvidenceV1(
    declarationPlanner.candidate,
    createdListEvidence.rawRef
  )
  const createdListRenameActivation = declarationNameActivationEvidenceV1(
    declarationPlanner.candidate,
    'list',
    createdListEvidence.rawRef.declarationTarget,
    GROUP_C_RENAMED_LIST,
    createdListEvidence.rawRef
  )
  declarationPlanner.add({
    kind: 'declaration.rename',
    opId: 'rename-created-batch-list',
    declaration: createdListRef,
    expectedName: expectedDeclarationNameIdentityV1(createdListEvidence.rawRef),
    expectedReferenceSetSha256:
      createdListReferences.expectedReferenceSetSha256,
    newName: GROUP_C_RENAMED_LIST,
    newNameActivation: {
      expectedActivationSetSha256:
        createdListRenameActivation.activationSetSha256,
      requireProspectiveActivationCount: 0,
    },
  })
  const addActivation = declarationNameActivationEvidenceV1(
    declarationPlanner.candidate,
    'broadcast',
    null,
    'LaunchSignal'
  )
  declarationPlanner.add({
    kind: 'declaration.addBroadcast',
    opId: 'add-launch-signal',
    name: 'LaunchSignal',
    nameActivation: {
      expectedActivationSetSha256: addActivation.activationSetSha256,
      requireProspectiveActivationCount: 0,
    },
    expectedStageBroadcastMapState: optionalCollectionContainerStateV1(
      planningStage.broadcasts
    ),
  })
  const createdDeclaration = declarationEntityEvidenceSetV1(
    declarationPlanner.candidate
  ).find(
    (entry) =>
      entry.declarationKind === 'broadcast' &&
      entry.rawRef.name === 'LaunchSignal'
  )
  assert.ok(createdDeclaration)
  const createdDeclarationRef = {
    entityKind: 'declaration',
    refKind: 'created',
    opId: 'add-launch-signal',
    slot: { slotKind: 'fixed', name: 'declaration' },
  } as const
  const renameReferences = declarationReferenceEvidenceV1(
    declarationPlanner.candidate,
    createdDeclaration.rawRef
  )
  const renameActivation = declarationNameActivationEvidenceV1(
    declarationPlanner.candidate,
    'broadcast',
    null,
    'PowerSignal',
    createdDeclaration.rawRef
  )
  declarationPlanner.add({
    kind: 'declaration.rename',
    opId: 'rename-launch-signal',
    declaration: createdDeclarationRef,
    expectedName: expectedDeclarationNameIdentityV1(createdDeclaration.rawRef),
    expectedReferenceSetSha256: renameReferences.expectedReferenceSetSha256,
    newName: 'PowerSignal',
    newNameActivation: {
      expectedActivationSetSha256: renameActivation.activationSetSha256,
      requireProspectiveActivationCount: 0,
    },
  })
  const declarationBeforeInspection = await inspectSemanticEditArtifact(
    await store.readImmutable(session.revisions.at(-1)!.candidateKey)
  )
  const declarationAfterInspection = await inspectSemanticEditArtifact(
    await declarationPlanner.candidate.toSb3()
  )
  const unusedVariableDiagnosticMultiset = (
    entries: typeof declarationBeforeInspection.static
  ) =>
    entries
      .filter((entry) => entry.code === 'unused-variable')
      .map((entry) => ({
        source: entry.source,
        code: entry.code,
        severity: entry.severity,
        locations: entry.locations,
      }))
  assert.deepEqual(
    unusedVariableDiagnosticMultiset(declarationAfterInspection.static),
    unusedVariableDiagnosticMultiset(declarationBeforeInspection.static)
  )
  const ledgerBeforeDeclarationPreview = structuredClone(
    retainedFutureBindingLedger(session.revisions.at(-1)!)
  )
  assert.deepEqual(ledgerBeforeDeclarationPreview.realizations, [])
  const declarationPreview = await session.preview(
    {
      requestId: 'preview-group-c-declaration-chain',
      expectedHead: session.head,
      canonicalTransaction: declarationPlanner.batch(),
    },
    invocation(7)
  )
  assert.equal(declarationPreview.preview.operationCount, 9)
  assert.deepEqual(
    retainedFutureBindingLedger(session.revisions.at(-1)!),
    ledgerBeforeDeclarationPreview
  )
  for (const bindingKey of GROUP_C_FUTURE_BINDING_KEYS)
    assert.equal(
      JSON.stringify(declarationPreview.preview.operationResults).includes(
        bindingKey
      ),
      false
    )
  const declarationApply = await session.apply(
    {
      schemaVersion: 1,
      sessionId: session.sessionId,
      requestId: 'apply-group-c-declaration-chain',
      ...expectedHeadRequest(declarationPreview.preview.expectedHead),
      previewId: declarationPreview.preview.previewId,
      applyGuardSha256: declarationPreview.preview.applyGuardSha256,
      expectedResolvedPlanSha256: declarationPreview.preview.resolvedPlanSha256,
    },
    invocation(8)
  )
  assert.equal(declarationApply.head.revisionNumber, 3)
  assert.deepEqual(
    declarationApply.operationResults,
    declarationPreview.preview.operationResults
  )
  const declarationResults = declarationApply.operationResults as readonly {
    opId: string
    selectedLineageIds: readonly string[]
    fixedSlots: readonly {
      entityKind: string
      lineageId: string
      semanticLocationSha256: string
      semanticFingerprintSha256: string
      contextFingerprintSha256: string
    }[]
  }[]
  assert.deepEqual(
    declarationResults.map((result) => result.opId),
    [
      'add-batch-variable',
      'set-created-batch-variable',
      'rename-created-batch-variable',
      'remove-obsolete-variable',
      'add-batch-list',
      'set-created-batch-list',
      'rename-created-batch-list',
      'add-launch-signal',
      'rename-launch-signal',
    ]
  )
  assert.equal(declarationResults[0]?.fixedSlots[0]?.entityKind, 'declaration')
  assert.equal(declarationResults[4]?.fixedSlots[0]?.entityKind, 'declaration')
  assert.equal(declarationResults[7]?.fixedSlots[0]?.entityKind, 'declaration')
  const committedDeclarationInspection = await session.inspect({
    issueHandles: false,
  })
  const committedVariableItem = committedDeclarationInspection.items.find(
    (item) =>
      item.entityKind === 'declaration' &&
      item.entitySubtype === 'variable' &&
      'name' in item.location &&
      item.location.name.displayKind === 'inline' &&
      item.location.name.value === GROUP_C_RENAMED_VARIABLE
  )
  const committedListItem = committedDeclarationInspection.items.find(
    (item) =>
      item.entityKind === 'declaration' &&
      item.entitySubtype === 'list' &&
      'name' in item.location &&
      item.location.name.displayKind === 'inline' &&
      item.location.name.value === GROUP_C_RENAMED_LIST
  )
  const committedBroadcastItem = committedDeclarationInspection.items.find(
    (item) =>
      item.entityKind === 'declaration' &&
      item.entitySubtype === 'broadcast' &&
      'name' in item.location &&
      item.location.name.displayKind === 'inline' &&
      item.location.name.value === 'PowerSignal'
  )
  assert.ok(
    committedVariableItem && committedListItem && committedBroadcastItem
  )
  const assertCreatorSlotMatchesCommittedItem = (
    slot: (typeof declarationResults)[number]['fixedSlots'][number],
    item: (typeof committedDeclarationInspection.items)[number]
  ): void =>
  {
    assert.deepEqual(
      {
        semanticLocationSha256: slot.semanticLocationSha256,
        semanticFingerprintSha256: slot.semanticFingerprintSha256,
        contextFingerprintSha256: slot.contextFingerprintSha256,
      },
      {
        semanticLocationSha256: item.semanticLocationSha256,
        semanticFingerprintSha256: item.semanticFingerprintSha256,
        contextFingerprintSha256: item.contextFingerprintSha256,
      }
    )
  }
  assertCreatorSlotMatchesCommittedItem(
    declarationResults[0]!.fixedSlots[0]!,
    committedVariableItem
  )
  assertCreatorSlotMatchesCommittedItem(
    declarationResults[4]!.fixedSlots[0]!,
    committedListItem
  )
  assertCreatorSlotMatchesCommittedItem(
    declarationResults[7]!.fixedSlots[0]!,
    committedBroadcastItem
  )
  const declarationRevision = session.revisions.at(-1)!
  const declarationLedger = retainedFutureBindingLedger(declarationRevision)
  assert.equal(declarationLedger.realizations.length, 3)
  assertHashOnlyFutureBindingRows(declarationLedger.realizations)
  const expectedDeclarationRealizations = [
    [
      'created-variable-binding',
      declarationResults[0]!.fixedSlots[0]!.lineageId,
    ],
    ['created-list-binding', declarationResults[4]!.fixedSlots[0]!.lineageId],
    [
      'created-broadcast-binding',
      declarationResults[7]!.fixedSlots[0]!.lineageId,
    ],
  ] as const
  for (const [bindingKey, resultLineageId] of expectedDeclarationRealizations)
  {
    const bindingKeySha256 = futureBindingKeySha256V1(
      declarationLedger.changeContractSha256,
      bindingKey
    )
    const matches = declarationLedger.realizations.filter(
      (row) => row.bindingKeySha256 === bindingKeySha256
    )
    assert.equal(matches.length, 1)
    assert.equal(matches[0]!.resultLineageId, resultLineageId)
  }
  for (const bindingKey of GROUP_C_FUTURE_BINDING_KEYS)
    assert.equal(
      JSON.stringify(declarationApply.operationResults).includes(bindingKey),
      false
    )
  const revisionTwoCandidate = await ProjectIR.fromSb3(
    await store.readImmutable(declarationRevision.candidateKey)
  )
  assert.equal(
    declarationEntityEvidenceSetV1(revisionTwoCandidate).some(
      (entry) => entry.rawRef.name === 'PowerSignal'
    ),
    true
  )
  const declarationCandidateTarget = revisionTwoCandidate.json.targets[1]
  assert.ok(declarationCandidateTarget && !declarationCandidateTarget.isStage)
  const batchVariable = Object.values(
    declarationCandidateTarget.variables
  ).find((entry) => entry[0] === GROUP_C_RENAMED_VARIABLE)
  const declarationCandidateLists = declarationCandidateTarget.lists
  assert.ok(declarationCandidateLists)
  const batchList = Object.values(declarationCandidateLists).find(
    (entry) => entry[0] === GROUP_C_RENAMED_LIST
  )
  assert.deepEqual(batchVariable, [GROUP_C_RENAMED_VARIABLE, 2])
  assert.deepEqual(batchList, [GROUP_C_RENAMED_LIST, ['seed', 'next']])
  const removedObsoleteResult = declarationResults[3]!
  assert.equal(
    (
      declarationRevision.lineageHistory as {
        records: readonly { lineageId: string; status: string }[]
      }
    ).records.find(
      (record) =>
        record.lineageId === removedObsoleteResult.selectedLineageIds[0]
    )?.status,
    'tombstoned'
  )
  const cumulative = declarationRevision.cumulativeDelta as {
    targets: readonly {
      gameplayPropertyChanges: readonly { operationIds: readonly string[] }[]
      declarationChanges: readonly {
        kind: string
        after?: unknown
        operationIds: readonly string[]
      }[]
    }[]
  }
  const targetScopeEvidence = (
    session.revisions[2]!.authorization as {
      contractAuthorization: {
        operationScopeEvidence: readonly {
          opId: string
          occurrenceId: string
          semanticScopeSha256: string
        }[]
      }
    }
  ).contractAuthorization.operationScopeEvidence.find(
    (entry) => entry.opId === 'move-sprite-x'
  )
  const addScopeEvidence = (
    declarationRevision.authorization as {
      contractAuthorization: {
        operationScopeEvidence: readonly {
          opId: string
          occurrenceId: string
          semanticScopeSha256: string
        }[]
      }
    }
  ).contractAuthorization.operationScopeEvidence.find(
    (entry) => entry.opId === 'add-launch-signal'
  )
  const declarationScopeEvidence = (
    declarationRevision.authorization as {
      contractAuthorization: {
        operationScopeEvidence: readonly {
          opId: string
          occurrenceId: string
          semanticScopeSha256: string
        }[]
      }
    }
  ).contractAuthorization.operationScopeEvidence.filter((entry) =>
    [
      'add-batch-variable',
      'set-created-batch-variable',
      'rename-created-batch-variable',
      'add-batch-list',
      'set-created-batch-list',
      'rename-created-batch-list',
    ].includes(entry.opId)
  )
  assert.equal(declarationScopeEvidence.length, 6)
  const expectedFutureRenameScopeSha256 = (
    entitySubtype: 'variable' | 'list',
    bindingKey: 'created-variable-binding' | 'created-list-binding'
  ): string =>
    productionContractScopeSha256V1({
      scopeSubjectKind: 'entity',
      operationKind: 'declaration.rename',
      entityKind: 'declaration',
      entitySubtype,
      locationScope: {
        scopeKind: 'exactEntity',
        entity: {
          contractRefKind: 'future',
          entityKind: 'declaration',
          entitySubtype,
          bindingKey,
        },
      },
      allowedPropertyPaths: [{ surface: 'declaration', property: 'name' }],
    })
  assert.equal(
    declarationScopeEvidence.find(
      (entry) => entry.opId === 'rename-created-batch-variable'
    )?.semanticScopeSha256,
    expectedFutureRenameScopeSha256('variable', 'created-variable-binding')
  )
  assert.equal(
    declarationScopeEvidence.find(
      (entry) => entry.opId === 'rename-created-batch-list'
    )?.semanticScopeSha256,
    expectedFutureRenameScopeSha256('list', 'created-list-binding')
  )
  const declarationStructuralAllowanceIds = (
    declarationRevision.authorization as {
      contractAuthorization: {
        matchedStructuralAllowanceIds: readonly string[]
      }
    }
  ).contractAuthorization.matchedStructuralAllowanceIds
  assert.equal(
    declarationStructuralAllowanceIds.includes('add-created-variable'),
    true
  )
  assert.equal(
    declarationStructuralAllowanceIds.includes('add-created-list'),
    true
  )
  const declarationParentOperationIds = operationIdArrays(
    declarationRevision.parentDelta
  ).flat()
  for (const occurrence of declarationScopeEvidence)
  {
    assert.match(occurrence.occurrenceId, /^[a-f0-9]{64}$/u)
    assert.equal(
      declarationParentOperationIds.includes(occurrence.occurrenceId),
      true,
      `${occurrence.opId} is absent from the declaration parent delta`
    )
  }
  const declarationOccurrenceByOpId = new Map(
    declarationScopeEvidence.map((entry) => [entry.opId, entry.occurrenceId])
  )
  const expectedAggregateWriterIds = (
    opIds: readonly string[]
  ): readonly string[] =>
    opIds
      .map((opId) => declarationOccurrenceByOpId.get(opId))
      .filter(
        (occurrenceId): occurrenceId is string => occurrenceId !== undefined
      )
      .sort()
  const assertAggregateDeclarationWriters = (
    delta: unknown,
    finalName: string,
    opIds: readonly string[]
  ): void =>
  {
    const targets = (
      delta as {
        targets: readonly {
          declarationChanges: readonly {
            kind: string
            after?: unknown
            operationIds: readonly string[]
          }[]
        }[]
      }
    ).targets
    const matches = targets.flatMap((target) =>
      target.declarationChanges.filter(
        (change) =>
          change.kind === 'added' &&
          Array.isArray(change.after) &&
          change.after[0] === finalName
      )
    )
    assert.equal(matches.length, 1)
    assert.deepEqual(
      [...matches[0]!.operationIds].sort(),
      expectedAggregateWriterIds(opIds)
    )
  }
  for (const delta of [declarationRevision.parentDelta, cumulative])
  {
    assertAggregateDeclarationWriters(delta, GROUP_C_RENAMED_VARIABLE, [
      'add-batch-variable',
      'set-created-batch-variable',
      'rename-created-batch-variable',
    ])
    assertAggregateDeclarationWriters(delta, GROUP_C_RENAMED_LIST, [
      'add-batch-list',
      'set-created-batch-list',
      'rename-created-batch-list',
    ])
  }
  assert.match(targetScopeEvidence?.occurrenceId ?? '', /^[a-f0-9]{64}$/u)
  assert.match(addScopeEvidence?.occurrenceId ?? '', /^[a-f0-9]{64}$/u)
  assert.equal(
    cumulative.targets.some((target) =>
      target.gameplayPropertyChanges.some((change) =>
        change.operationIds.includes(targetScopeEvidence!.occurrenceId)
      )
    ),
    true
  )
  assert.equal(
    cumulative.targets.some((target) =>
      target.declarationChanges.some((change) =>
        change.operationIds.includes(addScopeEvidence!.occurrenceId)
      )
    ),
    true
  )

  const rerenameInspection = await session.inspect({ issueHandles: true })
  const powerSignalItem = rerenameInspection.items.find(
    (item) =>
      item.entityKind === 'declaration' &&
      item.entitySubtype === 'broadcast' &&
      'name' in item.location &&
      item.location.name.displayKind === 'inline' &&
      item.location.name.value === 'PowerSignal'
  )
  assert.ok(powerSignalItem)
  const rerenamePlanner = await ProductionBatchPlannerV1.create({
    source: sourceProject,
    sourceBytes,
    session,
    store,
    contract: bound,
    inspection: rerenameInspection,
  })
  const powerSignalEvidence = declarationEntityEvidenceSetV1(
    rerenamePlanner.candidate
  ).find((entry) => entry.rawRef.name === 'PowerSignal')
  assert.ok(powerSignalEvidence)
  const powerSignalReferences = declarationReferenceEvidenceV1(
    rerenamePlanner.candidate,
    powerSignalEvidence.rawRef
  )
  const finalSignalActivation = declarationNameActivationEvidenceV1(
    rerenamePlanner.candidate,
    'broadcast',
    null,
    'FinalSignal',
    powerSignalEvidence.rawRef
  )
  rerenamePlanner.add({
    kind: 'declaration.rename',
    opId: 'rename-launch-signal',
    declaration: handleRef(powerSignalItem, 'declaration'),
    expectedName: expectedDeclarationNameIdentityV1(powerSignalEvidence.rawRef),
    expectedReferenceSetSha256:
      powerSignalReferences.expectedReferenceSetSha256,
    newName: 'FinalSignal',
    newNameActivation: {
      expectedActivationSetSha256: finalSignalActivation.activationSetSha256,
      requireProspectiveActivationCount: 0,
    },
  })
  const rerenamePreview = await session.preview(
    {
      requestId: 'preview-group-c-declaration-rerename',
      expectedHead: session.head,
      canonicalTransaction: rerenamePlanner.batch(),
    },
    invocation(9)
  )
  const rerenameApply = await session.apply(
    {
      schemaVersion: 1,
      sessionId: session.sessionId,
      requestId: 'apply-group-c-declaration-rerename',
      ...expectedHeadRequest(rerenamePreview.preview.expectedHead),
      previewId: rerenamePreview.preview.previewId,
      applyGuardSha256: rerenamePreview.preview.applyGuardSha256,
      expectedResolvedPlanSha256: rerenamePreview.preview.resolvedPlanSha256,
    },
    invocation(10)
  )
  assert.equal(rerenameApply.head.revisionNumber, 4)
  const revisionThree = session.revisions.at(-1)!
  const repeatedRenameOccurrences = (
    revisionThree.authorization as {
      contractAuthorization: {
        operationScopeEvidence: readonly {
          opId: string
          occurrenceId: string
        }[]
      }
    }
  ).contractAuthorization.operationScopeEvidence.filter(
    (entry) => entry.opId === 'rename-launch-signal'
  )
  assert.equal(repeatedRenameOccurrences.length, 2)
  assert.equal(
    new Set(repeatedRenameOccurrences.map((entry) => entry.occurrenceId)).size,
    2
  )
  for (const entry of repeatedRenameOccurrences)
    assert.match(entry.occurrenceId, /^[a-f0-9]{64}$/u)
  const revisionThreeCumulative = revisionThree.cumulativeDelta as {
    targets: readonly {
      declarationChanges: readonly { operationIds: readonly string[] }[]
    }[]
  }
  for (const occurrence of repeatedRenameOccurrences)
    assert.equal(
      revisionThreeCumulative.targets.some((target) =>
        target.declarationChanges.some((change) =>
          change.operationIds.includes(occurrence.occurrenceId)
        )
      ),
      true
    )

  const valueInspection = await session.inspect({ issueHandles: true })
  const batchVariableItem = valueInspection.items.find(
    (item) =>
      item.entityKind === 'declaration' &&
      item.entitySubtype === 'variable' &&
      'name' in item.location &&
      item.location.name.displayKind === 'inline' &&
      item.location.name.value === GROUP_C_RENAMED_VARIABLE
  )
  assert.ok(batchVariableItem)
  const valuePlanner = await ProductionBatchPlannerV1.create({
    source: sourceProject,
    sourceBytes,
    session,
    store,
    contract: bound,
    inspection: valueInspection,
  })
  valuePlanner.add({
    kind: 'declaration.setVariableInitialValue',
    opId: 'set-created-batch-variable-later',
    declaration: handleRef(batchVariableItem, 'declaration'),
    expectedValueFingerprintSha256: declarationValueFingerprintV1(2),
    newValue: 9,
  })
  const valuePreview = await session.preview(
    {
      requestId: 'preview-group-c-declaration-value',
      expectedHead: session.head,
      canonicalTransaction: valuePlanner.batch(),
    },
    invocation(11)
  )
  const valueApply = await session.apply(
    {
      schemaVersion: 1,
      sessionId: session.sessionId,
      requestId: 'apply-group-c-declaration-value',
      ...expectedHeadRequest(valuePreview.preview.expectedHead),
      previewId: valuePreview.preview.previewId,
      applyGuardSha256: valuePreview.preview.applyGuardSha256,
      expectedResolvedPlanSha256: valuePreview.preview.resolvedPlanSha256,
    },
    invocation(12)
  )
  assert.equal(valueApply.head.revisionNumber, 5)
  assert.deepEqual(
    retainedFutureBindingLedger(session.revisions.at(-1)!),
    declarationLedger
  )
  const laterVariableScopeEvidence = (
    session.revisions.at(-1)!.authorization as {
      contractAuthorization: {
        operationScopeEvidence: readonly {
          opId: string
          semanticScopeSha256: string
        }[]
      }
    }
  ).contractAuthorization.operationScopeEvidence.find(
    (entry) => entry.opId === 'set-created-batch-variable-later'
  )
  assert.equal(
    laterVariableScopeEvidence?.semanticScopeSha256,
    productionContractScopeSha256V1({
      scopeSubjectKind: 'entity',
      operationKind: 'declaration.setVariableInitialValue',
      entityKind: 'declaration',
      entitySubtype: 'variable',
      locationScope: {
        scopeKind: 'exactEntity',
        entity: {
          contractRefKind: 'future',
          entityKind: 'declaration',
          entitySubtype: 'variable',
          bindingKey: 'created-variable-binding',
        },
      },
      allowedPropertyPaths: [
        { surface: 'declaration', property: 'initialValue' },
      ],
    })
  )

  const laterListInspection = await session.inspect({ issueHandles: true })
  const batchListItem = laterListInspection.items.find(
    (item) =>
      item.entityKind === 'declaration' &&
      item.entitySubtype === 'list' &&
      'name' in item.location &&
      item.location.name.displayKind === 'inline' &&
      item.location.name.value === GROUP_C_RENAMED_LIST
  )
  assert.ok(batchListItem)
  const laterListPlanner = await ProductionBatchPlannerV1.create({
    source: sourceProject,
    sourceBytes,
    session,
    store,
    contract: bound,
    inspection: laterListInspection,
  })
  laterListPlanner.add({
    kind: 'declaration.setListInitialItems',
    opId: 'set-created-batch-list-later',
    declaration: handleRef(batchListItem, 'declaration'),
    expectedItemsSha256: declarationItemsFingerprintV1(['seed', 'next']),
    newItems: ['seed', 'next', 'later'],
  })
  const laterListPreview = await session.preview(
    {
      requestId: 'preview-group-c-created-list-later',
      expectedHead: session.head,
      canonicalTransaction: laterListPlanner.batch(),
    },
    invocation(13)
  )
  const laterListApply = await session.apply(
    {
      schemaVersion: 1,
      sessionId: session.sessionId,
      requestId: 'apply-group-c-created-list-later',
      ...expectedHeadRequest(laterListPreview.preview.expectedHead),
      previewId: laterListPreview.preview.previewId,
      applyGuardSha256: laterListPreview.preview.applyGuardSha256,
      expectedResolvedPlanSha256: laterListPreview.preview.resolvedPlanSha256,
    },
    invocation(14)
  )
  assert.equal(laterListApply.head.revisionNumber, 6)
  assert.deepEqual(
    retainedFutureBindingLedger(session.revisions.at(-1)!),
    declarationLedger
  )
  const laterListScopeEvidence = (
    session.revisions.at(-1)!.authorization as {
      contractAuthorization: {
        operationScopeEvidence: readonly {
          opId: string
          semanticScopeSha256: string
        }[]
      }
    }
  ).contractAuthorization.operationScopeEvidence.find(
    (entry) => entry.opId === 'set-created-batch-list-later'
  )
  assert.equal(
    laterListScopeEvidence?.semanticScopeSha256,
    productionContractScopeSha256V1({
      scopeSubjectKind: 'entity',
      operationKind: 'declaration.setListInitialItems',
      entityKind: 'declaration',
      entitySubtype: 'list',
      locationScope: {
        scopeKind: 'exactEntity',
        entity: {
          contractRefKind: 'future',
          entityKind: 'declaration',
          entitySubtype: 'list',
          bindingKey: 'created-list-binding',
        },
      },
      allowedPropertyPaths: [
        { surface: 'declaration', property: 'initialItems' },
      ],
    })
  )
  const laterListCandidate = await ProjectIR.fromSb3(
    await store.readImmutable(session.revisions.at(-1)!.candidateKey)
  )
  assert.deepEqual(
    Object.values(laterListCandidate.json.targets[1]?.lists ?? {}).find(
      (entry) => entry[0] === GROUP_C_RENAMED_LIST
    ),
    [GROUP_C_RENAMED_LIST, ['seed', 'next', 'later']]
  )

  const commentInspection = await session.inspect({ issueHandles: true })
  const commentSprite = commentInspection.items.find(
    (item) => item.entityKind === 'target' && item.entitySubtype === 'sprite'
  )
  const commentBlock = commentInspection.items.find(
    (item) =>
      item.entityKind === 'block' &&
      item.location.opcode.displayKind === 'inline' &&
      item.location.opcode.value === 'data_setvariableto'
  )
  const editableSourceComment = commentInspection.items.find(
    (item) =>
      item.entityKind === 'comment' &&
      item.location.textSha256 === sourceCommentItem.location.textSha256
  )
  assert.ok(commentSprite && commentBlock && editableSourceComment)
  const commentPlanner = await ProductionBatchPlannerV1.create({
    source: sourceProject,
    sourceBytes,
    session,
    store,
    contract: bound,
    inspection: commentInspection,
  })
  commentPlanner.add({
    kind: 'comment.updateText',
    opId: 'update-source-comment-text',
    comment: handleRef(editableSourceComment, 'comment'),
    expectedTextSha256: sourceCommentItem.location.textSha256,
    text: GROUP_C_UPDATED_COMMENT,
  })
  commentPlanner.add({
    kind: 'comment.move',
    opId: 'move-source-comment',
    comment: handleRef(editableSourceComment, 'comment'),
    edits: [
      {
        property: 'x',
        expected: { state: 'value', value: 24 },
        value: 34,
      },
      {
        property: 'minimized',
        expected: { state: 'value', value: false },
        value: true,
      },
    ],
  })
  commentPlanner.add({
    kind: 'comment.add',
    opId: 'add-review-comment',
    target: handleRef(commentSprite, 'target'),
    attachment: { kind: 'detached' },
    text: 'keep score mutation visible',
    layout: {
      x: 120,
      y: 80,
      width: 180,
      height: 90,
      minimized: false,
    },
    expectedCommentMapState: commentMapStateV1(commentPlanner.candidate, 1),
  })
  const createdCommentRef = {
    entityKind: 'comment',
    refKind: 'created',
    opId: 'add-review-comment',
    slot: { slotKind: 'fixed', name: 'comment' },
  } as const
  commentPlanner.add({
    kind: 'comment.move',
    opId: 'move-created-review-comment',
    comment: createdCommentRef,
    edits: [
      {
        property: 'x',
        expected: { state: 'value', value: 120 },
        value: 140,
      },
      {
        property: 'minimized',
        expected: { state: 'value', value: false },
        value: true,
      },
    ],
  })
  commentPlanner.add({
    kind: 'comment.attach',
    opId: 'attach-review-comment',
    comment: createdCommentRef,
    block: handleRef(commentBlock, 'block'),
    expectedDetached: true,
  })
  const ledgerBeforeCommentPreview = structuredClone(
    retainedFutureBindingLedger(session.revisions.at(-1)!)
  )
  assert.deepEqual(ledgerBeforeCommentPreview, declarationLedger)
  const commentPreview = await session.preview(
    {
      requestId: 'preview-group-c-comment-create-attach',
      expectedHead: session.head,
      canonicalTransaction: commentPlanner.batch(),
    },
    invocation(15)
  )
  assert.equal(commentPreview.preview.operationCount, 5)
  assert.deepEqual(
    retainedFutureBindingLedger(session.revisions.at(-1)!),
    ledgerBeforeCommentPreview
  )
  for (const bindingKey of GROUP_C_FUTURE_BINDING_KEYS)
    assert.equal(
      JSON.stringify(commentPreview.preview.operationResults).includes(
        bindingKey
      ),
      false
    )
  const commentApply = await session.apply(
    {
      schemaVersion: 1,
      sessionId: session.sessionId,
      requestId: 'apply-group-c-comment-create-attach',
      ...expectedHeadRequest(commentPreview.preview.expectedHead),
      previewId: commentPreview.preview.previewId,
      applyGuardSha256: commentPreview.preview.applyGuardSha256,
      expectedResolvedPlanSha256: commentPreview.preview.resolvedPlanSha256,
    },
    invocation(16)
  )
  const commentResults = commentApply.operationResults as readonly {
    opId: string
    fixedSlots: readonly {
      entityKind: string
      lineageId: string
      semanticLocationSha256: string
      semanticFingerprintSha256: string
      contextFingerprintSha256: string
    }[]
  }[]
  assert.equal(commentApply.head.revisionNumber, 7)
  assert.deepEqual(
    commentResults.map((result) => result.opId),
    [
      'update-source-comment-text',
      'move-source-comment',
      'add-review-comment',
      'move-created-review-comment',
      'attach-review-comment',
    ]
  )
  assert.equal(commentResults[2]?.fixedSlots[0]?.entityKind, 'comment')
  const createdCommentSlot = commentResults[2]!.fixedSlots[0]!
  const committedCommentInspection = await session.inspect({
    issueHandles: false,
  })
  const committedCommentItem = committedCommentInspection.items.find(
    (item) =>
      item.entityKind === 'comment' &&
      item.location.textSha256 ===
        commentTextSha256V1('keep score mutation visible')
  )
  assert.ok(committedCommentItem)
  assertCreatorSlotMatchesCommittedItem(
    createdCommentSlot,
    committedCommentItem
  )
  const commentRevision = session.revisions.at(-1)!
  const commentLedger = retainedFutureBindingLedger(commentRevision)
  assert.equal(commentLedger.realizations.length, 4)
  assertHashOnlyFutureBindingRows(commentLedger.realizations)
  assert.deepEqual(
    commentLedger.realizations.filter((row) =>
      declarationLedger.realizations.some(
        (prior) =>
          prior.resultCorrespondenceSha256 === row.resultCorrespondenceSha256
      )
    ),
    declarationLedger.realizations
  )
  const commentBindingKeySha256 = futureBindingKeySha256V1(
    commentLedger.changeContractSha256,
    'created-comment-binding'
  )
  const commentRealizations = commentLedger.realizations.filter(
    (row) => row.bindingKeySha256 === commentBindingKeySha256
  )
  assert.equal(commentRealizations.length, 1)
  assert.equal(
    commentRealizations[0]!.resultLineageId,
    createdCommentSlot.lineageId
  )
  for (const bindingKey of GROUP_C_FUTURE_BINDING_KEYS)
    assert.equal(
      JSON.stringify(commentApply.operationResults).includes(bindingKey),
      false
    )
  const commentCandidate = await ProjectIR.fromSb3(
    await store.readImmutable(commentRevision.candidateKey)
  )
  const updatedSourceComment = Object.values(
    commentCandidate.json.targets[1]?.comments ?? {}
  ).find((comment) => comment.text === GROUP_C_UPDATED_COMMENT)
  const createdReviewComment = Object.values(
    commentCandidate.json.targets[1]?.comments ?? {}
  ).find((comment) => comment.text === 'keep score mutation visible')
  assert.ok(updatedSourceComment && createdReviewComment)
  assert.deepEqual(
    { x: updatedSourceComment.x, minimized: updatedSourceComment.minimized },
    { x: 34, minimized: true }
  )
  assert.deepEqual(
    {
      x: createdReviewComment.x,
      minimized: createdReviewComment.minimized,
      attached: createdReviewComment.blockId !== null,
    },
    { x: 140, minimized: true, attached: true }
  )
  const commentScopeEvidence = (
    commentRevision.authorization as {
      contractAuthorization: {
        operationScopeEvidence: readonly {
          opId: string
          occurrenceId: string
        }[]
      }
    }
  ).contractAuthorization.operationScopeEvidence.filter((entry) =>
    [
      'update-source-comment-text',
      'move-source-comment',
      'move-created-review-comment',
    ].includes(entry.opId)
  )
  assert.equal(commentScopeEvidence.length, 3)
  const commentParentOperationIds = operationIdArrays(
    commentRevision.parentDelta
  ).flat()
  for (const occurrence of commentScopeEvidence)
  {
    assert.match(occurrence.occurrenceId, /^[a-f0-9]{64}$/u)
    assert.equal(
      commentParentOperationIds.includes(occurrence.occurrenceId),
      true,
      `${occurrence.opId} is absent from the comment parent delta`
    )
  }
  const commentCreationOccurrenceEvidence = (
    commentRevision.authorization as {
      contractAuthorization: {
        operationScopeEvidence: readonly {
          opId: string
          occurrenceId: string
        }[]
      }
    }
  ).contractAuthorization.operationScopeEvidence.filter((entry) =>
    [
      'add-review-comment',
      'move-created-review-comment',
      'attach-review-comment',
    ].includes(entry.opId)
  )
  assert.equal(commentCreationOccurrenceEvidence.length, 3)
  const createdCommentAggregates = (
    commentRevision.parentDelta as {
      targets: readonly {
        existingEditorLayoutChanges: readonly {
          kind: string
          after?: unknown
          operationIds: readonly string[]
        }[]
      }[]
    }
  ).targets.flatMap((target) =>
    target.existingEditorLayoutChanges.filter(
      (change) =>
        change.kind === 'added' &&
        change.after !== null &&
        typeof change.after === 'object' &&
        !Array.isArray(change.after) &&
        (change.after as { text?: unknown }).text ===
          'keep score mutation visible'
    )
  )
  assert.equal(createdCommentAggregates.length, 1)
  assert.deepEqual(
    [...createdCommentAggregates[0]!.operationIds].sort(),
    commentCreationOccurrenceEvidence.map((entry) => entry.occurrenceId).sort()
  )
  const commentPreservation = commentRevision.preservation as {
    status: string
    protectedSurfaceResultSha256: string
    preservationLensResultSha256: string
  }
  assert.equal(commentPreservation.status, 'passed')
  assert.match(
    commentPreservation.protectedSurfaceResultSha256,
    /^[a-f0-9]{64}$/u
  )
  assert.match(
    commentPreservation.preservationLensResultSha256,
    /^[a-f0-9]{64}$/u
  )
  const detachInspection = await session.inspect({ issueHandles: true })
  const attachedBlock = detachInspection.items.find(
    (item) =>
      item.entityKind === 'block' &&
      item.location.opcode.displayKind === 'inline' &&
      item.location.opcode.value === 'data_setvariableto'
  )
  const attachedComment = detachInspection.items.find(
    (item) =>
      item.entityKind === 'comment' &&
      item.location.attachedBlockLocationSha256 ===
        attachedBlock?.semanticLocationSha256
  )
  assert.ok(attachedComment && attachedBlock)
  const detachPlanner = await ProductionBatchPlannerV1.create({
    source: sourceProject,
    sourceBytes,
    session,
    store,
    contract: bound,
    inspection: detachInspection,
  })
  detachPlanner.add({
    kind: 'comment.detach',
    opId: 'detach-review-comment',
    comment: handleRef(attachedComment, 'comment'),
    expectedBlock: handleRef(attachedBlock, 'block'),
  })
  const detachPreview = await session.preview(
    {
      requestId: 'preview-group-c-comment-detach',
      expectedHead: session.head,
      canonicalTransaction: detachPlanner.batch(),
    },
    invocation(17)
  )
  const detachApply = await session.apply(
    {
      schemaVersion: 1,
      sessionId: session.sessionId,
      requestId: 'apply-group-c-comment-detach',
      ...expectedHeadRequest(detachPreview.preview.expectedHead),
      previewId: detachPreview.preview.previewId,
      applyGuardSha256: detachPreview.preview.applyGuardSha256,
      expectedResolvedPlanSha256: detachPreview.preview.resolvedPlanSha256,
    },
    invocation(18)
  )
  assert.equal(detachApply.head.revisionNumber, 8)
  const commentRemoveInspection = await session.inspect({ issueHandles: true })
  const detachedByLineage = commentRemoveInspection.items.find(
    (item) =>
      item.entityKind === 'comment' && item.attachmentStatus === 'detached'
  )
  const removableSourceComment = commentRemoveInspection.items.find(
    (item) =>
      item.entityKind === 'comment' &&
      item.location.textSha256 === commentTextSha256V1(GROUP_C_UPDATED_COMMENT)
  )
  assert.ok(detachedByLineage)
  assert.ok(removableSourceComment)
  const removeCommentPlanner = await ProductionBatchPlannerV1.create({
    source: sourceProject,
    sourceBytes,
    session,
    store,
    contract: bound,
    inspection: commentRemoveInspection,
  })
  const removableCommentEvidence = commentEntityEvidenceSetV1(
    removeCommentPlanner.candidate
  ).find(
    (entry) =>
      entry.semanticFingerprintSha256 ===
      removableSourceComment.semanticFingerprintSha256
  )
  assert.ok(removableCommentEvidence)
  const removableRawComment =
    removeCommentPlanner.candidate.json.targets[
      removableCommentEvidence.targetIndex
    ]?.comments?.[removableCommentEvidence.commentId]
  assert.ok(removableRawComment)
  assert.deepEqual(
    {
      blockId: removableRawComment.blockId,
      x: removableRawComment.x,
      y: removableRawComment.y,
      width: removableRawComment.width,
      height: removableRawComment.height,
      minimized: removableRawComment.minimized,
      text: removableRawComment.text,
    },
    {
      blockId: 'hat1',
      x: 34,
      y: 36,
      width: 180,
      height: 90,
      minimized: true,
      text: GROUP_C_UPDATED_COMMENT,
    }
  )
  removeCommentPlanner.add({
    kind: 'comment.remove',
    opId: 'remove-source-comment',
    comment: handleRef(removableSourceComment, 'comment'),
    expectedSemanticFingerprint: commentSemanticFingerprintV1(
      removableCommentEvidence.targetIndex,
      removableCommentEvidence.commentId,
      removableRawComment
    ),
  })
  const removeCommentPreview = await session.preview(
    {
      requestId: 'preview-group-c-comment-remove',
      expectedHead: session.head,
      canonicalTransaction: removeCommentPlanner.batch(),
    },
    invocation(19)
  )
  const removeCommentApply = await session.apply(
    {
      schemaVersion: 1,
      sessionId: session.sessionId,
      requestId: 'apply-group-c-comment-remove',
      ...expectedHeadRequest(removeCommentPreview.preview.expectedHead),
      previewId: removeCommentPreview.preview.previewId,
      applyGuardSha256: removeCommentPreview.preview.applyGuardSha256,
      expectedResolvedPlanSha256:
        removeCommentPreview.preview.resolvedPlanSha256,
    },
    invocation(20)
  )
  assert.equal(removeCommentApply.head.revisionNumber, 9)
  const removeCommentResult = removeCommentApply.operationResults[0] as {
    selectedLineageIds: readonly string[]
  }
  const commentLineage = session.revisions.at(-1)!.lineageHistory as {
    records: readonly { lineageId: string; status: string }[]
  }
  assert.equal(
    commentLineage.records.find(
      (record) => record.lineageId === removeCommentResult.selectedLineageIds[0]
    )?.status,
    'tombstoned'
  )
  assert.equal(
    commentLineage.records.find(
      (record) => record.lineageId === createdCommentSlot.lineageId
    )?.status,
    'active'
  )

  const scriptInspection = await session.inspect({ issueHandles: true })
  const scriptItem = scriptInspection.items.find(
    (item) => item.entityKind === 'script'
  )
  assert.ok(scriptItem)
  const scriptPlanner = await ProductionBatchPlannerV1.create({
    source: sourceProject,
    sourceBytes,
    session,
    store,
    contract: bound,
    inspection: scriptInspection,
  })
  scriptPlanner.add({
    kind: 'script.moveWorkspace',
    opId: 'move-script-workspace',
    script: handleRef(scriptItem, 'script'),
    expected: scriptItem.location.workspace,
    changes: { x: 321, y: -123 },
  })
  const scriptPreview = await session.preview(
    {
      requestId: 'preview-group-c-script-workspace',
      expectedHead: session.head,
      canonicalTransaction: scriptPlanner.batch(),
    },
    invocation(21)
  )
  const scriptApply = await session.apply(
    {
      schemaVersion: 1,
      sessionId: session.sessionId,
      requestId: 'apply-group-c-script-workspace',
      ...expectedHeadRequest(scriptPreview.preview.expectedHead),
      previewId: scriptPreview.preview.previewId,
      applyGuardSha256: scriptPreview.preview.applyGuardSha256,
      expectedResolvedPlanSha256: scriptPreview.preview.resolvedPlanSha256,
    },
    invocation(22)
  )
  assert.equal(scriptApply.head.revisionNumber, 10)
  const scriptCandidate = await ProjectIR.fromSb3(
    await store.readImmutable(session.revisions.at(-1)!.candidateKey)
  )
  const movedScript = scriptEntityEvidenceSetV1(scriptCandidate)[0]
  assert.deepEqual(movedScript?.location.workspace, {
    x: { state: 'value', value: 321 },
    y: { state: 'value', value: -123 },
  })

  const authoritativeHead = structuredClone(session.head)
  const authoritativeRevision = session.revisions.at(-1)!
  const assertAuthoritativeStateUnchanged = (): void =>
  {
    assert.deepEqual(session.head, authoritativeHead)
    assert.equal(session.revisions.length, 11)
    assert.deepEqual(session.revisions.at(-1), authoritativeRevision)
  }
  const adversarialInspection = await session.inspect({ issueHandles: true })
  const currentSprite = adversarialInspection.items.find(
    (item) => item.entityKind === 'target' && item.serializedTargetOrdinal === 1
  )
  assert.ok(currentSprite)
  const staleHandlePlanner = await ProductionBatchPlannerV1.create({
    source: sourceProject,
    sourceBytes,
    session,
    store,
    contract: bound,
    inspection: adversarialInspection,
  })
  const staleHandleOperation = {
    ...staleHandlePlanner.plan({
      kind: 'target.setSpriteProperties',
      opId: 'reject-stale-target-handle',
      target: handleRef(currentSprite, 'target'),
      edits: [
        {
          property: 'x',
          expected: { state: 'value', value: nextX },
          value: nextX + 1,
        },
      ],
    }),
    target: handleRef(spriteItem, 'target'),
  } as SemanticEditOperationV1
  await assertEditRefusal(
    () =>
      session.preview(
        {
          requestId: 'reject-stale-group-c-handle',
          expectedHead: session.head,
          canonicalTransaction: {
            ...staleHandlePlanner.batch(),
            operations: [staleHandleOperation],
          },
        },
        invocation(23)
      ),
    'edit.stale_handle'
  )
  assertAuthoritativeStateUnchanged()

  const wrongPlanningOperation = {
    ...staleHandlePlanner.plan({
      kind: 'target.setSpriteProperties',
      opId: 'reject-wrong-planning-facts',
      target: handleRef(currentSprite, 'target'),
      edits: [
        {
          property: 'x',
          expected: { state: 'value', value: nextX },
          value: nextX + 1,
        },
      ],
    }),
    expectedPlanningFactSetSha256: '0'.repeat(64),
  } as SemanticEditOperationV1
  await assertEditRefusal(
    () =>
      session.preview(
        {
          requestId: 'reject-wrong-group-c-planning-facts',
          expectedHead: session.head,
          canonicalTransaction: {
            ...staleHandlePlanner.batch(),
            operations: [wrongPlanningOperation],
          },
        },
        invocation(24)
      ),
    'edit.planning_facts_mismatch'
  )
  assertAuthoritativeStateUnchanged()

  const missingCreatedOperation = {
    kind: 'declaration.rename',
    opId: 'reject-missing-created-ref',
    declaration: {
      entityKind: 'declaration',
      refKind: 'created',
      opId: 'absent-declaration-creator',
      slot: { slotKind: 'fixed', name: 'declaration' },
    },
    expectedPlanningFactSetSha256: HASH_A,
    expectedName: expectedDeclarationNameIdentityV1({
      kind: 'broadcast',
      declarationTarget: {
        targetIndex: 0,
        name: 'Stage',
        isStage: true,
      },
      id: 'unresolved-created-ref',
      name: 'unresolved-created-ref',
    }),
    expectedReferenceSetSha256: HASH_B,
    newName: 'never-applied',
    newNameActivation: {
      expectedActivationSetSha256: HASH_C,
      requireProspectiveActivationCount: 0,
    },
  } as SemanticEditOperationV1
  await assertEditRefusal(
    () =>
      session.preview(
        {
          requestId: 'reject-missing-group-c-created-ref',
          expectedHead: session.head,
          canonicalTransaction: {
            schemaVersion: 1,
            expected: planningHead(session.head, session.sessionId),
            operations: [missingCreatedOperation],
          },
        },
        invocation(25)
      ),
    'edit.created_result_invalid'
  )
  assertAuthoritativeStateUnchanged()

  const forwardCreatedProducer = {
    kind: 'declaration.addBroadcast',
    opId: 'forward-created-producer',
    expectedPlanningFactSetSha256: HASH_A,
    name: 'ForwardSignal',
    nameActivation: {
      expectedActivationSetSha256: HASH_B,
      requireProspectiveActivationCount: 0,
    },
    expectedStageBroadcastMapState: optionalCollectionContainerStateV1(
      scriptCandidate.json.targets[0]?.broadcasts
    ),
  } as SemanticEditOperationV1
  const forwardRenameOperation = {
    ...missingCreatedOperation,
    opId: 'forward-created-consumer',
    declaration: {
      entityKind: 'declaration',
      refKind: 'created',
      opId: 'forward-created-producer',
      slot: { slotKind: 'fixed', name: 'declaration' },
    },
  } as SemanticEditOperationV1
  await assertEditRefusal(
    () =>
      session.preview(
        {
          requestId: 'reject-forward-group-c-created-ref',
          expectedHead: session.head,
          canonicalTransaction: {
            schemaVersion: 1,
            expected: planningHead(session.head, session.sessionId),
            operations: [forwardRenameOperation, forwardCreatedProducer],
          },
        },
        invocation(26)
      ),
    'edit.created_result_invalid'
  )
  assertAuthoritativeStateUnchanged()

  const conflictPlanner = await ProductionBatchPlannerV1.create({
    source: sourceProject,
    sourceBytes,
    session,
    store,
    contract: bound,
    inspection: adversarialInspection,
  })
  const firstConflictingOperation = conflictPlanner.plan({
    kind: 'target.setSpriteProperties',
    opId: 'conflicting-target-write-one',
    target: handleRef(currentSprite, 'target'),
    edits: [
      {
        property: 'x',
        expected: { state: 'value', value: nextX },
        value: nextX + 1,
      },
    ],
  })
  const secondConflictingOperation = conflictPlanner.plan({
    kind: 'target.setSpriteProperties',
    opId: 'conflicting-target-write-two',
    target: handleRef(currentSprite, 'target'),
    edits: [
      {
        property: 'x',
        expected: { state: 'value', value: nextX },
        value: nextX + 2,
      },
    ],
  })
  await assertEditRefusal(
    () =>
      session.preview(
        {
          requestId: 'reject-overlapping-group-c-writes',
          expectedHead: session.head,
          canonicalTransaction: {
            ...conflictPlanner.batch(),
            operations: [firstConflictingOperation, secondConflictingOperation],
          },
        },
        invocation(27)
      ),
    'edit.project_constraint'
  )
  assertAuthoritativeStateUnchanged()

  const unauthorizedPlanner = await ProductionBatchPlannerV1.create({
    source: sourceProject,
    sourceBytes,
    session,
    store,
    contract: bound,
    inspection: adversarialInspection,
  })
  const unauthorizedOperation = unauthorizedPlanner.plan({
    kind: 'target.setSpriteProperties',
    opId: 'reject-unauthorized-target-y',
    target: handleRef(currentSprite, 'target'),
    edits: [
      {
        property: 'y',
        expected: { state: 'value', value: sprite.y },
        value: sprite.y + 1,
      },
    ],
  })
  await assertEditRefusal(
    () =>
      session.preview(
        {
          requestId: 'reject-unauthorized-group-c-leaf',
          expectedHead: session.head,
          canonicalTransaction: {
            ...unauthorizedPlanner.batch(),
            operations: [unauthorizedOperation],
          },
        },
        invocation(28)
      ),
    'edit.unauthorized_change'
  )
  assertAuthoritativeStateUnchanged()

  const topologyPeerBlockEvidence = blockEntityEvidenceSetV1(
    scriptCandidate,
    undefined,
    scriptEntityEvidenceSetV1(scriptCandidate)
  ).find((entry) => entry.targetIndex === 2)
  const topologyPeerBlock = adversarialInspection.items.find(
    (item) =>
      item.entityKind === 'block' &&
      item.semanticLocationSha256 ===
        topologyPeerBlockEvidence?.semanticLocationSha256
  )
  const detachedTopologyComment = adversarialInspection.items.find(
    (item) =>
      item.entityKind === 'comment' && item.attachmentStatus === 'detached'
  )
  assert.ok(topologyPeerBlock && detachedTopologyComment)
  const topologyPlanner = await ProductionBatchPlannerV1.create({
    source: sourceProject,
    sourceBytes,
    session,
    store,
    contract: bound,
    inspection: adversarialInspection,
  })
  const crossTargetAttach = {
    kind: 'comment.attach',
    opId: 'reject-cross-target-comment-attach',
    comment: handleRef(detachedTopologyComment, 'comment'),
    block: handleRef(topologyPeerBlock, 'block'),
    expectedDetached: true,
    expectedPlanningFactSetSha256: HASH_A,
  } as SemanticEditOperationV1
  await assertEditRefusal(
    () =>
      session.preview(
        {
          requestId: 'reject-cross-target-comment-topology',
          expectedHead: session.head,
          canonicalTransaction: {
            ...topologyPlanner.batch(),
            operations: [crossTargetAttach],
          },
        },
        invocation(29)
      ),
    'edit.invalid_owner'
  )
  assertAuthoritativeStateUnchanged()

  const createdBroadcastProject = await ProjectIR.fromSb3(
    await store.readImmutable(session.revisions[3]!.candidateKey)
  )
  const generatedBroadcastId = declarationEntityEvidenceSetV1(
    createdBroadcastProject
  ).find((entry) => entry.rawRef.name === 'PowerSignal')?.declarationId
  const createdCommentProject = await ProjectIR.fromSb3(
    await store.readImmutable(session.revisions[7]!.candidateKey)
  )
  const generatedCommentId = Object.entries(
    createdCommentProject.json.targets[1]?.comments ?? {}
  ).find(([, comment]) => comment.text === 'keep score mutation visible')?.[0]
  assert.ok(generatedBroadcastId && generatedCommentId)
  const forbiddenRetainedValues = [
    generatedBroadcastId,
    generatedCommentId,
    ...GROUP_C_FUTURE_BINDING_KEYS,
    ...[
      inspection,
      targetInspection,
      declarationInspection,
      rerenameInspection,
      valueInspection,
      laterListInspection,
      commentInspection,
      detachInspection,
      commentRemoveInspection,
      scriptInspection,
      adversarialInspection,
    ].flatMap((entry) =>
      entry.items.flatMap((item) => (item.handle ? [item.handle] : []))
    ),
  ]
  for (const revision of session.revisions.slice(1))
  {
    if (revision.transitionDescriptor.kind !== 'apply') continue
    for (const artifactName of [
      'batch.json',
      'resolved-plan.json',
      'operation-results.json',
    ])
    {
      const artifact = new TextDecoder().decode(
        await store.readImmutable(
          revision.manifestKey.replace('manifest.json', artifactName)
        )
      )
      for (const forbidden of forbiddenRetainedValues)
        assert.equal(artifact.includes(forbidden), false)
      for (const forbiddenKey of [
        'targetIndex',
        'declarationId',
        'commentId',
        'topBlockId',
        'blockId',
        'rawRef',
      ])
        assert.equal(
          artifact.includes(`"${forbiddenKey}"`),
          false,
          `${artifactName} at revision ${revision.head.revisionNumber} leaked ${forbiddenKey}`
        )
      assert.equal(artifact.includes('/targets/'), false)
      assert.equal(artifact.includes('"refKind":"handle"'), false)
    }
  }
  for (const revisionNumber of [3, 7])
  {
    const revision = session.revisions[revisionNumber]!
    const batch = new TextDecoder().decode(
      await store.readImmutable(
        revision.manifestKey.replace('manifest.json', 'batch.json')
      )
    )
    assert.equal(batch.includes('"refKind":"created"'), true)
  }

  const undo = await session.undo(
    {
      schemaVersion: 1,
      sessionId: session.sessionId,
      requestId: 'undo-group-c-script-workspace',
      ...expectedHeadRequest(session.head),
      expectedUndoableApplyRevisionId: scriptApply.revisionId,
    },
    invocation(30)
  )
  assert.equal(undo.restoreKind, 'undo')
  assert.equal(undo.selectedRevision.revisionId, removeCommentApply.revisionId)
  assertRestoreLineageHistoryInvariant(session.revisions.at(-1)!)
  const rollback = await session.rollback(
    {
      schemaVersion: 1,
      sessionId: session.sessionId,
      requestId: 'rollback-group-c-target-checkpoint',
      ...expectedHeadRequest(session.head),
      target: {
        kind: 'checkpoint',
        checkpointId: productionCheckpoint.checkpointId,
        expectedCheckpointSha256: productionCheckpoint.checkpointSha256,
      },
    },
    invocation(31)
  )
  assert.equal(rollback.restoreKind, 'rollback')
  assert.equal(rollback.selectedRevision.revisionId, apply.revisionId)
  assert.equal(rollback.head.candidateSha256, apply.head.candidateSha256)
  const rollbackCandidate = await ProjectIR.fromSb3(
    await store.readImmutable(session.revisions.at(-1)!.candidateKey)
  )
  const rollbackSprite = rollbackCandidate.json.targets[1]
  assert.ok(rollbackSprite && !rollbackSprite.isStage)
  assert.deepEqual(rollbackSprite.variables.scoreVarId, [
    GROUP_C_RENAMED_REFERENCED_VARIABLE,
    0,
  ])
  const rollbackScoreField = rollbackSprite.blocks.setvar1
  assert.equal(
    Array.isArray(rollbackScoreField)
      ? undefined
      : rollbackScoreField?.fields?.VARIABLE?.[0],
    GROUP_C_RENAMED_REFERENCED_VARIABLE
  )
  const rollbackScoreReporter = rollbackSprite.blocks.scoreReporter
  assert.equal(
    Array.isArray(rollbackScoreReporter) ? rollbackScoreReporter[1] : undefined,
    GROUP_C_RENAMED_REFERENCED_VARIABLE
  )
  assert.equal(
    rollbackCandidate.json.monitors?.find(
      (monitor) => monitor.id === 'scoreVarId'
    )?.params.VARIABLE,
    GROUP_C_RENAMED_REFERENCED_VARIABLE
  )
  const rollbackRevision = session.revisions.at(-1)!
  assertRestoreLineageHistoryInvariant(rollbackRevision)
  const rollbackActiveLineage = rollbackRevision.activeLineage as {
    records: readonly { lineageId: string; status: string }[]
  }
  const rollbackLineageHistory = rollbackRevision.lineageHistory as {
    records: readonly { lineageId: string; status: string }[]
  }
  const restoredLineageIds = [
    removedObsoleteResult.selectedLineageIds[0]!,
    removeCommentResult.selectedLineageIds[0]!,
  ]
  const postSelectedLineageIds = [
    declarationResults[0]!.fixedSlots[0]!.lineageId,
    declarationResults[4]!.fixedSlots[0]!.lineageId,
    declarationResults[7]!.fixedSlots[0]!.lineageId,
    createdCommentSlot.lineageId,
  ]
  for (const lineageId of restoredLineageIds)
  {
    assert.equal(
      rollbackActiveLineage.records.find(
        (record) => record.lineageId === lineageId
      )?.status,
      'active'
    )
    assert.equal(
      rollbackLineageHistory.records.find(
        (record) => record.lineageId === lineageId
      )?.status,
      'active'
    )
  }
  for (const lineageId of postSelectedLineageIds)
  {
    assert.equal(
      rollbackActiveLineage.records.some(
        (record) => record.lineageId === lineageId
      ),
      false
    )
    assert.equal(
      rollbackLineageHistory.records.find(
        (record) => record.lineageId === lineageId
      )?.status,
      'tombstoned'
    )
  }
  assert.deepEqual(retainedFutureBindingLedger(rollbackRevision), commentLedger)
  const postRollbackInspection = await session.inspect({ issueHandles: true })
  const postRollbackStage = postRollbackInspection.items.find(
    (item) => item.entityKind === 'target' && item.entitySubtype === 'stage'
  )
  assert.ok(postRollbackStage)
  const postRollbackPlanner = await ProductionBatchPlannerV1.create({
    source: sourceProject,
    sourceBytes,
    session,
    store,
    contract: bound,
    inspection: postRollbackInspection,
  })
  const postRollbackStageTarget = postRollbackPlanner.candidate.json.targets[0]
  assert.ok(
    postRollbackStageTarget?.isStage &&
      typeof postRollbackStageTarget.tempo === 'number'
  )
  postRollbackPlanner.add({
    kind: 'target.setStageProperties',
    opId: 'validate-tombstoned-future-ledger',
    target: handleRef(postRollbackStage, 'target'),
    edits: [
      {
        property: 'tempo',
        expected: { state: 'value', value: postRollbackStageTarget.tempo },
        value: postRollbackStageTarget.tempo + 1,
      },
    ],
  })
  const postRollbackPreview = await session.preview(
    {
      requestId: 'preview-group-c-post-rollback-ledger-validation',
      expectedHead: session.head,
      canonicalTransaction: postRollbackPlanner.batch(),
    },
    invocation(802)
  )
  const postRollbackApply = await session.apply(
    {
      schemaVersion: 1,
      sessionId: session.sessionId,
      requestId: 'apply-group-c-post-rollback-ledger-validation',
      ...expectedHeadRequest(postRollbackPreview.preview.expectedHead),
      previewId: postRollbackPreview.preview.previewId,
      applyGuardSha256: postRollbackPreview.preview.applyGuardSha256,
      expectedResolvedPlanSha256:
        postRollbackPreview.preview.resolvedPlanSha256,
    },
    invocation(803)
  )
  assert.equal(
    postRollbackApply.head.revisionNumber,
    rollbackRevision.head.revisionNumber + 1
  )
  const postRollbackApplyRevision = session.revisions.at(-1)!
  assert.deepEqual(
    retainedFutureBindingLedger(postRollbackApplyRevision),
    commentLedger
  )
  const postRollbackApplyActive = postRollbackApplyRevision.activeLineage as {
    records: readonly { lineageId: string }[]
  }
  const postRollbackApplyHistory = postRollbackApplyRevision.lineageHistory as {
    records: readonly { lineageId: string; status: string }[]
  }
  for (const lineageId of postSelectedLineageIds)
  {
    assert.equal(
      postRollbackApplyActive.records.some(
        (record) => record.lineageId === lineageId
      ),
      false
    )
    assert.equal(
      postRollbackApplyHistory.records.find(
        (record) => record.lineageId === lineageId
      )?.status,
      'tombstoned'
    )
  }
  await session.close(
    {
      schemaVersion: 1,
      sessionId: session.sessionId,
      requestId: 'close-group-c-production',
      reason: 'Group C production lifecycle and replay evidence are complete',
      ...expectedHeadRequest(session.head),
    },
    invocation(804)
  )
  const replay = await verifyEditSessionReplayV1({
    artifactStore: store,
    sessionKey: session.manifest.sessionKey,
    boundChangeContract: bound,
    transactionExecutor: new ProductionTransactionExecutorV1(dispatchers),
  })
  assert.deepEqual(replay.failures, [])
  assert.equal(replay.ok, true)
  assert.equal(replay.verifiedRevisionCount, session.revisions.length)
  assert.deepEqual(replay.finalHead, session.head)
  const tamperedReplay = await verifyEditSessionReplayV1({
    artifactStore: tamperedFutureBindingLedgerStore(
      store,
      declarationRevision.manifestKey
    ),
    sessionKey: session.manifest.sessionKey,
    boundChangeContract: bound,
    transactionExecutor: new ProductionTransactionExecutorV1(dispatchers),
  })
  assert.equal(tamperedReplay.ok, false)
  assert.equal(
    tamperedReplay.failures.some((failure) =>
      failure.includes('future-binding ledger differs')
    ),
    true
  )
})

test('Group C cumulative attribution rebases a survivor across earlier sprite removal', async (t) =>
{
  const root = tempRoot(t)
  const fixture = await buildFixtureSb3()
  const sourceProject = await ProjectIR.fromSb3(fixture.sb3)
  const workingSprite = sourceProject.json.targets[1]
  if (!workingSprite || workingSprite.isStage)
    assert.fail('fixture sprite is absent')
  if (typeof workingSprite.x !== 'number')
    assert.fail('fixture sprite x is absent')
  workingSprite.variables.obsoleteVariable = ['obsolete', 0]
  workingSprite.comments ??= {}
  workingSprite.comments.inspectComment = {
    blockId: 'hat1',
    x: 24,
    y: 36,
    width: 180,
    height: 90,
    minimized: false,
    text: 'inspection evidence',
  }
  const workingHat = workingSprite.blocks.hat1
  if (!workingHat || Array.isArray(workingHat))
    assert.fail('fixture hat is absent')
  workingHat.comment = 'inspectComment'
  const disposableSprite = structuredClone(workingSprite)
  disposableSprite.name = 'Disposable Earlier Sprite'
  disposableSprite.layerOrder = 1
  disposableSprite.x = workingSprite.x - 90
  disposableSprite.variables = {}
  disposableSprite.lists = {}
  disposableSprite.broadcasts = {}
  disposableSprite.blocks = {}
  disposableSprite.comments = {}
  workingSprite.layerOrder = 2
  sourceProject.json.targets.splice(1, 0, disposableSprite)
  const sourceBytes = await sourceProject.toSb3()
  const sourceArtifactSha256 = sha256Hex(sourceBytes)
  const nextX = workingSprite.x + 31
  const requiredTargetChange = await requiredTargetChangeEvidence({
    sourceProject,
    sourceBytes,
    nextX,
    targetIndex: 2,
  })
  const { registry: contracts, bound } = registeredContract(
    sourceArtifactSha256,
    sourceProject,
    requiredTargetChange,
    {
      spriteTargetIndex: 2,
      removableSpriteTargetIndex: 1,
    }
  )
  const store = createEditArtifactStoreHostAdapter(root)
  const sessions = createEditSessionRegistryForExecutorV1(
    {
      artifactStore: store,
      changeContracts: contracts,
      identity: {
        realmSha256: HASH_A,
        profileSha256: HASH_B,
        pinnedScratchRuntimeSourceSha256: HASH_C,
        retentionPolicySha256: HASH_D,
        policyConfigVersion: 1,
      },
      clock: deterministicClock(1_753_056_500_000),
      entropy: deterministicEntropy(151),
      handleSecret: new Uint8Array(32).fill(0x72),
    },
    new ProductionTransactionExecutorV1()
  )
  const projectSessionId = 'phase-8-group-c-index-shift'
  const begun = await sessions.begin(
    {
      schemaVersion: 1,
      requestId: 'begin-group-c-index-shift',
      baseline: {
        kind: 'projectSession',
        projectSessionId,
        expectedSourceArtifactSha256: sourceArtifactSha256,
      },
      changeContractRegistrationId: bound.registration.registrationId,
      expectedSemanticContractSha256: bound.registration.semanticContractSha256,
    },
    {
      bytes: sourceBytes,
      displayName: 'phase-8-group-c-index-shift.sb3',
      expectedArtifactSha256: sourceArtifactSha256,
      provenance: {
        kind: 'projectSession',
        projectSessionId,
        selectedDisplayName: 'phase-8-group-c-index-shift.sb3',
        canonicalRealpath: '/virtual/phase-8-group-c-index-shift.sb3',
        device: 'test-device',
        inode: 'group-c-index-shift-inode',
        byteLength: sourceBytes.byteLength,
        modifiedAtNanoseconds: '1753056500000000000',
        sourceInspectionPolicySha256: HASH_A,
        diagnosticPolicySha256: HASH_B,
        runtimePolicySha256: HASH_C,
        provenanceRegistrationSha256: HASH_D,
      },
      recheck: async () => ({
        ok: true,
        observedArtifactSha256: sourceArtifactSha256,
      }),
    },
    invocation(1)
  )
  const session = sessions.session(begun.sessionId)
  const editInspection = await session.inspect({ issueHandles: true })
  const workingTarget = editInspection.items.find(
    (item) => item.entityKind === 'target' && item.serializedTargetOrdinal === 2
  )
  assert.ok(workingTarget)
  const editPlanner = await ProductionBatchPlannerV1.create({
    source: sourceProject,
    sourceBytes,
    session,
    store,
    contract: bound,
    inspection: editInspection,
  })
  editPlanner.add({
    kind: 'target.setSpriteProperties',
    opId: 'edit-later-sprite-before-shift',
    target: handleRef(workingTarget, 'target'),
    edits: [
      {
        property: 'x',
        expected: { state: 'value', value: workingSprite.x },
        value: nextX,
      },
    ],
  })
  const editPreview = await session.preview(
    {
      requestId: 'preview-later-sprite-before-shift',
      expectedHead: session.head,
      canonicalTransaction: editPlanner.batch(),
    },
    invocation(2)
  )
  const editApply = await session.apply(
    {
      schemaVersion: 1,
      sessionId: session.sessionId,
      requestId: 'apply-later-sprite-before-shift',
      ...expectedHeadRequest(editPreview.preview.expectedHead),
      previewId: editPreview.preview.previewId,
      applyGuardSha256: editPreview.preview.applyGuardSha256,
      expectedResolvedPlanSha256: editPreview.preview.resolvedPlanSha256,
    },
    invocation(3)
  )
  assert.equal(editApply.head.revisionNumber, 1)
  const editOccurrence = (
    session.revisions[1]!.authorization as {
      contractAuthorization: {
        operationScopeEvidence: readonly {
          opId: string
          occurrenceId: string
        }[]
      }
    }
  ).contractAuthorization.operationScopeEvidence.find(
    (entry) => entry.opId === 'edit-later-sprite-before-shift'
  )?.occurrenceId
  assert.match(editOccurrence ?? '', /^[a-f0-9]{64}$/u)

  const removeInspection = await session.inspect({ issueHandles: true })
  const disposableTarget = removeInspection.items.find(
    (item) => item.entityKind === 'target' && item.serializedTargetOrdinal === 1
  )
  assert.ok(disposableTarget)
  const removePlanner = await ProductionBatchPlannerV1.create({
    source: sourceProject,
    sourceBytes,
    session,
    store,
    contract: bound,
    inspection: removeInspection,
  })
  const disposableIndex = 1
  const removalLineage = session.revisions.at(-1)!
    .activeLineage as ProductionOperationContextV1['activeLineage']
  const removalOrder = targetDualOrderSnapshotV1(
    removePlanner.candidate.json,
    removalLineage
  )
  const removalInbound = targetInboundReferenceSetV1(
    removePlanner.candidate,
    buildSemanticReferenceIndex(removePlanner.candidate),
    disposableIndex
  )
  removePlanner.add({
    kind: 'target.removeSprite',
    opId: 'remove-earlier-sprite',
    target: handleRef(disposableTarget, 'target'),
    expectedInboundReferenceSetSha256: removalInbound.referenceSetSha256,
    expectedOwnedSurfaceSha256: targetOwnedSurfaceSha256V1(
      removePlanner.candidate.json.targets[disposableIndex]!
    ),
    expectedSerializedTargetOrderSha256:
      removalOrder.serializedTargetOrderSha256,
    expectedVisualLayerOrderSha256: removalOrder.visualLayerOrderSha256,
    requireFinalInboundReferenceCount: 0,
  })
  const removePreview = await session.preview(
    {
      requestId: 'preview-remove-earlier-sprite',
      expectedHead: session.head,
      canonicalTransaction: removePlanner.batch(),
    },
    invocation(4)
  )
  const removeApply = await session.apply(
    {
      schemaVersion: 1,
      sessionId: session.sessionId,
      requestId: 'apply-remove-earlier-sprite',
      ...expectedHeadRequest(removePreview.preview.expectedHead),
      previewId: removePreview.preview.previewId,
      applyGuardSha256: removePreview.preview.applyGuardSha256,
      expectedResolvedPlanSha256: removePreview.preview.resolvedPlanSha256,
    },
    invocation(5)
  )
  assert.equal(removeApply.head.revisionNumber, 2)
  const removeResult = removeApply.operationResults[0] as {
    selectedLineageIds: readonly string[]
  }
  const removedTargetLineageId = removeResult.selectedLineageIds[0]
  assert.match(removedTargetLineageId ?? '', /^[a-f0-9]{64}$/u)
  const removeOccurrence = (
    session.revisions[2]!.authorization as {
      contractAuthorization: {
        operationScopeEvidence: readonly {
          opId: string
          occurrenceId: string
        }[]
      }
    }
  ).contractAuthorization.operationScopeEvidence.find(
    (entry) => entry.opId === 'remove-earlier-sprite'
  )?.occurrenceId
  assert.match(removeOccurrence ?? '', /^[a-f0-9]{64}$/u)

  const cumulativeDelta = session.revisions[2]!.cumulativeDelta as {
    targets: readonly {
      beforeTargetIndex?: number
      afterTargetIndex?: number
      operationIds: readonly string[]
      gameplayPropertyChanges: readonly {
        path: string
        operationIds: readonly string[]
      }[]
    }[]
    protectedChanges: readonly { operationIds: readonly string[] }[]
  }
  const survivor = cumulativeDelta.targets.find(
    (target) => target.beforeTargetIndex === 2 && target.afterTargetIndex === 1
  )
  const removed = cumulativeDelta.targets.find(
    (target) =>
      target.beforeTargetIndex === 1 && target.afterTargetIndex === undefined
  )
  assert.ok(survivor && removed)
  assert.equal(
    survivor.gameplayPropertyChanges.some(
      (change) =>
        change.path === '/targets/1/x' &&
        change.operationIds.includes(editOccurrence!)
    ),
    true
  )
  assert.equal(
    operationIdArrays(removed).every(
      (operationIds) =>
        operationIds.length > 0 &&
        operationIds.every((operationId) => operationId === removeOccurrence)
    ),
    true
  )
  assert.equal(
    operationIdArrays(cumulativeDelta).every(
      (operationIds) => operationIds.length > 0
    ),
    true
  )
  assert.equal(
    cumulativeDelta.protectedChanges.every(
      (change) => change.operationIds.length > 0
    ),
    true
  )
  assert.deepEqual(
    (
      session.revisions[2]!.authorization as {
        violations: readonly unknown[]
      }
    ).violations,
    []
  )
  const shiftedCandidate = await ProjectIR.fromSb3(
    await store.readImmutable(session.revisions[2]!.candidateKey)
  )
  const shiftedSprite = shiftedCandidate.json.targets[1]
  assert.ok(shiftedSprite && !shiftedSprite.isStage)
  assert.equal(shiftedSprite.name, workingSprite.name)
  assert.equal(shiftedSprite.x, nextX)
  const undo = await session.undo(
    {
      schemaVersion: 1,
      sessionId: session.sessionId,
      requestId: 'undo-remove-earlier-sprite',
      ...expectedHeadRequest(session.head),
      expectedUndoableApplyRevisionId: removeApply.revisionId,
    },
    invocation(6)
  )
  assert.equal(undo.selectedRevision.revisionId, editApply.revisionId)
  const restoredRevision = session.revisions.at(-1)!
  assertRestoreLineageHistoryInvariant(restoredRevision)
  const restoredActive = restoredRevision.activeLineage as {
    records: readonly { lineageId: string; status: string }[]
  }
  const restoredHistory = restoredRevision.lineageHistory as {
    records: readonly { lineageId: string; status: string }[]
  }
  assert.equal(
    restoredActive.records.find(
      (record) => record.lineageId === removedTargetLineageId
    )?.status,
    'active'
  )
  assert.equal(
    restoredHistory.records.find(
      (record) => record.lineageId === removedTargetLineageId
    )?.status,
    'active'
  )
  const restoredCandidate = await ProjectIR.fromSb3(
    await store.readImmutable(restoredRevision.candidateKey)
  )
  assert.equal(restoredCandidate.json.targets.length, 3)
  const restoredWorkingSprite = restoredCandidate.json.targets[2]
  assert.ok(restoredWorkingSprite && !restoredWorkingSprite.isStage)
  assert.equal(restoredWorkingSprite.name, workingSprite.name)
  assert.equal(restoredWorkingSprite.x, nextX)
  await session.close(
    {
      schemaVersion: 1,
      sessionId: session.sessionId,
      requestId: 'close-group-c-index-shift',
      reason: 'target index shift restore and replay evidence are complete',
      ...expectedHeadRequest(session.head),
    },
    invocation(7)
  )
  const replay = await verifyEditSessionReplayV1({
    artifactStore: store,
    sessionKey: session.manifest.sessionKey,
    boundChangeContract: bound,
    transactionExecutor: new ProductionTransactionExecutorV1(),
  })
  assert.deepEqual(replay.failures, [])
  assert.equal(replay.ok, true)
  assert.equal(replay.verifiedRevisionCount, session.revisions.length)
  assert.deepEqual(replay.finalHead, session.head)
})

test('Group C cumulative attribution retains descendant writers for added entities', () =>
{
  const creator = '1'.repeat(64)
  const descendantWriter = '2'.repeat(64)
  const priorWriter = '3'.repeat(64)
  const latestWriter = '4'.repeat(64)
  const mediaCreator = '5'.repeat(64)
  const mediaWriter = '6'.repeat(64)
  const summary = {
    touchedTargets: 0,
    touchedScripts: 0,
    addedBlocks: 0,
    removedBlocks: 0,
    changedBlockRecords: 0,
    changedAuthoredBlocks: 0,
    graphLinkOnlyBlocks: 0,
    changedDeclarations: 0,
    changedGameplayProperties: 0,
    changedExistingEditorLayout: 0,
    changedAssets: 0,
    changedProjectMetadata: 0,
    changedUnknownFields: 0,
  }
  const delta = (
    declarationPath: string,
    declarationKind: 'added' | 'changed',
    declarationOperationIds: readonly string[],
    xOperationIds: readonly string[],
    mediaPath: string,
    mediaKind: 'added' | 'changed',
    mediaOperationIds: readonly string[],
    protectRoots = false
  ): ProjectDelta => ({
    complete: true,
    targets: [
      {
        targetIndex: 0,
        lineageId: 'target-lineage',
        operationIds: [...declarationOperationIds, ...xOperationIds],
        touchedScripts: [],
        blockChanges: [],
        declarationChanges: [
          {
            path: declarationPath,
            kind: declarationKind,
            ...(declarationKind === 'changed' ? { before: 0 } : {}),
            after: declarationPath.endsWith('/1') ? 9 : ['score', 9],
            operationIds: [...declarationOperationIds],
            entityLineageIds: ['declaration-lineage'],
          },
        ],
        gameplayPropertyChanges: [
          {
            path: '/targets/0/x',
            kind: 'changed',
            before: 10,
            after: 20,
            operationIds: [...xOperationIds],
          },
        ],
        assetMetadataChanges: [],
        existingEditorLayoutChanges: [],
        structureChanges: [],
        unknownChanges: [],
      },
    ],
    assets: [],
    projectChanges: [],
    correspondedEntityChanges: [
      {
        collectionKind: 'costumes',
        collectionPath: '/targets/0/costumes',
        ownerLineageId: 'target-lineage',
        entityLineageId: 'costume-lineage',
        changes: [
          {
            path: mediaPath,
            kind: mediaKind,
            ...(mediaKind === 'changed' ? { before: 'old' } : {}),
            after: mediaPath.endsWith('/name')
              ? 'updated costume'
              : { name: 'updated costume' },
            operationIds: [...mediaOperationIds],
            entityLineageIds: ['costume-lineage'],
          },
        ],
      },
    ],
    protectedChanges: protectRoots
      ? [
          {
            class: 'declaration',
            path: '/targets/0/variables/variable-id',
            operationIds: [],
            entityLineageIds: ['declaration-lineage'],
            mandatory: false,
            detail: 'created declaration changed',
          },
          {
            class: 'asset',
            path: '/targets/0/costumes/$members/costume-lineage',
            operationIds: [],
            entityLineageIds: ['costume-lineage'],
            mandatory: false,
            detail: 'created costume changed',
          },
        ]
      : [],
    summary,
  })
  const prior = delta(
    '/targets/0/variables/variable-id',
    'added',
    [creator],
    [priorWriter],
    '/targets/0/costumes/$members/costume-lineage',
    'added',
    [mediaCreator]
  )
  const parent = delta(
    '/targets/0/variables/variable-id/1',
    'changed',
    [descendantWriter],
    [latestWriter],
    '/targets/0/costumes/$members/costume-lineage/name',
    'changed',
    [mediaWriter]
  )
  const draft = delta(
    '/targets/0/variables/variable-id',
    'added',
    [],
    [],
    '/targets/0/costumes/$members/costume-lineage',
    'added',
    [],
    true
  )
  const cumulative = composeCumulativeProjectDeltaAttributionV1(
    prior,
    parent,
    draft
  )
  assert.deepEqual(cumulative.targets[0]?.declarationChanges[0]?.operationIds, [
    creator,
    descendantWriter,
  ])
  assert.deepEqual(
    cumulative.correspondedEntityChanges?.[0]?.changes[0]?.operationIds,
    [mediaCreator, mediaWriter]
  )
  assert.deepEqual(
    cumulative.targets[0]?.gameplayPropertyChanges[0]?.operationIds,
    [latestWriter]
  )
  assert.deepEqual(
    cumulative.protectedChanges.map((change) => change.operationIds),
    [
      [creator, descendantWriter],
      [mediaCreator, mediaWriter],
    ]
  )
})

test('Group C candidate admission elevates an injected broken reference', async (t) =>
{
  const root = tempRoot(t)
  const fixture = await buildFixtureSb3()
  const sourceProject = await ProjectIR.fromSb3(fixture.sb3)
  const sprite = sourceProject.json.targets[1]
  if (!sprite || sprite.isStage || typeof sprite.x !== 'number')
    assert.fail('fixture sprite is absent')
  sprite.variables.obsoleteVariable = ['obsolete', 0]
  sprite.comments ??= {}
  sprite.comments.inspectComment = {
    blockId: 'hat1',
    x: 24,
    y: 36,
    width: 180,
    height: 90,
    minimized: false,
    text: 'inspection evidence',
  }
  const hat = sprite.blocks.hat1
  if (!hat || Array.isArray(hat)) assert.fail('fixture hat is absent')
  hat.comment = 'inspectComment'
  const sourceBytes = await sourceProject.toSb3()
  const sourceArtifactSha256 = sha256Hex(sourceBytes)
  const nextX = sprite.x + 19
  const requiredTargetChange = await requiredTargetChangeEvidence({
    sourceProject,
    sourceBytes,
    nextX,
  })
  const { registry: contracts, bound } = registeredContract(
    sourceArtifactSha256,
    sourceProject,
    requiredTargetChange
  )
  const store = createEditArtifactStoreHostAdapter(root)
  const targetDispatcher = new TargetProductionOperationDispatcherV1()
  const corruptingDispatcher: ProductionOperationDispatcherV1 = {
    operationKinds: targetDispatcher.operationKinds,
    execute(context, operation)
    {
      const result = targetDispatcher.execute(context, operation)
      const editedSprite = context.candidate.json.targets[1]
      const setVariable = editedSprite?.blocks.setvar1
      if (!editedSprite || editedSprite.isStage || !setVariable)
        assert.fail('trusted corruption seam target is absent')
      if (Array.isArray(setVariable))
        assert.fail('trusted corruption seam block is primitive-form')
      setVariable.fields ??= {}
      setVariable.fields.VARIABLE = ['score', 'dangling-declaration-id']
      return result
    },
  }
  const sessions = createEditSessionRegistryForExecutorV1(
    {
      artifactStore: store,
      changeContracts: contracts,
      identity: {
        realmSha256: HASH_A,
        profileSha256: HASH_B,
        pinnedScratchRuntimeSourceSha256: HASH_C,
        retentionPolicySha256: HASH_D,
        policyConfigVersion: 1,
      },
      clock: deterministicClock(1_753_056_700_000),
      entropy: deterministicEntropy(171),
      handleSecret: new Uint8Array(32).fill(0x83),
    },
    new ProductionTransactionExecutorV1([corruptingDispatcher])
  )
  const projectSessionId = 'phase-8-group-c-broken-reference'
  const begun = await sessions.begin(
    {
      schemaVersion: 1,
      requestId: 'begin-group-c-broken-reference',
      baseline: {
        kind: 'projectSession',
        projectSessionId,
        expectedSourceArtifactSha256: sourceArtifactSha256,
      },
      changeContractRegistrationId: bound.registration.registrationId,
      expectedSemanticContractSha256: bound.registration.semanticContractSha256,
    },
    {
      bytes: sourceBytes,
      displayName: 'phase-8-group-c-broken-reference.sb3',
      expectedArtifactSha256: sourceArtifactSha256,
      provenance: {
        kind: 'projectSession',
        projectSessionId,
        selectedDisplayName: 'phase-8-group-c-broken-reference.sb3',
        canonicalRealpath: '/virtual/phase-8-group-c-broken-reference.sb3',
        device: 'test-device',
        inode: 'group-c-broken-reference-inode',
        byteLength: sourceBytes.byteLength,
        modifiedAtNanoseconds: '1753056700000000000',
        sourceInspectionPolicySha256: HASH_A,
        diagnosticPolicySha256: HASH_B,
        runtimePolicySha256: HASH_C,
        provenanceRegistrationSha256: HASH_D,
      },
      recheck: async () => ({
        ok: true,
        observedArtifactSha256: sourceArtifactSha256,
      }),
    },
    invocation(1)
  )
  const session = sessions.session(begun.sessionId)
  const inspection = await session.inspect({ issueHandles: true })
  const spriteItem = inspection.items.find(
    (item) => item.entityKind === 'target' && item.entitySubtype === 'sprite'
  )
  assert.ok(spriteItem)
  const planner = await ProductionBatchPlannerV1.create({
    source: sourceProject,
    sourceBytes,
    session,
    store,
    contract: bound,
    inspection,
  })
  planner.add({
    kind: 'target.setSpriteProperties',
    opId: 'inject-broken-reference-after-target-edit',
    target: handleRef(spriteItem, 'target'),
    edits: [
      {
        property: 'x',
        expected: { state: 'value', value: sprite.x },
        value: nextX,
      },
    ],
  })
  const beforeHead = structuredClone(session.head)
  const beforeRevision = structuredClone(session.revisions[0])
  const beforeCandidate = await store.readImmutable(
    session.revisions[0]!.candidateKey
  )
  await assertEditRefusal(
    () =>
      session.preview(
        {
          requestId: 'reject-injected-broken-reference',
          expectedHead: session.head,
          canonicalTransaction: planner.batch(),
        },
        invocation(2)
      ),
    'edit.graph_failed'
  )
  assert.deepEqual(session.head, beforeHead)
  assert.equal(session.revisions.length, 1)
  assert.deepEqual(session.revisions[0], beforeRevision)
  assert.deepEqual(
    await store.readImmutable(session.revisions[0]!.candidateKey),
    beforeCandidate
  )
})

test('Group D production lifecycle authors a script, realizes fixed and dynamic future bindings, and exactly replays', async (t) =>
{
  const root = tempRoot(t)
  const fixture = await buildFixtureSb3()
  const sourceProject = await ProjectIR.fromSb3(fixture.sb3)
  const sourceBytes = await sourceProject.toSb3()
  const sourceArtifactSha256 = sha256Hex(sourceBytes)
  const groupD = registeredScriptBlockContracts(sourceArtifactSha256, sourceProject)
  const store = createEditArtifactStoreHostAdapter(root)
  const dispatchers: readonly ProductionOperationDispatcherV1[] = [
    ...scriptBlockProductionOperationDispatchersV1(),
  ]
  const sessions = createEditSessionRegistryForExecutorV1(
    {
      artifactStore: store,
      changeContracts: groupD.registry,
      identity: {
        realmSha256: HASH_A,
        profileSha256: HASH_B,
        pinnedScratchRuntimeSourceSha256: HASH_C,
        retentionPolicySha256: HASH_D,
        policyConfigVersion: 1,
      },
      clock: deterministicClock(1_753_056_000_000),
      entropy: deterministicEntropy(101),
      handleSecret: new Uint8Array(32).fill(0x61),
    },
    new ProductionTransactionExecutorV1(dispatchers)
  )
  const projectSessionId = 'phase-8-group-d-production'
  const begun = await sessions.begin(
    {
      schemaVersion: 1,
      requestId: 'begin-group-d-production',
      baseline: {
        kind: 'projectSession',
        projectSessionId,
        expectedSourceArtifactSha256: sourceArtifactSha256,
      },
      changeContractRegistrationId: groupD.valid.registration.registrationId,
      expectedSemanticContractSha256:
        groupD.valid.registration.semanticContractSha256,
    },
    {
      bytes: sourceBytes,
      displayName: 'phase-8-group-d-production.sb3',
      expectedArtifactSha256: sourceArtifactSha256,
      provenance: {
        kind: 'projectSession',
        projectSessionId,
        selectedDisplayName: 'phase-8-group-d-production.sb3',
        canonicalRealpath: '/virtual/phase-8-group-d-production.sb3',
        device: 'test-device',
        inode: 'group-d-production-inode',
        byteLength: sourceBytes.byteLength,
        modifiedAtNanoseconds: '1753056000000000000',
        sourceInspectionPolicySha256: HASH_A,
        diagnosticPolicySha256: HASH_B,
        runtimePolicySha256: HASH_C,
        provenanceRegistrationSha256: HASH_D,
      },
      recheck: async () => ({
        ok: true,
        observedArtifactSha256: sourceArtifactSha256,
      }),
    },
    invocation(1)
  )
  const session = sessions.session(begun.sessionId)
  const inspection = await session.inspect({ issueHandles: true })
  const planner = await ProductionBatchPlannerV1.create({
    source: sourceProject,
    sourceBytes,
    session,
    store,
    contract: groupD.valid,
    inspection,
  })
  const spriteIndex = planner.candidate.json.targets.findIndex(
    (entry) => !entry.isStage
  )
  assert.ok(spriteIndex >= 0)
  const blockIdsBefore = new Set(
    Object.keys(planner.candidate.json.targets[spriteIndex]!.blocks)
  )
  planner.add(groupD.scriptAdd)
  const sayBlockId = Object.entries(
    planner.candidate.json.targets[spriteIndex]!.blocks
  ).find(
    ([blockId, entry]) =>
      !blockIdsBefore.has(blockId) &&
      !Array.isArray(entry) &&
      (entry as { opcode?: string }).opcode === 'looks_say'
  )?.[0]
  assert.ok(sayBlockId, 'script.add did not author a looks_say block')
  planner.add({
    kind: 'block.setInput',
    opId: 'group-d-set-say-message',
    block: groupD.createdSayRef,
    inputName: 'MESSAGE',
    expectedInputFingerprint: blockInputFingerprintV1(
      spriteIndex,
      sayBlockId,
      'MESSAGE',
      (
        planner.candidate.json.targets[spriteIndex]!.blocks[sayBlockId] as {
          inputs?: Record<string, never>
        }
      ).inputs?.MESSAGE
    ),
    replacedInput: { kind: 'requireNoOwnedBlock' },
    value: { valueKind: 'literal', value: 'goodbye' },
  } as UnplannedSemanticEditOperationV1)
  const preview = await session.preview(
    {
      requestId: 'preview-group-d-production',
      expectedHead: session.head,
      canonicalTransaction: planner.batch(),
    },
    invocation(2)
  )
  assert.equal(preview.preview.operationCount, 2)
  const apply = await session.apply(
    {
      schemaVersion: 1,
      sessionId: session.sessionId,
      requestId: 'apply-group-d-production',
      ...expectedHeadRequest(preview.preview.expectedHead),
      previewId: preview.preview.previewId,
      applyGuardSha256: preview.preview.applyGuardSha256,
      expectedResolvedPlanSha256: preview.preview.resolvedPlanSha256,
    },
    invocation(3)
  )
  assert.equal(
    apply.head.candidateSha256,
    preview.preview.predictedCandidateSha256
  )
  const revision = session.revisions.at(-1)!
  const ledger = retainedFutureBindingLedger(revision)
  assert.equal(ledger.realizations.length, 3)
  assertHashOnlyFutureBindingRows(
    ledger.realizations,
    GROUP_D_FUTURE_BINDING_KEYS
  )
  // G5 attribution: every Group D operation must be attributed into the parent
  // delta by its occurrence id, not merely listed in the operation results
  const groupDAuthorization = revision.authorization as {
    contractAuthorization: {
      operationScopeEvidence: readonly {
        opId: string
        occurrenceId: string
      }[]
    }
  }
  const groupDOperationIds = [
    'group-d-add-authored-script',
    'group-d-set-say-message',
  ]
  const groupDOccurrences =
    groupDAuthorization.contractAuthorization.operationScopeEvidence.filter(
      (entry) => groupDOperationIds.includes(entry.opId)
    )
  assert.deepEqual(
    groupDOccurrences.map((entry) => entry.opId).sort(),
    [...groupDOperationIds].sort()
  )
  const groupDParentOperationIds = operationIdArrays(
    revision.parentDelta
  ).flat()
  for (const occurrence of groupDOccurrences)
  {
    assert.match(occurrence.occurrenceId, /^[a-f0-9]{64}$/u)
    assert.equal(
      groupDParentOperationIds.includes(occurrence.occurrenceId),
      true,
      `${occurrence.opId} is absent from the Group D parent delta`
    )
  }
  const replay = await verifyEditSessionReplayV1({
    artifactStore: store,
    sessionKey: session.manifest.sessionKey,
    boundChangeContract: groupD.valid,
    transactionExecutor: new ProductionTransactionExecutorV1(dispatchers),
  })
  assert.deepEqual(replay.failures, [])
  assert.equal(replay.ok, true)
  assert.equal(replay.verifiedRevisionCount, session.revisions.length)
  assert.deepEqual(replay.finalHead, session.head)
})

// the gate's procedure keeps one parameter type across all slots, so a reorder
// leaves the placeholder run fixed & moves only ordinals
function procedureFixtureSignature(
  order: readonly string[],
  warp: boolean
): Extract<
  SemanticEditOperationV1,
  { kind: 'procedure.updateSignature' }
>['signature']
{
  return {
    parts: [
      { kind: 'label', text: 'probe' },
      ...order.map((localKey) => ({
        kind: 'parameter' as const,
        localKey,
        name: localKey,
        parameterType: 'stringOrNumber' as const,
        defaultValue: '',
      })),
    ],
    warp,
  }
}

// the frozen signature-state & call-set digests the dispatcher enforces; the
// test recomputes them so a formula change fails the gate rather than passing
function procedureFixtureSignatureStateSha256(
  project: ProjectIR,
  targetIndex: number,
  proccode: string
): string
{
  const record = resolveProcedureRecordV1(project, targetIndex, proccode)
  return semanticHashV1('evidence-content', {
    kind: 'procedure-signature-state',
    schemaVersion: 1,
    targetIndex,
    proccode: record.proccode,
    warp: record.warp,
    argumentIds: record.argumentIds,
    argumentNames: record.argumentNames,
    argumentDefaults: record.argumentDefaults,
  })
}

function procedureFixtureCallSetSha256(
  project: ProjectIR,
  targetIndex: number,
  proccode: string
): string
{
  return semanticHashV1('evidence-content', {
    kind: 'procedure-call-set',
    schemaVersion: 1,
    targetIndex,
    proccode,
    calls: procedureCallSitesV1(project, targetIndex, proccode).map((site) => ({
      blockId: site.blockId,
      argumentIds: site.argumentIds,
    })),
  })
}

function procedureFixtureRef(
  project: ProjectIR,
  targetIndex: number,
  proccode: string
): Extract<SemanticEditOperationV1, { kind: 'procedure.remove' }>['procedure']
{
  const evidence = procedureEntityEvidenceSetV1(project).find(
    (entry) => entry.targetIndex === targetIndex && entry.proccode === proccode
  )
  assert.ok(evidence, `procedure ${proccode} is absent`)
  return {
    entityKind: 'procedure',
    refKind: 'structural',
    selectorKind: 'exactLocation',
    location: {
      kind: 'procedure',
      targetLocationSha256: semanticHashV1(
        'semantic-location',
        evidence.location.target
      ),
      canonicalSignature: boundedDisplayStringV1(
        evidence.location.canonicalSignature
      ) as never,
      semanticFingerprint: evidence.semanticFingerprintSha256,
      fullLocationSha256: evidence.semanticLocationSha256,
      retainedLocationArtifactId: `procedure-location-${evidence.semanticLocationSha256.slice(0, 32)}`,
    },
    expectedFullLocationSha256: evidence.semanticLocationSha256,
    expectedSemanticFingerprint: evidence.semanticFingerprintSha256,
    expectedContextFingerprint: evidence.contextFingerprintSha256,
  }
}

function procedureFixtureParameterRef(
  project: ProjectIR,
  targetIndex: number,
  proccode: string,
  name: string
): Extract<
  SemanticEditOperationV1,
  { kind: 'procedure.setCallArgument' }
>['parameter']
{
  const evidence = parameterEntityEvidenceSetV1(project).find(
    (entry) =>
      entry.targetIndex === targetIndex &&
      entry.proccode === proccode &&
      entry.location.name === name
  )
  assert.ok(evidence, `parameter ${name} is absent`)
  return {
    entityKind: 'parameter',
    refKind: 'structural',
    selectorKind: 'exactLocation',
    location: {
      kind: 'parameter',
      name: boundedDisplayStringV1(evidence.location.name) as never,
      ordinal: evidence.ordinal,
      parameterType: evidence.parameterType,
      procedureLocationSha256: semanticHashV1(
        'semantic-location',
        evidence.location.procedure
      ),
      semanticFingerprint: evidence.semanticFingerprintSha256,
      fullLocationSha256: evidence.semanticLocationSha256,
      retainedLocationArtifactId: `parameter-location-${evidence.semanticLocationSha256.slice(0, 32)}`,
    },
    expectedFullLocationSha256: evidence.semanticLocationSha256,
    expectedSemanticFingerprint: evidence.semanticFingerprintSha256,
    expectedContextFingerprint: evidence.contextFingerprintSha256,
  }
}

// the Group E gate needs a source that already owns a well-formed procedure w/
// one call site & one body reporter; the shared fixture has none
async function buildProcedureFixtureSb3(
  options: { readonly foreignCollision?: boolean } = {}
): Promise<Uint8Array>
{
  const fixture = await buildFixtureSb3()
  const project = await ProjectIR.fromSb3(fixture.sb3)
  const json = project.toProjectJson()
  const sprite = json.targets[1] as unknown as {
    blocks: Record<string, unknown>
  }
  const reporter = (
    parent: string,
    name: string,
    shadow: boolean
  ): unknown => ({
    opcode: 'argument_reporter_string_number',
    next: null,
    parent,
    inputs: {},
    fields: { VALUE: [name, null] },
    shadow,
    topLevel: false,
  })
  sprite.blocks['edef'] = {
    opcode: 'procedures_definition',
    next: 'esay',
    parent: null,
    inputs: { custom_block: [1, 'eproto'] },
    fields: {},
    shadow: false,
    topLevel: true,
    x: 320,
    y: 240,
  }
  sprite.blocks['eproto'] = {
    opcode: 'procedures_prototype',
    next: null,
    parent: 'edef',
    inputs: { a1: [1, 'erep1'], a2: [1, 'erep2'], a3: [1, 'erep3'] },
    fields: {},
    shadow: true,
    topLevel: false,
    mutation: {
      tagName: 'mutation',
      children: [],
      proccode: 'probe %s %s %s',
      argumentids: '["a1","a2","a3"]',
      argumentnames: '["alpha","bravo","charlie"]',
      argumentdefaults: '["","",""]',
      warp: 'false',
    },
  }
  sprite.blocks['erep1'] = reporter('eproto', 'alpha', true)
  sprite.blocks['erep2'] = reporter('eproto', 'bravo', true)
  sprite.blocks['erep3'] = reporter('eproto', 'charlie', true)
  sprite.blocks['esay'] = {
    opcode: 'looks_say',
    next: null,
    parent: 'edef',
    inputs: { MESSAGE: [3, 'ebodyrep', [10, '']] },
    fields: {},
    shadow: false,
    topLevel: false,
  }
  sprite.blocks['ebodyrep'] = reporter('esay', 'alpha', false)
  // the call hangs off the existing green-flag stack so it is never dead code
  ;(sprite.blocks['changex1'] as { next: string | null }).next = 'ecall'
  sprite.blocks['ecall'] = {
    opcode: 'procedures_call',
    next: null,
    parent: 'changex1',
    inputs: {
      a1: [1, [10, 'one']],
      a2: [1, [10, 'two']],
      a3: [1, [10, 'three']],
    },
    fields: {},
    shadow: false,
    topLevel: false,
    mutation: {
      tagName: 'mutation',
      children: [],
      proccode: 'probe %s %s %s',
      argumentids: '["a1","a2","a3"]',
      warp: 'false',
    },
  }
  // a second, complete procedure that already owns the proccode the gate's
  // rename would produce; the source stays diagnostic-clean
  if (options.foreignCollision === true)
  {
    sprite.blocks['fdef'] = {
      opcode: 'procedures_definition',
      next: null,
      parent: null,
      inputs: { custom_block: [1, 'fproto'] },
      fields: {},
      shadow: false,
      topLevel: true,
      x: 320,
      y: 480,
    }
    sprite.blocks['fproto'] = {
      opcode: 'procedures_prototype',
      next: null,
      parent: 'fdef',
      inputs: {
        z1: [1, 'frep1'],
        z2: [1, 'frep2'],
        z3: [1, 'frep3'],
        z4: [1, 'frep4'],
      },
      fields: {},
      shadow: true,
      topLevel: false,
      mutation: {
        tagName: 'mutation',
        children: [],
        proccode: 'probe %s %s %s %s',
        argumentids: '["z1","z2","z3","z4"]',
        argumentnames: '["one","two","three","four"]',
        argumentdefaults: '["","","",""]',
        warp: 'false',
      },
    }
    for (const [id, name] of [
      ['frep1', 'one'],
      ['frep2', 'two'],
      ['frep3', 'three'],
      ['frep4', 'four'],
    ] as const)
      sprite.blocks[id] = reporter('fproto', name, true)
    ;(sprite.blocks['ecall'] as { next: string | null }).next = 'fcall'
    sprite.blocks['fcall'] = {
      opcode: 'procedures_call',
      next: null,
      parent: 'ecall',
      inputs: {
        z1: [1, [10, 'a']],
        z2: [1, [10, 'b']],
        z3: [1, [10, 'c']],
        z4: [1, [10, 'd']],
      },
      fields: {},
      shadow: false,
      topLevel: false,
      mutation: {
        tagName: 'mutation',
        children: [],
        proccode: 'probe %s %s %s %s',
        argumentids: '["z1","z2","z3","z4"]',
        warp: 'false',
      },
    }
  }
  return packSb3(JSON.stringify(json), project.assets)
}

const GROUP_E_SOURCE_PROCCODE = 'probe %s %s %s'
const GROUP_E_UPDATED_PROCCODE = 'probe %s %s %s %s'

// the reordered signature: charlie & alpha & bravo rotate, delta is new, & warp
// flips, so one operation proves reorder, add, & warp mapping together
const GROUP_E_UPDATED_ORDER = Object.freeze([
  'charlie',
  'alpha',
  'bravo',
  'delta',
])

function registeredProcedureContracts(
  sourceArtifactSha256: string,
  sourceProject: ProjectIR
): {
  readonly registry: EditChangeContractRegistryV1
  readonly valid: BoundChangeContractV1
  readonly updateSignature: UnplannedSemanticEditOperationV1
  readonly spriteTargetIndex: number
}
{
  const sprite = targetEntityEvidenceSetV1(sourceProject.json).find(
    (entry) => entry.targetKind === 'sprite'
  )
  assert.ok(sprite)
  const targetIndex = sprite.targetIndex
  const spriteContractRef = spriteBindingRef()
  const procedureContractRef = {
    contractRefKind: 'existing',
    entityKind: 'procedure',
    entitySubtype: 'unspecialized',
    bindingKey: 'group-e-source-procedure',
  } as const
  const procedureEvidence = procedureEntityEvidenceSetV1(sourceProject).find(
    (entry) =>
      entry.targetIndex === targetIndex &&
      entry.proccode === GROUP_E_SOURCE_PROCCODE
  )
  assert.ok(procedureEvidence)
  const parameterRef = (name: string) =>
    procedureFixtureParameterRef(
      sourceProject,
      targetIndex,
      GROUP_E_SOURCE_PROCCODE,
      name
    )
  const callEvidence = blockEntityEvidenceSetV1(sourceProject).find(
    (entry) => entry.targetIndex === targetIndex && entry.blockId === 'ecall'
  )
  assert.ok(callEvidence)
  const spriteBlocks = sourceProject.json.targets[targetIndex]!
    .blocks as Record<string, { readonly inputs?: Record<string, unknown> }>
  const callInputs = spriteBlocks['ecall']!.inputs ?? {}
  const preserved = (localKey: string, argumentId: string) => ({
    parameterLocalKey: localKey,
    source: {
      kind: 'preserveParameter' as const,
      existingParameter: parameterRef(localKey),
      expectedInputFingerprint: blockInputFingerprintV1(
        targetIndex,
        'ecall',
        argumentId,
        callInputs[argumentId] as never
      ),
    },
  })
  // the prototype reporters carry no comments, so the preserved comment set is
  // the empty set for every mapping
  const emptyCommentSet = commentSetSha256V1(
    sourceProject.json.targets[targetIndex]! as never,
    Object.freeze([])
  )
  const updateSignature = {
    kind: 'procedure.updateSignature',
    opId: 'group-e-update-signature',
    procedure: procedureFixtureRef(
      sourceProject,
      targetIndex,
      GROUP_E_SOURCE_PROCCODE
    ),
    signature: procedureFixtureSignature(GROUP_E_UPDATED_ORDER, true),
    parameterLineage: [
      {
        parameterLocalKey: 'charlie',
        lineage: { kind: 'retain', existingParameter: parameterRef('charlie') },
      },
      {
        parameterLocalKey: 'alpha',
        lineage: { kind: 'retain', existingParameter: parameterRef('alpha') },
      },
      {
        parameterLocalKey: 'bravo',
        lineage: { kind: 'retain', existingParameter: parameterRef('bravo') },
      },
      { parameterLocalKey: 'delta', lineage: { kind: 'create' } },
    ],
    prototypeReporters: ['alpha', 'bravo', 'charlie'].map((name) => ({
      existingParameter: parameterRef(name),
      expectedReporterBlockFingerprint: HASH_A,
      disposition: {
        kind: 'preserveExisting' as const,
        parameterLocalKey: name,
        expectedCommentSetSha256: emptyCommentSet,
      },
    })),
    bodyParameterReporters: ['alpha', 'bravo', 'charlie'].map((name) => ({
      existingParameter: parameterRef(name),
      expectedReporterSetSha256: HASH_A,
      disposition: { kind: 'retainMapped' as const, parameterLocalKey: name },
    })),
    callSites: [
      {
        call: exactBlockRef(callEvidence),
        expectedArgumentSetSha256: HASH_A,
        arguments: [
          preserved('charlie', 'a3'),
          preserved('alpha', 'a1'),
          preserved('bravo', 'a2'),
          {
            parameterLocalKey: 'delta',
            source: {
              kind: 'initializeNewParameter' as const,
              value: { valueKind: 'literal' as const, value: 'four' },
            },
          },
        ],
        removedArguments: [],
      },
    ],
    expectedSignatureSha256: procedureFixtureSignatureStateSha256(
      sourceProject,
      targetIndex,
      GROUP_E_SOURCE_PROCCODE
    ),
    expectedCallSetSha256: procedureFixtureCallSetSha256(
      sourceProject,
      targetIndex,
      GROUP_E_SOURCE_PROCCODE
    ),
    expectedProspectiveProcedureCollisionSetSha256:
      prospectiveProcedureCollisionSetSha256V1(
        prospectiveProcedureCollisionSetV1(
          sourceProject,
          targetIndex,
          GROUP_E_UPDATED_PROCCODE,
          new Set(['edef', 'eproto', 'ecall'])
        )
      ),
    requireFinalExternalProspectiveCollisionCount: 0,
  } as const satisfies UnplannedSemanticEditOperationV1
  const parameterDescriptor = {
    bindingKind: 'future',
    entityKind: 'parameter',
    entitySubtype: 'unspecialized',
    expectedCreatorOperationKind: 'procedure.updateSignature',
    expectedCreationRole: {
      roleKind: 'dynamic',
      name: 'parameter',
      entityKind: 'parameter',
      entitySubtype: 'unspecialized',
    },
    expectedCreationScope: {
      scopeKind: 'procedureOwnedClosure',
      procedure: procedureContractRef,
    },
  } as ProcedureCreationBindingDescriptorV1
  const deltaContentSha256 = procedureCreationContentFingerprintForResultV1({
    project: sourceProject,
    targetIndex,
    operation: {
      ...updateSignature,
      expectedPlanningFactSetSha256: HASH_A,
    } as Extract<
      SemanticEditOperationV1,
      { kind: 'procedure.updateSignature' }
    >,
    descriptor: parameterDescriptor,
    resultRole: { roleKind: 'dynamic', name: 'parameter', alias: 'delta' },
    selectedSource: { proccode: GROUP_E_SOURCE_PROCCODE },
    resolveContractEntityRef: () => procedureContractRef,
  })
  const base = structuredClone(SEMANTICALLY_VALID_CHANGE_CONTRACT_SAMPLE)
  base.sourceConstraint = { kind: 'exactArtifact', sourceArtifactSha256 }
  base.entityBindings = [
    {
      bindingKey: spriteContractRef.bindingKey,
      bindingKind: 'existing',
      entityKind: 'target',
      entitySubtype: 'sprite',
      expectedMatchCount: 1,
      sourceLocationSha256: sprite.semanticLocationSha256,
      expectedSourceSemanticFingerprint: sprite.semanticFingerprintSha256,
      expectedSourceContextFingerprint: sprite.contextFingerprintSha256,
    },
    {
      bindingKey: procedureContractRef.bindingKey,
      bindingKind: 'existing',
      entityKind: 'procedure',
      entitySubtype: 'unspecialized',
      expectedMatchCount: 1,
      sourceLocationSha256: procedureEvidence.semanticLocationSha256,
      expectedSourceSemanticFingerprint:
        procedureEvidence.semanticFingerprintSha256,
      expectedSourceContextFingerprint:
        procedureEvidence.contextFingerprintSha256,
    },
    {
      bindingKey: 'group-e-created-parameter-delta',
      ...parameterDescriptor,
      expectedCreationContentFingerprintSha256: deltaContentSha256,
    },
  ]
  base.allowedOperationKinds = ['procedure.updateSignature']
  const updateScope = {
    scopeSubjectKind: 'entity',
    operationKind: 'procedure.updateSignature',
    entityKind: 'procedure',
    entitySubtype: 'unspecialized',
    locationScope: { scopeKind: 'exactEntity', entity: procedureContractRef },
    allowedPropertyPaths: [{ surface: 'procedure', property: 'signature' }],
  } as const
  base.allowedSemanticScopes = [updateScope]
  base.allowedStructuralChanges = [
    {
      allowanceId: 'group-e-add-parameter-delta',
      kind: 'entityAddition',
      candidate: {
        contractRefKind: 'future',
        entityKind: 'parameter',
        entitySubtype: 'unspecialized',
        bindingKey: 'group-e-created-parameter-delta',
      },
      expectedAddedContentSha256: deltaContentSha256,
    },
  ]
  base.requiredStructuralChanges = [
    {
      objectiveId: 'group-e-required-signature-update',
      kind: 'deltaContains',
      direction: 'parent-child',
      operationKind: 'procedure.updateSignature',
      semanticScopeSha256: productionContractScopeSha256V1(updateScope),
      semanticChangeFingerprint: HASH_D,
    },
  ]
  const retainedPolicyArtifacts = attachRetainedPolicyFixturesV1(
    base as unknown as MutableRetainedPolicyContract
  )
  const parsed = parseSemanticChangeContractV1(base)
  assert.equal(
    parsed.ok,
    true,
    parsed.ok ? undefined : JSON.stringify(parsed.issues)
  )
  if (!parsed.ok) assert.fail('Group E contract did not parse')
  const registry = new EditChangeContractRegistryV1({
    hostDefaultLimits: HOST_DEFAULT_LIMITS,
    hostHardLimits: HOST_HARD_LIMITS,
  })
  const provenance = {
    authorityId: 'phase-8-group-e-authority',
    hostConfigurationSha256: HASH_A,
    provenanceArtifactSha256: HASH_B,
    registeredAt: '2026-07-20T00:00:00.000Z',
  }
  const displayObjective = boundedDisplayStringV1(
    'exercise Group E procedure signature editing atomically'
  ) as EditChangeContractRegistrationV1['displayObjective']
  const withoutDisplayHash = {
    schemaVersion: 1 as const,
    registrationId: 'phase-8-group-e-valid',
    semanticContract: parsed.value,
    semanticContractSha256: semanticHashV1('change-contract', parsed.value),
    bindingDisplayEvidence: [],
    displayObjective,
    provenance,
  }
  const registration: EditChangeContractRegistrationV1 = {
    ...withoutDisplayHash,
    displayEvidenceSha256: sha256Hex(
      canonicalJsonBytesV1({
        bindingDisplayEvidence: [],
        displayObjective,
        provenance,
      })
    ),
  }
  registry.registerBytes(
    canonicalJsonBytesV1(registration),
    retainedPolicyArtifacts
  )
  registry.seal()
  return {
    registry,
    valid: registry.bind({
      registrationId: registration.registrationId,
      expectedSemanticContractSha256: registration.semanticContractSha256,
      source: { kind: 'exactArtifact', sourceArtifactSha256 },
      existingBindings: [
        {
          bindingKey: spriteContractRef.bindingKey,
          entityKind: 'target',
          sourceLocationSha256: sprite.semanticLocationSha256,
        },
        {
          bindingKey: procedureContractRef.bindingKey,
          entityKind: 'procedure',
          sourceLocationSha256: procedureEvidence.semanticLocationSha256,
        },
      ],
    }),
    updateSignature,
    spriteTargetIndex: targetIndex,
  }
}

async function beginProcedureSession(input: {
  readonly store: EditArtifactStorePort
  readonly sourceBytes: Uint8Array
  readonly sourceArtifactSha256: string
  readonly groupE: ReturnType<typeof registeredProcedureContracts>
  readonly dispatchers: readonly ProductionOperationDispatcherV1[]
}): Promise<EditSessionV1>
{
  const sessions = createEditSessionRegistryForExecutorV1(
    {
      artifactStore: input.store,
      changeContracts: input.groupE.registry,
      identity: {
        realmSha256: HASH_A,
        profileSha256: HASH_B,
        pinnedScratchRuntimeSourceSha256: HASH_C,
        retentionPolicySha256: HASH_D,
        policyConfigVersion: 1,
      },
      clock: deterministicClock(1_753_056_000_000),
      entropy: deterministicEntropy(101),
      handleSecret: new Uint8Array(32).fill(0x61),
    },
    new ProductionTransactionExecutorV1(input.dispatchers)
  )
  const projectSessionId = 'phase-8-group-e-production'
  const begun = await sessions.begin(
    {
      schemaVersion: 1,
      requestId: 'begin-group-e-production',
      baseline: {
        kind: 'projectSession',
        projectSessionId,
        expectedSourceArtifactSha256: input.sourceArtifactSha256,
      },
      changeContractRegistrationId:
        input.groupE.valid.registration.registrationId,
      expectedSemanticContractSha256:
        input.groupE.valid.registration.semanticContractSha256,
    },
    {
      bytes: input.sourceBytes,
      displayName: 'phase-8-group-e-production.sb3',
      expectedArtifactSha256: input.sourceArtifactSha256,
      provenance: {
        kind: 'projectSession',
        projectSessionId,
        selectedDisplayName: 'phase-8-group-e-production.sb3',
        canonicalRealpath: '/virtual/phase-8-group-e-production.sb3',
        device: 'test-device',
        inode: 'group-e-production-inode',
        byteLength: input.sourceBytes.byteLength,
        modifiedAtNanoseconds: '1753056000000000000',
        sourceInspectionPolicySha256: HASH_A,
        diagnosticPolicySha256: HASH_B,
        runtimePolicySha256: HASH_C,
        provenanceRegistrationSha256: HASH_D,
      },
      recheck: async () => ({
        ok: true,
        observedArtifactSha256: input.sourceArtifactSha256,
      }),
    },
    invocation(1)
  )
  return sessions.session(begun.sessionId)
}

test('Group E production lifecycle reorders a signature, realizes a parameter future binding, and exactly replays', async (t) =>
{
  const root = tempRoot(t)
  const sourceBytes = await buildProcedureFixtureSb3()
  const sourceProject = await ProjectIR.fromSb3(sourceBytes)
  const sourceArtifactSha256 = sha256Hex(sourceBytes)
  const groupE = registeredProcedureContracts(sourceArtifactSha256, sourceProject)
  const store = createEditArtifactStoreHostAdapter(root)
  const dispatchers: readonly ProductionOperationDispatcherV1[] = [
    ...procedureProductionOperationDispatchersV1(),
    ...mediaTargetProductionOperationDispatchersV1(),
  ]
  const session = await beginProcedureSession({
    store,
    sourceBytes,
    sourceArtifactSha256,
    groupE,
    dispatchers,
  })
  const inspection = await session.inspect({ issueHandles: true })
  const planner = await ProductionBatchPlannerV1.create({
    source: sourceProject,
    sourceBytes,
    session,
    store,
    contract: groupE.valid,
    inspection,
  })
  const beforeLineage = session.revisions.at(-1)!
    .activeLineage as SemanticLineageSnapshot
  planner.add(groupE.updateSignature)
  const preview = await session.preview(
    {
      requestId: 'preview-group-e-production',
      expectedHead: session.head,
      canonicalTransaction: planner.batch(),
    },
    invocation(2)
  )
  assert.equal(preview.preview.operationCount, 1)
  const apply = await session.apply(
    {
      schemaVersion: 1,
      sessionId: session.sessionId,
      requestId: 'apply-group-e-production',
      ...expectedHeadRequest(preview.preview.expectedHead),
      previewId: preview.preview.previewId,
      applyGuardSha256: preview.preview.applyGuardSha256,
      expectedResolvedPlanSha256: preview.preview.resolvedPlanSha256,
    },
    invocation(3)
  )
  assert.equal(
    apply.head.candidateSha256,
    preview.preview.predictedCandidateSha256
  )
  const revision = session.revisions.at(-1)!
  const appliedProject = await ProjectIR.fromSb3(
    await store.readImmutable(revision.candidateKey)
  )
  // the rewritten prototype: reordered names, the retained argument ids in the
  // new order, one freshly allocated id for delta, & the flipped warp flag
  const record = resolveProcedureRecordV1(
    appliedProject,
    groupE.spriteTargetIndex,
    GROUP_E_UPDATED_PROCCODE
  )
  assert.equal(record.warp, true)
  assert.deepEqual([...record.argumentNames], [...GROUP_E_UPDATED_ORDER])
  assert.deepEqual(record.argumentIds.slice(0, 3), ['a3', 'a1', 'a2'])
  assert.equal(record.argumentIds.includes('a1'), true)
  assert.notEqual(record.argumentIds[3], undefined)
  // the call site keeps every preserved argument bound to its own value & gains
  // exactly one initialized input for the new parameter
  const call = procedureCallSitesV1(
    appliedProject,
    groupE.spriteTargetIndex,
    GROUP_E_UPDATED_PROCCODE
  )
  assert.equal(call.length, 1)
  assert.deepEqual([...call[0]!.argumentIds], [...record.argumentIds])
  const callBlock = (
    appliedProject.json.targets[groupE.spriteTargetIndex]!.blocks as Record<
      string,
      { readonly inputs?: Record<string, [number, [number, string]]> }
    >
  )['ecall']!
  assert.equal(callBlock.inputs?.['a3']?.[1]?.[1], 'three')
  assert.equal(callBlock.inputs?.['a1']?.[1]?.[1], 'one')
  assert.equal(callBlock.inputs?.['a2']?.[1]?.[1], 'two')
  assert.equal(callBlock.inputs?.[record.argumentIds[3]!]?.[1]?.[1], 'four')
  // semantic movement, not index churn: every retained parameter keeps its
  // lineage id while its canonical ordinal shifts to the new position
  const afterLineage = revision.activeLineage as SemanticLineageSnapshot
  const parameterRows = (snapshot: SemanticLineageSnapshot) =>
    new Map(
      snapshot.records
        .filter(
          (entry) => entry.status === 'active' && entry.kind === 'parameter'
        )
        .map((entry) => [entry.rawIdentity, entry])
    )
  const before = parameterRows(beforeLineage)
  const after = parameterRows(afterLineage)
  assert.equal(before.size, 3)
  assert.equal(after.size, 4)
  for (const [rawIdentity, expectedOrdinal] of [
    ['parameter:a3', 0],
    ['parameter:a1', 1],
    ['parameter:a2', 2],
  ] as const)
  {
    const priorRow = before.get(rawIdentity)
    const nextRow = after.get(rawIdentity)
    assert.ok(priorRow, `${rawIdentity} is absent before the update`)
    assert.ok(nextRow, `${rawIdentity} is absent after the update`)
    assert.equal(
      nextRow.lineageId,
      priorRow.lineageId,
      `${rawIdentity} did not keep its lineage id across the reorder`
    )
    assert.equal(nextRow.canonicalOrdinal, expectedOrdinal)
  }
  const deltaRow = [...after.entries()].find(
    ([rawIdentity]) => !before.has(rawIdentity)
  )
  assert.ok(deltaRow, 'the created parameter has no lineage row')
  assert.equal(deltaRow[1].canonicalOrdinal, 3)
  const deltaLineageId = deltaRow[1].lineageId
  // the delta states the reorder as ordered-collection movement of the same
  // lineages, not as raw index churn over rewritten argument arrays
  const orderedChanges =
    (
      revision.parentDelta as {
        orderedCollectionChanges?: readonly {
          readonly collectionKind: string
          readonly lineageId: string
          readonly kind: string
          readonly beforeIndex?: number
          readonly afterIndex?: number
        }[]
      }
    ).orderedCollectionChanges ?? []
  const parameterChanges = orderedChanges.filter(
    (entry) => entry.collectionKind === 'procedure-parameters'
  )
  const movedParameters = parameterChanges.filter(
    (entry) => entry.kind === 'moved'
  )
  assert.equal(
    movedParameters.length > 0,
    true,
    'the reorder produced no moved procedure-parameters change'
  )
  for (const moved of movedParameters)
    assert.notEqual(moved.beforeIndex, moved.afterIndex)
  assert.equal(
    parameterChanges.some(
      (entry) => entry.kind === 'added' && entry.lineageId === deltaLineageId
    ),
    true,
    'the new parameter is absent from the ordered-collection changes'
  )
  assert.equal(
    orderedChanges.some(
      (entry) => entry.collectionKind === 'procedure-call-arguments'
    ),
    true,
    'the rewritten call site produced no ordered call-argument change'
  )
  // the one declared future binding realizes exactly once & the retained ledger
  // stays hash-only
  const ledger = retainedFutureBindingLedger(revision)
  assert.equal(ledger.realizations.length, 1)
  assertHashOnlyFutureBindingRows(ledger.realizations, [
    'group-e-created-parameter-delta',
  ])
  const authorization = revision.authorization as {
    contractAuthorization: {
      operationScopeEvidence: readonly { opId: string; occurrenceId: string }[]
    }
  }
  const occurrences =
    authorization.contractAuthorization.operationScopeEvidence.filter(
      (entry) => entry.opId === 'group-e-update-signature'
    )
  assert.equal(occurrences.length, 1)
  assert.match(occurrences[0]!.occurrenceId, /^[a-f0-9]{64}$/u)
  assert.equal(
    operationIdArrays(revision.parentDelta)
      .flat()
      .includes(occurrences[0]!.occurrenceId),
    true,
    'procedure.updateSignature is absent from the Group E parent delta'
  )
  const replay = await verifyEditSessionReplayV1({
    artifactStore: store,
    sessionKey: session.manifest.sessionKey,
    boundChangeContract: groupE.valid,
    transactionExecutor: new ProductionTransactionExecutorV1(dispatchers),
  })
  assert.deepEqual(replay.failures, [])
  assert.equal(replay.ok, true)
  assert.equal(replay.verifiedRevisionCount, session.revisions.length)
  assert.deepEqual(replay.finalHead, session.head)
})

test('Group E refuses an injected mid-transaction failure and leaves exact prior bytes, allocator, and quota', async (t) =>
{
  const root = tempRoot(t)
  const sourceBytes = await buildProcedureFixtureSb3()
  const sourceProject = await ProjectIR.fromSb3(sourceBytes)
  const sourceArtifactSha256 = sha256Hex(sourceBytes)
  const groupE = registeredProcedureContracts(sourceArtifactSha256, sourceProject)
  const store = createEditArtifactStoreHostAdapter(root)
  const session = await beginProcedureSession({
    store,
    sourceBytes,
    sourceArtifactSha256,
    groupE,
    dispatchers: [
      ...procedureProductionOperationDispatchersV1(),
      ...mediaTargetProductionOperationDispatchersV1(),
    ],
  })
  const inspection = await session.inspect({ issueHandles: true })
  const planner = await ProductionBatchPlannerV1.create({
    source: sourceProject,
    sourceBytes,
    session,
    store,
    contract: groupE.valid,
    inspection,
  })
  planner.add(groupE.updateSignature)
  const batch = planner.batch()
  const planned = batch.operations[0] as Extract<
    SemanticEditOperationV1,
    { kind: 'procedure.updateSignature' }
  >
  // the injected fault lands after the prototype has already been rebuilt in the
  // working copy: a preserved call argument whose expected input moved
  const tamperedCallSite = {
    ...planned.callSites[0]!,
    arguments: planned.callSites[0]!.arguments.map((entry) =>
      entry.source.kind === 'preserveParameter'
        ? {
            ...entry,
            source: { ...entry.source, expectedInputFingerprint: HASH_C },
          }
        : entry
    ),
  }
  const tampered = {
    ...batch,
    operations: [{ ...planned, callSites: [tamperedCallSite] }],
  }
  const beforeHead = session.head
  const beforeRevision = session.revisions.at(-1)!
  const beforeBytes = await store.readImmutable(beforeRevision.candidateKey)
  const sessionPrefix = `sessions/${session.manifest.sessionKey}`
  // a refused attempt & its idempotency row are retained on purpose; every
  // other durable artifact must be byte-identical
  const revisionInventory = async () =>
    (await inventory(store, sessionPrefix)).filter(
      (entry) =>
        !entry.key.includes('/attempts/') &&
        !entry.key.endsWith('/idempotency-index.json')
    )
  const beforeInventory = await revisionInventory()
  const beforeEvidence = immutableSessionEvidence(
    await inventory(store, sessionPrefix)
  )
  const beforeBudget = session.status().budget
  await assertEditRefusal(
    () =>
      session.preview(
        {
          requestId: 'preview-group-e-injected-failure',
          expectedHead: session.head,
          canonicalTransaction: tampered,
        },
        invocation(2)
      ),
    'edit.fingerprint_mismatch'
  )
  assert.deepEqual(session.head, beforeHead)
  assert.equal(session.revisions.length, 1)
  assert.equal(session.status().state, 'active')
  const afterRevision = session.revisions.at(-1)!
  assert.deepEqual(afterRevision.allocatorState, beforeRevision.allocatorState)
  assert.deepEqual(
    await store.readImmutable(afterRevision.candidateKey),
    beforeBytes
  )
  assert.deepEqual(await revisionInventory(), beforeInventory)
  const afterBudget = session.status().budget
  const afterEvidence = immutableSessionEvidence(
    await inventory(store, sessionPrefix)
  )
  assert.equal(
    afterBudget.artifactBytesUsed - beforeBudget.artifactBytesUsed,
    newlyRetainedEvidenceBytes(beforeEvidence, afterEvidence)
  )
  // semantic consumption stays untouched while the durable refusal counter &
  // its exact immutable evidence advance together
  const consumed = (budget: typeof beforeBudget) => ({
    acceptedOperations: budget.acceptedOperations,
    acceptedRevisions: budget.acceptedRevisions,
    checkpoints: budget.checkpoints,
    impactUsed: budget.impactUsed,
    intentUsed: budget.intentUsed,
    restoreReserveHeld: budget.restoreReserveHeld,
  })
  assert.deepEqual(consumed(afterBudget), consumed(beforeBudget))
  assert.equal(beforeBudget.rejectedAttempts, 0)
  assert.equal(afterBudget.rejectedAttempts, 1)
})

test('Group E refuses a signature rename that collides with a foreign proccode', async (t) =>
{
  const root = tempRoot(t)
  const sourceBytes = await buildProcedureFixtureSb3({ foreignCollision: true })
  const sourceProject = await ProjectIR.fromSb3(sourceBytes)
  const sourceArtifactSha256 = sha256Hex(sourceBytes)
  const groupE = registeredProcedureContracts(sourceArtifactSha256, sourceProject)
  // the foreign procedure already claims the renamed proccode, so the external
  // prospective collision count is nonzero & the frozen literal zero refuses
  const collisions = prospectiveProcedureCollisionSetV1(
    sourceProject,
    groupE.spriteTargetIndex,
    GROUP_E_UPDATED_PROCCODE,
    new Set(['edef', 'eproto', 'ecall'])
  )
  assert.equal(collisions.records.length > 0, true)
  assert.equal(
    collisions.records.every(
      (entry) => entry.proccode === GROUP_E_UPDATED_PROCCODE
    ),
    true
  )
  const store = createEditArtifactStoreHostAdapter(root)
  const session = await beginProcedureSession({
    store,
    sourceBytes,
    sourceArtifactSha256,
    groupE,
    dispatchers: [
      ...procedureProductionOperationDispatchersV1(),
      ...mediaTargetProductionOperationDispatchersV1(),
    ],
  })
  const inspection = await session.inspect({ issueHandles: true })
  const planner = await ProductionBatchPlannerV1.create({
    source: sourceProject,
    sourceBytes,
    session,
    store,
    contract: groupE.valid,
    inspection,
  })
  assert.throws(
    () => planner.add(groupE.updateSignature),
    (error: unknown) =>
      (error as { code?: string }).code === 'edit.cardinality_mismatch'
  )
  assert.equal(session.revisions.length, 1)
})

// ---------------------------------------------------------------------------
// Group F: admitted media & greenfield authoring
// ---------------------------------------------------------------------------

// an authoring-eligible truecolour-alpha PNG; the red channel is the only
// varying byte so two calls differ in payload without differing in shape
function mediaFixtureSolidPng(
  width: number,
  height: number,
  red: number,
  interlaced = false
): Uint8Array
{
  const header = new Uint8Array(13)
  const view = new DataView(header.buffer)
  view.setUint32(0, width, false)
  view.setUint32(4, height, false)
  header[8] = 8
  header[9] = 6
  header[12] = interlaced ? 1 : 0
  const raw: number[] = []
  for (let row = 0; row < height; row += 1)
  {
    raw.push(0)
    for (let column = 0; column < width; column += 1)
      raw.push(red, 0x20, 0x40, 0xff)
  }
  return Uint8Array.from([
    0x89,
    0x50,
    0x4e,
    0x47,
    0x0d,
    0x0a,
    0x1a,
    0x0a,
    ...pngChunk('IHDR', header),
    ...pngChunk('IDAT', deflateSync(Uint8Array.from(raw))),
    ...pngChunk('IEND', new Uint8Array()),
  ])
}

function mediaFixturePcmWav(frameCount: number, seed: number): Uint8Array
{
  const dataBytes = frameCount * 2
  const bytes = new Uint8Array(44 + dataBytes)
  const view = new DataView(bytes.buffer)
  bytes.set(new TextEncoder().encode('RIFF'), 0)
  view.setUint32(4, 36 + dataBytes, true)
  bytes.set(new TextEncoder().encode('WAVEfmt '), 8)
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, 1, true)
  view.setUint32(24, 22_050, true)
  view.setUint32(28, 44_100, true)
  view.setUint16(32, 2, true)
  view.setUint16(34, 16, true)
  bytes.set(new TextEncoder().encode('data'), 36)
  view.setUint32(40, dataBytes, true)
  for (let frame = 0; frame < frameCount; frame += 1)
    view.setInt16(44 + frame * 2, ((frame * 37 + seed) % 4096) - 2048, true)
  return bytes
}

const GROUP_F_ADDED_COSTUME = 'delta'
const GROUP_F_SPRITE_INDEX = 1

interface MediaTargetFixtureV1
{
  readonly bytes: Uint8Array
  readonly sharedPng: Uint8Array
  readonly gammaPng: Uint8Array
  readonly deltaPng: Uint8Array
  readonly popWav: Uint8Array
}

// alpha & bravo deliberately share one payload so a removal can prove the
// shared-asset case; gamma is the sole claimant of its own payload & is the
// costume the block name reference points at
async function buildMediaTargetFixtureSb3(
  options: {
    readonly orderSensitiveBlock?: boolean
    readonly soleCostume?: boolean
    readonly selectedCostumeIndex?: number
  } = {}
): Promise<MediaTargetFixtureV1>
{
  const fixture = await buildFixtureSb3()
  const project = await ProjectIR.fromSb3(fixture.sb3)
  const json = project.toProjectJson()
  const sharedPng = mediaFixtureSolidPng(4, 3, 0x10)
  const gammaPng = mediaFixtureSolidPng(2, 2, 0x80)
  const deltaPng = mediaFixtureSolidPng(6, 5, 0xc0)
  const popWav = mediaFixturePcmWav(400, 3)
  const shared = await mediaFixtureCostumeIdentity(sharedPng)
  const gamma = await mediaFixtureCostumeIdentity(gammaPng)
  const pop = await mediaFixtureSoundIdentity(popWav)
  const sprite = json.targets[GROUP_F_SPRITE_INDEX] as unknown as {
    costumes: unknown[]
    sounds: unknown[]
    currentCostume: number
    blocks: Record<string, unknown>
  }
  const costumeRecord = (name: string, identity: typeof shared) => ({
    name,
    assetId: identity.md5,
    md5ext: identity.md5ext,
    dataFormat: identity.dataFormat,
    bitmapResolution: identity.bitmapResolution,
    rotationCenterX: identity.width / 2,
    rotationCenterY: identity.height / 2,
  })
  sprite.costumes =
    options.soleCostume === true
      ? [costumeRecord('alpha', shared)]
      : [
          costumeRecord('alpha', shared),
          costumeRecord('bravo', shared),
          costumeRecord('gamma', gamma),
        ]
  sprite.sounds = [
    {
      name: 'pop',
      assetId: pop.md5,
      md5ext: pop.md5ext,
      dataFormat: pop.dataFormat,
      format: pop.format,
      rate: pop.rate,
      sampleCount: pop.sampleCount,
    },
  ]
  sprite.currentCostume =
    options.selectedCostumeIndex ?? (options.soleCostume === true ? 0 : 1)
  // an exact costume name reference the rename must propagate to
  sprite.blocks['switch1'] = {
    opcode: 'looks_switchcostumeto',
    next: null,
    parent: null,
    inputs: { COSTUME: [1, 'menu1'] },
    fields: {},
    shadow: false,
    topLevel: true,
    x: 480,
    y: 40,
  }
  sprite.blocks['menu1'] = {
    opcode: 'looks_costume',
    next: null,
    parent: 'switch1',
    inputs: {},
    fields: {
      COSTUME: [options.soleCostume === true ? 'alpha' : 'gamma', null],
    },
    shadow: true,
    topLevel: false,
  }
  // an order-sensitive reference: next-costume reads ordinal meaning, so any
  // order-changing operation in this domain must refuse
  if (options.orderSensitiveBlock === true)
  {
    sprite.blocks['nextcostume1'] = {
      opcode: 'looks_nextcostume',
      next: null,
      parent: null,
      inputs: {},
      fields: {},
      shadow: false,
      topLevel: true,
      x: 480,
      y: 200,
    }
  }
  const assets = [
    ...project.assets,
    { path: shared.md5ext, bytes: sharedPng },
    { path: gamma.md5ext, bytes: gammaPng },
    { path: pop.md5ext, bytes: popWav },
  ]
  return {
    bytes: await packSb3(JSON.stringify(json), assets),
    sharedPng,
    gammaPng,
    deltaPng,
    popWav,
  }
}

// the derived identity is a union over media kind; every costume assertion
// below needs the costume arm, so the narrowing happens once here
async function mediaFixtureCostumeIdentity(bytes: Uint8Array)
{
  const identity = await deriveAuthoringMediaIdentity(
    bytes,
    'costume',
    resolveEditAdmissionLimits()
  )
  assert.equal(identity.mediaKind, 'costume')
  if (identity.mediaKind !== 'costume')
    assert.fail('costume payload derived a sound identity')
  return identity
}

async function mediaFixtureSoundIdentity(bytes: Uint8Array)
{
  const identity = await deriveAuthoringMediaIdentity(
    bytes,
    'sound',
    resolveEditAdmissionLimits()
  )
  assert.equal(identity.mediaKind, 'sound')
  if (identity.mediaKind !== 'sound')
    assert.fail('sound payload derived a costume identity')
  return identity
}

function mediaFixtureCostumeEvidence(
  project: ProjectIR,
  name: string
): MediaRecordEntityEvidenceV1
{
  const evidence = mediaRecordEntityEvidenceSetV1(project).find(
    (entry) =>
      entry.targetIndex === GROUP_F_SPRITE_INDEX &&
      entry.mediaKind === 'costume' &&
      entry.name === name
  )
  assert.ok(evidence, `costume ${name} is absent from the media evidence set`)
  return evidence
}

function mediaFixtureCostumeNames(project: ProjectIR): readonly string[]
{
  return project.json.targets[GROUP_F_SPRITE_INDEX]!.costumes.map(
    (costume) => costume.name
  )
}

function mediaFixtureAssetBytes(project: ProjectIR, path: string): Uint8Array
{
  const asset = project.assets.find((entry) => entry.path === path)
  assert.ok(asset, `archive entry ${path} is absent`)
  return asset.bytes
}

interface MediaTargetAdmittedAssetV1
{
  readonly assetToken: string
  readonly expectedPayloadSha256: string
  readonly expectedMetadataSha256: string
}

// both digests derive from the bytes alone, so a change contract can bind the
// content it authorizes before a session exists to mint the token
async function mediaFixtureCostumeDigests(bytes: Uint8Array): Promise<{
  readonly expectedPayloadSha256: string
  readonly expectedMetadataSha256: string
}>
{
  const identity = await deriveAuthoringMediaIdentity(
    bytes,
    'costume',
    resolveEditAdmissionLimits()
  )
  return {
    expectedPayloadSha256: identity.sha256,
    expectedMetadataSha256: editCanonicalSha256V1(identity),
  }
}

function mediaFixtureTargetRef(evidence: {
  readonly semanticLocationSha256: string
  readonly semanticFingerprintSha256: string
  readonly contextFingerprintSha256: string
})
{
  return {
    entityKind: 'target',
    refKind: 'structural',
    selectorKind: 'exactLocation',
    location: targetBoundedLocationProjectionV1(
      evidence as never,
      `group-f-target-${evidence.semanticLocationSha256.slice(0, 32)}`
    ),
    expectedFullLocationSha256: evidence.semanticLocationSha256,
    expectedSemanticFingerprint: evidence.semanticFingerprintSha256,
    expectedContextFingerprint: evidence.contextFingerprintSha256,
  } as const
}

interface MediaTargetContractsV1
{
  readonly registry: EditChangeContractRegistryV1
  readonly valid: BoundChangeContractV1
  readonly addCostume: UnplannedSemanticEditOperationV1
  readonly spriteRef: {
    readonly contractRefKind: 'existing'
    readonly entityKind: 'target'
    readonly entitySubtype: 'sprite'
    readonly bindingKey: string
  }
}

const GROUP_F_MEDIA_SCOPES = Object.freeze([
  { operationKind: 'media.addCostume', property: 'name' },
  { operationKind: 'media.renameCostume', property: 'name' },
  { operationKind: 'media.reorderCostume', property: 'order' },
  { operationKind: 'media.removeCostume', property: 'name' },
  { operationKind: 'media.setCurrentCostume', property: 'name' },
] as const)

function registeredMediaTargetContracts(
  sourceArtifactSha256: string,
  sourceProject: ProjectIR,
  asset: MediaTargetAdmittedAssetV1
): MediaTargetContractsV1
{
  const sprite = targetEntityEvidenceSetV1(sourceProject.json).find(
    (entry) => entry.targetKind === 'sprite'
  )
  assert.ok(sprite)
  const spriteRef = {
    contractRefKind: 'existing',
    entityKind: 'target',
    entitySubtype: 'sprite',
    bindingKey: 'group-f-sprite',
  } as const
  const spriteTarget = sourceProject.json.targets[GROUP_F_SPRITE_INDEX]!
  const currentState = currentCostumeStateV1(spriteTarget)
  assert.notEqual(currentState.effectiveIndex, null)
  const selected = mediaFixtureCostumeEvidence(
    sourceProject,
    spriteTarget.costumes[currentState.effectiveIndex!]!.name
  )
  // inserting at ordinal 0 shifts every later record up by one, so the
  // selection must keep naming bravo at its new raw index
  const addCostume = {
    kind: 'media.addCostume',
    opId: 'group-f-add-costume',
    target: mediaFixtureTargetRef(sprite),
    asset,
    name: GROUP_F_ADDED_COSTUME,
    order: 0,
    placement: { kind: 'derivedImageCenter' },
    nameActivation: {
      expectedActivationSetSha256: mediaNameActivationEvidenceV1(
        sourceProject,
        { targetIndex: GROUP_F_SPRITE_INDEX, mediaKind: 'costume' },
        GROUP_F_ADDED_COSTUME
      ).activationSetSha256,
      requireProspectiveActivationCount: 0,
    },
    currentSelection: {
      selectionState: 'selected',
      expectedEffectiveCurrentCostume: exactMediaRefV1(selected),
      expectedEffectiveCurrentCostumeFingerprint:
        selected.semanticFingerprintSha256,
      expectedEffectiveCurrentCostumeIndex: currentState.effectiveIndex!,
      expectedRawCurrentCostume: currentState.rawState,
    },
    expectedCostumeOrderSha256: mediaOrderEvidenceV1(spriteTarget, 'costume')
      .orderSha256,
    expectedFinalCurrentCostumeState: {
      state: 'value',
      value: currentState.effectiveIndex! + 1,
    },
  } as UnplannedSemanticEditOperationV1
  const costumeDescriptor = {
    bindingKind: 'future',
    entityKind: 'media',
    entitySubtype: 'costume',
    expectedCreatorOperationKind: 'media.addCostume',
    expectedCreationRole: {
      roleKind: 'fixed',
      name: 'media',
      entityKind: 'media',
      entitySubtype: 'costume',
    },
    expectedCreationScope: {
      scopeKind: 'targetAndOwnedDescendants',
      target: spriteRef,
    },
  } as MediaTargetCreationBindingDescriptorV1
  const createdContentSha256 = mediaTargetCreationContentFingerprintForResultV1({
    project: sourceProject,
    targetIndex: GROUP_F_SPRITE_INDEX,
    operation: {
      ...addCostume,
      expectedPlanningFactSetSha256: HASH_A,
    } as Extract<SemanticEditOperationV1, { kind: 'media.addCostume' }>,
    descriptor: costumeDescriptor,
    resultRole: { roleKind: 'fixed', name: 'media' },
    resolveContractEntityRef: () => spriteRef,
  })
  const base = structuredClone(SEMANTICALLY_VALID_CHANGE_CONTRACT_SAMPLE)
  base.sourceConstraint = { kind: 'exactArtifact', sourceArtifactSha256 }
  base.entityBindings = [
    {
      bindingKey: spriteRef.bindingKey,
      bindingKind: 'existing',
      entityKind: 'target',
      entitySubtype: 'sprite',
      expectedMatchCount: 1,
      sourceLocationSha256: sprite.semanticLocationSha256,
      expectedSourceSemanticFingerprint: sprite.semanticFingerprintSha256,
      expectedSourceContextFingerprint: sprite.contextFingerprintSha256,
    },
    {
      bindingKey: 'group-f-created-costume',
      ...costumeDescriptor,
      expectedCreationContentFingerprintSha256: createdContentSha256,
    },
  ]
  base.allowedOperationKinds = GROUP_F_MEDIA_SCOPES.map(
    (entry) => entry.operationKind
  )
  const scopes = GROUP_F_MEDIA_SCOPES.map((entry) => ({
    scopeSubjectKind: 'entity' as const,
    operationKind: entry.operationKind,
    entityKind: 'media' as const,
    entitySubtype: 'costume' as const,
    locationScope: {
      scopeKind: 'targetAndOwnedDescendants' as const,
      target: spriteRef,
    },
    allowedPropertyPaths: [
      { surface: 'media' as const, property: entry.property },
    ],
  }))
  base.allowedSemanticScopes = scopes
  base.allowedStructuralChanges = [
    {
      allowanceId: 'group-f-add-costume-allowance',
      kind: 'entityAddition',
      candidate: {
        contractRefKind: 'future',
        entityKind: 'media',
        entitySubtype: 'costume',
        bindingKey: 'group-f-created-costume',
      },
      expectedAddedContentSha256: createdContentSha256,
    },
  ]
  base.requiredStructuralChanges = [
    {
      objectiveId: 'group-f-required-add-costume',
      kind: 'deltaContains',
      direction: 'parent-child',
      operationKind: 'media.addCostume',
      semanticScopeSha256: productionContractScopeSha256V1(scopes[0]!),
      semanticChangeFingerprint: HASH_D,
    },
  ]
  const retainedPolicyArtifacts = attachRetainedPolicyFixturesV1(
    base as unknown as MutableRetainedPolicyContract
  )
  const parsed = parseSemanticChangeContractV1(base)
  assert.equal(
    parsed.ok,
    true,
    parsed.ok ? undefined : JSON.stringify(parsed.issues)
  )
  if (!parsed.ok) assert.fail('Group F contract did not parse')
  const registry = new EditChangeContractRegistryV1({
    hostDefaultLimits: HOST_DEFAULT_LIMITS,
    hostHardLimits: HOST_HARD_LIMITS,
  })
  const provenance = {
    authorityId: 'phase-8-group-f-authority',
    hostConfigurationSha256: HASH_A,
    provenanceArtifactSha256: HASH_B,
    registeredAt: '2026-07-20T00:00:00.000Z',
  }
  const displayObjective = boundedDisplayStringV1(
    'exercise Group F admitted media authoring atomically'
  ) as EditChangeContractRegistrationV1['displayObjective']
  const withoutDisplayHash = {
    schemaVersion: 1 as const,
    registrationId: 'phase-8-group-f-valid',
    semanticContract: parsed.value,
    semanticContractSha256: semanticHashV1('change-contract', parsed.value),
    bindingDisplayEvidence: [],
    displayObjective,
    provenance,
  }
  const registration: EditChangeContractRegistrationV1 = {
    ...withoutDisplayHash,
    displayEvidenceSha256: sha256Hex(
      canonicalJsonBytesV1({
        bindingDisplayEvidence: [],
        displayObjective,
        provenance,
      })
    ),
  }
  registry.registerBytes(
    canonicalJsonBytesV1(registration),
    retainedPolicyArtifacts
  )
  registry.seal()
  return {
    registry,
    valid: registry.bind({
      registrationId: registration.registrationId,
      expectedSemanticContractSha256: registration.semanticContractSha256,
      source: { kind: 'exactArtifact', sourceArtifactSha256 },
      existingBindings: [
        {
          bindingKey: spriteRef.bindingKey,
          entityKind: 'target',
          sourceLocationSha256: sprite.semanticLocationSha256,
        },
      ],
    }),
    addCostume,
    spriteRef,
  }
}

async function beginGroupFSession(input: {
  readonly store: EditArtifactStorePort
  readonly sourceBytes: Uint8Array
  readonly sourceArtifactSha256: string
  readonly groupF: MediaTargetContractsV1
  readonly executor: EditTransactionExecutorV1
  readonly policy?: Parameters<
    typeof createEditSessionRegistryForExecutorV1
  >[0]['policy']
}): Promise<EditSessionV1>
{
  const sessions = createEditSessionRegistryForExecutorV1(
    {
      artifactStore: input.store,
      changeContracts: input.groupF.registry,
      identity: {
        realmSha256: HASH_A,
        profileSha256: HASH_B,
        pinnedScratchRuntimeSourceSha256: HASH_C,
        retentionPolicySha256: HASH_D,
        policyConfigVersion: 1,
      },
      clock: deterministicClock(1_753_056_000_000),
      entropy: deterministicEntropy(211),
      handleSecret: new Uint8Array(32).fill(0x66),
      ...(input.policy === undefined ? {} : { policy: input.policy }),
    },
    input.executor
  )
  const projectSessionId = 'phase-8-group-f-production'
  const begun = await sessions.begin(
    {
      schemaVersion: 1,
      requestId: 'begin-group-f-production',
      baseline: {
        kind: 'projectSession',
        projectSessionId,
        expectedSourceArtifactSha256: input.sourceArtifactSha256,
      },
      changeContractRegistrationId:
        input.groupF.valid.registration.registrationId,
      expectedSemanticContractSha256:
        input.groupF.valid.registration.semanticContractSha256,
    },
    {
      bytes: input.sourceBytes,
      displayName: 'phase-8-group-f-production.sb3',
      expectedArtifactSha256: input.sourceArtifactSha256,
      provenance: {
        kind: 'projectSession',
        projectSessionId,
        selectedDisplayName: 'phase-8-group-f-production.sb3',
        canonicalRealpath: '/virtual/phase-8-group-f-production.sb3',
        device: 'test-device',
        inode: 'group-f-production-inode',
        byteLength: input.sourceBytes.byteLength,
        modifiedAtNanoseconds: '1753056000000000000',
        sourceInspectionPolicySha256: HASH_A,
        diagnosticPolicySha256: HASH_B,
        runtimePolicySha256: HASH_C,
        provenanceRegistrationSha256: HASH_D,
      },
      recheck: async () => ({
        ok: true,
        observedArtifactSha256: input.sourceArtifactSha256,
      }),
    },
    invocation(1)
  )
  return sessions.session(begun.sessionId)
}

interface MediaTargetHarnessV1
{
  readonly fixture: MediaTargetFixtureV1
  readonly sourceProject: ProjectIR
  readonly groupF: MediaTargetContractsV1
  readonly admitted: EditAssetAdmitDomainResultV1
  readonly asset: MediaTargetAdmittedAssetV1
  readonly planner: ProductionBatchPlannerV1
  readonly session: EditSessionV1
  readonly store: EditArtifactStorePort
}

// the Group F batch planner over a real begun session. the payload is admitted
// through the session's own store & the executor is the plain production one,
// so every media test resolves its asset the way a real host does
async function beginGroupFHarness(
  t: test.TestContext,
  options: {
    readonly orderSensitiveBlock?: boolean
    readonly soleCostume?: boolean
    readonly selectedCostumeIndex?: number
  } = {}
): Promise<MediaTargetHarnessV1>
{
  const root = tempRoot(t)
  const fixture = await buildMediaTargetFixtureSb3(options)
  const sourceProject = await ProjectIR.fromSb3(fixture.bytes)
  const sourceArtifactSha256 = sha256Hex(fixture.bytes)
  // the contract binds the created content by payload & metadata digest, both
  // of which come from the bytes, so it registers before any token is minted
  const digests = await mediaFixtureCostumeDigests(fixture.deltaPng)
  const groupF = registeredMediaTargetContracts(
    sourceArtifactSha256,
    sourceProject,
    {
      assetToken: 'asset-unadmitted-placeholder',
      ...digests,
    }
  )
  const store = createEditArtifactStoreHostAdapter(root)
  const dispatchers = mediaTargetProductionOperationDispatchersV1()
  const session = await beginGroupFSession({
    store,
    sourceBytes: fixture.bytes,
    sourceArtifactSha256,
    groupF,
    executor: new ProductionTransactionExecutorV1(dispatchers),
  })
  const admitted = await session.admitAsset(
    {
      requestId: 'admit-group-f-costume',
      expectedHead: session.head,
      source: {
        kind: 'sourceMedia',
        mediaKind: 'costume',
        bytes: fixture.deltaPng,
        expectedPayloadSha256: digests.expectedPayloadSha256,
      },
    },
    invocation(2)
  )
  const asset = {
    assetToken: admitted.assetToken,
    ...digests,
  }
  const inspection = await session.inspect({ issueHandles: true })
  const planner = await ProductionBatchPlannerV1.create({
    source: sourceProject,
    sourceBytes: fixture.bytes,
    session,
    store,
    contract: groupF.valid,
    inspection,
    resolveAdmittedAsset: session.admittedAssets,
  })
  return {
    fixture,
    sourceProject,
    groupF: {
      ...groupF,
      addCostume: {
        ...(groupF.addCostume as Record<string, unknown>),
        asset,
      } as UnplannedSemanticEditOperationV1,
    },
    admitted,
    asset,
    planner,
    session,
    store,
  }
}

test('Group F artifact refusal leaves asset admission provisional and the session active', async (t) =>
{
  const fixture = await buildMediaTargetFixtureSb3()
  const sourceProject = await ProjectIR.fromSb3(fixture.bytes)
  const sourceArtifactSha256 = sha256Hex(fixture.bytes)
  const digests = await mediaFixtureCostumeDigests(fixture.deltaPng)
  const groupF = registeredMediaTargetContracts(
    sourceArtifactSha256,
    sourceProject,
    {
      assetToken: 'asset-unadmitted-placeholder',
      ...digests,
    }
  )
  const dispatchers = mediaTargetProductionOperationDispatchersV1()
  const calibrationStore = createEditArtifactStoreHostAdapter(tempRoot(t))
  const calibration = await beginGroupFSession({
    store: calibrationStore,
    sourceBytes: fixture.bytes,
    sourceArtifactSha256,
    groupF,
    executor: new ProductionTransactionExecutorV1(dispatchers),
  })
  const openingArtifactBytes = calibration.status().budget.artifactBytesUsed
  await calibration.admitAsset(
    {
      requestId: 'asset-admission-cap-boundary',
      expectedHead: calibration.head,
      source: {
        kind: 'sourceMedia',
        mediaKind: 'costume',
        bytes: fixture.deltaPng,
        expectedPayloadSha256: digests.expectedPayloadSha256,
      },
    },
    invocation(2)
  )
  const admissionArtifactBytes =
    calibration.status().budget.artifactBytesUsed - openingArtifactBytes
  assert.ok(admissionArtifactBytes > fixture.deltaPng.byteLength)

  const cappedStore = createEditArtifactStoreHostAdapter(tempRoot(t))
  const capped = await beginGroupFSession({
    store: cappedStore,
    sourceBytes: fixture.bytes,
    sourceArtifactSha256,
    groupF,
    executor: new ProductionTransactionExecutorV1(dispatchers),
    policy: {
      artifactByteLimit: openingArtifactBytes + admissionArtifactBytes - 1,
    },
  })
  assert.equal(capped.status().budget.artifactBytesUsed, openingArtifactBytes)
  const request = {
    requestId: 'asset-admission-cap-boundary',
    expectedHead: capped.head,
    source: {
      kind: 'sourceMedia' as const,
      mediaKind: 'costume' as const,
      bytes: fixture.deltaPng,
      expectedPayloadSha256: digests.expectedPayloadSha256,
    },
  }
  await assert.rejects(
    capped.admitAsset(request, invocation(2)),
    (error: unknown) =>
      (error as { code?: string }).code === 'edit.artifact_quota_exceeded'
  )
  assert.equal(capped.state, 'active')
  const assetPrefix = `sessions/${capped.manifest.sessionKey}/assets`
  assert.deepEqual(await cappedStore.listImmutable(assetPrefix), [])
  const afterRefusal = await inventory(
    cappedStore,
    `sessions/${capped.manifest.sessionKey}`
  )
  await assert.rejects(
    capped.admitAsset(request, invocation(2)),
    (error: unknown) =>
      (error as { code?: string }).code === 'edit.artifact_quota_exceeded'
  )
  assert.deepEqual(
    await inventory(cappedStore, `sessions/${capped.manifest.sessionKey}`),
    afterRefusal
  )
})

test('Group F media authoring adds a costume, realizes its future binding, preserves every prior payload byte-exact, and packs deterministically', async (t) =>
{
  const harness = await beginGroupFHarness(t)
  const planned = harness.planner.add(harness.groupF.addCostume)
  assert.equal(planned.kind, 'media.addCostume')
  const deltaIdentity = await mediaFixtureCostumeIdentity(harness.fixture.deltaPng)
  assert.deepEqual(harness.planner.assetMaterializationUsage, {
    schemaVersion: 1,
    authoredCostumeAssetTokens: [harness.admitted.assetToken],
    authoredCostumeTextureMaterializations: 1,
    authoredCostumeReferencePixels: deltaIdentity.canvasPixels,
    authoredDecodedRgbaEstimateBytes: deltaIdentity.canvasPixels * 4,
  })
  const candidate = harness.planner.candidate
  // the record landed at the requested ordinal & the selection kept naming the
  // same costume across the insert that shifted it
  assert.deepEqual(
    [...mediaFixtureCostumeNames(candidate)],
    [GROUP_F_ADDED_COSTUME, 'alpha', 'bravo', 'gamma']
  )
  const target = candidate.json.targets[GROUP_F_SPRITE_INDEX]!
  assert.equal(target.currentCostume, 2)
  assert.equal(target.costumes[2]!.name, 'bravo')
  // every emitted identity field comes from the parsed payload, never the caller
  const added = target.costumes[0]!
  assert.equal(added.assetId, deltaIdentity.md5)
  assert.equal(added.md5ext, deltaIdentity.md5ext)
  assert.equal(added.dataFormat, 'png')
  assert.equal(added.bitmapResolution, 1)
  assert.equal(added.rotationCenterX, deltaIdentity.width / 2)
  assert.equal(added.rotationCenterY, deltaIdentity.height / 2)
  // the admitted payload landed byte-exact & no payload the source already
  // carried was rewritten
  assert.deepEqual(
    [...mediaFixtureAssetBytes(candidate, deltaIdentity.md5ext)],
    [...harness.fixture.deltaPng]
  )
  for (const priorAsset of harness.sourceProject.assets)
  {
    assert.deepEqual(
      [...mediaFixtureAssetBytes(candidate, priorAsset.path)],
      [...priorAsset.bytes],
      `${priorAsset.path} is not byte-exact after the media add`
    )
  }
  // the created record's future binding realized exactly once against the
  // fixed media role
  const realizations = harness.planner.futureBindingRealizations
  assert.equal(realizations.length, 1)
  assert.equal(
    realizations[0]!.bindingKeySha256,
    futureBindingKeySha256V1(
      harness.planner.changeContractSha256,
      'group-f-created-costume'
    )
  )
  // packing the same candidate twice is byte-identical, so the media pack adds
  // no nondeterminism to the candidate digest
  const packedOnce = await packSb3(
    JSON.stringify(candidate.toProjectJson()),
    candidate.assets
  )
  const packedTwice = await packSb3(
    JSON.stringify(candidate.toProjectJson()),
    candidate.assets
  )
  assert.equal(sha256Hex(packedOnce), sha256Hex(packedTwice))
  // the packed candidate readmits & still carries the added record
  const reopened = await ProjectIR.fromSb3(packedOnce)
  assert.deepEqual(
    [...mediaFixtureCostumeNames(reopened)],
    [GROUP_F_ADDED_COSTUME, 'alpha', 'bravo', 'gamma']
  )
  assert.deepEqual(
    [...mediaFixtureAssetBytes(reopened, deltaIdentity.md5ext)],
    [...harness.fixture.deltaPng]
  )
})

// a media reference always names a record as it stood at batch start, so the
// ref comes from the pre-batch project while every state-dependent expectation
// comes from the running candidate
function mediaFixtureCurrentSelection(preBatch: ProjectIR, candidate: ProjectIR)
{
  const target = candidate.json.targets[GROUP_F_SPRITE_INDEX]!
  const state = currentCostumeStateV1(target)
  assert.notEqual(state.effectiveIndex, null)
  const name = target.costumes[state.effectiveIndex!]!.name
  const selected = mediaFixtureCostumeEvidence(candidate, name)
  return {
    selectionState: 'selected',
    expectedEffectiveCurrentCostume: exactMediaRefV1(
      mediaFixtureCostumeEvidence(preBatch, name)
    ),
    expectedEffectiveCurrentCostumeFingerprint:
      selected.semanticFingerprintSha256,
    expectedEffectiveCurrentCostumeIndex: state.effectiveIndex!,
    expectedRawCurrentCostume: state.rawState,
  } as const
}

function mediaFixtureRemoveCostumeOp(
  preBatch: ProjectIR,
  candidate: ProjectIR,
  opId: string,
  name: string,
  expectedFinalCurrentCostumeState:
    | { state: 'missing' }
    | {
        state: 'value'
        value: number
      }
): UnplannedSemanticEditOperationV1
{
  const current = mediaFixtureCostumeEvidence(candidate, name)
  const target = candidate.json.targets[GROUP_F_SPRITE_INDEX]!
  return {
    kind: 'media.removeCostume',
    opId,
    media: exactMediaRefV1(mediaFixtureCostumeEvidence(preBatch, name)),
    currentSelection: mediaFixtureCurrentSelection(preBatch, candidate),
    expectedCostumeCount: target.costumes.length,
    expectedCurrentCostume: false,
    expectedFinalCurrentCostumeState,
    expectedReachabilitySha256:
      mediaReachabilityEvidenceV1(candidate).reachabilitySha256,
    expectedReferenceSetSha256: mediaReferenceEvidenceV1(candidate, {
      targetIndex: GROUP_F_SPRITE_INDEX,
      mediaKind: 'costume',
      ordinal: current.ordinal,
    }).referenceSetSha256,
    requireFinalCostumeCountAtLeast: 1,
    requireFinalReferenceCount: 0,
  } as UnplannedSemanticEditOperationV1
}

function mediaFixtureReorderCostumeOp(
  preBatch: ProjectIR,
  candidate: ProjectIR,
  opId: string,
  name: string,
  newIndex: number,
  expectedFinalCurrentCostumeState:
    | { state: 'missing' }
    | {
        state: 'value'
        value: number
      }
): UnplannedSemanticEditOperationV1
{
  return {
    kind: 'media.reorderCostume',
    opId,
    media: exactMediaRefV1(mediaFixtureCostumeEvidence(preBatch, name)),
    currentSelection: mediaFixtureCurrentSelection(preBatch, candidate),
    expectedIndex: mediaFixtureCostumeEvidence(candidate, name).ordinal,
    newIndex,
    expectedMediaOrderSha256: mediaOrderEvidenceV1(
      candidate.json.targets[GROUP_F_SPRITE_INDEX]!,
      'costume'
    ).orderSha256,
    expectedFinalCurrentCostumeState,
  } as UnplannedSemanticEditOperationV1
}

function mediaFixtureSetCurrentCostumeOp(
  preBatch: ProjectIR,
  candidate: ProjectIR,
  opId: string,
  name: string
): UnplannedSemanticEditOperationV1
{
  const sprite = targetEntityEvidenceSetV1(preBatch.json).find(
    (entry) => entry.targetIndex === GROUP_F_SPRITE_INDEX
  )
  assert.ok(sprite)
  return {
    kind: 'media.setCurrentCostume',
    opId,
    target: mediaFixtureTargetRef(sprite),
    media: exactMediaRefV1(mediaFixtureCostumeEvidence(preBatch, name)),
    currentSelection: mediaFixtureCurrentSelection(preBatch, candidate),
    expectedFinalCurrentCostumeIndex: mediaFixtureCostumeEvidence(candidate, name)
      .ordinal,
  } as UnplannedSemanticEditOperationV1
}

test('Group F reconciles the current costume across add, reorder, and remove, and refuses removing the selected costume', async (t) =>
{
  // (a) a reorder moves the selected record itself, so the raw index follows it
  const reordering = await beginGroupFHarness(t)
  reordering.planner.add(
    mediaFixtureReorderCostumeOp(
      reordering.sourceProject,
      reordering.planner.candidate,
      'group-f-reorder-alpha',
      'alpha',
      2,
      { state: 'value', value: 0 }
    )
  )
  const reordered = reordering.planner.candidate
  assert.deepEqual(
    [...mediaFixtureCostumeNames(reordered)],
    ['bravo', 'gamma', 'alpha']
  )
  const reorderedTarget = reordered.json.targets[GROUP_F_SPRITE_INDEX]!
  assert.equal(reorderedTarget.currentCostume, 0)
  assert.equal(reorderedTarget.costumes[0]!.name, 'bravo')

  // (b) removing a record before the selection shifts the raw index down while
  // the selected costume is unchanged, & the payload alpha shared w/ bravo
  // stays referenced & retained because V1 never collects
  const removing = await beginGroupFHarness(t)
  const beforeRemoval = removing.planner.candidate
  const sharedPath = mediaFixtureCostumeEvidence(beforeRemoval, 'alpha').archivePath
  assert.equal(
    mediaFixtureCostumeEvidence(beforeRemoval, 'bravo').archivePath,
    sharedPath,
    'the fixture no longer shares one payload between alpha and bravo'
  )
  removing.planner.add(
    mediaFixtureRemoveCostumeOp(
      removing.sourceProject,
      beforeRemoval,
      'group-f-remove-alpha',
      'alpha',
      { state: 'value', value: 0 }
    )
  )
  const removed = removing.planner.candidate
  assert.deepEqual([...mediaFixtureCostumeNames(removed)], ['bravo', 'gamma'])
  const removedTarget = removed.json.targets[GROUP_F_SPRITE_INDEX]!
  assert.equal(removedTarget.currentCostume, 0)
  assert.equal(removedTarget.costumes[0]!.name, 'bravo')
  const removedReachability = mediaReachabilityEvidenceV1(removed)
  assert.equal(
    removedReachability.referencedArchivePaths.includes(sharedPath),
    true,
    'the shared payload stopped being referenced when one claimant was detached'
  )
  assert.deepEqual([...removedReachability.protectedArchivePaths], [])
  assert.deepEqual(
    [...mediaFixtureAssetBytes(removed, sharedPath)],
    [...mediaFixtureAssetBytes(beforeRemoval, sharedPath)]
  )

  // (c) an explicit selection change writes the raw index of the named record
  // rather than reconciling anything
  const selecting = await beginGroupFHarness(t)
  selecting.planner.add(
    mediaFixtureSetCurrentCostumeOp(
      selecting.sourceProject,
      selecting.planner.candidate,
      'group-f-select-gamma',
      'gamma'
    )
  )
  const selectedTarget =
    selecting.planner.candidate.json.targets[GROUP_F_SPRITE_INDEX]!
  assert.equal(selectedTarget.currentCostume, 2)
  assert.equal(selectedTarget.costumes[2]!.name, 'gamma')
  assert.deepEqual(
    [...mediaFixtureCostumeNames(selecting.planner.candidate)],
    ['alpha', 'bravo', 'gamma'],
    'a selection change moved a record'
  )

  // (d) the frozen contract can only assert `expectedCurrentCostume: false`, so
  // removing the selected costume is a refusal rather than a reconciliation
  const protectedRemoval = await beginGroupFHarness(t)
  assert.throws(
    () =>
      protectedRemoval.planner.add(
        mediaFixtureRemoveCostumeOp(
          protectedRemoval.sourceProject,
          protectedRemoval.planner.candidate,
          'group-f-remove-current',
          'bravo',
          { state: 'value', value: 0 }
        )
      ),
    (error: unknown) =>
      (error as { code?: string }).code === 'edit.protected_change'
  )
})

test('Group F separates admission from committed materialization use and refuses mismatched or nonauthorable media', async (t) =>
{
  void t
  const png = mediaFixtureSolidPng(4, 3, 0x10)
  const identity = await mediaFixtureCostumeIdentity(png)
  const metadataSha256 = editCanonicalSha256V1(identity)
  const store = new SessionAssetStoreV1({
    sessionSalt: new Uint8Array(32).fill(0x5a),
  })
  const first = await store.admitSourceMedia({
    bytes: png,
    mediaKind: 'costume',
    expectedPayloadSha256: identity.sha256,
    expectedMetadataSha256: metadataSha256,
  })
  assert.deepEqual(store.ledger(), {
    admittedEditAssets: 1,
    admittedEditAssetBytes: identity.byteLength,
    authoredCostumeTextureMaterializations: 0,
    authoredCostumeReferencePixels: 0,
    authoredDecodedRgbaEstimateBytes: 0,
  })
  // the exact same payload admitted again mints its own record without claiming
  // an authored use; only the admission byte ceiling deduplicates by digest
  const second = await store.admitSourceMedia({
    bytes: png,
    mediaKind: 'costume',
    expectedPayloadSha256: identity.sha256,
    expectedMetadataSha256: metadataSha256,
  })
  assert.notEqual(first.assetToken, second.assetToken)
  assert.equal(first.payloadSha256, second.payloadSha256)
  assert.deepEqual(store.ledger(), {
    admittedEditAssets: 2,
    admittedEditAssetBytes: identity.byteLength,
    authoredCostumeTextureMaterializations: 0,
    authoredCostumeReferencePixels: 0,
    authoredDecodedRgbaEstimateBytes: 0,
  })
  // one further authored reference to an already-admitted record charges again
  // without admitting anything new
  store.chargeAuthoredReference(first.assetToken)
  assert.deepEqual(store.ledger(), {
    admittedEditAssets: 2,
    admittedEditAssetBytes: identity.byteLength,
    authoredCostumeTextureMaterializations: 1,
    authoredCostumeReferencePixels: identity.canvasPixels,
    authoredDecodedRgbaEstimateBytes: identity.canvasPixels * 4,
  })
  // a declared payload digest that does not describe the bytes is refused
  await assert.rejects(
    store.admitSourceMedia({
      bytes: png,
      mediaKind: 'costume',
      expectedPayloadSha256: HASH_A,
      expectedMetadataSha256: metadataSha256,
    }),
    (error: unknown) =>
      (error as { code?: string }).code === 'edit.asset_digest_mismatch'
  )
  // a declared metadata digest that does not describe the parsed identity is
  // refused separately: both proofs are required
  await assert.rejects(
    store.admitSourceMedia({
      bytes: png,
      mediaKind: 'costume',
      expectedPayloadSha256: identity.sha256,
      expectedMetadataSha256: HASH_B,
    }),
    (error: unknown) =>
      (error as { code?: string }).code === 'edit.asset_metadata_mismatch'
  )
  // a costume payload offered as a sound is refused by the parser itself
  await assert.rejects(
    store.admitSourceMedia({
      bytes: png,
      mediaKind: 'sound',
      expectedPayloadSha256: identity.sha256,
      expectedMetadataSha256: metadataSha256,
    }),
    (error: unknown) =>
      (error as { code?: string }).code === 'edit.unsupported_media'
  )
  // sourceMedia reuse is path-free, not a format bypass: an interlaced PNG is
  // preservable but never authoring eligible, so reuse refuses it too
  const interlaced = mediaFixtureSolidPng(4, 3, 0x10, true)
  const interlacedSha256 = sha256Hex(interlaced)
  await assert.rejects(
    store.admitSourceMedia({
      bytes: interlaced,
      mediaKind: 'costume',
      expectedPayloadSha256: interlacedSha256,
      expectedMetadataSha256: metadataSha256,
    }),
    (error: unknown) =>
      (error as { code?: string }).code === 'edit.unsupported_media'
  )
  // every refusal above left the ledger exactly where the last accepted charge
  // put it
  assert.deepEqual(store.ledger(), {
    admittedEditAssets: 2,
    admittedEditAssetBytes: identity.byteLength,
    authoredCostumeTextureMaterializations: 1,
    authoredCostumeReferencePixels: identity.canvasPixels,
    authoredDecodedRgbaEstimateBytes: identity.canvasPixels * 4,
  })
  // an unknown asset token names no admitted record
  assert.throws(
    () => store.record('asset-0000000000000000'),
    (error: unknown) =>
      (error as { code?: string }).code === 'edit.stale_handle'
  )
  assert.equal(store.resolver()('asset-0000000000000000'), null)
})

test('Group F pins the blank template artifact, admits it through the normal path, and permanently denies its backing file as an output', async (t) =>
{
  void t
  // the artifact is deterministic & its hash is pinned as its own oracle
  const first = await buildGreenfieldTemplateArtifactV1()
  const second = await buildGreenfieldTemplateArtifactV1()
  assert.equal(sha256Hex(first), sha256Hex(second))
  assert.equal(
    sha256Hex(first),
    PINNED_GREENFIELD_TEMPLATE_ARTIFACT_SHA256_V1,
    'the generated blank template no longer matches its pinned identity'
  )
  assert.equal(
    await assertPinnedGreenfieldTemplateIdentityV1(),
    PINNED_GREENFIELD_TEMPLATE_ARTIFACT_SHA256_V1
  )
  // the template opens as an ordinary project: one stage, one backdrop, no
  // sprite, & the intake carries registered-template provenance
  const project = await ProjectIR.fromSb3(first)
  assert.equal(project.json.targets.length, 1)
  assert.equal(project.json.targets[0]!.isStage, true)
  assert.equal(project.json.targets[0]!.costumes.length, 1)
  const intake = await greenfieldTemplateSourceIntakeV1({
    registryEntryId: 'group-f-template-entry',
    registryProfileSha256: HASH_A,
    sourceInspectionPolicySha256: HASH_B,
    diagnosticPolicySha256: HASH_C,
    runtimePolicySha256: HASH_D,
    backingFileIdentity: {
      canonicalRealpath: '/registry/scratch-3-empty-v1.sb3',
      device: 'registry-device',
      inode: 'registry-inode',
      byteLength: first.byteLength,
      modifiedAtNanoseconds: '1753056000000000000',
    },
  })
  assert.equal(intake.provenance.kind, 'registeredTemplate')
  assert.equal(
    intake.expectedArtifactSha256,
    PINNED_GREENFIELD_TEMPLATE_ARTIFACT_SHA256_V1
  )
  assert.deepEqual([...intake.bytes], [...first])
  const recheck = await intake.recheck()
  assert.equal(recheck.ok, true)
  // the backing file is denied by path & independently by device+inode, so
  // neither a rename nor a second path to the same file gets past it
  for (const destination of [
    {
      canonicalRealpath: '/registry/scratch-3-empty-v1.sb3',
      device: 'other-device',
      inode: 'other-inode',
    },
    {
      canonicalRealpath: '/somewhere/else.sb3',
      device: 'registry-device',
      inode: 'registry-inode',
    },
  ])
  {
    assert.throws(
      () =>
        assertTemplateBackingFileIsNotAnOutputV1(
          intake.provenance,
          destination
        ),
      (error: unknown) =>
        (error as { code?: string }).code === 'edit.source_overwrite_denied'
    )
  }
  // an unrelated output is untouched by the denial
  assertTemplateBackingFileIsNotAnOutputV1(intake.provenance, {
    canonicalRealpath: '/somewhere/else.sb3',
    device: 'other-device',
    inode: 'other-inode',
  })
})

test('Group F propagates a costume rename to its exact block reference and refuses an order change an ordinal-reading block could observe', async (t) =>
{
  // (a) gamma is named by one costume-menu field; the rename must rewrite it
  const renaming = await beginGroupFHarness(t)
  const beforeRename = renaming.planner.candidate
  const gammaBefore = mediaFixtureCostumeEvidence(beforeRename, 'gamma')
  const referencesBefore = mediaReferenceEvidenceV1(beforeRename, {
    targetIndex: GROUP_F_SPRITE_INDEX,
    mediaKind: 'costume',
    ordinal: gammaBefore.ordinal,
  })
  assert.equal(referencesBefore.directReferenceCount, 1)
  assert.deepEqual(
    [...referencesBefore.referencePaths],
    ['/targets/1/blocks/menu1/fields/COSTUME/0']
  )
  renaming.planner.add({
    kind: 'media.renameCostume',
    opId: 'group-f-rename-gamma',
    media: exactMediaRefV1(gammaBefore),
    expectedName: targetExpectedStringIdentityV1('gamma'),
    newName: 'renamed',
    newNameActivation: {
      expectedActivationSetSha256: mediaNameActivationEvidenceV1(
        beforeRename,
        { targetIndex: GROUP_F_SPRITE_INDEX, mediaKind: 'costume' },
        'renamed'
      ).activationSetSha256,
      requireProspectiveActivationCount: 0,
    },
    expectedReferenceSetSha256: referencesBefore.referenceSetSha256,
  } as UnplannedSemanticEditOperationV1)
  const renamed = renaming.planner.candidate
  assert.deepEqual(
    [...mediaFixtureCostumeNames(renamed)],
    ['alpha', 'bravo', 'renamed']
  )
  const menuField = (
    renamed.json.targets[GROUP_F_SPRITE_INDEX]!.blocks as Record<
      string,
      { readonly fields?: Record<string, [string, string | null]> }
    >
  )['menu1']!.fields?.['COSTUME']?.[0]
  assert.equal(
    menuField,
    'renamed',
    'the costume-menu field still names the old costume'
  )
  // a rename changes no ordinal, so the reference stays resolved rather than
  // becoming an unresolved name
  const referencesAfter = mediaReferenceEvidenceV1(renamed, {
    targetIndex: GROUP_F_SPRITE_INDEX,
    mediaKind: 'costume',
    ordinal: 2,
  })
  assert.equal(referencesAfter.directReferenceCount, 1)

  // (b) an order-sensitive block reads ordinal meaning across the whole
  // target+kind domain, so an order-changing operation refuses rather than
  // silently repointing what that block would select
  const ordered = await beginGroupFHarness(t, { orderSensitiveBlock: true })
  const policy = mediaDomainOrderPolicyV1(
    ordered.planner.candidate,
    GROUP_F_SPRITE_INDEX,
    'costume'
  )
  assert.equal(policy.orderSensitiveReferenceCount > 0, true)
  assert.throws(
    () =>
      ordered.planner.add(
        mediaFixtureReorderCostumeOp(
          ordered.sourceProject,
          ordered.planner.candidate,
          'group-f-reorder-under-order-reference',
          'alpha',
          2,
          { state: 'value', value: 0 }
        )
      ),
    (error: unknown) =>
      (error as { code?: string }).code === 'edit.media_order_reference'
  )
  // the same domain still admits a rename, which moves no ordinal at all
  const stillRenamable = mediaReferenceEvidenceV1(ordered.planner.candidate, {
    targetIndex: GROUP_F_SPRITE_INDEX,
    mediaKind: 'costume',
    ordinal: 2,
  })
  assert.equal(stillRenamable.orderSensitiveReferenceCount > 0, true)
})

// the payload the replay executor never receives: it is handed the plain
// production executor, so the costume bytes can only come from the artifacts
// the session retained at admission time
test('Group F admits a costume through the session, applies it, and exactly replays the revision from retained artifacts', async (t) =>
{
  const harness = await beginGroupFHarness(t)
  const session = harness.session
  // (a) the session minted the token & retained the payload as its own artifact
  assert.match(harness.admitted.assetToken, /^asset-[0-9a-f]{32}$/u)
  assert.equal(harness.admitted.mediaKind, 'costume')
  assert.equal(harness.admitted.dataFormat, 'png')
  assert.equal(harness.admitted.byteLength, harness.fixture.deltaPng.byteLength)
  assert.equal(
    harness.admitted.payloadSha256,
    harness.asset.expectedPayloadSha256
  )
  // the metadata digest is derived by the session, never supplied by the caller
  assert.equal(
    harness.admitted.metadataSha256,
    harness.asset.expectedMetadataSha256
  )
  const retainedPayload = await harness.store.readImmutable(
    harness.admitted.payloadKey
  )
  assert.deepEqual([...retainedPayload], [...harness.fixture.deltaPng])

  // (b) the add goes through preview & apply rather than the planner alone
  harness.planner.add(harness.groupF.addCostume)
  const preview = await session.preview(
    {
      requestId: 'preview-group-f-add-costume',
      expectedHead: session.head,
      canonicalTransaction: harness.planner.batch(),
    },
    invocation(3)
  )
  const afterPreviewAdmission = await session.admitAsset(
    {
      requestId: 'observe-group-f-ledger-after-preview',
      expectedHead: session.head,
      source: {
        kind: 'sourceMedia',
        mediaKind: 'costume',
        bytes: harness.fixture.deltaPng,
        expectedPayloadSha256: harness.asset.expectedPayloadSha256,
      },
    },
    invocation(4)
  )
  assert.equal(
    afterPreviewAdmission.ledger.authoredCostumeTextureMaterializations,
    0,
    'preview charged authored materialization usage'
  )
  const apply = await session.apply(
    {
      schemaVersion: 1,
      sessionId: session.sessionId,
      requestId: 'apply-group-f-add-costume',
      ...expectedHeadRequest(preview.preview.expectedHead),
      previewId: preview.preview.previewId,
      applyGuardSha256: preview.preview.applyGuardSha256,
      expectedResolvedPlanSha256: preview.preview.resolvedPlanSha256,
    },
    invocation(5)
  )
  assert.equal(
    apply.head.candidateSha256,
    preview.preview.predictedCandidateSha256,
    'apply committed a candidate the preview did not predict'
  )
  const afterApplyAdmission = await session.admitAsset(
    {
      requestId: 'observe-group-f-ledger-after-apply',
      expectedHead: session.head,
      source: {
        kind: 'sourceMedia',
        mediaKind: 'costume',
        bytes: harness.fixture.deltaPng,
        expectedPayloadSha256: harness.asset.expectedPayloadSha256,
      },
    },
    invocation(6)
  )
  assert.equal(
    afterApplyAdmission.ledger.authoredCostumeTextureMaterializations,
    1,
    'accepted costume add did not charge exactly one materialization'
  )
  assert.equal(
    afterApplyAdmission.ledger.authoredCostumeReferencePixels,
    (await mediaFixtureCostumeIdentity(harness.fixture.deltaPng)).canvasPixels
  )

  // (c) the committed revision carries the costume & its payload byte-exact
  const accepted = session.revisions.at(-1)!
  const committed = await ProjectIR.fromSb3(
    await harness.store.readImmutable(accepted.candidateKey)
  )
  assert.deepEqual(
    [...mediaFixtureCostumeNames(committed)],
    [GROUP_F_ADDED_COSTUME, 'alpha', 'bravo', 'gamma']
  )
  const identity = await mediaFixtureCostumeIdentity(harness.fixture.deltaPng)
  assert.deepEqual(
    [...mediaFixtureAssetBytes(committed, identity.md5ext)],
    [...harness.fixture.deltaPng],
    'the committed archive does not carry the admitted payload byte-exact'
  )
  // the selection followed the record it named across the insert that shifted it
  assert.equal(committed.json.targets[GROUP_F_SPRITE_INDEX]!.currentCostume, 2)

  await session.close(
    {
      schemaVersion: 1,
      sessionId: session.sessionId,
      requestId: 'close-group-f-add-costume',
      reason: 'Group F session media evidence is complete',
      ...expectedHeadRequest(session.head),
    },
    invocation(5)
  )

  // (d) exact replay w/ a plain executor: no asset store, no session state
  const replay = await verifyEditSessionReplayV1({
    artifactStore: harness.store,
    sessionKey: session.manifest.sessionKey,
    boundChangeContract: harness.groupF.valid,
    transactionExecutor: new ProductionTransactionExecutorV1(
      mediaTargetProductionOperationDispatchersV1()
    ),
  })
  assert.deepEqual(replay.failures, [])
  assert.equal(replay.ok, true)
  assert.equal(replay.verifiedRevisionCount, session.revisions.length)
  assert.deepEqual(replay.finalHead, session.head)
})

// the batch that proves media refs resolve against the running candidate: bravo
// stands at pre-batch ordinal 1 but at running ordinal 0 once alpha is gone, so
// a selector resolved against the pre-batch view would select gamma instead
test('Group F applies removeCostume then setCurrentCostume in one session batch and replays it', async (t) =>
{
  const harness = await beginGroupFHarness(t, { selectedCostumeIndex: 2 })
  const session = harness.session
  const preBatch = harness.sourceProject
  assert.deepEqual(
    [...mediaFixtureCostumeNames(preBatch)],
    ['alpha', 'bravo', 'gamma']
  )
  assert.equal(preBatch.json.targets[GROUP_F_SPRITE_INDEX]!.currentCostume, 2)
  assert.equal(mediaFixtureCostumeEvidence(preBatch, 'bravo').ordinal, 1)

  harness.planner.add(
    mediaFixtureRemoveCostumeOp(
      preBatch,
      harness.planner.candidate,
      'session-remove-alpha',
      'alpha',
      { state: 'value', value: 1 }
    )
  )
  // the removal shifted bravo down, so the pre-batch ordinal the next operation
  // carries no longer addresses it
  assert.equal(
    mediaFixtureCostumeEvidence(harness.planner.candidate, 'bravo').ordinal,
    0,
    'the running candidate did not shift bravo down after the removal'
  )
  assert.equal(
    mediaFixtureCostumeEvidence(harness.planner.candidate, 'gamma').ordinal,
    1,
    'a pre-batch ordinal of 1 would now select gamma rather than bravo'
  )
  harness.planner.add(
    mediaFixtureSetCurrentCostumeOp(
      preBatch,
      harness.planner.candidate,
      'session-select-bravo',
      'bravo'
    )
  )

  const preview = await session.preview(
    {
      requestId: 'preview-group-f-remove-then-select',
      expectedHead: session.head,
      canonicalTransaction: harness.planner.batch(),
    },
    invocation(3)
  )
  const apply = await session.apply(
    {
      schemaVersion: 1,
      sessionId: session.sessionId,
      requestId: 'apply-group-f-remove-then-select',
      ...expectedHeadRequest(preview.preview.expectedHead),
      previewId: preview.preview.previewId,
      applyGuardSha256: preview.preview.applyGuardSha256,
      expectedResolvedPlanSha256: preview.preview.resolvedPlanSha256,
    },
    invocation(4)
  )
  assert.equal(
    apply.head.candidateSha256,
    preview.preview.predictedCandidateSha256
  )

  const committed = await ProjectIR.fromSb3(
    await harness.store.readImmutable(session.revisions.at(-1)!.candidateKey)
  )
  assert.deepEqual([...mediaFixtureCostumeNames(committed)], ['bravo', 'gamma'])
  const committedTarget = committed.json.targets[GROUP_F_SPRITE_INDEX]!
  // the selection names bravo: a stale pre-batch ordinal would have left gamma
  // selected at index 1
  assert.equal(committedTarget.currentCostume, 0)
  assert.equal(committedTarget.costumes[0]!.name, 'bravo')

  await session.close(
    {
      schemaVersion: 1,
      sessionId: session.sessionId,
      requestId: 'close-group-f-remove-then-select',
      reason: 'Group F multi-operation media batch evidence is complete',
      ...expectedHeadRequest(session.head),
    },
    invocation(5)
  )
  const replay = await verifyEditSessionReplayV1({
    artifactStore: harness.store,
    sessionKey: session.manifest.sessionKey,
    boundChangeContract: harness.groupF.valid,
    transactionExecutor: new ProductionTransactionExecutorV1(
      mediaTargetProductionOperationDispatchersV1()
    ),
  })
  assert.deepEqual(replay.failures, [])
  assert.equal(replay.ok, true)
  assert.deepEqual(replay.finalHead, session.head)
})

const GROUP_F_CREATED_SPRITE = 'Newcomer'

const GROUP_F_CREATED_SPRITE_PROPERTIES = Object.freeze({
  x: 12,
  y: -34,
  direction: 90,
  size: 100,
  visible: true,
  draggable: false,
  rotationStyle: 'all around' as const,
  volume: 100,
})

// the atomic greenfield contract: one future target binding & one future media
// binding whose creation scope is that same not-yet-existing sprite
function registeredGroupFCreationContracts(
  sourceArtifactSha256: string,
  sourceProject: ProjectIR,
  asset: MediaTargetAdmittedAssetV1
): {
  readonly registry: EditChangeContractRegistryV1
  readonly valid: BoundChangeContractV1
  readonly addSprite: UnplannedSemanticEditOperationV1
  readonly spriteRef: {
    readonly contractRefKind: 'future'
    readonly entityKind: 'target'
    readonly entitySubtype: 'sprite'
    readonly bindingKey: string
  }
}
{
  const spriteRef = {
    contractRefKind: 'future',
    entityKind: 'target',
    entitySubtype: 'sprite',
    bindingKey: 'group-f-created-sprite',
  } as const
  const addSprite = {
    kind: 'target.addSprite',
    opId: 'group-f-add-sprite',
    name: GROUP_F_CREATED_SPRITE,
    visualLayerOrdinal: sourceProject.json.targets.length - 1,
    properties: { ...GROUP_F_CREATED_SPRITE_PROPERTIES },
    nameActivation: {
      expectedActivationSetSha256: targetProspectiveNameActivationV1(
        sourceProject,
        buildSemanticReferenceIndex(sourceProject),
        GROUP_F_CREATED_SPRITE
      ).activationSetSha256,
      requireProspectiveActivationCount: 0,
    },
  } as UnplannedSemanticEditOperationV1
  const targetDescriptor = {
    bindingKind: 'future',
    entityKind: 'target',
    entitySubtype: 'sprite',
    expectedCreatorOperationKind: 'target.addSprite',
    expectedCreationRole: {
      roleKind: 'fixed',
      name: 'target',
      entityKind: 'target',
      entitySubtype: 'sprite',
    },
    expectedCreationScope: {
      scopeKind: 'projectEntityCollection',
      collection: 'targets',
    },
  } as MediaTargetCreationBindingDescriptorV1
  const costumeDescriptor = {
    bindingKind: 'future',
    entityKind: 'media',
    entitySubtype: 'costume',
    expectedCreatorOperationKind: 'media.addCostume',
    expectedCreationRole: {
      roleKind: 'fixed',
      name: 'media',
      entityKind: 'media',
      entitySubtype: 'costume',
    },
    expectedCreationScope: {
      scopeKind: 'targetAndOwnedDescendants',
      target: spriteRef,
    },
  } as MediaTargetCreationBindingDescriptorV1
  // the created sprite is appended, so its content fingerprint is projected at
  // the index the append will take
  const createdTargetIndex = sourceProject.json.targets.length
  const targetContentSha256 = mediaTargetCreationContentFingerprintForResultV1({
    project: sourceProject,
    targetIndex: createdTargetIndex,
    operation: {
      ...addSprite,
      expectedPlanningFactSetSha256: HASH_A,
    } as Extract<SemanticEditOperationV1, { kind: 'target.addSprite' }>,
    descriptor: targetDescriptor,
    resultRole: { roleKind: 'fixed', name: 'target' },
    resolveContractEntityRef: () => spriteRef,
  })
  const addCostume = mediaFixtureCreatedSpriteCostumeOp(asset, 'group-f-add-sprite')
  const costumeContentSha256 = mediaTargetCreationContentFingerprintForResultV1({
    project: sourceProject,
    targetIndex: createdTargetIndex,
    operation: {
      ...addCostume,
      expectedPlanningFactSetSha256: HASH_A,
    } as Extract<SemanticEditOperationV1, { kind: 'media.addCostume' }>,
    descriptor: costumeDescriptor,
    resultRole: { roleKind: 'fixed', name: 'media' },
    resolveContractEntityRef: () => spriteRef,
  })
  const base = structuredClone(SEMANTICALLY_VALID_CHANGE_CONTRACT_SAMPLE)
  base.sourceConstraint = { kind: 'exactArtifact', sourceArtifactSha256 }
  base.entityBindings = [
    {
      bindingKey: spriteRef.bindingKey,
      ...targetDescriptor,
      expectedCreationContentFingerprintSha256: targetContentSha256,
    },
    {
      bindingKey: 'group-f-created-sprite-costume',
      ...costumeDescriptor,
      expectedCreationContentFingerprintSha256: costumeContentSha256,
    },
  ]
  base.allowedOperationKinds = ['target.addSprite', 'media.addCostume']
  const spriteScope = {
    scopeSubjectKind: 'entity' as const,
    operationKind: 'target.addSprite' as const,
    entityKind: 'target' as const,
    entitySubtype: 'sprite' as const,
    locationScope: {
      scopeKind: 'projectEntityCollection' as const,
      collection: 'targets' as const,
    },
    // appending a sprite renumbers the visual layer of every sprite above it, so
    // the contract declares that consequence rather than leaving it unauthorized
    allowedPropertyPaths: [
      { surface: 'target' as const, property: 'name' },
      { surface: 'target' as const, property: 'layerOrder' },
    ],
  }
  const costumeScope = {
    scopeSubjectKind: 'entity' as const,
    operationKind: 'media.addCostume' as const,
    entityKind: 'media' as const,
    entitySubtype: 'costume' as const,
    locationScope: {
      scopeKind: 'targetAndOwnedDescendants' as const,
      target: spriteRef,
    },
    allowedPropertyPaths: [{ surface: 'media' as const, property: 'name' }],
  }
  base.allowedSemanticScopes = [spriteScope, costumeScope]
  base.allowedStructuralChanges = [
    {
      allowanceId: 'group-f-add-sprite-allowance',
      kind: 'entityAddition',
      candidate: spriteRef,
      expectedAddedContentSha256: targetContentSha256,
    },
    {
      allowanceId: 'group-f-add-sprite-costume-allowance',
      kind: 'entityAddition',
      candidate: {
        contractRefKind: 'future',
        entityKind: 'media',
        entitySubtype: 'costume',
        bindingKey: 'group-f-created-sprite-costume',
      },
      expectedAddedContentSha256: costumeContentSha256,
    },
  ]
  base.requiredStructuralChanges = [
    {
      objectiveId: 'group-f-required-add-sprite',
      kind: 'deltaContains',
      direction: 'parent-child',
      operationKind: 'target.addSprite',
      semanticScopeSha256: productionContractScopeSha256V1(
        spriteScope as ContractScopeV1
      ),
      semanticChangeFingerprint: HASH_D,
    },
  ]
  const retainedPolicyArtifacts = attachRetainedPolicyFixturesV1(
    base as unknown as MutableRetainedPolicyContract
  )
  const parsed = parseSemanticChangeContractV1(base)
  assert.equal(
    parsed.ok,
    true,
    parsed.ok ? undefined : JSON.stringify(parsed.issues)
  )
  if (!parsed.ok) assert.fail('Group F creation contract did not parse')
  const registry = new EditChangeContractRegistryV1({
    hostDefaultLimits: HOST_DEFAULT_LIMITS,
    hostHardLimits: HOST_HARD_LIMITS,
  })
  const provenance = {
    authorityId: 'phase-8-group-f-creation-authority',
    hostConfigurationSha256: HASH_A,
    provenanceArtifactSha256: HASH_B,
    registeredAt: '2026-07-20T00:00:00.000Z',
  }
  const displayObjective = boundedDisplayStringV1(
    'create one sprite atomically with its first costume'
  ) as EditChangeContractRegistrationV1['displayObjective']
  const withoutDisplayHash = {
    schemaVersion: 1 as const,
    registrationId: 'phase-8-group-f-creation',
    semanticContract: parsed.value,
    semanticContractSha256: semanticHashV1('change-contract', parsed.value),
    bindingDisplayEvidence: [],
    displayObjective,
    provenance,
  }
  const registration: EditChangeContractRegistrationV1 = {
    ...withoutDisplayHash,
    displayEvidenceSha256: sha256Hex(
      canonicalJsonBytesV1({
        bindingDisplayEvidence: [],
        displayObjective,
        provenance,
      })
    ),
  }
  registry.registerBytes(
    canonicalJsonBytesV1(registration),
    retainedPolicyArtifacts
  )
  registry.seal()
  return {
    registry,
    valid: registry.bind({
      registrationId: registration.registrationId,
      expectedSemanticContractSha256: registration.semanticContractSha256,
      source: { kind: 'exactArtifact', sourceArtifactSha256 },
      existingBindings: [],
    }),
    addSprite,
    spriteRef,
  }
}

// the first costume of a sprite this same batch created: the target is named by
// the producing operation & the selection is the uninitialized created-target arm

// the order & activation digests describe the created sprite's still-empty
// costume collection, so they are supplied from the running candidate. neither
// feeds the creation-content fingerprint, which reads only authored fields
function mediaFixtureCreatedSpriteCostumeOp(
  asset: MediaTargetAdmittedAssetV1,
  creatorOpId: string,
  digests: {
    readonly orderSha256: string
    readonly activationSetSha256: string
  } = { orderSha256: HASH_A, activationSetSha256: HASH_B }
): UnplannedSemanticEditOperationV1
{
  return {
    kind: 'media.addCostume',
    opId: 'group-f-add-first-costume',
    target: {
      entityKind: 'target',
      refKind: 'created',
      opId: creatorOpId,
      slot: { slotKind: 'fixed', name: 'target' },
    },
    asset,
    name: GROUP_F_ADDED_COSTUME,
    order: 0,
    placement: { kind: 'derivedImageCenter' },
    nameActivation: {
      expectedActivationSetSha256: digests.activationSetSha256,
      requireProspectiveActivationCount: 0,
    },
    currentSelection: {
      selectionState: 'uninitializedCreatedTarget',
      expectedCostumeCount: 0,
    },
    expectedCostumeOrderSha256: digests.orderSha256,
    // a sole costume at index 0 w/ no prior raw selection stays absent on the
    // wire, which is exactly Scratch's default rather than a written 0
    expectedFinalCurrentCostumeState: { state: 'missing' },
  } as UnplannedSemanticEditOperationV1
}

// greenfield authoring through a session: a sprite & its first costume are one
// atomic batch, because a sprite without a costume is not a well-formed target
test('Group F creates a sprite and its first costume atomically in one session batch, selecting costume 0', async (t) =>
{
  const root = tempRoot(t)
  const fixture = await buildMediaTargetFixtureSb3()
  const sourceProject = await ProjectIR.fromSb3(fixture.bytes)
  const sourceArtifactSha256 = sha256Hex(fixture.bytes)
  const digests = await mediaFixtureCostumeDigests(fixture.deltaPng)
  const creation = registeredGroupFCreationContracts(
    sourceArtifactSha256,
    sourceProject,
    { assetToken: 'asset-unadmitted-placeholder', ...digests }
  )
  const store = createEditArtifactStoreHostAdapter(root)
  const dispatchers = mediaTargetProductionOperationDispatchersV1()
  const session = await beginGroupFSession({
    store,
    sourceBytes: fixture.bytes,
    sourceArtifactSha256,
    groupF: creation as unknown as MediaTargetContractsV1,
    executor: new ProductionTransactionExecutorV1(dispatchers),
  })
  const admitted = await session.admitAsset(
    {
      requestId: 'admit-group-f-first-costume',
      expectedHead: session.head,
      source: {
        kind: 'sourceMedia',
        mediaKind: 'costume',
        bytes: fixture.deltaPng,
        expectedPayloadSha256: digests.expectedPayloadSha256,
      },
    },
    invocation(2)
  )
  const inspection = await session.inspect({ issueHandles: true })
  const planner = await ProductionBatchPlannerV1.create({
    source: sourceProject,
    sourceBytes: fixture.bytes,
    session,
    store,
    contract: creation.valid,
    inspection,
    resolveAdmittedAsset: session.admittedAssets,
  })

  const priorTargetCount = sourceProject.json.targets.length
  planner.add(creation.addSprite)
  const createdIndex = priorTargetCount
  const created = planner.candidate.json.targets[createdIndex]!
  assert.equal(created.name, GROUP_F_CREATED_SPRITE)
  // a just-created sprite is deliberately costumeless mid-batch, which is the
  // state the batch-close predicate refuses if nothing costumes it
  assert.equal(created.costumes.length, 0)
  assert.throws(
    () => assertCreatedTargetsAreCostumedV1(planner.candidate, [createdIndex]),
    (error: unknown) =>
      (error as { code?: string }).code === 'edit.cardinality_mismatch'
  )

  planner.add(
    mediaFixtureCreatedSpriteCostumeOp(
      { assetToken: admitted.assetToken, ...digests },
      'group-f-add-sprite',
      {
        orderSha256: mediaOrderEvidenceV1(
          planner.candidate.json.targets[createdIndex]!,
          'costume'
        ).orderSha256,
        activationSetSha256: mediaNameActivationEvidenceV1(
          planner.candidate,
          { targetIndex: createdIndex, mediaKind: 'costume' },
          GROUP_F_ADDED_COSTUME
        ).activationSetSha256,
      }
    )
  )
  assertCreatedTargetsAreCostumedV1(planner.candidate, [createdIndex])

  const preview = await session.preview(
    {
      requestId: 'preview-group-f-create-sprite',
      expectedHead: session.head,
      canonicalTransaction: planner.batch(),
    },
    invocation(3)
  )
  const apply = await session.apply(
    {
      schemaVersion: 1,
      sessionId: session.sessionId,
      requestId: 'apply-group-f-create-sprite',
      ...expectedHeadRequest(preview.preview.expectedHead),
      previewId: preview.preview.previewId,
      applyGuardSha256: preview.preview.applyGuardSha256,
      expectedResolvedPlanSha256: preview.preview.resolvedPlanSha256,
    },
    invocation(4)
  )
  assert.equal(
    apply.head.candidateSha256,
    preview.preview.predictedCandidateSha256
  )

  const committed = await ProjectIR.fromSb3(
    await store.readImmutable(session.revisions.at(-1)!.candidateKey)
  )
  assert.equal(committed.json.targets.length, priorTargetCount + 1)
  const committedSprite = committed.json.targets[createdIndex]!
  assert.equal(committedSprite.name, GROUP_F_CREATED_SPRITE)
  assert.equal(committedSprite.isStage, false)
  assert.deepEqual(
    committedSprite.costumes.map((costume) => costume.name),
    [GROUP_F_ADDED_COSTUME]
  )
  // the sole costume of a freshly created sprite is the selected one: the raw
  // field stays absent, & the effective selection that implies is index 0
  const committedSelection = currentCostumeStateV1(committedSprite)
  assert.deepEqual(committedSelection.rawState, { state: 'missing' })
  assert.equal(committedSelection.effectiveIndex, 0)
  const identity = await mediaFixtureCostumeIdentity(fixture.deltaPng)
  assert.equal(committedSprite.costumes[0]!.md5ext, identity.md5ext)
  assert.deepEqual(
    [...mediaFixtureAssetBytes(committed, identity.md5ext)],
    [...fixture.deltaPng]
  )
  // every sprite the fixture already carried is untouched
  assert.deepEqual(
    committed.json.targets
      .slice(0, priorTargetCount)
      .map((entry) => entry.name),
    sourceProject.json.targets.map((entry) => entry.name)
  )

  await session.close(
    {
      schemaVersion: 1,
      sessionId: session.sessionId,
      requestId: 'close-group-f-create-sprite',
      reason: 'Group F atomic sprite creation evidence is complete',
      ...expectedHeadRequest(session.head),
    },
    invocation(5)
  )
  const replay = await verifyEditSessionReplayV1({
    artifactStore: store,
    sessionKey: session.manifest.sessionKey,
    boundChangeContract: creation.valid,
    transactionExecutor: new ProductionTransactionExecutorV1(
      mediaTargetProductionOperationDispatchersV1()
    ),
  })
  assert.deepEqual(replay.failures, [])
  assert.equal(replay.ok, true)
  assert.deepEqual(replay.finalHead, session.head)
})

// the media session keeps the final-costume floor independent from admission,
// while repeated unused payload admission consumes no authored-use allowance
test('Group F refuses removing the final costume and leaves repeated admissions unused', async (t) =>
{
  // (a) the sole costume cannot be removed, & the refusal leaves the session
  // usable rather than driving it into recovery
  const harness = await beginGroupFHarness(t, { soleCostume: true })
  const session = harness.session
  assert.deepEqual(
    [...mediaFixtureCostumeNames(harness.planner.candidate)],
    ['alpha']
  )
  // the sole costume is also still named by a block field, so the refusal
  // proves the cardinality floor is enforced ahead of the reference count
  const references = mediaReferenceEvidenceV1(harness.planner.candidate, {
    targetIndex: GROUP_F_SPRITE_INDEX,
    mediaKind: 'costume',
    ordinal: 0,
  })
  assert.equal(references.directReferenceCount, 1)
  const removal = mediaFixtureRemoveCostumeOp(
    harness.sourceProject,
    harness.planner.candidate,
    'session-remove-last-costume',
    'alpha',
    { state: 'value', value: 0 }
  )
  // the planner refuses at the IR floor, so the batch never reaches the session
  assert.throws(
    () => harness.planner.add(removal),
    (error: unknown) =>
      (error as { code?: string }).code === 'edit.last_costume'
  )
  // submitting the same operation straight to the session refuses identically,
  // which proves the floor is enforced by the transaction & not only by the
  // planner a caller could bypass
  const headBeforeRefusal = session.head
  await assert.rejects(
    () =>
      session.preview(
        {
          requestId: 'preview-group-f-remove-last-costume',
          expectedHead: session.head,
          canonicalTransaction: {
            ...harness.planner.batch(),
            operations: [harness.planner.plan(removal)],
          },
        },
        invocation(3)
      ),
    (error: unknown) =>
      (error as { code?: string }).code === 'edit.last_costume'
  )
  assert.deepEqual(session.head, headBeforeRefusal, 'a refusal moved the head')
  assert.equal(session.status().state, 'active')

  // (b) the same payload admitted again mints a second unused token while the
  // retained payload artifact stays keyed by digest
  const ledgerAfterFirst = harness.admitted.ledger
  assert.equal(ledgerAfterFirst.admittedEditAssets, 1)
  assert.equal(ledgerAfterFirst.authoredCostumeTextureMaterializations, 0)
  const budgetBefore = session.status().budget.artifactBytesUsed
  const sessionPrefix = `sessions/${session.manifest.sessionKey}`
  const evidenceBefore = immutableSessionEvidence(
    await inventory(harness.store, sessionPrefix)
  )
  const second = await session.admitAsset(
    {
      requestId: 'admit-group-f-costume-again',
      expectedHead: session.head,
      source: {
        kind: 'sourceMedia',
        mediaKind: 'costume',
        bytes: harness.fixture.deltaPng,
        expectedPayloadSha256: harness.asset.expectedPayloadSha256,
      },
    },
    invocation(4)
  )
  assert.notEqual(
    second.assetToken,
    harness.admitted.assetToken,
    'a repeated admission reused its predecessor token'
  )
  assert.equal(second.payloadSha256, harness.admitted.payloadSha256)
  assert.equal(second.metadataSha256, harness.admitted.metadataSha256)
  // admission is not authoring, so neither unused token consumes materialization
  assert.equal(second.ledger.admittedEditAssets, 2)
  assert.equal(second.ledger.authoredCostumeTextureMaterializations, 0)
  assert.equal(second.ledger.authoredCostumeReferencePixels, 0)
  // the payload artifact is keyed by digest, so the identical bytes are retained
  // exactly once & only the second per-token record is newly written
  assert.equal(second.payloadKey, harness.admitted.payloadKey)
  assert.notEqual(second.recordKey, harness.admitted.recordKey)
  const payloadPrefix = harness.admitted.payloadKey.slice(
    0,
    harness.admitted.payloadKey.lastIndexOf('/')
  )
  const recordPrefix = harness.admitted.recordKey.slice(
    0,
    harness.admitted.recordKey.lastIndexOf('/')
  )
  const payloadArtifacts = await harness.store.listImmutable(payloadPrefix)
  const recordArtifacts = await harness.store.listImmutable(recordPrefix)
  assert.equal(payloadArtifacts.length, 1, 'the payload was retained twice')
  assert.equal(
    payloadArtifacts[0]!.byteLength,
    harness.fixture.deltaPng.byteLength
  )
  assert.equal(recordArtifacts.length, 2, 'the second token wrote no record')
  // the budget charges the new record & all durable lifecycle evidence, while
  // the digest-keyed payload remains a single retained object
  const growth = session.status().budget.artifactBytesUsed - budgetBefore
  const evidenceAfter = immutableSessionEvidence(
    await inventory(harness.store, sessionPrefix)
  )
  assert.equal(
    growth,
    newlyRetainedEvidenceBytes(evidenceBefore, evidenceAfter),
    'a repeated admission did not charge its exact immutable evidence'
  )
  assert.ok(growth >= (await harness.store.sizeImmutable(second.recordKey)))
  // both tokens resolve, & to the same proven bytes
  const firstResolved = session.admittedAssets(harness.admitted.assetToken)
  const secondResolved = session.admittedAssets(second.assetToken)
  assert.ok(firstResolved && secondResolved)
  assert.deepEqual([...secondResolved.bytes], [...firstResolved.bytes])
  assert.deepEqual([...secondResolved.bytes], [...harness.fixture.deltaPng])
})
