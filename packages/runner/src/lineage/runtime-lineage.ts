// packages/runner/src/lineage/runtime-lineage.ts
// neutral hash-bound runtime lineage manifest & lane-independent seam binding

export const RUNTIME_LINEAGE_MANIFEST_SCHEMA_VERSION = 1 as const

// a raw sb3 declaration ID plus the xml-safe form the pinned loader actually installs.
// scratch-vm rewrites <>&'" in declaration IDs during deserialize (replaceUnsafeCharsInVariableIds),
// so a lane binding against raw IDs alone would silently miss those declarations.
interface RuntimeLineageDeclarationEntryV1
{
  readonly declarationLineage: string
  readonly rawDeclarationId: string
  readonly normalizedDeclarationId: string
}

export interface RuntimeLineageMediaEntryV1
{
  readonly mediaLineage: string
  readonly mediaKind: 'costume' | 'sound'
  readonly mediaOrder: number
  readonly assetId: string
}

// one serialized target's lineage plus every loader-preserved identity a lane
// may bind it by; witnessIds keeps only manifest-unique identities, & the two
// ordinals are expectations to verify rather than things to bind by
interface RuntimeLineageTargetEntryV1
{
  readonly targetLineage: string
  readonly isStage: boolean
  readonly serializedTargetOrdinal: number
  readonly executableTargetOrdinal: number
  readonly blockIds: readonly string[]
  readonly declarations: readonly RuntimeLineageDeclarationEntryV1[]
  readonly media: readonly RuntimeLineageMediaEntryV1[]
  readonly witnessIds: readonly string[]
}

interface RuntimeLineageManifestBodyV1
{
  readonly schemaVersion: typeof RUNTIME_LINEAGE_MANIFEST_SCHEMA_VERSION
  readonly artifactSha256: string
  readonly targets: readonly RuntimeLineageTargetEntryV1[]
  readonly executableTargetLineageOrder: readonly string[]
}

export interface RuntimeLineageManifestV1 extends RuntimeLineageManifestBodyV1
{
  readonly manifestSha256: string
}

// what an adapter reads off one VM target at the deserialize-before-install seam
export interface RuntimeLineageObservedTargetV1
{
  readonly isStage: boolean
  readonly seamOrdinal: number
  readonly layerOrder: number | null
  readonly blockIds: readonly string[]
  readonly declarationIds: readonly string[]
  readonly mediaAssetIds: readonly string[]
}

interface RuntimeLineageBoundTargetV1
{
  readonly targetLineage: string
  readonly seamOrdinal: number
  readonly matchedWitnessIds: readonly string[]
}

export type RuntimeLineageBindingV1 =
  | {
      readonly status: 'bound'
      readonly targets: readonly RuntimeLineageBoundTargetV1[]
      readonly paneLineageOrder: readonly string[]
    }
  | {
      readonly status: 'inconclusive'
      readonly reason: RuntimeLineageBindingReason
      readonly detail: string
      readonly unboundTargetLineages: readonly string[]
    }

type RuntimeLineageBindingReason =
  | 'manifest-shape-invalid'
  | 'target-count-mismatch'
  | 'stage-shape-mismatch'
  | 'unwitnessed-target'
  | 'ambiguous-witness'
  | 'unmatched-target'
  | 'pane-order-mismatch'
  | 'declaration-normalization-mismatch'

type RuntimeLineageAdapterStatus =
  'bound' | 'inconclusive' | 'unavailable'

