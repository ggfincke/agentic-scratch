// packages/sb3/src/canonical-json-bytes.ts
// pure strict CanonicalJsonV1 byte encoder shared by Node & browser consumers

export type CanonicalJsonValue =
  | null
  | boolean
  | number
  | string
  | CanonicalJsonValue[]
  | { [key: string]: CanonicalJsonValue }

interface CanonicalJsonLimits
{
  maxDepth: number
  maxNodes: number
  maxMembers: number
  maxStringCodeUnits: number
}

export const DEFAULT_CANONICAL_JSON_LIMITS: CanonicalJsonLimits = Object.freeze(
  {
    maxDepth: 64,
    maxNodes: 100_000,
    maxMembers: 16_384,
    maxStringCodeUnits: 1_000_000,
  }
)

export class CanonicalJsonError extends Error
{
  constructor(
    readonly code:
      | 'accessor'
      | 'cycle'
      | 'depth'
      | 'members'
      | 'nonfinite'
      | 'negative-zero'
      | 'non-json'
      | 'non-plain-array'
      | 'non-plain-object'
      | 'nodes'
      | 'sparse-array'
      | 'string-length'
      | 'symbol-key'
      | 'unsafe-integer',
    readonly path: string
  )
  {
    super(`CanonicalJsonV1 ${code} at ${path}`)
  }
}

interface EncodeState
{
  limits: CanonicalJsonLimits
  nodes: number
  ancestors: Set<object>
}

function hex4(value: number): string
{
  return value.toString(16).padStart(4, '0')
}

function escapeString(value: string, path: string, state: EncodeState): string
{
  if (value.length > state.limits.maxStringCodeUnits)
  {
    throw new CanonicalJsonError('string-length', path)
  }
  let output = '"'
  for (let index = 0; index < value.length; index += 1)
  {
    const code = value.charCodeAt(index)
    if (code === 0x22) output += '\\"'
    else if (code === 0x5c) output += '\\\\'
    else if (code === 0x08) output += '\\b'
    else if (code === 0x09) output += '\\t'
    else if (code === 0x0a) output += '\\n'
    else if (code === 0x0c) output += '\\f'
    else if (code === 0x0d) output += '\\r'
    else if (code < 0x20) output += `\\u${hex4(code)}`
    else if (code >= 0xd800 && code <= 0xdbff)
    {
      const next = value.charCodeAt(index + 1)
      if (next >= 0xdc00 && next <= 0xdfff)
      {
        output += value[index]
        output += value[index + 1]
        index += 1
      }
      else output += `\\u${hex4(code)}`
    }
    else if (code >= 0xdc00 && code <= 0xdfff)
    {
      output += `\\u${hex4(code)}`
    }
    else output += value[index]
  }
  return `${output}"`
}

function encodeNumber(value: number, path: string): string
{
  if (!Number.isFinite(value))
  {
    throw new CanonicalJsonError('nonfinite', path)
  }
  if (Object.is(value, -0))
  {
    throw new CanonicalJsonError('negative-zero', path)
  }
  if (Number.isInteger(value) && !Number.isSafeInteger(value))
  {
    throw new CanonicalJsonError('unsafe-integer', path)
  }
  return String(value)
}

function assertContainer(
  value: object,
  path: string,
  depth: number,
  state: EncodeState
): void
{
  if (depth > state.limits.maxDepth)
  {
    throw new CanonicalJsonError('depth', path)
  }
  if (state.ancestors.has(value))
  {
    throw new CanonicalJsonError('cycle', path)
  }
  state.ancestors.add(value)
}

