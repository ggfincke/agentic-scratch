// packages/mcp/src/edit/edit-bootstrap.ts
// assemble the strict production project-edit host from protected authority

import { LOWERCASE_SHA256_PATTERN } from '../internal/sha256-pattern.js'
import { hasExactObjectKeysV1 } from '../internal/exact-object-keys.js'

import { createHash, randomBytes } from 'node:crypto'
import {
  closeSync,
  constants,
  existsSync,
  fsyncSync,
  fstatSync,
  linkSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  realpathSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'

import {
  DEFAULT_PHASE_8_RESOURCE_POLICY,
  GREENFIELD_TEMPLATE_ID_V1,
  GREENFIELD_TEMPLATE_VERSION_V1,
  PINNED_GREENFIELD_TEMPLATE_ARTIFACT_SHA256_V1,
  ProductionEditDeterministicEvaluationPortV1,
  greenfieldTemplateSourceIntakeV1,
  inventoryRetainedEditSessionsV1,
  recoverRetainedEditSessionsV1,
  semanticHashV1,
  type EditAssetAdmitDomainSourceV1,
  type EditAssetAdmitRequestV1,
  type EditEvaluationPortsV1,
  type EditBeginRequestV1,
  type EditSessionRegistryIdentityV1,
  type EditSourceIntakeV1,
  type EditToolReceiptFreeResultV1,
  type HostInvocationContextV1,
  type RecoveredRetainedEditAttemptV1,
  type RetainedEditSessionEvidenceV1,
  type ServerAuditBoundaryV1,
  type ServerAuditRecordHashProjectionV1,
} from '@scratch-agent/edit'
import {
  createEditArtifactStoreHostAdapter,
  isPathWithinRootV1,
  type EditArtifactStoreHostAdapter,
  type EditProductionPolicyDecoderV1,
} from '@scratch-agent/eval'
import { scanStrictJson } from '@scratch-agent/sb3'
import { canonicalJsonBytesV1 } from '@scratch-agent/sb3/canonical-json'

import {
  createDurableEditArtifactCatalogueWriterV1,
  DurableEditArtifactCatalogueV1,
} from './edit-catalogue.js'
import { loadEditContractRegistryV1 } from './edit-contract-registry.js'
import {
  assertProductionEditRuntimeStartupReadyV1,
  createProductionEditEvaluationPortsV1,
  probeProductionEditRuntimeReadinessV1,
  productionEditRuntimeReadinessPortV1,
  STRICT_EDIT_MCP_EVALUATION_POLICY_DECODER_V1,
} from './edit-evaluation-host.js'
import type {
  EditHostArtifactResourcesPortV1,
  EditHostAuditHeadPortV1,
  EditTrustedIntakePortV1,
} from './edit-host.js'
import {
  EDIT_STATEFUL_RESPONSE_PROJECTOR_VERSION_V1,
  retainExactTransportResultV1,
} from './edit-host.js'
import { EditArtifactResourceStoreV1 } from './edit-resources.js'
import { parseEditMcpSecretMaterialV1 } from './edit-secrets.js'
import {
  createEditTransportRegistryV1,
  EditPaginationCursorAuthorityV1,
  mcpStdioInvocationV1,
  type EditTransportEvidenceSummaryV1,
} from './edit-sessions.js'
import {
  assertEditToolReceiptFreeResponseV1,
  editReceiptFreeAuditContextV1,
  editTransportIdempotencyBindingV1,
  isEditToolName,
  productionEditProfileAuthoritySha256V1,
} from './edit-tools.js'
import { McpBoundaryError } from '../transport/errors.js'
import {
  configureEditMcpProtectedRootsV1,
  createEditAssetInputPort,
  createProtectedMcpReadPortV1,
  editAssetInputRootFromAuthorityV1,
  recheckProtectedMcpRootV1,
  type EditMcpProtectedRootsV1,
  type RepairMcpPathConfig,
} from '../transport/paths.js'
import {
  configureEditPublicationDirectory,
  createEditPublicationPort,
  createEditPublicationRecoveryPortV1,
} from '../transport/publication.js'
import { ProjectSessionRegistry } from '../project/project-sessions.js'
import {
  createScratchMcpServer,
  serverCloseAuditOutcomeV1,
  type RepairMcpServer,
} from '../transport/server.js'
import {
  AUDIT_STORE_DIRECTORY_PREFIX,
  AUDIT_SUPERVISOR_DIRECTORY,
  createAuditPredecessorHandoffManifestV1,
  DurableAuditStoreSupervisorV1,
  editReceiptFreeOutcomeSha256V1,
  editTransportRequestSha256V1,
  HARD_AUDIT_BYTE_CAP,
  HARD_AUDIT_RECORD_CAP,
  parseAuditPredecessorHandoffManifestV1,
  type AuditPredecessorHandoffManifestV1,
  type AuditRecoveryClassificationV1,
  type AuditStoreIdentitySeedV1,
  type AuditSupervisorCurrentV1,
  type AuditTerminalEvidenceV1,
  type AuditTerminalSideEffectPlanV1,
  type DurableToolAuditJournalV1,
} from '../transport/tool-audit.js'

const OPAQUE_ID = /^[A-Za-z0-9_-]{16,128}$/u
const LOCAL_KEY = /^[A-Za-z][A-Za-z0-9_-]{0,127}$/u
const PRIVATE_RELATIVE_PATH = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,511}$/u
const MAXIMUM_BOOTSTRAP_BYTES = 2 * 1024 * 1024
const MAXIMUM_ACCEPTED_EVIDENCE_BYTES = 32 * 1024 * 1024
const ACCEPTED_EVIDENCE_PREFIX = 'evidence/'
const MINIMUM_REGISTRATION_POLICIES = 3
const MAXIMUM_REGISTRATION_POLICIES = 16
const EDIT_ARTIFACT_STORE_DIRECTORY = 'edit-artifacts'
const EDIT_ARTIFACT_STORE_MAX_BYTES =
  DEFAULT_PHASE_8_RESOURCE_POLICY.editProjectArtifactBytesPerServer
const EDIT_ARTIFACT_STORE_MAX_ENTRY_BYTES =
  DEFAULT_PHASE_8_RESOURCE_POLICY.editArtifactBytesPerSession
const EDIT_ARTIFACT_STORE_MAX_ENTRIES = 100_000

interface BootstrapContractV1
{
  readonly registrationId: string
  readonly semanticContractSha256: string
  readonly evaluationPlanId: string
}

interface BootstrapMediaContractV1 extends BootstrapContractV1
{
  readonly templateId: string
  readonly templateVersion: string
  readonly templateArtifactSha256: string
}

interface BootstrapAuditLimitsV1
{
  readonly recordCap: number
  readonly byteCap: number
}

type ProductionEditRegistryIdentityV1 = EditSessionRegistryIdentityV1 & {
  readonly transportProjectionAuthoritySha256: string
  readonly paginationCursorAuthoritySha256: string
}

interface BootstrapOperatorFixtureV1
{
  readonly kind: 'semantic-edit-benchmark-v1'
  readonly auditLimits?: BootstrapAuditLimitsV1
  readonly evaluationDisposition?:
    'required-lane-unavailable' | 'required-lane-inconclusive'
}

export interface ProductionEditHostBootstrapDescriptorV1
{
  readonly schemaVersion: 1
  readonly kind: 'production-stdio-edit-host-v1'
  readonly principalSha256: string
  readonly pinnedScratchRuntimeSourceSha256: string
  readonly authoritativeBuildManifestSha256: string
  readonly behaviorContract: BootstrapContractV1
  readonly mediaContract: BootstrapMediaContractV1
  readonly contractRegistryRelativePath: string
  readonly secretMaterialRelativePath: string
  readonly evidenceSummaryRelativePath: string
  readonly predecessorManifestRelativePath: string | null
  readonly operatorFixture?: BootstrapOperatorFixtureV1
}

interface ProtectedBootstrapReadV1
{
  readonly bytes: Uint8Array
  readonly sha256: string
  readonly canonicalDirectory: string
}

interface AcceptedEvidenceCallV1
{
  readonly sequence: number
  readonly boundary: 'tool' | 'resource-list' | 'resource-read' | 'protocol'
  readonly name: string
  readonly callId: string
  readonly requestSha256: string
  readonly outcomeSha256: string
  readonly beginRecordSha256: string
  readonly completeRecordSha256: string
  readonly eventSha256: string | null
}

interface AcceptedEvidenceDestinationV1
{
  readonly root: string
  readonly relativePath: string
  readonly absolutePath: string
}

function refuse(message: string): never
{
  throw new McpBoundaryError('mcp.edit-host-config-invalid', message)
}

function sha256(value: Uint8Array): string
{
  return createHash('sha256').update(value).digest('hex')
}

function canonicalSha256(value: unknown): string
{
  return sha256(canonicalJsonBytesV1(value))
}

function exactObject(
  value: unknown,
  expectedKeys: readonly string[],
  label: string
): Record<string, unknown>
{
  if (value === null || typeof value !== 'object' || Array.isArray(value))
    return refuse(`${label} must be one closed object`)
  const record = value as Record<string, unknown>
  if (!hasExactObjectKeysV1(record, expectedKeys))
    return refuse(`${label} has missing or unknown fields`)
  return record
}

function normalizedRelativePath(value: unknown, label: string): string
{
  if (
    typeof value !== 'string' ||
    !PRIVATE_RELATIVE_PATH.test(value) ||
    value.startsWith('/') ||
    value.endsWith('/') ||
    value
      .split('/')
      .some(
        (segment) => segment.length === 0 || segment === '.' || segment === '..'
      )
  )
    return refuse(`${label} must be one normalized relative path`)
  return value
}

function contractDescriptor(
  value: unknown,
  label: string,
  expectedKeys: readonly string[] = [
    'evaluationPlanId',
    'registrationId',
    'semanticContractSha256',
  ]
): BootstrapContractV1
{
  const record = exactObject(value, expectedKeys, label)
  if (
    typeof record.registrationId !== 'string' ||
    !OPAQUE_ID.test(record.registrationId) ||
    typeof record.semanticContractSha256 !== 'string' ||
    !LOWERCASE_SHA256_PATTERN.test(record.semanticContractSha256) ||
    typeof record.evaluationPlanId !== 'string' ||
    !LOCAL_KEY.test(record.evaluationPlanId)
  )
    return refuse(`${label} identity is invalid`)
  return Object.freeze({
    registrationId: record.registrationId,
    semanticContractSha256: record.semanticContractSha256,
    evaluationPlanId: record.evaluationPlanId,
  })
}

