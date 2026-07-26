// packages/ir/src/edit/graph/declaration-operations.ts
// guarded variable, list, & broadcast planning evidence & mutation builders

import {
  createScratchRecord,
  defineScratchRecordValue,
  deleteScratchRecordValue,
  isBlockEntry,
  scratchRecordKeys,
  scratchRecordValue,
  type ScalarVal,
  type Target,
} from '@scratch-agent/sb3'

import type { ProjectIR } from '../../project/project-ir.js'
import { jsonPointerPart as pointerPart } from '../../project/project-vocabulary.js'
import type {
  BroadcastRef,
  DeclarationRef,
  ListRef,
  TargetRef,
  VariableRef,
} from '../../repair/repair-types.js'
import type {
  ExpectedStringIdentityV1,
  OptionalCollectionContainerStateV1,
  ProspectiveNameActivationGuardV1,
  ScratchScalarV1,
} from '../contracts.generated.js'
import { semanticHashV1 } from '../contracts/hash-domains.js'
import { compareLexicalTextV1 as compareText } from '../support/lexical-order.js'
import { unknownNameSemanticsEvidenceV1 } from '../semantic-index/name-semantics-catalog.js'
import { buildSemanticReferenceIndex } from '../semantic-index/reference-index.js'
import {
  blockKey,
  declarationKey,
  monitorKey,
  targetKey,
  type BroadcastUse,
  type DeclarationUse,
  type IndexedMonitor,
  type SemanticReferenceIndex,
} from '../semantic-index/reference-index-types.js'
import {
  expectedStringIdentityV1,
  validateExpectedStringIdentity,
} from '../contracts/semantic-validation.js'

const DECLARATION_OPERATION_KINDS_V1 = [
  'declaration.addVariable',
  'declaration.addList',
  'declaration.addBroadcast',
  'declaration.rename',
  'declaration.setVariableInitialValue',
  'declaration.setListInitialItems',
  'declaration.remove',
] as const

type DeclarationOperationKindV1 =
  (typeof DECLARATION_OPERATION_KINDS_V1)[number]

export type ResolvedDeclarationOperationV1 =
  | {
      readonly opId: string
      readonly kind: 'declaration.addVariable'
      readonly scope: TargetRef
      readonly name: string
      readonly cloud: false
      readonly initialValue: ScratchScalarV1
      readonly nameActivation: ProspectiveNameActivationGuardV1
    }
  | {
      readonly opId: string
      readonly kind: 'declaration.addList'
      readonly scope: TargetRef
      readonly name: string
      readonly initialItems: readonly ScratchScalarV1[]
      readonly nameActivation: ProspectiveNameActivationGuardV1
      readonly expectedListMapState: OptionalCollectionContainerStateV1
    }
  | {
      readonly opId: string
      readonly kind: 'declaration.addBroadcast'
      readonly name: string
      readonly nameActivation: ProspectiveNameActivationGuardV1
      readonly expectedStageBroadcastMapState: OptionalCollectionContainerStateV1
    }
  | {
      readonly opId: string
      readonly kind: 'declaration.rename'
      readonly declaration: DeclarationRef
      readonly expectedName: ExpectedStringIdentityV1
      readonly newName: string
      readonly expectedReferenceSetSha256: string
      readonly newNameActivation: ProspectiveNameActivationGuardV1
    }
  | {
      readonly opId: string
      readonly kind: 'declaration.setVariableInitialValue'
      readonly declaration: VariableRef
      readonly expectedValueFingerprintSha256: string
      readonly newValue: ScratchScalarV1
    }
  | {
      readonly opId: string
      readonly kind: 'declaration.setListInitialItems'
      readonly declaration: ListRef
      readonly expectedItemsSha256: string
      readonly newItems: readonly ScratchScalarV1[]
    }
  | {
      readonly opId: string
      readonly kind: 'declaration.remove'
      readonly declaration: DeclarationRef
      readonly expectedReferenceSetSha256: string
      readonly expectedMonitorSetSha256: string
      readonly requireFinalReferenceCount: 0
      readonly requireFinalMonitorCount: 0
    }

interface DeclarationReferenceEvidenceV1
{
  readonly referenceCount: number
  readonly propagatableReferenceCount: number
  readonly monitorCount: number
  readonly expectedReferenceSetSha256: string
  readonly expectedMonitorSetSha256: string
  readonly referencePaths: readonly string[]
  readonly monitorPaths: readonly string[]
  readonly hasDynamicReference: boolean
}

interface DeclarationNameActivationEvidenceV1
{
  readonly activationCount: number
  readonly activationSetSha256: string
  readonly activationPaths: readonly string[]
}

interface BroadcastRuntimeCollisionEvidenceV1
{
  readonly exactCollisionCount: number
  readonly lowercaseCollisionCount: number
  readonly uppercaseHatCollisionCount: number
  readonly collisionSetSha256: string
  readonly collidingDeclarationKeys: readonly string[]
}

interface DeclarationCapabilityRowV1
{
  readonly kind: DeclarationOperationKindV1
  readonly availability: 'supported' | 'unsupported'
  readonly refusalCodes: readonly string[]
  readonly explanation: string
}

interface DeclarationCapabilityAssessmentV1
{
  readonly family: 'declaration'
  readonly availability: 'supported' | 'unsupported'
  readonly operations: readonly DeclarationCapabilityRowV1[]
  readonly restrictions: readonly string[]
  readonly assessmentSha256: string
}

interface AppliedDeclarationOperationV1
{
  readonly opId: string
  readonly kind: DeclarationOperationKindV1
  readonly declaration: DeclarationRef | null
  readonly createdDeclaration: DeclarationRef | null
  readonly exactPaths: readonly string[]
  readonly pathPrefixes: readonly string[]
  readonly propagatedReferenceCount: number
  readonly propagatedMonitorCount: number
  readonly referenceEvidenceBefore: DeclarationReferenceEvidenceV1 | null
  readonly referenceEvidenceAfter: DeclarationReferenceEvidenceV1 | null
  readonly allocatorState: ReturnType<ProjectIR['uids']['snapshot']>
}

