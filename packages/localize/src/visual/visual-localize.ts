// packages/localize/src/visual/visual-localize.ts
// validate visual symptoms & rank only exact artifact-backed IR identities

import {
  ProjectIR,
  ownRecordValue,
  type DeclarationRef,
  type ListRef,
  type ScriptRef,
  type TargetRef,
  type VariableRef,
} from '@scratch-agent/ir'
import {
  canonicalMultimodalJson,
  hashMultimodalContent,
  hashMultimodalJson,
  MAX_MULTIMODAL_JSON_BYTES,
  validateVisualSymptom,
  type MultimodalEvidenceLocator,
  type VisualSymptom,
} from '@scratch-agent/eval'
import {
  DEFAULT_SB3_LIMITS,
  isBlockEntry,
  primaryInputSlot,
  type Costume,
} from '@scratch-agent/sb3'

import { buildLocalizationIndexes } from '../structural/indexes.js'
import {
  declarationKey,
  targetKey,
  type IndexedDeclaration,
  type IndexedScript,
  type LocalizationIndexes,
} from '../structural/types.js'
import {
  DEFAULT_VISUAL_LOCALIZATION_CANDIDATES,
  MAX_VISUAL_LOCALIZATION_CANDIDATES,
  MAX_VISUAL_LOCALIZATION_FRAMES,
  MAX_VISUAL_LOCALIZATION_SYMPTOMS,
  MAX_VISUAL_LOCALIZATION_TARGETS_PER_FRAME,
  VISUAL_LOCALIZATION_SCHEMA_VERSION,
  VisualSymptomLocalizationError,
  type AssetRefV1,
  type CostumeRefV1,
  type MonitorRefV1,
  type VisualLocalizationCandidateV1,
  type VisualLocalizationEvidenceFrameV1,
  type VisualLocalizationEvidenceSetV1,
  type VisualLocalizationIdentityV1,
  type VisualLocalizationReasonV1,
  type VisualLocalizationUnresolvedV1,
  type VisualSymptomLocalizationInputV1,
  type VisualSymptomLocalizationIssue,
  type VisualSymptomLocalizationReportV1,
  type VisualSymptomLocalizationV1,
  type VisualSymptomSelectionsV1,
} from './visual-types.js'

const SHA256_PATTERN = /^[0-9a-f]{64}$/
const MAX_IDENTITY_LENGTH = 256
const MAX_CANVAS_DIMENSION = 16_384
const MAX_VISUAL_LOCALIZATION_ISSUES = 128
const MAX_VISUAL_SYMPTOM_EVIDENCE = 32
const MAX_VISUAL_LOCALIZATION_ARTIFACT_BYTES =
  DEFAULT_SB3_LIMITS.maxCompressedBytes
const UINT8_ARRAY_SET = Uint8Array.prototype.set
const TYPED_ARRAY_BYTE_LENGTH = Object.getOwnPropertyDescriptor(
  Object.getPrototypeOf(Uint8Array.prototype) as object,
  'byteLength'
)!.get!

interface ValidatedBoundaryInput
{
  artifactSha256: string
  artifactBytes: Uint8Array
  symptoms: VisualSymptom[]
  evidence: VisualLocalizationEvidenceSetV1 | null
  maxCandidates: number
}

interface AdmittedLocalizationInput
{
  project: ProjectIR
  artifactSha256: string
  symptoms: VisualSymptom[]
  evidence: VisualLocalizationEvidenceSetV1 | null
  maxCandidates: number
}

interface IndexedTargetIdentity
{
  ref: TargetRef
  originalTargetId: string
}

interface MonitorDeclarationMatch
{
  declaration: DeclarationRef
  monitor: MonitorRefV1
  target: TargetRef
}

interface MutableCandidate
{
  identity: VisualLocalizationIdentityV1
  identitySha256: string
  reasons: Map<string, VisualLocalizationReasonV1>
}

interface SymptomContext
{
  input: AdmittedLocalizationInput
  symptom: VisualSymptom
  symptomSha256: string
  indexes: LocalizationIndexes
  targets: IndexedTargetIdentity[]
  evidenceFrames: readonly VisualLocalizationEvidenceFrameV1[]
  evidenceByLocator: Array<VisualLocalizationEvidenceFrameV1 | null>
  geometryTargetsByEvidence: Map<
    number,
    Map<string, { target: TargetRef; ratio: number }>
  >
  maxCandidates: number
  candidates: Map<string, MutableCandidate>
  unresolved: VisualLocalizationUnresolvedV1[]
  unresolvedKeys: Set<string>
  selected: VisualSymptomSelectionsV1
}

type AnyIndexedDeclaration =
  IndexedDeclaration<VariableRef> | IndexedDeclaration<ListRef>

function compareText(a: string, b: string): number
{
  return a < b ? -1 : a > b ? 1 : 0
}

function sameTarget(a: TargetRef, b: TargetRef): boolean
{
  return (
    a.targetIndex === b.targetIndex &&
    a.name === b.name &&
    a.isStage === b.isStage
  )
}

function intrinsicUint8ArrayByteLength(bytes: Uint8Array): number
{
  return Reflect.apply(TYPED_ARRAY_BYTE_LENGTH, bytes, []) as number
}

function copyUint8ArrayBytes(
  bytes: Uint8Array,
  byteLength: number
): Uint8Array
{
  const copy = new Uint8Array(byteLength)
  Reflect.apply(UINT8_ARRAY_SET, copy, [bytes])
  return copy
}

function deepFreeze<T>(value: T, seen = new WeakSet<object>()): Readonly<T>
{
  if (value === null || typeof value !== 'object' || seen.has(value))
    return value
  seen.add(value)
  if (Array.isArray(value))
  {
    for (const entry of value) deepFreeze(entry, seen)
  }
  else
  {
    for (const entry of Object.values(value)) deepFreeze(entry, seen)
  }
  return Object.freeze(value)
}

function issue(
  issues: VisualSymptomLocalizationIssue[],
  path: string,
  code: VisualSymptomLocalizationIssue['code'],
  message: string
): void
{
  if (issues.length >= MAX_VISUAL_LOCALIZATION_ISSUES) return
  issues.push({ path, code, message })
}

function issueLimitReached(
  issues: readonly VisualSymptomLocalizationIssue[]
): boolean
{
  return issues.length >= MAX_VISUAL_LOCALIZATION_ISSUES
}

type JsonRecord = Record<string, unknown>

function plainRecord(
  value: unknown,
  path: string,
  issues: VisualSymptomLocalizationIssue[]
): JsonRecord | null
{
  if (
    value === null ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    (Object.getPrototypeOf(value) !== Object.prototype &&
      Object.getPrototypeOf(value) !== null)
  )
  {
    issue(issues, path, 'invalid-type', 'expected a plain JSON object')
    return null
  }
  const descriptors = Object.getOwnPropertyDescriptors(value)
  for (const [key, descriptor] of Object.entries(descriptors))
  {
    if (!('value' in descriptor) || !descriptor.enumerable)
    {
      issue(
        issues,
        `${path}.${key}`,
        'invalid-type',
        'JSON object properties must be enumerable data properties'
      )
      return null
    }
  }
  if (Object.getOwnPropertySymbols(value).length > 0)
  {
    issue(
      issues,
      path,
      'unknown-key',
      'JSON objects cannot contain symbol properties'
    )
    return null
  }
  return value as JsonRecord
}

