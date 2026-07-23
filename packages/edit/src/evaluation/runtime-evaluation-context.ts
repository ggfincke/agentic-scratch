// packages/edit/src/evaluation/runtime-evaluation-context.ts
// compile revision lineage into the neutral runner assignment without names

import type { ProjectIR } from '@scratch-agent/ir'
import {
  activeOrderedSemanticLineages,
  declarationEntityEvidenceSetV1,
  targetEntityEvidenceSetV1,
  validateSemanticLineageSnapshot,
  type ContractEntityBindingV1,
  type EditSemanticChangeContractV1,
  type SemanticLineageKind,
  type SemanticLineageRecord,
  type SemanticLineageSnapshot,
} from '@scratch-agent/ir/edit'
import type {
  EditDiagnosticLineageV1,
  EditRuntimeBindingTableV1,
  EditRuntimeBroadcastBindingV1,
  EditRuntimeDeclarationBindingV1,
  EditRuntimeDeclarationLineageV1,
  EditRuntimeLineageAssignmentV1,
  EditRuntimeMediaLineageV1,
  EditRuntimeTargetBindingV1,
} from '@scratch-agent/eval'

import {
  existingBindingOwnerLineageResolverV1,
  resolveFutureBindingLineageV1,
  type FutureBindingLedgerV1,
} from '../lineage/future-binding-ledger.js'

class EditRuntimeEvaluationContextErrorV1 extends Error
{
  constructor(message: string)
  {
    super(message)
    this.name = 'EditRuntimeEvaluationContextErrorV1'
  }
}

function fail(message: string): never
{
  throw new EditRuntimeEvaluationContextErrorV1(message)
}

function exactActiveChild(
  lineage: SemanticLineageSnapshot,
  ownerLineageId: string,
  kind: SemanticLineageKind,
  rawIdentity: string
): SemanticLineageRecord
{
  const matches = lineage.records.filter(
    (record) =>
      record.status === 'active' &&
      record.ownerLineageId === ownerLineageId &&
      record.kind === kind &&
      record.rawIdentity === rawIdentity
  )
  if (matches.length !== 1)
  {
    fail(
      `runtime lineage expected one active ${kind} ${rawIdentity} under ${ownerLineageId}, observed ${matches.length}`
    )
  }
  return matches[0]!
}

function declarationAssignments(
  project: ProjectIR,
  lineage: SemanticLineageSnapshot,
  targetLineages: readonly SemanticLineageRecord[]
): readonly EditRuntimeDeclarationLineageV1[]
{
  const assignments: EditRuntimeDeclarationLineageV1[] = []
  const append = (
    targetIndex: number,
    kind: EditRuntimeDeclarationLineageV1['kind'],
    values: Readonly<Record<string, unknown>> | undefined
  ): void =>
  {
    const owner = targetLineages[targetIndex]
    if (!owner) fail(`runtime lineage target ${targetIndex} is absent`)
    for (const rawDeclarationId of Object.keys(values ?? {}).sort())
    {
      const record = exactActiveChild(
        lineage,
        owner.lineageId,
        'declaration',
        `${kind}:${rawDeclarationId}`
      )
      assignments.push(
        Object.freeze({
          targetIndex,
          kind,
          rawDeclarationId,
          declarationLineage: record.lineageId,
        })
      )
    }
  }
  project.json.targets.forEach((target, targetIndex) =>
  {
    append(targetIndex, 'variable', target.variables)
    append(targetIndex, 'list', target.lists)
    append(targetIndex, 'broadcast', target.broadcasts)
  })
  return Object.freeze(assignments)
}

function mediaAssignments(
  project: ProjectIR,
  lineage: SemanticLineageSnapshot,
  targetLineages: readonly SemanticLineageRecord[]
): readonly EditRuntimeMediaLineageV1[]
{
  const assignments: EditRuntimeMediaLineageV1[] = []
  const append = (
    targetIndex: number,
    mediaKind: EditRuntimeMediaLineageV1['mediaKind'],
    expectedCount: number
  ): void =>
  {
    const owner = targetLineages[targetIndex]
    if (!owner) fail(`runtime lineage target ${targetIndex} is absent`)
    const lineageKind = mediaKind === 'costume' ? 'costume' : 'sound'
    const records = activeOrderedSemanticLineages(
      lineage,
      lineageKind,
      owner.lineageId
    )
    if (records.length !== expectedCount)
    {
      fail(
        `runtime lineage ${mediaKind} count ${records.length} differs from artifact count ${expectedCount} for target ${targetIndex}`
      )
    }
    records.forEach((record, mediaOrder) =>
    {
      assignments.push(
        Object.freeze({
          targetIndex,
          mediaKind,
          mediaOrder,
          mediaLineage: record.lineageId,
        })
      )
    })
  }
  project.json.targets.forEach((target, targetIndex) =>
  {
    append(targetIndex, 'costume', target.costumes.length)
    append(targetIndex, 'sound', target.sounds.length)
  })
  return Object.freeze(assignments)
}

