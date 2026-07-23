// packages/edit/src/assets/publication.ts
// export destination denial, semantic export receipt, & host publication provenance

import { basename, isAbsolute, join } from 'node:path'

import { isPathWithinRootV1 } from '@scratch-agent/eval'
import { semanticHashV1 } from '@scratch-agent/ir/edit'
import { sha256Hex } from '@scratch-agent/sb3/crypto-node'

import { editCanonicalSha256V1 } from '../support/canonical.js'
import { templateBackingIdentitiesV1 } from './greenfield-template.js'

import type { EditSourceProvenanceV1 } from '../session/source-intake.js'
import type {
  EditPublicationCapabilityV1,
  EditPublicationCommitV1,
  EditPublicationDirectoryIdentityV1,
  EditPublicationDestinationResolutionV1,
  EditPublicationNameInspectionV1,
  EditPublicationPreparedV1,
  EditPublicationReservationV1,
  EditPublicationVerificationV1,
} from '../transaction/ports.js'
import type {
  ExactRevisionIdentityV1,
  OutputNamePolicyV1,
} from '@scratch-agent/ir/edit'

export const EDIT_PUBLICATION_PROTOCOL_VERSION_V1 = 1

const OUTPUT_BASENAME_MAXIMUM_BYTES_V1 = 255

function validPublicationOutputBasenameV1(value: string): boolean
{
  const byteLength = new TextEncoder().encode(value).byteLength
  return (
    byteLength >= 5 &&
    byteLength <= OUTPUT_BASENAME_MAXIMUM_BYTES_V1 &&
    value.endsWith('.sb3') &&
    value !== '.' &&
    value !== '..' &&
    !value.includes('/') &&
    !value.includes('\\') &&
    !value.includes('\0') &&
    !isAbsolute(value) &&
    basename(value) === value
  )
}

export function isEditPublicationCapabilityReadyV1(
  capability: EditPublicationCapabilityV1
): boolean
{
  return (
    /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u.test(capability.publicationRootId) &&
    /^[0-9a-f]{64}$/u.test(capability.publicationRootOwnershipSha256) &&
    capability.writable === true &&
    capability.rejectsSymlinkComponents === true &&
    capability.enforcesRealPathContainment === true &&
    capability.noReplaceLink === true &&
    capability.durableFileSync === true &&
    capability.durableDirectorySync === true &&
    capability.reopensNoFollow === true &&
    Number.isSafeInteger(capability.maximumOutputByteLength) &&
    capability.maximumOutputByteLength > 0
  )
}

export function samePublicationDirectoryIdentityV1(
  left: EditPublicationDirectoryIdentityV1,
  right: EditPublicationDirectoryIdentityV1
): boolean
{
  return editCanonicalSha256V1(left) === editCanonicalSha256V1(right)
}

function validPublicationDirectoryIdentityV1(
  directory: EditPublicationDirectoryIdentityV1
): boolean
{
  return (
    typeof directory.canonicalRealpath === 'string' &&
    directory.canonicalRealpath.length > 0 &&
    isAbsolute(directory.canonicalRealpath) &&
    /^[0-9]+$/u.test(directory.device) &&
    /^[0-9]+$/u.test(directory.inode) &&
    /^[0-7]{3,4}$/u.test(directory.mode) &&
    /^[0-9]+$/u.test(directory.uid)
  )
}

export function isPublicationDestinationBoundV1(
  destination: EditPublicationDestinationResolutionV1
): boolean
{
  const finalCanonicalPath = join(
    destination.directory.canonicalRealpath,
    destination.basename
  )
  return (
    validPublicationDirectoryIdentityV1(destination.directory) &&
    validPublicationOutputBasenameV1(destination.basename) &&
    destination.finalCanonicalPath === finalCanonicalPath &&
    isPathWithinRootV1(
      destination.directory.canonicalRealpath,
      finalCanonicalPath,
      { allowEqual: false }
    ) &&
    (destination.finalIdentity === null ||
      (/^[0-9]+$/u.test(destination.finalIdentity.device) &&
        /^[0-9]+$/u.test(destination.finalIdentity.inode)))
  )
}