function exactKeys(
  value: JsonRecord,
  path: string,
  required: readonly string[],
  optional: readonly string[],
  issues: VisualSymptomLocalizationIssue[]
): void
{
  const allowed = new Set([...required, ...optional])
  for (const key of required)
  {
    if (!Object.hasOwn(value, key))
      issue(issues, `${path}.${key}`, 'missing-key', 'required key is missing')
  }
  for (const key of Object.keys(value))
  {
    if (!allowed.has(key))
      issue(
        issues,
        `${path}.${key}`,
        'unknown-key',
        'unknown key is not allowed'
      )
  }
}

function boundedArray(
  value: unknown,
  path: string,
  maximum: number,
  issues: VisualSymptomLocalizationIssue[]
): unknown[] | null
{
  if (
    !Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Array.prototype
  )
  {
    issue(issues, path, 'invalid-type', 'expected a plain JSON array')
    return null
  }
  if (value.length > maximum)
  {
    issue(
      issues,
      path,
      'limit-exceeded',
      `array cannot exceed ${maximum} entries`
    )
    return null
  }
  for (const key of Reflect.ownKeys(value))
  {
    if (key === 'length') continue
    if (
      typeof key !== 'string' ||
      !/^(0|[1-9]\d*)$/.test(key) ||
      Number(key) >= value.length
    )
    {
      issue(
        issues,
        path,
        'invalid-value',
        'arrays must be dense and cannot contain named properties'
      )
      return null
    }
  }
  let invalidEntry = false
  for (let index = 0; index < value.length; index++)
  {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index))
    if (!descriptor || !('value' in descriptor) || !descriptor.enumerable)
    {
      invalidEntry = true
      issue(
        issues,
        `${path}[${index}]`,
        'invalid-type',
        'array entries must be enumerable data properties'
      )
    }
  }
  if (invalidEntry) return null
  return value
}

function strictVisualSymptomShape(
  value: unknown,
  path: string,
  issues: VisualSymptomLocalizationIssue[]
): boolean
{
  const start = issues.length
  const record = plainRecord(value, path, issues)
  if (!record) return false
  exactKeys(
    record,
    path,
    ['id', 'kind', 'subject', 'assetName', 'description', 'evidence'],
    [],
    issues
  )
  const subjectPath = `${path}.subject`
  const subject = plainRecord(record.subject, subjectPath, issues)
  if (subject)
  {
    const required =
      subject.kind === 'sprite'
        ? ['kind', 'name']
        : subject.kind === 'monitor'
          ? ['kind', 'targetName', 'declarationName']
          : ['kind']
    exactKeys(subject, subjectPath, required, [], issues)
  }
  const evidencePath = `${path}.evidence`
  const evidence = boundedArray(
    record.evidence,
    evidencePath,
    MAX_VISUAL_SYMPTOM_EVIDENCE,
    issues
  )
  if (evidence)
  {
    for (let index = 0; index < evidence.length; index++)
    {
      if (issueLimitReached(issues)) break
      const locatorPath = `${evidencePath}[${index}]`
      const locator = plainRecord(evidence[index], locatorPath, issues)
      if (!locator) continue
      exactKeys(
        locator,
        locatorPath,
        ['evidenceId', 'frameId', 'tick', 'region'],
        [],
        issues
      )
      if (locator.region === null) continue
      const regionPath = `${locatorPath}.region`
      const region = plainRecord(locator.region, regionPath, issues)
      if (region)
        exactKeys(region, regionPath, ['x', 'y', 'width', 'height'], [], issues)
    }
  }
  return issues.length === start
}

function boundedString(
  value: unknown,
  path: string,
  issues: VisualSymptomLocalizationIssue[],
  minimum = 1,
  maximum = MAX_IDENTITY_LENGTH
): string | null
{
  if (
    typeof value !== 'string' ||
    value.length < minimum ||
    value.length > maximum
  )
  {
    issue(
      issues,
      path,
      typeof value === 'string' ? 'limit-exceeded' : 'invalid-type',
      `expected a string containing ${minimum}..${maximum} characters`
    )
    return null
  }
  return value
}

function booleanValue(
  value: unknown,
  path: string,
  issues: VisualSymptomLocalizationIssue[]
): boolean | null
{
  if (typeof value !== 'boolean')
  {
    issue(issues, path, 'invalid-type', 'expected a boolean')
    return null
  }
  return value
}

function safeInteger(
  value: unknown,
  path: string,
  issues: VisualSymptomLocalizationIssue[],
  minimum: number,
  maximum = Number.MAX_SAFE_INTEGER
): number | null
{
  if (
    !Number.isSafeInteger(value) ||
    (value as number) < minimum ||
    (value as number) > maximum
  )
  {
    issue(
      issues,
      path,
      'invalid-value',
      `expected a safe integer within ${minimum}..${maximum}`
    )
    return null
  }
  return value as number
}

function finiteNumber(
  value: unknown,
  path: string,
  issues: VisualSymptomLocalizationIssue[],
  minimum?: number
): number | null
{
  if (
    typeof value !== 'number' ||
    !Number.isFinite(value) ||
    (minimum !== undefined && value < minimum)
  )
  {
    issue(
      issues,
      path,
      'invalid-value',
      minimum === undefined
        ? 'expected a finite number'
        : `expected a finite number greater than or equal to ${minimum}`
    )
    return null
  }
  return Object.is(value, -0) ? 0 : value
}

type GeometryRect = NonNullable<
  VisualLocalizationEvidenceFrameV1['geometry']['targets'][number]['rect']
>

function validatedRect(
  value: unknown,
  path: string,
  issues: VisualSymptomLocalizationIssue[]
): GeometryRect | null | undefined
{
  if (value === null) return null
  const start = issues.length
  const record = plainRecord(value, path, issues)
  if (!record) return undefined
  exactKeys(record, path, ['x', 'y', 'width', 'height'], [], issues)
  const x = finiteNumber(record.x, `${path}.x`, issues)
  const y = finiteNumber(record.y, `${path}.y`, issues)
  const width = finiteNumber(record.width, `${path}.width`, issues, 0)
  const height = finiteNumber(record.height, `${path}.height`, issues, 0)
  if (
    issues.length !== start ||
    x === null ||
    y === null ||
    width === null ||
    height === null
  )
    return undefined
  return { x, y, width, height }
}

type GeometryTarget =
  VisualLocalizationEvidenceFrameV1['geometry']['targets'][number]

function validatedGeometryTarget(
  value: unknown,
  path: string,
  issues: VisualSymptomLocalizationIssue[]
): GeometryTarget | null
{
  if (issueLimitReached(issues)) return null
  const start = issues.length
  const record = plainRecord(value, path, issues)
  if (!record) return null
  exactKeys(
    record,
    path,
    [
      'originalTargetId',
      'name',
      'isStage',
      'instance',
      'instanceIndex',
      'visible',
      'costumeIndex',
      'costumeName',
      'rect',
    ],
    [],
    issues
  )
  const originalTargetId = boundedString(
    record.originalTargetId,
    `${path}.originalTargetId`,
    issues
  )
  const name = boundedString(record.name, `${path}.name`, issues)
  const isStage = booleanValue(record.isStage, `${path}.isStage`, issues)
  const instance =
    record.instance === 'original' || record.instance === 'clone'
      ? record.instance
      : null
  if (instance === null)
    issue(
      issues,
      `${path}.instance`,
      'invalid-value',
      'instance must be original or clone'
    )
  const instanceIndex = safeInteger(
    record.instanceIndex,
    `${path}.instanceIndex`,
    issues,
    0
  )
  const visible = booleanValue(record.visible, `${path}.visible`, issues)
  const costumeIndex = safeInteger(
    record.costumeIndex,
    `${path}.costumeIndex`,
    issues,
    0
  )
  const costumeName = boundedString(
    record.costumeName,
    `${path}.costumeName`,
    issues,
    0
  )
  const rect = validatedRect(record.rect, `${path}.rect`, issues)
  if (instance === 'original' && instanceIndex !== null && instanceIndex !== 0)
    issue(
      issues,
      `${path}.instanceIndex`,
      'invalid-value',
      'original targets must use instance index 0'
    )
  if (instance === 'clone' && instanceIndex !== null && instanceIndex < 1)
    issue(
      issues,
      `${path}.instanceIndex`,
      'invalid-value',
      'clone targets must use a positive instance index'
    )
  if (isStage === true && instance !== null && instance !== 'original')
    issue(
      issues,
      `${path}.instance`,
      'invalid-value',
      'the Stage cannot be a clone'
    )
  if (
    isStage === true &&
    originalTargetId !== null &&
    originalTargetId !== 'stage'
  )
    issue(
      issues,
      `${path}.originalTargetId`,
      'invalid-value',
      'the Stage must use the stable original target ID stage'
    )
  if (
    issues.length !== start ||
    originalTargetId === null ||
    name === null ||
    isStage === null ||
    instance === null ||
    instanceIndex === null ||
    visible === null ||
    costumeIndex === null ||
    costumeName === null ||
    rect === undefined
  )
    return null
  return {
    originalTargetId,
    name,
    isStage,
    instance,
    instanceIndex,
    visible,
    costumeIndex,
    costumeName,
    rect,
  }
}

