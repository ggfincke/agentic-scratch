// packages/mcp/src/edit/edit-evaluation-host.ts
// validate trusted retained runtime/lens policies for production evaluation

import { LOWERCASE_SHA256_PATTERN } from '../internal/sha256-pattern.js'
import { hasExactObjectKeysV1 } from '../internal/exact-object-keys.js'

import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  EVALUATION_LANE_ORDER_V1,
  ProductionEditDeterministicEvaluationPortV1,
  parseContractDefinitionV1,
  semanticHashV1,
  type EditEvaluationPortsV1,
  type RunnerAvailabilityV1,
} from '@scratch-agent/edit'
import {
  buildRelay,
  inspectSemanticEditArtifact,
  validateBehavioralLensSpecs,
  type BehavioralLensSpecV1,
  type EditProductionPolicyArtifactV1,
  type EditProductionPolicyDecoderV1,
} from '@scratch-agent/eval'
import {
  MAX_RUNTIME_OBSERVATION_CAPS,
  RUNNER_OBSERVATION_SCHEMA_VERSION,
  runnerExecutionPoisonIssue,
  runtimeLineageManifestForBytes,
  runIdentityBoundBrowserScenario,
  runIdentityBoundScenario,
  validateObservationPlan,
  verifyMediaManifest,
  type IdentityBoundScenarioV1,
  type ObservationPlanV1,
  type RuntimeObservationCapsV1,
  type RuntimeLineageTargetInputV1,
} from '@scratch-agent/runner'
import { McpBoundaryError } from '../transport/errors.js'

const LOCAL_KEY = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u
const RUNTIME_LANES = new Set([
  'officialHeadless',
  'officialBrowser',
  'turboWarpBrowser',
])
const READINESS_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20">' +
  '<rect width="20" height="20" fill="#4c97ff"></rect></svg>'

export interface ProductionEditRuntimeReadinessSnapshotV1
{
  readonly schemaVersion: 1
  readonly availabilityEpoch: number
  readonly runners: readonly RunnerAvailabilityV1[]
}

export interface ProductionEditRuntimeReadinessPortV1
{
  runtimeReadinessV1(): ProductionEditRuntimeReadinessSnapshotV1
}

export interface ProductionEditEvaluationPortsOptionsV1
{
  readonly runtimeReadiness: ProductionEditRuntimeReadinessPortV1
}

export interface ProductionEditRuntimeReadinessProofV1
{
  readonly schemaVersion: 1
  readonly proofSha256: string
  readonly projectPreflightSha256: string
  readonly officialHeadlessRuntimeSha256: string
  readonly officialBrowserRuntimeSha256: string
  readonly turboWarpBrowserRuntimeSha256: string
  readonly renderedDifferentialSha256: string
}

export interface ProbedProductionEditRuntimeReadinessV1
{
  readonly snapshot: ProductionEditRuntimeReadinessSnapshotV1
  readonly proof: ProductionEditRuntimeReadinessProofV1
}

function browserReadinessFailuresV1(
  result: Awaited<ReturnType<typeof runIdentityBoundBrowserScenario>>,
  mediaManifestIssues: readonly unknown[]
): string[]
{
  return [
    ...(!result.ok ? ['result'] : []),
    ...(result.identityBoundDrive?.status !== 'complete' ? ['drive'] : []),
    ...(result.lineage?.status !== 'bound'
      ? [
          `lineage:${result.lineage?.status ?? 'missing'}:${result.lineage?.mismatch ?? result.lineage?.unavailableReason ?? 'unknown'}`,
        ]
      : []),
    ...(result.runtimeIdentityFacet === null ? ['identity'] : []),
    ...(!result.runtimeDescriptor.browser ||
    result.runtimeDescriptor.browser.version === 'not-launched'
      ? ['browser']
      : []),
    ...(result.observations.media?.complete !== true ? ['media'] : []),
    ...(result.observations.media?.frames.length !== 1 ? ['frames'] : []),
    ...(mediaManifestIssues.length !== 0 ? ['manifest'] : []),
  ]
}

