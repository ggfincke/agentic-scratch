// packages/eval/src/development/reproduction.ts
// replay retained mark prefixes from reset & separate selected state from diagnostic media

import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import {
  openProfileBrowserEngineV1,
  profileRuntimeDescriptorBeforeLaunchV1,
  validateRuntimeExecutionProfileV1,
  PROFILE_VISUAL_CAPTURE_DEFAULTS_V1,
  PROFILE_VISUAL_CAPTURE_MAXIMUMS_V1,
  DEVELOPMENT_INPUT_POLICY_V1,
  DEVELOPMENT_INPUT_POLICY_V2,
  DEVELOPMENT_CHRONOLOGY_POLICY_V2,
  DevelopmentErrorV1,
  countDevelopmentInputEventsV1,
  isDevelopmentReleaseSourceV1,
  type DevelopmentArtifactRefV1,
  type DevelopmentInputRecordV1,
  type DevelopmentInputRecordV2,
  type DevelopmentFrameRecordV2,
  type DevelopmentMarkV1,
  type DevelopmentMarkV2,
  type DevelopmentServiceV1,
  type DevelopmentTraceV2,
  type ProfileAppliedInputEventV2,
  type ProfileEvidenceBatchV2,
  type ProfileBrowserEngineV1,
  type ProfileRuntimeFrameV1,
  type ProfileRuntimeFrameV2,
  type ProfileSoundEventsV1,
  type ProfilePerformanceDiagnosticsV1,
  type DevelopmentEngineFactoryV1,
  type RuntimeDescriptorV1,
  type RuntimeExecutionProfileV1,
} from '@scratch-agent/runner'
import { canonicalJsonBytesV1 } from '@scratch-agent/sb3/canonical-json'
import {
  compareDevelopmentSelectedStateV1,
  type DevelopmentStateComparisonV1,
  type DevelopmentStateDivergenceV1,
} from './selected-state.js'

export interface DevelopmentDenseCaptureV1
{
  maxFrames?: number
  maxBytes?: number
}

export interface ReproduceDevelopmentMarkRequestV1
{
  service: Pick<
    DevelopmentServiceV1,
    'retainedTrace' | 'command' | 'retainEvidence'
  >
  sessionId: string
  markId: string
  profile?: RuntimeExecutionProfileV1
  denseCapture?: DevelopmentDenseCaptureV1
  signal?: AbortSignal
}

export interface DevelopmentReproductionFrameV1
{
  image: DevelopmentArtifactRefV1
  metadata: DevelopmentArtifactRefV1
  tick: number
  segmentId: string
  state: ProfileRuntimeFrameV1
  geometry: unknown
  width: number
  height: number
}

export interface DevelopmentReproductionCheckpointV1
{
  tick: number
  disposition: DevelopmentStateComparisonV1['disposition']
  expectedSha256: string | null
  observedSha256: string | null
}

export interface DevelopmentReproductionReportV1
{
  schemaVersion: 1
  kind: 'development-reproduction-v1'
  sessionId: string
  markId: string
  sourceSha256: string
  source: DevelopmentArtifactRefV1
  disposition: 'matched' | 'diverged' | 'unavailable'
  replayClassification:
    'deterministic-selected-state' | 'natural-recorded-deterministic-conversion'
  recordedProfile: RuntimeExecutionProfileV1
  recordedInputMode: 'agent' | 'human'
  replayProfile: RuntimeExecutionProfileV1
  schedulerConversion: 'none' | 'natural-to-deterministic'
  exactNaturalScheduling: false
  reproducerPolicySha256: string
  recordedTraceSha256: string
  inputPrefixSha256: string
  inlineEvidence: 'complete' | 'omitted-budget-refusal'
  retainedCatalog: { sessionId: string; collection: 'artifacts' }
  markBoundary: {
    segmentId: string
    tick: number
    inputOrdinal: number
    startInputOrdinal: number | null
    frameSha256: string
  } | null
  prefix: readonly DevelopmentInputRecordV1[]
  mark: DevelopmentMarkV1 | null
  recordedRuntimeDescriptor: RuntimeDescriptorV1 | null
  replayRuntimeDescriptor: RuntimeDescriptorV1 | null
  recordedRuntimeIdentitySha256: string | null
  replayRuntimeIdentitySha256: string | null
  inputApplicationVerified: boolean
  originalPaused: boolean
  excludedPaths: readonly string[]
  checkpoints: readonly DevelopmentReproductionCheckpointV1[]
  replayMarkState: ProfileRuntimeFrameV1 | null
  firstDivergence: DevelopmentStateDivergenceV1 | null
  timingDiagnostics: {
    recordedTimer: number | null
    replayTimer: number | null
    recordedElapsedMs: number | null
    replayElapsedMs: number | null
  }
  frames: readonly DevelopmentReproductionFrameV1[]
  clip: DevelopmentArtifactRefV1 | null
  soundDiagnostics: ProfileSoundEventsV1 | null
  performanceDiagnostics: ProfilePerformanceDiagnosticsV1 | null
  issues: readonly string[]
  limitations: readonly string[]
  evidenceSha256: string
}

export interface DevelopmentReproductionCheckpointV2 extends DevelopmentReproductionCheckpointV1
{
  captureSequence: number
  inputOrdinal: number
  startInputOrdinal: number | null
  captureKind: ProfileRuntimeFrameV2['captureKind']
}

export interface DevelopmentReproductionReportV2 extends Omit<
  DevelopmentReproductionReportV1,
  | 'schemaVersion'
  | 'kind'
  | 'prefix'
  | 'mark'
  | 'checkpoints'
  | 'replayMarkState'
>
{
  schemaVersion: 2
  kind: 'development-reproduction-v2'
  chronologyPolicy: typeof DEVELOPMENT_CHRONOLOGY_POLICY_V2
  captureComplete: boolean
  prefix: readonly DevelopmentInputRecordV2[]
  mark: DevelopmentMarkV2 | null
  checkpoints: readonly DevelopmentReproductionCheckpointV2[]
  replayMarkState: ProfileRuntimeFrameV2 | null
}

