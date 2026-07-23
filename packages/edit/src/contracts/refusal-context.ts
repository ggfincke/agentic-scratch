// packages/edit/src/contracts/refusal-context.ts
// frozen refusal-context validation before durable outcome retention

import {
  REFUSAL_CODES,
  refusalErrorSchemaModel,
  validateSchemaValue,
  type RefusalCode,
  type RefusalContextV1,
} from '@scratch-agent/ir/edit'

const REFUSAL_CODE_SET = new Set<string>(REFUSAL_CODES)

interface FrozenRefusalResultV1
{
  readonly code: RefusalCode
  readonly safeMessage: string
  readonly context: RefusalContextV1
}

export function assertFrozenRefusalResultV1(
  expectedCode: unknown,
  result: unknown
): asserts result is FrozenRefusalResultV1
{
  if (typeof expectedCode !== 'string' || !REFUSAL_CODE_SET.has(expectedCode))
    throw new Error('retained refusal has no frozen refusal code')
  const record =
    result !== null && typeof result === 'object'
      ? (result as Record<string, unknown>)
      : null
  const projection = {
    code: record?.['code'],
    safeMessage: record?.['safeMessage'],
    context: record?.['context'],
  }
  const validation = validateSchemaValue(
    refusalErrorSchemaModel(expectedCode as RefusalCode),
    projection
  )
  if (validation.ok) return
  const issue = validation.issues[0]
  throw new Error(
    `retained refusal ${expectedCode} violates its frozen context schema${
      issue === undefined ? '' : ` at ${issue.path || '$'}: ${issue.message}`
    }`
  )
}
