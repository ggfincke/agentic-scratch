// packages/runner/src/lineage/runtime-lineage-vm.ts
// bind a runtime lineage manifest at the pinned deserialize-before-install VM seam

import {
  RUNTIME_LINEAGE_MANIFEST_SCHEMA_VERSION,
  bindRuntimeLineageV1,
  executableLineageOrderV1,
  isUsableRuntimeLineageAdapterResultV1,
  unavailableRuntimeLineageAdapterResultV1,
  type RuntimeLineageAdapterResultV1,
  type RuntimeLineageBindingV1,
  type RuntimeLineageLoaderIdentityV1,
  type RuntimeLineageManifestV1,
  type RuntimeLineageObservedTargetV1,
  type RuntimeIdentityFacetV1,
  type RuntimeIdentityTargetFacetV1,
} from './runtime-lineage.js'
import {
  resolveRuntimeTargetIdentities,
  stableObservationTargetId,
  type RuntimeTargetIdentity,
} from '../observation/snapshot.js'
import type { ScratchRuntime, ScratchTarget } from '../vm/vm-api.js'

// the structural slice of a deserialized target the seam exposes; deliberately
// separate from ScratchVm so the driven surface in vm-api.ts stays unchanged
interface RuntimeLineageSeamTarget
{
  isStage?: boolean
  layerOrder?: number
  blocks?: { _blocks?: Record<string, unknown>; _scripts?: readonly string[] }
  variables?: Record<string, unknown>
  sprite?: {
    costumes?: readonly { assetId?: string }[]
    sounds?: readonly { assetId?: string }[]
  }
}

interface RuntimeLineageSeamRuntime
{
  executableTargets?: readonly RuntimeLineageSeamTarget[]
}

export interface RuntimeLineageSeamVm
{
  runtime: RuntimeLineageSeamRuntime
  installTargets?: (
    targets: RuntimeLineageSeamTarget[],
    extensions: unknown,
    wholeProject: boolean
  ) => Promise<unknown>
}

// lineage -> the exact target object the seam bound, so a click can invoke that
// object directly instead of looking a display name up after install
export interface RuntimeLineageTargetIndexV1
{
  readonly status: 'bound' | 'unbound'
  readonly lineages: readonly string[]
  resolve(targetLineage: string): RuntimeLineageSeamTarget | null
}

export interface RuntimeLineageSeamHandle
{
  result(): RuntimeLineageAdapterResultV1
  targetIndex(): RuntimeLineageTargetIndexV1
  release(): void
}

const UNBOUND_TARGET_INDEX: RuntimeLineageTargetIndexV1 = Object.freeze({
  status: 'unbound' as const,
  lineages: Object.freeze([]),
  resolve: () => null,
})

export function unboundRuntimeLineageTargetIndexV1(): RuntimeLineageTargetIndexV1
{
  return UNBOUND_TARGET_INDEX
}

function inconclusiveRuntimeIdentityFacetV1(
  manifestSha256: string,
  reason: string
): RuntimeIdentityFacetV1
{
  return Object.freeze({
    schemaVersion: 1 as const,
    status: 'inconclusive' as const,
    manifestSha256,
    targets: Object.freeze([]) as readonly [],
    reason,
  })
}

