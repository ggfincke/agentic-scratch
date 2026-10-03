// packages/ir/src/authoring/workspace-compiler.ts
// compile one immutable logical source closure through production IR builders

import { createHash } from 'node:crypto'
import {
  DEFAULT_EDIT_ADMISSION_LIMITS,
  DEFAULT_SB3_LIMITS,
  ASSET_PIPELINE_LIMITS_V2,
  admitSb3ForEdit,
  deriveAuthoringMediaIdentity,
  defineScratchRecordValue,
  normalizeAssetsByPath,
  type Block,
  type BlockEntry,
  type DerivedMediaAssetIdentity,
} from '@scratch-agent/sb3'
import { ProjectIR } from '../project/project-ir.js'
import { computeProjectDelta } from '../project/project-delta.js'
import {
  editEvidenceCanonicalSha256V1 as hashJson,
  targetEntityEvidenceSetV1,
} from '../edit/operations/target-operations.js'
import { declarationEntityEvidenceSetV1 } from '../edit/operations/entity-resolution.js'
import { parseKnownProcedureMutations } from '../edit/semantic-index/procedure-mutation.js'
import { RESERVED_TARGET_NAMES_V1 } from '../edit/semantic-index/target-reference-catalog.js'
import {
  applyProcedureOperationV1,
  assertStandardProcedureGraphOwnershipV2,
  canonicalProcedureSignatureV1,
  standardProcedureSignatureSha256V2,
} from '../edit/operations/procedure-operations.js'
import {
  commitGraphAllocatorV1,
  type GraphInstalledClosureV1,
} from '../edit/graph/graph-primitives.js'
import {
  StandardBlockLowererV2,
  getStandardAuthoritySha256V2,
  standardExtensionIdsV2,
  type StandardProcedureScopeV2,
} from '../edit/standard-authoring/index.js'
import type {
  CuratedEntityResolutionRequestV1,
  CuratedResolvedEntityV1,
} from '../edit/core-blocks/core-block-builder.js'
import type {
  DeclarationRefV1,
  MediaRefV1,
  TargetRefV1,
  SemanticBlockTreeV1,
  SemanticFieldValueV1,
  SemanticInputValueV1,
  SemanticStatementBlockTreeV1,
  SemanticStatementSequenceV1,
  SemanticExpressionBlockTreeV1,
  TopLevelScriptRootV1,
} from '../edit/contracts.generated.js'
import {
  applyCostumePivotEditV2,
  costumePivotIdentityV2,
  resolveAnimationClipsV2,
  type ResolvedAnimationClipV2,
} from './animation-clips.js'
import {
  expandScratchWorkspaceManifestV2,
  parseScratchWorkspaceManifestV2,
  parseWorkspaceProcedureFileV2,
  parseWorkspaceScriptFileV2,
  workspaceRelativePathV2,
  workspaceSourceFailureV2 as fail,
  WorkspaceSourceErrorV2,
} from './workspace-validation.js'
import type {
  WorkspaceBlockV2,
  WorkspaceBuildLimitsV2,
  WorkspaceBuildPlanV2,
  WorkspaceCompilationInputV2,
  WorkspaceCompilationResultV2,
  WorkspaceInputValueV2,
  WorkspaceLogicalReferenceV2,
  WorkspacePreparedAssetV2,
  WorkspaceProcedureFileV2,
  WorkspaceSequenceV2,
  WorkspaceScriptRootV2,
} from './workspace-types.js'

export const WORKSPACE_BUILD_LIMITS_V2: Readonly<WorkspaceBuildLimitsV2> =
  Object.freeze({
    maximumTargets: DEFAULT_EDIT_ADMISSION_LIMITS.maxTargets,
    maximumBlocks: DEFAULT_EDIT_ADMISSION_LIMITS.maxBlockRecords,
    maximumScripts: DEFAULT_EDIT_ADMISSION_LIMITS.maxScriptRoots,
    maximumDeclarations: DEFAULT_EDIT_ADMISSION_LIMITS.maxDeclarationRecords,
    maximumCostumes: DEFAULT_EDIT_ADMISSION_LIMITS.maxCostumeRecords,
    maximumCostumesPerTarget:
      DEFAULT_EDIT_ADMISSION_LIMITS.maxCostumesPerTarget,
    maximumAssetBytes: DEFAULT_SB3_LIMITS.maxTotalAssetBytes,
    maximumSb3Bytes: DEFAULT_SB3_LIMITS.maxCompressedBytes,
    maximumProjectJsonBytes: DEFAULT_SB3_LIMITS.maxProjectJsonBytes,
    maximumDecodedCostumeBytes:
      DEFAULT_EDIT_ADMISSION_LIMITS.maxPngDecodedRgbaBytes,
    maximumSourceBytes: 160 * 1024 * 1024,
  })

interface EntityBinding
{
  readonly logicalId: string
  readonly entityKind: 'target' | 'declaration' | 'media'
  readonly subtype: string
  readonly targetIndex: number
  readonly serializedId: string
  readonly name: string
}

interface ProcedureBinding
{
  readonly logicalId: string
  readonly targetIndex: number
  readonly definitionId: string
  readonly source: WorkspaceProcedureFileV2
  readonly scope: StandardProcedureScopeV2
}

function sha256(bytes: Uint8Array): string
{
  return createHash('sha256').update(bytes).digest('hex')
}

function deepFreeze<T>(value: T): T
{
  if (value !== null && typeof value === 'object')
  {
    for (const child of Object.values(value)) deepFreeze(child)
    Object.freeze(value)
  }
  return value
}

