// packages/ir/src/edit/procedure-mutation.ts
// bounded strict parsing for edit-owned custom-procedure mutation arrays

import {
  DEFAULT_EDIT_ADMISSION_LIMITS,
  STRICT_JSON_CODES,
  StrictJsonScanError,
  isBlockEntry,
  scanStrictJson,
  type EditAdmissionLimits,
  type Mutation,
  type ProjectJson,
  type ScalarVal,
} from '@scratch-agent/sb3'

import { jsonPointerPart as pointerPart } from '../project/project-vocabulary.js'
import { ownRecordEntries, ownRecordKeys } from './own-record.js'

type ProcedureMutationArrayField =
  'argumentids' | 'argumentnames' | 'argumentdefaults'

type StrictProcedureMutationValue = ScalarVal

interface StrictProcedureMutationLimits
{
  maximumArrayBytes: number
  maximumItems: number
}

interface StrictProcedureMutationArrays
{
  argumentIds: readonly string[]
  argumentNames: readonly string[]
  argumentDefaults: readonly StrictProcedureMutationValue[]
}

export const DEFAULT_STRICT_PROCEDURE_MUTATION_LIMITS = {
  maximumArrayBytes:
    DEFAULT_EDIT_ADMISSION_LIMITS.maxProcedureMutationStringBytes,
  maximumItems:
    DEFAULT_EDIT_ADMISSION_LIMITS.maxProcedureParametersPerProcedure,
} as const satisfies StrictProcedureMutationLimits

type StrictProcedureMutationErrorCode =
  | 'missing'
  | 'byte-limit'
  | 'invalid-json'
  | 'not-array'
  | 'item-limit'
  | 'invalid-item'
  | 'misaligned'
  | 'placeholder-mismatch'

export class StrictProcedureMutationError extends Error
{
  constructor(
    readonly code: StrictProcedureMutationErrorCode,
    readonly field: ProcedureMutationArrayField | 'procedure',
    message: string
  )
  {
    super(message)
    this.name = 'StrictProcedureMutationError'
  }
}

const UTF8 = new TextEncoder()

function assertLimit(value: number, name: string): void
{
  if (!Number.isSafeInteger(value) || value < 0)
  {
    throw new RangeError(`${name} must be a nonnegative safe integer`)
  }
}

export function parseMutationArray(value: string | undefined): string[] | null
{
  if (typeof value !== 'string') return null
  try
  {
    const parsed: unknown = JSON.parse(value)
    if (!Array.isArray(parsed)) return null
    return parsed.map((entry) => String(entry))
  }
  catch
  {
    return null
  }
}

export function parseStrictEditMutationArray(
  value: string | undefined,
  field: ProcedureMutationArrayField,
  limits: StrictProcedureMutationLimits
): readonly StrictProcedureMutationValue[]
{
  assertLimit(limits.maximumArrayBytes, 'maximumArrayBytes')
  assertLimit(limits.maximumItems, 'maximumItems')
  if (value === undefined)
  {
    throw new StrictProcedureMutationError(
      'missing',
      field,
      `${field} is required`
    )
  }
  const bytes = UTF8.encode(value).byteLength
  if (bytes > limits.maximumArrayBytes)
  {
    throw new StrictProcedureMutationError(
      'byte-limit',
      field,
      `${field} exceeds its byte limit`
    )
  }
  let parsed: unknown
  try
  {
    parsed = scanStrictJson(value, {
      maxDepth: 1,
      maxMembersPerContainer: limits.maximumItems,
      maxNodes: Math.min(limits.maximumItems + 1, Number.MAX_SAFE_INTEGER),
    }).value
  }
  catch (error)
  {
    const limitExceeded =
      error instanceof StrictJsonScanError &&
      (error.code === STRICT_JSON_CODES.membersExceeded ||
        error.code === STRICT_JSON_CODES.nodesExceeded)
    throw new StrictProcedureMutationError(
      limitExceeded ? 'item-limit' : 'invalid-json',
      field,
      limitExceeded
        ? `${field} exceeds its item limit`
        : `${field} is not valid JSON`
    )
  }
  if (!Array.isArray(parsed))
  {
    throw new StrictProcedureMutationError(
      'not-array',
      field,
      `${field} must encode an array`
    )
  }
  if (parsed.length > limits.maximumItems)
  {
    throw new StrictProcedureMutationError(
      'item-limit',
      field,
      `${field} exceeds its item limit`
    )
  }
  const accepts =
    field === 'argumentdefaults'
      ? (entry: unknown): entry is StrictProcedureMutationValue =>
          typeof entry === 'string' ||
          typeof entry === 'number' ||
          typeof entry === 'boolean'
      : (entry: unknown): entry is string => typeof entry === 'string'
  if (!parsed.every(accepts))
  {
    throw new StrictProcedureMutationError(
      'invalid-item',
      field,
      `${field} contains an invalid item`
    )
  }
  return Object.freeze([...parsed] as StrictProcedureMutationValue[])
}

