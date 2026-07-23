// tests/edit/transaction/transaction-adversarial.test.ts
// adversarial Group B transactions, fault seams, recovery, fencing, & quota authority

import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { ProjectIR, type ProjectDelta } from '@scratch-agent/ir'
import {
  SEMANTICALLY_VALID_CHANGE_CONTRACT_SAMPLE,
  boundedDisplayStringV1,
  parseSemanticChangeContractV1,
  resolveBlockRefV1,
  resolveTargetRefV1,
  scenarioPolicyValueSemanticSha256V1,
  semanticHashV1,
  type EditApplyRequestV1,
  type EditBeginRequestV1,
  type EditChangeContractRegistrationV1,
  type EditCloseRequestV1,
  type EditLimitKeyV1,
  type EditScenarioPolicyV1,
  type EditUndoRequestV1,
  type HeadProjectionV1,
} from '@scratch-agent/ir/edit'
import { buildFixtureSb3 } from '@scratch-agent/sb3'
import { canonicalJsonBytesV1 } from '@scratch-agent/sb3/canonical-json'
import { sha256Hex } from '@scratch-agent/sb3/crypto-node'

import { EditChangeContractRegistryV1 } from '../../../packages/edit/src/contracts/change-contracts.js'
import type { EditEvaluationPortsV1 } from '../../../packages/edit/src/evaluation/evaluation-ports.js'
import { EVALUATION_LANE_ORDER_V1 } from '../../../packages/edit/src/evaluation/evaluation-plans.js'
import type { EditKernelTransactionResultV1 } from '../../../packages/edit/src/contracts/kernel-types.js'
import type { EditArtifactStorePort, EditClockPort, EditEntropyPort, HostInvocationContextV1 } from '../../../packages/edit/src/transaction/ports.js'
import { recoverRetainedEditSessionsV1 } from '../../../packages/edit/src/session/retained-session-recovery.js'
import { EditSessionErrorV1, createEditSessionRegistryForExecutorV1, createEditSessionRegistryV1, projectDeltaResourceUsageV1, type EditBeginDomainResultV1, type EditSessionRegistryV1, type EditSessionV1 } from '../../../packages/edit/src/session/session.js'
import type { EditSourceIntakeV1 } from '../../../packages/edit/src/session/source-intake.js'
import {
  KernelTestTransactionExecutorV1,
  defineKernelTestTransactionV1,
} from '../support/kernel-test-transaction.js'
import type { EditTransactionExecutorV1, EditTransactionInputV1 } from '../../../packages/edit/src/transaction/transaction.js'
import { DurableArtifactStoreError, EditArtifactStoreHostError, createDurableArtifactStore, createEditArtifactStoreHostAdapter, type DurableArtifactFaultContext, type DurableArtifactStore, type EditArtifactStoreHostAdapter } from '../../../packages/eval/src/artifacts/durable-artifacts.js'
import {
  HOST_DEFAULT_LIMITS,
  HOST_HARD_LIMITS,
  expectedHeadRequest,
} from '../../helpers/edit-host.js'

const HASH_A = 'a'.repeat(64)
const HASH_B = 'b'.repeat(64)
const HASH_C = 'c'.repeat(64)
const HASH_D = 'd'.repeat(64)
const HASH_E = 'e'.repeat(64)
const HASH_F = 'f'.repeat(64)

const RETAINED_SCENARIO_POLICY = Object.freeze({
  scenarioId: 'scenario',
  applicability: 'baselineAndCandidate',
  seed: 0,
  fixedDateMs: 0,
  maxTicks: 1,
  steps: Object.freeze([{ do: 'greenFlag' as const }]),
}) satisfies EditScenarioPolicyV1

type MutableRetainedPolicyContract = {
  policyBindings: Array<{
    kind: string
    semanticSha256: string
    retainedArtifactSha256: string
  }>
  evaluationPlans: Array<{ scenarioPolicySha256s: string[] }>
}

function attachRetainedPolicyFixturesV1(
  contract: MutableRetainedPolicyContract
): readonly Uint8Array[]
{
  const scenarioBytes = canonicalJsonBytesV1(RETAINED_SCENARIO_POLICY)
  const runtimeBytes = canonicalJsonBytesV1({
    policyKind: 'runtime',
    schemaVersion: 1,
  })
  const lensBytes = canonicalJsonBytesV1({
    policyKind: 'lens',
    schemaVersion: 1,
  })
  const bytesByKind = new Map<string, Uint8Array>([
    ['scenario', scenarioBytes],
    ['runtime', runtimeBytes],
    ['lens', lensBytes],
  ])
  const scenarioSemanticSha256 = scenarioPolicyValueSemanticSha256V1(
    RETAINED_SCENARIO_POLICY
  )
  for (const binding of contract.policyBindings)
  {
    const bytes = bytesByKind.get(binding.kind)
    assert.ok(bytes, `test policy bytes are missing for ${binding.kind}`)
    binding.retainedArtifactSha256 = sha256Hex(bytes)
    if (binding.kind === 'scenario')
      binding.semanticSha256 = scenarioSemanticSha256
  }
  for (const plan of contract.evaluationPlans)
    plan.scenarioPolicySha256s = [scenarioSemanticSha256]
  return Object.freeze([scenarioBytes, runtimeBytes, lensBytes])
}

const REGISTRY_IDENTITY = Object.freeze({
  realmSha256: HASH_A,
  profileSha256: HASH_B,
  pinnedScratchRuntimeSourceSha256: HASH_C,
  retentionPolicySha256: HASH_D,
  policyConfigVersion: 1,
})

class ManualClock implements EditClockPort
{
  #now: number

  constructor(now: number)
  {
    this.#now = now
  }

  nowEpochMs(): number
  {
    return this.#now
  }

  advance(milliseconds: number): void
  {
    this.#now += milliseconds
  }
}

class FaultController
{
  #match: ((context: DurableArtifactFaultContext) => boolean) | null = null
  #remaining = 0
  #label = 'unarmed fault'

  readonly hook = (context: DurableArtifactFaultContext): void =>
  {
    if (!this.#match?.(context)) return
    this.#remaining -= 1
    if (this.#remaining > 0) return
    const label = this.#label
    this.disarm()
    throw new Error(label)
  }

  arm(
    label: string,
    match: (context: DurableArtifactFaultContext) => boolean,
    occurrence = 1
  ): void
  {
    assert.ok(Number.isSafeInteger(occurrence) && occurrence > 0)
    this.#label = label
    this.#match = match
    this.#remaining = occurrence
  }

  disarm(): void
  {
    this.#match = null
    this.#remaining = 0
  }
}

class MismatchingExecutor implements EditTransactionExecutorV1
{
  readonly #delegate = new KernelTestTransactionExecutorV1()
  #executionCount = 0

  async execute(
    input: EditTransactionInputV1
  ): Promise<EditKernelTransactionResultV1>
  {
    this.#executionCount += 1
    if (this.#executionCount === 1) return this.#delegate.execute(input)
    return this.#delegate.execute({
      ...input,
      canonicalTransaction: stageVolumeTransaction(79),
    })
  }
}

class CountingExecutor implements EditTransactionExecutorV1
{
  executionCount = 0

  async execute(
    _input: EditTransactionInputV1
  ): Promise<EditKernelTransactionResultV1>
  {
    this.executionCount += 1
    throw new Error('counting executor must not be reached')
  }
}

class ReportedResourceExecutor implements EditTransactionExecutorV1
{
  readonly #delegate = new KernelTestTransactionExecutorV1()

  constructor(readonly summaryOverrides: Partial<ProjectDelta['summary']>)
  {}

  async execute(
    input: EditTransactionInputV1
  ): Promise<EditKernelTransactionResultV1>
  {
    const result = await this.#delegate.execute(input)
    const parentDelta = structuredClone(result.parentDelta) as ProjectDelta
    return {
      ...result,
      parentDelta: {
        ...parentDelta,
        summary: {
          ...parentDelta.summary,
          ...this.summaryOverrides,
        },
      },
    }
  }
}

class BlockingApplyExecutor implements EditTransactionExecutorV1
{
  readonly #delegate = new KernelTestTransactionExecutorV1()
  readonly applyEntered: Promise<void>
  #resolveApplyEntered!: () => void
  #releaseApply!: () => void
  readonly #applyRelease: Promise<void>
  #executionCount = 0