// the retained per-lane adapter record: pinned loader identities, the manifest hash
// it was dispatched w/, what it actually verified, & any exact mismatch
export interface RuntimeLineageAdapterResultV1
{
  readonly schemaVersion: typeof RUNTIME_LINEAGE_MANIFEST_SCHEMA_VERSION
  readonly laneId: string
  readonly status: RuntimeLineageAdapterStatus
  readonly loaderId: string
  readonly loaderVersion: string
  readonly seamId: string
  readonly declarationNormalizationId: string
  readonly manifestSha256: string | null
  readonly seamObserved: boolean
  readonly verifiedTargetCount: number
  readonly paneLineageOrder: readonly string[]
  readonly executableTargetLineageOrder: readonly string[]
  readonly expectedExecutableTargetLineageOrder: readonly string[]
  readonly boundTargets: readonly RuntimeLineageBoundTargetV1[]
  readonly mismatch: string | null
  readonly unavailableReason: string | null
}

interface RuntimeIdentityDeclarationFacetV1
{
  readonly declarationLineage: string
  readonly rawDeclarationId: string
  readonly normalizedDeclarationId: string
  readonly runtimeDeclarationId: string
  readonly runtimeName: string
  readonly collection: 'variables' | 'lists' | 'broadcasts'
}

interface RuntimeIdentityMediaFacetV1
{
  readonly mediaLineage: string
  readonly mediaKind: 'costume' | 'sound'
  readonly mediaOrder: number
  readonly assetId: string
  readonly runtimeName: string
  readonly mediaIndex: number
}

export interface RuntimeIdentityTargetFacetV1
{
  readonly targetLineage: string
  readonly runtimeTargetId: string
  readonly observationTargetId: string
  readonly runtimeTargetName: string
  readonly cloneCountTargetId: string
  readonly geometryOriginalTargetId: string
  readonly isStage: boolean
  readonly declarations: readonly RuntimeIdentityDeclarationFacetV1[]
  readonly media: readonly RuntimeIdentityMediaFacetV1[]
}

export type RuntimeIdentityFacetV1 =
  | {
      readonly schemaVersion: 1
      readonly status: 'bound'
      readonly manifestSha256: string
      readonly targets: readonly RuntimeIdentityTargetFacetV1[]
    }
  | {
      readonly schemaVersion: 1
      readonly status: 'inconclusive'
      readonly manifestSha256: string | null
      readonly targets: readonly []
      readonly reason: string
    }

class RuntimeLineageManifestError extends Error
{
  constructor(
    readonly reason: RuntimeLineageBindingReason,
    message: string
  )
  {
    super(message)
    this.name = 'RuntimeLineageManifestError'
  }
}

