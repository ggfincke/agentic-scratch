// packages/eval/src/multimodal/lens-validation.ts
// strictly validate behavioral lens specs, results, & differential reports

import {
  detachedFrozenMultimodalRecord,
  hashMultimodalJson,
  MULTIMODAL_SCHEMA_VERSION,
  multimodalArray,
  multimodalExactKeys,
  multimodalFiniteNumber,
  multimodalRecord,
  multimodalString,
  validateMultimodalEvidenceLocator,
  type MultimodalContractIssue,
  type MultimodalValidationResult,
} from './multimodal-contracts.js'
import {
  aggregateLensResults,
  type BehavioralLensSpecV1,
  type DifferentialReportV1,
  type LensResultV1,
} from './lenses.js'
import { unknownErrorMessage } from '../core/unknown-error-message.js'

const SHA256 = /^[a-f0-9]{64}$/
const LENS_KINDS = new Set([
  'final-state',
  'labeled-trace',
  'visual-keyframes',
  'runtime-outcome',
  'clone-count-trace',
])
const LENS_REASONS = new Set([
  'observation-unavailable',
  'observation-incomplete',
  'unsupported-feature',
  'runtime-failure',
  'infrastructure-failure',
  'invalid-specification',
  'capability-not-assessed',
  'capability-binding-mismatch',
  'not-applicable',
])
const CLAIM_SCOPE =
  'Finite evidence may support only: no regression was observed for the recorded scenarios, seeds, lenses, and runtimes.'

function issue(
  issues: MultimodalContractIssue[],
  path: string,
  code: MultimodalContractIssue['code'],
  message: string
): void
{
  issues.push({ path, code, message })
}

function hash(
  value: unknown,
  path: string,
  issues: MultimodalContractIssue[],
  nullable = false
): void
{
  if (nullable && value === null) return
  const parsed = multimodalString(value, path, issues, {
    minLength: 64,
    maxLength: 64,
  })
  if (parsed !== null && !SHA256.test(parsed))
    issue(issues, path, 'invalid-value', 'expected a lowercase SHA-256 digest')
}

function text(
  value: unknown,
  path: string,
  issues: MultimodalContractIssue[],
  maxLength = 4096
): void
{
  multimodalString(value, path, issues, { minLength: 1, maxLength })
}

function boolean(
  value: unknown,
  path: string,
  issues: MultimodalContractIssue[]
): void
{
  if (typeof value !== 'boolean')
    issue(issues, path, 'invalid-type', 'expected a boolean')
}

function nullableInteger(
  value: unknown,
  path: string,
  issues: MultimodalContractIssue[]
): void
{
  if (value === null) return
  multimodalFiniteNumber(value, path, issues, {
    min: Number.MIN_SAFE_INTEGER,
    max: Number.MAX_SAFE_INTEGER,
    integer: true,
  })
}

function stringArray(
  value: unknown,
  path: string,
  issues: MultimodalContractIssue[],
  unique = false,
  minLength = 0
): string[]
{
  const values = multimodalArray(value, path, issues, { minLength }) ?? []
  const parsed: string[] = []
  values.forEach((entry, index) =>
  {
    const current = multimodalString(entry, `${path}[${index}]`, issues, {
      minLength: 1,
      maxLength: 4096,
    })
    if (current !== null) parsed.push(current)
  })
  if (unique && new Set(parsed).size !== parsed.length)
    issue(issues, path, 'duplicate-id', 'values must be unique')
  return parsed
}

function locators(
  value: unknown,
  path: string,
  issues: MultimodalContractIssue[]
): void
{
  const values = multimodalArray(value, path, issues, { maxLength: 256 })
  values?.forEach((locator, index) =>
  {
    const validated = validateMultimodalEvidenceLocator(locator)
    if (!validated.ok)
      for (const current of validated.issues)
        issue(
          issues,
          `${path}[${index}]${current.path === '$' ? '' : current.path.slice(1)}`,
          current.code,
          current.message
        )
  })
}

function toleranceMap(
  value: unknown,
  path: string,
  issues: MultimodalContractIssue[]
): void
{
  if (value === undefined) return
  const map = multimodalRecord(value, path, issues)
  if (!map) return
  for (const [key, tolerance] of Object.entries(map))
  {
    text(key, `${path}.${key}`, issues, 1024)
    if (!key.startsWith('$'))
      issue(
        issues,
        `${path}.${key}`,
        'invalid-value',
        'numeric tolerance paths must start with $'
      )
    multimodalFiniteNumber(tolerance, `${path}.${key}`, issues, { min: 0 })
  }
}