function limitsFor(
  input: WorkspaceCompilationInputV2['limits']
): WorkspaceBuildLimitsV2
{
  const limits = { ...WORKSPACE_BUILD_LIMITS_V2 }
  for (const [key, value] of Object.entries(input ?? {}))
  {
    if (!Object.hasOwn(limits, key))
      fail('limits', `unknown build limit ${key}`)
    const name = key as keyof WorkspaceBuildLimitsV2
    if (!Number.isSafeInteger(value) || value < 0 || value > limits[name])
      fail('limits', `${key} can only lower its ceiling ${limits[name]}`)
    limits[name] = value
  }
  return limits
}

function charge(label: string, observed: number, ceiling: number): void
{
  if (!Number.isSafeInteger(observed) || observed < 0 || observed > ceiling)
    throw new WorkspaceSourceErrorV2(
      'WORKSPACE_BUILD_BUDGET_EXCEEDED',
      `${label}: ${observed} exceeds ${ceiling}`
    )
}

function chargeByteTotal(
  label: string,
  inputs: readonly { readonly bytes: Uint8Array }[],
  ceiling: number
): void
{
  let total = 0
  for (const input of inputs)
  {
    const bytes = input.bytes
    if (!(bytes instanceof Uint8Array))
      fail(label, 'payload must be a Uint8Array')
    charge(label, bytes.byteLength, ceiling - total)
    total += bytes.byteLength
  }
}

function entityReference(
  ref: WorkspaceLogicalReferenceV2
): TargetRefV1 | DeclarationRefV1 | MediaRefV1
{
  if (ref.entityKind === 'target')
    return {
      entityKind: 'target',
      refKind: 'created',
      opId: ref.id,
      slot: { slotKind: 'fixed', name: 'target' },
    }
  if (ref.entityKind === 'declaration')
    return {
      entityKind: 'declaration',
      refKind: 'created',
      opId: ref.id,
      slot: { slotKind: 'fixed', name: 'declaration' },
    }
  return {
    entityKind: 'media',
    refKind: 'created',
    opId: ref.id,
    slot: { slotKind: 'fixed', name: 'media' },
  }
}

function translateInput(
  value: WorkspaceInputValueV2,
  procedures: ReadonlyMap<string, ProcedureBinding>,
  owner?: ProcedureBinding
): SemanticInputValueV1
{
  if (value.valueKind === 'entity')
    return { ...value, value: entityReference(value.value) }
  if (value.valueKind === 'block')
    return {
      ...value,
      value: translateBlock(
        value.value,
        procedures,
        owner
      ) as SemanticExpressionBlockTreeV1,
    }
  if (value.valueKind === 'statementSequence')
    return {
      ...value,
      value: translateSequence(value.value, procedures, owner),
    }
  return value
}

function translateSequence(
  sequence: WorkspaceSequenceV2,
  procedures: ReadonlyMap<string, ProcedureBinding>,
  owner?: ProcedureBinding
): SemanticStatementSequenceV1
{
  return {
    blocks: sequence.blocks.map(
      (block) =>
        translateBlock(block, procedures, owner) as SemanticStatementBlockTreeV1
    ),
  }
}

function translateBlock(
  block: WorkspaceBlockV2,
  procedures: ReadonlyMap<string, ProcedureBinding>,
  owner?: ProcedureBinding
): SemanticBlockTreeV1
{
  const alias =
    block.localAlias === undefined ? {} : { localAlias: block.localAlias }
  if (block.nodeKind === 'parameterReporter')
  {
    if (
      !owner?.scope.parameters.some(
        (parameter) => parameter.localKey === block.parameterId
      )
    )
      fail(
        'parameterReporter',
        'parameter ID does not belong to the owning definition'
      )
    return {
      nodeKind: 'parameterReporter',
      ...alias,
      parameter: {
        refKind: 'procedureLocalParameter',
        localKey: block.parameterId,
      },
    }
  }
  if (block.nodeKind === 'procedureCall')
  {
    const called =
      procedures.get(block.procedureId) ??
      fail('procedureCall', `unknown procedure ID ${block.procedureId}`)
    return {
      nodeKind: 'procedureCall',
      ...alias,
      procedure:
        owner === called
          ? { refKind: 'selfProcedure' }
          : {
              refKind: 'created',
              entityKind: 'procedure',
              opId: called.logicalId,
              slot: { slotKind: 'fixed', name: 'procedure' },
            },
      expectedSignatureSha256: called.scope.signatureSha256,
      arguments: block.arguments.map((argument) => ({
        parameter: {
          refKind: 'created',
          entityKind: 'parameter',
          opId: called.logicalId,
          slot: { slotKind: 'parameter', localKey: argument.parameterId },
        },
        value: translateInput(argument.value, procedures, owner),
      })),
    }
  }
  return {
    nodeKind: 'ordinary',
    opcode: block.opcode,
    ...alias,
    fields: block.fields.map((field) => ({
      name: field.name,
      value:
        field.value.valueKind === 'entity'
          ? { ...field.value, value: entityReference(field.value.value) }
          : (field.value as SemanticFieldValueV1),
    })),
    inputs: block.inputs.map((input) => ({
      name: input.name,
      value: translateInput(input.value, procedures, owner),
    })),
  }
}

function translateRoot(
  root: WorkspaceScriptRootV2,
  procedures: ReadonlyMap<string, ProcedureBinding>
): TopLevelScriptRootV1
{
  if (root.rootKind === 'statementSequence')
    return { ...root, value: translateSequence(root.value, procedures) }
  if (root.rootKind === 'expression')
    return {
      ...root,
      value: translateBlock(
        root.value,
        procedures
      ) as SemanticExpressionBlockTreeV1,
    }
  return {
    rootKind: 'eventScript',
    hat: translateBlock(root.hat, procedures) as Extract<
      SemanticBlockTreeV1,
      { nodeKind: 'ordinary' }
    >,
    ...(root.body === undefined
      ? {}
      : { body: translateSequence(root.body, procedures) }),
  }
}

