// packages/edit/src/authoring/workspace-publication.ts
// bind recoverable publication intents, capacity & immutable receipts

import type {
  PreparedPublicationFileV1,
  PublicationDirectoryIdentityV1,
} from '@scratch-agent/eval'

import {
  editCanonicalBytesV1,
  editCanonicalSha256V1,
} from '../support/canonical.js'
import {
  AuthoringWorkspaceErrorV1,
  type AuthoringArtifactRefV1,
  type AuthoringToolIdentityV1,
} from './workspace-types.js'

export const AUTHORING_PUBLICATION_POLICY_V2 = Object.freeze({
  schemaVersion: 2,
  id: 'authoring-recoverable-publication-v2',
  writer: 'native-exclusive-artifact-root-lease',
  commit: 'no-replace-link-directory-sync-exact-inode-and-sha256',
  pending: 'block-all-ordinary-writes-until-reconciliation',
  recovery:
    'retained-acceptance-for-published-fresh-gate-before-new-publication',
  legacyState: 'read-only-before-owner-rotation',
  maximumEvidenceBytes: 64 * 1024,
  maximumNewEntries: 4,
  maximumReplacementPreparations: 1,
})

export const AUTHORING_PUBLICATION_POLICY_SHA256_V2 = editCanonicalSha256V1(
  AUTHORING_PUBLICATION_POLICY_V2
)

export const AUTHORING_PUBLICATION_POLICY_V3 = Object.freeze({
  ...AUTHORING_PUBLICATION_POLICY_V2,
  schemaVersion: 3,
  id: 'authoring-recoverable-publication-v3',
  recovery: 'pure-recorded-acceptance-after-exact-published-proof-v3',
  discovery: 'verified-immutable-phases-and-quota-under-native-root-lease',
  legacyState: 'recover-known-v2-policy-before-deferred-upgrade',
})

export const AUTHORING_PUBLICATION_POLICY_SHA256_V3 = editCanonicalSha256V1(
  AUTHORING_PUBLICATION_POLICY_V3
)

export interface AuthoringPublicationIntentV2
{
  readonly schemaVersion: 2
  readonly kind: 'authoring-publication-intent-v2'
  readonly exportId: string
  readonly workspaceId: string
  readonly buildId: string
  readonly evaluationId: string
  readonly evaluation: AuthoringArtifactRefV1
  readonly candidate: AuthoringArtifactRefV1
  readonly plan: AuthoringArtifactRefV1
  readonly contractSha256: string
  readonly sourceClosureSha256: string
  readonly tools: AuthoringToolIdentityV1
  readonly permissionsSha256: string
  readonly policySha256: string
  readonly previousStateSha256: string
  readonly ownerSha256: string
  readonly directory: PublicationDirectoryIdentityV1
  readonly finalBasename: string
  readonly tempBasename: string
  readonly capacity: {
    readonly reservationId: string
    readonly reservedBytes: number
    readonly reservedEntries: number
    readonly initialEntries: number
    readonly initialBytes: number
    readonly maximumPointerBytes: number
  }
}

export interface AuthoringPublicationPreparationV2
{
  readonly schemaVersion: 2
  readonly exportId: string
  readonly intentSha256: string
  readonly ordinal: 0 | 1
  readonly proof: PreparedPublicationFileV1
}

export interface AuthoringPublicationIntentV3 extends Omit<
  AuthoringPublicationIntentV2,
  'schemaVersion' | 'kind'
>
{
  readonly schemaVersion: 3
  readonly kind: 'authoring-publication-intent-v3'
}

export type AuthoringPublicationIntent =
  AuthoringPublicationIntentV2 | AuthoringPublicationIntentV3

export function authoringPublicationEvidenceBytesV2(
  value: unknown
): Uint8Array
{
  const bytes = editCanonicalBytesV1(value)
  if (bytes.byteLength > AUTHORING_PUBLICATION_POLICY_V2.maximumEvidenceBytes)
    throw new AuthoringWorkspaceErrorV1(
      'authoring.publication_budget_exceeded',
      'publication evidence exceeds its reserved bounded record size'
    )
  return bytes
}

export function authoringPublicationIssueV2(error: unknown): string
{
  const code =
    typeof error === 'object' && error !== null && 'code' in error
      ? String(error.code)
      : 'authoring.publication_interrupted'
  const message = error instanceof Error ? error.message : String(error)
  return `${code}: ${message}`.slice(0, 2048)
}