export function productionEditRuntimeReadinessPortV1(
  probed: ProbedProductionEditRuntimeReadinessV1
): ProductionEditRuntimeReadinessPortV1
{
  let poisonEpoch = probed.snapshot.availabilityEpoch
  let poisonSha256: string | null = null
  return Object.freeze({
    runtimeReadinessV1: () =>
    {
      const issue = runnerExecutionPoisonIssue()
      if (issue === null) return probed.snapshot
      const currentPoisonSha256 = semanticHashV1('evidence-content', {
        kind: 'production-edit-runner-poison',
        issue,
      })
      if (currentPoisonSha256 !== poisonSha256)
      {
        poisonSha256 = currentPoisonSha256
        poisonEpoch += 1
      }
      return validateProductionEditRuntimeReadinessV1({
        schemaVersion: 1,
        availabilityEpoch: poisonEpoch,
        runners: EVALUATION_LANE_ORDER_V1.map((lane) =>
          lane === 'nativeVisual'
            ? {
                lane,
                availability: 'unavailable',
                availabilityEpoch: poisonEpoch,
              }
            : {
                lane,
                availability: 'poisoned',
                availabilityEpoch: poisonEpoch,
                poisonSha256: currentPoisonSha256,
              }
        ),
      })
    },
  })
}

function refusal(message: string): never
{
  throw new McpBoundaryError('mcp.edit-evaluation-policy-invalid', message)
}

function readinessRefusal(message: string): never
{
  throw new McpBoundaryError('mcp.edit-host-port-unavailable', message)
}

