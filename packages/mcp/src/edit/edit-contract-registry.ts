// packages/mcp/src/edit/edit-contract-registry.ts
// load bounded trusted change-contract registrations from the private root

import { LOWERCASE_SHA256_PATTERN } from '../internal/sha256-pattern.js'
import { hasExactObjectKeysV1 } from '../internal/exact-object-keys.js'

import { createHash } from 'node:crypto'
import { resolve, sep } from 'node:path'

import {
  CHANGE_CONTRACT_REGISTRATION_LIMITS_V1,
  EditChangeContractRegistryV1,
  PHASE_8_EDIT_LIMIT_AUTHORITY_V1,
  PHASE_8_RESOURCE_POLICY_CATALOG,
  type EditLimitKeyV1,
} from '@scratch-agent/edit'
import { scanStrictJson } from '@scratch-agent/sb3'
import { canonicalJsonBytesV1 } from '@scratch-agent/sb3/canonical-json'

import { McpBoundaryError } from '../transport/errors.js'

const RELATIVE_PATH = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,511}$/u
const MAX_REGISTRATIONS = 32
const MAX_POLICIES_PER_REGISTRATION = 64
const MAX_REGISTRY_MANIFEST_BYTES = 256 * 1024
const MAX_REGISTRATION_BYTES =
  CHANGE_CONTRACT_REGISTRATION_LIMITS_V1.registrationBytes.defaultValue
const MAX_POLICY_BYTES =
  PHASE_8_RESOURCE_POLICY_CATALOG.retainedPolicyArtifactBytes.defaultValue
const MAX_POLICY_BYTES_PER_REGISTRATION =
  PHASE_8_RESOURCE_POLICY_CATALOG.retainedPolicyArtifactBytesPerContract
    .defaultValue

export interface EditPrivateReadPortV1
{
  read(absolutePath: string): Promise<{
    readonly bytes: Uint8Array
    readonly sha256: string
    readonly byteLength: number
    readonly evidence: { readonly hostEvidenceSha256: string }
  }>
}

export interface LoadedEditContractRegistryV1
{
  readonly registry: EditChangeContractRegistryV1
  readonly manifestSha256: string
  readonly manifestEvidenceSha256: string
  readonly artifactSetSha256: string
  readonly registrations: readonly {
    readonly registrationId: string
    readonly semanticContractSha256: string
    readonly retainedPolicyCount: number
  }[]
}

export interface EditContractRegistryArtifactIdentityV1
{
  readonly relativePath: string
  readonly sha256: string
  readonly byteLength: number
}

export function editContractRegistryArtifactSetSha256V1(
  artifacts: readonly EditContractRegistryArtifactIdentityV1[]
): string
{
  const paths = new Set<string>()
  const exact = [...artifacts]
    .map((artifact) =>
    {
      if (
        !RELATIVE_PATH.test(artifact.relativePath) ||
        artifact.relativePath.startsWith('/') ||
        artifact.relativePath.endsWith('/') ||
        artifact.relativePath
          .split('/')
          .some((segment) => segment === '.' || segment === '..') ||
        !LOWERCASE_SHA256_PATTERN.test(artifact.sha256) ||
        !Number.isSafeInteger(artifact.byteLength) ||
        artifact.byteLength < 0 ||
        paths.has(artifact.relativePath)
      )
        return refusal('contract registry artifact identity is invalid')
      paths.add(artifact.relativePath)
      return Object.freeze({ ...artifact })
    })
    .sort((left, right) => left.relativePath.localeCompare(right.relativePath))
  return createHash('sha256')
    .update(
      canonicalJsonBytesV1({
        schemaVersion: 1,
        kind: 'edit-contract-registry-artifact-set-v1',
        artifacts: exact,
      })
    )
    .digest('hex')
}

interface RegistryRowV1
{
  readonly registrationRelativePath: string
  readonly retainedPolicyRelativePaths: readonly string[]
}

function refusal(message: string): never
{
  throw new McpBoundaryError('mcp.edit-contract-config-invalid', message)
}

function exactObjectV1(
  value: unknown,
  expectedKeys: readonly string[],
  label: string
): Record<string, unknown>
{
  if (value === null || typeof value !== 'object' || Array.isArray(value))
    return refusal(`${label} must be one closed object`)
  const object = value as Record<string, unknown>
  if (!hasExactObjectKeysV1(object, expectedKeys))
    return refusal(`${label} has missing or unknown fields`)
  return object
}

function boundedReadBytesV1(
  read: Awaited<ReturnType<EditPrivateReadPortV1['read']>>,
  maximumBytes: number,
  label: string
): Uint8Array
{
  if (
    !(read.bytes instanceof Uint8Array) ||
    !Number.isSafeInteger(read.byteLength) ||
    read.byteLength !== read.bytes.byteLength ||
    read.byteLength > maximumBytes
  )
    return refusal(`${label} exceeds its authoritative byte bound`)
  return read.bytes
}

export function editPrivateRelativePathV1(
  privateRoot: string,
  value: unknown,
  label: string
): string
{
  if (
    typeof value !== 'string' ||
    !RELATIVE_PATH.test(value) ||
    value.startsWith('/') ||
    value.endsWith('/') ||
    value.split('/').some((segment) => segment === '.' || segment === '..')
  )
    return refusal(`${label} must be one normalized bounded relative path`)
  const root = resolve(privateRoot)
  const absolute = resolve(root, value)
  if (!absolute.startsWith(`${root}${sep}`))
    return refusal(`${label} resolves outside the private root`)
  return absolute
}

