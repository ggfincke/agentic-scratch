// scripts/semantic-edit/mcp-driver.ts
// typed real-stdio driver for the project-edit benchmark boundary

import { randomBytes } from 'node:crypto'
import type { ChildProcess } from 'node:child_process'
import { existsSync, lstatSync } from 'node:fs'
import { dirname, isAbsolute, join, resolve, sep } from 'node:path'

import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import {
  getDefaultEnvironment,
  StdioClientTransport,
} from '@modelcontextprotocol/sdk/client/stdio.js'
import {
  EDIT_TOOL_NAMES,
  EditChangeContractRegistryV1,
  PHASE_8_EDIT_LIMIT_AUTHORITY_V1,
  parseEditToolInputV1,
  toolOutputSchemaModel,
  validateSchemaValue,
  type EditApplyRequestV1,
  type EditAssetAdmitRequestV1,
  type EditBeginRequestV1,
  type EditCapabilitiesRequestV1,
  type EditCheckpointRequestV1,
  type EditCloseRequestV1,
  type EditEvaluateRequestV1,
  type EditExportRequestV1,
  type EditInspectRequestV1,
  type EditLimitKeyV1,
  type EditPreviewRequestV1,
  type EditRollbackRequestV1,
  type EditStatusRequestV1,
  type EditToolName,
  type EditToolResultV1,
  type EditUndoRequestV1,
} from '@scratch-agent/edit'
import {
  createAuditPredecessorHandoffManifestV1,
  editContractRegistryArtifactSetSha256V1,
  measureToolProfileV1,
  parseAuditPredecessorHandoffManifestV1,
  parseEditMcpSecretMaterialV1,
  recoverProductionEditAuditPredecessorHandoffV1,
  type AuditPredecessorHandoffManifestV1,
} from '@scratch-agent/mcp'
import { canonicalJsonBytesV1 } from '@scratch-agent/sb3/canonical-json'

import { unknownRecord } from '../lib/codex.js'

import {
  SEMANTIC_EDIT_TOOL_ALLOWLIST,
  canonicalSha256,
  ensurePrivateDirectory,
  parseSemanticEditHostBootstrapDescriptorV1,
  readBoundedJsonV1,
  readBoundedRegularFileV1,
  sha256,
  writeExclusive,
  writeJsonExclusive,
  type SemanticEditHostBootstrapDescriptorV1,
  type SemanticEditRunLayoutV1,
  type SemanticEditTraceRecordV1,
} from './harness.js'

interface EditRequestByNameV1
{
  readonly edit_capabilities: EditCapabilitiesRequestV1
  readonly edit_begin: EditBeginRequestV1
  readonly edit_inspect: EditInspectRequestV1
  readonly edit_asset_admit: EditAssetAdmitRequestV1
  readonly edit_preview: EditPreviewRequestV1
  readonly edit_apply: EditApplyRequestV1
  readonly edit_checkpoint: EditCheckpointRequestV1
  readonly edit_undo: EditUndoRequestV1
  readonly edit_rollback: EditRollbackRequestV1
  readonly edit_evaluate: EditEvaluateRequestV1
  readonly edit_status: EditStatusRequestV1
  readonly edit_export: EditExportRequestV1
  readonly edit_close: EditCloseRequestV1
}

interface SemanticEditMcpDriverOptionsV1
{
  readonly repositoryRoot: string
  readonly layout: SemanticEditRunLayoutV1
  readonly preparedHost: PreparedSemanticEditMcpHostV1
  readonly hostBootstrapPath: string
  readonly maximumCallDurationMs: number
  readonly serverPath?: string
}

interface SemanticEditProjectToolResultV1
{
  readonly result: unknown
  readonly trace: SemanticEditTraceRecordV1
}

interface SemanticEditToolCallResultV1<N extends EditToolName>
{
  readonly result: Extract<EditToolResultV1, { readonly tool: N }>
  readonly trace: SemanticEditTraceRecordV1
}

interface SemanticEditLostResponseV1<N extends EditToolName>
{
  readonly tool: N
  readonly request: EditRequestByNameV1[N]
  readonly result: Extract<EditToolResultV1, { readonly tool: N }>
  readonly interceptedTrace: SemanticEditTraceRecordV1
  readonly wireResponseSha256: string
}

export interface SemanticEditMcpDriverV1
{
  readonly serverPath: string
  readonly stderr: () => string
  readonly stderrEvidence: () => SemanticEditMcpStderrEvidenceV1
  readonly processObservation: () => SemanticEditMcpProcessObservationV1
  readonly trace: () => readonly SemanticEditTraceRecordV1[]
  readonly connect: () => Promise<void>
  readonly close: () => Promise<void>
  readonly crashForRecoveryProbe: () => Promise<void>
  readonly assertExactToolProfile: () => Promise<SemanticEditToolProfileEvidenceV1>
  readonly callProject: (
    name: 'project_open' | 'project_inspect' | 'project_run' | 'project_status',
    request: Readonly<Record<string, unknown>>
  ) => Promise<SemanticEditProjectToolResultV1>
  readonly callEdit: <N extends EditToolName>(
    name: N,
    request: EditRequestByNameV1[N]
  ) => Promise<SemanticEditToolCallResultV1<N>>
  readonly callEditWithLostResponse: <N extends EditToolName>(
    name: N,
    request: EditRequestByNameV1[N]
  ) => Promise<SemanticEditLostResponseV1<N>>
  readonly callEditBoundaryProbe: <N extends EditToolName>(
    name: N,
    request: EditRequestByNameV1[N]
  ) => Promise<
    | { readonly state: 'returned'; readonly result: unknown }
    | { readonly state: 'protocol-refusal'; readonly code: string }
  >
  readonly listResources: (cursor?: string) => Promise<unknown>
  readonly readResource: (uri: string) => Promise<unknown>
}

interface SemanticEditMcpStderrEvidenceV1
{
  readonly observedByteLength: number
  readonly retainedByteLength: number
  readonly retainedSha256: string
  readonly truncated: boolean
}

interface SemanticEditMcpProcessObservationV1
{
  readonly spawned: boolean
  readonly pid: number | null
  readonly closeObserved: boolean
  readonly exitCode: number | null
  readonly signal: NodeJS.Signals | null
  readonly clientCloseRequested: boolean
  readonly forcedCrashRequested: boolean
  readonly transportErrors: readonly string[]
}

export interface SemanticEditToolProfileEvidenceV1
{
  readonly names: readonly string[]
  readonly profileSha256: string
  readonly measurement: ReturnType<typeof measureToolProfileV1>
}

const MAXIMUM_STDERR_BYTES = 64 * 1024
const MAXIMUM_BOOTSTRAP_FILE_BYTES = 2 * 1024 * 1024

