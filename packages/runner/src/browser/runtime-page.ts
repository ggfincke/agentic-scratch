// packages/runner/src/browser/runtime-page.ts
// shared in-page scenario API for pinned TurboWarp & official Scratch runtimes

import type { SpikeApi } from './browser-api.js'
import { installDeterminism, type Determinism } from '../policy/determinism.js'
import { InputController } from '../scenario/input.js'
import { RUNNER_TICK_MS } from './browser-config.js'
import {
  readBoundedSnapshot,
  readCloneCountSample,
  readResolvedCloneCountSample,
  resolveRuntimeTargetIdentities,
  readSnapshot,
  type CloneCountRead,
} from '../observation/snapshot.js'
import {
  clampRuntimeObservationCaps,
  createRuntimeObservationBudget,
} from '../observation/observation.js'
import {
  captureRuntimeObservationV1,
  projectRuntimeObservationValueV1,
} from '../observation/runtime-observation.js'
import {
  unavailableRuntimeLineageAdapterResultV1,
  type RuntimeLineageAdapterResultV1,
  type RuntimeLineageLoaderIdentityV1,
  type RuntimeLineageManifestV1,
} from '../lineage/runtime-lineage.js'
import {
  buildRuntimeIdentityFacetV1,
  installRuntimeLineageSeamAdapter,
  unboundRuntimeLineageTargetIndexV1,
  type RuntimeLineageSeamHandle,
  type RuntimeLineageSeamVm,
} from '../lineage/runtime-lineage-vm.js'
import { IdentityBoundVmBinder } from '../scenario/identity-bound-vm.js'
import type {
  IdentityBoundBroadcastActionV1,
  IdentityBoundBroadcastDispatchV1,
  IdentityBoundBroadcastResolutionV1,
  IdentityBoundResolvedBroadcastV1,
  IdentityBoundTargetResolutionV1,
} from '../scenario/identity-bound-scenario.js'
import type { ScratchThread, ScratchVm } from '../vm/vm-api.js'
import type { RuntimeObservationBudgetV1 } from '../observation/observation.js'
import { readResolvedVisual, readVisual, type PageRenderer } from './visual.js'
import { canonicalJsonV1, sha256WebCryptoHex } from './semantic-hash.js'

// a manifest that cannot be fetched or parsed yields no adapter at all, so the
// lane reports unavailable rather than binding against unverified input
async function fetchLineageManifest(
  url: string
): Promise<RuntimeLineageManifestV1 | null>
{
  try
  {
    const response = await fetch(url)
    if (!response.ok) return null
    return (await response.json()) as RuntimeLineageManifestV1
  }
  catch
  {
    return null
  }
}

async function verifiedLineageManifest(
  manifest: RuntimeLineageManifestV1,
  artifactBytes: Uint8Array
): Promise<RuntimeLineageManifestV1 | null>
{
  try
  {
    const { manifestSha256, ...body } = manifest
    const bodySha256 = await sha256WebCryptoHex(
      new TextEncoder().encode(canonicalJsonV1(body))
    )
    const artifactSha256 = await sha256WebCryptoHex(artifactBytes)
    return bodySha256 === manifestSha256 &&
      artifactSha256 === manifest.artifactSha256
      ? manifest
      : null
  }
  catch
  {
    return null
  }
}

interface BrowserRuntimePageHost
{
  vm: ScratchVm
  renderer: PageRenderer
  loadProject(data: ArrayBuffer): Promise<void>
  stopFreeRunning(): void
  // each browser runtime names its own pinned loader seam; the official VM hook
  // is never assumed to cover the TurboWarp scaffolding build
  lineageIdentity: RuntimeLineageLoaderIdentityV1
}