function validateSpec(
  value: unknown,
  path: string,
  issues: MultimodalContractIssue[]
): void
{
  const spec = multimodalRecord(value, path, issues)
  if (!spec) return
  const kind = multimodalString(spec.kind, `${path}.kind`, issues, {
    minLength: 1,
    maxLength: 64,
  })
  const shared = ['schemaVersion', 'id', 'required', 'appliesTo', 'kind']
  const extra =
    kind === 'final-state'
      ? ['absoluteNumericTolerance', 'numericToleranceByPath']
      : kind === 'labeled-trace'
        ? ['labels', 'absoluteNumericTolerance', 'numericToleranceByPath']
        : kind === 'visual-keyframes'
          ? ['frameIds', 'maxMeanRgbDelta', 'maxNormalizedRectDelta']
          : kind === 'clone-count-trace'
            ? ['ticks']
            : []
  multimodalExactKeys(
    spec,
    path,
    [...shared, ...extra.filter((key) => key !== 'numericToleranceByPath')],
    extra.includes('numericToleranceByPath') ? ['numericToleranceByPath'] : [],
    issues
  )
  if (spec.schemaVersion !== MULTIMODAL_SCHEMA_VERSION)
    issue(
      issues,
      `${path}.schemaVersion`,
      'invalid-value',
      'unsupported schema'
    )
  text(spec.id, `${path}.id`, issues, 128)
  boolean(spec.required, `${path}.required`, issues)
  if (
    !['baseline-candidate', 'runtime-runtime', 'both'].includes(
      String(spec.appliesTo)
    )
  )
    issue(issues, `${path}.appliesTo`, 'invalid-value', 'unknown applicability')
  if (kind !== null && !LENS_KINDS.has(kind))
    issue(issues, `${path}.kind`, 'invalid-value', 'unknown lens kind')
  if (kind === 'final-state' || kind === 'labeled-trace')
  {
    multimodalFiniteNumber(
      spec.absoluteNumericTolerance,
      `${path}.absoluteNumericTolerance`,
      issues,
      { min: 0 }
    )
    toleranceMap(
      spec.numericToleranceByPath,
      `${path}.numericToleranceByPath`,
      issues
    )
  }
  if (kind === 'labeled-trace')
    stringArray(spec.labels, `${path}.labels`, issues, true, 1)
  if (kind === 'visual-keyframes')
  {
    stringArray(spec.frameIds, `${path}.frameIds`, issues, true, 1)
    multimodalFiniteNumber(
      spec.maxMeanRgbDelta,
      `${path}.maxMeanRgbDelta`,
      issues,
      { min: 0, max: 255 }
    )
    multimodalFiniteNumber(
      spec.maxNormalizedRectDelta,
      `${path}.maxNormalizedRectDelta`,
      issues,
      { min: 0, max: 1 }
    )
  }
  if (kind === 'clone-count-trace')
  {
    const ticks = multimodalArray(spec.ticks, `${path}.ticks`, issues, {
      minLength: 1,
    })
    ticks?.forEach((tick, index) =>
      multimodalFiniteNumber(tick, `${path}.ticks[${index}]`, issues, {
        min: 0,
        max: Number.MAX_SAFE_INTEGER,
        integer: true,
      })
    )
    if (ticks && new Set(ticks).size !== ticks.length)
      issue(issues, `${path}.ticks`, 'duplicate-id', 'ticks must be unique')
  }
}

