// packages/ir/src/edit/contracts/schema-model.ts
// deterministic schema modeling, emission, & structural validation

import { jsonPointerPart } from '../../project/project-vocabulary.js'
import { compareLexicalTextV1 as compareText } from '../support/lexical-order.js'

type NonEmptyReadonlyArray<T> = readonly [T, ...T[]]

interface StringSchema
{
  readonly kind: 'string'
  readonly minLength?: number
  readonly maxLength?: number
  readonly pattern?: string
  readonly utf8MinBytes?: number
  readonly utf8MaxBytes?: number
  readonly requireNfc?: boolean
  readonly rejectNul?: boolean
  readonly rejectUnpairedSurrogates?: boolean
}

interface LiteralStringSchema<TValue extends string = string>
{
  readonly kind: 'literalString'
  readonly value: TValue
}

interface EnumStringSchema<
  TValues extends NonEmptyReadonlyArray<string> = NonEmptyReadonlyArray<string>,
>
{
  readonly kind: 'enumString'
  readonly values: TValues
}

interface LiteralBooleanSchema<TValue extends boolean = boolean>
{
  readonly kind: 'literalBoolean'
  readonly value: TValue
}

interface LiteralIntegerSchema<TValue extends number = number>
{
  readonly kind: 'literalInteger'
  readonly value: TValue
}

interface NumberSchema
{
  readonly kind: 'number'
  readonly minimum?: number
  readonly maximum?: number
}

interface IntegerSchema
{
  readonly kind: 'integer'
  readonly minimum?: number
  readonly maximum?: number
}

interface BooleanSchema
{
  readonly kind: 'boolean'
}

interface NullSchema
{
  readonly kind: 'null'
}

interface ArraySchema<TItems extends SchemaNode = SchemaNode>
{
  readonly kind: 'array'
  readonly items: TItems
  readonly minItems?: number
  readonly maxItems?: number
  readonly uniqueItems?: boolean
}

export interface ObjectField<
  TSchema extends SchemaNode = SchemaNode,
  TRequired extends boolean = boolean,
>
{
  readonly schema: TSchema
  readonly required: TRequired
}

type ObjectFields = Readonly<Record<string, ObjectField>>

interface ObjectSchema<TFields extends ObjectFields = ObjectFields>
{
  readonly kind: 'object'
  readonly fields: TFields
}

interface AnyOfSchema<
  TVariants extends NonEmptyReadonlyArray<SchemaNode> =
    NonEmptyReadonlyArray<SchemaNode>,
>
{
  readonly kind: 'anyOf'
  readonly variants: TVariants
}

export interface RefSchema<TName extends string = string>
{
  readonly kind: 'ref'
  readonly name: TName
}

export type SchemaNode =
  | StringSchema
  | LiteralStringSchema
  | EnumStringSchema
  | LiteralBooleanSchema
  | LiteralIntegerSchema
  | NumberSchema
  | IntegerSchema
  | BooleanSchema
  | NullSchema
  | ArraySchema
  | ObjectSchema
  | AnyOfSchema
  | RefSchema

export type SchemaDefinitions = Readonly<Record<string, SchemaNode>>

export interface SchemaModel<
  TRoot extends SchemaNode = SchemaNode,
  TDefinitions extends SchemaDefinitions = SchemaDefinitions,
>
{
  readonly schemaVersion: 1
  readonly root: TRoot
  readonly definitions: TDefinitions
}

type ObjectStringKeys<TFields extends ObjectFields> = Extract<
  keyof TFields,
  string
>

type RequiredObjectKeys<TFields extends ObjectFields> = {
  [TKey in ObjectStringKeys<TFields>]-?: TFields[TKey] extends ObjectField<
    SchemaNode,
    true
  >
    ? TKey
    : never
}[ObjectStringKeys<TFields>]

type OptionalObjectKeys<TFields extends ObjectFields> = Exclude<
  ObjectStringKeys<TFields>,
  RequiredObjectKeys<TFields>
>

type InferField<TField extends ObjectField> =
  TField extends ObjectField<infer TSchema, boolean>
    ? InferSchema<TSchema>
    : never

type InferObject<TFields extends ObjectFields> = {
  readonly [TKey in RequiredObjectKeys<TFields>]: InferField<TFields[TKey]>
} & {
  readonly [TKey in OptionalObjectKeys<TFields>]?: InferField<TFields[TKey]>
}

type InferSchema<TSchema extends SchemaNode> =
  TSchema extends LiteralStringSchema<infer TValue>
    ? TValue
    : TSchema extends LiteralBooleanSchema<infer TValue>
      ? TValue
      : TSchema extends LiteralIntegerSchema<infer TValue>
        ? TValue
        : TSchema extends EnumStringSchema<infer TValues>
          ? TValues[number]
          : TSchema extends StringSchema
            ? string
            : TSchema extends NumberSchema | IntegerSchema
              ? number
              : TSchema extends BooleanSchema
                ? boolean
                : TSchema extends NullSchema
                  ? null
                  : TSchema extends ArraySchema<infer TItems>
                    ? readonly InferSchema<TItems>[]
                    : TSchema extends ObjectSchema<infer TFields>
                      ? InferObject<TFields>
                      : TSchema extends AnyOfSchema<infer TVariants>
                        ? InferSchema<TVariants[number]>
                        : unknown

interface StringSchemaOptions
{
  readonly minLength?: number
  readonly maxLength?: number
  readonly pattern?: string
  readonly utf8MinBytes?: number
  readonly utf8MaxBytes?: number
  readonly requireNfc?: boolean
  readonly rejectNul?: boolean
  readonly rejectUnpairedSurrogates?: boolean
}

interface NumberSchemaOptions
{
  readonly minimum?: number
  readonly maximum?: number
}

interface ArraySchemaOptions
{
  readonly minItems?: number
  readonly maxItems?: number
  readonly uniqueItems?: boolean
}

interface TypeScriptAnnexHeader
{
  readonly relativePath: string
  readonly purpose: string
}

interface TypeScriptAnnexOptions
{
  readonly rootTypeName?: string
  readonly exportTypes?: boolean
  readonly header?: TypeScriptAnnexHeader
}