// run one minimal exact artifact through every executable lane before the edit
// profile can advertise evaluation availability
export async function probeProductionEditRuntimeReadinessV1(): Promise<ProbedProductionEditRuntimeReadinessV1>
{
  const root = mkdtempSync(join(tmpdir(), 'agentic-scratch-edit-ready-'))
  try
  {
    const officialScreenshots = join(root, 'official')
    const turboWarpScreenshots = join(root, 'turbowarp')
    const officialMedia = join(root, 'official-media')
    const turboWarpMedia = join(root, 'turbowarp-media')
    mkdirSync(officialScreenshots, { mode: 0o700 })
    mkdirSync(turboWarpScreenshots, { mode: 0o700 })
    mkdirSync(officialMedia, { mode: 0o700 })
    mkdirSync(turboWarpMedia, { mode: 0o700 })
    const readinessProject = buildRelay()
    const readinessAsset = Buffer.from(READINESS_SVG, 'utf8')
    const readinessAssetId = createHash('md5')
      .update(readinessAsset)
      .digest('hex')
    const readinessAssetPath = `${readinessAssetId}.svg`
    for (const target of readinessProject.targets)
    {
      target.raw.costumes = []
      target.addCostume(
        {
          name: 'runtime readiness witness',
          assetId: readinessAssetId,
          md5ext: readinessAssetPath,
          dataFormat: 'svg',
          bitmapResolution: 1,
          rotationCenterX: 10,
          rotationCenterY: 10,
        },
        readinessAsset
      )
      target.raw.currentCostume = 0
    }
    readinessProject.stage!.addVariable('runtime readiness stage witness', 0)
    const bytes = await readinessProject.toSb3()
    const preflight = await inspectSemanticEditArtifact(bytes)
    if (!preflight.ok || preflight.project === null)
      return readinessRefusal(
        'production edit project preflight readiness probe failed'
      )
    const targets: RuntimeLineageTargetInputV1[] =
      preflight.project.json.targets.map((target, targetIndex) =>
      {
        const targetLineage = `readiness:target:${targetIndex}`
        return {
          targetLineage,
          isStage: target.isStage,
          serializedTargetOrdinal: targetIndex,
          layerOrder: target.layerOrder ?? targetIndex,
          blockIds: Object.keys(target.blocks),
          declarations: [
            ...Object.keys(target.variables),
            ...Object.keys(target.lists ?? {}),
            ...Object.keys(target.broadcasts ?? {}),
          ].map((rawDeclarationId) => ({
            declarationLineage: `${targetLineage}:declaration:${rawDeclarationId}`,
            rawDeclarationId,
          })),
          media: [
            ...target.costumes.map((media, mediaOrder) => ({
              mediaLineage: `${targetLineage}:costume:${mediaOrder}`,
              mediaKind: 'costume' as const,
              mediaOrder,
              assetId: media.assetId,
            })),
            ...target.sounds.map((media, mediaOrder) => ({
              mediaLineage: `${targetLineage}:sound:${mediaOrder}`,
              mediaKind: 'sound' as const,
              mediaOrder,
              assetId: media.assetId,
            })),
          ],
        }
      })
    const manifest = runtimeLineageManifestForBytes(bytes, targets)
    const scenario: IdentityBoundScenarioV1 = {
      schemaVersion: 1,
      seed: 1,
      fixedDateMs: 1_700_000_000_000,
      maxTicks: 7,
      steps: [
        { do: 'greenFlag' },
        { do: 'wait', ticks: 6 },
        {
          do: 'snapshot',
          label: 'runtime-readiness',
        },
      ],
    }
    const observationPlan: ObservationPlanV1 = {
      schemaVersion: RUNNER_OBSERVATION_SCHEMA_VERSION,
      temporal: {
        firstTick: 6,
        lastTick: 6,
        everyTicks: 6,
        playbackFps: 10,
        maxFrames: 1,
        maxBytes: 2 * 1024 * 1024,
        derivedVideo: false,
      },
      cloneCounts: 'none',
    }
    const officialHeadless = await runIdentityBoundScenario(
      bytes,
      scenario,
      manifest
    )
    const officialHeadlessFailures = [
      ...(!officialHeadless.trace.ok
        ? [`result:${officialHeadless.trace.errors.join('|')}`]
        : []),
      ...(officialHeadless.drive.status !== 'complete' ? ['drive'] : []),
      ...(officialHeadless.lineage?.status !== 'bound'
        ? [
            `lineage:${officialHeadless.lineage?.status ?? 'missing'}:${officialHeadless.lineage?.mismatch ?? officialHeadless.lineage?.unavailableReason ?? 'unknown'}`,
          ]
        : []),
      ...(officialHeadless.runtimeIdentityFacet === null ? ['identity'] : []),
    ]
    if (officialHeadlessFailures.length !== 0)
      return readinessRefusal(
        `production edit official headless readiness probe failed: ${officialHeadlessFailures.join(',')}`
      )
    const officialBrowser = await runIdentityBoundBrowserScenario(
      'scratch-official',
      bytes,
      scenario,
      manifest,
      {
        screenshotDir: officialScreenshots,
        mediaDir: officialMedia,
        observationPlan,
      }
    )
    const officialMediaIssues = officialBrowser.observations.media
      ? verifyMediaManifest(
          officialBrowser.observations.media,
          officialMedia,
          observationPlan
        )
      : []
    const officialFailures = browserReadinessFailuresV1(
      officialBrowser,
      officialMediaIssues
    )
    if (officialFailures.length !== 0)
      return readinessRefusal(
        `production edit official browser readiness probe failed: ${officialFailures.join(',')}`
      )
    const turboWarpBrowser = await runIdentityBoundBrowserScenario(
      'turbowarp',
      bytes,
      scenario,
      manifest,
      {
        screenshotDir: turboWarpScreenshots,
        mediaDir: turboWarpMedia,
        observationPlan,
      }
    )
    const turboWarpMediaIssues = turboWarpBrowser.observations.media
      ? verifyMediaManifest(
          turboWarpBrowser.observations.media,
          turboWarpMedia,
          observationPlan
        )
      : []
    const turboWarpFailures = browserReadinessFailuresV1(
      turboWarpBrowser,
      turboWarpMediaIssues
    )
    if (turboWarpFailures.length !== 0)
      return readinessRefusal(
        `production edit TurboWarp browser readiness probe failed: ${turboWarpFailures.join(',')}`
      )
    const projectPreflightSha256 = semanticHashV1('evidence-content', {
      kind: 'production-edit-project-preflight-readiness',
      semanticSourceIdentity: preflight.semanticSourceIdentity,
      semanticSourceSha256: preflight.semanticSourceSha256,
    })
    const officialHeadlessRuntimeSha256 = semanticHashV1('evidence-content', {
      kind: 'production-edit-official-headless-readiness',
      runtimeDescriptor: officialHeadless.trace.runtimeDescriptor,
      finalSnapshot: officialHeadless.trace.finalSnapshot,
      drive: officialHeadless.drive,
      lineage: officialHeadless.lineage,
      runtimeIdentityFacet: officialHeadless.runtimeIdentityFacet,
    })
    const officialBrowserRuntimeSha256 = semanticHashV1('evidence-content', {
      kind: 'production-edit-official-browser-readiness',
      runtimeDescriptor: officialBrowser.runtimeDescriptor,
      finalSnapshot: officialBrowser.finalSnapshot,
      media: officialBrowser.observations.media,
      drive: officialBrowser.identityBoundDrive,
      lineage: officialBrowser.lineage,
      runtimeIdentityFacet: officialBrowser.runtimeIdentityFacet,
    })
    const turboWarpBrowserRuntimeSha256 = semanticHashV1('evidence-content', {
      kind: 'production-edit-turbowarp-browser-readiness',
      runtimeDescriptor: turboWarpBrowser.runtimeDescriptor,
      finalSnapshot: turboWarpBrowser.finalSnapshot,
      media: turboWarpBrowser.observations.media,
      drive: turboWarpBrowser.identityBoundDrive,
      lineage: turboWarpBrowser.lineage,
      runtimeIdentityFacet: turboWarpBrowser.runtimeIdentityFacet,
    })
    const renderedDifferentialSha256 = semanticHashV1('evidence-content', {
      kind: 'production-edit-rendered-differential-readiness',
      officialBrowserRuntimeSha256,
      turboWarpBrowserRuntimeSha256,
      comparedFrameCount: 1,
    })
    const proof = Object.freeze({
      schemaVersion: 1 as const,
      projectPreflightSha256,
      officialHeadlessRuntimeSha256,
      officialBrowserRuntimeSha256,
      turboWarpBrowserRuntimeSha256,
      renderedDifferentialSha256,
      proofSha256: semanticHashV1('evidence-content', {
        kind: 'production-edit-runtime-readiness-proof',
        projectPreflightSha256,
        officialHeadlessRuntimeSha256,
        officialBrowserRuntimeSha256,
        turboWarpBrowserRuntimeSha256,
        renderedDifferentialSha256,
      }),
    })
    const availabilityEpoch = 1
    const snapshot = validateProductionEditRuntimeReadinessV1({
      schemaVersion: 1,
      availabilityEpoch,
      runners: EVALUATION_LANE_ORDER_V1.map((lane) => ({
        lane,
        availability: lane === 'nativeVisual' ? 'unavailable' : 'available',
        availabilityEpoch,
      })),
    })
    return Object.freeze({ snapshot, proof })
  }
  finally
  {
    rmSync(root, { recursive: true, force: true })
  }
}