function validateResult(
  value: unknown,
  path: string,
  spec: BehavioralLensSpecV1 | undefined,
  issues: MultimodalContractIssue[]
): void
{
  const result = multimodalRecord(value, path, issues)
  if (!result) return
  multimodalExactKeys(
    result,
    path,
    [
      'schemaVersion',
      'specId',
      'kind',
      'required',
      'verdict',
      'inconclusiveReason',
      'differences',
      'omittedDifferenceCount',
      'evidence',
    ],
    [],
    issues
  )
  if (result.schemaVersion !== MULTIMODAL_SCHEMA_VERSION)
    issue(
      issues,
      `${path}.schemaVersion`,
      'invalid-value',
      'unsupported schema'
    )
  text(result.specId, `${path}.specId`, issues, 128)
  const kind = multimodalString(result.kind, `${path}.kind`, issues, {
    minLength: 1,
    maxLength: 64,
  })
  if (kind !== null && !LENS_KINDS.has(kind))
    issue(issues, `${path}.kind`, 'invalid-value', 'unknown lens kind')
  boolean(result.required, `${path}.required`, issues)
  const verdict = multimodalString(result.verdict, `${path}.verdict`, issues, {
    minLength: 1,
    maxLength: 32,
  })
  if (
    verdict !== null &&
    !['agree', 'diverge', 'inconclusive'].includes(verdict)
  )
    issue(issues, `${path}.verdict`, 'invalid-value', 'unknown lens verdict')
  if (result.inconclusiveReason !== null)
  {
    const reason = multimodalString(
      result.inconclusiveReason,
      `${path}.inconclusiveReason`,
      issues,
      { minLength: 1, maxLength: 64 }
    )
    if (reason !== null && !LENS_REASONS.has(reason))
      issue(
        issues,
        `${path}.inconclusiveReason`,
        'invalid-value',
        'unknown inconclusive reason'
      )
  }
  const differences = multimodalArray(
    result.differences,
    `${path}.differences`,
    issues,
    { maxLength: 512 }
  )
  differences?.forEach((difference, index) =>
  {
    const differencePath = `${path}.differences[${index}]`
    const current = multimodalRecord(difference, differencePath, issues)
    if (!current) return
    multimodalExactKeys(
      current,
      differencePath,
      ['path', 'left', 'right', 'detail', 'evidence'],
      [],
      issues
    )
    text(current.path, `${differencePath}.path`, issues)
    text(current.left, `${differencePath}.left`, issues)
    text(current.right, `${differencePath}.right`, issues)
    text(current.detail, `${differencePath}.detail`, issues)
    locators(current.evidence, `${differencePath}.evidence`, issues)
  })
  multimodalFiniteNumber(
    result.omittedDifferenceCount,
    `${path}.omittedDifferenceCount`,
    issues,
    { min: 0, integer: true }
  )
  locators(result.evidence, `${path}.evidence`, issues)
  if (spec)
  {
    if (
      result.specId !== spec.id ||
      result.kind !== spec.kind ||
      result.required !== spec.required
    )
      issue(
        issues,
        path,
        'invalid-value',
        'lens result does not match its spec'
      )
  }
  if (
    verdict === 'agree' &&
    (result.inconclusiveReason !== null ||
      differences?.length ||
      result.omittedDifferenceCount !== 0)
  )
    issue(issues, path, 'invalid-value', 'agreement cannot retain differences')
  if (
    verdict === 'diverge' &&
    (result.inconclusiveReason !== null || !differences?.length)
  )
    issue(
      issues,
      path,
      'invalid-value',
      'divergence needs a witnessed difference'
    )
  if (verdict === 'inconclusive' && result.inconclusiveReason === null)
    issue(issues, path, 'invalid-value', 'inconclusive result needs a reason')
  if (
    verdict === 'inconclusive' &&
    (differences?.length || result.omittedDifferenceCount !== 0)
  )
    issue(
      issues,
      path,
      'invalid-value',
      'inconclusive results cannot retain differences'
    )
}

function validateFileIdentity(
  value: unknown,
  path: string,
  issues: MultimodalContractIssue[]
): void
{
  const file = multimodalRecord(value, path, issues)
  if (!file) return
  multimodalExactKeys(file, path, ['path', 'sha256', 'byteLength'], [], issues)
  text(file.path, `${path}.path`, issues)
  hash(file.sha256, `${path}.sha256`, issues)
  multimodalFiniteNumber(file.byteLength, `${path}.byteLength`, issues, {
    min: 0,
    integer: true,
  })
}

function validateRuntimeDescriptor(
  value: unknown,
  path: string,
  issues: MultimodalContractIssue[]
): void
{
  const runtime = multimodalRecord(value, path, issues)
  if (!runtime) return
  multimodalExactKeys(
    runtime,
    path,
    [
      'schemaVersion',
      'id',
      'kind',
      'configurationSha256',
      'renderer',
      'compiler',
      'network',
      'components',
      'browser',
      'bundle',
      'workers',
      'environment',
    ],
    [],
    issues
  )
  if (runtime.schemaVersion !== MULTIMODAL_SCHEMA_VERSION)
    issue(
      issues,
      `${path}.schemaVersion`,
      'invalid-value',
      'unsupported schema'
    )
  text(runtime.id, `${path}.id`, issues, 256)
  if (
    ![
      'scratch-vm-node',
      'scratch-official-browser',
      'turbowarp-browser',
      'headless-gl-experiment',
    ].includes(String(runtime.kind))
  )
    issue(issues, `${path}.kind`, 'invalid-value', 'unknown runtime kind')
  hash(runtime.configurationSha256, `${path}.configurationSha256`, issues)
  if (
    !['none', 'scratch-render', 'turbowarp-renderer', 'headless-gl'].includes(
      String(runtime.renderer)
    )
  )
    issue(issues, `${path}.renderer`, 'invalid-value', 'unknown renderer')
  if (
    !['enabled', 'disabled', 'not-applicable'].includes(
      String(runtime.compiler)
    )
  )
    issue(issues, `${path}.compiler`, 'invalid-value', 'unknown compiler mode')
  if (!['denied', 'allowlisted'].includes(String(runtime.network)))
    issue(issues, `${path}.network`, 'invalid-value', 'unknown network mode')
  const components = multimodalArray(
    runtime.components,
    `${path}.components`,
    issues
  )
  components?.forEach((component, index) =>
  {
    const componentPath = `${path}.components[${index}]`
    const current = multimodalRecord(component, componentPath, issues)
    if (!current) return
    multimodalExactKeys(
      current,
      componentPath,
      ['name', 'version', 'sha256', 'byteLength'],
      [],
      issues
    )
    text(current.name, `${componentPath}.name`, issues, 256)
    text(current.version, `${componentPath}.version`, issues, 256)
    hash(current.sha256, `${componentPath}.sha256`, issues, true)
    if (current.byteLength !== null)
      multimodalFiniteNumber(
        current.byteLength,
        `${componentPath}.byteLength`,
        issues,
        { min: 0, integer: true }
      )
  })
  if (runtime.browser !== null)
  {
    const browser = multimodalRecord(runtime.browser, `${path}.browser`, issues)
    if (browser)
    {
      multimodalExactKeys(
        browser,
        `${path}.browser`,
        ['name', 'version'],
        [],
        issues
      )
      text(browser.name, `${path}.browser.name`, issues, 256)
      text(browser.version, `${path}.browser.version`, issues, 256)
    }
  }
  if (runtime.bundle !== null)
    validateFileIdentity(runtime.bundle, `${path}.bundle`, issues)
  const workers = multimodalArray(runtime.workers, `${path}.workers`, issues)
  workers?.forEach((worker, index) =>
    validateFileIdentity(worker, `${path}.workers[${index}]`, issues)
  )
  const environment = multimodalRecord(
    runtime.environment,
    `${path}.environment`,
    issues
  )
  if (environment)
  {
    multimodalExactKeys(
      environment,
      `${path}.environment`,
      ['node', 'platform', 'arch'],
      [],
      issues
    )
    text(environment.node, `${path}.environment.node`, issues, 256)
    text(environment.platform, `${path}.environment.platform`, issues, 256)
    text(environment.arch, `${path}.environment.arch`, issues, 256)
  }
}