interface SchemaValidationOptions
{
  readonly rejectNonFinite?: boolean
  readonly rejectNegativeZero?: boolean
  readonly rejectUnsafeIntegers?: boolean
  readonly maxDepth?: number
  readonly maxIssues?: number
}

type SchemaValidationIssueCode =
  | 'any_of'
  | 'array_length'
  | 'cyclic_value'
  | 'depth_exceeded'
  | 'enum'
  | 'integer'
  | 'literal'
  | 'non_json_property'
  | 'nonfinite_number'
  | 'number_range'
  | 'required_key'
  | 'sparse_array'
  | 'string_length'
  | 'string_nfc'
  | 'string_nul'
  | 'string_pattern'
  | 'string_unpaired_surrogate'
  | 'string_utf8_length'
  | 'type'
  | 'unknown_key'
  | 'unique_items'
  | 'unsafe_integer'
  | 'negative_zero'

export interface SchemaValidationIssue
{
  readonly path: string
  readonly code: SchemaValidationIssueCode
  readonly message: string
}

type SchemaValidationResult =
  | { readonly ok: true }
  | {
      readonly ok: false
      readonly issues: readonly SchemaValidationIssue[]
      readonly truncated: boolean
    }

type JsonSchema202012 = Readonly<Record<string, unknown>>

const TYPESCRIPT_RESERVED_WORDS = new Set([
  'abstract',
  'any',
  'as',
  'asserts',
  'async',
  'await',
  'bigint',
  'boolean',
  'break',
  'case',
  'catch',
  'class',
  'const',
  'constructor',
  'continue',
  'debugger',
  'declare',
  'default',
  'delete',
  'do',
  'else',
  'enum',
  'export',
  'extends',
  'false',
  'finally',
  'for',
  'from',
  'function',
  'get',
  'global',
  'if',
  'implements',
  'import',
  'in',
  'infer',
  'instanceof',
  'interface',
  'intrinsic',
  'is',
  'keyof',
  'let',
  'module',
  'namespace',
  'never',
  'new',
  'null',
  'number',
  'object',
  'of',
  'package',
  'private',
  'protected',
  'public',
  'readonly',
  'require',
  'return',
  'set',
  'static',
  'string',
  'super',
  'switch',
  'symbol',
  'this',
  'throw',
  'true',
  'try',
  'type',
  'typeof',
  'undefined',
  'unique',
  'unknown',
  'using',
  'var',
  'void',
  'while',
  'with',
  'yield',
])

const DEFAULT_VALIDATION_OPTIONS = Object.freeze({
  rejectNonFinite: true,
  rejectNegativeZero: true,
  rejectUnsafeIntegers: true,
  maxDepth: 128,
  maxIssues: 64,
})

const UTF8 = new TextEncoder()
const STRING_PATTERN_BY_SCHEMA = new WeakMap<StringSchema, RegExp>()

function frozenRecord<TValue>(
  entries: readonly (readonly [string, TValue])[]
): Readonly<Record<string, TValue>>
{
  const result = Object.create(null) as Record<string, TValue>

  for (const [key, value] of [...entries].sort(([left], [right]) =>
    compareText(left, right)
  ))
  {
    result[key] = value
  }

  return Object.freeze(result)
}

function assertPlainRecord(
  value: unknown,
  label: string
): asserts value is object
{
  if (typeof value !== 'object' || value === null || Array.isArray(value))
  {
    throw new TypeError(`${label} must be a plain object`)
  }

  const prototype = Object.getPrototypeOf(value)

  if (prototype !== Object.prototype && prototype !== null)
  {
    throw new TypeError(`${label} must be a plain object`)
  }
}

function assertExactKeys(
  value: object,
  expected: readonly string[],
  label: string
): void
{
  const symbols = Object.getOwnPropertySymbols(value)

  if (symbols.length > 0)
  {
    throw new TypeError(`${label} must not contain symbol keys`)
  }

  const expectedSet = new Set(expected)
  const actual = Object.getOwnPropertyNames(value).sort(compareText)

  for (const key of actual)
  {
    const descriptor = Object.getOwnPropertyDescriptor(value, key)

    if (
      descriptor === undefined ||
      !descriptor.enumerable ||
      !('value' in descriptor)
    )
    {
      throw new TypeError(`${label}.${key} must be an enumerable data property`)
    }

    if (!expectedSet.has(key))
    {
      throw new TypeError(
        `${label} contains unknown key ${JSON.stringify(key)}`
      )
    }
  }
}

function assertTypeName(name: string, label: string): void
{
  if (
    !/^[$A-Z_a-z][$\w]*$/u.test(name) ||
    TYPESCRIPT_RESERVED_WORDS.has(name)
  )
  {
    throw new TypeError(`${label} must be a non-reserved TypeScript identifier`)
  }
}

function normalizeOptionalNonnegativeInteger(
  value: number | undefined,
  label: string
): number | undefined
{
  if (value === undefined)
  {
    return undefined
  }

  if (!Number.isSafeInteger(value) || value < 0 || Object.is(value, -0))
  {
    throw new RangeError(`${label} must be a nonnegative safe integer`)
  }

  return value
}

function normalizeOptionalFiniteNumber(
  value: number | undefined,
  label: string
): number | undefined
{
  if (value === undefined)
  {
    return undefined
  }

  if (!Number.isFinite(value) || Object.is(value, -0))
  {
    throw new RangeError(
      `${label} must be finite and must not be negative zero`
    )
  }

  return value
}

function normalizeOptionalSafeInteger(
  value: number | undefined,
  label: string
): number | undefined
{
  if (value === undefined)
  {
    return undefined
  }

  if (!Number.isSafeInteger(value) || Object.is(value, -0))
  {
    throw new RangeError(`${label} must be a safe integer`)
  }

  return value
}

function assertOrderedBounds(
  minimum: number | undefined,
  maximum: number | undefined,
  label: string
): void
{
  if (minimum !== undefined && maximum !== undefined && minimum > maximum)
  {
    throw new RangeError(`${label} minimum must not exceed maximum`)
  }
}