export function buildEditDiagnosticLineageTablesV1(
  project: ProjectIR,
  rawLineage: SemanticLineageSnapshot
): Omit<EditDiagnosticLineageV1, 'revisionIdentity'>
{
  const lineage = validateSemanticLineageSnapshot(rawLineage)
  const targets = activeOrderedSemanticLineages(lineage, 'target', null)
  if (targets.length !== project.json.targets.length)
    fail('diagnostic lineage target count differs from the exact artifact')
  const targetByIndex = new Map<number, string>()
  const blockByOwnerAndId = new Map<string, string>()
  const scriptByOwnerAndTopId = new Map<string, string>()
  const declarationByOwnerKindAndId = new Map<string, string>()
  const assetByPath = new Map<string, string>()
  const monitorById = new Map<string, string>()
  const unresolvedTargetByName = new Map<string, string>()
  const targetIndexByLineage = new Map<string, number>()
  const targetNameCounts = new Map<string, number>()
  for (const target of project.json.targets)
    targetNameCounts.set(
      target.name,
      (targetNameCounts.get(target.name) ?? 0) + 1
    )
  targets.forEach((target, targetIndex) =>
  {
    targetByIndex.set(targetIndex, target.lineageId)
    targetIndexByLineage.set(target.lineageId, targetIndex)
    const name = project.json.targets[targetIndex]?.name
    if (typeof name === 'string' && targetNameCounts.get(name) === 1)
      unresolvedTargetByName.set(name, target.lineageId)
  })
  for (const record of lineage.records)
  {
    if (record.status !== 'active') continue
    const targetIndex =
      record.ownerLineageId === null
        ? undefined
        : targetIndexByLineage.get(record.ownerLineageId)
    if (record.kind === 'block' && targetIndex !== undefined)
      blockByOwnerAndId.set(
        `${targetIndex}\u0000${record.rawIdentity.replace(/^block:/u, '')}`,
        record.lineageId
      )
    else if (record.kind === 'script' && targetIndex !== undefined)
      scriptByOwnerAndTopId.set(
        `${targetIndex}\u0000${record.rawIdentity.replace(/^script:/u, '')}`,
        record.lineageId
      )
    else if (record.kind === 'declaration' && targetIndex !== undefined)
    {
      const match = /^(variable|list|broadcast):(.*)$/u.exec(record.rawIdentity)
      if (match)
        declarationByOwnerKindAndId.set(
          `${targetIndex}\u0000${match[1]}\u0000${match[2]}`,
          record.lineageId
        )
    }
    else if (record.kind === 'asset')
      assetByPath.set(
        record.rawIdentity.replace(/^asset:/u, ''),
        record.lineageId
      )
    else if (record.kind === 'monitor')
    {
      const match = /^monitor:([^:]+):/u.exec(record.rawIdentity)
      if (match)
      {
        if (monitorById.has(match[1]!))
          fail(`diagnostic monitor ${match[1]} has ambiguous active lineage`)
        monitorById.set(match[1]!, record.lineageId)
      }
    }
  }
  return Object.freeze({
    targetByIndex,
    blockByOwnerAndId,
    scriptByOwnerAndTopId,
    declarationByOwnerKindAndId,
    assetByPath,
    monitorById,
    unresolvedTargetByName,
  })
}

// * canonical target ordinals are serialized-pane order, not layerOrder. The
// * runner derives executable order independently from the exact artifact.
export function buildEditRuntimeLineageAssignmentV1(
  project: ProjectIR,
  rawLineage: SemanticLineageSnapshot
): EditRuntimeLineageAssignmentV1
{
  const lineage = validateSemanticLineageSnapshot(rawLineage)
  const targets = activeOrderedSemanticLineages(lineage, 'target', null)
  if (targets.length !== project.json.targets.length)
  {
    fail(
      `runtime lineage target count ${targets.length} differs from artifact count ${project.json.targets.length}`
    )
  }
  targets.forEach((record, targetIndex) =>
  {
    if (record.canonicalOrdinal !== targetIndex)
    {
      fail(
        `runtime lineage target ${record.lineageId} has canonical ordinal ${String(record.canonicalOrdinal)}, expected ${targetIndex}`
      )
    }
  })
  return Object.freeze({
    targetLineagesBySerializedIndex: Object.freeze(
      targets.map((record) => record.lineageId)
    ),
    declarations: declarationAssignments(project, lineage, targets),
    media: mediaAssignments(project, lineage, targets),
  })
}

