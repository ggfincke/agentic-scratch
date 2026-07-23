// packages/mcp/src/transport/json-schema-check.ts
// validate a value against the closed JSON Schema subset the project tools emit

type JsonSchema = Record<string, unknown>

// every keyword the closed project projections actually use; anything else refuses
const SUPPORTED_KEYWORDS = new Set([
  '$defs',
  '$ref',
  '$schema',
  'additionalItems',
  'additionalProperties',
  'anyOf',
  'const',
  'enum',
  'items',
  'maxItems',
  'maxLength',
  'maxProperties',
  'maximum',
  'minItems',
  'minLength',
  'minimum',
  'oneOf',
  'patternProperties',
  'pattern',
  'prefixItems',
  'properties',
  'propertyNames',
  'required',
  'type',
  'uniqueItems',
])

const MAX_DEPTH = 64

interface CheckState
{
  readonly definitions: Record<string, JsonSchema>
  readonly issues: string[]
}

function record(value: unknown): value is Record<string, unknown>
{
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

// 2020-12 allows a boolean in any schema slot; `items: false` closes a tuple
function checkAny(
  node: unknown,
  value: unknown,
  path: string,
  depth: number,
  state: CheckState
): void
{
  if (node === true) return
  if (node === false)
  {
    state.issues.push(`${path}: schema accepts no value here`)
    return
  }
  checkNode(schemaOf(node), value, path, depth, state)
}

function schemaOf(value: unknown): JsonSchema
{
  if (!record(value)) throw new TypeError('schema node must be an object')
  for (const key of Object.keys(value))
  {
    if (!SUPPORTED_KEYWORDS.has(key))
    {
      throw new TypeError(`unsupported JSON Schema keyword ${key}`)
    }
  }
  return value
}

function typeMatches(expected: string, value: unknown): boolean
{
  switch (expected)
  {
    case 'object':
      return record(value)
    case 'array':
      return Array.isArray(value)
    case 'string':
      return typeof value === 'string'
    case 'boolean':
      return typeof value === 'boolean'
    case 'null':
      return value === null
    case 'integer':
      return typeof value === 'number' && Number.isSafeInteger(value)
    case 'number':
      return typeof value === 'number' && Number.isFinite(value)
    default:
      return false
  }
}

function sameJson(left: unknown, right: unknown): boolean
{
  return JSON.stringify(left) === JSON.stringify(right)
}

function resolve(node: JsonSchema, state: CheckState): JsonSchema
{
  let current = node
  let hops = 0
  while (typeof current.$ref === 'string')
  {
    hops += 1
    if (hops > MAX_DEPTH) throw new TypeError('cyclic $ref chain')
    const prefix = '#/$defs/'
    const reference = current.$ref
    if (!reference.startsWith(prefix))
    {
      throw new TypeError(`unsupported $ref ${reference}`)
    }
    const target = state.definitions[reference.slice(prefix.length)]
    if (target === undefined)
      throw new TypeError(`unresolved $ref ${reference}`)
    current = schemaOf(target)
  }
  return current
}

function branchCount(
  branches: readonly unknown[],
  value: unknown,
  path: string,
  depth: number,
  state: CheckState
): number
{
  let matched = 0
  for (const branch of branches)
  {
    const probe: CheckState = { definitions: state.definitions, issues: [] }
    checkAny(branch, value, path, depth + 1, probe)
    if (probe.issues.length === 0) matched += 1
  }
  return matched
}

function checkObject(
  node: JsonSchema,
  value: Record<string, unknown>,
  path: string,
  depth: number,
  state: CheckState
): void
{
  const properties = record(node.properties) ? node.properties : {}
  const patterns = record(node.patternProperties) ? node.patternProperties : {}
  const keys = Object.keys(value)
  if (
    typeof node.maxProperties === 'number' &&
    keys.length > node.maxProperties
  )
  {
    state.issues.push(`${path}: too many properties`)
  }
  for (const required of Array.isArray(node.required) ? node.required : [])
  {
    if (!(String(required) in value))
    {
      state.issues.push(`${path}: missing required ${String(required)}`)
    }
  }
  for (const key of keys)
  {
    const child = `${path}/${key}`
    if (node.propertyNames !== undefined)
    {
      checkAny(node.propertyNames, key, child, depth + 1, state)
    }
    let covered = false
    if (Object.hasOwn(properties, key))
    {
      covered = true
      checkAny(
        (properties as JsonSchema)[key],
        value[key],
        child,
        depth + 1,
        state
      )
    }
    for (const [pattern, sub] of Object.entries(patterns))
    {
      if (new RegExp(pattern, 'u').test(key))
      {
        covered = true
        checkAny(sub, value[key], child, depth + 1, state)
      }
    }
    if (!covered && node.additionalProperties === false)
    {
      state.issues.push(`${child}: unknown property`)
    }
  }
}

function checkArray(
  node: JsonSchema,
  value: readonly unknown[],
  path: string,
  depth: number,
  state: CheckState
): void
{
  if (typeof node.maxItems === 'number' && value.length > node.maxItems)
  {
    state.issues.push(`${path}: too many items`)
  }
  if (typeof node.minItems === 'number' && value.length < node.minItems)
  {
    state.issues.push(`${path}: too few items`)
  }
  if (node.uniqueItems === true)
  {
    const seen = new Set(value.map((entry) => JSON.stringify(entry)))
    if (seen.size !== value.length)
      state.issues.push(`${path}: duplicate items`)
  }
  const tuple = Array.isArray(node.items) ? node.items : null
  const prefix =
    tuple ?? (Array.isArray(node.prefixItems) ? node.prefixItems : [])
  const rest = tuple
    ? node.additionalItems
    : node.prefixItems
      ? node.items
      : node.items
  for (let index = 0; index < value.length; index += 1)
  {
    const child = `${path}/${index}`
    if (index < prefix.length)
    {
      checkAny(prefix[index], value[index], child, depth + 1, state)
      continue
    }
    if (rest !== undefined)
    {
      checkAny(rest, value[index], child, depth + 1, state)
    }
  }
}

function checkScalar(
  node: JsonSchema,
  value: unknown,
  path: string,
  state: CheckState
): void
{
  if (typeof value === 'string')
  {
    if (typeof node.maxLength === 'number' && value.length > node.maxLength)
    {
      state.issues.push(`${path}: string too long`)
    }
    if (typeof node.minLength === 'number' && value.length < node.minLength)
    {
      state.issues.push(`${path}: string too short`)
    }
    if (
      typeof node.pattern === 'string' &&
      !new RegExp(node.pattern, 'u').test(value)
    )
    {
      state.issues.push(`${path}: string does not match its pattern`)
    }
  }
  if (typeof value === 'number')
  {
    if (typeof node.maximum === 'number' && value > node.maximum)
    {
      state.issues.push(`${path}: number above maximum`)
    }
    if (typeof node.minimum === 'number' && value < node.minimum)
    {
      state.issues.push(`${path}: number below minimum`)
    }
  }
}

function checkNode(
  raw: JsonSchema,
  value: unknown,
  path: string,
  depth: number,
  state: CheckState
): void
{
  if (depth > MAX_DEPTH)
  {
    state.issues.push(`${path}: schema nesting exceeded`)
    return
  }
  const node = resolve(schemaOf(raw), state)
  if ('const' in node && !sameJson(node.const, value))
  {
    state.issues.push(`${path}: value is not the required constant`)
  }
  if (
    Array.isArray(node.enum) &&
    !node.enum.some((one) => sameJson(one, value))
  )
  {
    state.issues.push(`${path}: value is not in the advertised enum`)
  }
  if (typeof node.type === 'string' && !typeMatches(node.type, value))
  {
    state.issues.push(`${path}: expected ${node.type}`)
    return
  }
  if (Array.isArray(node.anyOf))
  {
    if (branchCount(node.anyOf, value, path, depth, state) === 0)
    {
      state.issues.push(`${path}: no anyOf branch matched`)
    }
  }
  if (Array.isArray(node.oneOf))
  {
    if (branchCount(node.oneOf, value, path, depth, state) !== 1)
    {
      state.issues.push(`${path}: exactly one oneOf branch must match`)
    }
  }
  checkScalar(node, value, path, state)
  if (record(value)) checkObject(node, value, path, depth, state)
  if (Array.isArray(value)) checkArray(node, value, path, depth, state)
}

// returns the issue list; an empty list means the value matched exactly
export function validateClosedJsonSchemaValueV1(
  schema: JsonSchema,
  value: unknown
): readonly string[]
{
  const definitions = record(schema.$defs)
    ? (schema.$defs as Record<string, JsonSchema>)
    : {}
  const state: CheckState = { definitions, issues: [] }
  checkAny(schema, value, '', 0, state)
  return Object.freeze([...state.issues])
}
