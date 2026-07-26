// packages/ir/src/edit/contracts/contract-data.ts
// frozen operation, transport, refusal, & hash inventories

import { deepFreeze } from '../support/immutable.js'

export const EDIT_TOOL_NAMES = [
  'edit_capabilities',
  'edit_begin',
  'edit_inspect',
  'edit_asset_admit',
  'edit_preview',
  'edit_apply',
  'edit_checkpoint',
  'edit_undo',
  'edit_rollback',
  'edit_evaluate',
  'edit_status',
  'edit_export',
  'edit_close',
] as const

export type EditToolName = (typeof EDIT_TOOL_NAMES)[number]

export const PROJECT_TOOL_NAMES = [
  'project_open',
  'project_inspect',
  'project_run',
  'project_status',
] as const

export const STATEFUL_EDIT_TOOL_NAMES = [
  'edit_begin',
  'edit_asset_admit',
  'edit_preview',
  'edit_apply',
  'edit_checkpoint',
  'edit_undo',
  'edit_rollback',
  'edit_evaluate',
  'edit_export',
  'edit_close',
] as const satisfies readonly EditToolName[]

export interface ReviewToolDescriptor
{
  name: EditToolName
  purpose: string
  annotations: {
    readOnlyHint: boolean
    destructiveHint: boolean
    idempotentHint: boolean
    openWorldHint: false
  }
  taskSupport: 'forbidden'
  requestMaximumBytes: number
  successDataMaximumBytes: number
  responseMaximumBytes: number
}

const READ_ONLY_TOOLS = new Set<EditToolName>([
  'edit_capabilities',
  'edit_inspect',
  'edit_status',
])

const DESTRUCTIVE_TOOLS = new Set<EditToolName>([
  'edit_apply',
  'edit_undo',
  'edit_rollback',
  'edit_export',
  'edit_close',
])

const IDEMPOTENT_TOOLS = new Set<EditToolName>([
  ...READ_ONLY_TOOLS,
  ...STATEFUL_EDIT_TOOL_NAMES,
])

const TOOL_PURPOSES: Record<EditToolName, string> = {
  edit_capabilities:
    'Page the exact Phase 8 operation, descriptor, selector, limit, and limitation manifest.',
  edit_begin:
    'Create immutable revision zero from an admitted project session or registered template.',
  edit_inspect:
    'Page one exact current or retained candidate projection, planning fact set, diff, or evidence collection.',
  edit_asset_admit:
    'Admit one digest-bound PNG or PCM-WAV input into the private edit session.',
  edit_preview:
    'Resolve, build, diff, and gate one noncommitting typed semantic batch.',
  edit_apply:
    'Atomically commit the exact retained preview as one immutable revision.',
  edit_checkpoint: 'Bind a bounded label to the exact current revision.',
  edit_undo:
    'Append one restore revision for the immediately preceding undoable apply.',
  edit_rollback:
    'Append one restore revision for an exact retained revision or checkpoint.',
  edit_evaluate:
    'Start or finalize one host-registered exact-revision evaluation plan.',
  edit_status:
    'Read session, recovery, evaluation, export-readiness, or idempotency status.',
  edit_export:
    'Publish and reopen one evaluated head at a new reserved output basename.',
  edit_close:
    'Terminally close one idle unexported session with retained evidence.',
}

export const EDIT_TOOL_DESCRIPTORS: readonly ReviewToolDescriptor[] =
  EDIT_TOOL_NAMES.map((name) => ({
    name,
    purpose: TOOL_PURPOSES[name],
    annotations: {
      readOnlyHint: READ_ONLY_TOOLS.has(name),
      destructiveHint: DESTRUCTIVE_TOOLS.has(name),
      idempotentHint: IDEMPOTENT_TOOLS.has(name),
      openWorldHint: false,
    },
    taskSupport: 'forbidden',
    requestMaximumBytes: 64 * 1024,
    successDataMaximumBytes: 60 * 1024,
    responseMaximumBytes: 64 * 1024,
  }))

export const OPERATION_KINDS = [
  'target.addSprite',
  'target.renameSprite',
  'target.reorderSprite',
  'target.removeSprite',
  'target.setSpriteProperties',
  'target.setStageProperties',
  'declaration.addVariable',
  'declaration.addList',
  'declaration.addBroadcast',
  'declaration.rename',
  'declaration.setVariableInitialValue',
  'declaration.setListInitialItems',
  'declaration.remove',
  'script.add',
  'script.duplicate',
  'script.moveWorkspace',
  'script.remove',
  'block.insertBefore',
  'block.insertAfter',
  'block.insertSubstack',
  'block.replace',
  'block.move',
  'block.remove',
  'block.setField',
  'block.setInput',
  'comment.add',
  'comment.updateText',
  'comment.move',
  'comment.attach',
  'comment.detach',
  'comment.remove',
  'procedure.add',
  'procedure.updateSignature',
  'procedure.setCallArgument',
  'procedure.remove',
  'media.addCostume',
  'media.renameCostume',
  'media.reorderCostume',
  'media.replaceCostume',
  'media.removeCostume',
  'media.addSound',
  'media.renameSound',
  'media.reorderSound',
  'media.replaceSound',
  'media.removeSound',
  'media.setCurrentCostume',
] as const

export type OperationKind = (typeof OPERATION_KINDS)[number]

export interface OperationReviewRow
{
  kind: OperationKind
  family:
    | 'target'
    | 'declaration'
    | 'script'
    | 'block'
    | 'comment'
    | 'procedure'
    | 'media'
  requiredFields: readonly string[]
  optionalFields: readonly string[]
  selectionFields: readonly string[]
  fixedResultSlots: readonly string[]
  dynamicResultSlots: readonly string[]
  readSetRule: string
  writeSetRule: string
  deleteSetRule: string
  builderKind: string
  executableGroup: 'C' | 'D' | 'E' | 'F'
}

