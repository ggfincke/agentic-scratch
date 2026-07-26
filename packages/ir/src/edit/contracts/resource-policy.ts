// packages/ir/src/edit/contracts/resource-policy.ts
// immutable phase 8 default & hard resource-policy authority

import type { EditLimitKeyV1 } from '../contracts.generated.js'

type Phase8ResourcePolicyUnit =
  | 'bytes'
  | 'coordinate-units'
  | 'count'
  | 'milliseconds'
  | 'pixels'
  | 'ticks'
  | 'work-units'

export interface Phase8ResourcePolicyLimit<TKey extends string = string>
{
  readonly key: TKey
  readonly resource: string
  readonly defaultValue: number
  readonly hardMaximum: number
  readonly unit: Phase8ResourcePolicyUnit
  readonly accounting: string
}

function limit<const TKey extends string>(
  key: TKey,
  resource: string,
  defaultValue: number,
  hardMaximum: number,
  unit: Phase8ResourcePolicyUnit,
  accounting: string
): Readonly<Phase8ResourcePolicyLimit<TKey>>
{
  if (
    !Number.isSafeInteger(defaultValue) ||
    defaultValue < 0 ||
    !Number.isSafeInteger(hardMaximum) ||
    hardMaximum < defaultValue
  )
  {
    throw new RangeError(`invalid Phase 8 resource limit ${key}`)
  }

  return Object.freeze({
    key,
    resource,
    defaultValue,
    hardMaximum,
    unit,
    accounting,
  })
}