function validateRunBinding(
  value: unknown,
  path: string,
  issues: MultimodalContractIssue[]
): void
{
  const binding = multimodalRecord(value, path, issues)
  if (!binding) return
  multimodalExactKeys(
    binding,
    path,
    [
      'artifactSha256',
      'runtimeDescriptor',
      'runtimeDescriptorSha256',
      'scenarioSha256',
      'seed',
      'fixedDateMs',
      'labels',
    ],
    [],
    issues
  )
  hash(binding.artifactSha256, `${path}.artifactSha256`, issues)
  validateRuntimeDescriptor(
    binding.runtimeDescriptor,
    `${path}.runtimeDescriptor`,
    issues
  )
  hash(
    binding.runtimeDescriptorSha256,
    `${path}.runtimeDescriptorSha256`,
    issues
  )
  try
  {
    if (
      binding.runtimeDescriptorSha256 !==
      hashMultimodalJson(binding.runtimeDescriptor)
    )
      issue(
        issues,
        `${path}.runtimeDescriptorSha256`,
        'invalid-value',
        'runtime descriptor hash does not match'
      )
  }
  catch
  {
    issue(
      issues,
      `${path}.runtimeDescriptor`,
      'invalid-value',
      'invalid runtime'
    )
  }
  hash(binding.scenarioSha256, `${path}.scenarioSha256`, issues)
  nullableInteger(binding.seed, `${path}.seed`, issues)
  nullableInteger(binding.fixedDateMs, `${path}.fixedDateMs`, issues)
  stringArray(binding.labels, `${path}.labels`, issues, true)
}

