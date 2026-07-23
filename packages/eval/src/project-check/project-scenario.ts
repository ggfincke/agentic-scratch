// packages/eval/src/project-check/project-scenario.ts
// validate agent-facing scenarios against bounded, network-free project policy

import {
  SCENARIO_STEP_KINDS,
  type Scenario,
  type Step,
} from '@scratch-agent/runner'
import { sha256 } from '../core/sha256.js'

const PROJECT_SCENARIO_CODES = {
  invalid: 'project.scenario.invalid',
  bytesExceeded: 'project.scenario.bytes-exceeded',
  depthExceeded: 'project.scenario.depth-exceeded',
  membersExceeded: 'project.scenario.members-exceeded',
  stepsExceeded: 'project.scenario.steps-exceeded',
  ticksExceeded: 'project.scenario.ticks-exceeded',
  broadcastWaitExceeded: 'project.scenario.broadcast-wait-exceeded',
  snapshotsExceeded: 'project.scenario.snapshots-exceeded',
  stringExceeded: 'project.scenario.string-exceeded',
  networkFieldForbidden: 'project.scenario.network-field-forbidden',
} as const

type ProjectScenarioCode =
  (typeof PROJECT_SCENARIO_CODES)[keyof typeof PROJECT_SCENARIO_CODES]

const DEFAULT_SMOKE_SCENARIO: Scenario = {
  seed: 0,
  maxTicks: 30,
  steps: [
    { do: 'snapshot', label: 'before-green-flag' },
    { do: 'greenFlag' },
    { do: 'snapshot', label: 'after-green-flag' },
    { do: 'wait', ticks: 30 },
    { do: 'snapshot', label: 'settled' },
  ],
}

const DEFAULT_PROJECT_SMOKE_SCENARIO: Readonly<Scenario> = Object.freeze(
  DEFAULT_SMOKE_SCENARIO
)

export const DEFAULT_PROJECT_SCENARIO_LIMITS = Object.freeze({
  maxRequestBytes: 64 * 1024,
  maxDepth: 8,
  maxMembers: 512,
  maxSteps: 64,
  maxTicks: 600,
  maxSnapshots: 8,
  maxStringBytes: 256,
  maxAnswerBytes: 4 * 1024,
  maxCoordinateMagnitude: 1_000_000,
})

export interface ProjectScenarioSummary
{
  profile: 'default-smoke' | 'custom'
  sha256: string
  stepCount: number
  maxTicks: number
  snapshotCount: number
}

export interface ParsedProjectScenario
{
  scenario: Scenario
  summary: ProjectScenarioSummary
}

export class ProjectScenarioError extends Error
{
  readonly code: ProjectScenarioCode

  constructor(code: ProjectScenarioCode, message: string)
  {
    super(message)
    this.name = 'ProjectScenarioError'
    this.code = code
  }
}

function fail(code: ProjectScenarioCode, message: string): never
{
  throw new ProjectScenarioError(code, message)
}

