// packages/ir/src/repair/repair-schema.ts
// validate untrusted semantic repair payloads before graph access

import { Buffer } from 'node:buffer'

import {
  DEFAULT_REPAIR_RESOURCE_LIMITS,
  type BlockRef,
  type BroadcastRef,
  type DeclarationRef,
  type ReferenceSite,
  type RepairBlockSpec,
  type RepairField,
  type RepairInput,
  type RepairLiteral,
  type RepairOp,
  type RepairResourceLimits,
  type RepairViolation,
  type SemanticPatch,
  type TargetRef,
  type VariableRef,
} from './repair-types.js'
import { isRepairLiteralKind } from './repair-literal-catalog.js'
import {
  isTargetProperty,
  isTargetPropertyValue,
  TARGET_PROPERTY_DESCRIPTORS,
} from '../project/target-properties.js'

interface SemanticPatchParseSuccess
{
  ok: true
  patch: SemanticPatch
  proposalBytes: number
  newBlockCount: number
}

interface SemanticPatchParseFailure
{
  ok: false
  violations: RepairViolation[]
}

type SemanticPatchParseResult =
  SemanticPatchParseSuccess | SemanticPatchParseFailure

class PayloadError extends Error
{
  constructor(
    readonly path: string,
    message: string,
    readonly code: 'invalid-payload' | 'resource-limit' = 'invalid-payload'
  )
  {
    super(message)
  }
}

function objectAt(value: unknown, path: string): Record<string, unknown>
{
  if (value === null || typeof value !== 'object' || Array.isArray(value))
  {
    throw new PayloadError(path, 'expected an object')
  }
  const prototype = Object.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== null)
  {
    throw new PayloadError(path, 'expected a plain JSON object')
  }
  return value as Record<string, unknown>
}

function arrayAt(value: unknown, path: string): unknown[]
{
  if (!Array.isArray(value)) throw new PayloadError(path, 'expected an array')
  return value
}

function stringAt(value: unknown, path: string, allowEmpty = false): string
{
  if (typeof value !== 'string' || (!allowEmpty && value.length === 0))
  {
    throw new PayloadError(path, 'expected a nonempty string')
  }
  return value
}

function integerAt(value: unknown, path: string): number
{
  if (!Number.isSafeInteger(value) || Number(value) < 0)
  {
    throw new PayloadError(path, 'expected a nonnegative safe integer')
  }
  return Number(value)
}

function exactKeys(
  object: Record<string, unknown>,
  required: readonly string[],
  optional: readonly string[],
  path: string
): void
{
  const allowed = new Set([...required, ...optional])
  for (const key of Object.keys(object))
  {
    if (!allowed.has(key))
    {
      throw new PayloadError(`${path}/${key}`, 'unknown field')
    }
  }
  for (const key of required)
  {
    if (!Object.hasOwn(object, key))
    {
      throw new PayloadError(`${path}/${key}`, 'missing required field')
    }
  }
}

function resolveResourceLimits(
  limits: Partial<RepairResourceLimits>
): RepairResourceLimits
{
  const resolved = { ...DEFAULT_REPAIR_RESOURCE_LIMITS, ...limits }
  for (const [key, value] of Object.entries(resolved))
  {
    if (!Number.isSafeInteger(value) || value <= 0)
    {
      throw new PayloadError(
        `/limits/${key}`,
        'limit must be a positive integer'
      )
    }
    const hardMaximum =
      DEFAULT_REPAIR_RESOURCE_LIMITS[key as keyof RepairResourceLimits]
    if (value > hardMaximum)
    {
      throw new PayloadError(
        `/limits/${key}`,
        `limit cannot exceed hard maximum ${hardMaximum}`
      )
    }
  }
  return resolved
}

function inspectResources(
  value: unknown,
  limits: RepairResourceLimits,
  path = '',
  depth = 0,
  seen = new Set<object>()
): void
{
  if (depth > limits.maxDepth)
  {
    throw new PayloadError(
      path,
      `nesting exceeds ${limits.maxDepth}`,
      'resource-limit'
    )
  }
  if (typeof value === 'string')
  {
    if (Buffer.byteLength(value, 'utf8') > limits.maxStringBytes)
    {
      throw new PayloadError(
        path,
        `string exceeds ${limits.maxStringBytes} UTF-8 bytes`,
        'resource-limit'
      )
    }
    return
  }
  if (
    value === null ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  )
  {
    if (typeof value === 'number' && !Number.isFinite(value))
    {
      throw new PayloadError(path, 'numbers must be finite')
    }
    return
  }
  if (typeof value !== 'object')
  {
    throw new PayloadError(path, 'payload must contain JSON values only')
  }
  if (seen.has(value)) throw new PayloadError(path, 'cyclic payload')
  seen.add(value)
  if (Array.isArray(value))
  {
    if (value.length > limits.maxMembers)
    {
      throw new PayloadError(
        path,
        `array exceeds ${limits.maxMembers} members`,
        'resource-limit'
      )
    }
    value.forEach((entry, index) =>
      inspectResources(entry, limits, `${path}/${index}`, depth + 1, seen)
    )
  }
  else
  {
    const object = objectAt(value, path)
    const entries = Object.entries(object)
    if (entries.length > limits.maxMembers)
    {
      throw new PayloadError(
        path,
        `object exceeds ${limits.maxMembers} members`,
        'resource-limit'
      )
    }
    for (const [key, entry] of entries)
    {
      inspectResources(key, limits, `${path}/${key}`, depth + 1, seen)
      inspectResources(entry, limits, `${path}/${key}`, depth + 1, seen)
    }
  }
  seen.delete(value)
}