function operation(
  kind: OperationKind,
  requiredFields: readonly string[],
  selectionFields: readonly string[],
  fixedResultSlots: readonly string[],
  dynamicResultSlots: readonly string[],
  rules: {
    read: string
    write: string
    delete?: string
    builder: string
    group: OperationReviewRow['executableGroup']
    optionalFields?: readonly string[]
  }
): OperationReviewRow
{
  return {
    kind,
    family: kind.slice(0, kind.indexOf('.')) as OperationReviewRow['family'],
    requiredFields: [
      'opId',
      'kind',
      'expectedPlanningFactSetSha256',
      ...requiredFields,
    ],
    optionalFields: rules.optionalFields ?? [],
    selectionFields,
    fixedResultSlots,
    dynamicResultSlots,
    readSetRule: rules.read,
    writeSetRule: rules.write,
    deleteSetRule: rules.delete ?? 'none',
    builderKind: rules.builder,
    executableGroup: rules.group,
  }
}

const TARGET_RULES = {
  read: 'exact target/project order and descriptor-owned reference facts',
  write:
    'exact target entity/property plus attributed project order consequences',
  builder: 'target semantic builder',
  group: 'C',
} as const

// target.addSprite is the one creating target op & belongs to Group F, not C w/ its
// siblings: a created sprite is only well-formed once it carries a first costume, so
// the op is inseparable from the media family it must co-transact w/
const TARGET_CREATION_RULES = {
  ...TARGET_RULES,
  group: 'F',
} as const

const DECLARATION_RULES = {
  read: 'exact declaration scope/value/reference/monitor facts',
  write:
    'exact declaration entity/value plus descriptor-known reference propagation',
  builder: 'declaration semantic builder',
  group: 'C',
} as const

const SCRIPT_RULES = {
  read: 'unique script ownership closure, workspace, comments, and external references',
  write:
    'exact script closure/workspace/destination and explicit comment disposition',
  builder: 'descriptor-backed script builder',
  group: 'D',
} as const

const BLOCK_RULES = {
  read: 'unique owned block closure, parent/destination, shadow, field/input, and comments',
  write:
    'exact source gap, destination, owned closure, field/input, and explicit comments',
  builder: 'descriptor-backed block graph builder',
  group: 'D',
} as const

const COMMENT_RULES = {
  read: 'exact comment record, attachment, optional layout, and target comment-map state',
  write: 'exact comment entity, attachment, text, or named layout leaves',
  builder: 'comment semantic builder',
  group: 'C',
} as const

const PROCEDURE_RULES = {
  read: 'exact definition/prototype/body/call/parameter/reporter/comment closure',
  write:
    'transactional procedure definition/prototype/body/call/argument mapping',
  builder: 'procedure mutation builder',
  group: 'E',
} as const

const MEDIA_RULES = {
  read: 'exact target media order, payload, selection, references, and reachability',
  write:
    'exact media record/order/payload plus attributed current-costume consequence',
  builder: 'admitted media semantic builder',
  group: 'F',
} as const