interface PrepareSemanticEditMcpHostOptionsV1
{
  readonly layout: SemanticEditRunLayoutV1
  readonly principalSha256: string
  readonly pinnedScratchRuntimeSourceSha256: string
  readonly authoritativeBuildManifestSha256: string
  readonly behaviorContract: SemanticEditHostBootstrapDescriptorV1['behaviorContract']
  readonly mediaContract: SemanticEditHostBootstrapDescriptorV1['mediaContract']
  readonly contractRegistryPath: string
  readonly evidenceSummaryRelativePath: string
  readonly secretMaterialPath?: string
  readonly predecessorHandoffPath?: string
  readonly operatorFixture?: SemanticEditHostBootstrapDescriptorV1['operatorFixture']
}

export interface PreparedSemanticEditMcpHostV1
{
  readonly descriptorPath: string
  readonly descriptor: SemanticEditHostBootstrapDescriptorV1
  // raw immutable descriptor-file identity used by production evidence
  readonly descriptorSha256: string
  // canonical parsed-object identity used by exclusive recovery validation
  readonly descriptorCanonicalSha256: string
  // raw immutable contract-registry manifest file identity
  readonly contractRegistrySha256: string
  // exact raw manifest, registration, & retained-policy identity set
  readonly contractRegistryArtifactSetSha256: string
  // raw immutable secret-material file identity
  readonly secretMaterialSha256: string
  readonly predecessorHandoffSha256: string | null
  readonly generatedSecretMaterial: boolean
}

export interface PreparedSemanticEditMcpHostEvidenceV1
{
  readonly descriptorSha256: string
  readonly descriptorCanonicalSha256: string
  readonly contractRegistrySha256: string
  readonly contractRegistryArtifactSetSha256: string
  readonly secretMaterialSha256: string
  readonly predecessorHandoffSha256: string | null
}

interface PrepareSemanticEditMcpSuccessorHostOptionsV1
{
  readonly layout: SemanticEditRunLayoutV1
  readonly predecessorHost: PreparedSemanticEditMcpHostV1
  readonly predecessorHandoffBytes: Uint8Array
  readonly evidenceSummaryRelativePath: string
  readonly descriptorBasename: string
  readonly rotatedSecretMaterialPath?: string
}

interface SemanticEditMcpPredecessorHandoffV1
{
  readonly bytes: Uint8Array
  readonly sha256: string
  readonly manifest: AuditPredecessorHandoffManifestV1
}

function record(value: unknown): Record<string, unknown> | null
{
  return unknownRecord(value)
}

function boundedError(error: unknown): string
{
  const message = error instanceof Error ? error.message : String(error)
  return message.slice(0, 2048)
}

async function bounded<T>(
  label: string,
  durationMs: number,
  operation: Promise<T>
): Promise<T>
{
  let timeout: NodeJS.Timeout | undefined
  try
  {
    return await Promise.race([
      operation,
      new Promise<never>((_resolve, reject) =>
      {
        timeout = setTimeout(
          () => reject(new Error(`${label} exceeded ${durationMs} ms`)),
          durationMs
        )
      }),
    ])
  }
  finally
  {
    if (timeout) clearTimeout(timeout)
  }
}

function exactEditResult<N extends EditToolName>(
  name: N,
  value: unknown
): Extract<EditToolResultV1, { readonly tool: N }>
{
  const validated = validateSchemaValue(toolOutputSchemaModel(name), value)
  if (!validated.ok)
    throw new Error(`${name} returned a non-authoritative response envelope`)
  return value as Extract<EditToolResultV1, { readonly tool: N }>
}

function eventSha256(value: unknown): string | null
{
  const envelope = record(value)
  const data = record(envelope?.data)
  if (typeof data?.eventSha256 === 'string') return data.eventSha256
  const identity = record(data?.identity)
  const event = record(identity?.event)
  return typeof event?.eventSha256 === 'string' ? event.eventSha256 : null
}

function traceRecord(
  sequence: number,
  boundary: SemanticEditTraceRecordV1['boundary'],
  name: string,
  request: unknown,
  outcome: unknown,
  outcomeIsError = false
): SemanticEditTraceRecordV1
{
  const envelope = record(outcome)
  const audit = record(envelope?.audit)
  return Object.freeze({
    sequence,
    boundary,
    name,
    requestSha256: canonicalSha256(request),
    outcomeSha256: canonicalSha256(outcome),
    rawRequest: structuredClone(request),
    rawOutcome: structuredClone(outcome),
    outcomeIsError,
    callId: typeof audit?.callId === 'string' ? audit.callId : null,
    beginRecordSha256:
      typeof audit?.beginRecordSha256 === 'string'
        ? audit.beginRecordSha256
        : null,
    completeRecordSha256:
      typeof audit?.completeRecordSha256 === 'string'
        ? audit.completeRecordSha256
        : null,
    eventSha256: eventSha256(outcome),
    ok: envelope?.ok === true,
  })
}

function resultStructuredContent(value: unknown, name: string): unknown
{
  const result = record(value)
  if (!result || !('structuredContent' in result))
    throw new Error(`${name} returned no structured MCP content`)
  return result.structuredContent
}

function privateRelativePath(value: unknown, label: string): string
{
  if (
    typeof value !== 'string' ||
    value.length < 1 ||
    value.length > 512 ||
    isAbsolute(value) ||
    !/^[A-Za-z0-9][A-Za-z0-9._/-]*$/u.test(value) ||
    value.endsWith('/') ||
    value.split('/').some((part) => part === '.' || part === '..')
  )
    throw new Error(`${label} is not a normalized private relative path`)
  return value
}

function registryRows(value: unknown): readonly {
  readonly registrationRelativePath: string
  readonly retainedPolicyRelativePaths: readonly string[]
}[]
{
  const manifest = record(value)
  if (
    !manifest ||
    manifest.schemaVersion !== 1 ||
    manifest.kind !== 'production-edit-contract-registry-v1' ||
    !Array.isArray(manifest.registrations) ||
    manifest.registrations.length !== 2 ||
    JSON.stringify(Object.keys(manifest).sort()) !==
      JSON.stringify(['kind', 'registrations', 'schemaVersion'])
  )
    throw new Error('benchmark contract registry must contain exactly two rows')
  return Object.freeze(
    manifest.registrations.map((candidate, index) =>
    {
      const row = record(candidate)
      if (
        !row ||
        JSON.stringify(Object.keys(row).sort()) !==
          JSON.stringify([
            'registrationRelativePath',
            'retainedPolicyRelativePaths',
          ]) ||
        !Array.isArray(row.retainedPolicyRelativePaths) ||
        row.retainedPolicyRelativePaths.length < 3 ||
        row.retainedPolicyRelativePaths.length > 16
      )
        throw new Error(`contract registry row ${index} is invalid`)
      return Object.freeze({
        registrationRelativePath: privateRelativePath(
          row.registrationRelativePath,
          `contract registry row ${index} registration`
        ),
        retainedPolicyRelativePaths: Object.freeze(
          row.retainedPolicyRelativePaths.map((path, policyIndex) =>
            privateRelativePath(
              path,
              `contract registry row ${index} policy ${policyIndex}`
            )
          )
        ),
      })
    })
  )
}

