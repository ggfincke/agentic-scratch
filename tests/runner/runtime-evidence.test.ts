// tests/runner/runtime-evidence.test.ts
// group G runtime scalar, cap-poisoning, & witness-bound lineage acceptance

import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test, type TestContext } from 'node:test'

import { buildMovement } from '@scratch-agent/ir'
import {
  DEFAULT_RUNTIME_OBSERVATION_CAPS,
  bindRuntimeLineageV1,
  captureRuntimeObservationV1,
  createRuntimeObservationBudget,
  hashRunnerJson,
  projectObservedRuntimeNumberV1,
  projectRuntimeObservationScalarListV1,
  projectRuntimeObservationValueV1,
  runIdentityBoundBrowserScenario,
  runIdentityBoundScenario,
  runtimeLineageManifestForBytes,
  sealRuntimeLineageManifestV1,
  type BrowserRuntimeObservationV1,
  type IdentityBoundScenarioV1,
  type ObservedRuntimeExecutionObservationV1,
  type ObservedRuntimeNumberV1,
  type ObservedRuntimeScalarV1,
  type RuntimeLineageManifestV1,
  type RuntimeLineageObservedTargetV1,
  type RuntimeLineageTargetInputV1,
  type RuntimeObservationCapsV1,
  type RuntimeObservationRecordV1,
} from '@scratch-agent/runner'
import { unpackSb3 } from '@scratch-agent/sb3'

import { buildRelay } from '@scratch-agent/eval'

interface SerializedTarget
{
  readonly isStage: boolean
  readonly name: string
  readonly layerOrder: number
  readonly blocks: Readonly<Record<string, unknown>>
  readonly variables: Readonly<Record<string, unknown>>
  readonly lists: Readonly<Record<string, unknown>>
  readonly broadcasts: Readonly<Record<string, string>>
  readonly costumes: readonly { readonly assetId: string }[]
  readonly sounds: readonly { readonly assetId: string }[]
}

const CAPS: RuntimeObservationCapsV1 = DEFAULT_RUNTIME_OBSERVATION_CAPS

function scratchDir(t: TestContext): string
{
  const path = mkdtempSync(join(tmpdir(), 'runtime-evidence-'))
  t.after(() => rmSync(path, { recursive: true, force: true }))
  return path
}

function targetLineage(name: string, index: number): string
{
  if (index === 0) return 'target:stage'
  if (name === 'Sender') return 'target:sender'
  if (name === 'Renamed Receiver') return 'target:receiver'
  if (name === 'Values') return 'target:values'
  return `target:${index}`
}

async function manifestFor(sb3: Uint8Array): Promise<RuntimeLineageManifestV1>
{
  const { projectJsonText } = await unpackSb3(sb3)
  const project = JSON.parse(projectJsonText) as {
    readonly targets: readonly SerializedTarget[]
  }
  const targets: RuntimeLineageTargetInputV1[] = project.targets.map(
    (target, targetIndex) =>
    {
      const lineage = targetLineage(target.name, targetIndex)
      const declarationIds = [
        ...Object.keys(target.variables ?? {}),
        ...Object.keys(target.lists ?? {}),
        ...Object.keys(target.broadcasts ?? {}),
      ]
      return {
        targetLineage: lineage,
        isStage: target.isStage,
        serializedTargetOrdinal: targetIndex,
        layerOrder: target.layerOrder,
        blockIds: Object.keys(target.blocks ?? {}),
        declarations: declarationIds.map((rawDeclarationId) => ({
          declarationLineage:
            rawDeclarationId in (target.broadcasts ?? {})
              ? 'broadcast:go'
              : `${lineage}:declaration:${rawDeclarationId}`,
          rawDeclarationId,
        })),
        media: [
          ...(target.costumes ?? []).map((media, mediaOrder) => ({
            mediaLineage: `${lineage}:costume:${mediaOrder}`,
            mediaKind: 'costume' as const,
            mediaOrder,
            assetId: media.assetId,
          })),
          ...(target.sounds ?? []).map((media, mediaOrder) => ({
            mediaLineage: `${lineage}:sound:${mediaOrder}`,
            mediaKind: 'sound' as const,
            mediaOrder,
            assetId: media.assetId,
          })),
        ],
      }
    }
  )
  return runtimeLineageManifestForBytes(sb3, targets)
}

