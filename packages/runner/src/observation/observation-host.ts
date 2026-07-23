// packages/runner/src/observation/observation-host.ts
// host-only canonical hashes, exclusive writes, & portable media verification

import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import {
  dirname,
  isAbsolute,
  join,
  posix,
  relative,
  resolve,
  sep,
} from 'node:path'

import { PNG } from 'pngjs'

import type { IdentityBoundScenarioV1 } from '../scenario/identity-bound-scenario.js'
import type { Scenario } from '../policy/types.js'
import {
  RUNNER_OBSERVATION_SCHEMA_VERSION,
  type MediaManifestV1,
  type ObservationTraceV1,
  type ObservationPlanIssue,
  type ObservationPlanV1,
} from './observation.js'
import type { RuntimeFileIdentityV1 } from '../lineage/runtime-identity.js'
import {
  buildRuntimeLineageManifestBodyV1,
  sealRuntimeLineageManifestV1,
  type RuntimeLineageManifestV1,
  type RuntimeLineageTargetInputV1,
} from '../lineage/runtime-lineage.js'
import { errorMessage } from '../error-message.js'

function canonicalValue(value: unknown, path: string): string
{
  if (value === null) return 'null'
  if (typeof value === 'string' || typeof value === 'boolean')
    return JSON.stringify(value)
  if (typeof value === 'number')
  {
    if (!Number.isFinite(value))
      throw new Error(`non-finite number in canonical value at ${path}`)
    return JSON.stringify(Object.is(value, -0) ? 0 : value)
  }
  if (typeof value !== 'object')
    throw new Error(`non-JSON canonical value at ${path}`)
  if (Array.isArray(value))
  {
    const entries: string[] = []
    for (let index = 0; index < value.length; index++)
    {
      if (!(index in value)) throw new Error(`sparse array at ${path}`)
      entries.push(canonicalValue(value[index], `${path}[${index}]`))
    }
    return `[${entries.join(',')}]`
  }
  const prototype = Object.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== null)
    throw new Error(`non-plain canonical value at ${path}`)
  const record = value as Record<string, unknown>
  return `{${Object.keys(record)
    .sort()
    .map((key) =>
    {
      if (record[key] === undefined)
        throw new Error(`undefined at ${path}.${key}`)
      return `${JSON.stringify(key)}:${canonicalValue(record[key], `${path}.${key}`)}`
    })
    .join(',')}}`
}

export function hashRunnerJson(value: unknown): string
{
  return createHash('sha256').update(canonicalValue(value, '$')).digest('hex')
}

export function hashScenario(scenario: Scenario): string
{
  return hashRunnerJson(scenario)
}

export function hashObservationPlan(plan: ObservationPlanV1): string
{
  return hashRunnerJson(plan)
}

export function hashRuntimeConfiguration(value: unknown): string
{
  return hashRunnerJson(value)
}

// derive & seal a runtime lineage manifest for exactly these artifact bytes;
// the hash covers the whole body, so a manifest cannot be replayed against
// different bytes or a mutated target table
function deriveRuntimeLineageManifestV1(input: {
  readonly artifactSha256: string
  readonly targets: readonly RuntimeLineageTargetInputV1[]
}): RuntimeLineageManifestV1
{
  const body = buildRuntimeLineageManifestBodyV1(input)
  return sealRuntimeLineageManifestV1(body, hashRunnerJson(body))
}

export function runtimeLineageManifestForBytes(
  sb3: Uint8Array,
  targets: readonly RuntimeLineageTargetInputV1[]
): RuntimeLineageManifestV1
{
  return deriveRuntimeLineageManifestV1({
    artifactSha256: identityForBytes('candidate.sb3', sb3).sha256,
    targets,
  })
}

export function createObservationTrace(
  sb3: Uint8Array,
  scenario: Scenario,
  plan: ObservationPlanV1
): ObservationTraceV1
{
  return createObservationTraceWithScenarioHash(
    sb3,
    hashScenario(scenario),
    plan
  )
}

function createObservationTraceWithScenarioHash(
  sb3: Uint8Array,
  scenarioSha256: string,
  plan: ObservationPlanV1
): ObservationTraceV1
{
  return {
    schemaVersion: RUNNER_OBSERVATION_SCHEMA_VERSION,
    sourceSb3Sha256: identityForBytes('source.sb3', sb3).sha256,
    scenarioSha256,
    plan: structuredClone(plan),
    planSha256: hashObservationPlan(plan),
    cloneCounts: [],
    media: null,
  }
}

