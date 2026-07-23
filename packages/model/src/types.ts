// packages/model/src/types.ts
// loaded model shapes, the per-tick check context & model-run result types

import type { ScalarValue, VmStateSnapshot } from '@scratch-agent/runner'

// our lanes advance the virtual clock one currentStepTime (== 1000/60) per _step; the model
// converts the JSON's millisecond timings to ticks against THIS clock, not Whisker's 30 TPS
export const MS_PER_TICK = 1000 / 60

type ModelUsage = 'program' | 'end' | 'user'

export type CheckArg = string | number | boolean

// a condition/effect check: {name, negated, args[]} evaluated against a CheckContext
export interface Check
{
  name: string
  negated: boolean
  args: CheckArg[]
}

// a user-model input (applied to the program); no negation
export interface UserInput
{
  name: string
  args: CheckArg[]
}

export interface ModelEdge
{
  id: string
  label: string
  from: string
  to: string
  // -1 when off; otherwise ticks (converted from the JSON's ms) to force a condition check
  forceTestAtTicks: number
  forceTestAfterTicks: number
  conditions: Check[]
  // program/end models: post-transition assertions & storage/control ops
  effects: Check[]
  // user models: inputs applied when the edge is taken
  inputs: UserInput[]
}

export interface ModelNode
{
  id: string
  label: string
  // outgoing edges in authored order; first whose conditions all pass wins
  outgoing: ModelEdge[]
  // a node w/ no outgoing edges halts its model
  isStop: boolean
}

export interface Model
{
  id: string
  usage: ModelUsage
  startNodeId: string
  stopAllNodeIds: ReadonlySet<string>
  nodes: Map<string, ModelNode>
  edges: ModelEdge[]
  initialStorage: Record<string, ScalarValue>
  // program-only start trigger (GreenFlag by default); carried for fidelity
  startTrigger: string
  // user-only run bound in ticks, else null
  maxDurationTicks: number | null
}

// the three model roles a model file loads into
export interface LoadedModels
{
  programModels: Model[]
  endModels: Model[]
  userModels: Model[]
}

// everything a single check needs to decide true/false at one tick
export interface CheckContext
{
  state: VmStateSnapshot
  // the previous observed state, for *Change checks; null on the first tick
  prev: VmStateSnapshot | null
  keysDown: readonly string[]
  clicked: readonly string[]
  // model-local storage (guard memory); SetStorage/ChangeStorageBy mutate it
  storage: Record<string, ScalarValue>
  ticksSinceTransition: number
  tick: number
  programEndTick: number | null
  // seeded rng for Probability checks (deterministic per run)
  random: () => number
  // renderer-backed collision, present only on the browser lane; SpriteTouching needs it
  touching?: (spriteA: string, spriteB: string) => boolean
}

export interface ModelFailure
{
  modelId: string
  edgeId: string
  edgeLabel: string
  checkName: string
  checkArgs: CheckArg[]
  checkNegated: boolean
  phase: 'effect'
  // the failed effect, rendered for the report
  check: string
  tick: number
  // sprite the failed check addresses, for failure localization
  sprite: string | null
  message: string
}

// edge ids exercised vs authored, the model-test analog of Whisker trace attributes
export interface EdgeCoverage
{
  covered: string[]
  total: string[]
}

export interface ModelResult
{
  modelId: string
  usage: ModelUsage
  ok: boolean
  finalNode: string
  reachedStop: boolean
  coverage: EdgeCoverage
  failures: ModelFailure[]
}

export interface ModelRunResult
{
  ok: boolean
  models: ModelResult[]
  // non-fatal authoring diagnostics (e.g. multiple simultaneously-passing edges)
  warnings: string[]
}
