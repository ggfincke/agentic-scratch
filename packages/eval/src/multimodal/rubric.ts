// packages/eval/src/multimodal/rubric.ts
// trusted rubric specs & strict evidence-bound provider judgment normalization

import {
  detachedFrozenMultimodalRecord,
  hashMultimodalJson,
  MULTIMODAL_SCHEMA_VERSION,
  multimodalArray,
  multimodalExactKeys,
  multimodalFiniteNumber,
  multimodalRecord,
  multimodalString,
  type MultimodalContractIssue,
  type MultimodalEvidenceLocator,
  type MultimodalValidationResult,
  type MultimodalVerdict,
  type VisualSymptom,
  validateMultimodalEvidenceLocator,
  validateVisualSymptom,
} from './multimodal-contracts.js'
import { unknownErrorMessage } from '../core/unknown-error-message.js'

export type CriterionVerdict = 'pass' | 'fail' | 'inconclusive'

export const MAX_RUBRIC_CRITERIA = 64

interface RubricCriterionV1
{
  id: string
  requirement: 'required' | 'advisory'
  evidenceKind: 'keyframe' | 'temporal' | 'state-and-visual'
  description: string
  passAnchors: string[]
  failAnchors: string[]
}

export interface RubricSpecV1
{
  schemaVersion: typeof MULTIMODAL_SCHEMA_VERSION
  id: string
  version: string
  objective: string
  criteria: RubricCriterionV1[]
}

interface RawRubricCriterionJudgmentV1
{
  criterionId: string
  verdict: CriterionVerdict
  confidence: number
  evidence: MultimodalEvidenceLocator[]
  symptoms: VisualSymptom[]
  limitation: string | null
}

export interface RawRubricJudgmentV1
{
  schemaVersion: typeof MULTIMODAL_SCHEMA_VERSION
  criteria: RawRubricCriterionJudgmentV1[]
}

interface RubricCriterionJudgmentV1 extends RawRubricCriterionJudgmentV1
{
  requirement: RubricCriterionV1['requirement']
}

interface RubricAdmittedEvidenceV1
{
  criterionId: string
  evidenceId: string
  frameId: string
  tick: number
}

export interface RubricJudgmentProvenanceV1
{
  requestSha256: string
  outputSchemaSha256: string
  criterionEvidenceSha256: string
  admittedEvidence: RubricAdmittedEvidenceV1[]
  context: {
    artifactSha256: string
    scenarioSha256: string
    observationPlanSha256: string
    observationTraceSha256: string
    sampleOrdinal: number
  }
  promptTemplate: {
    id: string
    version: string
    templateSha256: string
    renderedPromptSha256: string
  }
  provider: {
    adapter: string
    provider: string
    requestedModel: string
    version: string
    responseModel: string
  }
  generation: {
    temperature: number | null
    maxOutputTokens: number
  }
}

export interface RubricJudgmentV1
{
  schemaVersion: typeof MULTIMODAL_SCHEMA_VERSION
  rubric: { id: string; version: string; sha256: string }
  evidenceSha256: string
  responseSha256: string
  provenance: RubricJudgmentProvenanceV1
  verdict: MultimodalVerdict
  criteria: RubricCriterionJudgmentV1[]
  limitations: string[]
}

export interface RubricJudgmentBindingV1
{
  rubricSha256: string
  evidenceSha256: string
  responseSha256: string
  selectedCriterionIds: string[]
  provenance: RubricJudgmentProvenanceV1
  admittedEvidence: RubricAdmittedEvidenceV1[]
}

interface RubricAggregateCriterionV1
{
  criterionId: string
  requirement: RubricCriterionV1['requirement']
  verdict: CriterionVerdict
}

export interface RubricAggregateV1
{
  verdict: MultimodalVerdict
  criteria: RubricAggregateCriterionV1[]
}