function privateDestination(root: string, relativePath: string): string
{
  const resolvedRoot = resolve(root)
  const destination = resolve(resolvedRoot, relativePath)
  if (!destination.startsWith(`${resolvedRoot}${sep}`))
    throw new Error('bootstrap destination escapes the edit-private root')
  return destination
}

function generatedSecretMaterial(): Readonly<Record<string, unknown>>
{
  const secret = (): string => randomBytes(32).toString('base64url')
  const auditKeyId = `audit_${randomBytes(12).toString('hex')}`
  return Object.freeze({
    schemaVersion: 1,
    handle: secret(),
    paginationCursor: secret(),
    resourceCapability: secret(),
    resourceListingCursor: secret(),
    activeAuditKeyId: auditKeyId,
    auditKeys: Object.freeze([Object.freeze({ auditKeyId, secret: secret() })]),
    retiredAuditKeyIds: Object.freeze([]),
  })
}

function hostLimits(
  field: 'defaultValue' | 'hardMaximum'
): Readonly<Record<EditLimitKeyV1, number>>
{
  return Object.freeze(
    Object.fromEntries(
      Object.entries(PHASE_8_EDIT_LIMIT_AUTHORITY_V1).map(([key, value]) => [
        key,
        value[field],
      ])
    ) as Record<EditLimitKeyV1, number>
  )
}

export function prepareSemanticEditMcpHostV1(
  options: PrepareSemanticEditMcpHostOptionsV1
): PreparedSemanticEditMcpHostV1
{
  if (options.predecessorHandoffPath && !options.secretMaterialPath)
    throw new Error(
      'predecessor handoff requires the supplied retained secret material'
    )
  const manifestValue = readBoundedJsonV1(
    options.contractRegistryPath,
    'contract registry manifest'
  )
  const rows = registryRows(manifestValue)
  const sourceRoot = dirname(resolve(options.contractRegistryPath))
  const destinationManifestRelativePath = 'bootstrap/contract-registry.json'
  const registrationIdentities = new Map<string, string>()
  const registry = new EditChangeContractRegistryV1({
    hostDefaultLimits: hostLimits('defaultValue'),
    hostHardLimits: hostLimits('hardMaximum'),
  })
  const copied = new Set<string>()
  const contractRegistryArtifacts: {
    relativePath: string
    sha256: string
    byteLength: number
  }[] = []
  for (const [rowIndex, row] of rows.entries())
  {
    let registrationBytes: Uint8Array | null = null
    const policyBytes: Uint8Array[] = []
    for (const relativePath of [
      row.registrationRelativePath,
      ...row.retainedPolicyRelativePaths,
    ])
    {
      if (copied.has(relativePath))
        throw new Error('contract registry repeats a private artifact path')
      copied.add(relativePath)
      const source = resolve(sourceRoot, relativePath)
      if (!source.startsWith(`${sourceRoot}${sep}`))
        throw new Error('contract registry source artifact escapes its root')
      const bytes = readBoundedRegularFileV1(
        source,
        MAXIMUM_BOOTSTRAP_FILE_BYTES,
        `contract registry artifact ${relativePath}`
      )
      const destination = privateDestination(
        options.layout.editPrivateRoot,
        relativePath
      )
      ensurePrivateDirectory(dirname(destination))
      writeExclusive(destination, bytes)
      contractRegistryArtifacts.push({
        relativePath,
        sha256: sha256(bytes),
        byteLength: bytes.byteLength,
      })
      if (relativePath === row.registrationRelativePath)
      {
        registrationBytes = bytes
        const registration = record(
          readBoundedJsonV1(source, `contract registration ${rowIndex}`)
        )
        if (
          !registration ||
          typeof registration.registrationId !== 'string' ||
          typeof registration.semanticContractSha256 !== 'string'
        )
          throw new Error(`contract registration ${rowIndex} has no identity`)
        registrationIdentities.set(
          registration.registrationId,
          registration.semanticContractSha256
        )
      }
      else policyBytes.push(bytes)
    }
    if (registrationBytes === null)
      throw new Error(`contract registration ${rowIndex} is missing`)
    const registered = registry.registerBytes(registrationBytes, policyBytes)
    if (
      registrationIdentities.get(registered.registration.registrationId) !==
      registered.registration.semanticContractSha256
    )
      throw new Error(`contract registration ${rowIndex} identity changed`)
  }
  registry.seal()
  for (const contract of [options.behaviorContract, options.mediaContract])
    if (
      registrationIdentities.get(contract.registrationId) !==
      contract.semanticContractSha256
    )
      throw new Error(
        `bootstrap contract ${contract.registrationId} is absent or mismatched`
      )

  const destinationManifest = privateDestination(
    options.layout.editPrivateRoot,
    destinationManifestRelativePath
  )
  ensurePrivateDirectory(dirname(destinationManifest))
  writeJsonExclusive(destinationManifest, manifestValue)
  const manifestBytes = readBoundedRegularFileV1(
    destinationManifest,
    MAXIMUM_BOOTSTRAP_FILE_BYTES,
    'prepared contract registry manifest'
  )
  const contractRegistrySha256 = sha256(manifestBytes)
  contractRegistryArtifacts.push({
    relativePath: destinationManifestRelativePath,
    sha256: contractRegistrySha256,
    byteLength: manifestBytes.byteLength,
  })
  const contractRegistryArtifactSetSha256 =
    editContractRegistryArtifactSetSha256V1(contractRegistryArtifacts)

  const secretMaterialRelativePath = 'bootstrap/secret-material.json'
  const secretDestination = privateDestination(
    options.layout.editPrivateRoot,
    secretMaterialRelativePath
  )
  if (options.secretMaterialPath)
  {
    const secretBytes = readBoundedRegularFileV1(
      options.secretMaterialPath,
      MAXIMUM_BOOTSTRAP_FILE_BYTES,
      'edit host secret material'
    )
    parseEditMcpSecretMaterialV1(secretBytes)
    writeExclusive(secretDestination, secretBytes)
  }
  else
  {
    const material = generatedSecretMaterial()
    parseEditMcpSecretMaterialV1(
      new TextEncoder().encode(JSON.stringify(material))
    )
    writeJsonExclusive(secretDestination, material)
  }
  const secretMaterialSha256 = sha256(
    readBoundedRegularFileV1(
      secretDestination,
      MAXIMUM_BOOTSTRAP_FILE_BYTES,
      'prepared edit host secret material'
    )
  )

  const predecessorManifestRelativePath = options.predecessorHandoffPath
    ? 'predecessor/manifest.json'
    : null
  let predecessorHandoffSha256: string | null = null
  if (options.predecessorHandoffPath)
  {
    if (predecessorManifestRelativePath === null)
      throw new Error('predecessor manifest path invariant failed')
    const predecessorBytes = readBoundedRegularFileV1(
      options.predecessorHandoffPath,
      MAXIMUM_BOOTSTRAP_FILE_BYTES,
      'predecessor handoff'
    )
    parseAuditPredecessorHandoffManifestV1(predecessorBytes)
    const predecessorDestination = privateDestination(
      options.layout.editPrivateRoot,
      predecessorManifestRelativePath
    )
    ensurePrivateDirectory(dirname(predecessorDestination))
    writeExclusive(predecessorDestination, predecessorBytes)
    predecessorHandoffSha256 = sha256(predecessorBytes)
  }

  const descriptor = parseSemanticEditHostBootstrapDescriptorV1({
    schemaVersion: 1,
    kind: 'production-stdio-edit-host-v1',
    principalSha256: options.principalSha256,
    pinnedScratchRuntimeSourceSha256: options.pinnedScratchRuntimeSourceSha256,
    authoritativeBuildManifestSha256: options.authoritativeBuildManifestSha256,
    behaviorContract: options.behaviorContract,
    mediaContract: options.mediaContract,
    contractRegistryRelativePath: destinationManifestRelativePath,
    secretMaterialRelativePath,
    evidenceSummaryRelativePath: options.evidenceSummaryRelativePath,
    predecessorManifestRelativePath,
    ...(options.operatorFixture
      ? { operatorFixture: options.operatorFixture }
      : {}),
  })
  const descriptorPath = join(options.layout.configRoot, 'host-bootstrap.json')
  writeJsonExclusive(descriptorPath, descriptor)
  const descriptorSha256 = sha256(
    readBoundedRegularFileV1(
      descriptorPath,
      MAXIMUM_BOOTSTRAP_FILE_BYTES,
      'prepared edit host descriptor'
    )
  )
  return Object.freeze({
    descriptorPath,
    descriptor,
    descriptorSha256,
    descriptorCanonicalSha256: canonicalSha256(descriptor),
    contractRegistrySha256,
    contractRegistryArtifactSetSha256,
    secretMaterialSha256,
    predecessorHandoffSha256,
    generatedSecretMaterial: options.secretMaterialPath === undefined,
  })
}