function validatedReadinessRunnersV1(
  rows: readonly unknown[],
  availabilityEpoch: number
): readonly RunnerAvailabilityV1[]
{
  const parsed = rows.map((row) =>
  {
    const result = parseContractDefinitionV1<RunnerAvailabilityV1>(
      'RunnerAvailabilityV1',
      row
    )
    if (!result.ok)
      return readinessRefusal(
        'production edit runtime readiness contains an invalid lane row'
      )
    return result.value
  })
  const byLane = new Map(parsed.map((row) => [row.lane, row]))
  if (
    parsed.length !== EVALUATION_LANE_ORDER_V1.length ||
    byLane.size !== EVALUATION_LANE_ORDER_V1.length ||
    EVALUATION_LANE_ORDER_V1.some((lane) => !byLane.has(lane)) ||
    parsed.some((row) => row.availabilityEpoch !== availabilityEpoch)
  )
    return readinessRefusal(
      'production edit runtime readiness lanes or epoch do not match'
    )
  return Object.freeze(
    EVALUATION_LANE_ORDER_V1.map((lane) =>
      Object.freeze({ ...byLane.get(lane)! })
    )
  )
}

export function validateProductionEditRuntimeReadinessV1(
  value: unknown
): ProductionEditRuntimeReadinessSnapshotV1
{
  let snapshot: Record<string, unknown>
  try
  {
    snapshot = exactObjectV1(
      value,
      ['availabilityEpoch', 'runners', 'schemaVersion'],
      'production edit runtime readiness'
    )
  }
  catch
  {
    return readinessRefusal(
      'production edit runtime readiness is not one closed snapshot'
    )
  }
  if (
    snapshot.schemaVersion !== 1 ||
    !Number.isSafeInteger(snapshot.availabilityEpoch) ||
    Number(snapshot.availabilityEpoch) < 0 ||
    !Array.isArray(snapshot.runners)
  )
    return readinessRefusal(
      'production edit runtime readiness identity is invalid'
    )
  let runners: readonly RunnerAvailabilityV1[]
  try
  {
    runners = validatedReadinessRunnersV1(
      snapshot.runners,
      Number(snapshot.availabilityEpoch)
    )
  }
  catch
  {
    return readinessRefusal(
      'production edit runtime readiness lanes or epoch do not match'
    )
  }
  return Object.freeze({
    schemaVersion: 1,
    availabilityEpoch: Number(snapshot.availabilityEpoch),
    runners,
  })
}