const REGION_SCHEMA = {
  anyOf: [
    { type: 'null' },
    {
      type: 'object',
      description:
        'optional rectangle in normalized 0..1 frame fractions, never pixels',
      additionalProperties: false,
      required: ['x', 'y', 'width', 'height'],
      properties: {
        x: { type: 'number', description: 'normalized left edge from 0 to 1' },
        y: { type: 'number', description: 'normalized top edge from 0 to 1' },
        width: {
          type: 'number',
          description: 'normalized positive width no greater than 1',
        },
        height: {
          type: 'number',
          description: 'normalized positive height no greater than 1',
        },
      },
    },
  ],
} as const

const LOCATOR_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['evidenceId', 'frameId', 'tick', 'region'],
  properties: {
    evidenceId: { type: 'string' },
    frameId: { type: 'string' },
    tick: { type: 'integer' },
    region: REGION_SCHEMA,
  },
} as const

const SUBJECT_SCHEMA = {
  anyOf: [
    {
      type: 'object',
      additionalProperties: false,
      required: ['kind', 'name'],
      properties: {
        kind: { type: 'string', const: 'sprite' },
        name: { type: 'string' },
      },
    },
    {
      type: 'object',
      additionalProperties: false,
      required: ['kind'],
      properties: { kind: { type: 'string', const: 'stage' } },
    },
    {
      type: 'object',
      additionalProperties: false,
      required: ['kind', 'targetName', 'declarationName'],
      properties: {
        kind: { type: 'string', const: 'monitor' },
        targetName: {
          anyOf: [{ type: 'null' }, { type: 'string' }],
        },
        declarationName: { type: 'string' },
      },
    },
    {
      type: 'object',
      additionalProperties: false,
      required: ['kind'],
      properties: { kind: { type: 'string', const: 'unknown' } },
    },
  ],
} as const

const SYMPTOM_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['id', 'kind', 'subject', 'assetName', 'description', 'evidence'],
  properties: {
    id: { type: 'string' },
    kind: {
      type: 'string',
      enum: ['appearance', 'motion', 'layout', 'text', 'monitor', 'temporal'],
    },
    subject: SUBJECT_SCHEMA,
    assetName: {
      anyOf: [{ type: 'null' }, { type: 'string' }],
    },
    description: { type: 'string' },
    evidence: {
      type: 'array',
      items: LOCATOR_SCHEMA,
    },
  },
} as const

export const RUBRIC_JUDGMENT_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['schemaVersion', 'criteria'],
  properties: {
    schemaVersion: { type: 'integer', const: MULTIMODAL_SCHEMA_VERSION },
    criteria: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: [
          'criterionId',
          'verdict',
          'confidence',
          'evidence',
          'symptoms',
          'limitation',
        ],
        properties: {
          criterionId: { type: 'string' },
          verdict: {
            type: 'string',
            enum: ['pass', 'fail', 'inconclusive'],
          },
          confidence: { type: 'number' },
          evidence: {
            type: 'array',
            items: LOCATOR_SCHEMA,
          },
          symptoms: {
            type: 'array',
            items: SYMPTOM_SCHEMA,
          },
          limitation: {
            anyOf: [{ type: 'null' }, { type: 'string' }],
          },
        },
      },
    },
  },
} as const

function prefixedIssues(
  target: MultimodalContractIssue[],
  prefix: string,
  source: readonly MultimodalContractIssue[]
): void
{
  for (const current of source)
  {
    target.push({
      ...current,
      path: `${prefix}${current.path === '$' ? '' : current.path.slice(1)}`,
    })
  }
}

function readStringArray(
  value: unknown,
  path: string,
  issues: MultimodalContractIssue[],
  minLength: number
): void
{
  const array = multimodalArray(value, path, issues, {
    minLength,
    maxLength: 16,
  })
  array?.forEach((entry, index) =>
    multimodalString(entry, `${path}[${index}]`, issues, {
      minLength: 1,
      maxLength: 512,
    })
  )
}