function parseTargetRef(value: unknown, path: string): TargetRef
{
  const object = objectAt(value, path)
  exactKeys(object, ['targetIndex', 'name', 'isStage'], [], path)
  if (typeof object.isStage !== 'boolean')
  {
    throw new PayloadError(`${path}/isStage`, 'expected a boolean')
  }
  return {
    targetIndex: integerAt(object.targetIndex, `${path}/targetIndex`),
    name: stringAt(object.name, `${path}/name`),
    isStage: object.isStage,
  }
}

function parseBlockRef(value: unknown, path: string): BlockRef
{
  const object = objectAt(value, path)
  exactKeys(object, ['target', 'blockId'], [], path)
  return {
    target: parseTargetRef(object.target, `${path}/target`),
    blockId: stringAt(object.blockId, `${path}/blockId`),
  }
}

function parseDeclarationRef(
  value: unknown,
  path: string,
  expected?: DeclarationRef['kind']
): DeclarationRef
{
  const object = objectAt(value, path)
  exactKeys(object, ['kind', 'declarationTarget', 'id', 'name'], [], path)
  const kind = stringAt(object.kind, `${path}/kind`)
  if (kind !== 'variable' && kind !== 'list' && kind !== 'broadcast')
  {
    throw new PayloadError(`${path}/kind`, 'unknown declaration kind')
  }
  if (expected && kind !== expected)
  {
    throw new PayloadError(`${path}/kind`, `expected ${expected}`)
  }
  const ref = {
    kind,
    declarationTarget: parseTargetRef(
      object.declarationTarget,
      `${path}/declarationTarget`
    ),
    id: stringAt(object.id, `${path}/id`),
    name: stringAt(object.name, `${path}/name`),
  }
  return ref as DeclarationRef
}

function parseLiteral(value: unknown, path: string): RepairLiteral
{
  const object = objectAt(value, path)
  exactKeys(object, ['kind', 'value'], [], path)
  const kind = stringAt(object.kind, `${path}/kind`)
  if (!isRepairLiteralKind(kind))
  {
    throw new PayloadError(`${path}/kind`, 'unknown literal kind')
  }
  if (typeof object.value !== 'string' && typeof object.value !== 'number')
  {
    throw new PayloadError(`${path}/value`, 'expected a string or number')
  }
  if (typeof object.value === 'number' && !Number.isFinite(object.value))
  {
    throw new PayloadError(`${path}/value`, 'number must be finite')
  }
  return { kind, value: object.value } as RepairLiteral
}

function parseInput(
  value: unknown,
  path: string,
  countBlock: () => void
): RepairInput
{
  const object = objectAt(value, path)
  const kind = stringAt(object.kind, `${path}/kind`)
  if (isRepairLiteralKind(kind))
  {
    return parseLiteral(object, path)
  }
  if (kind === 'variable' || kind === 'list' || kind === 'broadcast')
  {
    return parseDeclarationRef(object, path)
  }
  if (kind === 'reporter' || kind === 'boolean')
  {
    exactKeys(object, ['kind', 'block'], [], path)
    return {
      kind,
      block: parseBlockSpec(object.block, `${path}/block`, countBlock),
    }
  }
  if (kind === 'substack')
  {
    exactKeys(object, ['kind', 'blocks'], [], path)
    return {
      kind,
      blocks: arrayAt(object.blocks, `${path}/blocks`).map((block, index) =>
        parseBlockSpec(block, `${path}/blocks/${index}`, countBlock)
      ),
    }
  }
  throw new PayloadError(`${path}/kind`, 'unknown repair input kind')
}

function parseField(value: unknown, path: string): RepairField
{
  if (
    value === null ||
    typeof value === 'string' ||
    (typeof value === 'number' && Number.isFinite(value))
  )
  {
    return value
  }
  return parseDeclarationRef(value, path)
}