export type DevelopmentReproductionReport =
  DevelopmentReproductionReportV1 | DevelopmentReproductionReportV2

export interface DevelopmentReproductionResultV1
{
  sessionId: string
  markId: string
  disposition: DevelopmentReproductionReportV1['disposition']
  replayClassification: DevelopmentReproductionReportV1['replayClassification']
  sourceSha256: string
  result: DevelopmentArtifactRefV1
  clip: DevelopmentArtifactRefV1 | null
  frames: readonly DevelopmentArtifactRefV1[]
  firstDivergence: DevelopmentStateDivergenceV1 | null
  issues: readonly string[]
}

const POLICY_V1 = Object.freeze({
  schemaVersion: 1,
  protocol: 'development-mark-reproduction-v1',
  prefix:
    'recorded-raw-vm-inputs-in-exact-ordinal-and-logical-tick-order-from-reset',
  startup: 'authoritative-start-input-ordinal',
  identities: 'exact-source-runtime-components-debug-bundle-and-loaded-browser',
  state:
    'selected-properties-declarations-list-prefix-lengths-clone-keys-counts',
  natural:
    'deterministic-conversion-system-timer-diagnostic-game-vars-compared',
  excluded: ['elapsedMs', 'drawEpoch', 'status'],
  media: 'actual-final-window-pngs-do-not-establish-state-equality',
  maxTicks: 10000,
  inputPolicy: DEVELOPMENT_INPUT_POLICY_V1,
  maxInputs: DEVELOPMENT_INPUT_POLICY_V1.maxInputEvents,
  maxReleaseInputs: DEVELOPMENT_INPUT_POLICY_V1.maxReleaseEvents,
  maxAppliedOrdinal: DEVELOPMENT_INPUT_POLICY_V1.maxAppliedOrdinal,
  maxDurationMs: 120000,
  maxReportBytes: 16 * 1024 * 1024,
  defaultDenseCapture: PROFILE_VISUAL_CAPTURE_DEFAULTS_V1,
  maximumDenseCapture: PROFILE_VISUAL_CAPTURE_MAXIMUMS_V1,
})
const POLICY_V2 = Object.freeze({
  ...POLICY_V1,
  schemaVersion: 2,
  protocol: 'development-mark-reproduction-v2',
  prefix: 'browser-capture-sequence-with-exact-frame-input-prefixes',
  chronology: DEVELOPMENT_CHRONOLOGY_POLICY_V2,
  inputPolicy: DEVELOPMENT_INPUT_POLICY_V2,
  checkpoints: 'every-post-step-and-explicit-observation-through-mark',
  legacy: 'read-as-recorded-without-new-exact-reproduction',
})
const HASH = /^[a-f0-9]{64}$/u

function bytes(value: unknown): Uint8Array
{
  return Buffer.from(JSON.stringify(value), 'utf8')
}

function hash(value: Uint8Array): string
{
  return createHash('sha256').update(value).digest('hex')
}

function jsonHash(value: unknown): string
{
  return hash(canonicalJsonBytesV1(JSON.parse(JSON.stringify(value))))
}

export function developmentReproducerPolicySha256V1(): string
{
  return reproducerPolicySha256(POLICY_V1)
}

export function developmentReproducerPolicySha256V2(): string
{
  return reproducerPolicySha256(POLICY_V2)
}

function reproducerPolicySha256(policy: unknown): string
{
  const module = readFileSync(new URL(import.meta.url))
  const stateModule = readFileSync(
    new URL(
      import.meta.url.endsWith('.ts')
        ? './selected-state.ts'
        : './selected-state.js',
      import.meta.url
    )
  )
  if (module.byteLength + stateModule.byteLength > 512 * 1024)
    throw new Error('reproducer module exceeds its identity bound')
  return jsonHash({
    policy,
    moduleSha256: hash(module),
    selectedStateModuleSha256: hash(stateModule),
    node: process.version,
  })
}

function prelaunchIdentity(descriptor: RuntimeDescriptorV1): string
{
  return jsonHash({
    ...descriptor,
    browser: descriptor.browser
      ? { ...descriptor.browser, version: 'prelaunch-comparison' }
      : null,
  })
}

function runtimeIdentity(descriptor: RuntimeDescriptorV1): string
{
  return hash(bytes(descriptor))
}

function runtimeIssues(
  descriptor: RuntimeDescriptorV1,
  profile: RuntimeExecutionProfileV1
): string[]
{
  if (
    !descriptor ||
    descriptor.network !== 'denied' ||
    !descriptor.id.startsWith('project-debug-v2:') ||
    descriptor.kind !==
      (profile.runtime === 'scratch-official'
        ? 'scratch-official-browser'
        : 'turbowarp-browser') ||
    !descriptor.bundle ||
    !HASH.test(descriptor.bundle.sha256) ||
    !descriptor.browser ||
    ['unknown', 'not-launched'].includes(descriptor.browser.version) ||
    descriptor.components.length === 0 ||
    descriptor.components.some(
      (entry) =>
        !entry.sha256 || !HASH.test(entry.sha256) || entry.version === 'unknown'
    )
  )
    return [
      'recorded debug runtime authority has incomplete or incompatible identities',
    ]
  return []
}

function captureLimits(
  input: DevelopmentDenseCaptureV1 = {}
): Required<DevelopmentDenseCaptureV1>
{
  if (
    !input ||
    typeof input !== 'object' ||
    Array.isArray(input) ||
    Object.keys(input).some((key) => !['maxFrames', 'maxBytes'].includes(key))
  )
    throw new Error('denseCapture only accepts maxFrames and maxBytes')
  const result = { ...PROFILE_VISUAL_CAPTURE_DEFAULTS_V1, ...input }
  if (
    !Number.isSafeInteger(result.maxFrames) ||
    result.maxFrames < 1 ||
    result.maxFrames > PROFILE_VISUAL_CAPTURE_MAXIMUMS_V1.maxFrames ||
    !Number.isSafeInteger(result.maxBytes) ||
    result.maxBytes < 1 ||
    result.maxBytes > PROFILE_VISUAL_CAPTURE_MAXIMUMS_V1.maxBytes
  )
    throw new Error('denseCapture exceeds the bounded 240-frame/50-MiB maximum')
  return result
}