type RuntimeBinding = Extract<
  ContractEntityBindingV1,
  | { entityKind: 'target'; entitySubtype: 'stage' | 'sprite' }
  | {
      entityKind: 'declaration'
      entitySubtype: 'variable' | 'list' | 'broadcast'
    }
>

function exactRuntimeBinding(
  bindingsByKey: ReadonlyMap<string, readonly RuntimeBinding[]>,
  bindingKey: string
): RuntimeBinding
{
  const matches = bindingsByKey.get(bindingKey) ?? []
  if (matches.length !== 1)
  {
    fail(
      `runtime contract binding ${bindingKey} resolved ${matches.length} target/declaration rows`
    )
  }
  return matches[0]!
}

function existingTargetLineage(
  source: ProjectIR,
  sourceLineage: SemanticLineageSnapshot,
  binding: Extract<RuntimeBinding, { entityKind: 'target' }>
): string
{
  if (binding.bindingKind !== 'existing')
    fail(`runtime target binding ${binding.bindingKey} is not existing`)
  const matches = targetEntityEvidenceSetV1(source.json).filter(
    (evidence) =>
      evidence.targetKind === binding.entitySubtype &&
      evidence.semanticLocationSha256 === binding.sourceLocationSha256 &&
      evidence.semanticFingerprintSha256 ===
        binding.expectedSourceSemanticFingerprint &&
      evidence.contextFingerprintSha256 ===
        binding.expectedSourceContextFingerprint
  )
  if (matches.length !== 1)
  {
    fail(
      `runtime target binding ${binding.bindingKey} resolved ${matches.length} source entities`
    )
  }
  const records = sourceLineage.records.filter(
    (record) =>
      record.status === 'active' &&
      record.kind === 'target' &&
      record.ownerLineageId === null &&
      record.rawIdentity === `target:${matches[0]!.targetIndex}`
  )
  if (records.length !== 1)
  {
    fail(
      `runtime target binding ${binding.bindingKey} resolved ${records.length} source lineages`
    )
  }
  return records[0]!.lineageId
}

function existingDeclarationLineage(
  source: ProjectIR,
  sourceLineage: SemanticLineageSnapshot,
  binding: Extract<RuntimeBinding, { entityKind: 'declaration' }>
): string
{
  if (binding.bindingKind !== 'existing')
    fail(`runtime declaration binding ${binding.bindingKey} is not existing`)
  const matches = declarationEntityEvidenceSetV1(source).filter(
    (evidence) =>
      evidence.declarationKind === binding.entitySubtype &&
      evidence.semanticLocationSha256 === binding.sourceLocationSha256 &&
      evidence.semanticFingerprintSha256 ===
        binding.expectedSourceSemanticFingerprint &&
      evidence.contextFingerprintSha256 ===
        binding.expectedSourceContextFingerprint
  )
  if (matches.length !== 1)
  {
    fail(
      `runtime declaration binding ${binding.bindingKey} resolved ${matches.length} source entities`
    )
  }
  const owner = activeOrderedSemanticLineages(sourceLineage, 'target', null)[
    matches[0]!.targetIndex
  ]
  if (!owner)
  {
    fail(
      `runtime declaration binding ${binding.bindingKey} has no source target lineage`
    )
  }
  return exactActiveChild(
    sourceLineage,
    owner.lineageId,
    'declaration',
    `${binding.entitySubtype}:${matches[0]!.declarationId}`
  ).lineageId
}

function resolvedBindingLineage(input: {
  readonly source: ProjectIR
  readonly sourceLineage: SemanticLineageSnapshot
  readonly artifactLineage: SemanticLineageSnapshot
  readonly lineageHistory: SemanticLineageSnapshot
  readonly contract: EditSemanticChangeContractV1
  readonly ledger: FutureBindingLedgerV1
  readonly binding: RuntimeBinding
  readonly side: 'baseline' | 'candidate'
}): string | null
{
  const { binding } = input
  if (binding.bindingKind === 'future')
  {
    if (input.side === 'baseline') return null
    return resolveFutureBindingLineageV1(
      input.ledger,
      binding.bindingKey,
      input.contract,
      input.lineageHistory,
      existingBindingOwnerLineageResolverV1(
        input.source,
        input.contract,
        input.sourceLineage
      )
    )
  }
  return binding.entityKind === 'target'
    ? existingTargetLineage(input.source, input.sourceLineage, binding)
    : existingDeclarationLineage(input.source, input.sourceLineage, binding)
}