function observedTargets(
  manifest: RuntimeLineageManifestV1
): RuntimeLineageObservedTargetV1[]
{
  return manifest.targets.map((target) => ({
    isStage: target.isStage,
    seamOrdinal: target.serializedTargetOrdinal,
    layerOrder: target.executableTargetOrdinal,
    blockIds: [...target.blockIds],
    declarationIds: target.declarations.map(
      (declaration) => declaration.normalizedDeclarationId
    ),
    mediaAssetIds: target.media.map((media) => media.assetId),
  }))
}

function captureAtLabel<T>(
  records: readonly RuntimeObservationRecordV1<T>[],
  label: string
): T
{
  const record = records.find((candidate) => candidate.label === label)
  assert.ok(record, `missing runtime observation ${label}`)
  assert.equal(record.capture.status, 'observed')
  return record.capture.value
}

function numberValues(
  observation:
    ObservedRuntimeExecutionObservationV1 | BrowserRuntimeObservationV1
): Record<string, ObservedRuntimeNumberV1>
{
  const target = Object.values(observation.state.targetsById).find(
    (candidate) =>
      candidate.name.scalarKind === 'string' &&
      candidate.name.value === 'Values'
  )
  assert.ok(target)
  const values: Record<string, ObservedRuntimeNumberV1> = {}
  for (const declaration of Object.values(target.variables))
  {
    assert.equal(declaration.name.scalarKind, 'string')
    assert.equal(declaration.value.scalarKind, 'number')
    values[declaration.name.value] = declaration.value.value
  }
  return values
}

async function taggedValueFixture(): Promise<{
  readonly sb3: Uint8Array
  readonly manifest: RuntimeLineageManifestV1
  readonly scenario: IdentityBoundScenarioV1
}>
{
  const project = buildMovement()
  project.stage!.addVariable('stage witness', 0)
  const sprite = project.target('Mover')!
  sprite.raw.name = 'Values'
  sprite.addVariable('finite', 7)
  const negativeZeroId = sprite.addVariable('negativeZero', 0)
  const nanId = sprite.addVariable('nan', 0)
  const positiveInfinityId = sprite.addVariable('positiveInfinity', 0)
  const negativeInfinityId = sprite.addVariable('negativeInfinity', 0)
  const divide = (left: number, right: number) => ({
    reporter: {
      opcode: 'operator_divide',
      inputs: { NUM1: left, NUM2: right },
    },
  })
  sprite.addScript([
    { opcode: 'event_whenflagclicked' },
    {
      opcode: 'data_setvariableto',
      fields: { VARIABLE: ['negativeZero', negativeZeroId] },
      inputs: {
        VALUE: {
          reporter: {
            opcode: 'operator_multiply',
            inputs: { NUM1: -1, NUM2: 0 },
          },
        },
      },
    },
    {
      opcode: 'data_setvariableto',
      fields: { VARIABLE: ['nan', nanId] },
      inputs: { VALUE: divide(0, 0) },
    },
    {
      opcode: 'data_setvariableto',
      fields: { VARIABLE: ['positiveInfinity', positiveInfinityId] },
      inputs: { VALUE: divide(1, 0) },
    },
    {
      opcode: 'data_setvariableto',
      fields: { VARIABLE: ['negativeInfinity', negativeInfinityId] },
      inputs: { VALUE: divide(-1, 0) },
    },
  ])
  const sb3 = await project.toSb3()
  return {
    sb3,
    manifest: await manifestFor(sb3),
    scenario: {
      schemaVersion: 1,
      seed: 23,
      fixedDateMs: 1_700_000_000_000,
      maxTicks: 5,
      steps: [
        { do: 'greenFlag' },
        { do: 'wait', ticks: 1 },
        { do: 'snapshot', label: 'values' },
      ],
    },
  }
}