export const OPERATION_REVIEW_ROWS = [
  operation(
    'target.addSprite',
    ['name', 'visualLayerOrdinal', 'nameActivation', 'properties'],
    [],
    ['target'],
    [],
    TARGET_CREATION_RULES
  ),
  operation(
    'target.renameSprite',
    [
      'target',
      'expectedName',
      'newName',
      'expectedInboundReferenceSetSha256',
      'newNameActivation',
    ],
    ['target'],
    [],
    [],
    TARGET_RULES
  ),
  operation(
    'target.reorderSprite',
    [
      'target',
      'expectedVisualLayerOrdinal',
      'newVisualLayerOrdinal',
      'expectedVisualLayerOrderSha256',
    ],
    ['target'],
    [],
    [],
    TARGET_RULES
  ),
  operation(
    'target.removeSprite',
    [
      'target',
      'expectedInboundReferenceSetSha256',
      'requireFinalInboundReferenceCount',
      'expectedOwnedSurfaceSha256',
      'expectedSerializedTargetOrderSha256',
      'expectedVisualLayerOrderSha256',
    ],
    ['target'],
    [],
    [],
    { ...TARGET_RULES, delete: 'selected sprite and its exact owned surface' }
  ),
  operation(
    'target.setSpriteProperties',
    ['target', 'edits'],
    ['target'],
    [],
    [],
    TARGET_RULES
  ),
  operation(
    'target.setStageProperties',
    ['target', 'edits'],
    ['target'],
    [],
    [],
    TARGET_RULES
  ),
  operation(
    'declaration.addVariable',
    ['scope', 'name', 'cloud', 'initialValue', 'nameActivation'],
    ['scope'],
    ['declaration'],
    [],
    DECLARATION_RULES
  ),
  operation(
    'declaration.addList',
    ['scope', 'name', 'initialItems', 'nameActivation', 'expectedListMapState'],
    ['scope'],
    ['declaration'],
    [],
    DECLARATION_RULES
  ),
  operation(
    'declaration.addBroadcast',
    ['name', 'nameActivation', 'expectedStageBroadcastMapState'],
    [],
    ['declaration'],
    [],
    DECLARATION_RULES
  ),
  operation(
    'declaration.rename',
    [
      'declaration',
      'expectedName',
      'newName',
      'expectedReferenceSetSha256',
      'newNameActivation',
    ],
    ['declaration'],
    [],
    [],
    DECLARATION_RULES
  ),
  operation(
    'declaration.setVariableInitialValue',
    ['declaration', 'expectedValueFingerprintSha256', 'newValue'],
    ['declaration'],
    [],
    [],
    DECLARATION_RULES
  ),
  operation(
    'declaration.setListInitialItems',
    ['declaration', 'expectedItemsSha256', 'newItems'],
    ['declaration'],
    [],
    [],
    DECLARATION_RULES
  ),
  operation(
    'declaration.remove',
    [
      'declaration',
      'expectedReferenceSetSha256',
      'expectedMonitorSetSha256',
      'requireFinalReferenceCount',
      'requireFinalMonitorCount',
    ],
    ['declaration'],
    [],
    [],
    {
      ...DECLARATION_RULES,
      delete: 'selected declaration after exact zero reference/monitor proof',
    }
  ),
  operation(
    'script.add',
    ['target', 'workspace', 'root'],
    ['target'],
    ['script', 'rootBlock'],
    ['blockAlias'],
    SCRIPT_RULES
  ),
  operation(
    'script.duplicate',
    ['script', 'workspace', 'comments', 'exposeClones'],
    ['script', 'exposeClones.sourceBlock'],
    ['script', 'rootBlock'],
    ['cloneAlias'],
    SCRIPT_RULES
  ),
  operation(
    'script.moveWorkspace',
    ['script', 'expected', 'changes'],
    ['script'],
    [],
    [],
    SCRIPT_RULES
  ),
  operation(
    'script.remove',
    ['script', 'expectedClosureSha256', 'expectedOwnedBlockCount', 'comments'],
    ['script', 'comments'],
    [],
    [],
    {
      ...SCRIPT_RULES,
      delete: 'selected script closure and explicit deleteExact comments only',
    }
  ),
  operation(
    'block.insertBefore',
    ['anchor', 'tree'],
    ['anchor'],
    ['rootBlock'],
    ['blockAlias'],
    BLOCK_RULES
  ),
  operation(
    'block.insertAfter',
    ['anchor', 'tree'],
    ['anchor'],
    ['rootBlock'],
    ['blockAlias'],
    BLOCK_RULES
  ),
  operation(
    'block.insertSubstack',
    [
      'owner',
      'inputName',
      'expectedCurrentInputFingerprint',
      'expectedEmpty',
      'tree',
    ],
    ['owner'],
    ['rootBlock'],
    ['blockAlias'],
    BLOCK_RULES
  ),
  operation(
    'block.replace',
    [
      'block',
      'expectedClosureSha256',
      'expectedOwnedBlockCount',
      'replacement',
      'comments',
    ],
    ['block', 'comments'],
    ['rootBlock'],
    ['blockAlias'],
    {
      ...BLOCK_RULES,
      delete: 'replaced owned closure and explicit deleteExact comments only',
    }
  ),
  operation(
    'block.move',
    ['block', 'expectedClosureSha256', 'destination', 'sourceGap', 'comments'],
    ['block', 'destination', 'sourceGap', 'comments'],
    [],
    ['destinationScript', 'sourceGapRootBlock', 'blockAlias'],
    BLOCK_RULES
  ),
  operation(
    'block.remove',
    [
      'block',
      'expectedClosureSha256',
      'expectedOwnedBlockCount',
      'sourceGap',
      'comments',
    ],
    ['block', 'sourceGap', 'comments'],
    [],
    ['sourceGapRootBlock', 'blockAlias'],
    {
      ...BLOCK_RULES,
      delete: 'selected owned closure and explicit deleteExact comments only',
    }
  ),
  operation(
    'block.setField',
    ['block', 'fieldName', 'expectedValueFingerprint', 'value'],
    ['block', 'value'],
    [],
    [],
    BLOCK_RULES
  ),
  operation(
    'block.setInput',
    [
      'block',
      'inputName',
      'expectedInputFingerprint',
      'replacedInput',
      'value',
    ],
    ['block', 'replacedInput', 'value'],
    [],
    ['rootBlock', 'blockAlias'],
    BLOCK_RULES
  ),
  operation(
    'comment.add',
    ['target', 'text', 'expectedCommentMapState', 'layout', 'attachment'],
    ['target', 'attachment.block'],
    ['comment'],
    [],
    COMMENT_RULES
  ),
  operation(
    'comment.updateText',
    ['comment', 'expectedTextSha256', 'text'],
    ['comment'],
    [],
    [],
    COMMENT_RULES
  ),
  operation(
    'comment.move',
    ['comment', 'edits'],
    ['comment'],
    [],
    [],
    COMMENT_RULES
  ),
  operation(
    'comment.attach',
    ['comment', 'expectedDetached', 'block'],
    ['comment', 'block'],
    [],
    [],
    COMMENT_RULES
  ),
  operation(
    'comment.detach',
    ['comment', 'expectedBlock'],
    ['comment', 'expectedBlock'],
    [],
    [],
    COMMENT_RULES
  ),
  operation(
    'comment.remove',
    ['comment', 'expectedSemanticFingerprint'],
    ['comment'],
    [],
    [],
    { ...COMMENT_RULES, delete: 'selected comment only' }
  ),
  operation(
    'procedure.add',
    [
      'target',
      'workspace',
      'signature',
      'expectedProspectiveProcedureCollisionSetSha256',
      'requireExistingProspectiveCollisionCount',
    ],
    ['target'],
    ['procedure', 'definitionScript'],
    ['parameter', 'blockAlias'],
    { ...PROCEDURE_RULES, optionalFields: ['body'] }
  ),
  operation(
    'procedure.updateSignature',
    [
      'procedure',
      'expectedSignatureSha256',
      'signature',
      'parameterLineage',
      'prototypeReporters',
      'bodyParameterReporters',
      'callSites',
      'expectedCallSetSha256',
      'expectedProspectiveProcedureCollisionSetSha256',
      'requireFinalExternalProspectiveCollisionCount',
    ],
    [
      'procedure',
      'parameterLineage',
      'prototypeReporters',
      'bodyParameterReporters',
      'callSites',
    ],
    [],
    ['parameter', 'blockAlias'],
    PROCEDURE_RULES
  ),
  operation(
    'procedure.setCallArgument',
    [
      'call',
      'procedure',
      'parameter',
      'expectedSignatureSha256',
      'expectedInputFingerprint',
      'replacedInput',
      'value',
    ],
    ['call', 'procedure', 'parameter', 'replacedInput', 'value'],
    [],
    ['rootBlock', 'blockAlias'],
    PROCEDURE_RULES
  ),
  operation(
    'procedure.remove',
    [
      'procedure',
      'expectedCallSetSha256',
      'expectedExternalArgumentReporterSetSha256',
      'requireFinalCallCount',
      'requireFinalExternalArgumentReporterCount',
      'expectedOwnedClosureSha256',
      'expectedOwnedBlockCount',
      'comments',
    ],
    ['procedure', 'comments'],
    [],
    [],
    {
      ...PROCEDURE_RULES,
      delete:
        'definition/prototype/body closure and explicit deleteExact comments only',
    }
  ),
  operation(
    'media.addCostume',
    [
      'target',
      'asset',
      'name',
      'order',
      'nameActivation',
      'placement',
      'expectedCostumeOrderSha256',
      'currentSelection',
      'expectedFinalCurrentCostumeState',
    ],
    ['target', 'asset', 'currentSelection'],
    ['media'],
    [],
    MEDIA_RULES
  ),
  operation(
    'media.renameCostume',
    [
      'media',
      'expectedName',
      'newName',
      'expectedReferenceSetSha256',
      'newNameActivation',
    ],
    ['media'],
    [],
    [],
    MEDIA_RULES
  ),
  operation(
    'media.reorderCostume',
    [
      'media',
      'expectedIndex',
      'newIndex',
      'expectedMediaOrderSha256',
      'currentSelection',
      'expectedFinalCurrentCostumeState',
    ],
    ['media', 'currentSelection'],
    [],
    [],
    MEDIA_RULES
  ),
  operation(
    'media.replaceCostume',
    ['media', 'expectedPayloadSha256', 'asset', 'placement'],
    ['media', 'asset'],
    [],
    [],
    MEDIA_RULES
  ),
  operation(
    'media.removeCostume',
    [
      'media',
      'expectedReferenceSetSha256',
      'requireFinalReferenceCount',
      'expectedCurrentCostume',
      'expectedCostumeCount',
      'requireFinalCostumeCountAtLeast',
      'currentSelection',
      'expectedFinalCurrentCostumeState',
      'expectedReachabilitySha256',
    ],
    ['media', 'currentSelection'],
    [],
    [],
    {
      ...MEDIA_RULES,
      delete: 'selected costume record only; archive payload remains protected',
    }
  ),
  operation(
    'media.addSound',
    ['target', 'asset', 'name', 'order', 'nameActivation'],
    ['target', 'asset'],
    ['media'],
    [],
    MEDIA_RULES
  ),
  operation(
    'media.renameSound',
    [
      'media',
      'expectedName',
      'newName',
      'expectedReferenceSetSha256',
      'newNameActivation',
    ],
    ['media'],
    [],
    [],
    MEDIA_RULES
  ),
  operation(
    'media.reorderSound',
    ['media', 'expectedIndex', 'newIndex', 'expectedMediaOrderSha256'],
    ['media'],
    [],
    [],
    MEDIA_RULES
  ),
  operation(
    'media.replaceSound',
    ['media', 'expectedPayloadSha256', 'asset'],
    ['media', 'asset'],
    [],
    [],
    MEDIA_RULES
  ),
  operation(
    'media.removeSound',
    [
      'media',
      'expectedReferenceSetSha256',
      'requireFinalReferenceCount',
      'expectedReachabilitySha256',
    ],
    ['media'],
    [],
    [],
    {
      ...MEDIA_RULES,
      delete: 'selected sound record only; archive payload remains protected',
    }
  ),
  operation(
    'media.setCurrentCostume',
    ['target', 'media', 'currentSelection', 'expectedFinalCurrentCostumeIndex'],
    ['target', 'media', 'currentSelection'],
    [],
    [],
    MEDIA_RULES
  ),
] as const satisfies readonly OperationReviewRow[]

