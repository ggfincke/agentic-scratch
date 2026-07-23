// packages/mcp/src/transport/jsonl-boundary.ts
// bounded strict jsonl framing & canonical parsing ahead of any sdk json parse

import { createHash } from 'node:crypto'
import type { Readable, Writable } from 'node:stream'

import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js'
import {
  JSONRPCMessageSchema,
  type JSONRPCMessage,
  type RequestId,
} from '@modelcontextprotocol/sdk/types.js'

import { McpBoundaryError } from './errors.js'

export const JSONL_BOUNDARY_REFUSAL_CODES = Object.freeze([
  'mcp.frame-too-large',
  'mcp.frame-empty',
  'mcp.frame-invalid-utf8',
  'mcp.frame-malformed',
  'mcp.frame-too-deep',
  'mcp.frame-members-exceeded',
  'mcp.frame-duplicate-key',
  'mcp.frame-unsafe-number',
  'mcp.frame-not-object',
  'mcp.frame-invalid-json-rpc',
  'mcp.frame-nul-string',
  'mcp.frame-unpaired-surrogate',
  'mcp.frame-admission-queue-exceeded',
  'mcp.frame-inflight-exceeded',
  'mcp.frame-request-id-conflict',
  'mcp.frame-refusal-overflow',
  'mcp.outbound-frame-too-large',
] as const)

export type JsonlBoundaryRefusalCodeV1 =
  (typeof JSONL_BOUNDARY_REFUSAL_CODES)[number]

// every detail string is selected by code alone, so a refusal can never carry a
// fragment of the frame that produced it
const REFUSAL_DETAILS: Readonly<Record<JsonlBoundaryRefusalCodeV1, string>> =
  Object.freeze({
    'mcp.frame-too-large':
      'inbound frame exceeded its raw byte cap before parsing',
    'mcp.frame-empty': 'inbound frame carried no bytes',
    'mcp.frame-invalid-utf8': 'inbound frame was not strict utf-8',
    'mcp.frame-malformed': 'inbound frame was not strict json',
    'mcp.frame-too-deep': 'inbound frame exceeded its nesting limit',
    'mcp.frame-members-exceeded': 'inbound frame exceeded its member limit',
    'mcp.frame-duplicate-key': 'inbound frame repeated an object key',
    'mcp.frame-unsafe-number':
      'inbound frame carried an unrepresentable number',
    'mcp.frame-not-object': 'inbound frame was not a json object',
    'mcp.frame-invalid-json-rpc':
      'inbound frame was not a valid json-rpc message',
    'mcp.frame-nul-string': 'inbound frame carried a nul in a json string',
    'mcp.frame-unpaired-surrogate':
      'inbound frame carried an unpaired surrogate in a json string',
    'mcp.frame-admission-queue-exceeded':
      'accepted frames exceeded the bounded admission queue',
    'mcp.frame-inflight-exceeded':
      'inbound requests exceeded the bounded in-flight response capacity',
    'mcp.frame-request-id-conflict':
      'inbound request repeated an id that has not completed',
    'mcp.frame-refusal-overflow':
      'inbound refusals exceeded the retained refusal queue',
    'mcp.outbound-frame-too-large': 'outbound frame exceeded its raw byte cap',
  })

export interface JsonlBoundaryLimitsV1
{
  readonly maximumInboundFrameBytes: number
  readonly maximumOutboundFrameBytes: number
  readonly maximumDepth: number
  readonly maximumContainerMembers: number
  readonly maximumTotalMembers: number
  readonly maximumQueuedRefusals: number
  readonly maximumQueuedOutboundFrames: number
  readonly maximumQueuedOutboundBytes: number
}

// the inbound raw cap is both the default & the hard maximum, so no
// configuration path can widen the byte surface the parser is ever handed
export const HARD_MAXIMUM_JSONL_BOUNDARY_LIMITS_V1: JsonlBoundaryLimitsV1 =
  Object.freeze({
    maximumInboundFrameBytes: 128 * 1024,
    maximumOutboundFrameBytes: 8 * 1024 * 1024,
    maximumDepth: 64,
    maximumContainerMembers: 4096,
    maximumTotalMembers: 65536,
    maximumQueuedRefusals: 256,
    maximumQueuedOutboundFrames: 256,
    maximumQueuedOutboundBytes: 32 * 1024 * 1024,
  })

export const DEFAULT_JSONL_BOUNDARY_LIMITS_V1: JsonlBoundaryLimitsV1 =
  HARD_MAXIMUM_JSONL_BOUNDARY_LIMITS_V1

export function resolveJsonlBoundaryLimitsV1(
  overrides: Partial<JsonlBoundaryLimitsV1> = {}
): JsonlBoundaryLimitsV1
{
  for (const key of Object.keys(overrides))
    if (!Object.hasOwn(DEFAULT_JSONL_BOUNDARY_LIMITS_V1, key))
      throw new McpBoundaryError(
        'mcp.transport-limit-invalid',
        'jsonl boundary limits contain an unknown field'
      )
  const limits = { ...DEFAULT_JSONL_BOUNDARY_LIMITS_V1, ...overrides }
  for (const key of Object.keys(limits) as Array<keyof JsonlBoundaryLimitsV1>)
  {
    const value = limits[key]
    if (
      !Number.isSafeInteger(value) ||
      value < 1 ||
      value > HARD_MAXIMUM_JSONL_BOUNDARY_LIMITS_V1[key]
    )
      throw new McpBoundaryError(
        'mcp.transport-limit-invalid',
        `jsonl boundary limit ${key} may only lower its default`
      )
  }
  return Object.freeze(limits)
}