test('runtime numbers keep all five tags byte-equal in Node and the official browser', async (t) =>
{
  const numericTable: readonly [number, ObservedRuntimeNumberV1][] = [
    [7, { numberKind: 'finite', value: 7 }],
    [-0, { numberKind: 'negativeZero' }],
    [Number.NaN, { numberKind: 'nan' }],
    [Number.POSITIVE_INFINITY, { numberKind: 'positiveInfinity' }],
    [Number.NEGATIVE_INFINITY, { numberKind: 'negativeInfinity' }],
  ]
  for (const [input, expected] of numericTable)
    assert.deepEqual(projectObservedRuntimeNumberV1(input), expected)

  const fixture = await taggedValueFixture()
  const node = await runIdentityBoundScenario(
    fixture.sb3,
    fixture.scenario,
    fixture.manifest,
    { runtimeObservation: { caps: CAPS } }
  )
  assert.equal(node.trace.ok, true, node.trace.errors.join('; '))
  assert.equal(
    node.lineage?.status,
    'bound',
    JSON.stringify(node.lineage, null, 2)
  )
  const browser = await runIdentityBoundBrowserScenario(
    'scratch-official',
    fixture.sb3,
    fixture.scenario,
    fixture.manifest,
    {
      screenshotDir: scratchDir(t),
      runtimeObservation: { caps: CAPS },
    }
  )
  assert.equal(browser.ok, true, browser.errors.join('; '))
  const nodeValues = numberValues(
    captureAtLabel(node.runtimeObservations, 'values')
  )
  const browserValues = numberValues(
    captureAtLabel(browser.runtimeObservations ?? [], 'values')
  )
  assert.deepEqual(browserValues, nodeValues)
  assert.deepEqual(nodeValues, {
    finite: { numberKind: 'finite', value: 7 },
    negativeInfinity: { numberKind: 'negativeInfinity' },
    negativeZero: { numberKind: 'negativeZero' },
    nan: { numberKind: 'nan' },
    positiveInfinity: { numberKind: 'positiveInfinity' },
  })
  assert.equal(JSON.stringify(browserValues), JSON.stringify(nodeValues))
})

test('non-scalars refuse with identity-only metadata and no partial value', () =>
{
  const cyclic: Record<string, unknown> = {}
  cyclic.self = cyclic
  const cases: readonly {
    readonly expected: string
    readonly observedKind: string
    readonly scope: string
    readonly run: (
      budget: ReturnType<typeof createRuntimeObservationBudget>
    ) => unknown
  }[] = [
    {
      expected: 'scalar',
      observedKind: 'function',
      scope: 'target/x',
      run: (budget) => budget.chargeScalar('target/x', () => 1),
    },
    {
      expected: 'scalar',
      observedKind: 'record',
      scope: 'target/list/1',
      run: (budget) =>
        projectRuntimeObservationScalarListV1([1, {}], budget, 'target/list'),
    },
    {
      expected: 'data-property',
      observedKind: 'function',
      scope: 'record/value',
      run: (budget) =>
        projectRuntimeObservationValueV1(
          Object.defineProperty({}, 'value', {
            enumerable: true,
            get: () => 1,
          }),
          budget,
          'record'
        ),
    },
    {
      expected: 'plain-record',
      observedKind: 'record',
      scope: 'record/self',
      run: (budget) =>
        projectRuntimeObservationValueV1(cyclic, budget, 'record'),
    },
  ]
  for (const row of cases)
  {
    const budget = createRuntimeObservationBudget()
    const capture = captureRuntimeObservationV1(budget, () => row.run(budget))
    assert.equal(capture.status, 'refused')
    assert.equal(capture.value, null)
    assert.equal(capture.issue.code, 'runner.observation_non_scalar')
    assert.equal(capture.issue.expected, row.expected)
    assert.equal(capture.issue.observedKind, row.observedKind)
    assert.equal(capture.issue.scope, row.scope)
    assert.equal('rawValue' in capture.issue, false)
  }
})