export function validateRubricSpec(
  value: unknown
): MultimodalValidationResult<RubricSpecV1>
{
  const issues: MultimodalContractIssue[] = []
  const record = multimodalRecord(value, '$', issues)
  const criterionIds = new Set<string>()
  let requiredCount = 0
  if (record)
  {
    multimodalExactKeys(
      record,
      '$',
      ['schemaVersion', 'id', 'version', 'objective', 'criteria'],
      [],
      issues
    )
    if (record.schemaVersion !== MULTIMODAL_SCHEMA_VERSION)
      issues.push({
        path: '$.schemaVersion',
        code: 'invalid-value',
        message: 'unsupported rubric schema version',
      })
    multimodalString(record.id, '$.id', issues, {
      minLength: 1,
      maxLength: 128,
    })
    multimodalString(record.version, '$.version', issues, {
      minLength: 1,
      maxLength: 128,
    })
    multimodalString(record.objective, '$.objective', issues, {
      minLength: 1,
      maxLength: 4096,
    })
    const criteria = multimodalArray(record.criteria, '$.criteria', issues, {
      minLength: 1,
      maxLength: MAX_RUBRIC_CRITERIA,
    })
    criteria?.forEach((criterion, index) =>
    {
      const path = `$.criteria[${index}]`
      const current = multimodalRecord(criterion, path, issues)
      if (!current) return
      multimodalExactKeys(
        current,
        path,
        [
          'id',
          'requirement',
          'evidenceKind',
          'description',
          'passAnchors',
          'failAnchors',
        ],
        [],
        issues
      )
      const id = multimodalString(current.id, `${path}.id`, issues, {
        minLength: 1,
        maxLength: 128,
      })
      if (id !== null)
      {
        if (criterionIds.has(id))
          issues.push({
            path: `${path}.id`,
            code: 'duplicate-id',
            message: 'rubric criterion IDs must be unique',
          })
        criterionIds.add(id)
      }
      const requirement = multimodalString(
        current.requirement,
        `${path}.requirement`,
        issues,
        { minLength: 1, maxLength: 32 }
      )
      if (requirement === 'required') requiredCount++
      else if (requirement !== null && requirement !== 'advisory')
        issues.push({
          path: `${path}.requirement`,
          code: 'invalid-value',
          message: 'requirement must be required or advisory',
        })
      const evidenceKind = multimodalString(
        current.evidenceKind,
        `${path}.evidenceKind`,
        issues,
        { minLength: 1, maxLength: 32 }
      )
      if (
        evidenceKind !== null &&
        !['keyframe', 'temporal', 'state-and-visual'].includes(evidenceKind)
      )
        issues.push({
          path: `${path}.evidenceKind`,
          code: 'invalid-value',
          message: 'unknown rubric evidence kind',
        })
      multimodalString(current.description, `${path}.description`, issues, {
        minLength: 1,
        maxLength: 2048,
      })
      readStringArray(current.passAnchors, `${path}.passAnchors`, issues, 1)
      readStringArray(current.failAnchors, `${path}.failAnchors`, issues, 1)
    })
  }
  if (requiredCount === 0)
    issues.push({
      path: '$.criteria',
      code: 'invalid-value',
      message: 'a rubric needs at least one required criterion',
    })
  if (issues.length > 0) return { ok: false, issues }
  return {
    ok: true,
    value: detachedFrozenMultimodalRecord(value as RubricSpecV1),
  }
}