function parsePreparedJsonBytesV1(bytes: Uint8Array, label: string): unknown
{
  try
  {
    return JSON.parse(
      new TextDecoder('utf-8', { fatal: true }).decode(bytes)
    ) as unknown
  }
  catch
  {
    throw new Error(`${label} is not exact UTF-8 JSON`)
  }
}

interface RetainedAuditKeyIdentityV1
{
  readonly auditKeyId: string
  readonly secretSha256: string
}

function retainedAuditKeyIdentitiesV1(
  secretBytes: Uint8Array
): readonly RetainedAuditKeyIdentityV1[]
{
  const secretMaterial = record(
    parsePreparedJsonBytesV1(secretBytes, 'prepared edit host secret material')
  )
  if (!secretMaterial || !Array.isArray(secretMaterial.auditKeys))
    throw new Error('prepared edit host has no retained audit key set')
  return Object.freeze(
    secretMaterial.auditKeys.map((candidate, index) =>
    {
      const key = record(candidate)
      if (
        !key ||
        typeof key.auditKeyId !== 'string' ||
        typeof key.secret !== 'string'
      )
        throw new Error(`prepared audit key ${index} is malformed`)
      return Object.freeze({
        auditKeyId: key.auditKeyId,
        secretSha256: sha256(Buffer.from(key.secret, 'base64url')),
      })
    })
  )
}

function inspectPreparedSemanticEditMcpHostV1(
  layout: SemanticEditRunLayoutV1,
  host: PreparedSemanticEditMcpHostV1
): {
  readonly evidence: PreparedSemanticEditMcpHostEvidenceV1
  readonly secrets: ReturnType<typeof parseEditMcpSecretMaterialV1>
  readonly auditKeyIdentities: readonly RetainedAuditKeyIdentityV1[]
}
{
  const descriptorBytes = readBoundedRegularFileV1(
    host.descriptorPath,
    MAXIMUM_BOOTSTRAP_FILE_BYTES,
    'prepared edit host descriptor'
  )
  const descriptor = parseSemanticEditHostBootstrapDescriptorV1(
    parsePreparedJsonBytesV1(descriptorBytes, 'prepared edit host descriptor')
  )
  const descriptorSha256 = sha256(descriptorBytes)
  const descriptorCanonicalSha256 = canonicalSha256(descriptor)
  if (
    descriptorSha256 !== host.descriptorSha256 ||
    descriptorCanonicalSha256 !== host.descriptorCanonicalSha256 ||
    descriptorCanonicalSha256 !== canonicalSha256(host.descriptor)
  )
    throw new Error('prepared edit host descriptor changed')

  const contractRegistryPath = privateDestination(
    layout.editPrivateRoot,
    descriptor.contractRegistryRelativePath
  )
  const contractRegistryBytes = readBoundedRegularFileV1(
    contractRegistryPath,
    MAXIMUM_BOOTSTRAP_FILE_BYTES,
    'prepared contract registry manifest'
  )
  const rows = registryRows(
    parsePreparedJsonBytesV1(
      contractRegistryBytes,
      'prepared contract registry manifest'
    )
  )
  const contractRegistrySha256 = sha256(contractRegistryBytes)
  if (contractRegistrySha256 !== host.contractRegistrySha256)
    throw new Error('prepared contract registry manifest changed')
  const contractRegistryArtifacts = [
    {
      relativePath: descriptor.contractRegistryRelativePath,
      sha256: contractRegistrySha256,
      byteLength: contractRegistryBytes.byteLength,
    },
  ]
  for (const row of rows)
    for (const relativePath of [
      row.registrationRelativePath,
      ...row.retainedPolicyRelativePaths,
    ])
    {
      const bytes = readBoundedRegularFileV1(
        privateDestination(layout.editPrivateRoot, relativePath),
        MAXIMUM_BOOTSTRAP_FILE_BYTES,
        `prepared contract registry artifact ${relativePath}`
      )
      contractRegistryArtifacts.push({
        relativePath,
        sha256: sha256(bytes),
        byteLength: bytes.byteLength,
      })
    }
  const contractRegistryArtifactSetSha256 =
    editContractRegistryArtifactSetSha256V1(contractRegistryArtifacts)
  if (
    contractRegistryArtifactSetSha256 !== host.contractRegistryArtifactSetSha256
  )
    throw new Error('prepared contract registry artifact set changed')

  const secretPath = privateDestination(
    layout.editPrivateRoot,
    descriptor.secretMaterialRelativePath
  )
  const secretBytes = readBoundedRegularFileV1(
    secretPath,
    MAXIMUM_BOOTSTRAP_FILE_BYTES,
    'prepared edit host secret material'
  )
  const secrets = parseEditMcpSecretMaterialV1(secretBytes)
  const auditKeyIdentities = retainedAuditKeyIdentitiesV1(secretBytes)
  const secretMaterialSha256 = sha256(secretBytes)
  if (secretMaterialSha256 !== host.secretMaterialSha256)
    throw new Error('prepared edit host secret material changed')

  let predecessorHandoffSha256: string | null = null
  if (descriptor.predecessorManifestRelativePath !== null)
  {
    const predecessorBytes = readBoundedRegularFileV1(
      privateDestination(
        layout.editPrivateRoot,
        descriptor.predecessorManifestRelativePath
      ),
      MAXIMUM_BOOTSTRAP_FILE_BYTES,
      'prepared predecessor handoff'
    )
    parseAuditPredecessorHandoffManifestV1(predecessorBytes)
    predecessorHandoffSha256 = sha256(predecessorBytes)
  }
  if (predecessorHandoffSha256 !== host.predecessorHandoffSha256)
    throw new Error('prepared predecessor handoff changed')

  return Object.freeze({
    evidence: Object.freeze({
      descriptorSha256,
      descriptorCanonicalSha256,
      contractRegistrySha256,
      contractRegistryArtifactSetSha256,
      secretMaterialSha256,
      predecessorHandoffSha256,
    }),
    secrets,
    auditKeyIdentities,
  })
}

