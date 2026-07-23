// packages/model/src/machine.ts
// one running model: first-matching-edge transitions, effect assertions & the 2-step window

import type { ScalarValue } from '@scratch-agent/runner'

import {
  applyStorageEffect,
  CONTROL_EFFECTS,
  describeCheck,
  evaluateCheck,
  STORAGE_EFFECTS,
  checkSprite,
} from './checks.js'
import type {
  Check,
  CheckContext,
  EdgeCoverage,
  Model,
  ModelEdge,
  ModelFailure,
} from './types.js'

// a control effect bubbled up to the checker, which owns cross-model actions
type ControlSignal = 'stop-all' | 'stop-models' | 'restart'

// build a fresh CheckContext for a given instance (the checker fills in tick/state/input)
export type ContextFactory = (inst: ModelInstance) => CheckContext

interface PendingEffect
{
  effect: Check
  sinceTick: number
  edgeId: string
  edgeLabel: string
}

export class ModelInstance
{
  currentNodeId: string
  lastTransitionTick = 0
  stopped = false
  readonly failures: ModelFailure[] = []
  readonly warnings: string[] = []
  private storage: Record<string, ScalarValue>
  private readonly coveredEdges = new Set<string>()
  // pure effects awaiting their second-step recheck (empty when effects check immediately)
  private pending: PendingEffect[] = []

  constructor(
    readonly model: Model,
    // program models defer effect checks one tick; end models check on the frozen final state
    private readonly deferEffects: boolean
  )
  {
    this.currentNodeId = model.startNodeId
    this.storage = { ...model.initialStorage }
  }

  storageRef(): Record<string, ScalarValue>
  {
    return this.storage
  }

  stop(): void
  {
    this.stopped = true
  }

  reset(tick: number): void
  {
    this.currentNodeId = this.model.startNodeId
    this.storage = { ...this.model.initialStorage }
    this.lastTransitionTick = tick
    this.stopped = false
    this.pending = []
  }

  // one lockstep observation: recheck deferred effects, then take at most one transition.
  // recheck runs even once stopped so an effect deferred on the terminal edge still completes
  // its 2-step window; without it a failing terminal-edge assertion is silently dropped
  step(makeCtx: ContextFactory): ControlSignal | null
  {
    this.recheckPending(makeCtx)
    if (this.stopped) return null

    const node = this.model.nodes.get(this.currentNodeId)!
    if (node.isStop)
    {
      this.stopped = true
      return null
    }

    const ctx = makeCtx(this)
    const passing = node.outgoing.filter((e) =>
      e.conditions.every((c) => evaluateCheck(c, ctx))
    )
    if (passing.length === 0) return null
    if (passing.length > 1)
    {
      const ids = passing.map((e) => e.id).join(', ')
      this.warnings.push(
        `model "${this.model.id}" node "${node.id}": ${passing.length} edges pass at once ([${ids}]); taking "${passing[0]!.id}"`
      )
    }
    return this.takeEdge(passing[0]!, ctx)
  }

  private takeEdge(edge: ModelEdge, ctx: CheckContext): ControlSignal | null
  {
    this.coveredEdges.add(edge.id)
    this.currentNodeId = edge.to
    this.lastTransitionTick = ctx.tick

    let signal: ControlSignal | null = null
    for (const effect of edge.effects)
    {
      if (CONTROL_EFFECTS.has(effect.name))
      {
        signal = effect.name === 'StopModels' ? 'stop-models' : 'restart'
      }
      else if (STORAGE_EFFECTS.has(effect.name))
      {
        applyStorageEffect(effect, this.storage)
      }
      else if (!evaluateCheck(effect, ctx))
      {
        if (this.deferEffects)
        {
          this.pending.push({
            effect,
            sinceTick: ctx.tick,
            edgeId: edge.id,
            edgeLabel: edge.label,
          })
        }
        else
        {
          this.recordFailure(effect, edge.id, edge.label, ctx.tick)
        }
      }
    }

    const toNode = this.model.nodes.get(edge.to)!
    if (toNode.isStop) this.stopped = true
    if (this.model.stopAllNodeIds.has(edge.to))
    {
      this.stopped = true
      signal = signal ?? 'stop-all'
    }
    return signal
  }

  // give each queued effect one more tick; fail it only after the 2-step window elapses
  private recheckPending(makeCtx: ContextFactory): void
  {
    if (this.pending.length === 0) return
    const ctx = makeCtx(this)
    const stillPending: PendingEffect[] = []
    for (const p of this.pending)
    {
      if (evaluateCheck(p.effect, ctx)) continue
      if (ctx.tick - p.sinceTick >= 1)
      {
        this.recordFailure(p.effect, p.edgeId, p.edgeLabel, ctx.tick)
      }
      else
      {
        stillPending.push(p)
      }
    }
    this.pending = stillPending
  }

  // last-chance flush at run end: an effect still queued never got its second step (the run
  // ended, or the model stopped on the final tick), so give it one final evaluation & fail it
  // if it still does not hold -- prefer a false alarm over silently passing a broken program
  finalize(makeCtx: ContextFactory): void
  {
    if (this.pending.length === 0) return
    const ctx = makeCtx(this)
    for (const p of this.pending)
    {
      if (!evaluateCheck(p.effect, ctx))
      {
        this.recordFailure(p.effect, p.edgeId, p.edgeLabel, ctx.tick)
      }
    }
    this.pending = []
  }

  private recordFailure(
    effect: Check,
    edgeId: string,
    edgeLabel: string,
    tick: number
  ): void
  {
    const sprite = checkSprite(effect)
    this.failures.push({
      modelId: this.model.id,
      edgeId,
      edgeLabel,
      checkName: effect.name,
      checkArgs: [...effect.args],
      checkNegated: effect.negated,
      phase: 'effect',
      check: describeCheck(effect),
      tick,
      sprite,
      message: `effect ${describeCheck(effect)} did not hold within 2 steps of edge "${edgeLabel || edgeId}"`,
    })
  }

  coverage(): EdgeCoverage
  {
    return {
      covered: [...this.coveredEdges],
      total: this.model.edges.map((e) => e.id),
    }
  }

  reachedStop(): boolean
  {
    return this.model.nodes.get(this.currentNodeId)!.isStop
  }
}
