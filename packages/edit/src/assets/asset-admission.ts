// packages/edit/src/assets/asset-admission.ts
// immutable session asset records, opaque token minting, digest binding, & materialization charging

import {
  deriveAuthoringMediaIdentity,
  MediaClassificationError,
  resolveEditAdmissionLimits,
  type DerivedMediaAssetIdentity,
  type EditAdmissionLimits,
} from '@scratch-agent/sb3'
import {
  resolvePhase8ResourcePolicy,
  type RefusalCode,
} from '@scratch-agent/ir/edit'

import { sha256Hex } from '@scratch-agent/sb3/crypto-node'

import { editCanonicalSha256V1, editOpaqueIdV1 } from '../support/canonical.js'
import type { EditAssetInputReadV1 } from '../transaction/ports.js'

const SHA256_PATTERN = /^[0-9a-f]{64}$/u

type EditAssetOriginV1 = 'inputFile' | 'sourceMedia'

export interface SessionAssetRecordV1
{
  readonly assetToken: string
  readonly mediaKind: 'costume' | 'sound'
  readonly origin: EditAssetOriginV1
  readonly payloadSha256: string
  readonly metadataSha256: string
  readonly byteLength: number
  readonly admittedSequence: number
  readonly identity: DerivedMediaAssetIdentity
}

// public admission evidence is a path-free identity derived from the retained
// record & its committed semantic event
export function editAssetAdmissionEvidenceIdV1(input: {
  readonly sessionId: string
  readonly eventSha256: string
  readonly record: Pick<
    SessionAssetRecordV1,
    | 'assetToken'
    | 'mediaKind'
    | 'payloadSha256'
    | 'metadataSha256'
    | 'byteLength'
  >
}): string
{
  return editOpaqueIdV1(
    'asset-evidence',
    new TextEncoder().encode(input.eventSha256),
    {
      schemaVersion: 1,
      sessionId: input.sessionId,
      eventSha256: input.eventSha256,
      assetToken: input.record.assetToken,
      mediaKind: input.record.mediaKind,
      payloadSha256: input.record.payloadSha256,
      metadataSha256: input.record.metadataSha256,
      byteLength: input.record.byteLength,
    }
  )
}

// what a media dispatcher needs to realize an add or replace: the proven
// digests plus the retained bytes the archive entry will carry
export interface AdmittedEditAssetV1
{
  readonly assetToken: string
  readonly mediaKind: 'costume' | 'sound'
  readonly payloadSha256: string
  readonly metadataSha256: string
  readonly bytes: Uint8Array
  readonly identity: DerivedMediaAssetIdentity
}

export type AdmittedEditAssetResolverV1 = (
  assetToken: string
) => AdmittedEditAssetV1 | null

// one durably retained asset record; replay reads these back beside the payload
// artifacts to rebuild a resolver w/o session state, re-admission, or a second
// parse of the bytes
export interface RetainedEditAssetRecordV1
{
  readonly schemaVersion: 1
  readonly record: SessionAssetRecordV1
}

export function retainedEditAssetRecordV1(
  record: SessionAssetRecordV1
): RetainedEditAssetRecordV1
{
  return Object.freeze({ schemaVersion: 1 as const, record })
}

// the bytes are re-proven against the record digest on every rehydration, so a
// tampered payload artifact can never reach a dispatcher
export function admittedEditAssetV1(
  record: SessionAssetRecordV1,
  bytes: Uint8Array
): AdmittedEditAssetV1
{
  if (sha256Hex(bytes) !== record.payloadSha256)
    fail(
      'edit.asset_digest_mismatch',
      'retained asset payload digest differs from its admitted record'
    )
  return Object.freeze({
    assetToken: record.assetToken,
    mediaKind: record.mediaKind,
    payloadSha256: record.payloadSha256,
    metadataSha256: record.metadataSha256,
    bytes: Uint8Array.from(bytes),
    identity: record.identity,
  })
}

export interface AssetMaterializationLedgerV1
{
  readonly admittedEditAssets: number
  readonly admittedEditAssetBytes: number
  readonly authoredCostumeTextureMaterializations: number
  readonly authoredCostumeReferencePixels: number
  readonly authoredDecodedRgbaEstimateBytes: number
}

