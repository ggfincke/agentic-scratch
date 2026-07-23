// packages/runner/src/observation/observation.ts
// bounded logical observations & authoritative media manifests for Multimodal

import type { RuntimeDescriptorV1 } from '../lineage/runtime-identity.js'

export const RUNNER_OBSERVATION_SCHEMA_VERSION = 1 as const
const MAX_TEMPORAL_TICKS = 720
const MAX_TEMPORAL_FRAMES = 120
export const MAX_TEMPORAL_BYTES = 25 * 1024 * 1024
const MIN_TEMPORAL_SAMPLE_TICKS = 6

export interface ObservationPlanIssue
{
  path: string
  code: 'invalid-value' | 'limit-exceeded' | 'inconsistent'
  message: string
}

type ObservationPlanValidation =
  | {
      ok: true
      value: ObservationPlanV1
      theoreticalFrameCount: number
    }
  | { ok: false; issues: ObservationPlanIssue[] }

interface TemporalObservationSpecV1
{
  firstTick: number
  lastTick: number
  everyTicks: number
  playbackFps: number
  maxFrames: number
  maxBytes: number
  derivedVideo: boolean
}

export interface ObservationPlanV1
{
  schemaVersion: typeof RUNNER_OBSERVATION_SCHEMA_VERSION
  temporal: TemporalObservationSpecV1 | null
  cloneCounts: 'none' | 'sampled' | 'every-tick'
}

export interface CloneCountSampleV1
{
  tick: number
  scenarioStepIndex: number
  snapshotLabel: string | null
  total: number
  byOriginalTargetId: Record<string, number>
}

interface RendererTargetGeometryV1
{
  originalTargetId: string
  name: string
  isStage: boolean
  instance: 'original' | 'clone'
  instanceIndex: number
  visible: boolean
  costumeIndex: number
  costumeName: string
  rect: { x: number; y: number; width: number; height: number } | null
}

export interface RendererGeometryV1
{
  canvas: { width: number; height: number }
  targets: RendererTargetGeometryV1[]
}

export interface MediaFrameRefV1
{
  id: string
  index: number
  tick: number
  scenarioStepIndex: number
  snapshotLabel: string | null
  relativePath: string
  mimeType: 'image/png'
  width: number
  height: number
  meanRgb: [number, number, number]
  sampledMeanRgb: { columns: number; rows: number; values: number[] }
  geometry: RendererGeometryV1
  bytes: number
  sha256: string
}

export interface DerivedVideoRefV1
{
  id: string
  relativePath: string
  mimeType: 'video/webm' | 'video/mp4'
  width: number
  height: number
  durationMs: number
  playbackFps: number
  bytes: number
  sha256: string
  authoritative: false
  sourceFrameIds: string[]
}

export interface MediaManifestV1
{
  schemaVersion: typeof RUNNER_OBSERVATION_SCHEMA_VERSION
  observationPlanSha256: string
  runtime: RuntimeDescriptorV1
  frames: MediaFrameRefV1[]
  derivedVideo: DerivedVideoRefV1 | null
  totalFrameBytes: number
  complete: boolean
  incompleteReason: string | null
}

export interface ObservationTraceV1
{
  schemaVersion: typeof RUNNER_OBSERVATION_SCHEMA_VERSION
  sourceSb3Sha256: string
  scenarioSha256: string
  plan: ObservationPlanV1
  planSha256: string
  cloneCounts: CloneCountSampleV1[]
  media: MediaManifestV1 | null
}

export function defaultObservationPlan(): ObservationPlanV1
{
  return {
    schemaVersion: RUNNER_OBSERVATION_SCHEMA_VERSION,
    temporal: null,
    cloneCounts: 'none',
  }
}

function planIssue(
  issues: ObservationPlanIssue[],
  path: string,
  code: ObservationPlanIssue['code'],
  message: string
): void
{
  issues.push({ path, code, message })
}

function safeInteger(value: number): boolean
{
  return Number.isSafeInteger(value)
}

function recordValue(value: unknown): Record<string, unknown> | null
{
  if (value === null || typeof value !== 'object' || Array.isArray(value))
    return null
  const prototype = Object.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== null) return null
  return value as Record<string, unknown>
}