export function isPublicationReservationBoundV1(
  reservation: EditPublicationReservationV1
): boolean
{
  const finalCanonicalPath = join(
    reservation.directory.canonicalRealpath,
    reservation.basename
  )
  return (
    validPublicationDirectoryIdentityV1(reservation.directory) &&
    validPublicationOutputBasenameV1(reservation.basename) &&
    /^[A-Za-z0-9][A-Za-z0-9._-]{0,255}$/u.test(reservation.reservationId) &&
    /^[0-9a-f]{64}$/u.test(reservation.reservationSha256) &&
    reservation.finalCanonicalPath === finalCanonicalPath &&
    isPathWithinRootV1(
      reservation.directory.canonicalRealpath,
      finalCanonicalPath,
      { allowEqual: false }
    )
  )
}

export function isPreparedPublicationBoundV1(input: {
  readonly prepared: EditPublicationPreparedV1
  readonly reservation: EditPublicationReservationV1
  readonly recoveryAuthority: string
  readonly candidateSha256: string
  readonly candidateByteLength: number
}): boolean
{
  const { prepared, reservation } = input
  return (
    prepared.reservationId === reservation.reservationId &&
    prepared.tempBasename === input.recoveryAuthority &&
    prepared.tempCanonicalPath ===
      join(reservation.directory.canonicalRealpath, input.recoveryAuthority) &&
    prepared.finalCanonicalPath === reservation.finalCanonicalPath &&
    samePublicationDirectoryIdentityV1(
      prepared.directory,
      reservation.directory
    ) &&
    typeof prepared.preparationId === 'string' &&
    prepared.preparationId.length >= 1 &&
    prepared.preparationId.length <= 256 &&
    /^[0-9]+$/u.test(prepared.device) &&
    /^[0-9]+$/u.test(prepared.inode) &&
    /^[0-7]{3,4}$/u.test(prepared.mode) &&
    prepared.byteLength === input.candidateByteLength &&
    prepared.sha256 === input.candidateSha256 &&
    prepared.nameDurableBeforeWrite === true &&
    prepared.fileSynced === true &&
    prepared.readbackVerified === true
  )
}

export function isPublicationCommitBoundV1(
  prepared: EditPublicationPreparedV1,
  commit: EditPublicationCommitV1
): boolean
{
  return (
    commit.preparationId === prepared.preparationId &&
    commit.finalCanonicalPath === prepared.finalCanonicalPath &&
    commit.linkCreated === true &&
    commit.directorySynced === true &&
    commit.device === prepared.device &&
    commit.inode === prepared.inode &&
    commit.byteLength === prepared.byteLength
  )
}

export function isPublicationInspectionBoundV1(
  prepared: EditPublicationPreparedV1,
  inspection: EditPublicationNameInspectionV1
): boolean
{
  const finalIdentityComplete =
    inspection.finalDevice !== null &&
    inspection.finalInode !== null &&
    inspection.finalByteLength !== null
  return (
    inspection.preparationId === prepared.preparationId &&
    (!inspection.tempMatchesProof || inspection.tempPresent) &&
    (!inspection.finalMatchesProof || inspection.finalPresent) &&
    inspection.finalPresent === finalIdentityComplete &&
    (!inspection.finalMatchesProof ||
      (inspection.finalDevice === prepared.device &&
        inspection.finalInode === prepared.inode &&
        inspection.finalByteLength === prepared.byteLength))
  )
}