// recheck every immutable bootstrap artifact as one authority snapshot
export function recheckPreparedSemanticEditMcpHostV1(
  layout: SemanticEditRunLayoutV1,
  host: PreparedSemanticEditMcpHostV1
): PreparedSemanticEditMcpHostEvidenceV1
{
  return inspectPreparedSemanticEditMcpHostV1(layout, host).evidence
}

function exactPredecessorHandoff(
  bytes: Uint8Array
): SemanticEditMcpPredecessorHandoffV1
{
  if (bytes.byteLength > MAXIMUM_BOOTSTRAP_FILE_BYTES)
    throw new Error('predecessor handoff exceeds its byte limit')
  return Object.freeze({
    bytes: Uint8Array.from(bytes),
    sha256: sha256(bytes),
    manifest: parseAuditPredecessorHandoffManifestV1(bytes),
  })
}

export async function createSemanticEditMcpPredecessorHandoffV1(input: {
  readonly layout: SemanticEditRunLayoutV1
  readonly predecessorHost: PreparedSemanticEditMcpHostV1
  readonly storeKey: string
}): Promise<SemanticEditMcpPredecessorHandoffV1>
{
  const prepared = inspectPreparedSemanticEditMcpHostV1(
    input.layout,
    input.predecessorHost
  )
  return exactPredecessorHandoff(
    await createAuditPredecessorHandoffManifestV1({
      serverRoot: input.layout.editPrivateRoot,
      storeKey: input.storeKey,
      keys: prepared.secrets.auditKeys,
    })
  )
}

export async function recoverSemanticEditMcpPredecessorHandoffV1(input: {
  readonly layout: SemanticEditRunLayoutV1
  readonly predecessorHost: PreparedSemanticEditMcpHostV1
}): Promise<SemanticEditMcpPredecessorHandoffV1>
{
  const prepared = inspectPreparedSemanticEditMcpHostV1(
    input.layout,
    input.predecessorHost
  )
  return exactPredecessorHandoff(
    await recoverProductionEditAuditPredecessorHandoffV1({
      inputRoot: input.layout.inputRoot,
      assetInputRoot: input.layout.assetInputRoot,
      privateRoot: input.layout.editPrivateRoot,
      artifactStoreRoot: join(
        input.layout.readableArtifactRoot,
        'edit-artifacts'
      ),
      readableArtifactRoot: input.layout.readableArtifactRoot,
      outputRoot: input.layout.outputRoot,
      descriptor: input.predecessorHost.descriptor,
      descriptorFileSha256: input.predecessorHost.descriptorSha256,
      descriptorCanonicalSha256:
        input.predecessorHost.descriptorCanonicalSha256,
      contractRegistrySha256: prepared.evidence.contractRegistrySha256,
      contractRegistryArtifactSetSha256:
        prepared.evidence.contractRegistryArtifactSetSha256,
      secretMaterialSha256: prepared.evidence.secretMaterialSha256,
      predecessorHandoffSha256: prepared.evidence.predecessorHandoffSha256,
      secrets: prepared.secrets,
      invocation: {
        boundaryKind: 'directHost',
        invocationSha256: sha256(
          canonicalJsonBytesV1({
            schemaVersion: 1,
            kind: 'exclusive-edit-recovery-v1',
            predecessorDescriptorFileSha256:
              input.predecessorHost.descriptorSha256,
            predecessorDescriptorCanonicalSha256:
              input.predecessorHost.descriptorCanonicalSha256,
          })
        ),
        principalSha256: input.predecessorHost.descriptor.principalSha256,
      },
      ...(input.predecessorHost.descriptor.operatorFixture?.auditLimits
        ? {
            auditLimits:
              input.predecessorHost.descriptor.operatorFixture.auditLimits,
          }
        : {}),
    })
  )
}