function validatedGeometry(
  value: unknown,
  path: string,
  issues: VisualSymptomLocalizationIssue[]
): VisualLocalizationEvidenceFrameV1['geometry'] | null
{
  const start = issues.length
  const record = plainRecord(value, path, issues)
  if (!record) return null
  exactKeys(record, path, ['canvas', 'targets'], [], issues)
  const canvasRecord = plainRecord(record.canvas, `${path}.canvas`, issues)
  let width: number | null = null
  let height: number | null = null
  if (canvasRecord)
  {
    exactKeys(canvasRecord, `${path}.canvas`, ['width', 'height'], [], issues)
    width = safeInteger(
      canvasRecord.width,
      `${path}.canvas.width`,
      issues,
      1,
      MAX_CANVAS_DIMENSION
    )
    height = safeInteger(
      canvasRecord.height,
      `${path}.canvas.height`,
      issues,
      1,
      MAX_CANVAS_DIMENSION
    )
  }
  const targetValues = boundedArray(
    record.targets,
    `${path}.targets`,
    MAX_VISUAL_LOCALIZATION_TARGETS_PER_FRAME,
    issues
  )
  const targets: GeometryTarget[] = []
  const identities = new Set<string>()
  if (targetValues)
  {
    for (let index = 0; index < targetValues.length; index++)
    {
      if (issueLimitReached(issues)) break
      const target = validatedGeometryTarget(
        targetValues[index],
        `${path}.targets[${index}]`,
        issues
      )
      if (!target) continue
      const identity = JSON.stringify([
        target.originalTargetId,
        target.instance,
        target.instanceIndex,
      ])
      if (identities.has(identity))
        issue(
          issues,
          `${path}.targets[${index}]`,
          'duplicate-id',
          'renderer target instance identity is duplicated'
        )
      else
      {
        identities.add(identity)
        targets.push(target)
      }
    }
  }
  if (
    issues.length !== start ||
    width === null ||
    height === null ||
    !targetValues ||
    targets.length !== targetValues.length
  )
    return null
  return { canvas: { width, height }, targets }
}

function validatedEvidenceFrame(
  value: unknown,
  index: number,
  issues: VisualSymptomLocalizationIssue[]
): VisualLocalizationEvidenceFrameV1 | null
{
  const path = `$.evidence.frames[${index}]`
  const start = issues.length
  const record = plainRecord(value, path, issues)
  if (!record) return null
  exactKeys(
    record,
    path,
    ['evidenceId', 'frameId', 'tick', 'geometry'],
    [],
    issues
  )
  const evidenceId = boundedString(
    record.evidenceId,
    `${path}.evidenceId`,
    issues
  )
  const frameId = boundedString(record.frameId, `${path}.frameId`, issues)
  const tick = safeInteger(record.tick, `${path}.tick`, issues, 0)
  const geometry = validatedGeometry(
    record.geometry,
    `${path}.geometry`,
    issues
  )
  if (
    issues.length !== start ||
    evidenceId === null ||
    frameId === null ||
    tick === null ||
    geometry === null
  )
    return null
  return { evidenceId, frameId, tick, geometry }
}

function validatedEvidence(
  value: unknown,
  artifactSha256: string | null,
  issues: VisualSymptomLocalizationIssue[]
): VisualLocalizationEvidenceSetV1 | null
{
  if (value === null) return null
  const start = issues.length
  const record = plainRecord(value, '$.evidence', issues)
  if (!record) return null
  exactKeys(
    record,
    '$.evidence',
    ['schemaVersion', 'artifactSha256', 'frames'],
    [],
    issues
  )
  if (record.schemaVersion !== VISUAL_LOCALIZATION_SCHEMA_VERSION)
    issue(
      issues,
      '$.evidence.schemaVersion',
      'invalid-value',
      'evidence schema version must be 1'
    )
  const evidenceArtifact =
    typeof record.artifactSha256 === 'string' &&
    SHA256_PATTERN.test(record.artifactSha256)
      ? record.artifactSha256
      : null
  if (evidenceArtifact === null)
    issue(
      issues,
      '$.evidence.artifactSha256',
      'invalid-value',
      'evidence artifact hash must be a lowercase SHA-256 digest'
    )
  else if (artifactSha256 !== null && evidenceArtifact !== artifactSha256)
    issue(
      issues,
      '$.evidence.artifactSha256',
      'invalid-value',
      'evidence must bind the exact localization artifact'
    )
  const frameValues = boundedArray(
    record.frames,
    '$.evidence.frames',
    MAX_VISUAL_LOCALIZATION_FRAMES,
    issues
  )
  const frames: VisualLocalizationEvidenceFrameV1[] = []
  const frameIdentities = new Set<string>()
  if (frameValues)
  {
    for (let index = 0; index < frameValues.length; index++)
    {
      if (issueLimitReached(issues)) break
      const frame = validatedEvidenceFrame(frameValues[index], index, issues)
      if (!frame) continue
      const identity = JSON.stringify([
        frame.evidenceId,
        frame.frameId,
        frame.tick,
      ])
      if (frameIdentities.has(identity))
        issue(
          issues,
          `$.evidence.frames[${index}]`,
          'duplicate-id',
          'evidence frame identity is duplicated'
        )
      else
      {
        frameIdentities.add(identity)
        frames.push(frame)
      }
    }
  }
  if (
    issues.length !== start ||
    evidenceArtifact === null ||
    !frameValues ||
    frames.length !== frameValues.length
  )
    return null
  const evidence: VisualLocalizationEvidenceSetV1 = {
    schemaVersion: VISUAL_LOCALIZATION_SCHEMA_VERSION,
    artifactSha256: evidenceArtifact,
    frames,
  }
  try
  {
    canonicalMultimodalJson(evidence)
  }
  catch
  {
    issue(
      issues,
      '$.evidence',
      'limit-exceeded',
      `evidence must fit within ${MAX_MULTIMODAL_JSON_BYTES} canonical JSON bytes`
    )
    return null
  }
  return deepFreeze(evidence) as VisualLocalizationEvidenceSetV1
}

function multimodalIssueCode(
  code: string
): VisualSymptomLocalizationIssue['code']
{
  if (
    code === 'invalid-type' ||
    code === 'invalid-value' ||
    code === 'missing-key' ||
    code === 'unknown-key' ||
    code === 'limit-exceeded' ||
    code === 'duplicate-id'
  )
    return code
  return 'invalid-value'
}