function operatorFixture(value: unknown): BootstrapOperatorFixtureV1
{
  const input = exactObject(
    value,
    [
      'kind',
      ...(typeof value === 'object' && value !== null && 'auditLimits' in value
        ? ['auditLimits']
        : []),
      ...(typeof value === 'object' &&
      value !== null &&
      'evaluationDisposition' in value
        ? ['evaluationDisposition']
        : []),
    ],
    'operator fixture'
  )
  if (Object.keys(input).length < 2)
    return refuse('operator fixture cannot be empty')
  if (input.kind !== 'semantic-edit-benchmark-v1')
    return refuse('operator fixture kind is invalid')
  let auditLimits: BootstrapAuditLimitsV1 | undefined
  if (input.auditLimits !== undefined)
  {
    const limits = exactObject(
      input.auditLimits,
      ['byteCap', 'recordCap'],
      'operator fixture audit limits'
    )
    const recordCap = Number(limits.recordCap)
    const byteCap = Number(limits.byteCap)
    const reserveRecords = Math.max(Math.ceil(recordCap / 10), 128)
    if (
      !Number.isSafeInteger(recordCap) ||
      recordCap < reserveRecords + 4 ||
      recordCap > HARD_AUDIT_RECORD_CAP ||
      !Number.isSafeInteger(byteCap) ||
      byteCap < (reserveRecords + 4) * 8 * 1024 ||
      byteCap > HARD_AUDIT_BYTE_CAP
    )
      return refuse('operator fixture audit limits are outside authority')
    auditLimits = Object.freeze({ recordCap, byteCap })
  }
  const disposition = input.evaluationDisposition
  if (
    disposition !== undefined &&
    disposition !== 'required-lane-unavailable' &&
    disposition !== 'required-lane-inconclusive'
  )
    return refuse('operator fixture evaluation disposition is invalid')
  return Object.freeze({
    kind: 'semantic-edit-benchmark-v1',
    ...(auditLimits ? { auditLimits } : {}),
    ...(disposition ? { evaluationDisposition: disposition } : {}),
  })
}

function parseBootstrapDescriptor(
  bytes: Uint8Array
): ProductionEditHostBootstrapDescriptorV1
{
  let value: unknown
  try
  {
    value = scanStrictJson(bytes, {
      maxDepth: 8,
      maxMembersPerContainer: 64,
      maxNodes: 1024,
    }).value
  }
  catch
  {
    return refuse('edit host bootstrap is not strict bounded JSON')
  }
  const candidate =
    value !== null && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null
  const hasFixture = candidate?.operatorFixture !== undefined
  const input = exactObject(
    value,
    [
      'authoritativeBuildManifestSha256',
      'behaviorContract',
      'contractRegistryRelativePath',
      'evidenceSummaryRelativePath',
      'kind',
      'mediaContract',
      ...(hasFixture ? ['operatorFixture'] : []),
      'pinnedScratchRuntimeSourceSha256',
      'predecessorManifestRelativePath',
      'principalSha256',
      'schemaVersion',
      'secretMaterialRelativePath',
    ],
    'edit host bootstrap'
  )
  const behavior = contractDescriptor(
    input.behaviorContract,
    'behavior contract'
  )
  const mediaFields = [
    'evaluationPlanId',
    'registrationId',
    'semanticContractSha256',
    'templateArtifactSha256',
    'templateId',
    'templateVersion',
  ]
  const mediaBase = contractDescriptor(
    input.mediaContract,
    'media contract',
    mediaFields
  )
  const mediaInput = input.mediaContract as Record<string, unknown>
  if (
    input.schemaVersion !== 1 ||
    input.kind !== 'production-stdio-edit-host-v1' ||
    typeof input.principalSha256 !== 'string' ||
    !LOWERCASE_SHA256_PATTERN.test(input.principalSha256) ||
    typeof input.pinnedScratchRuntimeSourceSha256 !== 'string' ||
    !LOWERCASE_SHA256_PATTERN.test(input.pinnedScratchRuntimeSourceSha256) ||
    typeof input.authoritativeBuildManifestSha256 !== 'string' ||
    !LOWERCASE_SHA256_PATTERN.test(input.authoritativeBuildManifestSha256) ||
    typeof mediaInput.templateId !== 'string' ||
    !LOCAL_KEY.test(mediaInput.templateId) ||
    typeof mediaInput.templateVersion !== 'string' ||
    mediaInput.templateVersion.length < 1 ||
    mediaInput.templateVersion.length > 64 ||
    typeof mediaInput.templateArtifactSha256 !== 'string' ||
    !LOWERCASE_SHA256_PATTERN.test(mediaInput.templateArtifactSha256) ||
    (input.predecessorManifestRelativePath !== null &&
      typeof input.predecessorManifestRelativePath !== 'string')
  )
    return refuse('edit host bootstrap identity is invalid')
  const privatePaths = {
    contractRegistryRelativePath: normalizedRelativePath(
      input.contractRegistryRelativePath,
      'contract registry path'
    ),
    secretMaterialRelativePath: normalizedRelativePath(
      input.secretMaterialRelativePath,
      'secret material path'
    ),
    predecessorManifestRelativePath:
      input.predecessorManifestRelativePath === null
        ? null
        : normalizedRelativePath(
            input.predecessorManifestRelativePath,
            'predecessor manifest path'
          ),
  }
  const privatePathValues = Object.values(privatePaths).filter(
    (path): path is string => path !== null
  )
  if (new Set(privatePathValues).size !== privatePathValues.length)
    return refuse('bootstrap private artifact paths must be distinct')
  const evidenceSummaryRelativePath = normalizedRelativePath(
    input.evidenceSummaryRelativePath,
    'readable evidence summary path'
  )
  if (
    !evidenceSummaryRelativePath.startsWith(ACCEPTED_EVIDENCE_PREFIX) ||
    !evidenceSummaryRelativePath.endsWith('.json')
  )
    return refuse(
      `readable evidence summary path must be JSON under ${ACCEPTED_EVIDENCE_PREFIX}`
    )
  return Object.freeze({
    schemaVersion: 1,
    kind: 'production-stdio-edit-host-v1',
    principalSha256: input.principalSha256,
    pinnedScratchRuntimeSourceSha256: input.pinnedScratchRuntimeSourceSha256,
    authoritativeBuildManifestSha256: input.authoritativeBuildManifestSha256,
    behaviorContract: behavior,
    mediaContract: Object.freeze({
      ...mediaBase,
      templateId: mediaInput.templateId,
      templateVersion: mediaInput.templateVersion,
      templateArtifactSha256: mediaInput.templateArtifactSha256,
    }),
    ...privatePaths,
    evidenceSummaryRelativePath,
    ...(hasFixture
      ? { operatorFixture: operatorFixture(input.operatorFixture) }
      : {}),
  })
}

function readBootstrapFile(path: string): ProtectedBootstrapReadV1
{
  if (!isAbsolute(path))
    return refuse('edit host bootstrap path must be absolute')
  let descriptor: number | null = null
  try
  {
    descriptor = openSync(
      path,
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK
    )
    const before = fstatSync(descriptor, { bigint: true })
    if (!before.isFile() || before.size > BigInt(MAXIMUM_BOOTSTRAP_BYTES))
      return refuse('edit host bootstrap must be one bounded regular file')
    const canonicalPath = realpathSync(path)
    const bytes = Uint8Array.from(readFileSync(descriptor))
    const after = fstatSync(descriptor, { bigint: true })
    if (
      bytes.byteLength > MAXIMUM_BOOTSTRAP_BYTES ||
      before.dev !== after.dev ||
      before.ino !== after.ino ||
      before.size !== after.size ||
      before.mtimeNs !== after.mtimeNs ||
      realpathSync(path) !== canonicalPath
    )
      return refuse('edit host bootstrap changed while it was read')
    return Object.freeze({
      bytes,
      sha256: sha256(bytes),
      canonicalDirectory: realpathSync(dirname(canonicalPath)),
    })
  }
  catch (error)
  {
    if (error instanceof McpBoundaryError) throw error
    return refuse('edit host bootstrap could not be read safely')
  }
  finally
  {
    if (descriptor !== null) closeSync(descriptor)
  }
}

function requiredEnvironment(
  environment: NodeJS.ProcessEnv,
  name: string
): string
{
  const value = environment[name]
  if (typeof value !== 'string' || value.length === 0 || value.includes('\0'))
    return refuse(`${name} is required for project-edit startup`)
  return value
}

function requiredSha256Environment(
  environment: NodeJS.ProcessEnv,
  name: string
): string
{
  const value = requiredEnvironment(environment, name)
  if (!LOWERCASE_SHA256_PATTERN.test(value))
    return refuse(`${name} must be one exact SHA-256 identity`)
  return value
}

function requiredPredecessorSha256Environment(
  environment: NodeJS.ProcessEnv
): string | null
{
  const value = requiredEnvironment(
    environment,
    'SCRATCH_AGENT_EDIT_EXPECTED_PREDECESSOR_HANDOFF_SHA256'
  )
  if (value === 'absent') return null
  if (!LOWERCASE_SHA256_PATTERN.test(value))
    return refuse(
      'SCRATCH_AGENT_EDIT_EXPECTED_PREDECESSOR_HANDOFF_SHA256 must be absent or SHA-256'
    )
  return value
}

function assertRegistrations(
  descriptor: ProductionEditHostBootstrapDescriptorV1,
  loaded: Awaited<ReturnType<typeof loadEditContractRegistryV1>>
): void
{
  if (
    loaded.registrations.length !== 2 ||
    descriptor.behaviorContract.registrationId ===
      descriptor.mediaContract.registrationId
  )
    return refuse('edit contract registry must contain exactly two identities')
  const expected = new Map(
    [descriptor.behaviorContract, descriptor.mediaContract].map((contract) => [
      contract.registrationId,
      contract.semanticContractSha256,
    ])
  )
  for (const registration of loaded.registrations)
  {
    if (
      expected.get(registration.registrationId) !==
        registration.semanticContractSha256 ||
      registration.retainedPolicyCount < MINIMUM_REGISTRATION_POLICIES ||
      registration.retainedPolicyCount > MAXIMUM_REGISTRATION_POLICIES
    )
      return refuse('edit contract registry identities or policies differ')
    expected.delete(registration.registrationId)
  }
  if (expected.size !== 0)
    return refuse('edit contract registry omits a bootstrap identity')
  for (const contract of [
    descriptor.behaviorContract,
    descriptor.mediaContract,
  ])
  {
    const registered = loaded.registry.get(contract.registrationId)
    if (
      !registered.registration.semanticContract.evaluationPlans.some(
        (plan) => plan.planId === contract.evaluationPlanId
      )
    )
      return refuse(
        `contract ${contract.registrationId} omits its evaluation plan`
      )
  }
}