function rejectExtraKeys(
  record: Record<string, unknown>,
  allowed: readonly string[],
  path: string,
  issues: ObservationPlanIssue[]
): void
{
  const allowedKeys = new Set(allowed)
  for (const key of Object.keys(record))
  {
    if (!allowedKeys.has(key))
      planIssue(
        issues,
        `${path}.${key}`,
        'invalid-value',
        'unknown observation-plan field'
      )
  }
  for (const key of allowed)
  {
    if (!(key in record))
      planIssue(
        issues,
        `${path}.${key}`,
        'invalid-value',
        'missing observation-plan field'
      )
  }
}

export function validateObservationPlan(
  input: unknown
): ObservationPlanValidation
{
  const issues: ObservationPlanIssue[] = []
  const plan = recordValue(input)
  if (!plan)
    return {
      ok: false,
      issues: [
        {
          path: '$',
          code: 'invalid-value',
          message: 'expected a plain observation-plan object',
        },
      ],
    }
  rejectExtraKeys(
    plan,
    ['schemaVersion', 'temporal', 'cloneCounts'],
    '$',
    issues
  )
  if (plan.schemaVersion !== RUNNER_OBSERVATION_SCHEMA_VERSION)
    planIssue(
      issues,
      '$.schemaVersion',
      'invalid-value',
      'unsupported observation-plan schema version'
    )
  if (
    typeof plan.cloneCounts !== 'string' ||
    !['none', 'sampled', 'every-tick'].includes(plan.cloneCounts)
  )
    planIssue(
      issues,
      '$.cloneCounts',
      'invalid-value',
      'unknown clone-count observation mode'
    )
  const temporal = plan.temporal
  if (temporal === null)
  {
    if (issues.length > 0) return { ok: false, issues }
    return {
      ok: true,
      value: {
        schemaVersion: RUNNER_OBSERVATION_SCHEMA_VERSION,
        temporal: null,
        cloneCounts: plan.cloneCounts as ObservationPlanV1['cloneCounts'],
      },
      theoreticalFrameCount: 0,
    }
  }
  const temporalRecord = recordValue(temporal)
  if (!temporalRecord)
  {
    planIssue(
      issues,
      '$.temporal',
      'invalid-value',
      'expected null or a plain temporal-observation object'
    )
    return { ok: false, issues }
  }
  rejectExtraKeys(
    temporalRecord,
    [
      'firstTick',
      'lastTick',
      'everyTicks',
      'playbackFps',
      'maxFrames',
      'maxBytes',
      'derivedVideo',
    ],
    '$.temporal',
    issues
  )
  const firstTick = temporalRecord.firstTick
  const lastTick = temporalRecord.lastTick
  const everyTicks = temporalRecord.everyTicks
  const playbackFps = temporalRecord.playbackFps
  const maxFrames = temporalRecord.maxFrames
  const maxBytes = temporalRecord.maxBytes
  const derivedVideo = temporalRecord.derivedVideo
  for (const [key, value] of [
    ['firstTick', firstTick],
    ['lastTick', lastTick],
    ['everyTicks', everyTicks],
    ['maxFrames', maxFrames],
    ['maxBytes', maxBytes],
  ] as const)
  {
    if (typeof value !== 'number' || !safeInteger(value))
      planIssue(
        issues,
        `$.temporal.${key}`,
        'invalid-value',
        'expected a safe integer'
      )
  }
  if (typeof derivedVideo !== 'boolean')
    planIssue(
      issues,
      '$.temporal.derivedVideo',
      'invalid-value',
      'expected a boolean'
    )
  if (typeof firstTick === 'number' && firstTick < 0)
    planIssue(
      issues,
      '$.temporal.firstTick',
      'invalid-value',
      'first tick cannot be negative'
    )
  if (
    typeof lastTick === 'number' &&
    typeof firstTick === 'number' &&
    lastTick < firstTick
  )
    planIssue(
      issues,
      '$.temporal.lastTick',
      'inconsistent',
      'last tick cannot precede first tick'
    )
  if (
    typeof lastTick === 'number' &&
    typeof firstTick === 'number' &&
    lastTick - firstTick > MAX_TEMPORAL_TICKS
  )
    planIssue(
      issues,
      '$.temporal.lastTick',
      'limit-exceeded',
      `temporal duration exceeds ${MAX_TEMPORAL_TICKS} ticks`
    )
  if (typeof everyTicks === 'number' && everyTicks < MIN_TEMPORAL_SAMPLE_TICKS)
    planIssue(
      issues,
      '$.temporal.everyTicks',
      'limit-exceeded',
      `sample cadence must be at least ${MIN_TEMPORAL_SAMPLE_TICKS} ticks`
    )
  if (
    typeof playbackFps !== 'number' ||
    !Number.isFinite(playbackFps) ||
    playbackFps <= 0 ||
    playbackFps > 60
  )
    planIssue(
      issues,
      '$.temporal.playbackFps',
      'invalid-value',
      'playback FPS must be finite and within 0..60'
    )
  if (
    typeof maxFrames === 'number' &&
    (maxFrames < 1 || maxFrames > MAX_TEMPORAL_FRAMES)
  )
    planIssue(
      issues,
      '$.temporal.maxFrames',
      'limit-exceeded',
      `frame bound must be within 1..${MAX_TEMPORAL_FRAMES}`
    )
  if (
    typeof maxBytes === 'number' &&
    (maxBytes < 1 || maxBytes > MAX_TEMPORAL_BYTES)
  )
    planIssue(
      issues,
      '$.temporal.maxBytes',
      'limit-exceeded',
      `byte bound must be within 1..${MAX_TEMPORAL_BYTES}`
    )
  const theoreticalFrameCount =
    typeof firstTick === 'number' &&
    typeof lastTick === 'number' &&
    typeof everyTicks === 'number' &&
    lastTick >= firstTick &&
    everyTicks > 0
      ? Math.floor((lastTick - firstTick) / everyTicks) + 1
      : 0
  if (typeof maxFrames === 'number' && theoreticalFrameCount > maxFrames)
    planIssue(
      issues,
      '$.temporal.maxFrames',
      'limit-exceeded',
      `plan requests ${theoreticalFrameCount} frames but maxFrames is ${maxFrames}`
    )
  if (theoreticalFrameCount > MAX_TEMPORAL_FRAMES)
    planIssue(
      issues,
      '$.temporal',
      'limit-exceeded',
      `plan exceeds the hard ${MAX_TEMPORAL_FRAMES}-frame limit`
    )
  if (issues.length > 0) return { ok: false, issues }
  return {
    ok: true,
    value: {
      schemaVersion: RUNNER_OBSERVATION_SCHEMA_VERSION,
      temporal: {
        firstTick: firstTick as number,
        lastTick: lastTick as number,
        everyTicks: everyTicks as number,
        playbackFps: playbackFps as number,
        maxFrames: maxFrames as number,
        maxBytes: maxBytes as number,
        derivedVideo: derivedVideo as boolean,
      },
      cloneCounts: plan.cloneCounts as ObservationPlanV1['cloneCounts'],
    },
    theoreticalFrameCount,
  }
}