function prefixForMark<T extends DevelopmentInputRecordV1>(
  trace: { readonly inputs: readonly T[] },
  mark: DevelopmentMarkV1
): T[]
{
  if (
    !Number.isSafeInteger(mark.tick) ||
    mark.tick < 0 ||
    mark.tick > POLICY_V1.maxTicks ||
    !Number.isSafeInteger(mark.inputOrdinal) ||
    mark.inputOrdinal < 0 ||
    mark.inputOrdinal > POLICY_V1.maxAppliedOrdinal ||
    mark.frame.tick !== mark.tick ||
    mark.frame.segmentId !== mark.segmentId ||
    mark.frame.order >= mark.order
  )
    throw new Error(
      'marked state has an invalid bounded tick or input boundary'
    )
  const prefix = trace.inputs.filter(
    (input) =>
      input.segmentId === mark.segmentId && input.ordinal <= mark.inputOrdinal
  )
  if (prefix.length !== mark.inputOrdinal)
    throw new Error('retained input prefix is incomplete')
  countDevelopmentInputEventsV1(prefix)
  let tick = 0
  let order = -1
  for (const [index, input] of prefix.entries())
  {
    if (
      input.ordinal !== index + 1 ||
      !Number.isSafeInteger(input.tick) ||
      input.tick < tick ||
      input.tick > mark.tick ||
      input.order <= order ||
      input.order >= mark.frame.order ||
      !['keyboard', 'mouse'].includes(input.device) ||
      !input.data ||
      typeof input.data !== 'object' ||
      Object.keys(input.data).length > 9
    )
      throw new Error(
        'retained input prefix has invalid application order or logical tick placement'
      )
    tick = input.tick
    order = input.order
  }
  if (
    mark.startInputOrdinal !== null &&
    (!Number.isSafeInteger(mark.startInputOrdinal) ||
      mark.startInputOrdinal < 0 ||
      mark.startInputOrdinal > mark.inputOrdinal)
  )
    throw new Error(
      'marked state lacks an authoritative green-flag input boundary'
    )
  if (mark.startInputOrdinal === null && mark.tick !== 0)
    throw new Error(
      'a mark before green flag cannot have advanced runtime ticks'
    )
  return prefix
}

function chronologyForMark(
  trace: DevelopmentTraceV2,
  mark: DevelopmentMarkV2,
  prefix: readonly DevelopmentInputRecordV2[]
): readonly (DevelopmentInputRecordV2 | DevelopmentFrameRecordV2)[]
{
  if (
    trace.chronologyPolicy !== DEVELOPMENT_CHRONOLOGY_POLICY_V2 ||
    !trace.captureComplete ||
    mark.frame.inputOrdinal !== mark.inputOrdinal ||
    mark.frame.startInputOrdinal !== mark.startInputOrdinal ||
    mark.frame.captureKind !== 'observation'
  )
    throw new Error('marked state lacks complete browser capture chronology')
  const frames = trace.frames.filter(
    (frame) =>
      frame.segmentId === mark.segmentId &&
      frame.captureSequence <= mark.frame.captureSequence
  )
  const rows = [...prefix, ...frames].sort(
    (left, right) => left.captureSequence - right.captureSequence
  )
  let ordinal = 0
  let tick = 0
  let started = false
  for (const [index, row] of rows.entries())
  {
    if (row.captureSequence !== index + 1 || row.order > mark.frame.order)
      throw new Error('retained browser capture sequence is incomplete')
    if ('captureKind' in row)
    {
      if (
        row.inputOrdinal !== ordinal ||
        !['post-step', 'observation'].includes(row.captureKind) ||
        row.tick !== tick + Number(row.captureKind === 'post-step') ||
        (row.startInputOrdinal !== null &&
          (row.startInputOrdinal !== mark.startInputOrdinal ||
            row.startInputOrdinal > ordinal)) ||
        (row.startInputOrdinal === null && (started || row.tick !== 0)) ||
        (row.captureKind === 'post-step' && row.startInputOrdinal === null)
      )
        throw new Error(
          'retained frame differs from its exact input/tick boundary'
        )
      started ||= row.startInputOrdinal !== null
      tick = row.tick
    }
    else
    {
      if (
        row.ordinal !== ordinal + 1 ||
        row.tick !== tick ||
        (row.interpretedKey !== null &&
          (typeof row.interpretedKey !== 'string' ||
            row.interpretedKey.length < 1 ||
            row.interpretedKey.length >
              DEVELOPMENT_INPUT_POLICY_V2.maxKeyCodeUnits)) ||
        !Array.isArray(row.releasedKeys) ||
        row.releasedKeys.length >
          DEVELOPMENT_INPUT_POLICY_V2.maxReleasedKeysPerInputEvent ||
        row.releasedKeys.some(
          (key) =>
            typeof key !== 'string' ||
            key.length < 1 ||
            key.length > DEVELOPMENT_INPUT_POLICY_V2.maxKeyCodeUnits
        ) ||
        (row.device === 'mouse' &&
          (row.interpretedKey !== null || row.releasedKeys.length !== 0))
      )
        throw new Error('retained interpreted input chronology is invalid')
      ordinal = row.ordinal
    }
  }
  const last = rows.at(-1)
  if (
    !last ||
    !('captureKind' in last) ||
    jsonHash(last) !== jsonHash(mark.frame)
  )
    throw new Error(
      'marked observation is absent from retained browser chronology'
    )
  return rows
}

