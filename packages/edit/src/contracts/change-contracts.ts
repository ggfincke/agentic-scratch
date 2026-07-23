// packages/edit/src/contracts/change-contracts.ts
// host-loaded immutable change-contract registration & session binding

import type {
  ContractEntityBindingV1,
  EditChangeContractRegistrationV1,
  EditLimitKeyV1,
  EditScenarioPolicyV1,
  EditSemanticChangeContractV1,
  RetainedPolicyBindingV1,
  Sha256,
} from '@scratch-agent/ir/edit'
import {
  PHASE_8_EDIT_LIMIT_AUTHORITY_V1,
  PHASE_8_RESOURCE_POLICY_CATALOG,
  parseContractDefinitionV1,
  parseEditScenarioPolicyV1,
  parseSemanticChangeContractV1,
  scenarioPolicyValueSemanticSha256V1,
  semanticHashV1,
} from '@scratch-agent/ir/edit'
import {
  canonicalJsonBytesV1,
  type CanonicalJsonValue,
} from '@scratch-agent/sb3/canonical-json'
import { sha256Hex } from '@scratch-agent/sb3/crypto-node'
import { scanStrictJson, StrictJsonScanError } from '@scratch-agent/sb3'

import { immutableCopyV1 as immutableCopy } from '../support/internal-values.js'

const SEMANTIC_CONTRACT_BYTES =
  PHASE_8_RESOURCE_POLICY_CATALOG.canonicalSemanticChangeContractBytes
const DISPLAY_EVIDENCE_BYTES =
  PHASE_8_RESOURCE_POLICY_CATALOG.contractRegistrationDisplayProvenanceBytes

export const CHANGE_CONTRACT_REGISTRATION_LIMITS_V1 = Object.freeze({
  semanticContractBytes: SEMANTIC_CONTRACT_BYTES,
  displayEvidenceBytes: DISPLAY_EVIDENCE_BYTES,
  registrationBytes: Object.freeze({
    defaultValue:
      SEMANTIC_CONTRACT_BYTES.defaultValue +
      DISPLAY_EVIDENCE_BYTES.defaultValue,
    hardMaximum:
      SEMANTIC_CONTRACT_BYTES.hardMaximum + DISPLAY_EVIDENCE_BYTES.hardMaximum,
  }),
  nestingDepth:
    PHASE_8_RESOURCE_POLICY_CATALOG.contractRegistrationJsonNestingDepth,
  membersPerContainer:
    PHASE_8_RESOURCE_POLICY_CATALOG.contractRegistrationMembersPerContainer,
  totalNodes:
    PHASE_8_RESOURCE_POLICY_CATALOG.contractRegistrationTotalJsonNodes,
})

type ChangeContractRegistrationErrorCodeV1 =
  | 'duplicate-registration'
  | 'display-evidence-hash-mismatch'
  | 'display-evidence-mismatch'
  | 'host-limit-invalid'
  | 'limit-override-exceeded'
  | 'operation-not-authorized'
  | 'registration-invalid'
  | 'registration-too-large'
  | 'retained-policy-artifact-duplicate'
  | 'retained-policy-artifact-hash-mismatch'
  | 'retained-policy-artifact-invalid'
  | 'retained-policy-artifact-missing'
  | 'retained-policy-artifact-too-large'
  | 'retained-policy-artifact-unreferenced'
  | 'retained-policy-binding-limit-exceeded'
  | 'retained-policy-invalid'
  | 'retained-policy-strict-json-invalid'
  | 'registry-sealed'
  | 'scope-not-authorized'
  | 'semantic-contract-hash-mismatch'
  | 'semantic-contract-invalid'
  | 'semantic-contract-too-large'
  | 'source-constraint-mismatch'
  | 'strict-json-invalid'
  | 'unknown-registration'

export class ChangeContractRegistrationErrorV1 extends Error
{
  readonly code: ChangeContractRegistrationErrorCodeV1

  constructor(code: ChangeContractRegistrationErrorCodeV1, message: string)
  {
    super(message)
    this.name = 'ChangeContractRegistrationErrorV1'
    this.code = code
  }
}

interface ChangeContractRegistryLimitsV1
{
  readonly maximumRegistrationBytes: number
  readonly maximumSemanticContractBytes: number
  readonly maximumDisplayEvidenceBytes: number
  readonly maximumDepth: number
  readonly maximumMembersPerContainer: number
  readonly maximumTotalNodes: number
}