// ---------------------------------------------------------------------------
// incremental runtime-observation caps
// ---------------------------------------------------------------------------

const RUNNER_OBSERVATION_RESOURCE_EXCEEDED =
  'runner.observation_resource_exceeded'
const RUNNER_OBSERVATION_NON_SCALAR = 'runner.observation_non_scalar'

export type ObservedRuntimeNumberV1 =
  | { readonly numberKind: 'finite'; readonly value: number }
  | { readonly numberKind: 'negativeZero' }
  | { readonly numberKind: 'nan' }
  | { readonly numberKind: 'positiveInfinity' }
  | { readonly numberKind: 'negativeInfinity' }

export type ObservedRuntimeScalarV1 =
  | { readonly scalarKind: 'string'; readonly value: string }
  | { readonly scalarKind: 'boolean'; readonly value: boolean }
  | { readonly scalarKind: 'number'; readonly value: ObservedRuntimeNumberV1 }

type RuntimeObservationValueKindV1 =
  | 'null'
  | 'undefined'
  | 'string'
  | 'boolean'
  | 'number'
  | 'bigint'
  | 'symbol'
  | 'function'
  | 'array'
  | 'record'
  | 'object'

export interface RuntimeObservationNonScalarV1
{
  readonly code: typeof RUNNER_OBSERVATION_NON_SCALAR
  readonly scope: string
  readonly expected: 'scalar' | 'scalar-list' | 'plain-record' | 'data-property'
  readonly observedKind: RuntimeObservationValueKindV1
}

class RuntimeObservationNonScalarError extends Error
{
  readonly issue: RuntimeObservationNonScalarV1