export const SEMANTIC_HASH_DOMAINS = [
  'semantic-source',
  'semantic-location',
  'semantic-fingerprint',
  'capability-profile',
  'capability-snapshot',
  'change-contract',
  'scenario-policy',
  'transport-request',
  'resolved-semantic-batch',
  'resolved-plan',
  'lineage',
  'allocator',
  'delta',
  'preservation',
  'diagnostic',
  'revision',
  'history',
  'evidence-content',
  'certificate',
  'semantic-event',
  'semantic-report-projection',
  'server-audit',
] as const

export const REFUSAL_CODES = [
  'edit.archive_conflict',
  'edit.artifact_quota_exceeded',
  'edit.asset_digest_mismatch',
  'edit.asset_metadata_mismatch',
  'edit.audit_failed',
  'edit.capacity_exceeded',
  'edit.cardinality_mismatch',
  'edit.created_result_invalid',
  'edit.cursor_invalid',
  'edit.cursor_stale',
  'edit.duplicate_op_id',
  'edit.dynamic_reference',
  'edit.entity_still_referenced',
  'edit.evaluation_failed',
  'edit.evaluation_inconclusive',
  'edit.evaluation_unavailable',
  'edit.export_proof_failed',
  'edit.export_reopen_failed',
  'edit.export_write_failed',
  'edit.external_evidence_cancelled',
  'edit.external_evidence_expired',
  'edit.fingerprint_mismatch',
  'edit.graph_cycle',
  'edit.graph_failed',
  'edit.handle_kind_mismatch',
  'edit.hat_cap_invariant',
  'edit.idempotency_not_found',
  'edit.impact_budget_exceeded',
  'edit.intent_budget_exceeded',
  'edit.internal_invariant',
  'edit.interrupted',
  'edit.invalid_move',
  'edit.invalid_owner',
  'edit.invalid_payload',
  'edit.invalid_shape',
  'edit.last_costume',
  'edit.media_order_reference',
  'edit.members_exceeded',
  'edit.nesting_exceeded',
  'edit.output_exists',
  'edit.output_invalid',
  'edit.pending_external_evidence',
  'edit.planning_facts_mismatch',
  'edit.planning_facts_unavailable',
  'edit.postcondition_failed',
  'edit.preview_apply_mismatch',
  'edit.procedure_ambiguous',
  'edit.project_constraint',
  'edit.protected_change',
  'edit.publication_interference',
  'edit.publication_unavailable',
  'edit.recovery_required',
  'edit.reference_propagation_incomplete',
  'edit.request_id_conflict',
  'edit.request_too_large',
  'edit.retention_failed',
  'edit.runtime_budget_exceeded',
  'edit.schema_failed',
  'edit.selector_ambiguous',
  'edit.selector_no_match',
  'edit.semantic_noop',
  'edit.session_budget_exceeded',
  'edit.session_busy',
  'edit.session_closed',
  'edit.session_not_found',
  'edit.shadow_invariant',
  'edit.source_identity_mismatch',
  'edit.source_not_editable',
  'edit.source_overwrite_denied',
  'edit.stale_candidate',
  'edit.stale_capability_profile',
  'edit.stale_capability_snapshot',
  'edit.stale_certificate',
  'edit.stale_contract',
  'edit.stale_handle',
  'edit.stale_preview',
  'edit.stale_revision',
  'edit.static_regression',
  'edit.string_too_large',
  'edit.unattributed_change',
  'edit.unauthorized_change',
  'edit.unknown_field',
  'edit.unknown_field_change',
  'edit.unsupported_extension',
  'edit.unsupported_media',
  'edit.unsupported_opcode',
  'edit.unsupported_operation',
  'edit.unsupported_schema',
] as const

