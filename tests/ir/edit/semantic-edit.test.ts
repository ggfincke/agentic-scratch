// tests/ir/edit/semantic-edit.test.ts
// major contract, catalog, discovery, & manifest parity gate

import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import test from 'node:test'
import { deflateSync } from 'node:zlib'

import {
  ProjectIR,
  Uids,
  authorizeEditDelta,
  blankProject,
  buildClicker,
  buildSemanticReferenceIndex,
  captureProjectOrderedHeadEvidence,
  collectEditUidCollisionUniverse,
  computeProjectDelta,
  createEditUids,
  parseMutationArray,
  parseStrictEditMutationArray,
  procedurePlaceholderKinds,
  validateSemanticLineageSnapshot,
  type ProjectDelta,
  type ProjectOrderedCorrespondence,
  type DeclarationRef,
  type SemanticLineageSnapshot,
  type TargetRef,
} from '@scratch-agent/ir'

import {
  APPROVED_A0_SEMANTIC_AUTHORITY_V1,
  PINNED_CORE_BLOCK_SURFACE_DESCRIPTORS_V1,
  PINNED_NAME_SEMANTICS_CORE_OPCODES_V1,
  TARGET_NAME_REFERENCE_DESCRIPTORS_V1,
  EDIT_TOOL_NAMES as PRODUCTION_EDIT_TOOL_NAMES,
  OPERATION_KINDS as PRODUCTION_OPERATION_KINDS,
  OPERATION_PLANNING_ROWS as PRODUCTION_OPERATION_PLANNING_ROWS,
  REFUSAL_CODES as PRODUCTION_REFUSAL_CODES,
  SEMANTIC_HASH_DOMAINS as PRODUCTION_HASH_DOMAINS,
  VANILLA_CORE_DESCRIPTORS as PRODUCTION_VANILLA_CORE_DESCRIPTORS,
  applyBlockStructuralOperationV1,
  applyCommentOperationV1,
  applyProcedureOperationV1,
  applyResolvedDeclarationOperationV1,
  applyScriptWorkspaceOperationV1,
  applyScriptStructuralOperationV1,
  applyTargetOperationV1,
  APPROVED_CURATED_CORE_BUILDER_POLICY_SHA256,
  APPROVED_CURATED_CORE_DESCRIPTOR_PROFILE_SHA256,
  APPROVED_REPAIR_CORE_COMPATIBILITY_PROFILE_SHA256,
  assessDeclarationCapabilitiesV1,
  assessTargetOperationCapabilitiesV1,
  assertApprovedA0SemanticAuthorityV1,
  assertCuratedCoreCatalogV1,
  assertRepairCoreCompatibilityProfileV1,
  blockEntityEvidenceSetV1,
  blockFieldFingerprintV1,
  blockInputFingerprintV1,
  broadcastRuntimeCollisionEvidenceV1,
  commentMapStateV1,
  commentEntityEvidenceSetV1,
  commentSemanticFingerprintV1,
  commentTextSha256V1,
  commentSetSha256V1,
  createCuratedCoreOperationAdaptersV1,
  declarationEntityEvidenceSetV1,
  declarationItemsFingerprintV1,
  declarationNameActivationEvidenceV1,
  declarationValueFingerprintV1,
  declarationReferenceEvidenceV1,
  EDIT_EVIDENCE_CANONICAL_LIMITS_V1,
  editEvidenceCanonicalBytesV1,
  expectedDeclarationNameIdentityV1,
  optionalCollectionContainerStateV1,
  inputShadowFingerprintV1,
  mediaRecordEntityEvidenceSetV1,
  PINNED_CURATED_CORE_PARITY_ROWS_V1,
  planGraphClosureV1,
  procedureEntityEvidenceSetV1,
  procedureParameterEncodingForPlaceholderV1,
  procedureParameterTypeForPlaceholderV1,
  REPAIR_CORE_COMPATIBILITY_PROFILE_V1,
  parseContractDefinitionV1,
  parseKnownProcedureMutations,
  parseSemanticChangeContractV1,
  parseSemanticEditBatchV1,
  semanticHashV1,
  resolveMediaRefV1,
  scriptEntityEvidenceSetV1,
  targetDualOrderSnapshotV1,
  targetExpectedStringIdentityV1,
  targetInboundReferenceSetV1,
  targetOwnedSurfaceSha256V1,
  targetProspectiveNameActivationV1,
  unknownNameSemanticsEvidenceV1,
  validateCuratedClosureV1,
  validateSchemaValue as productionValidateSchemaValue,
  type CuratedEntityResolverV1,
  type SemanticExpressionBlockTreeV1,
  type SemanticStatementSequenceV1,
  type TargetOperationV1,
} from '@scratch-agent/ir/edit'
import {
  AssetPathInvalidError,
  AssetPathConflictError,
  EDIT_SB3_ADMISSION_BRAND,
  MEDIA_CLASSIFICATION_CODES,
  StrictJsonScanError,
  admitSb3ForEdit,
  classifyMediaForAuthoring,
  classifyMediaForPreservation,
  classifyProjectMedia,
  createScratchRecord,
  defineScratchRecordValue,
  packSb3,
  resolveEditAdmissionLimits,
  isEditSb3Admission,
  scanStrictJson,
  type Asset,
  type BlockEntry,
  type BlockField,
  type BlockInput,
  type Comment,
  type ListEntry,
  type ProjectJson,
  type VariableEntry,
} from '@scratch-agent/sb3'
import {
  CanonicalJsonError as ProductionCanonicalJsonError,
  DEFAULT_CANONICAL_JSON_LIMITS,
  canonicalJsonV1 as productionCanonicalJsonV1,
} from '@scratch-agent/sb3/canonical-json'
import {
  hmacSha256Bytes,
  timingSafeBytesEqual,
} from '@scratch-agent/sb3/crypto-node'
import { validateProject } from '@scratch-agent/validate'

import {
  OPERATION_PLANNING_ROWS,
  VANILLA_CORE_DESCRIPTORS,
} from '@scratch-agent/ir/edit'
import {
  canonicalJsonV1,
} from '@scratch-agent/sb3/canonical-json'
import {
  EDIT_TOOL_NAMES,
  HANDLE_CONTRACT,
  OPERATION_KINDS,
  PROJECT_TOOL_NAMES,
  REFUSAL_CODES,
  REFUSAL_REVIEW_ROWS,
  RESOURCE_CONTRACT,
} from '@scratch-agent/ir/edit'
import {
  PHASE8_CONTRACT_MODEL,
  contractDefinitionSchemaModel,
  contractDefinitionNames,
  hashProjectionSchemaModel,
  operationGoalSchemaModel,
  operationSchemaKinds,
  refusalErrorSchemaModel,
  toolInputSchemaModel,
  toolOutputSchemaModel,
  toolReceiptFreeResultSchemaModel,
} from '@scratch-agent/ir/edit'
import {
  emitJsonSchema202012,
  validateSchemaValue,
  type SchemaModel,
  type SchemaNode,
} from '@scratch-agent/ir/edit'
import {
  SEMANTICALLY_VALID_CHANGE_CONTRACT_SAMPLE,
  SEMANTICALLY_VALID_EDIT_BATCH_SAMPLE,
  SEMANTIC_VALIDATION_VECTORS,
  STRING_IDENTITY_VALIDATION_VECTORS,
  validateBoundedDisplayString,
  validateEditScenarioPolicy,
  validateExpectedStringIdentity,
  validateSemanticBlockTree,
  validateSemanticChangeContract,
  validateSemanticEditBatch,
  validateSemanticStatementSequence,
} from '@scratch-agent/ir/edit'
import {
  inspectBaselineArtifact as inspectExtractedArtifact,
  inspectSemanticEditArtifact,
  preflightCandidateArtifact as preflightExtractedArtifact,
} from '@scratch-agent/eval'
import {
  compareEditDiagnosticsV1,
  normalizeEditDiagnosticV1,
} from '@scratch-agent/eval'
import { DEFAULT_DIAGNOSTIC_REGRESSION_OPTIONS } from '@scratch-agent/eval'
import {
  configureRepairMcpPaths,
  defineRegisteredTemplateHostProvenanceV1,
  readSelectedInput,
  recheckSelectedInputProvenanceV1,
} from '@scratch-agent/mcp'
import { pngChunk } from '../../helpers/png.js'

const PROJECT_ROOT = resolve(import.meta.dirname, '../../..')
const TEST_SHA256 = '0'.repeat(64)

const CREATED_TARGET_REF = {
  entityKind: 'target',
  refKind: 'created',
  opId: 'fixture-target',
  slot: { name: 'target', slotKind: 'fixed' },
} as const

const CREATED_BLOCK_REF = {
  entityKind: 'block',
  refKind: 'created',
  opId: 'fixture-block',
  slot: { name: 'rootBlock', slotKind: 'fixed' },
} as const

const CREATED_COMMENT_REF = {
  entityKind: 'comment',
  refKind: 'created',
  opId: 'fixture-comment',
  slot: { name: 'comment', slotKind: 'fixed' },
} as const

const CREATED_SCRIPT_REF = {
  entityKind: 'script',
  refKind: 'created',
  opId: 'fixture-script',
  slot: { name: 'script', slotKind: 'fixed' },
} as const

function sha256(bytes: Uint8Array): string
{
  return createHash('sha256').update(bytes).digest('hex')
}

function targetLineageSnapshot(project: ProjectIR): SemanticLineageSnapshot
{
  return validateSemanticLineageSnapshot({
    version: 'semantic-lineage-v1',
    records: project.json.targets.map((_target, targetIndex) => ({
      lineageId: `target-lineage-${targetIndex}`,
      kind: 'target',
      ownerLineageId: null,
      status: 'active',
      rawIdentity: `target:${targetIndex}`,
      canonicalOrdinal: targetIndex,
    })),
  })
}

function declarationActivationGuard(
  project: ProjectIR,
  kind: 'variable' | 'list' | 'broadcast',
  scope: TargetRef | null,
  name: string,
  excluding?: DeclarationRef
)
{
  const evidence = declarationNameActivationEvidenceV1(
    project,
    kind,
    scope,
    name,
    excluding
  )
  return {
    expectedActivationSetSha256: evidence.activationSetSha256,
    requireProspectiveActivationCount: 0 as const,
  }
}

function hasEditCode(expected: string): (error: unknown) => boolean
{
  return (error: unknown) =>
    error instanceof Error &&
    'code' in error &&
    (error as Error & { code: unknown }).code === expected
}

function applyTargetTestOperation(
  project: ProjectIR,
  activeLineage: SemanticLineageSnapshot,
  targetIndex: number,
  operation: TargetOperationV1
)
{
  return applyTargetOperationV1(project, {
    operation,
    targetIndex,
    activeLineage,
  })
}

function linearStatementScript(blockCount: number): Record<string, BlockEntry>
{
  const blocks = createScratchRecord<BlockEntry>()
  for (let index = 0; index < blockCount; index++)
  {
    defineScratchRecordValue<BlockEntry>(blocks, `bounded-${index}`, {
      opcode: 'looks_say',
      next: index === blockCount - 1 ? null : `bounded-${index + 1}`,
      parent: index === 0 ? null : `bounded-${index - 1}`,
      inputs: createScratchRecord<BlockInput>([
        ['MESSAGE', [1, [10, 'bounded evidence']]],
      ]),
      fields: createScratchRecord<BlockField>(),
      shadow: false,
      topLevel: index === 0,
      ...(index === 0 ? { x: 0, y: 0 } : {}),
    })
  }
  return blocks
}

function onePixelPng(interlaced = false): Uint8Array
{
  const signature = Uint8Array.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  ])
  const header = new Uint8Array(13)
  const view = new DataView(header.buffer)
  view.setUint32(0, 1, false)
  view.setUint32(4, 1, false)
  header[8] = 8
  header[9] = 6
  header[12] = interlaced ? 1 : 0
  const compressed = deflateSync(Uint8Array.from([0, 255, 0, 0, 255]))
  return Uint8Array.from([
    ...signature,
    ...pngChunk('IHDR', header),
    ...pngChunk('IDAT', compressed),
    ...pngChunk('IEND', new Uint8Array()),
  ])
}

function oneSamplePcmWav(): Uint8Array
{
  const bytes = new Uint8Array(46)
  const view = new DataView(bytes.buffer)
  bytes.set(new TextEncoder().encode('RIFF'), 0)
  view.setUint32(4, 38, true)
  bytes.set(new TextEncoder().encode('WAVEfmt '), 8)
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, 1, true)
  view.setUint32(24, 8_000, true)
  view.setUint32(28, 8_000, true)
  view.setUint16(32, 1, true)
  view.setUint16(34, 8, true)
  bytes.set(new TextEncoder().encode('data'), 36)
  view.setUint32(40, 2, true)
  bytes[44] = 128
  bytes[45] = 128
  return bytes
}

function assertClosedObjectSchemas(value: unknown, path = '$'): void
{
  if (Array.isArray(value))
  {
    value.forEach((entry, index) =>
      assertClosedObjectSchemas(entry, `${path}/${index}`)
    )
    return
  }
  if (value === null || typeof value !== 'object') return
  const record = value as Record<string, unknown>
  if (record.type === 'object')
  {
    assert.equal(
      record.additionalProperties,
      false,
      `${path} must reject unknown keys`
    )
  }
  for (const [key, entry] of Object.entries(record))
  {
    assertClosedObjectSchemas(entry, `${path}/${key}`)
  }
}

function reachableSchemaFieldNames(model: SchemaModel): Set<string>
{
  const fields = new Set<string>()
  const visitedDefinitions = new Set<string>()
  const visit = (node: SchemaNode): void =>
  {
    if (node.kind === 'ref')
    {
      if (visitedDefinitions.has(node.name)) return
      visitedDefinitions.add(node.name)
      const definition = model.definitions[node.name]
      assert.ok(definition, `missing schema definition ${node.name}`)
      visit(definition)
      return
    }
    if (node.kind === 'object')
    {
      for (const [name, field] of Object.entries(node.fields))
      {
        fields.add(name)
        visit(field.schema)
      }
      return
    }
    if (node.kind === 'array')
    {
      visit(node.items)
      return
    }
    if (node.kind === 'anyOf') node.variants.forEach(visit)
  }
  visit(model.root)
  return fields
}

function semanticVectorResult(
  vector: (typeof SEMANTIC_VALIDATION_VECTORS)[number]
)
{
  switch (vector.domain)
  {
    case 'changeContract':
      return validateSemanticChangeContract(vector.value)
    case 'editBatch':
      return validateSemanticEditBatch(vector.value)
    case 'blockTree':
      return validateSemanticBlockTree(vector.value)
    case 'statementSequence':
      return validateSemanticStatementSequence(vector.value)
    case 'scenarioPolicy':
      return validateEditScenarioPolicy(vector.value)
  }
}

function rootObjectFields(model: SchemaModel): Record<string, SchemaNode>
{
  let root = model.root
  const visited = new Set<string>()
  while (root.kind === 'ref')
  {
    assert.equal(visited.has(root.name), false)
    visited.add(root.name)
    const definition = model.definitions[root.name]
    assert.ok(definition)
    root = definition
  }
  assert.equal(root.kind, 'object')
  if (root.kind !== 'object') return {}
  return Object.fromEntries(
    Object.entries(root.fields).map(([name, field]) => [name, field.schema])
  )
}

function firstIssueCode(result: ReturnType<typeof parseContractDefinitionV1>)
{
  return result.ok ? null : result.issues[0]?.issue.code
}

test('A0 semantic algebra, catalogs, refusals, & resource contracts agree', () =>
{
  assert.equal(EDIT_TOOL_NAMES.length, 13)
  assert.equal(PROJECT_TOOL_NAMES.length, 4)
  assert.equal(OPERATION_KINDS.length, 46)
  assert.equal(OPERATION_PLANNING_ROWS.length, 46)
  assert.equal(VANILLA_CORE_DESCRIPTORS.length, 13)
  assert.deepEqual(operationSchemaKinds(), OPERATION_KINDS)
  assert.deepEqual(
    [...OPERATION_PLANNING_ROWS.map((row) => row.operationKind)].sort(),
    [...OPERATION_KINDS].sort()
  )
  assert.ok(
    OPERATION_PLANNING_ROWS.every(
      (row) =>
        canonicalJsonV1(
          row.choiceMappings.map((mapping) => mapping.destination)
        ) === canonicalJsonV1(row.choiceFields) &&
        canonicalJsonV1(
          row.completedFactMappings.map((mapping) => mapping.destination)
        ) === canonicalJsonV1(row.completedFactFields) &&
        row.choiceMappings.every(
          (mapping) =>
            mapping.allowedAlternativeKinds.length > 0 &&
            new Set(mapping.allowedAlternativeKinds).size ===
              mapping.allowedAlternativeKinds.length
        )
    )
  )
  const blockMoveGoal = rootObjectFields(operationGoalSchemaModel('block.move'))
  assert.deepEqual(Object.keys(blockMoveGoal).sort(), [
    'block',
    'destination',
    'kind',
    'opId',
  ])
  assert.deepEqual(blockMoveGoal.destination, {
    kind: 'ref',
    name: 'BlockMoveDestinationGoalV1',
  })
  assert.ok(
    Object.hasOwn(
      rootObjectFields(operationGoalSchemaModel('comment.add')),
      'attachment'
    )
  )
  for (const definitionName of [
    'SpritePropertyGoalEditV1',
    'StagePropertyGoalEditV1',
    'CommentLayoutGoalEditV1',
  ])
  {
    const fields = reachableSchemaFieldNames(
      contractDefinitionSchemaModel(definitionName)
    )
    assert.equal(fields.has('expected'), false, definitionName)
    assert.equal(fields.has('property'), true, definitionName)
    assert.equal(fields.has('value'), true, definitionName)
  }
  assert.equal(new Set(REFUSAL_CODES).size, REFUSAL_CODES.length)
  assert.deepEqual(
    [...REFUSAL_REVIEW_ROWS.map((row) => row.code)].sort(),
    [...REFUSAL_CODES].sort()
  )
  assert.deepEqual(
    REFUSAL_REVIEW_ROWS.filter((row) => !row.callerReachable)
      .map((row) => row.code)
      .sort(),
    ['edit.audit_failed', 'edit.internal_invariant', 'edit.retention_failed']
  )
  assert.ok(
    REFUSAL_REVIEW_ROWS.every(
      (row) =>
        row.tools.length > 0 &&
        row.states.length > 0 &&
        new Set(row.contextFields).size === row.contextFields.length
    )
  )
  assert.equal(
    REFUSAL_REVIEW_ROWS.find((row) => row.code === 'edit.audit_failed')
      ?.wireDisposition,
    'fatal-unaudited-boundary'
  )
  assert.deepEqual(
    [HANDLE_CONTRACT.tokenRawBytes, HANDLE_CONTRACT.tokenCharacters],
    [65, 87]
  )
  assert.deepEqual(
    [RESOURCE_CONTRACT.tokenRawBytes, RESOURCE_CONTRACT.tokenCharacters],
    [81, 108]
  )
  assert.equal(HANDLE_CONTRACT.issuanceRegistry, false)
  assert.equal(RESOURCE_CONTRACT.readCreatesDurableState, false)
  assert.equal(RESOURCE_CONTRACT.tokenVersion, 1)
  assert.equal(RESOURCE_CONTRACT.hmacAlgorithm, 'HMAC-SHA-256')
  assert.equal(
    RESOURCE_CONTRACT.hmacKeyPurpose,
    'scratch-edit-resource-capability-v1'
  )
  assert.equal(RESOURCE_CONTRACT.hmacPreimage.separatorByteHex, '00')
  assert.equal(RESOURCE_CONTRACT.resolution.verifyTagBeforeContentRead, true)

  const requiredDefinitions = [
    'EditChangeContractRegistrationV1',
    'EditEvaluationCertificateV1',
    'EditHistoryHashProjectionV1',
    'EditReportProvenanceV1',
    'EditRevisionV1',
    'EditSemanticChangeContractV1',
    'EditSemanticEventHashProjectionV1',
    'EditToolRequestV1',
    'EditToolResultV1',
    'OpeningRefusalIdentityV1',
    'RefusedStatefulResponseIdentityV1',
    'RuntimePredicateV1',
    'ScratchEditResourceMacInputV1',
    'ScratchEditArtifactResourceUriV1',
    'SemanticEditBatchV1',
    'SemanticEditCapabilityProfileV1',
    'SemanticEditCapabilitySnapshotV1',
  ]
  const definitionNames = contractDefinitionNames()
  for (const name of requiredDefinitions)
  {
    assert.ok(definitionNames.includes(name), `missing ${name}`)
  }
  assertClosedObjectSchemas(emitJsonSchema202012(PHASE8_CONTRACT_MODEL))
})

test('A0 strict tool schemas and CanonicalJsonV1 vectors fail closed', () =>
{
  for (const name of EDIT_TOOL_NAMES)
  {
    for (const model of [
      toolInputSchemaModel(name),
      toolOutputSchemaModel(name),
      toolReceiptFreeResultSchemaModel(name),
    ])
    {
      assertClosedObjectSchemas(emitJsonSchema202012(model))
      const invalid = validateSchemaValue(model, { __unknown: true })
      assert.equal(invalid.ok, false)
    }
  }

  for (const [domain, forbiddenFields] of Object.entries({
    'resolved-semantic-batch': [
      'expectedCapabilitySnapshotSha256',
      'capabilitySnapshotSha256',
      'requestBatchSha256',
      'requestId',
      'sessionId',
      'token',
      'assetToken',
    ],
    'resolved-plan': [
      'capabilitySnapshotSha256',
      'requestBatchSha256',
      'requestId',
      'sessionId',
    ],
    revision: [
      'capabilitySnapshotSha256',
      'requestBatchSha256',
      'requestId',
      'sessionId',
      'eventSha256',
    ],
    history: [
      'capabilitySnapshotSha256',
      'requestId',
      'sessionId',
      'eventSha256',
      'invocationSha256',
    ],
    'semantic-report-projection': [
      'capabilitySnapshotSha256',
      'requestId',
      'sessionId',
      'eventHeadSha256',
      'auditHeadSha256',
    ],
  }))
  {
    const fields = reachableSchemaFieldNames(
      hashProjectionSchemaModel(
        domain as Parameters<typeof hashProjectionSchemaModel>[0]
      )
    )
    for (const field of forbiddenFields)
    {
      assert.equal(fields.has(field), false, `${domain} contains ${field}`)
    }
  }

  for (const vector of SEMANTIC_VALIDATION_VECTORS)
  {
    const observed = semanticVectorResult(vector)
    assert.equal(observed.valid, vector.expectedValid, vector.id)
    assert.deepEqual(
      observed.issues.map((issue) => issue.code),
      vector.expectedIssueCodes,
      vector.id
    )
  }
  for (const vector of STRING_IDENTITY_VALIDATION_VECTORS)
  {
    const observed =
      vector.domain === 'expectedStringIdentity'
        ? validateExpectedStringIdentity(vector.value, vector.sourceValue)
        : validateBoundedDisplayString(vector.value, vector.sourceValue)
    assert.equal(observed.valid, vector.expectedValid, vector.id)
    assert.deepEqual(
      observed.issues.map((issue) => issue.code),
      vector.expectedIssueCodes,
      vector.id
    )
  }
  assert.equal(
    validateSchemaValue(
      contractDefinitionSchemaModel('EditSemanticChangeContractV1'),
      SEMANTICALLY_VALID_CHANGE_CONTRACT_SAMPLE
    ).ok,
    true
  )
  assert.equal(
    validateSemanticChangeContract(SEMANTICALLY_VALID_CHANGE_CONTRACT_SAMPLE)
      .valid,
    true
  )
  assert.equal(
    validateSchemaValue(
      contractDefinitionSchemaModel('SemanticEditBatchV1'),
      SEMANTICALLY_VALID_EDIT_BATCH_SAMPLE
    ).ok,
    true
  )
  assert.equal(
    validateSemanticEditBatch(SEMANTICALLY_VALID_EDIT_BATCH_SAMPLE).valid,
    true
  )

  for (const row of REFUSAL_REVIEW_ROWS)
  {
    assertClosedObjectSchemas(
      emitJsonSchema202012(refusalErrorSchemaModel(row.code))
    )
  }
})

test('Group A production authority is immutable, exact, & strictly parsed', () =>
{

  const authority = assertApprovedA0SemanticAuthorityV1()
  assert.equal(authority.approvedA0Parity, true)
  assert.equal(authority.definitionCount, 551)
  assert.deepEqual(
    APPROVED_A0_SEMANTIC_AUTHORITY_V1,
    Object.freeze({
      declarationSha256:
        'da2ab486dd407f0cd1ae26303fa996c6e6de16b3e3125dfd8a86c01b189614c0',
      semanticSchemaSha256:
        '022240af8e3c2cb1898d1c6b464a0c056e5d70e7671062e2a791f60d9947500b',
    })
  )
  assert.deepEqual(PRODUCTION_EDIT_TOOL_NAMES, EDIT_TOOL_NAMES)
  assert.deepEqual(PRODUCTION_OPERATION_KINDS, OPERATION_KINDS)
  assert.deepEqual(PRODUCTION_REFUSAL_CODES, REFUSAL_CODES)
  assert.equal(PRODUCTION_HASH_DOMAINS.length, 22)
  assert.deepEqual(PRODUCTION_OPERATION_PLANNING_ROWS, OPERATION_PLANNING_ROWS)
  assert.deepEqual(
    PRODUCTION_VANILLA_CORE_DESCRIPTORS,
    VANILLA_CORE_DESCRIPTORS
  )
  for (const authority of [
    PRODUCTION_EDIT_TOOL_NAMES,
    PRODUCTION_OPERATION_KINDS,
    PRODUCTION_REFUSAL_CODES,
    PRODUCTION_HASH_DOMAINS,
    PRODUCTION_OPERATION_PLANNING_ROWS,
    PRODUCTION_VANILLA_CORE_DESCRIPTORS,
    PRODUCTION_VANILLA_CORE_DESCRIPTORS[0],
  ])
  {
    assert.equal(Object.isFrozen(authority), true)
  }
  assert.equal(Object.isFrozen(DEFAULT_CANONICAL_JSON_LIMITS), true)

  const parsedContract = parseSemanticChangeContractV1(
    SEMANTICALLY_VALID_CHANGE_CONTRACT_SAMPLE
  )
  assert.equal(parsedContract.ok, true)
  if (parsedContract.ok)
  {
    assert.notEqual(
      parsedContract.value,
      SEMANTICALLY_VALID_CHANGE_CONTRACT_SAMPLE
    )
    assert.equal(Object.isFrozen(parsedContract.value), true)
    assert.equal(Object.getPrototypeOf(parsedContract.value), null)
  }
  const parsedBatch = parseSemanticEditBatchV1(
    SEMANTICALLY_VALID_EDIT_BATCH_SAMPLE
  )
  assert.equal(parsedBatch.ok, true)
  if (parsedBatch.ok)
  {
    assert.equal(Object.isFrozen(parsedBatch.value), true)
    assert.equal(Object.isFrozen(parsedBatch.value.operations), true)
  }

  for (const [definition, value, code] of [
    ['ScratchNumberV1', Number.NaN, 'nonfinite_number'],
    ['ScratchNumberV1', -0, 'negative_zero'],
    ['ScratchNumberV1', Number.MAX_SAFE_INTEGER + 1, 'unsafe_integer'],
    ['AuthoringNameV1', 'e\u0301', 'string_nfc'],
    ['AuthoringNameV1', 'a\0b', 'string_nul'],
    ['AuthoringNameV1', '\ud800', 'string_unpaired_surrogate'],
    ['AuthoringNameV1', '\ud83d\ude00'.repeat(65), 'string_utf8_length'],
  ] as const)
  {
    const result = parseContractDefinitionV1(definition, value)
    assert.equal(result.ok, false, `${definition}/${code}`)
    assert.equal(firstIssueCode(result), code, `${definition}/${code}`)
  }

  const arrayWithNonIndexKey = [0]
  Object.defineProperty(arrayWithNonIndexKey, '4294967295', {
    enumerable: true,
    value: 'hidden',
  })
  const nonIndexArrayResult = parseContractDefinitionV1('RuntimeExpectedV1', {
    valueKind: 'scalarList',
    value: arrayWithNonIndexKey,
  })
  assert.equal(nonIndexArrayResult.ok, false)
  assert.equal(firstIssueCode(nonIndexArrayResult), 'any_of')
  const directNonIndexArrayResult = productionValidateSchemaValue(
    {
      schemaVersion: 1,
      root: { kind: 'array', items: { kind: 'integer' } },
      definitions: {},
    },
    arrayWithNonIndexKey
  )
  assert.equal(directNonIndexArrayResult.ok, false)
  assert.equal(directNonIndexArrayResult.issues[0]?.code, 'unknown_key')
})

