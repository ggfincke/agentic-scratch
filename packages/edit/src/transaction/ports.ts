// packages/edit/src/transaction/ports.ts
// narrow host capabilities for durable edit artifacts, source intake, time, & entropy

export interface EditArtifactIdentityV1
{
  sha256: string
  byteLength: number
}

export interface EditArtifactEntryV1 extends EditArtifactIdentityV1
{
  key: string
}

interface EditStoreCapabilityV1
{
  storeId: string
  storeMode: 'create-writer' | 'read-only' | 'recovery'
  ownershipSha256: string
  writable: boolean
  exclusiveWriter: boolean
  durableFileSync: boolean
  durableDirectorySync: boolean
  noReplaceInstall: boolean
  expectedHashPointerCas: boolean
}

interface EditPointerReconciliationV1
{
  status: 'old' | 'new' | 'interference'
  observedSha256: string | null
  proposed: EditArtifactIdentityV1
}

interface EditQuotaReservationV1
{
  reservationId: string
  reservedBytes: number
}

type EditQuotaOutcomeV1 =
  | {
      state: 'active'
      reservationId: string
      reservedBytes: number
    }
  | {
      state: 'released'
      reservationId: string
      reservedBytes: number
      actualBytes: 0
    }
  | {
      state: 'settled'
      reservationId: string
      reservedBytes: number
      actualBytes: number
    }
  | { state: 'absent'; reservationId: string }

export interface EditArtifactStorePort
{
  capability(): Promise<EditStoreCapabilityV1>
  createImmutable(
    key: string,
    bytes: Uint8Array
  ): Promise<EditArtifactIdentityV1>
  createOrVerifyImmutable(
    key: string,
    bytes: Uint8Array
  ): Promise<EditArtifactIdentityV1>
  readImmutable(key: string): Promise<Uint8Array>
  hashImmutable(key: string): Promise<string>
  sizeImmutable(key: string): Promise<number>
  listImmutable(prefix: string): Promise<readonly EditArtifactEntryV1[]>
  compareAndSwapPointer(
    key: string,
    expectedSha256: string | null,
    bytes: Uint8Array
  ): Promise<EditArtifactIdentityV1>
  reconcilePointer(
    key: string,
    expectedOldSha256: string | null,
    proposedBytes: Uint8Array
  ): Promise<EditPointerReconciliationV1>
  reserveQuota(
    reservationId: string,
    byteLength: number
  ): Promise<EditQuotaReservationV1>
  releaseQuota(reservationId: string): Promise<void>
  settleQuota(reservationId: string, actualByteLength: number): Promise<void>
  quotaOutcome(reservationId: string): Promise<EditQuotaOutcomeV1>
  cleanupProvenTemp(proof: string): Promise<void>
  removeEvictable(key: string, expectedSha256: string): Promise<boolean>
}

export type EditRetainedResourceMimeTypeV1 =
  | 'application/json'
  | 'application/x.scratch.sb3'
  | 'audio/wav'
  | 'image/png'
  | 'text/markdown; charset=utf-8'
  | 'video/webm'

export interface EditRetainedResourceCatalogueInputV1
{
  readonly sessionId: string
  readonly sessionKey: string
  readonly logicalKey: string
  readonly identity: EditArtifactIdentityV1
  readonly mimeType: EditRetainedResourceMimeTypeV1
}

// the producer publishes exact content metadata only after the immutable
// payload exists; catalogue implementations must make retries idempotent
export interface EditRetainedResourceCataloguePortV1
{
  retain(input: EditRetainedResourceCatalogueInputV1): Promise<void>
}

export interface EditAssetHostProvenanceV1
{
  kind: 'assetInput'
  selectedPath: string
  canonicalPath: string
  device: string
  inode: string
  byteLength: number
  modifiedAtNanoseconds: string
  sha256: string
}

export interface EditAssetInputReadV1
{
  bytes: Uint8Array
  byteLength: number
  sha256: string
  provenance: EditAssetHostProvenanceV1
}

// * a genuinely separate host boundary from EditArtifactStorePort: that store owns
// * its own private root & Group B's frozen durability semantics, while this one
// * publishes a single file into an externally configured output directory