function normalizeNode<TSchema extends SchemaNode>(
  node: TSchema,
  label: string,
  active: Set<object>,
  references: Set<string>
): TSchema
{
  assertPlainRecord(node, label)

  if (active.has(node))
  {
    throw new TypeError(`${label} contains a direct object cycle`)
  }

  active.add(node)

  try
  {
    switch (node.kind)
    {
      case 'string':
      {
        assertExactKeys(
          node,
          [
            'kind',
            'maxLength',
            'minLength',
            'pattern',
            'rejectNul',
            'rejectUnpairedSurrogates',
            'requireNfc',
            'utf8MaxBytes',
            'utf8MinBytes',
          ],
          label
        )
        const minLength = normalizeOptionalNonnegativeInteger(
          node.minLength,
          `${label}.minLength`
        )
        const maxLength = normalizeOptionalNonnegativeInteger(
          node.maxLength,
          `${label}.maxLength`
        )
        assertOrderedBounds(minLength, maxLength, label)
        const utf8MinBytes = normalizeOptionalNonnegativeInteger(
          node.utf8MinBytes,
          `${label}.utf8MinBytes`
        )
        const utf8MaxBytes = normalizeOptionalNonnegativeInteger(
          node.utf8MaxBytes,
          `${label}.utf8MaxBytes`
        )
        assertOrderedBounds(utf8MinBytes, utf8MaxBytes, `${label}.utf8Bytes`)

        for (const [key, value] of [
          ['requireNfc', node.requireNfc],
          ['rejectNul', node.rejectNul],
          ['rejectUnpairedSurrogates', node.rejectUnpairedSurrogates],
        ] as const)
        {
          if (value !== undefined && typeof value !== 'boolean')
          {
            throw new TypeError(`${label}.${key} must be boolean`)
          }
        }

        if (node.pattern !== undefined)
        {
          if (typeof node.pattern !== 'string')
          {
            throw new TypeError(`${label}.pattern must be a string`)
          }

          try
          {
            new RegExp(node.pattern, 'u')
          }
          catch
          {
            throw new TypeError(
              `${label}.pattern must be a valid Unicode regex`
            )
          }
        }

        return Object.freeze({
          kind: 'string',
          ...(minLength === undefined ? {} : { minLength }),
          ...(maxLength === undefined ? {} : { maxLength }),
          ...(node.pattern === undefined ? {} : { pattern: node.pattern }),
          ...(utf8MinBytes === undefined ? {} : { utf8MinBytes }),
          ...(utf8MaxBytes === undefined ? {} : { utf8MaxBytes }),
          ...(node.requireNfc === undefined
            ? {}
            : { requireNfc: node.requireNfc }),
          ...(node.rejectNul === undefined
            ? {}
            : { rejectNul: node.rejectNul }),
          ...(node.rejectUnpairedSurrogates === undefined
            ? {}
            : { rejectUnpairedSurrogates: node.rejectUnpairedSurrogates }),
        }) as TSchema
      }
      case 'literalString':
      {
        assertExactKeys(node, ['kind', 'value'], label)

        if (typeof node.value !== 'string')
        {
          throw new TypeError(`${label}.value must be a string`)
        }

        return Object.freeze({
          kind: 'literalString',
          value: node.value,
        }) as TSchema
      }
      case 'enumString':
      {
        assertExactKeys(node, ['kind', 'values'], label)

        if (!Array.isArray(node.values) || node.values.length === 0)
        {
          throw new TypeError(`${label}.values must be a nonempty string array`)
        }

        const values = node.values.map((value, index) =>
        {
          if (typeof value !== 'string')
          {
            throw new TypeError(`${label}.values[${index}] must be a string`)
          }

          return value
        })

        if (new Set(values).size !== values.length)
        {
          throw new TypeError(`${label}.values must not contain duplicates`)
        }

        return Object.freeze({
          kind: 'enumString',
          values: Object.freeze(values),
        }) as TSchema
      }
      case 'literalBoolean':
      {
        assertExactKeys(node, ['kind', 'value'], label)

        if (typeof node.value !== 'boolean')
        {
          throw new TypeError(`${label}.value must be boolean`)
        }

        return Object.freeze({
          kind: 'literalBoolean',
          value: node.value,
        }) as TSchema
      }
      case 'literalInteger':
      {
        assertExactKeys(node, ['kind', 'value'], label)

        if (!Number.isSafeInteger(node.value) || Object.is(node.value, -0))
        {
          throw new TypeError(
            `${label}.value must be a safe non-negative-zero integer`
          )
        }

        return Object.freeze({
          kind: 'literalInteger',
          value: node.value,
        }) as TSchema
      }
      case 'number':
      {
        assertExactKeys(node, ['kind', 'maximum', 'minimum'], label)
        const minimum = normalizeOptionalFiniteNumber(
          node.minimum,
          `${label}.minimum`
        )
        const maximum = normalizeOptionalFiniteNumber(
          node.maximum,
          `${label}.maximum`
        )
        assertOrderedBounds(minimum, maximum, label)

        return Object.freeze({
          kind: 'number',
          ...(minimum === undefined ? {} : { minimum }),
          ...(maximum === undefined ? {} : { maximum }),
        }) as TSchema
      }
      case 'integer':
      {
        assertExactKeys(node, ['kind', 'maximum', 'minimum'], label)
        const minimum = normalizeOptionalSafeInteger(
          node.minimum,
          `${label}.minimum`
        )
        const maximum = normalizeOptionalSafeInteger(
          node.maximum,
          `${label}.maximum`
        )
        assertOrderedBounds(minimum, maximum, label)

        return Object.freeze({
          kind: 'integer',
          ...(minimum === undefined ? {} : { minimum }),
          ...(maximum === undefined ? {} : { maximum }),
        }) as TSchema
      }
      case 'boolean':
      case 'null':
      {
        assertExactKeys(node, ['kind'], label)

        return Object.freeze({ kind: node.kind }) as TSchema
      }
      case 'array':
      {
        assertExactKeys(
          node,
          ['items', 'kind', 'maxItems', 'minItems', 'uniqueItems'],
          label
        )
        const minItems = normalizeOptionalNonnegativeInteger(
          node.minItems,
          `${label}.minItems`
        )
        const maxItems = normalizeOptionalNonnegativeInteger(
          node.maxItems,
          `${label}.maxItems`
        )
        assertOrderedBounds(minItems, maxItems, label)

        if (
          node.uniqueItems !== undefined &&
          typeof node.uniqueItems !== 'boolean'
        )
        {
          throw new TypeError(`${label}.uniqueItems must be boolean`)
        }

        return Object.freeze({
          kind: 'array',
          items: normalizeNode(
            node.items,
            `${label}.items`,
            active,
            references
          ),
          ...(minItems === undefined ? {} : { minItems }),
          ...(maxItems === undefined ? {} : { maxItems }),
          ...(node.uniqueItems === undefined
            ? {}
            : { uniqueItems: node.uniqueItems }),
        }) as TSchema
      }
      case 'object':
      {
        assertExactKeys(node, ['fields', 'kind'], label)
        assertPlainRecord(node.fields, `${label}.fields`)
        const fieldEntries = Object.getOwnPropertyNames(node.fields).map(
          (key) =>
          {
            const descriptor = Object.getOwnPropertyDescriptor(node.fields, key)

            if (
              descriptor === undefined ||
              !descriptor.enumerable ||
              !('value' in descriptor)
            )
            {
              throw new TypeError(
                `${label}.fields.${key} must be an enumerable data property`
              )
            }

            const field = descriptor.value as ObjectField
            assertPlainRecord(field, `${label}.fields.${key}`)
            assertExactKeys(
              field,
              ['required', 'schema'],
              `${label}.fields.${key}`
            )

            if (typeof field.required !== 'boolean')
            {
              throw new TypeError(
                `${label}.fields.${key}.required must be boolean`
              )
            }

            return [
              key,
              Object.freeze({
                required: field.required,
                schema: normalizeNode(
                  field.schema,
                  `${label}.fields.${key}.schema`,
                  active,
                  references
                ),
              }),
            ] as const
          }
        )

        return Object.freeze({
          kind: 'object',
          fields: frozenRecord(fieldEntries),
        }) as TSchema
      }
      case 'anyOf':
      {
        assertExactKeys(node, ['kind', 'variants'], label)

        if (!Array.isArray(node.variants) || node.variants.length === 0)
        {
          throw new TypeError(
            `${label}.variants must be a nonempty schema array`
          )
        }

        return Object.freeze({
          kind: 'anyOf',
          variants: Object.freeze(
            node.variants.map((variant, index) =>
              normalizeNode(
                variant,
                `${label}.variants[${index}]`,
                active,
                references
              )
            )
          ),
        }) as TSchema
      }
      case 'ref':
      {
        assertExactKeys(node, ['kind', 'name'], label)

        if (typeof node.name !== 'string')
        {
          throw new TypeError(`${label}.name must be a string`)
        }

        assertTypeName(node.name, `${label}.name`)
        references.add(node.name)

        return Object.freeze({ kind: 'ref', name: node.name }) as TSchema
      }
    }
  }
  finally
  {
    active.delete(node)
  }
}

