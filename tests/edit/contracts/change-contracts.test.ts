// tests/edit/contracts/change-contracts.test.ts
// retained policy registration boundaries, identity, quotas, & immutability

import assert from 'node:assert/strict'
import test from 'node:test'

import {
  SEMANTICALLY_VALID_CHANGE_CONTRACT_SAMPLE,
  boundedDisplayStringV1,
  scenarioPolicySemanticSha256V1,
  scenarioPolicyValueSemanticSha256V1,
  semanticHashV1,
  type EditChangeContractRegistrationV1,
  type EditScenarioPolicyV1,
  type EditSemanticChangeContractV1,
} from '@scratch-agent/ir/edit'
import { scanStrictJson } from '@scratch-agent/sb3'
import { canonicalJsonBytesV1 } from '@scratch-agent/sb3/canonical-json'
import { sha256Hex } from '@scratch-agent/sb3/crypto-node'

import { ChangeContractRegistrationErrorV1, EditChangeContractRegistryV1, boundRetainedPolicyArtifactV1, retainedPolicyArtifactBytesV1, type RegisteredChangeContractV1, type RetainedPolicyRegistryLimitsV1 } from '../../../packages/edit/src/contracts/change-contracts.js'
import { EditEvaluationPlanErrorV1, activateEvaluationPlanSetV1 } from '../../../packages/edit/src/evaluation/evaluation-plans.js'
import { HOST_DEFAULT_LIMITS, HOST_HARD_LIMITS } from '../../helpers/edit-host.js'

const BASE_SCENARIO = Object.freeze({
  scenarioId: 'scenario',
  applicability: 'baselineAndCandidate',
  seed: 0,
  fixedDateMs: 0,
  maxTicks: 1,
  steps: Object.freeze([{ do: 'greenFlag' as const }]),
}) satisfies EditScenarioPolicyV1

const RUNTIME_POLICY = Object.freeze({
  policyKind: 'runtime',
  schemaVersion: 1,
})

const LENS_POLICY = Object.freeze({
  policyKind: 'lens',
  schemaVersion: 1,
})

interface PolicyFixture
{
  readonly contract: EditSemanticChangeContractV1
  readonly scenario: EditScenarioPolicyV1
  readonly scenarioBytes: Uint8Array
  readonly runtimeBytes: Uint8Array
  readonly lensBytes: Uint8Array
  readonly artifacts: readonly Uint8Array[]
  readonly scenarioSemanticSha256: string
}

function policyFixture(
  scenario: EditScenarioPolicyV1 = BASE_SCENARIO
): PolicyFixture
{
  const contract = structuredClone(
    SEMANTICALLY_VALID_CHANGE_CONTRACT_SAMPLE
  ) as EditSemanticChangeContractV1
  const scenarioBytes = canonicalJsonBytesV1(scenario)
  const runtimeBytes = canonicalJsonBytesV1(RUNTIME_POLICY)
  const lensBytes = canonicalJsonBytesV1(LENS_POLICY)
  const bytesByKind = new Map<string, Uint8Array>([
    ['scenario', scenarioBytes],
    ['runtime', runtimeBytes],
    ['lens', lensBytes],
  ])
  const scenarioSemanticSha256 = scenarioPolicyValueSemanticSha256V1(scenario)
  for (const binding of contract.policyBindings)
  {
    const bytes = bytesByKind.get(binding.kind)
    assert.ok(bytes)
    ;(binding as { retainedArtifactSha256: string }).retainedArtifactSha256 =
      sha256Hex(bytes)
    if (binding.kind === 'scenario')
    {
      ;(binding as { semanticSha256: string }).semanticSha256 =
        scenarioSemanticSha256
    }
  }
  for (const plan of contract.evaluationPlans)
  {
    ;(
      plan as unknown as { scenarioPolicySha256s: string[] }
    ).scenarioPolicySha256s = [scenarioSemanticSha256]
  }
  return Object.freeze({
    contract,
    scenario,
    scenarioBytes,
    runtimeBytes,
    lensBytes,
    artifacts: Object.freeze([scenarioBytes, runtimeBytes, lensBytes]),
    scenarioSemanticSha256,
  })
}