export type RefusalCode = (typeof REFUSAL_CODES)[number]

const ALL_STATEFUL_TOOLS = [
  ...STATEFUL_EDIT_TOOL_NAMES,
] as readonly EditToolName[]

const SESSION_TOOLS = [
  'edit_inspect',
  'edit_asset_admit',
  'edit_preview',
  'edit_apply',
  'edit_checkpoint',
  'edit_undo',
  'edit_rollback',
  'edit_evaluate',
  'edit_status',
  'edit_export',
  'edit_close',
] as const satisfies readonly EditToolName[]

const HEAD_TOOLS = [
  'edit_inspect',
  'edit_asset_admit',
  'edit_preview',
  'edit_apply',
  'edit_checkpoint',
  'edit_undo',
  'edit_rollback',
  'edit_evaluate',
  'edit_export',
  'edit_close',
] as const satisfies readonly EditToolName[]

const ACTIVE_MUTATION_TOOLS = [
  'edit_asset_admit',
  'edit_preview',
  'edit_apply',
  'edit_checkpoint',
  'edit_undo',
  'edit_rollback',
  'edit_evaluate',
  'edit_export',
  'edit_close',
] as const satisfies readonly EditToolName[]

type RefusalFamily =
  | 'protocol'
  | 'resource'
  | 'session'
  | 'concurrency'
  | 'selector-planning'
  | 'capability'
  | 'reference'
  | 'graph'
  | 'integrity'
  | 'validation'
  | 'preservation'
  | 'budget'
  | 'evaluation'
  | 'export'
  | 'invariant'

type RefusalState =
  | 'request-boundary'
  | 'opening'
  | 'active'
  | 'awaitingExternalEvidence'
  | 'exporting'
  | 'recovery-required'
  | 'terminal'
  | 'any'

export type RefusalContextField =
  | 'expectedRevisionId'
  | 'currentRevisionId'
  | 'expectedCandidateSha256'
  | 'currentCandidateSha256'
  | 'opId'
  | 'semanticSurface'
  | 'matchCount'
  | 'limit'
  | 'observed'
  | 'evidenceId'

interface RefusalReviewRow
{
  code: RefusalCode
  family: RefusalFamily
  tools: readonly EditToolName[]
  states: readonly RefusalState[]
  callerReachable: boolean
  contextFields: readonly RefusalContextField[]
  wireDisposition: 'tool-refusal' | 'fatal-unaudited-boundary'
}

type RefusalReviewSpec = Omit<
  RefusalReviewRow,
  'code' | 'contextFields' | 'wireDisposition'
>

function refusalSpec(
  family: RefusalFamily,
  tools: readonly EditToolName[],
  states: readonly RefusalState[],
  callerReachable = true
): RefusalReviewSpec
{
  return { family, tools, states, callerReachable }
}

