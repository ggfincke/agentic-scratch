// packages/runner/src/policy/types.ts
// shared types for the execution lanes & the run report

import type { ScalarVal } from '@scratch-agent/sb3'

import type { RunIssue } from './issues.js'
import type { ObservationTraceV1, RendererGeometryV1 } from '../observation/observation.js'
import type { RuntimeDescriptorV1 } from '../lineage/runtime-identity.js'
import type { BrowserRuntimeObservationV1 } from '../browser/browser-api.js'
import type { RuntimeObservationRecordV1 } from '../observation/runtime-observation.js'
import type { RuntimeIdentityFacetV1 } from '../lineage/runtime-lineage.js'
import type { RuntimeLineageAdapterResultV1 } from '../lineage/runtime-lineage.js'
import type { IdentityBoundDriveResultV1 } from '../scenario/identity-bound-scenario.js'

export type ScalarValue = ScalarVal

export interface SpriteState
{
  x: number
  y: number
  direction: number
  costume: string
  visible: boolean
}

export interface StateSnapshot
{
  tick: number
  targets: Record<string, SpriteState>
  variables: Record<string, string | number | boolean>
}

export interface BubbleState
{
  text: string
  type: 'say' | 'think'
}

export interface StageState
{
  backdrop: string
  tempo: number
  videoState: string
}

// the richer per-target state the VM test lane captures for assertions
export interface VmSpriteState extends SpriteState
{
  id: string
  name: string
  isStage: boolean
  size: number
  rotationStyle: string
  draggable: boolean
  volume: number
  effects: Record<string, number>
  bubble: BubbleState | null
  variables: Record<string, ScalarValue>
  lists: Record<string, ScalarValue[]>
}

// a screen-space rectangle in canvas pixels (top-left origin)
export interface ScreenRect
{
  x: number
  y: number
  width: number
  height: number
}

// renderer-derived observation captured alongside a browser snapshot (absent in the vm lane)
export interface VisualObservation
{
  canvas: { width: number; height: number }
  // per visible original sprite (keyed by name): its screen rect, or null if hidden/undrawable
  spriteRects: Record<string, ScreenRect | null>
  // a downsampled mean-RGB grid of the stage (row-major, length gridCols*gridRows*3, 0..255)
  gridCols: number
  gridRows: number
  grid: number[]
  geometry: RendererGeometryV1
  identityIssues: string[]
}

// a deterministic VM snapshot; top-level variables/lists are the Stage globals
export interface VmStateSnapshot
{
  tick: number
  label?: string
  targetOrder: string[]
  targetsById: Record<string, VmSpriteState>
  stageTargetId: string
  targets: Record<string, VmSpriteState>
  variables: Record<string, ScalarValue>
  lists: Record<string, ScalarValue[]>
  answer: string
  timer: number
  stage: StageState
  // browser lane only: renderer-derived rects + downsampled frame for visual assertions
  visual?: VisualObservation
}

// a single observed frame: the post-step VM state plus the input context active that tick
export interface ObservedTick
{
  state: VmStateSnapshot
  // keys held during this tick (canonical scenario key names, lowercased)
  keysDown: readonly string[]
  // sprites clicked since the previous observed tick (drains each tick)
  clicked: readonly string[]
}

// a per-tick observer hooked into the run loop; model-based tests drive their FSM off these
export interface TickObserver
{
  onTick(tick: ObservedTick): void | Promise<void>
  // called once after the scenario completes (program end), for post-run oracle checks
  onEnd?(tick: ObservedTick): void | Promise<void>
}

export interface RuntimeLogCategorySummary
{
  code: string
  level: 'warning' | 'error' | 'other'
  disposition: 'expected-environment' | 'advisory' | 'failure'
  count: number
  samples: string[]
  uniqueValues?: number
}

export interface RuntimeLogSummary
{
  total: number
  categories: RuntimeLogCategorySummary[]
  droppedEvents: number
  truncatedBytes: number
}

export interface BrowserConsoleCategorySummary
{
  code: string
  level: string
  disposition: 'expected-environment' | 'advisory' | 'failure'
  count: number
  samples: string[]
}

export interface BrowserConsoleSummary
{
  total: number
  retainedEntries: number
  droppedEntries: number
  truncatedBytes: number
  categories: BrowserConsoleCategorySummary[]
}