export interface RetainedPolicyRegistryLimitsV1
{
  readonly maximumBindings: number
  readonly maximumArtifactBytes: number
  readonly maximumDepth: number
  readonly maximumMembersPerContainer: number
  readonly maximumNodesPerArtifact: number
  readonly maximumArtifactBytesPerContract: number
  readonly maximumNodesPerContract: number
}

interface EditChangeContractRegistryOptionsV1
{
  readonly hostDefaultLimits: Readonly<Record<EditLimitKeyV1, number>>
  readonly hostHardLimits: Readonly<Record<EditLimitKeyV1, number>>
  readonly registrationLimits?: Partial<ChangeContractRegistryLimitsV1>
  readonly retainedPolicyLimits?: Partial<RetainedPolicyRegistryLimitsV1>
}

export type ChangeContractSourceBindingV1 =
  | {
      readonly kind: 'exactArtifact'
      readonly sourceArtifactSha256: Sha256
    }
  | {
      readonly kind: 'template'
      readonly artifactSha256: Sha256
      readonly templateId: string
      readonly version: string
    }

export interface ExistingContractBindingResolutionV1
{
  readonly bindingKey: string
  readonly entityKind: ContractEntityBindingV1['entityKind']
  readonly sourceLocationSha256: Sha256
}

interface BindChangeContractRequestV1
{
  readonly registrationId: string
  readonly expectedSemanticContractSha256: Sha256
  readonly source: ChangeContractSourceBindingV1
  readonly existingBindings: readonly ExistingContractBindingResolutionV1[]
}

export interface RegisteredChangeContractV1
{
  readonly registration: EditChangeContractRegistrationV1
  readonly registrationByteLength: number
  readonly semanticContractByteLength: number
  readonly displayEvidenceByteLength: number
  readonly registrationArtifactSha256: Sha256
  readonly retainedPoliciesBySemanticSha256: Readonly<
    Record<string, RegisteredRetainedPolicyArtifactV1>
  >
}

interface RegisteredRetainedPolicyArtifactV1
{
  readonly binding: RetainedPolicyBindingV1
  readonly canonicalByteLength: number
  readonly canonicalJson: string
  readonly jsonNodeCount: number
  readonly value: CanonicalJsonValue
  readonly scenarioPolicy?: EditScenarioPolicyV1
}

export interface BoundChangeContractV1 extends RegisteredChangeContractV1
{
  readonly source: ChangeContractSourceBindingV1
  readonly effectiveLimits: Readonly<Record<EditLimitKeyV1, number>>
  readonly existingBindings: readonly ExistingContractBindingResolutionV1[]
}

const DEFAULT_REGISTRY_LIMITS = Object.freeze({
  maximumRegistrationBytes:
    CHANGE_CONTRACT_REGISTRATION_LIMITS_V1.registrationBytes.defaultValue,
  maximumSemanticContractBytes:
    CHANGE_CONTRACT_REGISTRATION_LIMITS_V1.semanticContractBytes.defaultValue,
  maximumDisplayEvidenceBytes:
    CHANGE_CONTRACT_REGISTRATION_LIMITS_V1.displayEvidenceBytes.defaultValue,
  maximumDepth:
    CHANGE_CONTRACT_REGISTRATION_LIMITS_V1.nestingDepth.defaultValue,
  maximumMembersPerContainer:
    CHANGE_CONTRACT_REGISTRATION_LIMITS_V1.membersPerContainer.defaultValue,
  maximumTotalNodes:
    CHANGE_CONTRACT_REGISTRATION_LIMITS_V1.totalNodes.defaultValue,
}) satisfies ChangeContractRegistryLimitsV1