// mirrors scratch-vm's StringUtil.replaceUnsafeChars, which the pinned loader applies
// to every declaration ID before installTargets runs
function normalizeDeclarationId(rawId: string): string
{
  return rawId.replace(/[<>&'"]/g, (character) =>
  {
    switch (character)
    {
      case '<':
        return 'lt'
      case '>':
        return 'gt'
      case '&':
        return 'amp'
      case "'":
        return 'sq'
      default:
        return 'dq'
    }
  })
}

function blockWitnessId(blockId: string): string
{
  return `block:${blockId}`
}

function declarationWitnessId(normalizedId: string): string
{
  return `declaration:${normalizedId}`
}

function mediaWitnessId(assetId: string): string
{
  return `media:${assetId}`
}

export interface RuntimeLineageTargetInputV1
{
  readonly targetLineage: string
  readonly isStage: boolean
  readonly serializedTargetOrdinal: number
  readonly layerOrder: number
  readonly blockIds: readonly string[]
  readonly declarations: readonly {
    readonly declarationLineage: string
    readonly rawDeclarationId: string
  }[]
  readonly media: readonly RuntimeLineageMediaEntryV1[]
}

function sortedUnique(values: readonly string[]): readonly string[]
{
  return Object.freeze([...new Set(values)].sort())
}

// count every candidate witness across the manifest so shared identities
// (a costume asset used by two sprites) can never discriminate a target
function globallyUniqueWitnesses(
  perTarget: readonly (readonly string[])[]
): ReadonlySet<string>
{
  const counts = new Map<string, number>()
  for (const witnesses of perTarget)
    for (const witness of witnesses)
      counts.set(witness, (counts.get(witness) ?? 0) + 1)
  const unique = new Set<string>()
  for (const [witness, count] of counts) if (count === 1) unique.add(witness)
  return unique
}

function sameSortedValues(
  left: readonly string[],
  right: readonly string[]
): boolean
{
  if (left.length !== right.length) return false
  const sortedLeft = [...left].sort()
  const sortedRight = [...right].sort()
  return sortedLeft.every((value, index) => value === sortedRight[index])
}

export function buildRuntimeLineageManifestBodyV1(input: {
  readonly artifactSha256: string
  readonly targets: readonly RuntimeLineageTargetInputV1[]
}): RuntimeLineageManifestBodyV1
{
  const lineages = new Set<string>()
  for (const target of input.targets)
  {
    if (target.targetLineage.length === 0)
      throw new RuntimeLineageManifestError(
        'manifest-shape-invalid',
        'target lineage must not be empty'
      )
    if (lineages.has(target.targetLineage))
      throw new RuntimeLineageManifestError(
        'manifest-shape-invalid',
        `duplicate target lineage: ${target.targetLineage}`
      )
    lineages.add(target.targetLineage)
  }
  const stages = input.targets.filter((target) => target.isStage)
  if (stages.length !== 1)
    throw new RuntimeLineageManifestError(
      'stage-shape-mismatch',
      `manifest must describe exactly one stage, found ${stages.length}`
    )
  const candidates = input.targets.map((target) => ({
    target,
    witnessIds: sortedUnique([
      ...target.blockIds.map(blockWitnessId),
      ...target.declarations.map((declaration) =>
        declarationWitnessId(
          normalizeDeclarationId(declaration.rawDeclarationId)
        )
      ),
      ...target.media.map((media) => mediaWitnessId(media.assetId)),
    ]),
  }))
  const unique = globallyUniqueWitnesses(
    candidates.map((candidate) => candidate.witnessIds)
  )
  const ordered = [...candidates].sort(
    (left, right) =>
      left.target.serializedTargetOrdinal - right.target.serializedTargetOrdinal
  )
  const executableOrder = [...input.targets]
    .sort((left, right) => left.layerOrder - right.layerOrder)
    .map((target) => target.targetLineage)
  const executableOrdinals = new Map(
    executableOrder.map((lineage, ordinal) => [lineage, ordinal])
  )
  const targets = ordered.map(({ target, witnessIds }, index) =>
  {
    if (target.serializedTargetOrdinal !== index)
      throw new RuntimeLineageManifestError(
        'manifest-shape-invalid',
        `serialized target ordinals must be contiguous from zero at ${index}`
      )
    const uniqueWitnessIds = witnessIds.filter((witness) => unique.has(witness))
    return Object.freeze({
      targetLineage: target.targetLineage,
      isStage: target.isStage,
      serializedTargetOrdinal: index,
      executableTargetOrdinal: executableOrdinals.get(target.targetLineage)!,
      blockIds: Object.freeze([...target.blockIds]),
      declarations: Object.freeze(
        target.declarations.map((declaration) =>
          Object.freeze({
            declarationLineage: declaration.declarationLineage,
            rawDeclarationId: declaration.rawDeclarationId,
            normalizedDeclarationId: normalizeDeclarationId(
              declaration.rawDeclarationId
            ),
          })
        )
      ),
      media: Object.freeze(
        target.media.map((media) => Object.freeze({ ...media }))
      ),
      witnessIds: Object.freeze(uniqueWitnessIds),
    })
  })
  return Object.freeze({
    schemaVersion: RUNTIME_LINEAGE_MANIFEST_SCHEMA_VERSION,
    artifactSha256: input.artifactSha256,
    targets: Object.freeze(targets),
    executableTargetLineageOrder: Object.freeze(executableOrder),
  })
}

export function sealRuntimeLineageManifestV1(
  body: RuntimeLineageManifestBodyV1,
  manifestSha256: string
): RuntimeLineageManifestV1
{
  return Object.freeze({ ...body, manifestSha256 })
}

function bindingFailure(
  reason: RuntimeLineageBindingReason,
  detail: string,
  unboundTargetLineages: readonly string[] = []
): RuntimeLineageBindingV1
{
  return Object.freeze({
    status: 'inconclusive' as const,
    reason,
    detail,
    unboundTargetLineages: Object.freeze([...unboundTargetLineages]),
  })
}

// bind by loader-preserved identities, then verify pane order independently;
// no ordinal or display-name fallback may assign a target
export function bindRuntimeLineageV1(
  manifest: RuntimeLineageManifestBodyV1,
  observed: readonly RuntimeLineageObservedTargetV1[]
): RuntimeLineageBindingV1
{
  if (manifest.schemaVersion !== RUNTIME_LINEAGE_MANIFEST_SCHEMA_VERSION)
    return bindingFailure(
      'manifest-shape-invalid',
      `unsupported runtime lineage manifest version: ${String(manifest.schemaVersion)}`
    )
  if (manifest.targets.length !== observed.length)
    return bindingFailure(
      'target-count-mismatch',
      `manifest describes ${manifest.targets.length} targets but the seam exposed ${observed.length}`
    )
  const manifestStages = manifest.targets.filter((target) => target.isStage)
  if (manifestStages.length !== 1)
    return bindingFailure(
      'stage-shape-mismatch',
      `manifest describes ${manifestStages.length} stage targets`
    )
  const observedStages = observed.filter((target) => target.isStage)
  if (observedStages.length !== 1)
    return bindingFailure(
      'stage-shape-mismatch',
      `seam exposed ${observedStages.length} stage targets`
    )

  const manifestCandidates = manifest.targets.map((entry) =>
    sortedUnique([
      ...entry.blockIds.map(blockWitnessId),
      ...entry.declarations.map((declaration) =>
        declarationWitnessId(declaration.normalizedDeclarationId)
      ),
      ...entry.media.map((media) => mediaWitnessId(media.assetId)),
    ])
  )
  const manifestUnique = globallyUniqueWitnesses(manifestCandidates)
  const targetLineages = new Set<string>()
  for (let index = 0; index < manifest.targets.length; index++)
  {
    const entry = manifest.targets[index]!
    if (
      entry.targetLineage.length === 0 ||
      targetLineages.has(entry.targetLineage) ||
      entry.serializedTargetOrdinal !== index ||
      entry.declarations.some(
        (declaration) =>
          declaration.normalizedDeclarationId !==
          normalizeDeclarationId(declaration.rawDeclarationId)
      )
    )
      return bindingFailure(
        'manifest-shape-invalid',
        `manifest target ${entry.targetLineage || '<empty>'} has an invalid lineage or serialized ordinal`
      )
    targetLineages.add(entry.targetLineage)
    const expectedWitnessIds = manifestCandidates[index]!.filter((witness) =>
      manifestUnique.has(witness)
    )
    if (!sameSortedValues(entry.witnessIds, expectedWitnessIds))
      return bindingFailure(
        'manifest-shape-invalid',
        `manifest target ${entry.targetLineage} does not carry its exact globally unique witness set`,
        [entry.targetLineage]
      )
    if (entry.witnessIds.length === 0)
      return bindingFailure(
        'unwitnessed-target',
        `manifest target ${entry.targetLineage} has no globally unique loader-preserved witness`,
        [entry.targetLineage]
      )
  }

  const observedWitnesses = observed.map(
    (target) =>
      new Set([
        ...target.blockIds.map(blockWitnessId),
        ...target.declarationIds.map(declarationWitnessId),
        ...target.mediaAssetIds.map(mediaWitnessId),
      ])
  )
  const admittedBlockIds = observed.map((target) => new Set(target.blockIds))
  const observedByWitness = new Map<string, number[]>()
  for (let index = 0; index < observedWitnesses.length; index++)
    for (const witness of observedWitnesses[index]!)
    {
      const ordinals = observedByWitness.get(witness) ?? []
      ordinals.push(index)
      observedByWitness.set(witness, ordinals)
    }

  const observedOrdinalByLineage = new Map<string, number>()
  const lineageByObservedOrdinal = new Map<number, string>()
  const matchedWitnessesByLineage = new Map<string, readonly string[]>()
  for (const entry of manifest.targets)
  {
    const candidateOrdinals = new Set<number>()
    const matchedWitnessIds: string[] = []
    for (const witness of entry.witnessIds)
    {
      const ordinals = observedByWitness.get(witness) ?? []
      if (ordinals.length > 1)
        return bindingFailure(
          'ambiguous-witness',
          `globally unique witness ${witness} for ${entry.targetLineage} appeared on multiple seam targets`,
          [entry.targetLineage]
        )
      if (ordinals.length === 1)
      {
        candidateOrdinals.add(ordinals[0]!)
        matchedWitnessIds.push(witness)
      }
    }
    if (candidateOrdinals.size === 0)
      return bindingFailure(
        'unmatched-target',
        `no globally unique witness for ${entry.targetLineage} appeared at the seam`,
        [entry.targetLineage]
      )
    if (candidateOrdinals.size > 1)
      return bindingFailure(
        'ambiguous-witness',
        `globally unique witnesses for ${entry.targetLineage} resolved to different seam targets`,
        [entry.targetLineage]
      )
    const observedOrdinal = [...candidateOrdinals][0]!
    const conflictingLineage = lineageByObservedOrdinal.get(observedOrdinal)
    if (conflictingLineage !== undefined)
      return bindingFailure(
        'ambiguous-witness',
        `seam target ${observedOrdinal} carries unique witnesses for both ${conflictingLineage} and ${entry.targetLineage}`,
        [conflictingLineage, entry.targetLineage]
      )
    observedOrdinalByLineage.set(entry.targetLineage, observedOrdinal)
    lineageByObservedOrdinal.set(observedOrdinal, entry.targetLineage)
    matchedWitnessesByLineage.set(
      entry.targetLineage,
      Object.freeze(matchedWitnessIds)
    )
  }
  if (lineageByObservedOrdinal.size !== observed.length)
  {
    const unwitnessed = observed
      .map((target, index) => ({ target, index }))
      .filter(({ index }) => !lineageByObservedOrdinal.has(index))
      .map(({ target }) => `seam ordinal ${target.seamOrdinal}`)
    return bindingFailure(
      'unwitnessed-target',
      `the following seam targets have no globally unique manifest witness: ${unwitnessed.join(', ')}`
    )
  }

  const bound: RuntimeLineageBoundTargetV1[] = []
  for (const entry of manifest.targets)
  {
    const observedOrdinal = observedOrdinalByLineage.get(entry.targetLineage)!
    const target = observed[observedOrdinal]!
    if (
      target.seamOrdinal !== observedOrdinal ||
      entry.serializedTargetOrdinal !== target.seamOrdinal
    )
      return bindingFailure(
        'pane-order-mismatch',
        `witness-bound target ${entry.targetLineage} appeared at seam ordinal ${target.seamOrdinal}, expected serialized pane ordinal ${entry.serializedTargetOrdinal}`,
        [entry.targetLineage]
      )
    if (entry.isStage !== target.isStage)
      return bindingFailure(
        'stage-shape-mismatch',
        `witness-bound target ${entry.targetLineage} has stage=${target.isStage} but the admitted manifest expects stage=${entry.isStage}`,
        [entry.targetLineage]
      )
    // Scratch VM creates fresh shadow IDs for compact primitive inputs; require
    // every artifact-authored ID while allowing only that loader-owned superset
    if (
      !entry.blockIds.every((blockId) =>
        admittedBlockIds[observedOrdinal]!.has(blockId)
      )
    )
      return bindingFailure(
        'unmatched-target',
        `witness-bound target ${entry.targetLineage} is missing an admitted authored block ID`,
        [entry.targetLineage]
      )
    const expectedDeclarations = entry.declarations.map(
      (declaration) => declaration.normalizedDeclarationId
    )
    if (!sameSortedValues(expectedDeclarations, target.declarationIds))
      return bindingFailure(
        'declaration-normalization-mismatch',
        `witness-bound target ${entry.targetLineage} has a different normalized declaration-ID set`,
        [entry.targetLineage]
      )
    const expectedMedia = entry.media.map((media) => media.assetId)
    if (
      expectedMedia.length !== target.mediaAssetIds.length ||
      expectedMedia.some(
        (assetId, mediaIndex) => assetId !== target.mediaAssetIds[mediaIndex]
      )
    )
      return bindingFailure(
        'unmatched-target',
        `witness-bound target ${entry.targetLineage} has media ${JSON.stringify(target.mediaAssetIds)}, expected ${JSON.stringify(expectedMedia)}`,
        [entry.targetLineage]
      )
    bound.push(
      Object.freeze({
        targetLineage: entry.targetLineage,
        seamOrdinal: target.seamOrdinal,
        matchedWitnessIds: matchedWitnessesByLineage.get(entry.targetLineage)!,
      })
    )
  }
  return Object.freeze({
    status: 'bound' as const,
    targets: Object.freeze(bound),
    paneLineageOrder: Object.freeze(
      observed.map((_, index) => lineageByObservedOrdinal.get(index)!)
    ),
  })
}

// map post-install runtime.executableTargets back to lineage through the seam binding
export function executableLineageOrderV1(
  binding: Extract<RuntimeLineageBindingV1, { status: 'bound' }>,
  seamOrdinalsInExecutableOrder: readonly number[]
): readonly string[] | null
{
  const bySeamOrdinal = new Map(
    binding.targets.map((target) => [target.seamOrdinal, target.targetLineage])
  )
  const order: string[] = []
  for (const seamOrdinal of seamOrdinalsInExecutableOrder)
  {
    const lineage = bySeamOrdinal.get(seamOrdinal)
    if (lineage === undefined) return null
    order.push(lineage)
  }
  return Object.freeze(order)
}

export interface RuntimeLineageLoaderIdentityV1
{
  readonly laneId: string
  readonly loaderId: string
  readonly loaderVersion: string
  readonly seamId: string
  readonly declarationNormalizationId: string
}

// the honest result for a lane whose seam could not be verified; a required lane
// holding this blocks certification rather than reporting a fabricated success
export function unavailableRuntimeLineageAdapterResultV1(
  identity: RuntimeLineageLoaderIdentityV1,
  manifestSha256: string | null,
  unavailableReason: string
): RuntimeLineageAdapterResultV1
{
  return Object.freeze({
    schemaVersion: RUNTIME_LINEAGE_MANIFEST_SCHEMA_VERSION,
    laneId: identity.laneId,
    status: 'unavailable' as const,
    loaderId: identity.loaderId,
    loaderVersion: identity.loaderVersion,
    seamId: identity.seamId,
    declarationNormalizationId: identity.declarationNormalizationId,
    manifestSha256,
    seamObserved: false,
    verifiedTargetCount: 0,
    paneLineageOrder: Object.freeze([]),
    executableTargetLineageOrder: Object.freeze([]),
    expectedExecutableTargetLineageOrder: Object.freeze([]),
    boundTargets: Object.freeze([]),
    mismatch: null,
    unavailableReason,
  })
}

export function isUsableRuntimeLineageAdapterResultV1(
  result: RuntimeLineageAdapterResultV1
): boolean
{
  return result.status === 'bound' && result.mismatch === null
}