const POLICY_LIMITS = Object.freeze([
  limit(
    'activeEditSessions',
    'active edit sessions',
    2,
    8,
    'count',
    'registry'
  ),
  limit(
    'sessionIdleLeaseMilliseconds',
    'session idle lease',
    30 * 60 * 1_000,
    60 * 60 * 1_000,
    'milliseconds',
    'host retention policy; calls may renew'
  ),
  limit(
    'sessionAbsoluteLeaseMilliseconds',
    'session absolute lease',
    2 * 60 * 60 * 1_000,
    4 * 60 * 60 * 1_000,
    'milliseconds',
    'host retention policy; never renewed'
  ),
  limit(
    'selectedCandidateCompressedSb3Bytes',
    'selected/candidate compressed .sb3',
    50 * 1024 * 1024,
    50 * 1024 * 1024,
    'bytes',
    'admission per artifact'
  ),
  limit(
    'projectJsonBytes',
    'project JSON',
    10 * 1024 * 1024,
    10 * 1024 * 1024,
    'bytes',
    'admission per artifact'
  ),
  limit(
    'editSourceJsonNestingDepth',
    'edit-source JSON nesting depth',
    128,
    128,
    'count',
    'iterative raw-token scan before IR'
  ),
  limit(
    'editSourceMembersPerContainer',
    'edit-source members/one container',
    100_000,
    100_000,
    'count',
    'iterative raw-token scan'
  ),
  limit(
    'editSourceTotalJsonNodes',
    'edit-source total JSON nodes',
    2_000_000,
    2_000_000,
    'count',
    'iterative raw-token scan'
  ),
  limit(
    'sourceCandidateTargetRecords',
    'source/candidate target records',
    256,
    512,
    'count',
    'exact targets entries before semantic indexing/runtime load'
  ),
  limit(
    'sourceCandidateBlockMapRecords',
    'source/candidate block-map records',
    25_000,
    50_000,
    'count',
    'object blocks + top-level primitive arrays across targets'
  ),
  limit(
    'sourceCandidateTopLevelScriptRoots',
    'source/candidate top-level script roots',
    4_096,
    8_192,
    'count',
    'exact ownership index after graph admission, before runtime load'
  ),
  limit(
    'sourceCandidateDeclarationRecords',
    'source/candidate declaration records',
    4_096,
    8_192,
    'count',
    'variables + lists + broadcasts across targets'
  ),
  limit(
    'sourceCandidateProcedureParametersPerProcedure',
    'source/candidate procedure parameters/procedure',
    64,
    128,
    'count',
    'aligned known mutation arrays + semantic signature'
  ),
  limit(
    'sourceCandidateProcedureParametersTotal',
    'source/candidate procedure parameters total',
    4_096,
    8_192,
    'count',
    'decoded known mutation entries across procedures'
  ),
  limit(
    'knownProcedureMutationArrayStringBytes',
    'one known procedure mutation array string',
    128 * 1024,
    256 * 1024,
    'bytes',
    'UTF-8 bytes before embedded JSON parse'
  ),
  limit(
    'knownProcedureMutationArrayStringsTotalBytes',
    'known procedure mutation array strings total',
    2 * 1024 * 1024,
    4 * 1024 * 1024,
    'bytes',
    'UTF-8 bytes before embedded JSON parse/index'
  ),
  limit(
    'sourceCandidateListItemsPerList',
    'source/candidate list items/list',
    25_000,
    50_000,
    'count',
    'exact stored initial/runtime list length'
  ),
  limit(
    'sourceCandidateMonitorParamsPerMonitor',
    'source/candidate monitor params/monitor',
    64,
    128,
    'count',
    'exact own params entries; scalar values only'
  ),
  limit(
    'sourceCandidateMonitorListSnapshotItemsPerMonitor',
    'source/candidate monitor list snapshot items/monitor',
    25_000,
    50_000,
    'count',
    'exact value array length for list monitors'
  ),
  limit(
    'sourceCandidateRuntimeScalarSlots',
    'source/candidate runtime scalar slots',
    100_000,
    250_000,
    'count',
    'variable values + target list items + monitor scalar/list-snapshot values + monitor param values before runtime load'
  ),
  limit(
    'sourceCandidateCommentRecords',
    'source/candidate comment records',
    4_096,
    8_192,
    'count',
    'exact comment-map entries across targets'
  ),
  limit(
    'sourceCandidateMonitorRecords',
    'source/candidate monitor records',
    4_096,
    8_192,
    'count',
    'shape-validated top-level monitor array entries before indexing/runtime load'
  ),
  limit(
    'sourceCandidateCostumeRecords',
    'source/candidate costume records',
    4_096,
    8_192,
    'count',
    'reference count, independent of unique payload count/pixels'
  ),
  limit(
    'sourceCandidateCostumesPerTarget',
    'source/candidate costumes/target',
    1_024,
    2_048,
    'count',
    'exact target costume-array length'
  ),
  limit(
    'sourceCandidateSoundRecords',
    'source/candidate sound records',
    2_048,
    4_096,
    'count',
    'reference count, independent of unique payload count/bytes'
  ),
  limit(
    'sourceCandidateSoundsPerTarget',
    'source/candidate sounds/target',
    512,
    1_024,
    'count',
    'exact target sound-array length'
  ),
  limit(
    'sourceCandidateIndexedSemanticRecords',
    'source/candidate indexed semantic records',
    50_000,
    100_000,
    'count',
    'targets + declarations + block-map records + scripts + comments + monitors + media; intentional root double-accounting'
  ),
  limit(
    'admittedAssetBytes',
    'one admitted asset',
    25 * 1024 * 1024,
    25 * 1024 * 1024,
    'bytes',
    'media admission'
  ),
  limit(
    'sourceCandidateAssetBytes',
    'total source/candidate asset bytes',
    100 * 1024 * 1024,
    100 * 1024 * 1024,
    'bytes',
    'admission per artifact'
  ),
  limit(
    'inboundMcpJsonlFrameBytes',
    'inbound MCP JSONL frame',
    128 * 1024,
    128 * 1024,
    'bytes',
    'bounded request transport before JSON parse'
  ),
  limit(
    'outboundMcpJsonlFrameBytes',
    'outbound MCP JSONL frame',
    8 * 1024 * 1024,
    8 * 1024 * 1024,
    'bytes',
    'includes base64 resource responses; measured before write'
  ),
  limit(
    'realToolsListResponseBytes',
    'real tools/list response',
    384 * 1024,
    384 * 1024,
    'bytes',
    'serialized SDK discovery response; A0 measured 358,149 bytes and proved 256 KiB unattainable without weakening or splitting the frozen profile'
  ),
  limit(
    'aggregateToolDescriptionBytes',
    'aggregate tool descriptions',
    32 * 1024,
    32 * 1024,
    'bytes',
    'subset of discovery response'
  ),
  limit(
    'canonicalSemanticChangeContractBytes',
    'canonical semantic change contract',
    256 * 1024,
    1024 * 1024,
    'bytes',
    'host registration before session begin'
  ),
  limit(
    'contractRegistrationDisplayProvenanceBytes',
    'contract registration display/provenance',
    64 * 1024,
    256 * 1024,
    'bytes',
    'excluded from semantic identity; bounded projections/labels/authority evidence'
  ),
  limit(
    'contractRegistrationJsonNestingDepth',
    'contract/registration JSON nesting depth',
    64,
    64,
    'count',
    'iterative strict scan before parse/hash'
  ),
  limit(
    'contractRegistrationMembersPerContainer',
    'contract/registration members/one container',
    16_384,
    16_384,
    'count',
    'iterative strict scan before parse/hash'
  ),
  limit(
    'contractRegistrationTotalJsonNodes',
    'contract/registration total JSON nodes',
    100_000,
    250_000,
    'count',
    'semantic + display/provenance envelope before parse/hash'
  ),
  limit(
    'contractEntityBindings',
    'contract entity bindings',
    256,
    1_024,
    'count',
    'existing + future unique binding keys'
  ),
  limit(
    'contractPredicatesAllowancesMasks',
    'contract predicates/allowances/masks',
    512,
    2_048,
    'count',
    'aggregate required + allowed + state/clone/visual masks'
  ),
  limit(
    'contractEvaluationPlans',
    'contract evaluation plans',
    16,
    64,
    'count',
    'named plans, exactly one export-required'
  ),
  limit(
    'scenarioPoliciesPerEvaluationPlan',
    'scenario policies/evaluation plan',
    8,
    16,
    'count',
    'nonempty ordered unique set; every plan reference resolves within it'
  ),
  limit(
    'laneSideScenarioCellsPerEvaluationAttempt',
    'lane-side-scenario cells/evaluation attempt',
    80,
    160,
    'count',
    'full resolved matrix before dispatch; preflight artifacts are separate'
  ),
  limit(
    'retainedPolicyBindings',
    'retained policy bindings',
    64,
    256,
    'count',
    'scenario/runtime/observation/lens/native/criterion/confidence'
  ),
  limit(
    'retainedPolicyArtifactBytes',
    'one retained policy artifact',
    256 * 1024,
    1024 * 1024,
    'bytes',
    'canonical bytes before registration'
  ),
  limit(
    'retainedPolicyJsonNestingDepth',
    'one retained policy JSON nesting depth',
    64,
    64,
    'count',
    'iterative strict scan before parse/hash'
  ),
  limit(
    'retainedPolicyMembersPerContainer',
    'one retained policy members/one container',
    16_384,
    16_384,
    'count',
    'iterative strict scan before parse/hash'
  ),
  limit(
    'retainedPolicyTotalJsonNodes',
    'one retained policy total JSON nodes',
    100_000,
    250_000,
    'count',
    'before schema/canonicalization'
  ),
  limit(
    'retainedPolicyArtifactBytesPerContract',
    'retained policy artifact bytes/contract',
    2 * 1024 * 1024,
    8 * 1024 * 1024,
    'bytes',
    'distinct content-addressed policy bytes'
  ),
  limit(
    'retainedPolicyJsonNodesPerContract',
    'retained policy JSON nodes/contract',
    500_000,
    2_000_000,
    'count',
    'aggregate distinct policy artifacts'
  ),
  limit(
    'editScenarioLoweredRequestBytes',
    'edit scenario/lowered request bytes',
    64 * 1024,
    64 * 1024,
    'bytes',
    'current DEFAULT_PROJECT_SCENARIO_LIMITS.maxRequestBytes'
  ),
  limit(
    'editScenarioNestingDepth',
    'edit scenario nesting depth',
    8,
    8,
    'count',
    'current lane parser limit'
  ),
  limit(
    'editScenarioTotalMembers',
    'edit scenario total members',
    512,
    512,
    'count',
    'current lane parser limit'
  ),
  limit(
    'editScenarioStepsPerPolicy',
    'edit scenario steps/policy',
    64,
    64,
    'count',
    'current DEFAULT_PROJECT_SCENARIO_LIMITS.maxSteps before and after lowering'
  ),
  limit(
    'editScenarioRequestedTicks',
    'edit scenario requested ticks',
    600,
    600,
    'ticks',
    'current lane parser aggregate maxTicks'
  ),
  limit(
    'editScenarioSnapshots',
    'edit scenario snapshots',
    8,
    8,
    'count',
    'current lane parser limit'
  ),
  limit(
    'editScenarioOrdinaryStringBytes',
    'edit scenario ordinary string bytes',
    256,
    256,
    'bytes',
    'current UTF-8 lane parser ordinary-string limit'
  ),
  limit(
    'editScenarioAnswerStringBytes',
    'edit scenario answer string bytes',
    4 * 1024,
    4 * 1024,
    'bytes',
    'current UTF-8 lane parser answer-string limit'
  ),
  limit(
    'editScenarioCoordinateMagnitude',
    'edit scenario coordinate magnitude',
    1_000_000,
    1_000_000,
    'coordinate-units',
    'current absolute lane parser limit'
  ),
  limit(
    'observedRuntimeListItemsPerListSnapshot',
    'observed runtime list items/list/snapshot',
    25_000,
    50_000,
    'count',
    'checked before copying one VM list'
  ),
  limit(
    'observedRuntimeScalarSlotsPerSnapshot',
    'observed runtime scalar slots/snapshot',
    100_000,
    250_000,
    'count',
    'variables + every list item across all observed originals'
  ),
  limit(
    'observedRuntimeScalarCanonicalBytes',
    'one observed runtime scalar canonical bytes',
    64 * 1024,
    256 * 1024,
    'bytes',
    'measured before retaining/copying the value'
  ),
  limit(
    'canonicalStructuredRuntimeSnapshotBytes',
    'one canonical structured runtime snapshot',
    8 * 1024 * 1024,
    32 * 1024 * 1024,
    'bytes',
    'incrementally measured exact identity-bearing snapshot'
  ),
  limit(
    'structuredRuntimeObservationRecordsPerLaneScenarioSide',
    'structured runtime observation records/lane-scenario-side',
    4_096,
    8_192,
    'count',
    'state/clone/geometry/action/issue records, excluding bounded media files'
  ),
  limit(
    'structuredRuntimeTraceBytesPerLaneScenarioSide',
    'retained structured runtime trace bytes/lane-scenario-side',
    32 * 1024 * 1024,
    128 * 1024 * 1024,
    'bytes',
    'canonical records before immutable retention; media uses separate limits'
  ),
  limit(
    'structuredRuntimeTraceBytesPerEvaluationAttempt',
    'retained structured runtime trace bytes/evaluation attempt',
    128 * 1024 * 1024,
    512 * 1024 * 1024,
    'bytes',
    'aggregate across the complete scenario matrix before dispatch/retention'
  ),
  limit(
    'serializedEditBatchBytes',
    'serialized edit batch',
    48 * 1024,
    60 * 1024,
    'bytes',
    'after JSON-RPC, before IR parse'
  ),
  limit(
    'semanticStringValueTextBytes',
    'one string/value text',
    4 * 1024,
    16 * 1024,
    'bytes',
    'before semantic parse'
  ),
  limit(
    'semanticJsonNestingDepth',
    'JSON nesting depth',
    24,
    32,
    'count',
    'before semantic parse'
  ),
  limit(
    'semanticJsonObjectArrayMembers',
    'JSON object/array members',
    4_096,
    16_384,
    'count',
    'before semantic parse'
  ),
  limit(
    'operationsPerBatch',
    'operations per batch',
    32,
    64,
    'count',
    'intent + actual'
  ),
  limit(
    'structuralMatchSetCandidatesPerSelector',
    'structural match-set candidates/selector',
    64,
    256,
    'count',
    'complete ordered set retained before exact-one/occurrence selection'
  ),
  limit(
    'newBlockNodesDescribedPerBatch',
    'new block nodes described per batch',
    512,
    2_048,
    'count',
    'intent'
  ),
  limit(
    'declaredOperationResultSlotsPerBatch',
    'declared operation result slots/batch',
    256,
    512,
    'count',
    'retained complete; response paged'
  ),
  limit(
    'targetsTouchedPerBatch',
    'targets touched per batch',
    8,
    32,
    'count',
    'actual'
  ),
  limit(
    'scriptsTouchedPerBatch',
    'scripts touched per batch',
    64,
    256,
    'count',
    'actual'
  ),
  limit(
    'blockRecordsTouchedPerBatch',
    'block records touched per batch',
    4_096,
    20_000,
    'count',
    'actual'
  ),
  limit(
    'declarationsTouchedPerBatch',
    'declarations touched per batch',
    256,
    1_024,
    'count',
    'actual'
  ),
  limit(
    'commentsTouchedPerBatch',
    'comments touched per batch',
    256,
    1_024,
    'count',
    'actual'
  ),
  limit(
    'mediaTouchedPerBatch',
    'media touched per batch',
    256,
    1_024,
    'count',
    'actual'
  ),
  limit(
    'acceptedRevisions',
    'accepted revisions',
    16,
    32,
    'count',
    'cumulative including restore; apply may not consume the final held restore slot'
  ),
  limit(
    'heldRestoreEnvelopesPerSession',
    'held restore envelopes/session',
    1,
    1,
    'count',
    'one revision slot + worst retained-candidate/delta/lineage/index/report/event/audit/work capacity'
  ),
  limit(
    'cumulativeAcceptedOperations',
    'cumulative accepted operations',
    256,
    1_024,
    'count',
    'cumulative; never refunded'
  ),
  limit(
    'rejectedAttempts',
    'rejected attempts',
    64,
    256,
    'count',
    'cumulative evidence'
  ),
  limit(
    'retainedUnappliedPreviews',
    'retained unapplied previews',
    4,
    16,
    'count',
    'evict oldest unapplied only'
  ),
  limit('checkpoints', 'checkpoints', 16, 64, 'count', 'cumulative'),
  limit(
    'admittedEditAssets',
    'admitted edit assets',
    32,
    128,
    'count',
    'cumulative'
  ),
  limit(
    'admittedEditAssetBytes',
    'admitted edit-asset bytes',
    100 * 1024 * 1024,
    200 * 1024 * 1024,
    'bytes',
    'cumulative distinct payloads'
  ),
  limit(
    'authoredCostumeTextureMaterializations',
    'authored costume texture materializations',
    16,
    32,
    'count',
    'cumulative add + replace count, including repeated/source-media payload reuse'
  ),
  limit(
    'authoredCostumeReferencePixels',
    'authored costume reference pixels',
    33_554_432,
    67_108_864,
    'pixels',
    'cumulative dimensions for every add/replacement record, never unique-payload deduplicated'
  ),
  limit(
    'authoredDecodedRgbaEstimateBytes',
    'authored decoded RGBA estimate',
    128 * 1024 * 1024,
    256 * 1024 * 1024,
    'bytes',
    '4 * authored reference pixels before renderer load'
  ),
  limit(
    'candidatePngCostumeReferencePixels',
    'candidate PNG costume-reference pixels',
    67_108_864,
    134_217_728,
    'pixels',
    'reference-counted exact dimensions'
  ),
  limit(
    'candidatePngDecodedRgbaEstimateBytes',
    'candidate PNG decoded RGBA estimate',
    256 * 1024 * 1024,
    512 * 1024 * 1024,
    'bytes',
    '4 * reference-counted pixels'
  ),
  limit('evaluationRuns', 'evaluation runs', 8, 32, 'count', 'cumulative'),
  limit(
    'externalEvidenceWaitMilliseconds',
    'external-evidence wait',
    20 * 60 * 1_000,
    60 * 60 * 1_000,
    'milliseconds',
    'one exact deadline per awaiting attempt'
  ),
  limit(
    'successfulExports',
    'successful exports',
    1,
    1,
    'count',
    'terminal V1'
  ),
  limit(
    'editArtifactBytesPerSession',
    'edit artifact bytes/session',
    512 * 1024 * 1024,
    2 * 1024 * 1024 * 1024,
    'bytes',
    'immutable evidence'
  ),
  limit(
    'retainedSessionsPerServerLifetime',
    'retained sessions/server lifetime',
    32,
    128,
    'count',
    'active + terminal evidence'
  ),
  limit(
    'begunToolResourceCallsPerServerLifetime',
    'begun tool/resource calls/server lifetime',
    3_500,
    14_000,
    'count',
    'each reserves begin + completion audit records'
  ),
  limit(
    'concurrentlyPendingToolEvidenceWork',
    'concurrently pending tool/evidence work',
    4,
    8,
    'count',
    'server-wide'
  ),
  limit(
    'semanticWorkUnitsPerServerLifetime',
    'semantic work units/server lifetime',
    5_000_000,
    20_000_000,
    'work-units',
    'indexed visits/delta leaves/descriptors'
  ),
  limit(
    'nonRunToolWallClockMilliseconds',
    'non-run tool wall-clock budget',
    60 * 1_000,
    300 * 1_000,
    'milliseconds',
    'cooperative checks + outer watchdog'
  ),
  limit(
    'auditRecordsPerServerLifetime',
    'audit records/server lifetime',
    8_192,
    32_768,
    'count',
    'begin + complete/rejected records'
  ),
  limit(
    'auditBytesPerServerLifetime',
    'audit bytes/server lifetime',
    128 * 1024 * 1024,
    512 * 1024 * 1024,
    'bytes',
    'server-wide chain'
  ),
  limit(
    'editProjectArtifactBytesPerServer',
    'edit/project artifact bytes/server',
    2 * 1024 * 1024 * 1024,
    8 * 1024 * 1024 * 1024,
    'bytes',
    'global retained evidence'
  ),
  limit('mcpPageItems', 'MCP page items', 50, 50, 'count', 'response'),
  limit(
    'mcpPageItemBytes',
    'MCP page item bytes',
    16 * 1024,
    16 * 1024,
    'bytes',
    'response projection'
  ),
  limit(
    'mcpToolDataBytes',
    'MCP tool data',
    60 * 1024,
    60 * 1024,
    'bytes',
    'response envelope'
  ),
  limit(
    'readableArtifactResourceRawBytes',
    'readable artifact resource raw bytes',
    5 * 1024 * 1024,
    5 * 1024 * 1024,
    'bytes',
    'base64+JSON must remain within outbound frame; larger evidence paged/host-only'
  ),
] as const)