function rowsV1(value: unknown): readonly RegistryRowV1[]
{
  const root = exactObjectV1(
    value,
    ['kind', 'registrations', 'schemaVersion'],
    'edit contract registry manifest'
  )
  if (
    root.schemaVersion !== 1 ||
    root.kind !== 'production-edit-contract-registry-v1' ||
    !Array.isArray(root.registrations) ||
    root.registrations.length < 1 ||
    root.registrations.length > MAX_REGISTRATIONS
  )
    return refusal('edit contract registry manifest identity is invalid')
  return Object.freeze(
    root.registrations.map((candidate, index) =>
    {
      const row = exactObjectV1(
        candidate,
        ['registrationRelativePath', 'retainedPolicyRelativePaths'],
        `edit contract registry row ${index}`
      )
      if (
        typeof row.registrationRelativePath !== 'string' ||
        !Array.isArray(row.retainedPolicyRelativePaths) ||
        row.retainedPolicyRelativePaths.length >
          MAX_POLICIES_PER_REGISTRATION ||
        row.retainedPolicyRelativePaths.some((path) => typeof path !== 'string')
      )
        return refusal(`edit contract registry row ${index} is invalid`)
      return Object.freeze({
        registrationRelativePath: row.registrationRelativePath,
        retainedPolicyRelativePaths: Object.freeze([
          ...(row.retainedPolicyRelativePaths as string[]),
        ]),
      })
    })
  )
}

function hostLimitsV1(
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

export async function loadEditContractRegistryV1(input: {
  readonly privateRoot: string
  readonly manifestRelativePath: string
  readonly readPort: EditPrivateReadPortV1
}): Promise<LoadedEditContractRegistryV1>
{
  const manifest = await input.readPort.read(
    editPrivateRelativePathV1(
      input.privateRoot,
      input.manifestRelativePath,
      'contract registry manifest path'
    )
  )
  const manifestBytes = boundedReadBytesV1(
    manifest,
    MAX_REGISTRY_MANIFEST_BYTES,
    'edit contract registry manifest'
  )
  let parsed: unknown
  try
  {
    parsed = scanStrictJson(manifestBytes, {
      maxDepth: 8,
      maxMembersPerContainer: 128,
      maxNodes: 2048,
    }).value
  }
  catch
  {
    return refusal('edit contract registry manifest is not strict bounded JSON')
  }
  const rows = rowsV1(parsed)
  const artifactIdentities: EditContractRegistryArtifactIdentityV1[] = [
    {
      relativePath: input.manifestRelativePath,
      sha256: manifest.sha256,
      byteLength: manifest.byteLength,
    },
  ]
  const registry = new EditChangeContractRegistryV1({
    hostDefaultLimits: hostLimitsV1('defaultValue'),
    hostHardLimits: hostLimitsV1('hardMaximum'),
  })
  const registrations: LoadedEditContractRegistryV1['registrations'][number][] =
    []
  for (const [index, row] of rows.entries())
  {
    const registration = await input.readPort.read(
      editPrivateRelativePathV1(
        input.privateRoot,
        row.registrationRelativePath,
        `registration path ${index}`
      )
    )
    const registrationBytes = boundedReadBytesV1(
      registration,
      MAX_REGISTRATION_BYTES,
      `edit contract registration ${index}`
    )
    artifactIdentities.push({
      relativePath: row.registrationRelativePath,
      sha256: registration.sha256,
      byteLength: registration.byteLength,
    })
    const policies: Uint8Array[] = []
    let aggregatePolicyBytes = 0
    for (const [
      policyIndex,
      path,
    ] of row.retainedPolicyRelativePaths.entries())
    {
      const policy = await input.readPort.read(
        editPrivateRelativePathV1(
          input.privateRoot,
          path,
          `registration ${index} policy path ${policyIndex}`
        )
      )
      const policyBytes = boundedReadBytesV1(
        policy,
        MAX_POLICY_BYTES,
        `registration ${index} retained policy ${policyIndex}`
      )
      artifactIdentities.push({
        relativePath: path,
        sha256: policy.sha256,
        byteLength: policy.byteLength,
      })
      aggregatePolicyBytes += policyBytes.byteLength
      if (aggregatePolicyBytes > MAX_POLICY_BYTES_PER_REGISTRATION)
        return refusal(
          `registration ${index} retained policies exceed their authoritative aggregate byte bound`
        )
      policies.push(policyBytes)
    }
    let registered
    try
    {
      registered = registry.registerBytes(registrationBytes, policies)
    }
    catch
    {
      return refusal(`edit contract registration ${index} was refused`)
    }
    registrations.push(
      Object.freeze({
        registrationId: registered.registration.registrationId,
        semanticContractSha256: registered.registration.semanticContractSha256,
        retainedPolicyCount: policies.length,
      })
    )
  }
  registry.seal()
  return Object.freeze({
    registry,
    manifestSha256: manifest.sha256,
    manifestEvidenceSha256: manifest.evidence.hostEvidenceSha256,
    artifactSetSha256:
      editContractRegistryArtifactSetSha256V1(artifactIdentities),
    registrations: Object.freeze(registrations),
  })
}