const DEFAULT_RETAINED_POLICY_LIMITS = Object.freeze({
  maximumBindings:
    PHASE_8_RESOURCE_POLICY_CATALOG.retainedPolicyBindings.defaultValue,
  maximumArtifactBytes:
    PHASE_8_RESOURCE_POLICY_CATALOG.retainedPolicyArtifactBytes.defaultValue,
  maximumDepth:
    PHASE_8_RESOURCE_POLICY_CATALOG.retainedPolicyJsonNestingDepth.defaultValue,
  maximumMembersPerContainer:
    PHASE_8_RESOURCE_POLICY_CATALOG.retainedPolicyMembersPerContainer
      .defaultValue,
  maximumNodesPerArtifact:
    PHASE_8_RESOURCE_POLICY_CATALOG.retainedPolicyTotalJsonNodes.defaultValue,
  maximumArtifactBytesPerContract:
    PHASE_8_RESOURCE_POLICY_CATALOG.retainedPolicyArtifactBytesPerContract
      .defaultValue,
  maximumNodesPerContract:
    PHASE_8_RESOURCE_POLICY_CATALOG.retainedPolicyJsonNodesPerContract
      .defaultValue,
}) satisfies RetainedPolicyRegistryLimitsV1

function fail(
  code: ChangeContractRegistrationErrorCodeV1,
  message: string
): never
{
  throw new ChangeContractRegistrationErrorV1(code, message)
}

function assertBoundedInteger(
  name: string,
  value: unknown,
  approvedDefault: number
): asserts value is number
{
  if (
    !Number.isSafeInteger(value) ||
    (value as number) < 1 ||
    (value as number) > approvedDefault
  )
  {
    fail(
      'host-limit-invalid',
      `${name} must be a positive safe integer no larger than the approved default ${approvedDefault}`
    )
  }
}

function assertNonnegativeBoundedInteger(
  name: string,
  value: unknown,
  approvedDefault: number
): asserts value is number
{
  if (
    !Number.isSafeInteger(value) ||
    (value as number) < 0 ||
    (value as number) > approvedDefault
  )
  {
    fail(
      'host-limit-invalid',
      `${name} must be a nonnegative safe integer no larger than the approved default ${approvedDefault}`
    )
  }
}

function dataPropertyDescriptors(
  name: string,
  value: unknown
): PropertyDescriptorMap
{
  if (typeof value !== 'object' || value === null || Array.isArray(value))
  {
    fail('host-limit-invalid', `${name} must be a plain object`)
  }
  const prototype = Object.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== null)
  {
    fail('host-limit-invalid', `${name} must be a plain object`)
  }
  if (Object.getOwnPropertySymbols(value).length !== 0)
  {
    fail('host-limit-invalid', `${name} cannot contain symbol keys`)
  }
  const descriptors = Object.getOwnPropertyDescriptors(value)
  for (const key of Object.getOwnPropertyNames(descriptors))
  {
    const descriptor = descriptors[key]
    if (!descriptor || !('value' in descriptor))
    {
      fail('host-limit-invalid', `${name}.${key} must be a data property`)
    }
  }
  return descriptors
}

function normalizeHostLimits(
  defaultInput: unknown,
  hardInput: unknown
): {
  readonly defaultLimits: Readonly<Record<EditLimitKeyV1, number>>
  readonly hardLimits: Readonly<Record<EditLimitKeyV1, number>>
}
{
  const defaultDescriptors = dataPropertyDescriptors(
    'hostDefaultLimits',
    defaultInput
  )
  const hardDescriptors = dataPropertyDescriptors('hostHardLimits', hardInput)
  const authorityKeys = Object.keys(
    PHASE_8_EDIT_LIMIT_AUTHORITY_V1
  ) as EditLimitKeyV1[]
  for (const [name, descriptors] of [
    ['hostDefaultLimits', defaultDescriptors],
    ['hostHardLimits', hardDescriptors],
  ] as const)
  {
    for (const key of Object.getOwnPropertyNames(descriptors))
    {
      if (!Object.hasOwn(PHASE_8_EDIT_LIMIT_AUTHORITY_V1, key))
      {
        fail('host-limit-invalid', `${name} contains unknown key ${key}`)
      }
    }
    for (const key of authorityKeys)
    {
      if (!Object.hasOwn(descriptors, key))
      {
        fail('host-limit-invalid', `${name} is missing required key ${key}`)
      }
    }
  }

  const defaultLimits = Object.create(null) as Record<EditLimitKeyV1, number>
  const hardLimits = Object.create(null) as Record<EditLimitKeyV1, number>
  for (const key of authorityKeys)
  {
    const defaultValue = defaultDescriptors[key]!.value
    const hardMaximum = hardDescriptors[key]!.value
    const authority = PHASE_8_EDIT_LIMIT_AUTHORITY_V1[key]
    if (
      !Number.isSafeInteger(defaultValue) ||
      (defaultValue as number) < 0 ||
      (defaultValue as number) > authority.defaultValue
    )
    {
      fail(
        'host-limit-invalid',
        `host default limit ${key} must be a nonnegative safe integer no larger than the approved default ${authority.defaultValue}`
      )
    }
    if (
      !Number.isSafeInteger(hardMaximum) ||
      (hardMaximum as number) < 0 ||
      (hardMaximum as number) > authority.hardMaximum
    )
    {
      fail(
        'host-limit-invalid',
        `host hard limit ${key} must be a nonnegative safe integer no larger than the approved hard maximum ${authority.hardMaximum}`
      )
    }
    if ((defaultValue as number) > (hardMaximum as number))
    {
      fail(
        'host-limit-invalid',
        `host default limit ${key} cannot exceed its host hard limit`
      )
    }
    defaultLimits[key] = defaultValue as number
    hardLimits[key] = hardMaximum as number
  }
  return Object.freeze({
    defaultLimits: Object.freeze(defaultLimits),
    hardLimits: Object.freeze(hardLimits),
  })
}