export function developmentReproductionEvidenceSha256V1(
  report:
    | Omit<DevelopmentReproductionReportV1, 'evidenceSha256'>
    | Omit<DevelopmentReproductionReportV2, 'evidenceSha256'>
): string
{
  return hash(bytes(report))
}

export function validateDevelopmentReproductionReportV1(
  report: DevelopmentReproductionReport
): string[]
{
  const issues: string[] = []
  try
  {
    const { evidenceSha256, ...content } = report
    if (
      (report.schemaVersion === 1
        ? report.kind !== 'development-reproduction-v1' ||
          !HASH.test(report.reproducerPolicySha256)
        : report.schemaVersion !== 2 ||
          report.kind !== 'development-reproduction-v2' ||
          report.chronologyPolicy !== DEVELOPMENT_CHRONOLOGY_POLICY_V2 ||
          typeof report.captureComplete !== 'boolean' ||
          report.reproducerPolicySha256 !==
            developmentReproducerPolicySha256V2()) ||
      evidenceSha256 !== developmentReproductionEvidenceSha256V1(content) ||
      !HASH.test(report.sourceSha256) ||
      report.source.sha256 !== report.sourceSha256 ||
      !HASH.test(report.recordedTraceSha256) ||
      !HASH.test(report.inputPrefixSha256) ||
      (report.inlineEvidence === 'complete' &&
        report.inputPrefixSha256 !== hash(bytes(report.prefix))) ||
      report.retainedCatalog.sessionId !== report.sessionId ||
      report.retainedCatalog.collection !== 'artifacts' ||
      report.exactNaturalScheduling !== false
    )
      issues.push(
        'reproduction source, policy, input prefix or evidence identity does not reconstruct'
      )
    if (report.inlineEvidence === 'omitted-budget-refusal')
    {
      if (
        report.disposition !== 'unavailable' ||
        report.prefix.length !== 0 ||
        report.mark !== null ||
        report.frames.length !== 0 ||
        report.checkpoints.length !== 0 ||
        report.replayMarkState !== null ||
        report.inputApplicationVerified ||
        report.firstDivergence !== null ||
        report.clip !== null ||
        report.issues.length === 0
      )
        issues.push(
          'compact evidence must remain an unavailable refusal without omitted-state claims'
        )
      if (
        report.markBoundary &&
        (!HASH.test(report.markBoundary.frameSha256) ||
          !Number.isSafeInteger(report.markBoundary.inputOrdinal) ||
          report.markBoundary.inputOrdinal < 0 ||
          report.markBoundary.inputOrdinal > POLICY_V1.maxAppliedOrdinal ||
          !Number.isSafeInteger(report.markBoundary.tick) ||
          report.markBoundary.tick < 0 ||
          report.markBoundary.tick > POLICY_V1.maxTicks ||
          (report.markBoundary.startInputOrdinal !== null &&
            (!Number.isSafeInteger(report.markBoundary.startInputOrdinal) ||
              report.markBoundary.startInputOrdinal < 0 ||
              report.markBoundary.startInputOrdinal >
                report.markBoundary.inputOrdinal)))
      )
        issues.push(
          'compact marked boundary exceeds its finite identity bounds'
        )
    }
    else if (report.inlineEvidence !== 'complete')
      issues.push('unsupported reproduction inline evidence policy')
    if (bytes(report).byteLength > POLICY_V1.maxReportBytes)
      issues.push('reproduction report exceeds its byte bound')
    if (report.mark)
    {
      const prefix = prefixForMark({ inputs: report.prefix }, report.mark)
      if (
        report.mark.markId !== report.markId ||
        prefix.length !== report.prefix.length
      )
        issues.push(
          'reproduction mark or bounded prefix differs from its retained boundary'
        )
      if (report.schemaVersion === 2)
      {
        const mark = report.mark
        const points = report.checkpoints
        if (
          mark.frame.inputOrdinal !== mark.inputOrdinal ||
          mark.frame.startInputOrdinal !== mark.startInputOrdinal ||
          mark.frame.captureKind !== 'observation' ||
          report.markBoundary?.frameSha256 !== hash(bytes(mark.frame)) ||
          report.markBoundary.inputOrdinal !== mark.inputOrdinal ||
          report.markBoundary.startInputOrdinal !== mark.startInputOrdinal ||
          report.markBoundary.tick !== mark.tick ||
          report.markBoundary.segmentId !== mark.segmentId ||
          points.some(
            (point, index) =>
              !Number.isSafeInteger(point.captureSequence) ||
              point.captureSequence < 1 ||
              point.captureSequence > mark.frame.captureSequence ||
              (index > 0 &&
                point.captureSequence <= points[index - 1]!.captureSequence) ||
              !Number.isSafeInteger(point.inputOrdinal) ||
              point.inputOrdinal < 0 ||
              point.inputOrdinal > mark.inputOrdinal ||
              !['post-step', 'observation'].includes(point.captureKind)
          )
        )
          issues.push('reproduction checkpoint chronology does not reconstruct')
        if (
          report.disposition !== 'unavailable' &&
          points.at(-1)?.captureSequence !== mark.frame.captureSequence
        )
          issues.push('reproduction omitted its exact marked observation')
        if (report.disposition !== 'unavailable')
        {
          const rows = [...report.prefix, ...points].sort(
            (left, right) => left.captureSequence - right.captureSequence
          )
          let ordinal = 0
          for (const [index, row] of rows.entries())
          {
            if (row.captureSequence !== index + 1)
              throw new Error('reproduction omitted a browser capture boundary')
            if ('ordinal' in row)
            {
              if (row.ordinal !== ++ordinal)
                throw new Error('reproduction input sequence is discontinuous')
            }
            else if (row.inputOrdinal !== ordinal)
              throw new Error('reproduction checkpoint input prefix differs')
          }
          if (
            report.replayMarkState?.captureSequence !==
              mark.frame.captureSequence ||
            report.replayMarkState.inputOrdinal !== mark.inputOrdinal ||
            report.replayMarkState.startInputOrdinal !== mark.startInputOrdinal
          )
            issues.push(
              'reproduction replay state differs from its marked browser boundary'
            )
        }
      }
    }
    if (report.disposition !== 'unavailable')
    {
      if (report.schemaVersion === 2 && !report.captureComplete)
        issues.push('exact reproduction requires complete browser chronology')
      if (
        !report.mark ||
        !report.replayMarkState ||
        !report.inputApplicationVerified ||
        report.issues.length > 0
      )
        issues.push(
          'reproduction lacks a verified mark, replay state or applied input prefix'
        )
      else
      {
        const comparison = compareDevelopmentSelectedStateV1(
          report.mark.frame,
          report.replayMarkState,
          {
            excludeSystemTimer:
              report.schedulerConversion === 'natural-to-deterministic',
          }
        )
        if (
          comparison.disposition === 'unavailable' ||
          (report.disposition === 'matched' &&
            (comparison.disposition !== 'matched' ||
              report.firstDivergence !== null ||
              report.checkpoints.some(
                (point) => point.disposition !== 'matched'
              ))) ||
          (report.disposition === 'diverged' && report.firstDivergence === null)
        )
          issues.push(
            'reproduction selected-state disposition does not reconstruct'
          )
      }
    }
    const expectedConversion =
      report.recordedProfile.scheduler === 'natural'
        ? 'natural-to-deterministic'
        : 'none'
    if (
      report.schedulerConversion !== expectedConversion ||
      report.replayProfile.scheduler !== 'deterministic' ||
      report.replayProfile.runtime !== report.recordedProfile.runtime ||
      report.replayProfile.tickRate !== report.recordedProfile.tickRate ||
      (expectedConversion === 'natural-to-deterministic' &&
        !report.excludedPaths.includes('timer'))
    )
      issues.push(
        'reproduction scheduler conversion is incompatible or unlabeled'
      )
    if (
      report.recordedRuntimeDescriptor &&
      runtimeIdentity(report.recordedRuntimeDescriptor) !==
        report.recordedRuntimeIdentitySha256
    )
      issues.push('recorded runtime identity does not reconstruct')
    if (
      report.replayRuntimeDescriptor &&
      runtimeIdentity(report.replayRuntimeDescriptor) !==
        report.replayRuntimeIdentitySha256
    )
      issues.push('replay runtime identity does not reconstruct')
    for (const [descriptor, profile] of [
      [report.recordedRuntimeDescriptor, report.recordedProfile],
      [report.replayRuntimeDescriptor, report.replayProfile],
    ] as const)
      if (
        report.schemaVersion === 2 &&
        descriptor &&
        prelaunchIdentity(descriptor) !==
          prelaunchIdentity(
            profileRuntimeDescriptorBeforeLaunchV1(
              profile,
              report.recordedInputMode
            )
          )
      )
        issues.push(
          'runtime/debug observation authority changed since reproduction'
        )
  }
  catch (error)
  {
    issues.push(
      error instanceof Error
        ? error.message
        : 'reproduction report is malformed'
    )
  }
  return issues
}