function registrationValue(
  contract: unknown,
  registrationId = 'group-g-retained-policy'
): EditChangeContractRegistrationV1
{
  const provenance = {
    authorityId: 'phase-8-group-g-test-authority',
    hostConfigurationSha256: 'a'.repeat(64),
    provenanceArtifactSha256: 'b'.repeat(64),
    registeredAt: '2026-07-21T00:00:00.000Z',
  }
  const displayObjective = boundedDisplayStringV1(
    'exercise retained policy registration boundaries'
  ) as EditChangeContractRegistrationV1['displayObjective']
  const withoutDisplayHash = {
    schemaVersion: 1 as const,
    registrationId,
    semanticContract: contract,
    semanticContractSha256: semanticHashV1('change-contract', contract),
    bindingDisplayEvidence: [],
    displayObjective,
    provenance,
  }
  return {
    ...withoutDisplayHash,
    semanticContract:
      withoutDisplayHash.semanticContract as EditSemanticChangeContractV1,
    displayEvidenceSha256: sha256Hex(
      canonicalJsonBytesV1({
        bindingDisplayEvidence: [],
        displayObjective,
        provenance,
      })
    ),
  }
}

function registrationBytes(
  contract: unknown,
  registrationId?: string
): Uint8Array
{
  return canonicalJsonBytesV1(registrationValue(contract, registrationId))
}

function registry(
  retainedPolicyLimits?: Partial<RetainedPolicyRegistryLimitsV1>
): EditChangeContractRegistryV1
{
  return new EditChangeContractRegistryV1({
    hostDefaultLimits: HOST_DEFAULT_LIMITS,
    hostHardLimits: HOST_HARD_LIMITS,
    ...(retainedPolicyLimits === undefined ? {} : { retainedPolicyLimits }),
  })
}

function expectRegistrationError(
  run: () => unknown,
  code: ChangeContractRegistrationErrorV1['code']
): void
{
  assert.throws(run, (error) =>
  {
    assert.ok(error instanceof ChangeContractRegistrationErrorV1)
    assert.equal(error.code, code)
    return true
  })
}

function bindRegistered(
  changeContracts: EditChangeContractRegistryV1,
  registered: RegisteredChangeContractV1
)
{
  changeContracts.seal()
  const contract = registered.registration.semanticContract
  assert.equal(contract.sourceConstraint.kind, 'exactArtifact')
  if (contract.sourceConstraint.kind !== 'exactArtifact')
    throw new Error('test contract must select an exact source artifact')
  return changeContracts.bind({
    registrationId: registered.registration.registrationId,
    expectedSemanticContractSha256:
      registered.registration.semanticContractSha256,
    source: contract.sourceConstraint,
    existingBindings: contract.entityBindings.flatMap((binding) =>
      binding.bindingKind === 'existing'
        ? [
            {
              bindingKey: binding.bindingKey,
              entityKind: binding.entityKind,
              sourceLocationSha256: binding.sourceLocationSha256,
            },
          ]
        : []
    ),
  })
}

test('canonical scenario policy registration resolves immutable exact bytes', () =>
{
  const fixture = policyFixture()
  const changeContracts = registry()
  const registered = changeContracts.registerBytes(
    registrationBytes(fixture.contract),
    fixture.artifacts
  )
  const bound = bindRegistered(changeContracts, registered)
  const retained = boundRetainedPolicyArtifactV1(
    bound,
    fixture.scenarioSemanticSha256
  )

  assert.equal(retained.binding.kind, 'scenario')
  assert.deepEqual(JSON.parse(retained.canonicalJson), fixture.scenario)
  assert.deepEqual(
    retainedPolicyArtifactBytesV1(retained),
    fixture.scenarioBytes
  )
  assert.equal(
    scenarioPolicySemanticSha256V1(retainedPolicyArtifactBytesV1(retained)),
    fixture.scenarioSemanticSha256
  )
})