const REFUSAL_SPECS = {
  'edit.archive_conflict': refusalSpec(
    'integrity',
    ['edit_begin', 'edit_preview', 'edit_apply'],
    ['opening', 'active']
  ),
  'edit.artifact_quota_exceeded': refusalSpec('budget', ALL_STATEFUL_TOOLS, [
    'opening',
    'active',
    'exporting',
  ]),
  'edit.asset_digest_mismatch': refusalSpec(
    'integrity',
    ['edit_begin', 'edit_asset_admit', 'edit_preview'],
    ['opening', 'active']
  ),
  'edit.asset_metadata_mismatch': refusalSpec(
    'integrity',
    ['edit_begin', 'edit_asset_admit', 'edit_preview'],
    ['opening', 'active']
  ),
  'edit.audit_failed': refusalSpec(
    'invariant',
    ALL_STATEFUL_TOOLS,
    ['any'],
    false
  ),
  'edit.capacity_exceeded': refusalSpec(
    'session',
    ['edit_begin', 'edit_asset_admit', 'edit_preview', 'edit_evaluate'],
    ['opening', 'active']
  ),
  'edit.cardinality_mismatch': refusalSpec(
    'selector-planning',
    ['edit_inspect', 'edit_preview'],
    ['active']
  ),
  'edit.created_result_invalid': refusalSpec(
    'reference',
    ['edit_preview'],
    ['active']
  ),
  'edit.cursor_invalid': refusalSpec(
    'protocol',
    ['edit_capabilities', 'edit_inspect'],
    ['request-boundary']
  ),
  'edit.cursor_stale': refusalSpec(
    'concurrency',
    ['edit_capabilities', 'edit_inspect'],
    ['active']
  ),
  'edit.duplicate_op_id': refusalSpec(
    'protocol',
    ['edit_preview'],
    ['request-boundary']
  ),
  'edit.dynamic_reference': refusalSpec(
    'reference',
    ['edit_preview'],
    ['active']
  ),
  'edit.entity_still_referenced': refusalSpec(
    'reference',
    ['edit_preview'],
    ['active']
  ),
  'edit.evaluation_failed': refusalSpec(
    'evaluation',
    ['edit_evaluate', 'edit_export'],
    ['active']
  ),
  'edit.evaluation_inconclusive': refusalSpec(
    'evaluation',
    ['edit_evaluate', 'edit_export'],
    ['active']
  ),
  'edit.evaluation_unavailable': refusalSpec(
    'evaluation',
    ['edit_evaluate', 'edit_export'],
    ['active']
  ),
  'edit.export_proof_failed': refusalSpec(
    'export',
    ['edit_export'],
    ['exporting', 'recovery-required']
  ),
  'edit.export_reopen_failed': refusalSpec(
    'export',
    ['edit_export'],
    ['exporting', 'recovery-required']
  ),
  'edit.export_write_failed': refusalSpec(
    'export',
    ['edit_export'],
    ['exporting', 'recovery-required']
  ),
  'edit.external_evidence_cancelled': refusalSpec(
    'evaluation',
    ['edit_evaluate'],
    ['awaitingExternalEvidence']
  ),
  'edit.external_evidence_expired': refusalSpec(
    'evaluation',
    ['edit_evaluate'],
    ['awaitingExternalEvidence']
  ),
  'edit.fingerprint_mismatch': refusalSpec(
    'selector-planning',
    ['edit_inspect', 'edit_preview'],
    ['active']
  ),
  'edit.graph_cycle': refusalSpec('graph', ['edit_preview'], ['active']),
  'edit.graph_failed': refusalSpec(
    'validation',
    ['edit_begin', 'edit_preview', 'edit_apply'],
    ['opening', 'active']
  ),
  'edit.handle_kind_mismatch': refusalSpec(
    'selector-planning',
    ['edit_inspect', 'edit_preview'],
    ['active']
  ),
  'edit.hat_cap_invariant': refusalSpec('graph', ['edit_preview'], ['active']),
  'edit.idempotency_not_found': refusalSpec(
    'protocol',
    ['edit_status'],
    ['request-boundary']
  ),
  'edit.impact_budget_exceeded': refusalSpec(
    'budget',
    ['edit_preview'],
    ['active']
  ),
  'edit.intent_budget_exceeded': refusalSpec(
    'budget',
    ['edit_preview'],
    ['active']
  ),
  'edit.internal_invariant': refusalSpec(
    'invariant',
    ALL_STATEFUL_TOOLS,
    ['any'],
    false
  ),
  'edit.interrupted': refusalSpec('session', ACTIVE_MUTATION_TOOLS, [
    'terminal',
  ]),
  'edit.invalid_move': refusalSpec('graph', ['edit_preview'], ['active']),
  'edit.invalid_owner': refusalSpec('graph', ['edit_preview'], ['active']),
  'edit.invalid_payload': refusalSpec('protocol', EDIT_TOOL_NAMES, [
    'request-boundary',
  ]),
  'edit.invalid_shape': refusalSpec('graph', ['edit_preview'], ['active']),
  'edit.last_costume': refusalSpec('reference', ['edit_preview'], ['active']),
  'edit.media_order_reference': refusalSpec(
    'reference',
    ['edit_preview'],
    ['active']
  ),
  'edit.members_exceeded': refusalSpec('resource', EDIT_TOOL_NAMES, [
    'request-boundary',
  ]),
  'edit.nesting_exceeded': refusalSpec('resource', EDIT_TOOL_NAMES, [
    'request-boundary',
  ]),
  'edit.output_exists': refusalSpec('export', ['edit_export'], ['active']),
  'edit.output_invalid': refusalSpec('export', ['edit_export'], ['active']),
  'edit.pending_external_evidence': refusalSpec(
    'evaluation',
    ['edit_evaluate', 'edit_export'],
    ['awaitingExternalEvidence']
  ),
  'edit.planning_facts_mismatch': refusalSpec(
    'selector-planning',
    ['edit_inspect', 'edit_preview'],
    ['active']
  ),
  'edit.planning_facts_unavailable': refusalSpec(
    'selector-planning',
    ['edit_inspect', 'edit_preview'],
    ['active']
  ),
  'edit.postcondition_failed': refusalSpec(
    'validation',
    ['edit_preview', 'edit_apply', 'edit_evaluate'],
    ['active']
  ),
  'edit.preview_apply_mismatch': refusalSpec(
    'invariant',
    ['edit_apply'],
    ['active']
  ),
  'edit.procedure_ambiguous': refusalSpec(
    'reference',
    ['edit_preview'],
    ['active']
  ),
  'edit.project_constraint': refusalSpec(
    'capability',
    ['edit_begin', 'edit_preview'],
    ['opening', 'active']
  ),
  'edit.protected_change': refusalSpec(
    'preservation',
    ['edit_preview', 'edit_apply'],
    ['active']
  ),
  'edit.publication_interference': refusalSpec(
    'export',
    ['edit_export'],
    ['exporting', 'recovery-required']
  ),
  'edit.publication_unavailable': refusalSpec(
    'export',
    ['edit_export'],
    ['active']
  ),
  'edit.recovery_required': refusalSpec('session', ACTIVE_MUTATION_TOOLS, [
    'recovery-required',
  ]),
  'edit.reference_propagation_incomplete': refusalSpec(
    'reference',
    ['edit_preview'],
    ['active']
  ),
  'edit.request_id_conflict': refusalSpec('protocol', ALL_STATEFUL_TOOLS, [
    'request-boundary',
  ]),
  'edit.request_too_large': refusalSpec('resource', EDIT_TOOL_NAMES, [
    'request-boundary',
  ]),
  'edit.retention_failed': refusalSpec(
    'invariant',
    ALL_STATEFUL_TOOLS,
    ['any'],
    false
  ),
  'edit.runtime_budget_exceeded': refusalSpec(
    'budget',
    ['edit_preview', 'edit_apply', 'edit_evaluate'],
    ['active']
  ),
  'edit.schema_failed': refusalSpec(
    'validation',
    ['edit_begin', 'edit_preview', 'edit_apply'],
    ['opening', 'active']
  ),
  'edit.selector_ambiguous': refusalSpec(
    'selector-planning',
    ['edit_inspect', 'edit_preview'],
    ['active']
  ),
  'edit.selector_no_match': refusalSpec(
    'selector-planning',
    ['edit_inspect', 'edit_preview'],
    ['active']
  ),
  'edit.semantic_noop': refusalSpec('validation', ['edit_preview'], ['active']),
  'edit.session_budget_exceeded': refusalSpec('budget', ALL_STATEFUL_TOOLS, [
    'opening',
    'active',
  ]),
  'edit.session_busy': refusalSpec('session', ACTIVE_MUTATION_TOOLS, [
    'active',
  ]),
  'edit.session_closed': refusalSpec('session', ACTIVE_MUTATION_TOOLS, [
    'terminal',
  ]),
  'edit.session_not_found': refusalSpec(
    'session',
    ['edit_capabilities', ...SESSION_TOOLS],
    ['request-boundary']
  ),
  'edit.shadow_invariant': refusalSpec('graph', ['edit_preview'], ['active']),
  'edit.source_identity_mismatch': refusalSpec(
    'integrity',
    [
      'edit_capabilities',
      'edit_begin',
      'edit_preview',
      'edit_apply',
      'edit_export',
    ],
    ['opening', 'active', 'exporting']
  ),
  'edit.source_not_editable': refusalSpec(
    'validation',
    ['edit_begin'],
    ['opening']
  ),
  'edit.source_overwrite_denied': refusalSpec(
    'export',
    ['edit_export'],
    ['active']
  ),
  'edit.stale_candidate': refusalSpec('concurrency', HEAD_TOOLS, ['active']),
  'edit.stale_capability_profile': refusalSpec(
    'concurrency',
    ['edit_capabilities', 'edit_begin', ...HEAD_TOOLS],
    ['opening', 'active']
  ),
  'edit.stale_capability_snapshot': refusalSpec(
    'concurrency',
    ['edit_begin', ...HEAD_TOOLS],
    ['opening', 'active']
  ),
  'edit.stale_certificate': refusalSpec(
    'evaluation',
    ['edit_export'],
    ['active']
  ),
  'edit.stale_contract': refusalSpec(
    'concurrency',
    ['edit_begin', ...HEAD_TOOLS],
    ['opening', 'active']
  ),
  'edit.stale_handle': refusalSpec(
    'selector-planning',
    ['edit_inspect', 'edit_preview'],
    ['active']
  ),
  'edit.stale_preview': refusalSpec('concurrency', ['edit_apply'], ['active']),
  'edit.stale_revision': refusalSpec(
    'concurrency',
    ['edit_capabilities', ...HEAD_TOOLS],
    ['active']
  ),
  'edit.static_regression': refusalSpec(
    'validation',
    ['edit_preview', 'edit_apply', 'edit_evaluate'],
    ['active']
  ),
  'edit.string_too_large': refusalSpec('resource', EDIT_TOOL_NAMES, [
    'request-boundary',
  ]),
  'edit.unattributed_change': refusalSpec(
    'preservation',
    ['edit_preview', 'edit_apply'],
    ['active']
  ),
  'edit.unauthorized_change': refusalSpec(
    'preservation',
    ['edit_preview', 'edit_apply'],
    ['active']
  ),
  'edit.unknown_field': refusalSpec('protocol', EDIT_TOOL_NAMES, [
    'request-boundary',
  ]),
  'edit.unknown_field_change': refusalSpec(
    'preservation',
    ['edit_preview', 'edit_apply'],
    ['active']
  ),
  'edit.unsupported_extension': refusalSpec(
    'capability',
    ['edit_begin', 'edit_preview'],
    ['opening', 'active']
  ),
  'edit.unsupported_media': refusalSpec(
    'capability',
    ['edit_begin', 'edit_asset_admit', 'edit_preview'],
    ['opening', 'active']
  ),
  'edit.unsupported_opcode': refusalSpec(
    'capability',
    ['edit_preview'],
    ['active']
  ),
  'edit.unsupported_operation': refusalSpec(
    'capability',
    ['edit_inspect', 'edit_preview'],
    ['active']
  ),
  'edit.unsupported_schema': refusalSpec('protocol', EDIT_TOOL_NAMES, [
    'request-boundary',
  ]),
} as const satisfies Record<RefusalCode, RefusalReviewSpec>

