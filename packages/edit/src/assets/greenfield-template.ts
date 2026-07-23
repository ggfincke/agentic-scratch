// packages/edit/src/assets/greenfield-template.ts
// generate, pin, & admit the scratch-3-empty-v1 greenfield baseline artifact

import {
  md5Hex,
  packSb3,
  type Asset,
  type ProjectJson,
} from '@scratch-agent/sb3'
import { sha256Hex } from '@scratch-agent/sb3/crypto-node'

import {
  validateEditSourceIntakeV1,
  type EditSourceIntakeV1,
  type EditSourceProvenanceV1,
} from '../session/source-intake.js'

export const GREENFIELD_TEMPLATE_ID_V1 = 'scratch-3-empty-v1'
export const GREENFIELD_TEMPLATE_VERSION_V1 = 1

// a 2x2 fully transparent bitmap-free backdrop. the baseline has to carry one
// costume because a target w/o a costume is not a well-formed Scratch target, &
// this is the smallest payload that is still a real, parseable SVG document
const BLANK_BACKDROP_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" version="1.1" width="2" height="2">' +
  '<rect width="2" height="2" fill="none"/></svg>'

// every string, number, & key order below is frozen: the artifact hash is this
// template's only oracle, so any drift here is a template version change
export function buildGreenfieldTemplateProjectJsonV1(): ProjectJson
{
  const bytes = new TextEncoder().encode(BLANK_BACKDROP_SVG)
  const assetId = md5Hex(bytes)
  return {
    targets: [
      {
        isStage: true,
        name: 'Stage',
        variables: {},
        lists: {},
        broadcasts: {},
        blocks: {},
        comments: {},
        currentCostume: 0,
        costumes: [
          {
            name: 'backdrop1',
            assetId,
            md5ext: `${assetId}.svg`,
            dataFormat: 'svg',
            bitmapResolution: 1,
            rotationCenterX: 1,
            rotationCenterY: 1,
          },
        ],
        sounds: [],
        volume: 100,
        layerOrder: 0,
        tempo: 60,
        videoTransparency: 50,
        videoState: 'off',
        textToSpeechLanguage: null,
      },
    ],
    monitors: [],
    extensions: [],
    meta: { semver: '3.0.0', vm: '0.2.0', agent: '' },
  }
}

export function greenfieldTemplateAssetsV1(): readonly Asset[]
{
  const bytes = new TextEncoder().encode(BLANK_BACKDROP_SVG)
  return Object.freeze([{ path: `${md5Hex(bytes)}.svg`, bytes }])
}

// `packSb3` pins the zip entry timestamps, so the same project JSON & the same
// asset bytes always produce the same archive bytes across processes
export async function buildGreenfieldTemplateArtifactV1(): Promise<Uint8Array>
{
  return packSb3(
    JSON.stringify(buildGreenfieldTemplateProjectJsonV1()),
    greenfieldTemplateAssetsV1().map((asset) => ({ ...asset }))
  )
}

// the template has no external oracle, so its own artifact hash is the oracle.
// this moving is a template version change, never an incidental regeneration
export const PINNED_GREENFIELD_TEMPLATE_ARTIFACT_SHA256_V1 =
  '5d2853b533da7088cc546a53a510b0357e1fd3ed23920efc57081fbcaa91d26a'

async function greenfieldTemplateArtifactSha256V1(): Promise<string>
{
  return sha256Hex(await buildGreenfieldTemplateArtifactV1())
}

export async function assertPinnedGreenfieldTemplateIdentityV1(): Promise<string>
{
  const observed = await greenfieldTemplateArtifactSha256V1()
  if (observed !== PINNED_GREENFIELD_TEMPLATE_ARTIFACT_SHA256_V1)
    throw new GreenfieldTemplateError(
      'edit.source_identity_mismatch',
      `greenfield template artifact is ${observed}, not its pinned identity`
    )
  return observed
}

interface GreenfieldTemplateRegistryEntryV1
{
  readonly registryEntryId: string
  readonly registryProfileSha256: string
  readonly sourceInspectionPolicySha256: string
  readonly diagnosticPolicySha256: string
  readonly runtimePolicySha256: string
  // present only when the registry actually resolves the template from a file
  // rather than from embedded, content-addressed bytes
  readonly backingFileIdentity?: {
    readonly canonicalRealpath: string
    readonly device: string
    readonly inode: string
    readonly byteLength: number
    readonly modifiedAtNanoseconds: string
  }
}