function parseRawCriterion(
  value: unknown,
  path: string,
  issues: MultimodalContractIssue[]
): void
{
  const record = multimodalRecord(value, path, issues)
  if (!record) return
  multimodalExactKeys(
    record,
    path,
    [
      'criterionId',
      'verdict',
      'confidence',
      'evidence',
      'symptoms',
      'limitation',
    ],
    [],
    issues
  )
  multimodalString(record.criterionId, `${path}.criterionId`, issues, {
    minLength: 1,
    maxLength: 128,
  })
  const verdict = multimodalString(record.verdict, `${path}.verdict`, issues, {
    minLength: 1,
    maxLength: 32,
  })
  if (verdict !== null && !['pass', 'fail', 'inconclusive'].includes(verdict))
    issues.push({
      path: `${path}.verdict`,
      code: 'invalid-value',
      message: 'unknown criterion verdict',
    })
  multimodalFiniteNumber(record.confidence, `${path}.confidence`, issues, {
    min: 0,
    max: 1,
  })
  const evidence = multimodalArray(
    record.evidence,
    `${path}.evidence`,
    issues,
    {
      maxLength: 32,
    }
  )
  evidence?.forEach((locator, index) =>
  {
    const result = validateMultimodalEvidenceLocator(locator)
    if (!result.ok)
      prefixedIssues(issues, `${path}.evidence[${index}]`, result.issues)
  })
  const symptoms = multimodalArray(
    record.symptoms,
    `${path}.symptoms`,
    issues,
    {
      maxLength: 32,
    }
  )
  const symptomIds = new Set<string>()
  symptoms?.forEach((symptom, index) =>
  {
    const result = validateVisualSymptom(symptom)
    if (!result.ok)
      prefixedIssues(issues, `${path}.symptoms[${index}]`, result.issues)
    else if (symptomIds.has(result.value.id))
      issues.push({
        path: `${path}.symptoms[${index}].id`,
        code: 'duplicate-id',
        message: 'symptom IDs must be unique within a criterion',
      })
    else symptomIds.add(result.value.id)
  })
  if (record.limitation !== null)
    multimodalString(record.limitation, `${path}.limitation`, issues, {
      minLength: 1,
      maxLength: 2048,
    })
  if ((verdict === 'pass' || verdict === 'fail') && evidence?.length === 0)
    issues.push({
      path: `${path}.evidence`,
      code: 'invalid-value',
      message: 'pass and fail judgments require evidence',
    })
  if (verdict === 'inconclusive' && record.limitation === null)
    issues.push({
      path: `${path}.limitation`,
      code: 'invalid-value',
      message: 'inconclusive judgments require a limitation',
    })
}

export function parseRawRubricJudgment(
  value: unknown
): MultimodalValidationResult<RawRubricJudgmentV1>
{
  const issues: MultimodalContractIssue[] = []
  const record = multimodalRecord(value, '$', issues)
  if (record)
  {
    multimodalExactKeys(record, '$', ['schemaVersion', 'criteria'], [], issues)
    if (record.schemaVersion !== MULTIMODAL_SCHEMA_VERSION)
      issues.push({
        path: '$.schemaVersion',
        code: 'invalid-value',
        message: 'unsupported judgment schema version',
      })
    const criteria = multimodalArray(record.criteria, '$.criteria', issues, {
      minLength: 1,
      maxLength: MAX_RUBRIC_CRITERIA,
    })
    criteria?.forEach((criterion, index) =>
      parseRawCriterion(criterion, `$.criteria[${index}]`, issues)
    )
  }
  if (issues.length > 0) return { ok: false, issues }
  return {
    ok: true,
    value: detachedFrozenMultimodalRecord(value as RawRubricJudgmentV1),
  }
}

function rubricVerdict(
  criteria: readonly RubricCriterionJudgmentV1[]
): MultimodalVerdict
{
  const required = criteria.filter(
    (criterion) => criterion.requirement === 'required'
  )
  if (required.length === 0) throw new Error('rubric has no required judgments')
  if (required.some((criterion) => criterion.verdict === 'fail'))
    return 'failed'
  if (required.every((criterion) => criterion.verdict === 'pass'))
    return 'passed'
  return 'inconclusive'
}

function locatorKey(locator: MultimodalEvidenceLocator): string
{
  return `${locator.evidenceId}\u0000${locator.frameId}\u0000${locator.tick}`
}