const REFUSAL_CONTEXT_FIELDS: Partial<
  Record<RefusalCode, readonly RefusalContextField[]>
> = {
  'edit.cardinality_mismatch': ['opId', 'matchCount'],
  'edit.created_result_invalid': ['opId'],
  'edit.duplicate_op_id': ['opId'],
  'edit.dynamic_reference': ['opId', 'semanticSurface'],
  'edit.entity_still_referenced': ['opId', 'semanticSurface', 'matchCount'],
  'edit.evaluation_failed': ['evidenceId'],
  'edit.evaluation_inconclusive': ['evidenceId'],
  'edit.evaluation_unavailable': ['evidenceId'],
  'edit.external_evidence_cancelled': ['evidenceId'],
  'edit.external_evidence_expired': ['evidenceId'],
  'edit.fingerprint_mismatch': ['opId'],
  'edit.handle_kind_mismatch': ['opId', 'semanticSurface'],
  'edit.impact_budget_exceeded': ['limit', 'observed'],
  'edit.intent_budget_exceeded': ['limit', 'observed'],
  'edit.invalid_move': ['opId'],
  'edit.invalid_owner': ['opId'],
  'edit.invalid_shape': ['opId'],
  'edit.last_costume': ['opId', 'matchCount'],
  'edit.media_order_reference': ['opId'],
  'edit.members_exceeded': ['limit', 'observed'],
  'edit.nesting_exceeded': ['limit', 'observed'],
  'edit.pending_external_evidence': ['evidenceId'],
  'edit.planning_facts_mismatch': ['opId'],
  'edit.planning_facts_unavailable': ['opId'],
  'edit.postcondition_failed': ['opId', 'semanticSurface'],
  'edit.preview_apply_mismatch': [
    'expectedRevisionId',
    'currentRevisionId',
    'expectedCandidateSha256',
    'currentCandidateSha256',
  ],
  'edit.procedure_ambiguous': ['opId', 'matchCount'],
  'edit.protected_change': ['opId', 'semanticSurface'],
  'edit.reference_propagation_incomplete': [
    'opId',
    'semanticSurface',
    'matchCount',
  ],
  'edit.request_too_large': ['limit', 'observed'],
  'edit.runtime_budget_exceeded': ['limit', 'observed'],
  'edit.selector_ambiguous': ['opId', 'matchCount'],
  'edit.selector_no_match': ['opId', 'matchCount'],
  'edit.semantic_noop': ['opId', 'semanticSurface'],
  'edit.session_budget_exceeded': ['limit', 'observed'],
  'edit.shadow_invariant': ['opId'],
  'edit.stale_candidate': ['expectedCandidateSha256', 'currentCandidateSha256'],
  'edit.stale_handle': ['opId'],
  'edit.stale_revision': ['expectedRevisionId', 'currentRevisionId'],
  'edit.static_regression': ['evidenceId'],
  'edit.string_too_large': ['limit', 'observed'],
  'edit.unattributed_change': ['opId', 'semanticSurface'],
  'edit.unauthorized_change': ['opId', 'semanticSurface'],
  'edit.unknown_field_change': ['opId', 'semanticSurface'],
  'edit.unsupported_opcode': ['opId'],
  'edit.unsupported_operation': ['opId'],
} as const

