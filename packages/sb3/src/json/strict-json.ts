// packages/sb3/src/json/strict-json.ts
// iteratively scan bounded JSON before parsing or recursive project work

export const STRICT_JSON_CODES = {
  utf8Invalid: 'EDIT_JSON_UTF8_INVALID',
  syntaxInvalid: 'EDIT_JSON_SYNTAX_INVALID',
  duplicateKey: 'EDIT_JSON_DUPLICATE_KEY',
  depthExceeded: 'EDIT_JSON_DEPTH_EXCEEDED',
  membersExceeded: 'EDIT_JSON_MEMBERS_EXCEEDED',
  nodesExceeded: 'EDIT_JSON_NODES_EXCEEDED',
  numberInvalid: 'EDIT_JSON_NUMBER_INVALID',
} as const

type StrictJsonCode =
  (typeof STRICT_JSON_CODES)[keyof typeof STRICT_JSON_CODES]

interface StrictJsonLimits
{
  maxDepth: number
  maxMembersPerContainer: number
  maxNodes: number
}

export interface StrictJsonMetrics
{
  utf8Bytes: number
  maximumDepth: number
  nodes: number
  objectMembers: number
  arrayItems: number
}

interface StrictJsonScanResult
{
  text: string
  value: unknown
  metrics: StrictJsonMetrics
}

interface ContainerFrameBase
{
  members: number
}

interface ObjectFrame extends ContainerFrameBase
{
  kind: 'object'
  keys: Set<string>
  state: 'first-key-or-end' | 'key' | 'comma-or-end'
}

interface ArrayFrame extends ContainerFrameBase
{
  kind: 'array'
  state: 'first-value-or-end' | 'value' | 'comma-or-end'
}

type ContainerFrame = ObjectFrame | ArrayFrame

const SIMPLE_ESCAPES: Readonly<Record<string, string>> = {
  '"': '"',
  '/': '/',
  '\\': '\\',
  b: '\b',
  f: '\f',
  n: '\n',
  r: '\r',
  t: '\t',
}

export class StrictJsonScanError extends Error
{
  readonly code: StrictJsonCode
  readonly offset: number
  readonly observed?: number
  readonly limit?: number

  constructor(
    code: StrictJsonCode,
    message: string,
    offset: number,
    values: { observed?: number; limit?: number } = {}
  )
  {
    super(message)
    this.name = 'StrictJsonScanError'
    this.code = code
    this.offset = offset
    this.observed = values.observed
    this.limit = values.limit
  }
}

function fail(
  code: StrictJsonCode,
  message: string,
  offset: number,
  values: { observed?: number; limit?: number } = {}
): never
{
  throw new StrictJsonScanError(code, message, offset, values)
}

function decodeInput(input: Uint8Array | string): {
  text: string
  utf8Bytes: number
}
{
  if (typeof input === 'string')
  {
    return {
      text: input,
      utf8Bytes: new TextEncoder().encode(input).byteLength,
    }
  }
  try
  {
    return {
      text: new TextDecoder('utf-8', { fatal: true }).decode(input),
      utf8Bytes: input.byteLength,
    }
  }
  catch (cause)
  {
    throw new StrictJsonScanError(
      STRICT_JSON_CODES.utf8Invalid,
      `invalid UTF-8 JSON input: ${cause instanceof Error ? cause.message : String(cause)}`,
      0
    )
  }
}

function isWhitespace(code: number): boolean
{
  return code === 0x20 || code === 0x09 || code === 0x0a || code === 0x0d
}

function skipWhitespace(text: string, start: number): number
{
  let index = start
  while (index < text.length && isWhitespace(text.charCodeAt(index))) index++
  return index
}

function hexValue(code: number): number
{
  if (code >= 0x30 && code <= 0x39) return code - 0x30
  if (code >= 0x41 && code <= 0x46) return code - 0x41 + 10
  if (code >= 0x61 && code <= 0x66) return code - 0x61 + 10
  return -1
}