export async function reproduceDevelopmentMarkV1(
  request: ReproduceDevelopmentMarkRequestV1,
  dependencies: {
    readonly engineFactory?: DevelopmentEngineFactoryV1
  } = {}
): Promise<DevelopmentReproductionResultV1>
{
  const retained = await request.service.retainedTrace({
    sessionId: request.sessionId,
  })
  if (retained.trace.schemaVersion === 1)
    throw new DevelopmentErrorV1(
      'development.legacy_read_only',
      'legacy trace remains readable as recorded but lacks browser chronology for new exact reproduction; its catalog cannot accept new evidence'
    )
  const trace = retained.trace
  const policySha256 = developmentReproducerPolicySha256V2()
  const recordedProfile = validateRuntimeExecutionProfileV1(
    retained.trace.profile
  )
  const replayProfile = validateRuntimeExecutionProfileV1({
    ...recordedProfile,
    scheduler: 'deterministic',
  })
  const natural = recordedProfile.scheduler === 'natural'
  const report: Omit<DevelopmentReproductionReportV2, 'evidenceSha256'> = {
    schemaVersion: 2,
    kind: 'development-reproduction-v2',
    chronologyPolicy: DEVELOPMENT_CHRONOLOGY_POLICY_V2,
    captureComplete: trace.captureComplete,
    sessionId: request.sessionId,
    markId: request.markId,
    sourceSha256: retained.trace.sourceSha256,
    source: retained.status.source,
    disposition: 'unavailable',
    replayClassification: natural
      ? 'natural-recorded-deterministic-conversion'
      : 'deterministic-selected-state',
    recordedProfile,
    recordedInputMode: retained.trace.inputMode,
    replayProfile,
    schedulerConversion: natural ? 'natural-to-deterministic' : 'none',
    exactNaturalScheduling: false,
    reproducerPolicySha256: policySha256,
    recordedTraceSha256: hash(bytes(retained.trace)),
    inputPrefixSha256: hash(bytes([])),
    inlineEvidence: 'complete',
    retainedCatalog: { sessionId: request.sessionId, collection: 'artifacts' },
    markBoundary: null,
    prefix: [],
    mark: null,
    recordedRuntimeDescriptor: null,
    replayRuntimeDescriptor: null,
    recordedRuntimeIdentitySha256: null,
    replayRuntimeIdentitySha256: null,
    inputApplicationVerified: false,
    originalPaused: false,
    excludedPaths: [...POLICY_V1.excluded, ...(natural ? ['timer'] : [])],
    checkpoints: [],
    replayMarkState: null,
    firstDivergence: null,
    timingDiagnostics: {
      recordedTimer: null,
      replayTimer: null,
      recordedElapsedMs: null,
      replayElapsedMs: null,
    },
    frames: [],
    clip: null,
    soundDiagnostics: null,
    performanceDiagnostics: null,
    issues: [],
    limitations: [
      'matching covers selected recorded checkpoints and the marked state, including bounded list prefixes and lengths',
      'screenshots, audio output and performance diagnostics do not establish exact state equality',
      'natural recordings are replayed with deterministic scheduling; native timing remains diagnostic',
      'the original runtime is left paused when needed; reverse inspection reads retained history only',
    ],
  }
  const issues: string[] = []
  const frames: DevelopmentReproductionFrameV1[] = []
  const checkpoints: DevelopmentReproductionCheckpointV2[] = []
  const marker = retained.trace.marks.filter(
    (mark) => mark.markId === request.markId
  )
  const boundMark = marker.length === 1 ? marker[0]! : null
  const boundPrefix = boundMark
    ? retained.trace.inputs.filter(
        (input) =>
          input.segmentId === boundMark.segmentId &&
          input.ordinal <= boundMark.inputOrdinal
      )
    : []
  if (boundMark)
    report.markBoundary = {
      segmentId: boundMark.segmentId,
      tick: boundMark.tick,
      inputOrdinal: boundMark.inputOrdinal,
      startInputOrdinal: boundMark.startInputOrdinal,
      frameSha256: hash(bytes(boundMark.frame)),
    }
  const fallbackContent: Omit<
    DevelopmentReproductionReportV2,
    'evidenceSha256'
  > = {
    ...report,
    inlineEvidence: 'omitted-budget-refusal',
    inputPrefixSha256: hash(bytes(boundPrefix)),
    issues: [
      'complete reproduction evidence could not be retained within its byte/artifact budget or persistence boundary; inspect the exact session artifact catalog for partial evidence',
    ],
  }
  const fallback: DevelopmentReproductionReportV2 = {
    ...fallbackContent,
    evidenceSha256: developmentReproductionEvidenceSha256V1(fallbackContent),
  }
  // reserve an immutable unavailable result before media can consume the remaining quota
  const fallbackRef = await request.service.retainEvidence({
    sessionId: request.sessionId,
    kind: 'reproduction',
    bytes: bytes(fallback),
    mimeType: 'application/json',
  })
  let engine: ProfileBrowserEngineV1 | undefined
  let currentIdentity: string | undefined
  let evidenceBudgetFailure = false
  try
  {
    if (request.signal?.aborted)
      throw request.signal.reason ?? new Error('reproduction cancelled')
    const limits = captureLimits(request.denseCapture)
    if (request.profile)
    {
      const requested = validateRuntimeExecutionProfileV1(request.profile)
      if (jsonHash(requested) !== jsonHash(replayProfile))
        throw new Error(
          'replay profile must retain the recorded runtime/tick rate and select deterministic scheduling'
        )
    }
    if (
      retained.trace.sessionId !== request.sessionId ||
      retained.status.sessionId !== request.sessionId ||
      retained.status.sourceSha256 !== report.sourceSha256 ||
      hash(retained.sourceBytes) !== report.sourceSha256
    )
      throw new Error('retained source differs from its development authority')
    if (
      retained.trace.inputs.length > POLICY_V1.maxAppliedOrdinal ||
      retained.trace.frames.length > POLICY_V1.maxTicks ||
      bytes(retained.trace).byteLength > POLICY_V1.maxReportBytes
    )
    {
      evidenceBudgetFailure = true
      throw new Error('retained trace exceeds its reproduction evidence bounds')
    }
    countDevelopmentInputEventsV1(retained.trace.inputs)
    const marks = trace.marks.filter((mark) => mark.markId === request.markId)
    if (marks.length !== 1)
      throw new Error('one exact retained mark is required')
    const mark = marks[0]!
    report.mark = mark
    const segments = retained.trace.segments.filter(
      (segment) => segment.segmentId === mark.segmentId
    )
    if (segments.length !== 1)
      throw new Error('marked source segment is unavailable or ambiguous')
    const segment = segments[0]!
    if (
      segment.sourceSha256 !== report.sourceSha256 ||
      jsonHash(segment.profile) !== jsonHash(recordedProfile) ||
      runtimeIdentity(segment.runtimeDescriptor) !==
        segment.runtimeIdentitySha256
    )
      throw new Error(
        'marked source/runtime identity differs from its retained segment'
      )
    issues.push(...runtimeIssues(segment.runtimeDescriptor, recordedProfile))
    if (issues.length) throw new Error(issues.join('; '))
    report.recordedRuntimeDescriptor = segment.runtimeDescriptor
    report.recordedRuntimeIdentitySha256 = segment.runtimeIdentitySha256
    const originalPrepared = profileRuntimeDescriptorBeforeLaunchV1(
      recordedProfile,
      retained.trace.inputMode
    )
    currentIdentity = prelaunchIdentity(originalPrepared)
    if (currentIdentity !== prelaunchIdentity(segment.runtimeDescriptor))
      throw new Error(
        'recorded runtime/debug observation authority changed since the marked segment'
      )
    const prefix = prefixForMark(trace, mark)
    report.prefix = prefix
    report.inputPrefixSha256 = hash(bytes(prefix))
    const chronology = chronologyForMark(trace, mark, prefix)
    const available = compareDevelopmentSelectedStateV1(
      mark.frame,
      mark.frame,
      { excludeSystemTimer: natural }
    )
    if (available.disposition === 'unavailable')
      throw new Error(available.issues.join('; '))
    if (retained.status.status === 'running')
    {
      await request.service.command({
        sessionId: request.sessionId,
        command: { kind: 'pause' },
      })
      report.originalPaused = true
    }
    const replayPrepared = profileRuntimeDescriptorBeforeLaunchV1(
      replayProfile,
      retained.trace.inputMode
    )
    engine = await (dependencies.engineFactory ?? openProfileBrowserEngineV1)({
      sb3: retained.sourceBytes,
      profile: replayProfile,
      inputMode: retained.trace.inputMode,
      headless: true,
      seed: segment.seed,
      fixedDateMs: segment.fixedDateMs,
      signal: request.signal,
      limits: {
        maxTicks: Math.max(1, mark.tick),
        maxDurationMs: POLICY_V1.maxDurationMs,
        maxInputEvents: POLICY_V1.maxInputs,
        maxReleaseEvents: POLICY_V1.maxReleaseInputs,
        maxStateFrames: Math.max(1, chronology.length - prefix.length),
      },
    })
    report.replayRuntimeDescriptor = engine.runtimeDescriptor
    report.replayRuntimeIdentitySha256 = runtimeIdentity(
      engine.runtimeDescriptor
    )
    if (
      engine.evidencePolicy !== DEVELOPMENT_CHRONOLOGY_POLICY_V2 ||
      !engine.drainEvidence ||
      !engine.observeEvidence
    )
      throw new Error('replay engine lacks atomic browser evidence capture')
    if (
      prefix.some((input) => isDevelopmentReleaseSourceV1(input.source)) &&
      !engine.applyReplayInput
    )
      throw new Error(
        'replay engine does not support archived cleanup-release input provenance'
      )
    if (
      engine.sourceSha256 !== report.sourceSha256 ||
      prelaunchIdentity(engine.runtimeDescriptor) !==
        prelaunchIdentity(replayPrepared) ||
      engine.runtimeDescriptor.browser?.version !==
        segment.runtimeDescriptor.browser?.version
    )
      throw new Error(
        'replay source, runtime components or loaded browser identity drifted'
      )
    if (retained.trace.probe) await engine.configureProbe(retained.trace.probe)
    let cursor = 0
    let tick = 0
    let started = false
    const applied: ProfileAppliedInputEventV2[] = []
    function acceptBatch(batch: ProfileEvidenceBatchV2): void
    {
      if (
        batch.schemaVersion !== 2 ||
        batch.chronologyPolicy !== DEVELOPMENT_CHRONOLOGY_POLICY_V2 ||
        !batch.captureComplete
      )
        throw new Error('replay browser chronology is incomplete')
      const rows = [...batch.inputs, ...batch.frames].sort(
        (left, right) => left.captureSequence - right.captureSequence
      )
      for (const row of rows)
      {
        const expected = chronology[cursor++]
        if (
          !expected ||
          row.captureSequence !== expected.captureSequence ||
          row.tick !== expected.tick
        )
          throw new Error(
            'replay capture differs from the recorded input/frame sequence'
          )
        if ('captureKind' in row)
        {
          if (
            !('captureKind' in expected) ||
            row.captureKind !== expected.captureKind ||
            row.inputOrdinal !== expected.inputOrdinal ||
            row.startInputOrdinal !== expected.startInputOrdinal
          )
            throw new Error(
              'replay frame differs from its recorded input prefix'
            )
          const result = compareDevelopmentSelectedStateV1(expected, row, {
            excludeSystemTimer: natural,
          })
          checkpoints.push({
            tick: expected.tick,
            captureSequence: expected.captureSequence,
            inputOrdinal: expected.inputOrdinal,
            startInputOrdinal: expected.startInputOrdinal,
            captureKind: expected.captureKind,
            disposition: result.disposition,
            expectedSha256: result.expectedSha256,
            observedSha256: result.observedSha256,
          })
          if (result.disposition === 'unavailable')
            throw new Error(result.issues.join('; '))
          report.firstDivergence ??= result.firstDivergence
          if (expected.captureSequence === mark.frame.captureSequence)
            report.replayMarkState = row
          tick = row.tick
        }
        else
        {
          if ('captureKind' in expected)
            throw new Error(
              'replay applied input where an observation was recorded'
            )
          verifyAppliedPrefix([expected], [row])
          applied.push(row)
        }
      }
    }
    async function startIfNeeded(required: boolean): Promise<void>
    {
      if (started || !required) return
      if (
        mark.startInputOrdinal === null ||
        applied.length !== mark.startInputOrdinal
      )
        throw new Error(
          'replay cannot reconstruct the exact green-flag input boundary'
        )
      await engine!.start()
      started = true
      acceptBatch(await engine!.drainEvidence!())
    }
    const captureStart = Math.max(0, mark.tick - limits.maxFrames + 1)
    async function capture(): Promise<void>
    {
      const frame = await engine!.captureVisualFrame({ limits })
      if (
        frame.sourceSha256 !== report.sourceSha256 ||
        frame.runtimeIdentitySha256 !== report.replayRuntimeIdentitySha256 ||
        frame.state.tick !== frame.tick ||
        hash(frame.bytes) !== frame.sha256 ||
        frame.bytes.byteLength !== frame.byteLength ||
        frame.byteLength < 1 ||
        frame.ordinal !== frames.length + 1 ||
        frame.byteLength > limits.maxBytes ||
        jsonHash(frame.profile) !== jsonHash(replayProfile)
      )
        throw new Error(
          'dense visual capture identity or logical tick does not reconstruct'
        )
      const image = await request.service.retainEvidence({
        sessionId: request.sessionId,
        kind: 'frame',
        bytes: frame.bytes,
        mimeType: 'image/png',
      })
      const metadata = await request.service.retainEvidence({
        sessionId: request.sessionId,
        kind: 'frame',
        bytes: bytes({ ...frame, bytes: undefined, image }),
        mimeType: 'application/json',
      })
      frames.push({
        image,
        metadata,
        tick: frame.tick,
        segmentId: mark.segmentId,
        state: frame.state,
        geometry: frame.geometry,
        width: frame.width,
        height: frame.height,
      })
    }
    let capturedTick = -1
    while (cursor < chronology.length)
    {
      if (request.signal?.aborted)
        throw request.signal.reason ?? new Error('reproduction cancelled')
      const expected = chronology[cursor]!
      const before = cursor
      if ('captureKind' in expected)
      {
        await startIfNeeded(expected.startInputOrdinal !== null)
        if (expected.captureKind === 'observation')
        {
          const batch = await engine.observeEvidence!(trace.probe)
          if (batch.observedCaptureSequence !== expected.captureSequence)
            throw new Error(
              'replay observed a different recorded mark boundary'
            )
          acceptBatch(batch)
        }
        else
        {
          if (tick >= captureStart && capturedTick !== tick)
          {
            await capture()
            capturedTick = tick
          }
          let count = 0
          const maximum =
            tick < captureStart ? Math.min(600, captureStart - tick) : 1
          for (const row of chronology.slice(cursor, cursor + maximum))
          {
            if (!('captureKind' in row) || row.captureKind !== 'post-step')
              break
            count++
          }
          if (count < 1)
            throw new Error('replay cannot advance its retained chronology')
          await engine.advance(count)
          acceptBatch(await engine.drainEvidence!())
        }
      }
      else
      {
        await startIfNeeded(
          mark.startInputOrdinal !== null &&
            expected.ordinal > mark.startInputOrdinal
        )
        const value = { device: expected.device, data: expected.data }
        if (engine.applyReplayInput)
          await engine.applyReplayInput(value, expected.source)
        else await engine.applyInput(value)
        acceptBatch(await engine.drainEvidence!())
      }
      if (cursor <= before)
        throw new Error('replay omitted a retained input or observation')
    }
    if (tick >= captureStart && capturedTick !== tick) await capture()
    verifyAppliedPrefix(prefix, applied)
    report.inputApplicationVerified = true
    if (
      !report.replayMarkState ||
      checkpoints.length !== chronology.length - prefix.length
    )
      throw new Error('reproduction omitted a retained selected checkpoint')
    report.timingDiagnostics = {
      recordedTimer: mark.frame.timer,
      replayTimer: report.replayMarkState.timer,
      recordedElapsedMs: mark.frame.elapsedMs,
      replayElapsedMs: report.replayMarkState.elapsedMs,
    }
    report.soundDiagnostics = await engine.drainSoundEvents()
    report.performanceDiagnostics = await engine.readPerformanceDiagnostics()
    report.clip = await request.service.retainEvidence({
      sessionId: request.sessionId,
      kind: 'clip',
      bytes: bytes({
        schemaVersion: 1,
        kind: 'development-replay-clip-v1',
        sourceSha256: report.sourceSha256,
        sessionId: request.sessionId,
        markId: request.markId,
        replayProfile,
        limits,
        frames,
      }),
      mimeType: 'application/json',
    })
    if (
      currentIdentity !==
        prelaunchIdentity(
          profileRuntimeDescriptorBeforeLaunchV1(
            recordedProfile,
            retained.trace.inputMode
          )
        ) ||
      prelaunchIdentity(replayPrepared) !==
        prelaunchIdentity(
          profileRuntimeDescriptorBeforeLaunchV1(
            replayProfile,
            retained.trace.inputMode
          )
        ) ||
      policySha256 !== developmentReproducerPolicySha256V2()
    )
      throw new Error(
        'runtime/debug authority or reproducer policy changed during replay'
      )
    report.disposition = report.firstDivergence ? 'diverged' : 'matched'
  }
  catch (error)
  {
    const code =
      error && typeof error === 'object' && 'code' in error ? error.code : null
    evidenceBudgetFailure ||=
      [
        'development.evidence_budget_exceeded',
        'development.retention_budget_exceeded',
        'development.invalid_evidence',
      ].includes(typeof code === 'string' ? code : '') ||
      (error instanceof Error &&
        [
          'dense visual frame budget exhausted',
          'dense visual byte budget exhausted',
        ].includes(error.message))
    issues.push(
      error instanceof Error
        ? error.message
        : 'marked reproduction is unavailable'
    )
    report.disposition = 'unavailable'
  }
  finally
  {
    await engine?.close().catch((error: unknown) =>
    {
      issues.push(
        error instanceof Error ? error.message : 'replay browser cleanup failed'
      )
      report.disposition = 'unavailable'
    })
  }
  report.frames = frames
  report.checkpoints = checkpoints
  report.issues = issues
  let completed: DevelopmentReproductionReportV2 = {
    ...report,
    evidenceSha256: developmentReproductionEvidenceSha256V1(report),
  }
  let ref = fallbackRef
  if (
    !evidenceBudgetFailure &&
    bytes(completed).byteLength <= POLICY_V1.maxReportBytes
  )
  {
    try
    {
      ref = await request.service.retainEvidence({
        sessionId: request.sessionId,
        kind: 'reproduction',
        bytes: bytes(completed),
        mimeType: 'application/json',
      })
    }
    catch
    {
      completed = fallback
    }
  }
  else completed = fallback
  completed = JSON.parse(
    JSON.stringify(completed)
  ) as DevelopmentReproductionReportV2
  return {
    sessionId: request.sessionId,
    markId: request.markId,
    disposition: completed.disposition,
    replayClassification: completed.replayClassification,
    sourceSha256: completed.sourceSha256,
    result: ref,
    clip: completed.clip,
    frames: frames.map((frame) => frame.image),
    firstDivergence: completed.firstDivergence,
    issues: completed.issues,
  }
}

function verifyAppliedPrefix(
  expected: readonly DevelopmentInputRecordV2[],
  applied: readonly ProfileAppliedInputEventV2[]
): void
{
  if (
    expected.length !== applied.length ||
    expected.some((input, index) =>
    {
      const actual = applied[index]
      return (
        !actual ||
        actual.ordinal !== input.ordinal ||
        actual.tick !== input.tick ||
        actual.device !== input.device ||
        jsonHash(actual.data) !== jsonHash(input.data) ||
        actual.interpretedKey !== input.interpretedKey ||
        jsonHash(actual.releasedKeys) !== jsonHash(input.releasedKeys)
      )
    })
  )
    throw new Error(
      'replay did not apply every exact recorded VM payload in ordinal/tick order'
    )
}