class DeclarationOperationErrorV1 extends Error
{
  constructor(
    readonly code:
      | 'edit.dynamic_reference'
      | 'edit.entity_still_referenced'
      | 'edit.fingerprint_mismatch'
      | 'edit.internal_invariant'
      | 'edit.invalid_owner'
      | 'edit.planning_facts_mismatch'
      | 'edit.postcondition_failed'
      | 'edit.project_constraint'
      | 'edit.reference_propagation_incomplete'
      | 'edit.selector_no_match'
      | 'edit.semantic_noop'
      | 'edit.unsupported_extension'
      | 'edit.unsupported_opcode'
      | 'edit.unsupported_operation',
    message: string,
    readonly matchCount: number | null = null
  )
  {
    super(message)
    this.name = 'DeclarationOperationErrorV1'
  }
}

function declarationPath(declaration: DeclarationRef): string
{
  const collection =
    declaration.kind === 'variable'
      ? 'variables'
      : declaration.kind === 'list'
        ? 'lists'
        : 'broadcasts'
  return `/targets/${declaration.declarationTarget.targetIndex}/${collection}/${pointerPart(declaration.id)}`
}

function declarationUsePath(use: DeclarationUse): string
{
  const base = `/targets/${use.block.target.targetIndex}/blocks/${pointerPart(use.block.blockId)}`
  if (use.source === 'top-level-primitive') return `${base}/1`
  if (use.source === 'field' || use.source === 'sensing-property')
    return `${base}/fields/${pointerPart(use.siteName!)}/0`
  return `${base}/inputs/${pointerPart(use.siteName!)}/${use.inputSlotIndex}/1`
}

function monitorPath(monitor: IndexedMonitor): string
{
  return `/monitors/${monitor.ref.monitorIndex}`
}

function hashSet(kind: string, rows: readonly unknown[]): string
{
  return semanticHashV1('semantic-fingerprint', {
    schemaVersion: 1,
    setKind: kind,
    rows,
  })
}

function assertAuthoringName(name: string): void
{
  const bytes = new TextEncoder().encode(name)
  if (
    name.length === 0 ||
    bytes.byteLength > 256 ||
    name.includes('\0') ||
    name.normalize('NFC') !== name ||
    /[\uD800-\uDFFF]/u.test(
      [...name].filter((value) => value.length === 1).join('')
    )
  )
    throw new DeclarationOperationErrorV1(
      'edit.project_constraint',
      'declaration name violates the V1 authoring contract'
    )
}

function assertScalar(value: ScratchScalarV1): asserts value is ScalarVal
{
  if (typeof value === 'number')
  {
    if (
      !Number.isFinite(value) ||
      Object.is(value, -0) ||
      (Number.isInteger(value) && !Number.isSafeInteger(value))
    )
      throw new DeclarationOperationErrorV1(
        'edit.project_constraint',
        'declaration scalar number violates the V1 numeric contract'
      )
    return
  }
  if (typeof value === 'boolean') return
  if (
    typeof value !== 'string' ||
    new TextEncoder().encode(value).byteLength > 60 * 1024 ||
    value.includes('\0') ||
    value.normalize('NFC') !== value
  )
    throw new DeclarationOperationErrorV1(
      'edit.project_constraint',
      'declaration scalar string violates the V1 authoring contract'
    )
}

function assertItems(
  items: readonly ScratchScalarV1[]
): asserts items is readonly ScalarVal[]
{
  if (items.length > 100_000)
    throw new DeclarationOperationErrorV1(
      'edit.project_constraint',
      'list initial item count exceeds the V1 limit'
    )
  for (const item of items) assertScalar(item)
}

function targetMatches(left: TargetRef, right: TargetRef): boolean
{
  return targetKey(left) === targetKey(right)
}

function resolveTarget(project: ProjectIR, ref: TargetRef): Target
{
  const target = project.json.targets[ref.targetIndex]
  if (!target || target.name !== ref.name || target.isStage !== ref.isStage)
    throw new DeclarationOperationErrorV1(
      'edit.selector_no_match',
      'declaration scope target does not exactly match the current head'
    )
  return target
}

function uniqueStage(project: ProjectIR): { target: Target; ref: TargetRef }
{
  const stages = project.json.targets.flatMap((target, targetIndex) =>
    target.isStage
      ? [{ target, ref: { targetIndex, name: target.name, isStage: true } }]
      : []
  )
  if (stages.length !== 1)
    throw new DeclarationOperationErrorV1(
      'edit.project_constraint',
      'broadcast mutation requires exactly one stage'
    )
  return stages[0]!
}

function selectedDeclaration(
  project: ProjectIR,
  index: SemanticReferenceIndex,
  ref: DeclarationRef
): DeclarationRef
{
  resolveTarget(project, ref.declarationTarget)
  const indexed =
    ref.kind === 'broadcast'
      ? index.broadcastByKey.get(declarationKey(ref))
      : index.declarationByKey.get(declarationKey(ref))
  if (!indexed || indexed.declaration.name !== ref.name)
    throw new DeclarationOperationErrorV1(
      'edit.selector_no_match',
      'declaration does not exactly match the current head'
    )
  const idRecords =
    ref.kind === 'broadcast'
      ? index.broadcastsById.get(ref.id)
      : index.declarationsById.get(ref.id)
  if (idRecords?.length !== 1)
    throw new DeclarationOperationErrorV1(
      'edit.project_constraint',
      'declaration raw ID is not project-unique'
    )
  if (ref.kind === 'broadcast' && !ref.declarationTarget.isStage)
    throw new DeclarationOperationErrorV1(
      'edit.invalid_owner',
      'sprite-owned broadcasts are preservation-only in V1'
    )
  return indexed.declaration
}