test('Group A production canonical bytes, hashes, & HMAC substrate match', () =>
{
  const largestHashableChangeContract = structuredClone(
    SEMANTICALLY_VALID_CHANGE_CONTRACT_SAMPLE
  ) as typeof SEMANTICALLY_VALID_CHANGE_CONTRACT_SAMPLE & {
    evaluationPlans: { requiredRuntimeChanges: unknown[] }[]
  }
  largestHashableChangeContract.evaluationPlans[0]!.requiredRuntimeChanges = [
    {
      objectiveId: 'runtimeChange',
      kind: 'stateAtLabel',
      scenarioId: 'scenario',
      lane: 'officialHeadless',
      label: 'done',
      path: { pathKind: 'stageProperty', property: 'answer' },
      assertion: {
        comparator: 'equals',
        expected: {
          valueKind: 'scalarList',
          value: Array.from({ length: 16_384 }, () => 0),
        },
      },
    },
  ]
  const parsedHashableChangeContract = parseSemanticChangeContractV1(
    largestHashableChangeContract
  )
  assert.equal(parsedHashableChangeContract.ok, true)
  if (parsedHashableChangeContract.ok)
  {
    assert.doesNotThrow(() =>
      semanticHashV1('change-contract', parsedHashableChangeContract.value)
    )
  }
  const oversizedChangeContract = structuredClone(largestHashableChangeContract)
  const oversizedRuntimeList = (
    oversizedChangeContract.evaluationPlans[0]!.requiredRuntimeChanges[0] as {
      assertion: { expected: { value: number[] } }
    }
  ).assertion.expected.value
  oversizedRuntimeList.push(0)
  assert.equal(parseSemanticChangeContractV1(oversizedChangeContract).ok, false)

  const key = new TextEncoder().encode('phase-8-group-a-hmac-key')
  const message = new TextEncoder().encode('semantic-resource-claims')
  const handle = hmacSha256Bytes(
    key,
    new Uint8Array([
      ...new TextEncoder().encode('scratch-edit-handle-v1'),
      0,
      ...message,
    ])
  )
  const resource = hmacSha256Bytes(
    key,
    new Uint8Array([
      ...new TextEncoder().encode('scratch-edit-resource-capability-v1'),
      0,
      ...message,
    ])
  )
  const cursor = hmacSha256Bytes(
    key,
    new Uint8Array([
      ...new TextEncoder().encode('scratch-edit-cursor-v1'),
      0,
      ...message,
    ])
  )
  assert.equal(handle.byteLength, 32)
  assert.equal(timingSafeBytesEqual(handle, handle), true)
  assert.equal(timingSafeBytesEqual(handle, resource), false)
  assert.equal(timingSafeBytesEqual(handle, cursor), false)
  assert.equal(timingSafeBytesEqual(resource, cursor), false)
})

test('Group A preflight extraction & host-only provenance preserve behavior', async () =>
{
  const validBytes = await buildClicker().toSb3()
  const inspected = await inspectExtractedArtifact(validBytes)
  assert.equal(inspected.ok, true)
  assert.ok(inspected.project)
  assert.ok(inspected.diagnosticBaseline)
  const candidate = await preflightExtractedArtifact(
    validBytes,
    inspected.diagnosticBaseline,
    DEFAULT_DIAGNOSTIC_REGRESSION_OPTIONS
  )
  assert.equal(candidate.ok, true)
  assert.deepEqual(candidate.diagnosticChanges, {
    newGraph: [],
    newStatic: [],
    allowedGraph: [],
    allowedStatic: [],
    rejectedGraph: [],
    rejectedStatic: [],
  })
  const invalid = await inspectExtractedArtifact(new Uint8Array([1, 2, 3]))
  assert.equal(invalid.ok, false)
  assert.equal(invalid.schema[0]?.category, 'artifact-load-failed')
  assert.deepEqual(
    defineRegisteredTemplateHostProvenanceV1({
      registryEntryId: 'template-registry-entry-1',
      templateId: 'blank-stage',
      templateVersion: 1,
      templateArtifactSha256: '0'.repeat(64),
    }),
    {
      kind: 'registeredTemplate',
      registryEntryId: 'template-registry-entry-1',
      templateId: 'blank-stage',
      templateVersion: 1,
      templateArtifactSha256: '0'.repeat(64),
    }
  )

  const root = mkdtempSync(join(tmpdir(), 'phase-8-provenance-'))
  try
  {
    const inputRoot = join(root, 'input')
    const outputRoot = join(root, 'output')
    const artifactRoot = join(root, 'artifacts')
    mkdirSync(inputRoot)
    mkdirSync(outputRoot)
    mkdirSync(artifactRoot)
    const inputPath = join(inputRoot, 'source.sb3')
    writeFileSync(inputPath, validBytes)
    const paths = configureRepairMcpPaths({
      inputRoot,
      outputRoot,
      artifactRoot,
    })
    const selected = readSelectedInput(paths, inputPath)
    assert.equal(selected.provenance.kind, 'projectSession')
    assert.equal(selected.provenance.selectedPath, inputPath)
    assert.equal(selected.provenance.canonicalPath, realpathSync(inputPath))
    assert.match(selected.provenance.device, /^\d+$/u)
    assert.match(selected.provenance.inode, /^\d+$/u)
    assert.match(selected.provenance.modifiedAtNanoseconds, /^\d+$/u)
    assert.equal(selected.provenance.byteLength, validBytes.byteLength)
    assert.equal(selected.provenance.sha256, sha256(validBytes))
    assert.deepEqual(
      recheckSelectedInputProvenanceV1(paths, selected.provenance),
      {
        ok: true,
        provenance: selected.provenance,
      }
    )

    writeFileSync(inputPath, new Uint8Array([...validBytes, 0]))
    const changed = recheckSelectedInputProvenanceV1(paths, selected.provenance)
    assert.equal(changed.ok, false)
    if (!changed.ok)
    {
      assert.equal(changed.reason, 'changed')
      assert.notEqual(changed.provenance?.sha256, selected.provenance.sha256)
    }
    rmSync(inputPath)
    assert.deepEqual(
      recheckSelectedInputProvenanceV1(paths, selected.provenance),
      { ok: false, reason: 'missing', provenance: null }
    )
  }
  finally
  {
    rmSync(root, { recursive: true, force: true })
  }
})

test('Group A semantic index, allocator, delta, authorization, & diagnostics compose', () =>
{
  const project = buildClicker()
  const json = project.toProjectJson()
  const stage = json.targets[0]!

  stage.variables = createScratchRecord<VariableEntry>(
    Object.entries(stage.variables)
  )
  defineScratchRecordValue<VariableEntry>(stage.variables, '__proto__', [
    'prototype variable',
    0,
  ])
  defineScratchRecordValue<VariableEntry>(
    stage.variables,
    'monitor-global-variable',
    ['global score', 0]
  )
  stage.lists = createScratchRecord<ListEntry>(
    Object.entries(stage.lists ?? {})
  )
  defineScratchRecordValue<ListEntry>(stage.lists, 'constructor', [
    'constructor list',
    [],
  ])
  defineScratchRecordValue<ListEntry>(stage.lists, 'monitor-global-list', [
    'global items',
    [],
  ])
  stage.broadcasts = createScratchRecord<string>(
    Object.entries(stage.broadcasts ?? {})
  )
  defineScratchRecordValue(stage.broadcasts, 'toString', 'hostile broadcast')
  defineScratchRecordValue(stage.broadcasts, 'ba', 'Alpha')
  defineScratchRecordValue(stage.broadcasts, 'bb', 'Beta')
  stage.comments = createScratchRecord<Comment>(
    Object.entries(stage.comments ?? {})
  )
  defineScratchRecordValue(stage.comments, '__proto__', {
    text: 'hostile comment',
  })
  stage.blocks = createScratchRecord<BlockEntry>(Object.entries(stage.blocks))
  const hostileInputs = createScratchRecord<BlockInput>()
  defineScratchRecordValue(hostileInputs, '__proto__', [1, [10, 'value']])
  defineScratchRecordValue<BlockEntry>(stage.blocks, 'constructor', {
    opcode: 'procedures_call',
    inputs: hostileInputs,
    fields: createScratchRecord<BlockField>(),
    mutation: {
      tagName: 'mutation',
      children: [],
      proccode: 'hostile %s',
      argumentids: '["__proto__"]',
    },
  })
  Object.defineProperty(json, 'protectedId', {
    configurable: true,
    enumerable: true,
    value: 'b-0',
    writable: true,
  })
  Object.defineProperty(json, 'b-3', {
    configurable: true,
    enumerable: true,
    value: true,
    writable: true,
  })
  defineScratchRecordValue<BlockEntry>(stage.blocks, 'b-1', {
    opcode: 'motion_movesteps',
    next: 'b-2',
    inputs: createScratchRecord<BlockInput>(),
    fields: createScratchRecord<BlockField>(),
  })
  defineScratchRecordValue<BlockEntry>(stage.blocks, 'inherited-next', {
    opcode: 'motion_movesteps',
    next: '__proto__',
    inputs: createScratchRecord<BlockInput>(),
    fields: createScratchRecord<BlockField>(),
  })
  defineScratchRecordValue<BlockEntry>(stage.blocks, 'broadcast-fallback', {
    opcode: 'event_whenbroadcastreceived',
    inputs: createScratchRecord<BlockInput>(),
    fields: createScratchRecord<BlockField>([
      ['BROADCAST_OPTION', ['Beta', 'ba']],
    ]),
  })
  Object.defineProperty(stage.blocks, 'accessor-block', {
    configurable: true,
    enumerable: true,
    get: () =>
    {
      throw new Error('accessor block must never be read')
    },
  })

  const sprite = json.targets[1]!
  sprite.costumes = [
    { assetId: 'costume-a', name: 'one', dataFormat: 'png' },
    { assetId: 'costume-b', name: 'two', dataFormat: 'png' },
  ]
  sprite.sounds = [
    { assetId: 'sound-a', name: 'first', dataFormat: 'wav' },
    { assetId: 'sound-b', name: 'second', dataFormat: 'wav' },
  ]
  sprite.blocks = createScratchRecord<BlockEntry>(Object.entries(sprite.blocks))
  defineScratchRecordValue<BlockEntry>(sprite.blocks, 'variable-fallback', {
    opcode: 'data_setvariableto',
    inputs: createScratchRecord<BlockInput>(),
    fields: createScratchRecord<BlockField>([
      ['VARIABLE', ['prototype variable', 'ghost-variable']],
    ]),
  })
  for (const [blockId, entry] of [
    [
      'costume-ordinal',
      {
        opcode: 'looks_switchcostumeto',
        inputs: createScratchRecord<BlockInput>([['COSTUME', [1, [10, '2']]]]),
        fields: createScratchRecord<BlockField>(),
      },
    ],
    [
      'sound-ordinal',
      {
        opcode: 'sound_play',
        inputs: createScratchRecord<BlockInput>([
          ['SOUND_MENU', [1, [10, '1foo']]],
        ]),
        fields: createScratchRecord<BlockField>(),
      },
    ],
    [
      'next-costume',
      {
        opcode: 'looks_nextcostume',
        inputs: createScratchRecord<BlockInput>(),
        fields: createScratchRecord<BlockField>(),
      },
    ],
    [
      'next-backdrop',
      {
        opcode: 'looks_nextbackdrop',
        inputs: createScratchRecord<BlockInput>(),
        fields: createScratchRecord<BlockField>(),
      },
    ],
  ] as const)
    defineScratchRecordValue<BlockEntry>(sprite.blocks, blockId, entry)
  defineScratchRecordValue<BlockEntry>(sprite.blocks, 'edge-menu', {
    opcode: 'motion_goto_menu',
    inputs: createScratchRecord<BlockInput>(),
    fields: createScratchRecord<BlockField>([['TO', ['edge', null]]]),
    parent: null,
    next: null,
    shadow: true,
    topLevel: false,
  })
  defineScratchRecordValue<BlockEntry>(sprite.blocks, 'stage-name-menu', {
    opcode: 'motion_goto_menu',
    inputs: createScratchRecord<BlockInput>(),
    fields: createScratchRecord<BlockField>([['TO', [stage.name, null]]]),
    parent: null,
    next: null,
    shadow: true,
    topLevel: false,
  })
  defineScratchRecordValue<BlockEntry>(sprite.blocks, 'dynamic-target', {
    opcode: 'motion_goto',
    inputs: createScratchRecord<BlockInput>([
      ['TO', [2, 'dynamic-target-reporter']],
    ]),
    fields: createScratchRecord<BlockField>(),
    parent: null,
    next: null,
    shadow: false,
    topLevel: true,
    x: 0,
    y: 0,
  })
  defineScratchRecordValue<BlockEntry>(
    sprite.blocks,
    'dynamic-target-reporter',
    {
      opcode: 'operator_join',
      inputs: createScratchRecord<BlockInput>([
        ['STRING1', [1, [10, '']]],
        ['STRING2', [1, [10, '']]],
      ]),
      fields: createScratchRecord<BlockField>(),
      parent: 'dynamic-target',
      next: null,
      shadow: false,
      topLevel: false,
    }
  )
  json.monitors = [
    {
      id: 'monitor-global-variable',
      mode: 'default',
      opcode: 'data_variable',
      params: { VARIABLE: 'stale global score' },
      spriteName: sprite.name,
      value: 0,
    },
    {
      id: 'monitor-global-list',
      mode: 'list',
      opcode: 'data_listcontents',
      params: { LIST: 'global items' },
      spriteName: sprite.name,
      value: [],
    },
    {
      id: 'missing-monitor-list-id',
      mode: 'list',
      opcode: 'data_listcontents',
      params: { LIST: 'global items' },
      spriteName: sprite.name,
      value: [],
    },
  ]

  const index = buildSemanticReferenceIndex(project)
  assert.equal(index.blocksById.get('constructor')?.length, 1)
  assert.equal(
    index.variables.some((entry) => entry.declaration.id === '__proto__'),
    true
  )
  assert.equal(
    index.lists.some((entry) => entry.declaration.id === 'constructor'),
    true
  )
  assert.equal(
    index.broadcasts.some((entry) => entry.declaration.id === 'toString'),
    true
  )
  assert.equal(
    index.comments.some((entry) => entry.ref.commentId === '__proto__'),
    true
  )
  assert.equal(
    index.variables
      .find((entry) => entry.declaration.id === '__proto__')
      ?.references.some(
        (reference) =>
          reference.referencedId === 'ghost-variable' &&
          reference.resolutionSource === 'stage-name'
      ),
    true
  )
  const mismatchedBroadcast = index.broadcasts
    .find((entry) => entry.declaration.id === 'bb')
    ?.receivers.find(
      (reference) => reference.block.blockId === 'broadcast-fallback'
    )
  assert.equal(mismatchedBroadcast?.resolutionSource, 'name')
  assert.equal(mismatchedBroadcast?.idCandidateDeclaration?.id, 'ba')
  assert.equal(mismatchedBroadcast?.idNameMismatch, true)
  assert.equal(
    index.mediaOrderReferences.some(
      (reference) =>
        reference.block.blockId === 'costume-ordinal' &&
        reference.selectorKind === 'ordinal' &&
        reference.media?.name === 'two'
    ),
    true
  )
  assert.equal(
    index.mediaOrderReferences.some(
      (reference) =>
        reference.block.blockId === 'sound-ordinal' &&
        reference.selectorKind === 'ordinal' &&
        reference.media?.name === 'first'
    ),
    true
  )
  for (const blockId of ['next-costume', 'next-backdrop'])
  {
    assert.equal(
      index.mediaOrderReferences.some(
        (reference) =>
          reference.block.blockId === blockId &&
          reference.selectorKind === 'next' &&
          reference.inputName === null
      ),
      true,
      blockId
    )
  }
  const edgeReference = index.spriteReferences.find(
    (reference) => reference.block.blockId === 'edge-menu'
  )
  assert.equal(edgeReference?.name, 'edge')
  assert.equal(edgeReference?.targetStatus, 'unresolved')
  assert.equal(edgeReference?.special, false)
  const stageNameReference = index.spriteReferences.find(
    (reference) => reference.block.blockId === 'stage-name-menu'
  )
  assert.equal(stageNameReference?.targetStatus, 'unresolved')
  assert.deepEqual(stageNameReference?.targets, [])
  const globalVariableMonitor = index.monitors.find(
    (monitor) => monitor.ref.monitorId === 'monitor-global-variable'
  )
  assert.equal(globalVariableMonitor?.targetStatus, 'unique')
  assert.equal(
    globalVariableMonitor?.declaration?.id,
    'monitor-global-variable'
  )
  assert.equal(
    globalVariableMonitor?.declaration?.declarationTarget.isStage,
    true
  )
  assert.equal(globalVariableMonitor?.resolutionSource, 'stage-id')
  assert.equal(globalVariableMonitor?.referencedName, 'stale global score')
  assert.equal(globalVariableMonitor?.displayNameMismatch, true)
  const globalListMonitor = index.monitors.find(
    (monitor) => monitor.ref.monitorId === 'monitor-global-list'
  )
  assert.equal(globalListMonitor?.declaration?.id, 'monitor-global-list')
  assert.equal(globalListMonitor?.declaration?.declarationTarget.isStage, true)
  assert.equal(globalListMonitor?.resolutionSource, 'stage-id')
  assert.equal(globalListMonitor?.displayNameMismatch, false)
  const listNameFallbackMonitor = index.monitors.find(
    (monitor) => monitor.ref.monitorId === 'missing-monitor-list-id'
  )
  assert.equal(listNameFallbackMonitor?.declaration?.id, 'monitor-global-list')
  assert.equal(
    listNameFallbackMonitor?.declaration?.declarationTarget.isStage,
    true
  )
  assert.equal(listNameFallbackMonitor?.resolutionSource, 'stage-name')
  assert.equal(listNameFallbackMonitor?.displayNameMismatch, false)
  assert.deepEqual(
    index.dynamicSpriteReferences.find(
      (reference) => reference.block.blockId === 'dynamic-target'
    ),
    {
      kind: 'go-to',
      reason: 'reporter-computed',
      block: {
        target: index.targets[1],
        blockId: 'dynamic-target',
      },
      sourceBlock: {
        target: index.targets[1],
        blockId: 'dynamic-target-reporter',
      },
      script: {
        target: index.targets[1],
        topBlockId: 'dynamic-target',
      },
      inputName: 'TO',
    }
  )
  assert.equal(
    [...index.inboundReferencesByEntityKey.values()]
      .flat()
      .filter(
        (reference) =>
          reference.kind === 'dynamic-sprite-reference' &&
          reference.sourceEntityKey.includes('dynamic-target')
      ).length,
    index.targets.filter((target) => !target.isStage).length
  )
  assert.equal(
    validateProject(project).diagnostics.some(
      (diagnostic) =>
        diagnostic.code === 'dangling-next' &&
        diagnostic.location?.block === 'inherited-next'
    ),
    true
  )

  const limits = resolveEditAdmissionLimits()
  const procedures = parseKnownProcedureMutations(json, limits)
  assert.equal(
    procedures.records.some(
      (record) =>
        record.role === 'call' && record.argumentIds[0] === '__proto__'
    ),
    true
  )

  const collisionUniverse = collectEditUidCollisionUniverse(json)
  for (const expected of ['__proto__', 'b-0', 'b-1', 'b-2', 'b-3'])
  {
    assert.equal(collisionUniverse.includes(expected), true, expected)
  }

  const longJson = buildClicker().toProjectJson()
  const longTarget = longJson.targets[1]!
  longTarget.blocks = createScratchRecord<BlockEntry>()
  for (let index = 0; index < 12_000; index++)
  {
    const blockId = `long-${index}`
    defineScratchRecordValue<BlockEntry>(longTarget.blocks, blockId, {
      opcode: 'looks_say',
      next: index === 11_999 ? null : `long-${index + 1}`,
      parent: index === 0 ? null : `long-${index - 1}`,
      inputs: createScratchRecord<BlockInput>([['MESSAGE', [1, [10, 'x']]]]),
      fields: createScratchRecord<BlockField>(),
      shadow: false,
      topLevel: index === 0,
      ...(index === 0 ? { x: 0, y: 0 } : {}),
    })
  }
  const longIndex = buildSemanticReferenceIndex({ json: longJson })
  const longScript = longIndex.scripts.find(
    (script) => script.ref.topBlockId === 'long-0'
  )
  assert.equal(longScript?.blockRefs.length, 12_000)
  assert.equal(longScript?.blockRefs.at(-1)?.blockId, 'long-11999')

  const convergedJson = buildClicker().toProjectJson()
  const convergedTarget = convergedJson.targets[1]!
  convergedTarget.blocks = createScratchRecord<BlockEntry>()
  for (let index = 0; index < 64; index++)
  {
    defineScratchRecordValue<BlockEntry>(
      convergedTarget.blocks,
      `root-${index}`,
      {
        opcode: 'looks_say',
        next: 'shared-0',
        parent: null,
        inputs: createScratchRecord<BlockInput>([
          ['MESSAGE', [1, [10, 'root']]],
        ]),
        fields: createScratchRecord<BlockField>(),
        shadow: false,
        topLevel: true,
        x: index,
        y: 0,
      }
    )
  }
  for (let index = 0; index < 256; index++)
  {
    defineScratchRecordValue<BlockEntry>(
      convergedTarget.blocks,
      `shared-${index}`,
      {
        opcode: 'looks_say',
        next: index === 255 ? null : `shared-${index + 1}`,
        parent: index === 0 ? 'root-0' : `shared-${index - 1}`,
        inputs: createScratchRecord<BlockInput>([
          ['MESSAGE', [1, [10, 'shared']]],
        ]),
        fields: createScratchRecord<BlockField>(),
        shadow: false,
        topLevel: false,
      }
    )
  }
  const convergedIndex = buildSemanticReferenceIndex({ json: convergedJson })
  assert.equal(
    convergedIndex.scripts.reduce(
      (total, script) => total + script.blockRefs.length,
      0
    ),
    383
  )
  const convergence = convergedIndex.blocksById.get('shared-0')?.[0]
  assert.equal(convergence?.ownershipStatus, 'ambiguous')
  assert.deepEqual(
    convergence?.topScripts.map((script) => script.topBlockId),
    ['root-0', 'root-1']
  )
  assert.equal(
    convergedIndex.blocksById.get('shared-1')?.[0]?.ownershipStatus,
    'unique'
  )
  const allocator = createEditUids(json)
  const firstFreshId = allocator.next('b')
  assert.equal(collisionUniverse.includes(firstFreshId), false)
  assert.equal(createEditUids(json).next('b'), firstFreshId)
  assert.deepEqual(allocator.acceptReservations(), [firstFreshId])
  const previewAllocator = allocator.clone()
  const previewId = previewAllocator.next('b')
  assert.equal(allocator.has(previewId), false)
  assert.deepEqual(allocator.commit(previewAllocator), [previewId])
  assert.equal(allocator.isTombstoned(previewId), true)
  const restored = allocator.clone()
  restored.restoreMonotonic(allocator.snapshot())
  assert.notEqual(restored.next('b'), previewId)
  const baseAllocator = new Uids(['b-0'])
  const forgedCandidate = Uids.fromSnapshot({
    version: 'scratch-uids-v2',
    counter: 0,
    usedIds: ['b-0'],
    generatedReservationIds: ['b-0'],
    pendingReservationIds: ['b-0'],
    tombstonedIds: [],
  })
  assert.throws(
    () => baseAllocator.commit(forgedCandidate),
    /reclassifies a preexisting ID/u
  )
  assert.throws(
    () => baseAllocator.restoreMonotonic(forgedCandidate.snapshot()),
    /reclassifies a preexisting ID as generated/u
  )
  const reservedCandidate = baseAllocator.clone()
  reservedCandidate.reserve('forged-id')
  assert.throws(
    () => baseAllocator.commit(reservedCandidate),
    /untracked reservation/u
  )

  const inheritedLineageRecord = Object.assign(
    Object.create({ kind: 'target' }) as Record<string, unknown>,
    {
      lineageId: 'inherited-kind',
      ownerLineageId: null,
      status: 'active',
      rawIdentity: 'target:inherited',
      canonicalOrdinal: 0,
    }
  )
  assert.throws(
    () =>
      validateSemanticLineageSnapshot({
        version: 'semantic-lineage-v1',
        records: [inheritedLineageRecord],
      } as never),
    /invalid semantic lineage record/u
  )
  let lineageAccessorReads = 0
  const accessorLineageRecord = {
    lineageId: 'accessor-kind',
    ownerLineageId: null,
    status: 'active',
    rawIdentity: 'target:accessor',
    canonicalOrdinal: 0,
  }
  Object.defineProperty(accessorLineageRecord, 'kind', {
    enumerable: true,
    get: () =>
    {
      lineageAccessorReads += 1
      return 'target'
    },
  })
  assert.throws(
    () =>
      validateSemanticLineageSnapshot({
        version: 'semantic-lineage-v1',
        records: [accessorLineageRecord],
      } as never),
    /invalid semantic lineage record/u
  )
  assert.equal(lineageAccessorReads, 0)

  assert.throws(
    () =>
      validateSemanticLineageSnapshot({
        version: 'semantic-lineage-v1',
        records: [
          {
            lineageId: 'bad-lineage',
            kind: 'bogus',
            ownerLineageId: null,
            status: 'bogus',
            rawIdentity: 'raw',
            canonicalOrdinal: 0,
          },
        ],
      } as never),
    /invalid semantic lineage record/u
  )
  const mutableLineageRecord = {
    lineageId: 'target-lineage',
    kind: 'target' as const,
    ownerLineageId: null,
    status: 'active' as const,
    rawIdentity: 'target:0',
    canonicalOrdinal: 0,
  }
  const validatedLineage = validateSemanticLineageSnapshot({
    version: 'semantic-lineage-v1',
    records: [mutableLineageRecord],
  })
  mutableLineageRecord.rawIdentity = 'mutated-after-validation'
  assert.equal(validatedLineage.records[0]?.rawIdentity, 'target:0')
  assert.equal(Object.isFrozen(validatedLineage), true)
  assert.equal(Object.isFrozen(validatedLineage.records), true)
  assert.equal(Object.isFrozen(validatedLineage.records[0]), true)

  const before = buildClicker()
  const beforeJson = before.toProjectJson()
  const after = ProjectIR.fromProjectJson(
    {
      ...beforeJson,
      targets: [beforeJson.targets[1]!, beforeJson.targets[0]!],
    },
    before.assets
  )
  const semanticSourceSha256 = 'a'.repeat(64)
  const correspondence = {
    beforeRevisionIdentity: 'before-revision',
    afterRevisionIdentity: 'after-revision',
    beforeSemanticSourceSha256: semanticSourceSha256,
    afterSemanticSourceSha256: semanticSourceSha256,
    targets: {
      collectionKind: 'targets' as const,
      collectionPath: '/targets',
      beforeCollectionPath: '/targets',
      afterCollectionPath: '/targets',
      ownerLineageId: null,
      targetOwnerLineageId: null,
      containerLineageId: null,
      beforeLineageIds: ['stage-lineage', 'sprite-lineage'],
      afterLineageIds: ['sprite-lineage', 'stage-lineage'],
      members: [
        {
          lineageId: 'stage-lineage',
          beforeIndex: 0,
          afterIndex: 1,
        },
        {
          lineageId: 'sprite-lineage',
          beforeIndex: 1,
          afterIndex: 0,
        },
      ],
    },
  } satisfies ProjectOrderedCorrespondence
  const beforeLineageSnapshot = {
    version: 'semantic-lineage-v1',
    records: [
      {
        lineageId: 'stage-lineage',
        kind: 'target',
        ownerLineageId: null,
        status: 'active',
        rawIdentity: 'stage-head-identity',
        canonicalOrdinal: 0,
      },
      {
        lineageId: 'sprite-lineage',
        kind: 'target',
        ownerLineageId: null,
        status: 'active',
        rawIdentity: 'sprite-head-identity',
        canonicalOrdinal: 1,
      },
    ],
  } satisfies SemanticLineageSnapshot
  const afterLineageSnapshot = {
    version: 'semantic-lineage-v1',
    records: [
      {
        lineageId: 'stage-lineage',
        kind: 'target',
        ownerLineageId: null,
        status: 'active',
        rawIdentity: 'stage-head-identity',
        canonicalOrdinal: 1,
      },
      {
        lineageId: 'sprite-lineage',
        kind: 'target',
        ownerLineageId: null,
        status: 'active',
        rawIdentity: 'sprite-head-identity',
        canonicalOrdinal: 0,
      },
    ],
  } satisfies SemanticLineageSnapshot
  const correspondenceEvidence = {
    before: captureProjectOrderedHeadEvidence(
      before,
      correspondence,
      'before',
      {
        revisionIdentity: correspondence.beforeRevisionIdentity,
        semanticSourceSha256,
        lineageSnapshot: beforeLineageSnapshot,
      }
    ),
    after: captureProjectOrderedHeadEvidence(after, correspondence, 'after', {
      revisionIdentity: correspondence.afterRevisionIdentity,
      semanticSourceSha256,
      lineageSnapshot: afterLineageSnapshot,
    }),
  }
  const targetOrderAttribution = [
    {
      operationId: 'move-targets',
      projectPaths: [
        '/serializedTargetOrder',
        '/visualTargetOrder',
        '/runtimeExecutableTargetOrder',
      ],
      pathPrefixes: ['/targets'],
    },
  ]
  const delta = computeProjectDelta(before, after, targetOrderAttribution, {
    correspondence,
    correspondenceEvidence,
  })
  assert.deepEqual(
    delta.orderedCollectionChanges?.map((change) => [
      change.lineageId,
      change.kind,
      change.operationIds,
    ]),
    [
      ['stage-lineage', 'moved', ['move-targets']],
      ['sprite-lineage', 'moved', ['move-targets']],
    ]
  )
  assert.equal(delta.summary.touchedTargets, 2)
  assert.throws(
    () =>
      computeProjectDelta(before, after, targetOrderAttribution, {
        correspondence,
        correspondenceEvidence: {
          before: correspondenceEvidence.after,
          after: correspondenceEvidence.before,
        },
      }),
    /wrong revision or semantic source identity/u
  )
  const forgedCorrespondence = {
    ...correspondence,
    targets: {
      ...correspondence.targets,
      beforeLineageIds: ['sprite-lineage', 'stage-lineage'],
      members: [
        {
          lineageId: 'sprite-lineage',
          beforeIndex: 0,
          afterIndex: 0,
        },
        {
          lineageId: 'stage-lineage',
          beforeIndex: 1,
          afterIndex: 1,
        },
      ],
    },
  } satisfies ProjectOrderedCorrespondence
  assert.throws(
    () =>
      computeProjectDelta(before, after, [], {
        correspondence: forgedCorrespondence,
        correspondenceEvidence,
      }),
    /correspondence|membership differs from lineage head/u
  )
  assert.equal(authorizeEditDelta(delta, []).authorized, false)
  assert.equal(
    authorizeEditDelta(delta, [
      {
        operationId: 'move-targets',
        exactPaths: [
          '/serializedTargetOrder',
          '/visualTargetOrder',
          '/runtimeExecutableTargetOrder',
        ],
        pathPrefixes: ['/targets'],
        changeKinds: ['changed'],
        protectedClasses: ['project-structure'],
        entityLineageIds: ['stage-lineage', 'sprite-lineage'],
        allowMandatoryProtectedChange: false,
      },
    ]).authorized,
    true
  )
  const inheritedAuthorization = Object.assign(
    Object.create({
      exactPaths: [],
      pathPrefixes: ['/targets'],
      changeKinds: ['changed'],
      protectedClasses: ['project-structure'],
      entityLineageIds: ['stage-lineage', 'sprite-lineage'],
    }) as Record<string, unknown>,
    {
      operationId: 'move-targets',
      allowMandatoryProtectedChange: false,
    }
  )
  assert.equal(
    authorizeEditDelta(delta, [inheritedAuthorization as never]).authorized,
    false
  )
  const aggregateDelta = {
    ...delta,
    projectChanges: [
      ...delta.projectChanges,
      {
        class: 'metadata',
        change: {
          path: '/aggregate',
          kind: 'changed',
          before: 0,
          after: 1,
          operationIds: ['split-a', 'split-b'],
          entityLineageIds: ['stage-lineage', 'sprite-lineage'],
        },
      },
    ],
  } satisfies ProjectDelta
  const splitAuthorization = authorizeEditDelta(aggregateDelta, [
    {
      operationId: 'move-targets',
      exactPaths: [],
      pathPrefixes: ['/targets'],
      changeKinds: ['changed'],
      protectedClasses: ['project-structure'],
      entityLineageIds: ['stage-lineage', 'sprite-lineage'],
      allowMandatoryProtectedChange: false,
    },
    {
      operationId: 'split-a',
      exactPaths: ['/aggregate'],
      pathPrefixes: [],
      changeKinds: ['changed'],
      protectedClasses: [],
      entityLineageIds: ['stage-lineage'],
      allowMandatoryProtectedChange: false,
    },
    {
      operationId: 'split-b',
      exactPaths: ['/aggregate'],
      pathPrefixes: [],
      changeKinds: ['changed'],
      protectedClasses: [],
      entityLineageIds: ['sprite-lineage'],
      allowMandatoryProtectedChange: false,
    },
  ])
  assert.equal(splitAuthorization.authorized, false)
  assert.equal(
    splitAuthorization.violations.some(
      (violation) => violation.code === 'unauthorized-entity'
    ),
    true
  )

  const diagnostic = {
    code: 'hostile-block',
    severity: 'warning' as const,
    message: 'first wording',
    location: { target: 'Stage', block: 'constructor' },
  }
  const lineage = {
    revisionIdentity: 'revision-one',
    blockByOwnerAndId: new Map([['0\u0000constructor', 'block-lineage']]),
  }
  const normalized = normalizeEditDiagnosticV1(
    project,
    'graph',
    diagnostic,
    lineage
  )
  const reworded = normalizeEditDiagnosticV1(
    project,
    'graph',
    { ...diagnostic, message: 'different raw evidence wording' },
    lineage
  )
  assert.equal(normalized.fingerprint, reworded.fingerprint)
  assert.notEqual(normalized.raw.message, reworded.raw.message)
  assert.equal(
    compareEditDiagnosticsV1([normalized], [reworded]).retained.length,
    1
  )
  const unmapped = normalizeEditDiagnosticV1(project, 'graph', diagnostic, {
    revisionIdentity: 'revision-two',
  })
  assert.notEqual(normalized.fingerprint, unmapped.fingerprint)
})