// one driving action on the timeline; assertions are evaluated separately off the trace
export type Step =
  | { do: 'greenFlag' }
  | { do: 'wait'; ticks: number }
  | { do: 'keyDown'; key: string }
  | { do: 'keyUp'; key: string }
  | { do: 'tapKey'; key: string; ticks?: number }
  | { do: 'pressKey'; key: string }
  | { do: 'releaseKey'; key: string }
  | { do: 'clickSprite'; sprite: string }
  | { do: 'clickStage' }
  | { do: 'broadcast'; name: string }
  | { do: 'broadcastAndWait'; name: string; maxTicks?: number }
  | { do: 'moveMouse'; x: number; y: number }
  | { do: 'mouseDown'; x: number; y: number }
  | { do: 'mouseUp'; x: number; y: number }
  | { do: 'typeAnswer'; text: string }
  | { do: 'snapshot'; label: string }

function defineScenarioStepKinds<const Kinds extends readonly Step['do'][]>(
  kinds: Kinds & (Step['do'] extends Kinds[number] ? unknown : never)
): Kinds
{
  return kinds
}

export const SCENARIO_STEP_KINDS = defineScenarioStepKinds([
  'greenFlag',
  'wait',
  'keyDown',
  'keyUp',
  'tapKey',
  'pressKey',
  'releaseKey',
  'clickSprite',
  'clickStage',
  'broadcast',
  'broadcastAndWait',
  'moveMouse',
  'mouseDown',
  'mouseUp',
  'typeAnswer',
  'snapshot',
] as const)

// a deterministic run request: seed + an ordered timeline of steps
export interface Scenario
{
  seed?: number
  // fixed wall-clock epoch (ms) for sensing_current / days-since-2000
  fixedDateMs?: number
  // safety cap on total ticks the run may consume
  maxTicks?: number
  // default false: untrusted project execution cannot fetch external URLs
  allowNetwork?: boolean
  allowedOrigins?: readonly string[]
  steps: Step[]
}

// the result of driving a Scenario: the labeled snapshots its `snapshot` steps captured
export interface VmTrace
{
  ok: boolean
  runtime: string
  runtimeDescriptor: RuntimeDescriptorV1
  observations: ObservationTraceV1
  snapshots: VmStateSnapshot[]
  finalSnapshot: VmStateSnapshot | null
  errors: string[]
  issues: RunIssue[]
  runtimeLog: RuntimeLogSummary
}

// a stage screenshot captured at a `snapshot` step, keyed by label & tick
export interface ScreenshotRef
{
  label: string
  tick: number
  path: string
}

// the browser lane's trace: the same snapshot shape as the VM lane plus visual artifacts
export interface BrowserTrace
{
  ok: boolean
  runtime: string
  runtimeDescriptor: RuntimeDescriptorV1
  observations: ObservationTraceV1
  mediaRoot: string | null
  snapshots: VmStateSnapshot[]
  finalSnapshot: VmStateSnapshot | null
  screenshots: ScreenshotRef[]
  // path to the recorded run video, or null if not recorded; keep/discard is the caller's call
  video: string | null
  errors: string[]
  issues: RunIssue[]
  consoleLog: string[]
  consoleSummary: BrowserConsoleSummary
  // present only when the caller opted into the lineage facet
  lineage?: RuntimeLineageAdapterResultV1 | null
  // present only when an identity-bound timeline drove this run
  identityBoundDrive?: IdentityBoundDriveResultV1 | null
  // present only when the caller opts into bounded observations
  runtimeObservations?: readonly RuntimeObservationRecordV1<BrowserRuntimeObservationV1>[]
  // exact runtime IDs mapped from the verified deserialize-bound target objects
  runtimeIdentityFacet?: RuntimeIdentityFacetV1 | null
}

// a single VM/browser run request
export interface RunScenario
{
  greenFlag: boolean
  ticks: number
  // ticks at which to capture a state snapshot
  snapshots: number[]
  allowNetwork?: boolean
  allowedOrigins?: readonly string[]
}

interface LaneResult
{
  ok: boolean
  runtime: string
  snapshots: StateSnapshot[]
  errors: string[]
  // optional on legacy report values; live runner producers always populate it
  issues?: RunIssue[]
}

// the VM lane has no extra fields beyond the shared result shape
export type VmLaneResult = LaneResult

export interface BrowserLaneResult extends LaneResult
{
  screenshots: string[]
  consoleLog: string[]
}

export interface RunVersions
{
  node: string
  vm: string
  scaffolding: string
  parser: string
  jszip: string
  playwright: string
}

export interface RunReport
{
  runId: string
  createdAt: string
  ok: boolean
  artifact: {
    sb3Path: string
    sha256: string
    projectJsonBytes: number
    assetCount: number
  }
  versions: RunVersions
  validation: { ok: boolean; errors: string[] }
  vm: VmLaneResult | null
  browser: BrowserLaneResult | null
}