function normalizeLimits(
  partial: Partial<ChangeContractRegistryLimitsV1> | undefined
): ChangeContractRegistryLimitsV1
{
  if (partial === undefined) return DEFAULT_REGISTRY_LIMITS
  const descriptors = dataPropertyDescriptors('registrationLimits', partial)
  const value = { ...DEFAULT_REGISTRY_LIMITS }
  for (const key of Object.getOwnPropertyNames(descriptors))
  {
    if (!Object.hasOwn(DEFAULT_REGISTRY_LIMITS, key))
    {
      fail(
        'host-limit-invalid',
        `registrationLimits contains unknown key ${key}`
      )
    }
    const typedKey = key as keyof ChangeContractRegistryLimitsV1
    const override = descriptors[key]!.value
    assertBoundedInteger(
      `registrationLimits.${key}`,
      override,
      DEFAULT_REGISTRY_LIMITS[typedKey]
    )
    value[typedKey] = override
  }
  return Object.freeze(value)
}

function normalizeRetainedPolicyLimits(
  partial: Partial<RetainedPolicyRegistryLimitsV1> | undefined
): RetainedPolicyRegistryLimitsV1
{
  if (partial === undefined) return DEFAULT_RETAINED_POLICY_LIMITS
  const descriptors = dataPropertyDescriptors('retainedPolicyLimits', partial)
  const value = { ...DEFAULT_RETAINED_POLICY_LIMITS }
  for (const key of Object.getOwnPropertyNames(descriptors))
  {
    if (!Object.hasOwn(DEFAULT_RETAINED_POLICY_LIMITS, key))
    {
      fail(
        'host-limit-invalid',
        `retainedPolicyLimits contains unknown key ${key}`
      )
    }
    const typedKey = key as keyof RetainedPolicyRegistryLimitsV1
    const override = descriptors[key]!.value
    assertNonnegativeBoundedInteger(
      `retainedPolicyLimits.${key}`,
      override,
      DEFAULT_RETAINED_POLICY_LIMITS[typedKey]
    )
    value[typedKey] = override
  }
  return Object.freeze(value)
}

function displayEvidenceProjection(
  registration: EditChangeContractRegistrationV1
): CanonicalJsonValue
{
  return {
    bindingDisplayEvidence:
      registration.bindingDisplayEvidence as unknown as CanonicalJsonValue,
    displayObjective: registration.displayObjective as CanonicalJsonValue,
    provenance: registration.provenance as CanonicalJsonValue,
  }
}

function verifySourceConstraint(
  contract: EditSemanticChangeContractV1,
  source: ChangeContractSourceBindingV1
): void
{
  const expected = contract.sourceConstraint
  const matches =
    expected.kind === 'exactArtifact'
      ? source.kind === 'exactArtifact' &&
        source.sourceArtifactSha256 === expected.sourceArtifactSha256
      : source.kind === 'template' &&
        source.artifactSha256 === expected.artifactSha256 &&
        source.templateId === expected.templateId &&
        source.version === expected.version
  if (!matches)
  {
    fail(
      'source-constraint-mismatch',
      'resolved source does not satisfy the registered semantic contract'
    )
  }
}