test('strict policy scanning refuses malformed, excessive, & invalid artifacts', () =>
{
  const fixture = policyFixture()
  const bytes = registrationBytes(fixture.contract)
  const scannerCases = [
    {
      name: 'invalid UTF-8',
      limits: {},
      artifact: Uint8Array.from([0xff]),
    },
    {
      name: 'excessive nesting',
      limits: { maximumDepth: 2 },
      artifact: new TextEncoder().encode('[[[0]]]'),
    },
  ] as const
  for (const current of scannerCases)
  {
    expectRegistrationError(
      () => registry(current.limits).registerBytes(bytes, [current.artifact]),
      'retained-policy-strict-json-invalid'
    )
  }

  const invalidScenario = canonicalJsonBytesV1({
    ...fixture.scenario,
    maxTicks: 'one',
  })
  const invalidContract = structuredClone(fixture.contract)
  const scenarioBinding = invalidContract.policyBindings.find(
    (binding) => binding.kind === 'scenario'
  )!
  ;(
    scenarioBinding as { retainedArtifactSha256: string }
  ).retainedArtifactSha256 = sha256Hex(invalidScenario)
  expectRegistrationError(
    () =>
      registry().registerBytes(registrationBytes(invalidContract), [
        invalidScenario,
        fixture.runtimeBytes,
        fixture.lensBytes,
      ]),
    'retained-policy-invalid'
  )
})

test('registration refuses incomplete, ambiguous, unreferenced, & mistyped policy bindings', () =>
{
  const fixture = policyFixture()
  const bytes = registrationBytes(fixture.contract)
  expectRegistrationError(
    () =>
      registry().registerBytes(bytes, [
        fixture.runtimeBytes,
        fixture.lensBytes,
      ]),
    'retained-policy-artifact-missing'
  )
  expectRegistrationError(
    () =>
      registry().registerBytes(bytes, [
        fixture.scenarioBytes,
        fixture.scenarioBytes,
      ]),
    'retained-policy-artifact-duplicate'
  )
  expectRegistrationError(
    () =>
      registry().registerBytes(bytes, [
        ...fixture.artifacts,
        canonicalJsonBytesV1({ policyKind: 'unused' }),
      ]),
    'retained-policy-artifact-unreferenced'
  )

  const unsupportedVersion = structuredClone(fixture.contract)
  ;(
    unsupportedVersion.policyBindings[0] as { schemaVersion: number }
  ).schemaVersion = 2
  expectRegistrationError(
    () =>
      registry().registerBytes(
        registrationBytes(unsupportedVersion),
        fixture.artifacts
      ),
    'retained-policy-invalid'
  )

  const secondScenario = Object.freeze({ ...fixture.scenario, seed: 1 })
  const secondScenarioBytes = canonicalJsonBytesV1(secondScenario)
  const secondScenarioSha256 =
    scenarioPolicyValueSemanticSha256V1(secondScenario)
  const duplicateScenarioId = structuredClone(fixture.contract)
  ;(
    duplicateScenarioId.policyBindings as Array<
      EditSemanticChangeContractV1['policyBindings'][number]
    >
  ).push({
    bindingId: 'secondScenarioPolicy',
    kind: 'scenario',
    schemaVersion: 1,
    semanticSha256: secondScenarioSha256,
    retainedArtifactSha256: sha256Hex(secondScenarioBytes),
  })
  ;(
    duplicateScenarioId.evaluationPlans[0] as unknown as {
      scenarioPolicySha256s: string[]
    }
  ).scenarioPolicySha256s.push(secondScenarioSha256)
  expectRegistrationError(
    () =>
      registry().registerBytes(registrationBytes(duplicateScenarioId), [
        ...fixture.artifacts,
        secondScenarioBytes,
      ]),
    'retained-policy-invalid'
  )

  const wrongBindingKind = structuredClone(fixture.contract)
  const runtimeBinding = wrongBindingKind.policyBindings.find(
    (binding) => binding.kind === 'runtime'
  )!
  ;(
    wrongBindingKind.evaluationPlans[0] as unknown as {
      scenarioPolicySha256s: string[]
    }
  ).scenarioPolicySha256s = [runtimeBinding.semanticSha256]
  expectRegistrationError(
    () =>
      registry().registerBytes(
        registrationBytes(wrongBindingKind),
        fixture.artifacts
      ),
    'semantic-contract-invalid'
  )
})