function validatedInput(input: unknown): ValidatedBoundaryInput
{
  const issues: VisualSymptomLocalizationIssue[] = []
  const record = plainRecord(input, '$', issues)
  if (!record) throw new VisualSymptomLocalizationError(issues)
  exactKeys(
    record,
    '$',
    [
      'schemaVersion',
      'artifactSha256',
      'artifactBytes',
      'symptoms',
      'evidence',
    ],
    ['maxCandidatesPerSymptom'],
    issues
  )
  if (record.schemaVersion !== VISUAL_LOCALIZATION_SCHEMA_VERSION)
    issue(
      issues,
      '$.schemaVersion',
      'invalid-value',
      'visual localization schema version must be 1'
    )
  const artifactSha256 =
    typeof record.artifactSha256 === 'string' &&
    SHA256_PATTERN.test(record.artifactSha256)
      ? record.artifactSha256
      : null
  if (artifactSha256 === null)
    issue(
      issues,
      '$.artifactSha256',
      'invalid-value',
      'artifact hash must be a lowercase SHA-256 digest'
    )
  let artifactBytes: Uint8Array | null = null
  if (!(record.artifactBytes instanceof Uint8Array))
    issue(
      issues,
      '$.artifactBytes',
      'invalid-type',
      'artifact bytes must be a Uint8Array'
    )
  else
  {
    let byteLength: number | null = null
    try
    {
      byteLength = intrinsicUint8ArrayByteLength(record.artifactBytes)
    }
    catch
    {
      issue(
        issues,
        '$.artifactBytes',
        'invalid-type',
        'artifact bytes must have a readable Uint8Array backing store'
      )
    }
    if (
      byteLength !== null &&
      (byteLength <= 0 || byteLength > MAX_VISUAL_LOCALIZATION_ARTIFACT_BYTES)
    )
      issue(
        issues,
        '$.artifactBytes',
        'limit-exceeded',
        `artifact bytes must contain 1..${MAX_VISUAL_LOCALIZATION_ARTIFACT_BYTES} bytes`
      )
    else if (byteLength !== null)
    {
      try
      {
        artifactBytes = copyUint8ArrayBytes(record.artifactBytes, byteLength)
      }
      catch
      {
        issue(
          issues,
          '$.artifactBytes',
          'invalid-value',
          'artifact bytes could not be copied from the supplied backing store'
        )
      }
      if (
        artifactBytes !== null &&
        artifactSha256 !== null &&
        hashMultimodalContent(artifactBytes) !== artifactSha256
      )
        issue(
          issues,
          '$.artifactSha256',
          'invalid-value',
          'artifact hash does not match the exact supplied bytes'
        )
    }
  }
  const symptomValues = boundedArray(
    record.symptoms,
    '$.symptoms',
    MAX_VISUAL_LOCALIZATION_SYMPTOMS,
    issues
  )
  const symptoms: VisualSymptom[] = []
  const symptomIds = new Set<string>()
  if (symptomValues)
  {
    for (let index = 0; index < symptomValues.length; index++)
    {
      if (issueLimitReached(issues)) break
      if (
        !strictVisualSymptomShape(
          symptomValues[index],
          `$.symptoms[${index}]`,
          issues
        )
      )
        continue
      const result = validateVisualSymptom(symptomValues[index])
      if (!result.ok)
      {
        for (const current of result.issues)
        {
          issue(
            issues,
            `$.symptoms[${index}]${
              current.path === '$' ? '' : current.path.slice(1)
            }`,
            multimodalIssueCode(current.code),
            current.message
          )
          if (issueLimitReached(issues)) break
        }
        continue
      }
      const symptom = result.value as VisualSymptom
      if (symptomIds.has(symptom.id))
        issue(
          issues,
          `$.symptoms[${index}].id`,
          'duplicate-id',
          'symptom ID is duplicated'
        )
      else
      {
        symptomIds.add(symptom.id)
        symptoms.push(symptom)
      }
    }
  }
  const requestedLimit = Object.hasOwn(record, 'maxCandidatesPerSymptom')
    ? safeInteger(
        record.maxCandidatesPerSymptom,
        '$.maxCandidatesPerSymptom',
        issues,
        1,
        MAX_VISUAL_LOCALIZATION_CANDIDATES
      )
    : DEFAULT_VISUAL_LOCALIZATION_CANDIDATES
  const evidence = validatedEvidence(record.evidence, artifactSha256, issues)
  if (
    issues.length > 0 ||
    artifactSha256 === null ||
    artifactBytes === null ||
    !symptomValues ||
    symptoms.length !== symptomValues.length ||
    requestedLimit === null
  )
    throw new VisualSymptomLocalizationError(issues)
  return {
    artifactSha256,
    artifactBytes,
    symptoms,
    evidence,
    maxCandidates: requestedLimit,
  }
}

async function admitLocalizationInput(
  input: ValidatedBoundaryInput
): Promise<AdmittedLocalizationInput>
{
  let project: ProjectIR
  try
  {
    project = await ProjectIR.fromSb3(input.artifactBytes)
  }
  catch (error)
  {
    const message = error instanceof Error ? error.message : String(error)
    throw new VisualSymptomLocalizationError([
      {
        path: '$.artifactBytes',
        code: 'invalid-value',
        message: `artifact admission failed: ${message.slice(0, 512)}`,
      },
    ])
  }
  return {
    project,
    artifactSha256: input.artifactSha256,
    symptoms: input.symptoms,
    evidence: input.evidence,
    maxCandidates: input.maxCandidates,
  }
}

function indexedTargetIdentities(
  targets: readonly TargetRef[]
): IndexedTargetIdentity[]
{
  let spriteOrdinal = 0
  return targets.map((ref) => ({
    ref,
    originalTargetId: ref.isStage
      ? 'stage'
      : `sprite-${++spriteOrdinal}-${ref.name}`,
  }))
}

function evidenceHash(input: AdmittedLocalizationInput): string | null
{
  if (input.evidence === null) return null
  return hashMultimodalJson({
    schemaVersion: input.evidence.schemaVersion,
    artifactSha256: input.evidence.artifactSha256,
    frames: input.evidence.frames.map((frame) => ({
      evidenceId: frame.evidenceId,
      frameId: frame.frameId,
      tick: frame.tick,
      geometrySha256: hashMultimodalJson(frame.geometry),
    })),
  })
}

function reasonKey(reason: VisualLocalizationReasonV1): string
{
  return hashMultimodalJson(reason)
}

function addCandidate(
  context: SymptomContext,
  identity: VisualLocalizationIdentityV1,
  reason: VisualLocalizationReasonV1
): string
{
  const identitySha256 = hashMultimodalJson(identity)
  let candidate = context.candidates.get(identitySha256)
  if (!candidate)
  {
    candidate = {
      identity,
      identitySha256,
      reasons: new Map(),
    }
    context.candidates.set(identitySha256, candidate)
  }
  candidate.reasons.set(reasonKey(reason), reason)
  return identitySha256
}

function addUnresolved(
  context: SymptomContext,
  unresolved: VisualLocalizationUnresolvedV1
): void
{
  const key = hashMultimodalJson(unresolved)
  if (context.unresolvedKeys.has(key)) return
  context.unresolvedKeys.add(key)
  context.unresolved.push(unresolved)
}

function exactSubjectTargets(context: SymptomContext): TargetRef[]
{
  const subject = context.symptom.subject
  if (subject.kind === 'sprite')
    return context.targets
      .filter(
        (target) => !target.ref.isStage && target.ref.name === subject.name
      )
      .map((target) => target.ref)
  if (subject.kind === 'stage')
    return context.targets
      .filter((target) => target.ref.isStage)
      .map((target) => target.ref)
  return []
}