function validateCapabilityAssessment(
  value: unknown,
  path: string,
  issues: MultimodalContractIssue[]
): void
{
  const assessment = multimodalRecord(value, path, issues)
  if (!assessment) return
  multimodalExactKeys(
    assessment,
    path,
    [
      'schemaVersion',
      'status',
      'runtimePair',
      'classification',
      'sourceSb3Sha256',
      'leftRuntimeDescriptorSha256',
      'rightRuntimeDescriptorSha256',
      'declaredExtensions',
      'omittedDeclaredExtensionCount',
      'inventory',
      'capabilities',
    ],
    [],
    issues
  )
  if (assessment.schemaVersion !== MULTIMODAL_SCHEMA_VERSION)
    issue(
      issues,
      `${path}.schemaVersion`,
      'invalid-value',
      'unsupported schema'
    )
  if (
    !['classified', 'assessed', 'not-assessed'].includes(
      String(assessment.status)
    )
  )
    issue(
      issues,
      `${path}.status`,
      'invalid-value',
      'unknown assessment status'
    )
  if (
    ![
      'official-headless-vs-turbowarp-browser',
      'official-browser-vs-turbowarp-browser',
      'custom-runtime-pair',
    ].includes(String(assessment.runtimePair))
  )
    issue(
      issues,
      `${path}.runtimePair`,
      'invalid-value',
      'unknown runtime pair'
    )
  if (
    !['comparable', 'unsupported', 'unknown'].includes(
      String(assessment.classification)
    )
  )
    issue(
      issues,
      `${path}.classification`,
      'invalid-value',
      'unknown classification'
    )
  hash(assessment.sourceSb3Sha256, `${path}.sourceSb3Sha256`, issues, true)
  hash(
    assessment.leftRuntimeDescriptorSha256,
    `${path}.leftRuntimeDescriptorSha256`,
    issues,
    true
  )
  hash(
    assessment.rightRuntimeDescriptorSha256,
    `${path}.rightRuntimeDescriptorSha256`,
    issues,
    true
  )
  stringArray(
    assessment.declaredExtensions,
    `${path}.declaredExtensions`,
    issues,
    true
  )
  multimodalFiniteNumber(
    assessment.omittedDeclaredExtensionCount,
    `${path}.omittedDeclaredExtensionCount`,
    issues,
    { min: 0, integer: true }
  )
  const inventory = multimodalRecord(
    assessment.inventory,
    `${path}.inventory`,
    issues
  )
  if (inventory)
  {
    multimodalExactKeys(
      inventory,
      `${path}.inventory`,
      ['costumeCount', 'soundCount', 'cloudVariableCount'],
      [],
      issues
    )
    for (const key of [
      'costumeCount',
      'soundCount',
      'cloudVariableCount',
    ] as const)
      multimodalFiniteNumber(
        inventory[key],
        `${path}.inventory.${key}`,
        issues,
        {
          min: 0,
          integer: true,
        }
      )
  }
  const capabilities = multimodalArray(
    assessment.capabilities,
    `${path}.capabilities`,
    issues
  )
  capabilities?.forEach((capability, index) =>
  {
    const capabilityPath = `${path}.capabilities[${index}]`
    const current = multimodalRecord(capability, capabilityPath, issues)
    if (!current) return
    multimodalExactKeys(
      current,
      capabilityPath,
      [
        'kind',
        'support',
        'reason',
        'opcodes',
        'omittedOpcodeCount',
        'details',
        'omittedDetailCount',
      ],
      [],
      issues
    )
    if (
      ![
        'renderer',
        'audio',
        'network',
        'extension',
        'video',
        'hardware',
        'external-input',
      ].includes(String(current.kind))
    )
      issue(
        issues,
        `${capabilityPath}.kind`,
        'invalid-value',
        'unknown capability'
      )
    if (!['supported', 'unsupported'].includes(String(current.support)))
      issue(
        issues,
        `${capabilityPath}.support`,
        'invalid-value',
        'unknown support'
      )
    if (current.reason !== null)
      text(current.reason, `${capabilityPath}.reason`, issues)
    stringArray(current.opcodes, `${capabilityPath}.opcodes`, issues, true)
    multimodalFiniteNumber(
      current.omittedOpcodeCount,
      `${capabilityPath}.omittedOpcodeCount`,
      issues,
      { min: 0, integer: true }
    )
    stringArray(current.details, `${capabilityPath}.details`, issues, true)
    multimodalFiniteNumber(
      current.omittedDetailCount,
      `${capabilityPath}.omittedDetailCount`,
      issues,
      { min: 0, integer: true }
    )
  })
  const capabilityKinds = (capabilities ?? []).flatMap((capability) =>
  {
    const current = multimodalRecord(capability, '$', [])
    return current && typeof current.kind === 'string' ? [current.kind] : []
  })
  if (new Set(capabilityKinds).size !== capabilityKinds.length)
    issue(
      issues,
      `${path}.capabilities`,
      'duplicate-id',
      'capability kinds must be unique'
    )
  for (const [index, capability] of (capabilities ?? []).entries())
  {
    const current = multimodalRecord(capability, '$', [])
    if (!current) continue
    if (
      (current.support === 'supported' && current.reason !== null) ||
      (current.support === 'unsupported' && current.reason === null)
    )
      issue(
        issues,
        `${path}.capabilities[${index}].reason`,
        'invalid-value',
        'capability support and reason disagree'
      )
  }
  const hasUnsupported = (capabilities ?? []).some(
    (capability) =>
      multimodalRecord(capability, '$', [])?.support === 'unsupported'
  )
  const status = assessment.status
  if (status === 'not-assessed')
  {
    if (
      assessment.classification !== 'unknown' ||
      assessment.sourceSb3Sha256 !== null ||
      assessment.leftRuntimeDescriptorSha256 !== null ||
      assessment.rightRuntimeDescriptorSha256 !== null
    )
      issue(
        issues,
        path,
        'invalid-value',
        'an unassessed capability record cannot claim bound identities'
      )
  }
  else
  {
    if (
      assessment.sourceSb3Sha256 === null ||
      assessment.classification !==
        (hasUnsupported ? 'unsupported' : 'comparable')
    )
      issue(
        issues,
        path,
        'invalid-value',
        'capability classification does not match its assessed uses'
      )
    if (
      status === 'classified' &&
      (assessment.leftRuntimeDescriptorSha256 !== null ||
        assessment.rightRuntimeDescriptorSha256 !== null)
    )
      issue(
        issues,
        path,
        'invalid-value',
        'a classified capability record cannot claim runtime bindings'
      )
    if (
      status === 'assessed' &&
      (assessment.leftRuntimeDescriptorSha256 === null ||
        assessment.rightRuntimeDescriptorSha256 === null)
    )
      issue(
        issues,
        path,
        'invalid-value',
        'an assessed capability record needs both runtime bindings'
      )
  }
}