function requiredField<TSchema extends SchemaNode>(
  value: TSchema
): ObjectField<TSchema, true>
{
  return Object.freeze({ schema: value, required: true })
}

function optionalField<TSchema extends SchemaNode>(
  value: TSchema
): ObjectField<TSchema, false>
{
  return Object.freeze({ schema: value, required: false })
}

function stringSchema(options: StringSchemaOptions = {}): StringSchema
{
  return Object.freeze({ kind: 'string', ...options })
}

function literalStringSchema<const TValue extends string>(
  value: TValue
): LiteralStringSchema<TValue>
{
  return Object.freeze({ kind: 'literalString', value })
}

function enumStringSchema<const TValues extends NonEmptyReadonlyArray<string>>(
  values: TValues
): EnumStringSchema<TValues>
{
  return Object.freeze({
    kind: 'enumString',
    values: Object.freeze([...values]) as unknown as TValues,
  })
}

function literalBooleanSchema<const TValue extends boolean>(
  value: TValue
): LiteralBooleanSchema<TValue>
{
  return Object.freeze({ kind: 'literalBoolean', value })
}

function literalIntegerSchema<const TValue extends number>(
  value: TValue
): LiteralIntegerSchema<TValue>
{
  return Object.freeze({ kind: 'literalInteger', value })
}

function numberSchema(options: NumberSchemaOptions = {}): NumberSchema
{
  return Object.freeze({ kind: 'number', ...options })
}

function integerSchema(options: NumberSchemaOptions = {}): IntegerSchema
{
  return Object.freeze({ kind: 'integer', ...options })
}

function booleanSchema(): BooleanSchema
{
  return Object.freeze({ kind: 'boolean' })
}

function nullSchema(): NullSchema
{
  return Object.freeze({ kind: 'null' })
}

function arraySchema<TItems extends SchemaNode>(
  items: TItems,
  options: ArraySchemaOptions = {}
): ArraySchema<TItems>
{
  return Object.freeze({ kind: 'array', items, ...options })
}

function objectSchema<const TFields extends ObjectFields>(
  fields: TFields
): ObjectSchema<TFields>
{
  return Object.freeze({
    kind: 'object',
    fields: frozenRecord(
      Object.getOwnPropertyNames(fields).map(
        (key) => [key, fields[key]!] as const
      )
    ) as TFields,
  })
}

function anyOfSchema<const TVariants extends NonEmptyReadonlyArray<SchemaNode>>(
  variants: TVariants
): AnyOfSchema<TVariants>
{
  return Object.freeze({
    kind: 'anyOf',
    variants: Object.freeze([...variants]) as unknown as TVariants,
  })
}

function refSchema<const TName extends string>(name: TName): RefSchema<TName>
{
  return Object.freeze({ kind: 'ref', name })
}

export const schema = Object.freeze({
  required: requiredField,
  optional: optionalField,
  string: stringSchema,
  literalString: literalStringSchema,
  enumString: enumStringSchema,
  literalBoolean: literalBooleanSchema,
  literalInteger: literalIntegerSchema,
  number: numberSchema,
  integer: integerSchema,
  boolean: booleanSchema,
  null: nullSchema,
  array: arraySchema,
  object: objectSchema,
  anyOf: anyOfSchema,
  ref: refSchema,
})