  constructor(issue: RuntimeObservationNonScalarV1)
  {
    super(
      `${issue.expected} observation at ${issue.scope} received ${issue.observedKind}`
    )
    this.name = 'RuntimeObservationNonScalarError'
    this.issue = issue
  }
}

export function isRuntimeObservationNonScalarError(
  error: unknown
): error is RuntimeObservationNonScalarError
{
  return error instanceof RuntimeObservationNonScalarError
}

export function runtimeObservationValueKindV1(
  value: unknown
): RuntimeObservationValueKindV1
{
  if (value === null) return 'null'
  if (Array.isArray(value)) return 'array'
  const kind = typeof value
  if (kind !== 'object') return kind
  try
  {
    const prototype = Object.getPrototypeOf(value)
    return prototype === Object.prototype || prototype === null
      ? 'record'
      : 'object'
  }
  catch
  {
    return 'object'
  }
}

export function refuseRuntimeObservationValueV1(
  scope: string,
  expected: RuntimeObservationNonScalarV1['expected'],
  value: unknown
): never
{
  throw new RuntimeObservationNonScalarError(
    Object.freeze({
      code: RUNNER_OBSERVATION_NON_SCALAR,
      scope,
      expected,
      observedKind: runtimeObservationValueKindV1(value),
    })
  )
}

export function projectObservedRuntimeNumberV1(
  value: number
): ObservedRuntimeNumberV1
{
  if (Object.is(value, -0)) return Object.freeze({ numberKind: 'negativeZero' })
  if (Number.isNaN(value)) return Object.freeze({ numberKind: 'nan' })
  if (value === Number.POSITIVE_INFINITY)
    return Object.freeze({ numberKind: 'positiveInfinity' })
  if (value === Number.NEGATIVE_INFINITY)
    return Object.freeze({ numberKind: 'negativeInfinity' })
  return Object.freeze({ numberKind: 'finite', value })
}

// this is the only entry from an unknown runtime value into a retained scalar;
// non-scalars fail before JSON encoding, display conversion, or partial copying
function projectObservedRuntimeScalarV1(
  value: unknown,
  scope: string
): ObservedRuntimeScalarV1
{
  if (typeof value === 'string')
    return Object.freeze({ scalarKind: 'string', value })
  if (typeof value === 'boolean')
    return Object.freeze({ scalarKind: 'boolean', value })
  if (typeof value === 'number')
    return Object.freeze({
      scalarKind: 'number',
      value: projectObservedRuntimeNumberV1(value),
    })
  return refuseRuntimeObservationValueV1(scope, 'scalar', value)
}

type RuntimeObservationResource =
  | 'list-items'
  | 'scalar-slots'
  | 'scalar-bytes'
  | 'snapshot-bytes'
  | 'records'
  | 'trace-bytes'
  | 'attempt-trace-bytes'

// bounded failure metadata for a crossed cap: counters plus an identity-only
// scope, never a value or prefix a comparison could mistake for agreement
export interface RuntimeObservationOverflowV1
{
  readonly code: typeof RUNNER_OBSERVATION_RESOURCE_EXCEEDED
  readonly resource: RuntimeObservationResource
  readonly scope: string
  readonly observed: number
  readonly limit: number
}

export interface RuntimeObservationCapsV1
{
  readonly listItemsPerList: number
  readonly scalarSlotsPerSnapshot: number
  readonly scalarBytesPerValue: number
  readonly snapshotBytes: number
  readonly recordsPerCell: number
  readonly traceBytesPerCell: number
  readonly traceBytesPerAttempt: number
}

export interface RuntimeObservationCellOptionsV1
{
  readonly caps: RuntimeObservationCapsV1
  readonly carriedAttemptTraceBytes?: number
}

export const DEFAULT_RUNTIME_OBSERVATION_CAPS: RuntimeObservationCapsV1 =
  Object.freeze({
    listItemsPerList: 25_000,
    scalarSlotsPerSnapshot: 100_000,
    scalarBytesPerValue: 64 * 1024,
    snapshotBytes: 8 * 1024 * 1024,
    recordsPerCell: 4_096,
    traceBytesPerCell: 32 * 1024 * 1024,
    traceBytesPerAttempt: 128 * 1024 * 1024,
  })

