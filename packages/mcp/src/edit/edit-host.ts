// packages/mcp/src/edit/edit-host.ts
// map frozen edit requests to lifecycle calls & retained response projections

import { LOWERCASE_SHA256_PATTERN } from '../internal/sha256-pattern.js'

import {
  OPERATION_REVIEW_ROWS,
  OPERATION_PLANNING_ROWS,
  PHASE_8_EDIT_LIMIT_AUTHORITY_V1,
  REFUSAL_CODES,
  VANILLA_CORE_DESCRIPTORS,
  EditSessionErrorV1,
  parseEditToolInputV1,
  semanticHashV1,
  type BudgetProjectionV1,
  type CapabilityItemV1,
  type CurrentInspectionEntityItemV1,
  type EditApplyDomainResultV1,
  type EditArtifactStorePort,
  type EditApplyRequestV1,
  type EditAssetAdmitDomainResultV1,
  type EditAssetAdmitDomainSourceV1,
  type EditAssetAdmitRequestV1,
  type EditBeginDomainResultV1,
  type EditBeginRequestV1,
  type EditCapabilitiesRequestV1,
  type EditCheckpointRequestV1,
  type EditCheckpointResultV1,
  type EditCloseDomainResultV1,
  type EditCloseRequestV1,
  type EditEvaluateDomainResultV1,
  type EditEvaluateRequestV1,
  type EditExportDomainResultV1,
  type EditExportRequestV1,
  type EditIdempotentOutcomeProjectionV1,
  type EditOperationPlanningChoiceSlotV1,
  type EditInspectDomainItemV1,
  type EditInspectRequestV1,
  type EditPreviewRequestV1,
  type EditPreviewResultV1,
  type EditRetainedCapabilityFactsV1,
  type EditRestoreDomainResultV1,
  type RetainedEditBeginOutcomeAuthorityV1,
  type EditRollbackRequestV1,
  type EditSessionLifecycleV1,
  type EditSourceIntakeV1,
  type EditStatusRequestV1,
  type EditToolName,
  type EditTransportOutcomeTargetV1,
  type EditUndoRequestV1,
  type ExactRevisionIdentityV1,
  type HistoricalInspectionEntityItemV1,
  type HostInvocationContextV1,
  type OperationResultSummaryV1,
  type OperationPlanningBindingHeadV1,
  type OperationPlanningChoiceSlotRowV1,
  type OperationPlanningChoiceV1,
  type OperationPlanningFactRowV1,
  type OperationPlanningQueryV1,
  type RecoveredRetainedEditAttemptV1,
  type RefusalCode,
} from '@scratch-agent/edit'
import { canonicalJsonBytesV1 } from '@scratch-agent/sb3/canonical-json'
import { sha256Hex } from '@scratch-agent/sb3/crypto-node'

import type {
  EditPaginationCursorAuthorityV1,
  EditCursorBindingV1,
} from './edit-sessions.js'
import { editPageSizeV1 } from './edit-sessions.js'
import {
  assertEditToolReceiptFreeResponseV1,
  type EditToolHostV1,
} from './edit-tools.js'
import { editTransportRequestSha256V1 } from '../transport/tool-audit.js'
import { McpBoundaryError } from '../transport/errors.js'

export const EDIT_STATEFUL_RESPONSE_PROJECTOR_VERSION_V1 =
  'retained-stateful-edit-response-projector-v1'

export interface EditHostLifecycleAuthorityV1
{
  begin(
    request: EditBeginRequestV1,
    invocation: HostInvocationContextV1
  ): Promise<EditBeginDomainResultV1>
  lookupBeginOutcome(
    request: EditBeginRequestV1,
    invocation: HostInvocationContextV1
  ): Promise<EditIdempotentOutcomeProjectionV1 | null>
  retainedBeginOutcome(
    request: EditBeginRequestV1,
    invocation: HostInvocationContextV1
  ): Promise<RetainedEditBeginOutcomeAuthorityV1 | null>
  retainedBeginTransportOutcomeTarget(input: {
    readonly request: EditBeginRequestV1
    readonly invocation: HostInvocationContextV1
  }): Promise<EditTransportOutcomeTargetV1>
  session(sessionId: string): EditSessionLifecycleV1
  capabilities(
    request: EditCapabilitiesRequestV1
  ): Promise<EditRetainedCapabilityFactsV1>
}

// trusted intake is deliberately limited to host files & pinned templates.
// source-media reads must remain bound to retained edit-session authority.
export interface EditTrustedIntakePortV1
{
  preflight(): Promise<void>
  capabilityTemplateSource(): Promise<EditSourceIntakeV1>
  templateSource(request: EditBeginRequestV1): Promise<EditSourceIntakeV1>
  inputFileAssetSource(
    request: EditAssetAdmitRequestV1 & {
      readonly source: Extract<
        EditAssetAdmitRequestV1['source'],
        { readonly kind: 'inputFile' }
      >
    }
  ): Promise<
    Extract<EditAssetAdmitDomainSourceV1, { readonly kind: 'inputFile' }>
  >
}

// the status response reads this live after the request reaches the host. A
// startup-cached audit tail would immediately be stale after the next call.
export interface EditHostAuditHeadPortV1
{
  preflight(): Promise<void>
  currentAuditHeadSha256(): string
}

// retained resources resolve source-media from the exact current revision &
// expose only evidence already registered by the resource authority.
export interface EditHostArtifactResourcesPortV1
{
  preflight(): Promise<void>
}

interface HostOptionsV1
{
  readonly lifecycle: EditHostLifecycleAuthorityV1
  readonly intake: EditTrustedIntakePortV1
  readonly cursors: EditPaginationCursorAuthorityV1
  readonly realmSha256: string
  readonly profileSha256: string
  readonly principalSha256: string
  readonly transportStore: Pick<
    EditArtifactStorePort,
    'createOrVerifyImmutable'
  >
  readonly auditHead: EditHostAuditHeadPortV1
  readonly artifactResources: EditHostArtifactResourcesPortV1
}

type EditRestoreDispatchV1 =
  | readonly [tool: 'edit_undo', request: EditUndoRequestV1]
  | readonly [tool: 'edit_rollback', request: EditRollbackRequestV1]

const ZERO_SHA256 = '0'.repeat(64)

function exactTransportResultKeyV1(
  target: EditTransportOutcomeTargetV1
): string
{
  if (
    !Number.isSafeInteger(target.attemptSequence) ||
    target.attemptSequence < 0 ||
    !LOWERCASE_SHA256_PATTERN.test(target.requestSha256) ||
    !LOWERCASE_SHA256_PATTERN.test(target.namespaceSha256) ||
    target.invocationCorrelation.boundaryKind !== 'mcp' ||
    !LOWERCASE_SHA256_PATTERN.test(target.invocationCorrelation.invocationSha256)
  )
    throw new McpBoundaryError(
      'mcp.edit-transport-recovery-required',
      'transport-result target authority is not exact'
    )
  const attemptDirectory = `${String(target.attemptSequence).padStart(
    6,
    '0'
  )}-${target.requestSha256.slice(0, 16)}`
  if (target.kind === 'registryBegin')
    return `registry-attempts/${attemptDirectory}/transport-result.json`
  if (!/^[a-z0-9][a-z0-9-]{0,127}$/u.test(target.sessionKey))
    throw new McpBoundaryError(
      'mcp.edit-transport-recovery-required',
      'transport-result session target is not host-safe'
    )
  return `sessions/${target.sessionKey}/attempts/${attemptDirectory}/transport-result.json`
}

export async function retainExactTransportResultV1(input: {
  readonly store: Pick<EditArtifactStorePort, 'createOrVerifyImmutable'>
  readonly target: EditTransportOutcomeTargetV1
  readonly projection:
    | {
        readonly kind: 'begin'
        readonly request: EditBeginRequestV1
        readonly outcome: RetainedEditBeginOutcomeAuthorityV1
        readonly authority: EditStatefulResponseProjectionAuthorityV1
      }
    | {
        readonly kind: 'stateful'
        readonly projection: RetainedStatefulEditProjectionV1
        readonly authority: EditStatefulResponseProjectionAuthorityV1
      }
    | {
        readonly kind: 'recovered'
        readonly attempt: RecoveredRetainedEditAttemptV1
        readonly authority: EditStatefulResponseProjectionAuthorityV1
      }
}): Promise<Record<string, unknown>>
{
  const receiptFreeOutcome =
    input.projection.kind === 'begin'
      ? projectRetainedEditBeginOutcomeV1(
          input.projection.request,
          input.projection.outcome,
          input.projection.authority
        )
      : input.projection.kind === 'stateful'
        ? projectRetainedStatefulEditOutcomeV1(
            input.projection.projection,
            input.projection.authority
          )
        : input.projection.attempt.receiptFreeOutcome === null
          ? projectRecoveredRetainedEditOutcomeV1(
              input.projection.attempt,
              input.projection.authority
            )
          : (input.projection.attempt.receiptFreeOutcome as Record<
              string,
              unknown
            >)
  if (
    (input.target.kind === 'registryBegin') !==
    (input.target.toolName === 'edit_begin')
  )
    throw new McpBoundaryError(
      'mcp.edit-transport-recovery-required',
      'transport-result target kind differs from its edit tool'
    )
  assertEditToolReceiptFreeResponseV1(input.target.toolName, receiptFreeOutcome)
  const completed = receiptFreeOutcome['ok'] === true
  const data = recordValueV1(receiptFreeOutcome['data'])
  const identity = recordValueV1(
    completed ? data?.['identity'] : receiptFreeOutcome['identity']
  )
  const outcomeKind = identity?.['outcomeKind']
  if (
    identity === null ||
    receiptFreeOutcome['tool'] !== input.target.toolName ||
    completed !== (input.target.disposition === 'completed') ||
    identity['attemptId'] !== input.target.attemptId ||
    identity['requestId'] !== input.target.requestId ||
    (input.target.disposition === 'refused'
      ? outcomeKind !== 'refused'
      : outcomeKind !== 'completed' &&
        outcomeKind !== 'awaitingExternalEvidence')
  )
    throw new McpBoundaryError(
      'mcp.edit-transport-recovery-required',
      'transport-result envelope differs from its exact attempt target'
    )
  if (input.target.kind === 'session')
  {
    if (identity['sessionId'] !== input.target.sessionId)
      throw new McpBoundaryError(
        'mcp.edit-transport-recovery-required',
        'transport-result envelope differs from its session target'
      )
  }
  else if (input.target.sessionId === null)
  {
    const session = recordValueV1(identity['session'])
    if (
      input.target.disposition !== 'refused' ||
      session?.['state'] !== 'absent' ||
      'sessionId' in identity
    )
      throw new McpBoundaryError(
        'mcp.edit-transport-recovery-required',
        'transport-result envelope differs from its absent begin target'
      )
  }
  else if (completed)
  {
    if (identity['sessionId'] !== input.target.sessionId)
      throw new McpBoundaryError(
        'mcp.edit-transport-recovery-required',
        'transport-result envelope differs from its completed begin target'
      )
  }
  else
  {
    const session = recordValueV1(identity['session'])
    if (
      session?.['state'] !== 'present' ||
      session['sessionId'] !== input.target.sessionId
    )
      throw new McpBoundaryError(
        'mcp.edit-transport-recovery-required',
        'transport-result envelope differs from its present begin target'
      )
  }
  const receiptFreeOutcomeBytes = canonicalJsonBytesV1(receiptFreeOutcome)
  await input.store.createOrVerifyImmutable(
    exactTransportResultKeyV1(input.target),
    canonicalJsonBytesV1({
      schemaVersion: 1,
      kind: 'retained-mcp-transport-result-v1',
      namespaceSha256: input.target.namespaceSha256,
      requestSha256: input.target.requestSha256,
      invocationCorrelation: input.target.invocationCorrelation,
      receiptFreeOutcome,
      receiptFreeOutcomeSha256: sha256Hex(receiptFreeOutcomeBytes),
    })
  )
  return receiptFreeOutcome
}

