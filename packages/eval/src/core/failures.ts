// packages/eval/src/core/failures.ts
// normalized project/oracle failures & stable structural fingerprints

import { createHash } from 'node:crypto'

import type {
  BlockRef,
  DeclarationRef,
  ProjectIR,
  ScriptRef,
  TargetRef,
} from '@scratch-agent/ir'
import type { CheckArg } from '@scratch-agent/model'
import type { Diagnostic, DiagnosticLocation } from '@scratch-agent/validate'

import type { Matcher } from './matchers.js'
import type { Probe } from './assert.js'

type EvaluationLane = 'vm' | 'model' | 'browser'

export type EvidenceLocation =
  | { kind: 'project' }
  | { kind: 'target'; target: TargetRef }
  | { kind: 'block'; block: BlockRef }
  | { kind: 'script'; script: ScriptRef }
  | { kind: 'declaration'; declaration: DeclarationRef }
  | { kind: 'asset'; path: string }
  | { kind: 'unresolved-target'; name: string }

export type DiagnosticEvidenceLocation =
  EvidenceLocation | { kind: 'monitor'; id: string }

interface FailureBase
{
  fingerprint: string
}

export interface SchemaFailure extends FailureBase
{
  kind: 'schema'
  category:
    | 'artifact-load-failed'
    | 'ir-construction-failed'
    | 'project-json-invalid'
    | 'scratch-parser-rejected'
    | 'unsupported-project-version'
  message: string
  producerCode?: string
}

export interface DiagnosticFailure extends FailureBase
{
  kind: 'diagnostic'
  source: 'graph' | 'static'
  code: string
  severity: Diagnostic['severity']
  locations: DiagnosticEvidenceLocation[]
  message: string
}

export interface RunFailure extends FailureBase
{
  kind: 'run'
  testId: string
  lane: EvaluationLane
  issueKind: string
  code: string
  location?: EvidenceLocation
  message: string
}

export interface AssertionFailure extends FailureBase
{
  kind: 'assertion'
  testId: string
  lane: 'vm'
  snapshot: string
  probe: Probe
  matcher: Matcher
  expected: string
  observed: string
}

export interface ModelFailureSignal extends FailureBase
{
  kind: 'model'
  testId: string
  lane: 'model'
  modelId: string
  edgeId: string
  checkName: string
  checkArgs: CheckArg[]
  checkNegated: boolean
  phase: 'condition' | 'effect'
  target: string | null
  tick: number
  message: string
}

export interface VisualFailure extends FailureBase
{
  kind: 'visual'
  testId: string
  lane: 'browser'
  snapshot: string
  probe: Probe
  matcher: Matcher
  expected: string
  observed: string
}

export type NormalizedFailure =
  | SchemaFailure
  | DiagnosticFailure
  | RunFailure
  | AssertionFailure
  | ModelFailureSignal
  | VisualFailure

export type FailureExpectation =
  | {
      kind: 'schema'
      category: SchemaFailure['category']
    }
  | {
      kind: 'diagnostic'
      source: DiagnosticFailure['source']
      code: string
      locations?: DiagnosticEvidenceLocation[]
    }
  | {
      kind: 'run'
      lane: EvaluationLane
      issueKind: string
      code: string
      location?: EvidenceLocation
    }
  | {
      kind: 'assertion'
      snapshot: string
      probe: Probe
      matcher: Matcher
    }
  | {
      kind: 'model'
      modelId: string
      edgeId: string
      checkName: string
      checkArgs: CheckArg[]
      checkNegated: boolean
      phase: ModelFailureSignal['phase']
      target?: string | null
    }
  | {
      kind: 'visual'
      snapshot: string
      probe: Probe
      matcher: Matcher
    }

type FingerprintFields = Record<string, unknown>

function canonicalJson(value: unknown): string
{
  if (value === undefined) return 'undefined'
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  const record = value as Record<string, unknown>
  const fields = Object.keys(record)
    .filter((key) => record[key] !== undefined)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
  return `{${fields.join(',')}}`
}

export function stableFingerprint(
  kind: NormalizedFailure['kind'],
  fields: FingerprintFields
): string
{
  const digest = createHash('sha256')
    .update(canonicalJson({ kind, ...fields }))
    .digest('hex')
  return `${kind}-${digest}`
}

function targetRef(project: ProjectIR, targetIndex: number): TargetRef
{
  const target = project.json.targets[targetIndex]!
  return { targetIndex, name: target.name, isStage: target.isStage }
}