function registryIdentity(
  descriptor: ProductionEditHostBootstrapDescriptorV1,
  roots: EditMcpProtectedRootsV1,
  manifestSha256: string,
  nonAuditSecretAuthoritySha256: string,
  paginationCursorAuthoritySha256: string
): ProductionEditRegistryIdentityV1
{
  const profileSha256 = productionEditProfileAuthoritySha256V1(
    EDIT_STATEFUL_RESPONSE_PROJECTOR_VERSION_V1
  )
  const retentionPolicySha256 = canonicalSha256(DEFAULT_PHASE_8_RESOURCE_POLICY)
  const descriptorAuthoritySha256 =
    productionEditDescriptorAuthoritySha256V1(descriptor)
  return Object.freeze({
    realmSha256: productionEditRealmSha256V1({
      principalSha256: descriptor.principalSha256,
      manifestSha256,
      authoritativeBuildManifestSha256:
        descriptor.authoritativeBuildManifestSha256,
      pinnedScratchRuntimeSourceSha256:
        descriptor.pinnedScratchRuntimeSourceSha256,
      profileSha256,
      retentionPolicySha256,
      policyConfigVersion: 1,
      descriptorAuthoritySha256,
      nonAuditSecretAuthoritySha256,
      rootOwnershipSha256s: Object.fromEntries(
        Object.entries(roots).map(([role, authority]) => [
          role,
          authority.ownershipSha256,
        ])
      ),
    }),
    profileSha256,
    pinnedScratchRuntimeSourceSha256:
      descriptor.pinnedScratchRuntimeSourceSha256,
    retentionPolicySha256,
    policyConfigVersion: 1,
    transportProjectionAuthoritySha256: profileSha256,
    paginationCursorAuthoritySha256,
  })
}

export function productionEditDescriptorAuthoritySha256V1(
  descriptor: ProductionEditHostBootstrapDescriptorV1
): string
{
  return canonicalSha256({
    schemaVersion: descriptor.schemaVersion,
    kind: descriptor.kind,
    principalSha256: descriptor.principalSha256,
    pinnedScratchRuntimeSourceSha256:
      descriptor.pinnedScratchRuntimeSourceSha256,
    authoritativeBuildManifestSha256:
      descriptor.authoritativeBuildManifestSha256,
    behaviorContract: descriptor.behaviorContract,
    mediaContract: descriptor.mediaContract,
    operatorFixture: descriptor.operatorFixture ?? null,
  })
}

export function productionEditRealmSha256V1(input: {
  readonly principalSha256: string
  readonly manifestSha256: string
  readonly authoritativeBuildManifestSha256: string
  readonly pinnedScratchRuntimeSourceSha256: string
  readonly profileSha256: string
  readonly retentionPolicySha256: string
  readonly policyConfigVersion: 1
  readonly descriptorAuthoritySha256: string
  readonly nonAuditSecretAuthoritySha256: string
  readonly rootOwnershipSha256s: Readonly<Record<string, string>>
}): string
{
  return canonicalSha256({
    schemaVersion: 1,
    kind: 'production-edit-realm-v1',
    ...input,
  })
}

export function productionEditNonAuditSecretAuthoritySha256V1(
  input: Pick<
    ReturnType<typeof parseEditMcpSecretMaterialV1>,
    | 'handleSecret'
    | 'paginationCursorSecret'
    | 'resourceCapabilitySecret'
    | 'resourceListingCursorSecret'
  >
): string
{
  return canonicalSha256({
    schemaVersion: 1,
    kind: 'production-edit-non-audit-secret-authority-v1',
    purposes: [
      {
        purpose: 'handle',
        sha256: productionEditSecretAuthoritySha256V1(
          'handle',
          input.handleSecret
        ),
      },
      {
        purpose: 'paginationCursor',
        sha256: productionEditPaginationCursorAuthoritySha256V1(
          input.paginationCursorSecret
        ),
      },
      {
        purpose: 'resourceCapability',
        sha256: productionEditSecretAuthoritySha256V1(
          'resourceCapability',
          input.resourceCapabilitySecret
        ),
      },
      {
        purpose: 'resourceListingCursor',
        sha256: productionEditSecretAuthoritySha256V1(
          'resourceListingCursor',
          input.resourceListingCursorSecret
        ),
      },
    ],
  })
}

function productionEditSecretAuthoritySha256V1(
  purpose: string,
  secret: Uint8Array
): string
{
  return sha256(
    Buffer.concat([
      Buffer.from('scratch-agent/non-audit-secret-authority/v1', 'utf8'),
      Buffer.from([0]),
      Buffer.from(purpose, 'utf8'),
      Buffer.from([0]),
      Buffer.from(secret),
    ])
  )
}

export function productionEditPaginationCursorAuthoritySha256V1(
  secret: Uint8Array
): string
{
  return productionEditSecretAuthoritySha256V1('paginationCursor', secret)
}

function sourcePolicyHashes(identity: EditSessionRegistryIdentityV1): Readonly<{
  sourceInspectionPolicySha256: string
  diagnosticPolicySha256: string
  runtimePolicySha256: string
}>
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
  return Object.freeze({
    sourceInspectionPolicySha256: pin('source-inspection'),
    diagnosticPolicySha256: pin('diagnostic'),
    runtimePolicySha256: pin('runtime'),
  })
}

function createTrustedIntake(
  descriptor: ProductionEditHostBootstrapDescriptorV1,
  identity: EditSessionRegistryIdentityV1,
  registryProfileSha256: string,
  assetPort: ReturnType<typeof createEditAssetInputPort>
): EditTrustedIntakePortV1
{
  if (
    descriptor.mediaContract.templateId !== GREENFIELD_TEMPLATE_ID_V1 ||
    descriptor.mediaContract.templateVersion !==
      String(GREENFIELD_TEMPLATE_VERSION_V1) ||
    descriptor.mediaContract.templateArtifactSha256 !==
      PINNED_GREENFIELD_TEMPLATE_ARTIFACT_SHA256_V1
  )
    return refuse('bootstrap template is not the pinned greenfield template')
  const template = (): Promise<EditSourceIntakeV1> =>
    greenfieldTemplateSourceIntakeV1({
      registryEntryId: descriptor.mediaContract.registrationId,
      registryProfileSha256,
      ...sourcePolicyHashes(identity),
    })
  return Object.freeze({
    preflight: async () =>
    {
      const capability = await assetPort.capability()
      if (
        !capability.readable ||
        !capability.rejectsSymlinkComponents ||
        !capability.enforcesRealPathContainment ||
        !capability.rechecksIdentityAfterRead ||
        capability.maximumAssetByteLength < 1
      )
        return refuse('edit asset input capability is unavailable')
      const source = await template()
      if (
        source.expectedArtifactSha256 !==
        descriptor.mediaContract.templateArtifactSha256
      )
        return refuse('pinned greenfield template identity changed')
    },
    capabilityTemplateSource: template,
    templateSource: async (request: EditBeginRequestV1) =>
    {
      if (
        request.baseline.kind !== 'template' ||
        request.baseline.templateId !== descriptor.mediaContract.templateId ||
        request.baseline.expectedVersion !==
          descriptor.mediaContract.templateVersion ||
        request.baseline.expectedArtifactSha256 !==
          descriptor.mediaContract.templateArtifactSha256
      )
        return refuse('template begin differs from bootstrap authority')
      return template()
    },
    inputFileAssetSource: async (
      request: EditAssetAdmitRequestV1 & {
        readonly source: Extract<
          EditAssetAdmitRequestV1['source'],
          { readonly kind: 'inputFile' }
        >
      }
    ): Promise<
      Extract<EditAssetAdmitDomainSourceV1, { readonly kind: 'inputFile' }>
    > =>
      Object.freeze({
        kind: 'inputFile',
        mediaKind: request.source.mediaKind,
        read: await assetPort.readAsset(
          request.source.absolutePath,
          request.source.expectedByteLength
        ),
        expectedByteLength: request.source.expectedByteLength,
        expectedPayloadSha256: request.source.expectedPayloadSha256,
      }),
  })
}

async function reopenEditArtifactStore(
  storeRoot: string
): Promise<EditArtifactStoreHostAdapter>
{
  const quota = editArtifactStoreQuotaV1()
  if (!existsSync(storeRoot))
    return createEditArtifactStoreHostAdapter(storeRoot, quota)
  const probe = createEditArtifactStoreHostAdapter(storeRoot, {
    mode: 'read-only',
    ...quota,
  })
  const capability = await probe.capability()
  return createEditArtifactStoreHostAdapter(storeRoot, {
    mode: 'recovery',
    expectedStoreId: capability.storeId,
    expectedOwnershipSha256: capability.ownershipSha256,
    ...quota,
  })
}

function editArtifactStoreQuotaV1()
{
  return {
    maxBytes: EDIT_ARTIFACT_STORE_MAX_BYTES,
    maxEntryBytes: EDIT_ARTIFACT_STORE_MAX_ENTRY_BYTES,
    maxEntries: EDIT_ARTIFACT_STORE_MAX_ENTRIES,
  }
}

function fixtureEvaluationPorts(
  disposition: NonNullable<BootstrapOperatorFixtureV1['evaluationDisposition']>,
  readiness: ReturnType<typeof productionEditRuntimeReadinessPortV1>,
  availabilityEpoch: number
): EditEvaluationPortsV1
{
  const unavailable = disposition === 'required-lane-unavailable'
  const decoder: EditProductionPolicyDecoderV1 = Object.freeze({
    decodeRuntimePolicy: (
      artifact: Parameters<
        EditProductionPolicyDecoderV1['decodeRuntimePolicy']
      >[0],
      artifacts: Parameters<
        EditProductionPolicyDecoderV1['decodeRuntimePolicy']
      >[1]
    ) =>
    {
      if (unavailable)
        throw new Error(
          'benchmark operator fixture withheld required runtime policy authority'
        )
      const decoded =
        STRICT_EDIT_MCP_EVALUATION_POLICY_DECODER_V1.decodeRuntimePolicy(
          artifact,
          artifacts
        )
      return Object.freeze({
        ...decoded,
        cells: Object.freeze(
          decoded.cells.map((cell) =>
            Object.freeze({
              ...cell,
              observationCaps: Object.freeze(
                Object.fromEntries(
                  Object.keys(cell.observationCaps).map((key) => [key, 1])
                )
              ) as unknown as typeof cell.observationCaps,
            })
          )
        ),
      })
    },
    decodeLensPolicy: (
      artifact: Parameters<
        EditProductionPolicyDecoderV1['decodeLensPolicy']
      >[0],
      lens: Parameters<EditProductionPolicyDecoderV1['decodeLensPolicy']>[1],
      artifacts: Parameters<
        EditProductionPolicyDecoderV1['decodeLensPolicy']
      >[2]
    ) =>
    {
      if (unavailable)
        throw new Error(
          'benchmark operator fixture withheld required lens policy authority'
        )
      return STRICT_EDIT_MCP_EVALUATION_POLICY_DECODER_V1.decodeLensPolicy(
        artifact,
        lens,
        artifacts
      )
    },
  })
  return Object.freeze({
    deterministic: new ProductionEditDeterministicEvaluationPortV1({
      decoder,
      availabilityEpoch,
      runnerAvailabilityProbe: {
        runnerAvailabilityV1: () => readiness.runtimeReadinessV1().runners,
      },
    }),
  })
}

async function createEvaluationPorts(
  descriptor: ProductionEditHostBootstrapDescriptorV1
): Promise<EditEvaluationPortsV1>
{
  const probed = await probeProductionEditRuntimeReadinessV1()
  assertProductionEditRuntimeStartupReadyV1(probed.snapshot)
  const readiness = productionEditRuntimeReadinessPortV1(probed)
  const disposition = descriptor.operatorFixture?.evaluationDisposition
  return disposition === undefined
    ? createProductionEditEvaluationPortsV1({ runtimeReadiness: readiness })
    : fixtureEvaluationPorts(
        disposition,
        readiness,
        probed.snapshot.availabilityEpoch
      )
}