export interface JsonlFrameMetadataV1
{
  readonly frameSequence: number
  readonly rawByteLength: number
  readonly retainedByteLength: number
  readonly truncated: boolean
  readonly rawSha256: string
}

// * the bounded evidence a refusal-queue overflow retains. It is fixed-size no
// * matter how many refusals were folded into it, so the fact & shape of the
// * suppressed refusals survives without the queue growing alongside it
export interface JsonlSuppressedRefusalSummaryV1
{
  readonly refusalCount: number
  readonly firstCode: JsonlBoundaryRefusalCodeV1
  readonly lastCode: JsonlBoundaryRefusalCodeV1
  readonly firstFrameSequence: number
  readonly lastFrameSequence: number
  readonly rawByteLength: number
  readonly codeChainSha256: string
}

export interface JsonlFrameRefusalV1
{
  readonly ok: false
  readonly code: JsonlBoundaryRefusalCodeV1
  readonly detail: string
  readonly offset: number | null
  readonly metadata: JsonlFrameMetadataV1
}

// a folded summary is ordered transport evidence, not one raw frame; keeping
// it separate prevents its code-chain digest from masquerading as raw identity
export interface JsonlSuppressedRefusalOutcomeV1
{
  readonly ok: false
  readonly code: 'mcp.frame-refusal-overflow'
  readonly detail: string
  readonly offset: null
  readonly suppressed: JsonlSuppressedRefusalSummaryV1
}

export type JsonlBoundaryRefusalV1 =
  JsonlFrameRefusalV1 | JsonlSuppressedRefusalOutcomeV1

export interface JsonlFrameAcceptanceV1
{
  readonly ok: true
  readonly value: Record<string, unknown>
  readonly metadata: JsonlFrameMetadataV1
}

export type JsonlFrameOutcomeV1 =
  JsonlFrameAcceptanceV1 | JsonlBoundaryRefusalV1

export class JsonlBoundaryError extends McpBoundaryError
{
  constructor(
    code: JsonlBoundaryRefusalCodeV1,
    message: string,
    readonly refusal: JsonlBoundaryRefusalV1 | null = null
  )
  {
    super(code, message)
    this.name = 'JsonlBoundaryError'
  }
}

export interface StrictJsonAcceptanceV1
{
  readonly ok: true
  readonly value: unknown
}

export interface StrictJsonRefusalV1
{
  readonly ok: false
  readonly code: JsonlBoundaryRefusalCodeV1
  readonly offset: number
}

export type StrictJsonResultV1 = StrictJsonAcceptanceV1 | StrictJsonRefusalV1

// thrown only inside the scanner & always caught at its entry point, so a scan
// failure never escapes as an exception
class StrictScanFailure
{
  constructor(
    readonly code: JsonlBoundaryRefusalCodeV1,
    readonly offset: number
  )
  {}
}

const STRICT_UTF8_DECODER = new TextDecoder('utf-8', {
  fatal: true,
  ignoreBOM: true,
})
const NUMBER_PATTERN = /-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/uy
const HEX_PATTERN = /^[0-9a-fA-F]{4}$/u
const SIMPLE_ESCAPES: Readonly<Record<string, string>> = Object.freeze({
  '"': '"',
  '\\': '\\',
  '/': '/',
  b: '\b',
  f: '\f',
  n: '\n',
  r: '\r',
  t: '\t',
})

// a hand-written scanner rather than JSON.parse, because JSON.parse silently
// keeps the last of two duplicate keys, silently rounds unsafe integers, &
// always produces Object.prototype-bearing objects
class StrictJsonScannerV1
{
  readonly #text: string
  readonly #limits: JsonlBoundaryLimitsV1
  #index = 0
  #totalMembers = 0

  constructor(text: string, limits: JsonlBoundaryLimitsV1)
  {
    this.#text = text
    this.#limits = limits
  }