function requirePolicyInconclusive(
  result: Record<string, unknown>,
  reason: string,
  path: string,
  issues: MultimodalContractIssue[]
): void
{
  if (result.verdict !== 'inconclusive' || result.inconclusiveReason !== reason)
    issue(
      issues,
      path,
      'invalid-value',
      `lens policy requires inconclusive/${reason}`
    )
}

function validateVisualResultEvidence(
  spec: Extract<BehavioralLensSpecV1, { kind: 'visual-keyframes' }>,
  result: Record<string, unknown>,
  path: string,
  issues: MultimodalContractIssue[]
): void
{
  const evidence = Array.isArray(result.evidence) ? result.evidence : []
  if (result.verdict === 'inconclusive')
  {
    if (evidence.length !== 0)
      issue(
        issues,
        `${path}.evidence`,
        'invalid-value',
        'inconclusive visual evidence must be empty'
      )
    return
  }
  const byIdentity = new Map<string, Record<string, unknown>>()
  for (const locator of evidence)
  {
    const current = multimodalRecord(locator, '$', [])
    if (
      !current ||
      typeof current.evidenceId !== 'string' ||
      typeof current.frameId !== 'string'
    )
      continue
    const key = `${current.evidenceId}\u0000${current.frameId}`
    if (byIdentity.has(key))
      issue(
        issues,
        `${path}.evidence`,
        'duplicate-id',
        'visual evidence identities must be unique'
      )
    byIdentity.set(key, current)
  }
  for (const frameId of spec.frameIds)
    for (const side of ['left', 'right'] as const)
    {
      const locator = byIdentity.get(`${side}:${frameId}\u0000${frameId}`)
      if (!locator || locator.region !== null)
        issue(
          issues,
          `${path}.evidence`,
          'invalid-value',
          `visual result omitted canonical ${side}/${frameId} evidence`
        )
    }
  if (byIdentity.size !== spec.frameIds.length * 2)
    issue(
      issues,
      `${path}.evidence`,
      'invalid-value',
      'visual result retained unrelated evidence'
    )
  const admitted = new Set(byIdentity.keys())
  const differences = Array.isArray(result.differences)
    ? result.differences
    : []
  for (const [index, difference] of differences.entries())
  {
    const current = multimodalRecord(difference, '$', [])
    if (!current || !Array.isArray(current.evidence)) continue
    for (const locator of current.evidence)
    {
      const evidenceLocator = multimodalRecord(locator, '$', [])
      if (
        !evidenceLocator ||
        typeof evidenceLocator.evidenceId !== 'string' ||
        typeof evidenceLocator.frameId !== 'string' ||
        !admitted.has(
          `${evidenceLocator.evidenceId}\u0000${evidenceLocator.frameId}`
        )
      )
        issue(
          issues,
          `${path}.differences[${index}].evidence`,
          'unresolved-evidence',
          'visual difference cited evidence outside the result index'
        )
    }
  }
}

function validateResultPolicy(
  comparisonKind: unknown,
  spec: BehavioralLensSpecV1,
  resultValue: unknown,
  assessment: Record<string, unknown> | null,
  requirement: Record<string, unknown> | undefined,
  left: Record<string, unknown> | null,
  right: Record<string, unknown> | null,
  path: string,
  issues: MultimodalContractIssue[]
): void
{
  const result = multimodalRecord(resultValue, path, [])
  if (!result) return
  if (spec.appliesTo !== 'both' && spec.appliesTo !== comparisonKind)
  {
    requirePolicyInconclusive(result, 'not-applicable', path, issues)
    return
  }
  if (comparisonKind === 'runtime-runtime')
  {
    if (assessment?.status !== 'assessed')
    {
      requirePolicyInconclusive(result, 'capability-not-assessed', path, issues)
      return
    }
    if (
      requirement?.support === 'unsupported' ||
      assessment.classification === 'unsupported'
    )
    {
      requirePolicyInconclusive(result, 'unsupported-feature', path, issues)
      return
    }
  }
  if (
    spec.kind === 'labeled-trace' &&
    result.verdict !== 'inconclusive' &&
    (!Array.isArray(left?.labels) ||
      !Array.isArray(right?.labels) ||
      spec.labels.some(
        (label) =>
          !(left.labels as unknown[]).includes(label) ||
          !(right.labels as unknown[]).includes(label)
      ))
  )
    issue(
      issues,
      path,
      'invalid-value',
      'decisive labeled-trace evidence omitted a required label'
    )
  if (spec.kind === 'visual-keyframes')
    validateVisualResultEvidence(spec, result, path, issues)
  else if (Array.isArray(result.evidence) && result.evidence.length > 0)
    issue(
      issues,
      `${path}.evidence`,
      'invalid-value',
      'nonvisual lenses cannot retain frame evidence'
    )
}

