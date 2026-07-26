// packages/ir/src/edit/contracts/parser.ts
// immutable structural-first parser for public semantic edit contracts

import type {
  EditScenarioPolicyV1,
  EditSemanticChangeContractV1,
  SemanticEditBatchV1,
  TransportRequestHashProjectionV1,
} from '../contracts.generated.js'
import type { EditToolName } from './contract-data.js'
import {
  contractDefinitionSchemaModel,
  toolInputSchemaModel,
} from './contract-model.js'
import {
  validateSchemaValue,
  type SchemaModel,
  type SchemaValidationIssue,
} from './schema-model.js'
import {
  validateEditScenarioPolicy,
  validateSemanticChangeContract,
  validateSemanticEditBatch,
  type SemanticValidationIssue,
  type SemanticValidationResult,
} from './semantic-validation.js'

export type SemanticEditParseIssue =
  | {
      readonly phase: 'structural'
      readonly issue: SchemaValidationIssue
    }
  | {
      readonly phase: 'semantic'
      readonly issue: SemanticValidationIssue
    }

type SemanticEditParseResult<T> =
  | { readonly ok: true; readonly value: T }
  | {
      readonly ok: false
      readonly issues: readonly SemanticEditParseIssue[]
      readonly truncated: boolean
    }

export type EditToolRequestForV1<Name extends EditToolName> = Extract<
  TransportRequestHashProjectionV1,
  { readonly tool: Name }
>['request']

type SemanticValidator = (value: unknown) => SemanticValidationResult

function immutableDescriptorCopy(value: unknown): unknown
{
  if (Array.isArray(value))
  {
    const copy: unknown[] = []

    for (const key of Reflect.ownKeys(value))
    {
      if (key === 'length') continue
      if (
        typeof key !== 'string' ||
        !/^(0|[1-9]\d*)$/u.test(key) ||
        !Number.isSafeInteger(Number(key)) ||
        Number(key) < 0 ||
        Number(key) >= value.length ||
        String(Number(key)) !== key
      )
      {
        throw new TypeError('validated array contains an unknown own key')
      }
    }

    for (let index = 0; index < value.length; index += 1)
    {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index))

      if (descriptor === undefined || !('value' in descriptor))
      {
        throw new TypeError('validated array lost an own data property')
      }

      copy.push(immutableDescriptorCopy(descriptor.value))
    }

    return Object.freeze(copy)
  }

  if (value !== null && typeof value === 'object')
  {
    const copy = Object.create(null) as Record<string, unknown>

    for (const key of Object.getOwnPropertyNames(value).sort())
    {
      const descriptor = Object.getOwnPropertyDescriptor(value, key)

      if (descriptor === undefined || !('value' in descriptor))
      {
        throw new TypeError('validated object lost an own data property')
      }

      Object.defineProperty(copy, key, {
        configurable: false,
        enumerable: true,
        value: immutableDescriptorCopy(descriptor.value),
        writable: false,
      })
    }

    return Object.freeze(copy)
  }

  return value
}

function parseWithModel<T>(
  model: SchemaModel,
  input: unknown,
  semanticValidator?: SemanticValidator
): SemanticEditParseResult<T>
{
  const structural = validateSchemaValue(model, input)

  if (!structural.ok)
  {
    return Object.freeze({
      ok: false,
      issues: Object.freeze(
        structural.issues.map((issue) =>
          Object.freeze({ phase: 'structural' as const, issue })
        )
      ),
      truncated: structural.truncated,
    })
  }

  const value = immutableDescriptorCopy(input)
  const copiedStructural = validateSchemaValue(model, value)

  if (!copiedStructural.ok)
  {
    return Object.freeze({
      ok: false,
      issues: Object.freeze(
        copiedStructural.issues.map((issue) =>
          Object.freeze({ phase: 'structural' as const, issue })
        )
      ),
      truncated: copiedStructural.truncated,
    })
  }

  const semantic = semanticValidator?.(value)

  if (semantic !== undefined && !semantic.valid)
  {
    return Object.freeze({
      ok: false,
      issues: Object.freeze(
        semantic.issues.map((issue) =>
          Object.freeze({
            phase: 'semantic' as const,
            issue: Object.freeze({ ...issue }),
          })
        )
      ),
      truncated: false,
    })
  }

  return Object.freeze({ ok: true, value: value as T })
}

function validateToolInputSemantics(
  name: EditToolName,
  value: unknown
): SemanticValidationResult
{
  if (name !== 'edit_preview')
  {
    return Object.freeze({ valid: true, issues: Object.freeze([]) })
  }

  const record = value as Readonly<Record<string, unknown>>
  return validateSemanticEditBatch(record.batch)
}

export function parseContractDefinitionV1<T = unknown>(
  definitionName: string,
  input: unknown
): SemanticEditParseResult<T>
{
  return parseWithModel(contractDefinitionSchemaModel(definitionName), input)
}

export function parseEditToolInputV1<Name extends EditToolName>(
  name: Name,
  input: unknown
): SemanticEditParseResult<EditToolRequestForV1<Name>>
{
  return parseWithModel<EditToolRequestForV1<Name>>(
    toolInputSchemaModel(name),
    input,
    (value) => validateToolInputSemantics(name, value)
  )
}

export function parseSemanticChangeContractV1(
  input: unknown
): SemanticEditParseResult<EditSemanticChangeContractV1>
{
  return parseWithModel(
    contractDefinitionSchemaModel('EditSemanticChangeContractV1'),
    input,
    validateSemanticChangeContract
  )
}

export function parseEditScenarioPolicyV1(
  input: unknown
): SemanticEditParseResult<EditScenarioPolicyV1>
{
  return parseWithModel(
    contractDefinitionSchemaModel('EditScenarioPolicyV1'),
    input,
    validateEditScenarioPolicy
  )
}

export function parseSemanticEditBatchV1(
  input: unknown
): SemanticEditParseResult<SemanticEditBatchV1>
{
  return parseWithModel(
    contractDefinitionSchemaModel('SemanticEditBatchV1'),
    input,
    validateSemanticEditBatch
  )
}
