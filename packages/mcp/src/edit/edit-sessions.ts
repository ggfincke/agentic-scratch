// packages/mcp/src/edit/edit-sessions.ts
// transport registry, source lease admission, HMAC cursors, & edit kernel host ports

import { LOWERCASE_SHA256_PATTERN } from '../internal/sha256-pattern.js'

import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'

import {
  createEditSessionRegistryV1,
  discoverEditCapabilityFactsV1,
  EditSessionErrorV1,
  inventoryRetainedEditSessionsV1,
  isEditPublicationCapabilityReadyV1,
  semanticHashV1,
  SYSTEM_EDIT_CLOCK,
  type EditBeginDomainResultV1,
  type EditBeginRequestV1,
  type EditBeginSourceIdentityV1,
  type EditCapabilitiesRequestV1,
  type EditChangeContractRegistryV1,
  type EditClockPort,
  type EditEntropyPort,
  type EditEvaluationPortsV1,
  type EditIdempotentOutcomeProjectionV1,
  type EditPublicationPort,
  type EditRetainedCapabilityFactsV1,
  type EditRetainedResourceCataloguePortV1,
  type RetainedEditSessionEvidenceV1,
  type EditSessionLifecycleV1,
  type EditSessionRegistryIdentityV1,
  type EditSessionRegistryLifecycleV1,
  type EditSourceIntakeV1,
  type EditSourceProvenanceV1,
  type EditToolName,
  type EditTransportOutcomeTargetV1,
  type HostInvocationContextV1,
  type RetainedEditBeginOutcomeAuthorityV1,
} from '@scratch-agent/edit'

import {
  DirectEditToolHostV1,
  type EditHostLifecycleAuthorityV1,
  type EditHostArtifactResourcesPortV1,
  type EditHostAuditHeadPortV1,
  type EditTrustedIntakePortV1,
} from './edit-host.js'
import type { EditToolHostV1 } from './edit-tools.js'
import { McpBoundaryError } from '../transport/errors.js'
import type {
  EditSourceAdmittedIdentityV1,
  EditSourceLeaseV1,
  EditSourceOpeningRefusalAuthorityV1,
  ProjectSessionRegistry,
} from '../project/project-sessions.js'

export const DEFAULT_EDIT_PAGE_SIZE = 20
export const MAX_EDIT_PAGE_SIZE = 50

// a cursor is an OpaqueId, so it carries no separator: 1 version byte, a 4-byte
// offset, a 16-byte binding prefix, & a 16-byte MAC, base64url encoded
const CURSOR_VERSION = 1
const CURSOR_BINDING_BYTES = 16
const CURSOR_MAC_BYTES = 16
const CURSOR_BODY_BYTES = 1 + 4 + CURSOR_BINDING_BYTES
const CURSOR_TOKEN_BYTES = CURSOR_BODY_BYTES + CURSOR_MAC_BYTES
const CURSOR_ENCODED_LENGTH =
  Buffer.alloc(CURSOR_TOKEN_BYTES).toString('base64url').length
const CURSOR_BASE64URL = /^[A-Za-z0-9_-]+$/u

// * every collection a cursor may page over. A cursor names its scope so a diff
// * cursor can never be replayed as a history cursor even at the same revision
export type EditCursorScopeV1 =
  'capabilities' | 'inspection' | 'diff' | 'history' | 'operationResults'

// * the exact identity a cursor is bound to. Every field enters the MAC, so a
// * cursor issued against one revision, query, collection, or diff cannot be
// * replayed against another: the binding prefix simply stops matching
export interface EditCursorBindingV1
{
  readonly sessionId: string
  readonly scope: EditCursorScopeV1
  readonly revisionId: string
  readonly revisionNumber: number
  readonly querySha256: string
  readonly collectionSha256: string
  readonly diffSha256: string
}

function cursorBindingDigest(binding: EditCursorBindingV1): Buffer
{
  return Buffer.from(
    semanticHashV1('transport-request', {
      kind: 'edit-pagination-cursor-binding',
      schemaVersion: 1,
      sessionId: binding.sessionId,
      scope: binding.scope,
      revisionId: binding.revisionId,
      revisionNumber: binding.revisionNumber,
      querySha256: binding.querySha256,
      collectionSha256: binding.collectionSha256,
      diffSha256: binding.diffSha256,
    }),
    'hex'
  )
}