function recordValueV1(value: unknown): Record<string, unknown> | null
{
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function planningChoiceRows(
  binding: OperationPlanningBindingHeadV1,
  query: OperationPlanningQueryV1,
  expandedSlots: readonly EditOperationPlanningChoiceSlotV1[]
): readonly OperationPlanningChoiceSlotRowV1[]
{
  const row = OPERATION_PLANNING_ROWS.find(
    (candidate) => candidate.operationKind === query.goal.kind
  )
  if (!row)
    throw new EditSessionErrorV1(
      'edit.unsupported_operation',
      `planning catalogue has no ${query.goal.kind} operation`,
      false,
      { opId: query.goal.opId }
    )
  const slots =
    expandedSlots.length === 0
      ? row.choiceMappings.map((mapping, index) => ({
          destination: mapping.destination,
          slotDiscriminator: `static-${index}`,
          currentState: `${query.goal.kind} ${mapping.destination}`,
          evidenceIds: [binding.revisionId],
        }))
      : expandedSlots
  return Object.freeze(
    slots.map((slot, index) =>
    {
      const mapping = row.choiceMappings.find(
        (candidate) => candidate.destination === slot.destination
      )
      if (!mapping)
        throw new EditSessionErrorV1(
          'edit.internal_invariant',
          `expanded choice slot has unknown ${slot.destination} destination`,
          false,
          { opId: query.goal.opId }
        )
      const currentState = slot.currentState
      const currentStateSha256 = semanticHashV1('resolved-plan', {
        kind: 'operation-planning-choice-current-state',
        binding,
        destination: slot.destination,
        slotDiscriminator: slot.slotDiscriminator,
        currentState,
        index,
      })
      return {
        itemKind: 'planningChoice',
        operationKind: query.goal.kind,
        choiceSlotKey: `planning-choice-${currentStateSha256.slice(0, 32)}`,
        destination: slot.destination,
        currentStateSha256,
        boundedCurrentState: {
          displayKind: 'inline',
          value: currentState,
          canonicalJsonStringByteLength: new TextEncoder().encode(
            JSON.stringify(currentState)
          ).byteLength,
          valueSha256: semanticHashV1('resolved-plan', {
            kind: 'operation-planning-choice-display',
            value: currentState,
          }),
        },
        allowedAlternativeSetSha256: semanticHashV1('resolved-plan', {
          kind: 'operation-planning-choice-alternatives',
          operationKind: query.goal.kind,
          destination: slot.destination,
          allowedAlternativeKinds: mapping.allowedAlternativeKinds,
        }),
        allowedAlternativeKinds: mapping.allowedAlternativeKinds,
        evidenceIds: [...new Set([binding.revisionId, ...slot.evidenceIds])],
      } as OperationPlanningChoiceSlotRowV1
    })
  )
}

function operationChoiceSetSha256(
  binding: OperationPlanningBindingHeadV1,
  rows: readonly OperationPlanningChoiceSlotRowV1[]
): string
{
  return semanticHashV1('resolved-plan', {
    kind: 'operation-planning-choice-set',
    schemaVersion: 1,
    binding,
    rows,
  })
}

function completedChoiceProjectionSha256(
  binding: OperationPlanningBindingHeadV1,
  choices: readonly OperationPlanningChoiceV1[]
): string
{
  return semanticHashV1('resolved-plan', {
    kind: 'operation-planning-completed-choices',
    schemaVersion: 1,
    binding,
    choices,
  })
}

function success(tool: EditToolName, data: unknown): Record<string, unknown>
{
  return { schemaVersion: 1, ok: true, tool, data }
}

function requestSessionId(request: unknown): string | null
{
  if (request === null || typeof request !== 'object') return null
  const value = (request as { readonly sessionId?: unknown }).sessionId
  return typeof value === 'string' ? value : null
}

function exactRevision(head: {
  readonly sourceArtifactSha256: string
  readonly revisionNumber: number
  readonly revisionId: string
  readonly candidateSha256: string
  readonly assetManifestSha256: string
  readonly changeContractSha256: string
  readonly capabilityProfileSha256: string
}): ExactRevisionIdentityV1
{
  return {
    sourceArtifactSha256: head.sourceArtifactSha256,
    revisionNumber: head.revisionNumber,
    revisionId: head.revisionId,
    candidateSha256: head.candidateSha256,
    assetManifestSha256: head.assetManifestSha256,
    changeContractSha256: head.changeContractSha256,
    capabilityProfileSha256: head.capabilityProfileSha256,
  }
}

function budgetProjection(value: {
  readonly artifactBytesUsed: number
  readonly impactUsed: number
  readonly intentUsed: number
  readonly restoreReserveHeld: boolean
}): BudgetProjectionV1
{
  return {
    artifactBytesUsed: value.artifactBytesUsed,
    impactUsed: value.impactUsed,
    intentUsed: value.intentUsed,
    restoreReserveHeld: value.restoreReserveHeld,
  }
}

function boundedRecord(input: unknown, index: number): Record<string, unknown>
{
  const value = input as Record<string, unknown>
  const recordSha256 = semanticHashV1('semantic-report-projection', {
    kind: 'bounded-inspection-record',
    schemaVersion: 1,
    value,
  })
  const candidateKind = value['attempt']
    ? 'attempt'
    : value['previewId']
      ? 'preview'
      : value['checkpointId']
        ? 'checkpoint'
        : value['evaluationId'] || value['certificate']
          ? 'evaluation'
          : value['publicationEvidenceId']
            ? 'export'
            : value['revision'] || value['head']
              ? 'history'
              : 'artifact'
  const revisionId =
    typeof value['revisionId'] === 'string'
      ? value['revisionId']
      : typeof (value['head'] as Record<string, unknown> | undefined)?.[
            'revisionId'
          ] === 'string'
        ? ((value['head'] as Record<string, unknown>)['revisionId'] as string)
        : undefined
  return {
    itemKind: 'record',
    recordKind: candidateKind,
    recordId: recordSha256,
    recordSha256,
    status:
      typeof value['state'] === 'string' ? value['state'] : `retained-${index}`,
    evidenceIds: [],
    ...(revisionId === undefined ? {} : { revisionId }),
  }
}

function inspectEntity(
  item: EditInspectDomainItemV1,
  historical: boolean
): CurrentInspectionEntityItemV1 | HistoricalInspectionEntityItemV1
{
  const common = {
    itemKind: 'entity' as const,
    entityKind: item.entityKind,
    evidenceId: item.semanticLocationSha256,
    boundedCountsSha256: semanticHashV1('semantic-report-projection', {
      kind: 'inspection-bounded-counts',
      schemaVersion: 1,
      entityKind: item.entityKind,
      location: item.location,
    }),
    canonicalSummarySha256: semanticHashV1('semantic-report-projection', {
      kind: 'inspection-canonical-summary',
      schemaVersion: 1,
      entityKind: item.entityKind,
      entitySubtype: item.entitySubtype,
      location: item.location,
    }),
    contextFingerprint: item.contextFingerprintSha256,
    semanticFingerprint: item.semanticFingerprintSha256,
    location: item.location,
  }
  const structuralSelectorRecipe = {
    refKind: 'structural' as const,
    selectorKind: 'exactLocation' as const,
    entityKind: item.entityKind,
    location: item.location,
    expectedFullLocationSha256: item.semanticLocationSha256,
    expectedSemanticFingerprint: item.semanticFingerprintSha256,
    expectedContextFingerprint: item.contextFingerprintSha256,
  }
  return {
    ...common,
    ...(historical || item.handle === undefined
      ? { structuralSelectorRecipe }
      : { handle: item.handle }),
  } as CurrentInspectionEntityItemV1 | HistoricalInspectionEntityItemV1
}

function inspectionPageEvidenceIdsV1(
  items: readonly unknown[]
): readonly string[]
{
  const evidenceIds = items.flatMap((item) =>
  {
    const value = recordValueV1(item)
    if (value === null) return []
    const ids = [
      ...(typeof value.evidenceId === 'string' ? [value.evidenceId] : []),
      ...(Array.isArray(value.evidenceIds)
        ? value.evidenceIds.filter(
            (candidate): candidate is string => typeof candidate === 'string'
          )
        : []),
    ]
    return ids
  })
  return Object.freeze([...new Set(evidenceIds)].slice(0, 128))
}

type OperationResultSelectionV1 = {
  readonly attemptId?: string
  readonly revisionId?: string
}

function operationResultSelectionSha256V1(
  selection: OperationResultSelectionV1
): string
{
  return semanticHashV1('transport-request', {
    kind: 'operation-result-page-selection',
    schemaVersion: 1,
    ...selection,
  })
}

function operationResultPage(
  options: { readonly cursors: EditPaginationCursorAuthorityV1 },
  sessionId: string,
  head: EditSessionLifecycleV1['head'],
  selection: OperationResultSelectionV1,
  collectionSha256: string,
  items: readonly OperationResultSummaryV1[],
  page: { readonly cursor?: string; readonly pageSize?: number } | undefined
): Record<string, unknown>
{
  const querySha256 = operationResultSelectionSha256V1(selection)
  const binding: EditCursorBindingV1 = {
    sessionId,
    scope: 'operationResults',
    revisionId: head.revisionId,
    revisionNumber: head.revisionNumber,
    querySha256,
    collectionSha256,
    diffSha256: ZERO_SHA256,
  }
  const offset = options.cursors.offset(binding, page?.cursor)
  const pageSize = editPageSizeV1(page?.pageSize)
  const pageItems = items.slice(offset, offset + pageSize)
  const nextOffset = offset + pageItems.length
  return {
    collectionSha256,
    items: pageItems,
    totalCount: items.length,
    ...(nextOffset < items.length
      ? { nextCursor: options.cursors.issue(binding, nextOffset) }
      : {}),
  }
}

export interface RetainedStatefulEditProjectionV1
{
  readonly toolName: Exclude<
    EditToolName,
    'edit_capabilities' | 'edit_inspect' | 'edit_status'
  >
  readonly request: unknown
  readonly result: unknown
  readonly disposition: 'completed' | 'refused'
  readonly sessionId: string
  readonly attemptId: string
  readonly preHead: EditSessionLifecycleV1['head'] | null
  readonly postHead: EditSessionLifecycleV1['head'] | null
  readonly budget: Parameters<typeof budgetProjection>[0]
  readonly events: readonly {
    readonly eventSha256: string
    readonly sequence: number
  }[]
  readonly evidenceIds: readonly string[]
}

export interface EditStatefulResponseProjectionAuthorityV1
{
  readonly principalSha256: string
  readonly realmSha256: string
  readonly cursors: EditPaginationCursorAuthorityV1
}

function exactRetainedEventV1(projection: RetainedStatefulEditProjectionV1): {
  readonly eventSha256: string
  readonly sequence: number
}
{
  const events = [...projection.events].sort(
    (left, right) => left.sequence - right.sequence
  )
  const event = events.at(-1)
  if (event === undefined)
    throw new McpBoundaryError(
      'mcp.edit-transport-recovery-required',
      'completed semantic outcome lacks an exact event correlation'
    )
  return Object.freeze({
    eventSha256: event.eventSha256,
    sequence: event.sequence,
  })
}

function retainedStatefulIdentityV1(
  projection: RetainedStatefulEditProjectionV1,
  authority: EditStatefulResponseProjectionAuthorityV1,
  outcomeKind: 'completed' | 'awaitingExternalEvidence'
): Record<string, unknown>
{
  const request = projection.request as { readonly requestId?: unknown }
  if (
    typeof request.requestId !== 'string' ||
    projection.postHead === null ||
    (projection.toolName === 'edit_begin') !== (projection.preHead === null)
  )
    throw new McpBoundaryError(
      'mcp.edit-transport-recovery-required',
      'semantic outcome lacks exact response identity authority'
    )
  const event = exactRetainedEventV1(projection)
  return {
    attemptId: projection.attemptId,
    requestId: request.requestId,
    requestSha256: editTransportRequestSha256V1({
      principalSha256: authority.principalSha256,
      realmSha256: authority.realmSha256,
      tool: projection.toolName,
      request: projection.request as never,
    }),
    sessionId: projection.sessionId,
    outcomeKind,
    preHead:
      projection.preHead === null
        ? { state: 'absent' }
        : { state: 'present', head: projection.preHead },
    postHead: projection.postHead,
    budget: budgetProjection(projection.budget),
    event,
    evidenceIds: projection.evidenceIds,
  }
}

export function projectRetainedStatefulEditOutcomeV1(
  projection: RetainedStatefulEditProjectionV1,
  authority: EditStatefulResponseProjectionAuthorityV1
): Record<string, unknown>
{
  const request = projection.request as { readonly requestId?: unknown }
  if (typeof request.requestId !== 'string')
    throw new McpBoundaryError(
      'mcp.edit-transport-recovery-required',
      'retained semantic request lacks its request ID'
    )
  if (projection.disposition === 'refused')
  {
    if (
      projection.toolName === 'edit_begin' ||
      projection.preHead === null ||
      projection.postHead === null
    )
      throw new McpBoundaryError(
        'mcp.edit-transport-recovery-required',
        'opening refusal requires registry transport authority'
      )
    const result = recordValueV1(projection.result)
    if (
      result === null ||
      typeof result.code !== 'string' ||
      !REFUSAL_CODES.includes(result.code as RefusalCode) ||
      typeof result.safeMessage !== 'string' ||
      recordValueV1(result.context) === null
    )
      throw new McpBoundaryError(
        'mcp.edit-transport-recovery-required',
        'retained refusal result is not one exact refusal authority'
      )
    const events = [...projection.events].sort(
      (left, right) => left.sequence - right.sequence
    )
    const event = events.at(-1)
    return {
      schemaVersion: 1,
      ok: false,
      tool: projection.toolName,
      error: {
        code: result.code,
        safeMessage: result.safeMessage,
        context: result.context,
      },
      identity: {
        attemptId: projection.attemptId,
        requestId: request.requestId,
        requestSha256: editTransportRequestSha256V1({
          principalSha256: authority.principalSha256,
          realmSha256: authority.realmSha256,
          tool: projection.toolName,
          request: projection.request as never,
        }),
        sessionId: projection.sessionId,
        outcomeKind: 'refused',
        preHead: { state: 'present', head: projection.preHead },
        postHead: projection.postHead,
        budget: budgetProjection(projection.budget),
        event:
          event === undefined
            ? { state: 'absent' }
            : { state: 'present', event },
        evidenceIds: projection.evidenceIds,
      },
    }
  }
  const result = recordValueV1(projection.result)
  if (result === null)
    throw new McpBoundaryError(
      'mcp.edit-transport-recovery-required',
      'completed semantic result is not one projection object'
    )
  const identity = retainedStatefulIdentityV1(
    projection,
    authority,
    result.phase === 'awaitingExternalEvidence'
      ? 'awaitingExternalEvidence'
      : 'completed'
  )
  let data: Record<string, unknown>
  switch (projection.toolName)
  {
    case 'edit_begin':
      data = {
        state: result.state,
        semanticSourceSha256: result.semanticSourceSha256,
        changeContractSha256: result.changeContractSha256,
        sourceProvenanceEvidenceSha256: result.sourceProvenanceEvidenceSha256,
        identity,
      }
      break
    case 'edit_asset_admit':
      data = {
        assetHandle: result.assetToken,
        payloadSha256: result.payloadSha256,
        mediaMetadataSha256: result.metadataSha256,
        byteLength: result.byteLength,
        format: result.dataFormat,
        admissionEvidenceId: result.admissionEvidenceId,
        identity,
      }
      break
    case 'edit_preview':
    {
      const preview = recordValueV1(result.preview)
      if (preview === null || !Array.isArray(preview.operationResultSummaries))
        throw new McpBoundaryError(
          'mcp.edit-transport-recovery-required',
          'retained preview result lacks its exact operation collection'
        )
      data = {
        previewId: preview.previewId,
        requestBatchSha256: preview.requestSha256,
        operationCount: preview.operationCount,
        predictedCandidateSha256: preview.predictedCandidateSha256,
        resolvedSemanticBatchSha256: preview.resolvedSemanticBatchSha256,
        resolvedPlanSha256: preview.resolvedPlanSha256,
        deltaSha256: preview.deltaSha256,
        preservationSha256: preview.preservationSha256,
        diagnosticsSha256: preview.diagnosticsSha256,
        applyGuardSha256: preview.applyGuardSha256,
        operationResultCount: preview.operationResultSummaries.length,
        resultPage: operationResultPage(
          authority,
          projection.sessionId,
          projection.postHead!,
          { attemptId: projection.attemptId },
          String(preview.operationResultSetSha256),
          preview.operationResultSummaries as OperationResultSummaryV1[],
          undefined
        ),
        identity,
      }
      break
    }
    case 'edit_apply':
    {
      if (!Array.isArray(result.operationResultSummaries))
        throw new McpBoundaryError(
          'mcp.edit-transport-recovery-required',
          'retained apply result lacks its exact operation collection'
        )
      data = {
        revisionSha256: result.revisionId,
        deltaSha256: result.deltaSha256,
        preservationSha256: result.preservationSha256,
        lineageSha256: result.lineageSha256,
        preparedEventSha256: result.preparedEventSha256,
        committedEventSha256: result.committedEventSha256,
        reportSha256: result.reportSha256,
        operationResultCount: result.operationResultSummaries.length,
        resultPage: operationResultPage(
          authority,
          projection.sessionId,
          projection.postHead!,
          { revisionId: String(result.revisionId) },
          String(result.operationResultSetSha256),
          result.operationResultSummaries as OperationResultSummaryV1[],
          undefined
        ),
        identity,
      }
      break
    }
    case 'edit_checkpoint':
      data = {
        checkpointId: result.checkpointId,
        checkpointSha256: result.checkpointSha256,
        identity,
      }
      break
    case 'edit_undo':
    case 'edit_rollback':
      data = {
        restoreSource: exactRevision(result.fromRevision as never),
        restoreTarget: exactRevision(result.selectedRevision as never),
        restoreDeltaSha256: result.restoreDeltaSha256,
        preparedEventSha256: result.preparedEventSha256,
        committedEventSha256: result.committedEventSha256,
        reportSha256: result.reportSha256,
        identity,
      }
      break
    case 'edit_evaluate':
      data = {
        evaluationId: result.evaluationId,
        phase: result.phase,
        evaluatedRevision: result.evaluatedRevision,
        evaluationAttemptSha256: result.evaluationAttemptSha256,
        certificate: result.certificate,
        evidenceContent: result.evidenceContent,
        requiredHostAction: result.requiredHostAction,
        identity,
      }
      break
    case 'edit_export':
    {
      const {
        terminalState: _terminalState,
        receiptSha256: _receiptSha256,
        ...exported
      } = result
      data = { terminalState: result.terminalState, ...exported, identity }
      break
    }
    case 'edit_close':
      data = {
        terminalState: result.terminalState,
        finalHead: result.head,
        eventSha256: result.eventSha256,
        reportSha256: result.reportSha256,
        retentionProofSha256: result.retentionProofSha256,
        identity,
      }
      break
  }
  return { schemaVersion: 1, ok: true, tool: projection.toolName, data }
}

export function projectRetainedEditBeginOutcomeV1(
  request: EditBeginRequestV1,
  outcome: RetainedEditBeginOutcomeAuthorityV1,
  authority: EditStatefulResponseProjectionAuthorityV1
): Record<string, unknown>
{
  if (
    outcome.kind !== 'retained-edit-begin-outcome-authority-v1' ||
    outcome.invocationCorrelation.boundaryKind !== 'mcp'
  )
    throw new McpBoundaryError(
      'mcp.edit-transport-recovery-required',
      'begin outcome lacks retained MCP projection authority'
    )
  if (outcome.disposition === 'completed')
  {
    if (outcome.openingSession.state !== 'present' || outcome.postHead === null)
      throw new McpBoundaryError(
        'mcp.edit-transport-recovery-required',
        'completed begin outcome lacks its opened session authority'
      )
    return projectRetainedStatefulEditOutcomeV1(
      {
        toolName: 'edit_begin',
        request,
        result: outcome.result,
        disposition: 'completed',
        sessionId: outcome.openingSession.sessionId,
        attemptId: outcome.attemptId,
        preHead: null,
        postHead: outcome.postHead,
        budget: outcome.budget,
        events: outcome.events,
        evidenceIds: outcome.evidenceIds,
      },
      authority
    )
  }
  const result = recordValueV1(outcome.result)
  if (
    result === null ||
    typeof result.code !== 'string' ||
    !REFUSAL_CODES.includes(result.code as RefusalCode) ||
    typeof result.safeMessage !== 'string' ||
    recordValueV1(result.context) === null
  )
    throw new McpBoundaryError(
      'mcp.edit-transport-recovery-required',
      'retained begin refusal is not one exact refusal authority'
    )
  const requestSha256 = editTransportRequestSha256V1({
    principalSha256: authority.principalSha256,
    realmSha256: authority.realmSha256,
    tool: 'edit_begin',
    request,
  })
  const base = {
    attemptId: outcome.attemptId,
    requestId: request.requestId,
    requestSha256,
    outcomeKind: 'refused' as const,
    preHead: { state: 'absent' as const },
    budget: budgetProjection(outcome.budget),
    evidenceIds: outcome.evidenceIds,
  }
  let identity: Record<string, unknown>
  if (outcome.openingSession.state === 'absent')
  {
    if (outcome.postHead !== null || outcome.events.length !== 0)
      throw new McpBoundaryError(
        'mcp.edit-transport-recovery-required',
        'session-absent begin refusal carries impossible session authority'
      )
    identity = {
      ...base,
      session: {
        state: 'absent',
        beginNamespaceSha256: outcome.beginNamespaceSha256,
      },
      postHead: { state: 'absent' },
      registryAttemptSha256: outcome.registryAttemptSha256,
    }
  }
  else
  {
    if (outcome.postHead === null)
      throw new McpBoundaryError(
        'mcp.edit-transport-recovery-required',
        'session-present begin refusal lacks its exact post-head'
      )
    identity = {
      ...base,
      session: {
        state: 'present',
        sessionId: outcome.openingSession.sessionId,
      },
      postHead: { state: 'present', head: outcome.postHead },
      event: exactRetainedEventV1({
        toolName: 'edit_begin',
        request,
        result: outcome.result,
        disposition: 'refused',
        sessionId: outcome.openingSession.sessionId,
        attemptId: outcome.attemptId,
        preHead: null,
        postHead: outcome.postHead,
        budget: outcome.budget,
        events: outcome.events,
        evidenceIds: outcome.evidenceIds,
      }),
    }
  }
  return {
    schemaVersion: 1,
    ok: false,
    tool: 'edit_begin',
    error: {
      code: result.code,
      safeMessage: result.safeMessage,
      context: result.context,
    },
    identity,
  }
}

export function projectRecoveredRetainedEditOutcomeV1(
  attempt: RecoveredRetainedEditAttemptV1,
  authority: EditStatefulResponseProjectionAuthorityV1
): Record<string, unknown>
{
  if (attempt.toolName === 'edit_begin')
  {
    const parsedRequest = parseEditToolInputV1(
      'edit_begin',
      attempt.transportRequest
    )
    if (
      !parsedRequest.ok ||
      attempt.beginNamespaceSha256 === null ||
      attempt.registryAttemptSha256 === null
    )
      throw new McpBoundaryError(
        'mcp.edit-transport-recovery-required',
        'recovered begin attempt lacks exact projection authority'
      )
    return projectRetainedEditBeginOutcomeV1(
      parsedRequest.value,
      {
        schemaVersion: 1,
        kind: 'retained-edit-begin-outcome-authority-v1',
        attemptId: attempt.attemptId,
        attemptSequence: attempt.attemptSequence,
        registryAttemptSha256: attempt.registryAttemptSha256,
        namespaceSha256: attempt.namespaceSha256,
        beginNamespaceSha256: attempt.beginNamespaceSha256,
        requestSha256: attempt.requestSha256,
        invocationCorrelation: attempt.invocationCorrelation,
        disposition: attempt.disposition,
        result: attempt.result,
        resultSha256: attempt.resultSha256,
        openingSession: attempt.session,
        preHead: null,
        postHead: attempt.postHead,
        budget: attempt.budget,
        events: attempt.events,
        evidenceIds: attempt.evidenceIds,
      },
      authority
    )
  }
  if (
    attempt.toolName === 'edit_capabilities' ||
    attempt.toolName === 'edit_inspect' ||
    attempt.toolName === 'edit_status' ||
    attempt.sessionId === null
  )
    throw new McpBoundaryError(
      'mcp.edit-transport-recovery-required',
      'recovered attempt is not one stateful projection authority'
    )
  return projectRetainedStatefulEditOutcomeV1(
    {
      toolName: attempt.toolName,
      request: attempt.transportRequest,
      result: attempt.result,
      disposition: attempt.disposition,
      sessionId: attempt.sessionId,
      attemptId: attempt.attemptId,
      preHead: attempt.preHead,
      postHead: attempt.postHead,
      budget: attempt.budget,
      events: attempt.events,
      evidenceIds: attempt.evidenceIds,
    },
    authority
  )
}

type OperationResultsInspectionQueryV1 = Extract<
  EditInspectRequestV1['query'],
  { readonly kind: 'operationResults' }
>

function retainedOperationResultSelectionV1(input: {
  readonly groups: readonly unknown[]
  readonly attempts: readonly unknown[]
  readonly query: OperationResultsInspectionQueryV1
}): {
  readonly selection: OperationResultSelectionV1
  readonly collectionSha256: string
  readonly items: readonly OperationResultSummaryV1[]
}
{
  const selection = Object.freeze({
    ...('attemptId' in input.query ? { attemptId: input.query.attemptId } : {}),
    ...('revisionId' in input.query
      ? { revisionId: input.query.revisionId }
      : {}),
  })
  const attempts = input.attempts.map((value) =>
  {
    const entry = recordValueV1(value)
    return entry === null ? null : recordValueV1(entry.attempt)
  })
  const matches = input.groups.flatMap((value) =>
  {
    const group = recordValueV1(value)
    if (
      group === null ||
      typeof group.operationResultSetSha256 !== 'string' ||
      !LOWERCASE_SHA256_PATTERN.test(group.operationResultSetSha256) ||
      !Array.isArray(group.summaries)
    )
      throw new McpBoundaryError(
        'mcp.edit-retained-outcome-missing',
        'retained operation-result collection is malformed'
      )
    const revisionId =
      typeof group.revisionId === 'string' ? group.revisionId : null
    const retainedAttemptId =
      typeof group.attemptId === 'string' ? group.attemptId : null
    const joinedAttempts = attempts.filter((attempt) =>
    {
      if (attempt === null) return false
      if (
        'attemptId' in input.query &&
        attempt.attemptId !== input.query.attemptId
      )
        return false
      if (retainedAttemptId !== null)
        return (
          attempt.toolName === 'edit_preview' &&
          attempt.attemptId === retainedAttemptId
        )
      if (attempt.toolName !== 'edit_apply') return false
      const postHead = recordValueV1(attempt.postHead)
      return revisionId !== null && postHead?.revisionId === revisionId
    })
    if ('attemptId' in input.query && joinedAttempts.length !== 1) return []
    if ('revisionId' in input.query)
    {
      if (revisionId !== null)
      {
        if (revisionId !== input.query.revisionId) return []
      }
      else
      {
        if (!('attemptId' in input.query)) return []
        const postHead = recordValueV1(joinedAttempts[0]?.postHead)
        if (postHead?.revisionId !== input.query.revisionId) return []
      }
    }
    return [
      Object.freeze({
        collectionSha256: group.operationResultSetSha256,
        items: Object.freeze(
          structuredClone(group.summaries) as OperationResultSummaryV1[]
        ),
      }),
    ]
  })
  if (matches.length === 0)
    throw new EditSessionErrorV1(
      'edit.cursor_invalid',
      'operation-result selection has no retained collection'
    )
  if (matches.length > 1)
    throw new McpBoundaryError(
      'mcp.edit-retained-outcome-missing',
      'operation-result selection resolved multiple retained collections'
    )
  return Object.freeze({ selection, ...matches[0]! })
}

// the host projects only retained kernel facts. It does not accept semantic
// projection callbacks, mint event identities, or infer a post-transition head.
export class DirectEditToolHostV1 implements EditToolHostV1
{
  readonly #options: HostOptionsV1

  constructor(options: HostOptionsV1)
  {
    this.#options = options
  }

  async callEditTool(
    name: EditToolName,
    request: unknown,
    invocation: HostInvocationContextV1
  ): Promise<unknown>
  {
    this.#assertInvocation(invocation)
    let session: EditSessionLifecycleV1 | null = null
    const response = await (async (): Promise<Record<string, unknown>> =>
    {
      try
      {
        const id = requestSessionId(request)
        if (id !== null) session = this.#options.lifecycle.session(id)
        switch (name)
        {
          case 'edit_capabilities':
            return success(
              name,
              await this.#capabilities(request as EditCapabilitiesRequestV1)
            )
          case 'edit_begin':
            return success(
              name,
              await this.#begin(request as EditBeginRequestV1, invocation)
            )
          case 'edit_inspect':
            return success(
              name,
              await this.#inspect(
                request as EditInspectRequestV1,
                this.#requiredSession(session)
              )
            )
          case 'edit_asset_admit':
            return success(
              name,
              await this.#assetAdmit(
                request as EditAssetAdmitRequestV1,
                this.#requiredSession(session),
                invocation
              )
            )
          case 'edit_preview':
            return success(
              name,
              await this.#preview(
                request as EditPreviewRequestV1,
                this.#requiredSession(session),
                invocation
              )
            )
          case 'edit_apply':
            return success(
              name,
              await this.#apply(
                request as EditApplyRequestV1,
                this.#requiredSession(session),
                invocation
              )
            )
          case 'edit_checkpoint':
            return success(
              name,
              await this.#checkpoint(
                request as EditCheckpointRequestV1,
                this.#requiredSession(session),
                invocation
              )
            )
          case 'edit_undo':
            return success(
              name,
              await this.#restore(
                ['edit_undo', request as EditUndoRequestV1],
                this.#requiredSession(session),
                invocation
              )
            )
          case 'edit_rollback':
            return success(
              name,
              await this.#restore(
                ['edit_rollback', request as EditRollbackRequestV1],
                this.#requiredSession(session),
                invocation
              )
            )
          case 'edit_evaluate':
            return success(
              name,
              await this.#evaluate(
                request as EditEvaluateRequestV1,
                this.#requiredSession(session),
                invocation
              )
            )
          case 'edit_status':
            return success(
              name,
              await this.#status(request as EditStatusRequestV1, invocation)
            )
          case 'edit_export':
            return success(
              name,
              await this.#export(
                request as EditExportRequestV1,
                this.#requiredSession(session),
                invocation
              )
            )
          case 'edit_close':
            return success(
              name,
              await this.#close(
                request as EditCloseRequestV1,
                this.#requiredSession(session),
                invocation
              )
            )
        }
      }
      catch (error)
      {
        return this.#refusal(name, request, invocation, session, error)
      }
    })()
    return this.#retainTransportOutcomeV1(
      name,
      request,
      invocation,
      session,
      response
    )
  }

  async #retainTransportOutcomeV1(
    name: EditToolName,
    request: unknown,
    invocation: HostInvocationContextV1,
    session: EditSessionLifecycleV1 | null,
    response: Record<string, unknown>
  ): Promise<Record<string, unknown>>
  {
    const requestRecord = recordValueV1(request)
    const requestId = requestRecord?.requestId
    if (typeof requestId !== 'string')
    {
      assertEditToolReceiptFreeResponseV1(name, response)
      return response
    }
    let retainedBegin: RetainedEditBeginOutcomeAuthorityV1 | null = null
    if (name === 'edit_begin')
      retainedBegin = await this.#options.lifecycle.retainedBeginOutcome(
        request as EditBeginRequestV1,
        invocation
      )
    if (retainedBegin !== null)
      response = projectRetainedEditBeginOutcomeV1(
        request as EditBeginRequestV1,
        retainedBegin,
        this.#responseProjectionAuthorityV1()
      )
    let retainedSession = session
    const beginOutcome =
      retainedBegin === null &&
      retainedSession === null &&
      name === 'edit_begin'
        ? await this.#options.lifecycle.lookupBeginOutcome(
            request as EditBeginRequestV1,
            invocation
          )
        : null
    if (
      retainedSession === null &&
      beginOutcome !== null &&
      beginOutcome.sessionId !== null
    )
    {
      retainedSession = this.#options.lifecycle.session(beginOutcome.sessionId)
    }
    const retainedSessionFacts =
      name === 'edit_begin'
        ? null
        : (retainedSession?.retainedOutcomeFactsV1({
            toolName: name,
            requestId,
            principalSha256: invocation.principalSha256,
            invocationSha256: invocation.invocationSha256,
            transportRequest: request,
          }) ?? null)
    const outcome = retainedBegin
      ? retainedBegin
      : (beginOutcome ?? retainedSessionFacts?.outcome ?? null)
    if (outcome === null)
    {
      assertEditToolReceiptFreeResponseV1(name, response)
      return response
    }
    if (retainedBegin === null && retainedSessionFacts !== null)
    {
      if (
        retainedSession === null ||
        retainedSessionFacts.outcome.preHead === null ||
        retainedSessionFacts.outcome.postHead === null
      )
        throw new McpBoundaryError(
          'mcp.edit-transport-recovery-required',
          'stateful transport outcome lacks exact retained heads'
        )
      response = projectRetainedStatefulEditOutcomeV1(
        this.#retainedProjectionV1(
          name as RetainedStatefulEditProjectionV1['toolName'],
          request,
          retainedSession,
          retainedSessionFacts,
          retainedSessionFacts.outcome.classification as
            'completed' | 'refused'
        ),
        this.#responseProjectionAuthorityV1()
      )
    }
    const classification =
      retainedBegin?.disposition ??
      (outcome as EditIdempotentOutcomeProjectionV1).classification
    if (
      (classification === 'completed' && response.ok !== true) ||
      (classification === 'refused' && response.ok !== false) ||
      (classification !== 'completed' && classification !== 'refused')
    )
      throw new McpBoundaryError(
        'mcp.edit-transport-recovery-required',
        'the projected response differs from its retained semantic disposition'
      )
    try
    {
      // validate before transport retention: after a semantic terminal exists,
      // an invalid projection is recovery-required, never a generic audit fail
      assertEditToolReceiptFreeResponseV1(name, response)
      if (name === 'edit_begin')
      {
        if (retainedBegin === null)
          throw new McpBoundaryError(
            'mcp.edit-transport-recovery-required',
            'begin terminal lacks exact registry transport authority'
          )
        const target =
          await this.#options.lifecycle.retainedBeginTransportOutcomeTarget({
            request: request as EditBeginRequestV1,
            invocation,
          })
        response = await retainExactTransportResultV1({
          store: this.#options.transportStore,
          target,
          projection: {
            kind: 'begin',
            request: request as EditBeginRequestV1,
            outcome: retainedBegin,
            authority: this.#responseProjectionAuthorityV1(),
          },
        })
      }
      else if (
        retainedSession !== null &&
        retainedSessionFacts !== null &&
        retainedSessionFacts.outcome.preHead !== null &&
        retainedSessionFacts.outcome.postHead !== null
      )
      {
        const target = await retainedSession.retainedTransportOutcomeTargetV1({
          toolName: name,
          requestId,
          principalSha256: invocation.principalSha256,
          invocationSha256: invocation.invocationSha256,
          transportRequest: request,
        })
        response = await retainExactTransportResultV1({
          store: this.#options.transportStore,
          target,
          projection: {
            kind: 'stateful',
            projection: this.#retainedProjectionV1(
              name as RetainedStatefulEditProjectionV1['toolName'],
              request,
              retainedSession,
              retainedSessionFacts,
              retainedSessionFacts.outcome.classification as
                'completed' | 'refused'
            ),
            authority: this.#responseProjectionAuthorityV1(),
          },
        })
      }
      else
        throw new McpBoundaryError(
          'mcp.edit-transport-recovery-required',
          'stateful terminal lacks exact transport projection facts'
        )
    }
    catch
    {
      throw new McpBoundaryError(
        'mcp.edit-transport-recovery-required',
        'semantic outcome committed without durable transport-result authority'
      )
    }
    return response
  }

  #assertInvocation(invocation: HostInvocationContextV1): void
  {
    if (
      invocation.boundaryKind !== 'mcpStdio' ||
      invocation.principalSha256 !== this.#options.principalSha256
    )
      throw new McpBoundaryError(
        'mcp.edit-invocation-invalid',
        'the MCP edit host requires its bound stdio principal and correlation'
      )
  }

  #requiredSession(
    session: EditSessionLifecycleV1 | null
  ): EditSessionLifecycleV1
  {
    if (session === null)
      throw new EditSessionErrorV1(
        'edit.session_not_found',
        'the retained edit session is unavailable'
      )
    return session
  }

  #responseProjectionAuthorityV1(): EditStatefulResponseProjectionAuthorityV1
  {
    return {
      principalSha256: this.#options.principalSha256,
      realmSha256: this.#options.realmSha256,
      cursors: this.#options.cursors,
    }
  }

  #retainedProjectionV1(
    toolName: RetainedStatefulEditProjectionV1['toolName'],
    request: unknown,
    session: EditSessionLifecycleV1,
    facts: NonNullable<
      ReturnType<EditSessionLifecycleV1['retainedOutcomeFactsV1']>
    >,
    disposition: RetainedStatefulEditProjectionV1['disposition']
  ): RetainedStatefulEditProjectionV1
  {
    return {
      toolName,
      request,
      result: facts.result,
      disposition,
      sessionId: session.sessionId,
      attemptId: facts.outcome.attemptId,
      preHead: facts.outcome.preHead,
      postHead: facts.outcome.postHead,
      budget: facts.budget,
      events: facts.event === null ? [] : [facts.event],
      evidenceIds: facts.evidenceIds,
    }
  }

  #projectStatefulDataV1(
    toolName: RetainedStatefulEditProjectionV1['toolName'],
    request: unknown,
    result: unknown,
    session: EditSessionLifecycleV1,
    invocation: HostInvocationContextV1
  ): Record<string, unknown>
  {
    const requestId = recordValueV1(request)?.requestId
    if (typeof requestId !== 'string')
      throw new McpBoundaryError(
        'mcp.edit-transport-recovery-required',
        'stateful response projection lacks its request ID'
      )
    const facts = session.retainedOutcomeFactsV1({
      toolName,
      requestId,
      principalSha256: invocation.principalSha256,
      invocationSha256: invocation.invocationSha256,
      transportRequest: request,
    })
    if (
      facts === null ||
      facts.outcome.classification !== 'completed' ||
      facts.outcome.postHead === null
    )
      throw new McpBoundaryError(
        'mcp.edit-transport-recovery-required',
        'completed stateful result lacks its retained semantic authority'
      )
    if (
      semanticHashV1('server-audit', {
        kind: 'live-stateful-result-comparison-v1',
        result,
      }) !==
      semanticHashV1('server-audit', {
        kind: 'live-stateful-result-comparison-v1',
        result: facts.result,
      })
    )
      throw new McpBoundaryError(
        'mcp.edit-transport-recovery-required',
        'live stateful result differs from retained semantic authority'
      )
    const envelope = projectRetainedStatefulEditOutcomeV1(
      this.#retainedProjectionV1(
        toolName,
        request,
        session,
        facts,
        'completed'
      ),
      this.#responseProjectionAuthorityV1()
    )
    const data = recordValueV1(envelope.data)
    if (data === null)
      throw new McpBoundaryError(
        'mcp.edit-transport-recovery-required',
        'stateful response projector did not return exact success data'
      )
    return data
  }

  async #begin(
    request: EditBeginRequestV1,
    invocation: HostInvocationContextV1
  ): Promise<Record<string, unknown>>
  {
    const result = await this.#options.lifecycle.begin(request, invocation)
    const session = this.#options.lifecycle.session(result.sessionId)
    return this.#projectStatefulDataV1(
      'edit_begin',
      request,
      result,
      session,
      invocation
    )
  }

  async #assetAdmit(
    request: EditAssetAdmitRequestV1,
    session: EditSessionLifecycleV1,
    invocation: HostInvocationContextV1
  ): Promise<Record<string, unknown>>
  {
    const source =
      request.source.kind === 'inputFile'
        ? await this.#options.intake.inputFileAssetSource(
            request as EditAssetAdmitRequestV1 & {
              readonly source: Extract<
                EditAssetAdmitRequestV1['source'],
                { readonly kind: 'inputFile' }
              >
            }
          )
        : await session.sourceMediaAssetSourceV1({
            media: request.source.media,
            expectedPayloadSha256: request.source.expectedPayloadSha256,
          })
    const result: EditAssetAdmitDomainResultV1 = await session.admitAsset(
      {
        requestId: request.requestId,
        expectedHead: {
          sourceArtifactSha256: request.expectedSourceArtifactSha256,
          revisionNumber: request.expectedRevisionNumber,
          revisionId: request.expectedRevisionId,
          candidateSha256: request.expectedCandidateSha256,
          assetManifestSha256: request.expectedAssetManifestSha256,
          changeContractSha256: request.expectedChangeContractSha256,
          capabilityProfileSha256: request.expectedCapabilityProfileSha256,
          capabilitySnapshotSha256: request.expectedCapabilitySnapshotSha256,
        },
        source,
        transportRequest: request,
      },
      invocation
    )
    return this.#projectStatefulDataV1(
      'edit_asset_admit',
      request,
      result,
      session,
      invocation
    )
  }

  async #preview(
    request: EditPreviewRequestV1,
    session: EditSessionLifecycleV1,
    invocation: HostInvocationContextV1
  ): Promise<Record<string, unknown>>
  {
    const result: EditPreviewResultV1 = await session.preview(
      request,
      invocation
    )
    return this.#projectStatefulDataV1(
      'edit_preview',
      request,
      result,
      session,
      invocation
    )
  }

  async #apply(
    request: EditApplyRequestV1,
    session: EditSessionLifecycleV1,
    invocation: HostInvocationContextV1
  ): Promise<Record<string, unknown>>
  {
    const result: EditApplyDomainResultV1 = await session.apply(
      request,
      invocation
    )
    return this.#projectStatefulDataV1(
      'edit_apply',
      request,
      result,
      session,
      invocation
    )
  }

  async #checkpoint(
    request: EditCheckpointRequestV1,
    session: EditSessionLifecycleV1,
    invocation: HostInvocationContextV1
  ): Promise<Record<string, unknown>>
  {
    const result: EditCheckpointResultV1 = await session.checkpoint(
      request,
      invocation
    )
    return this.#projectStatefulDataV1(
      'edit_checkpoint',
      request,
      result,
      session,
      invocation
    )
  }

  async #restore(
    restore: EditRestoreDispatchV1,
    session: EditSessionLifecycleV1,
    invocation: HostInvocationContextV1
  ): Promise<Record<string, unknown>>
  {
    const [tool, request] = restore
    const result: EditRestoreDomainResultV1 =
      tool === 'edit_undo'
        ? await session.undo(request, invocation)
        : await session.rollback(request, invocation)
    return this.#projectStatefulDataV1(
      tool,
      request,
      result,
      session,
      invocation
    )
  }

  async #evaluate(
    request: EditEvaluateRequestV1,
    session: EditSessionLifecycleV1,
    invocation: HostInvocationContextV1
  ): Promise<Record<string, unknown>>
  {
    const result: EditEvaluateDomainResultV1 = await session.evaluate(
      request,
      invocation
    )
    return this.#projectStatefulDataV1(
      'edit_evaluate',
      request,
      result,
      session,
      invocation
    )
  }

  async #export(
    request: EditExportRequestV1,
    session: EditSessionLifecycleV1,
    invocation: HostInvocationContextV1
  ): Promise<Record<string, unknown>>
  {
    const result: EditExportDomainResultV1 = await session.export(
      request,
      invocation
    )
    return this.#projectStatefulDataV1(
      'edit_export',
      request,
      result,
      session,
      invocation
    )
  }

  async #close(
    request: EditCloseRequestV1,
    session: EditSessionLifecycleV1,
    invocation: HostInvocationContextV1
  ): Promise<Record<string, unknown>>
  {
    const result: EditCloseDomainResultV1 = await session.close(
      request,
      invocation
    )
    return this.#projectStatefulDataV1(
      'edit_close',
      request,
      result,
      session,
      invocation
    )
  }

  async #capabilities(
    request: EditCapabilitiesRequestV1
  ): Promise<Record<string, unknown>>
  {
    const session =
      request.context?.kind === 'edit'
        ? this.#options.lifecycle.session(request.context.sessionId)
        : null
    if (request.context?.kind === 'edit')
    {
      if (session === null)
        throw new EditSessionErrorV1(
          'edit.session_not_found',
          'capability discovery session is unavailable'
        )
      if (request.context.expectedRevisionId !== session.head.revisionId)
        throw new EditSessionErrorV1(
          'edit.stale_revision',
          'capability discovery expected a different revision',
          false,
          {
            currentRevisionId: session.head.revisionId,
            expectedRevisionId: request.context.expectedRevisionId,
          }
        )
    }
    const facts = await this.#options.lifecycle.capabilities(request)
    const query = request.query
    const family = new Map(
      facts.profile.profile.familyAssessments.map((value) => [
        value.family,
        value,
      ])
    )
    let items: CapabilityItemV1[]
    if (query.kind === 'operations' || query.kind === 'summary')
      items = OPERATION_REVIEW_ROWS.filter(
        (row) =>
          query.kind === 'summary' ||
          query.operationKinds === undefined ||
          query.operationKinds.includes(row.kind)
      ).map((row) =>
      {
        const assessment = family.get(row.family)
        return {
          itemKind: 'operation',
          operationKind: row.kind,
          executableGroup: row.executableGroup,
          availability: assessment?.availability ?? 'unsupported',
          operationContractSha256: semanticHashV1('capability-profile', {
            kind: 'operation-contract',
            row,
          }),
          resultSlotContractSha256: semanticHashV1('capability-profile', {
            kind: 'operation-result-slot-contract',
            fixed: row.fixedResultSlots,
            dynamic: row.dynamicResultSlots,
          }),
          limitationCodes: assessment?.refusalCodes ?? [],
        }
      })
    else if (query.kind === 'blockDescriptors')
      items = VANILLA_CORE_DESCRIPTORS.filter(
        (row) =>
          query.opcodePrefix === undefined ||
          row.opcode.startsWith(query.opcodePrefix)
      ).map((row) => ({
        itemKind: 'blockDescriptor',
        opcode: row.opcode,
        category: row.category,
        shape: row.shape,
        availability: 'supported',
        descriptorSha256: semanticHashV1('capability-profile', {
          kind: 'block-descriptor',
          row,
        }),
        fieldContractSha256: semanticHashV1('capability-profile', {
          kind: 'block-field-contract',
          required: row.requiredFields,
          optional: row.optionalFields,
        }),
        inputContractSha256: semanticHashV1('capability-profile', {
          kind: 'block-input-contract',
          required: row.requiredInputs,
          optional: row.optionalInputs,
        }),
        limitationCodes: [],
      }))
    else if (query.kind === 'limits')
      items = Object.values(PHASE_8_EDIT_LIMIT_AUTHORITY_V1).map((limit) => ({
        itemKind: 'limit',
        key: limit.editLimitKey,
        defaultValue: limit.defaultValue,
        effectiveValue: facts.effectiveLimits[limit.editLimitKey],
        hardMaximum: limit.hardMaximum,
      }))
    else if (query.kind === 'selectors')
      items = [
        'target',
        'declaration',
        'script',
        'block',
        'topLevelPrimitive',
        'procedure',
        'parameter',
        'comment',
        'media',
      ].flatMap((entityKind) =>
        facts.profile.profile.selectorKinds.map((selectorKind) => ({
          itemKind: 'selector' as const,
          entityKind: entityKind as never,
          selectorKind,
          availability:
            selectorKind === 'handle' && entityKind === 'topLevelPrimitive'
              ? ('preservationOnly' as const)
              : ('supported' as const),
          occurrenceSelectionSupported: selectorKind === 'matchSet',
          selectorContractSha256: semanticHashV1('capability-profile', {
            kind: 'selector-contract',
            entityKind,
            selectorKind,
          }),
        }))
      )
    else if (query.kind === 'limitations')
      items = facts.profile.profile.familyAssessments.map((assessment) => ({
        itemKind: 'limitation',
        limitationCode:
          assessment.refusalCodes[0] ?? 'edit.unsupported_operation',
        availability: assessment.availability,
        affectedSemanticScopeSha256:
          assessment.affectedSemanticScopeSha256 ??
          semanticHashV1('capability-profile', {
            kind: 'capability-family-scope',
            family: assessment.family,
          }),
        explanation: assessment.boundedExplanation,
      }))
    else
      items = REFUSAL_CODES.map((code) => ({
        itemKind: 'refusalCode',
        code,
        callerReachable: code !== 'edit.audit_failed',
        toolSetSha256: semanticHashV1('capability-profile', {
          kind: 'refusal-tool-set',
          code,
        }),
        stateSetSha256: semanticHashV1('capability-profile', {
          kind: 'refusal-state-set',
          code,
        }),
      }))
    const collectionSha256 = semanticHashV1('capability-profile', {
      kind: 'capability-collection',
      query,
      items,
    })
    const binding: EditCursorBindingV1 = {
      sessionId:
        session?.sessionId ??
        `capability-${facts.head.sourceArtifactSha256.slice(0, 32)}`,
      scope: 'capabilities',
      revisionId: facts.head.revisionId,
      revisionNumber: facts.head.revisionNumber,
      querySha256: semanticHashV1('transport-request', query),
      collectionSha256,
      diffSha256: ZERO_SHA256,
    }
    const offset = this.#options.cursors.offset(binding, request.page?.cursor)
    const size = editPageSizeV1(request.page?.pageSize)
    const pageItems = items.slice(offset, offset + size)
    const next = offset + pageItems.length
    return {
      capabilityProfileSha256: facts.profile.capabilityProfileSha256,
      capabilitySnapshotSha256: facts.snapshot.capabilitySnapshotSha256,
      evidenceIds: facts.evidenceIds,
      collection: {
        collectionSha256,
        items: pageItems,
        totalCount: items.length,
        ...(next < items.length
          ? { nextCursor: this.#options.cursors.issue(binding, next) }
          : {}),
      },
    }
  }

  async #inspect(
    request: EditInspectRequestV1,
    session: EditSessionLifecycleV1
  ): Promise<Record<string, unknown>>
  {
    if (request.query.kind === 'operationPlanningFacts')
    {
      if (request.revisionSelection !== 'currentHead')
        throw new EditSessionErrorV1(
          'edit.stale_revision',
          'operation planning is available only at the current head',
          false,
          {
            expectedRevisionId: request.revisionId,
            currentRevisionId: session.head.revisionId,
          }
        )
      this.#assertInspectionHead(request, session.head)
      const planning = await session.retainedOperationPlanningFactsV1(
        request.query
      )
      const choiceRows = planningChoiceRows(
        planning.binding,
        request.query,
        planning.choiceSlots
      )
      const choiceSetSha256 = operationChoiceSetSha256(
        planning.binding,
        choiceRows
      )
      const choices =
        request.query.planningStage === 'completeChoices'
          ? request.query.choices
          : Object.freeze([])
      if (request.query.planningStage === 'completeChoices')
      {
        if (request.query.expectedChoiceSetSha256 !== choiceSetSha256)
          throw new EditSessionErrorV1(
            'edit.planning_facts_mismatch',
            'the expected operation choice set changed',
            false,
            { opId: request.query.goal.opId }
          )
        if (choices.length !== choiceRows.length)
          throw new EditSessionErrorV1(
            'edit.cardinality_mismatch',
            'operation planning choices do not cover every exact slot',
            false,
            {
              opId: request.query.goal.opId,
              matchCount: choices.length,
            }
          )
        for (let index = 0; index < choiceRows.length; index++)
        {
          const expected = choiceRows[index]!
          const actual = choices[index]!
          if (
            actual.operationKind !== expected.operationKind ||
            actual.destination !== expected.destination ||
            actual.choiceSlotKey !== expected.choiceSlotKey
          )
            throw new EditSessionErrorV1(
              'edit.planning_facts_mismatch',
              'operation planning choice order or identity changed',
              false,
              { opId: request.query.goal.opId }
            )
        }
      }
      const completedChoiceSha256 = completedChoiceProjectionSha256(
        planning.binding,
        choices
      )
      const items: readonly (
        OperationPlanningChoiceSlotRowV1 | OperationPlanningFactRowV1
      )[] =
        request.query.planningStage === 'enumerateChoices'
          ? choiceRows
          : Object.freeze(
              (planning.completion?.facts ?? []).map(
                (fact): OperationPlanningFactRowV1 =>
                  ({
                    itemKind: 'planningFact',
                    operationKind: planning.completion!.operationKind,
                    destination: fact.destination,
                    availability: 'available',
                    value: fact.value,
                    evidenceIds: [planning.binding.revisionId],
                  }) as OperationPlanningFactRowV1
              )
            )
      if (
        request.query.planningStage === 'completeChoices' &&
        planning.completion === null
      )
        throw new EditSessionErrorV1(
          'edit.planning_facts_unavailable',
          'the retained planning authority returned no completed facts',
          false,
          { opId: request.query.goal.opId }
        )
      const querySha256 = semanticHashV1('transport-request', request.query)
      const collectionSha256 = semanticHashV1('resolved-plan', {
        kind:
          request.query.planningStage === 'enumerateChoices'
            ? 'operation-planning-ordered-choice-collection'
            : 'operation-planning-ordered-fact-collection',
        schemaVersion: 1,
        binding: planning.binding,
        completedChoiceProjectionSha256: completedChoiceSha256,
        items,
      })
      const cursorBinding: EditCursorBindingV1 = {
        sessionId: session.sessionId,
        scope: 'inspection',
        revisionId: session.head.revisionId,
        revisionNumber: session.head.revisionNumber,
        querySha256,
        collectionSha256,
        diffSha256: ZERO_SHA256,
      }
      const offset = this.#options.cursors.offset(
        cursorBinding,
        request.page?.cursor
      )
      const size = editPageSizeV1(request.page?.pageSize)
      const pageItems = items.slice(offset, offset + size)
      const next = offset + pageItems.length
      const planningHeader =
        request.query.planningStage === 'enumerateChoices'
          ? {
              binding: planning.binding,
              choiceSetSha256,
              completedChoiceProjectionSha256: completedChoiceSha256,
              totalChoiceCount: items.length,
              orderedChoiceCollectionSha256: collectionSha256,
            }
          : {
              binding: planning.binding,
              expectedChoiceSetSha256: choiceSetSha256,
              completedChoiceProjectionSha256: completedChoiceSha256,
              planningFactSetSha256: planning.completion!.planningFactSetSha256,
              totalFactCount: items.length,
              orderedFactCollectionSha256: collectionSha256,
            }
      return {
        revisionSelection: 'currentHead',
        requestedRevision: session.head,
        querySha256,
        handlesIssued: false,
        evidenceIds: [planning.binding.revisionId],
        planningHeader,
        collection: {
          collectionSha256,
          items: pageItems,
          totalCount: items.length,
          ...(next < items.length
            ? { nextCursor: this.#options.cursors.issue(cursorBinding, next) }
            : {}),
        },
      }
    }
    const historical = request.revisionSelection === 'retainedRevision'
    if (!historical) this.#assertInspectionHead(request, session.head)
    const entityKindByQuery = new Map<
      string,
      EditInspectDomainItemV1['entityKind']
    >([
      ['targets', 'target'],
      ['declarations', 'declaration'],
      ['scripts', 'script'],
      ['blocks', 'block'],
      ['topLevelPrimitives', 'topLevelPrimitive'],
      ['procedures', 'procedure'],
      ['parameters', 'parameter'],
      ['comments', 'comment'],
      ['media', 'media'],
    ])
    const entityKind = entityKindByQuery.get(request.query.kind)
    const facts = await session.retainedInspectionFactsV1({
      ...(historical
        ? {
            revisionNumber: request.revisionNumber,
            revisionId: request.revisionId,
          }
        : {}),
      issueHandles: !historical && request.issueHandles === true,
      ...(request.query.kind === 'summary'
        ? {}
        : { entityKinds: entityKind === undefined ? [] : [entityKind] }),
    })
    if (historical) this.#assertInspectionHead(request, facts.revision)
    if (request.query.kind === 'operationResults')
    {
      const selected = retainedOperationResultSelectionV1({
        groups: facts.collections.operationResults.items,
        attempts: facts.collections.attempts.items,
        query: request.query,
      })
      const collection = operationResultPage(
        this.#options,
        session.sessionId,
        facts.revision,
        selected.selection,
        selected.collectionSha256,
        selected.items,
        request.page
      )
      return {
        revisionSelection: request.revisionSelection,
        requestedRevision: historical
          ? exactRevision(facts.revision)
          : facts.revision,
        querySha256: operationResultSelectionSha256V1(selected.selection),
        handlesIssued: false,
        evidenceIds: Object.freeze(
          [
            ...new Set(selected.items.flatMap((item) => item.evidenceIds)),
          ].sort()
        ),
        collection,
      }
    }
    let items: readonly unknown[]
    if (request.query.kind === 'summary')
      items = facts.items.map((item) => inspectEntity(item, historical))
    else if (entityKind !== undefined)
      items = facts.items
        .filter(
          (item) =>
            item.entityKind === entityKind &&
            (request.query.kind !== 'targets' ||
              request.query.targetKind === undefined ||
              item.entitySubtype === request.query.targetKind)
        )
        .map((item) => inspectEntity(item, historical))
    else
    {
      const retainedKind =
        request.query.kind === 'capabilities' ? null : request.query.kind
      if (retainedKind === null) items = []
      else
      {
        const collection =
          facts.collections[retainedKind as keyof typeof facts.collections]
        items = collection.items.map(boundedRecord)
      }
    }
    const querySha256 = semanticHashV1('transport-request', {
      kind: 'inspection-query',
      schemaVersion: 1,
      revision: facts.revision,
      query: request.query,
      itemAuthoritySha256: facts.querySha256,
      handlesIssued: facts.handlesIssued,
    })
    const collectionSha256 = semanticHashV1('semantic-report-projection', {
      kind: historical
        ? 'historical-inspection-collection'
        : 'current-inspection-collection',
      revision: facts.revision,
      querySha256,
      items,
    })
    const binding: EditCursorBindingV1 = {
      sessionId: session.sessionId,
      scope: 'inspection',
      revisionId: facts.revision.revisionId,
      revisionNumber: facts.revision.revisionNumber,
      querySha256,
      collectionSha256,
      diffSha256: ZERO_SHA256,
    }
    const offset = this.#options.cursors.offset(binding, request.page?.cursor)
    const size = editPageSizeV1(request.page?.pageSize)
    const pageItems = items.slice(offset, offset + size)
    const next = offset + pageItems.length
    return {
      revisionSelection: request.revisionSelection,
      requestedRevision: historical
        ? exactRevision(facts.revision)
        : facts.revision,
      querySha256,
      handlesIssued: !historical && facts.handlesIssued,
      evidenceIds: inspectionPageEvidenceIdsV1(pageItems),
      collection: {
        collectionSha256,
        items: pageItems,
        totalCount: items.length,
        ...(next < items.length
          ? { nextCursor: this.#options.cursors.issue(binding, next) }
          : {}),
      },
    }
  }

  #assertInspectionHead(
    request: EditInspectRequestV1,
    head: EditSessionLifecycleV1['head']
  ): void
  {
    const expectedRevisionId =
      request.revisionSelection === 'currentHead'
        ? request.expectedRevisionId
        : request.revisionId
    const expectedRevisionNumber =
      request.revisionSelection === 'currentHead'
        ? request.expectedRevisionNumber
        : request.revisionNumber
    if (expectedRevisionId !== head.revisionId)
      throw new EditSessionErrorV1(
        'edit.stale_revision',
        'inspection expected a different revision',
        false,
        {
          currentRevisionId: head.revisionId,
          expectedRevisionId,
        }
      )
    if (expectedRevisionNumber !== head.revisionNumber)
      throw new EditSessionErrorV1(
        'edit.stale_revision',
        'inspection expected a different revision number',
        false,
        {
          currentRevisionId: head.revisionId,
          expectedRevisionId,
        }
      )
    if (request.expectedCandidateSha256 !== head.candidateSha256)
      throw new EditSessionErrorV1(
        'edit.stale_candidate',
        'inspection expected a different candidate',
        false,
        {
          currentCandidateSha256: head.candidateSha256,
          expectedCandidateSha256: request.expectedCandidateSha256,
        }
      )
    if (request.expectedSourceArtifactSha256 !== head.sourceArtifactSha256)
      throw new EditSessionErrorV1(
        'edit.source_identity_mismatch',
        'inspection expected a different source artifact'
      )
    if (request.expectedChangeContractSha256 !== head.changeContractSha256)
      throw new EditSessionErrorV1(
        'edit.stale_contract',
        'inspection expected a different change contract'
      )
    if (
      request.expectedCapabilityProfileSha256 !== head.capabilityProfileSha256
    )
      throw new EditSessionErrorV1(
        'edit.stale_capability_profile',
        'inspection expected a different capability profile'
      )
    if (request.expectedAssetManifestSha256 !== head.assetManifestSha256)
      throw new EditSessionErrorV1(
        'edit.stale_revision',
        'inspection expected a different asset manifest',
        false,
        {
          currentRevisionId: head.revisionId,
          expectedRevisionId,
        }
      )
  }

  async #status(
    request: EditStatusRequestV1,
    invocation: HostInvocationContextV1
  ): Promise<Record<string, unknown>>
  {
    if (request.lookup === 'idempotency')
    {
      const outcome =
        request.toolName === 'edit_begin'
          ? await this.#options.lifecycle.lookupBeginOutcome(
              {
                schemaVersion: 1,
                requestId: request.requestId,
                ...request.beginRequest,
              },
              invocation
            )
          : this.#options.lifecycle
              .session(request.sessionId)
              .lookupIdempotentOutcomeV1({
                toolName: request.toolName,
                requestId: request.requestId,
                principalSha256: invocation.principalSha256,
              })
      if (outcome === null)
        throw new EditSessionErrorV1(
          'edit.idempotency_not_found',
          'the retained idempotency outcome is unavailable'
        )
      const evidenceIds = outcome.retainedOutcomeSha256
        ? [outcome.retainedOutcomeSha256]
        : []
      return outcome.classification === 'pending'
        ? {
            lookup: 'idempotency',
            classification: 'pending',
            namespace: this.#idempotencyNamespace(outcome, invocation),
            retainedStatusSha256: semanticHashV1(
              'semantic-report-projection',
              outcome
            ),
            evidenceIds,
          }
        : {
            lookup: 'idempotency',
            classification:
              outcome.classification === 'refused' ? 'refused' : 'completed',
            namespace: this.#idempotencyNamespace(outcome, invocation),
            retainedOutcomeSha256:
              outcome.retainedOutcomeSha256 ??
              semanticHashV1('semantic-report-projection', outcome),
            ...(outcome.sessionId === null
              ? {}
              : { sessionId: outcome.sessionId }),
            evidenceIds,
          }
    }
    const session = this.#options.lifecycle.session(request.sessionId)
    const result = await session.status(invocation)
    const retained = session.retainedStatusFactsV1()
    const exportLimitationSetSha256 = semanticHashV1(
      'semantic-report-projection',
      {
        kind: 'edit-export-limitation-set',
        exportability: retained.exportability,
      }
    )
    return {
      lookup: 'session',
      sessionId: result.sessionId,
      state: result.state,
      head: result.head,
      ...(result.busyKind === null ? {} : { busyKind: result.busyKind }),
      budget: budgetProjection(result.budget),
      eventHeadSha256: result.eventHeadSha256,
      capabilityProfileSha256: result.capabilityProfileSha256,
      capabilitySnapshotSha256: result.capabilitySnapshotSha256,
      awaitingEvaluations: result.awaitingEvaluations,
      exportReady: result.exportReady,
      exportLimitationSetSha256,
      evidenceIds: retained.evidenceIds,
      auditHeadSha256: this.#options.auditHead.currentAuditHeadSha256(),
    }
  }

  #refusal(
    tool: EditToolName,
    request: unknown,
    invocation: HostInvocationContextV1,
    session: EditSessionLifecycleV1 | null,
    error: unknown
  ): Record<string, unknown>
  {
    const requested = request as { readonly requestId?: string }
    const code: RefusalCode =
      error instanceof EditSessionErrorV1
        ? error.code
        : error instanceof McpBoundaryError
          ? error.code === 'mcp.edit-source-changed'
            ? 'edit.source_identity_mismatch'
            : error.code === 'mcp.edit-source-not-editable'
              ? 'edit.source_not_editable'
              : error.code === 'mcp.edit-cursor-invalid'
                ? 'edit.cursor_invalid'
                : error.code === 'mcp.edit-cursor-stale'
                  ? 'edit.cursor_stale'
                  : 'edit.internal_invariant'
          : 'edit.internal_invariant'
    const safeMessage =
      error instanceof EditSessionErrorV1
        ? error.message
        : code === 'edit.cursor_invalid'
          ? 'the pagination cursor is invalid'
          : code === 'edit.cursor_stale'
            ? 'the pagination cursor is stale'
            : 'the edit authority could not complete the request safely'
    const context =
      error instanceof EditSessionErrorV1 ? error.context : Object.freeze({})
    if (session !== null && typeof requested.requestId === 'string')
    {
      const facts = session.retainedOutcomeFactsV1({
        toolName: tool,
        requestId: requested.requestId,
        principalSha256: invocation.principalSha256,
        invocationSha256: invocation.invocationSha256,
        transportRequest: request,
      })
      if (
        facts !== null &&
        facts.outcome.classification === 'refused' &&
        facts.outcome.preHead !== null &&
        facts.outcome.postHead !== null
      )
      {
        return projectRetainedStatefulEditOutcomeV1(
          this.#retainedProjectionV1(
            tool as RetainedStatefulEditProjectionV1['toolName'],
            request,
            session,
            facts,
            'refused'
          ),
          this.#responseProjectionAuthorityV1()
        )
      }
    }
    return {
      schemaVersion: 1,
      ok: false,
      tool,
      ...(typeof requested.requestId === 'string'
        ? { requestId: requested.requestId }
        : {}),
      error: { code, safeMessage, context },
    }
  }

  #idempotencyNamespace(
    outcome: EditIdempotentOutcomeProjectionV1,
    invocation: HostInvocationContextV1
  ): Record<string, unknown>
  {
    return {
      toolName: outcome.toolName,
      requestId: outcome.requestId,
      requestSha256: outcome.requestSha256,
      principalSha256: invocation.principalSha256,
      realmSha256: this.#options.realmSha256,
      profileSha256: this.#options.profileSha256,
      ...(outcome.sessionId === null
        ? { beginNamespaceSha256: outcome.namespaceSha256 }
        : { sessionId: outcome.sessionId }),
    }
  }
}