export function normalizeRubricJudgment(
  rubric: RubricSpecV1,
  raw: RawRubricJudgmentV1,
  binding: RubricJudgmentBindingV1
): MultimodalValidationResult<RubricJudgmentV1>
{
  const issues: MultimodalContractIssue[] = []
  const actualRubricSha256 = hashMultimodalJson(rubric)
  if (actualRubricSha256 !== binding.rubricSha256)
    issues.push({
      path: '$.rubricSha256',
      code: 'invalid-value',
      message: 'rubric hash does not match the trusted rubric',
    })
  const rubricCriteria = new Map(
    rubric.criteria.map((criterion) => [criterion.id, criterion])
  )
  const selectedIds = new Set<string>()
  binding.selectedCriterionIds.forEach((criterionId, index) =>
  {
    if (selectedIds.has(criterionId))
      issues.push({
        path: `$.selectedCriterionIds[${index}]`,
        code: 'duplicate-id',
        message: 'trusted criterion selection contains a duplicate',
      })
    else if (!rubricCriteria.has(criterionId))
      issues.push({
        path: `$.selectedCriterionIds[${index}]`,
        code: 'invalid-value',
        message: 'trusted criterion selection contains an unknown criterion',
      })
    selectedIds.add(criterionId)
  })
  const selectedRequiredCount = rubric.criteria.filter(
    (criterion) =>
      selectedIds.has(criterion.id) && criterion.requirement === 'required'
  ).length
  if (selectedRequiredCount === 0)
    issues.push({
      path: '$.selectedCriterionIds',
      code: 'invalid-value',
      message: 'criterion selection needs at least one required criterion',
    })
  const providerIds = new Set<string>()
  const providerSymptomIds = new Set<string>()
  const seen = new Set<string>()
  const admittedByCriterion = new Map<string, Set<string>>()
  if (
    hashMultimodalJson(binding.provenance.admittedEvidence) !==
    hashMultimodalJson(binding.admittedEvidence)
  )
    issues.push({
      path: '$.provenance.admittedEvidence',
      code: 'invalid-value',
      message: 'provenance and trusted admitted evidence do not match',
    })
  binding.admittedEvidence.forEach((entry, index) =>
  {
    if (!selectedIds.has(entry.criterionId))
      issues.push({
        path: `$.admittedEvidence[${index}].criterionId`,
        code: 'invalid-value',
        message: 'admitted evidence belongs to an unselected criterion',
      })
    const current = admittedByCriterion.get(entry.criterionId) ?? new Set()
    const key = `${entry.evidenceId}\u0000${entry.frameId}\u0000${entry.tick}`
    if (current.has(key))
      issues.push({
        path: `$.admittedEvidence[${index}]`,
        code: 'duplicate-id',
        message: 'admitted criterion evidence must be unique',
      })
    current.add(key)
    admittedByCriterion.set(entry.criterionId, current)
  })
  const criteria: RubricCriterionJudgmentV1[] = []
  raw.criteria.forEach((judgment, index) =>
  {
    const criterion = rubricCriteria.get(judgment.criterionId)
    if (providerIds.has(judgment.criterionId))
      issues.push({
        path: `$.criteria[${index}].criterionId`,
        code: 'duplicate-id',
        message: 'provider returned a criterion more than once',
      })
    else if (!criterion)
      issues.push({
        path: `$.criteria[${index}].criterionId`,
        code: 'invalid-value',
        message: 'provider returned an unknown criterion',
      })
    else if (!selectedIds.has(judgment.criterionId))
      issues.push({
        path: `$.criteria[${index}].criterionId`,
        code: 'invalid-value',
        message: 'provider returned a criterion outside the trusted selection',
      })
    else
    {
      seen.add(judgment.criterionId)
      criteria.push({ ...judgment, requirement: criterion.requirement })
    }
    providerIds.add(judgment.criterionId)
    for (const symptom of judgment.symptoms)
    {
      if (providerSymptomIds.has(symptom.id))
        issues.push({
          path: `$.criteria[${index}].symptoms`,
          code: 'duplicate-id',
          message: 'provider symptom IDs must be unique across the judgment',
        })
      providerSymptomIds.add(symptom.id)
    }
    const locators = [
      ...judgment.evidence,
      ...judgment.symptoms.flatMap((symptom) => symptom.evidence),
    ]
    const admitted = admittedByCriterion.get(judgment.criterionId) ?? new Set()
    for (const locator of locators)
    {
      if (!admitted.has(locatorKey(locator)))
        issues.push({
          path: `$.criteria[${index}].evidence`,
          code: 'unresolved-evidence',
          message: 'provider referenced evidence outside the admitted index',
        })
    }
  })
  for (const criterionId of selectedIds)
  {
    if (rubricCriteria.has(criterionId) && !seen.has(criterionId))
      issues.push({
        path: '$.criteria',
        code: 'missing-key',
        message: `provider omitted criterion ${criterionId}`,
      })
  }
  if (issues.length > 0) return { ok: false, issues }
  const ordered = rubric.criteria
    .filter((criterion) => selectedIds.has(criterion.id))
    .map((criterion) =>
      criteria.find((entry) => entry.criterionId === criterion.id)!
    )
  const normalized: RubricJudgmentV1 = {
    schemaVersion: MULTIMODAL_SCHEMA_VERSION,
    rubric: {
      id: rubric.id,
      version: rubric.version,
      sha256: binding.rubricSha256,
    },
    evidenceSha256: binding.evidenceSha256,
    responseSha256: binding.responseSha256,
    provenance: binding.provenance,
    verdict: rubricVerdict(ordered),
    criteria: ordered,
    limitations: ordered.flatMap((entry) =>
      entry.limitation === null ? [] : [entry.limitation]
    ),
  }
  return { ok: true, value: detachedFrozenMultimodalRecord(normalized) }
}