export function isPublicationVerificationBoundV1(
  prepared: EditPublicationPreparedV1,
  commit: EditPublicationCommitV1,
  verification: EditPublicationVerificationV1
): boolean
{
  return (
    verification.preparationId === prepared.preparationId &&
    verification.finalCanonicalPath === prepared.finalCanonicalPath &&
    verification.device === prepared.device &&
    verification.device === commit.device &&
    verification.inode === prepared.inode &&
    verification.inode === commit.inode &&
    verification.byteLength === prepared.byteLength &&
    verification.byteLength === commit.byteLength &&
    verification.sha256 === prepared.sha256 &&
    verification.bytes.byteLength === prepared.byteLength &&
    sha256Hex(verification.bytes) === prepared.sha256 &&
    verification.matchesPreparedIdentity === true
  )
}

export class EditPublicationDenialError extends Error
{
  constructor(
    readonly code: 'edit.output_invalid' | 'edit.source_overwrite_denied',
    message: string
  )
  {
    super(message)
    this.name = 'EditPublicationDenialError'
  }
}

interface EditDeniedDestinationV1
{
  readonly reason: 'projectSource' | 'templateBacking'
  readonly canonicalRealpath: string
  readonly device: string
  readonly inode: string
}

interface EditPublicationDestinationV1
{
  readonly canonicalRealpath: string
  readonly identity: { readonly device: string; readonly inode: string } | null
}

const OUTPUT_STEM_ALPHABET = /^[A-Za-z0-9 ._-]*$/u

// the contract owns the publishable name even when the host issued the
// reservation. A reservation proves filesystem authority, not semantic policy.
export function assertOutputBasenameAllowedV1(
  policy: OutputNamePolicyV1,
  basename: string
): void
{
  if (policy.kind === 'exact')
  {
    if (basename === policy.basename) return
    throw new EditPublicationDenialError(
      'edit.output_invalid',
      'output basename does not match the change contract'
    )
  }
  const validBounds =
    Number.isSafeInteger(policy.minStemBytes) &&
    Number.isSafeInteger(policy.maxStemBytes) &&
    policy.minStemBytes >= 0 &&
    policy.maxStemBytes >= policy.minStemBytes
  const prefixLength = policy.requiredPrefix.length
  const suffixLength = policy.requiredSuffix.length
  const hasAffixes =
    basename.length >= prefixLength + suffixLength &&
    basename.startsWith(policy.requiredPrefix) &&
    basename.endsWith(policy.requiredSuffix)
  const stem = hasAffixes
    ? basename.slice(prefixLength, basename.length - suffixLength)
    : ''
  const stemBytes = new TextEncoder().encode(stem).byteLength
  if (
    validBounds &&
    hasAffixes &&
    OUTPUT_STEM_ALPHABET.test(stem) &&
    stemBytes >= policy.minStemBytes &&
    stemBytes <= policy.maxStemBytes
  )
    return
  throw new EditPublicationDenialError(
    'edit.output_invalid',
    'output basename does not satisfy the change contract stem policy'
  )
}

// the denied set is derived from the provenance captured at session begin & is
// never re-resolved from the filesystem, which is exactly why moving or deleting
// the selected source afterwards cannot clear the denial
function deniedExportDestinationsV1(
  provenance: EditSourceProvenanceV1
): readonly EditDeniedDestinationV1[]
{
  const template = templateBackingIdentitiesV1(provenance).map((identity) => ({
    reason: 'templateBacking' as const,
    canonicalRealpath: identity.canonicalRealpath,
    device: identity.device,
    inode: identity.inode,
  }))
  if (provenance.kind !== 'projectSession') return Object.freeze(template)
  return Object.freeze([
    {
      reason: 'projectSource' as const,
      canonicalRealpath: provenance.canonicalRealpath,
      device: provenance.device,
      inode: provenance.inode,
    },
    ...template,
  ])
}

// permanent & configuration-free: it consults neither capability state nor
// contract scope, so no later group can weaken it by configuration

