// packages/eval/src/authoring/candidate-evaluation.ts
// retain conservative exact-artifact authoring checks across every required lane

import { createHash } from 'node:crypto'
import { constants } from 'node:fs'
import { mkdtemp, mkdir, open, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { isAbsolute, join } from 'node:path'

import {
  assertStandardAuthoringAuthorityV2,
  getStandardAuthoritySha256V2,
} from '@scratch-agent/ir/edit'
import {
  browserRuntimeIdentity,
  collectVersions,
  executeProfileScenarioV1,
  hashScenario,
  isRunnerIssueError,
  nodeRuntimeDescriptor,
  profileRuntimeDescriptorBeforeLaunchV1,
  runScenario,
  validateRuntimeExecutionProfileV1,
  type BrowserTrace,
  type RuntimeDescriptorV1,
  type Scenario,
  type VmTrace,
} from '@scratch-agent/runner'
import { DEFAULT_SB3_LIMITS } from '@scratch-agent/sb3'
import { canonicalJsonBytesV1 } from '@scratch-agent/sb3/canonical-json'

import { validateScenarioAssertionsV1 } from '../candidate/candidate.js'
import type { Assertion, AssertResult, Probe } from '../core/assert.js'
import { evaluate } from '../core/evaluate.js'
import {
  inspectSelectedProject,
  type SelectedProjectInspection,
} from '../project-check/project-inspection.js'
import {
  defaultProjectScenario,
  parseProjectScenario,
} from '../project-check/project-scenario.js'

export interface AuthoringRuntimeTargetV2
{
  schemaVersion: 1
  runtime: 'scratch-official' | 'turbowarp'
  scheduler: 'deterministic' | 'natural'
  tickRate: 30 | 60
}

export interface AuthoringEvaluationScenarioV2
{
  id: string
  scenario: unknown
}

export interface AuthoringEvaluationAssertionV2
{
  scenarioId: string
  assertion: unknown
}

export interface AuthoringCandidateEvaluationRequestV2
{
  candidateBytes: Uint8Array
  candidateSha256: string
  standardAuthoritySha256: string
  compilerIdentitySha256: string
  runtimeIdentities?: readonly AuthoringRuntimeIdentityV2[]
  runtimeTargets?: readonly AuthoringRuntimeTargetV2[]
  scenarios?: readonly AuthoringEvaluationScenarioV2[]
  assertions?: readonly AuthoringEvaluationAssertionV2[]
  evidenceRoot?: string
  signal?: AbortSignal
}

export type AuthoringEvaluationLaneV2 =
  'officialHeadless' | 'officialBrowser' | 'turboWarpBrowser'

export interface AuthoringEvaluationLaneEvidenceV2
{
  lane: AuthoringEvaluationLaneV2
  executionProfile: AuthoringRuntimeTargetV2 | null
  assertionApplicability: 'baseline-smoke' | 'declared'
  clock: AuthoringExecutionClockV2
  scenarioId: string
  scenarioSha256: string
  runtimeIdentitySha256: string
  runtimeDescriptor: RuntimeDescriptorV1
  traceSha256: string
  assertions: AssertResult[]
  accepted: boolean
  issues: string[]
  trace: VmTrace | BrowserTrace
}

export interface AuthoringExecutionClockV2
{
  drive: 'manual' | 'native'
  tickMs: number
  replay: 'exact' | 'timing-diagnostic'
}

export interface AuthoringRuntimeIdentityV2
{
  lane: AuthoringEvaluationLaneV2
  runtimeIdentitySha256: string
  runtimeDescriptor: RuntimeDescriptorV1
}

export interface AuthoringEvaluationMediaArtifactV2
{
  path: string
  sha256: string
  byteLength: number
  mimeType: 'image/png'
}

export interface AuthoringCandidateEvaluationV2
{
  kind: 'authoring-candidate-evaluation-v2'
  schemaVersion: 2
  disposition: 'accepted' | 'refused'
  candidateSha256: string
  standardAuthoritySha256: string
  compilerIdentitySha256: string
  runtimeTargets: readonly AuthoringRuntimeTargetV2[]
  evaluationPolicySha256: string
  evidenceSha256: string
  inspection: SelectedProjectInspection | null
  lanes: readonly AuthoringEvaluationLaneEvidenceV2[]
  mediaArtifacts: readonly AuthoringEvaluationMediaArtifactV2[]
  issues: readonly string[]
  limitations: readonly string[]
  evidenceRoot: string | null
  versions: ReturnType<typeof collectVersions>
}

export type AuthoringCandidateEvaluationResultV2 =
  AuthoringCandidateEvaluationV2

export interface AuthoringRuntimeIdentityV3 extends AuthoringRuntimeIdentityV2
{
  browserInstallationIdentity: string | null
}

export interface AuthoringEvaluationLaneEvidenceV3 extends AuthoringEvaluationLaneEvidenceV2
{
  browserInstallationIdentity: string | null
}

export interface AuthoringCandidateEvaluationRequestV3 extends Omit<
  AuthoringCandidateEvaluationRequestV2,
  'runtimeIdentities'
>
{
  runtimeIdentities?: readonly AuthoringRuntimeIdentityV3[]
}

export interface AuthoringRecordedCandidateEvaluationRequestV3 extends AuthoringCandidateEvaluationRequestV3
{
  runtimeIdentities: readonly AuthoringRuntimeIdentityV3[]
}

export interface AuthoringLegacyPublishedEvaluationRequestV2 extends AuthoringCandidateEvaluationRequestV2
{
  runtimeIdentities: readonly AuthoringRuntimeIdentityV2[]
}

export interface AuthoringCandidateEvaluationV3 extends Omit<
  AuthoringCandidateEvaluationV2,
  'kind' | 'schemaVersion' | 'lanes'
>
{
  kind: 'authoring-candidate-evaluation-v3'
  schemaVersion: 3
  lanes: readonly AuthoringEvaluationLaneEvidenceV3[]
}

export type AuthoringCandidateEvaluationResultV3 =
  AuthoringCandidateEvaluationV3

export type AuthoringCandidateEvaluation =
  AuthoringCandidateEvaluationV2 | AuthoringCandidateEvaluationV3

interface PreparedScenarioV2
{
  id: string
  scenario: Scenario
  scenarioSha256: string
  stateAssertions: Assertion[]
  visualAssertions: Assertion[]
}

const HASH = /^[a-f0-9]{64}$/u
const ID = /^[a-z0-9](?:[a-z0-9_-]{0,62}[a-z0-9])?$/u
const VISUAL_PROBES = new Set<Probe['on']>([
  'spriteRect',
  'spriteInRegion',
  'notBlank',
  'regionInk',
  'regionChanged',
])

const AUTHORING_EVALUATION_POLICY_V2 = Object.freeze({
  schemaVersion: 2,
  mandatoryLane: 'officialHeadless',
  schemaAndGraph: 'no-errors',
  statics: 'no-errors-warnings-retained',
  network: 'denied',
  clock: 'selected-profile-with-explicit-manual60-baseline',
  maxScenarios: 4,
  maxRuntimeDurationMs: 120000,
  maxRuntimeTicks: 600,
  maxAssertions: 128,
  maxPolicyBytes: 128 * 1024,
  maxEvidenceBytes: 32 * 1024 * 1024,
  maxMediaBytes: 64 * 1024 * 1024,
  maxScreenshotBytes: 2 * 1024 * 1024,
  requiredRuntimeDescriptors: 'complete-hashed-components-rendered-bundle',
  applicability:
    'all-declared-assertions-on-every-selected-profile-or-headless-if-no-profile',
})

const AUTHORING_EVALUATION_POLICY_V3 = Object.freeze({
  ...AUTHORING_EVALUATION_POLICY_V2,
  schemaVersion: 3,
  requiredRuntimeDescriptors:
    'complete-hashed-components-rendered-bundle-and-recorded-installation',
  runtimeIdentity: 'recorded-installation-and-version-normalized-descriptor-v3',
  historicalValidation: 'recorded-identities-without-current-installation',
})

function sha256(bytes: Uint8Array): string
{
  return createHash('sha256').update(bytes).digest('hex')
}

function recordHash(value: unknown): string
{
  return sha256(evidenceBytes(value))
}

// runner reports use ordinary JSON for optional fields & signed zero
function evidenceBytes(value: unknown): Uint8Array
{
  return canonicalJsonBytesV1(JSON.parse(JSON.stringify(value)))
}

function record(value: unknown): value is Record<string, unknown>
{
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function expectedLanes(
  targets: readonly AuthoringRuntimeTargetV2[]
): AuthoringEvaluationLaneV2[]
{
  return [
    'officialHeadless',
    ...targets.map((target): AuthoringEvaluationLaneV2 =>
      target.runtime === 'scratch-official'
        ? 'officialBrowser'
        : 'turboWarpBrowser'
    ),
  ]
}

function profileForLane(
  targets: readonly AuthoringRuntimeTargetV2[],
  lane: AuthoringEvaluationLaneV2
): AuthoringRuntimeTargetV2 | null
{
  if (lane === 'officialHeadless') return null
  return (
    targets.find(
      (target) =>
        target.runtime ===
        (lane === 'officialBrowser' ? 'scratch-official' : 'turbowarp')
    ) ?? null
  )
}

function laneSemantics(
  targets: readonly AuthoringRuntimeTargetV2[],
  lane: AuthoringEvaluationLaneV2
): Pick<
  AuthoringEvaluationLaneEvidenceV2,
  'executionProfile' | 'assertionApplicability' | 'clock'
>
{
  const executionProfile = profileForLane(targets, lane)
  const natural = executionProfile?.scheduler === 'natural'
  return {
    executionProfile,
    assertionApplicability:
      lane === 'officialHeadless' && targets.length > 0
        ? 'baseline-smoke'
        : 'declared',
    clock: {
      drive: natural ? 'native' : 'manual',
      tickMs: 1000 / (executionProfile?.tickRate ?? 60),
      replay: natural ? 'timing-diagnostic' : 'exact',
    },
  }
}

function applicableAssertions(
  scenario: PreparedScenarioV2,
  lane: AuthoringEvaluationLaneV2,
  targets: readonly AuthoringRuntimeTargetV2[]
): Assertion[]
{
  if (lane === 'officialHeadless')
    return targets.length > 0 ? [] : scenario.stateAssertions
  return [...scenario.stateAssertions, ...scenario.visualAssertions]
}

function profileTraceIssues(
  trace: VmTrace | BrowserTrace,
  lane: AuthoringEvaluationLaneV2,
  targets: readonly AuthoringRuntimeTargetV2[]
): string[]
{
  if (lane === 'officialHeadless') return []
  const semantics = laneSemantics(targets, lane)
  const retained = trace as unknown as Record<string, unknown>
  if (
    recordHash(retained.executionProfile ?? null) !==
      recordHash(semantics.executionProfile) ||
    recordHash(retained.clock ?? null) !== recordHash(semantics.clock)
  )
    return [
      'runtime trace did not verify the selected execution profile and clock',
    ]
  if (semantics.executionProfile?.scheduler === 'natural')
  {
    const diagnostics = retained.naturalDiagnostics
    if (
      !record(diagnostics) ||
      diagnostics.exactReplay !== false ||
      !Number.isSafeInteger(diagnostics.requestedWaitTicks) ||
      Number(diagnostics.requestedWaitTicks) < 0 ||
      Number(diagnostics.requestedWaitTicks) >
        AUTHORING_EVALUATION_POLICY_V2.maxRuntimeTicks ||
      !Number.isSafeInteger(diagnostics.observedTicks) ||
      Number(diagnostics.observedTicks) < 0 ||
      Number(diagnostics.observedTicks) >
        AUTHORING_EVALUATION_POLICY_V2.maxRuntimeTicks ||
      diagnostics.observedTicks !== trace.finalSnapshot?.tick ||
      typeof diagnostics.elapsedMs !== 'number' ||
      !Number.isFinite(diagnostics.elapsedMs) ||
      diagnostics.elapsedMs < 0 ||
      diagnostics.elapsedMs >
        AUTHORING_EVALUATION_POLICY_V2.maxRuntimeDurationMs
    )
      return [
        'natural runtime trace lacks bounded timing diagnostics with exact replay explicitly unavailable',
      ]
  }
  return []
}

function prepareTargets(
  input: readonly AuthoringRuntimeTargetV2[] = []
): readonly AuthoringRuntimeTargetV2[]
{
  const targets = structuredClone(input)
  if (!Array.isArray(targets) || targets.length > 2)
    throw new Error(
      'runtimeTargets must select at most one profile per rendered runtime'
    )
  const seenRuntimes = new Set<string>()
  for (const target of targets)
  {
    if (
      !record(target) ||
      Object.keys(target).some(
        (key) =>
          !['schemaVersion', 'runtime', 'scheduler', 'tickRate'].includes(key)
      ) ||
      target.schemaVersion !== 1 ||
      !['scratch-official', 'turbowarp'].includes(String(target.runtime)) ||
      !['deterministic', 'natural'].includes(String(target.scheduler)) ||
      ![30, 60].includes(Number(target.tickRate))
    )
      throw new Error(
        'runtimeTargets require an explicit supported runtime, scheduler and tick rate'
      )
    if (seenRuntimes.has(String(target.runtime)))
      throw new Error('runtimeTargets cannot repeat a runtime')
    seenRuntimes.add(String(target.runtime))
    validateRuntimeExecutionProfileV1(target)
  }
  return targets
}

export function authoringRuntimeIdentitySha256V2(
  descriptor: RuntimeDescriptorV1
): string
{
  return recordHash({
    ...descriptor,
    browser:
      descriptor.browser === null
        ? null
        : {
            name: descriptor.browser.name,
            installation: browserRuntimeIdentity(),
          },
  })
}

export function authoringRuntimeIdentitiesV2(
  targets: readonly AuthoringRuntimeTargetV2[] = []
): readonly AuthoringRuntimeIdentityV2[]
{
  return expectedLanes(prepareTargets(targets)).map((lane) =>
  {
    const descriptor =
      lane === 'officialHeadless'
        ? nodeRuntimeDescriptor({ allowNetwork: false })
        : profileRuntimeDescriptorBeforeLaunchV1(profileForLane(targets, lane)!)
    const issues = runtimeIssues(descriptor, lane)
    if (issues.length > 0) throw new Error(issues.join('; '))
    return {
      lane,
      runtimeIdentitySha256: authoringRuntimeIdentitySha256V2(descriptor),
      runtimeDescriptor: descriptor,
    }
  })
}

function normalizedRuntimeDescriptor(descriptor: RuntimeDescriptorV1): unknown
{
  return {
    ...descriptor,
    browser:
      descriptor.browser === null
        ? null
        : { ...descriptor.browser, version: null },
  }
}

export function authoringRecordedRuntimeIdentitySha256V3(
  descriptor: RuntimeDescriptorV1,
  browserInstallationIdentity: string | null
): string
{
  if (
    descriptor.browser === null
      ? browserInstallationIdentity !== null
      : typeof browserInstallationIdentity !== 'string' ||
        browserInstallationIdentity.length < 1 ||
        browserInstallationIdentity.length > 512
  )
    throw new Error('runtime browser installation identity is incomplete')
  return recordHash({
    schemaVersion: 3,
    runtimeDescriptor: normalizedRuntimeDescriptor(descriptor),
    browserInstallationIdentity,
  })
}

export function authoringRuntimeIdentitiesV3(
  targets: readonly AuthoringRuntimeTargetV2[] = []
): readonly AuthoringRuntimeIdentityV3[]
{
  const prepared = prepareTargets(targets)
  const installation = prepared.length > 0 ? browserRuntimeIdentity() : null
  return expectedLanes(prepared).map((lane) =>
  {
    const descriptor =
      lane === 'officialHeadless'
        ? nodeRuntimeDescriptor({ allowNetwork: false })
        : profileRuntimeDescriptorBeforeLaunchV1(
            profileForLane(prepared, lane)!
          )
    const issues = runtimeIssues(descriptor, lane)
    if (issues.length > 0) throw new Error(issues.join('; '))
    const browserInstallationIdentity =
      lane === 'officialHeadless' ? null : installation
    return {
      lane,
      browserInstallationIdentity,
      runtimeIdentitySha256: authoringRecordedRuntimeIdentitySha256V3(
        descriptor,
        browserInstallationIdentity
      ),
      runtimeDescriptor: descriptor,
    }
  })
}

function preparePolicy(
  request: AuthoringCandidateEvaluationRequestV2,
  version: 2 | 3 = 2
): {
  targets: readonly AuthoringRuntimeTargetV2[]
  scenarios: PreparedScenarioV2[]
  policySha256: string
}
{
  const targets = prepareTargets(request.runtimeTargets)
  const suppliedScenarios = request.scenarios ?? []
  const suppliedAssertions = request.assertions ?? []
  if (
    !Array.isArray(suppliedScenarios) ||
    suppliedScenarios.length > AUTHORING_EVALUATION_POLICY_V2.maxScenarios ||
    !Array.isArray(suppliedAssertions) ||
    suppliedAssertions.length > AUTHORING_EVALUATION_POLICY_V2.maxAssertions
  )
    throw new Error(
      'authoring evaluation exceeds its scenario or assertion count limit'
    )
  const policyBytes = canonicalJsonBytesV1({
    targets,
    scenarios: suppliedScenarios,
    assertions: suppliedAssertions,
  })
  if (policyBytes.byteLength > AUTHORING_EVALUATION_POLICY_V2.maxPolicyBytes)
    throw new Error('authoring evaluation policy exceeds its byte limit')
  const scenarios: PreparedScenarioV2[] = []
  const seenIds = new Set<string>()
  if (suppliedScenarios.length === 0)
  {
    const smoke = defaultProjectScenario()
    scenarios.push({
      id: 'default-smoke',
      scenario: smoke.scenario,
      scenarioSha256: hashScenario(smoke.scenario),
      stateAssertions: [],
      visualAssertions: [],
    })
    seenIds.add('default-smoke')
  }
  for (const entry of suppliedScenarios)
  {
    if (
      !record(entry) ||
      Object.keys(entry).some((key) => !['id', 'scenario'].includes(key)) ||
      typeof entry.id !== 'string' ||
      !ID.test(entry.id) ||
      seenIds.has(entry.id)
    )
      throw new Error('evaluation scenarios require unique bounded logical IDs')
    const parsed = parseProjectScenario({
      profile: 'custom',
      scenario: entry.scenario,
    })
    scenarios.push({
      id: entry.id,
      scenario: parsed.scenario,
      scenarioSha256: hashScenario(parsed.scenario),
      stateAssertions: [],
      visualAssertions: [],
    })
    seenIds.add(entry.id)
  }
  for (const entry of suppliedAssertions)
  {
    if (
      !record(entry) ||
      Object.keys(entry).some(
        (key) => !['scenarioId', 'assertion'].includes(key)
      ) ||
      typeof entry.scenarioId !== 'string' ||
      !seenIds.has(entry.scenarioId)
    )
      throw new Error(
        'evaluation assertions must reference an included scenario'
      )
    const scenario = scenarios.find((value) => value.id === entry.scenarioId)!
    const assertion = structuredClone(entry.assertion) as Assertion
    const visual =
      record(assertion) &&
      record(assertion.probe) &&
      VISUAL_PROBES.has(assertion.probe.on as Probe['on'])
    if (visual && targets.length === 0)
      throw new Error(
        'visual assertions require an explicitly selected rendered runtime'
      )
    const problems = validateScenarioAssertionsV1(
      [assertion],
      scenario.scenario,
      visual ? 'browser' : 'vm'
    )
    if (problems.length > 0) throw new Error(problems.join('; '))
    if (visual) scenario.visualAssertions.push(assertion)
    else scenario.stateAssertions.push(assertion)
  }
  return {
    targets,
    scenarios,
    policySha256: recordHash({
      policy:
        version === 2
          ? AUTHORING_EVALUATION_POLICY_V2
          : AUTHORING_EVALUATION_POLICY_V3,
      targets,
      scenarios,
    }),
  }
}

function runtimeIssues(
  descriptor: RuntimeDescriptorV1,
  lane: AuthoringEvaluationLaneV2
): string[]
{
  const issues: string[] = []
  const expectedKind =
    lane === 'officialHeadless'
      ? 'scratch-vm-node'
      : lane === 'officialBrowser'
        ? 'scratch-official-browser'
        : 'turbowarp-browser'
  if (
    descriptor.kind !== expectedKind ||
    descriptor.network !== 'denied' ||
    !HASH.test(descriptor.configurationSha256)
  )
    issues.push(
      'runtime descriptor does not match the selected network-free lane'
    )
  if (
    descriptor.components.length === 0 ||
    descriptor.components.some(
      (component) =>
        component.version === 'unknown' ||
        !component.sha256 ||
        !HASH.test(component.sha256) ||
        !Number.isSafeInteger(component.byteLength) ||
        component.byteLength! < 1
    )
  )
    issues.push('runtime component identities are incomplete')
  if (
    lane !== 'officialHeadless' &&
    (!descriptor.browser ||
      descriptor.browser.version === 'unknown' ||
      !descriptor.bundle ||
      !HASH.test(descriptor.bundle.sha256))
  )
    issues.push('rendered runtime browser or bundle identity is incomplete')
  return issues
}

function inspectionIssues(inspection: SelectedProjectInspection): string[]
{
  const issues = inspection.issues.map(
    (issue) => `${issue.code}: ${issue.message}`
  )
  if (
    !inspection.canRun ||
    ['admission', 'schema', 'graph', 'static'].some(
      (stage) =>
        inspection.stages[
          stage as keyof SelectedProjectInspection['stages']
        ] !== 'passed'
    )
  )
    issues.push('required project preflight stages did not all pass')
  if (!inspection.static || inspection.static.counts.error > 0)
    issues.push('static analysis contains errors or is unavailable')
  return issues
}

function laneIssues(
  trace: VmTrace | BrowserTrace,
  lane: AuthoringEvaluationLaneV2,
  scenario: PreparedScenarioV2,
  candidateSha256: string,
  results: AssertResult[],
  targets: readonly AuthoringRuntimeTargetV2[]
): string[]
{
  const issues = trace.issues.map((issue) => `${issue.code}: ${issue.message}`)
  if (!trace.ok) issues.push('runtime trace did not complete successfully')
  if (trace.observations.sourceSb3Sha256 !== candidateSha256)
    issues.push('runtime trace is bound to different candidate bytes')
  if (trace.observations.scenarioSha256 !== scenario.scenarioSha256)
    issues.push('runtime trace is bound to a different scenario')
  const expectedLabels = scenario.scenario.steps
    .filter((step) => step.do === 'snapshot')
    .map((step) => (step as { label: string }).label)
  const labels = trace.snapshots.map((snapshot) => snapshot.label)
  if (
    labels.length !== expectedLabels.length ||
    labels.some((label, index) => label !== expectedLabels[index])
  )
    issues.push(
      'runtime trace did not retain every requested snapshot in order'
    )
  if (
    lane !== 'officialHeadless' &&
    (trace as BrowserTrace).screenshots.length !== expectedLabels.length
  )
    issues.push('rendered runtime did not retain every requested screenshot')
  if (
    lane !== 'officialHeadless' &&
    trace.runtimeDescriptor.browser?.version === 'not-launched'
  )
    issues.push(
      'rendered runtime did not retain an actually launched browser identity'
    )
  if (results.some((result) => !result.ok))
    issues.push('one or more declared assertions failed')
  issues.push(...runtimeIssues(trace.runtimeDescriptor, lane))
  issues.push(...profileTraceIssues(trace, lane, targets))
  return issues
}

export function authoringCandidateEvaluationEvidenceSha256V2(
  value: Omit<AuthoringCandidateEvaluationV2, 'evidenceSha256'>
): string
{
  return recordHash(value)
}

export function authoringEvaluationPolicySha256V2(
  request: AuthoringCandidateEvaluationRequestV2
): string
{
  return preparePolicy(request).policySha256
}

export function authoringCandidateEvaluationEvidenceSha256V3(
  value: Omit<AuthoringCandidateEvaluationV3, 'evidenceSha256'>
): string
{
  return recordHash(value)
}

export function authoringEvaluationPolicySha256V3(
  request: AuthoringCandidateEvaluationRequestV3
): string
{
  return preparePolicy(request, 3).policySha256
}

export function validateAuthoringCandidateEvaluationV2(
  value: AuthoringCandidateEvaluationV2,
  request: AuthoringCandidateEvaluationRequestV2
): string[]
{
  return validateCandidateEvaluation(value, request, 'current-v2')
}

export function validateAuthoringCandidateEvaluationV3(
  value: AuthoringCandidateEvaluationV3,
  request: AuthoringCandidateEvaluationRequestV3
): string[]
{
  return validateCandidateEvaluation(value, request, 'current-v3')
}

export function validateRecordedAuthoringCandidateEvaluationV3(
  value: AuthoringCandidateEvaluationV3,
  request: AuthoringRecordedCandidateEvaluationRequestV3
): string[]
{
  return validateCandidateEvaluation(value, request, 'recorded-v3')
}

// the publication owner must first prove the exact already-published inode &
// bytes; this verifies retained acceptance without inventing its missing preimage
export function verifyLegacyPublishedAuthoringCandidateEvaluationV2(
  value: AuthoringCandidateEvaluationV2,
  request: AuthoringLegacyPublishedEvaluationRequestV2
): string[]
{
  return validateCandidateEvaluation(value, request, 'published-v2')
}

function validateCandidateEvaluation(
  value: AuthoringCandidateEvaluation,
  request: AuthoringCandidateEvaluationRequestV2,
  mode: 'current-v2' | 'current-v3' | 'recorded-v3' | 'published-v2'
): string[]
{
  const issues: string[] = []
  try
  {
    const version = mode.endsWith('v3') ? 3 : 2
    const policy = preparePolicy(request, version)
    const installed =
      mode === 'current-v3'
        ? authoringRuntimeIdentitiesV3(policy.targets)
        : mode === 'current-v2' && request.runtimeIdentities === undefined
          ? authoringRuntimeIdentitiesV2(policy.targets)
          : undefined
    const runtimeIdentities = request.runtimeIdentities ?? installed
    if (!runtimeIdentities)
      throw new Error(
        'historical validation requires recorded runtime identities'
      )
    const lanes = expectedLanes(policy.targets)
    if (mode !== 'current-v2')
    {
      if (
        !Array.isArray(runtimeIdentities) ||
        runtimeIdentities.length !== lanes.length ||
        lanes.some(
          (lane) =>
            runtimeIdentities.filter((identity) => identity.lane === lane)
              .length !== 1
        )
      )
        throw new Error(
          'recorded runtime identities do not cover the exact required lanes'
        )
      if (
        !(request.candidateBytes instanceof Uint8Array) ||
        request.candidateBytes.byteLength < 1 ||
        request.candidateBytes.byteLength >
          DEFAULT_SB3_LIMITS.maxCompressedBytes ||
        sha256(request.candidateBytes) !== request.candidateSha256
      )
        throw new Error(
          'exact candidate bytes do not match their bound SHA-256'
        )
      for (const identity of runtimeIdentities)
      {
        issues.push(...runtimeIssues(identity.runtimeDescriptor, identity.lane))
        if (!HASH.test(identity.runtimeIdentitySha256))
          issues.push('recorded runtime identity is not a SHA-256')
        if (
          version === 3 &&
          identity.runtimeIdentitySha256 !==
            authoringRecordedRuntimeIdentitySha256V3(
              identity.runtimeDescriptor,
              (identity as AuthoringRuntimeIdentityV3)
                .browserInstallationIdentity
            )
        )
          issues.push('recorded runtime identity does not reconstruct')
      }
      if (installed)
      {
        for (const identity of runtimeIdentities)
        {
          const current = installed.find(
            (entry) => entry.lane === identity.lane
          )
          if (
            !current ||
            current.runtimeIdentitySha256 !== identity.runtimeIdentitySha256 ||
            (current as AuthoringRuntimeIdentityV3)
              .browserInstallationIdentity !==
              (identity as AuthoringRuntimeIdentityV3)
                .browserInstallationIdentity ||
            recordHash(
              normalizedRuntimeDescriptor(current.runtimeDescriptor)
            ) !==
              recordHash(
                normalizedRuntimeDescriptor(identity.runtimeDescriptor)
              )
          )
            issues.push(
              'runtime installation identities changed since the immutable build plan'
            )
        }
      }
    }
    const { evidenceSha256, ...content } = value
    if (
      value.kind !== `authoring-candidate-evaluation-v${version}` ||
      value.schemaVersion !== version ||
      value.candidateSha256 !== request.candidateSha256 ||
      value.standardAuthoritySha256 !== request.standardAuthoritySha256 ||
      value.compilerIdentitySha256 !== request.compilerIdentitySha256 ||
      value.evaluationPolicySha256 !== policy.policySha256 ||
      recordHash(value.runtimeTargets) !== recordHash(policy.targets) ||
      evidenceSha256 !== recordHash(content)
    )
      issues.push(
        'evaluation identity or evidence hash does not match its exact request'
      )
    if (value.disposition !== 'accepted')
      issues.push('candidate evaluation did not accept the declared checks')
    if (!value.evidenceRoot || !isAbsolute(value.evidenceRoot))
      issues.push('evaluation has no retained private evidence root')
    if (
      !value.inspection ||
      value.inspection.input.sha256 !== request.candidateSha256
    )
      issues.push(
        'evaluation preflight is missing or bound to different candidate bytes'
      )
    else issues.push(...inspectionIssues(value.inspection))
    if (value.lanes.length !== lanes.length * policy.scenarios.length)
      issues.push(
        'evaluation omitted or added a required runtime/scenario cell'
      )
    for (const scenario of policy.scenarios)
    {
      for (const lane of lanes)
      {
        const cells = value.lanes.filter(
          (cell) => cell.lane === lane && cell.scenarioId === scenario.id
        )
        if (cells.length !== 1)
        {
          issues.push(`evaluation lacks one exact ${lane}/${scenario.id} cell`)
          continue
        }
        const cell = cells[0]!
        const assertions = applicableAssertions(scenario, lane, policy.targets)
        const results = evaluate(cell.trace, assertions)
        const semantics = laneSemantics(policy.targets, lane)
        const identity = runtimeIdentities.find((entry) => entry.lane === lane)
        let runtimeMatches =
          identity?.runtimeIdentitySha256 === cell.runtimeIdentitySha256
        if (mode === 'current-v2')
          runtimeMatches &&=
            cell.runtimeIdentitySha256 ===
            authoringRuntimeIdentitySha256V2(cell.trace.runtimeDescriptor)
        else
        {
          runtimeMatches &&=
            identity !== undefined &&
            recordHash(
              normalizedRuntimeDescriptor(identity.runtimeDescriptor)
            ) ===
              recordHash(
                normalizedRuntimeDescriptor(cell.trace.runtimeDescriptor)
              )
          if (version === 3)
          {
            const installation = (cell as AuthoringEvaluationLaneEvidenceV3)
              .browserInstallationIdentity
            runtimeMatches &&=
              installation ===
                (identity as AuthoringRuntimeIdentityV3)
                  .browserInstallationIdentity &&
              cell.runtimeIdentitySha256 ===
                authoringRecordedRuntimeIdentitySha256V3(
                  cell.trace.runtimeDescriptor,
                  installation
                )
          }
          else if (lane === 'officialHeadless')
            runtimeMatches &&=
              cell.runtimeIdentitySha256 ===
              recordHash({
                ...cell.trace.runtimeDescriptor,
                browser: null,
              })
        }
        if (
          !cell.accepted ||
          cell.issues.length !== 0 ||
          cell.scenarioSha256 !== scenario.scenarioSha256 ||
          cell.traceSha256 !== recordHash(cell.trace) ||
          !runtimeMatches ||
          recordHash(cell.runtimeDescriptor) !==
            recordHash(cell.trace.runtimeDescriptor) ||
          recordHash(cell.executionProfile) !==
            recordHash(semantics.executionProfile) ||
          cell.assertionApplicability !== semantics.assertionApplicability ||
          recordHash(cell.clock) !== recordHash(semantics.clock) ||
          recordHash(cell.assertions) !== recordHash(results)
        )
          issues.push(
            `evaluation ${lane}/${scenario.id} evidence does not reconstruct`
          )
        issues.push(
          ...laneIssues(
            cell.trace,
            lane,
            scenario,
            request.candidateSha256,
            results,
            policy.targets
          )
        )
      }
    }
    if (value.issues.length !== 0)
      issues.push('evaluation retains refusal issues')
    const expectedMediaPaths = value.lanes.flatMap((cell) =>
      cell.lane === 'officialHeadless'
        ? []
        : (cell.trace as BrowserTrace).screenshots.map(
            (screenshot) => screenshot.path
          )
    )
    if (
      value.mediaArtifacts.length !== expectedMediaPaths.length ||
      value.mediaArtifacts.some(
        (artifact, index) =>
          artifact.path !== expectedMediaPaths[index] ||
          !HASH.test(artifact.sha256) ||
          !Number.isSafeInteger(artifact.byteLength) ||
          artifact.byteLength < 1 ||
          artifact.byteLength >
            AUTHORING_EVALUATION_POLICY_V2.maxScreenshotBytes ||
          artifact.mimeType !== 'image/png'
      )
    )
      issues.push(
        'evaluation media identity does not cover every requested screenshot'
      )
  }
  catch (error)
  {
    issues.push(
      error instanceof Error
        ? error.message
        : 'evaluation evidence is malformed'
    )
  }
  return issues
}

function assertEvaluationActive(signal?: AbortSignal): void
{
  if (signal?.aborted) throw new Error('authoring evaluation cancelled')
}

export async function evaluateAuthoringCandidateV2(
  request: AuthoringCandidateEvaluationRequestV2
): Promise<AuthoringCandidateEvaluationV2>
{
  return evaluateCandidate(request, 2)
}

export async function evaluateAuthoringCandidateV3(
  request: AuthoringCandidateEvaluationRequestV3
): Promise<AuthoringCandidateEvaluationV3>
{
  return evaluateCandidate(request, 3)
}

function evaluateCandidate(
  request: AuthoringCandidateEvaluationRequestV2,
  version: 2
): Promise<AuthoringCandidateEvaluationV2>
function evaluateCandidate(
  request: AuthoringCandidateEvaluationRequestV3,
  version: 3
): Promise<AuthoringCandidateEvaluationV3>
async function evaluateCandidate(
  request: AuthoringCandidateEvaluationRequestV2,
  version: 2 | 3
): Promise<AuthoringCandidateEvaluation>
{
  const result: Omit<
    AuthoringCandidateEvaluationV2,
    'evidenceSha256' | 'kind' | 'schemaVersion'
  > & {
    kind: AuthoringCandidateEvaluation['kind']
    schemaVersion: 2 | 3
  } = {
    kind:
      version === 2
        ? 'authoring-candidate-evaluation-v2'
        : 'authoring-candidate-evaluation-v3',
    schemaVersion: version,
    disposition: 'refused',
    candidateSha256: request.candidateSha256,
    standardAuthoritySha256: request.standardAuthoritySha256,
    compilerIdentitySha256: request.compilerIdentitySha256,
    runtimeTargets: [],
    evaluationPolicySha256: '',
    inspection: null,
    lanes: [],
    mediaArtifacts: [],
    issues: [],
    evidenceRoot: null,
    versions: collectVersions(),
    limitations: [
      'acceptance covers only required structural checks and declared bounded scenarios/assertions',
      'headless execution does not verify rendered media or device input',
      'when profiles are selected their assertions run in every rendered lane; headless is an explicit manual60 structural and VM smoke lane',
      'natural scheduling observations are timing diagnostics and do not establish exact replay equality',
      'warnings are retained; no broad gameplay or visual quality claim is made',
    ],
  }
  const issues: string[] = []
  const cells: AuthoringEvaluationLaneEvidenceV2[] = []
  const mediaArtifacts: AuthoringEvaluationMediaArtifactV2[] = []
  let mediaBytes = 0
  try
  {
    assertEvaluationActive(request.signal)
    assertStandardAuthoringAuthorityV2()
    if (
      !HASH.test(request.candidateSha256) ||
      !HASH.test(request.compilerIdentitySha256) ||
      request.standardAuthoritySha256 !== getStandardAuthoritySha256V2()
    )
      throw new Error(
        'candidate, compiler or standard authoring authority identity is invalid'
      )
    if (
      !(request.candidateBytes instanceof Uint8Array) ||
      request.candidateBytes.byteLength < 1 ||
      request.candidateBytes.byteLength > DEFAULT_SB3_LIMITS.maxCompressedBytes
    )
      throw new Error(
        'candidate bytes exceed the bounded Scratch archive input profile'
      )
    assertEvaluationActive(request.signal)
    const bytes = new Uint8Array(request.candidateBytes)
    if (sha256(bytes) !== request.candidateSha256)
      throw new Error('exact candidate bytes do not match their bound SHA-256')
    const policy = preparePolicy(request, version)
    result.runtimeTargets = policy.targets
    result.evaluationPolicySha256 = policy.policySha256
    const runtimeIdentities =
      version === 2
        ? authoringRuntimeIdentitiesV2(policy.targets)
        : authoringRuntimeIdentitiesV3(policy.targets)
    const identityProjection = (identity: AuthoringRuntimeIdentityV2) => ({
      lane: identity.lane,
      runtimeIdentitySha256: identity.runtimeIdentitySha256,
      ...(version === 3
        ? {
            browserInstallationIdentity: (
              identity as AuthoringRuntimeIdentityV3
            ).browserInstallationIdentity,
            runtimeDescriptor: normalizedRuntimeDescriptor(
              identity.runtimeDescriptor
            ),
          }
        : {}),
    })
    if (
      request.runtimeIdentities !== undefined &&
      recordHash(request.runtimeIdentities.map(identityProjection)) !==
        recordHash(runtimeIdentities.map(identityProjection))
    )
      throw new Error(
        'runtime installation identities changed since the immutable build plan'
      )
    if (request.evidenceRoot !== undefined)
    {
      if (!isAbsolute(request.evidenceRoot))
        throw new Error(
          'evaluation evidenceRoot must be an absolute operator-owned path'
        )
      await mkdir(request.evidenceRoot, { recursive: true, mode: 0o700 })
    }
    result.evidenceRoot = await mkdtemp(
      join(request.evidenceRoot ?? tmpdir(), 'scratch-authoring-evaluation-')
    )
    assertEvaluationActive(request.signal)
    result.inspection = await inspectSelectedProject(bytes)
    assertEvaluationActive(request.signal)
    issues.push(...inspectionIssues(result.inspection))
    if (result.inspection.input.sha256 !== request.candidateSha256)
      issues.push('preflight is bound to different candidate bytes')
    if (issues.length === 0)
    {
      for (const scenario of policy.scenarios)
      {
        for (const lane of expectedLanes(policy.targets))
        {
          assertEvaluationActive(request.signal)
          const directory = join(result.evidenceRoot, `${cells.length}-${lane}`)
          const browserInstallationIdentity =
            version === 3 && lane !== 'officialHeadless'
              ? browserRuntimeIdentity()
              : null
          if (
            version === 3 &&
            browserInstallationIdentity !==
              (
                runtimeIdentities.find(
                  (identity) => identity.lane === lane
                ) as AuthoringRuntimeIdentityV3
              ).browserInstallationIdentity
          )
            throw new Error(
              'runtime installation changed before scenario execution'
            )
          const trace =
            lane === 'officialHeadless'
              ? await runScenario(bytes, scenario.scenario)
              : await executeProfileScenarioV1(bytes, scenario.scenario, {
                  profile: profileForLane(policy.targets, lane)!,
                  screenshotDir: directory,
                  maxDurationMs:
                    AUTHORING_EVALUATION_POLICY_V2.maxRuntimeDurationMs,
                  signal: request.signal,
                })
          assertEvaluationActive(request.signal)
          const assertions = applicableAssertions(
            scenario,
            lane,
            policy.targets
          )
          const results = evaluate(trace, assertions)
          const cellIssues = laneIssues(
            trace,
            lane,
            scenario,
            request.candidateSha256,
            results,
            policy.targets
          )
          if (
            version === 3 &&
            lane !== 'officialHeadless' &&
            browserRuntimeIdentity() !== browserInstallationIdentity
          )
            cellIssues.push(
              'runtime installation changed during scenario execution'
            )
          const runtimeIdentitySha256 =
            version === 2
              ? authoringRuntimeIdentitySha256V2(trace.runtimeDescriptor)
              : authoringRecordedRuntimeIdentitySha256V3(
                  trace.runtimeDescriptor,
                  browserInstallationIdentity
                )
          if (
            runtimeIdentitySha256 !==
            runtimeIdentities.find((identity) => identity.lane === lane)!
              .runtimeIdentitySha256
          )
            cellIssues.push(
              'executed runtime content differs from its prepared installation identity'
            )
          cells.push({
            lane,
            ...laneSemantics(policy.targets, lane),
            scenarioId: scenario.id,
            scenarioSha256: scenario.scenarioSha256,
            runtimeIdentitySha256,
            ...(version === 3 ? { browserInstallationIdentity } : {}),
            runtimeDescriptor: trace.runtimeDescriptor,
            traceSha256: recordHash(trace),
            assertions: results,
            accepted: cellIssues.length === 0,
            issues: cellIssues,
            trace,
          })
          if (lane !== 'officialHeadless')
          {
            for (const screenshot of (trace as BrowserTrace).screenshots)
            {
              assertEvaluationActive(request.signal)
              const file = await open(
                screenshot.path,
                constants.O_RDONLY | constants.O_NOFOLLOW
              )
              try
              {
                const stat = await file.stat()
                if (
                  !stat.isFile() ||
                  stat.size < 1 ||
                  stat.size >
                    AUTHORING_EVALUATION_POLICY_V2.maxScreenshotBytes ||
                  mediaBytes + stat.size >
                    AUTHORING_EVALUATION_POLICY_V2.maxMediaBytes
                )
                  throw new Error(
                    'rendered evidence exceeds its bounded media byte profile'
                  )
                const bytes = Buffer.alloc(stat.size + 1)
                let length = 0
                while (length < bytes.byteLength)
                {
                  assertEvaluationActive(request.signal)
                  const read = await file.read(
                    bytes,
                    length,
                    bytes.byteLength - length,
                    length
                  )
                  if (read.bytesRead === 0) break
                  length += read.bytesRead
                }
                if (length !== stat.size)
                  throw new Error(
                    'rendered evidence changed while its identity was retained'
                  )
                const payload = bytes.subarray(0, length)
                assertEvaluationActive(request.signal)
                mediaBytes += length
                mediaArtifacts.push({
                  path: screenshot.path,
                  sha256: sha256(payload),
                  byteLength: length,
                  mimeType: 'image/png',
                })
              }
              finally
              {
                await file.close()
              }
            }
          }
          issues.push(
            ...cellIssues.map((issue) => `${lane}/${scenario.id}: ${issue}`)
          )
        }
      }
    }
  }
  catch (error)
  {
    issues.push(
      isRunnerIssueError(error) &&
        error.issue.code === 'runner.cleanup.incomplete'
        ? `runner.cleanup.incomplete: ${error.issue.message.slice(0, 1024)}`
        : error instanceof Error
          ? error.message
          : 'authoring evaluation failed'
    )
  }
  result.lanes = cells
  result.mediaArtifacts = mediaArtifacts
  if (
    request.signal?.aborted &&
    !issues.includes('authoring evaluation cancelled')
  )
    issues.push('authoring evaluation cancelled')
  result.issues = issues
  result.disposition = issues.length === 0 ? 'accepted' : 'refused'
  let completed = {
    ...result,
    evidenceSha256: recordHash(result),
  } as AuthoringCandidateEvaluation
  if (result.evidenceRoot)
  {
    try
    {
      const bytes = evidenceBytes(completed)
      if (bytes.byteLength > AUTHORING_EVALUATION_POLICY_V2.maxEvidenceBytes)
        throw new Error('authoring evaluation evidence exceeds its byte limit')
      await writeFile(join(result.evidenceRoot, 'evaluation.json'), bytes, {
        flag: 'wx',
      })
    }
    catch (error)
    {
      result.disposition = 'refused'
      result.issues = [
        ...result.issues,
        error instanceof Error
          ? error.message
          : 'authoring evidence could not be retained',
      ]
      completed = {
        ...result,
        evidenceSha256: recordHash(result),
      } as AuthoringCandidateEvaluation
    }
  }
  return JSON.parse(JSON.stringify(completed)) as AuthoringCandidateEvaluation
}
