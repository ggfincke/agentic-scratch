// packages/eval/src/multimodal/multimodal-contracts.ts
// strict shared JSON contracts, evidence locators, symptoms, hashes, & freezing

import { sha256 } from '../core/sha256.js'

export const MULTIMODAL_SCHEMA_VERSION = 1 as const
export const MAX_MULTIMODAL_JSON_BYTES = 1024 * 1024
export const MAX_MULTIMODAL_ARRAY_LENGTH = 16_384
const MAX_MULTIMODAL_STRING_LENGTH = 4096

export type MultimodalVerdict = 'passed' | 'failed' | 'inconclusive'

export interface MultimodalContractIssue
{
  path: string
  code:
    | 'invalid-type'
    | 'invalid-value'
    | 'missing-key'
    | 'unknown-key'
    | 'limit-exceeded'
    | 'duplicate-id'
    | 'unresolved-evidence'
  message: string
}

export type MultimodalValidationResult<T> =
  | { ok: true; value: Readonly<T> }
  | { ok: false; issues: MultimodalContractIssue[] }

interface MultimodalNormalizedRegion
{
  x: number
  y: number
  width: number
  height: number
}

export interface MultimodalEvidenceLocator
{
  evidenceId: string
  frameId: string
  tick: number
  region: MultimodalNormalizedRegion | null
}

type VisualSymptomKind =
  'appearance' | 'motion' | 'layout' | 'text' | 'monitor' | 'temporal'

type VisualSymptomSubject =
  | { kind: 'sprite'; name: string }
  | { kind: 'stage' }
  | {
      kind: 'monitor'
      targetName: string | null
      declarationName: string
    }
  | { kind: 'unknown' }

export interface VisualSymptom
{
  id: string
  kind: VisualSymptomKind
  subject: VisualSymptomSubject
  assetName: string | null
  description: string
  evidence: MultimodalEvidenceLocator[]
}

type MultimodalRecord = Record<string, unknown>

function issue(
  issues: MultimodalContractIssue[],
  path: string,
  code: MultimodalContractIssue['code'],
  message: string
): void
{
  issues.push({ path, code, message })
}

export function multimodalRecord(
  value: unknown,
  path: string,
  issues: MultimodalContractIssue[]
): MultimodalRecord | null
{
  if (
    value === null ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    (Object.getPrototypeOf(value) !== Object.prototype &&
      Object.getPrototypeOf(value) !== null)
  )
  {
    issue(issues, path, 'invalid-type', 'expected a plain object')
    return null
  }
  return value as MultimodalRecord
}