// path & device/inode are checked independently because a path can be renamed &
// an inode can be reached through a different path
export function assertExportDestinationAllowedV1(
  provenance: EditSourceProvenanceV1,
  destination: EditPublicationDestinationV1
): void
{
  for (const denied of deniedExportDestinationsV1(provenance))
  {
    if (
      denied.canonicalRealpath === destination.canonicalRealpath ||
      (destination.identity !== null &&
        denied.device === destination.identity.device &&
        denied.inode === destination.identity.inode)
    )
      throw new EditPublicationDenialError(
        'edit.source_overwrite_denied',
        denied.reason === 'projectSource'
          ? 'the selected project source is permanently denied as an export destination'
          : 'the registered template backing file is permanently denied as an export destination'
      )
  }
}

export function deniedDestinationSetSha256V1(
  provenance: EditSourceProvenanceV1
): string
{
  return editCanonicalSha256V1({
    schemaVersion: 1,
    label: 'denied-export-destination-set',
    entries: [...deniedExportDestinationsV1(provenance)].sort((left, right) =>
      left.canonicalRealpath < right.canonicalRealpath ? -1 : 1
    ),
  })
}

// * deliberately an edit-internal record, not an A0-annex contract type. The
// * frozen EditExportSuccessDataV1 already carries every identity a caller may
// * see; this record is the replayable meaning behind those hashes

// follows the EditEvaluationEvidenceProvenanceV1 & EditSourceProvenanceV1
// precedent: verified at replay while staying outside the contract
export interface EditSemanticExportReceiptV1
{
  readonly schemaVersion: 1
  readonly publicationProtocolVersion: number
  readonly exportedRevision: ExactRevisionIdentityV1
  readonly semanticSourceSha256: string
  readonly historySha256: string
  readonly changeContractSha256: string
  readonly capabilityProfileSha256: string
  readonly certificateSha256: string
  readonly publishedByteLength: number
  readonly publishedSha256: string
  readonly basename: string
  readonly preparedProofSha256: string
  readonly reopenSha256: string
  readonly gateSha256: string
  readonly sourcePreservationSha256: string
  readonly terminalStatus: 'closed-exported'
}

// ! the receipt must exclude reservation/resource IDs, roots & paths,
// ! device/inode/mode, temp names, timestamps, store IDs, invocation IDs, &
// ! audit sequence, or a fresh replay stops reproducing it
export function editSemanticExportReceiptSha256V1(
  receipt: EditSemanticExportReceiptV1
): string
{
  return semanticHashV1('certificate', {
    kind: 'semantic-export-receipt',
    ...receipt,
  })
}

// the host half: every fact the semantic receipt excludes on purpose. Fresh
// semantic replay verifies this record rather than regenerating it, & a
// provenance-only difference never changes revision identity
export interface EditExportProvenanceV1
{
  readonly schemaVersion: 1
  readonly exportId: string
  readonly reservationId: string
  readonly reservationSha256: string
  readonly publicationRootId: string
  readonly publicationRootOwnershipSha256: string
  readonly directoryCanonicalRealpath: string
  readonly directoryDevice: string
  readonly directoryInode: string
  readonly directoryMode: string
  readonly tempCanonicalPath: string
  readonly tempDevice: string
  readonly tempInode: string
  readonly tempMode: string
  readonly finalCanonicalPath: string
  readonly finalDevice: string
  readonly finalInode: string
  readonly nameDurableBeforeWrite: boolean
  readonly fileSynced: boolean
  readonly readbackVerified: boolean
  readonly linkCreated: boolean
  readonly directorySynced: boolean
  readonly postCommitIdentityMatched: boolean
  readonly tempReleased: boolean
  readonly deniedDestinationSetSha256: string
  readonly originalSourceCheckSha256: string
  readonly preparedAtEpochMs: number
  readonly committedAtEpochMs: number
  readonly recoveryAuthority: string
  readonly auditRecordSha256: string
  readonly reportSha256: string
  readonly eventSha256: string
}