function encodeArray(
  value: unknown[],
  path: string,
  depth: number,
  state: EncodeState
): string
{
  if (Object.getPrototypeOf(value) !== Array.prototype)
  {
    throw new CanonicalJsonError('non-plain-array', path)
  }
  assertContainer(value, path, depth, state)
  const names = Object.getOwnPropertyNames(value)
  const expectedNames = new Set([
    'length',
    ...Array.from({ length: value.length }, (_, index) => String(index)),
  ])
  if (names.some((name) => !expectedNames.has(name)))
  {
    state.ancestors.delete(value)
    throw new CanonicalJsonError('non-json', path)
  }
  if (Object.getOwnPropertySymbols(value).length > 0)
  {
    state.ancestors.delete(value)
    throw new CanonicalJsonError('symbol-key', path)
  }
  if (value.length > state.limits.maxMembers)
  {
    state.ancestors.delete(value)
    throw new CanonicalJsonError('members', path)
  }
  const entries: string[] = []
  for (let index = 0; index < value.length; index += 1)
  {
    if (!Object.hasOwn(value, index))
    {
      state.ancestors.delete(value)
      throw new CanonicalJsonError('sparse-array', `${path}/${index}`)
    }
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index))
    if (!descriptor || !descriptor.enumerable || !('value' in descriptor))
    {
      state.ancestors.delete(value)
      throw new CanonicalJsonError('accessor', `${path}/${index}`)
    }
    entries.push(encode(descriptor.value, `${path}/${index}`, depth + 1, state))
  }
  state.ancestors.delete(value)
  return `[${entries.join(',')}]`
}

function encodeObject(
  value: object,
  path: string,
  depth: number,
  state: EncodeState
): string
{
  const prototype = Object.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== null)
  {
    throw new CanonicalJsonError('non-plain-object', path)
  }
  assertContainer(value, path, depth, state)
  if (Object.getOwnPropertySymbols(value).length > 0)
  {
    state.ancestors.delete(value)
    throw new CanonicalJsonError('symbol-key', path)
  }
  const keys = Object.getOwnPropertyNames(value).sort()
  if (keys.length > state.limits.maxMembers)
  {
    state.ancestors.delete(value)
    throw new CanonicalJsonError('members', path)
  }
  const entries: string[] = []
  for (const key of keys)
  {
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    if (!descriptor || !descriptor.enumerable || !('value' in descriptor))
    {
      state.ancestors.delete(value)
      throw new CanonicalJsonError('accessor', `${path}/${key}`)
    }
    const encodedKey = escapeString(key, `${path}/<key>`, state)
    const encodedValue = encode(
      descriptor.value,
      `${path}/${key}`,
      depth + 1,
      state
    )
    entries.push(`${encodedKey}:${encodedValue}`)
  }
  state.ancestors.delete(value)
  return `{${entries.join(',')}}`
}

function encode(
  value: unknown,
  path: string,
  depth: number,
  state: EncodeState
): string
{
  state.nodes += 1
  if (state.nodes > state.limits.maxNodes)
  {
    throw new CanonicalJsonError('nodes', path)
  }
  if (value === null) return 'null'
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  if (typeof value === 'number') return encodeNumber(value, path)
  if (typeof value === 'string') return escapeString(value, path, state)
  if (Array.isArray(value)) return encodeArray(value, path, depth, state)
  if (typeof value === 'object') return encodeObject(value, path, depth, state)
  throw new CanonicalJsonError('non-json', path)
}

export function canonicalJsonV1(
  value: unknown,
  limits: CanonicalJsonLimits = DEFAULT_CANONICAL_JSON_LIMITS
): string
{
  if (
    !Number.isSafeInteger(limits.maxDepth) ||
    !Number.isSafeInteger(limits.maxNodes) ||
    !Number.isSafeInteger(limits.maxMembers) ||
    !Number.isSafeInteger(limits.maxStringCodeUnits) ||
    Object.values(limits).some((limit) => limit <= 0)
  )
  {
    throw new Error('CanonicalJsonV1 limits must be positive safe integers')
  }
  return encode(value, '$', 0, {
    limits,
    nodes: 0,
    ancestors: new Set(),
  })
}

export function canonicalJsonBytesV1(value: unknown): Uint8Array
{
  return new TextEncoder().encode(canonicalJsonV1(value))
}

export function semanticHashPreimageV1(
  domain: string,
  value: unknown
): Uint8Array
{
  if (!/^[a-z][a-z0-9-]{0,63}$/.test(domain))
  {
    throw new Error('invalid Phase 8 semantic hash domain')
  }
  const prefix = new TextEncoder().encode(`scratch-agent:${domain}:v1\0`)
  const canonical = canonicalJsonBytesV1(value)
  const output = new Uint8Array(prefix.byteLength + canonical.byteLength)
  output.set(prefix, 0)
  output.set(canonical, prefix.byteLength)
  return output
}