test('candidate-only scenarios cannot activate baseline preservation lenses', () =>
{
  const fixture = policyFixture({
    ...BASE_SCENARIO,
    applicability: 'candidateOnly',
  })
  const registered = registry().registerBytes(
    registrationBytes(fixture.contract),
    fixture.artifacts
  )
  assert.throws(
    () =>
      activateEvaluationPlanSetV1(
        registered.registration.semanticContract,
        registered.retainedPoliciesBySemanticSha256
      ),
    (error) =>
    {
      assert.ok(error instanceof EditEvaluationPlanErrorV1)
      assert.equal(error.reason, 'candidate-only-preservation-scenario')
      return true
    }
  )
})

test('canonical content identity accepts normalized spelling but refuses raw hashes', () =>
{
  const fixture = policyFixture()
  const noncanonicalScenarioBytes = new TextEncoder().encode(
    '{ "steps" : [{"do":"greenFlag"}], "seed":0, "scenarioId":"scenario", "maxTicks":1, "fixedDateMs":0, "applicability":"baselineAndCandidate" }'
  )
  assert.equal(
    scenarioPolicySemanticSha256V1(noncanonicalScenarioBytes),
    scenarioPolicySemanticSha256V1(fixture.scenarioBytes)
  )
  const registered = registry().registerBytes(
    registrationBytes(fixture.contract),
    [noncanonicalScenarioBytes, fixture.runtimeBytes, fixture.lensBytes]
  )
  const retained =
    registered.retainedPoliciesBySemanticSha256[fixture.scenarioSemanticSha256]!
  assert.deepEqual(
    retainedPolicyArtifactBytesV1(retained),
    fixture.scenarioBytes
  )
  assert.equal(
    retained.binding.retainedArtifactSha256,
    sha256Hex(fixture.scenarioBytes)
  )

  const rawHashContract = structuredClone(fixture.contract)
  const scenarioBinding = rawHashContract.policyBindings.find(
    (binding) => binding.kind === 'scenario'
  )!
  ;(
    scenarioBinding as { retainedArtifactSha256: string }
  ).retainedArtifactSha256 = sha256Hex(noncanonicalScenarioBytes)
  expectRegistrationError(
    () =>
      registry().registerBytes(registrationBytes(rawHashContract), [
        noncanonicalScenarioBytes,
        fixture.runtimeBytes,
        fixture.lensBytes,
      ]),
    'retained-policy-artifact-hash-mismatch'
  )
})