test('Group A strict source admission and media fail closed before indexing', async () =>
{
  assert.equal(
    isEditSb3Admission(Object.create({ [EDIT_SB3_ADMISSION_BRAND]: true })),
    false
  )
  let admissionBrandAccessorReads = 0
  const accessorAdmissionBrand = {}
  Object.defineProperty(accessorAdmissionBrand, EDIT_SB3_ADMISSION_BRAND, {
    enumerable: true,
    get: () =>
    {
      admissionBrandAccessorReads += 1
      return true
    },
  })
  assert.equal(isEditSb3Admission(accessorAdmissionBrand), false)
  assert.equal(admissionBrandAccessorReads, 0)

  const strictLimits = {
    maxDepth: 8,
    maxMembersPerContainer: 8,
    maxNodes: 32,
  }
  for (const input of [
    '{"a":1,"a":2}',
    '{"a":1,"\\u0061":2}',
    '{"😀":1,"\\ud83d\\ude00":2}',
    '{"n":-0}',
    '{"n":9007199254740992}',
    '{"n":9007199254740991.5}',
    '{"n":1e400}',
  ])
  {
    assert.throws(
      () => scanStrictJson(input, strictLimits),
      StrictJsonScanError,
      input
    )
  }
  assert.throws(
    () => scanStrictJson(new Uint8Array([0xff]), strictLimits),
    StrictJsonScanError
  )
  assert.throws(
    () =>
      scanStrictJson('[[[]]]', {
        ...strictLimits,
        maxDepth: 2,
      }),
    StrictJsonScanError
  )
  assert.throws(
    () =>
      scanStrictJson('[0,1]', {
        ...strictLimits,
        maxMembersPerContainer: 1,
      }),
    StrictJsonScanError
  )
  assert.throws(
    () => scanStrictJson('[0]', { ...strictLimits, maxNodes: 1 }),
    StrictJsonScanError
  )
  assert.deepEqual(parseMutationArray('[1,true,"x"]'), ['1', 'true', 'x'])
  assert.throws(() =>
    parseStrictEditMutationArray('[1,true,"x"]', 'argumentids', {
      maximumArrayBytes: 128,
      maximumItems: 3,
    })
  )
  assert.deepEqual(procedurePlaceholderKinds('%s and %b then %n'), [
    's',
    'b',
    'n',
  ])

  const duplicateRoot = await packSb3(
    '{"targets":[],"targets":[],"meta":{"semver":"3.0.0"}}',
    []
  )
  const stageEvents: string[] = []
  const refused = await inspectSemanticEditArtifact(duplicateRoot, {
    onStage: (event) => stageEvents.push(`${event.stage}:${event.status}`),
  })
  assert.equal(refused.ok, false)
  assert.equal(refused.refusal?.stage, 'raw-json')
  assert.equal(
    stageEvents.some((event) => event.startsWith('procedure-mutations:')),
    false
  )
  assert.equal(
    stageEvents.some((event) => event.startsWith('reference-index:')),
    false
  )

  const validBytes = await buildClicker().toSb3()
  await assert.rejects(
    admitSb3ForEdit(validBytes, {
      limits: { maxProjectJsonBytes: 10 * 1024 * 1024 + 1 },
    }),
    (error: unknown) =>
      error instanceof RangeError &&
      error.message.includes('maxProjectJsonBytes')
  )
  await assert.rejects(
    admitSb3ForEdit(validBytes, { editLimits: { maxTargets: 1 } }),
    (error: unknown) =>
      error instanceof Error && error.message.includes('targets')
  )
  const admitted = await inspectSemanticEditArtifact(validBytes)
  assert.equal(admitted.ok, true)
  assert.equal(admitted.completedStages.at(-1), 'complete')
  assert.equal(
    admitted.referenceIndex?.blocks.some(
      (block) => block.ownershipStatus === 'ambiguous'
    ),
    false
  )
  assert.match(admitted.semanticSourceSha256 ?? '', /^[0-9a-f]{64}$/u)
  assert.equal(
    admitted.semanticSourceIdentity?.sourceArtifactSha256,
    sha256(validBytes)
  )

  const sharedOwnershipSource = buildClicker()
  const sharedOwnershipTarget = sharedOwnershipSource.json.targets[1]!
  sharedOwnershipTarget.blocks = createScratchRecord<BlockEntry>()
  for (let index = 0; index < 16; index++)
  {
    defineScratchRecordValue<BlockEntry>(
      sharedOwnershipTarget.blocks,
      `root-${index}`,
      {
        opcode: 'looks_say',
        next: 'shared-0',
        parent: null,
        inputs: createScratchRecord<BlockInput>([
          ['MESSAGE', [1, [10, 'root']]],
        ]),
        fields: createScratchRecord<BlockField>(),
        shadow: false,
        topLevel: true,
        x: index,
        y: 0,
      }
    )
  }
  for (let index = 0; index < 64; index++)
  {
    defineScratchRecordValue<BlockEntry>(
      sharedOwnershipTarget.blocks,
      `shared-${index}`,
      {
        opcode: 'looks_say',
        next: index === 63 ? null : `shared-${index + 1}`,
        parent: index === 0 ? 'root-0' : `shared-${index - 1}`,
        inputs: createScratchRecord<BlockInput>([
          ['MESSAGE', [1, [10, 'shared']]],
        ]),
        fields: createScratchRecord<BlockField>(),
        shadow: false,
        topLevel: false,
      }
    )
  }
  const sharedOwnership = await inspectSemanticEditArtifact(
    await sharedOwnershipSource.toSb3()
  )
  assert.equal(sharedOwnership.ok, false)
  assert.equal(sharedOwnership.refusal?.stage, 'reference-index')
  assert.equal(sharedOwnership.refusal?.code, 'EDIT_SOURCE_INTEGRITY_INVALID')

  for (const sharedVariant of ['top-level', 'shadow'] as const)
  {
    const sharedVariantSource = buildClicker()
    const sharedVariantTarget = sharedVariantSource.json.targets[1]!
    sharedVariantTarget.blocks = createScratchRecord<BlockEntry>()
    const sharedBlockId = `shared-${sharedVariant}`
    for (const rootId of ['root-a', 'root-b'])
    {
      defineScratchRecordValue<BlockEntry>(sharedVariantTarget.blocks, rootId, {
        opcode: 'looks_say',
        next: sharedVariant === 'top-level' ? sharedBlockId : null,
        parent: null,
        inputs: createScratchRecord<BlockInput>(
          sharedVariant === 'shadow'
            ? [['MESSAGE', [1, sharedBlockId]]]
            : [['MESSAGE', [1, [10, 'root']]]]
        ),
        fields: createScratchRecord<BlockField>(),
        shadow: false,
        topLevel: true,
        x: rootId === 'root-a' ? 0 : 1,
        y: 0,
      })
    }
    defineScratchRecordValue<BlockEntry>(
      sharedVariantTarget.blocks,
      sharedBlockId,
      {
        opcode: sharedVariant === 'shadow' ? 'sensing_answer' : 'looks_say',
        next: null,
        parent: 'root-a',
        inputs: createScratchRecord<BlockInput>(
          sharedVariant === 'shadow' ? [] : [['MESSAGE', [1, [10, 'shared']]]]
        ),
        fields: createScratchRecord<BlockField>(),
        shadow: sharedVariant === 'shadow',
        topLevel: sharedVariant === 'top-level',
        ...(sharedVariant === 'top-level' ? { x: 2, y: 0 } : {}),
      }
    )
    const sharedVariantResult = await inspectSemanticEditArtifact(
      await sharedVariantSource.toSb3()
    )
    assert.equal(sharedVariantResult.ok, false, sharedVariant)
    assert.equal(
      sharedVariantResult.refusal?.stage,
      'reference-index',
      sharedVariant
    )
    assert.equal(
      sharedVariantResult.refusal?.code,
      'EDIT_SOURCE_INTEGRITY_INVALID',
      sharedVariant
    )
  }

  const missingAssetSource = buildClicker()
  const missingAssetEvents: string[] = []
  const missingAsset = await inspectSemanticEditArtifact(
    await packSb3(JSON.stringify(missingAssetSource.toProjectJson()), []),
    {
      onStage: (event) =>
        missingAssetEvents.push(`${event.stage}:${event.status}`),
    }
  )
  assert.equal(missingAsset.ok, false)
  assert.equal(missingAsset.refusal?.stage, 'media')
  assert.equal(
    missingAsset.refusal?.code,
    MEDIA_CLASSIFICATION_CODES.referencedAssetMissing
  )
  assert.equal(
    missingAssetEvents.some((event) => event.startsWith('reference-index:')),
    false
  )

  const corruptedAssetSource = buildClicker()
  const corruptedAssets = corruptedAssetSource.assets.map((asset, index) =>
  {
    if (index !== 0) return asset
    const bytes = asset.bytes.slice()
    bytes[0] = (bytes[0] ?? 0) ^ 1
    return { ...asset, bytes }
  })
  const corruptedAsset = await inspectSemanticEditArtifact(
    await packSb3(
      JSON.stringify(corruptedAssetSource.toProjectJson()),
      corruptedAssets
    )
  )
  assert.equal(corruptedAsset.ok, false)
  assert.equal(corruptedAsset.refusal?.stage, 'media')
  assert.equal(
    corruptedAsset.refusal?.code,
    MEDIA_CLASSIFICATION_CODES.assetDigestMismatch
  )

  const noncanonicalAssetSource = buildClicker()
  const noncanonicalAssetProject = noncanonicalAssetSource.toProjectJson()
  const canonicalAssetPath =
    noncanonicalAssetProject.targets[0]!.costumes[0]!.md5ext!
  const noncanonicalAssetPath = `legacy-${canonicalAssetPath}`
  noncanonicalAssetProject.targets[0]!.costumes[0]!.md5ext =
    noncanonicalAssetPath
  const noncanonicalAsset = await inspectSemanticEditArtifact(
    await packSb3(JSON.stringify(noncanonicalAssetProject), [
      ...noncanonicalAssetSource.assets,
      {
        path: noncanonicalAssetPath,
        bytes: noncanonicalAssetSource.assets[0]!.bytes,
      },
    ])
  )
  assert.equal(noncanonicalAsset.ok, false)
  assert.equal(noncanonicalAsset.refusal?.stage, 'media')
  assert.equal(
    noncanonicalAsset.refusal?.code,
    MEDIA_CLASSIFICATION_CODES.assetMetadataMismatch
  )

  const variableArtifact = async (
    referencedName: string,
    referencedId: string
  ): Promise<Uint8Array> =>
  {
    const source = buildClicker()
    const project = source.toProjectJson()
    const target = project.targets[1]!
    target.blocks = createScratchRecord<BlockEntry>(
      Object.entries(target.blocks)
    )
    defineScratchRecordValue<BlockEntry>(target.blocks, 'source-variable', {
      opcode: 'data_setvariableto',
      next: null,
      parent: null,
      inputs: createScratchRecord<BlockInput>([['VALUE', [1, [10, 'value']]]]),
      fields: createScratchRecord<BlockField>([
        ['VARIABLE', [referencedName, referencedId]],
      ]),
      shadow: false,
      topLevel: true,
      x: 0,
      y: 0,
    })
    return packSb3(JSON.stringify(project), source.assets)
  }
  for (const [name, id] of [
    ['ghost', 'ghost-variable'],
    ['score', 'ghost-variable'],
    ['stale score', 'var-0'],
  ] as const)
  {
    const result = await inspectSemanticEditArtifact(
      await variableArtifact(name, id)
    )
    assert.equal(result.ok, false)
    assert.equal(result.refusal?.stage, 'reference-index')
    assert.equal(result.refusal?.code, 'EDIT_SOURCE_INTEGRITY_INVALID')
    assert.equal(result.completedStages.includes('graph-static'), false)
  }

  const staleBroadcastSource = buildClicker()
  const staleBroadcastProject = staleBroadcastSource.toProjectJson()
  const staleBroadcastStage = staleBroadcastProject.targets[0]!
  const staleBroadcastTarget = staleBroadcastProject.targets[1]!
  staleBroadcastStage.broadcasts = createScratchRecord<string>([
    ['message-id', 'message'],
  ])
  staleBroadcastTarget.blocks = createScratchRecord<BlockEntry>(
    Object.entries(staleBroadcastTarget.blocks)
  )
  defineScratchRecordValue<BlockEntry>(
    staleBroadcastTarget.blocks,
    'stale-broadcast',
    {
      opcode: 'event_whenbroadcastreceived',
      next: null,
      parent: null,
      inputs: createScratchRecord<BlockInput>(),
      fields: createScratchRecord<BlockField>([
        ['BROADCAST_OPTION', ['stale message', 'message-id']],
      ]),
      shadow: false,
      topLevel: true,
      x: 0,
      y: 0,
    }
  )
  const staleBroadcast = await inspectSemanticEditArtifact(
    await packSb3(
      JSON.stringify(staleBroadcastProject),
      staleBroadcastSource.assets
    )
  )
  assert.equal(staleBroadcast.ok, false)
  assert.equal(staleBroadcast.refusal?.stage, 'reference-index')
  assert.equal(staleBroadcast.refusal?.code, 'EDIT_SOURCE_INTEGRITY_INVALID')

  const missingTargetSource = buildClicker()
  const missingTargetProject = missingTargetSource.toProjectJson()
  const missingTargetSprite = missingTargetProject.targets[1]!
  missingTargetSprite.blocks = createScratchRecord<BlockEntry>(
    Object.entries(missingTargetSprite.blocks)
  )
  defineScratchRecordValue<BlockEntry>(
    missingTargetSprite.blocks,
    'missing-target-parent',
    {
      opcode: 'motion_goto',
      next: null,
      parent: null,
      inputs: createScratchRecord<BlockInput>([
        ['TO', [1, 'missing-target-menu']],
      ]),
      fields: createScratchRecord<BlockField>(),
      shadow: false,
      topLevel: true,
      x: 0,
      y: 0,
    }
  )
  defineScratchRecordValue<BlockEntry>(
    missingTargetSprite.blocks,
    'missing-target-menu',
    {
      opcode: 'motion_goto_menu',
      next: null,
      parent: 'missing-target-parent',
      inputs: createScratchRecord<BlockInput>(),
      fields: createScratchRecord<BlockField>([['TO', ['MissingSprite']]]),
      shadow: true,
      topLevel: false,
    }
  )
  const missingTarget = await inspectSemanticEditArtifact(
    await packSb3(
      JSON.stringify(missingTargetProject),
      missingTargetSource.assets
    )
  )
  assert.equal(missingTarget.ok, false)
  assert.equal(missingTarget.refusal?.stage, 'reference-index')
  assert.equal(missingTarget.refusal?.code, 'EDIT_SOURCE_INTEGRITY_INVALID')

  const dynamicTargetSource = buildClicker()
  const dynamicTargetProject = dynamicTargetSource.toProjectJson()
  const dynamicTargetSprite = dynamicTargetProject.targets[1]!
  dynamicTargetSprite.blocks = createScratchRecord<BlockEntry>(
    Object.entries(dynamicTargetSprite.blocks)
  )
  defineScratchRecordValue<BlockEntry>(
    dynamicTargetSprite.blocks,
    'dynamic-target-parent',
    {
      opcode: 'motion_goto',
      next: null,
      parent: null,
      inputs: createScratchRecord<BlockInput>([
        ['TO', [3, 'dynamic-target-reporter', 'dynamic-target-menu']],
      ]),
      fields: createScratchRecord<BlockField>(),
      shadow: false,
      topLevel: true,
      x: 0,
      y: 0,
    }
  )
  defineScratchRecordValue<BlockEntry>(
    dynamicTargetSprite.blocks,
    'dynamic-target-reporter',
    {
      opcode: 'sensing_answer',
      next: null,
      parent: 'dynamic-target-parent',
      inputs: createScratchRecord<BlockInput>(),
      fields: createScratchRecord<BlockField>(),
      shadow: false,
      topLevel: false,
    }
  )
  defineScratchRecordValue<BlockEntry>(
    dynamicTargetSprite.blocks,
    'dynamic-target-menu',
    {
      opcode: 'motion_goto_menu',
      next: null,
      parent: 'dynamic-target-parent',
      inputs: createScratchRecord<BlockInput>(),
      fields: createScratchRecord<BlockField>([['TO', ['MissingSprite']]]),
      shadow: true,
      topLevel: false,
    }
  )
  const dynamicTarget = await inspectSemanticEditArtifact(
    await packSb3(
      JSON.stringify(dynamicTargetProject),
      dynamicTargetSource.assets
    )
  )
  assert.equal(dynamicTarget.ok, true)

  const detachedTargetSource = buildClicker()
  const detachedTargetProject = detachedTargetSource.toProjectJson()
  const detachedTargetSprite = detachedTargetProject.targets[1]!
  detachedTargetSprite.blocks = createScratchRecord<BlockEntry>(
    Object.entries(detachedTargetSprite.blocks)
  )
  defineScratchRecordValue<BlockEntry>(
    detachedTargetSprite.blocks,
    'detached-target-menu',
    {
      opcode: 'motion_goto_menu',
      next: null,
      parent: null,
      inputs: createScratchRecord<BlockInput>(),
      fields: createScratchRecord<BlockField>([['TO', ['_mouse_']]]),
      shadow: false,
      topLevel: true,
      x: 0,
      y: 0,
    }
  )
  const detachedTarget = await inspectSemanticEditArtifact(
    await packSb3(
      JSON.stringify(detachedTargetProject),
      detachedTargetSource.assets
    )
  )
  assert.equal(detachedTarget.ok, false)
  assert.equal(detachedTarget.refusal?.stage, 'reference-index')
  assert.equal(detachedTarget.refusal?.code, 'EDIT_SOURCE_INTEGRITY_INVALID')

  const mismatchedProcedureSource = buildClicker()
  const mismatchedProcedureProject = mismatchedProcedureSource.toProjectJson()
  const mismatchedProcedureTarget = mismatchedProcedureProject.targets[1]!
  mismatchedProcedureTarget.blocks = createScratchRecord<BlockEntry>(
    Object.entries(mismatchedProcedureTarget.blocks)
  )
  defineScratchRecordValue<BlockEntry>(
    mismatchedProcedureTarget.blocks,
    'source-prototype',
    {
      opcode: 'procedures_prototype',
      inputs: createScratchRecord<BlockInput>(),
      fields: createScratchRecord<BlockField>(),
      mutation: {
        tagName: 'mutation',
        children: [],
        proccode: 'source procedure %s',
        argumentids: '["prototype-argument"]',
        argumentnames: '["value"]',
        argumentdefaults: '[""]',
      },
    }
  )
  defineScratchRecordValue<BlockEntry>(
    mismatchedProcedureTarget.blocks,
    'source-call',
    {
      opcode: 'procedures_call',
      inputs: createScratchRecord<BlockInput>([
        ['call-argument', [1, [10, 'value']]],
      ]),
      fields: createScratchRecord<BlockField>(),
      mutation: {
        tagName: 'mutation',
        children: [],
        proccode: 'source procedure %s',
        argumentids: '["call-argument"]',
      },
    }
  )
  const mismatchedProcedure = await inspectSemanticEditArtifact(
    await packSb3(
      JSON.stringify(mismatchedProcedureProject),
      mismatchedProcedureSource.assets
    )
  )
  assert.equal(mismatchedProcedure.ok, false)
  assert.equal(mismatchedProcedure.refusal?.stage, 'procedure-mutations')
  assert.equal(
    mismatchedProcedure.refusal?.code,
    'EDIT_SOURCE_INTEGRITY_INVALID'
  )
  assert.equal(
    mismatchedProcedure.completedStages.includes('scratch-schema'),
    false
  )

  const procedureTopology = async (
    variant:
      | 'valid'
      | 'orphan-prototype'
      | 'duplicate-prototype'
      | 'duplicate-definition'
  ): Promise<Awaited<ReturnType<typeof inspectSemanticEditArtifact>>> =>
  {
    const source = buildClicker()
    const project = source.toProjectJson()
    const target = project.targets[1]!
    target.blocks = createScratchRecord<BlockEntry>(
      Object.entries(target.blocks)
    )
    const definitionId = 'topology-definition'
    const prototypeId = 'topology-prototype'
    defineScratchRecordValue<BlockEntry>(target.blocks, prototypeId, {
      opcode: 'procedures_prototype',
      next: null,
      parent: variant === 'orphan-prototype' ? null : definitionId,
      inputs: createScratchRecord<BlockInput>(),
      fields: createScratchRecord<BlockField>(),
      shadow: variant !== 'orphan-prototype',
      topLevel: variant === 'orphan-prototype',
      ...(variant === 'orphan-prototype' ? { x: 0, y: 0 } : {}),
      mutation: {
        tagName: 'mutation',
        children: [],
        proccode: 'topology procedure',
        argumentids: '[]',
        argumentnames: '[]',
        argumentdefaults: '[]',
      },
    })
    if (variant !== 'orphan-prototype')
    {
      defineScratchRecordValue<BlockEntry>(target.blocks, definitionId, {
        opcode: 'procedures_definition',
        next: null,
        parent: null,
        inputs: createScratchRecord<BlockInput>([
          ['custom_block', [1, prototypeId]],
        ]),
        fields: createScratchRecord<BlockField>(),
        shadow: false,
        topLevel: true,
        x: 0,
        y: 0,
      })
    }
    if (variant === 'duplicate-prototype')
    {
      defineScratchRecordValue<BlockEntry>(
        target.blocks,
        'topology-prototype-duplicate',
        {
          opcode: 'procedures_prototype',
          next: null,
          parent: null,
          inputs: createScratchRecord<BlockInput>(),
          fields: createScratchRecord<BlockField>(),
          shadow: false,
          topLevel: true,
          x: 0,
          y: 0,
          mutation: {
            tagName: 'mutation',
            children: [],
            proccode: 'topology procedure',
            argumentids: '[]',
            argumentnames: '[]',
            argumentdefaults: '[]',
          },
        }
      )
    }
    if (variant === 'duplicate-definition')
    {
      defineScratchRecordValue<BlockEntry>(
        target.blocks,
        'topology-definition-duplicate',
        {
          opcode: 'procedures_definition',
          next: null,
          parent: null,
          inputs: createScratchRecord<BlockInput>([
            ['custom_block', [1, prototypeId]],
          ]),
          fields: createScratchRecord<BlockField>(),
          shadow: false,
          topLevel: true,
          x: 0,
          y: 0,
        }
      )
    }
    if (variant === 'valid')
    {
      defineScratchRecordValue<BlockEntry>(target.blocks, 'topology-call', {
        opcode: 'procedures_call',
        next: null,
        parent: null,
        inputs: createScratchRecord<BlockInput>(),
        fields: createScratchRecord<BlockField>(),
        shadow: false,
        topLevel: true,
        x: 0,
        y: 0,
        mutation: {
          tagName: 'mutation',
          children: [],
          proccode: 'topology procedure',
          argumentids: '[]',
        },
      })
    }
    return inspectSemanticEditArtifact(
      await packSb3(JSON.stringify(project), source.assets)
    )
  }
  const validProcedureTopology = await procedureTopology('valid')
  assert.equal(validProcedureTopology.ok, true)
  const orphanProcedureTopology = await procedureTopology('orphan-prototype')
  assert.equal(orphanProcedureTopology.ok, false)
  assert.equal(orphanProcedureTopology.refusal?.stage, 'reference-index')
  assert.equal(
    orphanProcedureTopology.refusal?.code,
    'EDIT_SOURCE_INTEGRITY_INVALID'
  )
  assert.equal(
    orphanProcedureTopology.completedStages.includes('graph-static'),
    false
  )
  for (const variant of [
    'duplicate-prototype',
    'duplicate-definition',
  ] as const)
  {
    const result = await procedureTopology(variant)
    assert.equal(result.ok, true)
    assert.equal(result.refusal, null)
    assert.equal(result.completedStages.includes('complete'), true)
    assert.equal(
      procedureEntityEvidenceSetV1(
        result.project!,
        result.referenceIndex!
      ).some((evidence) => evidence.proccode === 'topology procedure'),
      false
    )
  }

  const clampedCostumeSource = buildClicker()
  const clampedCostumeProject = clampedCostumeSource.toProjectJson()
  clampedCostumeProject.targets[1]!.currentCostume = 99
  const clampedCostume = await inspectSemanticEditArtifact(
    await packSb3(
      JSON.stringify(clampedCostumeProject),
      clampedCostumeSource.assets
    )
  )
  assert.equal(clampedCostume.ok, false)
  assert.equal(clampedCostume.refusal?.stage, 'graph-static')
  assert.equal(clampedCostume.refusal?.code, 'EDIT_SOURCE_INTEGRITY_INVALID')
  assert.equal(
    clampedCostume.graph.some(
      (diagnostic) => diagnostic.code === 'current-costume-range'
    ),
    true
  )

  const monitorArtifact = async (
    monitors: NonNullable<ProjectJson['monitors']>
  ): Promise<Awaited<ReturnType<typeof inspectSemanticEditArtifact>>> =>
  {
    const source = buildClicker()
    const project = source.toProjectJson()
    const stage = project.targets[0]!
    const sprite = project.targets[1]!
    stage.variables = createScratchRecord<VariableEntry>([
      ['global-variable', ['global score', 0]],
    ])
    stage.lists = createScratchRecord<ListEntry>([
      ['global-list', ['global items', []]],
    ])
    sprite.lists = createScratchRecord<ListEntry>([
      ['local-list', ['local items', []]],
    ])
    project.monitors = monitors
    return inspectSemanticEditArtifact(
      await packSb3(JSON.stringify(project), source.assets)
    )
  }
  const validMonitors = await monitorArtifact([
    {
      id: 'global-variable',
      mode: 'default',
      opcode: 'data_variable',
      params: { VARIABLE: 'global score' },
      spriteName: null,
      value: 0,
    },
    {
      id: 'global-list',
      mode: 'list',
      opcode: 'data_listcontents',
      params: { LIST: 'global items' },
      spriteName: 'Sprite1',
      value: [],
    },
    {
      id: 'var-0',
      mode: 'default',
      opcode: 'data_variable',
      params: { VARIABLE: 'score' },
      spriteName: 'Sprite1',
      value: 0,
    },
    {
      id: 'local-list',
      mode: 'list',
      opcode: 'data_listcontents',
      params: { LIST: 'local items' },
      spriteName: 'Sprite1',
      value: [],
    },
  ])
  assert.equal(validMonitors.ok, true)
  const invalidMonitors: NonNullable<ProjectJson['monitors']> = [
    {
      id: 'ghost-variable',
      mode: 'default',
      opcode: 'data_variable',
      params: { VARIABLE: 'ghost' },
      spriteName: null,
      value: 0,
    },
    {
      id: 'ghost-list',
      mode: 'list',
      opcode: 'data_listcontents',
      params: { LIST: 'ghost' },
      spriteName: 'MissingSprite',
      value: [],
    },
    {
      id: 'var-0',
      mode: 'default',
      opcode: 'data_variable',
      params: { VARIABLE: 'stale score' },
      spriteName: 'Sprite1',
      value: 0,
    },
    {
      id: 'ghost-variable',
      mode: 'default',
      opcode: 'data_variable',
      params: { VARIABLE: 'score' },
      spriteName: 'Sprite1',
      value: 0,
    },
    {
      id: 'var-0',
      mode: 'default',
      opcode: 'data_variable',
      params: { LIST: 'score' },
      spriteName: 'Sprite1',
      value: 0,
    },
    {
      id: 'var-0',
      mode: 'default',
      opcode: 'data_variable',
      params: { VARIABLE: 'score', EXTRA: 'unexpected' },
      spriteName: 'Sprite1',
      value: 0,
    },
    {
      id: 'local-list',
      mode: 'default',
      opcode: 'data_variable',
      params: { VARIABLE: 'local items' },
      spriteName: 'Sprite1',
      value: 0,
    },
    {
      id: 'non-declaration-monitor',
      mode: 'default',
      opcode: 'motion_xposition',
      params: { VARIABLE: 'score' },
      spriteName: 'Sprite1',
      value: 0,
    },
  ]
  for (const monitor of invalidMonitors)
  {
    const result = await monitorArtifact([monitor])
    assert.equal(result.ok, false)
    assert.equal(result.refusal?.stage, 'reference-index')
    assert.equal(result.refusal?.code, 'EDIT_SOURCE_INTEGRITY_INVALID')
    assert.equal(result.completedStages.includes('graph-static'), false)
  }

  const boundedProject = buildClicker()
  const boundedJson = boundedProject.toProjectJson()
  const malformedMonitor = {
    ...boundedJson,
    monitors: {},
  } as unknown as ProjectJson
  await assert.rejects(
    admitSb3ForEdit(
      await packSb3(JSON.stringify(malformedMonitor), boundedProject.assets)
    ),
    (error: unknown) =>
      error instanceof Error && error.message.includes('monitors')
  )
  const malformedExtensions = {
    ...boundedJson,
    extensions: [1],
  } as unknown as ProjectJson
  await assert.rejects(
    admitSb3ForEdit(
      await packSb3(JSON.stringify(malformedExtensions), boundedProject.assets)
    ),
    (error: unknown) =>
      error instanceof Error && error.message.includes('extensions')
  )
  const monitorProject: ProjectJson = {
    ...boundedJson,
    monitors: [
      {
        id: 'monitor-1',
        mode: 'default',
        opcode: 'data_variable',
        params: { VARIABLE: 'score', EXTRA: 'charged' },
        spriteName: 'Sprite1',
        value: [1, 2],
      },
    ],
  }
  const monitorBytes = await packSb3(
    JSON.stringify(monitorProject),
    boundedProject.assets
  )
  await assert.rejects(
    admitSb3ForEdit(monitorBytes, {
      editLimits: { maxMonitorParamsPerMonitor: 1 },
    }),
    (error: unknown) =>
      error instanceof Error && error.message.includes('monitor params')
  )
  await assert.rejects(
    admitSb3ForEdit(monitorBytes, {
      editLimits: { maxMonitorListSnapshotItemsPerMonitor: 1 },
    }),
    (error: unknown) =>
      error instanceof Error && error.message.includes('monitor list snapshot')
  )
  await assert.rejects(
    admitSb3ForEdit(validBytes, {
      editLimits: { maxRuntimeScalarSlots: 0 },
    }),
    (error: unknown) =>
      error instanceof Error && error.message.includes('runtime scalar slots')
  )
  await assert.rejects(
    admitSb3ForEdit(validBytes, {
      editLimits: { maxBlockRecords: 0 },
    }),
    (error: unknown) =>
      error instanceof Error && error.message.includes('block records')
  )

  const procedureProject = buildClicker().toProjectJson()
  const procedureTarget = procedureProject.targets[0]!
  procedureTarget.blocks = createScratchRecord<BlockEntry>(
    Object.entries(procedureTarget.blocks)
  )
  defineScratchRecordValue<BlockEntry>(procedureTarget.blocks, 'prototype', {
    opcode: 'procedures_prototype',
    inputs: createScratchRecord<BlockInput>(),
    fields: createScratchRecord<BlockField>(),
    mutation: {
      tagName: 'mutation',
      children: [],
      proccode: 'bounded %s',
      argumentids: '["arg-1"]',
      argumentnames: '["value"]',
      argumentdefaults: '[""]',
    },
  })
  assert.throws(
    () =>
      parseKnownProcedureMutations(
        procedureProject,
        resolveEditAdmissionLimits({
          maxProcedureMutationStringsTotalBytes: 2,
        })
      ),
    (error: unknown) =>
      error instanceof Error && error.message.includes('aggregate encoded')
  )

  const mediaLimits = resolveEditAdmissionLimits()
  const png = onePixelPng()
  const preservationPng = await classifyMediaForPreservation(png, mediaLimits)
  assert.equal(preservationPng.outcome, 'metadataClassified')
  if (preservationPng.outcome === 'metadataClassified')
  {
    assert.equal(preservationPng.canvasPixels, 1)
    assert.equal(preservationPng.authoringEligible, true)
  }
  const interlaced = await classifyMediaForPreservation(
    onePixelPng(true),
    mediaLimits
  )
  assert.equal(interlaced.outcome, 'metadataClassified')
  if (interlaced.outcome === 'metadataClassified')
  {
    assert.equal(interlaced.authoringEligible, false)
    assert.equal(interlaced.features.interlaced, true)
  }
  await assert.rejects(
    classifyMediaForAuthoring(onePixelPng(true), 'costume', mediaLimits),
    (error: unknown) =>
      error !== null &&
      typeof error === 'object' &&
      'code' in error &&
      error.code === MEDIA_CLASSIFICATION_CODES.authoringUnsupported
  )
  await assert.rejects(
    classifyMediaForPreservation(
      png.subarray(0, png.byteLength - 1),
      mediaLimits,
      true
    ),
    (error: unknown) =>
      error !== null &&
      typeof error === 'object' &&
      'code' in error &&
      error.code === MEDIA_CLASSIFICATION_CODES.pngMalformed
  )
  const badCrc = png.slice()
  const crcIndex = badCrc.byteLength - 5
  badCrc[crcIndex] = (badCrc[crcIndex] ?? 0) ^ 1
  await assert.rejects(
    classifyMediaForPreservation(badCrc, mediaLimits, true),
    (error: unknown) =>
      error !== null &&
      typeof error === 'object' &&
      'code' in error &&
      error.code === MEDIA_CLASSIFICATION_CODES.pngMalformed
  )
  await assert.rejects(
    classifyMediaForPreservation(
      new Uint8Array(25 * 1024 * 1024 + 1),
      mediaLimits
    ),
    (error: unknown) =>
      error !== null &&
      typeof error === 'object' &&
      'code' in error &&
      error.code === MEDIA_CLASSIFICATION_CODES.assetTooLarge
  )
  const mediaSource = buildClicker()
  const mediaProject = mediaSource.toProjectJson()
  const pngAssetId = createHash('md5').update(png).digest('hex')
  mediaProject.targets[0]!.costumes = [
    {
      assetId: pngAssetId,
      md5ext: `${pngAssetId}.png`,
      name: 'first',
      dataFormat: 'png',
    },
    {
      assetId: pngAssetId,
      md5ext: `${pngAssetId}.png`,
      name: 'second',
      dataFormat: 'png',
    },
  ]
  await assert.rejects(
    classifyProjectMedia(
      mediaProject,
      [...mediaSource.assets, { path: `${pngAssetId}.png`, bytes: png }],
      resolveEditAdmissionLimits({ maxPngReferencePixels: 1 })
    ),
    (error: unknown) =>
      error !== null &&
      typeof error === 'object' &&
      'code' in error &&
      error.code === MEDIA_CLASSIFICATION_CODES.referenceWorkExceeded
  )
  const missingMedia = await classifyProjectMedia(
    mediaProject,
    mediaSource.assets,
    mediaLimits
  )
  assert.deepEqual(missingMedia.missingReferencedAssetPaths, [
    `${pngAssetId}.png`,
  ])

  const wav = oneSamplePcmWav()
  const authoredWav = await classifyMediaForAuthoring(wav, 'sound', mediaLimits)
  assert.equal(authoredWav.mediaType, 'riff-wave-pcm-integer')
  const legacyWav = wav.slice()
  legacyWav[20] = 3
  const preservedWav = await classifyMediaForPreservation(
    legacyWav,
    mediaLimits
  )
  assert.deepEqual(preservedWav, {
    outcome: 'opaquePreserved',
    mediaType: 'wav',
    authoringEligible: false,
  })

  const asset: Asset = { path: 'same.bin', bytes: Uint8Array.of(1, 2) }
  const oneAsset = await packSb3('{}', [asset])
  const duplicateAsset = await packSb3('{}', [asset, { ...asset }])
  assert.deepEqual(duplicateAsset, oneAsset)
  await assert.rejects(
    packSb3('{}', [asset, { path: asset.path, bytes: Uint8Array.of(2, 1) }]),
    AssetPathConflictError
  )
  await assert.rejects(
    packSb3('{}', [
      {
        path: 'project.json',
        bytes: new TextEncoder().encode('{"hostile":true}'),
      },
    ]),
    AssetPathInvalidError
  )
  for (const path of ['', '.', '..', 'nested/asset.bin', 'nested\\asset.bin'])
  {
    await assert.rejects(
      packSb3('{}', [{ path, bytes: Uint8Array.of(1) }]),
      AssetPathInvalidError,
      path
    )
  }
  const assetProject = buildClicker()
  assetProject.addAsset(asset)
  assetProject.addAsset({ ...asset })
  assert.equal(
    assetProject.assets.filter((entry) => entry.path === asset.path).length,
    1
  )
  assert.throws(
    () =>
      assetProject.addAsset({
        path: asset.path,
        bytes: Uint8Array.of(2, 1),
      }),
    AssetPathConflictError
  )
})