function referenceRows(
  index: SemanticReferenceIndex,
  declaration: DeclarationRef
): {
  uses: DeclarationUse[]
  broadcastUses: BroadcastUse[]
  incompletePaths: string[]
  dynamicPaths: string[]
  monitors: IndexedMonitor[]
}
{
  const key = declarationKey(declaration)
  const uses =
    declaration.kind === 'broadcast'
      ? []
      : [
          ...(index.declarationByKey.get(key)?.references ?? []),
          ...index.sensingDeclarationUses.filter(
            (use) =>
              use.declaration !== null &&
              declarationKey(use.declaration) === key
          ),
        ]
  const broadcast =
    declaration.kind === 'broadcast' ? index.broadcastByKey.get(key) : undefined
  const broadcastUses = broadcast
    ? [...broadcast.senders, ...broadcast.receivers]
    : []
  const incompletePaths =
    declaration.kind === 'broadcast'
      ? []
      : index.sensingDeclarationUses
          .filter(
            (use) =>
              use.declaration === null &&
              use.candidateDeclarations.some(
                (candidate) => declarationKey(candidate) === key
              )
          )
          .map(declarationUsePath)
  const dynamicPaths =
    declaration.kind === 'broadcast'
      ? index.dynamicBroadcastSenders.map((use) => use.path)
      : declaration.kind === 'variable'
        ? index.dynamicDeclarationNameReferences
            .filter((use) => use.referencedName === declaration.name)
            .map(
              (use) =>
                `/targets/${use.block.target.targetIndex}/blocks/${pointerPart(use.block.blockId)}/fields/PROPERTY/0`
            )
        : []
  const monitors = index.monitors.filter((monitor) =>
    monitor.candidateDeclarations.some(
      (candidate) => declarationKey(candidate) === key
    )
  )
  return { uses, broadcastUses, incompletePaths, dynamicPaths, monitors }
}

export function declarationReferenceEvidenceV1(
  project: ProjectIR,
  declaration: DeclarationRef
): DeclarationReferenceEvidenceV1
{
  const index = buildSemanticReferenceIndex(project)
  return declarationReferenceEvidenceFromIndex(project, index, declaration)
}

function declarationReferenceEvidenceFromIndex(
  project: ProjectIR,
  index: SemanticReferenceIndex,
  declaration: DeclarationRef
): DeclarationReferenceEvidenceV1
{
  const selected = selectedDeclaration(project, index, declaration)
  const rows = referenceRows(index, selected)
  const referenceRowsForHash = [
    ...rows.uses.map((use) => ({
      kind: use.source,
      path: declarationUsePath(use),
      sourceEntityKey: blockKey(use.block),
      propagatable: true,
    })),
    ...rows.broadcastUses.map((use) => ({
      kind: use.source,
      path: use.path,
      sourceEntityKey: blockKey(use.block),
      propagatable: true,
    })),
    ...rows.incompletePaths.map((path) => ({
      kind: 'incomplete-static',
      path,
      sourceEntityKey: path,
      propagatable: false,
    })),
    ...rows.dynamicPaths.map((path) => ({
      kind: 'dynamic',
      path,
      sourceEntityKey: path,
      propagatable: false,
    })),
  ].sort((left, right) => compareText(left.path, right.path))
  const monitorRows = rows.monitors
    .map((monitor) => ({
      path: monitorPath(monitor),
      sourceEntityKey: monitorKey(monitor.ref),
      monitorId: monitor.ref.monitorId,
    }))
    .sort((left, right) => compareText(left.path, right.path))
  return Object.freeze({
    referenceCount: referenceRowsForHash.length + monitorRows.length,
    propagatableReferenceCount:
      rows.uses.length + rows.broadcastUses.length + monitorRows.length,
    monitorCount: monitorRows.length,
    expectedReferenceSetSha256: hashSet('declaration-reference-set-v1', [
      ...referenceRowsForHash,
      ...monitorRows,
    ]),
    expectedMonitorSetSha256: hashSet(
      'declaration-monitor-set-v1',
      monitorRows
    ),
    referencePaths: Object.freeze(referenceRowsForHash.map((row) => row.path)),
    monitorPaths: Object.freeze(monitorRows.map((row) => row.path)),
    hasDynamicReference:
      rows.incompletePaths.length > 0 || rows.dynamicPaths.length > 0,
  })
}

export function optionalCollectionContainerStateV1(
  value: Record<string, unknown> | undefined
): OptionalCollectionContainerStateV1
{
  if (value === undefined) return { state: 'missing' }
  const rows = scratchRecordKeys(value)
    .sort(compareText)
    .map((key) => ({ key, value: scratchRecordValue(value, key) }))
  return {
    state: 'present',
    expectedEntryCount: rows.length,
    expectedEntrySetSha256: hashSet('scratch-record-entry-set-v1', rows),
  }
}

export function declarationValueFingerprintV1(value: ScratchScalarV1): string
{
  assertScalar(value)
  return hashSet('declaration-scalar-value-v1', [value])
}

export function declarationItemsFingerprintV1(
  items: readonly ScratchScalarV1[]
): string
{
  assertItems(items)
  return hashSet('declaration-list-items-v1', items)
}

function sameContainerState(
  expected: OptionalCollectionContainerStateV1,
  actual: OptionalCollectionContainerStateV1
): boolean
{
  return (
    expected.state === actual.state &&
    (expected.state === 'missing' ||
      (actual.state === 'present' &&
        expected.expectedEntryCount === actual.expectedEntryCount &&
        expected.expectedEntrySetSha256 === actual.expectedEntrySetSha256))
  )
}

export function broadcastRuntimeCollisionEvidenceV1(
  project: ProjectIR,
  name: string,
  excluding?: BroadcastRef
): BroadcastRuntimeCollisionEvidenceV1
{
  const index = buildSemanticReferenceIndex(project)
  return broadcastRuntimeCollisionEvidenceFromIndex(index, name, excluding)
}