test('list and scalar cap crossings poison the cell without retaining a prefix', () =>
{
  const cases: readonly {
    readonly caps: Partial<RuntimeObservationCapsV1>
    readonly resource: string
    readonly read: (
      budget: ReturnType<typeof createRuntimeObservationBudget>
    ) => readonly ObservedRuntimeScalarV1[] | ObservedRuntimeScalarV1
  }[] = [
    {
      caps: { listItemsPerList: 2 },
      resource: 'list-items',
      read: (budget) =>
        projectRuntimeObservationScalarListV1([1, 2, 3], budget, 'list'),
    },
    {
      caps: { scalarBytesPerValue: 16 },
      resource: 'scalar-bytes',
      read: (budget) => budget.chargeScalar('scalar', 'x'.repeat(64)),
    },
  ]
  for (const row of cases)
  {
    const budget = createRuntimeObservationBudget({
      ...DEFAULT_RUNTIME_OBSERVATION_CAPS,
      ...row.caps,
    })
    const first = captureRuntimeObservationV1(budget, () => row.read(budget))
    assert.equal(first.status, 'refused')
    assert.equal(first.value, null)
    assert.equal(first.issue.code, 'runner.observation_resource_exceeded')
    assert.equal(first.issue.resource, row.resource)
    const later = captureRuntimeObservationV1(budget, () =>
      budget.chargeScalar('later', 1)
    )
    assert.deepEqual(later, first)
  }
})

async function lineageFixture(): Promise<{
  readonly sb3: Uint8Array
  readonly manifest: RuntimeLineageManifestV1
  readonly scenario: IdentityBoundScenarioV1
}>
{
  const project = buildRelay()
  const svg = Buffer.from(
    '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20">' +
      '<rect width="20" height="20" fill="#4c97ff"></rect></svg>',
    'utf8'
  )
  const assetId = createHash('md5').update(svg).digest('hex')
  const assetPath = `${assetId}.svg`
  project.addAsset({ path: assetPath, bytes: svg })
  for (const target of project.targets)
  {
    target.raw.costumes = [
      {
        name: `${target.name} witness`,
        assetId,
        md5ext: assetPath,
        dataFormat: 'svg',
        bitmapResolution: 1,
        rotationCenterX: 10,
        rotationCenterY: 10,
      },
    ]
    target.raw.currentCostume = 0
  }
  project.stage!.addVariable('stage witness', 0)
  const receiver = project.target('Receiver')!
  receiver.raw.name = 'Renamed Receiver'
  const broadcasts = project.stage!.raw.broadcasts
  assert.ok(broadcasts)
  const broadcastId = Object.keys(broadcasts)[0]!
  broadcasts[broadcastId] = 'renamed-go'
  for (const block of Object.values(receiver.raw.blocks))
    if (
      typeof block === 'object' &&
      block !== null &&
      'opcode' in block &&
      block.opcode === 'event_whenbroadcastreceived'
    )
      block.fields!.BROADCAST_OPTION = ['renamed-go', broadcastId]
  project.target('Sender')!.raw.layerOrder = 2
  receiver.raw.layerOrder = 1
  const sb3 = await project.toSb3()
  return {
    sb3,
    manifest: await manifestFor(sb3),
    scenario: {
      schemaVersion: 1,
      seed: 31,
      fixedDateMs: 1_700_000_000_000,
      maxTicks: 10,
      steps: [
        {
          do: 'broadcastAndWait',
          broadcast: {
            broadcastLineage: 'broadcast:go',
            name: 'renamed-go',
            expectedReceiverTargetLineages: ['target:receiver'],
          },
        },
        { do: 'snapshot', label: 'after' },
      ],
    },
  }
}