function validateJudgmentHash(
  value: unknown,
  path: string,
  issues: MultimodalContractIssue[]
): void
{
  const parsed = multimodalString(value, path, issues, {
    minLength: 64,
    maxLength: 64,
  })
  if (parsed !== null && !/^[a-f0-9]{64}$/.test(parsed))
    issues.push({
      path,
      code: 'invalid-value',
      message: 'expected a lowercase SHA-256 digest',
    })
}

function validateJudgmentIdentity(
  value: unknown,
  path: string,
  issues: MultimodalContractIssue[]
): void
{
  const identity = multimodalRecord(value, path, issues)
  if (!identity) return
  multimodalExactKeys(identity, path, ['id', 'version', 'sha256'], [], issues)
  multimodalString(identity.id, `${path}.id`, issues, {
    minLength: 1,
    maxLength: 256,
  })
  multimodalString(identity.version, `${path}.version`, issues, {
    minLength: 1,
    maxLength: 256,
  })
  validateJudgmentHash(identity.sha256, `${path}.sha256`, issues)
}

function validateNormalizedProvenance(
  value: unknown,
  issues: MultimodalContractIssue[]
): void
{
  const path = '$.provenance'
  const provenance = multimodalRecord(value, path, issues)
  if (!provenance) return
  multimodalExactKeys(
    provenance,
    path,
    [
      'requestSha256',
      'outputSchemaSha256',
      'criterionEvidenceSha256',
      'admittedEvidence',
      'context',
      'promptTemplate',
      'provider',
      'generation',
    ],
    [],
    issues
  )
  validateJudgmentHash(
    provenance.requestSha256,
    `${path}.requestSha256`,
    issues
  )
  validateJudgmentHash(
    provenance.outputSchemaSha256,
    `${path}.outputSchemaSha256`,
    issues
  )
  validateJudgmentHash(
    provenance.criterionEvidenceSha256,
    `${path}.criterionEvidenceSha256`,
    issues
  )
  const admittedEvidence = multimodalArray(
    provenance.admittedEvidence,
    `${path}.admittedEvidence`,
    issues,
    { minLength: 1, maxLength: 4096 }
  )
  const admittedKeys = new Set<string>()
  admittedEvidence?.forEach((entry, index) =>
  {
    const entryPath = `${path}.admittedEvidence[${index}]`
    const admitted = multimodalRecord(entry, entryPath, issues)
    if (!admitted) return
    multimodalExactKeys(
      admitted,
      entryPath,
      ['criterionId', 'evidenceId', 'frameId', 'tick'],
      [],
      issues
    )
    const criterionId = multimodalString(
      admitted.criterionId,
      `${entryPath}.criterionId`,
      issues,
      { minLength: 1, maxLength: 256 }
    )
    multimodalString(admitted.evidenceId, `${entryPath}.evidenceId`, issues, {
      minLength: 1,
      maxLength: 256,
    })
    const frameId = multimodalString(
      admitted.frameId,
      `${entryPath}.frameId`,
      issues,
      { minLength: 1, maxLength: 256 }
    )
    multimodalFiniteNumber(admitted.tick, `${entryPath}.tick`, issues, {
      min: 0,
      integer: true,
    })
    if (criterionId === null || frameId === null) return
    const key = `${criterionId}\u0000${frameId}`
    if (admittedKeys.has(key))
      issues.push({
        path: entryPath,
        code: 'duplicate-id',
        message: 'admitted criterion/frame identities must be unique',
      })
    admittedKeys.add(key)
  })
  const context = multimodalRecord(
    provenance.context,
    `${path}.context`,
    issues
  )
  if (context)
  {
    multimodalExactKeys(
      context,
      `${path}.context`,
      [
        'artifactSha256',
        'scenarioSha256',
        'observationPlanSha256',
        'observationTraceSha256',
        'sampleOrdinal',
      ],
      [],
      issues
    )
    for (const key of [
      'artifactSha256',
      'scenarioSha256',
      'observationPlanSha256',
      'observationTraceSha256',
    ] as const)
      validateJudgmentHash(context[key], `${path}.context.${key}`, issues)
    multimodalFiniteNumber(
      context.sampleOrdinal,
      `${path}.context.sampleOrdinal`,
      issues,
      { min: 0, integer: true }
    )
  }
  const prompt = multimodalRecord(
    provenance.promptTemplate,
    `${path}.promptTemplate`,
    issues
  )
  if (prompt)
  {
    multimodalExactKeys(
      prompt,
      `${path}.promptTemplate`,
      ['id', 'version', 'templateSha256', 'renderedPromptSha256'],
      [],
      issues
    )
    multimodalString(prompt.id, `${path}.promptTemplate.id`, issues, {
      minLength: 1,
      maxLength: 256,
    })
    multimodalString(prompt.version, `${path}.promptTemplate.version`, issues, {
      minLength: 1,
      maxLength: 256,
    })
    validateJudgmentHash(
      prompt.templateSha256,
      `${path}.promptTemplate.templateSha256`,
      issues
    )
    validateJudgmentHash(
      prompt.renderedPromptSha256,
      `${path}.promptTemplate.renderedPromptSha256`,
      issues
    )
  }
  const provider = multimodalRecord(
    provenance.provider,
    `${path}.provider`,
    issues
  )
  if (provider)
  {
    multimodalExactKeys(
      provider,
      `${path}.provider`,
      ['adapter', 'provider', 'requestedModel', 'version', 'responseModel'],
      [],
      issues
    )
    for (const key of [
      'adapter',
      'provider',
      'requestedModel',
      'version',
      'responseModel',
    ] as const)
      multimodalString(provider[key], `${path}.provider.${key}`, issues, {
        minLength: 1,
        maxLength: 256,
      })
  }
  const generation = multimodalRecord(
    provenance.generation,
    `${path}.generation`,
    issues
  )
  if (generation)
  {
    multimodalExactKeys(
      generation,
      `${path}.generation`,
      ['temperature', 'maxOutputTokens'],
      [],
      issues
    )
    if (generation.temperature !== null)
      multimodalFiniteNumber(
        generation.temperature,
        `${path}.generation.temperature`,
        issues,
        { min: 0, max: 2 }
      )
    multimodalFiniteNumber(
      generation.maxOutputTokens,
      `${path}.generation.maxOutputTokens`,
      issues,
      { min: 1, integer: true }
    )
  }
}