function install(
  project: ProjectIR,
  targetIndex: number,
  graph: GraphInstalledClosureV1
): void
{
  commitGraphAllocatorV1(project.uids, graph)
  const target = project.json.targets[targetIndex]!
  for (const [id, block] of Object.entries(graph.blocks))
  {
    if (Object.hasOwn(target.blocks, id))
      fail('graph', `builder ID collision ${id}`)
    defineScratchRecordValue<BlockEntry>(target.blocks, id, block)
  }
}

function resolver(
  bindings: readonly EntityBinding[],
  stageIndex: number,
  project: ProjectIR
): (request: CuratedEntityResolutionRequestV1) => CuratedResolvedEntityV1
{
  return (request) =>
  {
    if (request.reference.refKind !== 'created')
      fail(
        request.semanticPath,
        'compiler accepts only its own resolved logical references'
      )
    const reference = request.reference
    const matches = bindings.filter(
      (binding) =>
        binding.logicalId === reference.opId &&
        binding.entityKind === request.expectedEntityKind &&
        (binding.entityKind !== 'media' ||
          binding.targetIndex === request.ownerTargetIndex)
    )
    if (matches.length !== 1)
      fail(
        request.semanticPath,
        'logical reference is absent or ambiguous at this owner'
      )
    const binding = matches[0]!
    if (binding.subtype !== request.expectedEntitySubtype)
      fail(
        request.semanticPath,
        'logical reference kind differs from block policy'
      )
    if (
      binding.entityKind === 'declaration' &&
      binding.targetIndex !== stageIndex &&
      binding.targetIndex !== request.ownerTargetIndex
    )
      fail(request.semanticPath, 'declaration belongs to another sprite')
    const target = project.json.targets[binding.targetIndex]!
    const record =
      binding.entityKind === 'declaration'
        ? binding.subtype === 'variable'
          ? target.variables[binding.serializedId]
          : binding.subtype === 'list'
            ? target.lists?.[binding.serializedId]
            : target.broadcasts?.[binding.serializedId]
        : binding.entityKind === 'media'
          ? [...target.costumes, ...target.sounds].find(
              (media) => media.name === binding.name
            )
          : { name: target.name, isStage: target.isStage }
    return {
      entityKind: binding.entityKind,
      entitySubtype: binding.subtype,
      displayName: binding.name,
      serializedId: binding.serializedId,
      ownerTargetIndex: binding.targetIndex,
      semanticLineageSha256: hashJson({
        kind: 'workspace-logical-binding-v2',
        ...binding,
      }),
      semanticFingerprintSha256: hashJson({
        kind: 'workspace-resolved-entity-v2',
        binding,
        record,
      }),
    }
  }
}

async function checkPrepared(
  asset: WorkspacePreparedAssetV2
): Promise<DerivedMediaAssetIdentity>
{
  for (const key of [
    'sourceSha256',
    'transformSha256',
    'outputSha256',
  ] as const)
    if (!/^[a-f\d]{64}$/.test(asset[key]))
      fail(asset.logicalAssetId, `invalid ${key}`)
  if (sha256(asset.bytes) !== asset.outputSha256)
    fail(asset.logicalAssetId, 'prepared payload digest differs')
  const actual = await deriveAuthoringMediaIdentity(
    asset.bytes,
    asset.kind,
    DEFAULT_EDIT_ADMISSION_LIMITS
  )
  if (asset.kind === 'costume')
  {
    if (
      actual.mediaKind !== 'costume' ||
      actual.width !== asset.metadata.width ||
      actual.height !== asset.metadata.height ||
      actual.md5ext !== asset.metadata.md5ext ||
      asset.metadata.bitmapResolution !== 1 ||
      asset.metadata.dataFormat !== 'png'
    )
      fail(
        asset.logicalAssetId,
        'prepared costume metadata differs from actual PNG'
      )
    for (const value of [asset.metadata.pivot.x, asset.metadata.pivot.y])
      if (!Number.isFinite(value) || Math.abs(value) > 1_000_000)
        fail(asset.logicalAssetId, 'prepared pivot is outside finite bounds')
  }
  else if (hashJson(actual) !== hashJson(asset.metadata.identity))
    fail(
      asset.logicalAssetId,
      'prepared sound identity differs from actual WAV'
    )
  return actual
}