export const MAX_RUNTIME_OBSERVATION_CAPS: RuntimeObservationCapsV1 =
  Object.freeze({
    listItemsPerList: 50_000,
    scalarSlotsPerSnapshot: 250_000,
    scalarBytesPerValue: 256 * 1024,
    snapshotBytes: 32 * 1024 * 1024,
    recordsPerCell: 8_192,
    traceBytesPerCell: 128 * 1024 * 1024,
    traceBytesPerAttempt: 512 * 1024 * 1024,
  })

class RuntimeObservationOverflowError extends Error
{
  readonly overflow: RuntimeObservationOverflowV1

  constructor(overflow: RuntimeObservationOverflowV1)
  {
    super(
      `${overflow.resource} observation at ${overflow.scope} reached ${overflow.observed}, exceeding ${overflow.limit}`
    )
    this.name = 'RuntimeObservationOverflowError'
    this.overflow = overflow
  }
}

export function isRuntimeObservationOverflowError(
  error: unknown
): error is RuntimeObservationOverflowError
{
  return error instanceof RuntimeObservationOverflowError
}

export function clampRuntimeObservationCaps(
  requested: Partial<RuntimeObservationCapsV1>
): RuntimeObservationCapsV1
{
  const keys = Object.keys(
    DEFAULT_RUNTIME_OBSERVATION_CAPS
  ) as (keyof RuntimeObservationCapsV1)[]
  const clamped: Record<string, number> = {}
  for (const key of keys)
  {
    const value = requested[key]
    const fallback = DEFAULT_RUNTIME_OBSERVATION_CAPS[key]
    const chosen =
      typeof value === 'number' && Number.isSafeInteger(value) && value > 0
        ? value
        : fallback
    clamped[key] = Math.min(chosen, MAX_RUNTIME_OBSERVATION_CAPS[key])
  }
  return Object.freeze(clamped as unknown as RuntimeObservationCapsV1)
}

function utf8ByteLength(text: string): number
{
  let bytes = 0
  for (let index = 0; index < text.length; index++)
  {
    const code = text.charCodeAt(index)
    if (code < 0x80) bytes += 1
    else if (code < 0x800) bytes += 2
    else if (code >= 0xd800 && code <= 0xdbff && index + 1 < text.length)
    {
      bytes += 4
      index += 1
    }
    else bytes += 3
  }
  return bytes
}

// canonical byte size of one observed scalar; strings are pre-screened on
// character count so an oversized value is never encoded, since UTF-8 never
// uses fewer than one byte per character
function canonicalScalarByteLength(
  value: ObservedRuntimeScalarV1,
  limit: number
): number
{
  if (value.scalarKind === 'string' && value.value.length > limit)
    return value.value.length
  return utf8ByteLength(JSON.stringify(value))
}

export interface RuntimeObservationBudgetTotalsV1
{
  readonly scalarSlots: number
  readonly snapshotBytes: number
  readonly records: number
  readonly cellTraceBytes: number
  readonly attemptTraceBytes: number
}

// incremental charger for one lane/scenario/side cell; every charge runs before
// the matching slice, spread, or append, & crossing a bound permanently poisons
// the budget so no truncated snapshot can be presented as equality evidence
export interface RuntimeObservationBudgetV1
{
  readonly caps: RuntimeObservationCapsV1
  beginSnapshot(): void
  chargeListItems(scope: string, itemCount: number): void
  chargeContainerItems(scope: string, itemCount: number): void
  chargeScalar(scope: string, value: unknown): ObservedRuntimeScalarV1
  chargeScalarBytes(scope: string, value: unknown): ObservedRuntimeScalarV1
  chargeSnapshotBytes(scope: string, bytes: number): void
  chargeRecords(scope: string, count: number): void
  chargeTraceBytes(scope: string, bytes: number): void
  overflow(): RuntimeObservationOverflowV1 | null
  totals(): RuntimeObservationBudgetTotalsV1
}