export function defineSchemaModel<
  const TRoot extends SchemaNode,
  const TDefinitions extends SchemaDefinitions,
>(input: {
  readonly root: TRoot
  readonly definitions: TDefinitions
}): SchemaModel<TRoot, TDefinitions>
{
  assertPlainRecord(input, 'schema model')
  assertExactKeys(input, ['definitions', 'root'], 'schema model')
  assertPlainRecord(input.definitions, 'schema model definitions')

  const active = new Set<object>()
  const references = new Set<string>()
  const definitionEntries = Object.getOwnPropertyNames(input.definitions).map(
    (name) =>
    {
      assertTypeName(name, `definition ${JSON.stringify(name)}`)
      const descriptor = Object.getOwnPropertyDescriptor(
        input.definitions,
        name
      )

      if (
        descriptor === undefined ||
        !descriptor.enumerable ||
        !('value' in descriptor)
      )
      {
        throw new TypeError(
          `definition ${JSON.stringify(name)} must be an enumerable data property`
        )
      }

      return [
        name,
        normalizeNode(
          descriptor.value as SchemaNode,
          `definition ${name}`,
          active,
          references
        ),
      ] as const
    }
  )
  const definitions = frozenRecord(definitionEntries)
  const root = normalizeNode(input.root, 'schema root', active, references)

  for (const reference of [...references].sort(compareText))
  {
    if (!Object.hasOwn(definitions, reference))
    {
      throw new TypeError(`schema reference ${reference} has no definition`)
    }
  }

  return Object.freeze({
    schemaVersion: 1,
    root,
    definitions,
  }) as SchemaModel<TRoot, TDefinitions>
}

function standardStringLengthBounds(node: StringSchema): Readonly<{
  minLength?: number
  maxLength?: number
}>
{
  const minimums = [
    node.minLength,
    node.rejectUnpairedSurrogates && node.utf8MinBytes !== undefined
      ? Math.ceil(node.utf8MinBytes / 4)
      : undefined,
  ].filter((value): value is number => value !== undefined)
  const maximums = [
    node.maxLength,
    node.rejectUnpairedSurrogates && node.utf8MaxBytes !== undefined
      ? node.utf8MaxBytes
      : undefined,
  ].filter((value): value is number => value !== undefined)
  return {
    ...(minimums.length === 0 ? {} : { minLength: Math.max(...minimums) }),
    ...(maximums.length === 0 ? {} : { maxLength: Math.min(...maximums) }),
  }
}

function emitNodeJsonSchema(node: SchemaNode): JsonSchema202012
{
  switch (node.kind)
  {
    case 'string':
      return {
        type: 'string',
        ...standardStringLengthBounds(node),
        ...(node.pattern === undefined ? {} : { pattern: node.pattern }),
        ...(node.utf8MinBytes === undefined
          ? {}
          : { 'x-scratch-agent-utf8MinBytes': node.utf8MinBytes }),
        ...(node.utf8MaxBytes === undefined
          ? {}
          : { 'x-scratch-agent-utf8MaxBytes': node.utf8MaxBytes }),
        ...(node.requireNfc === undefined
          ? {}
          : { 'x-scratch-agent-requireNfc': node.requireNfc }),
        ...(node.rejectNul === undefined
          ? {}
          : { 'x-scratch-agent-rejectNul': node.rejectNul }),
        ...(node.rejectUnpairedSurrogates === undefined
          ? {}
          : {
              'x-scratch-agent-rejectUnpairedSurrogates':
                node.rejectUnpairedSurrogates,
            }),
      }
    case 'literalString':
      return { type: 'string', const: node.value }
    case 'enumString':
      return { type: 'string', enum: [...node.values] }
    case 'literalBoolean':
      return { type: 'boolean', const: node.value }
    case 'literalInteger':
      return { type: 'integer', const: node.value }
    case 'number':
      return {
        type: 'number',
        ...(node.minimum === undefined ? {} : { minimum: node.minimum }),
        ...(node.maximum === undefined ? {} : { maximum: node.maximum }),
      }
    case 'integer':
      return {
        type: 'integer',
        ...(node.minimum === undefined ? {} : { minimum: node.minimum }),
        ...(node.maximum === undefined ? {} : { maximum: node.maximum }),
      }
    case 'boolean':
      return { type: 'boolean' }
    case 'null':
      return { type: 'null' }
    case 'array':
      return {
        type: 'array',
        items: emitNodeJsonSchema(node.items),
        ...(node.minItems === undefined ? {} : { minItems: node.minItems }),
        ...(node.maxItems === undefined ? {} : { maxItems: node.maxItems }),
        ...(node.uniqueItems === undefined
          ? {}
          : { uniqueItems: node.uniqueItems }),
      }
    case 'object':
    {
      const keys = Object.keys(node.fields).sort(compareText)
      const properties = frozenRecord(
        keys.map((key) => [key, emitNodeJsonSchema(node.fields[key]!.schema)])
      )
      const required = keys.filter((key) => node.fields[key]!.required)

      return {
        type: 'object',
        properties,
        required,
        additionalProperties: false,
      }
    }
    case 'anyOf':
      return { anyOf: node.variants.map(emitNodeJsonSchema) }
    case 'ref':
      return {
        $ref: `#/$defs/${jsonPointerPart(node.name)}`,
      }
  }
}

export function emitJsonSchema202012(model: SchemaModel): JsonSchema202012
{
  const root = emitNodeJsonSchema(model.root)
  const definitions = frozenRecord(
    Object.keys(model.definitions).map((name) => [
      name,
      emitNodeJsonSchema(model.definitions[name]!),
    ])
  )

  return frozenRecord([
    ['$schema', 'https://json-schema.org/draft/2020-12/schema'],
    ['$defs', definitions],
    [
      'x-scratch-agent-numberContract',
      'finite; negative zero rejected; integral values must be safe integers',
    ],
    ...Object.keys(root).map((key) => [key, root[key]] as const),
  ])
}

function quoteTypeScriptProperty(value: string): string
{
  return JSON.stringify(value)
}