export function multimodalExactKeys(
  value: MultimodalRecord,
  path: string,
  required: readonly string[],
  optional: readonly string[],
  issues: MultimodalContractIssue[]
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

export function multimodalString(
  value: unknown,
  path: string,
  issues: MultimodalContractIssue[],
  options: { minLength?: number; maxLength?: number } = {}
): string | null
{
  if (typeof value !== 'string')
  {
    issue(issues, path, 'invalid-type', 'expected a string')
    return null
  }
  const minLength = options.minLength ?? 0
  const maxLength = options.maxLength ?? MAX_MULTIMODAL_STRING_LENGTH
  if (value.length < minLength || value.length > maxLength)
  {
    issue(
      issues,
      path,
      'limit-exceeded',
      `string length must be ${minLength}..${maxLength}`
    )
    return null
  }
  return value
}

export function multimodalFiniteNumber(
  value: unknown,
  path: string,
  issues: MultimodalContractIssue[],
  options: { min?: number; max?: number; integer?: boolean } = {}
): number | null
{
  if (typeof value !== 'number' || !Number.isFinite(value))
  {
    issue(issues, path, 'invalid-type', 'expected a finite number')
    return null
  }
  if (options.integer && !Number.isInteger(value))
  {
    issue(issues, path, 'invalid-value', 'expected an integer')
    return null
  }
  if (
    (options.min !== undefined && value < options.min) ||
    (options.max !== undefined && value > options.max)
  )
  {
    issue(
      issues,
      path,
      'invalid-value',
      `number must be within ${options.min ?? '-infinity'}..${options.max ?? 'infinity'}`
    )
    return null
  }
  return Object.is(value, -0) ? 0 : value
}

export function multimodalArray(
  value: unknown,
  path: string,
  issues: MultimodalContractIssue[],
  options: { minLength?: number; maxLength?: number } = {}
): unknown[] | null
{
  if (!Array.isArray(value))
  {
    issue(issues, path, 'invalid-type', 'expected an array')
    return null
  }
  const minLength = options.minLength ?? 0
  const maxLength = options.maxLength ?? MAX_MULTIMODAL_ARRAY_LENGTH
  if (value.length < minLength || value.length > maxLength)
  {
    issue(
      issues,
      path,
      'limit-exceeded',
      `array length must be ${minLength}..${maxLength}`
    )
    return null
  }
  for (let index = 0; index < value.length; index++)
  {
    if (!(index in value))
      issue(
        issues,
        `${path}[${index}]`,
        'invalid-value',
        'sparse arrays are not allowed'
      )
  }
  return value
}

function canonicalJsonValue(
  value: unknown,
  path: string,
  stack: WeakSet<object>,
  state: { nodes: number }
): string
{
  state.nodes++
  if (state.nodes > 100_000)
    throw new Error('Multimodal record has too many values')
  if (value === null) return 'null'
  if (typeof value === 'string' || typeof value === 'boolean')
    return JSON.stringify(value)
  if (typeof value === 'number')
  {
    if (!Number.isFinite(value))
      throw new Error(`Multimodal record has a non-finite number at ${path}`)
    return JSON.stringify(Object.is(value, -0) ? 0 : value)
  }
  if (typeof value !== 'object')
    throw new Error(`Multimodal record has a non-JSON value at ${path}`)
  if (stack.has(value))
    throw new Error(`Multimodal record is cyclic at ${path}`)
  stack.add(value)
  let result: string
  if (Array.isArray(value))
  {
    if (value.length > MAX_MULTIMODAL_ARRAY_LENGTH)
      throw new Error(`Multimodal array exceeds its bound at ${path}`)
    for (const key of Reflect.ownKeys(value))
    {
      if (key === 'length') continue
      if (
        typeof key !== 'string' ||
        !/^(0|[1-9]\d*)$/.test(key) ||
        Number(key) >= value.length
      )
        throw new Error(`Multimodal array has a non-index key at ${path}`)
      const descriptor = Object.getOwnPropertyDescriptor(value, key)
      if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value'))
        throw new Error(`Multimodal array has an accessor at ${path}[${key}]`)
    }
    const entries: string[] = []
    for (let index = 0; index < value.length; index++)
    {
      if (!(index in value))
        throw new Error(`Multimodal record has a sparse array at ${path}`)
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index))
      if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value'))
        throw new Error(`Multimodal array has an accessor at ${path}[${index}]`)
      entries.push(
        canonicalJsonValue(descriptor.value, `${path}[${index}]`, stack, state)
      )
    }
    result = `[${entries.join(',')}]`
  }
  else
  {
    const prototype = Object.getPrototypeOf(value)
    if (prototype !== Object.prototype && prototype !== null)
      throw new Error(`Multimodal record has a non-plain object at ${path}`)
    const record = value as MultimodalRecord
    const keys = Reflect.ownKeys(record)
    if (keys.some((key) => typeof key !== 'string'))
      throw new Error(`Multimodal record has a symbol key at ${path}`)
    const entries = (keys as string[]).sort().map((key) =>
    {
      const descriptor = Object.getOwnPropertyDescriptor(record, key)
      if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value'))
        throw new Error(`Multimodal record has an accessor at ${path}.${key}`)
      if (descriptor.value === undefined)
        throw new Error(`Multimodal record has undefined at ${path}.${key}`)
      return `${JSON.stringify(key)}:${canonicalJsonValue(descriptor.value, `${path}.${key}`, stack, state)}`
    })
    result = `{${entries.join(',')}}`
  }
  stack.delete(value)
  return result
}

export function canonicalMultimodalJson(value: unknown): string
{
  const json = canonicalJsonValue(value, '$', new WeakSet(), { nodes: 0 })
  if (Buffer.byteLength(json, 'utf8') > MAX_MULTIMODAL_JSON_BYTES)
    throw new Error('Multimodal record exceeds its serialized byte bound')
  return json
}

export function hashMultimodalContent(value: Uint8Array | string): string
{
  return sha256(value)
}

export function hashMultimodalJson(value: unknown): string
{
  return hashMultimodalContent(canonicalMultimodalJson(value))
}

function freezeJson(value: unknown): void
{
  if (value === null || typeof value !== 'object') return
  if (ArrayBuffer.isView(value)) return
  for (const child of Object.values(value)) freezeJson(child)
  Object.freeze(value)
}

export function detachedFrozenMultimodalRecord<T>(value: T): Readonly<T>
{
  canonicalMultimodalJson(value)
  const detached = structuredClone(value)
  canonicalMultimodalJson(detached)
  freezeJson(detached)
  return detached
}