type ExistingContractEntityBindingV1 = Extract<
  ContractEntityBindingV1,
  { readonly bindingKind: 'existing' }
>

function existingBindings(
  contract: EditSemanticChangeContractV1
): readonly ExistingContractEntityBindingV1[]
{
  return contract.entityBindings.filter(
    (binding) => binding.bindingKind === 'existing'
  ) as readonly ExistingContractEntityBindingV1[]
}

function verifyExistingBindings(
  registration: EditChangeContractRegistrationV1,
  resolutions: readonly ExistingContractBindingResolutionV1[]
): void
{
  const expected = existingBindings(registration.semanticContract)
  const resolutionByKey = new Map(
    resolutions.map((resolution) => [resolution.bindingKey, resolution])
  )
  if (resolutionByKey.size !== resolutions.length)
  {
    fail('display-evidence-mismatch', 'resolved binding keys must be unique')
  }
  for (const binding of expected)
  {
    const resolution = resolutionByKey.get(binding.bindingKey)
    if (
      resolution === undefined ||
      resolution.entityKind !== binding.entityKind ||
      resolution.sourceLocationSha256 !== binding.sourceLocationSha256
    )
    {
      fail(
        'display-evidence-mismatch',
        `existing contract binding ${binding.bindingKey} did not resolve exactly`
      )
    }
  }
  if (resolutionByKey.size !== expected.length)
  {
    fail(
      'display-evidence-mismatch',
      'resolved bindings must cover exactly the existing contract bindings'
    )
  }
  const bindingByKey = new Map(
    registration.semanticContract.entityBindings.map((binding) => [
      binding.bindingKey,
      binding,
    ])
  )
  for (const evidence of registration.bindingDisplayEvidence)
  {
    const binding = bindingByKey.get(evidence.bindingKey)
    if (
      binding === undefined ||
      binding.bindingKind !== 'existing' ||
      evidence.boundedLocation.kind !== binding.entityKind ||
      evidence.boundedLocation.fullLocationSha256 !==
        binding.sourceLocationSha256
    )
    {
      fail(
        'display-evidence-mismatch',
        `display evidence ${evidence.bindingKey} does not match its source binding`
      )
    }
  }
}

interface ScannedRetainedPolicyArtifactV1
{
  readonly canonicalBytes: Uint8Array
  readonly canonicalSha256: Sha256
  readonly metrics: Readonly<{ readonly nodes: number }>
  readonly rawSha256: Sha256
  readonly value: CanonicalJsonValue
}

function scanRetainedPolicyArtifact(
  bytes: Uint8Array,
  limits: Readonly<{
    artifactBytes: number
    nestingDepth: number
    membersPerContainer: number
    totalNodes: number
  }>
): ScannedRetainedPolicyArtifactV1
{
  if (!(bytes instanceof Uint8Array))
  {
    fail(
      'retained-policy-artifact-invalid',
      'retained policy artifacts must be supplied as byte arrays'
    )
  }
  if (bytes.byteLength > limits.artifactBytes)
  {
    fail(
      'retained-policy-artifact-too-large',
      `retained policy artifact exceeds ${limits.artifactBytes} input bytes`
    )
  }
  let scan: ReturnType<typeof scanStrictJson>
  try
  {
    scan = scanStrictJson(bytes, {
      maxDepth: limits.nestingDepth,
      maxMembersPerContainer: limits.membersPerContainer,
      maxNodes: limits.totalNodes,
    })
  }
  catch (error)
  {
    const detail =
      error instanceof StrictJsonScanError
        ? error.code
        : 'unknown scanner error'
    fail(
      'retained-policy-strict-json-invalid',
      `retained policy artifact JSON refused: ${detail}`
    )
  }
  const canonicalBytes = canonicalJsonBytesV1(scan.value)
  if (canonicalBytes.byteLength > limits.artifactBytes)
  {
    fail(
      'retained-policy-artifact-too-large',
      `retained policy artifact exceeds ${limits.artifactBytes} canonical bytes`
    )
  }
  return Object.freeze({
    canonicalBytes,
    canonicalSha256: sha256Hex(canonicalBytes),
    metrics: Object.freeze({ nodes: scan.metrics.nodes }),
    rawSha256: sha256Hex(bytes),
    value: scan.value as CanonicalJsonValue,
  })
}