function resolveDiagnosticLocations(
  project: ProjectIR,
  location: DiagnosticLocation
): DiagnosticEvidenceLocation[]
{
  const resolved: DiagnosticEvidenceLocation[] = []
  const matchingIndexes = project.json.targets.flatMap((target, index) =>
    location.target && target.name === location.target ? [index] : []
  )
  if (location.block)
  {
    const blockOwners = project.json.targets.flatMap((target, index) =>
      Object.hasOwn(target.blocks, location.block!) ? [index] : []
    )
    const namedBlockOwners = blockOwners.filter((index) =>
      location.target
        ? project.json.targets[index]!.name === location.target
        : true
    )
    const plausibleOwners =
      namedBlockOwners.length > 0 ? namedBlockOwners : blockOwners
    for (const index of plausibleOwners)
    {
      resolved.push({
        kind: 'block',
        block: {
          target: targetRef(project, index),
          blockId: location.block,
        },
      })
    }
    if (plausibleOwners.length === 0 && location.target)
    {
      resolved.push({ kind: 'unresolved-target', name: location.target })
    }
  }
  else if (location.target)
  {
    for (const index of matchingIndexes)
    {
      resolved.push({ kind: 'target', target: targetRef(project, index) })
    }
    if (matchingIndexes.length === 0)
      resolved.push({ kind: 'unresolved-target', name: location.target })
  }
  if (location.asset) resolved.push({ kind: 'asset', path: location.asset })
  if (location.monitor) resolved.push({ kind: 'monitor', id: location.monitor })
  if (resolved.length === 0) resolved.push({ kind: 'project' })
  return resolved.sort((a, b) =>
    canonicalJson(a) < canonicalJson(b)
      ? -1
      : canonicalJson(a) > canonicalJson(b)
        ? 1
        : 0
  )
}

export function normalizeDiagnosticFailure(
  project: ProjectIR,
  source: DiagnosticFailure['source'],
  diagnostic: Diagnostic
): DiagnosticFailure
{
  const locations = resolveDiagnosticLocations(project, diagnostic.location)
  const fingerprint = stableFingerprint('diagnostic', {
    source,
    code: diagnostic.code,
    locations,
  })
  return {
    kind: 'diagnostic',
    fingerprint,
    source,
    code: diagnostic.code,
    severity: diagnostic.severity,
    locations,
    message: diagnostic.message,
  }
}

function expectationFields(
  expectation: FailureExpectation
): Record<string, unknown>
{
  const { kind: _kind, ...fields } = expectation
  return fields
}

function failureStableFields(
  failure: NormalizedFailure
): Record<string, unknown>
{
  switch (failure.kind)
  {
    case 'schema':
      return { category: failure.category }
    case 'diagnostic':
      return {
        source: failure.source,
        code: failure.code,
        locations: failure.locations,
      }
    case 'run':
      return {
        lane: failure.lane,
        issueKind: failure.issueKind,
        code: failure.code,
        location: failure.location,
      }
    case 'assertion':
    case 'visual':
      return {
        snapshot: failure.snapshot,
        probe: failure.probe,
        matcher: failure.matcher,
      }
    case 'model':
      return {
        modelId: failure.modelId,
        edgeId: failure.edgeId,
        checkName: failure.checkName,
        checkArgs: failure.checkArgs,
        checkNegated: failure.checkNegated,
        phase: failure.phase,
        target: failure.target,
      }
  }
}

export function matchesFailureExpectation(
  expectation: FailureExpectation,
  failure: NormalizedFailure
): boolean
{
  if (expectation.kind !== failure.kind) return false
  const actual = failureStableFields(failure)
  return Object.entries(expectationFields(expectation)).every(
    ([key, expected]) => canonicalJson(expected) === canonicalJson(actual[key])
  )
}

export function matchFailureMultiset(
  expectations: FailureExpectation[],
  failures: NormalizedFailure[]
): { missing: FailureExpectation[]; unexpected: NormalizedFailure[] }
{
  const failureOwner = new Array<number>(failures.length).fill(-1)

  function assign(expectationIndex: number, visited: Set<number>): boolean
  {
    for (let failureIndex = 0; failureIndex < failures.length; failureIndex++)
    {
      if (visited.has(failureIndex)) continue
      if (
        !matchesFailureExpectation(
          expectations[expectationIndex]!,
          failures[failureIndex]!
        )
      )
      {
        continue
      }
      visited.add(failureIndex)
      const previous = failureOwner[failureIndex]!
      if (previous === -1 || assign(previous, visited))
      {
        failureOwner[failureIndex] = expectationIndex
        return true
      }
    }
    return false
  }

  for (let index = 0; index < expectations.length; index++)
  {
    assign(index, new Set())
  }
  const matchedExpectations = new Set(
    failureOwner.filter((index) => index >= 0)
  )
  return {
    missing: expectations.filter((_, index) => !matchedExpectations.has(index)),
    unexpected: failures.filter((_, index) => failureOwner[index] === -1),
  }
}