function selectSubjectTarget(context: SymptomContext): void
{
  const subject = context.symptom.subject
  if (subject.kind !== 'sprite' && subject.kind !== 'stage') return
  const matches = exactSubjectTargets(context)
  const candidateHashes = matches.map((target) =>
    addCandidate(
      context,
      { kind: 'target', target },
      {
        code: 'exact-subject-target',
        score: 100,
        detail:
          subject.kind === 'stage'
            ? 'subject exactly names the admitted Stage target'
            : `subject exactly names admitted sprite ${subject.name}`,
        evidenceIndexes: [],
      }
    )
  )
  if (matches.length === 1)
  {
    context.selected.target = matches[0]!
    return
  }
  const stage = subject.kind === 'stage'
  addUnresolved(context, {
    code: stage
      ? 'stage-not-unique'
      : matches.length === 0
        ? 'target-hint-not-found'
        : 'target-hint-ambiguous',
    detail: stage
      ? `expected exactly one admitted Stage target, found ${matches.length}`
      : matches.length === 0
        ? `sprite hint ${subject.name} names no admitted target`
        : `sprite hint ${subject.name} names ${matches.length} admitted targets`,
    blocking: true,
    evidenceIndexes: [],
    candidateIdentitySha256s: candidateHashes,
  })
}

function declarationMatchesForMonitor(
  context: SymptomContext,
  target: TargetRef,
  monitorId: string,
  kind: 'variable' | 'list'
): AnyIndexedDeclaration[]
{
  const all =
    kind === 'variable' ? context.indexes.variables : context.indexes.lists
  const local = all.filter(
    (entry) =>
      sameTarget(entry.declaration.declarationTarget, target) &&
      entry.declaration.id === monitorId
  ) as AnyIndexedDeclaration[]
  if (local.length > 0 || target.isStage) return local
  return all.filter(
    (entry) =>
      entry.declaration.declarationTarget.isStage &&
      entry.declaration.id === monitorId
  ) as AnyIndexedDeclaration[]
}

function monitorOwnerTargets(context: SymptomContext): TargetRef[]
{
  const subject = context.symptom.subject
  if (subject.kind !== 'monitor') return []
  if (subject.targetName === null)
    return context.targets
      .filter((target) => target.ref.isStage)
      .map((target) => target.ref)
  return context.targets
    .filter(
      (target) => !target.ref.isStage && target.ref.name === subject.targetName
    )
    .map((target) => target.ref)
}

function monitorMatches(
  context: SymptomContext,
  owner: TargetRef
): MonitorDeclarationMatch[]
{
  const subject = context.symptom.subject
  if (subject.kind !== 'monitor') return []
  const expectedSpriteName = subject.targetName
  const matches: MonitorDeclarationMatch[] = []
  for (
    let monitorIndex = 0;
    monitorIndex < (context.input.project.json.monitors?.length ?? 0);
    monitorIndex++
  )
  {
    const monitor = context.input.project.json.monitors![monitorIndex]!
    if (monitor.spriteName !== expectedSpriteName) continue
    const kind =
      monitor.opcode === 'data_variable'
        ? 'variable'
        : monitor.opcode === 'data_listcontents'
          ? 'list'
          : null
    if (kind === null) continue
    const declarations = declarationMatchesForMonitor(
      context,
      owner,
      monitor.id,
      kind
    ).filter((entry) => entry.declaration.name === subject.declarationName)
    for (const declaration of declarations)
    {
      matches.push({
        declaration: declaration.declaration,
        monitor: {
          monitorIndex,
          id: monitor.id,
          opcode: monitor.opcode,
          spriteName: monitor.spriteName,
        },
        target: owner,
      })
    }
  }
  return matches
}

function selectMonitor(context: SymptomContext): void
{
  const subject = context.symptom.subject
  if (subject.kind !== 'monitor') return
  const owners = monitorOwnerTargets(context)
  const ownerHashes = owners.map((target) =>
    addCandidate(
      context,
      { kind: 'target', target },
      {
        code: 'exact-subject-target',
        score: 100,
        detail:
          subject.targetName === null
            ? 'monitor owner resolves to the admitted Stage target'
            : `monitor owner exactly names admitted sprite ${subject.targetName}`,
        evidenceIndexes: [],
      }
    )
  )
  if (owners.length !== 1)
  {
    addUnresolved(context, {
      code:
        owners.length === 0
          ? 'monitor-owner-not-found'
          : 'monitor-owner-ambiguous',
      detail:
        owners.length === 0
          ? 'monitor owner does not resolve to an admitted target'
          : `monitor owner resolves to ${owners.length} admitted targets`,
      blocking: true,
      evidenceIndexes: [],
      candidateIdentitySha256s: ownerHashes,
    })
    return
  }
  const owner = owners[0]!
  context.selected.target = owner
  const matches = monitorMatches(context, owner)
  const declarationHashes = matches.map((match) =>
    addCandidate(
      context,
      {
        kind: 'declaration',
        declaration: match.declaration,
        monitor: match.monitor,
      },
      {
        code: 'exact-monitor-declaration',
        score: 110,
        detail: `monitor ${match.monitor.id} exactly binds declaration ${match.declaration.name}`,
        evidenceIndexes: [],
      }
    )
  )
  if (matches.length === 1)
  {
    context.selected.declaration = {
      declaration: matches[0]!.declaration,
      monitor: matches[0]!.monitor,
    }
    return
  }
  const ownerMonitors = (context.input.project.json.monitors ?? []).filter(
    (monitor) => monitor.spriteName === subject.targetName
  )
  const matchingNames = ownerMonitors.filter((monitor) =>
  {
    const kind =
      monitor.opcode === 'data_variable'
        ? 'variable'
        : monitor.opcode === 'data_listcontents'
          ? 'list'
          : null
    return (
      kind !== null &&
      declarationMatchesForMonitor(context, owner, monitor.id, kind).some(
        (entry) => entry.declaration.name === subject.declarationName
      )
    )
  })
  addUnresolved(context, {
    code:
      matches.length > 1
        ? 'monitor-record-ambiguous'
        : ownerMonitors.length === 0
          ? 'monitor-record-not-found'
          : matchingNames.length === 0
            ? 'monitor-declaration-not-found'
            : 'monitor-declaration-ambiguous',
    detail:
      matches.length > 1
        ? `monitor hint resolves to ${matches.length} actual monitor/declaration pairs`
        : ownerMonitors.length === 0
          ? 'monitor hint resolves to no actual monitor record'
          : `monitor hint does not uniquely bind declaration ${subject.declarationName}`,
    blocking: true,
    evidenceIndexes: [],
    candidateIdentitySha256s: declarationHashes,
  })
}

function costumeRef(
  target: TargetRef,
  costume: Costume,
  costumeIndex: number
): CostumeRefV1
{
  return {
    target,
    costumeIndex,
    name: costume.name,
    assetId: costume.assetId,
    dataFormat: costume.dataFormat,
    md5ext: costume.md5ext ?? null,
    assetPath: costume.md5ext ?? `${costume.assetId}.${costume.dataFormat}`,
  }
}