test('headless lineage binds renamed entities by witnesses and preserves independent orders', async () =>
{
  const fixture = await lineageFixture()
  assert.notDeepEqual(
    fixture.manifest.targets.map((target) => target.targetLineage),
    fixture.manifest.executableTargetLineageOrder
  )
  const run = await runIdentityBoundScenario(
    fixture.sb3,
    fixture.scenario,
    fixture.manifest,
    { runtimeObservation: { caps: CAPS } }
  )
  assert.equal(
    run.trace.ok,
    true,
    `${run.trace.errors.join('; ')}\n${JSON.stringify(run.lineage, null, 2)}`
  )
  assert.equal(run.lineage?.status, 'bound')
  assert.deepEqual(
    run.lineage?.paneLineageOrder,
    fixture.manifest.targets.map((target) => target.targetLineage)
  )
  assert.deepEqual(
    run.lineage?.executableTargetLineageOrder,
    fixture.manifest.executableTargetLineageOrder
  )
  assert.equal(run.drive.status, 'complete')
  assert.deepEqual(run.drive.actions[0], {
    stepIndex: 0,
    do: 'broadcastAndWait',
    tick: 0,
    targetLineage: null,
    broadcastLineage: 'broadcast:go',
    concreteName: 'renamed-go',
    expectedReceiverTargetLineages: ['target:receiver'],
    provenReceiverTargetLineages: ['target:receiver'],
    startedReceiverTargetLineages: ['target:receiver'],
    startedThreadCount: 1,
  })
  assert.equal(run.trace.snapshots[0]?.targets['Renamed Receiver']?.x, 10)
  assert.equal(run.runtimeIdentityFacet?.status, 'bound')
  if (run.runtimeIdentityFacet?.status === 'bound')
  {
    assert.deepEqual(
      run.runtimeIdentityFacet.targets.map((target) => target.targetLineage),
      fixture.manifest.targets.map((target) => target.targetLineage)
    )
    assert.equal(
      run.runtimeIdentityFacet.targets.find(
        (target) => target.targetLineage === 'target:receiver'
      )?.runtimeTargetName,
      'Renamed Receiver'
    )
  }
})

test('official-browser and TurboWarp lanes bind the same manifest identity', async (t) =>
{
  const fixture = await lineageFixture()
  for (const kind of ['scratch-official', 'turbowarp'] as const)
  {
    const run = await runIdentityBoundBrowserScenario(
      kind,
      fixture.sb3,
      fixture.scenario,
      fixture.manifest,
      { screenshotDir: scratchDir(t) }
    )
    assert.equal(
      run.ok,
      true,
      `${kind}: ${run.errors.join('; ')}\n${JSON.stringify(run.lineage, null, 2)}`
    )
    assert.equal(run.lineage?.status, 'bound')
    assert.equal(run.lineage?.manifestSha256, fixture.manifest.manifestSha256)
    assert.deepEqual(
      run.lineage?.paneLineageOrder,
      fixture.manifest.targets.map((target) => target.targetLineage)
    )
    assert.deepEqual(
      run.lineage?.executableTargetLineageOrder,
      fixture.manifest.executableTargetLineageOrder
    )
  }
})