export async function compileScratchWorkspaceV2(
  input: WorkspaceCompilationInputV2
): Promise<WorkspaceCompilationResultV2>
{
  const limits = limitsFor(input.limits)
  charge('prepared asset count', input.preparedAssets.length, 4096)
  charge('source file count', input.files.length, 4096)
  if (!(input.baselineBytes instanceof Uint8Array))
    fail('baseline', 'payload must be a Uint8Array')
  charge(
    'baseline compressed bytes',
    input.baselineBytes.byteLength,
    limits.maximumSb3Bytes
  )
  chargeByteTotal('source bytes', input.files, limits.maximumSourceBytes)
  chargeByteTotal(
    'prepared asset bytes',
    input.preparedAssets,
    limits.maximumAssetBytes
  )
  const originalManifest = parseScratchWorkspaceManifestV2(input.manifest)
  const baselineBytes = Uint8Array.from(input.baselineBytes)
  const files = input.files.map((file) => ({
    ...file,
    bytes: Uint8Array.from(file.bytes),
  }))
  const prepared = input.preparedAssets.map((asset) => ({
    ...asset,
    bytes: Uint8Array.from(asset.bytes),
    metadata: structuredClone(asset.metadata),
  })) as WorkspacePreparedAssetV2[]
  chargeByteTotal('source bytes', files, limits.maximumSourceBytes)
  chargeByteTotal('prepared asset bytes', prepared, limits.maximumAssetBytes)
  const sourceByPath = new Map(
    files.map((file) => [workspaceRelativePathV2(file.path), file])
  )
  if (sourceByPath.size !== files.length)
    fail('sources', 'duplicate source path')
  const manifest = expandScratchWorkspaceManifestV2(originalManifest, files)
  const source = (path: string) =>
    sourceByPath.get(path) ??
    fail(path, 'declared source is absent from the immutable closure')
  const sourceJSON = (path: string): Uint8Array =>
  {
    const file = source(path)
    charge(
      'source JSON bytes',
      file.bytes.byteLength,
      limits.maximumProjectJsonBytes
    )
    return file.bytes
  }
  const baselineHash = sha256(baselineBytes)
  if (manifest.baseline.kind === 'selectedProject')
  {
    if (
      baselineHash !== manifest.baseline.expectedArtifactSha256 ||
      sha256(source(manifest.baseline.path).bytes) !== baselineHash
    )
      fail(
        'baseline',
        'selected artifact identity differs from the immutable source'
      )
  }
  const editLimits = {
    ...DEFAULT_EDIT_ADMISSION_LIMITS,
    maxTargets: limits.maximumTargets,
    maxBlockRecords: limits.maximumBlocks,
    maxScriptRoots: limits.maximumScripts,
    maxDeclarationRecords: limits.maximumDeclarations,
    maxCostumeRecords: limits.maximumCostumes,
    maxCostumesPerTarget: limits.maximumCostumesPerTarget,
    maxPngDecodedRgbaBytes: limits.maximumDecodedCostumeBytes,
    maxPngReferencePixels: Math.floor(limits.maximumDecodedCostumeBytes / 4),
  }
  const archiveLimits = {
    ...DEFAULT_SB3_LIMITS,
    maxCompressedBytes: limits.maximumSb3Bytes,
    maxTotalAssetBytes: limits.maximumAssetBytes,
    maxProjectJsonBytes: limits.maximumProjectJsonBytes,
  }
  const admitted = await admitSb3ForEdit(baselineBytes, {
    editLimits,
    limits: archiveLimits,
  })
  const baseline = ProjectIR.fromProjectJson(admitted.project, admitted.assets)
  const candidate = ProjectIR.fromProjectJson(
    structuredClone(admitted.project),
    admitted.assets.map((asset) => ({
      path: asset.path,
      bytes: Uint8Array.from(asset.bytes),
    }))
  )
  const counts = { ...admitted.projectCounts }
  let decodedCostumeBytes = admitted.media.metrics.pngDecodedRgbaBytes
  let assetBytes = candidate.assets.reduce(
    (sum, asset) => sum + asset.bytes.byteLength,
    0
  )
  const reserveGraph = (graph: GraphInstalledClosureV1): void =>
  {
    counts.blockRecords += graph.blockIds.length
    counts.scriptRoots += Object.values(graph.blocks).filter(
      (block) => block.topLevel
    ).length
    charge('block records', counts.blockRecords, limits.maximumBlocks)
    charge('script roots', counts.scriptRoots, limits.maximumScripts)
  }
  const reserveAsset = (path: string, bytes: Uint8Array): void =>
  {
    if (!candidate.assets.some((asset) => asset.path === path))
    {
      assetBytes += bytes.byteLength
      charge('candidate asset bytes', assetBytes, limits.maximumAssetBytes)
      charge(
        'archive entries',
        candidate.assets.length + 2,
        DEFAULT_SB3_LIMITS.maxEntries
      )
    }
  }
  const targetEvidence = targetEntityEvidenceSetV1(baseline.json)
  const declarationEvidence = declarationEntityEvidenceSetV1(baseline)
  const stageIndex = candidate.json.targets.findIndex(
    (target) => target.isStage
  )
  if (stageIndex < 0) fail('baseline', 'baseline stage is absent')
  const targetIndexes = new Map<string, number>()
  const bindings: EntityBinding[] = []
  const operations: WorkspaceBuildPlanV2['operationOrder'][number][] = []
  const recordOperation = (
    kind: string,
    logicalId: string,
    targetIndex: number
  ) => operations.push({ kind, logicalId, targetIndex })
  const boundIndexes = new Set<number>()
  for (const targetSource of manifest.targets)
  {
    const matches = candidate.json.targets.flatMap((target, index) =>
      target.name === targetSource.name &&
      target.isStage === (targetSource.kind === 'stage')
        ? [index]
        : []
    )
    let targetIndex: number
    if (targetSource.kind === 'stage' || targetSource.existing)
    {
      if (matches.length !== 1)
        fail(
          targetSource.id,
          'existing target selection is absent or ambiguous'
        )
      targetIndex = matches[0]!
      if (
        targetSource.existing &&
        targetEvidence[targetIndex]?.semanticFingerprintSha256 !==
          targetSource.existing.expectedSemanticFingerprintSha256
      )
        fail(targetSource.id, 'existing target fingerprint differs')
      if (
        manifest.baseline.kind === 'selectedProject' &&
        !targetSource.existing
      )
        fail(
          targetSource.id,
          'selected baseline targets require explicit identity binding'
        )
    }
    else
    {
      if (RESERVED_TARGET_NAMES_V1.includes(targetSource.name))
        fail(
          targetSource.id,
          'sprite name collides with a reserved runtime target name'
        )
      if (
        matches.length > 0 ||
        candidate.json.targets.some(
          (target) => target.name === targetSource.name
        )
      )
        fail(targetSource.id, 'new sprite name collides with a baseline target')
      charge(
        'targets',
        candidate.json.targets.length + 1,
        limits.maximumTargets
      )
      candidate.addSprite(targetSource.name)
      targetIndex = candidate.json.targets.length - 1
      recordOperation('target.add', targetSource.id, targetIndex)
    }
    if (boundIndexes.has(targetIndex))
      fail(
        targetSource.id,
        'multiple logical targets select one serialized target'
      )
    boundIndexes.add(targetIndex)
    targetIndexes.set(targetSource.id, targetIndex)
    bindings.push({
      logicalId: targetSource.id,
      entityKind: 'target',
      subtype: targetSource.kind,
      targetIndex,
      serializedId: `target:${targetIndex}`,
      name: targetSource.name,
    })
    const target = candidate.json.targets[targetIndex]!
    if (targetSource.logicMode === 'replace')
    {
      counts.blockRecords -= Object.keys(target.blocks).length
      counts.scriptRoots -= Object.values(target.blocks).filter(
        (block) => !Array.isArray(block) && block.topLevel
      ).length
      target.blocks = {}
      target.comments = {}
      recordOperation('target.replaceLogic', targetSource.id, targetIndex)
    }
    if (targetSource.properties)
    {
      for (const [key, value] of Object.entries(targetSource.properties))
        Object.defineProperty(target, key, {
          value,
          enumerable: true,
          writable: true,
          configurable: true,
        })
      recordOperation('target.setProperties', targetSource.id, targetIndex)
    }
    for (const declaration of targetSource.declarations ?? [])
    {
      if (declaration.kind === 'broadcast' && targetIndex !== stageIndex)
        fail(declaration.id, 'broadcast declarations belong to the stage')
      const records =
        declaration.kind === 'variable'
          ? target.variables
          : declaration.kind === 'list'
            ? (target.lists ??= {})
            : (target.broadcasts ??= {})
      const matches = Object.entries(records).filter(
        ([, entry]) =>
          (declaration.kind === 'broadcast'
            ? entry
            : (entry as unknown[])[0]) === declaration.name
      )
      let id: string
      if (declaration.existing)
      {
        if (matches.length !== 1)
          fail(declaration.id, 'existing declaration is absent or ambiguous')
        id = matches[0]![0]
        const evidence = declarationEvidence.find(
          (entry) =>
            entry.targetIndex === targetIndex &&
            entry.declarationKind === declaration.kind &&
            entry.declarationId === id
        )
        if (
          evidence?.semanticFingerprintSha256 !==
            declaration.existing.expectedSemanticFingerprintSha256 ||
          evidence.cloud === true
        )
          fail(
            declaration.id,
            'existing declaration fingerprint differs or is cloud-backed'
          )
        if (
          declaration.kind === 'variable' &&
          declaration.initialValue !== undefined
        )
          target.variables[id]![1] = declaration.initialValue
        if (
          declaration.kind === 'list' &&
          declaration.initialItems !== undefined
        )
        {
          counts.runtimeScalarSlots +=
            declaration.initialItems.length - target.lists![id]![1].length
          charge(
            'runtime scalar slots',
            counts.runtimeScalarSlots,
            DEFAULT_EDIT_ADMISSION_LIMITS.maxRuntimeScalarSlots
          )
          target.lists![id]![1] = [...declaration.initialItems]
        }
      }
      else
      {
        if (matches.length > 0)
          fail(
            declaration.id,
            'new declaration name collides with an existing declaration'
          )
        counts.declarations += 1
        counts.runtimeScalarSlots +=
          declaration.kind === 'variable'
            ? 1
            : declaration.kind === 'list'
              ? (declaration.initialItems ?? []).length
              : 0
        charge(
          'declaration records',
          counts.declarations,
          limits.maximumDeclarations
        )
        charge(
          'runtime scalar slots',
          counts.runtimeScalarSlots,
          DEFAULT_EDIT_ADMISSION_LIMITS.maxRuntimeScalarSlots
        )
        id = candidate.uids.next(
          declaration.kind === 'variable'
            ? 'v'
            : declaration.kind === 'list'
              ? 'l'
              : 'bc'
        )
        if (declaration.kind === 'variable')
          defineScratchRecordValue(target.variables, id, [
            declaration.name,
            declaration.initialValue ?? 0,
          ])
        else if (declaration.kind === 'list')
          defineScratchRecordValue(target.lists!, id, [
            declaration.name,
            [...(declaration.initialItems ?? [])],
          ])
        else defineScratchRecordValue(target.broadcasts!, id, declaration.name)
      }
      bindings.push({
        logicalId: declaration.id,
        entityKind: 'declaration',
        subtype: declaration.kind,
        targetIndex,
        serializedId: id,
        name: declaration.name,
      })
      recordOperation(
        declaration.existing ? 'declaration.bind' : 'declaration.add',
        declaration.id,
        targetIndex
      )
    }
  }
  const expectedAssets = new Map<
    string,
    { kind: 'costume' | 'sound'; sourceSha256: string }
  >()
  for (const asset of manifest.assets ?? [])
  {
    const sourceHash = sha256(source(asset.source.path).bytes)
    if (
      asset.source.expectedSha256 &&
      asset.source.expectedSha256 !== sourceHash
    )
      fail(asset.id, 'asset source digest differs')
    const ids =
      asset.kind === 'costumeSheet'
        ? asset.frames.map((frame) => frame.id)
        : [asset.id]
    for (const id of ids)
    {
      if (expectedAssets.has(id))
        fail(id, 'duplicate prepared logical asset ID')
      expectedAssets.set(id, {
        kind: asset.kind === 'sound' ? 'sound' : 'costume',
        sourceSha256: sourceHash,
      })
    }
  }
  const preparedById = new Map<
    string,
    { asset: WorkspacePreparedAssetV2; identity: DerivedMediaAssetIdentity }
  >()
  for (const asset of prepared)
  {
    if (preparedById.has(asset.logicalAssetId))
      fail(asset.logicalAssetId, 'duplicate prepared asset')
    const expected = expectedAssets.get(asset.logicalAssetId)
    if (
      !expected ||
      expected.kind !== asset.kind ||
      expected.sourceSha256 !== asset.sourceSha256
    )
      fail(
        asset.logicalAssetId,
        'prepared evidence is outside the declared source closure'
      )
    preparedById.set(asset.logicalAssetId, {
      asset,
      identity: await checkPrepared(asset),
    })
  }
  if (preparedById.size !== expectedAssets.size)
    fail('assets', 'declared assets are missing preparation evidence')
  for (const targetSource of manifest.targets)
  {
    const targetIndex = targetIndexes.get(targetSource.id)!
    const target = candidate.json.targets[targetIndex]!
    for (const costume of targetSource.costumes ?? [])
    {
      const prepared = preparedById.get(costume.assetId)
      if (
        !prepared ||
        prepared.asset.kind !== 'costume' ||
        prepared.identity.mediaKind !== 'costume'
      )
        fail(
          costume.assetId,
          'costume binding requires a declared prepared PNG'
        )
      if (
        target.costumes.some((entry) => entry.name === costume.name) ||
        bindings.some(
          (entry) =>
            entry.entityKind === 'media' &&
            entry.targetIndex === targetIndex &&
            entry.logicalId === costume.assetId
        )
      )
        fail(
          costume.assetId,
          'costume name or logical binding is ambiguous on this target'
        )
      const { asset, identity } = prepared
      if (asset.kind !== 'costume' || identity.mediaKind !== 'costume')
        fail(costume.assetId, 'costume kind differs')
      counts.costumes += 1
      decodedCostumeBytes += identity.width * identity.height * 4
      charge('costume records', counts.costumes, limits.maximumCostumes)
      charge(
        'target costumes',
        target.costumes.length + 1,
        limits.maximumCostumesPerTarget
      )
      charge(
        'decoded costume bytes',
        decodedCostumeBytes,
        limits.maximumDecodedCostumeBytes
      )
      reserveAsset(identity.md5ext, asset.bytes)
      candidate.addAsset({ path: identity.md5ext, bytes: asset.bytes })
      target.costumes.push({
        assetId: identity.md5,
        name: costume.name,
        dataFormat: 'png',
        md5ext: identity.md5ext,
        bitmapResolution: 1,
        rotationCenterX: asset.metadata.pivot.x,
        rotationCenterY: asset.metadata.pivot.y,
      })
      if (costume.pivot)
        applyCostumePivotEditV2(candidate, {
          kind: 'costume.setPivot',
          targetIndex,
          costumeIndexOneBased: target.costumes.length,
          expectedIdentitySha256: costumePivotIdentityV2(
            candidate,
            targetIndex,
            target.costumes.length
          ),
          rotationCenterX: costume.pivot.x,
          rotationCenterY: costume.pivot.y,
        })
      bindings.push({
        logicalId: costume.assetId,
        entityKind: 'media',
        subtype: 'costume',
        targetIndex,
        serializedId: identity.md5ext,
        name: costume.name,
      })
      recordOperation('media.addCostume', costume.assetId, targetIndex)
    }
    for (const sound of targetSource.sounds ?? [])
    {
      const prepared = preparedById.get(sound.assetId)
      if (
        !prepared ||
        prepared.asset.kind !== 'sound' ||
        prepared.identity.mediaKind !== 'sound'
      )
        fail(sound.assetId, 'sound binding requires a declared prepared WAV')
      if (
        target.sounds.some((entry) => entry.name === sound.name) ||
        bindings.some(
          (entry) =>
            entry.entityKind === 'media' &&
            entry.targetIndex === targetIndex &&
            entry.logicalId === sound.assetId
        )
      )
        fail(
          sound.assetId,
          'sound name or logical binding is ambiguous on this target'
        )
      const { asset, identity } = prepared
      if (identity.mediaKind !== 'sound')
        fail(sound.assetId, 'sound kind differs')
      counts.sounds += 1
      charge(
        'sound records',
        counts.sounds,
        DEFAULT_EDIT_ADMISSION_LIMITS.maxSoundRecords
      )
      charge(
        'target sounds',
        target.sounds.length + 1,
        DEFAULT_EDIT_ADMISSION_LIMITS.maxSoundsPerTarget
      )
      reserveAsset(identity.md5ext, asset.bytes)
      candidate.addAsset({ path: identity.md5ext, bytes: asset.bytes })
      target.sounds.push({
        assetId: identity.md5,
        name: sound.name,
        dataFormat: 'wav',
        md5ext: identity.md5ext,
        format: identity.format,
        rate: identity.rate,
        sampleCount: identity.sampleCount,
      })
      bindings.push({
        logicalId: sound.assetId,
        entityKind: 'media',
        subtype: 'sound',
        targetIndex,
        serializedId: identity.md5ext,
        name: sound.name,
      })
      recordOperation('media.addSound', sound.assetId, targetIndex)
    }
    if (targetSource.currentCostume !== undefined)
    {
      const selected = target.costumes.flatMap((costume, index) =>
        costume.name === targetSource.currentCostume ? [index] : []
      )
      if (selected.length !== 1)
        fail(targetSource.id, 'current costume name is absent or ambiguous')
      target.currentCostume = selected[0]!
      recordOperation('media.setCurrentCostume', targetSource.id, targetIndex)
    }
    if (target.costumes.length === 0)
      fail(targetSource.id, 'compiled target must have a costume')
  }
  const procedures = new Map<string, ProcedureBinding>()
  const lowerer = new StandardBlockLowererV2({
    resolveEntity: resolver(bindings, stageIndex, candidate),
    resolveProcedure: (request) =>
    {
      if (request.reference.refKind !== 'created')
        fail(
          request.semanticPath,
          'procedure ref is outside compiler authority'
        )
      const binding =
        procedures.get(request.reference.opId) ??
        fail(request.semanticPath, 'procedure logical ID is absent')
      return {
        ...binding.scope,
        ownerTargetIndex: binding.targetIndex,
        semanticLineageSha256: hashJson({
          kind: 'workspace-procedure-binding-v2',
          logicalId: binding.logicalId,
          targetIndex: binding.targetIndex,
        }),
        semanticFingerprintSha256: binding.scope.signatureSha256,
      }
    },
    resolveParameter: (request) =>
    {
      const ref = request.reference
      if (ref.refKind !== 'created')
        fail(
          request.semanticPath,
          'parameter ref is outside compiler authority'
        )
      const binding =
        procedures.get(ref.opId) ??
        fail(request.semanticPath, 'parameter procedure ID is absent')
      const parameter =
        binding.scope.parameters.find(
          (parameter) => parameter.localKey === ref.slot.localKey
        ) ??
        fail(
          request.semanticPath,
          'parameter ID is absent from the selected procedure'
        )
      return {
        ...parameter,
        proccode: binding.scope.proccode,
        signatureSha256: binding.scope.signatureSha256,
        ownerTargetIndex: binding.targetIndex,
        semanticLineageSha256: hashJson({
          kind: 'workspace-parameter-binding-v2',
          logicalId: binding.logicalId,
          localKey: parameter.localKey,
          targetIndex: binding.targetIndex,
        }),
        semanticFingerprintSha256: hashJson(parameter),
      }
    },
  })
  // definitions allocate every signature first so forward & recursive calls bind exact IDs
  for (const targetSource of manifest.targets)
    for (const ref of targetSource.procedures ?? [])
    {
      const targetIndex = targetIndexes.get(targetSource.id)!
      const source = parseWorkspaceProcedureFileV2(sourceJSON(ref.path))
      const decoded = canonicalProcedureSignatureV1(source.signature)
      charge(
        'block records',
        counts.blockRecords + 2 + decoded.parameters.length,
        limits.maximumBlocks
      )
      charge('script roots', counts.scriptRoots + 1, limits.maximumScripts)
      const compilationFact = hashJson({
        kind: 'workspace-procedure-definition-v2',
        logicalId: ref.id,
        targetIndex,
        source,
      })
      const receipt = applyProcedureOperationV1(
        candidate,
        {
          targetIndex,
          operation: {
            kind: 'procedure.add',
            opId: ref.id,
            target: {
              entityKind: 'target',
              refKind: 'created',
              opId: targetSource.id,
              slot: { slotKind: 'fixed', name: 'target' },
            },
            signature: source.signature,
            workspace: source.workspace ?? { x: 0, y: 0 },
            expectedPlanningFactSetSha256: compilationFact,
            expectedProspectiveProcedureCollisionSetSha256: hashJson([]),
            requireExistingProspectiveCollisionCount: 0,
          },
        },
        {
          semanticAuthorityId: 'standard-v2',
          lowerStatementSequence: (...args) =>
            lowerer.lowerStatementSequence(...args),
        }
      )
      const scope: StandardProcedureScopeV2 = {
        proccode: decoded.proccode,
        warp: decoded.warp,
        signatureSha256: standardProcedureSignatureSha256V2(decoded),
        parameters: decoded.parameters.map((parameter) => ({
          ...parameter,
          argumentId: receipt.argumentIdByLocalKey[parameter.localKey]!,
        })),
      }
      counts.blockRecords += receipt.createdBlockIds.length
      counts.scriptRoots += 1
      procedures.set(ref.id, {
        logicalId: ref.id,
        targetIndex,
        definitionId: receipt.definitionBlockId!,
        source,
        scope,
      })
      recordOperation('procedure.addDefinition', ref.id, targetIndex)
    }
  for (const binding of procedures.values())
  {
    if (!binding.source.body) continue
    const graph = lowerer.lowerStatementSequence(
      candidate,
      binding.targetIndex,
      translateSequence(binding.source.body, procedures, binding),
      { procedureScope: binding.scope }
    )
    reserveGraph(graph)
    install(candidate, binding.targetIndex, graph)
    const target = candidate.json.targets[binding.targetIndex]!
    ;(target.blocks[binding.definitionId] as Block).next = graph.rootId
    ;(target.blocks[graph.rootId] as Block).parent = binding.definitionId
    recordOperation('procedure.addBody', binding.logicalId, binding.targetIndex)
  }
  const scriptReferences: WorkspaceBuildPlanV2['resolvedReferences'][number][] =
    []
  for (const targetSource of manifest.targets)
    for (const ref of targetSource.scripts ?? [])
    {
      const targetIndex = targetIndexes.get(targetSource.id)!
      const file = parseWorkspaceScriptFileV2(sourceJSON(ref.path))
      const graph = lowerer.lowerTopLevelRoot(
        candidate,
        targetIndex,
        translateRoot(file.root, procedures),
        file.workspace ?? { x: 0, y: 0 }
      )
      reserveGraph(graph)
      install(candidate, targetIndex, graph)
      scriptReferences.push({
        entityKind: 'script',
        logicalId: ref.id,
        targetIndex,
        serializedIdentity: graph.rootId,
        displayName: ref.id,
      })
      recordOperation('script.add', ref.id, targetIndex)
    }
  assertStandardProcedureGraphOwnershipV2(candidate, baseline)
  parseKnownProcedureMutations(candidate.json, editLimits)
  const opcodes = candidate.json.targets.flatMap((target) =>
    Object.values(target.blocks).flatMap((entry) =>
      Array.isArray(entry) ? [] : [entry.opcode]
    )
  )
  const knownExtensions = new Set(['pen', 'music', 'videoSensing'])
  const extensions = [
    ...new Set([
      ...(candidate.json.extensions ?? []).filter(
        (id) =>
          !knownExtensions.has(id) ||
          opcodes.some((opcode) => opcode.startsWith(`${id}_`))
      ),
      ...standardExtensionIdsV2(opcodes),
    ]),
  ].sort()
  if (candidate.json.extensions !== undefined || extensions.length > 0)
    candidate.json.extensions = extensions
  const clips: ResolvedAnimationClipV2[] = []
  for (const targetSource of manifest.targets)
  {
    const targetIndex = targetIndexes.get(targetSource.id)!
    const selected = (manifest.clips ?? []).filter(
      (clip) => clip.targetId === targetSource.id
    )
    clips.push(
      ...resolveAnimationClipsV2(
        selected,
        candidate,
        targetIndex,
        bindings
          .filter(
            (binding) =>
              binding.entityKind === 'media' &&
              binding.subtype === 'costume' &&
              binding.targetIndex === targetIndex
          )
          .map((binding) => ({
            logicalAssetId: binding.logicalId,
            costumeName: binding.name,
            outputSha256: preparedById.get(binding.logicalId)!.asset
              .outputSha256,
          }))
      )
    )
  }
  for (const clip of manifest.clips ?? [])
    if (!targetIndexes.has(clip.targetId))
      fail(clip.id, 'clip target ID is absent')
  const jsonBytes = new TextEncoder().encode(
    candidate.toProjectJsonText()
  ).byteLength
  const assets = normalizeAssetsByPath(candidate.assets)
  charge('project JSON bytes', jsonBytes, limits.maximumProjectJsonBytes)
  charge(
    'candidate asset bytes',
    assets.reduce((sum, asset) => sum + asset.bytes.byteLength, 0),
    limits.maximumAssetBytes
  )
  charge('archive entries', assets.length + 1, DEFAULT_SB3_LIMITS.maxEntries)
  const preprocessing = input.preprocessingCosts ?? {
    pixelVisits: 0,
    peakDecodedBytes: 0,
  }
  charge(
    'preprocessing pixel visits',
    preprocessing.pixelVisits,
    ASSET_PIPELINE_LIMITS_V2.maxPixelVisits
  )
  charge(
    'preprocessing peak decoded bytes',
    preprocessing.peakDecodedBytes,
    ASSET_PIPELINE_LIMITS_V2.maxDecodedWorkingBytes
  )
  const candidateBytes = await candidate.toSb3()
  charge(
    'candidate SB3 bytes',
    candidateBytes.byteLength,
    limits.maximumSb3Bytes
  )
  const candidateAdmission = await admitSb3ForEdit(candidateBytes, {
    editLimits,
    limits: archiveLimits,
  })
  const diff = computeProjectDelta(baseline, candidate)
  const sourceFiles = files
    .map((file) => ({
      path: file.path,
      sha256: sha256(file.bytes),
      byteLength: file.bytes.byteLength,
    }))
    .sort((left, right) =>
      left.path < right.path ? -1 : left.path > right.path ? 1 : 0
    )
  const assetEvidence = prepared
    .map((asset) => ({
      logicalAssetId: asset.logicalAssetId,
      kind: asset.kind,
      sourceSha256: asset.sourceSha256,
      transformSha256: asset.transformSha256,
      outputSha256: asset.outputSha256,
    }))
    .sort((left, right) =>
      left.logicalAssetId < right.logicalAssetId
        ? -1
        : left.logicalAssetId > right.logicalAssetId
          ? 1
          : 0
    )
  const compilerIdentity =
    input.compilerIdentitySha256 ??
    hashJson({
      kind: 'scratch-workspace-compiler-v2',
      schemaVersion: 2,
      standardAuthoritySha256: getStandardAuthoritySha256V2(),
    })
  if (!/^[a-f\d]{64}$/.test(compilerIdentity))
    fail('compilerIdentity', 'expected a SHA-256')
  const unsigned = {
    schemaVersion: 2 as const,
    kind: 'scratch-workspace-build' as const,
    manifestSha256: hashJson(originalManifest),
    baselineArtifactSha256: baselineHash,
    sourceSetSha256: hashJson(sourceFiles),
    standardAuthoritySha256: getStandardAuthoritySha256V2(),
    compilerIdentitySha256: compilerIdentity,
    candidateSha256: sha256(candidateBytes),
    sourceFiles,
    preparedAssets: assetEvidence,
    resolvedReferences: [
      ...bindings.map((binding) => ({
        entityKind: binding.entityKind,
        logicalId: binding.logicalId,
        targetIndex: binding.targetIndex,
        serializedIdentity: binding.serializedId,
        displayName: binding.name,
      })),
      ...Array.from(procedures.values(), (binding) => ({
        entityKind: 'procedure',
        logicalId: binding.logicalId,
        targetIndex: binding.targetIndex,
        serializedIdentity: binding.definitionId,
        displayName: binding.scope.proccode,
      })),
      ...scriptReferences,
    ],
    operationOrder: operations,
    clips,
    runtimeTargets: manifest.runtimeTargets ?? [],
    scenarios: manifest.scenarios ?? [],
    assertions: manifest.assertions ?? [],
    costs: {
      ...candidateAdmission.projectCounts,
      assetBytes: assets.reduce(
        (sum, asset) => sum + asset.bytes.byteLength,
        0
      ),
      projectJsonBytes: jsonBytes,
      sb3Bytes: candidateBytes.byteLength,
      sourceBytes: sourceFiles.reduce((sum, file) => sum + file.byteLength, 0),
      decodedCostumeBytes: candidateAdmission.media.metrics.pngDecodedRgbaBytes,
      referencePixels: candidateAdmission.media.metrics.pngReferencePixels,
      preprocessingPixelVisits: preprocessing.pixelVisits,
      preprocessingPeakDecodedBytes: preprocessing.peakDecodedBytes,
    },
    limits,
    diffSha256: hashJson(diff),
  }
  const plan: WorkspaceBuildPlanV2 = {
    ...unsigned,
    planSha256: hashJson(unsigned),
  }
  return {
    manifest: deepFreeze(manifest),
    plan: deepFreeze(plan),
    candidate,
    candidateBytes,
    diff: deepFreeze(diff),
  }
}