// the identity-bound sibling: this hash covers the lowered lineage-valued
// timeline, which differs per side under an authorized rename. only the eval-owned
// projected-differential adapter re-establishes equality; this hash never weakens.
export function createIdentityBoundObservationTrace(
  sb3: Uint8Array,
  scenario: IdentityBoundScenarioV1,
  plan: ObservationPlanV1
): ObservationTraceV1
{
  return createObservationTraceWithScenarioHash(
    sb3,
    hashIdentityBoundScenario(scenario),
    plan
  )
}

export function hashIdentityBoundScenario(
  scenario: IdentityBoundScenarioV1
): string
{
  return hashRunnerJson(scenario)
}

function portablePath(value: string): boolean
{
  return (
    value.length > 0 &&
    !isAbsolute(value) &&
    !value.includes('\\') &&
    posix.normalize(value) === value &&
    value !== '..' &&
    !value.startsWith('../')
  )
}

function resolvedMediaPath(root: string, relativePath: string): string
{
  if (!portablePath(relativePath))
    throw new Error(`invalid manifest-relative path: ${relativePath}`)
  const resolvedRoot = resolve(root)
  const path = resolve(join(resolvedRoot, relativePath))
  const fromRoot = relative(resolvedRoot, path)
  if (fromRoot === '..' || fromRoot.startsWith(`..${sep}`))
    throw new Error(`media path escapes its root: ${relativePath}`)
  return path
}

export function identityForBytes(
  path: string,
  bytes: Uint8Array
): RuntimeFileIdentityV1
{
  return {
    path,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    byteLength: bytes.byteLength,
  }
}

export function writeMediaFileExclusive(
  root: string,
  relativePath: string,
  bytes: Uint8Array
): RuntimeFileIdentityV1
{
  const path = resolvedMediaPath(root, relativePath)
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, bytes, { flag: 'wx' })
  return identityForBytes(relativePath, bytes)
}

function readMediaFileIdentity(
  root: string,
  relativePath: string
): RuntimeFileIdentityV1
{
  const path = resolvedMediaPath(root, relativePath)
  const bytes = readFileSync(path)
  const stat = statSync(path)
  if (!stat.isFile())
    throw new Error(`media artifact is not a file: ${relativePath}`)
  return identityForBytes(relativePath, bytes)
}

function readMediaBytes(root: string, relativePath: string): Buffer
{
  const path = resolvedMediaPath(root, relativePath)
  const stat = statSync(path)
  if (!stat.isFile())
    throw new Error(`media artifact is not a file: ${relativePath}`)
  return readFileSync(path)
}

function pngMeanRgb(png: PNG): [number, number, number]
{
  let red = 0
  let green = 0
  let blue = 0
  const pixels = png.width * png.height
  for (let index = 0; index < png.data.length; index += 4)
  {
    red += png.data[index] ?? 0
    green += png.data[index + 1] ?? 0
    blue += png.data[index + 2] ?? 0
  }
  return [red / pixels, green / pixels, blue / pixels]
}

function pngSampledMeanRgb(png: PNG, columns: number, rows: number): number[]
{
  const cells = columns * rows
  const red = new Float64Array(cells)
  const green = new Float64Array(cells)
  const blue = new Float64Array(cells)
  const count = new Uint32Array(cells)
  for (let y = 0; y < png.height; y++)
  {
    const row = Math.min(rows - 1, Math.floor((y * rows) / png.height))
    for (let x = 0; x < png.width; x++)
    {
      const column = Math.min(
        columns - 1,
        Math.floor((x * columns) / png.width)
      )
      const cell = row * columns + column
      const pixel = (y * png.width + x) * 4
      red[cell]! += png.data[pixel] ?? 0
      green[cell]! += png.data[pixel + 1] ?? 0
      blue[cell]! += png.data[pixel + 2] ?? 0
      count[cell]! += 1
    }
  }
  const values = new Array<number>(cells * 3)
  for (let cell = 0; cell < cells; cell++)
  {
    const samples = count[cell] || 1
    values[cell * 3] = Math.round(red[cell]! / samples)
    values[cell * 3 + 1] = Math.round(green[cell]! / samples)
    values[cell * 3 + 2] = Math.round(blue[cell]! / samples)
  }
  return values
}

function mediaIssue(
  issues: ObservationPlanIssue[],
  path: string,
  code: ObservationPlanIssue['code'],
  message: string
): void
{
  issues.push({ path, code, message })
}