// each list entry is one committed add/replace occurrence; keeping duplicates
// is what prevents token reuse from becoming a materialization-budget bypass
export interface AssetMaterializationUsageDeltaV1
{
  readonly schemaVersion: 1
  readonly authoredCostumeAssetTokens: readonly string[]
  readonly authoredCostumeTextureMaterializations: number
  readonly authoredCostumeReferencePixels: number
  readonly authoredDecodedRgbaEstimateBytes: number
}

export const EMPTY_ASSET_MATERIALIZATION_USAGE_DELTA_V1: AssetMaterializationUsageDeltaV1 =
  Object.freeze({
    schemaVersion: 1 as const,
    authoredCostumeAssetTokens: Object.freeze([]),
    authoredCostumeTextureMaterializations: 0,
    authoredCostumeReferencePixels: 0,
    authoredDecodedRgbaEstimateBytes: 0,
  })

function checkedUsageTotal(left: number, right: number, label: string): number
{
  const total = left + right
  if (!Number.isSafeInteger(total) || total < 0)
    fail('edit.internal_invariant', `${label} usage is outside safe range`)
  return total
}

export function assetMaterializationUsageDeltaV1(
  assets: readonly AdmittedEditAssetV1[]
): AssetMaterializationUsageDeltaV1
{
  const costumes = assets.flatMap((asset) =>
  {
    if (asset.mediaKind !== asset.identity.mediaKind)
      fail(
        'edit.internal_invariant',
        'admitted asset kind differs from its parsed identity'
      )
    return asset.mediaKind === 'costume' &&
      asset.identity.mediaKind === 'costume'
      ? [
          {
            assetToken: asset.assetToken,
            canvasPixels: asset.identity.canvasPixels,
          },
        ]
      : []
  })
  return Object.freeze({
    schemaVersion: 1 as const,
    authoredCostumeAssetTokens: Object.freeze(
      costumes.map((asset) => asset.assetToken)
    ),
    authoredCostumeTextureMaterializations: costumes.length,
    authoredCostumeReferencePixels: costumes.reduce(
      (total, asset) =>
        checkedUsageTotal(
          total,
          asset.canvasPixels,
          'authored costume reference pixels'
        ),
      0
    ),
    authoredDecodedRgbaEstimateBytes: costumes.reduce(
      (total, asset) =>
        checkedUsageTotal(
          total,
          asset.canvasPixels * 4,
          'authored decoded RGBA estimate bytes'
        ),
      0
    ),
  })
}

export function combineAssetMaterializationUsageDeltasV1(
  deltas: readonly AssetMaterializationUsageDeltaV1[]
): AssetMaterializationUsageDeltaV1
{
  return Object.freeze({
    schemaVersion: 1 as const,
    authoredCostumeAssetTokens: Object.freeze(
      deltas.flatMap((delta) => delta.authoredCostumeAssetTokens)
    ),
    authoredCostumeTextureMaterializations: deltas.reduce(
      (total, delta) =>
        checkedUsageTotal(
          total,
          delta.authoredCostumeTextureMaterializations,
          'authored costume texture materializations'
        ),
      0
    ),
    authoredCostumeReferencePixels: deltas.reduce(
      (total, delta) =>
        checkedUsageTotal(
          total,
          delta.authoredCostumeReferencePixels,
          'authored costume reference pixels'
        ),
      0
    ),
    authoredDecodedRgbaEstimateBytes: deltas.reduce(
      (total, delta) =>
        checkedUsageTotal(
          total,
          delta.authoredDecodedRgbaEstimateBytes,
          'authored decoded RGBA estimate bytes'
        ),
      0
    ),
  })
}

// `expectedMetadataSha256` is optional because no caller can compute it without
// this package's canonical hash over the parsed identity; the frozen
// `edit_asset_admit` transport sends only the payload digest
interface AdmitAssetInputFileRequestV1
{
  readonly read: EditAssetInputReadV1
  readonly mediaKind: 'costume' | 'sound'
  readonly expectedByteLength: number
  readonly expectedPayloadSha256: string
  readonly expectedMetadataSha256?: string
}

interface AdmitSourceMediaRequestV1
{
  readonly bytes: Uint8Array
  readonly mediaKind: 'costume' | 'sound'
  readonly expectedPayloadSha256: string
  readonly expectedMetadataSha256?: string
}

interface SessionAssetStoreOptionsV1
{
  readonly sessionSalt: Uint8Array
  readonly limits?: EditAdmissionLimits
  readonly policyOverrides?: unknown
}