function registerRetainedPolicies(
  contract: EditSemanticChangeContractV1,
  artifactBytes: readonly Uint8Array[],
  limits: RetainedPolicyRegistryLimitsV1
): Readonly<Record<string, RegisteredRetainedPolicyArtifactV1>>
{
  if (!Array.isArray(artifactBytes))
  {
    fail(
      'retained-policy-artifact-invalid',
      'retained policy artifacts must be supplied as an array'
    )
  }
  if (contract.policyBindings.length > limits.maximumBindings)
  {
    fail(
      'retained-policy-binding-limit-exceeded',
      `contract retains ${contract.policyBindings.length} policy bindings but the effective limit is ${limits.maximumBindings}`
    )
  }
  if (artifactBytes.length > contract.policyBindings.length)
  {
    fail(
      'retained-policy-artifact-unreferenced',
      'retained policy artifact inputs cannot outnumber contract policy bindings'
    )
  }

  const scanLimits = Object.freeze({
    artifactBytes: limits.maximumArtifactBytes,
    nestingDepth: limits.maximumDepth,
    membersPerContainer: limits.maximumMembersPerContainer,
    totalNodes: limits.maximumNodesPerArtifact,
  })
  const artifactsBySha256 = new Map<Sha256, ScannedRetainedPolicyArtifactV1>()
  let aggregateBytes = 0
  let aggregateNodes = 0
  for (const bytes of artifactBytes)
  {
    const artifact = scanRetainedPolicyArtifact(bytes, scanLimits)
    if (artifactsBySha256.has(artifact.canonicalSha256))
    {
      fail(
        'retained-policy-artifact-duplicate',
        `retained policy artifact ${artifact.canonicalSha256} was supplied more than once`
      )
    }
    aggregateBytes += artifact.canonicalBytes.byteLength
    aggregateNodes += artifact.metrics.nodes
    if (aggregateBytes > limits.maximumArtifactBytesPerContract)
    {
      fail(
        'retained-policy-artifact-too-large',
        `retained policy artifacts exceed ${limits.maximumArtifactBytesPerContract} distinct canonical bytes for one contract`
      )
    }
    if (aggregateNodes > limits.maximumNodesPerContract)
    {
      fail(
        'retained-policy-artifact-too-large',
        `retained policy artifacts exceed ${limits.maximumNodesPerContract} distinct JSON nodes for one contract`
      )
    }
    artifactsBySha256.set(artifact.canonicalSha256, artifact)
  }

  const referencedArtifacts = new Set<Sha256>()
  const scenarioIds = new Set<string>()
  const policies = Object.create(null) as Record<
    string,
    RegisteredRetainedPolicyArtifactV1
  >
  for (const binding of contract.policyBindings)
  {
    if (binding.schemaVersion !== 1)
    {
      fail(
        'retained-policy-invalid',
        `retained policy binding ${binding.bindingId} requests unsupported schema version ${binding.schemaVersion}`
      )
    }
    const artifact = artifactsBySha256.get(binding.retainedArtifactSha256)
    if (artifact === undefined)
    {
      const rawArtifact = [...artifactsBySha256.values()].find(
        (candidate) => candidate.rawSha256 === binding.retainedArtifactSha256
      )
      if (rawArtifact !== undefined)
      {
        fail(
          'retained-policy-artifact-hash-mismatch',
          `retained policy binding ${binding.bindingId} hashes noncanonical input bytes instead of the exact canonical artifact bytes`
        )
      }
      fail(
        'retained-policy-artifact-missing',
        `retained policy binding ${binding.bindingId} cannot resolve artifact ${binding.retainedArtifactSha256}`
      )
    }
    referencedArtifacts.add(artifact.canonicalSha256)
    let scenarioPolicy: EditScenarioPolicyV1 | undefined
    if (binding.kind === 'scenario')
    {
      const parsed = parseEditScenarioPolicyV1(artifact.value)
      if (!parsed.ok)
      {
        fail(
          'retained-policy-invalid',
          `retained scenario policy ${binding.bindingId} refused ${parsed.issues.length} schema or semantic issue(s)`
        )
      }
      if (scenarioIds.has(parsed.value.scenarioId))
      {
        fail(
          'retained-policy-invalid',
          `retained scenario policy id ${parsed.value.scenarioId} is duplicated`
        )
      }
      scenarioIds.add(parsed.value.scenarioId)
      scenarioPolicy = immutableCopy(parsed.value)
      if (
        scenarioPolicyValueSemanticSha256V1(scenarioPolicy) !==
        binding.semanticSha256
      )
      {
        fail(
          'retained-policy-artifact-hash-mismatch',
          `retained scenario policy ${binding.bindingId} does not match its semantic hash`
        )
      }
    }
    policies[binding.semanticSha256] = immutableCopy({
      binding,
      canonicalByteLength: artifact.canonicalBytes.byteLength,
      canonicalJson: new TextDecoder('utf-8', { fatal: true }).decode(
        artifact.canonicalBytes
      ),
      jsonNodeCount: artifact.metrics.nodes,
      value: artifact.value,
      ...(scenarioPolicy === undefined ? {} : { scenarioPolicy }),
    })
  }
  if (referencedArtifacts.size !== artifactsBySha256.size)
  {
    fail(
      'retained-policy-artifact-unreferenced',
      'every supplied retained policy artifact must be referenced by the contract'
    )
  }
  return Object.freeze(policies)
}