export function verifyMediaManifest(
  manifest: MediaManifestV1,
  root: string,
  plan: ObservationPlanV1
): ObservationPlanIssue[]
{
  const issues: ObservationPlanIssue[] = []
  if (manifest.observationPlanSha256 !== hashObservationPlan(plan))
    mediaIssue(
      issues,
      '$.observationPlanSha256',
      'inconsistent',
      'manifest is bound to a different observation plan'
    )
  const ids = new Set<string>()
  let previousTick = -1
  let frameBytes = 0
  manifest.frames.forEach((frame, index) =>
  {
    const path = `$.frames[${index}]`
    if (frame.index !== index)
      mediaIssue(
        issues,
        `${path}.index`,
        'inconsistent',
        'frame indexes are not contiguous'
      )
    if (ids.has(frame.id))
      mediaIssue(
        issues,
        `${path}.id`,
        'inconsistent',
        'frame IDs must be unique'
      )
    ids.add(frame.id)
    if (frame.tick <= previousTick)
      mediaIssue(
        issues,
        `${path}.tick`,
        'inconsistent',
        'frame ticks must be increasing'
      )
    previousTick = frame.tick
    frameBytes += frame.bytes
    try
    {
      const identity = readMediaFileIdentity(root, frame.relativePath)
      if (
        identity.sha256 !== frame.sha256 ||
        identity.byteLength !== frame.bytes
      )
        mediaIssue(
          issues,
          path,
          'inconsistent',
          'frame file identity does not match the manifest'
        )
      const bytes = readMediaBytes(root, frame.relativePath)
      const png = PNG.sync.read(bytes)
      if (png.width !== frame.width || png.height !== frame.height)
        mediaIssue(
          issues,
          path,
          'inconsistent',
          'decoded frame dimensions do not match the manifest'
        )
      const mean = pngMeanRgb(png)
      if (
        mean.some(
          (value, channel) => Math.abs(value - frame.meanRgb[channel]!) > 1e-9
        )
      )
        mediaIssue(
          issues,
          `${path}.meanRgb`,
          'inconsistent',
          'decoded frame mean RGB does not match the manifest'
        )
      const sampled = frame.sampledMeanRgb
      if (
        !Number.isSafeInteger(sampled.columns) ||
        !Number.isSafeInteger(sampled.rows) ||
        sampled.columns < 1 ||
        sampled.columns > 64 ||
        sampled.rows < 1 ||
        sampled.rows > 64 ||
        sampled.values.length !== sampled.columns * sampled.rows * 3
      )
        mediaIssue(
          issues,
          `${path}.sampledMeanRgb`,
          'invalid-value',
          'sampled RGB grid has invalid dimensions or length'
        )
      else if (
        pngSampledMeanRgb(png, sampled.columns, sampled.rows).some(
          (value, sampleIndex) => value !== sampled.values[sampleIndex]
        )
      )
        mediaIssue(
          issues,
          `${path}.sampledMeanRgb`,
          'inconsistent',
          'decoded frame sampled RGB does not match the manifest'
        )
    }
    catch (error)
    {
      mediaIssue(
        issues,
        `${path}.relativePath`,
        'invalid-value',
        errorMessage(error)
      )
    }
  })
  if (frameBytes !== manifest.totalFrameBytes)
    mediaIssue(
      issues,
      '$.totalFrameBytes',
      'inconsistent',
      'frame byte total does not match the manifest'
    )
  if (plan.temporal && frameBytes > plan.temporal.maxBytes)
    mediaIssue(
      issues,
      '$.totalFrameBytes',
      'limit-exceeded',
      'authoritative frame bytes exceed the plan budget'
    )
  const video = manifest.derivedVideo
  if (video)
  {
    if (!video.sourceFrameIds.every((id) => ids.has(id)))
      mediaIssue(
        issues,
        '$.derivedVideo.sourceFrameIds',
        'inconsistent',
        'derived video references an unknown frame'
      )
    if (plan.temporal && video.bytes > plan.temporal.maxBytes)
      mediaIssue(
        issues,
        '$.derivedVideo.bytes',
        'limit-exceeded',
        'derived video exceeds its independent byte budget'
      )
    try
    {
      const identity = readMediaFileIdentity(root, video.relativePath)
      if (
        identity.sha256 !== video.sha256 ||
        identity.byteLength !== video.bytes
      )
        mediaIssue(
          issues,
          '$.derivedVideo',
          'inconsistent',
          'derived video identity does not match the manifest'
        )
    }
    catch (error)
    {
      mediaIssue(
        issues,
        '$.derivedVideo.relativePath',
        'invalid-value',
        errorMessage(error)
      )
    }
  }
  return issues
}