export const REFUSAL_REVIEW_ROWS: readonly RefusalReviewRow[] =
  REFUSAL_CODES.map((code) => ({
    code,
    ...REFUSAL_SPECS[code],
    contextFields: REFUSAL_CONTEXT_FIELDS[code] ?? [],
    wireDisposition:
      code === 'edit.audit_failed'
        ? 'fatal-unaudited-boundary'
        : 'tool-refusal',
  }))

export const RESOURCE_CONTRACT = {
  scheme: 'scratch-edit',
  authority: 'artifact',
  uriTemplate: 'scratch-edit://artifact/<opaque-resource-id>',
  uriCharacters: 132,
  allowQuery: false,
  allowFragment: false,
  allowAdditionalPathSegments: false,
  tokenEncoding: 'base64url-unpadded',
  tokenVersion: 1,
  tokenRawBytes: 81,
  tokenCharacters: 108,
  opaqueTokenMaximumAsciiBytes: 128,
  components: {
    versionBytes: 1,
    sessionStoreKeyBytes: 16,
    locatorDigestBytes: 32,
    hmacSha256Bytes: 32,
  },
  locatorKinds: ['retained-artifact', 'exact-virtual-slice'] as const,
  hmacAlgorithm: 'HMAC-SHA-256',
  hmacKeyPurpose: 'scratch-edit-resource-capability-v1',
  hmacSecretScope: 'per-process-resource-purpose',
  hmacSecretSeparation: [
    'semantic-hash',
    'semantic-handle',
    'pagination-cursor',
    'server-audit-tail',
  ] as const,
  hmacPreimage: {
    domainPrefixUtf8: 'scratch-agent:resource-capability:v1',
    separatorByteHex: '00',
    composition:
      'UTF8(domainPrefixUtf8) || 0x00 || UTF8(CanonicalJsonV1(payload))',
    payloadEncoding: 'CanonicalJsonV1',
    payloadType: 'ScratchEditResourceMacInputV1',
    closedFields: {
      schemaVersion: 1,
      tokenVersion: 1,
      sessionStoreKeyEncoding: 'lowercase-hex-16-bytes',
      principalIdentity: 'authenticated-principal-sha256',
      sessionId: 'opaque-session-id',
      revisionOrStoreIdentity: 'closed-revision-or-store-identity',
      locatorKind: 'retained-artifact-or-exact-virtual-slice',
      locatorDigest: 'lowercase-hex-sha256',
      contentSha256: 'lowercase-hex-sha256',
      mimeType: 'exact-retained-mime-type',
      byteLength: 'safe-nonnegative-integer',
    },
    tokenTagCoversVersionAndSessionStoreKey: true,
  },
  hmacClaims: [
    'schemaVersion',
    'tokenVersion',
    'sessionStoreKey',
    'principalIdentity',
    'sessionId',
    'revisionOrStoreIdentity',
    'locatorKind',
    'locatorDigest',
    'contentSha256',
    'mimeType',
    'byteLength',
  ] as const,
  resolution: {
    catalogue: 'existing-retained-only',
    requiredMatchCount: 1,
    missingDisposition: 'refuse',
    collisionDisposition: 'refuse',
    catalogueSuppliesAllHmacClaims: true,
    recheckAllHmacClaimsAgainstRetainedEvidence: true,
    recheckRetainedBytes: true,
    lookupBeforeTagPolicy:
      'bounded-exact-session-store-key-and-locator-digest-only',
    verifyTagBeforeContentRead: true,
    tagComparison: 'constant-time-exact-32-byte',
    rejectUnknownTokenVersion: true,
    authenticationFailureDisposition:
      'uniform-invalid-or-unresolvable-capability',
  },
  readCreatesCatalogueRow: false,
  readCreatesDurableState: false,
  readInvalidatesInspectionState: false,
  readInvalidatesApplyState: false,
  readableArtifactMaximumBytes: 5 * 1024 * 1024,
  transportFrameMaximumBytes: 8 * 1024 * 1024,
} as const

export const HANDLE_CONTRACT = {
  tokenEncoding: 'base64url-unpadded',
  tokenRawBytes: 65,
  tokenCharacters: 87,
  components: {
    versionBytes: 1,
    locationDigestBytes: 32,
    hmacSha256Bytes: 32,
  },
  issuanceRegistry: false,
  durable: false,
} as const

for (const authority of [
  EDIT_TOOL_NAMES,
  PROJECT_TOOL_NAMES,
  STATEFUL_EDIT_TOOL_NAMES,
  EDIT_TOOL_DESCRIPTORS,
  OPERATION_KINDS,
  OPERATION_REVIEW_ROWS,
  SEMANTIC_HASH_DOMAINS,
  REFUSAL_CODES,
  REFUSAL_REVIEW_ROWS,
  RESOURCE_CONTRACT,
  HANDLE_CONTRACT,
])
{
  deepFreeze(authority)
}