test('Phase 8 package DAG remains acyclic', () =>
{
  const output = execFileSync(
    process.execPath,
    [
      '--import',
      'tsx',
      join(PROJECT_ROOT, 'scripts/gates/check-package-boundaries.ts'),
    ],
    { cwd: PROJECT_ROOT, encoding: 'utf8' }
  )
  assert.match(output, /0 cycles, 0 violations/u)
})

test('Group C target edits preserve raw order and propagate guarded identity', async () =>
{
  const project = blankProject()
  project.addSprite('Primary')
  project.addSprite('Spare')
  project.addSprite('Disposable')
  const stage = project.json.targets[0]!
  for (const target of project.json.targets.slice(1))
    target.costumes = [structuredClone(stage.costumes[0]!)]
  defineScratchRecordValue<BlockEntry>(stage.blocks, 'target-source', {
    opcode: 'motion_goto',
    next: null,
    parent: null,
    inputs: createScratchRecord<BlockInput>([['TO', [1, 'target-menu']]]),
    fields: createScratchRecord<BlockField>(),
    shadow: false,
    topLevel: true,
    x: 12,
    y: 24,
  })
  defineScratchRecordValue<BlockEntry>(stage.blocks, 'target-menu', {
    opcode: 'motion_goto_menu',
    next: null,
    parent: 'target-source',
    inputs: createScratchRecord<BlockInput>(),
    fields: createScratchRecord<BlockField>([['TO', ['Primary', null]]]),
    shadow: true,
    topLevel: false,
  })
  defineScratchRecordValue<BlockEntry>(stage.blocks, 'event-target-source', {
    opcode: 'event_whentouchingobject',
    next: null,
    parent: null,
    inputs: createScratchRecord<BlockInput>([
      ['TOUCHINGOBJECTMENU', [1, 'event-target-menu']],
    ]),
    fields: createScratchRecord<BlockField>(),
    shadow: false,
    topLevel: true,
    x: 12,
    y: 124,
  })
  defineScratchRecordValue<BlockEntry>(stage.blocks, 'event-target-menu', {
    opcode: 'event_touchingobjectmenu',
    next: null,
    parent: 'event-target-source',
    inputs: createScratchRecord<BlockInput>(),
    fields: createScratchRecord<BlockField>([
      ['TOUCHINGOBJECTMENU', ['Primary', null]],
    ]),
    shadow: true,
    topLevel: false,
  })
  project.json.monitors = [
    {
      id: 'primary-x-monitor',
      mode: 'default',
      opcode: 'motion_xposition',
      params: createScratchRecord(),
      spriteName: 'Primary',
      value: 0,
    },
  ]
  const sourcePreflight = await inspectSemanticEditArtifact(
    await project.toSb3()
  )
  assert.equal(sourcePreflight.ok, true, JSON.stringify(sourcePreflight))

  let lineage = targetLineageSnapshot(project)
  const renameIndex = buildSemanticReferenceIndex(project)
  const renameInbound = targetInboundReferenceSetV1(project, renameIndex, 1)
  const renameActivation = targetProspectiveNameActivationV1(
    project,
    renameIndex,
    'Hero'
  )
  assert.equal(renameActivation.activations.length, 0)
  const rename = applyTargetTestOperation(project, lineage, 1, {
    kind: 'target.renameSprite',
    opId: 'rename-primary',
    target: CREATED_TARGET_REF,
    newName: 'Hero',
    expectedName: targetExpectedStringIdentityV1('Primary'),
    expectedInboundReferenceSetSha256: renameInbound.referenceSetSha256,
    newNameActivation: {
      expectedActivationSetSha256: renameActivation.activationSetSha256,
      requireProspectiveActivationCount: 0,
    },
    expectedPlanningFactSetSha256: TEST_SHA256,
  })
  lineage = rename.activeLineage
  assert.equal(project.json.targets[1]?.name, 'Hero')
  const renamedMenu = project.json.targets[0]?.blocks['target-menu']
  assert.equal(
    Array.isArray(renamedMenu) ? undefined : renamedMenu?.fields?.TO?.[0],
    'Hero'
  )
  const renamedEventMenu = project.json.targets[0]?.blocks['event-target-menu']
  assert.equal(
    Array.isArray(renamedEventMenu)
      ? undefined
      : renamedEventMenu?.fields?.TOUCHINGOBJECTMENU?.[0],
    'Hero'
  )
  assert.equal(project.json.monitors?.[0]?.spriteName, 'Hero')
  assert.equal(rename.postcondition.propagatedReferenceCount, 3)
  assert.deepEqual(
    project.json.targets.map((target) => target.name),
    ['Stage', 'Hero', 'Spare', 'Disposable']
  )

  const beforeReorder = targetDualOrderSnapshotV1(project.json, lineage)
  const serializedNames = project.json.targets.map((target) => target.name)
  const reorder = applyTargetTestOperation(project, lineage, 1, {
    kind: 'target.reorderSprite',
    opId: 'reorder-hero',
    target: CREATED_TARGET_REF,
    expectedVisualLayerOrdinal: 1,
    newVisualLayerOrdinal: 3,
    expectedVisualLayerOrderSha256: beforeReorder.visualLayerOrderSha256,
    expectedPlanningFactSetSha256: TEST_SHA256,
  })
  lineage = reorder.activeLineage
  assert.deepEqual(
    project.json.targets.map((target) => target.name),
    serializedNames
  )
  assert.equal(
    reorder.beforeOrder.serializedTargetOrderSha256,
    reorder.afterOrder.serializedTargetOrderSha256
  )
  assert.notEqual(
    reorder.beforeOrder.visualLayerOrderSha256,
    reorder.afterOrder.visualLayerOrderSha256
  )
  assert.deepEqual(
    project.json.targets.slice(1).map((target) => target.layerOrder),
    [3, 1, 2]
  )
  assert.ok(
    reorder.targetCorrespondence.members.every(
      (member) => member.beforeIndex === member.afterIndex
    )
  )

  const hero = project.json.targets[1]!
  if (hero.isStage) assert.fail('fixture hero must be a sprite')
  delete hero.draggable
  const spriteProperties = applyTargetTestOperation(project, lineage, 1, {
    kind: 'target.setSpriteProperties',
    opId: 'set-hero-properties',
    target: CREATED_TARGET_REF,
    edits: [
      {
        property: 'x',
        expected: { state: 'value', value: 0 },
        value: 48,
      },
      {
        property: 'draggable',
        expected: { state: 'missing' },
        value: true,
      },
    ],
    expectedPlanningFactSetSha256: TEST_SHA256,
  })
  lineage = spriteProperties.activeLineage
  const editedHero = project.json.targets[1]
  assert.ok(editedHero && !editedHero.isStage)
  if (!editedHero || editedHero.isStage)
    assert.fail('edited hero must be a sprite')
  assert.equal(editedHero.x, 48)
  assert.equal(editedHero.draggable, true)
  const stageProperties = applyTargetTestOperation(project, lineage, 0, {
    kind: 'target.setStageProperties',
    opId: 'set-stage-properties',
    target: CREATED_TARGET_REF,
    edits: [
      {
        property: 'tempo',
        expected: { state: 'value', value: 60 },
        value: 72,
      },
    ],
    expectedPlanningFactSetSha256: TEST_SHA256,
  })
  lineage = stageProperties.activeLineage
  const editedStage = project.json.targets[0]
  assert.ok(editedStage?.isStage)
  if (!editedStage?.isStage) assert.fail('edited stage must be the stage')
  assert.equal(editedStage.tempo, 72)

  const referencedIndex = buildSemanticReferenceIndex(project)
  const referencedInbound = targetInboundReferenceSetV1(
    project,
    referencedIndex,
    1
  )
  const referencedOrder = targetDualOrderSnapshotV1(project.json, lineage)
  const beforeRefusal = structuredClone(project.json)
  assert.throws(
    () =>
      applyTargetTestOperation(project, lineage, 1, {
        kind: 'target.removeSprite',
        opId: 'remove-referenced-hero',
        target: CREATED_TARGET_REF,
        expectedInboundReferenceSetSha256: referencedInbound.referenceSetSha256,
        expectedOwnedSurfaceSha256: targetOwnedSurfaceSha256V1(
          project.json.targets[1]!
        ),
        expectedSerializedTargetOrderSha256:
          referencedOrder.serializedTargetOrderSha256,
        expectedVisualLayerOrderSha256: referencedOrder.visualLayerOrderSha256,
        requireFinalInboundReferenceCount: 0,
        expectedPlanningFactSetSha256: TEST_SHA256,
      }),
    hasEditCode('edit.entity_still_referenced')
  )
  assert.deepEqual(project.json, beforeRefusal)

  const disposableIndex = 3
  const disposableInbound = targetInboundReferenceSetV1(
    project,
    buildSemanticReferenceIndex(project),
    disposableIndex
  )
  const beforeRemoval = targetDualOrderSnapshotV1(project.json, lineage)
  const beforeRemovalNames = project.json.targets.map((target) => target.name)
  const removal = applyTargetTestOperation(project, lineage, disposableIndex, {
    kind: 'target.removeSprite',
    opId: 'remove-disposable',
    target: CREATED_TARGET_REF,
    expectedInboundReferenceSetSha256: disposableInbound.referenceSetSha256,
    expectedOwnedSurfaceSha256: targetOwnedSurfaceSha256V1(
      project.json.targets[disposableIndex]!
    ),
    expectedSerializedTargetOrderSha256:
      beforeRemoval.serializedTargetOrderSha256,
    expectedVisualLayerOrderSha256: beforeRemoval.visualLayerOrderSha256,
    requireFinalInboundReferenceCount: 0,
    expectedPlanningFactSetSha256: TEST_SHA256,
  })
  assert.deepEqual(
    project.json.targets.map((target) => target.name),
    beforeRemovalNames.filter((_name, index) => index !== disposableIndex)
  )
  assert.deepEqual(
    project.json.targets
      .slice(1)
      .map((target) => target.layerOrder)
      .sort(),
    [1, 2]
  )
  assert.equal(
    removal.targetCorrespondence.members.find(
      (member) => member.lineageId === 'target-lineage-3'
    )?.afterIndex,
    null
  )
  const targetCapabilities = assessTargetOperationCapabilitiesV1(project)
  assert.deepEqual(
    targetCapabilities.items.find(
      (item) => item.operationKind === 'target.addSprite'
    ),
    {
      operationKind: 'target.addSprite',
      availability: 'supported',
      limitationCodes: [],
      targetIndexes: [],
    }
  )
})

test('Group C monitor ownership preserves empty and Stage-collision semantics', async () =>
{
  const project = blankProject()
  project.addSprite('')
  project.addSprite('Spare')
  const stage = project.json.targets[0]!
  for (const target of project.json.targets.slice(1))
    target.costumes = [structuredClone(stage.costumes[0]!)]
  project.json.monitors = [
    {
      id: 'stage-x-monitor',
      mode: 'default',
      opcode: 'motion_xposition',
      params: createScratchRecord(),
      spriteName: '',
      value: 0,
    },
  ]
  const preflight = await inspectSemanticEditArtifact(await project.toSb3())
  assert.equal(preflight.ok, true, JSON.stringify(preflight))
  const index = buildSemanticReferenceIndex(project)
  assert.equal(index.monitors[0]?.targetStatus, 'unique')
  assert.equal(index.monitors[0]?.target?.targetIndex, 0)
  assert.equal(index.monitors[0]?.target?.isStage, true)
  const targetIndex = 1
  const inbound = targetInboundReferenceSetV1(project, index, targetIndex)
  assert.equal(
    inbound.references.some((reference) => reference.kind === 'monitor-target'),
    false
  )
  const capability = assessTargetOperationCapabilitiesV1(project).items.find(
    (item) => item.operationKind === 'target.renameSprite'
  )
  assert.equal(capability?.targetIndexes.includes(targetIndex), true)
  const activation = targetProspectiveNameActivationV1(project, index, 'Hero')
  const lineage = targetLineageSnapshot(project)
  const rename = applyTargetTestOperation(project, lineage, targetIndex, {
    kind: 'target.renameSprite',
    opId: 'rename-empty-sprite-with-stage-monitor',
    target: CREATED_TARGET_REF,
    expectedName: targetExpectedStringIdentityV1(''),
    newName: 'Hero',
    expectedInboundReferenceSetSha256: inbound.referenceSetSha256,
    newNameActivation: {
      expectedActivationSetSha256: activation.activationSetSha256,
      requireProspectiveActivationCount: 0,
    },
    expectedPlanningFactSetSha256: TEST_SHA256,
  })
  assert.equal(project.json.targets[targetIndex]?.name, 'Hero')
  assert.equal(project.json.monitors[0]?.spriteName, '')
  assert.equal(rename.postcondition.propagatedReferenceCount, 0)
  assert.equal(
    (rename.attribution.projectPaths ?? []).some((path) =>
      path.includes('monitors')
    ),
    false
  )

  const collision = blankProject()
  collision.addSprite('Stage')
  collision.addSprite('Spare')
  const collisionStage = collision.json.targets[0]!
  for (const target of collision.json.targets.slice(1))
    target.costumes = [structuredClone(collisionStage.costumes[0]!)]
  collision.json.monitors = [
    {
      id: 'stage-name-collision-monitor',
      mode: 'default',
      opcode: 'motion_xposition',
      params: createScratchRecord(),
      spriteName: 'Stage',
      value: 0,
    },
  ]
  const collisionIndex = buildSemanticReferenceIndex(collision)
  assert.equal(collisionIndex.monitors[0]?.targetStatus, 'ambiguous')
  assert.deepEqual(
    collisionIndex.monitors[0]?.candidateTargets.map(
      (target) => target.targetIndex
    ),
    [0, 1]
  )
  const collisionInbound = targetInboundReferenceSetV1(
    collision,
    collisionIndex,
    1
  )
  assert.deepEqual(
    collisionInbound.references
      .filter((reference) => reference.kind === 'monitor-target')
      .map((reference) => reference.path),
    ['/monitors/0/spriteName']
  )
  const collisionCapability = assessTargetOperationCapabilitiesV1(
    collision
  ).items.find((item) => item.operationKind === 'target.renameSprite')
  assert.equal(collisionCapability?.targetIndexes.includes(1), false)
  assert.equal(
    collisionCapability?.limitationCodes.includes(
      'edit.reference_propagation_incomplete'
    ),
    true
  )
  const collisionPreflight = await inspectSemanticEditArtifact(
    await collision.toSb3()
  )
  assert.equal(collisionPreflight.ok, false)
  assert.equal(collisionPreflight.refusal?.stage, 'reference-index')
  const collisionActivation = targetProspectiveNameActivationV1(
    collision,
    collisionIndex,
    'Hero'
  )
  const collisionBefore = JSON.stringify(collision.json)
  assert.throws(
    () =>
      applyTargetTestOperation(collision, targetLineageSnapshot(collision), 1, {
        kind: 'target.renameSprite',
        opId: 'reject-stage-name-monitor-collision',
        target: CREATED_TARGET_REF,
        expectedName: targetExpectedStringIdentityV1('Stage'),
        newName: 'Hero',
        expectedInboundReferenceSetSha256: collisionInbound.referenceSetSha256,
        newNameActivation: {
          expectedActivationSetSha256: collisionActivation.activationSetSha256,
          requireProspectiveActivationCount: 0,
        },
        expectedPlanningFactSetSha256: TEST_SHA256,
      }),
    hasEditCode('edit.reference_propagation_incomplete')
  )
  assert.equal(JSON.stringify(collision.json), collisionBefore)
  assert.equal(collision.json.monitors[0]?.spriteName, 'Stage')
})