export function validateNormalizedRubricJudgment(
  rubric: RubricSpecV1,
  value: unknown,
  binding: RubricJudgmentBindingV1
): MultimodalValidationResult<RubricJudgmentV1>
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
  const record = multimodalRecord(detached, '$', issues)
  if (!record) return { ok: false, issues }
  multimodalExactKeys(
    record,
    '$',
    [
      'schemaVersion',
      'rubric',
      'evidenceSha256',
      'responseSha256',
      'provenance',
      'verdict',
      'criteria',
      'limitations',
    ],
    [],
    issues
  )
  if (record.schemaVersion !== MULTIMODAL_SCHEMA_VERSION)
    issues.push({
      path: '$.schemaVersion',
      code: 'invalid-value',
      message: 'unsupported normalized-judgment schema version',
    })
  validateJudgmentIdentity(record.rubric, '$.rubric', issues)
  validateJudgmentHash(record.evidenceSha256, '$.evidenceSha256', issues)
  validateJudgmentHash(record.responseSha256, '$.responseSha256', issues)
  validateNormalizedProvenance(record.provenance, issues)
  const verdict = multimodalString(record.verdict, '$.verdict', issues, {
    minLength: 1,
    maxLength: 32,
  })
  if (
    verdict !== null &&
    !['passed', 'failed', 'inconclusive'].includes(verdict)
  )
    issues.push({
      path: '$.verdict',
      code: 'invalid-value',
      message: 'unknown normalized rubric verdict',
    })
  const criteria = multimodalArray(record.criteria, '$.criteria', issues, {
    minLength: 1,
    maxLength: MAX_RUBRIC_CRITERIA,
  })
  const rawCriteria: RawRubricCriterionJudgmentV1[] = []
  criteria?.forEach((criterion, index) =>
  {
    const path = `$.criteria[${index}]`
    const normalized = multimodalRecord(criterion, path, issues)
    if (!normalized) return
    multimodalExactKeys(
      normalized,
      path,
      [
        'criterionId',
        'verdict',
        'confidence',
        'evidence',
        'symptoms',
        'limitation',
        'requirement',
      ],
      [],
      issues
    )
    const requirement = multimodalString(
      normalized.requirement,
      `${path}.requirement`,
      issues,
      { minLength: 1, maxLength: 16 }
    )
    if (
      requirement !== null &&
      requirement !== 'required' &&
      requirement !== 'advisory'
    )
      issues.push({
        path: `${path}.requirement`,
        code: 'invalid-value',
        message: 'unknown rubric requirement',
      })
    const raw = {
      criterionId: normalized.criterionId,
      verdict: normalized.verdict,
      confidence: normalized.confidence,
      evidence: normalized.evidence,
      symptoms: normalized.symptoms,
      limitation: normalized.limitation,
    }
    parseRawCriterion(raw, path, issues)
    rawCriteria.push(raw as RawRubricCriterionJudgmentV1)
  })
  const limitations = multimodalArray(
    record.limitations,
    '$.limitations',
    issues,
    {
      maxLength: MAX_RUBRIC_CRITERIA,
    }
  )
  limitations?.forEach((limitation, index) =>
    multimodalString(limitation, `$.limitations[${index}]`, issues, {
      minLength: 1,
      maxLength: 2048,
    })
  )
  if (issues.length > 0) return { ok: false, issues }
  const raw: RawRubricJudgmentV1 = {
    schemaVersion: MULTIMODAL_SCHEMA_VERSION,
    criteria: rawCriteria,
  }
  const normalized = normalizeRubricJudgment(rubric, raw, binding)
  if (!normalized.ok) return normalized
  if (hashMultimodalJson(normalized.value) !== hashMultimodalJson(detached))
    return {
      ok: false,
      issues: [
        {
          path: '$',
          code: 'invalid-value',
          message:
            'normalized rubric judgment does not match its trusted binding',
        },
      ],
    }
  return normalized
}