type Phase8ResourcePolicyKey = (typeof POLICY_LIMITS)[number]['key']

type Phase8ResourcePolicyOverrides = Partial<
  Readonly<Record<Phase8ResourcePolicyKey, number>>
>

type ResolvedPhase8ResourcePolicy = Readonly<
  Record<Phase8ResourcePolicyKey, number>
>

function indexLimits(): Readonly<
  Record<Phase8ResourcePolicyKey, Phase8ResourcePolicyLimit>
>
{
  const result = Object.create(null) as Record<
    Phase8ResourcePolicyKey,
    Phase8ResourcePolicyLimit
  >
  for (const entry of POLICY_LIMITS)
  {
    if (Object.hasOwn(result, entry.key))
    {
      throw new Error(`duplicate Phase 8 resource limit ${entry.key}`)
    }
    result[entry.key] = entry
  }
  return Object.freeze(result)
}

function projectValues(
  field: 'defaultValue' | 'hardMaximum'
): ResolvedPhase8ResourcePolicy
{
  const result = Object.create(null) as Record<Phase8ResourcePolicyKey, number>
  for (const entry of POLICY_LIMITS)
  {
    result[entry.key] = entry[field]
  }
  return Object.freeze(result)
}

export const PHASE_8_RESOURCE_POLICY_LIMITS = POLICY_LIMITS