test('Group C target capabilities reject every target when sprite names collide', () =>
{
  const project = blankProject()
  project.addSprite('Dup')
  project.addSprite('Dup')
  project.addSprite('Unique')
  const capabilities = assessTargetOperationCapabilitiesV1(project)
  for (const kind of ['target.renameSprite', 'target.removeSprite'] as const)
  {
    const capability = capabilities.items.find(
      (item) => item.operationKind === kind
    )
    assert.deepEqual(capability?.targetIndexes, [], kind)
    assert.equal(capability?.availability, 'unsupported', kind)
    assert.equal(
      capability?.limitationCodes.includes('edit.project_constraint'),
      true,
      kind
    )
  }

  const targetIndex = 3
  const lineage = targetLineageSnapshot(project)
  const index = buildSemanticReferenceIndex(project)
  const inbound = targetInboundReferenceSetV1(project, index, targetIndex)
  const activation = targetProspectiveNameActivationV1(
    project,
    index,
    'RenamedUnique'
  )
  const order = targetDualOrderSnapshotV1(project.json, lineage)
  const before = JSON.stringify(project.json)
  assert.throws(
    () =>
      applyTargetTestOperation(project, lineage, targetIndex, {
        kind: 'target.renameSprite',
        opId: 'reject-unique-rename-amid-duplicate-peers',
        target: CREATED_TARGET_REF,
        expectedName: targetExpectedStringIdentityV1('Unique'),
        newName: 'RenamedUnique',
        expectedInboundReferenceSetSha256: inbound.referenceSetSha256,
        newNameActivation: {
          expectedActivationSetSha256: activation.activationSetSha256,
          requireProspectiveActivationCount: 0,
        },
        expectedPlanningFactSetSha256: TEST_SHA256,
      }),
    hasEditCode('edit.project_constraint')
  )
  assert.equal(JSON.stringify(project.json), before)
  assert.throws(
    () =>
      applyTargetTestOperation(project, lineage, targetIndex, {
        kind: 'target.removeSprite',
        opId: 'reject-unique-remove-amid-duplicate-peers',
        target: CREATED_TARGET_REF,
        expectedInboundReferenceSetSha256: inbound.referenceSetSha256,
        expectedOwnedSurfaceSha256: targetOwnedSurfaceSha256V1(
          project.json.targets[targetIndex]!
        ),
        expectedSerializedTargetOrderSha256: order.serializedTargetOrderSha256,
        expectedVisualLayerOrderSha256: order.visualLayerOrderSha256,
        requireFinalInboundReferenceCount: 0,
        expectedPlanningFactSetSha256: TEST_SHA256,
      }),
    hasEditCode('edit.project_constraint')
  )
  assert.equal(JSON.stringify(project.json), before)
})

test('Group C target-name mutations refuse dynamic references before mutation', () =>
{
  const project = blankProject()
  project.addSprite('Victim')
  project.addSprite('Spare')
  const stage = project.json.targets[0]!
  defineScratchRecordValue<BlockEntry>(stage.blocks, 'dynamic-target-parent', {
    opcode: 'motion_goto',
    next: null,
    parent: null,
    inputs: createScratchRecord<BlockInput>([
      ['TO', [3, 'dynamic-target-reporter', 'dynamic-target-menu']],
    ]),
    fields: createScratchRecord<BlockField>(),
    shadow: false,
    topLevel: true,
    x: 0,
    y: 0,
  })
  defineScratchRecordValue<BlockEntry>(
    stage.blocks,
    'dynamic-target-reporter',
    {
      opcode: 'sensing_answer',
      next: null,
      parent: 'dynamic-target-parent',
      inputs: createScratchRecord<BlockInput>(),
      fields: createScratchRecord<BlockField>(),
      shadow: false,
      topLevel: false,
    }
  )
  defineScratchRecordValue<BlockEntry>(stage.blocks, 'dynamic-target-menu', {
    opcode: 'motion_goto_menu',
    next: null,
    parent: 'dynamic-target-parent',
    inputs: createScratchRecord<BlockInput>(),
    fields: createScratchRecord<BlockField>([['TO', ['Victim', null]]]),
    shadow: true,
    topLevel: false,
  })
  const lineage = targetLineageSnapshot(project)
  const index = buildSemanticReferenceIndex(project)
  assert.equal(index.dynamicSpriteReferences.length, 1)
  const inbound = targetInboundReferenceSetV1(project, index, 1)
  const activation = targetProspectiveNameActivationV1(
    project,
    index,
    'RenamedVictim'
  )
  const order = targetDualOrderSnapshotV1(project.json, lineage)
  const before = JSON.stringify(project.json)
  assert.throws(
    () =>
      applyTargetTestOperation(project, lineage, 1, {
        kind: 'target.renameSprite',
        opId: 'reject-dynamic-rename',
        target: CREATED_TARGET_REF,
        newName: 'RenamedVictim',
        expectedName: targetExpectedStringIdentityV1('Victim'),
        expectedInboundReferenceSetSha256: inbound.referenceSetSha256,
        newNameActivation: {
          expectedActivationSetSha256: activation.activationSetSha256,
          requireProspectiveActivationCount: 0,
        },
        expectedPlanningFactSetSha256: TEST_SHA256,
      }),
    hasEditCode('edit.dynamic_reference')
  )
  assert.equal(JSON.stringify(project.json), before)
  assert.throws(
    () =>
      applyTargetTestOperation(project, lineage, 1, {
        kind: 'target.removeSprite',
        opId: 'reject-dynamic-remove',
        target: CREATED_TARGET_REF,
        expectedInboundReferenceSetSha256: inbound.referenceSetSha256,
        expectedOwnedSurfaceSha256: targetOwnedSurfaceSha256V1(
          project.json.targets[1]!
        ),
        expectedSerializedTargetOrderSha256: order.serializedTargetOrderSha256,
        expectedVisualLayerOrderSha256: order.visualLayerOrderSha256,
        requireFinalInboundReferenceCount: 0,
        expectedPlanningFactSetSha256: TEST_SHA256,
      }),
    hasEditCode('edit.dynamic_reference')
  )
  assert.equal(JSON.stringify(project.json), before)
})

test('Group C prospective target names include unresolved menus and monitors', () =>
{
  const project = blankProject()
  project.addSprite('Primary')
  project.addSprite('Spare')
  const stage = project.json.targets[0]!
  defineScratchRecordValue<BlockEntry>(stage.blocks, 'prospective-event', {
    opcode: 'event_whentouchingobject',
    next: null,
    parent: null,
    inputs: createScratchRecord<BlockInput>([
      ['TOUCHINGOBJECTMENU', [1, 'prospective-event-menu']],
    ]),
    fields: createScratchRecord<BlockField>(),
    shadow: false,
    topLevel: true,
    x: 0,
    y: 0,
  })
  defineScratchRecordValue<BlockEntry>(stage.blocks, 'prospective-event-menu', {
    opcode: 'event_touchingobjectmenu',
    next: null,
    parent: 'prospective-event',
    inputs: createScratchRecord<BlockInput>(),
    fields: createScratchRecord<BlockField>([
      ['TOUCHINGOBJECTMENU', ['Hero', null]],
    ]),
    shadow: true,
    topLevel: false,
  })
  project.json.monitors = [
    {
      id: 'unresolved-hero-monitor',
      mode: 'default',
      opcode: 'motion_xposition',
      params: createScratchRecord(),
      spriteName: 'Hero',
      value: 0,
    },
  ]
  const index = buildSemanticReferenceIndex(project)
  assert.equal(index.monitors[0]?.targetStatus, 'none')
  const activation = targetProspectiveNameActivationV1(project, index, 'Hero')
  assert.deepEqual(activation.activations, [
    {
      kind: 'unresolved-static',
      path: '/monitors/0/spriteName',
      monitorIndex: 0,
      referenceKind: 'monitor-owner',
    },
    {
      kind: 'unresolved-static',
      path: '/targets/0/blocks/prospective-event-menu/fields/TOUCHINGOBJECTMENU/0',
      sourceTargetIndex: 0,
      blockId: 'prospective-event-menu',
      referenceKind: 'touching',
    },
  ])
  const targetIndex = 1
  const lineage = targetLineageSnapshot(project)
  const inbound = targetInboundReferenceSetV1(project, index, targetIndex)
  const before = JSON.stringify(project.json)
  assert.throws(
    () =>
      applyTargetTestOperation(project, lineage, targetIndex, {
        kind: 'target.renameSprite',
        opId: 'reject-monitor-name-activation',
        target: CREATED_TARGET_REF,
        expectedName: targetExpectedStringIdentityV1('Primary'),
        newName: 'Hero',
        expectedInboundReferenceSetSha256: inbound.referenceSetSha256,
        newNameActivation: {
          expectedActivationSetSha256: activation.activationSetSha256,
          requireProspectiveActivationCount: 0,
        },
        expectedPlanningFactSetSha256: TEST_SHA256,
      }),
    hasEditCode('edit.dynamic_reference')
  )
  assert.equal(JSON.stringify(project.json), before)
})

test('Group C target-name descriptor catalog is behavior-complete', () =>
{
  assert.equal(TARGET_NAME_REFERENCE_DESCRIPTORS_V1.length, 8)
  for (
    let descriptorIndex = 0;
    descriptorIndex < TARGET_NAME_REFERENCE_DESCRIPTORS_V1.length;
    descriptorIndex++
  )
  {
    const descriptor = TARGET_NAME_REFERENCE_DESCRIPTORS_V1[descriptorIndex]!
    const project = blankProject()
    project.addSprite('Victim')
    project.addSprite('Spare')
    const host = project.json.targets[2]!
    const sourceId = `catalog-source-${descriptorIndex}`
    const menuId = `catalog-menu-${descriptorIndex}`
    const sourceFields = createScratchRecord<BlockField>()
    if (descriptor.sourceOpcode === 'sensing_of')
      defineScratchRecordValue(sourceFields, 'PROPERTY', ['x position', null])
    defineScratchRecordValue<BlockEntry>(host.blocks, sourceId, {
      opcode: descriptor.sourceOpcode,
      next: null,
      parent: null,
      inputs: createScratchRecord<BlockInput>([
        [descriptor.inputName, [1, menuId]],
      ]),
      fields: sourceFields,
      shadow: false,
      topLevel: true,
      x: 0,
      y: descriptorIndex * 80,
    })
    const originalTuple: BlockField =
      descriptorIndex % 2 === 0 ? ['Victim'] : ['Victim', null]
    defineScratchRecordValue<BlockEntry>(host.blocks, menuId, {
      opcode: descriptor.menuOpcode,
      next: null,
      parent: sourceId,
      inputs: createScratchRecord<BlockInput>(),
      fields: createScratchRecord<BlockField>([
        [descriptor.fieldName, originalTuple],
      ]),
      shadow: true,
      topLevel: false,
    })
    const index = buildSemanticReferenceIndex(project)
    const reference = index.spriteReferences.find(
      (row) => row.block.blockId === menuId
    )
    assert.ok(reference, descriptor.sourceOpcode)
    assert.equal(reference.sourceStatus, 'verified-parent')
    assert.equal(reference.sourceBlock?.blockId, sourceId)
    assert.equal(reference.fieldName, descriptor.fieldName)
    assert.equal(reference.kind, descriptor.referenceKind)
    assert.equal(reference.targetStatus, 'unique')
    assert.equal(reference.targets[0]?.targetIndex, 1)
    const inbound = targetInboundReferenceSetV1(project, index, 1)
    assert.equal(
      inbound.references.some((row) => row.path.includes(menuId)),
      true,
      descriptor.sourceOpcode
    )
    const activation = targetProspectiveNameActivationV1(project, index, 'Hero')
    const renamed = applyTargetTestOperation(
      project,
      targetLineageSnapshot(project),
      1,
      {
        kind: 'target.renameSprite',
        opId: `catalog-rename-${descriptorIndex}`,
        target: CREATED_TARGET_REF,
        expectedName: targetExpectedStringIdentityV1('Victim'),
        newName: 'Hero',
        expectedInboundReferenceSetSha256: inbound.referenceSetSha256,
        newNameActivation: {
          expectedActivationSetSha256: activation.activationSetSha256,
          requireProspectiveActivationCount: 0,
        },
        expectedPlanningFactSetSha256: TEST_SHA256,
      }
    )
    assert.equal(renamed.postcondition.propagatedReferenceCount, 1)
    const menu = project.json.targets[2]?.blocks[menuId]
    if (!menu || Array.isArray(menu)) assert.fail('catalog menu is absent')
    assert.deepEqual(
      menu.fields?.[descriptor.fieldName],
      descriptorIndex % 2 === 0 ? ['Hero'] : ['Hero', null],
      descriptor.sourceOpcode
    )

    menu.fields![descriptor.fieldName]![0] = 'Future'
    const prospectiveIndex = buildSemanticReferenceIndex(project)
    const prospective = targetProspectiveNameActivationV1(
      project,
      prospectiveIndex,
      'Future'
    )
    assert.deepEqual(
      prospective.activations.map((row) => row.path),
      [`/targets/2/blocks/${menuId}/fields/${descriptor.fieldName}/0`],
      descriptor.sourceOpcode
    )
    for (const specialName of descriptor.specialNames)
    {
      menu.fields![descriptor.fieldName]![0] = specialName
      const special = buildSemanticReferenceIndex(
        project
      ).spriteReferences.find((row) => row.block.blockId === menuId)
      assert.equal(special?.special, true, descriptor.sourceOpcode)
      assert.equal(special?.targetStatus, 'special', descriptor.sourceOpcode)
      assert.deepEqual(special?.targets, [], descriptor.sourceOpcode)
    }
  }
})

test('Group C name-bearing edits fail closed on actual opcode inventory', () =>
{
  for (const vector of [
    {
      id: 'undeclared extension opcode',
      opcode: 'pen_mystery',
      extensions: [] as string[],
      expectedCode: 'edit.unsupported_opcode',
    },
    {
      id: 'core-looking unknown opcode',
      opcode: 'motion_custom',
      extensions: [] as string[],
      expectedCode: 'edit.unsupported_opcode',
    },
    {
      id: 'declared extension',
      opcode: 'motion_movesteps',
      extensions: ['pen'],
      expectedCode: 'edit.unsupported_extension',
    },
  ] as const)
  {
    const project = blankProject()
    project.addSprite('Victim')
    project.addSprite('Spare')
    project.json.extensions = [...vector.extensions]
    const stage = project.json.targets[0]!
    defineScratchRecordValue<BlockEntry>(stage.blocks, 'unknown-semantics', {
      opcode: vector.opcode,
      next: null,
      parent: null,
      inputs: createScratchRecord<BlockInput>(),
      fields: createScratchRecord<BlockField>(),
      shadow: false,
      topLevel: true,
      x: 0,
      y: 0,
    })
    const unknown = unknownNameSemanticsEvidenceV1(project.json)
    assert.deepEqual(unknown.declaredExtensions, vector.extensions, vector.id)
    assert.deepEqual(
      unknown.unknownOpcodes,
      vector.expectedCode === 'edit.unsupported_opcode'
        ? [
            {
              targetIndex: 0,
              blockId: 'unknown-semantics',
              opcode: vector.opcode,
            },
          ]
        : [],
      vector.id
    )
    const targetCapability = assessTargetOperationCapabilitiesV1(project)
    const renameCapability = targetCapability.items.find(
      (item) => item.operationKind === 'target.renameSprite'
    )
    const removeCapability = targetCapability.items.find(
      (item) => item.operationKind === 'target.removeSprite'
    )
    for (const capability of [renameCapability, removeCapability])
    {
      assert.equal(capability?.availability, 'unsupported', vector.id)
      assert.equal(
        capability?.limitationCodes.includes(vector.expectedCode),
        true,
        vector.id
      )
    }
    const declarationCapability = assessDeclarationCapabilitiesV1(project)
    for (const kind of [
      'declaration.addVariable',
      'declaration.rename',
      'declaration.remove',
    ] as const)
    {
      const capability = declarationCapability.operations.find(
        (item) => item.kind === kind
      )
      assert.equal(capability?.availability, 'unsupported', vector.id)
      assert.deepEqual(
        capability?.refusalCodes,
        [vector.expectedCode],
        vector.id
      )
    }

    const lineage = targetLineageSnapshot(project)
    const index = buildSemanticReferenceIndex(project)
    const inbound = targetInboundReferenceSetV1(project, index, 1)
    const activation = targetProspectiveNameActivationV1(
      project,
      index,
      'RenamedVictim'
    )
    const order = targetDualOrderSnapshotV1(project.json, lineage)
    const before = JSON.stringify(project.json)
    assert.throws(
      () =>
        applyTargetTestOperation(project, lineage, 1, {
          kind: 'target.renameSprite',
          opId: `reject-target-rename-${vector.opcode}`,
          target: CREATED_TARGET_REF,
          newName: 'RenamedVictim',
          expectedName: targetExpectedStringIdentityV1('Victim'),
          expectedInboundReferenceSetSha256: inbound.referenceSetSha256,
          newNameActivation: {
            expectedActivationSetSha256: activation.activationSetSha256,
            requireProspectiveActivationCount: 0,
          },
          expectedPlanningFactSetSha256: TEST_SHA256,
        }),
      hasEditCode(vector.expectedCode),
      vector.id
    )
    assert.equal(JSON.stringify(project.json), before, vector.id)
    assert.throws(
      () =>
        applyTargetTestOperation(project, lineage, 1, {
          kind: 'target.removeSprite',
          opId: `reject-target-remove-${vector.opcode}`,
          target: CREATED_TARGET_REF,
          expectedInboundReferenceSetSha256: inbound.referenceSetSha256,
          expectedOwnedSurfaceSha256: targetOwnedSurfaceSha256V1(
            project.json.targets[1]!
          ),
          expectedSerializedTargetOrderSha256:
            order.serializedTargetOrderSha256,
          expectedVisualLayerOrderSha256: order.visualLayerOrderSha256,
          requireFinalInboundReferenceCount: 0,
          expectedPlanningFactSetSha256: TEST_SHA256,
        }),
      hasEditCode(vector.expectedCode),
      vector.id
    )
    assert.equal(JSON.stringify(project.json), before, vector.id)
    const stageRef = {
      targetIndex: 0,
      name: stage.name,
      isStage: true,
    }
    assert.throws(
      () =>
        applyResolvedDeclarationOperationV1(project, {
          kind: 'declaration.addVariable',
          opId: `reject-declaration-${vector.opcode}`,
          scope: stageRef,
          name: 'new variable',
          cloud: false,
          initialValue: 0,
          nameActivation: declarationActivationGuard(
            project,
            'variable',
            stageRef,
            'new variable'
          ),
        }),
      hasEditCode(vector.expectedCode),
      vector.id
    )
    assert.equal(JSON.stringify(project.json), before, vector.id)
  }
})