// ! complete-or-absent holds under non-adversarial concurrency only. Node has no
// ! portable dirfd-relative openat/linkat, so V1 trusts this private same-user
// ! directory is not replaced mid-operation; it detects change between them
export interface EditPublicationCapabilityV1
{
  publicationRootId: string
  publicationRootOwnershipSha256: string
  writable: boolean
  rejectsSymlinkComponents: boolean
  enforcesRealPathContainment: boolean
  noReplaceLink: boolean
  durableFileSync: boolean
  durableDirectorySync: boolean
  reopensNoFollow: boolean
  maximumOutputByteLength: number
}

export interface EditPublicationDirectoryIdentityV1
{
  canonicalRealpath: string
  device: string
  inode: string
  mode: string
  uid: string
}

export interface EditPublicationReservationV1
{
  reservationId: string
  reservationSha256: string
  basename: string
  finalCanonicalPath: string
  directory: EditPublicationDirectoryIdentityV1
}

// the prepared temp is the recovery authority; its name is durable before any
// byte is written, so a crash leaves a nameable inode rather than a leak
export interface EditPublicationPreparedV1
{
  preparationId: string
  reservationId: string
  tempBasename: string
  tempCanonicalPath: string
  finalCanonicalPath: string
  device: string
  inode: string
  mode: string
  byteLength: number
  sha256: string
  directory: EditPublicationDirectoryIdentityV1
  nameDurableBeforeWrite: boolean
  fileSynced: boolean
  readbackVerified: boolean
}

// * linkCreated alone is not a durability claim; the commit point is linkCreated
// * && directorySynced together
export interface EditPublicationCommitV1
{
  preparationId: string
  finalCanonicalPath: string
  linkCreated: boolean
  directorySynced: boolean
  device: string
  inode: string
  byteLength: number
}

export interface EditPublicationVerificationV1
{
  preparationId: string
  finalCanonicalPath: string
  device: string
  inode: string
  byteLength: number
  sha256: string
  bytes: Uint8Array
  matchesPreparedIdentity: boolean
}

interface EditPublicationErrorV1 extends Error
{
  code: string
  // true once the final link may exist, which forbids reporting ordinary failure
  committed: boolean
}

export interface EditPublicationDestinationResolutionV1
{
  basename: string
  finalCanonicalPath: string
  // the final entry's own no-follow identity when it already exists; this is
  // never substituted w/ the containing directory's identity
  finalIdentity: { readonly device: string; readonly inode: string } | null
  directory: EditPublicationDirectoryIdentityV1
}

// * what recovery reads: every field comes from what the filesystem shows now,
// * never from an earlier syscall having returned. A durable commit is claimed
// * only after this inspection plus a fresh directory sync
export interface EditPublicationNameInspectionV1
{
  preparationId: string
  tempPresent: boolean
  tempMatchesProof: boolean
  finalPresent: boolean
  finalMatchesProof: boolean
  finalDevice: string | null
  finalInode: string | null
  finalByteLength: number | null
}

// a relink may have to recreate the prepared temp from the retained candidate,
// so it returns the refreshed proof the provenance must record
interface EditPublicationRelinkV1
{
  commit: EditPublicationCommitV1
  prepared: EditPublicationPreparedV1
  temporaryRecreated: boolean
}

// retained before the temp is created, so every process-crash window leaves
// one exact, host-resolvable publication authority rather than an orphan name
export interface EditPublicationRecoveryAuthorityV1
{
  publicationRootId: string
  publicationRootOwnershipSha256: string
  directory: EditPublicationDirectoryIdentityV1
  reservationId: string
  reservationSha256: string
  basename: string
  tempBasename: string
  tempDevice: string | null
  tempInode: string | null
  tempMode: string | null
  candidateSha256: string
  candidateByteLength: number
}

// exclusive predecessor recovery receives only the operations needed to
// classify or terminalize one already-retained publication
export interface EditPublicationRecoveryPortV1
{
  adoptRetainedPreparation(
    authority: EditPublicationRecoveryAuthorityV1
  ): Promise<EditPublicationPreparedV1>
  inspectPublicationNames(
    preparationId: string
  ): Promise<EditPublicationNameInspectionV1>
  syncPublicationDirectory(
    preparationId: string
  ): Promise<EditPublicationCommitV1>
  relinkPrepared(
    preparationId: string,
    bytes: Uint8Array
  ): Promise<EditPublicationRelinkV1>
  verifyCommitted(preparationId: string): Promise<EditPublicationVerificationV1>
  releasePrepared(preparationId: string): Promise<void>
}