export class EditChangeContractRegistryV1
{
  readonly #defaultLimits: Readonly<Record<EditLimitKeyV1, number>>
  readonly #hardLimits: Readonly<Record<EditLimitKeyV1, number>>
  readonly #limits: ChangeContractRegistryLimitsV1
  readonly #retainedPolicyLimits: RetainedPolicyRegistryLimitsV1
  readonly #registrations = new Map<string, RegisteredChangeContractV1>()
  #sealed = false

  constructor(options: EditChangeContractRegistryOptionsV1)
  {
    const hostLimits = normalizeHostLimits(
      options.hostDefaultLimits,
      options.hostHardLimits
    )
    this.#defaultLimits = hostLimits.defaultLimits
    this.#hardLimits = hostLimits.hardLimits
    this.#limits = normalizeLimits(options.registrationLimits)
    this.#retainedPolicyLimits = normalizeRetainedPolicyLimits(
      options.retainedPolicyLimits
    )
  }

  registerBytes(
    bytes: Uint8Array,
    retainedPolicyArtifacts: readonly Uint8Array[] = Object.freeze([])
  ): RegisteredChangeContractV1
  {
    if (this.#sealed)
    {
      fail('registry-sealed', 'change-contract registry is already sealed')
    }
    if (bytes.byteLength > this.#limits.maximumRegistrationBytes)
    {
      fail(
        'registration-too-large',
        `contract registration exceeds ${this.#limits.maximumRegistrationBytes} bytes`
      )
    }
    let input: unknown
    try
    {
      input = scanStrictJson(bytes, {
        maxDepth: this.#limits.maximumDepth,
        maxMembersPerContainer: this.#limits.maximumMembersPerContainer,
        maxNodes: this.#limits.maximumTotalNodes,
      }).value
    }
    catch (error)
    {
      const detail =
        error instanceof StrictJsonScanError
          ? error.code
          : 'unknown scanner error'
      fail(
        'strict-json-invalid',
        `contract registration JSON refused: ${detail}`
      )
    }
    const parsed = parseContractDefinitionV1<EditChangeContractRegistrationV1>(
      'EditChangeContractRegistrationV1',
      input
    )
    if (!parsed.ok)
    {
      fail(
        'registration-invalid',
        `contract registration schema refused ${parsed.issues.length} issue(s)`
      )
    }
    const semantic = parseSemanticChangeContractV1(
      parsed.value.semanticContract
    )
    if (!semantic.ok)
    {
      fail(
        'semantic-contract-invalid',
        `semantic change contract refused ${semantic.issues.length} issue(s)`
      )
    }
    const registration = immutableCopy({
      ...parsed.value,
      semanticContract: semantic.value,
    }) as EditChangeContractRegistrationV1
    const semanticBytes = canonicalJsonBytesV1(registration.semanticContract)
    if (semanticBytes.byteLength > this.#limits.maximumSemanticContractBytes)
    {
      fail(
        'semantic-contract-too-large',
        `semantic contract exceeds ${this.#limits.maximumSemanticContractBytes} canonical bytes`
      )
    }
    const semanticContractSha256 = semanticHashV1(
      'change-contract',
      registration.semanticContract
    )
    if (semanticContractSha256 !== registration.semanticContractSha256)
    {
      fail(
        'semantic-contract-hash-mismatch',
        'semantic contract hash does not match the canonical contract projection'
      )
    }
    const displayBytes = canonicalJsonBytesV1(
      displayEvidenceProjection(registration)
    )
    if (displayBytes.byteLength > this.#limits.maximumDisplayEvidenceBytes)
    {
      fail(
        'registration-too-large',
        `registration display evidence exceeds ${this.#limits.maximumDisplayEvidenceBytes} canonical bytes`
      )
    }
    if (sha256Hex(displayBytes) !== registration.displayEvidenceSha256)
    {
      fail(
        'display-evidence-hash-mismatch',
        'display/provenance hash does not match its canonical projection'
      )
    }
    for (const override of registration.semanticContract.limitOverrides)
    {
      const hardMaximum = this.#hardLimits[override.key]
      const defaultValue = this.#defaultLimits[override.key]
      if (
        hardMaximum === undefined ||
        defaultValue === undefined ||
        !Number.isSafeInteger(override.value) ||
        override.value < 0 ||
        override.value > defaultValue ||
        override.value > hardMaximum
      )
      {
        fail(
          'limit-override-exceeded',
          `contract limit ${override.key} may only lower the host default`
        )
      }
    }
    const retainedPoliciesBySemanticSha256 = registerRetainedPolicies(
      registration.semanticContract,
      retainedPolicyArtifacts,
      this.#retainedPolicyLimits
    )
    if (this.#registrations.has(registration.registrationId))
    {
      fail(
        'duplicate-registration',
        `change-contract registration ${registration.registrationId} already exists`
      )
    }
    const result = immutableCopy({
      registration,
      registrationByteLength: bytes.byteLength,
      semanticContractByteLength: semanticBytes.byteLength,
      displayEvidenceByteLength: displayBytes.byteLength,
      registrationArtifactSha256: sha256Hex(bytes),
      retainedPoliciesBySemanticSha256,
    }) as RegisteredChangeContractV1
    this.#registrations.set(registration.registrationId, result)
    return result
  }

  get(registrationId: string): RegisteredChangeContractV1
  {
    const registration = this.#registrations.get(registrationId)
    if (registration === undefined)
    {
      fail(
        'unknown-registration',
        `change-contract registration ${registrationId} is unavailable`
      )
    }
    return registration
  }

  bind(request: BindChangeContractRequestV1): BoundChangeContractV1
  {
    if (!this.#sealed)
    {
      fail(
        'registry-sealed',
        'change-contract registry must be sealed before session binding'
      )
    }
    const registered = this.get(request.registrationId)
    if (
      registered.registration.semanticContractSha256 !==
      request.expectedSemanticContractSha256
    )
    {
      fail(
        'semantic-contract-hash-mismatch',
        'begin precondition names a different semantic contract'
      )
    }
    verifySourceConstraint(
      registered.registration.semanticContract,
      request.source
    )
    verifyExistingBindings(registered.registration, request.existingBindings)
    const effectiveLimits = { ...this.#defaultLimits }
    for (const override of registered.registration.semanticContract
      .limitOverrides)
      {
      effectiveLimits[override.key] = override.value
    }
    return immutableCopy({
      ...registered,
      source: request.source,
      effectiveLimits,
      existingBindings: request.existingBindings,
    })
  }

  seal(): void
  {
    this.#sealed = true
  }

  ids(): readonly string[]
  {
    return Object.freeze([...this.#registrations.keys()].sort())
  }
}

export function boundRetainedPolicyArtifactV1(
  bound: BoundChangeContractV1,
  semanticSha256: Sha256
): RegisteredRetainedPolicyArtifactV1
{
  const artifact = bound.retainedPoliciesBySemanticSha256[semanticSha256]
  if (artifact === undefined)
  {
    fail(
      'retained-policy-artifact-missing',
      `bound change contract does not retain policy ${semanticSha256}`
    )
  }
  return artifact
}

export function retainedPolicyArtifactBytesV1(
  artifact: RegisteredRetainedPolicyArtifactV1
): Uint8Array
{
  return new TextEncoder().encode(artifact.canonicalJson)
}