test('Group C structural name edits require exact raw surface envelopes', () =>
{
  const catalogSource = readFileSync(
    join(PROJECT_ROOT, 'packages/ir/src/edit/name-semantics-catalog.ts'),
    'utf8'
  )
  assert.equal(catalogSource.includes('review/phase-8-a0'), false)
  assert.equal(catalogSource.includes('reconciliation-v1.json'), false)
  assert.equal(catalogSource.includes('oracle metadata is not runtime'), true)
  assert.equal(PINNED_NAME_SEMANTICS_CORE_OPCODES_V1.length, 173)
  assert.equal(PINNED_CORE_BLOCK_SURFACE_DESCRIPTORS_V1.length, 173)
  assert.deepEqual(
    PINNED_CORE_BLOCK_SURFACE_DESCRIPTORS_V1.map((row) => row.opcode),
    PINNED_NAME_SEMANTICS_CORE_OPCODES_V1
  )
  const intentionalSupplements = {
    control_create_clone_of_menu: {
      fieldNames: ['CLONE_OPTION'],
      inputNames: [],
    },
    event_whenbackdropswitchesto: {
      fieldNames: ['BACKDROP'],
      inputNames: [],
    },
    looks_backdrops: { fieldNames: ['BACKDROP'], inputNames: [] },
    looks_costume: { fieldNames: ['COSTUME'], inputNames: [] },
    motion_glideto_menu: { fieldNames: ['TO'], inputNames: [] },
    motion_goto_menu: { fieldNames: ['TO'], inputNames: [] },
    motion_pointtowards_menu: {
      fieldNames: ['TOWARDS'],
      inputNames: [],
    },
    sensing_distancetomenu: {
      fieldNames: ['DISTANCETOMENU'],
      inputNames: [],
    },
    sensing_of_object_menu: { fieldNames: ['OBJECT'], inputNames: [] },
    sensing_touchingobjectmenu: {
      fieldNames: ['TOUCHINGOBJECTMENU'],
      inputNames: [],
    },
    sound_sounds_menu: { fieldNames: ['SOUND_MENU'], inputNames: [] },
    sensing_of: { fieldNames: ['PROPERTY'], inputNames: ['OBJECT'] },
    sound_beats_menu: { fieldNames: ['BEATS'], inputNames: [] },
    sound_effects_menu: { fieldNames: ['EFFECT'], inputNames: [] },
  } as const
  assert.equal(Object.keys(intentionalSupplements).length, 14)

  const positive = blankProject()
  const positiveStage = positive.json.targets[0]!
  defineScratchRecordValue<BlockEntry>(positiveStage.blocks, 'backdrop-hat', {
    opcode: 'event_whenbackdropswitchesto',
    fields: createScratchRecord<BlockField>([
      ['BACKDROP', ['backdrop1', null]],
    ]),
    inputs: createScratchRecord<BlockInput>(),
    next: null,
    parent: null,
    shadow: false,
    topLevel: true,
    x: 0,
    y: 0,
  })
  defineScratchRecordValue<BlockEntry>(positiveStage.blocks, 'stop-absent', {
    opcode: 'control_stop',
    fields: createScratchRecord<BlockField>([['STOP_OPTION', ['all']]]),
    inputs: createScratchRecord<BlockInput>(),
    next: null,
    parent: null,
    shadow: false,
    topLevel: true,
    x: 0,
    y: 100,
  })
  defineScratchRecordValue<BlockEntry>(positiveStage.blocks, 'stop-present', {
    opcode: 'control_stop',
    fields: createScratchRecord<BlockField>([['STOP_OPTION', ['this script']]]),
    inputs: createScratchRecord<BlockInput>(),
    next: null,
    parent: null,
    shadow: false,
    topLevel: true,
    x: 0,
    y: 200,
    mutation: {
      tagName: 'mutation',
      children: [],
      hasnext: 'false',
    },
  })
  defineScratchRecordValue<BlockEntry>(positiveStage.blocks, 'procedure-call', {
    opcode: 'procedures_call',
    fields: createScratchRecord<BlockField>(),
    inputs: createScratchRecord<BlockInput>([
      ['call-argument', [1, [10, 'hello']]],
    ]),
    next: null,
    parent: null,
    shadow: false,
    topLevel: true,
    x: 0,
    y: 300,
    mutation: {
      tagName: 'mutation',
      children: [],
      proccode: 'say %s',
      argumentids: '["call-argument"]',
    },
  })
  defineScratchRecordValue<BlockEntry>(
    positiveStage.blocks,
    'procedure-prototype',
    {
      opcode: 'procedures_prototype',
      fields: createScratchRecord<BlockField>(),
      inputs: createScratchRecord<BlockInput>([
        ['prototype-argument', [1, [10, 'value']]],
      ]),
      next: null,
      parent: null,
      shadow: true,
      topLevel: false,
      mutation: {
        tagName: 'mutation',
        children: [],
        proccode: 'say %s',
        argumentids: '["prototype-argument"]',
        argumentnames: '["value"]',
        argumentdefaults: '[""]',
        warp: false,
      },
    }
  )
  positive.json.monitors = [
    ['data_variable', { VARIABLE: 'score' }],
    ['data_listcontents', { LIST: 'items' }],
    ['motion_xposition', {}],
    ['motion_yposition', {}],
    ['motion_direction', {}],
    ['looks_size', {}],
    ['looks_costumenumbername', { NUMBER_NAME: 'number' }],
    ['looks_backdropnumbername', { NUMBER_NAME: 'number' }],
    ['sound_volume', {}],
    ['sensing_answer', {}],
    ['sensing_loudness', {}],
    ['sensing_online', {}],
    ['sensing_timer', {}],
    ['sensing_current', { CURRENTMENU: 'YEAR' }],
  ].map(([opcode, params], monitorIndex) => ({
    id: `positive-monitor-${monitorIndex}`,
    mode: 'default',
    opcode: opcode as string,
    params: params as Record<string, string>,
    spriteName: null,
    value: 0,
  }))
  assert.deepEqual(unknownNameSemanticsEvidenceV1(positive.json), {
    declaredExtensions: [],
    unknownOpcodes: [],
    surfaceIssues: [],
  })

  const knownBlock = (
    opcode: string,
    fields = createScratchRecord<BlockField>(),
    inputs = createScratchRecord<BlockInput>()
  ): Exclude<BlockEntry, readonly unknown[]> => ({
    opcode,
    fields,
    inputs,
    next: null,
    parent: null,
    shadow: false,
    topLevel: true,
    x: 0,
    y: 0,
  })
  const hiddenNameFields = createScratchRecord<BlockField>([
    ['CUSTOM_OLD_TARGET', ['Victim', null]],
    ['CUSTOM_NEW_TARGET', ['RenamedVictim', null]],
    ['CUSTOM_OLD_DECLARATION', ['score', null]],
    ['CUSTOM_NEW_DECLARATION', ['energy', null]],
  ])
  const hiddenNameInputs = createScratchRecord<BlockInput>([
    ['CUSTOM_OLD_TARGET', [1, [10, 'Victim']]],
    ['CUSTOM_NEW_TARGET', [1, [10, 'RenamedVictim']]],
    ['CUSTOM_OLD_DECLARATION', [1, [10, 'score']]],
    ['CUSTOM_NEW_DECLARATION', [1, [10, 'energy']]],
  ])
  const vectors: readonly {
    id: string
    expectedSurface: string
    prepare: (project: ProjectIR) => void
  }[] = [
    {
      id: 'project own key',
      expectedSurface: 'project-own-keys',
      prepare: (project) =>
        Object.defineProperty(project.json, 'linkedTarget', {
          configurable: true,
          enumerable: true,
          value: 'Victim',
          writable: true,
        }),
    },
    {
      id: 'meta own key',
      expectedSurface: 'meta-own-keys',
      prepare: (project) =>
        Object.defineProperty(project.json.meta, 'linkedTarget', {
          configurable: true,
          enumerable: true,
          value: 'Victim',
          writable: true,
        }),
    },
    {
      id: 'target own key',
      expectedSurface: 'target-own-keys',
      prepare: (project) =>
        Object.defineProperty(project.json.targets[0]!, 'linkedTarget', {
          configurable: true,
          enumerable: true,
          value: 'Victim',
          writable: true,
        }),
    },
    {
      id: 'block own key',
      expectedSurface: 'block-own-keys',
      prepare: (project) =>
      {
        const block = knownBlock('motion_xposition')
        Object.defineProperty(block, 'linkedTarget', {
          configurable: true,
          enumerable: true,
          value: 'Victim',
          writable: true,
        })
        defineScratchRecordValue<BlockEntry>(
          project.json.targets[0]!.blocks,
          'hidden-block-own-key',
          block
        )
      },
    },
    {
      id: 'known opcode extra fields carry old and prospective names',
      expectedSurface: 'block-fields',
      prepare: (project) =>
        defineScratchRecordValue<BlockEntry>(
          project.json.targets[0]!.blocks,
          'hidden-fields',
          knownBlock('motion_xposition', hiddenNameFields)
        ),
    },
    {
      id: 'known opcode extra inputs carry old and prospective names',
      expectedSurface: 'block-inputs',
      prepare: (project) =>
        defineScratchRecordValue<BlockEntry>(
          project.json.targets[0]!.blocks,
          'hidden-inputs',
          knownBlock(
            'motion_xposition',
            createScratchRecord(),
            hiddenNameInputs
          )
        ),
    },
    {
      id: 'obscured shadow tuple is malformed',
      expectedSurface: 'block-inputs',
      prepare: (project) =>
        defineScratchRecordValue<BlockEntry>(
          project.json.targets[0]!.blocks,
          'malformed-obscured-shadow',
          knownBlock(
            'motion_movesteps',
            createScratchRecord(),
            createScratchRecord([['STEPS', [3, [10, 'Victim'], null]]])
          )
        ),
    },
    {
      id: 'identity field has no declaration ID',
      expectedSurface: 'block-fields',
      prepare: (project) =>
        defineScratchRecordValue<BlockEntry>(
          project.json.targets[0]!.blocks,
          'malformed-identity-field',
          knownBlock(
            'data_variable',
            createScratchRecord([['VARIABLE', ['score', null]]])
          )
        ),
    },
    {
      id: 'mutation on mutation-free opcode',
      expectedSurface: 'block-mutation',
      prepare: (project) =>
      {
        const block = knownBlock('motion_xposition')
        block.mutation = { tagName: 'mutation', children: [] }
        defineScratchRecordValue<BlockEntry>(
          project.json.targets[0]!.blocks,
          'hidden-mutation',
          block
        )
      },
    },
    {
      id: 'procedure mutation has extra name-bearing key',
      expectedSurface: 'block-mutation',
      prepare: (project) =>
      {
        const block = knownBlock(
          'procedures_call',
          createScratchRecord(),
          createScratchRecord([['argument-0', [1, [10, 'Victim']]]])
        )
        block.mutation = {
          tagName: 'mutation',
          children: [],
          proccode: 'call %s',
          argumentids: '["argument-0"]',
        }
        Object.defineProperty(block.mutation, 'linkedTarget', {
          configurable: true,
          enumerable: true,
          value: 'RenamedVictim',
          writable: true,
        })
        defineScratchRecordValue<BlockEntry>(
          project.json.targets[0]!.blocks,
          'hidden-procedure-mutation',
          block
        )
      },
    },
    {
      id: 'comment own key',
      expectedSurface: 'comment-own-keys',
      prepare: (project) =>
      {
        const stage = project.json.targets[0]!
        stage.comments = createScratchRecord([
          [
            'hidden-comment',
            {
              blockId: null,
              text: 'known comment text',
              minimized: false,
              x: 0,
              y: 0,
              width: 120,
              height: 80,
            },
          ],
        ])
        Object.defineProperty(
          stage.comments['hidden-comment']!,
          'linkedTarget',
          {
            configurable: true,
            enumerable: true,
            value: 'Victim',
            writable: true,
          }
        )
      },
    },
    {
      id: 'costume own key',
      expectedSurface: 'costume-own-keys',
      prepare: (project) =>
        Object.defineProperty(
          project.json.targets[0]!.costumes[0]!,
          'linkedTarget',
          {
            configurable: true,
            enumerable: true,
            value: 'Victim',
            writable: true,
          }
        ),
    },
    {
      id: 'sound own key',
      expectedSurface: 'sound-own-keys',
      prepare: (project) =>
      {
        const sound = {
          assetId: '0'.repeat(32),
          name: 'hidden sound',
          dataFormat: 'wav',
        }
        Object.defineProperty(sound, 'linkedTarget', {
          configurable: true,
          enumerable: true,
          value: 'Victim',
          writable: true,
        })
        project.json.targets[0]!.sounds.push(sound)
      },
    },
    {
      id: 'monitor own key',
      expectedSurface: 'monitor-own-keys',
      prepare: (project) =>
      {
        const monitor: NonNullable<ProjectJson['monitors']>[number] = {
          id: 'x-position-monitor',
          mode: 'default',
          opcode: 'motion_xposition',
          params: createScratchRecord<never>(),
          spriteName: 'Victim',
          value: 0,
        }
        Object.defineProperty(monitor, 'linkedTarget', {
          configurable: true,
          enumerable: true,
          value: 'Victim',
          writable: true,
        })
        project.json.monitors = [monitor]
      },
    },
    {
      id: 'unknown monitor opcode carries target name',
      expectedSurface: 'monitor-opcode',
      prepare: (project) =>
      {
        project.json.monitors = [
          {
            id: 'extension-target-monitor',
            mode: 'default',
            opcode: 'extension_target_monitor',
            params: createScratchRecord([['TARGET', 'Victim']]),
            spriteName: 'Victim',
            value: 0,
          },
        ]
      },
    },
    {
      id: 'known monitor has extra declaration-name param',
      expectedSurface: 'monitor-params',
      prepare: (project) =>
      {
        project.json.monitors = [
          {
            id: 'score',
            mode: 'default',
            opcode: 'data_variable',
            params: createScratchRecord([
              ['VARIABLE', 'score'],
              ['CUSTOM', 'score'],
            ]),
            spriteName: null,
            value: 0,
          },
        ]
      },
    },
  ]

  for (const vector of vectors)
  {
    const project = blankProject()
    project.addSprite('Victim')
    project.addSprite('Spare')
    const stage = project.json.targets[0]!
    defineScratchRecordValue<VariableEntry>(stage.variables, 'score', [
      'score',
      0,
    ])
    vector.prepare(project)
    const evidence = unknownNameSemanticsEvidenceV1(project.json)
    assert.equal(
      evidence.surfaceIssues.some(
        (issue) => issue.surface === vector.expectedSurface
      ),
      true,
      vector.id
    )
    const targetCapability = assessTargetOperationCapabilitiesV1(project)
    for (const kind of [
      'target.renameSprite',
      'target.removeSprite',
    ] as const)
    {
      const capability = targetCapability.items.find(
        (item) => item.operationKind === kind
      )
      assert.equal(capability?.availability, 'unsupported', vector.id)
      assert.equal(
        capability?.limitationCodes.includes('edit.unsupported_opcode'),
        true,
        vector.id
      )
    }
    const declarationCapability = assessDeclarationCapabilitiesV1(project)
    for (const kind of [
      'declaration.addVariable',
      'declaration.rename',
      'declaration.remove',
    ] as const)
    {
      const capability = declarationCapability.operations.find(
        (item) => item.kind === kind
      )
      assert.equal(capability?.availability, 'unsupported', vector.id)
      assert.deepEqual(
        capability?.refusalCodes,
        ['edit.unsupported_opcode'],
        vector.id
      )
    }
    assert.equal(
      declarationCapability.operations.find(
        (item) => item.kind === 'declaration.setVariableInitialValue'
      )?.availability,
      'supported',
      vector.id
    )

    const lineage = targetLineageSnapshot(project)
    const index = buildSemanticReferenceIndex(project)
    const inbound = targetInboundReferenceSetV1(project, index, 1)
    const activation = targetProspectiveNameActivationV1(
      project,
      index,
      'RenamedVictim'
    )
    const order = targetDualOrderSnapshotV1(project.json, lineage)
    const before = JSON.stringify(project.json)
    assert.throws(
      () =>
        applyTargetTestOperation(project, lineage, 1, {
          kind: 'target.renameSprite',
          opId: `reject-target-rename-${vector.id}`,
          target: CREATED_TARGET_REF,
          newName: 'RenamedVictim',
          expectedName: targetExpectedStringIdentityV1('Victim'),
          expectedInboundReferenceSetSha256: inbound.referenceSetSha256,
          newNameActivation: {
            expectedActivationSetSha256: activation.activationSetSha256,
            requireProspectiveActivationCount: 0,
          },
          expectedPlanningFactSetSha256: TEST_SHA256,
        }),
      hasEditCode('edit.unsupported_opcode'),
      vector.id
    )
    assert.equal(JSON.stringify(project.json), before, vector.id)
    assert.throws(
      () =>
        applyTargetTestOperation(project, lineage, 1, {
          kind: 'target.removeSprite',
          opId: `reject-target-remove-${vector.id}`,
          target: CREATED_TARGET_REF,
          expectedInboundReferenceSetSha256: inbound.referenceSetSha256,
          expectedOwnedSurfaceSha256: targetOwnedSurfaceSha256V1(
            project.json.targets[1]!
          ),
          expectedSerializedTargetOrderSha256:
            order.serializedTargetOrderSha256,
          expectedVisualLayerOrderSha256: order.visualLayerOrderSha256,
          requireFinalInboundReferenceCount: 0,
          expectedPlanningFactSetSha256: TEST_SHA256,
        }),
      hasEditCode('edit.unsupported_opcode'),
      vector.id
    )
    assert.equal(JSON.stringify(project.json), before, vector.id)

    const stageRef = {
      targetIndex: 0,
      name: stage.name,
      isStage: true,
    } as const
    const score = {
      kind: 'variable',
      declarationTarget: stageRef,
      id: 'score',
      name: 'score',
    } as const
    const scoreReferences = declarationReferenceEvidenceV1(project, score)
    for (const operation of [
      {
        kind: 'declaration.addVariable',
        opId: `reject-add-${vector.id}`,
        scope: stageRef,
        name: 'new variable',
        cloud: false,
        initialValue: 0,
        nameActivation: declarationActivationGuard(
          project,
          'variable',
          stageRef,
          'new variable'
        ),
      },
      {
        kind: 'declaration.rename',
        opId: `reject-rename-${vector.id}`,
        declaration: score,
        expectedName: expectedDeclarationNameIdentityV1(score),
        newName: 'energy',
        expectedReferenceSetSha256: scoreReferences.expectedReferenceSetSha256,
        newNameActivation: declarationActivationGuard(
          project,
          'variable',
          stageRef,
          'energy',
          score
        ),
      },
      {
        kind: 'declaration.remove',
        opId: `reject-remove-${vector.id}`,
        declaration: score,
        expectedReferenceSetSha256: scoreReferences.expectedReferenceSetSha256,
        expectedMonitorSetSha256: scoreReferences.expectedMonitorSetSha256,
        requireFinalReferenceCount: 0,
        requireFinalMonitorCount: 0,
      },
    ] as const)
    {
      assert.throws(
        () => applyResolvedDeclarationOperationV1(project, operation),
        hasEditCode('edit.unsupported_opcode'),
        `${vector.id}: ${operation.kind}`
      )
      assert.equal(JSON.stringify(project.json), before, vector.id)
    }
  }
})

test('Group C declaration structural edits refuse name-fallback monitors', async () =>
{
  for (const vector of [
    {
      kind: 'variable',
      declarationId: 'global-variable',
      monitorId: 'var-0',
      name: 'score',
      opcode: 'data_variable',
      parameter: 'VARIABLE',
    },
    {
      kind: 'list',
      declarationId: 'global-list',
      monitorId: 'list-0',
      name: 'items',
      opcode: 'data_listcontents',
      parameter: 'LIST',
    },
  ] as const)
  {
    const project = blankProject()
    project.addSprite('Sprite1')
    const stage = project.json.targets[0]!
    project.json.targets[1]!.costumes = [structuredClone(stage.costumes[0]!)]
    const spriteRef = {
      targetIndex: 1,
      name: 'Sprite1',
      isStage: false,
    } as const
    if (vector.kind === 'variable')
      defineScratchRecordValue<VariableEntry>(
        stage.variables,
        vector.declarationId,
        [vector.name, 0]
      )
    else
    {
      stage.lists ??= createScratchRecord()
      defineScratchRecordValue<ListEntry>(stage.lists, vector.declarationId, [
        vector.name,
        [],
      ])
    }
    project.json.monitors = [
      {
        id: vector.monitorId,
        mode: vector.kind === 'list' ? 'list' : 'default',
        opcode: vector.opcode,
        params: createScratchRecord([[vector.parameter, vector.name]]),
        spriteName: 'Sprite1',
        value: vector.kind === 'list' ? [] : 0,
      },
    ]
    const beforeIndex = buildSemanticReferenceIndex(project)
    assert.equal(
      beforeIndex.monitors[0]?.resolutionSource,
      'stage-name',
      vector.kind
    )
    assert.equal(
      project.uids.clone().next(vector.kind === 'variable' ? 'var' : 'list'),
      vector.monitorId,
      vector.kind
    )
    const capability = assessDeclarationCapabilitiesV1(project)
    for (const kind of [
      'declaration.addVariable',
      'declaration.addList',
      'declaration.addBroadcast',
      'declaration.rename',
      'declaration.remove',
    ] as const)
    {
      const operation = capability.operations.find((row) => row.kind === kind)
      assert.equal(operation?.availability, 'unsupported', vector.kind)
      assert.deepEqual(
        operation?.refusalCodes,
        ['edit.reference_propagation_incomplete'],
        `${vector.kind}: ${kind}`
      )
    }
    const before = JSON.stringify(project.json)
    const operation =
      vector.kind === 'variable'
        ? ({
            kind: 'declaration.addVariable',
            opId: 'reject-variable-monitor-name-fallback',
            scope: spriteRef,
            name: vector.name,
            cloud: false,
            initialValue: 1,
            nameActivation: declarationActivationGuard(
              project,
              'variable',
              spriteRef,
              vector.name
            ),
          } as const)
        : ({
            kind: 'declaration.addList',
            opId: 'reject-list-monitor-name-fallback',
            scope: spriteRef,
            name: vector.name,
            initialItems: ['seed'],
            nameActivation: declarationActivationGuard(
              project,
              'list',
              spriteRef,
              vector.name
            ),
            expectedListMapState: optionalCollectionContainerStateV1(
              project.json.targets[1]?.lists
            ),
          } as const)
    assert.throws(
      () => applyResolvedDeclarationOperationV1(project, operation),
      hasEditCode('edit.reference_propagation_incomplete'),
      vector.kind
    )
    assert.equal(JSON.stringify(project.json), before, vector.kind)
    assert.equal(
      buildSemanticReferenceIndex(project).monitors[0]?.resolutionSource,
      'stage-name',
      vector.kind
    )
    const preflight = await inspectSemanticEditArtifact(await project.toSb3())
    assert.equal(preflight.ok, false, vector.kind)
    assert.equal(preflight.refusal?.stage, 'reference-index', vector.kind)
  }

  const ambiguousOwner = blankProject()
  ambiguousOwner.addSprite('Duplicated Owner')
  ambiguousOwner.addSprite('Duplicated Owner')
  const ambiguousStage = ambiguousOwner.json.targets[0]!
  for (const target of ambiguousOwner.json.targets.slice(1))
    target.costumes = [structuredClone(ambiguousStage.costumes[0]!)]
  defineScratchRecordValue<VariableEntry>(
    ambiguousStage.variables,
    'global-score',
    ['score', 0]
  )
  ambiguousOwner.json.monitors = [
    {
      id: 'global-score',
      mode: 'default',
      opcode: 'data_variable',
      params: createScratchRecord([['VARIABLE', 'score']]),
      spriteName: 'Duplicated Owner',
      value: 0,
    },
  ]
  const ambiguousIndex = buildSemanticReferenceIndex(ambiguousOwner)
  assert.equal(ambiguousIndex.monitors[0]?.targetStatus, 'ambiguous')
  assert.equal(ambiguousIndex.monitors[0]?.declarationStatus, 'unique')
  const ambiguousCapabilities = assessDeclarationCapabilitiesV1(ambiguousOwner)
  for (const kind of [
    'declaration.addVariable',
    'declaration.rename',
    'declaration.remove',
  ] as const)
  {
    const capability = ambiguousCapabilities.operations.find(
      (row) => row.kind === kind
    )
    assert.equal(capability?.availability, 'unsupported', kind)
    assert.deepEqual(
      capability?.refusalCodes,
      ['edit.reference_propagation_incomplete'],
      kind
    )
  }
  const ambiguousScope = {
    targetIndex: 1,
    name: 'Duplicated Owner',
    isStage: false,
  } as const
  const ambiguousBefore = JSON.stringify(ambiguousOwner.json)
  assert.throws(
    () =>
      applyResolvedDeclarationOperationV1(ambiguousOwner, {
        kind: 'declaration.addVariable',
        opId: 'reject-ambiguous-monitor-owner',
        scope: ambiguousScope,
        name: 'local score',
        cloud: false,
        initialValue: 1,
        nameActivation: declarationActivationGuard(
          ambiguousOwner,
          'variable',
          ambiguousScope,
          'local score'
        ),
      }),
    hasEditCode('edit.reference_propagation_incomplete')
  )
  assert.equal(JSON.stringify(ambiguousOwner.json), ambiguousBefore)
  const ambiguousPreflight = await inspectSemanticEditArtifact(
    await ambiguousOwner.toSb3()
  )
  assert.equal(ambiguousPreflight.ok, false)
  assert.equal(ambiguousPreflight.refusal?.stage, 'reference-index')
})

test('Group C declaration edits preserve references, containers, and hostile own keys', () =>
{
  const project = blankProject()
  project.addSprite('Sprite1')
  const stage = project.json.targets[0]!
  const sprite = project.json.targets[1]!
  const stageRef = { targetIndex: 0, name: 'Stage', isStage: true } as const
  const spriteRef = {
    targetIndex: 1,
    name: 'Sprite1',
    isStage: false,
  } as const
  delete sprite.lists
  delete stage.broadcasts

  const variableAdd = applyResolvedDeclarationOperationV1(project, {
    opId: 'add-health',
    kind: 'declaration.addVariable',
    scope: spriteRef,
    name: 'health',
    cloud: false,
    initialValue: 10,
    nameActivation: declarationActivationGuard(
      project,
      'variable',
      spriteRef,
      'health'
    ),
  })
  const health = variableAdd.createdDeclaration
  assert.equal(health?.kind, 'variable')
  if (!health || health.kind !== 'variable')
    assert.fail('variable was not added')
  const variableBeforeRefusal = structuredClone(sprite.variables[health.id])
  assert.throws(
    () =>
      applyResolvedDeclarationOperationV1(project, {
        opId: 'reject-stale-health-value',
        kind: 'declaration.setVariableInitialValue',
        declaration: health,
        expectedValueFingerprintSha256: TEST_SHA256,
        newValue: 12,
      }),
    hasEditCode('edit.fingerprint_mismatch')
  )
  assert.deepEqual(sprite.variables[health.id], variableBeforeRefusal)
  applyResolvedDeclarationOperationV1(project, {
    opId: 'set-health-value',
    kind: 'declaration.setVariableInitialValue',
    declaration: health,
    expectedValueFingerprintSha256: declarationValueFingerprintV1(10),
    newValue: 12,
  })
  assert.deepEqual(sprite.variables[health.id], ['health', 12])

  const listAdd = applyResolvedDeclarationOperationV1(project, {
    opId: 'add-inventory',
    kind: 'declaration.addList',
    scope: spriteRef,
    name: 'inventory',
    initialItems: ['key', 2],
    nameActivation: declarationActivationGuard(
      project,
      'list',
      spriteRef,
      'inventory'
    ),
    expectedListMapState: { state: 'missing' },
  })
  const inventory = listAdd.createdDeclaration
  assert.equal(inventory?.kind, 'list')
  if (!inventory || inventory.kind !== 'list') assert.fail('list was not added')
  assert.deepEqual(sprite.lists?.[inventory.id], ['inventory', ['key', 2]])
  const listBeforeRefusal = structuredClone(sprite.lists?.[inventory.id])
  assert.throws(
    () =>
      applyResolvedDeclarationOperationV1(project, {
        opId: 'reject-stale-inventory-items',
        kind: 'declaration.setListInitialItems',
        declaration: inventory,
        expectedItemsSha256: TEST_SHA256,
        newItems: ['key', 2, 'map'],
      }),
    hasEditCode('edit.fingerprint_mismatch')
  )
  assert.deepEqual(sprite.lists?.[inventory.id], listBeforeRefusal)
  applyResolvedDeclarationOperationV1(project, {
    opId: 'set-inventory-items',
    kind: 'declaration.setListInitialItems',
    declaration: inventory,
    expectedItemsSha256: declarationItemsFingerprintV1(['key', 2]),
    newItems: ['key', 2, 'map'],
  })
  assert.deepEqual(sprite.lists?.[inventory.id], [
    'inventory',
    ['key', 2, 'map'],
  ])

  const broadcastAdd = applyResolvedDeclarationOperationV1(project, {
    opId: 'add-launch',
    kind: 'declaration.addBroadcast',
    name: 'Launch',
    nameActivation: declarationActivationGuard(
      project,
      'broadcast',
      null,
      'Launch'
    ),
    expectedStageBroadcastMapState: { state: 'missing' },
  })
  const launch = broadcastAdd.createdDeclaration
  assert.equal(launch?.kind, 'broadcast')
  if (!launch || launch.kind !== 'broadcast')
    assert.fail('broadcast was not added')
  assert.equal(launch.declarationTarget.isStage, true)

  defineScratchRecordValue<BlockEntry>(sprite.blocks, 'health-field', {
    opcode: 'data_setvariableto',
    fields: createScratchRecord<BlockField>([
      ['VARIABLE', ['health', health.id]],
    ]),
    inputs: createScratchRecord<BlockInput>([['VALUE', [1, [10, '1']]]]),
    next: null,
    parent: null,
    shadow: false,
    topLevel: true,
    x: 0,
    y: 0,
  })
  defineScratchRecordValue<BlockEntry>(sprite.blocks, 'health-input', {
    opcode: 'looks_say',
    fields: createScratchRecord<BlockField>(),
    inputs: createScratchRecord<BlockInput>([
      ['MESSAGE', [1, [12, 'health', health.id]]],
    ]),
    next: null,
    parent: null,
    shadow: false,
    topLevel: true,
    x: 0,
    y: 100,
  })
  defineScratchRecordValue<BlockEntry>(sprite.blocks, 'health-top-level', [
    12,
    'health',
    health.id,
    200,
    100,
  ])
  project.json.monitors = [
    {
      id: health.id,
      mode: 'default',
      opcode: 'data_variable',
      params: createScratchRecord([['VARIABLE', 'health']]),
      spriteName: 'Sprite1',
      value: 10,
    },
  ]

  const healthBefore = declarationReferenceEvidenceV1(project, health)
  assert.deepEqual(
    [
      healthBefore.propagatableReferenceCount,
      healthBefore.monitorCount,
      healthBefore.hasDynamicReference,
    ],
    [4, 1, false]
  )
  const variableRename = applyResolvedDeclarationOperationV1(project, {
    opId: 'rename-health',
    kind: 'declaration.rename',
    declaration: health,
    expectedName: expectedDeclarationNameIdentityV1(health),
    newName: 'energy',
    expectedReferenceSetSha256: healthBefore.expectedReferenceSetSha256,
    newNameActivation: declarationActivationGuard(
      project,
      'variable',
      spriteRef,
      'energy',
      health
    ),
  })
  assert.deepEqual(
    [
      variableRename.propagatedReferenceCount,
      variableRename.propagatedMonitorCount,
    ],
    [3, 1]
  )
  assert.equal(sprite.variables[health.id]?.[0], 'energy')
  const healthField = sprite.blocks['health-field']
  assert.equal(
    Array.isArray(healthField) ? undefined : healthField?.fields?.VARIABLE?.[0],
    'energy'
  )
  const healthInput = sprite.blocks['health-input']
  assert.equal(
    Array.isArray(healthInput)
      ? undefined
      : healthInput?.inputs?.MESSAGE?.[1]?.[1],
    'energy'
  )
  const healthTopLevel = sprite.blocks['health-top-level']
  assert.ok(Array.isArray(healthTopLevel))
  if (!Array.isArray(healthTopLevel))
    assert.fail('top-level variable reporter is absent')
  assert.equal(healthTopLevel[1], 'energy')
  assert.equal(project.json.monitors[0]?.params.VARIABLE, 'energy')

  defineScratchRecordValue<BlockEntry>(stage.blocks, 'launch-receiver', {
    opcode: 'event_whenbroadcastreceived',
    fields: createScratchRecord<BlockField>([
      ['BROADCAST_OPTION', ['Launch', launch.id]],
    ]),
    inputs: createScratchRecord<BlockInput>(),
    next: null,
    parent: null,
    shadow: false,
    topLevel: true,
    x: 0,
    y: 0,
  })
  defineScratchRecordValue<BlockEntry>(sprite.blocks, 'launch-sender', {
    opcode: 'event_broadcast',
    fields: createScratchRecord<BlockField>(),
    inputs: createScratchRecord<BlockInput>([
      ['BROADCAST_INPUT', [1, [11, 'Launch', launch.id]]],
    ]),
    next: null,
    parent: null,
    shadow: false,
    topLevel: true,
    x: 300,
    y: 0,
  })
  const launchBefore = declarationReferenceEvidenceV1(project, launch)
  const broadcastRename = applyResolvedDeclarationOperationV1(project, {
    opId: 'rename-launch',
    kind: 'declaration.rename',
    declaration: launch,
    expectedName: expectedDeclarationNameIdentityV1(launch),
    newName: 'Depart',
    expectedReferenceSetSha256: launchBefore.expectedReferenceSetSha256,
    newNameActivation: declarationActivationGuard(
      project,
      'broadcast',
      null,
      'Depart',
      launch
    ),
  })
  assert.equal(broadcastRename.propagatedReferenceCount, 2)
  assert.equal(stage.broadcasts?.[launch.id], 'Depart')
  const receiver = stage.blocks['launch-receiver']
  assert.equal(
    Array.isArray(receiver)
      ? undefined
      : receiver?.fields?.BROADCAST_OPTION?.[0],
    'Depart'
  )
  const sender = sprite.blocks['launch-sender']
  assert.equal(
    Array.isArray(sender)
      ? undefined
      : sender?.inputs?.BROADCAST_INPUT?.[1]?.[1],
    'Depart'
  )

  const collision = broadcastRuntimeCollisionEvidenceV1(project, 'depart')
  assert.deepEqual(
    [collision.exactCollisionCount, collision.lowercaseCollisionCount],
    [0, 1]
  )
  assert.equal(collision.uppercaseHatCollisionCount, 1)
  const beforeCollision = Object.entries(stage.broadcasts ?? {})
  assert.throws(
    () =>
      applyResolvedDeclarationOperationV1(project, {
        opId: 'add-colliding-broadcast',
        kind: 'declaration.addBroadcast',
        name: 'depart',
        nameActivation: declarationActivationGuard(
          project,
          'broadcast',
          null,
          'depart'
        ),
        expectedStageBroadcastMapState: optionalCollectionContainerStateV1(
          stage.broadcasts
        ),
      }),
    hasEditCode('edit.project_constraint')
  )
  assert.equal(Object.getPrototypeOf(stage.broadcasts!), null)
  assert.deepEqual(Object.entries(stage.broadcasts ?? {}), beforeCollision)

  defineScratchRecordValue<VariableEntry>(stage.variables, '__proto__', [
    'hostile',
    1,
  ])
  const hostileVariable = {
    kind: 'variable',
    declarationTarget: stageRef,
    id: '__proto__',
    name: 'hostile',
  } as const
  const hostileBefore = declarationReferenceEvidenceV1(project, hostileVariable)
  applyResolvedDeclarationOperationV1(project, {
    opId: 'rename-hostile-variable',
    kind: 'declaration.rename',
    declaration: hostileVariable,
    expectedName: expectedDeclarationNameIdentityV1(hostileVariable),
    newName: 'hostile renamed',
    expectedReferenceSetSha256: hostileBefore.expectedReferenceSetSha256,
    newNameActivation: declarationActivationGuard(
      project,
      'variable',
      stageRef,
      'hostile renamed',
      hostileVariable
    ),
  })
  assert.equal(Object.hasOwn(stage.variables, '__proto__'), true)
  assert.equal(
    Object.getOwnPropertyDescriptor(stage.variables, '__proto__')?.value[0],
    'hostile renamed'
  )

  const inventoryBefore = declarationReferenceEvidenceV1(project, inventory)
  assert.deepEqual(
    [inventoryBefore.referenceCount, inventoryBefore.monitorCount],
    [0, 0]
  )
  applyResolvedDeclarationOperationV1(project, {
    opId: 'remove-inventory',
    kind: 'declaration.remove',
    declaration: inventory,
    expectedReferenceSetSha256: inventoryBefore.expectedReferenceSetSha256,
    expectedMonitorSetSha256: inventoryBefore.expectedMonitorSetSha256,
    requireFinalReferenceCount: 0,
    requireFinalMonitorCount: 0,
  })
  const retainedListMap = optionalCollectionContainerStateV1(sprite.lists)
  assert.equal(retainedListMap.state, 'present')
  if (retainedListMap.state !== 'present')
    assert.fail('last removal must retain a present list map')
  assert.equal(retainedListMap.expectedEntryCount, 0)
})