function record(value: unknown): value is Record<string, unknown>
{
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function onlyKeys(value: Record<string, unknown>, keys: string[]): boolean
{
  const allowed = new Set(keys)
  return Object.keys(value).every((key) => allowed.has(key))
}

function safeInteger(value: unknown, minimum = 0): value is number
{
  return Number.isSafeInteger(value) && Number(value) >= minimum
}

function finiteNumber(value: unknown): value is number
{
  return typeof value === 'number' && Number.isFinite(value)
}

function boundedString(value: unknown, answer = false): value is string
{
  if (typeof value !== 'string') return false
  const limit = answer
    ? DEFAULT_PROJECT_SCENARIO_LIMITS.maxAnswerBytes
    : DEFAULT_PROJECT_SCENARIO_LIMITS.maxStringBytes
  if (Buffer.byteLength(value, 'utf-8') > limit)
  {
    fail(
      PROJECT_SCENARIO_CODES.stringExceeded,
      `scenario string exceeds ${limit} UTF-8 bytes`
    )
  }
  return true
}

function validateShapeBudget(value: unknown): string
{
  let members = 0
  const seen = new Set<object>()
  const visit = (entry: unknown, depth: number): void =>
  {
    if (depth > DEFAULT_PROJECT_SCENARIO_LIMITS.maxDepth)
    {
      fail(
        PROJECT_SCENARIO_CODES.depthExceeded,
        `scenario nesting exceeds ${DEFAULT_PROJECT_SCENARIO_LIMITS.maxDepth}`
      )
    }
    if (entry === null || typeof entry !== 'object') return
    if (seen.has(entry))
    {
      fail(PROJECT_SCENARIO_CODES.invalid, 'scenario must not be cyclic')
    }
    seen.add(entry)
    const values = Array.isArray(entry)
      ? entry
      : Object.values(entry as Record<string, unknown>)
    members += values.length
    if (members > DEFAULT_PROJECT_SCENARIO_LIMITS.maxMembers)
    {
      fail(
        PROJECT_SCENARIO_CODES.membersExceeded,
        `scenario contains more than ${DEFAULT_PROJECT_SCENARIO_LIMITS.maxMembers} members`
      )
    }
    for (const child of values) visit(child, depth + 1)
    seen.delete(entry)
  }
  visit(value, 0)
  let json: string
  try
  {
    json = JSON.stringify(value)
  }
  catch
  {
    return fail(PROJECT_SCENARIO_CODES.invalid, 'scenario must be JSON data')
  }
  const bytes = Buffer.byteLength(json, 'utf-8')
  if (bytes > DEFAULT_PROJECT_SCENARIO_LIMITS.maxRequestBytes)
  {
    return fail(
      PROJECT_SCENARIO_CODES.bytesExceeded,
      `scenario exceeds ${DEFAULT_PROJECT_SCENARIO_LIMITS.maxRequestBytes} UTF-8 bytes`
    )
  }
  return json
}

function coordinates(value: Record<string, unknown>): boolean
{
  if (!finiteNumber(value.x) || !finiteNumber(value.y)) return false
  const max = DEFAULT_PROJECT_SCENARIO_LIMITS.maxCoordinateMagnitude
  return Math.abs(value.x) <= max && Math.abs(value.y) <= max
}

function parseStep(value: unknown): Step
{
  if (!record(value) || typeof value.do !== 'string')
  {
    return fail(
      PROJECT_SCENARIO_CODES.invalid,
      'scenario step must be an object'
    )
  }
  if (!SCENARIO_STEP_KINDS.includes(value.do as Step['do']))
  {
    return fail(
      PROJECT_SCENARIO_CODES.invalid,
      `unknown scenario step ${String(value.do)}`
    )
  }
  switch (value.do)
  {
    case 'greenFlag':
    case 'clickStage':
      if (!onlyKeys(value, ['do'])) break
      return { do: value.do }
    case 'wait':
      if (onlyKeys(value, ['do', 'ticks']) && safeInteger(value.ticks))
      {
        return { do: value.do, ticks: value.ticks }
      }
      break
    case 'keyDown':
    case 'keyUp':
    case 'pressKey':
    case 'releaseKey':
      if (onlyKeys(value, ['do', 'key']) && boundedString(value.key))
      {
        return { do: value.do, key: value.key }
      }
      break
    case 'tapKey':
      if (
        onlyKeys(value, ['do', 'key', 'ticks']) &&
        boundedString(value.key) &&
        (value.ticks === undefined || safeInteger(value.ticks))
      )
      {
        return {
          do: value.do,
          key: value.key,
          ...(value.ticks === undefined ? {} : { ticks: value.ticks }),
        }
      }
      break
    case 'clickSprite':
      if (onlyKeys(value, ['do', 'sprite']) && boundedString(value.sprite))
      {
        return { do: value.do, sprite: value.sprite }
      }
      break
    case 'broadcast':
      if (onlyKeys(value, ['do', 'name']) && boundedString(value.name))
      {
        return { do: value.do, name: value.name }
      }
      break
    case 'broadcastAndWait':
      if (
        onlyKeys(value, ['do', 'name', 'maxTicks']) &&
        boundedString(value.name) &&
        (value.maxTicks === undefined || safeInteger(value.maxTicks))
      )
      {
        const maxTicks = value.maxTicks ?? 600
        if (maxTicks > DEFAULT_PROJECT_SCENARIO_LIMITS.maxTicks)
        {
          return fail(
            PROJECT_SCENARIO_CODES.broadcastWaitExceeded,
            `broadcast wait exceeds ${DEFAULT_PROJECT_SCENARIO_LIMITS.maxTicks} ticks`
          )
        }
        return {
          do: value.do,
          name: value.name,
          ...(value.maxTicks === undefined ? {} : { maxTicks }),
        }
      }
      break
    case 'moveMouse':
    case 'mouseDown':
    case 'mouseUp':
      if (onlyKeys(value, ['do', 'x', 'y']) && coordinates(value))
      {
        return { do: value.do, x: value.x as number, y: value.y as number }
      }
      break
    case 'typeAnswer':
      if (onlyKeys(value, ['do', 'text']) && boundedString(value.text, true))
      {
        return { do: value.do, text: value.text }
      }
      break
    case 'snapshot':
      if (onlyKeys(value, ['do', 'label']) && boundedString(value.label))
      {
        return { do: value.do, label: value.label }
      }
      break
  }
  return fail(
    PROJECT_SCENARIO_CODES.invalid,
    `invalid fields for scenario step ${value.do}`
  )
}

function summary(
  profile: ProjectScenarioSummary['profile'],
  scenario: Scenario
): ProjectScenarioSummary
{
  const json = JSON.stringify(scenario)
  return {
    profile,
    sha256: sha256(json),
    stepCount: scenario.steps.length,
    maxTicks: scenario.maxTicks ?? 0,
    snapshotCount: scenario.steps.filter((step) => step.do === 'snapshot')
      .length,
  }
}

export function defaultProjectScenario(): ParsedProjectScenario
{
  const scenario = structuredClone(DEFAULT_PROJECT_SMOKE_SCENARIO) as Scenario
  return { scenario, summary: summary('default-smoke', scenario) }
}

export function parseProjectScenario(value: unknown): ParsedProjectScenario
{
  validateShapeBudget(value)
  if (!record(value) || !onlyKeys(value, ['profile', 'scenario']))
  {
    return fail(
      PROJECT_SCENARIO_CODES.invalid,
      'project scenario request must contain only profile and scenario'
    )
  }
  if (value.profile === 'default-smoke' && value.scenario === undefined)
  {
    return defaultProjectScenario()
  }
  if (value.profile !== 'custom' || !record(value.scenario))
  {
    return fail(PROJECT_SCENARIO_CODES.invalid, 'invalid scenario profile')
  }
  const raw = value.scenario
  if ('allowNetwork' in raw || 'allowedOrigins' in raw)
  {
    return fail(
      PROJECT_SCENARIO_CODES.networkFieldForbidden,
      'network policy is host-owned and cannot be supplied by a scenario'
    )
  }
  if (!onlyKeys(raw, ['seed', 'fixedDateMs', 'maxTicks', 'steps']))
  {
    return fail(PROJECT_SCENARIO_CODES.invalid, 'unknown scenario fields')
  }
  if (!safeInteger(raw.maxTicks))
  {
    return fail(PROJECT_SCENARIO_CODES.invalid, 'maxTicks is required')
  }
  if (raw.maxTicks > DEFAULT_PROJECT_SCENARIO_LIMITS.maxTicks)
  {
    return fail(
      PROJECT_SCENARIO_CODES.ticksExceeded,
      `scenario exceeds ${DEFAULT_PROJECT_SCENARIO_LIMITS.maxTicks} ticks`
    )
  }
  if (!Array.isArray(raw.steps))
  {
    return fail(PROJECT_SCENARIO_CODES.invalid, 'steps must be an array')
  }
  if (raw.steps.length > DEFAULT_PROJECT_SCENARIO_LIMITS.maxSteps)
  {
    return fail(
      PROJECT_SCENARIO_CODES.stepsExceeded,
      `scenario exceeds ${DEFAULT_PROJECT_SCENARIO_LIMITS.maxSteps} steps`
    )
  }
  if (raw.seed !== undefined && !finiteNumber(raw.seed))
  {
    return fail(PROJECT_SCENARIO_CODES.invalid, 'seed must be finite')
  }
  if (
    raw.fixedDateMs !== undefined &&
    !safeInteger(raw.fixedDateMs, Number.MIN_SAFE_INTEGER)
  )
  {
    return fail(
      PROJECT_SCENARIO_CODES.invalid,
      'fixedDateMs must be a safe integer'
    )
  }
  const steps = raw.steps.map(parseStep)
  const snapshotCount = steps.filter((step) => step.do === 'snapshot').length
  if (snapshotCount > DEFAULT_PROJECT_SCENARIO_LIMITS.maxSnapshots)
  {
    return fail(
      PROJECT_SCENARIO_CODES.snapshotsExceeded,
      `scenario exceeds ${DEFAULT_PROJECT_SCENARIO_LIMITS.maxSnapshots} snapshots`
    )
  }
  let requestedTicks = 0
  for (const step of steps)
  {
    if (step.do === 'wait') requestedTicks += step.ticks
    if (step.do === 'tapKey') requestedTicks += step.ticks ?? 1
    if (step.do === 'typeAnswer') requestedTicks++
    if (step.do === 'broadcastAndWait')
    {
      requestedTicks += step.maxTicks ?? 600
    }
  }
  if (requestedTicks > raw.maxTicks)
  {
    return fail(
      PROJECT_SCENARIO_CODES.ticksExceeded,
      `scenario requests up to ${requestedTicks} ticks with maxTicks ${raw.maxTicks}`
    )
  }
  const scenario: Scenario = {
    ...(raw.seed === undefined ? {} : { seed: raw.seed }),
    ...(raw.fixedDateMs === undefined ? {} : { fixedDateMs: raw.fixedDateMs }),
    maxTicks: raw.maxTicks,
    steps,
  }
  return { scenario, summary: summary('custom', scenario) }
}