function parsePredecessorManifest(
  bytes: Uint8Array
): AuditPredecessorHandoffManifestV1
{
  try
  {
    scanStrictJson(bytes, {
      maxDepth: 32,
      maxMembersPerContainer: 256,
      maxNodes: 2_048,
    })
    return parseAuditPredecessorHandoffManifestV1(bytes)
  }
  catch
  {
    return refuse(
      'predecessor audit handoff is not strict, exact, canonical, and bounded'
    )
  }
}

function assertAuditRealm(
  current: AuditSupervisorCurrentV1,
  seed: AuditStoreIdentitySeedV1
): void
{
  if (
    current.state !== 'absent' &&
    (current.identity.realmSha256 !== seed.realmSha256 ||
      current.identity.profileSha256 !== seed.profileSha256 ||
      current.identity.boundaryPolicySha256 !== seed.boundaryPolicySha256)
  )
    return refuse('existing audit supervisor belongs to another host realm')
}

function assertExpectedPredecessor(
  expected: AuditPredecessorHandoffManifestV1 | null,
  current: AuditSupervisorCurrentV1
): void
{
  if (expected === null)
  {
    if (current.state !== 'absent')
      return refuse(
        'every noninitial ordinary startup requires an exact predecessor handoff'
      )
    return
  }
  if (
    current.state === 'absent' ||
    current.storeKey !== expected.serverManifest.storeKey ||
    !Buffer.from(canonicalJsonBytesV1(current.identity)).equals(
      Buffer.from(canonicalJsonBytesV1(expected.serverManifest.identity))
    ) ||
    current.state !== 'terminal' ||
    !Buffer.from(canonicalJsonBytesV1(current.terminal)).equals(
      Buffer.from(canonicalJsonBytesV1(expected.terminal))
    )
  )
    return refuse(
      'predecessor manifest does not name the supervisor current store'
    )
}

function auditBoundaryPolicySha256V1(
  identity: ProductionEditRegistryIdentityV1
): string
{
  return productionEditAuditBoundaryPolicySha256V1({
    profileSha256: identity.profileSha256,
    retentionPolicySha256: identity.retentionPolicySha256,
    paginationCursorAuthoritySha256: identity.paginationCursorAuthoritySha256,
  })
}

function productionEditAuditBoundaryPolicySha256V1(input: {
  readonly profileSha256: string
  readonly retentionPolicySha256: string
  readonly paginationCursorAuthoritySha256: string
}): string
{
  return canonicalSha256({
    schemaVersion: 1,
    kind: 'production-edit-audit-boundary-policy-v1',
    profileSha256: input.profileSha256,
    retentionPolicySha256: input.retentionPolicySha256,
    transportProjectionAuthoritySha256: input.profileSha256,
    paginationCursorAuthoritySha256: input.paginationCursorAuthoritySha256,
  })
}

async function preflightAuditSuccessorV1(input: {
  readonly privateRoot: string
  readonly identity: ProductionEditRegistryIdentityV1
  readonly keys: Parameters<
    typeof DurableAuditStoreSupervisorV1.inspect
  >[0]['keys']
  readonly expectedPredecessor: AuditPredecessorHandoffManifestV1 | null
}): Promise<void>
{
  const supervisorRoot = join(input.privateRoot, AUDIT_SUPERVISOR_DIRECTORY)
  const current = existsSync(supervisorRoot)
    ? (
        await DurableAuditStoreSupervisorV1.inspect({
          serverRoot: input.privateRoot,
          keys: input.keys,
        })
      ).current
    : ({ state: 'absent' } as const)
  const seed: AuditStoreIdentitySeedV1 = {
    serverInstanceId: 'preflight-server-id',
    runId: 'preflight-run-id',
    realmSha256: input.identity.realmSha256,
    profileSha256: input.identity.profileSha256,
    boundaryPolicySha256: auditBoundaryPolicySha256V1(input.identity),
  }
  assertAuditRealm(current, seed)
  assertExpectedPredecessor(input.expectedPredecessor, current)
  if (current.state === 'terminal' && input.expectedPredecessor !== null)
  {
    const actual = await createAuditPredecessorHandoffManifestV1({
      serverRoot: input.privateRoot,
      storeKey: current.storeKey,
      keys: input.keys,
      expectedIdentity: current.identity,
    })
    if (
      !Buffer.from(actual).equals(
        Buffer.from(canonicalJsonBytesV1(input.expectedPredecessor))
      )
    )
      return refuse(
        'predecessor handoff differs from the authenticated supervisor current store'
      )
  }
}

function recoveryClassification(
  begin: Parameters<
    Parameters<
      DurableAuditStoreSupervisorV1['recoverCurrentStoreV1']
    >[0]['classify']
  >[0],
  recoveredAttempts: readonly RecoveredRetainedEditAttemptV1[],
  principalSha256: string,
  realmSha256: string
): AuditRecoveryClassificationV1
{
  const outcome = begin.retainedOutcome
  if (outcome !== null)
    return Object.freeze({
      disposition: outcome.disposition,
      resultSha256: outcome.resultSha256,
      preHead: outcome.preHead,
      postHead: outcome.postHead,
      semanticEvent: outcome.semanticEvent,
      evidenceIds: outcome.evidenceIds,
      receiptFreeOutcome: outcome.receiptFreeOutcome,
    })
  if (
    begin.boundary.boundaryKind === 'tool' &&
    isEditToolName(begin.boundary.tool)
  )
  {
    const toolName = begin.boundary.tool
    const invocationSha256 = mcpStdioInvocationV1({
      callId: begin.callId,
      toolName,
      requestSha256: begin.fullInputSha256,
      principalSha256,
    }).invocationSha256
    const matches = recoveredAttempts.filter((attempt) =>
    {
      if (
        attempt.receiptFreeOutcome === null ||
        attempt.toolName !== toolName ||
        attempt.invocationCorrelation.boundaryKind !== 'mcp' ||
        attempt.invocationCorrelation.invocationSha256 !== invocationSha256 ||
        begin.idempotency.state !== 'present'
      )
        return false
      const binding = editTransportIdempotencyBindingV1({
        realmSha256,
        principalSha256,
        toolName,
        sessionId: toolName === 'edit_begin' ? null : attempt.sessionId,
        requestId: attempt.requestId,
      })
      return (
        editTransportRequestSha256V1({
          principalSha256,
          realmSha256,
          tool: toolName,
          request: attempt.transportRequest as never,
        }) === begin.fullInputSha256 &&
        binding.namespaceSha256 === begin.idempotency.namespaceSha256 &&
        binding.requestIdSha256 === begin.idempotency.requestIdSha256 &&
        (toolName === 'edit_begin'
          ? begin.session.state === 'absent'
          : begin.session.state === 'present' &&
            begin.session.sessionId === attempt.sessionId)
      )
    })
    if (matches.length > 1)
      return refuse(
        'multiple recovered semantic attempts match one unmatched audit begin'
      )
    const matched = matches[0]
    if (matched !== undefined)
    {
      const receiptFree = matched.receiptFreeOutcome
      if (
        receiptFree === null ||
        typeof receiptFree !== 'object' ||
        Array.isArray(receiptFree)
      )
        return refuse('recovered transport outcome is not one exact envelope')
      const envelope = receiptFree as Record<string, unknown>
      assertEditToolReceiptFreeResponseV1(toolName, envelope)
      const disposition = envelope.ok === false ? 'refused' : 'completed'
      if (disposition !== matched.disposition)
        return refuse(
          'recovered transport outcome differs from its semantic disposition'
        )
      return Object.freeze({
        disposition,
        resultSha256: editReceiptFreeOutcomeSha256V1(
          envelope as unknown as EditToolReceiptFreeResultV1
        ),
        receiptFreeOutcome: envelope as unknown as EditToolReceiptFreeResultV1,
        ...editReceiptFreeAuditContextV1(envelope),
      })
    }
  }
  return Object.freeze({
    disposition: 'failed',
    resultSha256: canonicalSha256({
      schemaVersion: 1,
      kind: 'unmatched-audit-call-recovery-v1',
      callId: begin.callId,
      beginRecordSha256: begin.recordSha256,
      fullInputSha256: begin.fullInputSha256,
    }),
  })
}