test('Group C cloud declaration evidence preserves rename and refuses removal', () =>
{
  const project = blankProject()
  const stage = project.json.targets[0]!
  defineScratchRecordValue<VariableEntry>(stage.variables, 'cloud-score', [
    'cloud score',
    0,
    true,
  ])
  defineScratchRecordValue<VariableEntry>(stage.variables, 'local-score', [
    'local score',
    1,
  ])
  stage.lists ??= createScratchRecord<ListEntry>()
  defineScratchRecordValue<ListEntry>(stage.lists, 'local-items', [
    'local items',
    [],
  ])
  const evidence = declarationEntityEvidenceSetV1(project)
  const cloud = evidence.find((entry) => entry.declarationId === 'cloud-score')
  const local = evidence.find((entry) => entry.declarationId === 'local-score')
  const list = evidence.find((entry) => entry.declarationId === 'local-items')
  assert.equal(cloud?.cloud, true)
  assert.equal(local?.cloud, false)
  assert.equal(list?.cloud, null)
  assert.ok(cloud && cloud.rawRef.kind === 'variable')
  const capability = assessDeclarationCapabilitiesV1(project)
  assert.deepEqual(
    capability.operations.find(
      (operation) => operation.kind === 'declaration.remove'
    ),
    {
      kind: 'declaration.remove',
      availability: 'unsupported',
      refusalCodes: ['edit.unsupported_operation'],
      explanation: 'cloud variables are preservation-only for removal in V1',
    }
  )
  assert.equal(
    capability.restrictions.includes(
      'cloud variable removal is unavailable; declaration.remove is not advertised'
    ),
    true
  )
  assert.equal(
    capability.operations.find(
      (operation) => operation.kind === 'declaration.rename'
    )?.availability,
    'supported'
  )
  const renameEvidence = declarationReferenceEvidenceV1(project, cloud.rawRef)
  const renamed = applyResolvedDeclarationOperationV1(project, {
    kind: 'declaration.rename',
    opId: 'rename-cloud-score',
    declaration: cloud.rawRef,
    expectedName: expectedDeclarationNameIdentityV1(cloud.rawRef),
    expectedReferenceSetSha256: renameEvidence.expectedReferenceSetSha256,
    newName: 'cloud total',
    newNameActivation: declarationActivationGuard(
      project,
      'variable',
      cloud.rawRef.declarationTarget,
      'cloud total',
      cloud.rawRef
    ),
  }).declaration
  assert.ok(renamed && renamed.kind === 'variable')
  assert.deepEqual(stage.variables['cloud-score'], ['cloud total', 0, true])
  const removalEvidence = declarationReferenceEvidenceV1(project, renamed)
  const beforeRemoval = JSON.stringify(project.json)
  assert.throws(
    () =>
      applyResolvedDeclarationOperationV1(project, {
        kind: 'declaration.remove',
        opId: 'reject-cloud-removal',
        declaration: renamed,
        expectedReferenceSetSha256: removalEvidence.expectedReferenceSetSha256,
        expectedMonitorSetSha256: removalEvidence.expectedMonitorSetSha256,
        requireFinalReferenceCount: 0,
        requireFinalMonitorCount: 0,
      }),
    hasEditCode('edit.unsupported_operation')
  )
  assert.equal(JSON.stringify(project.json), beforeRemoval)
})

test('Group C evidence refuses dangling comment attachments deterministically', () =>
{
  const project = buildClicker()
  const sprite = project.json.targets[1]!
  sprite.comments = createScratchRecord<Comment>([
    [
      'dangling-comment',
      {
        blockId: 'absent-block',
        text: 'cannot attach here',
        x: 0,
        y: 0,
        width: 120,
        height: 80,
        minimized: false,
      },
    ],
  ])
  const refusal = (error: unknown): boolean =>
    error instanceof Error &&
    error.name === 'TargetOperationError' &&
    hasEditCode('edit.reference_propagation_incomplete')(error) &&
    error.message === 'comment attachment points to an absent block'
  assert.throws(() => commentEntityEvidenceSetV1(project), refusal)
  assert.throws(() => commentEntityEvidenceSetV1(project), refusal)
})

test('Group C evidence reuses exact script and block hashes across build paths', () =>
{
  const project = buildClicker()
  const index = buildSemanticReferenceIndex(project)
  const scripts = scriptEntityEvidenceSetV1(project, index)
  const indexedBlocks = blockEntityEvidenceSetV1(project, index, scripts)
  assert.deepEqual(scriptEntityEvidenceSetV1(project), scripts)
  assert.deepEqual(blockEntityEvidenceSetV1(project), indexedBlocks)
  assert.deepEqual(
    commentEntityEvidenceSetV1(project, index, indexedBlocks),
    commentEntityEvidenceSetV1(project)
  )
})

test('Group C block evidence bounds whole block-map scans on long scripts', () =>
{
  const project = buildClicker()
  const sprite = project.json.targets[1]!
  const blockCount = 96
  const blocks = linearStatementScript(blockCount)
  let wholeMapScans = 0
  sprite.blocks = new Proxy(blocks, {
    ownKeys(target)
    {
      wholeMapScans++
      return Reflect.ownKeys(target)
    },
  })
  const evidence = blockEntityEvidenceSetV1(project)
  assert.equal(evidence.length, blockCount)
  assert.ok(
    wholeMapScans <= 32,
    `whole block map scanned ${wholeMapScans} times for ${blockCount} blocks`
  )
})

test('Group C evidence hashes admitted projects beyond the default canonical node limit', async () =>
{
  const source = buildClicker()
  source.json.targets[1]!.blocks = linearStatementScript(8_000)
  assert.throws(
    () => productionCanonicalJsonV1(source.json.targets[1]!.blocks),
    (error: unknown) =>
      error instanceof ProductionCanonicalJsonError && error.code === 'nodes'
  )
  const admission = await admitSb3ForEdit(
    await packSb3(JSON.stringify(source.json), source.assets)
  )
  assert.equal(isEditSb3Admission(admission), true)
  assert.equal(admission.projectCounts.blockRecords, 8_000)
  const admittedProject = ProjectIR.fromProjectJson(
    admission.project,
    admission.assets
  )
  const evidence = mediaRecordEntityEvidenceSetV1(admittedProject)
  assert.equal(evidence.length, 2)
  assert.match(evidence[1]?.semanticLocationSha256 ?? '', /^[0-9a-f]{64}$/u)
})

test('Group C evidence canonicalization refuses impossible limits with an edit code', () =>
{
  let impossibleDepth: unknown = null
  for (
    let depth = 0;
    depth <= EDIT_EVIDENCE_CANONICAL_LIMITS_V1.maxDepth + 1;
    depth++
  )
    impossibleDepth = [impossibleDepth]
  assert.throws(
    () => editEvidenceCanonicalBytesV1(impossibleDepth),
    (error: unknown) =>
      error instanceof Error &&
      error.name === 'TargetOperationError' &&
      hasEditCode('edit.impact_budget_exceeded')(error) &&
      error.message === 'semantic evidence exceeds the canonical depth limit'
  )
})

test('Group C created media refs resolve without building block entity evidence', () =>
{
  const project = buildClicker()
  const mediaEvidence = mediaRecordEntityEvidenceSetV1(project)
  const resolved = resolveMediaRefV1(
    project,
    {
      entityKind: 'media',
      refKind: 'created',
      opId: 'created-costume',
      slot: { name: 'media', slotKind: 'fixed' },
    },
    { resolveMediaCreated: () => 1 }
  )
  assert.equal(resolved.entityKind, 'media')
  assert.deepEqual(resolved, mediaEvidence[1])
})

test('procedure parameter encoding is bidirectional and authoritative', () =>
{
  assert.deepEqual(
    (['s', 'n', 'b'] as const).map((placeholder) => ({
      placeholder,
      parameterType: procedureParameterTypeForPlaceholderV1(placeholder),
      encoding: procedureParameterEncodingForPlaceholderV1(placeholder),
    })),
    [
      {
        placeholder: 's',
        parameterType: 'stringOrNumber',
        encoding: {
          placeholder: '%s',
          reporterOpcode: 'argument_reporter_string_number',
          literalPrimitiveTag: 10,
          literalValueMode: 'stringify',
          inputShape: 'round',
          defaultValueMode: 'preserveNumberOrStringify',
        },
      },
      {
        placeholder: 'n',
        parameterType: 'number',
        encoding: {
          placeholder: '%n',
          reporterOpcode: 'argument_reporter_string_number',
          literalPrimitiveTag: 4,
          literalValueMode: 'preserveNumber',
          inputShape: 'round',
          defaultValueMode: 'coerceNumber',
        },
      },
      {
        placeholder: 'b',
        parameterType: 'boolean',
        encoding: {
          placeholder: '%b',
          reporterOpcode: 'argument_reporter_boolean',
          literalPrimitiveTag: 10,
          literalValueMode: 'unsupported',
          inputShape: 'boolean',
          defaultValueMode: 'coerceBoolean',
        },
      },
    ]
  )
})

test('procedure call arguments use the authoritative parameter encoding', () =>
{
  const project = buildClicker()
  const target = project.json.targets[1]!
  const call: Exclude<BlockEntry, readonly unknown[]> = {
    opcode: 'procedures_call',
    fields: createScratchRecord<BlockField>(),
    inputs: createScratchRecord<BlockInput>(),
    next: null,
    parent: null,
    shadow: false,
    topLevel: true,
    x: 0,
    y: 0,
    mutation: {
      tagName: 'mutation',
      children: [],
      proccode: 'typed %n',
      argumentids: '["argument"]',
    },
  }
  defineScratchRecordValue<BlockEntry>(target.blocks, 'catalog-call', call)
  const procedure = {
    entityKind: 'procedure',
    refKind: 'created',
    opId: 'catalog-procedure',
    slot: { name: 'procedure', slotKind: 'fixed' },
  } as const
  const parameter = {
    entityKind: 'parameter',
    refKind: 'created',
    opId: 'catalog-procedure',
    slot: { localKey: 'argument', slotKind: 'parameter' },
  } as const
  const baseOperation = {
    call: CREATED_BLOCK_REF,
    expectedInputFingerprint: TEST_SHA256,
    expectedPlanningFactSetSha256: TEST_SHA256,
    expectedSignatureSha256: TEST_SHA256,
    kind: 'procedure.setCallArgument',
    opId: 'set-catalog-argument',
    parameter,
    procedure,
    replacedInput: { kind: 'requireNoOwnedBlock' },
  } as const
  const baseRecord = {
    targetIndex: 1,
    definitionBlockId: 'definition',
    prototypeBlockId: 'prototype',
    warp: false,
    argumentIds: ['argument'],
    argumentNames: ['value'],
    argumentDefaults: [''],
  } as const
  const adapters = {
    lowerStatementSequence: (): never =>
      assert.fail('literal arguments must not lower a block sequence'),
  }

  applyProcedureOperationV1(
    project,
    {
      operation: {
        ...baseOperation,
        value: { valueKind: 'literal', value: 7 },
      },
      targetIndex: 1,
      record: { ...baseRecord, proccode: 'typed %n' },
      callBlockId: 'catalog-call',
      argumentId: 'argument',
    },
    adapters
  )
  assert.deepEqual(call.inputs?.argument, [1, [4, 7]])

  call.mutation!.proccode = 'typed %b'
  assert.throws(
    () =>
      applyProcedureOperationV1(
        project,
        {
          operation: {
            ...baseOperation,
            value: { valueKind: 'literal', value: true },
          },
          targetIndex: 1,
          record: { ...baseRecord, proccode: 'typed %b' },
          callBlockId: 'catalog-call',
          argumentId: 'argument',
        },
        adapters
      ),
    hasEditCode('edit.invalid_shape')
  )
})

test('Group C comment edits maintain reciprocal links and exact layout states', () =>
{
  const project = buildClicker()
  const sprite = project.json.targets[1]!
  const topBlockIds = Object.keys(sprite.blocks).filter((blockId) =>
  {
    const block = sprite.blocks[blockId]
    return !Array.isArray(block) && block?.topLevel === true
  })
  assert.ok(topBlockIds.length >= 2)
  delete sprite.comments
  assert.deepEqual(commentMapStateV1(project, 1), { state: 'missing' })

  const added = applyCommentOperationV1(project, {
    operation: {
      kind: 'comment.add',
      opId: 'add-comment',
      target: CREATED_TARGET_REF,
      attachment: { kind: 'attached', block: CREATED_BLOCK_REF },
      text: 'guard the click flow',
      layout: {
        x: 10,
        y: 20,
        width: 160,
        height: 80,
        minimized: true,
      },
      expectedCommentMapState: { state: 'missing' },
      expectedPlanningFactSetSha256: TEST_SHA256,
    },
    targetIndex: 1,
    blockId: topBlockIds[0],
  })
  const addedComment = project.json.targets[1]!.comments?.[added.commentId] as
    Comment | undefined
  assert.ok(addedComment)
  if (!addedComment) assert.fail('added comment is absent')
  assert.equal(addedComment.blockId, topBlockIds[0])
  const firstBlock = sprite.blocks[topBlockIds[0]!]
  assert.equal(
    Array.isArray(firstBlock) ? undefined : firstBlock?.comment,
    added.commentId
  )
  assert.equal(commentMapStateV1(project, 1).state, 'present')
  const commentBeforeRefusal = structuredClone(addedComment)
  assert.throws(
    () =>
      applyCommentOperationV1(project, {
        operation: {
          kind: 'comment.updateText',
          opId: 'reject-stale-comment-text',
          comment: CREATED_COMMENT_REF,
          expectedTextSha256: TEST_SHA256,
          text: 'updated click-flow guard',
          expectedPlanningFactSetSha256: TEST_SHA256,
        },
        targetIndex: 1,
        commentId: added.commentId,
      }),
    hasEditCode('edit.fingerprint_mismatch')
  )
  assert.deepEqual(addedComment, commentBeforeRefusal)
  applyCommentOperationV1(project, {
    operation: {
      kind: 'comment.updateText',
      opId: 'update-comment-text',
      comment: CREATED_COMMENT_REF,
      expectedTextSha256: commentTextSha256V1('guard the click flow'),
      text: 'updated click-flow guard',
      expectedPlanningFactSetSha256: TEST_SHA256,
    },
    targetIndex: 1,
    commentId: added.commentId,
  })
  assert.equal(addedComment.text, 'updated click-flow guard')

  applyCommentOperationV1(project, {
    operation: {
      kind: 'comment.detach',
      opId: 'detach-comment',
      comment: CREATED_COMMENT_REF,
      expectedBlock: CREATED_BLOCK_REF,
      expectedPlanningFactSetSha256: TEST_SHA256,
    },
    targetIndex: 1,
    commentId: added.commentId,
    blockId: topBlockIds[0],
  })
  assert.equal(addedComment.blockId, null)
  assert.equal(
    Array.isArray(firstBlock) ? undefined : firstBlock?.comment,
    undefined
  )

  addedComment.x = null
  addedComment.y = 25
  delete addedComment.width
  applyCommentOperationV1(project, {
    operation: {
      kind: 'comment.move',
      opId: 'move-comment',
      comment: CREATED_COMMENT_REF,
      edits: [
        {
          property: 'x',
          expected: { state: 'null' },
          value: 30,
        },
        {
          property: 'y',
          expected: { state: 'value', value: 25 },
          value: 40,
        },
        {
          property: 'width',
          expected: { state: 'missing' },
          value: 180,
        },
        {
          property: 'minimized',
          expected: { state: 'value', value: true },
          value: false,
        },
      ],
      expectedPlanningFactSetSha256: TEST_SHA256,
    },
    targetIndex: 1,
    commentId: added.commentId,
  })
  assert.deepEqual(
    {
      x: addedComment.x,
      y: addedComment.y,
      width: addedComment.width,
      minimized: addedComment.minimized,
    },
    { x: 30, y: 40, width: 180, minimized: false }
  )

  applyCommentOperationV1(project, {
    operation: {
      kind: 'comment.attach',
      opId: 'reattach-comment',
      comment: CREATED_COMMENT_REF,
      block: CREATED_BLOCK_REF,
      expectedDetached: true,
      expectedPlanningFactSetSha256: TEST_SHA256,
    },
    targetIndex: 1,
    commentId: added.commentId,
    blockId: topBlockIds[1],
  })
  const secondBlock = sprite.blocks[topBlockIds[1]!]
  assert.equal(addedComment.blockId, topBlockIds[1])
  assert.equal(
    Array.isArray(secondBlock) ? undefined : secondBlock?.comment,
    added.commentId
  )

  applyCommentOperationV1(project, {
    operation: {
      kind: 'comment.remove',
      opId: 'remove-comment',
      comment: CREATED_COMMENT_REF,
      expectedSemanticFingerprint: commentSemanticFingerprintV1(
        1,
        added.commentId,
        addedComment
      ),
      expectedPlanningFactSetSha256: TEST_SHA256,
    },
    targetIndex: 1,
    commentId: added.commentId,
  })
  assert.equal(sprite.comments?.[added.commentId], undefined)
  assert.equal(
    Array.isArray(secondBlock) ? undefined : secondBlock?.comment,
    undefined
  )
  assert.equal(commentMapStateV1(project, 1).state, 'present')
})

test('Group C script workspace movement preserves every non-layout byte value', () =>
{
  const project = buildClicker()
  const sprite = project.json.targets[1]!
  const topBlockId = Object.keys(sprite.blocks).find((blockId) =>
  {
    const block = sprite.blocks[blockId]
    return (
      !Array.isArray(block) &&
      block?.topLevel === true &&
      typeof block.x === 'number' &&
      typeof block.y === 'number'
    )
  })
  assert.ok(topBlockId)
  const topBlock = sprite.blocks[topBlockId]
  assert.ok(!Array.isArray(topBlock) && topBlock)
  if (Array.isArray(topBlock) || !topBlock) assert.fail('script root is absent')
  const expected = structuredClone(project.json)
  const expectedBlock = expected.targets[1]?.blocks[topBlockId]
  assert.ok(!Array.isArray(expectedBlock) && expectedBlock)
  if (Array.isArray(expectedBlock) || !expectedBlock)
    assert.fail('expected script root is absent')
  expectedBlock.x = 321
  expectedBlock.y = -123

  applyScriptWorkspaceOperationV1(project, {
    operation: {
      kind: 'script.moveWorkspace',
      opId: 'move-workspace',
      script: CREATED_SCRIPT_REF,
      expected: {
        x: { state: 'value', value: topBlock.x! },
        y: { state: 'value', value: topBlock.y! },
      },
      changes: { x: 321, y: -123 },
      expectedPlanningFactSetSha256: TEST_SHA256,
    },
    targetIndex: 1,
    topBlockId,
  })
  assert.deepEqual(project.json, expected)
})