  scan(): unknown
  {
    this.#skipWhitespace()
    if (this.#index >= this.#text.length) this.#fail('mcp.frame-malformed')
    const value = this.#value(1)
    this.#skipWhitespace()
    if (this.#index !== this.#text.length) this.#fail('mcp.frame-malformed')
    return value
  }

  #fail(code: JsonlBoundaryRefusalCodeV1): never
  {
    throw new StrictScanFailure(code, this.#index)
  }

  #skipWhitespace(): void
  {
    while (this.#index < this.#text.length)
    {
      const code = this.#text.charCodeAt(this.#index)
      if (code !== 0x20 && code !== 0x09 && code !== 0x0a && code !== 0x0d)
        break
      this.#index += 1
    }
  }

  #countMember(): void
  {
    this.#totalMembers += 1
    if (this.#totalMembers > this.#limits.maximumTotalMembers)
      this.#fail('mcp.frame-members-exceeded')
  }

  #value(depth: number): unknown
  {
    if (depth > this.#limits.maximumDepth) this.#fail('mcp.frame-too-deep')
    if (this.#index >= this.#text.length) this.#fail('mcp.frame-malformed')
    const character = this.#text[this.#index]
    if (character === '{') return this.#object(depth)
    if (character === '[') return this.#array(depth)
    if (character === '"') return this.#string()
    if (character === 't') return this.#literal('true', true)
    if (character === 'f') return this.#literal('false', false)
    if (character === 'n') return this.#literal('null', null)
    return this.#number()
  }

  #literal<T>(word: string, value: T): T
  {
    if (!this.#text.startsWith(word, this.#index))
      this.#fail('mcp.frame-malformed')
    this.#index += word.length
    return value
  }

  // every accepted object is a fresh null-prototype record, so an attacker key
  // such as __proto__ lands as an ordinary own data property & can never reach
  // a prototype setter anywhere downstream
  #object(depth: number): Record<string, unknown>
  {
    this.#index += 1
    const value = Object.create(null) as Record<string, unknown>
    const keys = new Set<string>()
    this.#skipWhitespace()
    if (this.#text[this.#index] === '}')
    {
      this.#index += 1
      return value
    }
    for (;;)
    {
      this.#skipWhitespace()
      if (this.#text[this.#index] !== '"') this.#fail('mcp.frame-malformed')
      const keyOffset = this.#index
      const key = this.#string()
      if (keys.has(key))
      {
        this.#index = keyOffset
        this.#fail('mcp.frame-duplicate-key')
      }
      keys.add(key)
      if (keys.size > this.#limits.maximumContainerMembers)
        this.#fail('mcp.frame-members-exceeded')
      this.#countMember()
      this.#skipWhitespace()
      if (this.#text[this.#index] !== ':') this.#fail('mcp.frame-malformed')
      this.#index += 1
      this.#skipWhitespace()
      value[key] = this.#value(depth + 1)
      this.#skipWhitespace()
      const next = this.#text[this.#index]
      if (next === ',')
      {
        this.#index += 1
        continue
      }
      if (next === '}')
      {
        this.#index += 1
        return value
      }
      this.#fail('mcp.frame-malformed')
    }
  }

  #array(depth: number): unknown[]
  {
    this.#index += 1
    const value: unknown[] = []
    this.#skipWhitespace()
    if (this.#text[this.#index] === ']')
    {
      this.#index += 1
      return value
    }
    for (;;)
    {
      this.#skipWhitespace()
      if (value.length >= this.#limits.maximumContainerMembers)
        this.#fail('mcp.frame-members-exceeded')
      this.#countMember()
      value.push(this.#value(depth + 1))
      this.#skipWhitespace()
      const next = this.#text[this.#index]
      if (next === ',')
      {
        this.#index += 1
        continue
      }
      if (next === ']')
      {
        this.#index += 1
        return value
      }
      this.#fail('mcp.frame-malformed')
    }
  }

  // decoding escapes here is what makes duplicate detection exact: the returned
  // string is the frame's precise utf-16 code unit sequence, so a raw key & its
  // \u-escaped spelling compare equal
  #string(): string
  {
    const start = this.#index
    this.#index += 1
    let decoded = ''
    let chunkStart = this.#index
    for (;;)
    {
      if (this.#index >= this.#text.length) this.#fail('mcp.frame-malformed')
      const code = this.#text.charCodeAt(this.#index)
      if (code === 0x22)
      {
        decoded += this.#text.slice(chunkStart, this.#index)
        this.#index += 1
        this.#assertInertString(decoded, start)
        return decoded
      }
      if (code === 0x5c)
      {
        decoded += this.#text.slice(chunkStart, this.#index)
        this.#index += 1
        decoded += this.#escape()
        chunkStart = this.#index
        continue
      }
      if (code < 0x20) this.#fail('mcp.frame-malformed')
      this.#index += 1
    }
  }

  // the frozen contract's rejectNul & rejectUnpairedSurrogates rules applied at
  // the transport: a nul truncates downstream & a lone surrogate breaks the
  // exact code-unit comparison duplicate-key detection depends on
  #assertInertString(value: string, start: number): void
  {
    for (let index = 0; index < value.length; index += 1)
    {
      const unit = value.charCodeAt(index)
      if (unit === 0)
      {
        this.#index = start
        this.#fail('mcp.frame-nul-string')
      }
      if (unit < 0xd800 || unit > 0xdfff) continue
      const next = index + 1 < value.length ? value.charCodeAt(index + 1) : -1
      // a correctly paired astral character is admitted; only a high surrogate
      // followed by a low surrogate is a pair, so every other case is lone
      if (unit > 0xdbff || next < 0xdc00 || next > 0xdfff)
      {
        this.#index = start
        this.#fail('mcp.frame-unpaired-surrogate')
      }
      index += 1
    }
  }

  #escape(): string
  {
    if (this.#index >= this.#text.length) this.#fail('mcp.frame-malformed')
    const marker = this.#text[this.#index]!
    const simple = SIMPLE_ESCAPES[marker]
    if (simple !== undefined)
    {
      this.#index += 1
      return simple
    }
    if (marker !== 'u') this.#fail('mcp.frame-malformed')
    const hex = this.#text.slice(this.#index + 1, this.#index + 5)
    if (!HEX_PATTERN.test(hex)) this.#fail('mcp.frame-malformed')
    this.#index += 5
    return String.fromCharCode(Number.parseInt(hex, 16))
  }

  // every number is checked as a value, not as a literal shape, so an unsafe
  // integer, an overflowing exponent, & a negative zero all refuse wherever
  // they appear in the tree
  #number(): number
  {
    NUMBER_PATTERN.lastIndex = this.#index
    const match = NUMBER_PATTERN.exec(this.#text)
    if (match === null || match[0].length === 0)
      this.#fail('mcp.frame-malformed')
    this.#index += match[0].length
    const value = Number(match[0])
    if (!Number.isFinite(value)) this.#fail('mcp.frame-unsafe-number')
    if (Object.is(value, -0)) this.#fail('mcp.frame-unsafe-number')
    if (Number.isInteger(value) && !Number.isSafeInteger(value))
      this.#fail('mcp.frame-unsafe-number')
    return value
  }
}

export function parseStrictBoundaryJsonV1(
  text: string,
  limits: JsonlBoundaryLimitsV1 = DEFAULT_JSONL_BOUNDARY_LIMITS_V1
): StrictJsonResultV1
{
  const resolvedLimits = resolveJsonlBoundaryLimitsV1(limits)
  try
  {
    return {
      ok: true,
      value: new StrictJsonScannerV1(text, resolvedLimits).scan(),
    }
  }
  catch (error)
  {
    if (error instanceof StrictScanFailure)
      return { ok: false, code: error.code, offset: error.offset }
    throw error
  }
}

export function isCanonicalFrameObjectV1(
  value: unknown
): value is Record<string, unknown>
{
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

const NEWLINE = 0x0a
const CARRIAGE_RETURN = 0x0d
export const MAXIMUM_INFLIGHT_JSON_RPC_REQUESTS_V1 = 256
export const MAXIMUM_QUEUED_ACCEPTED_JSONL_FRAMES_V1 = 256

// the running fold a refusal-queue overflow accumulates into. It is the only
// state a flood of malformed frames may grow, & every field is fixed width
interface MutableSuppressedRefusalsV1
{
  readonly outcomeKind: 'suppressed-refusals'
  refusalCount: number
  firstCode: JsonlBoundaryRefusalCodeV1
  lastCode: JsonlBoundaryRefusalCodeV1
  firstFrameSequence: number
  lastFrameSequence: number
  rawByteLength: number
  chain: string
}

// the fold is chained rather than listed, so an auditor can still prove which
// refusals were suppressed without the buffer retaining any of them
function chainSuppressedRefusalV1(
  previous: string,
  code: JsonlBoundaryRefusalCodeV1,
  frameSequence: number
): string
{
  return createHash('sha256')
    .update(previous)
    .update(`${code}:${frameSequence}\n`)
    .digest('hex')
}

function suppressedRefusalOutcomeV1(
  suppressed: MutableSuppressedRefusalsV1
): JsonlSuppressedRefusalOutcomeV1
{
  return Object.freeze({
    ok: false as const,
    code: 'mcp.frame-refusal-overflow' as const,
    detail: REFUSAL_DETAILS['mcp.frame-refusal-overflow'],
    offset: null,
    suppressed: Object.freeze({
      refusalCount: suppressed.refusalCount,
      firstCode: suppressed.firstCode,
      lastCode: suppressed.lastCode,
      firstFrameSequence: suppressed.firstFrameSequence,
      lastFrameSequence: suppressed.lastFrameSequence,
      rawByteLength: suppressed.rawByteLength,
      codeChainSha256: suppressed.chain,
    }),
  })
}

// replaces the sdk's unbounded ReadBuffer: bytes are capped, hashed, & strictly
// decoded before any value exists, so an oversized or malformed frame is
// refused on framing evidence alone
export class BoundedJsonlReadBufferV1
{
  readonly #limits: JsonlBoundaryLimitsV1
  readonly #outcomes: Array<JsonlFrameOutcomeV1 | MutableSuppressedRefusalsV1> =
    []
  #parts: Uint8Array[] = []
  #retained = 0
  #rawByteLength = 0
  #hash = createHash('sha256')
  #discarding = false
  #sequence = 0
  #queuedAcceptances = 0
  #queuedRefusals = 0
  #suppressed: MutableSuppressedRefusalsV1 | null = null
  #admissionClosed = false

  constructor(
    limits: JsonlBoundaryLimitsV1 = DEFAULT_JSONL_BOUNDARY_LIMITS_V1
  )
  {
    this.#limits = resolveJsonlBoundaryLimitsV1(limits)
  }

  append(chunk: Uint8Array): void
  {
    if (this.#admissionClosed) return
    let offset = 0
    while (offset < chunk.length)
    {
      const newline = chunk.indexOf(NEWLINE, offset)
      if (newline === -1)
      {
        this.#absorb(chunk.subarray(offset))
        return
      }
      this.#absorb(chunk.subarray(offset, newline))
      this.#complete()
      if (this.#admissionClosed) return
      offset = newline + 1
    }
  }

  // draining a refusal reopens a slot, so a folded overflow is emitted as soon
  // as the reader has caught up rather than being held until the stream ends
  read(): JsonlFrameOutcomeV1 | null
  {
    const outcome = this.#outcomes.shift()
    if (outcome !== undefined)
    {
      if ('outcomeKind' in outcome)
      {
        if (this.#suppressed === outcome) this.#suppressed = null
        return suppressedRefusalOutcomeV1(outcome)
      }
      if (outcome.ok) this.#queuedAcceptances -= 1
      else this.#queuedRefusals -= 1
      return outcome
    }
    return null
  }

  clear(): void
  {
    this.#outcomes.length = 0
    this.#queuedAcceptances = 0
    this.#queuedRefusals = 0
    this.#suppressed = null
    this.#admissionClosed = false
    this.#reset()
  }

  get queuedRefusalCount(): number
  {
    return this.#queuedRefusals
  }

  get suppressedRefusalCount(): number
  {
    return this.#suppressed?.refusalCount ?? 0
  }

  // retained memory stops at the cap, while length/hash keep covering every
  // later byte until delimiter or EOF finalizes the one exact frame identity
  #absorb(slice: Uint8Array): void
  {
    if (slice.length === 0) return
    this.#rawByteLength += slice.length
    this.#hash.update(slice)
    if (this.#discarding) return
    if (this.#rawByteLength > this.#limits.maximumInboundFrameBytes)
    {
      this.#discarding = true
      this.#parts = []
      this.#retained = 0
      return
    }
    const retained = new Uint8Array(slice.length)
    retained.set(slice)
    this.#parts.push(retained)
    this.#retained += slice.length
  }

  #complete(): void
  {
    if (this.#discarding)
    {
      this.#refuse('mcp.frame-too-large', null, true)
      this.#reset()
      return
    }
    const parts = this.#parts
    this.#parts = []
    let bytes = parts.length === 1 ? parts[0]! : Buffer.concat(parts)
    if (bytes.length > 0 && bytes[bytes.length - 1] === CARRIAGE_RETURN)
      bytes = bytes.subarray(0, bytes.length - 1)
    if (bytes.length === 0)
    {
      this.#refuse('mcp.frame-empty', null, false)
      this.#reset()
      return
    }
    let text: string
    try
    {
      text = STRICT_UTF8_DECODER.decode(bytes)
    }
    catch
    {
      this.#refuse('mcp.frame-invalid-utf8', null, false)
      this.#reset()
      return
    }
    const parsed = parseStrictBoundaryJsonV1(text, this.#limits)
    if (!parsed.ok)
    {
      this.#refuse(parsed.code, parsed.offset, false)
      this.#reset()
      return
    }
    if (!isCanonicalFrameObjectV1(parsed.value))
    {
      this.#refuse('mcp.frame-not-object', null, false)
      this.#reset()
      return
    }
    if (this.#queuedAcceptances >= MAXIMUM_QUEUED_ACCEPTED_JSONL_FRAMES_V1)
    {
      this.#refuse('mcp.frame-admission-queue-exceeded', null, false)
      this.#admissionClosed = true
      this.#reset()
      return
    }
    this.#closeSuppressedRun()
    this.#queuedAcceptances += 1
    this.#outcomes.push(
      Object.freeze({
        ok: true as const,
        value: parsed.value,
        metadata: this.#metadata(false),
      })
    )
    this.#reset()
  }

  #metadata(truncated: boolean): JsonlFrameMetadataV1
  {
    this.#sequence += 1
    // raw identity covers every frame byte before LF; a CR in CRLF is included
    return Object.freeze({
      frameSequence: this.#sequence,
      rawByteLength: this.#rawByteLength,
      retainedByteLength: this.#retained,
      truncated,
      rawSha256: this.#hash.copy().digest('hex'),
    })
  }

  // * the refusal queue is capped. Past the cap a refusal is folded into fixed
  // * metadata instead of being enqueued, so a peer flooding malformed frames
  // * cannot grow memory, & the fold is still reported rather than dropped
  #refuse(
    code: JsonlBoundaryRefusalCodeV1,
    offset: number | null,
    truncated: boolean
  ): void
  {
    const metadata = this.#metadata(truncated)
    if (this.#queuedRefusals >= this.#limits.maximumQueuedRefusals)
    {
      this.#suppress(code, metadata)
      return
    }
    this.#closeSuppressedRun()
    this.#queuedRefusals += 1
    this.#outcomes.push(
      Object.freeze({
        ok: false as const,
        code,
        detail: REFUSAL_DETAILS[code],
        offset,
        metadata,
      })
    )
  }

  #suppress(
    code: JsonlBoundaryRefusalCodeV1,
    metadata: JsonlFrameMetadataV1
  ): void
  {
    const current = this.#suppressed
    if (current === null)
    {
      this.#suppressed = {
        outcomeKind: 'suppressed-refusals',
        refusalCount: 1,
        firstCode: code,
        lastCode: code,
        firstFrameSequence: metadata.frameSequence,
        lastFrameSequence: metadata.frameSequence,
        rawByteLength: metadata.rawByteLength,
        chain: chainSuppressedRefusalV1(
          '0'.repeat(64),
          code,
          metadata.frameSequence
        ),
      }
      this.#outcomes.push(this.#suppressed)
      return
    }
    current.refusalCount += 1
    current.lastCode = code
    current.lastFrameSequence = metadata.frameSequence
    current.rawByteLength += metadata.rawByteLength
    current.chain = chainSuppressedRefusalV1(
      current.chain,
      code,
      metadata.frameSequence
    )
  }

  #closeSuppressedRun(): void
  {
    this.#suppressed = null
  }

  // stream end supplies the boundary for an otherwise unterminated frame
  finish(): void
  {
    if (this.#rawByteLength === 0) return
    this.#refuse(
      this.#discarding ? 'mcp.frame-too-large' : 'mcp.frame-malformed',
      null,
      this.#discarding
    )
    this.#reset()
  }

  #reset(): void
  {
    this.#parts = []
    this.#retained = 0
    this.#rawByteLength = 0
    this.#hash = createHash('sha256')
    this.#discarding = false
  }
}

// measured on the encoded frame, so an oversized base64 resource payload is
// caught here rather than at whatever reads the pipe
export function serializeBoundedOutboundFrameV1(
  message: unknown,
  limits: JsonlBoundaryLimitsV1 = DEFAULT_JSONL_BOUNDARY_LIMITS_V1
): Buffer
{
  const resolvedLimits = resolveJsonlBoundaryLimitsV1(limits)
  const frame = Buffer.from(`${JSON.stringify(message)}\n`, 'utf-8')
  if (frame.byteLength > resolvedLimits.maximumOutboundFrameBytes)
    throw new JsonlBoundaryError(
      'mcp.outbound-frame-too-large',
      `outbound frame of ${frame.byteLength} bytes exceeds its ${limits.maximumOutboundFrameBytes} byte limit`
    )
  return frame
}

export interface BoundedStdioServerTransportOptionsV1
{
  readonly stdin?: Readable
  readonly stdout?: Writable
  readonly limits?: JsonlBoundaryLimitsV1
  readonly onRefusal?: (refusal: JsonlBoundaryRefusalV1) => void
  readonly onTerminal?: (terminal: JsonlTransportTerminalV1) => void
  readonly onAcceptedMessage?: (message: JSONRPCMessage) => void
}

export type JsonlTransportTerminalReasonV1 =
  | 'stdin-end'
  | 'stdin-close'
  | 'stdin-error'
  | 'stdout-error'
  | 'response-write-failed'
  | 'boundary-refusal-failed'
  | 'request-admission-failed'
  | 'outbound-admission-failed'
  | 'explicit-close'

export interface JsonlTransportTerminalV1
{
  readonly reason: JsonlTransportTerminalReasonV1
  readonly errorCode: string | null
}

interface PendingJsonRpcResponseV1
{
  readonly requestId: RequestId
  frame: Buffer | null
  releaseOutbound: (() => void) | null
  readonly promise: Promise<void>
  readonly resolve: () => void
  readonly reject: (error: Error) => void
}

function inboundRequestIdV1(message: JSONRPCMessage): RequestId | null
{
  if (!('method' in message) || !Object.hasOwn(message, 'id')) return null
  const requestId = (message as { readonly id?: unknown }).id
  return typeof requestId === 'string' || typeof requestId === 'number'
    ? requestId
    : null
}

function outboundResponseIdV1(message: JSONRPCMessage): RequestId | null
{
  if ('method' in message || !Object.hasOwn(message, 'id')) return null
  if (!('result' in message) && !('error' in message)) return null
  return typeof message.id === 'string' || typeof message.id === 'number'
    ? message.id
    : null
}

export class BoundedStdioServerTransportV1 implements Transport
{
  onclose?: () => void
  onerror?: (error: Error) => void
  onmessage?: (message: JSONRPCMessage) => void

  readonly #stdin: Readable
  readonly #stdout: Writable
  readonly #limits: JsonlBoundaryLimitsV1
  readonly #buffer: BoundedJsonlReadBufferV1
  readonly #onRefusal: ((refusal: JsonlBoundaryRefusalV1) => void) | null
  readonly #onTerminal: ((terminal: JsonlTransportTerminalV1) => void) | null
  readonly #onAcceptedMessage: ((message: JSONRPCMessage) => void) | null
  readonly #pendingResponses: PendingJsonRpcResponseV1[] = []
  readonly #liveRequestIds = new Set<RequestId>()
  readonly #activeWriteRejectors = new Set<(error: Error) => void>()
  #started = false
  #terminal = false
  #inputEnded = false
  #pendingWrites = 0
  #queuedOutboundFrames = 0
  #queuedOutboundBytes = 0
  #responseFlush: Promise<void> | null = null
  #writeTail = Promise.resolve()

  readonly #ondata = (chunk: Buffer): void =>
  {
    if (this.#terminal) return
    this.#buffer.append(chunk)
    this.#drain()
  }

  readonly #onstreamerror = (error: Error): void =>
  {
    this.#notifyError(error)
    this.#terminate('stdin-error', error)
  }

  readonly #onstdinend = (): void =>
  {
    this.#buffer.finish()
    this.#drain()
    if (this.#terminal) return
    this.#inputEnded = true
    this.#finishGracefulEnd()
  }

  readonly #onstdinclose = (): void =>
  {
    if (this.#inputEnded)
    {
      this.#finishGracefulEnd()
      return
    }
    this.#terminate('stdin-close')
  }

  readonly #onstdouterror = (error: Error): void =>
  {
    this.#notifyError(error)
    this.#terminate('stdout-error', error)
  }

  constructor(options: BoundedStdioServerTransportOptionsV1 = {})
  {
    this.#stdin = options.stdin ?? process.stdin
    this.#stdout = options.stdout ?? process.stdout
    this.#limits = resolveJsonlBoundaryLimitsV1(options.limits)
    this.#buffer = new BoundedJsonlReadBufferV1(this.#limits)
    this.#onRefusal = options.onRefusal ?? null
    this.#onTerminal = options.onTerminal ?? null
    this.#onAcceptedMessage = options.onAcceptedMessage ?? null
  }

  get limits(): JsonlBoundaryLimitsV1
  {
    return this.#limits
  }

  async start(): Promise<void>
  {
    if (this.#terminal)
      throw new McpBoundaryError(
        'mcp.transport-closed',
        'bounded stdio transport is closed'
      )
    if (this.#started)
      throw new McpBoundaryError(
        'mcp.transport-already-started',
        'bounded stdio transport is already started'
      )
    this.#started = true
    this.#stdin.on('data', this.#ondata)
    this.#stdin.on('error', this.#onstreamerror)
    this.#stdin.on('end', this.#onstdinend)
    this.#stdin.on('close', this.#onstdinclose)
    this.#stdout.on('error', this.#onstdouterror)
  }

  async send(message: JSONRPCMessage): Promise<void>
  {
    if (this.#terminal)
      throw new McpBoundaryError(
        'mcp.transport-closed',
        'bounded stdio transport is closed'
      )
    let frame: Buffer
    try
    {
      frame = serializeBoundedOutboundFrameV1(message, this.#limits)
    }
    catch (error)
    {
      const failure = error instanceof Error ? error : new Error(String(error))
      this.#notifyError(failure)
      this.#terminate('response-write-failed', failure)
      throw failure
    }
    const releaseOutbound = this.#reserveOutbound(frame)
    const responseId = outboundResponseIdV1(message)
    if (responseId !== null)
    {
      const pending = this.#pendingResponses.find(
        (candidate) =>
          candidate.requestId === responseId && candidate.frame === null
      )
      if (pending !== undefined)
      {
        pending.frame = frame
        pending.releaseOutbound = releaseOutbound
        this.#flushResponses()
        return pending.promise
      }
    }
    return this.#write(frame, releaseOutbound)
  }

  #reserveOutbound(frame: Buffer): () => void
  {
    if (
      this.#queuedOutboundFrames + 1 >
        this.#limits.maximumQueuedOutboundFrames ||
      this.#queuedOutboundBytes + frame.byteLength >
        this.#limits.maximumQueuedOutboundBytes
    )
    {
      const failure = new McpBoundaryError(
        'mcp.outbound-queue-exceeded',
        'bounded stdio outbound queue capacity is exhausted'
      )
      this.#notifyError(failure)
      this.#terminate('outbound-admission-failed', failure)
      throw failure
    }
    this.#queuedOutboundFrames += 1
    this.#queuedOutboundBytes += frame.byteLength
    let released = false
    return () =>
    {
      if (released) return
      released = true
      this.#queuedOutboundFrames -= 1
      this.#queuedOutboundBytes -= frame.byteLength
    }
  }

  async #write(frame: Buffer, releaseOutbound: () => void): Promise<void>
  {
    const write = async (): Promise<void> =>
    {
      try
      {
        if (this.#terminal)
          throw new McpBoundaryError(
            'mcp.transport-closed',
            'bounded stdio transport is closed'
          )
        await new Promise<void>((resolve, reject) =>
        {
          let settled = false
          const settle = (
            outcome: 'resolve' | 'reject',
            error?: Error
          ): void =>
          {
            if (settled) return
            settled = true
            this.#stdout.off('error', onError)
            this.#stdout.off('drain', onDrain)
            this.#activeWriteRejectors.delete(onTerminal)
            if (outcome === 'resolve') resolve()
            else reject(error)
          }
          const onError = (error: Error): void =>
          {
            settle('reject', error)
          }
          const onDrain = (): void =>
          {
            settle('resolve')
          }
          const onTerminal = (error: Error): void => settle('reject', error)
          this.#activeWriteRejectors.add(onTerminal)
          this.#stdout.once('error', onError)
          try
          {
            if (this.#stdout.write(frame)) settle('resolve')
            else this.#stdout.once('drain', onDrain)
          }
          catch (error)
          {
            settle(
              'reject',
              error instanceof Error ? error : new Error(String(error))
            )
          }
        })
      }
      catch (error)
      {
        const failure =
          error instanceof Error ? error : new Error(String(error))
        if (!this.#terminal)
        {
          this.#notifyError(failure)
          this.#terminate('response-write-failed', failure)
        }
        throw failure
      }
    }
    this.#pendingWrites += 1
    const scheduled = this.#writeTail.then(write)
    const tracked = scheduled.finally(() =>
    {
      this.#pendingWrites -= 1
      releaseOutbound()
      this.#finishGracefulEnd()
    })
    this.#writeTail = tracked.catch(() => undefined)
    return tracked
  }

  async close(): Promise<void>
  {
    this.#terminate('explicit-close')
  }

  // a refused frame is reported & skipped rather than closing the stream: the
  // reader has already resynchronized at the next newline, so a hostile frame
  // cannot deny service to the frames after it
  #drain(): void
  {
    for (;;)
    {
      const outcome = this.#buffer.read()
      if (outcome === null) return
      if (!outcome.ok)
      {
        try
        {
          this.#onRefusal?.(outcome)
        }
        catch (error)
        {
          const failure =
            error instanceof Error ? error : new Error(String(error))
          this.#notifyError(failure)
          this.#terminate('boundary-refusal-failed', failure)
          return
        }
        const failure = new JsonlBoundaryError(
          outcome.code,
          outcome.detail,
          outcome
        )
        this.#notifyError(failure)
        if (
          outcome.code === 'mcp.frame-admission-queue-exceeded' ||
          outcome.code === 'mcp.frame-inflight-exceeded'
        )
        {
          this.#terminate('request-admission-failed', failure)
          return
        }
        continue
      }
      let message: JSONRPCMessage
      try
      {
        message = JSONRPCMessageSchema.parse(outcome.value)
      }
      catch
      {
        const refusal: JsonlFrameRefusalV1 = Object.freeze({
          ok: false,
          code: 'mcp.frame-invalid-json-rpc',
          detail: REFUSAL_DETAILS['mcp.frame-invalid-json-rpc'],
          offset: null,
          metadata: outcome.metadata,
        })
        try
        {
          this.#onRefusal?.(refusal)
        }
        catch (error)
        {
          const failure =
            error instanceof Error ? error : new Error(String(error))
          this.#notifyError(failure)
          this.#terminate('boundary-refusal-failed', failure)
          return
        }
        this.#notifyError(
          new JsonlBoundaryError(refusal.code, refusal.detail, refusal)
        )
        continue
      }
      const requestId = inboundRequestIdV1(message)
      if (requestId !== null)
      {
        if (
          this.#liveRequestIds.size >= MAXIMUM_INFLIGHT_JSON_RPC_REQUESTS_V1
        )
        {
          this.#refuseAcceptedFrame(
            'mcp.frame-inflight-exceeded',
            outcome.metadata
          )
          return
        }
        if (this.#liveRequestIds.has(requestId))
        {
          this.#refuseAcceptedFrame(
            'mcp.frame-request-id-conflict',
            outcome.metadata
          )
          return
        }
        let resolve!: () => void
        let reject!: (error: Error) => void
        const promise = new Promise<void>((onResolve, onReject) =>
        {
          resolve = onResolve
          reject = onReject
        })
        void promise.catch(() => undefined)
        this.#liveRequestIds.add(requestId)
        this.#pendingResponses.push({
          requestId,
          frame: null,
          releaseOutbound: null,
          promise,
          resolve,
          reject,
        })
      }
      try
      {
        this.#onAcceptedMessage?.(message)
        this.onmessage?.(message)
      }
      catch (error)
      {
        const failure =
          error instanceof Error ? error : new Error(String(error))
        this.#notifyError(failure)
        this.#terminate('request-admission-failed', failure)
        return
      }
    }
  }

  #flushResponses(): void
  {
    if (this.#responseFlush !== null) return
    this.#responseFlush = (async () =>
    {
      while (
        this.#pendingResponses.length > 0 &&
        this.#pendingResponses[0]!.frame !== null
      )
      {
        const pending = this.#pendingResponses.shift()
        if (
          pending === undefined ||
          pending.frame === null ||
          pending.releaseOutbound === null
        )
          return
        try
        {
          await this.#write(pending.frame, pending.releaseOutbound)
          pending.releaseOutbound = null
          this.#liveRequestIds.delete(pending.requestId)
          pending.resolve()
        }
        catch (error)
        {
          this.#liveRequestIds.delete(pending.requestId)
          pending.reject(
            error instanceof Error ? error : new Error(String(error))
          )
          return
        }
      }
    })().finally(() =>
    {
      this.#responseFlush = null
      if (
        this.#pendingResponses.length > 0 &&
        this.#pendingResponses[0]!.frame !== null
      )
        this.#flushResponses()
      else this.#finishGracefulEnd()
    })
  }

  // normal EOF closes admission but lets every admitted request publish its
  // ordered response before terminal audit evidence is installed
  #finishGracefulEnd(): void
  {
    if (
      !this.#inputEnded ||
      this.#terminal ||
      this.#pendingResponses.length > 0 ||
      this.#pendingWrites > 0 ||
      this.#responseFlush !== null
    )
      return
    this.#terminate('stdin-end')
  }

  #rejectPendingResponses(error: Error): void
  {
    for (const pending of this.#pendingResponses.splice(0))
    {
      pending.releaseOutbound?.()
      pending.releaseOutbound = null
      pending.reject(error)
    }
    this.#liveRequestIds.clear()
  }

  #refuseAcceptedFrame(
    code: 'mcp.frame-inflight-exceeded' | 'mcp.frame-request-id-conflict',
    metadata: JsonlFrameMetadataV1
  ): void
  {
    const refusal: JsonlFrameRefusalV1 = Object.freeze({
      ok: false,
      code,
      detail: REFUSAL_DETAILS[code],
      offset: null,
      metadata,
    })
    try
    {
      this.#onRefusal?.(refusal)
    }
    catch (error)
    {
      const failure = error instanceof Error ? error : new Error(String(error))
      this.#notifyError(failure)
      this.#terminate('boundary-refusal-failed', failure)
      return
    }
    const failure = new JsonlBoundaryError(code, refusal.detail, refusal)
    this.#notifyError(failure)
    this.#terminate('request-admission-failed', failure)
  }

  #notifyError(error: Error): void
  {
    try
    {
      this.onerror?.(error)
    }
    catch
    {
      // observers cannot bypass transport cleanup or terminal audit evidence
    }
  }

  #terminate(reason: JsonlTransportTerminalReasonV1, error?: Error): void
  {
    if (this.#terminal) return
    this.#terminal = true
    this.#stdin.off('data', this.#ondata)
    this.#stdin.off('error', this.#onstreamerror)
    this.#stdin.off('end', this.#onstdinend)
    this.#stdin.off('close', this.#onstdinclose)
    this.#stdout.off('error', this.#onstdouterror)
    if (this.#stdin.listenerCount('data') === 0) this.#stdin.pause()
    this.#buffer.clear()
    const closeError =
      error ??
      new McpBoundaryError(
        'mcp.transport-closed',
        'bounded stdio transport is closed'
      )
    for (const reject of [...this.#activeWriteRejectors]) reject(closeError)
    this.#activeWriteRejectors.clear()
    this.#rejectPendingResponses(closeError)
    const terminal = Object.freeze({
      reason,
      errorCode:
        error instanceof McpBoundaryError
          ? error.code
          : error === undefined
            ? null
            : error.name,
    })
    let terminalFailure: Error | null = null
    try
    {
      this.#onTerminal?.(terminal)
    }
    catch (terminalError)
    {
      terminalFailure =
        terminalError instanceof Error
          ? terminalError
          : new Error(String(terminalError))
      this.#notifyError(terminalFailure)
    }
    this.onclose?.()
    // terminal audit/evidence is part of a successful close. Propagating its
    // failure makes explicit close reject & makes stream-driven shutdown fail
    // the process instead of looking authoritative w/o a durable terminal.
    if (terminalFailure !== null) throw terminalFailure
  }
}