export async function recoverProductionEditAuditPredecessorHandoffV1(input: {
  readonly inputRoot: string
  readonly assetInputRoot: string
  readonly privateRoot: string
  readonly artifactStoreRoot: string
  readonly readableArtifactRoot: string
  readonly outputRoot: string
  readonly descriptor: ProductionEditHostBootstrapDescriptorV1
  readonly descriptorFileSha256: string
  readonly descriptorCanonicalSha256: string
  readonly contractRegistrySha256: string
  readonly contractRegistryArtifactSetSha256: string
  readonly secretMaterialSha256: string
  readonly predecessorHandoffSha256: string | null
  readonly secrets: ReturnType<typeof parseEditMcpSecretMaterialV1>
  readonly invocation: HostInvocationContextV1
  readonly auditLimits?: BootstrapAuditLimitsV1
}): Promise<Uint8Array>
{
  if (
    !LOWERCASE_SHA256_PATTERN.test(input.descriptorFileSha256) ||
    canonicalSha256(input.descriptor) !== input.descriptorCanonicalSha256 ||
    !LOWERCASE_SHA256_PATTERN.test(input.contractRegistrySha256) ||
    !LOWERCASE_SHA256_PATTERN.test(input.contractRegistryArtifactSetSha256) ||
    !LOWERCASE_SHA256_PATTERN.test(input.secretMaterialSha256) ||
    (input.predecessorHandoffSha256 !== null &&
      !LOWERCASE_SHA256_PATTERN.test(input.predecessorHandoffSha256)) ||
    input.descriptor.principalSha256 !== input.invocation.principalSha256
  )
    return refuse(
      'exclusive recovery descriptor differs from its invocation authority'
    )
  if (!existsSync(input.readableArtifactRoot))
    return refuse('exclusive recovery requires the readable-artifact root')
  if (!existsSync(input.artifactStoreRoot))
    return refuse(
      'exclusive recovery requires the retained edit artifact store'
    )
  const roots = configureEditMcpProtectedRootsV1({
    inputRoot: input.inputRoot,
    assetInputRoot: input.assetInputRoot,
    outputRoot: input.outputRoot,
    editPrivateRoot: input.privateRoot,
    readableArtifactRoot: input.readableArtifactRoot,
  })
  let readableArtifactRoot: string
  let canonicalArtifactStoreRoot: string
  try
  {
    readableArtifactRoot = realpathSync(input.readableArtifactRoot)
    canonicalArtifactStoreRoot = realpathSync(input.artifactStoreRoot)
  }
  catch
  {
    return refuse(
      'exclusive recovery retained edit-artifact paths are unavailable'
    )
  }
  if (
    resolve(readableArtifactRoot, EDIT_ARTIFACT_STORE_DIRECTORY) !==
    canonicalArtifactStoreRoot
  )
    return refuse(
      'exclusive recovery artifact store differs from the readable root authority'
    )
  const supervisorRoot = join(input.privateRoot, AUDIT_SUPERVISOR_DIRECTORY)
  if (!existsSync(supervisorRoot))
    return refuse('exclusive recovery requires an existing audit supervisor')
  const supervisor = await DurableAuditStoreSupervisorV1.reopen({
    serverRoot: input.privateRoot,
    keys: input.secrets.auditKeys,
  })
  let current = supervisor.index().current
  if (current.state === 'absent')
    return refuse('exclusive recovery has no predecessor audit store')
  const expectedRegistryIdentity = registryIdentity(
    input.descriptor,
    roots,
    input.contractRegistrySha256,
    productionEditNonAuditSecretAuthoritySha256V1(input.secrets),
    productionEditPaginationCursorAuthoritySha256V1(
      input.secrets.paginationCursorSecret
    )
  )
  const recoveryBoundaryPolicySha256 = auditBoundaryPolicySha256V1(
    expectedRegistryIdentity
  )
  if (
    current.identity.realmSha256 !== expectedRegistryIdentity.realmSha256 ||
    current.identity.profileSha256 !== expectedRegistryIdentity.profileSha256 ||
    current.identity.boundaryPolicySha256 !== recoveryBoundaryPolicySha256
  )
    return refuse(
      'exclusive recovery bootstrap, root, projector, schema, or cursor authority differs from the predecessor'
    )
  const recoveryRealmSha256 = expectedRegistryIdentity.realmSha256
  const cursors = new EditPaginationCursorAuthorityV1(
    input.secrets.paginationCursorSecret
  )
  let recoveryStore: ReturnType<typeof createEditArtifactStoreHostAdapter>
  let recoveredAttempts: readonly RecoveredRetainedEditAttemptV1[] = []
  let recoveredSessions: readonly RetainedEditSessionEvidenceV1[] = []
  try
  {
    const artifactStore = createEditArtifactStoreHostAdapter(
      input.artifactStoreRoot,
      { mode: 'read-only', ...editArtifactStoreQuotaV1() }
    )
    const capability = await artifactStore.capability()
    recoveryStore = createEditArtifactStoreHostAdapter(
      input.artifactStoreRoot,
      {
        mode: 'recovery',
        expectedStoreId: capability.storeId,
        expectedOwnershipSha256: capability.ownershipSha256,
        ...editArtifactStoreQuotaV1(),
      }
    )
    const recoveryCapability = await recoveryStore.capability()
    const recoveryCatalogue = await createDurableEditArtifactCatalogueWriterV1({
      artifactStore: recoveryStore,
      expectedStoreId: recoveryCapability.storeId,
      expectedOwnershipSha256: recoveryCapability.ownershipSha256,
    })
    const recovered = await recoverRetainedEditSessionsV1({
      artifactStore: recoveryStore,
      resourceCatalogue: recoveryCatalogue,
      invocation: input.invocation,
      openPublicationRecoveryPort: (authority) =>
        createEditPublicationRecoveryPortV1({
          outputRoot: input.outputRoot,
          authority,
        }),
    })
    const reconstructed: RecoveredRetainedEditAttemptV1[] = []
    for (const attempt of recovered.recoveredAttempts)
    {
      const projectionAuthority = {
        principalSha256: input.invocation.principalSha256,
        realmSha256: recoveryRealmSha256,
        cursors,
      }
      const receiptFreeOutcome = await retainExactTransportResultV1({
        store: recoveryStore,
        target: attempt.transportAuthority,
        projection: {
          kind: 'recovered',
          attempt,
          authority: projectionAuthority,
        },
      })
      reconstructed.push(Object.freeze({ ...attempt, receiptFreeOutcome }))
    }
    recoveredAttempts = Object.freeze(reconstructed)
    recoveredSessions = recovered.sessions
    if ((await recoveryStore.activeQuotaReservations()).length !== 0)
      return refuse('exclusive recovery left active quota reservations')
  }
  catch
  {
    return refuse(
      'exclusive recovery refused unreconciled retained edit-session state'
    )
  }
  const inspectedEvidenceDestination = inspectAcceptedEvidenceDestinationV1(
    readableArtifactRoot,
    input.descriptor.evidenceSummaryRelativePath
  )
  const evidenceDestination = existsSync(
    inspectedEvidenceDestination.absolutePath
  )
    ? inspectedEvidenceDestination
    : prepareAcceptedEvidenceDestinationV1(inspectedEvidenceDestination)
  const recheckEvidenceRoot = (): void =>
  {
    let currentRoot: string
    try
    {
      currentRoot = realpathSync(input.readableArtifactRoot)
    }
    catch
    {
      return refuse('exclusive recovery readable-artifact root is unavailable')
    }
    if (currentRoot !== readableArtifactRoot)
      return refuse(
        'exclusive recovery readable-artifact root identity changed'
      )
  }
  const applyAcceptedEvidencePlan = (
    _terminal: AuditTerminalEvidenceV1,
    plan: AuditTerminalSideEffectPlanV1 | null
  ): void =>
  {
    if (
      plan === null ||
      plan.kind !== 'accepted-evidence-v1' ||
      plan.relativePath !== input.descriptor.evidenceSummaryRelativePath
    )
      return refuse(
        'exclusive recovery requires the exact accepted-evidence side-effect plan'
      )
    writeAcceptedEvidenceBytesV1(
      evidenceDestination,
      Uint8Array.from(Buffer.from(plan.contentBase64, 'base64')),
      recheckEvidenceRoot
    )
  }
  const semantic = retainedEvidenceSummaryV1(recoveredSessions)
  const persistAcceptedEvidencePlan = (
    terminal: AuditTerminalEvidenceV1,
    journal: DurableToolAuditJournalV1
  ): void =>
  {
    const evidence = acceptedEvidenceV1({
      journal,
      terminal,
      semantic,
      descriptor: input.descriptor,
      descriptorFileSha256: input.descriptorFileSha256,
      descriptorCanonicalSha256: input.descriptorCanonicalSha256,
      contractRegistrySha256: input.contractRegistrySha256,
      contractRegistryArtifactSetSha256:
        input.contractRegistryArtifactSetSha256,
      secretMaterialSha256: input.secretMaterialSha256,
      predecessorHandoffSha256: input.predecessorHandoffSha256,
    })
    const plan = journal.retainTerminalSideEffectPlanV1(terminal, {
      kind: 'accepted-evidence-v1',
      relativePath: input.descriptor.evidenceSummaryRelativePath,
      content: canonicalJsonBytesV1(evidence),
    })
    applyAcceptedEvidencePlan(terminal, plan)
  }
  const rawArgument = Object.freeze({ reason: 'exclusive-startup-recovery' })
  const bytes = canonicalJsonBytesV1(rawArgument)
  const terminalInput = Object.freeze({
    principal: { state: 'unavailable' as const },
    fullInputSha256: sha256(bytes),
    inputByteLength: bytes.byteLength,
    rawArgument,
    outcome: serverCloseAuditOutcomeV1(),
  })
  if (current.state === 'active')
  {
    const storeExists = existsSync(
      join(
        input.privateRoot,
        `${AUDIT_STORE_DIRECTORY_PREFIX}${current.storeKey}`
      )
    )
    if (!storeExists)
    {
      const journal = await supervisor.resumeUncreatedStoreV1({
        keys: input.secrets.auditKeys,
        ...(input.auditLimits
          ? {
              recordCap: input.auditLimits.recordCap,
              byteCap: input.auditLimits.byteCap,
            }
          : {}),
      })
      const terminal = journal.terminalizeV1({
        ...terminalInput,
        beforeTerminalPersistence: persistAcceptedEvidencePlan,
      })
      applyAcceptedEvidencePlan(
        terminal,
        journal.terminalSideEffectPlanV1(terminal)
      )
      supervisor.recordCurrentTerminalV1(terminal)
    }
    else
    {
      const currentRealmSha256 = current.identity.realmSha256
      await supervisor.recoverCurrentStoreV1({
        keys: input.secrets.auditKeys,
        classify: (begin) =>
          recoveryClassification(
            begin,
            recoveredAttempts,
            input.invocation.principalSha256,
            currentRealmSha256
          ),
        terminal: terminalInput,
        beforeTerminalPersistence: persistAcceptedEvidencePlan,
        beforeTerminalAnchor: applyAcceptedEvidencePlan,
      })
    }
  }
  else
  {
    await supervisor.recoverCurrentStoreV1({
      keys: input.secrets.auditKeys,
      classify: () =>
        refuse('a terminal audit store cannot expose an unmatched begin'),
      terminal: terminalInput,
      beforeTerminalPersistence: persistAcceptedEvidencePlan,
      beforeTerminalAnchor: applyAcceptedEvidencePlan,
    })
  }
  current = supervisor.index().current
  if (current.state !== 'terminal')
    return refuse('exclusive recovery did not terminalize the predecessor')
  return createAuditPredecessorHandoffManifestV1({
    serverRoot: input.privateRoot,
    storeKey: current.storeKey,
    keys: input.secrets.auditKeys,
    expectedIdentity: current.identity,
  })
}

async function createAuditJournal(input: {
  readonly privateRoot: string
  readonly identity: ProductionEditRegistryIdentityV1
  readonly descriptor: ProductionEditHostBootstrapDescriptorV1
  readonly keys: ReturnType<typeof parseEditMcpSecretMaterialV1>['auditKeys']
  readonly expectedPredecessor: AuditPredecessorHandoffManifestV1 | null
}): Promise<{
  readonly journal: DurableToolAuditJournalV1
  readonly supervisor: DurableAuditStoreSupervisorV1
}>
{
  const supervisorRoot = join(input.privateRoot, AUDIT_SUPERVISOR_DIRECTORY)
  const supervisorExists = existsSync(supervisorRoot)
  const observedCurrent = supervisorExists
    ? (
        await DurableAuditStoreSupervisorV1.inspect({
          serverRoot: input.privateRoot,
          keys: input.keys,
        })
      ).current
    : ({ state: 'absent' } as const)
  const seed: AuditStoreIdentitySeedV1 = Object.freeze({
    serverInstanceId: randomBytes(16).toString('base64url'),
    runId: randomBytes(16).toString('base64url'),
    realmSha256: input.identity.realmSha256,
    profileSha256: input.identity.profileSha256,
    boundaryPolicySha256: auditBoundaryPolicySha256V1(input.identity),
  })
  assertAuditRealm(observedCurrent, seed)
  assertExpectedPredecessor(input.expectedPredecessor, observedCurrent)
  const supervisor = supervisorExists
    ? await DurableAuditStoreSupervisorV1.reopen({
        serverRoot: input.privateRoot,
        keys: input.keys,
      })
    : await DurableAuditStoreSupervisorV1.create({
        serverRoot: input.privateRoot,
        keys: input.keys,
      })
  let current = supervisor.index().current
  const limits = input.descriptor.operatorFixture?.auditLimits
  const options = {
    storeKey: randomBytes(16).toString('hex'),
    identity: seed,
    keys: input.keys,
    ...(limits ? { recordCap: limits.recordCap, byteCap: limits.byteCap } : {}),
  }
  let journal: DurableToolAuditJournalV1
  if (current.state === 'absent')
    journal = await supervisor.createInitialStoreV1(options)
  else
  {
    if (current.state !== 'terminal' || input.expectedPredecessor === null)
      return refuse(
        'ordinary startup refuses an active or unauthenticated predecessor; run exclusive recovery first'
      )
    const actualHandoff = await createAuditPredecessorHandoffManifestV1({
      serverRoot: input.privateRoot,
      storeKey: current.storeKey,
      keys: input.keys,
      expectedIdentity: current.identity,
    })
    if (
      !Buffer.from(actualHandoff).equals(
        Buffer.from(canonicalJsonBytesV1(input.expectedPredecessor))
      )
    )
      return refuse(
        'predecessor handoff differs from the authenticated supervisor current store'
      )
    journal = await supervisor.createSuccessorStoreV1(options)
  }
  current = supervisor.index().current
  if (
    current.state !== 'active' ||
    current.storeKey !== journal.storeKey ||
    journal.identity.realmSha256 !== input.identity.realmSha256
  )
    return refuse('audit supervisor did not retain the live writer authority')
  return Object.freeze({ journal, supervisor })
}