test('Group D curated graph editing composes every approved shape and operation', () =>
{
  const verification = assertCuratedCoreCatalogV1()
  assert.equal(verification.ok, true)
  // D1 pins the reviewed catalog the operations were built against; a descriptor
  // or builder-policy edit changes these & must go through an A0 amendment
  assert.equal(
    verification.descriptorProfileSha256,
    APPROVED_CURATED_CORE_DESCRIPTOR_PROFILE_SHA256
  )
  assert.equal(
    APPROVED_CURATED_CORE_DESCRIPTOR_PROFILE_SHA256,
    '89f387b05b05c7ee48824d339103ad09dac257634b89974ceb3c1c38905b732d'
  )
  assert.equal(
    APPROVED_CURATED_CORE_BUILDER_POLICY_SHA256,
    'cae42b37b69e96614c05f64b2dc553c01aa902ac567e425a592f334d842a438f'
  )
  assert.equal(
    APPROVED_REPAIR_CORE_COMPATIBILITY_PROFILE_SHA256,
    '7bdb6c4d35f906ac5a93ab45882d296868af0ec1dcfbd8d1d9ce7f9ef344d739'
  )
  assert.equal(verification.descriptorCount, 13)
  assert.equal(verification.authorableDescriptorCount, 12)
  assert.equal(verification.coveredAuthorableDescriptorCount, 12)
  assert.equal(verification.coveredBuilderOnlyDescriptorCount, 1)
  assert.deepEqual(
    PINNED_CURATED_CORE_PARITY_ROWS_V1.map((row) => row.shape),
    [
      'hat',
      'hat',
      'stack',
      'menuReporter',
      'stack',
      'reporter',
      'stack',
      'stack',
      'stack',
      'cShape',
      'cShape',
      'cap',
      'boolean',
    ]
  )
  assertRepairCoreCompatibilityProfileV1()
  assert.deepEqual(
    {
      compatible: REPAIR_CORE_COMPATIBILITY_PROFILE_V1.rows
        .filter((row) => row.disposition === 'compatible')
        .map((row) => row.opcode),
      excludedWithReasons: REPAIR_CORE_COMPATIBILITY_PROFILE_V1.rows.filter(
        (row) => row.disposition === 'excluded' && row.reason.length > 0
      ).length,
      frozen: Object.isFrozen(REPAIR_CORE_COMPATIBILITY_PROFILE_V1.rows),
      sha256: REPAIR_CORE_COMPATIBILITY_PROFILE_V1.profileSha256,
    },
    {
      compatible: [
        'event_whenflagclicked',
        'event_whenbroadcastreceived',
        'event_broadcast',
      ],
      excludedWithReasons: 10,
      frozen: true,
      sha256: APPROVED_REPAIR_CORE_COMPATIBILITY_PROFILE_SHA256,
    }
  )

  const source = buildClicker()
  const sourceJson = structuredClone(source.json)
  const stage = sourceJson.targets[0]!
  const sprite = sourceJson.targets[1]!
  stage.broadcasts = createScratchRecord([['broadcast-main', 'message1']])
  sprite.variables = createScratchRecord<VariableEntry>([
    ['score-main', ['score', 0]],
    ['score-secondary', ['score 2', 0]],
  ])
  sprite.blocks = createScratchRecord<BlockEntry>()
  sprite.comments = createScratchRecord<Comment>()
  const project = ProjectIR.fromProjectJson(sourceJson, source.assets)

  const variableRef = {
    entityKind: 'declaration',
    refKind: 'created',
    opId: 'variable-main',
    slot: { name: 'declaration', slotKind: 'fixed' },
  } as const
  const secondaryVariableRef = {
    entityKind: 'declaration',
    refKind: 'created',
    opId: 'variable-secondary',
    slot: { name: 'declaration', slotKind: 'fixed' },
  } as const
  const broadcastRef = {
    entityKind: 'declaration',
    refKind: 'created',
    opId: 'broadcast-main',
    slot: { name: 'declaration', slotKind: 'fixed' },
  } as const
  const resolveEntity: CuratedEntityResolverV1 = (request) =>
  {
    const secondary =
      request.reference.refKind === 'created' &&
      request.reference.opId === 'variable-secondary'
    if (request.expectedEntitySubtype === 'variable')
      return {
        entityKind: 'declaration',
        entitySubtype: 'variable',
        displayName: secondary ? 'score 2' : 'score',
        serializedId: secondary ? 'score-secondary' : 'score-main',
        ownerTargetIndex: 1,
        semanticLineageSha256: secondary ? '2'.repeat(64) : '1'.repeat(64),
        semanticFingerprintSha256: secondary ? '4'.repeat(64) : '3'.repeat(64),
      }
    if (request.expectedEntitySubtype === 'broadcast')
      return {
        entityKind: 'declaration',
        entitySubtype: 'broadcast',
        displayName: 'message1',
        serializedId: 'broadcast-main',
        ownerTargetIndex: 0,
        semanticLineageSha256: '5'.repeat(64),
        semanticFingerprintSha256: '6'.repeat(64),
      }
    assert.fail(
      `unexpected curated entity subtype ${request.expectedEntitySubtype}`
    )
  }
  const adapters = createCuratedCoreOperationAdaptersV1(resolveEntity)
  const assertAffectedBlocks = (
    result: ReturnType<typeof applyBlockStructuralOperationV1>,
    expectedBlockIds: readonly string[]
  ): void =>
  {
    const expected = [...expectedBlockIds].sort()
    assert.deepEqual(result.affectedBlockIds, expected)
    assert.deepEqual(result.affectedCommentIds, [])
    assert.deepEqual(
      result.exactPaths,
      expected.map((id) => `/targets/1/blocks/${id}`)
    )
  }

  const equalsExpression = {
    nodeKind: 'ordinary',
    localAlias: 'equals',
    opcode: 'operator_equals',
    fields: [],
    inputs: [
      {
        name: 'OPERAND1',
        value: { valueKind: 'literal', value: 'left' },
      },
      {
        name: 'OPERAND2',
        value: { valueKind: 'literal', value: 'right' },
      },
    ],
  } as const satisfies SemanticExpressionBlockTreeV1
  const primaryBody = {
    blocks: [
      {
        nodeKind: 'ordinary',
        localAlias: 'setScore',
        opcode: 'data_setvariableto',
        fields: [
          {
            name: 'VARIABLE',
            value: { valueKind: 'entity', value: variableRef },
          },
        ],
        inputs: [{ name: 'VALUE', value: { valueKind: 'literal', value: 0 } }],
      },
      {
        nodeKind: 'ordinary',
        localAlias: 'conditionIf',
        opcode: 'control_if',
        fields: [],
        inputs: [
          {
            name: 'CONDITION',
            value: { valueKind: 'block', value: equalsExpression },
          },
          {
            name: 'SUBSTACK',
            value: {
              valueKind: 'statementSequence',
              value: {
                blocks: [
                  {
                    nodeKind: 'ordinary',
                    localAlias: 'nestedSay',
                    opcode: 'looks_say',
                    fields: [],
                    inputs: [
                      {
                        name: 'MESSAGE',
                        value: { valueKind: 'literal', value: 'nested' },
                      },
                    ],
                  },
                ],
              },
            },
          },
        ],
      },
      {
        nodeKind: 'ordinary',
        localAlias: 'repeat',
        opcode: 'control_repeat',
        fields: [],
        inputs: [
          { name: 'TIMES', value: { valueKind: 'literal', value: 3 } },
          {
            name: 'SUBSTACK',
            value: {
              valueKind: 'statementSequence',
              value: {
                blocks: [
                  {
                    nodeKind: 'ordinary',
                    localAlias: 'nestedMotion',
                    opcode: 'motion_gotoxy',
                    fields: [],
                    inputs: [
                      { name: 'X', value: { valueKind: 'literal', value: 10 } },
                      {
                        name: 'Y',
                        value: { valueKind: 'literal', value: -20 },
                      },
                    ],
                  },
                ],
              },
            },
          },
        ],
      },
      {
        nodeKind: 'ordinary',
        localAlias: 'broadcast',
        opcode: 'event_broadcast',
        fields: [],
        inputs: [
          {
            name: 'BROADCAST_INPUT',
            value: { valueKind: 'entity', value: broadcastRef },
          },
        ],
      },
      {
        nodeKind: 'ordinary',
        localAlias: 'emptyIf',
        opcode: 'control_if',
        fields: [],
        inputs: [],
      },
      {
        nodeKind: 'ordinary',
        localAlias: 'show',
        opcode: 'looks_show',
        fields: [],
        inputs: [],
      },
      {
        nodeKind: 'ordinary',
        localAlias: 'cap',
        opcode: 'control_delete_this_clone',
        fields: [],
        inputs: [],
      },
    ],
  } as const satisfies SemanticStatementSequenceV1
  const primary = applyScriptStructuralOperationV1(
    project,
    {
      operation: {
        kind: 'script.add',
        opId: 'add-primary-script',
        target: CREATED_TARGET_REF,
        workspace: { x: 40, y: 80 },
        root: {
          rootKind: 'eventScript',
          hat: {
            nodeKind: 'ordinary',
            localAlias: 'flagHat',
            opcode: 'event_whenflagclicked',
            fields: [],
            inputs: [],
          },
          body: primaryBody,
        },
        expectedPlanningFactSetSha256: TEST_SHA256,
      },
      targetIndex: 1,
    },
    adapters.script
  )
  assert.equal(primary.createdBlockIds.length, 11)
  assert.equal(primary.createdTopBlockId, primary.aliasBlockIds.flagHat)
  assert.equal(primary.createdTailBlockId, primary.aliasBlockIds.cap)
  assert.ok(primary.postClosureSha256)

  const broadcastHat = applyScriptStructuralOperationV1(
    project,
    {
      operation: {
        kind: 'script.add',
        opId: 'add-broadcast-hat',
        target: CREATED_TARGET_REF,
        workspace: { x: 400, y: 80 },
        root: {
          rootKind: 'eventScript',
          hat: {
            nodeKind: 'ordinary',
            localAlias: 'broadcastHat',
            opcode: 'event_whenbroadcastreceived',
            fields: [
              {
                name: 'BROADCAST_OPTION',
                value: { valueKind: 'entity', value: broadcastRef },
              },
            ],
            inputs: [],
          },
          body: {
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
        expectedPlanningFactSetSha256: TEST_SHA256,
      },
      targetIndex: 1,
    },
    adapters.script
  )
  assert.equal(broadcastHat.createdBlockIds.length, 2)

  const firstClosure = planGraphClosureV1(
    project.json.targets[1]!,
    'script',
    primary.createdTopBlockId!
  )
  assert.equal(firstClosure.closureSha256, primary.postClosureSha256)
  assert.equal(
    validateCuratedClosureV1(
      project.json.targets[1]!.blocks,
      primary.createdTopBlockId!
    ).safeForDuplication,
    true
  )
  const referenceIndex = buildSemanticReferenceIndex(project)
  assert.equal(referenceIndex.unresolvedDeclarationUses.length, 0)
  assert.equal(referenceIndex.unresolvedBroadcastUses.length, 0)
  assert.ok(
    [...referenceIndex.inboundReferencesByEntityKey.values()].flat().length >= 3
  )
  assert.equal(
    validateProject(project).counts.error,
    0,
    JSON.stringify(validateProject(project).diagnostics)
  )
  // G1 menu shape: an entity-valued BROADCAST_INPUT lowers to the compressed
  // menu primitive [11, exact name, exact declaration id], never a shadow block
  const broadcastBlock = project.json.targets[1]!.blocks[
    primary.aliasBlockIds.broadcast!
  ] as Exclude<BlockEntry, readonly unknown[]>
  assert.deepEqual(broadcastBlock.inputs?.BROADCAST_INPUT, [
    1,
    [11, 'message1', 'broadcast-main'],
  ])
  assert.equal(
    Object.values(project.json.targets[1]!.blocks).some(
      (entry) =>
        !Array.isArray(entry) &&
        (entry as { opcode?: string }).opcode === 'event_broadcast_menu'
    ),
    false,
    'the curated menu descriptor must stay compressed, not materialize a block'
  )
  // G4 baseline: the block-operation sequence below must not introduce a
  // diagnostic code that was absent here. warnings may disappear, never appear.
  const baselineDiagnosticCodes = new Set(
    validateProject(project).diagnostics.map((diagnostic) => diagnostic.code)
  )

  const equalsId = primary.aliasBlockIds.equals!
  const reporterInsertion = applyBlockStructuralOperationV1(
    project,
    {
      operation: {
        kind: 'block.setInput',
        opId: 'set-reporter-input',
        block: CREATED_BLOCK_REF,
        inputName: 'OPERAND1',
        expectedInputFingerprint: blockInputFingerprintV1(
          1,
          equalsId,
          'OPERAND1',
          (
            project.json.targets[1]!.blocks[equalsId] as Exclude<
              BlockEntry,
              readonly unknown[]
            >
          ).inputs?.OPERAND1
        ),
        replacedInput: { kind: 'requireNoOwnedBlock' },
        value: {
          valueKind: 'block',
          value: {
            nodeKind: 'ordinary',
            localAlias: 'xReporter',
            opcode: 'motion_xposition',
            fields: [],
            inputs: [],
          },
        },
        expectedPlanningFactSetSha256: TEST_SHA256,
      },
      targetIndex: 1,
      blockId: equalsId,
      replacedInputComments: { kind: 'rejectIfPresent' },
    },
    adapters.block
  )
  const reporterId = reporterInsertion.rootBlockId!
  assertAffectedBlocks(reporterInsertion, [equalsId, reporterId])
  const obscuredInput = (
    project.json.targets[1]!.blocks[equalsId] as Exclude<
      BlockEntry,
      readonly unknown[]
    >
  ).inputs?.OPERAND1
  assert.equal(obscuredInput?.[0], 3)
  assert.equal(obscuredInput?.[1], reporterId)
  assert.deepEqual(obscuredInput?.[2], [10, 'left'])
  const reporterPlan = planGraphClosureV1(
    project.json.targets[1]!,
    'ownedBlock',
    reporterId
  )
  const reporterRemoval = applyBlockStructuralOperationV1(
    project,
    {
      operation: {
        kind: 'block.remove',
        opId: 'restore-reporter-shadow',
        block: CREATED_BLOCK_REF,
        expectedClosureSha256: reporterPlan.closureSha256,
        expectedOwnedBlockCount: reporterPlan.orderedBlockIds.length,
        sourceGap: {
          kind: 'revealExistingShadow',
          expectedCurrentInputFingerprint: blockInputFingerprintV1(
            1,
            equalsId,
            'OPERAND1',
            obscuredInput
          ),
          expectedShadowFingerprint: inputShadowFingerprintV1(
            1,
            equalsId,
            'OPERAND1',
            obscuredInput?.[2]
          ),
        },
        comments: { kind: 'rejectIfPresent' },
        expectedPlanningFactSetSha256: TEST_SHA256,
      },
      targetIndex: 1,
      blockId: reporterId,
      comments: { kind: 'rejectIfPresent' },
    },
    adapters.block
  )
  assertAffectedBlocks(reporterRemoval, [equalsId, reporterId])
  assert.deepEqual(
    (
      project.json.targets[1]!.blocks[equalsId] as Exclude<
        BlockEntry,
        readonly unknown[]
      >
    ).inputs?.OPERAND1,
    [1, [10, 'left']]
  )

  const sourceCommentId = 'primary-comment'
  const sourceCommentBlockId = primary.aliasBlockIds.setScore!
  project.uids.reserve(sourceCommentId)
  defineScratchRecordValue<Comment>(
    project.json.targets[1]!.comments!,
    sourceCommentId,
    {
      blockId: sourceCommentBlockId,
      text: 'duplicate this comment exactly',
      minimized: false,
      x: 150,
      y: 200,
      width: 180,
      height: 90,
    }
  )
  const sourceCommentBlock =
    project.json.targets[1]!.blocks[sourceCommentBlockId]
  assert.ok(sourceCommentBlock && !Array.isArray(sourceCommentBlock))
  if (!sourceCommentBlock || Array.isArray(sourceCommentBlock))
    assert.fail('source comment block is absent')
  sourceCommentBlock.comment = sourceCommentId

  const rejectedDuplicateAllocator = project.uids.snapshot()
  const rejectedDuplicateProject = JSON.stringify(project.json)
  assert.throws(
    () =>
      applyScriptStructuralOperationV1(
        project,
        {
          operation: {
            kind: 'script.duplicate',
            opId: 'reject-incomplete-duplicate-exposure',
            script: CREATED_SCRIPT_REF,
            workspace: { x: 40, y: 500 },
            comments: {
              kind: 'duplicateAll',
              layout: 'translateWithRoot',
            },
            exposeClones: [
              { sourceBlock: CREATED_BLOCK_REF, alias: 'unresolvedClone' },
            ],
            expectedPlanningFactSetSha256: TEST_SHA256,
          },
          targetIndex: 1,
          topBlockId: primary.createdTopBlockId!,
          exposedCloneSources: [],
        },
        adapters.script
      ),
    hasEditCode('edit.planning_facts_mismatch')
  )
  assert.deepEqual(project.uids.snapshot(), rejectedDuplicateAllocator)
  assert.equal(JSON.stringify(project.json), rejectedDuplicateProject)

  const duplicateAllocatorBefore = project.uids.snapshot()
  const duplicate = applyScriptStructuralOperationV1(
    project,
    {
      operation: {
        kind: 'script.duplicate',
        opId: 'duplicate-primary',
        script: CREATED_SCRIPT_REF,
        workspace: { x: 40, y: 500 },
        comments: {
          kind: 'duplicateAll',
          layout: 'translateWithRoot',
        },
        exposeClones: [
          { sourceBlock: CREATED_BLOCK_REF, alias: 'setScoreClone' },
        ],
        expectedPlanningFactSetSha256: TEST_SHA256,
      },
      targetIndex: 1,
      topBlockId: primary.createdTopBlockId!,
      exposedCloneSources: [
        {
          alias: 'setScoreClone',
          sourceBlockId: primary.aliasBlockIds.setScore!,
        },
      ],
    },
    adapters.script
  )
  assert.equal(
    new Set([...primary.createdBlockIds, ...duplicate.createdBlockIds]).size,
    primary.createdBlockIds.length + duplicate.createdBlockIds.length
  )
  assert.equal(
    duplicate.aliasBlockIds.setScoreClone,
    duplicate.clonedBlockIds[primary.aliasBlockIds.setScore!]
  )
  // G2: every internal edge of the clone must land inside the clone. a residual
  // source id anywhere in next/parent/inputs would mean an incomplete remap.
  const cloneBlockIds = new Set(duplicate.createdBlockIds)
  const sourceBlockIds = new Set(primary.createdBlockIds)
  const residualSourceEdges: string[] = []
  for (const cloneBlockId of duplicate.createdBlockIds)
  {
    const entry = project.json.targets[1]!.blocks[cloneBlockId]
    assert.ok(entry && !Array.isArray(entry))
    const block = entry as Exclude<BlockEntry, readonly unknown[]>
    for (const [edge, referenced] of [
      ['next', block.next],
      ['parent', block.parent],
    ] as const)
      if (
        typeof referenced === 'string' &&
        !cloneBlockIds.has(referenced) &&
        sourceBlockIds.has(referenced)
      )
        residualSourceEdges.push(`${cloneBlockId}.${edge} -> ${referenced}`)
    for (const [inputName, input] of Object.entries(block.inputs ?? {}))
      for (const slot of input as readonly unknown[])
        if (
          typeof slot === 'string' &&
          !cloneBlockIds.has(slot) &&
          sourceBlockIds.has(slot)
        )
          residualSourceEdges.push(
            `${cloneBlockId}.inputs.${inputName} -> ${slot}`
          )
  }
  assert.deepEqual(residualSourceEdges, [])
  // the clone must also be structurally valid while it still exists; the
  // duplicate is removed further down, which would hide any dangling edge
  const duplicateValidation = validateProject(project)
  assert.equal(
    duplicateValidation.counts.error,
    0,
    JSON.stringify(duplicateValidation.diagnostics)
  )
  const clonedCommentId = duplicate.clonedCommentIds[sourceCommentId]
  assert.ok(clonedCommentId)
  const clonedComment = project.json.targets[1]!.comments?.[clonedCommentId!]
  assert.deepEqual(clonedComment, {
    blockId: duplicate.aliasBlockIds.setScoreClone,
    text: 'duplicate this comment exactly',
    minimized: false,
    x: 150,
    y: 620,
    width: 180,
    height: 90,
  })
  const clonedCommentBlock =
    project.json.targets[1]!.blocks[duplicate.aliasBlockIds.setScoreClone!]
  assert.ok(clonedCommentBlock && !Array.isArray(clonedCommentBlock))
  if (!clonedCommentBlock || Array.isArray(clonedCommentBlock))
    assert.fail('cloned comment block is absent')
  assert.equal(clonedCommentBlock.comment, clonedCommentId)
  assert.equal(
    project.json.targets[1]!.comments?.[sourceCommentId]?.blockId,
    sourceCommentBlockId
  )
  const duplicateAllocatorAfter = project.uids.snapshot()
  const usedBeforeDuplicate = new Set(duplicateAllocatorBefore.usedIds)
  const duplicateReservedIds = duplicateAllocatorAfter.usedIds.filter(
    (id) => !usedBeforeDuplicate.has(id)
  )
  assert.deepEqual(
    [...duplicateReservedIds].sort(),
    [
      ...duplicate.createdBlockIds,
      ...Object.values(duplicate.clonedCommentIds),
    ].sort()
  )
  for (const id of duplicateReservedIds)
  {
    assert.equal(project.uids.isPending(id), false)
    assert.equal(project.uids.isTombstoned(id), true)
  }
  const duplicatePlan = planGraphClosureV1(
    project.json.targets[1]!,
    'script',
    duplicate.createdTopBlockId!
  )
  applyScriptStructuralOperationV1(
    project,
    {
      operation: {
        kind: 'script.remove',
        opId: 'remove-duplicate',
        script: CREATED_SCRIPT_REF,
        expectedClosureSha256: duplicatePlan.closureSha256,
        expectedOwnedBlockCount: duplicatePlan.orderedBlockIds.length,
        comments: {
          kind: 'deleteExact',
          comments: [CREATED_COMMENT_REF],
        },
        expectedPlanningFactSetSha256: TEST_SHA256,
      },
      targetIndex: 1,
      topBlockId: duplicate.createdTopBlockId!,
      dispositionCommentIds: [clonedCommentId!],
    },
    adapters.script
  )
  assert.equal(
    project.json.targets[1]!.blocks[duplicate.createdTopBlockId!],
    undefined
  )
  assert.equal(project.json.targets[1]!.comments?.[clonedCommentId!], undefined)

  const insertBefore = applyBlockStructuralOperationV1(
    project,
    {
      operation: {
        kind: 'block.insertBefore',
        opId: 'insert-before-score',
        anchor: CREATED_BLOCK_REF,
        tree: {
          blocks: [
            {
              nodeKind: 'ordinary',
              localAlias: 'insertedShow',
              opcode: 'looks_show',
              fields: [],
              inputs: [],
            },
          ],
        },
        expectedPlanningFactSetSha256: TEST_SHA256,
      },
      targetIndex: 1,
      anchorBlockId: primary.aliasBlockIds.setScore!,
    },
    adapters.block
  )
  const insertedShowId = insertBefore.rootBlockId!
  assertAffectedBlocks(insertBefore, [
    primary.createdTopBlockId!,
    primary.aliasBlockIds.setScore!,
    insertedShowId,
  ])
  const insertAfter = applyBlockStructuralOperationV1(
    project,
    {
      operation: {
        kind: 'block.insertAfter',
        opId: 'insert-after-show',
        anchor: CREATED_BLOCK_REF,
        tree: {
          blocks: [
            {
              nodeKind: 'ordinary',
              localAlias: 'insertedSay',
              opcode: 'looks_say',
              fields: [],
              inputs: [
                {
                  name: 'MESSAGE',
                  value: { valueKind: 'literal', value: 'inserted' },
                },
              ],
            },
          ],
        },
        expectedPlanningFactSetSha256: TEST_SHA256,
      },
      targetIndex: 1,
      anchorBlockId: insertedShowId,
    },
    adapters.block
  )
  const insertedSayId = insertAfter.rootBlockId!
  assertAffectedBlocks(insertAfter, [
    insertedShowId,
    insertedSayId,
    primary.aliasBlockIds.setScore!,
  ])
  const insertedSubstack = applyBlockStructuralOperationV1(
    project,
    {
      operation: {
        kind: 'block.insertSubstack',
        opId: 'insert-empty-substack',
        owner: CREATED_BLOCK_REF,
        inputName: 'SUBSTACK',
        expectedCurrentInputFingerprint: blockInputFingerprintV1(
          1,
          primary.aliasBlockIds.emptyIf!,
          'SUBSTACK',
          undefined
        ),
        expectedEmpty: true,
        tree: {
          blocks: [
            {
              nodeKind: 'ordinary',
              localAlias: 'substackShow',
              opcode: 'looks_show',
              fields: [],
              inputs: [],
            },
          ],
        },
        expectedPlanningFactSetSha256: TEST_SHA256,
      },
      targetIndex: 1,
      ownerBlockId: primary.aliasBlockIds.emptyIf!,
    },
    adapters.block
  )
  const substackShowId = insertedSubstack.rootBlockId!
  assertAffectedBlocks(insertedSubstack, [
    primary.aliasBlockIds.emptyIf!,
    substackShowId,
  ])
  const sayPlan = planGraphClosureV1(
    project.json.targets[1]!,
    'ownedBlock',
    insertedSayId
  )
  const replacement = applyBlockStructuralOperationV1(
    project,
    {
      operation: {
        kind: 'block.replace',
        opId: 'replace-say-with-motion',
        block: CREATED_BLOCK_REF,
        expectedClosureSha256: sayPlan.closureSha256,
        expectedOwnedBlockCount: sayPlan.orderedBlockIds.length,
        replacement: {
          replacementKind: 'statementSequence',
          value: {
            blocks: [
              {
                nodeKind: 'ordinary',
                localAlias: 'replacementMotion',
                opcode: 'motion_gotoxy',
                fields: [],
                inputs: [
                  { name: 'X', value: { valueKind: 'literal', value: 1 } },
                  { name: 'Y', value: { valueKind: 'literal', value: 2 } },
                ],
              },
            ],
          },
        },
        comments: { kind: 'rejectIfPresent' },
        expectedPlanningFactSetSha256: TEST_SHA256,
      },
      targetIndex: 1,
      blockId: insertedSayId,
      comments: { kind: 'rejectIfPresent' },
    },
    adapters.block
  )
  const motionId = replacement.rootBlockId!
  assertAffectedBlocks(replacement, [
    insertedShowId,
    insertedSayId,
    motionId,
    primary.aliasBlockIds.setScore!,
  ])
  const motionPlan = planGraphClosureV1(
    project.json.targets[1]!,
    'ownedBlock',
    motionId
  )
  const moved = applyBlockStructuralOperationV1(
    project,
    {
      operation: {
        kind: 'block.move',
        opId: 'move-motion-to-substack',
        block: CREATED_BLOCK_REF,
        expectedClosureSha256: motionPlan.closureSha256,
        destination: { kind: 'after', anchor: CREATED_BLOCK_REF },
        sourceGap: { kind: 'spliceStatements' },
        comments: {
          kind: 'preserveAttached',
          expectedCommentSetSha256: commentSetSha256V1(
            project.json.targets[1]!,
            []
          ),
          layout: 'preserveAbsolute',
        },
        expectedPlanningFactSetSha256: TEST_SHA256,
      },
      targetIndex: 1,
      blockId: motionId,
      destination: {
        kind: 'after',
        targetIndex: 1,
        blockId: substackShowId,
      },
    },
    adapters.block
  )
  assertAffectedBlocks(moved, [
    insertedShowId,
    motionId,
    primary.aliasBlockIds.setScore!,
    substackShowId,
  ])
  const movedPlan = planGraphClosureV1(
    project.json.targets[1]!,
    'ownedBlock',
    motionId
  )
  const removedMotion = applyBlockStructuralOperationV1(
    project,
    {
      operation: {
        kind: 'block.remove',
        opId: 'remove-moved-motion',
        block: CREATED_BLOCK_REF,
        expectedClosureSha256: movedPlan.closureSha256,
        expectedOwnedBlockCount: movedPlan.orderedBlockIds.length,
        sourceGap: { kind: 'spliceStatements' },
        comments: { kind: 'rejectIfPresent' },
        expectedPlanningFactSetSha256: TEST_SHA256,
      },
      targetIndex: 1,
      blockId: motionId,
      comments: { kind: 'rejectIfPresent' },
    },
    adapters.block
  )
  assertAffectedBlocks(removedMotion, [substackShowId, motionId])
  assert.equal(project.json.targets[1]!.blocks[motionId], undefined)

  const setScoreId = primary.aliasBlockIds.setScore!
  const setScore = project.json.targets[1]!.blocks[setScoreId]
  assert.ok(setScore && !Array.isArray(setScore))
  if (!setScore || Array.isArray(setScore))
    assert.fail('set score block is absent')
  const retargetedField = applyBlockStructuralOperationV1(
    project,
    {
      operation: {
        kind: 'block.setField',
        opId: 'retarget-variable-field',
        block: CREATED_BLOCK_REF,
        fieldName: 'VARIABLE',
        expectedValueFingerprint: blockFieldFingerprintV1(
          1,
          setScoreId,
          'VARIABLE',
          setScore.fields?.VARIABLE
        ),
        value: { valueKind: 'entity', value: secondaryVariableRef },
        expectedPlanningFactSetSha256: TEST_SHA256,
      },
      targetIndex: 1,
      blockId: setScoreId,
    },
    adapters.block
  )
  assertAffectedBlocks(retargetedField, [setScoreId])
  const retargetedSetScore = project.json.targets[1]!.blocks[setScoreId]
  assert.ok(retargetedSetScore && !Array.isArray(retargetedSetScore))
  if (!retargetedSetScore || Array.isArray(retargetedSetScore))
    assert.fail('retargeted set score block is absent')
  assert.deepEqual(retargetedSetScore.fields?.VARIABLE, [
    'score 2',
    'score-secondary',
  ])

  const refusalBefore = JSON.stringify(project.json)
  const movablePlan = planGraphClosureV1(
    project.json.targets[1]!,
    'ownedBlock',
    insertedShowId
  )
  const moveOperationBase = {
    block: CREATED_BLOCK_REF,
    expectedClosureSha256: movablePlan.closureSha256,
    sourceGap: { kind: 'spliceStatements' } as const,
    comments: {
      kind: 'preserveAttached' as const,
      expectedCommentSetSha256: commentSetSha256V1(
        project.json.targets[1]!,
        []
      ),
      layout: 'preserveAbsolute' as const,
    },
    expectedPlanningFactSetSha256: TEST_SHA256,
  }
  assert.throws(
    () =>
      applyBlockStructuralOperationV1(
        project,
        {
          operation: {
            ...moveOperationBase,
            kind: 'block.move',
            opId: 'reject-cross-target',
            destination: {
              kind: 'topLevelStatement',
              workspace: { target: CREATED_TARGET_REF, x: 0, y: 0 },
            },
          },
          targetIndex: 1,
          blockId: insertedShowId,
          destination: {
            kind: 'topLevelStatement',
            targetIndex: 0,
            workspace: { x: 0, y: 0 },
          },
        },
        adapters.block
      ),
    hasEditCode('edit.invalid_owner')
  )
  assert.throws(
    () =>
      applyBlockStructuralOperationV1(
        project,
        {
          operation: {
            ...moveOperationBase,
            kind: 'block.move',
            opId: 'reject-statement-input',
            destination: {
              kind: 'input',
              owner: CREATED_BLOCK_REF,
              inputName: 'OPERAND1',
              expectedCurrentInputFingerprint: blockInputFingerprintV1(
                1,
                equalsId,
                'OPERAND1',
                (
                  project.json.targets[1]!.blocks[equalsId] as Exclude<
                    BlockEntry,
                    readonly unknown[]
                  >
                ).inputs?.OPERAND1
              ),
              expectedNoOwnedBlock: true,
            },
          },
          targetIndex: 1,
          blockId: insertedShowId,
          destination: {
            kind: 'input',
            targetIndex: 1,
            blockId: equalsId,
            inputName: 'OPERAND1',
          },
        },
        adapters.block
      ),
    hasEditCode('edit.invalid_shape')
  )
  const emptyIfPlan = planGraphClosureV1(
    project.json.targets[1]!,
    'ownedBlock',
    primary.aliasBlockIds.emptyIf!
  )
  assert.throws(
    () =>
      applyBlockStructuralOperationV1(
        project,
        {
          operation: {
            kind: 'block.move',
            opId: 'reject-cycle',
            block: CREATED_BLOCK_REF,
            expectedClosureSha256: emptyIfPlan.closureSha256,
            destination: {
              kind: 'substack',
              owner: CREATED_BLOCK_REF,
              inputName: 'SUBSTACK',
              expectedCurrentInputFingerprint: blockInputFingerprintV1(
                1,
                primary.aliasBlockIds.emptyIf!,
                'SUBSTACK',
                (
                  project.json.targets[1]!.blocks[
                    primary.aliasBlockIds.emptyIf!
                  ] as Exclude<BlockEntry, readonly unknown[]>
                ).inputs?.SUBSTACK
              ),
              expectedEmpty: true,
            },
            sourceGap: { kind: 'spliceStatements' },
            comments: {
              kind: 'preserveAttached',
              expectedCommentSetSha256: commentSetSha256V1(
                project.json.targets[1]!,
                []
              ),
              layout: 'preserveAbsolute',
            },
            expectedPlanningFactSetSha256: TEST_SHA256,
          },
          targetIndex: 1,
          blockId: primary.aliasBlockIds.emptyIf!,
          destination: {
            kind: 'substack',
            targetIndex: 1,
            blockId: primary.aliasBlockIds.emptyIf!,
            inputName: 'SUBSTACK',
          },
        },
        adapters.block
      ),
    hasEditCode('edit.graph_cycle')
  )
  const hatPlan = planGraphClosureV1(
    project.json.targets[1]!,
    'ownedBlock',
    primary.createdTopBlockId!
  )
  assert.throws(
    () =>
      applyBlockStructuralOperationV1(
        project,
        {
          operation: {
            kind: 'block.remove',
            opId: 'reject-hat-remove',
            block: CREATED_BLOCK_REF,
            expectedClosureSha256: hatPlan.closureSha256,
            expectedOwnedBlockCount: hatPlan.orderedBlockIds.length,
            sourceGap: {
              kind: 'removeTopLevelScript',
              expectedScriptClosureSha256: planGraphClosureV1(
                project.json.targets[1]!,
                'script',
                primary.createdTopBlockId!
              ).closureSha256,
            },
            comments: { kind: 'rejectIfPresent' },
            expectedPlanningFactSetSha256: TEST_SHA256,
          },
          targetIndex: 1,
          blockId: primary.createdTopBlockId!,
          comments: { kind: 'rejectIfPresent' },
        },
        adapters.block
      ),
    hasEditCode('edit.hat_cap_invariant')
  )
  assert.throws(
    () =>
      applyBlockStructuralOperationV1(
        project,
        {
          operation: {
            kind: 'block.insertAfter',
            opId: 'reject-cap-successor',
            anchor: CREATED_BLOCK_REF,
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
            expectedPlanningFactSetSha256: TEST_SHA256,
          },
          targetIndex: 1,
          anchorBlockId: primary.aliasBlockIds.cap!,
        },
        adapters.block
      ),
    hasEditCode('edit.hat_cap_invariant')
  )
  assert.equal(JSON.stringify(project.json), refusalBefore)

  // G4 is asserted here, after every operation & refusal but before the raw
  // opaque roots are injected below: those bypass the operation surface entirely
  // & deliberately add an undeclared-extension warning the gate must not own.
  const operationValidation = validateProject(project)
  assert.equal(
    operationValidation.counts.error,
    0,
    JSON.stringify(operationValidation.diagnostics)
  )
  const introducedDiagnosticCodes = [
    ...new Set(
      operationValidation.diagnostics.map((diagnostic) => diagnostic.code)
    ),
  ].filter((code) => !baselineDiagnosticCodes.has(code))
  assert.deepEqual(
    introducedDiagnosticCodes,
    [],
    JSON.stringify(operationValidation.diagnostics)
  )
  const operationReferenceIndex = buildSemanticReferenceIndex(project)
  assert.equal(operationReferenceIndex.unresolvedDeclarationUses.length, 0)
  assert.equal(operationReferenceIndex.unresolvedBroadcastUses.length, 0)

  for (const [rootId, raw] of [
    [
      'unknown-root',
      {
        opcode: 'extension_unknown',
        next: null,
        parent: null,
        inputs: {},
        fields: {},
        shadow: false,
        topLevel: true,
        x: 700,
        y: 0,
      },
    ],
    [
      'opaque-root',
      {
        opcode: 'looks_show',
        next: null,
        parent: null,
        inputs: {},
        fields: {},
        shadow: false,
        topLevel: true,
        x: 700,
        y: 200,
        linkedBlockId: primary.aliasBlockIds.show,
      },
    ],
  ] as const)
  {
    project.uids.reserve(rootId)
    defineScratchRecordValue<BlockEntry>(
      project.json.targets[1]!.blocks,
      rootId,
      raw as unknown as BlockEntry
    )
    const before = JSON.stringify(project.json)
    const allocatorBefore = project.uids.snapshot()
    assert.throws(
      () =>
        applyScriptStructuralOperationV1(
          project,
          {
            operation: {
              kind: 'script.duplicate',
              opId: `reject-duplicate-${rootId}`,
              script: CREATED_SCRIPT_REF,
              workspace: { x: 900, y: 0 },
              comments: { kind: 'rejectIfPresent' },
              exposeClones: [],
              expectedPlanningFactSetSha256: TEST_SHA256,
            },
            targetIndex: 1,
            topBlockId: rootId,
            exposedCloneSources: [],
          },
          adapters.script
        ),
      hasEditCode('edit.unsupported_opcode')
    )
    assert.equal(JSON.stringify(project.json), before)
    assert.deepEqual(project.uids.snapshot(), allocatorBefore)
  }

  const finalValidation = validateProject(project)
  assert.equal(
    finalValidation.diagnostics.some((diagnostic) =>
      ['dangling-next', 'dangling-parent', 'parent-mismatch'].includes(
        diagnostic.code
      )
    ),
    false,
    JSON.stringify(finalValidation.diagnostics)
  )
  assert.equal(
    finalValidation.counts.error,
    0,
    JSON.stringify(finalValidation.diagnostics)
  )
})