export function createRuntimeObservationBudget(
  caps: RuntimeObservationCapsV1 = DEFAULT_RUNTIME_OBSERVATION_CAPS,
  carriedAttemptTraceBytes = 0
): RuntimeObservationBudgetV1
{
  let scalarSlots = 0
  let snapshotBytes = 0
  let records = 0
  let cellTraceBytes = 0
  let attemptTraceBytes = carriedAttemptTraceBytes
  let overflow: RuntimeObservationOverflowV1 | null = null

  function fail(
    resource: RuntimeObservationResource,
    scope: string,
    observed: number,
    limit: number
  ): never
  {
    const record: RuntimeObservationOverflowV1 = Object.freeze({
      code: RUNNER_OBSERVATION_RESOURCE_EXCEEDED,
      resource,
      scope,
      observed,
      limit,
    })
    overflow = record
    throw new RuntimeObservationOverflowError(record)
  }

  // an already-overflowed budget never allows another read; the cell is aborted
  function guard(): void
  {
    if (overflow) throw new RuntimeObservationOverflowError(overflow)
  }

  function chargeProjectedScalarBytes(
    scope: string,
    projected: ObservedRuntimeScalarV1
  ): void
  {
    const bytes = canonicalScalarByteLength(projected, caps.scalarBytesPerValue)
    if (bytes > caps.scalarBytesPerValue)
      fail('scalar-bytes', scope, bytes, caps.scalarBytesPerValue)
    const total = snapshotBytes + bytes
    if (total > caps.snapshotBytes)
      fail('snapshot-bytes', scope, total, caps.snapshotBytes)
    snapshotBytes = total
  }

  return {
    caps,
    beginSnapshot(): void
    {
      guard()
      scalarSlots = 0
      snapshotBytes = 0
    },
    chargeListItems(scope: string, itemCount: number): void
    {
      guard()
      if (itemCount > caps.listItemsPerList)
        fail('list-items', scope, itemCount, caps.listItemsPerList)
      const slots = scalarSlots + itemCount
      if (slots > caps.scalarSlotsPerSnapshot)
        fail('scalar-slots', scope, slots, caps.scalarSlotsPerSnapshot)
      scalarSlots = slots
    },
    chargeContainerItems(scope: string, itemCount: number): void
    {
      guard()
      if (itemCount > caps.listItemsPerList)
        fail('list-items', scope, itemCount, caps.listItemsPerList)
    },
    chargeScalar(scope: string, value: unknown): ObservedRuntimeScalarV1
    {
      guard()
      const projected = projectObservedRuntimeScalarV1(value, scope)
      const slots = scalarSlots + 1
      if (slots > caps.scalarSlotsPerSnapshot)
        fail('scalar-slots', scope, slots, caps.scalarSlotsPerSnapshot)
      scalarSlots = slots
      chargeProjectedScalarBytes(scope, projected)
      return projected
    },
    // list items already consumed their slots through chargeListItems; only their
    // canonical size is still outstanding
    chargeScalarBytes(scope: string, value: unknown): ObservedRuntimeScalarV1
    {
      guard()
      const projected = projectObservedRuntimeScalarV1(value, scope)
      chargeProjectedScalarBytes(scope, projected)
      return projected
    },
    chargeSnapshotBytes(scope: string, bytes: number): void
    {
      guard()
      const total = snapshotBytes + bytes
      if (total > caps.snapshotBytes)
        fail('snapshot-bytes', scope, total, caps.snapshotBytes)
      snapshotBytes = total
    },
    chargeRecords(scope: string, count: number): void
    {
      guard()
      const total = records + count
      if (total > caps.recordsPerCell)
        fail('records', scope, total, caps.recordsPerCell)
      records = total
    },
    chargeTraceBytes(scope: string, bytes: number): void
    {
      guard()
      const cell = cellTraceBytes + bytes
      if (cell > caps.traceBytesPerCell)
        fail('trace-bytes', scope, cell, caps.traceBytesPerCell)
      const attempt = attemptTraceBytes + bytes
      if (attempt > caps.traceBytesPerAttempt)
        fail('attempt-trace-bytes', scope, attempt, caps.traceBytesPerAttempt)
      cellTraceBytes = cell
      attemptTraceBytes = attempt
    },
    overflow(): RuntimeObservationOverflowV1 | null
    {
      return overflow
    },
    totals(): RuntimeObservationBudgetTotalsV1
    {
      return Object.freeze({
        scalarSlots,
        snapshotBytes,
        records,
        cellTraceBytes,
        attemptTraceBytes,
      })
    },
  }
}

export function observationTicks(plan: ObservationPlanV1): number[]
{
  const temporal = plan.temporal
  if (!temporal) return []
  const ticks: number[] = []
  for (
    let tick = temporal.firstTick;
    tick <= temporal.lastTick;
    tick += temporal.everyTicks
  )
    ticks.push(tick)
  return ticks
}