function parseStringToken(
  text: string,
  start: number
): { end: number; value: string }
{
  if (text[start] !== '"')
  {
    return fail(STRICT_JSON_CODES.syntaxInvalid, 'expected JSON string', start)
  }
  let index = start + 1
  let value = ''
  while (index < text.length)
  {
    const code = text.charCodeAt(index)
    if (code === 0x22) return { end: index + 1, value }
    if (code < 0x20)
    {
      return fail(
        STRICT_JSON_CODES.syntaxInvalid,
        'unescaped control code in JSON string',
        index
      )
    }
    if (code === 0x5c)
    {
      const escape = text[index + 1]
      if (escape !== undefined && Object.hasOwn(SIMPLE_ESCAPES, escape))
      {
        value += SIMPLE_ESCAPES[escape]
        index += 2
        continue
      }
      if (escape !== 'u' || index + 5 >= text.length)
      {
        return fail(
          STRICT_JSON_CODES.syntaxInvalid,
          'invalid JSON string escape',
          index
        )
      }
      let decoded = 0
      for (let offset = 2; offset <= 5; offset++)
      {
        const digit = hexValue(text.charCodeAt(index + offset))
        if (digit < 0)
        {
          return fail(
            STRICT_JSON_CODES.syntaxInvalid,
            'invalid Unicode escape in JSON string',
            index
          )
        }
        decoded = decoded * 16 + digit
      }
      value += String.fromCharCode(decoded)
      index += 6
      continue
    }
    if (code >= 0xd800 && code <= 0xdbff)
    {
      const low = text.charCodeAt(index + 1)
      if (!(low >= 0xdc00 && low <= 0xdfff))
      {
        return fail(
          STRICT_JSON_CODES.utf8Invalid,
          'literal unpaired surrogate cannot occur in UTF-8 JSON',
          index
        )
      }
      value += text[index]! + text[index + 1]!
      index += 2
      continue
    }
    if (code >= 0xdc00 && code <= 0xdfff)
    {
      return fail(
        STRICT_JSON_CODES.utf8Invalid,
        'literal unpaired surrogate cannot occur in UTF-8 JSON',
        index
      )
    }
    value += text[index]!
    index++
  }
  return fail(
    STRICT_JSON_CODES.syntaxInvalid,
    'unterminated JSON string',
    start
  )
}

function parseNumberToken(text: string, start: number): number
{
  let index = start
  if (text[index] === '-') index++
  if (text[index] === '0') index++
  else
  {
    const first = text.charCodeAt(index)
    if (!(first >= 0x31 && first <= 0x39))
    {
      return fail(STRICT_JSON_CODES.syntaxInvalid, 'invalid JSON number', start)
    }
    index++
    while (index < text.length)
    {
      const code = text.charCodeAt(index)
      if (code < 0x30 || code > 0x39) break
      index++
    }
  }
  if (text[index] === '.')
  {
    index++
    const first = text.charCodeAt(index)
    if (!(first >= 0x30 && first <= 0x39))
    {
      return fail(
        STRICT_JSON_CODES.syntaxInvalid,
        'invalid JSON number fraction',
        index
      )
    }
    while (index < text.length)
    {
      const code = text.charCodeAt(index)
      if (code < 0x30 || code > 0x39) break
      index++
    }
  }
  if (text[index] === 'e' || text[index] === 'E')
  {
    index++
    if (text[index] === '+' || text[index] === '-') index++
    const first = text.charCodeAt(index)
    if (!(first >= 0x30 && first <= 0x39))
    {
      return fail(
        STRICT_JSON_CODES.syntaxInvalid,
        'invalid JSON number exponent',
        index
      )
    }
    while (index < text.length)
    {
      const code = text.charCodeAt(index)
      if (code < 0x30 || code > 0x39) break
      index++
    }
  }
  const token = text.slice(start, index)
  const parsed = Number(token)
  if (
    !Number.isFinite(parsed) ||
    Object.is(parsed, -0) ||
    (Number.isInteger(parsed) && !Number.isSafeInteger(parsed))
  )
  {
    return fail(
      STRICT_JSON_CODES.numberInvalid,
      `JSON number ${JSON.stringify(token)} is outside the edit profile`,
      start
    )
  }
  const reemitted = String(parsed)
  if (!Object.is(Number(reemitted), parsed))
  {
    return fail(
      STRICT_JSON_CODES.numberInvalid,
      `JSON number ${JSON.stringify(token)} cannot be canonically re-emitted`,
      start
    )
  }
  return index
}

function literalEnd(text: string, start: number, literal: string): number
{
  if (text.slice(start, start + literal.length) !== literal)
  {
    return fail(
      STRICT_JSON_CODES.syntaxInvalid,
      `invalid JSON token at offset ${start}`,
      start
    )
  }
  return start + literal.length
}

function postcheckNumbers(value: unknown): void
{
  const pending: unknown[] = [value]
  while (pending.length > 0)
  {
    const current = pending.pop()
    if (typeof current === 'number')
    {
      if (
        !Number.isFinite(current) ||
        Object.is(current, -0) ||
        (Number.isInteger(current) && !Number.isSafeInteger(current))
      )
      {
        fail(
          STRICT_JSON_CODES.numberInvalid,
          'parsed JSON contains a number outside the edit profile',
          0
        )
      }
      continue
    }
    if (Array.isArray(current))
    {
      for (const entry of current) pending.push(entry)
      continue
    }
    if (current !== null && typeof current === 'object')
    {
      for (const key of Object.keys(current))
      {
        pending.push((current as Record<string, unknown>)[key])
      }
    }
  }
}