function auditHeadPort(
  journal: DurableToolAuditJournalV1
): EditHostAuditHeadPortV1
{
  return Object.freeze({
    preflight: async () =>
    {
      const verified = journal.verify()
      if (
        !verified.authenticated ||
        verified.tailSha256 !== journal.tailSha256()
      )
        return refuse('live audit head did not verify')
    },
    currentAuditHeadSha256: () => journal.tailSha256(),
  })
}

function artifactResourcesPort(
  resources: EditArtifactResourceStoreV1
): EditHostArtifactResourcesPortV1
{
  return Object.freeze({
    preflight: async () =>
    {
      resources.refresh()
    },
  })
}

function recheckRoots(roots: EditMcpProtectedRootsV1): void
{
  for (const authority of Object.values(roots))
    recheckProtectedMcpRootV1(authority)
}

function assertConfigRootDisjoint(
  configDirectory: string,
  roots: EditMcpProtectedRootsV1
): void
{
  for (const authority of Object.values(roots))
    if (
      isPathWithinRootV1(configDirectory, authority.canonicalRoot) ||
      isPathWithinRootV1(authority.canonicalRoot, configDirectory)
    )
      return refuse(
        'edit host bootstrap directory must be disjoint from protected roots'
      )
}

function syncEvidenceDirectoryV1(path: string): void
{
  let descriptor: number | null = null
  try
  {
    descriptor = openSync(
      path,
      constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW
    )
    if (!fstatSync(descriptor).isDirectory())
      return refuse('accepted evidence parent is not a real directory')
    fsyncSync(descriptor)
  }
  catch (error)
  {
    if (error instanceof McpBoundaryError) throw error
    return refuse('accepted evidence parent could not be synchronized')
  }
  finally
  {
    if (descriptor !== null) closeSync(descriptor)
  }
}

function inspectAcceptedEvidenceDestinationV1(
  root: string,
  relativePath: string
): AcceptedEvidenceDestinationV1
{
  const canonicalRoot = realpathSync(root)
  const absolutePath = resolve(canonicalRoot, relativePath)
  if (
    absolutePath === canonicalRoot ||
    !isPathWithinRootV1(canonicalRoot, absolutePath)
  )
    return refuse('accepted evidence path escapes the readable-artifact root')
  const parentPath = dirname(absolutePath)
  const parentRelative = relative(canonicalRoot, parentPath)
  let current = canonicalRoot
  for (const segment of parentRelative.split(/[\\/]/u).filter(Boolean))
  {
    const next = join(current, segment)
    if (!existsSync(next)) break
    const info = lstatSync(next)
    if (info.isSymbolicLink() || !info.isDirectory())
      return refuse('accepted evidence parent has a symlink component')
    const canonical = realpathSync(next)
    if (canonical !== next || !isPathWithinRootV1(canonicalRoot, canonical))
      return refuse(
        'accepted evidence parent escapes the readable-artifact root'
      )
    current = next
  }
  return Object.freeze({
    root: canonicalRoot,
    relativePath,
    absolutePath,
  })
}

function assertAcceptedEvidenceDestinationAvailableV1(
  root: string,
  relativePath: string
): AcceptedEvidenceDestinationV1
{
  const destination = inspectAcceptedEvidenceDestinationV1(root, relativePath)
  try
  {
    lstatSync(destination.absolutePath)
  }
  catch (error)
  {
    if (
      error !== null &&
      typeof error === 'object' &&
      'code' in error &&
      error.code === 'ENOENT'
    )
      return destination
    if (error instanceof McpBoundaryError) throw error
    return refuse('accepted evidence destination could not be inspected')
  }
  return refuse(
    'accepted evidence destination already belongs to another process'
  )
}

function prepareAcceptedEvidenceDestinationV1(
  inspected: AcceptedEvidenceDestinationV1
): AcceptedEvidenceDestinationV1
{
  const destination = inspectAcceptedEvidenceDestinationV1(
    inspected.root,
    inspected.relativePath
  )
  if (
    destination.root !== inspected.root ||
    destination.absolutePath !== inspected.absolutePath
  )
    return refuse('accepted evidence destination identity changed')
  const parentPath = dirname(destination.absolutePath)
  const parentRelative = relative(destination.root, parentPath)
  let current = destination.root
  for (const segment of parentRelative.split(/[\\/]/u).filter(Boolean))
  {
    const next = join(current, segment)
    if (!existsSync(next))
    {
      try
      {
        mkdirSync(next, { mode: 0o700 })
        syncEvidenceDirectoryV1(current)
      }
      catch (error)
      {
        if (!existsSync(next))
        {
          if (error instanceof McpBoundaryError) throw error
          return refuse('accepted evidence parent could not be created')
        }
      }
    }
    const info = lstatSync(next)
    if (info.isSymbolicLink() || !info.isDirectory())
      return refuse('accepted evidence parent has a symlink component')
    const canonical = realpathSync(next)
    if (canonical !== next || !isPathWithinRootV1(destination.root, canonical))
      return refuse(
        'accepted evidence parent escapes the readable-artifact root'
      )
    current = next
  }
  return assertAcceptedEvidenceDestinationAvailableV1(
    destination.root,
    destination.relativePath
  )
}

function acceptedBoundaryV1(
  boundary: ServerAuditBoundaryV1
): AcceptedEvidenceCallV1['boundary'] | null
{
  if (boundary.boundaryKind === 'tool') return 'tool'
  if (boundary.boundaryKind === 'resource-list') return 'resource-list'
  if (boundary.boundaryKind === 'resource-read') return 'resource-read'
  if (boundary.boundaryKind === 'protocol') return 'protocol'
  return null
}

function acceptedBoundaryNameV1(
  boundary: Parameters<typeof acceptedBoundaryV1>[0]
): string
{
  if (boundary.boundaryKind === 'tool') return boundary.tool
  if (boundary.boundaryKind === 'resource-list') return 'resources/list'
  if (boundary.boundaryKind === 'resource-read') return 'resources/read'
  if (boundary.boundaryKind === 'protocol')
    return boundary.protocolKind === 'tools-list'
      ? 'tools/list'
      : `protocol/${boundary.protocolKind}`
  return refuse('non-call audit boundary cannot enter accepted evidence')
}

function acceptedAuditCallsV1(
  journal: DurableToolAuditJournalV1
): readonly AcceptedEvidenceCallV1[]
{
  const reconciliation = journal.verify()
  if (
    !reconciliation.authenticated ||
    reconciliation.tailSha256 !== journal.tailSha256()
  )
    return refuse('terminal audit journal did not authenticate')
  const begins = new Map<
    string,
    {
      readonly sequence: number
      readonly recordSha256: string
      readonly record: Extract<
        ServerAuditRecordHashProjectionV1,
        { readonly phase: 'call-begin' }
      >
    }
  >()
  const calls: AcceptedEvidenceCallV1[] = []
  const seenCallIds = new Set<string>()
  const seenBeginSequences = new Set<number>()
  const records = [...reconciliation.records.values()].sort(
    (left, right) => left.sequence - right.sequence
  )
  for (const loaded of records)
  {
    const record = loaded.record.record
    if (
      record.serverInstanceId !== journal.identity.serverInstanceId ||
      record.principal.state !== 'unavailable'
    )
      return refuse(
        'terminal audit record identity differs from production authority'
      )
    const boundary = acceptedBoundaryV1(record.boundary)
    if (boundary === null) continue
    if (record.phase === 'call-begin')
    {
      if (
        begins.has(record.callId) ||
        seenCallIds.has(record.callId) ||
        seenBeginSequences.has(record.sequence)
      )
        return refuse('terminal audit journal repeats a call identity')
      seenCallIds.add(record.callId)
      seenBeginSequences.add(record.sequence)
      begins.set(record.callId, {
        sequence: record.sequence,
        recordSha256: loaded.sha256,
        record,
      })
      continue
    }
    const begun = begins.get(record.callId)
    if (
      begun === undefined ||
      begun.recordSha256 !== record.beginRecordSha256 ||
      begun.sequence !== record.beginSequence ||
      acceptedBoundaryV1(begun.record.boundary) !== boundary ||
      acceptedBoundaryNameV1(begun.record.boundary) !==
        acceptedBoundaryNameV1(record.boundary)
    )
      return refuse('terminal audit call pair does not reconcile')
    calls.push(
      Object.freeze({
        sequence: begun.sequence,
        boundary,
        name: acceptedBoundaryNameV1(record.boundary),
        callId: record.callId,
        requestSha256: begun.record.fullInputSha256,
        outcomeSha256: record.resultSha256,
        beginRecordSha256: begun.recordSha256,
        completeRecordSha256: loaded.sha256,
        eventSha256:
          record.semanticEvent.state === 'present'
            ? record.semanticEvent.event.eventSha256
            : null,
      })
    )
    begins.delete(record.callId)
  }
  if (begins.size !== 0 || journal.unmatchedBegins().length !== 0)
    return refuse('terminal audit journal retains unmatched call begins')
  return Object.freeze(
    calls.sort((left, right) => left.sequence - right.sequence)
  )
}