export interface EditPublicationPort
{
  capability(): Promise<EditPublicationCapabilityV1>
  // * resolves the destination WITHOUT an existence check, so the domain's
  // * permanent source denial is decided before the host reports output_exists;
  // * a denied destination must refuse as denied whether or not it exists today
  resolveDestination(
    request:
      | { kind: 'basename'; basename: string }
      | { kind: 'reservation'; reservationId: string }
  ): Promise<EditPublicationDestinationResolutionV1>
  revalidateReservation(
    request:
      | { kind: 'basename'; basename: string }
      | { kind: 'reservation'; reservationId: string }
  ): Promise<EditPublicationReservationV1>
  recheckDirectory(
    reservationId: string
  ): Promise<EditPublicationDirectoryIdentityV1>
  prepare(
    reservationId: string,
    bytes: Uint8Array,
    recoveryAuthority: string
  ): Promise<EditPublicationPreparedV1>
  readPrepared(preparationId: string): Promise<Uint8Array>
  commit(preparationId: string): Promise<EditPublicationCommitV1>
  verifyCommitted(preparationId: string): Promise<EditPublicationVerificationV1>
  releasePrepared(preparationId: string): Promise<void>
  // the three roll-forward primitives for the link-before-directory-sync window
  inspectPublicationNames(
    preparationId: string
  ): Promise<EditPublicationNameInspectionV1>
  // makes an already-correct final link durable; it never creates a link
  syncPublicationDirectory(
    preparationId: string
  ): Promise<EditPublicationCommitV1>
  // repeats the no-replace link onto a proven-absent final name
  relinkPrepared(
    preparationId: string,
    bytes: Uint8Array
  ): Promise<EditPublicationRelinkV1>
}

export function isEditPublicationErrorV1(
  error: unknown
): error is EditPublicationErrorV1
{
  return (
    error instanceof Error &&
    'code' in error &&
    typeof error.code === 'string' &&
    error.code.length > 0 &&
    'committed' in error &&
    typeof error.committed === 'boolean'
  )
}

// * the audit MAC purpose is structurally distinct, not merely conventional.
// * A provider declares this purpose & the journal refuses any material naming
// * another, so a pagination-cursor or handle secret cannot authenticate a tail
export const AUDIT_KEY_PURPOSE_V1 = 'server-audit-tail'

type AuditKeyPurposeV1 = typeof AUDIT_KEY_PURPOSE_V1

interface AuditKeyDescriptorV1
{
  auditKeyId: string
  algorithm: 'HMAC-SHA-256'
  algorithmVersion: 1
  purpose: AuditKeyPurposeV1
}

// ! secret lives in memory only. Key bytes are never written to a store,
// ! report, trace, or supervisor manifest; only auditKeyId ever leaves here
export interface AuditKeyMaterialV1 extends AuditKeyDescriptorV1
{
  secret: Uint8Array
}

type AuditKeyUnavailableReasonV1 = 'missing' | 'retired'

export interface AuditKeyUnavailableErrorV1 extends Error
{
  code: string
  auditKeyId: string
  reason: AuditKeyUnavailableReasonV1
}

// * one process store pins one active key ID. Rotation starts a NEW store &
// * never re-HMACs an old tail, so every old verification key is retained until
// * the stores naming it are reconciled, final-tail-anchored, & removed
export interface AuditKeyProviderPort
{
  activeKey(): Promise<AuditKeyMaterialV1>
  verificationKey(auditKeyId: string): Promise<AuditKeyMaterialV1>
}

export function isAuditKeyUnavailableErrorV1(
  error: unknown
): error is AuditKeyUnavailableErrorV1
{
  return (
    error instanceof Error &&
    'code' in error &&
    typeof error.code === 'string' &&
    'auditKeyId' in error &&
    typeof error.auditKeyId === 'string' &&
    'reason' in error &&
    (error.reason === 'missing' || error.reason === 'retired')
  )
}

export interface EditClockPort
{
  nowEpochMs(): number
}

export interface EditEntropyPort
{
  randomBytes(byteLength: number): Uint8Array
}

// the two boundaries make different claims: a direct call cannot assert
// anything about duplicate keys that no longer exist in a parsed object, while
// mcpStdio refused them at framing before any value was built
export interface HostInvocationContextV1
{
  boundaryKind: 'directHost' | 'mcpStdio'
  invocationSha256: string
  principalSha256: string
}

export const SYSTEM_EDIT_CLOCK: EditClockPort = Object.freeze({
  nowEpochMs: () => Date.now(),
})