export function scanStrictJson(
  input: Uint8Array | string,
  limits: StrictJsonLimits
): StrictJsonScanResult
{
  const decoded = decodeInput(input)
  const text = decoded.text
  const stack: ContainerFrame[] = []
  let index = skipWhitespace(text, 0)
  let nodes = 0
  let objectMembers = 0
  let arrayItems = 0
  let maximumDepth = 0

  const noteNode = (): void =>
  {
    nodes++
    if (nodes > limits.maxNodes)
    {
      fail(STRICT_JSON_CODES.nodesExceeded, 'JSON node limit exceeded', index, {
        observed: nodes,
        limit: limits.maxNodes,
      })
    }
  }
  const pushContainer = (frame: ContainerFrame): void =>
  {
    stack.push(frame)
    maximumDepth = Math.max(maximumDepth, stack.length)
    if (stack.length > limits.maxDepth)
    {
      fail(
        STRICT_JSON_CODES.depthExceeded,
        'JSON nesting depth limit exceeded',
        index,
        { observed: stack.length, limit: limits.maxDepth }
      )
    }
  }
  const parseValue = (): void =>
  {
    index = skipWhitespace(text, index)
    noteNode()
    const token = text[index]
    if (token === '{')
    {
      index++
      pushContainer({
        kind: 'object',
        keys: new Set(),
        members: 0,
        state: 'first-key-or-end',
      })
      return
    }
    if (token === '[')
    {
      index++
      pushContainer({
        kind: 'array',
        members: 0,
        state: 'first-value-or-end',
      })
      return
    }
    if (token === '"')
    {
      index = parseStringToken(text, index).end
      return
    }
    if (token === '-' || (token !== undefined && /[0-9]/u.test(token)))
    {
      index = parseNumberToken(text, index)
      return
    }
    if (token === 't')
    {
      index = literalEnd(text, index, 'true')
      return
    }
    if (token === 'f')
    {
      index = literalEnd(text, index, 'false')
      return
    }
    if (token === 'n')
    {
      index = literalEnd(text, index, 'null')
      return
    }
    fail(STRICT_JSON_CODES.syntaxInvalid, 'expected JSON value', index)
  }

  parseValue()
  while (stack.length > 0)
  {
    index = skipWhitespace(text, index)
    const frame = stack[stack.length - 1]!
    if (frame.kind === 'object')
    {
      if (frame.state === 'first-key-or-end' && text[index] === '}')
      {
        index++
        stack.pop()
        continue
      }
      if (frame.state === 'comma-or-end')
      {
        if (text[index] === '}')
        {
          index++
          stack.pop()
          continue
        }
        if (text[index] !== ',')
        {
          fail(
            STRICT_JSON_CODES.syntaxInvalid,
            'expected comma or object end',
            index
          )
        }
        index++
        frame.state = 'key'
        continue
      }
      const key = parseStringToken(text, index)
      index = skipWhitespace(text, key.end)
      if (frame.keys.has(key.value))
      {
        fail(
          STRICT_JSON_CODES.duplicateKey,
          `duplicate decoded object key ${JSON.stringify(key.value)}`,
          index
        )
      }
      frame.keys.add(key.value)
      frame.members++
      objectMembers++
      if (frame.members > limits.maxMembersPerContainer)
      {
        fail(
          STRICT_JSON_CODES.membersExceeded,
          'JSON object member limit exceeded',
          index,
          { observed: frame.members, limit: limits.maxMembersPerContainer }
        )
      }
      if (text[index] !== ':')
      {
        fail(
          STRICT_JSON_CODES.syntaxInvalid,
          'expected colon after object key',
          index
        )
      }
      index++
      frame.state = 'comma-or-end'
      parseValue()
      continue
    }
    if (frame.state === 'first-value-or-end' && text[index] === ']')
    {
      index++
      stack.pop()
      continue
    }
    if (frame.state === 'comma-or-end')
    {
      if (text[index] === ']')
      {
        index++
        stack.pop()
        continue
      }
      if (text[index] !== ',')
      {
        fail(
          STRICT_JSON_CODES.syntaxInvalid,
          'expected comma or array end',
          index
        )
      }
      index++
      frame.state = 'value'
      continue
    }
    frame.members++
    arrayItems++
    if (frame.members > limits.maxMembersPerContainer)
    {
      fail(
        STRICT_JSON_CODES.membersExceeded,
        'JSON array member limit exceeded',
        index,
        { observed: frame.members, limit: limits.maxMembersPerContainer }
      )
    }
    frame.state = 'comma-or-end'
    parseValue()
  }
  index = skipWhitespace(text, index)
  if (index !== text.length)
  {
    fail(
      STRICT_JSON_CODES.syntaxInvalid,
      'unexpected data after root JSON value',
      index
    )
  }

  let value: unknown
  try
  {
    value = JSON.parse(text) as unknown
  }
  catch (cause)
  {
    return fail(
      STRICT_JSON_CODES.syntaxInvalid,
      `invalid JSON: ${cause instanceof Error ? cause.message : String(cause)}`,
      0
    )
  }
  postcheckNumbers(value)
  return {
    text,
    value,
    metrics: {
      utf8Bytes: decoded.utf8Bytes,
      maximumDepth,
      nodes,
      objectMembers,
      arrayItems,
    },
  }
}