function retainedEvidenceSummaryV1(
  retainedSessions: readonly RetainedEditSessionEvidenceV1[]
): EditTransportEvidenceSummaryV1
{
  const sessions = Object.freeze(
    retainedSessions
      .map((session) =>
        Object.freeze({
          sessionId: session.sessionId,
          state: session.state,
          head: session.head,
          eventHeadSha256: session.eventHeadSha256,
          reportSha256: session.reportSha256,
          recoverable: false,
        })
      )
      .sort((left, right) => left.sessionId.localeCompare(right.sessionId))
  )
  const terminalEvidence = retainedSessions.map(
    (session) => session.terminalEvidence
  )
  const unique = (values: readonly string[]): readonly string[] =>
    Object.freeze([...new Set(values)].sort())
  const projection = {
    kind: 'edit-transport-evidence-summary' as const,
    schemaVersion: 1 as const,
    sessions,
    revisionSha256s: unique(
      terminalEvidence.flatMap((entry) => entry.revisionSha256s)
    ),
    parentDeltaSha256s: unique(
      terminalEvidence.flatMap((entry) => entry.parentDeltaSha256s)
    ),
    cumulativeDeltaSha256s: unique(
      terminalEvidence.flatMap((entry) => entry.cumulativeDeltaSha256s)
    ),
    preservationSha256s: unique(
      terminalEvidence.flatMap((entry) => entry.preservationSha256s)
    ),
    lineageSha256s: unique(
      terminalEvidence.flatMap((entry) => entry.lineageSha256s)
    ),
    certificateSha256s: unique(
      terminalEvidence.flatMap((entry) => entry.certificateSha256s)
    ),
    reportProjectionSha256s: unique(
      terminalEvidence.flatMap((entry) => entry.reportProjectionSha256s)
    ),
    exportReceiptSha256s: unique(
      terminalEvidence.flatMap((entry) => entry.exportReceiptSha256s)
    ),
    recoverableSessionCount: 0,
    hasRecoverableState: false,
  }
  return Object.freeze({
    ...projection,
    summarySha256: semanticHashV1('semantic-report-projection', projection),
  })
}

function acceptedEvidenceV1(input: {
  readonly journal: DurableToolAuditJournalV1
  readonly terminal: AuditTerminalEvidenceV1
  readonly semantic: EditTransportEvidenceSummaryV1
  readonly descriptor: ProductionEditHostBootstrapDescriptorV1
  readonly descriptorFileSha256: string
  readonly descriptorCanonicalSha256: string
  readonly contractRegistrySha256: string
  readonly contractRegistryArtifactSetSha256: string
  readonly secretMaterialSha256: string
  readonly predecessorHandoffSha256: string | null
}): unknown
{
  const reconciliation = input.journal.verify()
  if (
    !reconciliation.authenticated ||
    reconciliation.tailSha256 !== input.terminal.finalTailSha256 ||
    input.journal.tailSha256() !== input.terminal.finalTailSha256 ||
    reconciliation.tail.storeKey !== input.terminal.storeKey ||
    reconciliation.tail.auditKeyId !== input.terminal.auditKeyId ||
    reconciliation.tail.currentRecordSha256 !==
      input.terminal.finalRecordSha256 ||
    reconciliation.tail.recordCount !== input.terminal.recordCount ||
    reconciliation.tail.recordBytes !== input.terminal.recordBytes ||
    input.terminal.closeReceipt.completeRecordSha256 !==
      input.terminal.finalRecordSha256 ||
    input.journal.identity.serverInstanceId !==
      input.terminal.serverInstanceId ||
    input.journal.identity.runId !== input.terminal.runId
  )
    return refuse('terminal evidence does not match the live host authority')
  const semantic = input.semantic
  if (
    semantic.hasRecoverableState ||
    semantic.sessions.some(
      (session) =>
        session.state !== 'closed-exported' &&
        session.state !== 'closed-unexported'
    )
  )
    return refuse('accepted evidence requires every edit session to be closed')
  const calls = acceptedAuditCallsV1(input.journal)
  const resourceCalls = calls.filter(
    (call) =>
      call.boundary === 'resource-list' || call.boundary === 'resource-read'
  )
  return Object.freeze({
    schemaVersion: 1 as const,
    serverInstanceId: input.terminal.serverInstanceId,
    invocationPrincipalSha256: input.descriptor.principalSha256,
    journalRunId: input.terminal.runId,
    journalStoreKey: input.terminal.storeKey,
    journalAuditKeyId: input.terminal.auditKeyId,
    journalRealmSha256: input.journal.identity.realmSha256,
    journalProfileSha256: input.journal.identity.profileSha256,
    journalBoundaryPolicySha256: input.journal.identity.boundaryPolicySha256,
    journalPredecessor: input.journal.identity.predecessor,
    serverAuditHeadSha256: input.terminal.finalTailSha256,
    terminalSha256: input.terminal.terminalSha256,
    auditRecordCount: input.terminal.recordCount,
    auditRecordBytes: input.terminal.recordBytes,
    semanticEventHeads: Object.freeze(
      semantic.sessions.map((session) =>
        Object.freeze({
          sessionId: session.sessionId,
          eventHeadSha256: session.eventHeadSha256,
        })
      )
    ),
    unmatchedAuditBegins: 0 as const,
    calls,
    revisionSha256s: semantic.revisionSha256s,
    parentDeltaSha256s: semantic.parentDeltaSha256s,
    cumulativeDeltaSha256s: semantic.cumulativeDeltaSha256s,
    preservationSha256s: semantic.preservationSha256s,
    lineageSha256s: semantic.lineageSha256s,
    certificateSha256s: semantic.certificateSha256s,
    reportProjectionSha256s: semantic.reportProjectionSha256s,
    exportReceiptSha256s: semantic.exportReceiptSha256s,
    resourceUseSha256: canonicalSha256({
      schemaVersion: 1,
      kind: 'production-edit-resource-use-v1',
      calls: resourceCalls,
    }),
    bootstrapDescriptorSha256: input.descriptorFileSha256,
    bootstrapDescriptorCanonicalSha256: input.descriptorCanonicalSha256,
    contractRegistrySha256: input.contractRegistrySha256,
    contractRegistryArtifactSetSha256: input.contractRegistryArtifactSetSha256,
    secretMaterialSha256: input.secretMaterialSha256,
    predecessorHandoffSha256: input.predecessorHandoffSha256,
    hostManifestSha256: input.descriptor.authoritativeBuildManifestSha256,
  })
}

function writeAcceptedEvidenceV1(
  destination: AcceptedEvidenceDestinationV1,
  roots: EditMcpProtectedRootsV1,
  evidence: unknown
): void
{
  writeAcceptedEvidenceBytesV1(
    destination,
    canonicalJsonBytesV1(evidence),
    () => recheckRoots(roots)
  )
}

function writeAcceptedEvidenceBytesV1(
  destination: AcceptedEvidenceDestinationV1,
  bytes: Uint8Array,
  recheck: () => void
): void
{
  recheck()
  const current = inspectAcceptedEvidenceDestinationV1(
    destination.root,
    destination.relativePath
  )
  if (current.absolutePath !== destination.absolutePath)
    return refuse('accepted evidence destination changed after startup')
  if (bytes.byteLength > MAXIMUM_ACCEPTED_EVIDENCE_BYTES)
    return refuse('accepted evidence exceeds its terminal byte limit')
  const expectedSha256 = sha256(bytes)
  const parent = dirname(current.absolutePath)
  const temporaryPath = join(parent, `.accepted-evidence-${expectedSha256}.tmp`)
  const reconcilePath = (path: string, syncParent: boolean): boolean =>
  {
    let finalDescriptor: number | null = null
    try
    {
      finalDescriptor = openSync(
        path,
        constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK
      )
      const before = fstatSync(finalDescriptor, { bigint: true })
      const retained = Uint8Array.from(readFileSync(finalDescriptor))
      const after = fstatSync(finalDescriptor, { bigint: true })
      if (
        !before.isFile() ||
        before.dev !== after.dev ||
        before.ino !== after.ino ||
        before.size !== after.size ||
        before.mtimeNs !== after.mtimeNs ||
        retained.byteLength !== bytes.byteLength ||
        sha256(retained) !== expectedSha256
      )
        return false
      if (syncParent) syncEvidenceDirectoryV1(parent)
      return true
    }
    catch
    {
      return false
    }
    finally
    {
      if (finalDescriptor !== null) closeSync(finalDescriptor)
    }
  }
  if (existsSync(current.absolutePath))
  {
    if (!reconcilePath(current.absolutePath, true))
      return refuse('accepted evidence destination contains different bytes')
    if (existsSync(temporaryPath))
    {
      if (!reconcilePath(temporaryPath, false))
        return refuse(
          'accepted evidence temporary path contains different bytes'
        )
      unlinkSync(temporaryPath)
      syncEvidenceDirectoryV1(parent)
    }
    return
  }
  let descriptor: number | null = null
  let installed = false
  let ownedTemporary = false
  try
  {
    if (existsSync(temporaryPath))
    {
      if (!reconcilePath(temporaryPath, false))
        return refuse(
          'accepted evidence temporary path contains different bytes'
        )
      ownedTemporary = true
    }
    else
    {
      descriptor = openSync(
        temporaryPath,
        constants.O_WRONLY |
          constants.O_CREAT |
          constants.O_EXCL |
          constants.O_NOFOLLOW,
        0o600
      )
      ownedTemporary = true
      writeFileSync(descriptor, bytes)
      fsyncSync(descriptor)
      const retained = fstatSync(descriptor)
      if (!retained.isFile() || retained.size !== bytes.byteLength)
        return refuse('accepted evidence was not durably retained in full')
      closeSync(descriptor)
      descriptor = null
      if (!reconcilePath(temporaryPath, false))
        return refuse('accepted evidence failed its no-follow hash readback')
    }
    linkSync(temporaryPath, current.absolutePath)
    installed = true
    syncEvidenceDirectoryV1(parent)
    unlinkSync(temporaryPath)
    syncEvidenceDirectoryV1(parent)
  }
  catch (error)
  {
    if (error instanceof McpBoundaryError) throw error
    if (reconcilePath(current.absolutePath, true)) return
    return refuse('accepted evidence could not be installed without replace')
  }
  finally
  {
    if (descriptor !== null) closeSync(descriptor)
    if (ownedTemporary && (!installed || existsSync(temporaryPath)))
    {
      try
      {
        unlinkSync(temporaryPath)
        syncEvidenceDirectoryV1(parent)
      }
      catch
      {
        // a failed temp cleanup cannot make a partial final artifact visible
      }
    }
  }
}