export function buildRuntimeIdentityFacetV1(
  runtime: ScratchRuntime,
  manifest: RuntimeLineageManifestV1,
  index: RuntimeLineageTargetIndexV1
): RuntimeIdentityFacetV1
{
  if (index.status !== 'bound')
    return inconclusiveRuntimeIdentityFacetV1(
      manifest.manifestSha256,
      'the loader seam did not produce one exact target binding'
    )
  const identities = resolveRuntimeTargetIdentities(runtime)
  if (identities.issues.length > 0)
    return inconclusiveRuntimeIdentityFacetV1(
      manifest.manifestSha256,
      identities.issues.join('; ')
    )
  const targets: RuntimeIdentityTargetFacetV1[] = []
  const originalIdentityByTarget = new Map<
    ScratchTarget,
    RuntimeTargetIdentity
  >()
  for (const identity of identities.targets)
    if (
      identity.instance === 'original' &&
      !originalIdentityByTarget.has(identity.target)
    )
      originalIdentityByTarget.set(identity.target, identity)
  const originalSpriteOrdinalByTarget = new Map<ScratchTarget, number>()
  let originalSpriteOrdinal = 0
  for (const target of runtime.targets)
  {
    if (!target.isOriginal || target.isStage) continue
    originalSpriteOrdinal += 1
    if (!originalSpriteOrdinalByTarget.has(target))
      originalSpriteOrdinalByTarget.set(target, originalSpriteOrdinal)
  }
  for (const manifestTarget of manifest.targets)
  {
    const runtimeTarget = index.resolve(
      manifestTarget.targetLineage
    ) as ScratchTarget | null
    if (runtimeTarget === null || typeof runtimeTarget.id !== 'string')
      return inconclusiveRuntimeIdentityFacetV1(
        manifest.manifestSha256,
        `target ${manifestTarget.targetLineage} has no exact runtime object or string ID`
      )
    const runtimeIdentity = originalIdentityByTarget.get(runtimeTarget)
    if (runtimeIdentity === undefined)
      return inconclusiveRuntimeIdentityFacetV1(
        manifest.manifestSha256,
        `target ${manifestTarget.targetLineage} has no exact authored-original identity`
      )
    const declarations = []
    for (const declaration of manifestTarget.declarations)
    {
      if (!(declaration.normalizedDeclarationId in runtimeTarget.variables))
        return Object.freeze({
          schemaVersion: 1 as const,
          status: 'inconclusive' as const,
          manifestSha256: manifest.manifestSha256,
          targets: Object.freeze([]) as readonly [],
          reason: `declaration ${declaration.declarationLineage} is absent from its exact runtime target`,
        })
      declarations.push(
        Object.freeze({
          declarationLineage: declaration.declarationLineage,
          rawDeclarationId: declaration.rawDeclarationId,
          normalizedDeclarationId: declaration.normalizedDeclarationId,
          runtimeDeclarationId: declaration.normalizedDeclarationId,
          runtimeName:
            runtimeTarget.variables[declaration.normalizedDeclarationId]!.name,
          collection:
            runtimeTarget.variables[declaration.normalizedDeclarationId]!
              .type === 'list'
              ? ('lists' as const)
              : runtimeTarget.variables[declaration.normalizedDeclarationId]!
                    .type === 'broadcast_msg'
                ? ('broadcasts' as const)
                : ('variables' as const),
        })
      )
    }
    targets.push(
      Object.freeze({
        targetLineage: manifestTarget.targetLineage,
        runtimeTargetId: runtimeIdentity.originalTargetId,
        observationTargetId: stableObservationTargetId(
          runtimeTarget,
          runtimeTarget.isStage
            ? 0
            : (originalSpriteOrdinalByTarget.get(runtimeTarget) ?? 0)
        ),
        runtimeTargetName: runtimeTarget.getName(),
        cloneCountTargetId: runtimeIdentity.originalTargetId,
        geometryOriginalTargetId: runtimeIdentity.originalTargetId,
        isStage: manifestTarget.isStage,
        declarations: Object.freeze(declarations),
        media: Object.freeze(
          manifestTarget.media.flatMap((media) =>
          {
            if (media.mediaKind !== 'costume') return []
            const costume = runtimeTarget.getCostumes()[media.mediaOrder]
            if (costume === undefined) return []
            return [
              Object.freeze({
                ...media,
                runtimeName: costume.name,
                mediaIndex: media.mediaOrder,
              }),
            ]
          })
        ),
      })
    )
  }
  return Object.freeze({
    schemaVersion: 1 as const,
    status: 'bound' as const,
    manifestSha256: manifest.manifestSha256,
    targets: Object.freeze(targets),
  })
}