export function assertProductionEditRuntimeStartupReadyV1(
  snapshot: ProductionEditRuntimeReadinessSnapshotV1
): void
{
  for (const lane of EVALUATION_LANE_ORDER_V1)
  {
    const row = snapshot.runners.find((candidate) => candidate.lane === lane)!
    const expected = lane === 'nativeVisual' ? 'unavailable' : 'available'
    if (row.availability !== expected)
      readinessRefusal(
        `production edit runtime lane ${lane} is not ${expected}`
      )
  }
}

function exactObjectV1(
  value: unknown,
  fields: readonly string[],
  label: string
): Record<string, unknown>
{
  if (value === null || typeof value !== 'object' || Array.isArray(value))
    return refusal(`${label} must be one closed object`)
  const record = value as Record<string, unknown>
  if (!hasExactObjectKeysV1(record, fields))
    return refusal(`${label} has missing or unknown fields`)
  return record
}

function runtimeCapsV1(value: unknown): RuntimeObservationCapsV1
{
  const keys = Object.keys(MAX_RUNTIME_OBSERVATION_CAPS)
  const record = exactObjectV1(value, keys, 'runtime observation caps')
  for (const key of keys as (keyof RuntimeObservationCapsV1)[])
  {
    const observed = record[key]
    if (
      !Number.isSafeInteger(observed) ||
      Number(observed) < 1 ||
      Number(observed) > MAX_RUNTIME_OBSERVATION_CAPS[key]
    )
      return refusal(`runtime observation cap ${key} is outside its bound`)
  }
  return Object.freeze({ ...record }) as unknown as RuntimeObservationCapsV1
}