function validateRegion(
  value: unknown,
  path: string,
  issues: MultimodalContractIssue[]
): void
{
  const record = multimodalRecord(value, path, issues)
  if (!record) return
  multimodalExactKeys(record, path, ['x', 'y', 'width', 'height'], [], issues)
  const x = multimodalFiniteNumber(record.x, `${path}.x`, issues, {
    min: 0,
    max: 1,
  })
  const y = multimodalFiniteNumber(record.y, `${path}.y`, issues, {
    min: 0,
    max: 1,
  })
  const width = multimodalFiniteNumber(record.width, `${path}.width`, issues, {
    min: Number.EPSILON,
    max: 1,
  })
  const height = multimodalFiniteNumber(
    record.height,
    `${path}.height`,
    issues,
    {
      min: Number.EPSILON,
      max: 1,
    }
  )
  if (x !== null && width !== null && x + width > 1)
    issue(issues, path, 'invalid-value', 'region exceeds the normalized width')
  if (y !== null && height !== null && y + height > 1)
    issue(issues, path, 'invalid-value', 'region exceeds the normalized height')
}

function validateLocator(
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
    ['evidenceId', 'frameId', 'tick', 'region'],
    [],
    issues
  )
  multimodalString(record.evidenceId, `${path}.evidenceId`, issues, {
    minLength: 1,
    maxLength: 256,
  })
  multimodalString(record.frameId, `${path}.frameId`, issues, {
    minLength: 1,
    maxLength: 256,
  })
  multimodalFiniteNumber(record.tick, `${path}.tick`, issues, {
    min: 0,
    integer: true,
  })
  if (record.region !== null)
    validateRegion(record.region, `${path}.region`, issues)
}

export function validateMultimodalEvidenceLocator(
  value: unknown
): MultimodalValidationResult<MultimodalEvidenceLocator>
{
  const issues: MultimodalContractIssue[] = []
  validateLocator(value, '$', issues)
  if (issues.length > 0) return { ok: false, issues }
  return {
    ok: true,
    value: detachedFrozenMultimodalRecord(value as MultimodalEvidenceLocator),
  }
}

function validateSubject(
  value: unknown,
  path: string,
  issues: MultimodalContractIssue[]
): void
{
  const record = multimodalRecord(value, path, issues)
  if (!record) return
  const kind = multimodalString(record.kind, `${path}.kind`, issues, {
    minLength: 1,
    maxLength: 32,
  })
  if (kind === 'sprite')
  {
    multimodalExactKeys(record, path, ['kind', 'name'], [], issues)
    multimodalString(record.name, `${path}.name`, issues, {
      minLength: 1,
      maxLength: 256,
    })
  }
  else if (kind === 'monitor')
  {
    multimodalExactKeys(
      record,
      path,
      ['kind', 'targetName', 'declarationName'],
      [],
      issues
    )
    if (record.targetName !== null)
      multimodalString(record.targetName, `${path}.targetName`, issues, {
        minLength: 1,
        maxLength: 256,
      })
    multimodalString(
      record.declarationName,
      `${path}.declarationName`,
      issues,
      {
        minLength: 1,
        maxLength: 256,
      }
    )
  }
  else if (kind === 'stage' || kind === 'unknown')
  {
    multimodalExactKeys(record, path, ['kind'], [], issues)
  }
  else if (kind !== null)
  {
    issue(
      issues,
      `${path}.kind`,
      'invalid-value',
      'unknown symptom subject kind'
    )
  }
}

export function validateVisualSymptom(
  value: unknown
): MultimodalValidationResult<VisualSymptom>
{
  const issues: MultimodalContractIssue[] = []
  const record = multimodalRecord(value, '$', issues)
  if (record)
  {
    multimodalExactKeys(
      record,
      '$',
      ['id', 'kind', 'subject', 'assetName', 'description', 'evidence'],
      [],
      issues
    )
    multimodalString(record.id, '$.id', issues, {
      minLength: 1,
      maxLength: 128,
    })
    const kind = multimodalString(record.kind, '$.kind', issues, {
      minLength: 1,
      maxLength: 32,
    })
    if (
      kind !== null &&
      ![
        'appearance',
        'motion',
        'layout',
        'text',
        'monitor',
        'temporal',
      ].includes(kind)
    )
      issue(issues, '$.kind', 'invalid-value', 'unknown visual symptom kind')
    validateSubject(record.subject, '$.subject', issues)
    if (record.assetName !== null)
      multimodalString(record.assetName, '$.assetName', issues, {
        minLength: 1,
        maxLength: 256,
      })
    multimodalString(record.description, '$.description', issues, {
      minLength: 1,
      maxLength: 2048,
    })
    const evidence = multimodalArray(record.evidence, '$.evidence', issues, {
      minLength: 1,
      maxLength: 32,
    })
    evidence?.forEach((locator, index) =>
      validateLocator(locator, `$.evidence[${index}]`, issues)
    )
  }
  if (issues.length > 0) return { ok: false, issues }
  return {
    ok: true,
    value: detachedFrozenMultimodalRecord(value as VisualSymptom),
  }
}