export async function createProductionEditMcpServerFromEnvironmentV1(
  environment: NodeJS.ProcessEnv = process.env
): Promise<RepairMcpServer>
{
  if (environment.SCRATCH_AGENT_MCP_PROFILE !== 'project-edit')
    return refuse('production edit bootstrap requires project-edit profile')
  const expectedDescriptorSha256 = requiredSha256Environment(
    environment,
    'SCRATCH_AGENT_EDIT_EXPECTED_DESCRIPTOR_SHA256'
  )
  const expectedDescriptorCanonicalSha256 = requiredSha256Environment(
    environment,
    'SCRATCH_AGENT_EDIT_EXPECTED_DESCRIPTOR_CANONICAL_SHA256'
  )
  const expectedRegistrySha256 = requiredSha256Environment(
    environment,
    'SCRATCH_AGENT_EDIT_EXPECTED_CONTRACT_REGISTRY_SHA256'
  )
  const expectedRegistryArtifactSetSha256 = requiredSha256Environment(
    environment,
    'SCRATCH_AGENT_EDIT_EXPECTED_CONTRACT_REGISTRY_ARTIFACT_SET_SHA256'
  )
  const expectedSecretMaterialSha256 = requiredSha256Environment(
    environment,
    'SCRATCH_AGENT_EDIT_EXPECTED_SECRET_MATERIAL_SHA256'
  )
  const expectedPredecessorHandoffSha256 =
    requiredPredecessorSha256Environment(environment)
  const descriptorRead = readBootstrapFile(
    requiredEnvironment(environment, 'SCRATCH_AGENT_EDIT_HOST_CONFIG')
  )
  const descriptor = parseBootstrapDescriptor(descriptorRead.bytes)
  if (
    descriptorRead.sha256 !== expectedDescriptorSha256 ||
    canonicalSha256(descriptor) !== expectedDescriptorCanonicalSha256
  )
    return refuse(
      'consumed edit host descriptor differs from prepared authority'
    )
  const roots = configureEditMcpProtectedRootsV1({
    inputRoot: requiredEnvironment(environment, 'SCRATCH_AGENT_INPUT_ROOT'),
    assetInputRoot: requiredEnvironment(
      environment,
      'SCRATCH_AGENT_ASSET_INPUT_ROOT'
    ),
    outputRoot: requiredEnvironment(environment, 'SCRATCH_AGENT_OUTPUT_ROOT'),
    editPrivateRoot: requiredEnvironment(
      environment,
      'SCRATCH_AGENT_EDIT_PRIVATE_ROOT'
    ),
    readableArtifactRoot: requiredEnvironment(
      environment,
      'SCRATCH_AGENT_READABLE_ARTIFACT_ROOT'
    ),
  })
  assertConfigRootDisjoint(descriptorRead.canonicalDirectory, roots)
  const privateRead = createProtectedMcpReadPortV1(
    roots.editPrivate,
    MAXIMUM_BOOTSTRAP_BYTES
  )
  const loaded = await loadEditContractRegistryV1({
    privateRoot: roots.editPrivate.canonicalRoot,
    manifestRelativePath: descriptor.contractRegistryRelativePath,
    readPort: privateRead,
  })
  if (
    loaded.manifestSha256 !== expectedRegistrySha256 ||
    loaded.artifactSetSha256 !== expectedRegistryArtifactSetSha256
  )
    return refuse(
      'consumed edit contract registry differs from prepared authority'
    )
  assertRegistrations(descriptor, loaded)
  const secretRead = await privateRead.read(
    resolve(
      roots.editPrivate.canonicalRoot,
      descriptor.secretMaterialRelativePath
    )
  )
  if (secretRead.sha256 !== expectedSecretMaterialSha256)
    return refuse(
      'consumed edit host secret material differs from prepared authority'
    )
  const secrets = parseEditMcpSecretMaterialV1(secretRead.bytes)
  const predecessorRead =
    descriptor.predecessorManifestRelativePath === null
      ? null
      : await privateRead.read(
          resolve(
            roots.editPrivate.canonicalRoot,
            descriptor.predecessorManifestRelativePath
          )
        )
  if (
    (predecessorRead === null ? null : predecessorRead.sha256) !==
    expectedPredecessorHandoffSha256
  )
    return refuse(
      'consumed predecessor handoff differs from prepared authority'
    )
  const expectedPredecessor =
    predecessorRead === null
      ? null
      : parsePredecessorManifest(predecessorRead.bytes)
  const inspectedEvidenceDestination =
    assertAcceptedEvidenceDestinationAvailableV1(
      roots.readableArtifact.canonicalRoot,
      descriptor.evidenceSummaryRelativePath
    )
  const identity = registryIdentity(
    descriptor,
    roots,
    loaded.manifestSha256,
    productionEditNonAuditSecretAuthoritySha256V1(secrets),
    productionEditPaginationCursorAuthoritySha256V1(
      secrets.paginationCursorSecret
    )
  )
  await preflightAuditSuccessorV1({
    privateRoot: roots.editPrivate.canonicalRoot,
    identity,
    keys: secrets.auditKeys,
    expectedPredecessor,
  })
  const artifactStoreRoot = join(
    roots.readableArtifact.canonicalRoot,
    EDIT_ARTIFACT_STORE_DIRECTORY
  )
  let retainedSessionInventory: Awaited<
    ReturnType<typeof inventoryRetainedEditSessionsV1>
  > = Object.freeze({ sessions: Object.freeze([]) })
  if (existsSync(artifactStoreRoot))
  {
    try
    {
      const readOnlyArtifactStore = createEditArtifactStoreHostAdapter(
        artifactStoreRoot,
        { mode: 'read-only', ...editArtifactStoreQuotaV1() }
      )
      const readOnlyCapability = await readOnlyArtifactStore.capability()
      if (readOnlyCapability.quota.maxBytes !== EDIT_ARTIFACT_STORE_MAX_BYTES)
        return refuse('edit artifact store quota differs from frozen authority')
      retainedSessionInventory = await inventoryRetainedEditSessionsV1({
        artifactStore: readOnlyArtifactStore,
      })
      const activeReservations =
        await readOnlyArtifactStore.activeQuotaReservations()
      if (activeReservations.length !== 0)
        return refuse(
          'ordinary startup refuses active edit-artifact quota reservations; run exclusive recovery first'
        )
    }
    catch
    {
      return refuse(
        'retained edit-session startup inventory could not be read safely'
      )
    }
  }
  const evidenceDestination = prepareAcceptedEvidenceDestinationV1(
    inspectedEvidenceDestination
  )
  const evaluationPorts = await createEvaluationPorts(descriptor)
  const artifactStore = await reopenEditArtifactStore(artifactStoreRoot)
  const artifactCapability = await artifactStore.capability()
  if (artifactCapability.quota.maxBytes !== EDIT_ARTIFACT_STORE_MAX_BYTES)
    return refuse('edit artifact store quota differs from frozen authority')
  const resourceCatalogue = await createDurableEditArtifactCatalogueWriterV1({
    artifactStore,
    expectedStoreId: artifactCapability.storeId,
    expectedOwnershipSha256: artifactCapability.ownershipSha256,
  })
  const readableCatalogue = new DurableEditArtifactCatalogueV1({
    storeRoot: artifactStoreRoot,
    expectedStoreId: artifactCapability.storeId,
    expectedOwnershipSha256: artifactCapability.ownershipSha256,
    principalIdentity: descriptor.principalSha256,
  })
  const editArtifacts = new EditArtifactResourceStoreV1({
    principalIdentity: descriptor.principalSha256,
    resourceSecret: secrets.resourceCapabilitySecret,
    catalogue: readableCatalogue,
    listingCursorSecret: secrets.resourceListingCursorSecret,
  })
  const assetRoot = editAssetInputRootFromAuthorityV1(roots.assetInput)
  const assetPort = createEditAssetInputPort(assetRoot)
  const intake = createTrustedIntake(
    descriptor,
    identity,
    loaded.manifestSha256,
    assetPort
  )
  const paths: RepairMcpPathConfig = Object.freeze({
    inputRoot: roots.input.canonicalRoot,
    outputRoot: roots.output.canonicalRoot,
    artifactRoot: roots.readableArtifact.canonicalRoot,
    inputLexicalRoot: roots.input.lexicalRoot,
    outputLexicalRoot: roots.output.lexicalRoot,
    artifactLexicalRoot: roots.readableArtifact.lexicalRoot,
  })
  const projects = new ProjectSessionRegistry(paths)
  const audit = await createAuditJournal({
    privateRoot: roots.editPrivate.canonicalRoot,
    identity,
    descriptor,
    keys: secrets.auditKeys,
    expectedPredecessor,
  })
  const persistAcceptedEvidence =
    (semantic: EditTransportEvidenceSummaryV1) =>
    (
      terminal: AuditTerminalEvidenceV1,
      journal: DurableToolAuditJournalV1
    ): void =>
    {
      const evidence = acceptedEvidenceV1({
        journal,
        terminal,
        semantic,
        descriptor,
        descriptorFileSha256: descriptorRead.sha256,
        descriptorCanonicalSha256: canonicalSha256(descriptor),
        contractRegistrySha256: loaded.manifestSha256,
        contractRegistryArtifactSetSha256: loaded.artifactSetSha256,
        secretMaterialSha256: secretRead.sha256,
        predecessorHandoffSha256:
          predecessorRead === null ? null : predecessorRead.sha256,
      })
      journal.retainTerminalSideEffectPlanV1(terminal, {
        kind: 'accepted-evidence-v1',
        relativePath: descriptor.evidenceSummaryRelativePath,
        content: canonicalJsonBytesV1(evidence),
      })
      writeAcceptedEvidenceV1(evidenceDestination, roots, evidence)
    }
  try
  {
    const publicationRoot = configureEditPublicationDirectory(
      roots.output.canonicalRoot,
      `edit-${audit.journal.identity.runId}`
    )
    projects.registerEditPublicationRootV1(publicationRoot)
    const publicationPort = createEditPublicationPort(publicationRoot)
    const editHost = await createEditTransportRegistryV1({
      projects,
      changeContracts: loaded.registry,
      identity,
      artifactStore,
      resourceCatalogue,
      handleSecret: secrets.handleSecret,
      principalSha256: descriptor.principalSha256,
      evaluationPorts,
      publicationPort,
      trustedIntake: intake,
      auditHead: auditHeadPort(audit.journal),
      artifactResources: artifactResourcesPort(editArtifacts),
      cursorSecret: secrets.paginationCursorSecret,
      retainedSessionInventory: retainedSessionInventory.sessions,
    })
    recheckRoots(roots)
    return createScratchMcpServer(paths, {
      profile: 'project-edit',
      projectRegistry: projects,
      editHost,
      editJournal: audit.journal,
      editArtifacts,
      editPrincipal: Object.freeze({ state: 'unavailable' }),
      editInvocationPrincipalSha256: descriptor.principalSha256,
      editPredecessorIdempotencyLookup: (lookup) =>
        audit.supervisor.lookupPredecessorIdempotencyV1({
          keys: secrets.auditKeys,
          ...lookup,
        }),
      beforeAuditTerminalPersistence: (terminal, journal) =>
        persistAcceptedEvidence(editHost.evidenceSummaryV1())(
          terminal,
          journal
        ),
      onAuditTerminal: (terminal) =>
        audit.supervisor.recordCurrentTerminalV1(terminal),
    })
  }
  catch (error)
  {
    const rawArgument = Object.freeze({ reason: 'startup-construction-failed' })
    const inputBytes = canonicalJsonBytesV1(rawArgument)
    try
    {
      const terminal = audit.journal.terminalizeV1({
        principal: { state: 'unavailable' },
        fullInputSha256: sha256(inputBytes),
        inputByteLength: inputBytes.byteLength,
        rawArgument,
        outcome: serverCloseAuditOutcomeV1(),
        beforeTerminalPersistence: persistAcceptedEvidence(
          retainedEvidenceSummaryV1(retainedSessionInventory.sessions)
        ),
      })
      audit.supervisor.recordCurrentTerminalV1(terminal)
    }
    catch (terminalError)
    {
      throw new AggregateError(
        [error, terminalError],
        'project-edit startup failed and its audit allocation requires exclusive recovery'
      )
    }
    throw error
  }
}