function costumeMatches(context: SymptomContext): CostumeRefV1[]
{
  const assetName = context.symptom.assetName
  if (assetName === null) return []
  let targets: TargetRef[]
  if (context.selected.target) targets = [context.selected.target]
  else if (context.symptom.subject.kind === 'unknown')
    targets = context.targets.map((target) => target.ref)
  else return []
  const matches: CostumeRefV1[] = []
  for (const target of targets)
  {
    const raw = context.input.project.json.targets[target.targetIndex]
    if (!raw || raw.name !== target.name || raw.isStage !== target.isStage)
      continue
    raw.costumes.forEach((costume, costumeIndex) =>
    {
      if (costume.name === assetName)
        matches.push(costumeRef(target, costume, costumeIndex))
    })
  }
  return matches
}

function assetRefsForCostume(
  context: SymptomContext,
  costume: CostumeRefV1
): AssetRefV1[]
{
  const matches: AssetRefV1[] = []
  context.input.project.assets.forEach((asset, assetIndex) =>
  {
    if (asset.path !== costume.assetPath) return
    matches.push({
      assetIndex,
      path: asset.path,
      byteLength: asset.bytes.byteLength,
      sha256: hashMultimodalContent(asset.bytes),
    })
  })
  return matches
}

function selectCombinedUnknownTarget(context: SymptomContext): void
{
  if (context.symptom.subject.kind !== 'unknown') return
  const constraints: Map<string, TargetRef>[] = []
  if (context.symptom.assetName !== null)
  {
    constraints.push(
      new Map(
        costumeMatches(context).map((costume) => [
          targetKey(costume.target),
          costume.target,
        ])
      )
    )
  }
  context.symptom.evidence.forEach((locator, evidenceIndex) =>
  {
    if (locator.region === null) return
    const frame = context.evidenceByLocator[evidenceIndex] ?? null
    if (!frame)
    {
      constraints.push(new Map())
      return
    }
    const overlaps = geometryTargets(context, frame, locator, evidenceIndex)
    const nonStage = [...overlaps.entries()].filter(
      ([, current]) => !current.target.isStage
    )
    constraints.push(
      new Map(
        (nonStage.length > 0 ? nonStage : [...overlaps.entries()]).map(
          ([key, current]) => [key, current.target]
        )
      )
    )
  })
  if (constraints.length === 0) return
  const [first, ...remaining] = constraints
  const candidates = new Map(first)
  for (const key of candidates.keys())
  {
    if (remaining.some((constraint) => !constraint.has(key)))
      candidates.delete(key)
  }
  if (candidates.size === 1)
    context.selected.target = candidates.values().next().value ?? null
}

function selectAsset(context: SymptomContext): void
{
  const assetName = context.symptom.assetName
  if (assetName === null) return
  const costumes = costumeMatches(context)
  const costumeHashes = costumes.map((costume) =>
    addCandidate(
      context,
      { kind: 'costume', costume },
      {
        code: 'exact-asset-name',
        score: 95,
        detail: `asset hint exactly names admitted costume ${assetName}`,
        evidenceIndexes: [],
      }
    )
  )
  if (costumes.length !== 1)
  {
    addUnresolved(context, {
      code:
        costumes.length === 0 ? 'asset-hint-not-found' : 'asset-hint-ambiguous',
      detail:
        costumes.length === 0
          ? `asset hint ${assetName} names no costume in the resolved target scope`
          : `asset hint ${assetName} names ${costumes.length} costumes in the resolved target scope`,
      blocking: true,
      evidenceIndexes: [],
      candidateIdentitySha256s: costumeHashes,
    })
    return
  }
  const costume = costumes[0]!
  context.selected.costume = costume
  if (context.symptom.subject.kind === 'unknown')
  {
    context.selected.target = costume.target
    addCandidate(
      context,
      { kind: 'target', target: costume.target },
      {
        code: 'exact-asset-name',
        score: 90,
        detail: `unique costume ${assetName} owns this admitted target`,
        evidenceIndexes: [],
      }
    )
  }
  const assets = assetRefsForCostume(context, costume)
  const assetHashes = assets.map((asset) =>
    addCandidate(
      context,
      { kind: 'asset', asset },
      {
        code: 'exact-costume-asset',
        score: 90,
        detail: `costume ${assetName} exactly references admitted asset ${asset.path}`,
        evidenceIndexes: [],
      }
    )
  )
  if (assets.length === 1)
  {
    context.selected.asset = assets[0]!
    return
  }
  addUnresolved(context, {
    code: assets.length === 0 ? 'asset-file-not-found' : 'asset-file-ambiguous',
    detail:
      assets.length === 0
        ? `costume ${assetName} references no admitted asset at ${costume.assetPath}`
        : `costume ${assetName} references ${assets.length} admitted assets at ${costume.assetPath}`,
    blocking: true,
    evidenceIndexes: [],
    candidateIdentitySha256s: assetHashes,
  })
}

function evidenceFrameMatches(
  context: SymptomContext,
  locator: MultimodalEvidenceLocator
): readonly VisualLocalizationEvidenceFrameV1[]
{
  return context.evidenceFrames.filter(
    (frame) =>
      frame.evidenceId === locator.evidenceId &&
      frame.frameId === locator.frameId &&
      frame.tick === locator.tick
  )
}

function bindSymptomEvidence(context: SymptomContext): void
{
  if (context.input.evidence === null)
  {
    context.evidenceByLocator = context.symptom.evidence.map(() => null)
    addUnresolved(context, {
      code: 'evidence-unavailable',
      detail: 'symptom evidence has no admitted renderer frame set',
      blocking: true,
      evidenceIndexes: context.symptom.evidence.map((_, index) => index),
      candidateIdentitySha256s: [],
    })
    return
  }
  context.evidenceByLocator = context.symptom.evidence.map((locator, index) =>
  {
    const frames = evidenceFrameMatches(context, locator)
    if (frames.length === 1) return frames[0]!
    addUnresolved(context, {
      code:
        frames.length === 0
          ? 'evidence-locator-not-found'
          : 'evidence-locator-ambiguous',
      detail:
        frames.length === 0
          ? `evidence ${locator.evidenceId}/${locator.frameId}@${locator.tick} was not admitted`
          : `evidence ${locator.evidenceId}/${locator.frameId}@${locator.tick} is ambiguous`,
      blocking: true,
      evidenceIndexes: [index],
      candidateIdentitySha256s: [],
    })
    return null
  })
}

function overlapRatio(
  region: NonNullable<MultimodalEvidenceLocator['region']>,
  rect: { x: number; y: number; width: number; height: number },
  canvas: { width: number; height: number }
): number
{
  if (rect.width <= 0 || rect.height <= 0) return 0
  const left = Math.max(region.x, rect.x / canvas.width)
  const top = Math.max(region.y, rect.y / canvas.height)
  const right = Math.min(
    region.x + region.width,
    (rect.x + rect.width) / canvas.width
  )
  const bottom = Math.min(
    region.y + region.height,
    (rect.y + rect.height) / canvas.height
  )
  if (right <= left || bottom <= top) return 0
  const intersection = (right - left) * (bottom - top)
  return Math.min(1, intersection / (region.width * region.height))
}