export async function prepareSemanticEditMcpSuccessorHostV1(
  options: PrepareSemanticEditMcpSuccessorHostOptionsV1
): Promise<PreparedSemanticEditMcpHostV1>
{
  const predecessorPrepared = inspectPreparedSemanticEditMcpHostV1(
    options.layout,
    options.predecessorHost
  )
  if (options.predecessorHandoffBytes.byteLength === 0)
    throw new Error('successor predecessor handoff must not be empty')
  if (options.predecessorHandoffBytes.byteLength > MAXIMUM_BOOTSTRAP_FILE_BYTES)
    throw new Error('successor predecessor handoff exceeds its byte limit')
  parseAuditPredecessorHandoffManifestV1(options.predecessorHandoffBytes)
  if (
    options.evidenceSummaryRelativePath ===
    options.predecessorHost.descriptor.evidenceSummaryRelativePath
  )
    throw new Error('successor evidence must use a new no-replace path')
  const descriptorBasename = privateRelativePath(
    options.descriptorBasename,
    'successor descriptor basename'
  )
  if (descriptorBasename.includes('/'))
    throw new Error('successor descriptor basename must be one filename')
  const predecessorManifestRelativePath = privateRelativePath(
    `predecessor/${descriptorBasename}.manifest.json`,
    'successor predecessor manifest path'
  )
  const predecessorDestination = privateDestination(
    options.layout.editPrivateRoot,
    predecessorManifestRelativePath
  )
  const predecessorHandoffSha256 = sha256(options.predecessorHandoffBytes)
  const predecessor = options.predecessorHost.descriptor
  let secretMaterialRelativePath = predecessor.secretMaterialRelativePath
  let secretMaterialSha256 = options.predecessorHost.secretMaterialSha256
  let generatedSecretMaterial = options.predecessorHost.generatedSecretMaterial
  let rotatedSecretMaterial: Readonly<{
    bytes: Uint8Array
    destination: string
  }> | null = null
  if (options.rotatedSecretMaterialPath)
  {
    const rotatedBytes = readBoundedRegularFileV1(
      options.rotatedSecretMaterialPath,
      MAXIMUM_BOOTSTRAP_FILE_BYTES,
      'rotated edit host secret material'
    )
    const rotated = parseEditMcpSecretMaterialV1(rotatedBytes)
    for (const [label, before, after] of [
      [
        'handle',
        predecessorPrepared.secrets.handleSecret,
        rotated.handleSecret,
      ],
      [
        'pagination cursor',
        predecessorPrepared.secrets.paginationCursorSecret,
        rotated.paginationCursorSecret,
      ],
      [
        'resource capability',
        predecessorPrepared.secrets.resourceCapabilitySecret,
        rotated.resourceCapabilitySecret,
      ],
      [
        'resource listing cursor',
        predecessorPrepared.secrets.resourceListingCursorSecret,
        rotated.resourceListingCursorSecret,
      ],
    ] as const)
      if (!Buffer.from(before).equals(Buffer.from(after)))
        throw new Error(`rotated ${label} secret changed purpose authority`)
    const oldActiveKeyId = predecessorPrepared.secrets.activeAuditKeyId
    if (rotated.activeAuditKeyId === oldActiveKeyId)
      throw new Error('rotated audit material did not select a new active key')
    const [oldActive, retainedOld, newActive] = await Promise.all([
      predecessorPrepared.secrets.auditKeys.verificationKey(oldActiveKeyId),
      rotated.auditKeys.verificationKey(oldActiveKeyId),
      rotated.auditKeys.activeKey(),
    ])
    if (
      retainedOld.auditKeyId !== oldActive.auditKeyId ||
      !Buffer.from(retainedOld.secret).equals(Buffer.from(oldActive.secret))
    )
      throw new Error('rotated audit material changed the old verification key')
    const newActiveSecretSha256 = sha256(newActive.secret)
    if (
      predecessorPrepared.auditKeyIdentities.some(
        (key) =>
          key.auditKeyId === newActive.auditKeyId ||
          key.secretSha256 === newActiveSecretSha256
      )
    )
      throw new Error('rotated audit material reused a predecessor key')
    if (
      newActive.auditKeyId !== rotated.activeAuditKeyId ||
      Buffer.from(newActive.secret).equals(Buffer.from(oldActive.secret))
    )
      throw new Error('rotated audit material did not install a distinct key')
    secretMaterialRelativePath = privateRelativePath(
      `successors/${descriptorBasename}.secret-material.json`,
      'successor rotated secret material path'
    )
    const destination = privateDestination(
      options.layout.editPrivateRoot,
      secretMaterialRelativePath
    )
    secretMaterialSha256 = sha256(rotatedBytes)
    generatedSecretMaterial = false
    rotatedSecretMaterial = Object.freeze({
      bytes: rotatedBytes,
      destination,
    })
  }
  const descriptor = parseSemanticEditHostBootstrapDescriptorV1({
    ...predecessor,
    evidenceSummaryRelativePath: options.evidenceSummaryRelativePath,
    predecessorManifestRelativePath,
    secretMaterialRelativePath,
  })
  const descriptorPath = join(
    options.layout.configRoot,
    `${descriptorBasename}.json`
  )
  const destinations = [
    { label: 'successor predecessor handoff', path: predecessorDestination },
    { label: 'successor descriptor', path: descriptorPath },
    ...(rotatedSecretMaterial === null
      ? []
      : [
          {
            label: 'successor rotated secret material',
            path: rotatedSecretMaterial.destination,
          },
        ]),
  ]
  if (
    new Set(destinations.map((destination) => destination.path)).size !==
    destinations.length
  )
    throw new Error('successor preparation destinations overlap')
  for (const destination of destinations)
    if (lstatSync(destination.path, { throwIfNoEntry: false }) !== undefined)
      throw new Error(`${destination.label} destination already exists`)
  if (rotatedSecretMaterial !== null)
    ensurePrivateDirectory(dirname(rotatedSecretMaterial.destination))
  ensurePrivateDirectory(dirname(predecessorDestination))
  ensurePrivateDirectory(dirname(descriptorPath))
  if (rotatedSecretMaterial !== null)
  {
    writeExclusive(
      rotatedSecretMaterial.destination,
      rotatedSecretMaterial.bytes
    )
  }
  writeExclusive(predecessorDestination, options.predecessorHandoffBytes)
  writeJsonExclusive(descriptorPath, descriptor)
  const descriptorSha256 = sha256(
    readBoundedRegularFileV1(
      descriptorPath,
      MAXIMUM_BOOTSTRAP_FILE_BYTES,
      'prepared successor edit host descriptor'
    )
  )
  const successor = Object.freeze({
    descriptorPath,
    descriptor,
    descriptorSha256,
    descriptorCanonicalSha256: canonicalSha256(descriptor),
    contractRegistrySha256: options.predecessorHost.contractRegistrySha256,
    contractRegistryArtifactSetSha256:
      options.predecessorHost.contractRegistryArtifactSetSha256,
    secretMaterialSha256,
    predecessorHandoffSha256,
    generatedSecretMaterial,
  })
  recheckPreparedSemanticEditMcpHostV1(options.layout, successor)
  return successor
}