export function procedurePlaceholderKinds(
  proccode: string
): ('s' | 'b' | 'n')[]
{
  const kinds: ('s' | 'b' | 'n')[] = []
  const components = proccode
    .split(/(?=[^\\]%[nbs])/u)
    .map((component) => component.trim())
  for (const component of components)
  {
    if (!component.startsWith('%')) continue
    const kind = component[1]
    if (kind === 's' || kind === 'b' || kind === 'n')
    {
      kinds.push(kind)
    }
  }
  return kinds
}

export function parseStrictEditProcedureMutation(
  mutation: Mutation,
  limits: StrictProcedureMutationLimits
): StrictProcedureMutationArrays
{
  const argumentIds = parseStrictEditMutationArray(
    mutation.argumentids,
    'argumentids',
    limits
  ) as readonly string[]
  const argumentNames = parseStrictEditMutationArray(
    mutation.argumentnames,
    'argumentnames',
    limits
  ) as readonly string[]
  const argumentDefaults = parseStrictEditMutationArray(
    mutation.argumentdefaults,
    'argumentdefaults',
    limits
  )
  if (
    argumentIds.length !== argumentNames.length ||
    argumentIds.length !== argumentDefaults.length
  )
  {
    throw new StrictProcedureMutationError(
      'misaligned',
      'procedure',
      'procedure mutation arrays must have equal lengths'
    )
  }
  const placeholders =
    typeof mutation.proccode === 'string'
      ? procedurePlaceholderKinds(mutation.proccode)
      : []
  if (
    typeof mutation.proccode !== 'string' ||
    placeholders.length !== argumentIds.length
  )
  {
    throw new StrictProcedureMutationError(
      'placeholder-mismatch',
      'procedure',
      'procedure placeholders must align with mutation arrays'
    )
  }
  for (let index = 0; index < argumentDefaults.length; index++)
  {
    const placeholder = placeholders[index]
    const value = argumentDefaults[index]
    const compatible =
      placeholder === 'b'
        ? typeof value === 'boolean'
        : typeof value === 'string' || typeof value === 'number'
    if (!compatible)
      throw new StrictProcedureMutationError(
        'invalid-item',
        'argumentdefaults',
        `argument default ${index} does not match %${placeholder}`
      )
  }
  if (new Set(argumentIds).size !== argumentIds.length)
    throw new StrictProcedureMutationError(
      'invalid-item',
      'argumentids',
      'procedure argument IDs must be unique'
    )
  return { argumentIds, argumentNames, argumentDefaults }
}

export interface KnownProcedureMutationRecord
{
  targetIndex: number
  blockId: string
  role: 'prototype' | 'call'
  proccode: string
  argumentIds: readonly string[]
  argumentNames?: readonly string[]
  argumentDefaults?: readonly StrictProcedureMutationValue[]
}

interface ProcedureMutationMetrics
{
  arrayStrings: number
  encodedBytes: number
  procedures: number
  parameters: number
}

export interface ProcedureMutationAdmission
{
  records: readonly KnownProcedureMutationRecord[]
  metrics: ProcedureMutationMetrics
}

class ProcedureMutationAdmissionError extends Error
{
  constructor(
    readonly path: string,
    message: string,
    options: ErrorOptions = {}
  )
  {
    super(`${path}: ${message}`, options)
    this.name = 'ProcedureMutationAdmissionError'
  }
}

function mutationPath(targetIndex: number, blockId: string): string
{
  return `$/targets/${targetIndex}/blocks/${pointerPart(blockId)}/mutation`
}