function broadcastRuntimeCollisionEvidenceFromIndex(
  index: SemanticReferenceIndex,
  name: string,
  excluding?: BroadcastRef
): BroadcastRuntimeCollisionEvidenceV1
{
  const rows = index.broadcasts
    .filter(
      (entry) =>
        excluding === undefined ||
        declarationKey(entry.declaration) !== declarationKey(excluding)
    )
    .map((entry) => ({
      key: declarationKey(entry.declaration),
      name: entry.declaration.name,
      exact: entry.declaration.name === name,
      lowercase: entry.declaration.name.toLowerCase() === name.toLowerCase(),
      uppercaseHat: entry.declaration.name.toUpperCase() === name.toUpperCase(),
    }))
    .filter((entry) => entry.exact || entry.lowercase || entry.uppercaseHat)
    .sort((left, right) => compareText(left.key, right.key))
  return Object.freeze({
    exactCollisionCount: rows.filter((row) => row.exact).length,
    lowercaseCollisionCount: rows.filter((row) => row.lowercase).length,
    uppercaseHatCollisionCount: rows.filter((row) => row.uppercaseHat).length,
    collisionSetSha256: hashSet('broadcast-runtime-collision-set-v1', rows),
    collidingDeclarationKeys: Object.freeze(rows.map((row) => row.key)),
  })
}

function scopeCanActivate(
  declarationKind: 'variable' | 'list',
  scope: TargetRef,
  use: DeclarationUse
): boolean
{
  if (use.referencedKind !== declarationKind) return false
  if (use.source === 'sensing-property')
    return targetMatches(scope, use.lookupTarget)
  if (targetMatches(scope, use.lookupTarget)) return true
  return scope.isStage
}

export function declarationNameActivationEvidenceV1(
  project: ProjectIR,
  kind: 'variable' | 'list' | 'broadcast',
  scope: TargetRef | null,
  name: string,
  excluding?: DeclarationRef
): DeclarationNameActivationEvidenceV1
{
  const index = buildSemanticReferenceIndex(project)
  return declarationNameActivationEvidenceFromIndex(
    index,
    kind,
    scope,
    name,
    excluding
  )
}

function declarationNameActivationEvidenceFromIndex(
  index: SemanticReferenceIndex,
  kind: 'variable' | 'list' | 'broadcast',
  scope: TargetRef | null,
  name: string,
  excluding?: DeclarationRef
): DeclarationNameActivationEvidenceV1
{
  const rows: { kind: string; path: string }[] = []
  if (kind === 'broadcast')
  {
    for (const use of index.unresolvedBroadcastUses)
    {
      if (
        use.referencedName !== null &&
        use.referencedName.toLowerCase() === name.toLowerCase()
      )
        rows.push({ kind: 'unresolved-static', path: use.path })
    }
    for (const use of index.dynamicBroadcastSenders)
      rows.push({ kind: 'dynamic', path: use.path })
  }
  else
  {
    if (scope === null)
      throw new DeclarationOperationErrorV1(
        'edit.invalid_owner',
        'variable/list activation requires an exact target scope'
      )
    for (const use of [
      ...index.unresolvedDeclarationUses,
      ...index.sensingDeclarationUses.filter(
        (entry) => entry.declaration === null
      ),
    ])
    {
      if (use.referencedName === name && scopeCanActivate(kind, scope, use))
        rows.push({ kind: 'unresolved-static', path: declarationUsePath(use) })
    }
    if (kind === 'variable')
    {
      for (const use of index.dynamicDeclarationNameReferences)
      {
        if (use.referencedName !== name) continue
        rows.push({
          kind: 'dynamic',
          path: `/targets/${use.block.target.targetIndex}/blocks/${pointerPart(use.block.blockId)}/fields/PROPERTY/0`,
        })
      }
    }
  }
  const excludedKey = excluding ? declarationKey(excluding) : null
  const duplicates =
    kind === 'broadcast'
      ? index.broadcasts.filter(
          (entry) =>
            declarationKey(entry.declaration) !== excludedKey &&
            entry.declaration.name === name
        )
      : [...index.variables, ...index.lists].filter(
          (entry) =>
            entry.declaration.kind === kind &&
            declarationKey(entry.declaration) !== excludedKey &&
            scope !== null &&
            targetMatches(entry.declaration.declarationTarget, scope) &&
            entry.declaration.name === name
        )
  for (const duplicate of duplicates)
    rows.push({
      kind: 'declaration-collision',
      path: declarationPath(duplicate.declaration),
    })
  rows.sort(
    (left, right) =>
      compareText(left.path, right.path) || compareText(left.kind, right.kind)
  )
  return Object.freeze({
    activationCount: rows.length,
    activationSetSha256: hashSet('prospective-name-activation-set-v1', rows),
    activationPaths: Object.freeze(rows.map((row) => row.path)),
  })
}

function assertActivation(
  expected: ProspectiveNameActivationGuardV1,
  evidence: DeclarationNameActivationEvidenceV1
): void
{
  if (expected.expectedActivationSetSha256 !== evidence.activationSetSha256)
    throw new DeclarationOperationErrorV1(
      'edit.planning_facts_mismatch',
      'prospective declaration activation set changed'
    )
  if (evidence.activationCount !== expected.requireProspectiveActivationCount)
    throw new DeclarationOperationErrorV1(
      'edit.dynamic_reference',
      'declaration add/rename would activate an unresolved or dynamic reference'
    )
}

function assertReferenceIntegrity(project: ProjectIR): void
{
  const index = buildSemanticReferenceIndex(project)
  assertReferenceIntegrityWithIndex(index)
}