test('browser lineage refuses changed bodies, stale hashes, and wrong artifact binding before its seam', async (t) =>
{
  const fixture = await lineageFixture()
  const { manifestSha256: _manifestSha256, ...body } = fixture.manifest
  const changedBody: RuntimeLineageManifestV1 = {
    ...fixture.manifest,
    targets: fixture.manifest.targets.map((target, index) =>
      index === 1 ? { ...target, targetLineage: 'target:changed' } : target
    ),
  }
  const staleHash = { ...fixture.manifest, manifestSha256: '0'.repeat(64) }
  const wrongBody = { ...body, artifactSha256: 'f'.repeat(64) }
  const wrongArtifact = sealRuntimeLineageManifestV1(
    wrongBody,
    hashRunnerJson(wrongBody)
  )
  for (const [label, manifest] of [
    ['changed-body', changedBody],
    ['stale-hash', staleHash],
    ['wrong-artifact', wrongArtifact],
  ] as const)
  {
    const run = await runIdentityBoundBrowserScenario(
      'scratch-official',
      fixture.sb3,
      fixture.scenario,
      manifest,
      { screenshotDir: scratchDir(t) }
    )
    assert.equal(run.ok, false, label)
    assert.equal(run.lineage?.status, 'unavailable', label)
    assert.equal(run.lineage?.seamObserved, false, label)
    assert.equal(run.lineage?.verifiedTargetCount, 0, label)
    assert.match(run.lineage?.unavailableReason ?? '', /did not verify/, label)
  }
})

test('lineage mismatches stay inconclusive and never rebind by ordinal', async () =>
{
  const fixture = await lineageFixture()
  const observed = observedTargets(fixture.manifest)
  const targetCount = bindRuntimeLineageV1(
    fixture.manifest,
    observed.slice(0, -1)
  )
  assert.equal(targetCount.status, 'inconclusive')
  if (targetCount.status === 'inconclusive')
    assert.equal(targetCount.reason, 'target-count-mismatch')

  const witnessMismatch = observed.map((target, index) =>
    index === 1
      ? {
          ...target,
          blockIds: ['display-name-and-ordinal-are-not-witnesses'],
          declarationIds: [],
          mediaAssetIds: [],
        }
      : target
  )
  const noFallback = bindRuntimeLineageV1(fixture.manifest, witnessMismatch)
  assert.equal(noFallback.status, 'inconclusive')
  if (noFallback.status === 'inconclusive')
    assert.equal(noFallback.reason, 'unmatched-target')

  const declarationMismatch = observed.map((target, index) =>
    index === 0
      ? {
          ...target,
          declarationIds: [target.declarationIds[0]!, 'wrong-normalized-id'],
        }
      : target
  )
  const declarations = bindRuntimeLineageV1(
    fixture.manifest,
    declarationMismatch
  )
  assert.equal(declarations.status, 'inconclusive')
  if (declarations.status === 'inconclusive')
    assert.equal(declarations.reason, 'declaration-normalization-mismatch')

  const seamMismatch = observed.map((target, index) =>
    index === 2 ? { ...target, blockIds: target.blockIds.slice(1) } : target
  )
  const seam = bindRuntimeLineageV1(fixture.manifest, seamMismatch)
  assert.equal(seam.status, 'inconclusive')
  if (seam.status === 'inconclusive')
    assert.equal(seam.reason, 'unmatched-target')

  const paneMismatch = [observed[0]!, observed[2]!, observed[1]!]
  const pane = bindRuntimeLineageV1(fixture.manifest, paneMismatch)
  assert.equal(pane.status, 'inconclusive')
  if (pane.status === 'inconclusive')
    assert.equal(pane.reason, 'pane-order-mismatch')

  const witnessFree = runtimeLineageManifestForBytes(fixture.sb3, [
    {
      targetLineage: 'target:stage',
      isStage: true,
      serializedTargetOrdinal: 0,
      layerOrder: 0,
      blockIds: [],
      declarations: [],
      media: [],
    },
  ])
  const unwitnessed = bindRuntimeLineageV1(witnessFree, [
    {
      isStage: true,
      seamOrdinal: 0,
      layerOrder: 0,
      blockIds: [],
      declarationIds: [],
      mediaAssetIds: [],
    },
  ])
  assert.equal(unwitnessed.status, 'inconclusive')
  if (unwitnessed.status === 'inconclusive')
    assert.equal(unwitnessed.reason, 'unwitnessed-target')
})
