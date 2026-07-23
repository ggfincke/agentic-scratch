// packages/model/src/checker.ts
// a TickObserver that drives program + end models in lockstep & collects their results

import type {
  ObservedTick,
  TickObserver,
  VmStateSnapshot,
} from '@scratch-agent/runner'

import { ModelInstance, type ContextFactory } from './machine.js'
import type { Model, ModelResult, ModelRunResult } from './types.js'

interface ModelCheckerOptions
{
  // seeds the Probability rng so a run is reproducible
  seed?: number
  // renderer collision hook (browser lane only) that SpriteTouching checks read
  touching?: (spriteA: string, spriteB: string) => boolean
}

// mulberry32: the same tiny prng the determinism layer uses, kept local to avoid a runtime dep
function mulberry32(seed: number): () => number
{
  let a = seed >>> 0
  return () =>
  {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export class ModelChecker implements TickObserver
{
  private readonly programInstances: ModelInstance[]
  private readonly endInstances: ModelInstance[]
  private prev: VmStateSnapshot | null = null
  private tick = 0
  private programEndTick: number | null = null
  private readonly random: () => number
  private readonly touching?: (spriteA: string, spriteB: string) => boolean

  constructor(
    models: { programModels: Model[]; endModels?: Model[] },
    opts: ModelCheckerOptions = {}
  )
  {
    this.programInstances = models.programModels.map(
      (m) => new ModelInstance(m, true)
    )
    this.endInstances = (models.endModels ?? []).map(
      (m) => new ModelInstance(m, false)
    )
    this.random = mulberry32(opts.seed ?? 0)
    this.touching = opts.touching
  }

  onTick(observed: ObservedTick): void
  {
    this.tick = observed.state.tick
    const makeCtx = this.contextFactory(observed)
    // step every model, then apply cross-model actions AFTER the loop: mutating a sibling
    // instance mid-iteration would make the outcome depend on array order (not lockstep)
    let stopAll = false
    let restart = false
    for (const inst of this.programInstances)
    {
      const signal = inst.step(makeCtx)
      if (signal === 'stop-all' || signal === 'stop-models') stopAll = true
      else if (signal === 'restart') restart = true
    }
    if (stopAll) for (const inst of this.programInstances) inst.stop()
    else if (restart)
      for (const inst of this.programInstances) inst.reset(this.tick)
    this.prev = observed.state
  }

  onEnd(observed: ObservedTick): void
  {
    this.tick = observed.state.tick
    this.programEndTick = observed.state.tick
    const makeCtx = this.contextFactory(observed)
    // flush program-model effects still inside their 2-step window: the run ended before they
    // could be rechecked, so evaluate them once more rather than silently dropping a failure
    for (const inst of this.programInstances) inst.finalize(makeCtx)
    // end models assert against the frozen final state; drive each to a fixed point
    for (const inst of this.endInstances)
    {
      let guard = 0
      while (!inst.stopped && guard++ < 10000)
      {
        const before = inst.currentNodeId
        inst.step(makeCtx)
        if (inst.currentNodeId === before) break
      }
    }
  }

  private contextFactory(observed: ObservedTick): ContextFactory
  {
    return (inst) => ({
      state: observed.state,
      prev: this.prev,
      keysDown: observed.keysDown,
      clicked: observed.clicked,
      storage: inst.storageRef(),
      ticksSinceTransition: observed.state.tick - inst.lastTransitionTick,
      tick: observed.state.tick,
      programEndTick: this.programEndTick,
      random: this.random,
      touching: this.touching,
    })
  }

  private toResult(inst: ModelInstance): ModelResult
  {
    return {
      modelId: inst.model.id,
      usage: inst.model.usage,
      ok: inst.failures.length === 0,
      finalNode: inst.currentNodeId,
      reachedStop: inst.reachedStop(),
      coverage: inst.coverage(),
      failures: [...inst.failures],
    }
  }

  // aggregate the run; a model run is ok only if every model recorded no failed effect
  results(): ModelRunResult
  {
    const instances = [...this.programInstances, ...this.endInstances]
    const models = instances.map((inst) => this.toResult(inst))
    const warnings = instances.flatMap((inst) => inst.warnings)
    return {
      ok: models.every((m) => m.ok),
      models,
      warnings,
    }
  }
}