function assertReferenceIntegrityWithIndex(
  index: SemanticReferenceIndex
): void
{
  const invalidDeclaration = [
    ...index.unresolvedDeclarationUses,
    ...index.variables.flatMap((entry) => entry.references),
    ...index.lists.flatMap((entry) => entry.references),
  ].find(
    (use) =>
      use.declaration === null ||
      use.resolutionStatus !== 'resolved-id' ||
      use.displayNameMismatch
  )
  const invalidSensing = index.sensingDeclarationUses.find(
    (use) =>
      use.declaration === null ||
      use.resolutionStatus !== 'resolved-sensing-name'
  )
  const invalidBroadcast = [
    ...index.unresolvedBroadcastUses,
    ...index.broadcasts.flatMap((entry) => [
      ...entry.senders,
      ...entry.receivers,
    ]),
  ].find(
    (use) =>
      use.declaration === null ||
      use.resolutionStatus !== 'resolved' ||
      use.resolutionSource !== 'id' ||
      use.idNameMismatch ||
      use.displayNameMismatch ||
      use.normalizedName !== null ||
      use.referencedName !== use.declaration.name
  )
  const invalidMonitor = index.monitors.find(
    (monitor) =>
      monitor.declarationKind !== null &&
      (monitor.targetStatus !== 'unique' ||
        monitor.declarationStatus !== 'unique' ||
        monitor.declaration === null ||
        (monitor.resolutionSource !== 'local-id' &&
          monitor.resolutionSource !== 'stage-id') ||
        monitor.displayNameMismatch ||
        monitor.referencedName !== monitor.declaration.name)
  )
  if (
    invalidDeclaration ||
    invalidSensing ||
    invalidBroadcast ||
    invalidMonitor
  )
    throw new DeclarationOperationErrorV1(
      'edit.reference_propagation_incomplete',
      'project declaration references are not exact and complete'
    )
}

function assertNoUnknownNameSemantics(project: ProjectIR): void
{
  const evidence = unknownNameSemanticsEvidenceV1(project.json)
  if (evidence.declaredExtensions.length > 0)
    throw new DeclarationOperationErrorV1(
      'edit.unsupported_extension',
      'declaration add/rename/remove is unavailable with unknown extension name semantics'
    )
  if (evidence.unknownOpcodes.length > 0 || evidence.surfaceIssues.length > 0)
    throw new DeclarationOperationErrorV1(
      'edit.unsupported_opcode',
      'declaration add/rename/remove is unavailable with unknown raw name semantics'
    )
}

function assertBroadcastProjectMutable(project: ProjectIR): void
{
  uniqueStage(project)
  const index = buildSemanticReferenceIndex(project)
  assertBroadcastIndexMutable(index)
}

function assertBroadcastProjectMutableWithIndex(
  project: ProjectIR,
  index: SemanticReferenceIndex
): void
{
  uniqueStage(project)
  assertBroadcastIndexMutable(index)
}

function assertBroadcastIndexMutable(index: SemanticReferenceIndex): void
{
  if (
    index.broadcasts.some(
      (entry) => !entry.declaration.declarationTarget.isStage
    ) ||
    [...index.broadcastsById.values()].some((entries) => entries.length !== 1)
  )
    throw new DeclarationOperationErrorV1(
      'edit.project_constraint',
      'broadcast mutation requires unique stage-owned raw broadcast records'
    )
  for (const entry of index.broadcasts)
  {
    const collision = broadcastRuntimeCollisionEvidenceFromIndex(
      index,
      entry.declaration.name,
      entry.declaration
    )
    if (
      collision.exactCollisionCount > 0 ||
      collision.lowercaseCollisionCount > 0 ||
      collision.uppercaseHatCollisionCount > 0
    )
      throw new DeclarationOperationErrorV1(
        'edit.project_constraint',
        'existing broadcast runtime-equivalence collision is preservation-only'
      )
  }
}

export function assessDeclarationCapabilitiesV1(
  project: ProjectIR
): DeclarationCapabilityAssessmentV1
{
  const restrictions: string[] = []
  let exactReferences = true
  const unknownSemantics = unknownNameSemanticsEvidenceV1(project.json)
  const unknownSemanticsCode =
    unknownSemantics.declaredExtensions.length > 0
      ? ('edit.unsupported_extension' as const)
      : unknownSemantics.unknownOpcodes.length > 0 ||
          unknownSemantics.surfaceIssues.length > 0
        ? ('edit.unsupported_opcode' as const)
        : null
  let broadcastMutable = true
  const hasCloudVariables = project.json.targets.some((target) =>
    scratchRecordKeys(target.variables).some((variableId) =>
    {
      const raw = scratchRecordValue(target.variables, variableId)
      return Array.isArray(raw) && raw[2] === true
    })
  )
  if (hasCloudVariables)
    restrictions.push(
      'cloud variable removal is unavailable; declaration.remove is not advertised'
    )
  try
  {
    assertReferenceIntegrity(project)
  }
  catch
  {
    exactReferences = false
    restrictions.push('declaration reference integrity is incomplete')
  }
  if (unknownSemanticsCode !== null)
  {
    restrictions.push(
      unknownSemanticsCode === 'edit.unsupported_extension'
        ? 'unknown extension name semantics restrict structural declaration edits'
        : 'unknown block opcode name semantics restrict structural declaration edits'
    )
  }
  try
  {
    assertBroadcastProjectMutable(project)
  }
  catch
  {
    broadcastMutable = false
    restrictions.push(
      'broadcast ownership, ID, or runtime-equivalence constraints are not mutable'
    )
  }
  const operations = DECLARATION_OPERATION_KINDS_V1.map((kind) =>
  {
    const broadcastOperation = kind === 'declaration.addBroadcast'
    const structural =
      kind === 'declaration.addVariable' ||
      kind === 'declaration.addList' ||
      kind === 'declaration.addBroadcast' ||
      kind === 'declaration.rename' ||
      kind === 'declaration.remove'
    const cloudRemoval = kind === 'declaration.remove' && hasCloudVariables
    const supported =
      (!structural || exactReferences) &&
      (!structural || unknownSemanticsCode === null) &&
      (!broadcastOperation || broadcastMutable) &&
      !cloudRemoval
    return Object.freeze({
      kind,
      availability: supported
        ? ('supported' as const)
        : ('unsupported' as const),
      refusalCodes: Object.freeze(
        supported
          ? []
          : [
              unknownSemanticsCode !== null && structural
                ? unknownSemanticsCode
                : structural && !exactReferences
                  ? 'edit.reference_propagation_incomplete'
                  : cloudRemoval
                    ? 'edit.unsupported_operation'
                    : 'edit.project_constraint',
            ]
      ),
      explanation: supported
        ? 'complete declaration preview/apply builder is available subject to exact operation guards'
        : cloudRemoval
          ? 'cloud variables are preservation-only for removal in V1'
          : 'project-specific declaration constraints make this operation unavailable',
    })
  })
  const assessment = {
    family: 'declaration' as const,
    availability: operations.some((row) => row.availability === 'supported')
      ? ('supported' as const)
      : ('unsupported' as const),
    operations: Object.freeze(operations),
    restrictions: Object.freeze(restrictions.sort(compareText)),
  }
  return Object.freeze({
    ...assessment,
    assessmentSha256: semanticHashV1('capability-profile', assessment),
  })
}