function parseRecord<T>(
  value: unknown,
  path: string,
  parse: (entry: unknown, entryPath: string) => T
): Record<string, T>
{
  const object = objectAt(value, path)
  const result = Object.create(null) as Record<string, T>
  for (const [key, entry] of Object.entries(object))
  {
    if (!key) throw new PayloadError(path, 'record keys must be nonempty')
    result[key] = parse(entry, `${path}/${key}`)
  }
  return result
}

function parseBlockSpec(
  value: unknown,
  path: string,
  countBlock: () => void
): RepairBlockSpec
{
  countBlock()
  const object = objectAt(value, path)
  exactKeys(object, ['opcode'], ['inputs', 'fields'], path)
  return {
    opcode: stringAt(object.opcode, `${path}/opcode`),
    ...(object.inputs === undefined
      ? {}
      : {
          inputs: parseRecord(
            object.inputs,
            `${path}/inputs`,
            (entry, entryPath) => parseInput(entry, entryPath, countBlock)
          ),
        }),
    ...(object.fields === undefined
      ? {}
      : {
          fields: parseRecord(object.fields, `${path}/fields`, parseField),
        }),
  }
}

function parseReferenceSite(value: unknown, path: string): ReferenceSite
{
  const object = objectAt(value, path)
  exactKeys(object, ['container', 'name'], [], path)
  if (object.container !== 'input' && object.container !== 'field')
  {
    throw new PayloadError(`${path}/container`, 'expected input or field')
  }
  return {
    container: object.container,
    name: stringAt(object.name, `${path}/name`),
  }
}

function parseBase(object: Record<string, unknown>, path: string): string
{
  const opId = stringAt(object.opId, `${path}/opId`)
  if (opId !== opId.trim())
  {
    throw new PayloadError(
      `${path}/opId`,
      'operation ID cannot have surrounding whitespace'
    )
  }
  return opId
}

function parseRepairOp(
  value: unknown,
  path: string,
  countBlock: () => void
): RepairOp
{
  const object = objectAt(value, path)
  const kind = stringAt(object.kind, `${path}/kind`)
  const opId = parseBase(object, path)
  switch (kind)
  {
    case 'replaceLiteral':
      exactKeys(
        object,
        ['kind', 'opId', 'block', 'inputName', 'expectedOpcode', 'from', 'to'],
        [],
        path
      )
      return {
        kind,
        opId,
        block: parseBlockRef(object.block, `${path}/block`),
        inputName: stringAt(object.inputName, `${path}/inputName`),
        expectedOpcode: stringAt(
          object.expectedOpcode,
          `${path}/expectedOpcode`
        ),
        from: parseLiteral(object.from, `${path}/from`),
        to: parseLiteral(object.to, `${path}/to`),
      }
    case 'replaceCompatibleOpcode':
      exactKeys(
        object,
        ['kind', 'opId', 'block', 'fromOpcode', 'toOpcode'],
        [],
        path
      )
      return {
        kind,
        opId,
        block: parseBlockRef(object.block, `${path}/block`),
        fromOpcode: stringAt(object.fromOpcode, `${path}/fromOpcode`),
        toOpcode: stringAt(object.toOpcode, `${path}/toOpcode`),
      }
    case 'replaceVariableRef':
      exactKeys(
        object,
        ['kind', 'opId', 'block', 'expectedOpcode', 'site', 'from', 'to'],
        [],
        path
      )
      return {
        kind,
        opId,
        block: parseBlockRef(object.block, `${path}/block`),
        expectedOpcode: stringAt(
          object.expectedOpcode,
          `${path}/expectedOpcode`
        ),
        site: parseReferenceSite(object.site, `${path}/site`),
        from: parseDeclarationRef(
          object.from,
          `${path}/from`,
          'variable'
        ) as VariableRef,
        to: parseDeclarationRef(
          object.to,
          `${path}/to`,
          'variable'
        ) as VariableRef,
      }
    case 'replaceBroadcastRef':
      exactKeys(
        object,
        ['kind', 'opId', 'block', 'expectedOpcode', 'site', 'from', 'to'],
        [],
        path
      )
      return {
        kind,
        opId,
        block: parseBlockRef(object.block, `${path}/block`),
        expectedOpcode: stringAt(
          object.expectedOpcode,
          `${path}/expectedOpcode`
        ),
        site: parseReferenceSite(object.site, `${path}/site`),
        from: parseDeclarationRef(
          object.from,
          `${path}/from`,
          'broadcast'
        ) as BroadcastRef,
        to: parseDeclarationRef(
          object.to,
          `${path}/to`,
          'broadcast'
        ) as BroadcastRef,
      }
    case 'insertStatementsAfter':
      exactKeys(
        object,
        ['kind', 'opId', 'anchor', 'expectedOpcode', 'statements'],
        [],
        path
      )
      return {
        kind,
        opId,
        anchor: parseBlockRef(object.anchor, `${path}/anchor`),
        expectedOpcode: stringAt(
          object.expectedOpcode,
          `${path}/expectedOpcode`
        ),
        statements: arrayAt(object.statements, `${path}/statements`).map(
          (block, index) =>
            parseBlockSpec(block, `${path}/statements/${index}`, countBlock)
        ),
      }
    case 'deleteStatement':
      exactKeys(
        object,
        ['kind', 'opId', 'statement', 'expectedOpcode'],
        [],
        path
      )
      return {
        kind,
        opId,
        statement: parseBlockRef(object.statement, `${path}/statement`),
        expectedOpcode: stringAt(
          object.expectedOpcode,
          `${path}/expectedOpcode`
        ),
      }
    case 'addScript':
      exactKeys(object, ['kind', 'opId', 'target', 'statements'], [], path)
      return {
        kind,
        opId,
        target: parseTargetRef(object.target, `${path}/target`),
        statements: arrayAt(object.statements, `${path}/statements`).map(
          (block, index) =>
            parseBlockSpec(block, `${path}/statements/${index}`, countBlock)
        ),
      }
    case 'setTargetProperty':
    {
      exactKeys(
        object,
        ['kind', 'opId', 'target', 'property', 'from', 'to'],
        [],
        path
      )
      const property = stringAt(object.property, `${path}/property`)
      if (!isTargetProperty(property))
      {
        throw new PayloadError(`${path}/property`, 'unknown target property')
      }
      if (
        !isTargetPropertyValue(property, object.from) ||
        !isTargetPropertyValue(property, object.to)
      )
      {
        throw new PayloadError(path, `property ${property} has invalid values`)
      }
      const target = parseTargetRef(object.target, `${path}/target`)
      if (
        TARGET_PROPERTY_DESCRIPTORS[property].target === 'sprite' &&
        target.isStage
      )
      {
        throw new PayloadError(
          `${path}/target/isStage`,
          `property ${property} requires a sprite target`
        )
      }
      return {
        kind,
        opId,
        target,
        property,
        from: object.from,
        to: object.to,
      } as RepairOp
    }
    default:
      throw new PayloadError(`${path}/kind`, 'unknown repair operation')
  }
}