function chargeMutationString(
  value: string | undefined,
  path: string,
  limits: EditAdmissionLimits,
  metrics: ProcedureMutationMetrics
): void
{
  if (value === undefined)
  {
    throw new ProcedureMutationAdmissionError(path, 'required field is missing')
  }
  const bytes = UTF8.encode(value).byteLength
  if (bytes > limits.maxProcedureMutationStringBytes)
  {
    throw new ProcedureMutationAdmissionError(
      path,
      `encoded array exceeds ${limits.maxProcedureMutationStringBytes} bytes`
    )
  }
  metrics.arrayStrings++
  metrics.encodedBytes += bytes
  if (metrics.encodedBytes > limits.maxProcedureMutationStringsTotalBytes)
  {
    throw new ProcedureMutationAdmissionError(
      path,
      `aggregate encoded mutation bytes exceed ${limits.maxProcedureMutationStringsTotalBytes}`
    )
  }
}

function strictLimits(
  limits: EditAdmissionLimits
): StrictProcedureMutationLimits
{
  return {
    maximumArrayBytes: limits.maxProcedureMutationStringBytes,
    maximumItems: limits.maxProcedureParametersPerProcedure,
  }
}

export function parseKnownProcedureMutations(
  project: ProjectJson,
  limits: EditAdmissionLimits
): ProcedureMutationAdmission
{
  const records: KnownProcedureMutationRecord[] = []
  const metrics: ProcedureMutationMetrics = {
    arrayStrings: 0,
    encodedBytes: 0,
    procedures: 0,
    parameters: 0,
  }
  for (const [targetIndex, target] of project.targets.entries())
  {
    for (const [blockId, entry] of ownRecordEntries(target.blocks))
    {
      if (!isBlockEntry(entry)) continue
      if (
        entry.opcode !== 'procedures_prototype' &&
        entry.opcode !== 'procedures_call'
      )
      {
        continue
      }
      const path = mutationPath(targetIndex, blockId)
      const mutation = entry.mutation
      if (!mutation || typeof mutation.proccode !== 'string')
      {
        throw new ProcedureMutationAdmissionError(
          path,
          'known procedure record requires a proccode mutation'
        )
      }
      chargeMutationString(
        mutation.argumentids,
        `${path}/argumentids`,
        limits,
        metrics
      )
      try
      {
        if (entry.opcode === 'procedures_prototype')
        {
          chargeMutationString(
            mutation.argumentnames,
            `${path}/argumentnames`,
            limits,
            metrics
          )
          chargeMutationString(
            mutation.argumentdefaults,
            `${path}/argumentdefaults`,
            limits,
            metrics
          )
          const parsed = parseStrictEditProcedureMutation(
            mutation,
            strictLimits(limits)
          )
          metrics.procedures++
          metrics.parameters += parsed.argumentIds.length
          if (metrics.parameters > limits.maxProcedureParametersTotal)
          {
            throw new ProcedureMutationAdmissionError(
              path,
              `aggregate parameter count exceeds ${limits.maxProcedureParametersTotal}`
            )
          }
          records.push({
            targetIndex,
            blockId,
            role: 'prototype',
            proccode: mutation.proccode,
            argumentIds: parsed.argumentIds,
            argumentNames: parsed.argumentNames,
            argumentDefaults: parsed.argumentDefaults,
          })
          continue
        }
        const argumentIds = parseStrictEditMutationArray(
          mutation.argumentids,
          'argumentids',
          strictLimits(limits)
        ) as readonly string[]
        if (new Set(argumentIds).size !== argumentIds.length)
        {
          throw new StrictProcedureMutationError(
            'invalid-item',
            'argumentids',
            'procedure argument IDs must be unique'
          )
        }
        const inputKeys = ownRecordKeys(entry.inputs).sort()
        const sortedIds = [...argumentIds].sort()
        if (
          inputKeys.length !== sortedIds.length ||
          inputKeys.some((key, index) => key !== sortedIds[index])
        )
        {
          throw new StrictProcedureMutationError(
            'misaligned',
            'procedure',
            'call input keys must exactly equal mutation argument IDs'
          )
        }
        records.push({
          targetIndex,
          blockId,
          role: 'call',
          proccode: mutation.proccode,
          argumentIds,
        })
      }
      catch (cause)
      {
        if (cause instanceof ProcedureMutationAdmissionError) throw cause
        throw new ProcedureMutationAdmissionError(
          path,
          cause instanceof Error ? cause.message : String(cause),
          { cause }
        )
      }
    }
  }
  return { records, metrics }
}