const OFFICIAL_HEADLESS_LINEAGE_IDENTITY: RuntimeLineageLoaderIdentityV1 =
  Object.freeze({
    laneId: 'official-headless',
    loaderId: '@scratch/scratch-vm/serialization/sb3.deserialize',
    loaderVersion: '14.1.0',
    seamId: 'VirtualMachine.installTargets(wholeProject)',
    declarationNormalizationId: 'replaceUnsafeCharsInVariableIds@sb3',
  })

function assetIds(target: RuntimeLineageSeamTarget): readonly string[]
{
  const costumes = target.sprite?.costumes ?? []
  const sounds = target.sprite?.sounds ?? []
  const ids: string[] = []
  for (const media of [...costumes, ...sounds])
    if (typeof media.assetId === 'string') ids.push(media.assetId)
  return ids
}

// read one seam target's loader-preserved identities; no display name is touched
function readSeamTarget(
  target: RuntimeLineageSeamTarget,
  seamOrdinal: number
): RuntimeLineageObservedTargetV1
{
  return {
    isStage: target.isStage === true,
    seamOrdinal,
    layerOrder:
      typeof target.layerOrder === 'number' ? target.layerOrder : null,
    blockIds: Object.freeze(Object.keys(target.blocks?._blocks ?? {})),
    declarationIds: Object.freeze(Object.keys(target.variables ?? {})),
    mediaAssetIds: Object.freeze(assetIds(target)),
  }
}

interface SeamCapture
{
  observed: readonly RuntimeLineageObservedTargetV1[]
  seamTargets: readonly RuntimeLineageSeamTarget[]
}

function boundResult(
  identity: RuntimeLineageLoaderIdentityV1,
  manifest: RuntimeLineageManifestV1,
  binding: RuntimeLineageBindingV1,
  capture: SeamCapture | null,
  executableSeamOrdinals: readonly number[] | null,
  invocations: number
): RuntimeLineageAdapterResultV1
{
  if (!capture)
    return unavailableRuntimeLineageAdapterResultV1(
      identity,
      manifest.manifestSha256,
      'the pinned deserialize-before-install seam never ran'
    )
  if (invocations !== 1)
    return unavailableRuntimeLineageAdapterResultV1(
      identity,
      manifest.manifestSha256,
      `the whole-project seam ran ${invocations} times; exactly one load is required`
    )
  if (binding.status !== 'bound')
    return Object.freeze({
      schemaVersion: RUNTIME_LINEAGE_MANIFEST_SCHEMA_VERSION,
      laneId: identity.laneId,
      status: 'inconclusive' as const,
      loaderId: identity.loaderId,
      loaderVersion: identity.loaderVersion,
      seamId: identity.seamId,
      declarationNormalizationId: identity.declarationNormalizationId,
      manifestSha256: manifest.manifestSha256,
      seamObserved: true,
      verifiedTargetCount: capture.observed.length,
      paneLineageOrder: Object.freeze([]),
      executableTargetLineageOrder: Object.freeze([]),
      expectedExecutableTargetLineageOrder:
        manifest.executableTargetLineageOrder,
      boundTargets: Object.freeze([]),
      mismatch: `${binding.reason}: ${binding.detail}`,
      unavailableReason: null,
    })

  const executableOrder =
    executableSeamOrdinals === null
      ? null
      : executableLineageOrderV1(binding, executableSeamOrdinals)
  const expected = manifest.executableTargetLineageOrder
  const mismatch =
    executableOrder === null
      ? 'post-install runtime.executableTargets could not be mapped back to seam targets'
      : executableOrder.length !== expected.length ||
          executableOrder.some((lineage, index) => lineage !== expected[index])
        ? `executable target order ${JSON.stringify(executableOrder)} differs from the manifest prediction ${JSON.stringify(expected)}`
        : null
  return Object.freeze({
    schemaVersion: RUNTIME_LINEAGE_MANIFEST_SCHEMA_VERSION,
    laneId: identity.laneId,
    status: mismatch === null ? ('bound' as const) : ('inconclusive' as const),
    loaderId: identity.loaderId,
    loaderVersion: identity.loaderVersion,
    seamId: identity.seamId,
    declarationNormalizationId: identity.declarationNormalizationId,
    manifestSha256: manifest.manifestSha256,
    seamObserved: true,
    verifiedTargetCount: capture.observed.length,
    paneLineageOrder: binding.paneLineageOrder,
    executableTargetLineageOrder: Object.freeze([...(executableOrder ?? [])]),
    expectedExecutableTargetLineageOrder: expected,
    boundTargets: binding.targets,
    mismatch,
    unavailableReason: null,
  })
}