export function parseSemanticPatch(
  raw: unknown,
  partialLimits: Partial<RepairResourceLimits> = {}
): SemanticPatchParseResult
{
  try
  {
    const limits = resolveResourceLimits(partialLimits)
    inspectResources(raw, limits)
    const serialized = JSON.stringify(raw)
    const proposalBytes = Buffer.byteLength(serialized, 'utf8')
    if (proposalBytes > limits.maxProposalBytes)
    {
      throw new PayloadError(
        '',
        `payload exceeds ${limits.maxProposalBytes} UTF-8 bytes`,
        'resource-limit'
      )
    }
    const detached = JSON.parse(serialized) as unknown
    const object = objectAt(detached, '')
    exactKeys(
      object,
      ['schemaVersion', 'baseArtifactSha256', 'operations'],
      [],
      ''
    )
    if (object.schemaVersion !== 1)
    {
      throw new PayloadError('/schemaVersion', 'expected schema version 1')
    }
    const baseArtifactSha256 = stringAt(
      object.baseArtifactSha256,
      '/baseArtifactSha256'
    )
    if (!/^[0-9a-f]{64}$/.test(baseArtifactSha256))
    {
      throw new PayloadError(
        '/baseArtifactSha256',
        'expected lowercase SHA-256'
      )
    }
    let newBlockCount = 0
    const countBlock = (): void =>
    {
      newBlockCount++
    }
    const operations = arrayAt(object.operations, '/operations').map(
      (operation, index) =>
        parseRepairOp(operation, `/operations/${index}`, countBlock)
    )
    const ids = new Set<string>()
    for (const operation of operations)
    {
      if (ids.has(operation.opId))
      {
        return {
          ok: false,
          violations: [
            {
              code: 'duplicate-op-id',
              message: `duplicate operation ID "${operation.opId}"`,
              opId: operation.opId,
            },
          ],
        }
      }
      ids.add(operation.opId)
    }
    return {
      ok: true,
      patch: { schemaVersion: 1, baseArtifactSha256, operations },
      proposalBytes,
      newBlockCount,
    }
  }
  catch (error)
  {
    const payloadError =
      error instanceof PayloadError
        ? error
        : new PayloadError('', `cannot parse payload: ${String(error)}`)
    return {
      ok: false,
      violations: [
        {
          code: payloadError.code,
          message: `${payloadError.path || '/'}: ${payloadError.message}`,
        },
      ],
    }
  }
}