function indentMultiline(value: string, prefix: string): string
{
  return value.replaceAll('\n', `\n${prefix}`)
}

function emitNodeTypeScript(node: SchemaNode, depth: number): string
{
  switch (node.kind)
  {
    case 'string':
      return 'string'
    case 'literalString':
      return JSON.stringify(node.value)
    case 'enumString':
      return node.values.map((value) => JSON.stringify(value)).join(' | ')
    case 'literalBoolean':
    case 'literalInteger':
      return String(node.value)
    case 'number':
    case 'integer':
      return 'number'
    case 'boolean':
      return 'boolean'
    case 'null':
      return 'null'
    case 'array':
      return `ReadonlyArray<${emitNodeTypeScript(node.items, depth)}>`
    case 'object':
    {
      const outerIndent = '  '.repeat(depth)
      const memberIndent = '  '.repeat(depth + 1)
      const members = Object.keys(node.fields)
        .sort(compareText)
        .map((key) =>
        {
          const field = node.fields[key]!
          const optional = field.required ? '' : '?'
          const rendered = indentMultiline(
            emitNodeTypeScript(field.schema, depth + 1),
            memberIndent
          )

          return `${memberIndent}readonly ${quoteTypeScriptProperty(key)}${optional}: ${rendered}`
        })

      return members.length === 0
        ? 'Record<string, never>'
        : `{\n${members.join('\n')}\n${outerIndent}}`
    }
    case 'anyOf':
      return node.variants
        .map((variant) => `(${emitNodeTypeScript(variant, depth)})`)
        .join(' | ')
    case 'ref':
      return node.name
  }
}

export function emitTypeScriptAnnex(
  model: SchemaModel,
  options: TypeScriptAnnexOptions = {}
): string
{
  const rootTypeName = options.rootTypeName ?? 'A0SchemaRoot'
  const prefix = options.exportTypes === false ? '' : 'export '
  assertTypeName(rootTypeName, 'root type name')

  if (Object.hasOwn(model.definitions, rootTypeName))
  {
    throw new TypeError(
      `root type name ${rootTypeName} collides with a definition`
    )
  }

  const declarations = Object.keys(model.definitions)
    .sort(compareText)
    .map(
      (name) =>
        `${prefix}type ${name} = ${emitNodeTypeScript(model.definitions[name]!, 0)}`
    )

  declarations.push(
    `${prefix}type ${rootTypeName} = ${emitNodeTypeScript(model.root, 0)}`
  )

  let header = ''

  if (options.header !== undefined)
  {
    const { relativePath, purpose } = options.header

    if (
      relativePath.length === 0 ||
      relativePath.trim() !== relativePath ||
      /[\r\n]/u.test(relativePath)
    )
    {
      throw new TypeError('annex header relativePath must be one trimmed line')
    }

    if (
      purpose.length === 0 ||
      purpose.trim() !== purpose ||
      purpose !== purpose.toLowerCase() ||
      /[\r\n]/u.test(purpose)
    )
    {
      throw new TypeError(
        'annex header purpose must be one trimmed lowercase line'
      )
    }

    header = `// ${relativePath}\n// ${purpose}\n\n`
  }

  return `${header}${declarations.join('\n\n')}\n`
}

interface ResolvedValidationOptions
{
  readonly rejectNonFinite: boolean
  readonly rejectNegativeZero: boolean
  readonly rejectUnsafeIntegers: boolean
  readonly maxDepth: number
  readonly maxIssues: number
}

interface ValidationState
{
  readonly model: SchemaModel
  readonly options: ResolvedValidationOptions
  readonly issues: SchemaValidationIssue[]
  readonly ancestors: Set<object>
  truncated: boolean
}

function resolveValidationOptions(
  options: SchemaValidationOptions
): ResolvedValidationOptions
{
  const resolved = { ...DEFAULT_VALIDATION_OPTIONS, ...options }

  if (
    !Number.isSafeInteger(resolved.maxDepth) ||
    resolved.maxDepth < 1 ||
    !Number.isSafeInteger(resolved.maxIssues) ||
    resolved.maxIssues < 1
  )
  {
    throw new RangeError(
      'validation maxDepth and maxIssues must be positive safe integers'
    )
  }

  return resolved
}

function addIssue(
  state: ValidationState,
  path: string,
  code: SchemaValidationIssueCode,
  message: string
): void
{
  if (state.issues.length >= state.options.maxIssues)
  {
    state.truncated = true
    return
  }

  state.issues.push(Object.freeze({ path, code, message }))
}

function pointerChild(path: string, key: string): string
{
  return `${path}/${jsonPointerPart(key)}`
}