export const PHASE_8_RESOURCE_POLICY_CATALOG = indexLimits()

export const DEFAULT_PHASE_8_RESOURCE_POLICY = projectValues('defaultValue')

export const HARD_MAXIMUM_PHASE_8_RESOURCE_POLICY = projectValues('hardMaximum')

interface Phase8EditLimitAuthorityEntryV1
{
  readonly editLimitKey: EditLimitKeyV1
  readonly resourcePolicyKey: Phase8ResourcePolicyKey
  readonly resource: string
  readonly defaultValue: number
  readonly hardMaximum: number
  readonly unit: Phase8ResourcePolicyUnit
  readonly accounting: string
}

const EDIT_LIMIT_RESOURCE_POLICY_KEYS_V1 = Object.freeze({
  activeMatchCandidateLimit: 'structuralMatchSetCandidatesPerSelector',
  activeScenariosPerEvaluationPlanLimit: 'scenarioPoliciesPerEvaluationPlan',
  artifactBytesPerSessionLimit: 'editArtifactBytesPerSession',
  evaluationAttemptsPerSessionLimit: 'evaluationRuns',
  impactBudgetLimit: 'blockRecordsTouchedPerBatch',
  intentBudgetLimit: 'newBlockNodesDescribedPerBatch',
  laneSideScenarioCellsPerEvaluationAttemptLimit:
    'laneSideScenarioCellsPerEvaluationAttempt',
  operationsPerBatchLimit: 'operationsPerBatch',
  retainedEvidenceBytesPerSessionLimit:
    'structuredRuntimeTraceBytesPerEvaluationAttempt',
} satisfies Readonly<Record<EditLimitKeyV1, Phase8ResourcePolicyKey>>)