export function validateBehavioralLensSpecs(
  value: unknown
): MultimodalValidationResult<BehavioralLensSpecV1[]>
{
  const issues: MultimodalContractIssue[] = []
  let detached: Readonly<unknown>
  try
  {
    detached = detachedFrozenMultimodalRecord(value)
  }
  catch (error)
  {
    return {
      ok: false,
      issues: [
        {
          path: '$',
          code: 'limit-exceeded',
          message: unknownErrorMessage(error),
        },
      ],
    }
  }
  const specs = multimodalArray(detached, '$', issues, { maxLength: 64 })
  specs?.forEach((spec, index) => validateSpec(spec, `$[${index}]`, issues))
  const ids = (specs ?? []).flatMap((spec) =>
  {
    const current = multimodalRecord(spec, '$', [])
    return current && typeof current.id === 'string' ? [current.id] : []
  })
  if (new Set(ids).size !== ids.length)
    issue(issues, '$', 'duplicate-id', 'lens spec IDs must be unique')
  if (issues.length > 0) return { ok: false, issues }
  return {
    ok: true,
    value: detached as Readonly<BehavioralLensSpecV1[]>,
  }
}

export function validateDifferentialReport(
  value: unknown
): MultimodalValidationResult<DifferentialReportV1>
{
  const issues: MultimodalContractIssue[] = []
  let detached: Readonly<unknown>
  try
  {
    detached = detachedFrozenMultimodalRecord(value)
  }
  catch (error)
  {
    return {
      ok: false,
      issues: [
        {
          path: '$',
          code: 'limit-exceeded',
          message: unknownErrorMessage(error),
        },
      ],
    }
  }
  const report = multimodalRecord(detached, '$', issues)
  if (!report) return { ok: false, issues }
  multimodalExactKeys(
    report,
    '$',
    [
      'schemaVersion',
      'comparisonKind',
      'left',
      'right',
      'capabilityAssessment',
      'capabilityRequirements',
      'specs',
      'results',
      'verdict',
      'claimScope',
    ],
    [],
    issues
  )
  if (report.schemaVersion !== MULTIMODAL_SCHEMA_VERSION)
    issue(issues, '$.schemaVersion', 'invalid-value', 'unsupported schema')
  if (
    !['baseline-candidate', 'runtime-runtime'].includes(
      String(report.comparisonKind)
    )
  )
    issue(
      issues,
      '$.comparisonKind',
      'invalid-value',
      'unknown comparison kind'
    )
  validateRunBinding(report.left, '$.left', issues)
  validateRunBinding(report.right, '$.right', issues)
  const left = multimodalRecord(report.left, '$.left', [])
  const right = multimodalRecord(report.right, '$.right', [])
  if (left && right && left.scenarioSha256 !== right.scenarioSha256)
    issue(issues, '$', 'invalid-value', 'differential scenarios must match')
  if (
    left &&
    right &&
    (left.seed !== right.seed || left.fixedDateMs !== right.fixedDateMs)
  )
    issue(
      issues,
      '$',
      'invalid-value',
      'differential determinism bindings must match'
    )
  if (
    report.comparisonKind === 'runtime-runtime' &&
    left &&
    right &&
    left.artifactSha256 !== right.artifactSha256
  )
    issue(
      issues,
      '$',
      'invalid-value',
      'runtime comparison artifacts must match'
    )
  validateCapabilityAssessment(
    report.capabilityAssessment,
    '$.capabilityAssessment',
    issues
  )
  const assessment = multimodalRecord(
    report.capabilityAssessment,
    '$.capabilityAssessment',
    []
  )
  if (assessment?.status === 'assessed' && left && right)
  {
    if (
      assessment.leftRuntimeDescriptorSha256 !== left.runtimeDescriptorSha256 ||
      assessment.rightRuntimeDescriptorSha256 !== right.runtimeDescriptorSha256
    )
      issue(
        issues,
        '$.capabilityAssessment',
        'invalid-value',
        'capability assessment runtime bindings do not match'
      )
    if (
      report.comparisonKind === 'runtime-runtime' &&
      (assessment.sourceSb3Sha256 !== left.artifactSha256 ||
        assessment.sourceSb3Sha256 !== right.artifactSha256)
    )
      issue(
        issues,
        '$.capabilityAssessment.sourceSb3Sha256',
        'invalid-value',
        'capability assessment artifact binding does not match'
      )
    const leftRuntime = multimodalRecord(left.runtimeDescriptor, '$', [])
    const rightRuntime = multimodalRecord(right.runtimeDescriptor, '$', [])
    const expectedKinds =
      assessment.runtimePair === 'official-headless-vs-turbowarp-browser'
        ? { left: 'scratch-vm-node', right: 'turbowarp-browser' }
        : assessment.runtimePair === 'official-browser-vs-turbowarp-browser'
          ? { left: 'scratch-official-browser', right: 'turbowarp-browser' }
          : null
    if (
      expectedKinds &&
      (leftRuntime?.kind !== expectedKinds.left ||
        rightRuntime?.kind !== expectedKinds.right)
    )
      issue(
        issues,
        '$.capabilityAssessment.runtimePair',
        'invalid-value',
        'capability runtime-pair identity does not match the run bindings'
      )
  }
  const specsValidation = validateBehavioralLensSpecs(report.specs)
  if (!specsValidation.ok)
    for (const current of specsValidation.issues)
      issue(
        issues,
        `$.specs${current.path === '$' ? '' : current.path.slice(1)}`,
        current.code,
        current.message
      )
  const specs = specsValidation.ok ? specsValidation.value : []
  if (!specs.some((spec) => spec.required))
    issue(issues, '$.specs', 'invalid-value', 'a required lens is needed')
  const results = multimodalArray(report.results, '$.results', issues, {
    maxLength: 64,
  })
  results?.forEach((result, index) =>
    validateResult(result, `$.results[${index}]`, specs[index], issues)
  )
  if (results && results.length !== specs.length)
    issue(issues, '$.results', 'invalid-value', 'every lens needs one result')
  const requirements = multimodalArray(
    report.capabilityRequirements,
    '$.capabilityRequirements',
    issues,
    { maxLength: 64 }
  )
  requirements?.forEach((requirement, index) =>
  {
    const path = `$.capabilityRequirements[${index}]`
    const current = multimodalRecord(requirement, path, issues)
    if (!current) return
    multimodalExactKeys(
      current,
      path,
      ['specId', 'capability', 'support', 'reason'],
      [],
      issues
    )
    text(current.specId, `${path}.specId`, issues, 128)
    if (!specs.some((spec) => spec.id === current.specId))
      issue(issues, `${path}.specId`, 'invalid-value', 'unknown lens spec')
    if (current.capability !== 'renderer')
      issue(issues, `${path}.capability`, 'invalid-value', 'unknown capability')
    if (!['supported', 'unsupported'].includes(String(current.support)))
      issue(issues, `${path}.support`, 'invalid-value', 'unknown support')
    if (current.reason !== null) text(current.reason, `${path}.reason`, issues)
  })
  const requirementIds = (requirements ?? []).flatMap((entry) =>
  {
    const current = multimodalRecord(entry, '$', [])
    return current && typeof current.specId === 'string' ? [current.specId] : []
  })
  if (new Set(requirementIds).size !== requirementIds.length)
    issue(
      issues,
      '$.capabilityRequirements',
      'duplicate-id',
      'capability requirements must be unique'
    )
  const leftRuntime = left
    ? multimodalRecord(left.runtimeDescriptor, '$', [])
    : null
  const rightRuntime = right
    ? multimodalRecord(right.runtimeDescriptor, '$', [])
    : null
  const rendererSupported =
    leftRuntime !== null &&
    rightRuntime !== null &&
    leftRuntime.renderer !== 'none' &&
    rightRuntime.renderer !== 'none'
  const expectedRequirements =
    report.comparisonKind === 'runtime-runtime'
      ? specs
          .filter((spec) => spec.kind === 'visual-keyframes')
          .map((spec) => ({
            specId: spec.id,
            capability: 'renderer',
            support: rendererSupported ? 'supported' : 'unsupported',
            reason: rendererSupported
              ? null
              : 'a visual-keyframes lens requires a renderer in both lanes',
          }))
      : []
  if (
    hashMultimodalJson(report.capabilityRequirements) !==
    hashMultimodalJson(expectedRequirements)
  )
    issue(
      issues,
      '$.capabilityRequirements',
      'invalid-value',
      'capability requirements do not match the differential contract'
    )
  const requirementsBySpec = new Map(
    (requirements ?? []).flatMap((requirement) =>
    {
      const current = multimodalRecord(requirement, '$', [])
      return current && typeof current.specId === 'string'
        ? [[current.specId, current] as const]
        : []
    })
  )
  results?.forEach((result, index) =>
  {
    const spec = specs[index]
    if (!spec) return
    validateResultPolicy(
      report.comparisonKind,
      spec,
      result,
      assessment,
      requirementsBySpec.get(spec.id),
      left,
      right,
      `$.results[${index}]`,
      issues
    )
  })
  if (report.claimScope !== CLAIM_SCOPE)
    issue(issues, '$.claimScope', 'invalid-value', 'claim scope changed')
  if (issues.length === 0)
  {
    const typedResults = results as unknown as LensResultV1[]
    if (report.verdict !== aggregateLensResults(typedResults))
      issue(
        issues,
        '$.verdict',
        'invalid-value',
        'differential verdict changed'
      )
  }
  if (issues.length > 0) return { ok: false, issues }
  return {
    ok: true,
    value: detached as Readonly<DifferentialReportV1>,
  }
}