function assertExpectedName(
  expected: ExpectedStringIdentityV1,
  actual: string
): void
{
  const validation = validateExpectedStringIdentity(expected, actual)
  if (!validation.valid)
    throw new DeclarationOperationErrorV1(
      'edit.fingerprint_mismatch',
      'declaration expected name identity is stale'
    )
}

function propagateDeclarationName(
  project: ProjectIR,
  declaration: DeclarationRef,
  newName: string,
  index: SemanticReferenceIndex
): { references: number; monitors: number; paths: string[] }
{
  const rows = referenceRows(index, declaration)
  if (rows.dynamicPaths.length > 0)
    throw new DeclarationOperationErrorV1(
      'edit.dynamic_reference',
      'dynamic declaration reference cannot be safely renamed'
    )
  const paths: string[] = []
  for (const use of rows.uses)
  {
    const target = project.json.targets[use.block.target.targetIndex]!
    const entry = scratchRecordValue(target.blocks, use.block.blockId)
    if (use.source === 'top-level-primitive')
    {
      if (!Array.isArray(entry))
        throw new DeclarationOperationErrorV1(
          'edit.internal_invariant',
          'indexed top-level declaration primitive disappeared'
        )
      entry[1] = newName
    }
    else if (isBlockEntry(entry))
    {
      if (use.source === 'field' || use.source === 'sensing-property')
      {
        const field = scratchRecordValue(entry.fields, use.siteName!)
        if (!field)
          throw new DeclarationOperationErrorV1(
            'edit.internal_invariant',
            'indexed declaration field disappeared'
          )
        field[0] = newName
      }
      else
      {
        const input = scratchRecordValue(entry.inputs, use.siteName!)
        const primitive = input?.[use.inputSlotIndex!]
        if (!Array.isArray(primitive))
          throw new DeclarationOperationErrorV1(
            'edit.internal_invariant',
            'indexed declaration input primitive disappeared'
          )
        primitive[1] = newName
      }
    }
    else
      throw new DeclarationOperationErrorV1(
        'edit.internal_invariant',
        'indexed declaration reference block disappeared'
      )
    paths.push(declarationUsePath(use))
  }
  for (const use of rows.broadcastUses)
  {
    const target = project.json.targets[use.block.target.targetIndex]!
    const entry = scratchRecordValue(target.blocks, use.block.blockId)
    if (!isBlockEntry(entry))
      throw new DeclarationOperationErrorV1(
        'edit.internal_invariant',
        'indexed broadcast reference block disappeared'
      )
    if (use.fieldName !== null)
    {
      const field = scratchRecordValue(entry.fields, use.fieldName)
      if (!field)
        throw new DeclarationOperationErrorV1(
          'edit.internal_invariant',
          'indexed broadcast field disappeared'
        )
      field[0] = newName
    }
    else
    {
      const input = scratchRecordValue(entry.inputs, use.inputName!)
      const primitive = input?.[use.inputSlotIndex!]
      if (!Array.isArray(primitive) || primitive[0] !== 11)
        throw new DeclarationOperationErrorV1(
          'edit.internal_invariant',
          'indexed broadcast primitive disappeared'
        )
      primitive[1] = newName
    }
    paths.push(use.path)
  }
  for (const monitor of rows.monitors)
  {
    const raw = project.json.monitors?.[monitor.ref.monitorIndex]
    if (!raw || raw.id !== declaration.id || monitor.declarationKind === null)
      throw new DeclarationOperationErrorV1(
        'edit.internal_invariant',
        'indexed declaration monitor disappeared'
      )
    const parameterName =
      monitor.declarationKind === 'variable' ? 'VARIABLE' : 'LIST'
    defineScratchRecordValue<ScalarVal>(raw.params, parameterName, newName)
    paths.push(`${monitorPath(monitor)}/params/${parameterName}`)
  }
  return {
    references: rows.uses.length + rows.broadcastUses.length,
    monitors: rows.monitors.length,
    paths,
  }
}

function rawDeclarationEntry(
  project: ProjectIR,
  declaration: DeclarationRef
): unknown[] | string
{
  const target = resolveTarget(project, declaration.declarationTarget)
  if (declaration.kind === 'variable')
    return scratchRecordValue(target.variables, declaration.id)!
  if (declaration.kind === 'list')
    return scratchRecordValue(target.lists, declaration.id)!
  return scratchRecordValue(target.broadcasts, declaration.id)!
}

function assertExpectedReferenceEvidence(
  expectedReferenceSetSha256: string,
  actual: DeclarationReferenceEvidenceV1
): void
{
  if (expectedReferenceSetSha256 !== actual.expectedReferenceSetSha256)
    throw new DeclarationOperationErrorV1(
      'edit.planning_facts_mismatch',
      'declaration reference set changed'
    )
}