// contract actions carry binding keys, while runner actions carry only stable
// lineage. This table is the one exact bridge & never includes display names.
export function buildEditRuntimeBindingTableV1(input: {
  readonly source: ProjectIR
  readonly sourceLineage: SemanticLineageSnapshot
  readonly artifactLineage: SemanticLineageSnapshot
  readonly lineageHistory: SemanticLineageSnapshot
  readonly contract: EditSemanticChangeContractV1
  readonly ledger: FutureBindingLedgerV1
  readonly side: 'baseline' | 'candidate'
}): EditRuntimeBindingTableV1
{
  const sourceLineage = validateSemanticLineageSnapshot(input.sourceLineage)
  const artifactLineage = validateSemanticLineageSnapshot(input.artifactLineage)
  const lineageHistory = validateSemanticLineageSnapshot(input.lineageHistory)
  const targets: EditRuntimeTargetBindingV1[] = []
  const declarations: EditRuntimeDeclarationBindingV1[] = []
  const broadcasts: EditRuntimeBroadcastBindingV1[] = []
  const runtimeBindingsByKey = new Map<string, RuntimeBinding[]>()
  for (const binding of input.contract.entityBindings)
  {
    if (binding.entityKind !== 'target' && binding.entityKind !== 'declaration')
      continue
    const rows = runtimeBindingsByKey.get(binding.bindingKey)
    if (rows) rows.push(binding)
    else runtimeBindingsByKey.set(binding.bindingKey, [binding])
  }
  const artifactLineageById = new Map<string, SemanticLineageRecord[]>()
  for (const record of artifactLineage.records)
  {
    const rows = artifactLineageById.get(record.lineageId)
    if (rows) rows.push(record)
    else artifactLineageById.set(record.lineageId, [record])
  }
  for (const candidate of input.contract.entityBindings)
  {
    if (!(
      candidate.entityKind === 'target' ||
      candidate.entityKind === 'declaration'
    ))
      continue
    const binding = exactRuntimeBinding(
      runtimeBindingsByKey,
      candidate.bindingKey
    )
    const lineageId = resolvedBindingLineage({
      ...input,
      sourceLineage,
      artifactLineage,
      lineageHistory,
      binding,
    })
    if (lineageId === null) continue
    const records = (artifactLineageById.get(lineageId) ?? []).filter(
      (record) =>
        binding.entityKind === 'target'
          ? record.kind === 'target'
          : record.kind === 'declaration'
    )
    if (records.length !== 1)
    {
      fail(
        `runtime binding ${binding.bindingKey} resolved ${records.length} artifact lineage rows`
      )
    }
    if (records[0]!.status !== 'active') continue
    if (binding.entityKind === 'target')
      targets.push({ bindingKey: binding.bindingKey, targetLineage: lineageId })
    else
    {
      if (!records[0]!.rawIdentity.startsWith(`${binding.entitySubtype}:`))
      {
        fail(
          `runtime declaration binding ${binding.bindingKey} has the wrong artifact subtype`
        )
      }
      if (binding.entitySubtype === 'broadcast')
      {
        broadcasts.push({
          bindingKey: binding.bindingKey,
          declarationLineage: lineageId,
        })
        continue
      }
      const ownerLineageId = records[0]!.ownerLineageId
      const owners = (
        ownerLineageId === null
          ? []
          : (artifactLineageById.get(ownerLineageId) ?? [])
      ).filter(
        (record) => record.status === 'active' && record.kind === 'target'
      )
      if (owners.length !== 1)
      {
        fail(
          `runtime declaration binding ${binding.bindingKey} resolved ${owners.length} active target owners`
        )
      }
      declarations.push({
        bindingKey: binding.bindingKey,
        declarationLineage: lineageId,
        targetLineage: owners[0]!.lineageId,
        collection:
          binding.entitySubtype === 'variable' ? 'variables' : 'lists',
      })
    }
  }
  return Object.freeze({
    targets: Object.freeze(targets.map((entry) => Object.freeze(entry))),
    declarations: Object.freeze(
      declarations.map((entry) => Object.freeze(entry))
    ),
    broadcasts: Object.freeze(broadcasts.map((entry) => Object.freeze(entry))),
  })
}