test('retained policy quotas charge each distinct canonical artifact once', () =>
{
  const fixture = policyFixture()
  const bytes = registrationBytes(fixture.contract)
  expectRegistrationError(
    () =>
      registry({
        maximumArtifactBytes: fixture.scenarioBytes.byteLength - 1,
      }).registerBytes(bytes, fixture.artifacts),
    'retained-policy-artifact-too-large'
  )
  expectRegistrationError(
    () =>
      registry({ maximumNodesPerArtifact: 8 }).registerBytes(
        bytes,
        fixture.artifacts
      ),
    'retained-policy-strict-json-invalid'
  )
  expectRegistrationError(
    () =>
      registry({
        maximumArtifactBytesPerContract:
          fixture.scenarioBytes.byteLength +
          fixture.runtimeBytes.byteLength -
          1,
      }).registerBytes(bytes, fixture.artifacts),
    'retained-policy-artifact-too-large'
  )

  const scenarioNodes = scanStrictJson(fixture.scenarioBytes, {
    maxDepth: 64,
    maxMembersPerContainer: 16_384,
    maxNodes: 250_000,
  }).metrics.nodes
  const runtimeNodes = scanStrictJson(fixture.runtimeBytes, {
    maxDepth: 64,
    maxMembersPerContainer: 16_384,
    maxNodes: 250_000,
  }).metrics.nodes
  expectRegistrationError(
    () =>
      registry({
        maximumNodesPerContract: scenarioNodes + runtimeNodes - 1,
      }).registerBytes(bytes, fixture.artifacts),
    'retained-policy-artifact-too-large'
  )

  const sharedBytes = canonicalJsonBytesV1({
    policyKind: 'shared-runtime-and-lens',
    schemaVersion: 1,
  })
  const sharedContract = structuredClone(fixture.contract)
  for (const binding of sharedContract.policyBindings)
  {
    if (binding.kind === 'runtime' || binding.kind === 'lens')
    {
      ;(binding as { retainedArtifactSha256: string }).retainedArtifactSha256 =
        sha256Hex(sharedBytes)
    }
  }
  const sharedNodes = scanStrictJson(sharedBytes, {
    maxDepth: 64,
    maxMembersPerContainer: 16_384,
    maxNodes: 250_000,
  }).metrics.nodes
  registry({
    maximumArtifactBytesPerContract:
      fixture.scenarioBytes.byteLength + sharedBytes.byteLength,
    maximumNodesPerContract: scenarioNodes + sharedNodes,
  }).registerBytes(registrationBytes(sharedContract), [
    fixture.scenarioBytes,
    sharedBytes,
  ])
  expectRegistrationError(
    () =>
      registry().registerBytes(registrationBytes(sharedContract), [
        fixture.scenarioBytes,
        sharedBytes,
        sharedBytes,
      ]),
    'retained-policy-artifact-duplicate'
  )
})

test('registered input and returned policy bytes are defensive copies', () =>
{
  const fixture = policyFixture()
  const mutableScenarioBytes = Uint8Array.from(fixture.scenarioBytes)
  const registered = registry().registerBytes(
    registrationBytes(fixture.contract),
    [mutableScenarioBytes, fixture.runtimeBytes, fixture.lensBytes]
  )
  mutableScenarioBytes.fill(0)
  const retained =
    registered.retainedPoliciesBySemanticSha256[fixture.scenarioSemanticSha256]!
  const first = retainedPolicyArtifactBytesV1(retained)
  first.fill(0)
  const second = retainedPolicyArtifactBytesV1(retained)
  assert.deepEqual(second, fixture.scenarioBytes)
  assert.notStrictEqual(first, second)
  assert.ok(Object.isFrozen(retained))
  assert.ok(Object.isFrozen(retained.value))
  assert.ok(Object.isFrozen(retained.scenarioPolicy))
})

test('scenario semantic identity refuses stale hashes after a policy change', () =>
{
  const original = policyFixture()
  const changedScenario = Object.freeze({ ...original.scenario, seed: 1 })
  const changedBytes = canonicalJsonBytesV1(changedScenario)
  const staleContract = structuredClone(original.contract)
  const scenarioBinding = staleContract.policyBindings.find(
    (binding) => binding.kind === 'scenario'
  )!
  ;(
    scenarioBinding as { retainedArtifactSha256: string }
  ).retainedArtifactSha256 = sha256Hex(changedBytes)

  expectRegistrationError(
    () =>
      registry().registerBytes(registrationBytes(staleContract), [
        changedBytes,
        original.runtimeBytes,
        original.lensBytes,
      ]),
    'retained-policy-artifact-hash-mismatch'
  )
})
