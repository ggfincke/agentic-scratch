// packages/runner/src/browser/browser-api.ts
// the in-page __spike primitive surface, shared by page-entry (in-page) & browser-lane (driver)

import type { VmStateSnapshot } from '../policy/types.js'
import type {
  CloneCountRead,
  ObservedRuntimeExecutionObservationV1,
} from '../observation/snapshot.js'
import type {
  RuntimeObservationCapsV1,
  RuntimeObservationBudgetTotalsV1,
} from '../observation/observation.js'
import type {
  ObservedRuntimeValueV1,
  RuntimeObservationCaptureV1,
} from '../observation/runtime-observation.js'
import type {
  RuntimeIdentityFacetV1,
  RuntimeLineageAdapterResultV1,
} from '../lineage/runtime-lineage.js'
import type {
  IdentityBoundBroadcastActionV1,
  IdentityBoundBroadcastDispatchV1,
  IdentityBoundBroadcastResolutionV1,
  IdentityBoundResolvedBroadcastV1,
  IdentityBoundTargetResolutionV1,
} from '../scenario/identity-bound-scenario.js'

// frame-exact primitives the browser engine round-trips to via page.evaluate
export interface SpikeApi
{
  // the lineage manifest travels beside the project bytes on the same routed
  // origin; the page binds it at its own loader seam before installTargets runs
  load(url: string, lineageManifestUrl?: string | null): Promise<void>
  lineage(): RuntimeLineageAdapterResultV1 | null
  runtimeIdentityFacet(): RuntimeIdentityFacetV1 | null
  // stop scaffolding's loop, warm up rendering, install determinism edges
  prep(opts: { seed?: number; fixedDateMs?: number }): Promise<void>
  greenFlag(): void
  step(n: number): Promise<void>
  pressKey(key: string): void
  releaseKey(key: string): void
  moveMouse(x: number, y: number): void
  mouseDown(x: number, y: number): void
  mouseUp(x: number, y: number): void
  clickSprite(name: string): void
  clickStage(): void
  broadcast(name: string): void
  beginBroadcastWait(name: string): void
  // identity-bound half: resolve against the in-page seam lineage index, then
  // drive the exact bound target object rather than a display name
  resolveTargetLineage(targetLineage: string): IdentityBoundTargetResolutionV1
  resolveBroadcastLineage(
    action: IdentityBoundBroadcastActionV1
  ): IdentityBoundBroadcastResolutionV1
  clickTargetLineage(targetLineage: string): void
  broadcastLineage(
    resolved: IdentityBoundResolvedBroadcastV1
  ): IdentityBoundBroadcastDispatchV1
  beginBroadcastWaitLineage(
    resolved: IdentityBoundResolvedBroadcastV1
  ): IdentityBoundBroadcastDispatchV1
  // advance active receivers by at most `limit` so the host can stop at observation ticks
  continueBroadcastWait(
    limit: number
  ): Promise<{ used: number; running: boolean }>
  answer(text: string): void
  draw(): void
  readState(label: string, tick: number): VmStateSnapshot
  // opt-in projection; begin installs one permanently poisonable cell
  // budget, then every scalar is tagged in-page before browser serialization
  beginRuntimeObservation(
    caps: RuntimeObservationCapsV1,
    carriedAttemptTraceBytes?: number
  ): void
  readRuntimeObservation(
    label: string,
    tick: number,
    scenarioStepIndex: number,
    supplemental?: unknown
  ): BrowserRuntimeObservationReadV1
  runtimeObservationTotals(): RuntimeObservationBudgetTotalsV1 | null
  readCloneCounts(
    tick: number,
    scenarioStepIndex: number,
    snapshotLabel: string | null
  ): CloneCountRead
}

export interface BrowserRuntimeObservationReadV1
{
  readonly capture: RuntimeObservationCaptureV1<BrowserRuntimeObservationV1>
  readonly cloneRead: CloneCountRead
}

export interface BrowserRuntimeObservationV1
{
  readonly state: ObservedRuntimeExecutionObservationV1['state']
  readonly cloneCounts: ObservedRuntimeExecutionObservationV1['cloneCounts']
  readonly supplemental: ObservedRuntimeExecutionObservationV1['supplemental']
  readonly cloneIdentityIssues: ObservedRuntimeExecutionObservationV1['cloneIdentityIssues']
  readonly visual: ObservedRuntimeValueV1
}