function runtimePolicyV1(
  artifact: EditProductionPolicyArtifactV1
): ReturnType<EditProductionPolicyDecoderV1['decodeRuntimePolicy']>
{
  if (artifact.binding.kind !== 'runtime')
    return refusal('runtime decoder received a non-runtime retained policy')
  const root = exactObjectV1(
    artifact.value,
    ['allowedNewDiagnosticFingerprints', 'cells', 'schemaVersion'],
    'runtime policy'
  )
  if (
    root.schemaVersion !== 1 ||
    !Array.isArray(root.cells) ||
    root.cells.length < 1 ||
    root.cells.length > 128 ||
    !Array.isArray(root.allowedNewDiagnosticFingerprints) ||
    root.allowedNewDiagnosticFingerprints.length > 128 ||
    root.allowedNewDiagnosticFingerprints.some(
      (value) => typeof value !== 'string' || !LOWERCASE_SHA256_PATTERN.test(value)
    )
  )
    return refusal('runtime policy identity or bounded collections are invalid')
  const diagnostics = root.allowedNewDiagnosticFingerprints as string[]
  if (new Set(diagnostics).size !== diagnostics.length)
    return refusal('runtime policy repeats an allowed diagnostic fingerprint')
  const cellKeys = new Set<string>()
  const cells = root.cells.map((candidate, index) =>
  {
    const cell = exactObjectV1(
      candidate,
      ['lane', 'observationCaps', 'observationPlan', 'scenarioId'],
      `runtime policy cell ${index}`
    )
    if (
      typeof cell.lane !== 'string' ||
      !RUNTIME_LANES.has(cell.lane) ||
      typeof cell.scenarioId !== 'string' ||
      !LOCAL_KEY.test(cell.scenarioId)
    )
      return refusal(`runtime policy cell ${index} identity is invalid`)
    const plan = validateObservationPlan(cell.observationPlan)
    if (!plan.ok)
      return refusal(`runtime policy cell ${index} observation plan is invalid`)
    const key = `${cell.lane}\u0000${cell.scenarioId}`
    if (cellKeys.has(key))
      return refusal(`runtime policy repeats cell ${index}`)
    cellKeys.add(key)
    return Object.freeze({
      lane: cell.lane as
        'officialHeadless' | 'officialBrowser' | 'turboWarpBrowser',
      scenarioId: cell.scenarioId,
      observationPlan: plan.value,
      observationCaps: runtimeCapsV1(cell.observationCaps),
    })
  })
  return Object.freeze({
    cells: Object.freeze(cells),
    allowedNewDiagnosticFingerprints: Object.freeze([...diagnostics]),
  })
}

function lensPolicyV1(
  artifact: EditProductionPolicyArtifactV1
): BehavioralLensSpecV1
{
  if (artifact.binding.kind !== 'lens')
    return refusal('lens decoder received a non-lens retained policy')
  const validated = validateBehavioralLensSpecs([artifact.value])
  if (!validated.ok || validated.value.length !== 1)
    return refusal('retained lens policy is not one closed behavioral lens')
  return validated.value[0]!
}

export const STRICT_EDIT_MCP_EVALUATION_POLICY_DECODER_V1: EditProductionPolicyDecoderV1 =
  Object.freeze({
    decodeRuntimePolicy: (artifact: EditProductionPolicyArtifactV1) =>
      runtimePolicyV1(artifact),
    decodeLensPolicy: (artifact: EditProductionPolicyArtifactV1) =>
      lensPolicyV1(artifact),
  })

export function createProductionEditEvaluationPortsV1(
  options: ProductionEditEvaluationPortsOptionsV1
): EditEvaluationPortsV1
{
  if (
    options === null ||
    typeof options !== 'object' ||
    options.runtimeReadiness === null ||
    typeof options.runtimeReadiness !== 'object' ||
    typeof options.runtimeReadiness.runtimeReadinessV1 !== 'function'
  )
    return readinessRefusal(
      'production edit runtime readiness port is unavailable'
    )
  const readSnapshot = (): ProductionEditRuntimeReadinessSnapshotV1 =>
  {
    let value: unknown
    try
    {
      value = options.runtimeReadiness.runtimeReadinessV1()
    }
    catch
    {
      return readinessRefusal(
        'production edit runtime readiness probe is unavailable'
      )
    }
    return validateProductionEditRuntimeReadinessV1(value)
  }
  const initial = readSnapshot()
  assertProductionEditRuntimeStartupReadyV1(initial)
  return Object.freeze({
    deterministic: new ProductionEditDeterministicEvaluationPortV1({
      decoder: STRICT_EDIT_MCP_EVALUATION_POLICY_DECODER_V1,
      availabilityEpoch: initial.availabilityEpoch,
      runnerAvailabilityProbe: {
        runnerAvailabilityV1: () => readSnapshot().runners,
      },
    }),
  })
}