export interface PreparedSessionAssetAdmissionV1
{
  readonly record: SessionAssetRecordV1
  readonly bytes: Uint8Array
  readonly prospectiveLedger: AssetMaterializationLedgerV1
  readonly priorSequence: number
}

export class EditAssetAdmissionErrorV1 extends Error
{
  constructor(
    readonly code: RefusalCode,
    message: string
  )
  {
    super(message)
    this.name = 'EditAssetAdmissionErrorV1'
  }
}

function fail(code: RefusalCode, message: string): never
{
  throw new EditAssetAdmissionErrorV1(code, message)
}

function requireDigest(value: unknown, label: string): string
{
  if (typeof value !== 'string' || !SHA256_PATTERN.test(value))
    fail('edit.invalid_payload', `${label} must be a lowercase SHA-256`)
  return value
}

// every counter this store charges is a resource-policy key; the store
// owns the running totals so a refusal happens before a record is minted
interface MutableLedger
{
  admittedEditAssets: number
  admittedEditAssetBytes: number
  authoredCostumeTextureMaterializations: number
  authoredCostumeReferencePixels: number
  authoredDecodedRgbaEstimateBytes: number
}

// append-only session asset records; a repeated payload still mints its own
// record, while only the cumulative admission byte counter deduplicates by digest
export class SessionAssetStoreV1
{
  readonly #salt: Uint8Array
  readonly #limits: EditAdmissionLimits
  readonly #policy: Readonly<Record<string, number>>
  readonly #records = new Map<string, SessionAssetRecordV1>()
  // retained once per distinct digest; `admittedEditAssetBytes` is charged on
  // the same distinct-payload basis, so retention & the budget stay in step
  readonly #payloads = new Map<string, Uint8Array>()
  readonly #preparedAdmissions = new WeakSet<PreparedSessionAssetAdmissionV1>()
  readonly #ledger: MutableLedger = {
    admittedEditAssets: 0,
    admittedEditAssetBytes: 0,
    authoredCostumeTextureMaterializations: 0,
    authoredCostumeReferencePixels: 0,
    authoredDecodedRgbaEstimateBytes: 0,
  }

  #sequence = 0

  constructor(options: SessionAssetStoreOptionsV1)
  {
    if (
      !(options.sessionSalt instanceof Uint8Array) ||
      options.sessionSalt.byteLength < 16
    )
    {
      throw new TypeError('session asset salt must be at least 16 bytes')
    }
    this.#salt = Uint8Array.from(options.sessionSalt)
    this.#limits = options.limits ?? resolveEditAdmissionLimits()
    this.#policy = resolvePhase8ResourcePolicy(options.policyOverrides ?? {})
  }

  ledger(): AssetMaterializationLedgerV1
  {
    return Object.freeze({ ...this.#ledger })
  }

  records(): readonly SessionAssetRecordV1[]
  {
    return Object.freeze([...this.#records.values()])
  }

  record(assetToken: string): SessionAssetRecordV1
  {
    const record = this.#records.get(assetToken)
    if (record === undefined)
      fail('edit.stale_handle', 'asset token names no admitted session record')
    return record
  }

  // the retained payload is handed out as a fresh copy so no consumer can edit
  // the bytes the digest was proven over
  admitted(assetToken: string): AdmittedEditAssetV1
  {
    const record = this.record(assetToken)
    const bytes = this.#payloads.get(record.payloadSha256)
    if (bytes === undefined)
      fail('edit.internal_invariant', 'admitted asset payload was not retained')
    return admittedEditAssetV1(record, bytes)
  }

  payload(payloadSha256: string): Uint8Array
  {
    const bytes = this.#payloads.get(payloadSha256)
    if (bytes === undefined)
      fail('edit.internal_invariant', 'admitted asset payload was not retained')
    return Uint8Array.from(bytes)
  }

  resolver(): AdmittedEditAssetResolverV1
  {
    return (assetToken) =>
      this.#records.has(assetToken) ? this.admitted(assetToken) : null
  }

  // external add/replace input: the host already bounded & digested the read,
  // so the payload digest is proven against the host read before parsing
  async admitInputFile(
    request: AdmitAssetInputFileRequestV1
  ): Promise<SessionAssetRecordV1>
  {
    return this.commitPreparedAdmission(await this.prepareInputFile(request))
  }

  async prepareInputFile(
    request: AdmitAssetInputFileRequestV1
  ): Promise<PreparedSessionAssetAdmissionV1>
  {
    const expectedPayloadSha256 = requireDigest(
      request.expectedPayloadSha256,
      'expectedPayloadSha256'
    )
    if (
      !Number.isSafeInteger(request.expectedByteLength) ||
      request.expectedByteLength !== request.read.byteLength
    )
    {
      fail(
        'edit.asset_digest_mismatch',
        'admitted asset byte length differs from the declared length'
      )
    }
    if (request.read.sha256 !== expectedPayloadSha256)
    {
      fail(
        'edit.asset_digest_mismatch',
        'host asset payload digest differs from the declared digest'
      )
    }
    return this.#prepareAdmission(
      request.read.bytes,
      request.mediaKind,
      'inputFile',
      expectedPayloadSha256,
      request.expectedMetadataSha256
    )
  }

  // path-free reuse of an existing payload; it is not a format bypass, so the
  // bytes run the identical authoring parser & charge identical materializations
  async admitSourceMedia(
    request: AdmitSourceMediaRequestV1
  ): Promise<SessionAssetRecordV1>
  {
    return this.commitPreparedAdmission(await this.prepareSourceMedia(request))
  }

  async prepareSourceMedia(
    request: AdmitSourceMediaRequestV1
  ): Promise<PreparedSessionAssetAdmissionV1>
  {
    if (!(request.bytes instanceof Uint8Array))
      fail('edit.invalid_payload', 'source media payload must be bytes')
    return this.#prepareAdmission(
      request.bytes,
      request.mediaKind,
      'sourceMedia',
      requireDigest(request.expectedPayloadSha256, 'expectedPayloadSha256'),
      request.expectedMetadataSha256
    )
  }

  commitPreparedAdmission(
    prepared: PreparedSessionAssetAdmissionV1
  ): SessionAssetRecordV1
  {
    if (
      !this.#preparedAdmissions.has(prepared) ||
      prepared.priorSequence !== this.#sequence ||
      prepared.record.admittedSequence !== this.#sequence + 1
    )
      fail(
        'edit.internal_invariant',
        'prepared asset admission is stale or belongs to another session store'
      )
    this.#preparedAdmissions.delete(prepared)
    this.#commitLedger(prepared.prospectiveLedger)
    this.#sequence = prepared.record.admittedSequence
    if (!this.#payloads.has(prepared.record.payloadSha256))
    {
      this.#payloads.set(
        prepared.record.payloadSha256,
        Uint8Array.from(prepared.bytes)
      )
    }
    this.#records.set(prepared.record.assetToken, prepared.record)
    return prepared.record
  }

  // one authored add/replace reference to an already-admitted record; the
  // policy counts these cumulatively & never deduplicates them by payload
  chargeAuthoredReference(assetToken: string): AssetMaterializationLedgerV1
  {
    return this.commitMaterializationUsage(
      this.materializationUsage([assetToken])
    )
  }

  // the returned delta is pure session-local planning state; validation &
  // commit remain separate so preview, recomputation, & replay never charge it
  materializationUsage(
    assetTokens: readonly string[]
  ): AssetMaterializationUsageDeltaV1
  {
    return assetMaterializationUsageDeltaV1(
      assetTokens.map((assetToken) => this.admitted(assetToken))
    )
  }

  prospectiveMaterializationLedger(
    usage: AssetMaterializationUsageDeltaV1
  ): AssetMaterializationLedgerV1
  {
    if (
      usage.schemaVersion !== 1 ||
      !Array.isArray(usage.authoredCostumeAssetTokens) ||
      usage.authoredCostumeAssetTokens.some(
        (assetToken) => typeof assetToken !== 'string'
      )
    )
      fail(
        'edit.internal_invariant',
        'transaction asset materialization usage has an invalid shape'
      )
    const expected = this.materializationUsage(usage.authoredCostumeAssetTokens)
    if (
      usage.authoredCostumeTextureMaterializations !==
        expected.authoredCostumeTextureMaterializations ||
      usage.authoredCostumeReferencePixels !==
        expected.authoredCostumeReferencePixels ||
      usage.authoredDecodedRgbaEstimateBytes !==
        expected.authoredDecodedRgbaEstimateBytes
    )
      fail(
        'edit.internal_invariant',
        'transaction asset materialization usage differs from admitted records'
      )
    return this.#prospectiveLedger({
      authoredCostumeTextureMaterializations:
        expected.authoredCostumeTextureMaterializations,
      authoredCostumeReferencePixels: expected.authoredCostumeReferencePixels,
      authoredDecodedRgbaEstimateBytes:
        expected.authoredDecodedRgbaEstimateBytes,
    })
  }

  commitMaterializationUsage(
    usage: AssetMaterializationUsageDeltaV1
  ): AssetMaterializationLedgerV1
  {
    const prospective = this.prospectiveMaterializationLedger(usage)
    this.#commitLedger(prospective)
    return this.ledger()
  }

  async #prepareAdmission(
    bytes: Uint8Array,
    mediaKind: 'costume' | 'sound',
    origin: EditAssetOriginV1,
    expectedPayloadSha256: string,
    expectedMetadataSha256: string | undefined
  ): Promise<PreparedSessionAssetAdmissionV1>
  {
    const metadataDigest =
      expectedMetadataSha256 === undefined
        ? null
        : requireDigest(expectedMetadataSha256, 'expectedMetadataSha256')
    let identity: DerivedMediaAssetIdentity
    try
    {
      identity = await deriveAuthoringMediaIdentity(
        bytes,
        mediaKind,
        this.#limits
      )
    }
    catch (error)
    {
      if (error instanceof MediaClassificationError)
      {
        fail(
          'edit.unsupported_media',
          `${mediaKind} payload is not authoring eligible: ${error.message}`
        )
      }
      throw error
    }
    if (identity.sha256 !== expectedPayloadSha256)
    {
      fail(
        'edit.asset_digest_mismatch',
        'parsed payload digest differs from the declared digest'
      )
    }
    const derivedMetadataSha256 = editCanonicalSha256V1(identity)
    if (metadataDigest !== null && derivedMetadataSha256 !== metadataDigest)
    {
      fail(
        'edit.asset_metadata_mismatch',
        'derived media metadata digest differs from the declared digest'
      )
    }
    const charges: Partial<MutableLedger> = { admittedEditAssets: 1 }
    if (!this.#payloads.has(identity.sha256))
      charges.admittedEditAssetBytes = identity.byteLength
    const prospectiveLedger = this.#prospectiveLedger(charges)
    const admittedSequence = this.#sequence + 1
    if (!Number.isSafeInteger(admittedSequence))
      fail('edit.session_budget_exceeded', 'asset admission sequence exhausted')
    const assetToken = editOpaqueIdV1('asset', this.#salt, {
      admittedSequence,
      origin,
      mediaKind,
      payloadSha256: identity.sha256,
      metadataSha256: derivedMetadataSha256,
    })
    const record: SessionAssetRecordV1 = Object.freeze({
      assetToken,
      mediaKind,
      origin,
      payloadSha256: identity.sha256,
      metadataSha256: derivedMetadataSha256,
      byteLength: identity.byteLength,
      admittedSequence,
      identity,
    })
    const prepared = Object.freeze({
      record,
      bytes: Uint8Array.from(bytes),
      prospectiveLedger,
      priorSequence: this.#sequence,
    })
    this.#preparedAdmissions.add(prepared)
    return prepared
  }

  #prospectiveLedger(
    charges: Partial<MutableLedger>
  ): AssetMaterializationLedgerV1
  {
    const prospective: MutableLedger = { ...this.#ledger }
    for (const key of Object.keys(charges) as (keyof MutableLedger)[])
    {
      const amount = charges[key]
      if (amount === undefined || !Number.isSafeInteger(amount) || amount < 0)
        fail('edit.internal_invariant', `${key} charge is outside safe range`)
      const limit = this.#policy[key]
      if (limit === undefined)
        fail('edit.internal_invariant', `${key} has no resource policy ceiling`)
      const proposed = prospective[key] + amount
      if (!Number.isSafeInteger(proposed) || proposed > limit)
        fail(
          'edit.session_budget_exceeded',
          `${key} would reach ${proposed}, above the session ceiling ${limit}`
        )
      prospective[key] = proposed
    }
    return Object.freeze(prospective)
  }

  #commitLedger(ledger: AssetMaterializationLedgerV1): void
  {
    Object.assign(this.#ledger, ledger)
  }
}