function isPlainValueRecord(value: unknown): value is Record<string, unknown>
{
  if (typeof value !== 'object' || value === null || Array.isArray(value))
  {
    return false
  }

  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function enterContainer(
  state: ValidationState,
  value: object,
  path: string
): boolean
{
  if (state.ancestors.has(value))
  {
    addIssue(state, path, 'cyclic_value', 'value contains an object cycle')
    return false
  }

  state.ancestors.add(value)
  return true
}

function validateNumericValue(
  node: NumberSchema | IntegerSchema,
  value: unknown,
  path: string,
  state: ValidationState
): void
{
  if (typeof value !== 'number')
  {
    addIssue(state, path, 'type', `expected ${node.kind}`)
    return
  }

  if (!Number.isFinite(value) && state.options.rejectNonFinite)
  {
    addIssue(state, path, 'nonfinite_number', 'number must be finite')
    return
  }

  if (Object.is(value, -0) && state.options.rejectNegativeZero)
  {
    addIssue(state, path, 'negative_zero', 'number must not be negative zero')
    return
  }

  if (node.kind === 'integer' && !Number.isInteger(value))
  {
    addIssue(state, path, 'integer', 'number must be an integer')
    return
  }

  if (
    Number.isInteger(value) &&
    !Number.isSafeInteger(value) &&
    state.options.rejectUnsafeIntegers
  )
  {
    addIssue(
      state,
      path,
      'unsafe_integer',
      'integer must be safely representable'
    )
    return
  }

  if (
    (node.minimum !== undefined && value < node.minimum) ||
    (node.maximum !== undefined && value > node.maximum)
  )
  {
    addIssue(state, path, 'number_range', 'number is outside the allowed range')
  }
}

function uniqueValueKey(
  value: unknown,
  ancestors: Set<object>
): string | undefined
{
  if (value === null)
  {
    return 'null'
  }

  if (typeof value === 'string')
  {
    return `string:${JSON.stringify(value)}`
  }

  if (typeof value === 'boolean')
  {
    return `boolean:${String(value)}`
  }

  if (typeof value === 'number')
  {
    if (Number.isNaN(value))
    {
      return 'number:nan'
    }

    if (value === Number.POSITIVE_INFINITY)
    {
      return 'number:positive-infinity'
    }

    if (value === Number.NEGATIVE_INFINITY)
    {
      return 'number:negative-infinity'
    }

    return `number:${Object.is(value, -0) ? '0' : String(value)}`
  }

  if (typeof value !== 'object' || ancestors.has(value))
  {
    return undefined
  }

  ancestors.add(value)

  try
  {
    if (Array.isArray(value))
    {
      const parts: string[] = []

      for (let index = 0; index < value.length; index += 1)
      {
        const descriptor = Object.getOwnPropertyDescriptor(value, String(index))

        if (
          descriptor === undefined ||
          !descriptor.enumerable ||
          !('value' in descriptor)
        )
        {
          return undefined
        }

        const item = uniqueValueKey(descriptor.value, ancestors)

        if (item === undefined)
        {
          return undefined
        }

        parts.push(`${item.length}:${item}`)
      }

      return `array:${parts.join('')}`
    }

    if (
      !isPlainValueRecord(value) ||
      Object.getOwnPropertySymbols(value).length
    )
    {
      return undefined
    }

    const parts: string[] = []

    for (const key of Object.getOwnPropertyNames(value).sort(compareText))
    {
      const descriptor = Object.getOwnPropertyDescriptor(value, key)

      if (
        descriptor === undefined ||
        !descriptor.enumerable ||
        !('value' in descriptor)
      )
      {
        return undefined
      }

      const member = uniqueValueKey(descriptor.value, ancestors)

      if (member === undefined)
      {
        return undefined
      }

      const encodedKey = JSON.stringify(key)
      parts.push(`${encodedKey.length}:${encodedKey}${member.length}:${member}`)
    }

    return `object:${parts.join('')}`
  }
  finally
  {
    ancestors.delete(value)
  }
}

function validateArrayValue(
  node: ArraySchema,
  value: unknown,
  path: string,
  depth: number,
  state: ValidationState
): void
{
  if (!Array.isArray(value))
  {
    addIssue(state, path, 'type', 'expected array')
    return
  }

  if (
    (node.minItems !== undefined && value.length < node.minItems) ||
    (node.maxItems !== undefined && value.length > node.maxItems)
  )
  {
    addIssue(
      state,
      path,
      'array_length',
      'array length is outside the allowed range'
    )
  }

  if (!enterContainer(state, value, path))
  {
    return
  }

  try
  {
    const extras = Reflect.ownKeys(value).filter((key) =>
    {
      if (key === 'length') return false
      if (typeof key !== 'string' || !/^(0|[1-9]\d*)$/u.test(key)) return true
      const index = Number(key)
      return (
        !Number.isSafeInteger(index) ||
        index < 0 ||
        index >= value.length ||
        String(index) !== key
      )
    })

    for (const extra of extras)
    {
      addIssue(
        state,
        path,
        'unknown_key',
        `array contains unknown key ${String(extra)}`
      )
    }

    for (let index = 0; index < value.length; index += 1)
    {
      const itemPath = pointerChild(path, String(index))
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index))

      if (descriptor === undefined)
      {
        addIssue(
          state,
          itemPath,
          'sparse_array',
          'array must not contain holes'
        )
        continue
      }

      if (!descriptor.enumerable || !('value' in descriptor))
      {
        addIssue(
          state,
          itemPath,
          'non_json_property',
          'array item must be an enumerable data property'
        )
        continue
      }

      validateNodeValue(
        node.items,
        descriptor.value,
        itemPath,
        depth + 1,
        state
      )
    }

    if (node.uniqueItems)
    {
      const firstIndexByValue = new Map<string, number>()

      for (let index = 0; index < value.length; index += 1)
      {
        const descriptor = Object.getOwnPropertyDescriptor(value, String(index))
        const key =
          descriptor !== undefined && 'value' in descriptor
            ? uniqueValueKey(descriptor.value, new Set())
            : undefined

        if (key === undefined)
        {
          continue
        }

        const firstIndex = firstIndexByValue.get(key)

        if (firstIndex !== undefined)
        {
          addIssue(
            state,
            pointerChild(path, String(index)),
            'unique_items',
            `array item duplicates index ${firstIndex}`
          )
        }
        else
        {
          firstIndexByValue.set(key, index)
        }
      }
    }
  }
  finally
  {
    state.ancestors.delete(value)
  }
}

function validateObjectValue(
  node: ObjectSchema,
  value: unknown,
  path: string,
  depth: number,
  state: ValidationState
): void
{
  if (!isPlainValueRecord(value))
  {
    addIssue(state, path, 'type', 'expected plain object')
    return
  }

  if (!enterContainer(state, value, path))
  {
    return
  }

  try
  {
    for (const symbol of Object.getOwnPropertySymbols(value))
    {
      addIssue(
        state,
        path,
        'unknown_key',
        `object contains unknown symbol key ${String(symbol)}`
      )
    }

    const actualKeys = Object.getOwnPropertyNames(value).sort(compareText)

    for (const key of actualKeys)
    {
      const childPath = pointerChild(path, key)

      if (!Object.hasOwn(node.fields, key))
      {
        addIssue(
          state,
          childPath,
          'unknown_key',
          `object contains unknown key ${JSON.stringify(key)}`
        )
        continue
      }

      const descriptor = Object.getOwnPropertyDescriptor(value, key)

      if (
        descriptor === undefined ||
        !descriptor.enumerable ||
        !('value' in descriptor)
      )
      {
        addIssue(
          state,
          childPath,
          'non_json_property',
          'object member must be an enumerable data property'
        )
        continue
      }

      validateNodeValue(
        node.fields[key]!.schema,
        descriptor.value,
        childPath,
        depth + 1,
        state
      )
    }

    for (const key of Object.keys(node.fields).sort(compareText))
    {
      if (node.fields[key]!.required && !Object.hasOwn(value, key))
      {
        addIssue(
          state,
          pointerChild(path, key),
          'required_key',
          `required key ${JSON.stringify(key)} is missing`
        )
      }
    }
  }
  finally
  {
    state.ancestors.delete(value)
  }
}