// shadow the instance's own installTargets so the adapter sees the exact
// deserialize output before runtime.addTarget runs, then delegates unchanged;
// layerOrder still exists at entry, so both orders are captured separately
export function installRuntimeLineageSeamAdapter(
  vm: RuntimeLineageSeamVm,
  manifest: RuntimeLineageManifestV1,
  identity: RuntimeLineageLoaderIdentityV1 = OFFICIAL_HEADLESS_LINEAGE_IDENTITY
): RuntimeLineageSeamHandle
{
  const original = vm.installTargets
  if (typeof original !== 'function')
  {
    const reason =
      'the pinned loader exposes no installTargets seam on the VM instance'
    return {
      result: () =>
        unavailableRuntimeLineageAdapterResultV1(
          identity,
          manifest.manifestSha256,
          reason
        ),
      targetIndex: () => UNBOUND_TARGET_INDEX,
      release: () =>
      {},
    }
  }

  let capture: SeamCapture | null = null
  let binding: RuntimeLineageBindingV1 | null = null
  let executableSeamOrdinals: readonly number[] | null = null
  let invocations = 0
  let released = false

  const hook = async (
    targets: RuntimeLineageSeamTarget[],
    extensions: unknown,
    wholeProject: boolean
  ): Promise<unknown> =>
  {
    if (!wholeProject)
      return original.call(vm, targets, extensions, wholeProject)
    invocations += 1
    const live = targets.filter((target) => !!target)
    const observed = live.map((target, index) => readSeamTarget(target, index))
    capture = { observed, seamTargets: Object.freeze([...live]) }
    binding = bindRuntimeLineageV1(manifest, observed)
    const outcome = await original.call(vm, targets, extensions, wholeProject)
    const executable = vm.runtime.executableTargets
    executableSeamOrdinals = Array.isArray(executable)
      ? Object.freeze(executable.map((target) => live.indexOf(target)))
      : null
    return outcome
  }

  vm.installTargets = hook
  return {
    result(): RuntimeLineageAdapterResultV1
    {
      if (binding === null)
        return unavailableRuntimeLineageAdapterResultV1(
          identity,
          manifest.manifestSha256,
          'the pinned deserialize-before-install seam never ran'
        )
      return boundResult(
        identity,
        manifest,
        binding,
        capture,
        executableSeamOrdinals,
        invocations
      )
    },
    // only a clean bound result may hand out target objects; an inconclusive or
    // unavailable seam yields nothing to click rather than a best guess
    targetIndex(): RuntimeLineageTargetIndexV1
    {
      const held = capture as SeamCapture | null
      if (!held || binding === null || binding.status !== 'bound')
        return UNBOUND_TARGET_INDEX
      if (!isUsableRuntimeLineageAdapterResultV1(this.result()))
        return UNBOUND_TARGET_INDEX
      const byLineage = new Map<string, RuntimeLineageSeamTarget>()
      for (const target of binding.targets)
      {
        const seamTarget = held.seamTargets[target.seamOrdinal]
        if (seamTarget) byLineage.set(target.targetLineage, seamTarget)
      }
      return Object.freeze({
        status: 'bound' as const,
        lineages: Object.freeze([...byLineage.keys()].sort()),
        resolve: (targetLineage: string) =>
          byLineage.get(targetLineage) ?? null,
      })
    },
    release(): void
    {
      if (released) return
      released = true
      // only restore what we installed; a later wrapper keeps ownership
      if (vm.installTargets === hook) vm.installTargets = original
    },
  }
}