function geometryTargets(
  context: SymptomContext,
  frame: VisualLocalizationEvidenceFrameV1,
  locator: MultimodalEvidenceLocator,
  evidenceIndex: number
): Map<string, { target: TargetRef; ratio: number }>
{
  const cached = context.geometryTargetsByEvidence.get(evidenceIndex)
  if (cached) return cached
  const region = locator.region
  const results = new Map<string, { target: TargetRef; ratio: number }>()
  if (region === null)
  {
    context.geometryTargetsByEvidence.set(evidenceIndex, results)
    return results
  }
  for (const geometry of frame.geometry.targets)
  {
    if (!geometry.visible || geometry.rect === null) continue
    const admittedMatches = context.targets.filter(
      (target) =>
        target.originalTargetId === geometry.originalTargetId &&
        target.ref.name === geometry.name &&
        target.ref.isStage === geometry.isStage
    )
    if (admittedMatches.length !== 1) continue
    const admitted = admittedMatches[0]!
    const ratio = overlapRatio(region, geometry.rect, frame.geometry.canvas)
    if (ratio <= 0) continue
    const key = targetKey(admitted.ref)
    const existing = results.get(key)
    if (!existing || ratio > existing.ratio)
      results.set(key, { target: admitted.ref, ratio })
  }
  for (const current of results.values())
  {
    addCandidate(
      context,
      { kind: 'target', target: current.target },
      {
        code: 'region-overlap',
        score: 50 + Math.floor(current.ratio * 30),
        detail: `normalized region overlaps renderer geometry for ${current.target.name}`,
        evidenceIndexes: [evidenceIndex],
      }
    )
  }
  context.geometryTargetsByEvidence.set(evidenceIndex, results)
  return results
}

function selectRegionTarget(context: SymptomContext): void
{
  if (context.symptom.subject.kind === 'monitor') return
  const regionIndexes = context.symptom.evidence.flatMap((locator, index) =>
    locator.region === null ? [] : [index]
  )
  if (regionIndexes.length === 0) return
  const byTarget = new Map<
    string,
    { target: TargetRef; evidence: Set<number> }
  >()
  const unknownRegionCandidates: TargetRef[][] = []
  let everyRegionBound = true
  for (const evidenceIndex of regionIndexes)
  {
    const locator = context.symptom.evidence[evidenceIndex]!
    const frame = context.evidenceByLocator[evidenceIndex] ?? null
    if (!frame)
    {
      everyRegionBound = false
      continue
    }
    const overlaps = geometryTargets(context, frame, locator, evidenceIndex)
    for (const [key, current] of overlaps)
    {
      const aggregate = byTarget.get(key) ?? {
        target: current.target,
        evidence: new Set<number>(),
      }
      aggregate.evidence.add(evidenceIndex)
      byTarget.set(key, aggregate)
    }
    if (context.symptom.subject.kind === 'unknown')
    {
      const current = [...overlaps.values()].map((entry) => entry.target)
      const nonStage = current.filter((target) => !target.isStage)
      unknownRegionCandidates.push(nonStage.length > 0 ? nonStage : current)
    }
    if (context.selected.target)
    {
      const selectedOverlap = overlaps.get(targetKey(context.selected.target))
      if (!selectedOverlap)
        addUnresolved(context, {
          code: 'region-subject-conflict',
          detail: `region evidence does not overlap the exact subject target ${context.selected.target.name}`,
          blocking: true,
          evidenceIndexes: [evidenceIndex],
          candidateIdentitySha256s: [...overlaps.values()].map((entry) =>
            hashMultimodalJson({ kind: 'target', target: entry.target })
          ),
        })
    }
  }
  if (context.selected.target || context.symptom.subject.kind !== 'unknown')
    return
  if (!everyRegionBound) return
  const candidateHashes = [...byTarget.values()].map((entry) =>
    hashMultimodalJson({ kind: 'target', target: entry.target })
  )
  const singletonKeys = unknownRegionCandidates.flatMap((candidates) =>
    candidates.length === 1 ? [targetKey(candidates[0]!)] : []
  )
  if (
    unknownRegionCandidates.length === regionIndexes.length &&
    singletonKeys.length === regionIndexes.length &&
    new Set(singletonKeys).size === 1
  )
  {
    context.selected.target = unknownRegionCandidates[0]![0]!
    return
  }
  const candidateCount = byTarget.size
  addUnresolved(context, {
    code:
      candidateCount === 0
        ? 'region-target-not-found'
        : 'region-target-ambiguous',
    detail:
      candidateCount === 0
        ? 'normalized regions overlap no admitted target geometry'
        : `normalized regions do not identify one unambiguous admitted target from ${candidateCount} candidates`,
    blocking: true,
    evidenceIndexes: regionIndexes,
    candidateIdentitySha256s: candidateHashes,
  })
}

function exactAssetInputName(
  project: ProjectIR,
  script: IndexedScript,
  costume: CostumeRefV1
): boolean
{
  const raw = project.json.targets[script.ref.target.targetIndex]
  if (!raw) return false
  const inputName = costume.target.isStage ? 'BACKDROP' : 'COSTUME'
  for (const blockRef of script.blockRefs)
  {
    const block = ownRecordValue(raw.blocks, blockRef.blockId)
    if (!isBlockEntry(block)) continue
    const acceptedOpcode = costume.target.isStage
      ? block.opcode === 'looks_switchbackdropto' ||
        block.opcode === 'looks_switchbackdroptoandwait'
      : block.opcode === 'looks_switchcostumeto'
    if (!acceptedOpcode) continue
    const input = ownRecordValue(block.inputs, inputName)
    const slot = input ? primaryInputSlot(input) : null
    if (Array.isArray(slot) && String(slot[1] ?? '') === costume.name)
      return true
    if (typeof slot !== 'string') continue
    const menu = ownRecordValue(raw.blocks, slot)
    if (
      isBlockEntry(menu) &&
      String(ownRecordValue(menu.fields, inputName)?.[0] ?? '') === costume.name
    )
      return true
  }
  return false
}

function visualOpcodeRelevant(
  kind: VisualSymptom['kind'],
  opcode: string
): boolean
{
  if (kind === 'appearance') return opcode.startsWith('looks_')
  if (kind === 'motion') return opcode.startsWith('motion_')
  if (kind === 'layout')
    return opcode.startsWith('motion_') || opcode.startsWith('looks_')
  if (kind === 'text')
    return opcode.startsWith('looks_say') || opcode.startsWith('looks_think')
  if (kind === 'temporal')
    return (
      opcode.startsWith('motion_') ||
      opcode.startsWith('looks_') ||
      opcode.startsWith('control_') ||
      opcode.startsWith('event_')
    )
  return false
}

function declarationIndex(
  context: SymptomContext,
  declaration: DeclarationRef
): AnyIndexedDeclaration | null
{
  if (declaration.kind === 'broadcast') return null
  return (context.indexes.declarationByKey.get(declarationKey(declaration)) ??
    null) as AnyIndexedDeclaration | null
}

function addScriptCandidate(
  context: SymptomContext,
  script: ScriptRef,
  reason: VisualLocalizationReasonV1
): void
{
  addCandidate(context, { kind: 'script', script }, reason)
}

function rankScripts(context: SymptomContext): void
{
  const declaration = context.selected.declaration?.declaration
  if (declaration)
  {
    const indexed = declarationIndex(context, declaration)
    for (const writer of indexed?.writers ?? [])
    {
      if (!writer.script) continue
      addScriptCandidate(context, writer.script, {
        code: 'monitor-writer-script',
        score: 75,
        detail: `script writes monitored declaration ${declaration.name}`,
        evidenceIndexes: [],
      })
    }
    for (const reader of indexed?.readers ?? [])
    {
      if (!reader.script) continue
      addScriptCandidate(context, reader.script, {
        code: 'monitor-reader-script',
        score: 45,
        detail: `script reads monitored declaration ${declaration.name}`,
        evidenceIndexes: [],
      })
    }
  }
  const target = context.selected.target
  if (target && context.symptom.kind !== 'monitor')
  {
    for (const script of context.indexes.scripts)
    {
      if (!sameTarget(script.ref.target, target)) continue
      if (
        script.opcodes.some((opcode) =>
          visualOpcodeRelevant(context.symptom.kind, opcode)
        )
      )
        addScriptCandidate(context, script.ref, {
          code: 'visual-opcode-script',
          score: 35,
          detail: `script contains ${context.symptom.kind}-related visual opcodes`,
          evidenceIndexes: [],
        })
      if (
        context.selected.costume &&
        exactAssetInputName(
          context.input.project,
          script,
          context.selected.costume
        )
      )
        addScriptCandidate(context, script.ref, {
          code: 'exact-asset-script',
          score: 85,
          detail: `script exactly references costume ${context.selected.costume.name}`,
          evidenceIndexes: [],
        })
    }
  }
}