function validateAnyOfValue(
  node: AnyOfSchema,
  value: unknown,
  path: string,
  depth: number,
  state: ValidationState
): void
{
  for (const variant of node.variants)
  {
    const branch: ValidationState = {
      model: state.model,
      options: state.options,
      issues: [],
      ancestors: new Set(state.ancestors),
      truncated: false,
    }
    validateNodeValue(variant, value, path, depth + 1, branch)

    if (branch.issues.length === 0 && !branch.truncated)
    {
      return
    }
  }

  addIssue(state, path, 'any_of', 'value does not match any allowed schema')
}

function hasUnpairedSurrogate(value: string): boolean
{
  for (let index = 0; index < value.length; index += 1)
  {
    const codeUnit = value.charCodeAt(index)
    if (codeUnit >= 0xd800 && codeUnit <= 0xdbff)
    {
      const next = value.charCodeAt(index + 1)
      if (!(next >= 0xdc00 && next <= 0xdfff)) return true
      index += 1
    }
    else if (codeUnit >= 0xdc00 && codeUnit <= 0xdfff)
    {
      return true
    }
  }

  return false
}

function validateNodeValue(
  node: SchemaNode,
  value: unknown,
  path: string,
  depth: number,
  state: ValidationState
): void
{
  if (state.truncated)
  {
    return
  }

  if (depth > state.options.maxDepth)
  {
    addIssue(state, path, 'depth_exceeded', 'validation depth limit exceeded')
    return
  }

  switch (node.kind)
  {
    case 'string':
    {
      if (typeof value !== 'string')
      {
        addIssue(state, path, 'type', 'expected string')
        return
      }

      if (node.minLength !== undefined || node.maxLength !== undefined)
      {
        let length = 0
        for (const _codePoint of value) length += 1
        if (
          (node.minLength !== undefined && length < node.minLength) ||
          (node.maxLength !== undefined && length > node.maxLength)
        )
        {
          addIssue(
            state,
            path,
            'string_length',
            'string length is outside the allowed range'
          )
        }
      }

      if (node.pattern !== undefined)
      {
        let pattern = STRING_PATTERN_BY_SCHEMA.get(node)
        if (pattern === undefined)
        {
          pattern = new RegExp(node.pattern, 'u')
          STRING_PATTERN_BY_SCHEMA.set(node, pattern)
        }
        if (!pattern.test(value))
        {
          addIssue(
            state,
            path,
            'string_pattern',
            'string does not match the pattern'
          )
        }
      }

      if (node.rejectNul && value.includes('\0'))
      {
        addIssue(state, path, 'string_nul', 'string must not contain NUL')
      }

      const validateUtf8Length =
        node.utf8MinBytes !== undefined || node.utf8MaxBytes !== undefined
      const unpairedSurrogate =
        node.rejectUnpairedSurrogates || validateUtf8Length
          ? hasUnpairedSurrogate(value)
          : false
      if (node.rejectUnpairedSurrogates && unpairedSurrogate)
      {
        addIssue(
          state,
          path,
          'string_unpaired_surrogate',
          'string must not contain an unpaired surrogate'
        )
      }

      if (node.requireNfc && value.normalize('NFC') !== value)
      {
        addIssue(state, path, 'string_nfc', 'string must already be NFC')
      }

      if (validateUtf8Length)
      {
        if (!unpairedSurrogate)
        {
          const bytes = UTF8.encode(value).byteLength
          if (
            (node.utf8MinBytes !== undefined && bytes < node.utf8MinBytes) ||
            (node.utf8MaxBytes !== undefined && bytes > node.utf8MaxBytes)
          )
          {
            addIssue(
              state,
              path,
              'string_utf8_length',
              'UTF-8 byte length is outside the allowed range'
            )
          }
        }
      }
      return
    }
    case 'literalString':
      if (value !== node.value)
      {
        addIssue(
          state,
          path,
          'literal',
          'string does not match the required literal'
        )
      }
      return
    case 'enumString':
      if (typeof value !== 'string' || !node.values.includes(value))
      {
        addIssue(state, path, 'enum', 'string is not an allowed enum value')
      }
      return
    case 'literalBoolean':
    case 'literalInteger':
      if (!Object.is(value, node.value))
      {
        addIssue(
          state,
          path,
          'literal',
          'value does not match the required literal'
        )
      }
      return
    case 'number':
    case 'integer':
      validateNumericValue(node, value, path, state)
      return
    case 'boolean':
      if (typeof value !== 'boolean')
      {
        addIssue(state, path, 'type', 'expected boolean')
      }
      return
    case 'null':
      if (value !== null)
      {
        addIssue(state, path, 'type', 'expected null')
      }
      return
    case 'array':
      validateArrayValue(node, value, path, depth, state)
      return
    case 'object':
      validateObjectValue(node, value, path, depth, state)
      return
    case 'anyOf':
      validateAnyOfValue(node, value, path, depth, state)
      return
    case 'ref':
      validateNodeValue(
        state.model.definitions[node.name]!,
        value,
        path,
        depth + 1,
        state
      )
  }
}

export function validateSchemaValue(
  model: SchemaModel,
  value: unknown,
  options: SchemaValidationOptions = {}
): SchemaValidationResult
{
  const state: ValidationState = {
    model,
    options: resolveValidationOptions(options),
    issues: [],
    ancestors: new Set(),
    truncated: false,
  }
  validateNodeValue(model.root, value, '', 0, state)

  return state.issues.length === 0 && !state.truncated
    ? Object.freeze({ ok: true })
    : Object.freeze({
        ok: false,
        issues: Object.freeze([...state.issues]),
        truncated: state.truncated,
      })
}