// * the pagination-cursor HMAC purpose is deliberately its own secret. It is
// * never the semantic-hash, semantic-handle, or server-audit-tail key, so a
// * token minted for one purpose cannot verify as another
export class EditPaginationCursorAuthorityV1
{
  readonly #secret: Buffer

  constructor(secret: Uint8Array = randomBytes(32))
  {
    if (secret.byteLength < 32)
    {
      throw new McpBoundaryError(
        'mcp.edit-cursor-secret-invalid',
        'pagination cursor secret must carry at least 256 bits'
      )
    }
    this.#secret = Buffer.from(secret)
  }

  issue(binding: EditCursorBindingV1, offset: number): string
  {
    if (!Number.isSafeInteger(offset) || offset < 0 || offset > 0xffffffff)
    {
      throw new McpBoundaryError(
        'mcp.edit-cursor-invalid',
        'cursor offset is outside the representable range'
      )
    }
    const body = Buffer.alloc(CURSOR_BODY_BYTES)
    body.writeUInt8(CURSOR_VERSION, 0)
    body.writeUInt32BE(offset, 1)
    cursorBindingDigest(binding).copy(body, 5, 0, CURSOR_BINDING_BYTES)
    return Buffer.concat([body, this.#mac(body)]).toString('base64url')
  }

  // absent cursor starts at zero; a forged or malformed one is invalid, & a
  // structurally sound cursor bound to different state is stale
  offset(binding: EditCursorBindingV1, value: unknown): number
  {
    if (value === undefined || value === null) return 0
    if (
      typeof value !== 'string' ||
      value.length !== CURSOR_ENCODED_LENGTH ||
      !CURSOR_BASE64URL.test(value)
    )
    {
      throw new McpBoundaryError('mcp.edit-cursor-invalid', 'cursor is invalid')
    }
    const token = Buffer.from(value, 'base64url')
    if (
      token.byteLength !== CURSOR_TOKEN_BYTES ||
      token.toString('base64url') !== value ||
      token.readUInt8(0) !== CURSOR_VERSION
    )
    {
      throw new McpBoundaryError('mcp.edit-cursor-invalid', 'cursor is invalid')
    }
    const body = token.subarray(0, CURSOR_BODY_BYTES)
    const presented = token.subarray(CURSOR_BODY_BYTES)
    const expected = this.#mac(body)
    if (
      presented.byteLength !== expected.byteLength ||
      !timingSafeEqual(presented, expected)
    )
    {
      throw new McpBoundaryError(
        'mcp.edit-cursor-invalid',
        'cursor signature is invalid'
      )
    }
    const presentedBinding = body.subarray(5)
    const currentBinding = cursorBindingDigest(binding).subarray(
      0,
      CURSOR_BINDING_BYTES
    )
    if (!timingSafeEqual(presentedBinding, currentBinding))
    {
      throw new McpBoundaryError(
        'mcp.edit-cursor-stale',
        'cursor was issued against a different revision, query, or collection'
      )
    }
    return body.readUInt32BE(1)
  }

  #mac(body: Buffer): Buffer
  {
    return createHmac('sha256', this.#secret)
      .update('scratch-edit/pagination-cursor/v1')
      .update(body)
      .digest()
      .subarray(0, CURSOR_MAC_BYTES)
  }
}

export function editPageSizeV1(value: unknown): number
{
  if (value === undefined) return DEFAULT_EDIT_PAGE_SIZE
  if (
    !Number.isSafeInteger(value) ||
    Number(value) < 1 ||
    Number(value) > MAX_EDIT_PAGE_SIZE
  )
  {
    throw new McpBoundaryError(
      'mcp.edit-page-invalid',
      `pageSize must be an integer from 1 to ${MAX_EDIT_PAGE_SIZE}`
    )
  }
  return Number(value)
}

// * the transport's own boundary claim. Every edit call the MCP surface makes
// * carries mcpStdio, which is what lets the audit subsystem attribute a
// * transport invocation apart from a direct-host one
export function mcpStdioInvocationV1(input: {
  readonly callId: string
  readonly toolName: EditToolName
  readonly requestSha256: string
  readonly principalSha256: string
}): HostInvocationContextV1
{
  return Object.freeze({
    boundaryKind: 'mcpStdio',
    invocationSha256: semanticHashV1('transport-request', {
      kind: 'mcp-stdio-invocation',
      schemaVersion: 1,
      callId: input.callId,
      toolName: input.toolName,
      requestSha256: input.requestSha256,
    }),
    principalSha256: input.principalSha256,
  })
}

export interface EditTransportRegistryOptionsV1
{
  readonly projects: ProjectSessionRegistry
  readonly changeContracts: EditChangeContractRegistryV1
  readonly identity: EditSessionRegistryIdentityV1
  readonly artifactStore: Parameters<
    typeof createEditSessionRegistryV1
  >[0]['artifactStore']
  readonly handleSecret: Uint8Array
  readonly principalSha256: string
  readonly evaluationPorts: EditEvaluationPortsV1
  readonly publicationPort: EditPublicationPort
  readonly trustedIntake: EditTrustedIntakePortV1
  readonly auditHead: EditHostAuditHeadPortV1
  readonly artifactResources: EditHostArtifactResourcesPortV1
  readonly resourceCatalogue: EditRetainedResourceCataloguePortV1
  readonly clock?: EditClockPort
  readonly entropy?: EditEntropyPort
  readonly cursorSecret?: Uint8Array
  readonly retainedSessionInventory?: readonly RetainedEditSessionEvidenceV1[]
}

export interface EditTransportSessionEvidenceV1
{
  readonly sessionId: string
  readonly state: EditSessionLifecycleV1['state']
  readonly head: EditSessionLifecycleV1['head']
  readonly eventHeadSha256: string
  readonly reportSha256: string
  readonly recoverable: boolean
}

export interface EditTransportEvidenceSummaryV1
{
  readonly sessions: readonly EditTransportSessionEvidenceV1[]
  readonly revisionSha256s: readonly string[]
  readonly parentDeltaSha256s: readonly string[]
  readonly cumulativeDeltaSha256s: readonly string[]
  readonly preservationSha256s: readonly string[]
  readonly lineageSha256s: readonly string[]
  readonly certificateSha256s: readonly string[]
  readonly reportProjectionSha256s: readonly string[]
  readonly exportReceiptSha256s: readonly string[]
  readonly recoverableSessionCount: number
  readonly hasRecoverableState: boolean
  readonly summarySha256: string
}

function assertSha256V1(value: string, label: string): void
{
  if (!LOWERCASE_SHA256_PATTERN.test(value))
    throw new McpBoundaryError(
      'mcp.edit-host-port-invalid',
      `${label} must be a lowercase SHA-256 digest`
    )
}

// * startup probes every trusted capability before constructing the registry,
// * so a profile cannot advertise edit tools around a missing durability,
// * evaluation, publication, intake, paging, or response-authority port
async function assertEditTransportPortsReadyV1(
  options: EditTransportRegistryOptionsV1
): Promise<void>
{
  assertSha256V1(options.principalSha256, 'edit principal identity')
  const store = await options.artifactStore.capability()
  if (
    !store.writable ||
    !store.exclusiveWriter ||
    !store.durableFileSync ||
    !store.durableDirectorySync ||
    !store.noReplaceInstall ||
    !store.expectedHashPointerCas
  )
    throw new McpBoundaryError(
      'mcp.edit-host-port-unavailable',
      'edit artifact storage lacks a required durable atomic capability'
    )
  const publication = await options.publicationPort.capability()
  if (!isEditPublicationCapabilityReadyV1(publication))
    throw new McpBoundaryError(
      'mcp.edit-host-port-unavailable',
      'edit publication lacks a required containment or durability capability'
    )
  const runners = options.evaluationPorts.deterministic.runnerAvailabilityV1()
  if (!Array.isArray(runners))
    throw new McpBoundaryError(
      'mcp.edit-host-port-unavailable',
      'edit evaluation availability did not return a retained lane projection'
    )
  await Promise.all([
    options.trustedIntake.preflight(),
    options.auditHead.preflight(),
    options.artifactResources.preflight(),
  ])
}

// the four policy hashes revision zero records alongside the host identity;
// they pin which inspection, diagnostic, & runtime policy admitted the source
function sourcePolicyHashesV1(identity: EditSessionRegistryIdentityV1): {
  sourceInspectionPolicySha256: string
  diagnosticPolicySha256: string
  runtimePolicySha256: string
}
{
  const pin = (aspect: string): string =>
    semanticHashV1('semantic-source', {
      kind: 'mcp-source-admission-policy',
      schemaVersion: 1,
      aspect,
      realmSha256: identity.realmSha256,
      profileSha256: identity.profileSha256,
      policyConfigVersion: identity.policyConfigVersion,
    })
  return {
    sourceInspectionPolicySha256: pin('source-inspection'),
    diagnosticPolicySha256: pin('diagnostic'),
    runtimePolicySha256: pin('runtime'),
  }
}

// live leases & byte-free admitted authority share this exact projection;
// only the live lease path can turn it into revision zero
function projectSessionSourceIdentityV1(
  source: {
    readonly projectSessionId: string
    readonly displayName: string
    readonly sha256: string
    readonly byteLength: number
    readonly provenance: EditSourceLeaseV1['provenance']
    readonly hostEvidenceSha256: string
  },
  identity: EditSessionRegistryIdentityV1
): EditBeginSourceIdentityV1
{
  const policy = sourcePolicyHashesV1(identity)
  return Object.freeze({
    expectedArtifactSha256: source.sha256,
    provenance: Object.freeze({
      kind: 'projectSession' as const,
      projectSessionId: source.projectSessionId,
      selectedDisplayName: source.displayName,
      canonicalRealpath: source.provenance.canonicalPath,
      device: source.provenance.device,
      inode: source.provenance.inode,
      byteLength: source.byteLength,
      modifiedAtNanoseconds: source.provenance.modifiedAtNanoseconds,
      ...policy,
      provenanceRegistrationSha256: semanticHashV1('semantic-source', {
        kind: 'mcp-source-provenance-registration',
        schemaVersion: 1,
        projectSessionId: source.projectSessionId,
        sourceArtifactSha256: source.sha256,
        sourceLeaseHostEvidenceSha256: source.hostEvidenceSha256,
        ...policy,
      }),
    }),
  })
}

export function leaseSourceProvenanceV1(
  lease: EditSourceLeaseV1,
  identity: EditSessionRegistryIdentityV1
): EditSourceProvenanceV1
{
  return projectSessionSourceIdentityV1(lease, identity).provenance
}

function admittedSourceIdentityV1(
  authority: EditSourceAdmittedIdentityV1,
  identity: EditSessionRegistryIdentityV1
): EditBeginSourceIdentityV1
{
  return projectSessionSourceIdentityV1(authority, identity)
}

// inspect-only publications get a stable source identity from their registered
// project-session record, without receiving a byte-bearing edit lease
function openingRefusalSourceIdentityV1(
  authority: EditSourceOpeningRefusalAuthorityV1,
  identity: EditSessionRegistryIdentityV1
): EditBeginSourceIdentityV1
{
  const policy = sourcePolicyHashesV1(identity)
  return Object.freeze({
    expectedArtifactSha256: authority.sha256,
    provenance: Object.freeze({
      kind: 'projectSession' as const,
      projectSessionId: authority.projectSessionId,
      selectedDisplayName: authority.displayName,
      canonicalRealpath: authority.provenance.canonicalPath,
      device: authority.provenance.device,
      inode: authority.provenance.inode,
      byteLength: authority.byteLength,
      modifiedAtNanoseconds: authority.provenance.modifiedAtNanoseconds,
      ...policy,
      provenanceRegistrationSha256: semanticHashV1('semantic-source', {
        kind: 'mcp-source-opening-refusal-provenance-registration',
        schemaVersion: 1,
        projectSessionId: authority.projectSessionId,
        sourceArtifactSha256: authority.sha256,
        recordedHostProvenanceSha256: authority.provenanceSha256,
        reason: authority.reason,
        ...policy,
      }),
    }),
  })
}

// the intake the kernel copies into revision zero: exact leased bytes, the
// rehashed identity, & a recheck that re-reads the host rather than a cache
export function leaseSourceIntakeV1(
  lease: EditSourceLeaseV1,
  identity: EditSessionRegistryIdentityV1
): EditSourceIntakeV1
{
  return {
    bytes: lease.bytes,
    displayName: lease.displayName,
    expectedArtifactSha256: lease.sha256,
    provenance: leaseSourceProvenanceV1(lease, identity),
    recheck: async () =>
    {
      const current = lease.recheck()
      return current.ok
        ? { ok: true, observedArtifactSha256: current.provenance.sha256 }
        : {
            ok: false,
            reason: current.reason,
            ...(current.provenance
              ? { observedArtifactSha256: current.provenance.sha256 }
              : {}),
          }
    },
  }
}

// * the transport registry. It owns no domain logic: it leases a source,
// * admits it, tracks which project session each edit session came from, &
// * hands every call to the kernel under an mcpStdio invocation
export class EditTransportRegistryV1
  implements EditHostLifecycleAuthorityV1, EditToolHostV1
{
  readonly cursors: EditPaginationCursorAuthorityV1
  readonly #projects: ProjectSessionRegistry
  readonly #identity: EditSessionRegistryIdentityV1
  readonly #principalSha256: string
  readonly #kernel: EditSessionRegistryLifecycleV1
  readonly #host: DirectEditToolHostV1
  readonly #trustedIntake: EditTrustedIntakePortV1
  readonly #origins = new Map<string, string>()
  readonly #predecessorSessions: readonly RetainedEditSessionEvidenceV1[]

  private constructor(
    options: EditTransportRegistryOptionsV1,
    predecessorSessions: readonly RetainedEditSessionEvidenceV1[]
  )
  {
    this.#projects = options.projects
    this.#identity = options.identity
    this.#principalSha256 = options.principalSha256
    this.#trustedIntake = options.trustedIntake
    this.#predecessorSessions = predecessorSessions
    this.cursors = new EditPaginationCursorAuthorityV1(options.cursorSecret)
    this.#kernel = createEditSessionRegistryV1({
      artifactStore: options.artifactStore,
      changeContracts: options.changeContracts,
      identity: options.identity,
      clock: options.clock ?? SYSTEM_EDIT_CLOCK,
      entropy: options.entropy ?? { randomBytes: (n) => randomBytes(n) },
      handleSecret: options.handleSecret,
      evaluationPorts: options.evaluationPorts,
      publicationPort: options.publicationPort,
      resourceCatalogue: options.resourceCatalogue,
    })
    this.#host = new DirectEditToolHostV1({
      lifecycle: this,
      intake: options.trustedIntake,
      cursors: this.cursors,
      realmSha256: options.identity.realmSha256,
      profileSha256: options.identity.profileSha256,
      principalSha256: options.principalSha256,
      transportStore: options.artifactStore,
      auditHead: options.auditHead,
      artifactResources: options.artifactResources,
    })
  }

  static async create(
    options: EditTransportRegistryOptionsV1
  ): Promise<EditTransportRegistryV1>
  {
    await assertEditTransportPortsReadyV1(options)
    if (options.retainedSessionInventory)
      return new EditTransportRegistryV1(
        options,
        options.retainedSessionInventory
      )
    let inventory: Awaited<ReturnType<typeof inventoryRetainedEditSessionsV1>>
    try
    {
      inventory = await inventoryRetainedEditSessionsV1({
        artifactStore: options.artifactStore,
      })
    }
    catch (error)
    {
      throw new McpBoundaryError(
        'mcp.edit-predecessor-invalid',
        `retained edit-session startup inventory refused: ${
          error instanceof Error ? error.message : String(error)
        }`
      )
    }
    return new EditTransportRegistryV1(options, inventory.sessions)
  }

  get principalSha256(): string
  {
    return this.#principalSha256
  }

  session(sessionId: string): EditSessionLifecycleV1
  {
    try
    {
      return this.#kernel.session(sessionId)
    }
    catch
    {
      throw new EditSessionErrorV1(
        'edit.session_not_found',
        'edit session is absent',
        false
      )
    }
  }

  async capabilities(
    request: EditCapabilitiesRequestV1
  ): Promise<EditRetainedCapabilityFactsV1>
  {
    if (request.context?.kind === 'edit')
      return this.session(request.context.sessionId).retainedCapabilityFactsV1()
    if (request.context?.kind === 'project')
    {
      const context = request.context
      return this.#projects.withEditSourceLeaseV1(
        context.projectSessionId,
        async (lease) =>
        {
          if (lease.sha256 !== context.expectedSourceArtifactSha256)
            throw new McpBoundaryError(
              'mcp.edit-source-changed',
              'leased source digest differs from capability discovery input'
            )
          return discoverEditCapabilityFactsV1(lease.bytes, this.#identity)
        }
      )
    }
    const template = await this.#trustedIntake.capabilityTemplateSource()
    return discoverEditCapabilityFactsV1(template.bytes, this.#identity)
  }

  callEditTool(
    name: EditToolName,
    request: unknown,
    invocation: HostInvocationContextV1
  ): Promise<unknown>
  {
    return this.#host.callEditTool(name, request, invocation)
  }

  // which project session admitted this edit session; Group I's drift checks
  // recheck that exact source, not whichever project session is newest
  originProjectSession(sessionId: string): string | null
  {
    return this.#origins.get(sessionId) ?? null
  }

  // bounded terminal evidence: exact retained heads only, w/ no locators,
  // paths, candidate bytes, or other response payloads
  evidenceSummaryV1(): EditTransportEvidenceSummaryV1
  {
    const retainedSessions = this.#kernel.sessions()
    const liveSessions = retainedSessions.map(
      (session): EditTransportSessionEvidenceV1 =>
      {
        const retained = session.retainedStatusFactsV1()
        return Object.freeze({
          sessionId: session.sessionId,
          state: session.state,
          head: session.head,
          eventHeadSha256: retained.eventHead.eventSha256,
          reportSha256: retained.latestReport.semanticProjectionSha256,
          recoverable: session.state === 'recovery-required',
        })
      }
    )
    const predecessorSessions = this.#predecessorSessions.map(
      (session): EditTransportSessionEvidenceV1 =>
        Object.freeze({
          sessionId: session.sessionId,
          state: session.state,
          head: session.head,
          eventHeadSha256: session.eventHeadSha256,
          reportSha256: session.reportSha256,
          recoverable: false,
        })
    )
    const sessions = [...predecessorSessions, ...liveSessions].sort(
      (left, right) => left.sessionId.localeCompare(right.sessionId)
    )
    if (
      new Set(sessions.map((session) => session.sessionId)).size !==
      sessions.length
    )
      throw new McpBoundaryError(
        'mcp.edit-predecessor-invalid',
        'retained and live edit sessions repeat one session identity'
      )
    const recoverableSessionCount = sessions.filter(
      (session) => session.recoverable
    ).length
    const terminalEvidence = [
      ...this.#predecessorSessions.map((session) => session.terminalEvidence),
      ...retainedSessions.map((session) => session.terminalEvidenceV1()),
    ]
    const unique = (values: readonly string[]): readonly string[] =>
      Object.freeze([...new Set(values)].sort())
    const projection = {
      kind: 'edit-transport-evidence-summary',
      schemaVersion: 1,
      sessions,
      revisionSha256s: unique(
        terminalEvidence.flatMap((evidence) => evidence.revisionSha256s)
      ),
      parentDeltaSha256s: unique(
        terminalEvidence.flatMap((evidence) => evidence.parentDeltaSha256s)
      ),
      cumulativeDeltaSha256s: unique(
        terminalEvidence.flatMap((evidence) => evidence.cumulativeDeltaSha256s)
      ),
      preservationSha256s: unique(
        terminalEvidence.flatMap((evidence) => evidence.preservationSha256s)
      ),
      lineageSha256s: unique(
        terminalEvidence.flatMap((evidence) => evidence.lineageSha256s)
      ),
      certificateSha256s: unique(
        terminalEvidence.flatMap((evidence) => evidence.certificateSha256s)
      ),
      reportProjectionSha256s: unique(
        terminalEvidence.flatMap((evidence) => evidence.reportProjectionSha256s)
      ),
      exportReceiptSha256s: unique(
        terminalEvidence.flatMap((evidence) => evidence.exportReceiptSha256s)
      ),
      recoverableSessionCount,
      hasRecoverableState: recoverableSessionCount > 0,
    }
    return Object.freeze({
      ...projection,
      summarySha256: semanticHashV1('semantic-report-projection', projection),
    })
  }

  // * the whole of Group H step 1 at the transport: the lease reserves the
  // * record, rehashes the private copy & original provenance, & only then
  // * copies exact bytes into revision zero. The lease releases either way
  async begin(
    request: EditBeginRequestV1,
    invocation: HostInvocationContextV1
  ): Promise<EditBeginDomainResultV1>
  {
    if (request.baseline.kind === 'template')
      return this.#kernel.begin(
        request,
        await this.#trustedIntake.templateSource(request),
        invocation
      )
    const baseline = request.baseline
    const refusalAuthority = this.#projects.editSourceOpeningRefusalAuthorityV1(
      baseline.projectSessionId
    )
    if (refusalAuthority !== null)
    {
      const identityMatches =
        baseline.expectedSourceArtifactSha256 === refusalAuthority.sha256
      return this.#kernel.refuseBeginOpeningV1(
        request,
        openingRefusalSourceIdentityV1(refusalAuthority, this.#identity),
        invocation,
        Object.freeze({
          code: identityMatches
            ? ('edit.source_not_editable' as const)
            : ('edit.source_identity_mismatch' as const),
          safeMessage: identityMatches
            ? 'published output sessions are inspect-only and cannot become edit sources'
            : 'begin source identity does not match the admitted project session',
          context: Object.freeze({}),
        })
      )
    }
    try
    {
      return await this.#projects.withEditSourceLeaseV1(
        baseline.projectSessionId,
        async (lease) =>
        {
          if (lease.sha256 !== baseline.expectedSourceArtifactSha256)
          {
            throw new McpBoundaryError(
              'mcp.edit-source-changed',
              'leased source digest differs from the digest begin expected'
            )
          }
          const result = await this.#kernel.begin(
            request,
            leaseSourceIntakeV1(lease, this.#identity),
            invocation
          )
          this.#origins.set(result.sessionId, lease.projectSessionId)
          return result
        }
      )
    }
    catch (error)
    {
      if (
        !(error instanceof McpBoundaryError) ||
        ![
          'mcp.edit-source-changed',
          'mcp.edit-source-missing',
          'mcp.edit-source-lease-invalid',
          'mcp.edit-source-not-editable',
        ].includes(error.code)
      )
        throw error
      const admitted = this.#projects.editSourceAdmittedIdentityV1(
        baseline.projectSessionId
      )
      const semanticRefusal =
        error.code === 'mcp.edit-source-not-editable' &&
        baseline.expectedSourceArtifactSha256 === admitted.sha256
      return this.#kernel.refuseBeginOpeningV1(
        request,
        admittedSourceIdentityV1(admitted, this.#identity),
        invocation,
        Object.freeze({
          code: semanticRefusal
            ? ('edit.source_not_editable' as const)
            : ('edit.source_identity_mismatch' as const),
          safeMessage: semanticRefusal
            ? 'selected project source was refused for semantic editing at open'
            : 'selected source no longer matches the identity this session admitted',
          context: Object.freeze({}),
        })
      )
    }
  }

  // read-only discovery uses admitted identity, so source drift cannot hide an
  // already-retained opening outcome or create revision zero
  async lookupBeginOutcome(
    request: EditBeginRequestV1,
    invocation: HostInvocationContextV1
  ): Promise<EditIdempotentOutcomeProjectionV1 | null>
  {
    const sourceIdentity = await this.#beginSourceIdentityV1(request)
    return this.#kernel.lookupBeginOutcomeV1(
      request,
      sourceIdentity,
      invocation
    )
  }

  async retainedBeginOutcome(
    request: EditBeginRequestV1,
    invocation: HostInvocationContextV1
  ): Promise<RetainedEditBeginOutcomeAuthorityV1 | null>
  {
    const sourceIdentity = await this.#beginSourceIdentityV1(request)
    return this.#kernel.retainedBeginOutcomeV1(
      request,
      sourceIdentity,
      invocation
    )
  }

  async retainedBeginTransportOutcomeTarget(input: {
    readonly request: EditBeginRequestV1
    readonly invocation: HostInvocationContextV1
  }): Promise<EditTransportOutcomeTargetV1>
  {
    const sourceIdentity = await this.#beginSourceIdentityV1(input.request)
    return this.#kernel.retainedBeginTransportOutcomeTargetV1({
      request: input.request,
      invocation: input.invocation,
      sourceIdentity,
    })
  }

  async #beginSourceIdentityV1(
    request: EditBeginRequestV1
  ): Promise<EditBeginSourceIdentityV1>
  {
    if (request.baseline.kind === 'template')
    {
      const source = await this.#trustedIntake.templateSource(request)
      return {
        provenance: source.provenance,
        expectedArtifactSha256: source.expectedArtifactSha256,
      }
    }
    const refusalAuthority = this.#projects.editSourceOpeningRefusalAuthorityV1(
      request.baseline.projectSessionId
    )
    if (refusalAuthority !== null)
      return openingRefusalSourceIdentityV1(refusalAuthority, this.#identity)
    const admitted = this.#projects.editSourceAdmittedIdentityV1(
      request.baseline.projectSessionId
    )
    return admittedSourceIdentityV1(admitted, this.#identity)
  }
}

export function createEditTransportRegistryV1(
  options: EditTransportRegistryOptionsV1
): Promise<EditTransportRegistryV1>
{
  return EditTransportRegistryV1.create(options)
}