  constructor()
  {
    this.applyEntered = new Promise((resolve) =>
    {
      this.#resolveApplyEntered = resolve
    })
    this.#applyRelease = new Promise((resolve) =>
    {
      this.#releaseApply = resolve
    })
  }

  release(): void
  {
    this.#releaseApply()
  }

  async execute(
    input: EditTransactionInputV1
  ): Promise<EditKernelTransactionResultV1>
  {
    this.#executionCount += 1
    if (this.#executionCount === 2)
    {
      this.#resolveApplyEntered()
      await this.#applyRelease
    }
    return this.#delegate.execute(input)
  }
}

interface PreparedHarness
{
  readonly adapter: EditArtifactStoreHostAdapter
  readonly beginRequest: EditBeginRequestV1
  readonly clock: ManualClock
  readonly contracts: EditChangeContractRegistryV1
  readonly controller: FaultController
  readonly root: string
  readonly sessions: EditSessionRegistryV1
  readonly source: EditSourceIntakeV1
  readonly sourceArtifactSha256: string
  readonly sourceBytes: Uint8Array
  readonly store: EditArtifactStorePort
}

interface OpenHarness extends PreparedHarness
{
  readonly begun: EditBeginDomainResultV1
  readonly session: EditSessionV1
}

function tempRoot(t: test.TestContext, label: string): string
{
  const container = mkdtempSync(join(tmpdir(), `phase-8-adversarial-${label}-`))
  t.after(() => rmSync(container, { recursive: true, force: true }))
  return join(container, 'durable-store')
}

function deterministicEntropy(seed: number): EditEntropyPort
{
  let sequence = seed
  return {
    randomBytes(byteLength: number): Uint8Array
    {
      const bytes = new Uint8Array(byteLength)
      for (let index = 0; index < byteLength; index += 1)
        bytes[index] = (sequence + index * 31) & 0xff
      sequence += byteLength + 19
      return bytes
    },
  }
}

function invocation(ordinal: number): HostInvocationContextV1
{
  return {
    boundaryKind: 'directHost',
    invocationSha256: ordinal.toString(16).padStart(64, '0'),
    principalSha256: HASH_E,
  }
}

function stageVolumeTransaction(
  value: number
): ReturnType<typeof defineKernelTestTransactionV1>
{
  return defineKernelTestTransactionV1([
    {
      kind: 'kernel.test.setTargetNumber',
      opId: 'set-stage-volume',
      targetIndex: 0,
      property: 'volume',
      value: { kind: 'literal', value },
    },
  ])
}

function sourceIntake(
  bytes: Uint8Array,
  sourceArtifactSha256: string,
  projectSessionId: string
): EditSourceIntakeV1
{
  return {
    bytes,
    displayName: `${projectSessionId}.sb3`,
    expectedArtifactSha256: sourceArtifactSha256,
    provenance: {
      kind: 'projectSession',
      projectSessionId,
      selectedDisplayName: `${projectSessionId}.sb3`,
      canonicalRealpath: `/virtual/${projectSessionId}.sb3`,
      device: 'test-device',
      inode: `inode-${projectSessionId}`,
      byteLength: bytes.byteLength,
      modifiedAtNanoseconds: '1753056000000000000',
      sourceInspectionPolicySha256: HASH_A,
      diagnosticPolicySha256: HASH_B,
      runtimePolicySha256: HASH_C,
      provenanceRegistrationSha256: HASH_D,
    },
    recheck: async () => ({
      ok: true,
      observedArtifactSha256: sourceArtifactSha256,
    }),
  }
}

function registeredContract(
  sourceArtifactSha256: string,
  limitOverrides: readonly {
    readonly key: EditLimitKeyV1
    readonly value: number
  }[] = []
): EditChangeContractRegistryV1
{
  const candidate = structuredClone(SEMANTICALLY_VALID_CHANGE_CONTRACT_SAMPLE)
  candidate.sourceConstraint = {
    kind: 'exactArtifact',
    sourceArtifactSha256,
  }
  candidate.entityBindings = []
  candidate.allowedSemanticScopes = [
    {
      scopeSubjectKind: 'project',
      operationKind: 'target.setStageProperties',
      locationScope: { scopeKind: 'project' },
      allowedProjectPropertyPaths: [],
    },
  ]
  candidate.allowedStructuralChanges = []
  candidate.limitOverrides = structuredClone(limitOverrides)
  const retainedPolicyArtifacts = attachRetainedPolicyFixturesV1(
    candidate as unknown as MutableRetainedPolicyContract
  )
  const parsed = parseSemanticChangeContractV1(candidate)
  assert.equal(parsed.ok, true)
  if (!parsed.ok) throw new Error('adversarial change contract is invalid')
  const provenance = {
    authorityId: 'phase-8-host-authority',
    hostConfigurationSha256: HASH_A,
    provenanceArtifactSha256: HASH_B,
    registeredAt: '2026-07-20T00:00:00.000Z',
  }
  const displayObjective = boundedDisplayStringV1(
    'exercise adversarial Group B lifecycle authority'
  ) as EditChangeContractRegistrationV1['displayObjective']
  const registration: EditChangeContractRegistrationV1 = {
    schemaVersion: 1,
    registrationId: 'phase-8-adversarial-contract',
    semanticContract: parsed.value,
    semanticContractSha256: semanticHashV1('change-contract', parsed.value),
    bindingDisplayEvidence: [],
    displayObjective,
    provenance,
    displayEvidenceSha256: sha256Hex(
      canonicalJsonBytesV1({
        bindingDisplayEvidence: [],
        displayObjective,
        provenance,
      })
    ),
  }
  const registry = new EditChangeContractRegistryV1({
    hostDefaultLimits: HOST_DEFAULT_LIMITS,
    hostHardLimits: HOST_HARD_LIMITS,
  })
  registry.registerBytes(
    canonicalJsonBytesV1(registration),
    retainedPolicyArtifacts
  )
  registry.seal()
  return registry
}

async function prepareHarness(
  t: test.TestContext,
  label: string,
  options: {
    executor?: EditTransactionExecutorV1
    evaluationPorts?: EditEvaluationPortsV1
    limitOverrides?: readonly {
      readonly key: EditLimitKeyV1
      readonly value: number
    }[]
    policy?: Parameters<
      typeof createEditSessionRegistryForExecutorV1
    >[0]['policy']
    productionExecutor?: boolean
    maxBytes?: number
  } = {}
): Promise<PreparedHarness>
{
  const root = tempRoot(t, label)
  const fixture = await buildFixtureSb3()
  const sourceBytes = fixture.sb3
  const sourceArtifactSha256 = sha256Hex(sourceBytes)
  const contracts = registeredContract(
    sourceArtifactSha256,
    options.limitOverrides
  )
  const registration = contracts.get('phase-8-adversarial-contract')
  const controller = new FaultController()
  const adapter = createEditArtifactStoreHostAdapter(root, {
    faultHook: controller.hook,
    ...(options.maxBytes === undefined ? {} : { maxBytes: options.maxBytes }),
  })
  const store = adapter
  const clock = new ManualClock(1_753_056_000_000)
  const registryOptions = {
    artifactStore: store,
    changeContracts: contracts,
    identity: REGISTRY_IDENTITY,
    clock,
    entropy: deterministicEntropy(23),
    handleSecret: new Uint8Array(32).fill(0x51),
    ...(options.evaluationPorts === undefined
      ? {}
      : { evaluationPorts: options.evaluationPorts }),
    ...(options.policy === undefined ? {} : { policy: options.policy }),
  }
  const sessions = options.productionExecutor
    ? createEditSessionRegistryV1(registryOptions)
    : createEditSessionRegistryForExecutorV1(
        registryOptions,
        options.executor ?? new KernelTestTransactionExecutorV1()
      )
  const projectSessionId = `project-${label}`
  return {
    adapter,
    beginRequest: {
      schemaVersion: 1,
      requestId: `begin-${label}`,
      baseline: {
        kind: 'projectSession',
        projectSessionId,
        expectedSourceArtifactSha256: sourceArtifactSha256,
      },
      changeContractRegistrationId: registration.registration.registrationId,
      expectedSemanticContractSha256:
        registration.registration.semanticContractSha256,
    },
    clock,
    contracts,
    controller,
    root,
    sessions,
    source: sourceIntake(sourceBytes, sourceArtifactSha256, projectSessionId),
    sourceArtifactSha256,
    sourceBytes,
    store,
  }
}

async function openHarness(
  t: test.TestContext,
  label: string,
  options: Parameters<typeof prepareHarness>[2] = {}
): Promise<OpenHarness>
{
  const prepared = await prepareHarness(t, label, options)
  const begun = await prepared.sessions.begin(
    prepared.beginRequest,
    prepared.source,
    invocation(1)
  )
  return {
    ...prepared,
    begun,
    session: prepared.sessions.session(begun.sessionId),
  }
}

async function preview(
  harness: OpenHarness,
  transaction: unknown,
  requestId: string,
  ordinal: number
)
{
  return harness.session.preview(
    {
      requestId,
      expectedHead: harness.session.head,
      canonicalTransaction: transaction,
    },
    invocation(ordinal)
  )
}

async function previewAndApplyRequest(
  harness: OpenHarness,
  transaction: unknown,
  requestId: string,
  ordinal: number
): Promise<EditApplyRequestV1>
{
  const result = await preview(
    harness,
    transaction,
    `preview-${requestId}`,
    ordinal
  )
  return {
    schemaVersion: 1,
    sessionId: harness.session.sessionId,
    requestId,
    ...expectedHeadRequest(result.preview.expectedHead),
    previewId: result.preview.previewId,
    applyGuardSha256: result.preview.applyGuardSha256,
    expectedResolvedPlanSha256: result.preview.resolvedPlanSha256,
  }
}

async function rejection(operation: () => Promise<unknown>): Promise<unknown>
{
  try
  {
    await operation()
  }
  catch (error)
  {
    return error
  }
  assert.fail('expected operation to reject')
}

function assertCode(error: unknown, code: string): void
{
  assert.ok(error instanceof Error)
  assert.equal(
    'code' in error && typeof error.code === 'string' ? error.code : null,
    code
  )
}

async function inventory(
  store: EditArtifactStorePort,
  prefix: string
): Promise<readonly { key: string; sha256: string; byteLength: number }[]>
{
  return [...(await store.listImmutable(prefix))]
    .map(({ key, sha256, byteLength }) => ({ key, sha256, byteLength }))
    .sort((left, right) => left.key.localeCompare(right.key))
}

function describedTwoBlockTransaction(): unknown
{
  return {
    schemaVersion: 1,
    operations: [
      {
        kind: 'script.add',
        opId: 'describe-two-blocks',
        root: {
          rootKind: 'eventScript',
          hat: {
            nodeKind: 'ordinary',
            opcode: 'event_whenflagclicked',
            fields: [],
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
      },
    ],
  }
}

function structuralMatchReference(
  entityKind: 'target' | 'block',
  scope: unknown,
  criterion: unknown
): Record<string, unknown>
{
  return {
    entityKind,
    refKind: 'structural',
    selectorKind: 'matchSet',
    scope,
    criteria: { conjunction: [criterion] },
    expectedMatchCount: 1,
    expectedOrderedMatchSetSha256: HASH_A,
    selection: { kind: 'occurrence', zeroBasedIndex: 0 },
    expectedSelectedFullLocationSha256: HASH_B,
    expectedSelectedSemanticFingerprint: HASH_C,
    expectedSelectedContextFingerprint: HASH_D,
  }
}

test('bound intent and impact limits meter described blocks and authoritative delta records', async (t) =>
{
  const counting = new CountingExecutor()
  const intent = await openHarness(t, 'intent-resource-limit', {
    executor: counting,
    limitOverrides: [{ key: 'intentBudgetLimit', value: 1 }],
  })
  const intentError = await rejection(() =>
    preview(
      intent,
      describedTwoBlockTransaction(),
      'preview-described-two-blocks',
      2
    )
  )
  assertCode(intentError, 'edit.intent_budget_exceeded')
  assert.equal(counting.executionCount, 0)
  assert.deepEqual((intentError as EditSessionErrorV1).context, {
    limit: 1,
    observed: 2,
  })

  const impact = await openHarness(t, 'impact-resource-limit', {
    executor: new ReportedResourceExecutor({ changedBlockRecords: 2 }),
    limitOverrides: [{ key: 'impactBudgetLimit', value: 1 }],
  })
  const impactError = await rejection(() =>
    preview(
      impact,
      stageVolumeTransaction(72),
      'preview-two-touched-block-records',
      2
    )
  )
  assertCode(impactError, 'edit.impact_budget_exceeded')
  assert.deepEqual((impactError as EditSessionErrorV1).context, {
    limit: 1,
    observed: 2,
  })

  const zeroBlockImpact = await openHarness(t, 'zero-block-impact', {
    limitOverrides: [{ key: 'impactBudgetLimit', value: 0 }],
  })
  const accepted = await preview(
    zeroBlockImpact,
    stageVolumeTransaction(72),
    'preview-zero-block-impact',
    2
  )
  assert.equal(accepted.preview.operationCount, 1)
})

test('target-removal roots count every declaration while media lineage views dedupe', () =>
{
  const variables = Object.fromEntries(
    Array.from({ length: 260 }, (_, index) => [
      `variable-${index}`,
      [`variable ${index}`, index],
    ])
  )
  const lists = Object.fromEntries(
    Array.from({ length: 3 }, (_, index) => [
      `list-${index}`,
      [`list ${index}`, []],
    ])
  )
  const broadcasts = {
    'broadcast-0': 'broadcast 0',
    'broadcast-1': 'broadcast 1',
  }
  const usage = projectDeltaResourceUsageV1({
    complete: true,
    targets: [
      {
        targetIndex: 1,
        operationIds: ['remove-sprite'],
        touchedScripts: [],
        blockChanges: [],
        declarationChanges: [
          {
            path: '/targets/1/variables',
            kind: 'removed',
            before: variables,
            operationIds: ['remove-sprite'],
          },
          {
            path: '/targets/1/lists',
            kind: 'removed',
            before: lists,
            operationIds: ['remove-sprite'],
          },
          {
            path: '/targets/1/lists/list-0',
            kind: 'removed',
            before: lists['list-0'],
            operationIds: ['remove-sprite'],
          },
          {
            path: '/targets/1/broadcasts',
            kind: 'removed',
            before: broadcasts,
            operationIds: ['remove-sprite'],
          },
        ],
        gameplayPropertyChanges: [],
        assetMetadataChanges: [
          {
            path: '/targets/1/costumes/0/name',
            kind: 'removed',
            before: 'costume',
            operationIds: ['remove-sprite'],
            entityLineageIds: ['costume-lineage'],
          },
          {
            path: '/targets/1/costumes/0/md5ext',
            kind: 'removed',
            before: 'costume.png',
            operationIds: ['remove-sprite'],
            entityLineageIds: ['costume-lineage'],
          },
        ],
        existingEditorLayoutChanges: [],
        structureChanges: [],
        unknownChanges: [],
      },
    ],
    assets: [],
    projectChanges: [],
    protectedChanges: [],
    orderedCollectionChanges: [
      {
        collectionKind: 'costumes',
        collectionPath: '/targets/1/costumes',
        ownerLineageId: 'target-lineage',
        lineageId: 'costume-lineage',
        kind: 'removed',
        beforeIndex: 0,
        operationIds: ['remove-sprite'],
      },
    ],
    summary: {
      touchedTargets: 1,
      touchedScripts: 0,
      addedBlocks: 0,
      removedBlocks: 0,
      changedBlockRecords: 0,
      changedAuthoredBlocks: 0,
      graphLinkOnlyBlocks: 0,
      changedDeclarations: 265,
      changedGameplayProperties: 0,
      changedExistingEditorLayout: 0,
      changedAssets: 1,
      changedProjectMetadata: 0,
      changedUnknownFields: 0,
    },
  })
  assert.equal(usage.declarations, 265)
  assert.equal(usage.media, 1)
})

test('target and Group C match selectors enforce the active candidate ceiling at every scope', async () =>
{
  const fixture = await buildFixtureSb3()
  const project = await ProjectIR.fromSb3(fixture.sb3)
  const targetReference = structuralMatchReference(
    'target',
    { scopeKind: 'project' },
    {
      criterionKind: 'property',
      semanticSurface: 'target',
      property: 'name',
    }
  )
  assert.throws(
    () =>
      resolveTargetRefV1(project, targetReference as never, {
        activeMatchCandidateLimit: 1,
      }),
    (error: unknown) =>
      (error as { code?: string; context?: unknown }).code ===
        'edit.impact_budget_exceeded' &&
      assert.deepEqual((error as { context?: unknown }).context, {
        limit: 1,
        observed: 2,
      }) === undefined
  )

  const blockReference = structuralMatchReference(
    'block',
    { scopeKind: 'project' },
    { criterionKind: 'opcode', opcode: 'event_whenflagclicked' }
  )
  assert.throws(
    () =>
      resolveBlockRefV1(project, blockReference as never, {
        activeMatchCandidateLimit: 0,
      }),
    (error: unknown) =>
      (error as { code?: string; context?: unknown }).code ===
        'edit.impact_budget_exceeded' &&
      assert.deepEqual((error as { context?: unknown }).context, {
        limit: 0,
        observed: 1,
      }) === undefined
  )

  const nestedBlockReference = {
    ...blockReference,
    scope: { scopeKind: 'target', target: targetReference },
  } as never
  assert.throws(
    () =>
      resolveBlockRefV1(project, nestedBlockReference, {
        activeMatchCandidateLimit: 16,
        target: { activeMatchCandidateLimit: 1 },
      }),
    (error: unknown) =>
      (error as { code?: string; context?: unknown }).code ===
        'edit.impact_budget_exceeded' &&
      assert.deepEqual((error as { context?: unknown }).context, {
        limit: 1,
        observed: 2,
      }) === undefined
  )
})

test('contract evaluation-attempt override stops execution before the port', async (t) =>
{
  let evaluationCalls = 0
  const evaluationPorts = {
    deterministic: {
      runnerAvailabilityV1: () =>
        EVALUATION_LANE_ORDER_V1.map((lane) => ({
          lane,
          availability: 'unavailable' as const,
          availabilityEpoch: 1,
        })),
      async evaluate(): Promise<never>
      {
        evaluationCalls += 1
        throw new Error('evaluation port must not be reached')
      },
    },
  } as EditEvaluationPortsV1
  const evaluation = await openHarness(t, 'zero-evaluation-limit', {
    evaluationPorts,
    limitOverrides: [{ key: 'evaluationAttemptsPerSessionLimit', value: 0 }],
  })
  const evaluationError = await rejection(() =>
    evaluation.session.evaluate(
      {
        schemaVersion: 1,
        action: 'start',
        sessionId: evaluation.session.sessionId,
        requestId: 'evaluate-over-contract-limit',
        evaluationPlanId: 'export-plan',
        ...expectedHeadRequest(evaluation.session.head),
      },
      invocation(2)
    )
  )
  assertCode(evaluationError, 'edit.session_budget_exceeded')
  assert.equal(evaluationCalls, 0)
  assert.deepEqual((evaluationError as EditSessionErrorV1).context, {
    limit: 0,
    observed: 1,
  })
})

test('immutable session evidence is fully reflected in the live budget', async (t) =>
{
  const accounting = await openHarness(t, 'immutable-artifact-accounting')
  const sessionPrefix = `sessions/${accounting.session.manifest.sessionKey}`
  const initialEntries = await inventory(accounting.store, sessionPrefix)
  const immutableBytes = (
    entries: readonly { readonly key: string; readonly byteLength: number }[]
  ): number =>
    entries
      .filter(
        (entry) =>
          !entry.key.endsWith('/head.json') &&
          !entry.key.endsWith('/current-report.json') &&
          !entry.key.endsWith('/idempotency-index.json') &&
          !entry.key.endsWith('/quota-state.json')
      )
      .reduce((total, entry) => total + entry.byteLength, 0)
  const initialBytes = immutableBytes(initialEntries)
  const initialBudget = accounting.session.status().budget.artifactBytesUsed
  assert.ok(
    initialBudget >= initialBytes,
    'opening immutable evidence exceeds the charged artifact budget'
  )
  await preview(
    accounting,
    stageVolumeTransaction(72),
    'preview-retained-accounting',
    2
  )
  const previewEntries = await inventory(accounting.store, sessionPrefix)
  const previewBytes = immutableBytes(previewEntries)
  const previewBudget = accounting.session.status().budget.artifactBytesUsed
  assert.ok(previewBytes > initialBytes)
  assert.ok(
    previewBudget - initialBudget >= previewBytes - initialBytes,
    `preview, attempt, event, or report evidence was retained without charge: budget delta ${previewBudget - initialBudget}, immutable delta ${previewBytes - initialBytes}`
  )
  const capability = await accounting.session.retainedCapabilityFactsV1()
  assert.deepEqual(capability.head, accounting.session.head)
  assert.equal(
    capability.snapshot.capabilitySnapshotSha256,
    capability.head.capabilitySnapshotSha256
  )
  assert.equal(
    capability.evidenceIds.at(-1),
    capability.head.capabilitySnapshotSha256
  )
})

test('zero contract artifact ceiling refuses before a session artifact exists', async (t) =>
{
  const capped = await prepareHarness(t, 'zero-artifact-limit', {
    limitOverrides: [{ key: 'artifactBytesPerSessionLimit', value: 0 }],
  })
  const [artifactOverride] = capped.contracts.get(
    'phase-8-adversarial-contract'
  ).registration.semanticContract.limitOverrides
  assert.equal(artifactOverride?.key, 'artifactBytesPerSessionLimit')
  assert.equal(artifactOverride?.value, 0)
  const artifactError = await rejection(() =>
    capped.sessions.begin(capped.beginRequest, capped.source, invocation(1))
  )
  assert.ok(
    artifactError instanceof EditSessionErrorV1,
    artifactError instanceof Error ? artifactError.stack : String(artifactError)
  )
  assertCode(artifactError, 'edit.artifact_quota_exceeded')
  assert.deepEqual(await inventory(capped.store, 'sessions'), [])
})

test('partial opening capacity refuses before retaining any session prefix', async (t) =>
{
  const capped = await prepareHarness(t, 'partial-opening-artifact-limit', {
    limitOverrides: [{ key: 'artifactBytesPerSessionLimit', value: 4_096 }],
  })
  const artifactError = await rejection(() =>
    capped.sessions.begin(capped.beginRequest, capped.source, invocation(1))
  )
  assertCode(artifactError, 'edit.artifact_quota_exceeded')
  assert.match((artifactError as Error).message, /opening session artifacts/u)
  assert.deepEqual(await inventory(capped.store, 'sessions'), [])
})

test('stale head components fail closed with exact refusal idempotency', async (t) =>
{
  const harness = await openHarness(t, 'stale-head')
  const head = harness.session.head
  const cases: readonly {
    readonly label: string
    readonly expectedCode: string
    readonly expectedHead: HeadProjectionV1
  }[] = [
    {
      label: 'revision-number',
      expectedCode: 'edit.stale_revision',
      expectedHead: { ...head, revisionNumber: head.revisionNumber + 1 },
    },
    {
      label: 'revision-id',
      expectedCode: 'edit.stale_revision',
      expectedHead: { ...head, revisionId: HASH_F },
    },
    {
      label: 'candidate',
      expectedCode: 'edit.stale_candidate',
      expectedHead: { ...head, candidateSha256: HASH_F },
    },
    {
      label: 'contract',
      expectedCode: 'edit.stale_contract',
      expectedHead: { ...head, changeContractSha256: HASH_F },
    },
    {
      label: 'capability-profile',
      expectedCode: 'edit.stale_capability_profile',
      expectedHead: { ...head, capabilityProfileSha256: HASH_F },
    },
    {
      label: 'capability-snapshot',
      expectedCode: 'edit.stale_capability_snapshot',
      expectedHead: { ...head, capabilitySnapshotSha256: HASH_F },
    },
    {
      label: 'source-artifact',
      expectedCode: 'edit.source_identity_mismatch',
      expectedHead: { ...head, sourceArtifactSha256: HASH_F },
    },
    {
      label: 'asset-manifest',
      expectedCode: 'edit.source_identity_mismatch',
      expectedHead: { ...head, assetManifestSha256: HASH_F },
    },
  ]
  for (const [index, stale] of cases.entries())
  {
    const request = {
      requestId: `stale-${stale.label}`,
      expectedHead: stale.expectedHead,
      canonicalTransaction: stageVolumeTransaction(72),
    }
    const first = await rejection(() =>
      harness.session.preview(request, invocation(10 + index))
    )
    assertCode(first, stale.expectedCode)
    const afterRefusal = await inventory(
      harness.store,
      `sessions/${harness.session.manifest.sessionKey}`
    )
    const retry = await rejection(() =>
      harness.session.preview(request, invocation(10 + index))
    )
    assertCode(retry, stale.expectedCode)
    assert.deepEqual(
      await inventory(
        harness.store,
        `sessions/${harness.session.manifest.sessionKey}`
      ),
      afterRefusal
    )
    assert.deepEqual(harness.session.head, head)
  }
})

test('same request ID with different canonical input is a hash conflict', async (t) =>
{
  const harness = await openHarness(t, 'request-conflict')
  const firstRequest = {
    requestId: 'shared-preview-id',
    expectedHead: {
      ...harness.session.head,
      candidateSha256: HASH_F,
    },
    canonicalTransaction: stageVolumeTransaction(72),
  }
  assertCode(
    await rejection(() => harness.session.preview(firstRequest, invocation(2))),
    'edit.stale_candidate'
  )
  const conflictingRequest = {
    ...firstRequest,
    canonicalTransaction: stageVolumeTransaction(73),
  }
  assertCode(
    await rejection(() =>
      harness.session.preview(conflictingRequest, invocation(2))
    ),
    'edit.request_id_conflict'
  )
  assert.equal(harness.session.revisions.length, 1)
})

test('invalid transaction descriptors retain precise semantic refusals', async (t) =>
{
  const harness = await openHarness(t, 'descriptor-refusals')
  const descriptors: readonly {
    readonly code: string
    readonly id: string
    readonly transaction: unknown
  }[] = [
    {
      id: 'duplicate-operation-id',
      code: 'edit.duplicate_op_id',
      transaction: {
        schemaVersion: 1,
        descriptorKind: 'phase8-group-b-kernel-test-v1',
        operations: [
          {
            kind: 'kernel.test.constant',
            opId: 'duplicate',
            resultKey: 'first',
            value: 1,
          },
          {
            kind: 'kernel.test.constant',
            opId: 'duplicate',
            resultKey: 'second',
            value: 2,
          },
        ],
      },
    },
    {
      id: 'missing-result-dependency',
      code: 'edit.created_result_invalid',
      transaction: {
        schemaVersion: 1,
        descriptorKind: 'phase8-group-b-kernel-test-v1',
        operations: [
          {
            kind: 'kernel.test.setTargetNumber',
            opId: 'consume-missing',
            targetIndex: 0,
            property: 'volume',
            value: {
              kind: 'result',
              opId: 'absent-producer',
              resultKey: 'value',
            },
          },
        ],
      },
    },
    {
      id: 'dependency-cycle',
      code: 'edit.graph_cycle',
      transaction: {
        schemaVersion: 1,
        descriptorKind: 'phase8-group-b-kernel-test-v1',
        operations: [
          {
            kind: 'kernel.test.setTargetNumber',
            opId: 'cycle-a',
            targetIndex: 0,
            property: 'volume',
            value: {
              kind: 'result',
              opId: 'cycle-b',
              resultKey: 'value',
            },
          },
          {
            kind: 'kernel.test.setTargetNumber',
            opId: 'cycle-b',
            targetIndex: 1,
            property: 'x',
            value: {
              kind: 'result',
              opId: 'cycle-a',
              resultKey: 'value',
            },
          },
        ],
      },
    },
    {
      id: 'semantic-no-op',
      code: 'edit.semantic_noop',
      transaction: stageVolumeTransaction(100),
    },
  ]
  for (const [index, descriptor] of descriptors.entries())
  {
    assertCode(
      await rejection(() =>
        harness.session.preview(
          {
            requestId: descriptor.id,
            expectedHead: harness.session.head,
            canonicalTransaction: descriptor.transaction,
          },
          invocation(20 + index)
        )
      ),
      descriptor.code
    )
  }
  assert.equal(harness.session.revisions.length, 1)
  assert.equal(harness.session.status().state, 'active')
})

test('the production executor refuses the private Group B descriptor', async (t) =>
{
  const harness = await openHarness(t, 'production-executor', {
    productionExecutor: true,
  })
  assertCode(
    await rejection(() =>
      harness.session.preview(
        {
          requestId: 'production-private-descriptor',
          expectedHead: harness.session.head,
          canonicalTransaction: stageVolumeTransaction(72),
        },
        invocation(2)
      )
    ),
    'edit.unsupported_operation'
  )
  assert.equal(harness.session.revisions.length, 1)
})

test('lease expiry durably abandons the session before retaining an attempt', async (t) =>
{
  const harness = await openHarness(t, 'lease-expiry', {
    policy: { idleLeaseMs: 5, absoluteLeaseMs: 10 },
  })
  const before = await inventory(
    harness.store,
    `sessions/${harness.session.manifest.sessionKey}`
  )
  harness.clock.advance(11)
  assertCode(
    await rejection(() =>
      harness.session.preview(
        {
          requestId: 'expired-preview',
          expectedHead: harness.session.head,
          canonicalTransaction: stageVolumeTransaction(72),
        },
        invocation(2)
      )
    ),
    'edit.interrupted'
  )
  assert.equal(harness.session.status().state, 'closed-abandoned')
  const after = await inventory(
    harness.store,
    `sessions/${harness.session.manifest.sessionKey}`
  )
  assert.ok(after.length > before.length)
  assert.ok(after.some((entry) => entry.key.includes('/events/')))
  assert.ok(after.some((entry) => entry.key.includes('/reports/')))
})

test('active-session capacity refuses excess work and releases on close', async (t) =>
{
  const harness = await openHarness(t, 'capacity', {
    policy: { activeSessionLimit: 1 },
  })
  const secondProjectSessionId = 'project-capacity-second'
  const secondSource = sourceIntake(
    harness.sourceBytes,
    harness.sourceArtifactSha256,
    secondProjectSessionId
  )
  const registration = harness.contracts.get('phase-8-adversarial-contract')
  const secondBegin: EditBeginRequestV1 = {
    schemaVersion: 1,
    requestId: 'begin-capacity-second',
    baseline: {
      kind: 'projectSession',
      projectSessionId: secondProjectSessionId,
      expectedSourceArtifactSha256: harness.sourceArtifactSha256,
    },
    changeContractRegistrationId: registration.registration.registrationId,
    expectedSemanticContractSha256:
      registration.registration.semanticContractSha256,
  }
  assertCode(
    await rejection(() =>
      harness.sessions.begin(secondBegin, secondSource, invocation(2))
    ),
    'edit.capacity_exceeded'
  )
  assert.equal(harness.sessions.sessions().length, 1)
  const closeRequest: EditCloseRequestV1 = {
    schemaVersion: 1,
    sessionId: harness.session.sessionId,
    requestId: 'close-capacity-first',
    reason: 'release active capacity',
    ...expectedHeadRequest(harness.session.head),
  }
  await harness.session.close(closeRequest, invocation(3))
  const second = await harness.sessions.begin(
    { ...secondBegin, requestId: 'begin-capacity-after-close' },
    secondSource,
    invocation(4)
  )
  assert.equal(second.state, 'active')
  assert.equal(harness.sessions.sessions().length, 2)
})

test('preview/apply recomputation mismatch never advances the head', async (t) =>
{
  const harness = await openHarness(t, 'preview-apply-mismatch', {
    executor: new MismatchingExecutor(),
  })
  const initialHead = harness.session.head
  const request = await previewAndApplyRequest(
    harness,
    stageVolumeTransaction(78),
    'apply-mismatch',
    2
  )
  assertCode(
    await rejection(() => harness.session.apply(request, invocation(3))),
    'edit.preview_apply_mismatch'
  )
  assert.deepEqual(harness.session.head, initialHead)
  assert.equal(harness.session.revisions.length, 1)
  assert.equal(harness.session.status().state, 'active')
})

test('apply preserves its restore reserve at the revision boundary', async (t) =>
{
  const harness = await openHarness(t, 'restore-reserve', {
    policy: { acceptedRevisionLimit: 3 },
  })
  const initialHead = harness.session.head
  const firstRequest = await previewAndApplyRequest(
    harness,
    stageVolumeTransaction(70),
    'apply-first-reserved',
    2
  )
  const first = await harness.session.apply(firstRequest, invocation(3))
  const secondRequest = await previewAndApplyRequest(
    harness,
    stageVolumeTransaction(71),
    'apply-would-consume-reserve',
    4
  )
  assertCode(
    await rejection(() => harness.session.apply(secondRequest, invocation(5))),
    'edit.session_budget_exceeded'
  )
  assert.equal(harness.session.head.revisionId, first.revisionId)
  const undoRequest: EditUndoRequestV1 = {
    schemaVersion: 1,
    sessionId: harness.session.sessionId,
    requestId: 'undo-with-held-reserve',
    ...expectedHeadRequest(harness.session.head),
    expectedUndoableApplyRevisionId: first.revisionId,
  }
  const undo = await harness.session.undo(undoRequest, invocation(6))
  assert.equal(undo.restoreKind, 'undo')
  assert.equal(undo.selectedRevision.revisionId, initialHead.revisionId)
  assert.equal(undo.head.candidateSha256, initialHead.candidateSha256)
  assert.equal(harness.session.revisions.length, 3)
  assert.equal(harness.session.status().budget.restoreReserveHeld, false)
})

test('concurrent apply admits exactly one transition', async (t) =>
{
  const executor = new BlockingApplyExecutor()
  const harness = await openHarness(t, 'concurrent-apply', { executor })
  const previewResult = await preview(
    harness,
    stageVolumeTransaction(69),
    'preview-concurrent-apply',
    2
  )
  const base = {
    schemaVersion: 1 as const,
    sessionId: harness.session.sessionId,
    ...expectedHeadRequest(previewResult.preview.expectedHead),
    previewId: previewResult.preview.previewId,
    applyGuardSha256: previewResult.preview.applyGuardSha256,
    expectedResolvedPlanSha256: previewResult.preview.resolvedPlanSha256,
  }
  const firstPromise = harness.session.apply(
    { ...base, requestId: 'concurrent-apply-first' },
    invocation(3)
  )
  await executor.applyEntered
  const secondPromise = harness.session.apply(
    { ...base, requestId: 'concurrent-apply-second' },
    invocation(4)
  )
  executor.release()
  const outcomes = await Promise.allSettled([firstPromise, secondPromise])
  assert.equal(
    outcomes.filter((outcome) => outcome.status === 'fulfilled').length,
    1
  )
  const rejected = outcomes.find(
    (outcome): outcome is PromiseRejectedResult => outcome.status === 'rejected'
  )
  assert.ok(rejected)
  assertCode(rejected.reason, 'edit.session_busy')
  assert.equal(harness.session.revisions.length, 2)
  assert.equal(harness.session.head.revisionNumber, 1)
})

function thrown(operation: () => unknown): unknown
{
  try
  {
    operation()
  }
  catch (error)
  {
    return error
  }
  assert.fail('expected operation to throw')
}

function directStore(
  t: test.TestContext,
  label: string,
  controller: FaultController,
  maxBytes = 8 * 1024 * 1024
): { root: string; store: DurableArtifactStore }
{
  const root = tempRoot(t, label)
  return {
    root,
    store: createDurableArtifactStore(root, {
      faultHook: controller.hook,
      maxBytes,
    }),
  }
}

test('immutable create faults distinguish before-install from after-install', (t) =>
{
  const controller = new FaultController()
  const { store } = directStore(t, 'immutable-seams', controller)
  const beforeBytes = new TextEncoder().encode('before-install')
  controller.arm(
    'immutable before install',
    (context) =>
      context.point === 'immutable.beforeInstall' &&
      context.key === 'objects/before.bin'
  )
  const beforeError = thrown(() =>
    store.createImmutable('objects/before.bin', beforeBytes)
  )
  assert.ok(beforeError instanceof DurableArtifactStoreError)
  assert.equal(beforeError.finalInstalled, false)
  assert.equal(beforeError.tempProof?.sha256, sha256Hex(beforeBytes))
  assertCode(
    thrown(() => store.readImmutable('objects/before.bin')),
    'entry-not-found'
  )

  const afterBytes = new TextEncoder().encode('after-install')
  controller.arm(
    'immutable after install',
    (context) =>
      context.point === 'immutable.afterInstall' &&
      context.key === 'objects/after.bin'
  )
  const afterError = thrown(() =>
    store.createImmutable('objects/after.bin', afterBytes)
  )
  assert.ok(afterError instanceof DurableArtifactStoreError)
  assert.equal(afterError.finalInstalled, true)
  assert.equal(afterError.tempProof?.sha256, sha256Hex(afterBytes))
  assert.deepEqual(store.readImmutable('objects/after.bin'), afterBytes)
  assert.deepEqual(
    store.createOrVerifyImmutable('objects/after.bin', afterBytes),
    { sha256: sha256Hex(afterBytes), byteLength: afterBytes.byteLength }
  )
})

test('pointer faults reconcile exact old, new, and interference states', (t) =>
{
  const controller = new FaultController()
  const { store } = directStore(t, 'pointer-seams', controller)
  const oldBytes = new TextEncoder().encode('old-pointer')
  const proposedBytes = new TextEncoder().encode('proposed-pointer')
  const old = store.compareAndSwapPointer('pointers/head.json', null, oldBytes)

  controller.arm(
    'pointer before install',
    (context) =>
      context.point === 'pointer.beforeInstall' &&
      context.key === 'pointers/head.json'
  )
  const beforeError = thrown(() =>
    store.compareAndSwapPointer('pointers/head.json', old.sha256, proposedBytes)
  )
  assert.ok(beforeError instanceof DurableArtifactStoreError)
  assert.equal(beforeError.finalInstalled, false)
  assert.deepEqual(
    store.reconcilePointer('pointers/head.json', old.sha256, proposedBytes),
    {
      status: 'old',
      observedSha256: old.sha256,
      proposed: {
        sha256: sha256Hex(proposedBytes),
        byteLength: proposedBytes.byteLength,
      },
    }
  )

  controller.arm(
    'pointer after install',
    (context) =>
      context.point === 'pointer.afterInstall' &&
      context.key === 'pointers/head.json'
  )
  const afterError = thrown(() =>
    store.compareAndSwapPointer('pointers/head.json', old.sha256, proposedBytes)
  )
  assert.ok(afterError instanceof DurableArtifactStoreError)
  assert.equal(afterError.finalInstalled, true)
  assert.deepEqual(
    store.reconcilePointer('pointers/head.json', old.sha256, proposedBytes),
    {
      status: 'new',
      observedSha256: sha256Hex(proposedBytes),
      proposed: {
        sha256: sha256Hex(proposedBytes),
        byteLength: proposedBytes.byteLength,
      },
    }
  )

  const interferenceOld = store.compareAndSwapPointer(
    'pointers/interference.json',
    null,
    oldBytes
  )
  const interferingBytes = new TextEncoder().encode('different-writer')
  store.compareAndSwapPointer(
    'pointers/interference.json',
    interferenceOld.sha256,
    interferingBytes
  )
  assert.deepEqual(
    store.reconcilePointer(
      'pointers/interference.json',
      interferenceOld.sha256,
      proposedBytes
    ),
    {
      status: 'interference',
      observedSha256: sha256Hex(interferingBytes),
      proposed: {
        sha256: sha256Hex(proposedBytes),
        byteLength: proposedBytes.byteLength,
      },
    }
  )
})

const PRE_HEAD_FAULTS = [
  {
    label: 'revision-candidate',
    arm(controller: FaultController): void
    {
      controller.arm(
        'revision candidate before install',
        (context) =>
          context.point === 'immutable.beforeInstall' &&
          context.key?.includes('/revisions/000001-') === true &&
          context.key.endsWith('/candidate.sb3')
      )
    },
  },
  {
    label: 'prepared-report',
    arm(controller: FaultController): void
    {
      controller.arm(
        'prepared report before install',
        (context) =>
          context.point === 'immutable.beforeInstall' &&
          context.key?.includes('/reports/') === true &&
          context.key.endsWith('/report.json')
      )
    },
  },
  {
    label: 'head-before-install',
    arm(controller: FaultController): void
    {
      controller.arm(
        'head before install',
        (context) =>
          context.point === 'pointer.beforeInstall' &&
          context.key?.endsWith('/head.json') === true
      )
    },
  },
] as const

for (const fault of PRE_HEAD_FAULTS)
{
  test(`pre-head ${fault.label} failure preserves the old authority`, async (t) =>
  {
    const harness = await openHarness(t, `pre-${fault.label}`)
    const oldHead = harness.session.head
    const applyRequest = await previewAndApplyRequest(
      harness,
      stageVolumeTransaction(74),
      `apply-pre-${fault.label}`,
      2
    )
    fault.arm(harness.controller)
    await rejection(() => harness.session.apply(applyRequest, invocation(3)))
    assert.equal(harness.session.status().state, 'active')
    assert.deepEqual(harness.session.head, oldHead)
    assert.equal(harness.session.revisions.length, 1)
    const durableHead = JSON.parse(
      new TextDecoder().decode(
        await harness.store.readImmutable(
          `sessions/${harness.session.manifest.sessionKey}/head.json`
        )
      )
    ) as { head: HeadProjectionV1 }
    assert.deepEqual(durableHead.head, oldHead)
  })
}

test('a head after-install fault reconciles forward without double apply', async (t) =>
{
  const harness = await openHarness(t, 'head-after-install')
  const applyRequest = await previewAndApplyRequest(
    harness,
    stageVolumeTransaction(75),
    'apply-head-after-install',
    2
  )
  harness.controller.arm(
    'head after install',
    (context) =>
      context.point === 'pointer.afterInstall' &&
      context.key?.endsWith('/head.json') === true
  )
  const applied = await harness.session.apply(applyRequest, invocation(3))
  assert.equal(applied.head.revisionNumber, 1)
  assert.equal(harness.session.revisions.length, 2)
  assert.deepEqual(
    await harness.session.apply(applyRequest, invocation(3)),
    applied
  )
  assert.equal(harness.session.revisions.length, 2)
})

const POST_HEAD_FAULTS = [
  {
    label: 'committed-event',
    arm(controller: FaultController): void
    {
      controller.arm(
        'committed event before install',
        (context) =>
          context.point === 'immutable.beforeInstall' &&
          context.key?.includes('/events/000003-') === true
      )
    },
  },
  {
    label: 'current-report',
    arm(controller: FaultController): void
    {
      controller.arm(
        'current report pointer before install',
        (context) =>
          context.point === 'pointer.beforeInstall' &&
          context.key?.endsWith('/current-report.json') === true
      )
    },
  },
  {
    label: 'attempt-result',
    arm(controller: FaultController): void
    {
      controller.arm(
        'attempt result before install',
        (context) =>
          context.point === 'immutable.beforeInstall' &&
          context.key?.includes('/attempts/') === true &&
          context.key.endsWith('/result.json')
      )
    },
  },
  {
    label: 'idempotency-completion',
    arm(controller: FaultController): void
    {
      controller.arm(
        'idempotency completion before install',
        (context) =>
          context.point === 'pointer.beforeInstall' &&
          context.key?.endsWith('/idempotency-index.json') === true,
        2
      )
    },
  },
] as const

for (const fault of POST_HEAD_FAULTS)
{
  test(`post-head ${fault.label} failure is attempt-bound roll-forward`, async (t) =>
  {
    const harness = await openHarness(t, `post-${fault.label}`)
    const oldHead = harness.session.head
    const applyRequest = await previewAndApplyRequest(
      harness,
      stageVolumeTransaction(76),
      `apply-post-${fault.label}`,
      2
    )
    fault.arm(harness.controller)
    const interrupted = await rejection(() =>
      harness.session.apply(applyRequest, invocation(3))
    )
    assert.ok(interrupted instanceof EditSessionErrorV1)
    assert.equal(interrupted.code, 'edit.recovery_required')
    assert.equal(interrupted.committed, true)
    assert.equal(harness.session.status().state, 'recovery-required')
    assert.equal(harness.session.head.revisionNumber, 1)
    assert.notEqual(harness.session.head.revisionId, oldHead.revisionId)
    assert.equal(harness.session.revisions.length, 2)
    const recovered = await harness.session.apply(applyRequest, invocation(3))
    assert.equal(recovered.head.revisionNumber, 1)
    assert.equal(harness.session.status().state, 'active')
    assert.equal(harness.session.revisions.length, 2)
    assert.deepEqual(
      await harness.session.apply(applyRequest, invocation(3)),
      recovered
    )
    assert.equal(harness.session.revisions.length, 2)
  })
}

test('terminal recovery meters its complete evidence and refuses low capacity before installation', async (t) =>
{
  const interruptAfterHead = async (
    harness: OpenHarness
  ): Promise<() => void> =>
  {
    const createOrVerifyImmutable = harness.store.createOrVerifyImmutable.bind(
      harness.store
    )
    harness.store.createOrVerifyImmutable = async (key, bytes) =>
    {
      if (key.includes('/attempts/') && key.endsWith('/result.json'))
        throw new Error('persistent attempt result retention fault')
      return createOrVerifyImmutable(key, bytes)
    }
    const interrupted = await rejection(() =>
      harness.session.close(
        {
          schemaVersion: 1,
          sessionId: harness.session.sessionId,
          requestId: 'close-recovery-artifact-cap',
          reason: 'exercise terminal recovery artifact accounting',
          ...expectedHeadRequest(harness.session.head),
        },
        invocation(2)
      )
    )
    assertCode(interrupted, 'edit.recovery_required')
    return () =>
    {
      harness.store.createOrVerifyImmutable = createOrVerifyImmutable
    }
  }
  const immutableSessionBytes = async (harness: OpenHarness): Promise<number> =>
    (
      await inventory(
        harness.store,
        `sessions/${harness.session.manifest.sessionKey}`
      )
    )
      .filter(
        (entry) =>
          !entry.key.endsWith('/head.json') &&
          !entry.key.endsWith('/current-report.json') &&
          !entry.key.endsWith('/idempotency-index.json') &&
          !entry.key.endsWith('/quota-state.json')
      )
      .reduce((total, entry) => total + entry.byteLength, 0)

  const calibration = await openHarness(t, 'recovery-cap-calibration')
  const restoreCalibrationStore = await interruptAfterHead(calibration)
  const retainedBeforeRecovery = await immutableSessionBytes(calibration)
  restoreCalibrationStore()
  const recovered = await recoverRetainedEditSessionsV1({
    artifactStore: calibration.store,
    invocation: invocation(4),
    clock: calibration.clock,
  })
  assert.ok(
    recovered.recoveredAttempts.some(
      (attempt) =>
        attempt.toolName === 'edit_close' &&
        attempt.requestId === 'close-recovery-artifact-cap'
    )
  )
  const calibrationPrefix = `sessions/${calibration.session.manifest.sessionKey}`
  const reportPointer = JSON.parse(
    new TextDecoder().decode(
      await calibration.store.readImmutable(
        `${calibrationPrefix}/current-report.json`
      )
    )
  ) as { readonly reportJsonSha256: string }
  const terminalReport = JSON.parse(
    new TextDecoder().decode(
      await calibration.store.readImmutable(
        `${calibrationPrefix}/reports/${reportPointer.reportJsonSha256}/report.json`
      )
    )
  ) as { readonly budget: { readonly artifactBytesUsed: number } }
  const terminalPlan = JSON.parse(
    new TextDecoder().decode(
      await calibration.store.readImmutable(
        `${calibrationPrefix}/recovery/terminal-plan-v1.json`
      )
    )
  ) as {
    readonly artifactBytesAfterRecovery: number
    readonly recoveryReservationId: string
    readonly recoveryReservedBytes: number
    readonly recoveryActualBytes: number
  }
  const recoveryQuota = await calibration.store.quotaOutcome(
    terminalPlan.recoveryReservationId
  )
  assert.equal(
    terminalReport.budget.artifactBytesUsed,
    await immutableSessionBytes(calibration)
  )
  assert.equal(
    terminalPlan.artifactBytesAfterRecovery,
    terminalReport.budget.artifactBytesUsed
  )
  assert.ok(
    terminalPlan.recoveryActualBytes <= terminalPlan.recoveryReservedBytes
  )
  assert.equal(recoveryQuota.state, 'settled')
  if (recoveryQuota.state !== 'settled') assert.fail('quota was not settled')
  assert.equal(recoveryQuota.reservedBytes, terminalPlan.recoveryReservedBytes)
  assert.equal(recoveryQuota.actualBytes, terminalPlan.recoveryActualBytes)
  const recoveredInventory = await inventory(
    calibration.store,
    calibrationPrefix
  )
  await recoverRetainedEditSessionsV1({
    artifactStore: calibration.store,
    invocation: invocation(5),
    clock: calibration.clock,
  })
  assert.deepEqual(
    await inventory(calibration.store, calibrationPrefix),
    recoveredInventory
  )
  const capped = await openHarness(t, 'recovery-cap-refusal', {
    limitOverrides: [
      {
        key: 'artifactBytesPerSessionLimit',
        value: retainedBeforeRecovery + 2_048,
      },
    ],
  })
  await interruptAfterHead(capped)
  const prefix = `sessions/${capped.session.manifest.sessionKey}`
  const beforeRecovery = await inventory(capped.store, prefix)
  const recoveryError = await rejection(() =>
    recoverRetainedEditSessionsV1({
      artifactStore: capped.store,
      invocation: invocation(4),
      clock: capped.clock,
    })
  )
  assert.match(
    (recoveryError as Error).message,
    /terminal recovery artifacts would reach/u
  )
  assert.deepEqual(await inventory(capped.store, prefix), beforeRecovery)
  assert.equal(
    beforeRecovery.some((entry) =>
      entry.key.endsWith('/recovery/terminal-plan-v1.json')
    ),
    false
  )
})

test('begin failure before the head commit retains no session authority', async (t) =>
{
  const harness = await prepareHarness(t, 'begin-before-head')
  harness.controller.arm(
    'begin head before install',
    (context) =>
      context.point === 'pointer.beforeInstall' &&
      context.key?.endsWith('/head.json') === true
  )
  const first = await rejection(() =>
    harness.sessions.begin(harness.beginRequest, harness.source, invocation(1))
  )
  assert.ok(first instanceof EditSessionErrorV1)
  assert.equal(first.code, 'edit.retention_failed')
  assert.equal(first.committed, false)
  assert.equal(harness.sessions.sessions().length, 0)
  assertCode(
    await rejection(() =>
      harness.store.readImmutable('sessions/000000/head.json')
    ),
    'entry-not-found'
  )
  const beforeRetry = await inventory(harness.store, 'registry-attempts')
  const retry = await rejection(() =>
    harness.sessions.begin(harness.beginRequest, harness.source, invocation(1))
  )
  assert.ok(retry instanceof EditSessionErrorV1)
  assert.equal(retry.code, 'edit.retention_failed')
  assert.equal(retry.committed, false)
  assert.deepEqual(
    await inventory(harness.store, 'registry-attempts'),
    beforeRetry
  )
})

test('begin uncertainty after head commit rolls forward idempotently', async (t) =>
{
  const harness = await prepareHarness(t, 'begin-after-head')
  harness.controller.arm(
    'begin current report before install',
    (context) =>
      context.point === 'pointer.beforeInstall' &&
      context.key?.endsWith('/current-report.json') === true
  )
  const first = await harness.sessions.begin(
    harness.beginRequest,
    harness.source,
    invocation(1)
  )
  assert.equal(first.state, 'active')
  assert.equal(first.head.revisionNumber, 0)
  assert.equal(harness.sessions.sessions().length, 1)
  const heads = (await harness.store.listImmutable('sessions')).filter(
    (entry) => entry.key.endsWith('/head.json')
  )
  assert.equal(heads.length, 1)
  const beforeRetry = await inventory(harness.store, 'registry-attempts')
  const retry = await harness.sessions.begin(
    harness.beginRequest,
    harness.source,
    invocation(1)
  )
  assert.deepEqual(retry, first)
  assert.equal(harness.sessions.sessions().length, 1)
  assert.deepEqual(
    await inventory(harness.store, 'registry-attempts'),
    beforeRetry
  )
})

test('begin reconciles a head after-install fault to one active session', async (t) =>
{
  const harness = await prepareHarness(t, 'begin-head-after-install')
  harness.controller.arm(
    'begin head after install',
    (context) =>
      context.point === 'pointer.afterInstall' &&
      context.key?.endsWith('/head.json') === true
  )
  const begun = await harness.sessions.begin(
    harness.beginRequest,
    harness.source,
    invocation(1)
  )
  assert.equal(begun.state, 'active')
  assert.equal(harness.sessions.sessions().length, 1)
  assert.deepEqual(
    await harness.sessions.begin(
      harness.beginRequest,
      harness.source,
      invocation(1)
    ),
    begun
  )
  assert.equal(harness.sessions.sessions().length, 1)
})

test('recovery ownership fences the old writer and read-only stores refuse writes', async (t) =>
{
  const root = tempRoot(t, 'writer-fencing')
  const writer = createEditArtifactStoreHostAdapter(root)
  const writerCapability = await writer.capability()
  const originalBytes = new TextEncoder().encode('original writer bytes')
  await writer.createImmutable('objects/original.bin', originalBytes)

  const reader = createEditArtifactStoreHostAdapter(root, {
    mode: 'read-only',
    expectedStoreId: writerCapability.storeId,
    expectedOwnershipSha256: writerCapability.ownershipSha256,
  })
  const readerCapability = await reader.capability()
  assert.equal(readerCapability.writable, false)
  assert.equal(readerCapability.exclusiveWriter, false)
  assert.deepEqual(
    await reader.readImmutable('objects/original.bin'),
    originalBytes
  )
  const readerWrite = await rejection(() =>
    reader.createImmutable('objects/read-only-refusal.bin', new Uint8Array([1]))
  )
  assert.ok(readerWrite instanceof EditArtifactStoreHostError)
  assert.equal(readerWrite.code, 'capability-unavailable')

  const recovery = createEditArtifactStoreHostAdapter(root, {
    mode: 'recovery',
    expectedStoreId: writerCapability.storeId,
    expectedOwnershipSha256: writerCapability.ownershipSha256,
  })
  const recoveryCapability = await recovery.capability()
  assert.equal(recoveryCapability.writable, true)
  assert.equal(recoveryCapability.exclusiveWriter, true)
  assert.notEqual(
    recoveryCapability.ownershipSha256,
    writerCapability.ownershipSha256
  )
  const fencedWrite = await rejection(() =>
    writer.createImmutable('objects/fenced-writer.bin', new Uint8Array([2]))
  )
  assert.ok(fencedWrite instanceof EditArtifactStoreHostError)
  assert.equal(fencedWrite.code, 'path-unsafe')
  await recovery.createImmutable(
    'objects/recovery-writer.bin',
    new Uint8Array([3])
  )
  assertCode(
    thrown(() =>
      createEditArtifactStoreHostAdapter(root, {
        mode: 'recovery',
        expectedStoreId: writerCapability.storeId,
        expectedOwnershipSha256: writerCapability.ownershipSha256,
      })
    ),
    'path-unsafe'
  )
})

test('quota reservation and terminal outcome survive fault and ownership recovery', async (t) =>
{
  const root = tempRoot(t, 'quota-persistence')
  const controller = new FaultController()
  const writer = createEditArtifactStoreHostAdapter(root, {
    maxBytes: 8 * 1024 * 1024,
    faultHook: controller.hook,
  })
  const writerCapability = await writer.capability()
  controller.arm(
    'quota persisted before response',
    (context) => context.point === 'quota.afterPersist'
  )
  await rejection(() => writer.reserveQuota('quota/session-a', 4_096))
  const writerAfterFault = await writer.capability()
  assert.equal(writerAfterFault.quota.reservations, 1)
  assert.equal(writerAfterFault.quota.reservedBytes, 4_096)

  const reader = createEditArtifactStoreHostAdapter(root, {
    mode: 'read-only',
    expectedStoreId: writerCapability.storeId,
    expectedOwnershipSha256: writerCapability.ownershipSha256,
  })
  const readSnapshot = await reader.capability()
  assert.equal(readSnapshot.quota.reservations, 1)
  assert.equal(readSnapshot.quota.reservedBytes, 4_096)

  const recovery = createEditArtifactStoreHostAdapter(root, {
    mode: 'recovery',
    expectedStoreId: writerCapability.storeId,
    expectedOwnershipSha256: writerCapability.ownershipSha256,
  })
  await recovery.settleQuota('quota/session-a', 1_024)
  const recoveredSnapshot = await recovery.capability()
  assert.equal(recoveredSnapshot.quota.reservations, 0)
  assert.equal(recoveredSnapshot.quota.reservedBytes, 0)
  await recovery.reserveQuota('quota/session-a', 4_096)
  await recovery.settleQuota('quota/session-a', 1_024)
  const conflictingSettle = await rejection(() =>
    recovery.settleQuota('quota/session-a', 1_025)
  )
  assert.ok(conflictingSettle instanceof EditArtifactStoreHostError)
  assert.equal(conflictingSettle.code, 'reservation-conflict')

  const recoveryCapability = await recovery.capability()
  const reopened = createEditArtifactStoreHostAdapter(root, {
    mode: 'read-only',
    expectedStoreId: recoveryCapability.storeId,
    expectedOwnershipSha256: recoveryCapability.ownershipSha256,
  })
  const reopenedSnapshot = await reopened.capability()
  assert.equal(reopenedSnapshot.quota.reservations, 0)
  assert.equal(reopenedSnapshot.quota.reservedBytes, 0)
})