export function createSemanticEditMcpDriverV1(
  options: SemanticEditMcpDriverOptionsV1
): SemanticEditMcpDriverV1
{
  const repositoryRoot = resolve(options.repositoryRoot)
  const serverPath = resolve(
    options.serverPath ?? join(repositoryRoot, 'packages/mcp/dist/transport/server.js')
  )
  if (!existsSync(serverPath))
    throw new Error(`authoritative MCP server is missing: ${serverPath}`)
  if (
    !isAbsolute(options.hostBootstrapPath) ||
    !existsSync(options.hostBootstrapPath)
  )
    throw new Error('edit host bootstrap must be an existing absolute path')
  if (
    resolve(options.hostBootstrapPath) !==
    resolve(options.preparedHost.descriptorPath)
  )
    throw new Error(
      'edit host bootstrap path differs from its prepared authority'
    )
  if (
    !Number.isSafeInteger(options.maximumCallDurationMs) ||
    options.maximumCallDurationMs < 1_000 ||
    options.maximumCallDurationMs > 10 * 60 * 1000
  )
    throw new Error('MCP call timeout is outside its bounded range')

  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [serverPath],
    cwd: repositoryRoot,
    env: {
      ...getDefaultEnvironment(),
      SCRATCH_AGENT_MCP_PROFILE: 'project-edit',
      SCRATCH_AGENT_INPUT_ROOT: options.layout.inputRoot,
      SCRATCH_AGENT_ASSET_INPUT_ROOT: options.layout.assetInputRoot,
      SCRATCH_AGENT_OUTPUT_ROOT: options.layout.outputRoot,
      SCRATCH_AGENT_EDIT_PRIVATE_ROOT: options.layout.editPrivateRoot,
      SCRATCH_AGENT_READABLE_ARTIFACT_ROOT: options.layout.readableArtifactRoot,
      SCRATCH_AGENT_EDIT_HOST_CONFIG: options.hostBootstrapPath,
      SCRATCH_AGENT_EDIT_EXPECTED_DESCRIPTOR_SHA256:
        options.preparedHost.descriptorSha256,
      SCRATCH_AGENT_EDIT_EXPECTED_DESCRIPTOR_CANONICAL_SHA256:
        options.preparedHost.descriptorCanonicalSha256,
      SCRATCH_AGENT_EDIT_EXPECTED_CONTRACT_REGISTRY_SHA256:
        options.preparedHost.contractRegistrySha256,
      SCRATCH_AGENT_EDIT_EXPECTED_CONTRACT_REGISTRY_ARTIFACT_SET_SHA256:
        options.preparedHost.contractRegistryArtifactSetSha256,
      SCRATCH_AGENT_EDIT_EXPECTED_SECRET_MATERIAL_SHA256:
        options.preparedHost.secretMaterialSha256,
      SCRATCH_AGENT_EDIT_EXPECTED_PREDECESSOR_HANDOFF_SHA256:
        options.preparedHost.predecessorHandoffSha256 ?? 'absent',
    },
    stderr: 'pipe',
  })
  let stderr = Buffer.alloc(0)
  let observedStderrBytes = 0
  let stderrTruncated = false
  transport.stderr?.on('data', (chunk: Buffer) =>
  {
    const bytes = Buffer.from(chunk)
    observedStderrBytes += bytes.byteLength
    const remaining = MAXIMUM_STDERR_BYTES - stderr.byteLength
    if (remaining > 0)
      stderr = Buffer.concat([stderr, bytes.subarray(0, remaining)])
    if (bytes.byteLength > remaining) stderrTruncated = true
  })
  let transportClosed = false
  let childProcess: ChildProcess | null = null
  let childPid: number | null = null
  let childExitCode: number | null = null
  let childSignal: NodeJS.Signals | null = null
  let clientCloseRequested = false
  let forcedCrashRequested = false
  const transportErrors: string[] = []
  transport.onclose = () =>
  {
    transportClosed = true
  }
  transport.onerror = (error) =>
  {
    if (transportErrors.length < 16) transportErrors.push(boundedError(error))
  }
  const client = new Client({
    name: 'semantic-edit-authoritative-driver',
    version: '1',
  })
  const callTool = (name: string, request: Readonly<Record<string, unknown>>) =>
    client.callTool({ name, arguments: request }, undefined, {
      timeout: options.maximumCallDurationMs,
      maxTotalTimeout: options.maximumCallDurationMs,
    })
  const records: SemanticEditTraceRecordV1[] = []
  let connected = false
  let closed = false
  let nextSequence = 1

  const nextRecord = (
    boundary: SemanticEditTraceRecordV1['boundary'],
    name: string,
    request: unknown,
    outcome: unknown,
    outcomeIsError = false
  ): SemanticEditTraceRecordV1 =>
  {
    const entry = traceRecord(
      nextSequence++,
      boundary,
      name,
      request,
      outcome,
      outcomeIsError
    )
    records.push(entry)
    return entry
  }

  const errorOutcome = (error: unknown): Readonly<Record<string, unknown>> =>
    Object.freeze({
      state: 'threw',
      name: error instanceof Error ? error.name : 'UnknownError',
      message: boundedError(error),
    })

  const observeSpawnedProcess = (): void =>
  {
    if (childProcess !== null) return
    const candidate = Reflect.get(
      transport as unknown as object,
      '_process'
    ) as unknown
    if (
      candidate === null ||
      typeof candidate !== 'object' ||
      typeof (candidate as ChildProcess).once !== 'function' ||
      typeof (candidate as ChildProcess).pid !== 'number'
    )
      throw new Error(
        'pinned MCP stdio transport did not expose its spawned process for bounded observation'
      )
    childProcess = candidate as ChildProcess
    childPid = childProcess.pid ?? null
    childProcess.once('close', (code, signal) =>
    {
      childExitCode = code
      childSignal = signal
      transportClosed = true
    })
  }

  return Object.freeze({
    serverPath,
    stderr: () => stderr.toString('utf8'),
    stderrEvidence: () =>
      Object.freeze({
        observedByteLength: observedStderrBytes,
        retainedByteLength: stderr.byteLength,
        retainedSha256: sha256(stderr),
        truncated: stderrTruncated,
      }),
    processObservation: () =>
      Object.freeze({
        spawned: childProcess !== null,
        pid: childPid,
        closeObserved: transportClosed,
        exitCode: childExitCode,
        signal: childSignal,
        clientCloseRequested,
        forcedCrashRequested,
        transportErrors: Object.freeze([...transportErrors]),
      }),
    trace: () => Object.freeze([...records]),
    connect: async () =>
    {
      if (connected) return
      if (closed) throw new Error('semantic-edit MCP driver is closed')
      try
      {
        recheckPreparedSemanticEditMcpHostV1(
          options.layout,
          options.preparedHost
        )
        const connection = client.connect(transport)
        observeSpawnedProcess()
        await bounded(
          'MCP stdio connection',
          options.maximumCallDurationMs,
          connection
        )
        connected = true
      }
      catch (error)
      {
        throw new Error(
          `semantic-edit-stdio-bootstrap-unavailable: ${boundedError(error)}; ` +
            `the project-edit server must consume ${options.hostBootstrapPath} ` +
            'and inject its production edit host plus durable server audit'
        )
      }
    },
    close: async () =>
    {
      if (closed) return
      clientCloseRequested = true
      closed = true
      await client.close()
    },
    crashForRecoveryProbe: async () =>
    {
      if (closed) return
      const pid = transport.pid
      if (!connected || pid === null)
        throw new Error('semantic-edit MCP process is not connected')
      forcedCrashRequested = true
      closed = true
      process.kill(pid, 'SIGKILL')
      await bounded(
        'MCP forced termination',
        5_000,
        new Promise<void>((resolveTermination) =>
        {
          const poll = (): void =>
          {
            try
            {
              process.kill(pid, 0)
              setTimeout(poll, 10)
            }
            catch
            {
              resolveTermination()
            }
          }
          poll()
        })
      )
    },
    assertExactToolProfile: async () =>
    {
      const request = Object.freeze({ method: 'tools/list' })
      try
      {
        const listed = await bounded(
          'MCP tools/list',
          options.maximumCallDurationMs,
          client.listTools()
        )
        const actual = listed.tools.map((tool) => tool.name)
        if (
          JSON.stringify(actual) !==
          JSON.stringify(SEMANTIC_EDIT_TOOL_ALLOWLIST)
        )
          throw new Error(
            `project-edit tool profile mismatch: ${JSON.stringify(actual)}`
          )
        const measurement = measureToolProfileV1(listed.tools)
        if (
          measurement.serializedBytes > measurement.maximumSerializedBytes ||
          measurement.aggregateDescriptionBytes >
            measurement.maximumAggregateDescriptionBytes
        )
          throw new Error('project-edit tools/list exceeds its production caps')
        const evidence = Object.freeze({
          names: Object.freeze(actual),
          profileSha256: canonicalSha256({
            schemaVersion: 1,
            toolOrder: actual,
          }),
          measurement,
        })
        nextRecord('protocol', 'tools/list', request, evidence)
        return evidence
      }
      catch (error)
      {
        nextRecord('protocol', 'tools/list', request, errorOutcome(error), true)
        throw error
      }
    },
    callProject: async (
      name:
        'project_open' | 'project_inspect' | 'project_run' | 'project_status',
      request: Readonly<Record<string, unknown>>
    ) =>
    {
      try
      {
        const raw = await bounded(
          name,
          options.maximumCallDurationMs,
          callTool(name, request)
        )
        const result = resultStructuredContent(raw, name)
        return Object.freeze({
          result,
          trace: nextRecord(
            'tool',
            name,
            request,
            result,
            raw.isError === true
          ),
        })
      }
      catch (error)
      {
        nextRecord('tool', name, request, errorOutcome(error), true)
        throw error
      }
    },
    callEdit: async <N extends EditToolName>(
      name: N,
      request: EditRequestByNameV1[N]
    ): Promise<SemanticEditToolCallResultV1<N>> =>
    {
      if (!(EDIT_TOOL_NAMES as readonly string[]).includes(name))
        throw new Error(`unapproved edit tool: ${name}`)
      const parsed = parseEditToolInputV1(name, request)
      if (!parsed.ok)
        throw new Error(`${name} request does not match its frozen schema`)
      try
      {
        const raw = await bounded(
          name,
          options.maximumCallDurationMs,
          callTool(name, parsed.value as Record<string, unknown>)
        )
        const result = exactEditResult(name, resultStructuredContent(raw, name))
        return Object.freeze({
          result,
          trace: nextRecord(
            'tool',
            name,
            parsed.value,
            result,
            raw.isError === true
          ),
        })
      }
      catch (error)
      {
        nextRecord('tool', name, parsed.value, errorOutcome(error), true)
        throw error
      }
    },
    callEditWithLostResponse: async <N extends EditToolName>(
      name: N,
      request: EditRequestByNameV1[N]
    ): Promise<SemanticEditLostResponseV1<N>> =>
    {
      if (!(EDIT_TOOL_NAMES as readonly string[]).includes(name))
        throw new Error(`unapproved lost-response edit tool: ${name}`)
      const parsed = parseEditToolInputV1(name, request)
      if (!parsed.ok)
        throw new Error(
          `${name} lost-response request does not match its frozen schema`
        )
      const originalOnMessage = transport.onmessage
      if (!connected || closed || originalOnMessage === undefined)
        throw new Error('lost-response injection requires a connected driver')
      let releaseResponse: ((message: unknown) => void) | undefined
      const response = new Promise<unknown>((resolveResponse) =>
      {
        releaseResponse = resolveResponse
      })
      transport.onmessage = (message) =>
      {
        const envelope = record(message)
        if (
          envelope?.jsonrpc === '2.0' &&
          (Object.hasOwn(envelope, 'result') ||
            Object.hasOwn(envelope, 'error'))
        )
        {
          transport.onmessage = originalOnMessage
          releaseResponse?.(message)
          return
        }
        originalOnMessage(message)
      }
      const pending = callTool(name, parsed.value as Record<string, unknown>)
      void pending.catch(() => undefined)
      let wireResponse: unknown
      try
      {
        wireResponse = await bounded(
          `${name} intentionally lost response`,
          options.maximumCallDurationMs,
          response
        )
      }
      finally
      {
        transport.onmessage = originalOnMessage
      }
      const envelope = record(wireResponse)
      if (!envelope || !Object.hasOwn(envelope, 'result'))
        throw new Error(`${name} lost-response injection observed an error`)
      const rawResult = envelope.result
      const result = exactEditResult(
        name,
        resultStructuredContent(rawResult, name)
      )
      return Object.freeze({
        tool: name,
        request: structuredClone(request),
        result,
        interceptedTrace: traceRecord(
          nextSequence++,
          'tool',
          name,
          parsed.value,
          result,
          false
        ),
        wireResponseSha256: canonicalSha256(wireResponse),
      })
    },
    callEditBoundaryProbe: async <N extends EditToolName>(
      name: N,
      request: EditRequestByNameV1[N]
    ) =>
    {
      const parsed = parseEditToolInputV1(name, request)
      if (!parsed.ok)
        throw new Error(
          `${name} boundary probe request is not frozen-schema valid`
        )
      try
      {
        const raw = await bounded(
          `${name} boundary probe`,
          options.maximumCallDurationMs,
          callTool(name, parsed.value as Record<string, unknown>)
        )
        const result = resultStructuredContent(raw, name)
        nextRecord('tool', name, parsed.value, result, raw.isError === true)
        return Object.freeze({ state: 'returned' as const, result })
      }
      catch (error)
      {
        const data = record((error as { readonly data?: unknown }).data)
        const code = typeof data?.code === 'string' ? data.code : 'mcp.internal'
        nextRecord(
          'protocol',
          'protocol/admission-refused',
          { tool: name, arguments: parsed.value },
          { state: 'protocol-refusal', code }
        )
        return Object.freeze({ state: 'protocol-refusal' as const, code })
      }
    },
    listResources: async (cursor?: string) =>
    {
      const request = cursor === undefined ? null : { cursor }
      try
      {
        const result = await bounded(
          'MCP resources/list',
          options.maximumCallDurationMs,
          client.listResources(cursor === undefined ? undefined : { cursor })
        )
        nextRecord('resource-list', 'resources/list', request, result)
        return result
      }
      catch (error)
      {
        nextRecord(
          'resource-list',
          'resources/list',
          request,
          errorOutcome(error),
          true
        )
        throw error
      }
    },
    readResource: async (uri: string) =>
    {
      const request = Object.freeze({ uri })
      try
      {
        const result = await bounded(
          'MCP resources/read',
          options.maximumCallDurationMs,
          client.readResource({ uri })
        )
        nextRecord('resource-read', 'resources/read', request, result)
        return result
      }
      catch (error)
      {
        nextRecord(
          'resource-read',
          'resources/read',
          request,
          errorOutcome(error),
          true
        )
        throw error
      }
    },
  })
}