function identityOrder(identity: VisualLocalizationIdentityV1): number
{
  if (identity.kind === 'declaration') return 0
  if (identity.kind === 'target') return 1
  if (identity.kind === 'costume') return 2
  if (identity.kind === 'asset') return 3
  return 4
}

function finalizedCandidates(context: SymptomContext): {
  candidates: VisualLocalizationCandidateV1[]
  ranked: VisualLocalizationCandidateV1[]
  omitted: number
}
{
  const candidates = [...context.candidates.values()].map((candidate) =>
  {
    const reasons = [...candidate.reasons.values()].sort(
      (a, b) =>
        b.score - a.score ||
        compareText(a.code, b.code) ||
        compareText(a.detail, b.detail)
    )
    return {
      score: reasons.reduce((total, reason) => total + reason.score, 0),
      identitySha256: candidate.identitySha256,
      identity: candidate.identity,
      provenance: {
        artifactSha256: context.input.artifactSha256,
        symptomId: context.symptom.id,
        symptomSha256: context.symptomSha256,
      },
      reasons,
    }
  })
  candidates.sort(
    (a, b) =>
      b.score - a.score ||
      identityOrder(a.identity) - identityOrder(b.identity) ||
      compareText(a.identitySha256, b.identitySha256)
  )
  const ranked = candidates.map((candidate, index) => ({
    rank: index + 1,
    ...candidate,
  }))
  return {
    candidates: ranked.slice(0, context.maxCandidates),
    ranked,
    omitted: Math.max(0, ranked.length - context.maxCandidates),
  }
}

function selectTopScript(
  context: SymptomContext,
  candidates: readonly VisualLocalizationCandidateV1[]
): void
{
  const scripts = candidates.filter(
    (
      candidate
    ): candidate is VisualLocalizationCandidateV1 & {
      identity: { kind: 'script'; script: ScriptRef }
    } => candidate.identity.kind === 'script'
  )
  if (scripts.length === 0) return
  const topScore = scripts[0]!.score
  const top = scripts.filter((candidate) => candidate.score === topScore)
  if (top.length === 1) context.selected.script = top[0]!.identity.script
}

function localizeSymptom(
  input: AdmittedLocalizationInput,
  symptom: VisualSymptom,
  indexes: LocalizationIndexes,
  targets: IndexedTargetIdentity[],
  maxCandidates: number
): VisualSymptomLocalizationV1
{
  const symptomSha256 = hashMultimodalJson(symptom)
  const context: SymptomContext = {
    input,
    symptom,
    symptomSha256,
    indexes,
    targets,
    evidenceFrames: input.evidence?.frames ?? [],
    evidenceByLocator: [],
    geometryTargetsByEvidence: new Map(),
    maxCandidates,
    candidates: new Map(),
    unresolved: [],
    unresolvedKeys: new Set(),
    selected: {
      target: null,
      script: null,
      declaration: null,
      costume: null,
      asset: null,
    },
  }
  bindSymptomEvidence(context)
  selectSubjectTarget(context)
  selectMonitor(context)
  selectCombinedUnknownTarget(context)
  selectAsset(context)
  selectRegionTarget(context)
  if (
    symptom.subject.kind === 'unknown' &&
    !context.selected.target &&
    symptom.assetName === null &&
    symptom.evidence.every((locator) => locator.region === null)
  )
    addUnresolved(context, {
      code: 'subject-unknown',
      detail:
        'symptom supplies no target, monitor, asset, or region identity hint',
      blocking: true,
      evidenceIndexes: [],
      candidateIdentitySha256s: [],
    })
  rankScripts(context)
  const allCandidates = finalizedCandidates(context)
  selectTopScript(context, allCandidates.ranked)
  const hasSelection =
    context.selected.target !== null ||
    context.selected.script !== null ||
    context.selected.declaration !== null ||
    context.selected.costume !== null ||
    context.selected.asset !== null
  const blocking = context.unresolved.some((entry) => entry.blocking)
  return {
    symptomId: symptom.id,
    symptomSha256,
    status: blocking
      ? hasSelection
        ? 'partial'
        : 'unresolved'
      : hasSelection
        ? 'resolved'
        : 'unresolved',
    selected: context.selected,
    candidates: allCandidates.candidates,
    omittedCandidateCount: allCandidates.omitted,
    unresolved: context.unresolved.sort(
      (a, b) =>
        Number(b.blocking) - Number(a.blocking) ||
        compareText(a.code, b.code) ||
        compareText(a.detail, b.detail)
    ),
  }
}

export async function localizeVisualSymptoms(
  input: VisualSymptomLocalizationInputV1
): Promise<Readonly<VisualSymptomLocalizationReportV1>>
{
  const boundary = validatedInput(input)
  const admitted = await admitLocalizationInput(boundary)
  const { symptoms, maxCandidates } = admitted
  const indexes = buildLocalizationIndexes(admitted.project)
  const targets = indexedTargetIdentities(indexes.targets)
  const symptomsSha256 = hashMultimodalJson(symptoms)
  const evidenceSha256 = evidenceHash(admitted)
  const inputSha256 = hashMultimodalJson({
    schemaVersion: VISUAL_LOCALIZATION_SCHEMA_VERSION,
    artifactSha256: admitted.artifactSha256,
    symptomsSha256,
    evidenceSha256,
    maxCandidatesPerSymptom: maxCandidates,
  })
  const localized = symptoms.map((symptom) =>
    localizeSymptom(admitted, symptom, indexes, targets, maxCandidates)
  )
  const body = {
    schemaVersion: VISUAL_LOCALIZATION_SCHEMA_VERSION,
    artifactSha256: admitted.artifactSha256,
    symptomsSha256,
    evidenceSha256,
    inputSha256,
    localizer: {
      id: 'scratch-agent-visual-localizer' as const,
      version: '1' as const,
    },
    limits: {
      maxSymptoms: MAX_VISUAL_LOCALIZATION_SYMPTOMS,
      maxEvidenceFrames: MAX_VISUAL_LOCALIZATION_FRAMES,
      maxEvidenceBytes: MAX_MULTIMODAL_JSON_BYTES,
      maxTargetsPerFrame: MAX_VISUAL_LOCALIZATION_TARGETS_PER_FRAME,
      maxArtifactBytes: MAX_VISUAL_LOCALIZATION_ARTIFACT_BYTES,
      maxCandidatesPerSymptom: maxCandidates,
    },
    counts: {
      symptoms: localized.length,
      resolved: localized.filter((entry) => entry.status === 'resolved').length,
      partial: localized.filter((entry) => entry.status === 'partial').length,
      unresolved: localized.filter((entry) => entry.status === 'unresolved')
        .length,
      candidates: localized.reduce(
        (total, entry) => total + entry.candidates.length,
        0
      ),
      omittedCandidates: localized.reduce(
        (total, entry) => total + entry.omittedCandidateCount,
        0
      ),
    },
    symptoms: localized,
  }
  const reportSha256 = hashMultimodalJson({
    ...body,
    symptoms: body.symptoms.map((symptom) => hashMultimodalJson(symptom)),
  })
  return deepFreeze({
    ...body,
    reportSha256,
  }) as Readonly<VisualSymptomLocalizationReportV1>
}