export function editExportProvenanceSha256V1(
  provenance: EditExportProvenanceV1
): string
{
  return editCanonicalSha256V1({
    schemaVersion: 1,
    label: 'export-provenance',
    provenance,
  })
}

interface EditExportSourcePreservationV1
{
  readonly schemaVersion: 1
  readonly provenanceKind: EditSourceProvenanceV1['kind']
  readonly sourceArtifactSha256: string
  readonly revisionZeroCandidateSha256: string
  readonly preLinkRecheckOk: boolean
  readonly postLinkRecheckOk: boolean
  readonly deniedDestinationSetSha256: string
}

export function editExportSourcePreservationSha256V1(
  preservation: EditExportSourcePreservationV1
): string
{
  // denied destinations contain host paths & inode identities; provenance
  // verifies them separately so the semantic receipt stays host-independent
  return editCanonicalSha256V1({
    schemaVersion: 1,
    label: 'export-source-preservation',
    preservation: {
      schemaVersion: preservation.schemaVersion,
      provenanceKind: preservation.provenanceKind,
      sourceArtifactSha256: preservation.sourceArtifactSha256,
      revisionZeroCandidateSha256: preservation.revisionZeroCandidateSha256,
      preLinkRecheckOk: preservation.preLinkRecheckOk,
      postLinkRecheckOk: preservation.postLinkRecheckOk,
    },
  })
}

export interface EditExportReopenEvidenceV1
{
  readonly schemaVersion: 1
  readonly stage: 'preparedTemp' | 'committedFinal'
  readonly admitted: boolean
  readonly projectJsonSha256: string
  readonly assetManifestSha256: string
  readonly byteLength: number
  readonly artifactSha256: string
  readonly diagnosticsStatus: 'passed' | 'failed'
}

// both reopen stages fold into one hash so the receipt carries a single
// replay-stable reopen identity covering the temp inode & the committed name
export function editExportReopenSha256V1(
  entries: readonly EditExportReopenEvidenceV1[]
): string
{
  return editCanonicalSha256V1({
    schemaVersion: 1,
    label: 'export-reopen-evidence',
    entries,
  })
}

interface EditExportGateEvidenceV1
{
  readonly schemaVersion: 1
  readonly exportRequiredPlanId: string
  readonly certificateSha256: string
  readonly certificateStatus: string
  readonly exportable: boolean
  readonly cumulativePreservationSha256: string
  readonly diagnosticsSha256: string
}

export function editExportGateSha256V1(gate: EditExportGateEvidenceV1): string
{
  return editCanonicalSha256V1({
    schemaVersion: 1,
    label: 'export-gate-evidence',
    gate,
  })
}

interface EditExportPreparedProofV1
{
  readonly schemaVersion: 1
  readonly publicationProtocolVersion: number
  readonly basename: string
  readonly candidateSha256: string
  readonly candidateByteLength: number
  readonly nameDurableBeforeWrite: boolean
  readonly fileSynced: boolean
  readonly readbackVerified: boolean
}

export function editExportPreparedProofSha256V1(
  proof: EditExportPreparedProofV1
): string
{
  return editCanonicalSha256V1({
    schemaVersion: 1,
    label: 'export-prepared-proof',
    proof,
  })
}

interface EditPublicationProofV1
{
  readonly schemaVersion: 1
  readonly publicationProtocolVersion: number
  readonly basename: string
  readonly publishedSha256: string
  readonly publishedByteLength: number
  readonly preparedProofSha256: string
  readonly reopenSha256: string
  readonly noReplaceLinkProven: boolean
  readonly durableCommitPointReached: boolean
  readonly postCommitIdentityMatched: boolean
}

// * the durable commit point is linkCreated && directorySynced together; link
// * visibility alone is never recorded as a durability claim
export function editPublicationProofSha256V1(
  proof: EditPublicationProofV1
): string
{
  return editCanonicalSha256V1({
    schemaVersion: 1,
    label: 'publication-proof',
    proof,
  })
}