function templateProvenance(
  entry: GreenfieldTemplateRegistryEntryV1,
  artifactSha256: string
): EditSourceProvenanceV1
{
  return {
    kind: 'registeredTemplate',
    registryProfileSha256: entry.registryProfileSha256,
    registryEntryId: entry.registryEntryId,
    templateId: GREENFIELD_TEMPLATE_ID_V1,
    templateVersion: GREENFIELD_TEMPLATE_VERSION_V1,
    templateArtifactSha256: artifactSha256,
    // the resolution proof binds the entry to the exact artifact it produced, so
    // a later registry edit cannot silently re-point the same entry id
    registryResolutionProofSha256: sha256Hex(
      new TextEncoder().encode(
        `${entry.registryEntryId}:${GREENFIELD_TEMPLATE_ID_V1}:${GREENFIELD_TEMPLATE_VERSION_V1}:${artifactSha256}`
      )
    ),
    sourceInspectionPolicySha256: entry.sourceInspectionPolicySha256,
    diagnosticPolicySha256: entry.diagnosticPolicySha256,
    runtimePolicySha256: entry.runtimePolicySha256,
    provenanceRegistrationSha256: sha256Hex(
      new TextEncoder().encode(
        `registered-template-v1:${entry.registryProfileSha256}:${artifactSha256}`
      )
    ),
    ...(entry.backingFileIdentity
      ? { backingFileIdentity: { ...entry.backingFileIdentity } }
      : {}),
  }
}

// greenfield is a begin-mode, not an operation: it produces the same intake shape
// an opened project produces, so revision 0 & every later gate is one path
export async function greenfieldTemplateSourceIntakeV1(
  entry: GreenfieldTemplateRegistryEntryV1
): Promise<EditSourceIntakeV1>
{
  const bytes = await buildGreenfieldTemplateArtifactV1()
  // the registry can only hand out the pinned artifact: a generator drift is a
  // refusal here rather than a silently different baseline downstream
  const artifactSha256 = await assertPinnedGreenfieldTemplateIdentityV1()
  return validateEditSourceIntakeV1({
    bytes,
    displayName: `${GREENFIELD_TEMPLATE_ID_V1}.sb3`,
    expectedArtifactSha256: artifactSha256,
    provenance: templateProvenance(entry, artifactSha256),
    // the registry entry is immutable, so a recheck regenerates & re-hashes
    // rather than re-reading any mutable host state
    recheck: async () =>
    {
      const observed = sha256Hex(await buildGreenfieldTemplateArtifactV1())
      return observed === artifactSha256
        ? { ok: true, observedArtifactSha256: observed }
        : { ok: false, reason: 'changed', observedArtifactSha256: observed }
    },
  })
}

class GreenfieldTemplateError extends Error
{
  constructor(
    readonly code: string,
    message: string
  )
  {
    super(message)
    this.name = 'GreenfieldTemplateError'
  }
}

interface TemplateBackingIdentityV1
{
  readonly canonicalRealpath: string
  readonly device: string
  readonly inode: string
}

// every registered-template backing path is a permanently denied destination.
// both halves are checked because a path can be renamed & an inode can be
// reached through a different path, so neither alone is sufficient
export function templateBackingIdentitiesV1(
  provenance: EditSourceProvenanceV1
): readonly TemplateBackingIdentityV1[]
{
  if (
    provenance.kind !== 'registeredTemplate' ||
    provenance.backingFileIdentity === undefined
  )
    return Object.freeze([])
  const identity = provenance.backingFileIdentity
  return Object.freeze([
    {
      canonicalRealpath: identity.canonicalRealpath,
      device: identity.device,
      inode: identity.inode,
    },
  ])
}

// this is permanent: it does not consult capability state, contract scope, or
// any caller-supplied allowance, so no later group can weaken it by configuration
export function assertTemplateBackingFileIsNotAnOutputV1(
  provenance: EditSourceProvenanceV1,
  destination: TemplateBackingIdentityV1
): void
{
  for (const denied of templateBackingIdentitiesV1(provenance))
  {
    if (
      denied.canonicalRealpath === destination.canonicalRealpath ||
      (denied.device === destination.device &&
        denied.inode === destination.inode)
    )
      throw new GreenfieldTemplateError(
        'edit.source_overwrite_denied',
        'a registered-template backing file is permanently denied as an output'
      )
  }
}