export function applyResolvedDeclarationOperationV1(
  project: ProjectIR,
  operation: ResolvedDeclarationOperationV1
): AppliedDeclarationOperationV1
{
  const valueOnly =
    operation.kind === 'declaration.setVariableInitialValue' ||
    operation.kind === 'declaration.setListInitialItems'
  if (!valueOnly)
  {
    assertNoUnknownNameSemantics(project)
  }
  const index = buildSemanticReferenceIndex(project)
  if (!valueOnly) assertReferenceIntegrityWithIndex(index)
  let declaration: DeclarationRef | null = null
  let createdDeclaration: DeclarationRef | null = null
  let before: DeclarationReferenceEvidenceV1 | null = null
  const exactPaths: string[] = []
  let propagatedReferenceCount = 0
  let propagatedMonitorCount = 0

  if (
    operation.kind === 'declaration.addVariable' ||
    operation.kind === 'declaration.addList'
  )
  {
    assertNoUnknownNameSemantics(project)
    assertAuthoringName(operation.name)
    const target = resolveTarget(project, operation.scope)
    const activation = declarationNameActivationEvidenceFromIndex(
      index,
      operation.kind === 'declaration.addVariable' ? 'variable' : 'list',
      operation.scope,
      operation.name
    )
    assertActivation(operation.nameActivation, activation)
    if (operation.kind === 'declaration.addVariable')
    {
      assertScalar(operation.initialValue)
      const id = project.uids.next('var')
      defineScratchRecordValue(target.variables, id, [
        operation.name,
        operation.initialValue,
      ])
      createdDeclaration = {
        kind: 'variable',
        declarationTarget: operation.scope,
        id,
        name: operation.name,
      }
      exactPaths.push(`/targets/${operation.scope.targetIndex}/variables/${id}`)
    }
    else
    {
      assertItems(operation.initialItems)
      const actualState = optionalCollectionContainerStateV1(target.lists)
      if (!sameContainerState(operation.expectedListMapState, actualState))
        throw new DeclarationOperationErrorV1(
          'edit.planning_facts_mismatch',
          'list collection container state changed'
        )
      if (target.lists === undefined) target.lists = createScratchRecord()
      const id = project.uids.next('list')
      defineScratchRecordValue(target.lists, id, [
        operation.name,
        [...operation.initialItems],
      ])
      createdDeclaration = {
        kind: 'list',
        declarationTarget: operation.scope,
        id,
        name: operation.name,
      }
      exactPaths.push(
        `/targets/${operation.scope.targetIndex}/lists/${pointerPart(id)}`
      )
      if (actualState.state === 'missing')
        exactPaths.push(`/targets/${operation.scope.targetIndex}/lists`)
    }
  }
  else if (operation.kind === 'declaration.addBroadcast')
  {
    assertNoUnknownNameSemantics(project)
    assertBroadcastProjectMutableWithIndex(project, index)
    assertAuthoringName(operation.name)
    const stage = uniqueStage(project)
    const activation = declarationNameActivationEvidenceFromIndex(
      index,
      'broadcast',
      null,
      operation.name
    )
    assertActivation(operation.nameActivation, activation)
    const collision = broadcastRuntimeCollisionEvidenceFromIndex(
      index,
      operation.name
    )
    if (
      collision.exactCollisionCount > 0 ||
      collision.lowercaseCollisionCount > 0 ||
      collision.uppercaseHatCollisionCount > 0
    )
      throw new DeclarationOperationErrorV1(
        'edit.project_constraint',
        'broadcast name collides under pinned runtime equivalence'
      )
    const actualState = optionalCollectionContainerStateV1(
      stage.target.broadcasts
    )
    if (
      !sameContainerState(operation.expectedStageBroadcastMapState, actualState)
    )
      throw new DeclarationOperationErrorV1(
        'edit.planning_facts_mismatch',
        'stage broadcast collection container state changed'
      )
    if (stage.target.broadcasts === undefined)
      stage.target.broadcasts = createScratchRecord()
    const id = project.uids.next('broadcast')
    defineScratchRecordValue(stage.target.broadcasts, id, operation.name)
    createdDeclaration = {
      kind: 'broadcast',
      declarationTarget: stage.ref,
      id,
      name: operation.name,
    }
    exactPaths.push(
      `/targets/${stage.ref.targetIndex}/broadcasts/${pointerPart(id)}`
    )
    if (actualState.state === 'missing')
      exactPaths.push(`/targets/${stage.ref.targetIndex}/broadcasts`)
  }
  else
  {
    declaration = selectedDeclaration(project, index, operation.declaration)
    before = declarationReferenceEvidenceFromIndex(project, index, declaration)
    if (operation.kind === 'declaration.rename')
    {
      assertNoUnknownNameSemantics(project)
      assertExpectedName(operation.expectedName, declaration.name)
      assertAuthoringName(operation.newName)
      assertExpectedReferenceEvidence(
        operation.expectedReferenceSetSha256,
        before
      )
      if (operation.newName === declaration.name)
        throw new DeclarationOperationErrorV1(
          'edit.semantic_noop',
          'declaration rename is a semantic no-op'
        )
      if (declaration.kind === 'broadcast')
      {
        assertBroadcastProjectMutableWithIndex(project, index)
        const collision = broadcastRuntimeCollisionEvidenceFromIndex(
          index,
          operation.newName,
          declaration
        )
        if (
          collision.exactCollisionCount > 0 ||
          collision.lowercaseCollisionCount > 0 ||
          collision.uppercaseHatCollisionCount > 0
        )
          throw new DeclarationOperationErrorV1(
            'edit.project_constraint',
            'broadcast rename collides under pinned runtime equivalence'
          )
      }
      const activation = declarationNameActivationEvidenceFromIndex(
        index,
        declaration.kind,
        declaration.kind === 'broadcast' ? null : declaration.declarationTarget,
        operation.newName,
        declaration
      )
      assertActivation(operation.newNameActivation, activation)
      const propagated = propagateDeclarationName(
        project,
        declaration,
        operation.newName,
        index
      )
      propagatedReferenceCount = propagated.references
      propagatedMonitorCount = propagated.monitors
      exactPaths.push(...propagated.paths)
      const raw = rawDeclarationEntry(project, declaration)
      if (typeof raw === 'string')
      {
        const target = resolveTarget(project, declaration.declarationTarget)
        defineScratchRecordValue(
          target.broadcasts!,
          declaration.id,
          operation.newName
        )
      }
      else raw[0] = operation.newName
      exactPaths.push(
        declaration.kind === 'broadcast'
          ? declarationPath(declaration)
          : `${declarationPath(declaration)}/0`
      )
      declaration = { ...declaration, name: operation.newName }
    }
    else if (operation.kind === 'declaration.setVariableInitialValue')
    {
      if (declaration.kind !== 'variable')
        throw new DeclarationOperationErrorV1(
          'edit.unsupported_operation',
          'variable initial-value operation requires a variable declaration'
        )
      assertScalar(operation.newValue)
      const raw = rawDeclarationEntry(project, declaration)
      if (!Array.isArray(raw))
        throw new DeclarationOperationErrorV1(
          'edit.internal_invariant',
          'variable declaration tuple disappeared'
        )
      if (
        operation.expectedValueFingerprintSha256 !==
        declarationValueFingerprintV1(raw[1] as ScratchScalarV1)
      )
        throw new DeclarationOperationErrorV1(
          'edit.fingerprint_mismatch',
          'variable initial value changed'
        )
      if (Object.is(raw[1], operation.newValue))
        throw new DeclarationOperationErrorV1(
          'edit.semantic_noop',
          'variable initial-value operation is a semantic no-op'
        )
      raw[1] = operation.newValue
      exactPaths.push(`${declarationPath(declaration)}/1`)
    }
    else if (operation.kind === 'declaration.setListInitialItems')
    {
      if (declaration.kind !== 'list')
        throw new DeclarationOperationErrorV1(
          'edit.unsupported_operation',
          'list initial-items operation requires a list declaration'
        )
      assertItems(operation.newItems)
      const raw = rawDeclarationEntry(project, declaration)
      if (!Array.isArray(raw) || !Array.isArray(raw[1]))
        throw new DeclarationOperationErrorV1(
          'edit.internal_invariant',
          'list declaration tuple disappeared'
        )
      if (
        operation.expectedItemsSha256 !==
        declarationItemsFingerprintV1(raw[1] as ScratchScalarV1[])
      )
        throw new DeclarationOperationErrorV1(
          'edit.fingerprint_mismatch',
          'list initial items changed'
        )
      const nextHash = declarationItemsFingerprintV1(operation.newItems)
      if (nextHash === operation.expectedItemsSha256)
        throw new DeclarationOperationErrorV1(
          'edit.semantic_noop',
          'list initial-items operation is a semantic no-op'
        )
      raw[1] = [...operation.newItems]
      exactPaths.push(`${declarationPath(declaration)}/1`)
    }
    else
    {
      assertNoUnknownNameSemantics(project)
      assertExpectedReferenceEvidence(
        operation.expectedReferenceSetSha256,
        before
      )
      if (
        operation.expectedMonitorSetSha256 !== before.expectedMonitorSetSha256
      )
        throw new DeclarationOperationErrorV1(
          'edit.planning_facts_mismatch',
          'declaration monitor set changed'
        )
      if (before.hasDynamicReference)
        throw new DeclarationOperationErrorV1(
          'edit.dynamic_reference',
          'dynamic declaration reference prevents removal'
        )
      if (
        before.referenceCount !== operation.requireFinalReferenceCount ||
        before.monitorCount !== operation.requireFinalMonitorCount
      )
        throw new DeclarationOperationErrorV1(
          'edit.entity_still_referenced',
          'declaration removal requires zero references and monitors'
        )
      const raw = rawDeclarationEntry(project, declaration)
      if (
        declaration.kind === 'variable' &&
        Array.isArray(raw) &&
        raw[2] === true
      )
        throw new DeclarationOperationErrorV1(
          'edit.unsupported_operation',
          'cloud variable removal is unavailable in V1'
        )
      if (declaration.kind === 'broadcast')
        assertBroadcastProjectMutableWithIndex(project, index)
      const target = resolveTarget(project, declaration.declarationTarget)
      const record =
        declaration.kind === 'variable'
          ? target.variables
          : declaration.kind === 'list'
            ? target.lists!
            : target.broadcasts!
      if (!deleteScratchRecordValue(record, declaration.id))
        throw new DeclarationOperationErrorV1(
          'edit.internal_invariant',
          'selected declaration disappeared before removal'
        )
      exactPaths.push(declarationPath(declaration))
      declaration = null
    }
  }

  const postMutationIndex = buildSemanticReferenceIndex(project)
  if (!valueOnly) assertReferenceIntegrityWithIndex(postMutationIndex)
  const effectiveDeclaration = declaration ?? createdDeclaration
  const after = effectiveDeclaration
    ? declarationReferenceEvidenceFromIndex(
        project,
        postMutationIndex,
        effectiveDeclaration
      )
    : null
  if (
    operation.kind === 'declaration.rename' &&
    (after?.expectedReferenceSetSha256 !== before?.expectedReferenceSetSha256 ||
      after?.expectedMonitorSetSha256 !== before?.expectedMonitorSetSha256)
  )
    throw new DeclarationOperationErrorV1(
      'edit.postcondition_failed',
      'declaration rename changed the exact reference or monitor set'
    )
  return Object.freeze({
    opId: operation.opId,
    kind: operation.kind,
    declaration,
    createdDeclaration,
    exactPaths: Object.freeze([...new Set(exactPaths)].sort(compareText)),
    pathPrefixes: Object.freeze([]),
    propagatedReferenceCount,
    propagatedMonitorCount,
    referenceEvidenceBefore: before,
    referenceEvidenceAfter: after,
    allocatorState: project.uids.snapshot(),
  })
}

export function expectedDeclarationNameIdentityV1(
  declaration: DeclarationRef
): ExpectedStringIdentityV1
{
  return expectedStringIdentityV1(declaration.name)
}