export function installRuntimePage(host: BrowserRuntimePageHost): void
{
  const vm = host.vm
  const runtime = vm.runtime
  const input = new InputController(vm)
  let det: Determinism | undefined
  let activeBroadcastThreads: ScratchThread[] | null = null
  let seam: RuntimeLineageSeamHandle | null = null
  let lineageUnavailable: RuntimeLineageAdapterResultV1 | null = null
  let binder: IdentityBoundVmBinder | null = null
  let runtimeObservationBudget: RuntimeObservationBudgetV1 | null = null
  let boundManifest: RuntimeLineageManifestV1 | null = null

  // the in-page binder only exists once the seam bound cleanly; without it every
  // identity-bound action resolves inconclusive instead of falling back to a name
  function identityBinder(): IdentityBoundVmBinder
  {
    if (!binder)
      binder = new IdentityBoundVmBinder(
        runtime,
        seam ? seam.targetIndex() : unboundRuntimeLineageTargetIndexV1()
      )
    return binder
  }

  function draw(): void
  {
    host.renderer.draw()
  }

  async function tickOnce(): Promise<void>
  {
    runtime._step()
    if (det) det.flushTimers()
    await Promise.resolve()
  }

  const api: SpikeApi = {
    async load(url: string, lineageManifestUrl?: string | null): Promise<void>
    {
      const response = await fetch(url)
      if (!response.ok)
        throw new Error(`project fetch failed with status ${response.status}`)
      const bytes = await response.arrayBuffer()
      if (lineageManifestUrl)
      {
        const manifest = await fetchLineageManifest(lineageManifestUrl)
        const verified = manifest
          ? await verifiedLineageManifest(manifest, new Uint8Array(bytes))
          : null
        if (verified)
        {
          boundManifest = verified
          seam = installRuntimeLineageSeamAdapter(
            vm as unknown as RuntimeLineageSeamVm,
            verified,
            host.lineageIdentity
          )
        }
        else
          lineageUnavailable = unavailableRuntimeLineageAdapterResultV1(
            host.lineageIdentity,
            manifest?.manifestSha256 ?? null,
            manifest
              ? 'the lineage manifest hash or artifact binding did not verify'
              : 'the lineage manifest could not be fetched beside the project bytes'
          )
      }
      await host.loadProject(bytes)
    },
    lineage(): RuntimeLineageAdapterResultV1 | null
    {
      if (seam) return seam.result()
      return lineageUnavailable
    },
    runtimeIdentityFacet()
    {
      if (!seam || !boundManifest) return null
      return buildRuntimeIdentityFacetV1(
        runtime,
        boundManifest,
        seam.targetIndex()
      )
    },
    async prep(opts: { seed?: number; fixedDateMs?: number }): Promise<void>
    {
      host.stopFreeRunning()
      for (let index = 0; index < 3; index++)
      {
        draw()
        await new Promise<void>((done) => requestAnimationFrame(() => done()))
      }
      det = installDeterminism(runtime, {
        seed: opts.seed ?? 0,
        fixedDateMs: opts.fixedDateMs,
      })
      runtime.currentStepTime = RUNNER_TICK_MS
    },
    greenFlag(): void
    {
      vm.greenFlag()
    },
    async step(n: number): Promise<void>
    {
      for (let index = 0; index < n; index++) await tickOnce()
      draw()
    },
    pressKey(key: string): void
    {
      input.pressKey(key)
    },
    releaseKey(key: string): void
    {
      input.releaseKey(key)
    },
    moveMouse(x: number, y: number): void
    {
      input.moveMouse(x, y)
    },
    mouseDown(x: number, y: number): void
    {
      input.mouseDown(x, y)
    },
    mouseUp(x: number, y: number): void
    {
      input.mouseUp(x, y)
    },
    clickSprite(name: string): void
    {
      input.clickSprite(name)
    },
    clickStage(): void
    {
      input.clickStage()
    },
    broadcast(name: string): void
    {
      input.broadcast(name)
    },
    resolveTargetLineage(
      targetLineage: string
    ): IdentityBoundTargetResolutionV1
    {
      return identityBinder().resolveTargetLineage(targetLineage)
    },
    resolveBroadcastLineage(
      action: IdentityBoundBroadcastActionV1
    ): IdentityBoundBroadcastResolutionV1
    {
      return identityBinder().resolveBroadcast(action)
    },
    clickTargetLineage(targetLineage: string): void
    {
      identityBinder().clickResolvedTarget({
        status: 'resolved',
        targetLineage,
      })
    },
    broadcastLineage(
      resolved: IdentityBoundResolvedBroadcastV1
    ): IdentityBoundBroadcastDispatchV1
    {
      return identityBinder().startResolvedBroadcast(resolved).dispatch
    },
    beginBroadcastWaitLineage(
      resolved: IdentityBoundResolvedBroadcastV1
    ): IdentityBoundBroadcastDispatchV1
    {
      if (activeBroadcastThreads)
        throw new Error('a broadcastAndWait operation is already active')
      const started = identityBinder().startResolvedBroadcast(resolved)
      activeBroadcastThreads = [...started.threads]
      return started.dispatch
    },
    beginBroadcastWait(name: string): void
    {
      if (activeBroadcastThreads)
        throw new Error('a broadcastAndWait operation is already active')
      activeBroadcastThreads =
        runtime.startHats('event_whenbroadcastreceived', {
          BROADCAST_OPTION: name,
        }) ?? []
    },
    async continueBroadcastWait(
      limit: number
    ): Promise<{ used: number; running: boolean }>
    {
      if (!activeBroadcastThreads)
        throw new Error('no broadcastAndWait operation is active')
      const stillRunning = (): boolean =>
        activeBroadcastThreads!.some(
          (thread) => runtime.threads.indexOf(thread) !== -1
        )
      let used = 0
      while (used < limit && stillRunning())
      {
        await tickOnce()
        used++
      }
      draw()
      const running = stillRunning()
      if (!running) activeBroadcastThreads = null
      return { used, running }
    },
    answer(text: string): void
    {
      input.answer(text)
    },
    draw(): void
    {
      draw()
    },
    readState(label: string, tick: number)
    {
      const snapshot = readSnapshot(runtime, tick, label)
      return { ...snapshot, visual: readVisual(host.renderer, runtime) }
    },
    beginRuntimeObservation(caps, carriedAttemptTraceBytes = 0): void
    {
      runtimeObservationBudget = createRuntimeObservationBudget(
        clampRuntimeObservationCaps(caps),
        carriedAttemptTraceBytes
      )
    },
    readRuntimeObservation(
      label: string,
      tick: number,
      scenarioStepIndex: number,
      supplemental?: unknown
    )
    {
      if (runtimeObservationBudget === null)
        throw new Error('the runtime observation cell has not been initialized')
      const budget = runtimeObservationBudget
      let cloneRead: CloneCountRead | undefined
      const capture = captureRuntimeObservationV1(budget, () =>
      {
        const state = readBoundedSnapshot(runtime, budget, tick, label)
        const resolved = resolveRuntimeTargetIdentities(runtime)
        cloneRead = readResolvedCloneCountSample(
          resolved,
          tick,
          scenarioStepIndex,
          label
        )
        const cloneCounts = projectRuntimeObservationValueV1(
          cloneRead.sample,
          budget,
          'cloneCounts'
        )
        const visual = projectRuntimeObservationValueV1(
          readResolvedVisual(host.renderer, resolved),
          budget,
          'visual'
        )
        const projectedSupplemental =
          supplemental === undefined
            ? null
            : projectRuntimeObservationValueV1(
                supplemental,
                budget,
                'supplemental'
              )
        const observation = Object.freeze({
          state,
          cloneCounts,
          supplemental: projectedSupplemental,
          cloneIdentityIssues: Object.freeze([...cloneRead.issues]),
          visual,
        })
        budget.chargeTraceBytes(
          `observation/${tick}`,
          new TextEncoder().encode(JSON.stringify(observation)).byteLength
        )
        return observation
      })
      cloneRead ??= readCloneCountSample(
        runtime,
        tick,
        scenarioStepIndex,
        label
      )
      return { capture, cloneRead }
    },
    runtimeObservationTotals()
    {
      return runtimeObservationBudget?.totals() ?? null
    },
    readCloneCounts(
      tick: number,
      scenarioStepIndex: number,
      snapshotLabel: string | null
    )
    {
      return readCloneCountSample(
        runtime,
        tick,
        scenarioStepIndex,
        snapshotLabel
      )
    },
  }

  ;(window as unknown as { __spike: SpikeApi }).__spike = api
}