function indexEditLimitAuthority(): Readonly<
  Record<EditLimitKeyV1, Readonly<Phase8EditLimitAuthorityEntryV1>>
>
{
  const result = Object.create(null) as Record<
    EditLimitKeyV1,
    Readonly<Phase8EditLimitAuthorityEntryV1>
  >
  for (const [editLimitKey, resourcePolicyKey] of Object.entries(
    EDIT_LIMIT_RESOURCE_POLICY_KEYS_V1
  ) as [EditLimitKeyV1, Phase8ResourcePolicyKey][])
  {
    const limit = PHASE_8_RESOURCE_POLICY_CATALOG[resourcePolicyKey]
    result[editLimitKey] = Object.freeze({
      editLimitKey,
      resourcePolicyKey,
      resource: limit.resource,
      defaultValue: limit.defaultValue,
      hardMaximum: limit.hardMaximum,
      unit: limit.unit,
      accounting: limit.accounting,
    })
  }
  return Object.freeze(result)
}

export const PHASE_8_EDIT_LIMIT_AUTHORITY_V1 = indexEditLimitAuthority()

function assertOverrideRecord(
  value: unknown
): asserts value is Phase8ResourcePolicyOverrides
{
  if (typeof value !== 'object' || value === null || Array.isArray(value))
  {
    throw new TypeError('Phase 8 resource policy overrides must be an object')
  }

  const prototype = Object.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== null)
  {
    throw new TypeError(
      'Phase 8 resource policy overrides must be a plain object'
    )
  }
  if (Object.getOwnPropertySymbols(value).length !== 0)
  {
    throw new TypeError(
      'Phase 8 resource policy overrides cannot contain symbol keys'
    )
  }

  const descriptors = Object.getOwnPropertyDescriptors(value)
  for (const key of Object.getOwnPropertyNames(descriptors))
  {
    const descriptor = descriptors[key]
    if (!descriptor || !('value' in descriptor))
    {
      throw new TypeError(
        `Phase 8 resource policy override ${key} must be a data property`
      )
    }
    if (!Object.hasOwn(PHASE_8_RESOURCE_POLICY_CATALOG, key))
    {
      throw new RangeError(`unknown Phase 8 resource policy key ${key}`)
    }

    const typedKey = key as Phase8ResourcePolicyKey
    const override = descriptor.value
    const policyLimit = PHASE_8_RESOURCE_POLICY_CATALOG[typedKey]
    if (
      !Number.isSafeInteger(override) ||
      override < 0 ||
      override > policyLimit.defaultValue ||
      override > policyLimit.hardMaximum
    )
    {
      throw new RangeError(
        `${key} must be a nonnegative safe integer at most the Phase 8 default ${policyLimit.defaultValue} and hard maximum ${policyLimit.hardMaximum}`
      )
    }
  }
}

export function resolvePhase8ResourcePolicy(
  overrides: unknown = {}
): ResolvedPhase8ResourcePolicy
{
  assertOverrideRecord(overrides)
  const result = Object.create(null) as Record<Phase8ResourcePolicyKey, number>
  for (const entry of POLICY_LIMITS)
  {
    result[entry.key] = Object.hasOwn(overrides, entry.key)
      ? overrides[entry.key]!
      : entry.defaultValue
  }
  return Object.freeze(result)
}
