// packages/static/src/fragility/closure-walker.ts
// deterministic procedure closure & pre-yield traversal

import {
  blockKey,
  procedureKey,
  scriptKey,
  type BlockRef,
  type IndexedBlock,
  type IndexedProcedure,
  type IndexedScript,
  type ScriptRef,
} from '@scratch-agent/ir'
import {
  scratchRecordValue,
  type Block,
  type BlockField,
  type ProjectJson,
} from '@scratch-agent/sb3'
import { isBlock, type ProjectIndex } from '@scratch-agent/validate'

import { isLiteralPrimitive, primarySlot } from '../helpers.js'
import { isBudgetBurner, warpBreakerFor } from './boundary-model.js'
import { FragilityAnalysisBudgetV1 } from './analysis-budget.js'

const LOOP_ENTRIES = new Set([
  'control_forever',
  'control_repeat',
  'control_repeat_until',
  'control_while',
])

export type WarpState = 'warp' | 'non-warp' | 'mixed'
export type BoundaryState = 'triggered' | 'not-triggered' | 'indeterminate'

export interface BoundaryEvaluation
{
  state: BoundaryState
  kind: 'warp-break' | 'budget-burn'
  detail: string
  indeterminateReason: 'unresolved-receivers' | 'unsupported-feature' | null
}

export interface ProcedureCallGraph
{
  procedures: readonly IndexedProcedure[]
  calleesByProcedure: ReadonlyMap<string, readonly IndexedProcedure[]>
  callersByProcedure: ReadonlyMap<string, readonly IndexedProcedure[]>
  nonProcedureCallers: ReadonlyMap<string, readonly ScriptRef[]>
  effectiveWarpProcedures: ReadonlySet<string>
  mixedContextProcedures: ReadonlySet<string>
}

function uniquePush<T>(
  values: T[],
  value: T,
  keyOf: (entry: T) => string,
  budget: FragilityAnalysisBudgetV1 = new FragilityAnalysisBudgetV1()
): void
{
  budget.work()

  const key = keyOf(value)
  if (
    !values.some((entry) =>
    {
      budget.work()
      return keyOf(entry) === key
    })
  )
    values.push(value)
}

export function buildProcedureCallGraph(
  json: ProjectJson,
  index: ProjectIndex,
  budget: FragilityAnalysisBudgetV1 = new FragilityAnalysisBudgetV1()
): ProcedureCallGraph
{
  budget.work()

  const procedures = index.semantic.procedures
  const calleesByProcedure = new Map<string, IndexedProcedure[]>()
  const callersByProcedure = new Map<string, IndexedProcedure[]>()
  const nonProcedureCallers = new Map<string, ScriptRef[]>()
  const definitionOwners = new Map<string, IndexedProcedure>()

  for (const procedure of procedures)
  {
    budget.work()

    const key = procedureKey(procedure.target, procedure.proccode)
    calleesByProcedure.set(key, [])
    callersByProcedure.set(key, [])
    nonProcedureCallers.set(key, [])
    if (procedure.runtimeDefinition)
      definitionOwners.set(blockKey(procedure.runtimeDefinition), procedure)
  }

  for (const callee of procedures)
  {
    budget.work()

    const calleeKey = procedureKey(callee.target, callee.proccode)
    for (const call of callee.calls)
    {
      budget.work()

      if (!json.targets[call.target.targetIndex]) continue
      const indexedCall = index.semantic.blockByKey.get(blockKey(call))
      const callerScript = indexedCall?.topScript
      if (!callerScript) continue
      const caller = definitionOwners.get(
        blockKey({
          target: callerScript.target,
          blockId: callerScript.topBlockId,
        })
      )
      if (caller)
      {
        const callerKey = procedureKey(caller.target, caller.proccode)
        const callees = calleesByProcedure.get(callerKey)
        if (callees)
          uniquePush(
            callees,
            callee,
            (entry) =>
            {
              budget.work()
              return procedureKey(entry.target, entry.proccode)
            },
            budget
          )
        const callers = callersByProcedure.get(calleeKey)
        if (callers)
          uniquePush(
            callers,
            caller,
            (entry) =>
            {
              budget.work()
              return procedureKey(entry.target, entry.proccode)
            },
            budget
          )
      }
      else
      {
        const callerTop = index.semantic.blockByKey.get(
          blockKey({
            target: callerScript.target,
            blockId: callerScript.topBlockId,
          })
        )
        if (callerTop?.opcode === 'procedures_definition') continue
        const callers = nonProcedureCallers.get(calleeKey)
        if (callers) uniquePush(callers, callerScript, scriptKey, budget)
      }
    }
  }

  const effectiveWarpProcedures = new Set<string>()
  for (const procedure of procedures)
  {
    budget.work()

    if (procedure.warp === true)
      effectiveWarpProcedures.add(
        procedureKey(procedure.target, procedure.proccode)
      )
  }
  let changed = true
  while (changed)
  {
    budget.work()

    changed = false
    for (const caller of procedures)
    {
      budget.work()

      const callerKey = procedureKey(caller.target, caller.proccode)
      if (!effectiveWarpProcedures.has(callerKey)) continue
      for (const callee of calleesByProcedure.get(callerKey) ?? [])
      {
        budget.work()

        const calleeKey = procedureKey(callee.target, callee.proccode)
        if (effectiveWarpProcedures.has(calleeKey)) continue
        effectiveWarpProcedures.add(calleeKey)
        changed = true
      }
    }
  }

  const unwarpedProcedures = new Set<string>()
  for (const procedure of procedures)
  {
    budget.work()

    const key = procedureKey(procedure.target, procedure.proccode)
    if (
      procedure.warp !== true &&
      (nonProcedureCallers.get(key)?.length ?? 0) > 0
    )
      unwarpedProcedures.add(key)
  }
  changed = true
  while (changed)
  {
    budget.work()

    changed = false
    for (const caller of procedures)
    {
      budget.work()

      const callerKey = procedureKey(caller.target, caller.proccode)
      if (!unwarpedProcedures.has(callerKey)) continue
      for (const callee of calleesByProcedure.get(callerKey) ?? [])
      {
        budget.work()

        const calleeKey = procedureKey(callee.target, callee.proccode)
        if (callee.warp === true || unwarpedProcedures.has(calleeKey)) continue
        unwarpedProcedures.add(calleeKey)
        changed = true
      }
    }
  }

  const mixedContextProcedures = new Set<string>()
  for (const procedure of procedures)
  {
    budget.work()

    const key = procedureKey(procedure.target, procedure.proccode)
    if (
      procedure.warp !== true &&
      effectiveWarpProcedures.has(key) &&
      unwarpedProcedures.has(key)
    )
      mixedContextProcedures.add(key)
  }

  return {
    procedures,
    calleesByProcedure,
    callersByProcedure,
    nonProcedureCallers,
    effectiveWarpProcedures,
    mixedContextProcedures,
  }
}

export function effectiveWarp(
  procedure: IndexedProcedure,
  graph: ProcedureCallGraph,
  budget: FragilityAnalysisBudgetV1 = new FragilityAnalysisBudgetV1()
): boolean
{
  budget.work()

  return graph.effectiveWarpProcedures.has(
    procedureKey(procedure.target, procedure.proccode)
  )
}

export function mixedContext(
  procedure: IndexedProcedure,
  graph: ProcedureCallGraph,
  budget: FragilityAnalysisBudgetV1 = new FragilityAnalysisBudgetV1()
): boolean
{
  budget.work()

  return graph.mixedContextProcedures.has(
    procedureKey(procedure.target, procedure.proccode)
  )
}

function rawBlock(
  json: ProjectJson,
  ref: BlockRef,
  budget: FragilityAnalysisBudgetV1 = new FragilityAnalysisBudgetV1()
): Block | undefined
{
  budget.work()

  const target = json.targets[ref.target.targetIndex]
  const entry = target
    ? scratchRecordValue(target.blocks, ref.blockId)
    : undefined
  return isBlock(entry) ? entry : undefined
}

interface StaticValue
{
  known: boolean
  value?: string | number | null
}

function fieldValue(
  field: BlockField | undefined,
  budget: FragilityAnalysisBudgetV1 = new FragilityAnalysisBudgetV1()
): StaticValue
{
  budget.work()

  return field ? { known: true, value: field[0] } : { known: false }
}

function inputValue(
  json: ProjectJson,
  ref: BlockRef,
  inputName: string,
  menuOpcode: string,
  fieldName: string,
  budget: FragilityAnalysisBudgetV1 = new FragilityAnalysisBudgetV1()
): StaticValue
{
  budget.work()

  const block = rawBlock(json, ref, budget)
  const input = block ? scratchRecordValue(block.inputs, inputName) : undefined
  if (!input) return { known: false }
  const slot = primarySlot(input)
  if (Array.isArray(slot) && isLiteralPrimitive(slot))
    return { known: true, value: slot[1] }
  if (typeof slot !== 'string') return { known: false }
  const target = json.targets[ref.target.targetIndex]
  const menu = target ? scratchRecordValue(target.blocks, slot) : undefined
  if (!isBlock(menu) || menu.opcode !== menuOpcode) return { known: false }
  return fieldValue(scratchRecordValue(menu.fields, fieldName), budget)
}

function scratchNumber(
  value: string | number | null | undefined,
  budget: FragilityAnalysisBudgetV1 = new FragilityAnalysisBudgetV1()
): number
{
  budget.work()

  if (typeof value === 'number') return Number.isNaN(value) ? 0 : value
  const number = Number(value)
  return Number.isNaN(number) ? 0 : number
}

function scratchBoolean(
  value: string | number | null | undefined,
  budget: FragilityAnalysisBudgetV1 = new FragilityAnalysisBudgetV1()
): boolean
{
  budget.work()

  if (typeof value === 'string')
  {
    return !(value === '' || value === '0' || value.toLowerCase() === 'false')
  }
  return Boolean(value)
}

function literalBooleanCondition(
  json: ProjectJson,
  ref: BlockRef,
  budget: FragilityAnalysisBudgetV1 = new FragilityAnalysisBudgetV1()
): boolean | null
{
  budget.work()

  const value = inputValue(json, ref, 'CONDITION', 'math_number', 'NUM', budget)
  return value.known ? scratchBoolean(value.value, budget) : null
}

function decision(
  state: BoundaryState,
  kind: BoundaryEvaluation['kind'],
  detail: string,
  indeterminateReason: BoundaryEvaluation['indeterminateReason'] = null,
  budget: FragilityAnalysisBudgetV1 = new FragilityAnalysisBudgetV1()
): BoundaryEvaluation
{
  budget.work()

  return { state, kind, detail, indeterminateReason }
}

function waitDecision(
  json: ProjectJson,
  ref: BlockRef,
  warpState: WarpState,
  budget: FragilityAnalysisBudgetV1 = new FragilityAnalysisBudgetV1()
): BoundaryEvaluation
{
  budget.work()

  const value = inputValue(json, ref, 'DURATION', 'math_number', 'NUM', budget)
  if (!value.known && warpState === 'non-warp')
    return decision(
      'triggered',
      'budget-burn',
      'wait yields once outside warp regardless of its runtime duration',
      undefined,
      budget
    )
  if (!value.known)
    return decision(
      'indeterminate',
      'budget-burn',
      'wait duration is computed at runtime',
      'unsupported-feature',
      budget
    )
  const duration = scratchNumber(value.value, budget)
  if (duration > 0)
    return decision(
      'triggered',
      'budget-burn',
      `literal wait duration casts to ${duration} seconds`,
      undefined,
      budget
    )
  if (warpState === 'warp')
    return decision(
      'not-triggered',
      'budget-burn',
      'nonpositive wait completes during the same warp pass',
      undefined,
      budget
    )
  if (warpState === 'non-warp')
    return decision(
      'triggered',
      'budget-burn',
      'nonpositive wait yields once outside warp',
      undefined,
      budget
    )
  return decision(
    'indeterminate',
    'budget-burn',
    'nonpositive wait depends on caller warp context',
    'unsupported-feature',
    budget
  )
}

function waitUntilDecision(
  json: ProjectJson,
  ref: BlockRef,
  budget: FragilityAnalysisBudgetV1 = new FragilityAnalysisBudgetV1()
): BoundaryEvaluation
{
  budget.work()

  const condition = literalBooleanCondition(json, ref, budget)
  if (condition === null)
    return decision(
      'indeterminate',
      'budget-burn',
      'wait-until condition is computed at runtime',
      'unsupported-feature',
      budget
    )
  return condition
    ? decision(
        'not-triggered',
        'budget-burn',
        'wait-until condition is already true',
        undefined,
        budget
      )
    : decision(
        'triggered',
        'budget-burn',
        'wait-until condition is statically false',
        undefined,
        budget
      )
}

function glideTargetDecision(
  json: ProjectJson,
  index: ProjectIndex,
  ref: BlockRef,
  budget: FragilityAnalysisBudgetV1 = new FragilityAnalysisBudgetV1()
): BoundaryEvaluation
{
  budget.work()

  const target = index.semantic.spriteReferences.find((entry) =>
  {
    budget.work()
    return (
      entry.sourceBlock !== null &&
      blockKey(entry.sourceBlock) === blockKey(ref)
    )
  })
  if (target?.special || target?.targetStatus === 'unique')
    return decision(
      'triggered',
      'budget-burn',
      'glide target resolves',
      undefined,
      budget
    )
  if (target?.targetStatus === 'unresolved')
    return decision(
      'not-triggered',
      'budget-burn',
      'glide target does not resolve',
      undefined,
      budget
    )
  if (target)
    return decision(
      'indeterminate',
      'budget-burn',
      'glide target is ambiguous',
      'unsupported-feature',
      budget
    )
  const dynamic = index.semantic.dynamicSpriteReferences.some((entry) =>
  {
    budget.work()
    return blockKey(entry.block) === blockKey(ref)
  })
  if (dynamic)
    return decision(
      'indeterminate',
      'budget-burn',
      'glide target is computed at runtime',
      'unsupported-feature',
      budget
    )
  const value = inputValue(json, ref, 'TO', 'motion_glideto_menu', 'TO', budget)
  if (!value.known)
    return decision(
      'indeterminate',
      'budget-burn',
      'glide target cannot be resolved',
      'unsupported-feature',
      budget
    )
  const name = String(value.value)
  if (name === '_mouse_' || name === '_random_')
    return decision(
      'triggered',
      'budget-burn',
      'glide target resolves',
      undefined,
      budget
    )
  const matches = json.targets.filter((entry) =>
  {
    budget.work()
    return !entry.isStage && entry.name === name
  })
  if (matches.length === 1)
    return decision(
      'triggered',
      'budget-burn',
      'glide target resolves',
      undefined,
      budget
    )
  if (matches.length === 0)
    return decision(
      'not-triggered',
      'budget-burn',
      'glide target does not resolve',
      undefined,
      budget
    )
  return decision(
    'indeterminate',
    'budget-burn',
    'glide target is ambiguous',
    'unsupported-feature',
    budget
  )
}

function glideDecision(
  json: ProjectJson,
  index: ProjectIndex,
  ref: BlockRef,
  opcode: string,
  budget: FragilityAnalysisBudgetV1 = new FragilityAnalysisBudgetV1()
): BoundaryEvaluation
{
  budget.work()

  const duration = inputValue(json, ref, 'SECS', 'math_number', 'NUM', budget)
  if (!duration.known)
    return decision(
      'indeterminate',
      'budget-burn',
      'glide duration is computed at runtime',
      'unsupported-feature',
      budget
    )
  const seconds = scratchNumber(duration.value, budget)
  if (seconds <= 0)
    return decision(
      'not-triggered',
      'budget-burn',
      'nonpositive glide completes without yielding',
      undefined,
      budget
    )
  if (opcode === 'motion_glideto')
    return glideTargetDecision(json, index, ref, budget)
  return decision(
    'triggered',
    'budget-burn',
    `literal glide duration casts to ${seconds} seconds`,
    undefined,
    budget
  )
}

function soundEffectDecision(
  json: ProjectJson,
  ref: BlockRef,
  budget: FragilityAnalysisBudgetV1 = new FragilityAnalysisBudgetV1()
): BoundaryEvaluation
{
  budget.work()

  const block = rawBlock(json, ref, budget)
  if (!block)
    return decision(
      'indeterminate',
      'warp-break',
      'sound effect block is unavailable',
      'unsupported-feature',
      budget
    )
  const effect = fieldValue(scratchRecordValue(block.fields, 'EFFECT'), budget)
  const name = String(effect.value).toLowerCase()
  return name === 'pitch' || name === 'pan'
    ? decision(
        'triggered',
        'warp-break',
        `sound effect ${name} returns a promise`,
        undefined,
        budget
      )
    : decision(
        'not-triggered',
        'warp-break',
        `sound effect ${name} returns without a promise`,
        undefined,
        budget
      )
}

function soundDecision(
  json: ProjectJson,
  ref: BlockRef,
  budget: FragilityAnalysisBudgetV1 = new FragilityAnalysisBudgetV1()
): BoundaryEvaluation
{
  budget.work()

  const target = json.targets[ref.target.targetIndex]
  if (!target || target.sounds.length === 0)
    return decision(
      'not-triggered',
      'warp-break',
      'target has no resolvable sounds',
      undefined,
      budget
    )
  const selector = inputValue(
    json,
    ref,
    'SOUND_MENU',
    'sound_sounds_menu',
    'SOUND_MENU',
    budget
  )
  if (!selector.known)
    return decision(
      'indeterminate',
      'warp-break',
      'sound selector is computed at runtime',
      'unsupported-feature',
      budget
    )
  const name = selector.value
  const named = target.sounds.some((sound) =>
  {
    budget.work()
    return sound.name === name
  })
  const ordinal = Number.parseInt(String(name), 10)
  if (!named && Number.isNaN(ordinal))
    return decision(
      'not-triggered',
      'warp-break',
      'sound selector does not resolve',
      undefined,
      budget
    )
  return decision(
    'indeterminate',
    'warp-break',
    'sound resolves but sound-bank state is runtime-only',
    'unsupported-feature',
    budget
  )
}

function broadcastDecision(
  index: ProjectIndex,
  ref: BlockRef,
  budget: FragilityAnalysisBudgetV1 = new FragilityAnalysisBudgetV1()
): BoundaryEvaluation
{
  budget.work()

  const key = blockKey(ref)
  const broadcast = index.semantic.broadcasts.find((entry) =>
  {
    budget.work()
    return entry.senders.some((sender) =>
    {
      budget.work()
      return blockKey(sender.block) === key
    })
  })
  const unresolved = [
    ...budget.iterable(index.semantic.unresolvedBroadcastUses),
    ...budget.iterable(index.semantic.dynamicBroadcastSenders),
  ].find((sender) =>
  {
    budget.work()
    return blockKey(sender.block) === key
  })
  if (
    unresolved?.resolutionStatus === 'dynamic' ||
    unresolved?.resolutionStatus === 'unresolved' ||
    unresolved?.resolutionStatus === 'ambiguous'
  )
  {
    return decision(
      'indeterminate',
      'warp-break',
      `${unresolved.resolutionStatus} broadcast receivers`,
      'unresolved-receivers',
      budget
    )
  }
  if (!broadcast || broadcast.receivers.length === 0)
    return decision(
      'not-triggered',
      'warp-break',
      'broadcast starts no receiver scripts',
      undefined,
      budget
    )
  return decision(
    'triggered',
    'warp-break',
    `${broadcast.receivers.length} resolved receiver script(s) start`,
    undefined,
    budget
  )
}

function wrappedIndex(
  oneBased: number,
  length: number,
  budget: FragilityAnalysisBudgetV1 = new FragilityAnalysisBudgetV1()
): number
{
  budget.work()

  const zeroBased = oneBased - 1
  return zeroBased - Math.floor(zeroBased / length) * length
}

function backdropName(
  json: ProjectJson,
  ref: BlockRef,
  budget: FragilityAnalysisBudgetV1 = new FragilityAnalysisBudgetV1()
): StaticValue
{
  budget.work()

  const stage = json.targets.find((target) =>
  {
    budget.work()
    return target.isStage
  })
  if (!stage || stage.costumes.length === 0) return { known: false }
  const selector = inputValue(
    json,
    ref,
    'BACKDROP',
    'looks_backdrops',
    'BACKDROP',
    budget
  )
  if (!selector.known) return selector
  if (typeof selector.value === 'number')
  {
    return {
      known: true,
      value:
        stage.costumes[
          wrappedIndex(selector.value, stage.costumes.length, budget)
        ]?.name,
    }
  }
  const value = String(selector.value)
  const named = stage.costumes.find((costume) =>
  {
    budget.work()
    return costume.name === value
  })
  if (named) return { known: true, value: named.name }
  if (
    value === 'next backdrop' ||
    value === 'previous backdrop' ||
    value === 'random backdrop' ||
    value.trim().length === 0
  )
    return { known: false }
  const ordinal = Number(value)
  if (Number.isNaN(ordinal)) return { known: false }
  return {
    known: true,
    value:
      stage.costumes[wrappedIndex(ordinal, stage.costumes.length, budget)]
        ?.name,
  }
}

function backdropDecision(
  json: ProjectJson,
  index: ProjectIndex,
  ref: BlockRef,
  budget: FragilityAnalysisBudgetV1 = new FragilityAnalysisBudgetV1()
): BoundaryEvaluation
{
  budget.work()

  const selected = backdropName(json, ref, budget)
  if (!selected.known || typeof selected.value !== 'string')
    return decision(
      'indeterminate',
      'warp-break',
      'resulting backdrop depends on runtime state',
      'unresolved-receivers',
      budget
    )
  const selectedName = selected.value.toUpperCase()
  const receivers = index.semantic.eventHats.filter((hat) =>
  {
    budget.work()

    if (hat.opcode !== 'event_whenbackdropswitchesto') return false
    const block = rawBlock(json, hat.block, budget)
    const field = block
      ? scratchRecordValue(block.fields, 'BACKDROP')
      : undefined
    return (
      field !== undefined && String(field[0]).toUpperCase() === selectedName
    )
  })
  if (receivers.length === 0)
    return decision(
      'not-triggered',
      'warp-break',
      `backdrop ${selected.value} starts no receiver scripts`,
      undefined,
      budget
    )
  return decision(
    'triggered',
    'warp-break',
    `${receivers.length} matching backdrop receiver script(s) start`,
    undefined,
    budget
  )
}

export function evaluateBoundary(
  json: ProjectJson,
  index: ProjectIndex,
  ref: BlockRef,
  warpState: WarpState,
  budget: FragilityAnalysisBudgetV1 = new FragilityAnalysisBudgetV1()
): BoundaryEvaluation | null
{
  budget.work()

  const opcode = index.semantic.blockByKey.get(blockKey(ref))?.opcode
  if (!opcode) return null
  const breaker = warpBreakerFor(opcode)
  if (breaker)
  {
    if (breaker.group === 'unconditional')
      return decision(
        'triggered',
        'warp-break',
        breaker.mechanism,
        undefined,
        budget
      )
    if (breaker.group === 'argument-conditional')
      return soundEffectDecision(json, ref, budget)
    if (breaker.group === 'state-conditional')
      return soundDecision(json, ref, budget)
    return opcode === 'event_broadcastandwait'
      ? broadcastDecision(index, ref, budget)
      : backdropDecision(json, index, ref, budget)
  }
  if (!isBudgetBurner(opcode)) return null
  if (opcode === 'control_wait')
    return waitDecision(json, ref, warpState, budget)
  if (opcode === 'control_wait_until')
    return waitUntilDecision(json, ref, budget)
  return glideDecision(json, index, ref, opcode, budget)
}

function calledProcedure(
  json: ProjectJson,
  index: ProjectIndex,
  ref: BlockRef,
  budget: FragilityAnalysisBudgetV1 = new FragilityAnalysisBudgetV1()
): IndexedProcedure | undefined
{
  budget.work()

  const block = rawBlock(json, ref, budget)
  const proccode = block?.mutation?.proccode
  if (block?.opcode !== 'procedures_call' || typeof proccode !== 'string')
    return undefined
  return index.semantic.procedureByKey.get(procedureKey(ref.target, proccode))
}

type ProcedureReturnState = 'returns' | 'nonreturning' | 'indeterminate'
export type ProcedureReturnCache = Map<IndexedProcedure, ProcedureReturnState>

function walkSequenceReturnState(
  json: ProjectJson,
  index: ProjectIndex,
  start: BlockRef | null,
  cache: ProcedureReturnCache,
  activeProcedures: Set<IndexedProcedure>,
  budget: FragilityAnalysisBudgetV1 = new FragilityAnalysisBudgetV1()
): ProcedureReturnState
{
  budget.work()
  budget.enter()
  try
  {
    let current = start
    let indeterminate = false
    const seen = new Set<string>()
    while (current)
    {
      budget.work()

      const key = blockKey(current)
      if (seen.has(key)) return 'indeterminate'
      seen.add(key)
      const indexed = index.semantic.blockByKey.get(key)
      if (!indexed) return 'indeterminate'
      if (indexed.opcode === 'control_forever') return 'nonreturning'
      if (
        (indexed.opcode === 'control_wait_until' ||
          indexed.opcode === 'control_repeat_until') &&
        literalBooleanCondition(json, current, budget) === false
      )
        return 'nonreturning'
      if (
        indexed.opcode === 'control_while' &&
        literalBooleanCondition(json, current, budget) === true
      )
        return 'nonreturning'
      if (indexed.opcode === 'control_stop')
      {
        const block = rawBlock(json, current, budget)
        const option = block
          ? scratchRecordValue(block.fields, 'STOP_OPTION')
          : undefined
        if (
          option === undefined ||
          String(option[0]).toLowerCase() !== 'other scripts in sprite'
        )
          return 'nonreturning'
      }
      if (indexed.opcode === 'procedures_call')
      {
        const callee = calledProcedure(json, index, current, budget)
        const state = callee
          ? procedureReturnState(
              json,
              index,
              callee,
              cache,
              activeProcedures,
              budget
            )
          : 'indeterminate'
        if (state === 'nonreturning') return state
        if (state === 'indeterminate') indeterminate = true
      }
      if (indexed.opcode === 'control_if_else')
      {
        const left = primaryBranch(indexed, 'SUBSTACK', budget)
        const right = primaryBranch(indexed, 'SUBSTACK2', budget)
        const leftState =
          left === null
            ? 'returns'
            : walkSequenceReturnState(
                json,
                index,
                left,
                cache,
                activeProcedures,
                budget
              )
        const rightState =
          right === null
            ? 'returns'
            : walkSequenceReturnState(
                json,
                index,
                right,
                cache,
                activeProcedures,
                budget
              )
        if (leftState === 'nonreturning' && rightState === 'nonreturning')
          return 'nonreturning'
        if (leftState !== 'returns' || rightState !== 'returns')
          indeterminate = true
      }
      else if (indexed.opcode === 'control_if')
      {
        const branch = primaryBranch(indexed, 'SUBSTACK', budget)
        if (
          branch !== null &&
          walkSequenceReturnState(
            json,
            index,
            branch,
            cache,
            activeProcedures,
            budget
          ) !== 'returns'
        )
          indeterminate = true
      }
      current = indexed.successor
    }
    return indeterminate ? 'indeterminate' : 'returns'
  }
  finally
  {
    budget.leave()
  }
}

export function procedureReturnState(
  json: ProjectJson,
  index: ProjectIndex,
  procedure: IndexedProcedure,
  cache: ProcedureReturnCache = new Map(),
  activeProcedures: Set<IndexedProcedure> = new Set(),
  budget: FragilityAnalysisBudgetV1 = new FragilityAnalysisBudgetV1()
): ProcedureReturnState
{
  budget.work()

  const cached = cache.get(procedure)
  if (cached !== undefined) return cached
  if (activeProcedures.has(procedure)) return 'indeterminate'
  const definition = procedure.runtimeDefinition
  const indexedDefinition = definition
    ? index.semantic.blockByKey.get(blockKey(definition))
    : undefined
  if (!indexedDefinition || topologyIssues(procedure, budget).length > 0)
    return 'indeterminate'
  activeProcedures.add(procedure)
  let state: ProcedureReturnState
  try
  {
    state = walkSequenceReturnState(
      json,
      index,
      indexedDefinition.successor,
      cache,
      activeProcedures,
      budget
    )
  }
  finally
  {
    activeProcedures.delete(procedure)
  }
  cache.set(procedure, state)
  return state
}

export function executionSequenceReturnState(
  json: ProjectJson,
  index: ProjectIndex,
  start: BlockRef | null,
  cache: ProcedureReturnCache = new Map(),
  budget: FragilityAnalysisBudgetV1 = new FragilityAnalysisBudgetV1()
): ProcedureReturnState
{
  budget.work()

  return walkSequenceReturnState(json, index, start, cache, new Set(), budget)
}

export function procedureCanReturn(
  json: ProjectJson,
  index: ProjectIndex,
  procedure: IndexedProcedure,
  cache: ProcedureReturnCache = new Map(),
  activeProcedures: Set<IndexedProcedure> = new Set(),
  budget: FragilityAnalysisBudgetV1 = new FragilityAnalysisBudgetV1()
): boolean
{
  budget.work()

  return (
    procedureReturnState(
      json,
      index,
      procedure,
      cache,
      activeProcedures,
      budget
    ) === 'returns'
  )
}

export interface ProcedureExecutionBlock
{
  ref: BlockRef
  warpState: WarpState
  uncertaintyReason: 'mixed-warp-callers' | 'unsupported-feature' | null
  loopKeys: readonly string[]
}

export interface ProcedureClosureIssue
{
  ref: BlockRef | null
  detail: string
}

export interface ProcedureExecution
{
  blocks: readonly ProcedureExecutionBlock[]
  issues: readonly ProcedureClosureIssue[]
}

function mergeWarpStates(
  left: WarpState,
  right: WarpState,
  budget: FragilityAnalysisBudgetV1 = new FragilityAnalysisBudgetV1()
): WarpState
{
  budget.work()

  return left === right ? left : 'mixed'
}

export function procedureEntryWarpState(
  procedure: IndexedProcedure,
  graph: ProcedureCallGraph,
  budget: FragilityAnalysisBudgetV1 = new FragilityAnalysisBudgetV1()
): WarpState
{
  budget.work()

  if (mixedContext(procedure, graph, budget)) return 'mixed'
  return effectiveWarp(procedure, graph, budget) ? 'warp' : 'non-warp'
}

function procedureParentWarpState(
  procedure: IndexedProcedure,
  graph: ProcedureCallGraph,
  budget: FragilityAnalysisBudgetV1 = new FragilityAnalysisBudgetV1()
): WarpState
{
  budget.work()

  const key = procedureKey(procedure.target, procedure.proccode)
  let state: WarpState | null =
    (graph.nonProcedureCallers.get(key)?.length ?? 0) > 0 ? 'non-warp' : null
  for (const caller of graph.callersByProcedure.get(key) ?? [])
  {
    budget.work()

    const callerState = procedureEntryWarpState(caller, graph, budget)
    state =
      state === null ? callerState : mergeWarpStates(state, callerState, budget)
  }
  return state ?? 'non-warp'
}

function topologyIssues(
  procedure: IndexedProcedure,
  budget: FragilityAnalysisBudgetV1 = new FragilityAnalysisBudgetV1()
): ProcedureClosureIssue[]
{
  budget.work()

  const issues: ProcedureClosureIssue[] = []
  if (procedure.runtimeDefinition === null)
  {
    issues.push({
      ref: procedure.definitions[0] ?? null,
      detail:
        procedure.definitions.length > 0
          ? 'no VM-effective definition/prototype pair can be selected'
          : 'procedure call has no definition',
    })
    return issues
  }
  return issues
}

interface MutableProcedureExecution
{
  blocks: ProcedureExecutionBlock[]
  issues: ProcedureClosureIssue[]
}

interface WalkContext
{
  state: WarpState
  parentState: WarpState
  uncertaintyReason: ProcedureExecutionBlock['uncertaintyReason']
  loopKeys: readonly string[]
  warpLoopDepth: number
}

function primaryBranch(
  indexed: IndexedBlock,
  inputName: string,
  budget: FragilityAnalysisBudgetV1 = new FragilityAnalysisBudgetV1()
): BlockRef | null
{
  budget.work()

  return (
    indexed.inputChildren.find((child) =>
    {
      budget.work()
      return child.inputName === inputName && child.slot === 'primary'
    })?.block ?? null
  )
}

function walkSequence(
  json: ProjectJson,
  index: ProjectIndex,
  start: BlockRef | null,
  graph: ProcedureCallGraph,
  activeProcedures: Set<string>,
  result: MutableProcedureExecution,
  context: WalkContext,
  budget: FragilityAnalysisBudgetV1 = new FragilityAnalysisBudgetV1()
): WarpState
{
  budget.work()
  budget.enter()
  try
  {
    let current = start
    let state = context.state
    const seen = new Set<string>()
    while (current)
    {
      budget.work()

      const key = blockKey(current)
      if (seen.has(key))
      {
        result.issues.push({
          ref: current,
          detail: 'block successor cycle prevents a complete closure',
        })
        break
      }
      seen.add(key)
      const indexed = index.semantic.blockByKey.get(key)
      if (!indexed)
      {
        result.issues.push({
          ref: current,
          detail: 'reachable block is missing from the semantic index',
        })
        break
      }

      budget.occurrence(current, indexed.opcode)
      result.blocks.push({
        ref: current,
        warpState: state,
        uncertaintyReason:
          state === 'mixed'
            ? (context.uncertaintyReason ?? 'mixed-warp-callers')
            : context.uncertaintyReason,
        loopKeys: context.loopKeys,
      })

      if (indexed.opcode === 'procedures_call')
      {
        const raw = rawBlock(json, current, budget)
        const proccode = raw?.mutation?.proccode
        const callee = calledProcedure(json, index, current, budget)
        if (typeof proccode !== 'string' || !callee)
        {
          result.issues.push({
            ref: current,
            detail: 'procedure call mutation cannot be resolved',
          })
        }
        else if (callee.runtimeDefinition === null)
        {
          result.issues.push({
            ref: current,
            detail:
              callee.definitions.length > 0
                ? `procedure call ${proccode} has malformed definition topology`
                : `procedure call ${proccode} has no definition`,
          })
        }
        else if (callee.warpEncoding === 'malformed')
        {
          result.issues.push({
            ref: current,
            detail: `procedure call ${proccode} has malformed warp metadata`,
          })
        }
        else if (callee.runtimeDefinition !== null)
        {
          const calleeKey = procedureKey(callee.target, callee.proccode)
          if (activeProcedures.has(calleeKey))
          {
            result.issues.push({
              ref: current,
              detail: `recursive procedure call ${proccode} prevents a complete closure`,
            })
          }
          else
          {
            const calleeState = callee.warp === true ? 'warp' : state
            walkProcedure(
              json,
              index,
              callee,
              graph,
              activeProcedures,
              result,
              {
                state: calleeState,
                parentState: state,
                uncertaintyReason:
                  calleeState === 'mixed'
                    ? 'mixed-warp-callers'
                    : context.uncertaintyReason,
                loopKeys: context.loopKeys,
                warpLoopDepth: 0,
              },
              budget
            )
          }
        }
      }

      if (indexed.opcode && LOOP_ENTRIES.has(indexed.opcode))
      {
        const branch = primaryBranch(indexed, 'SUBSTACK', budget)
        const loopKey = blockKey(current)
        walkSequence(
          json,
          index,
          branch,
          graph,
          activeProcedures,
          result,
          {
            state,
            parentState: state,
            uncertaintyReason: context.uncertaintyReason,
            loopKeys: [...budget.iterable(context.loopKeys), loopKey],
            warpLoopDepth: context.warpLoopDepth + 1,
          },
          budget
        )
        if (indexed.opcode === 'control_forever') break
      }
      else if (
        indexed.opcode === 'control_if' ||
        indexed.opcode === 'control_if_else'
      )
      {
        const branches = [
          primaryBranch(indexed, 'SUBSTACK', budget),
          primaryBranch(indexed, 'SUBSTACK2', budget),
        ]
        const exitStates: WarpState[] =
          indexed.opcode === 'control_if' ? [state] : []
        for (const branch of branches)
        {
          budget.work()

          if (branch === null)
          {
            if (indexed.opcode === 'control_if_else') exitStates.push(state)
            continue
          }
          exitStates.push(
            walkSequence(
              json,
              index,
              branch,
              graph,
              activeProcedures,
              result,
              {
                state,
                parentState: context.parentState,
                uncertaintyReason: 'unsupported-feature',
                loopKeys: context.loopKeys,
                warpLoopDepth: context.warpLoopDepth,
              },
              budget
            )
          )
        }
        if (exitStates.length > 0)
          state = exitStates.reduce((left, right) =>
            mergeWarpStates(left, right, budget)
          )
      }

      const boundary = evaluateBoundary(json, index, current, state, budget)
      const promise =
        indexed.opcode !== null &&
        warpBreakerFor(indexed.opcode)?.mechanism === 'promise'
      if (
        promise &&
        boundary?.state !== 'not-triggered' &&
        context.warpLoopDepth === 0
      )
      {
        state =
          boundary?.state === 'triggered'
            ? context.parentState
            : mergeWarpStates(state, context.parentState, budget)
      }
      current = indexed.successor
    }
    return state
  }
  finally
  {
    budget.leave()
  }
}

function walkProcedure(
  json: ProjectJson,
  index: ProjectIndex,
  procedure: IndexedProcedure,
  graph: ProcedureCallGraph,
  activeProcedures: Set<string>,
  result: MutableProcedureExecution,
  context: WalkContext,
  budget: FragilityAnalysisBudgetV1 = new FragilityAnalysisBudgetV1()
): void
{
  budget.work()

  const key = procedureKey(procedure.target, procedure.proccode)
  if (activeProcedures.has(key)) return
  budget.append(result.issues, topologyIssues(procedure, budget))
  const definition = procedure.runtimeDefinition
  if (!definition) return
  const indexedDefinition = index.semantic.blockByKey.get(blockKey(definition))
  if (!indexedDefinition)
  {
    result.issues.push({
      ref: definition,
      detail: 'VM-effective definition is missing from the semantic index',
    })
    return
  }
  activeProcedures.add(key)
  try
  {
    walkSequence(
      json,
      index,
      indexedDefinition.successor,
      graph,
      activeProcedures,
      result,
      context,
      budget
    )
  }
  finally
  {
    activeProcedures.delete(key)
  }
}

export function procedureExecution(
  json: ProjectJson,
  index: ProjectIndex,
  procedure: IndexedProcedure,
  graph: ProcedureCallGraph,
  parentState?: WarpState,
  budget: FragilityAnalysisBudgetV1 = new FragilityAnalysisBudgetV1()
): ProcedureExecution
{
  budget.work()

  const result: MutableProcedureExecution = { blocks: [], issues: [] }
  const state = procedureEntryWarpState(procedure, graph, budget)
  walkProcedure(
    json,
    index,
    procedure,
    graph,
    new Set(),
    result,
    {
      state,
      parentState:
        parentState ?? procedureParentWarpState(procedure, graph, budget),
      uncertaintyReason: state === 'mixed' ? 'mixed-warp-callers' : null,
      loopKeys: [],
      warpLoopDepth: 0,
    },
    budget
  )
  return result
}

export function scriptExecution(
  json: ProjectJson,
  index: ProjectIndex,
  script: IndexedScript,
  graph: ProcedureCallGraph,
  budget: FragilityAnalysisBudgetV1 = new FragilityAnalysisBudgetV1()
): ProcedureExecution
{
  budget.work()

  const result: MutableProcedureExecution = { blocks: [], issues: [] }
  const top = index.semantic.blockByKey.get(blockKey(script.top))
  if (!top)
  {
    result.issues.push({
      ref: script.top,
      detail: 'script top block is missing from the semantic index',
    })
    return result
  }
  const start =
    script.hat !== null || top.opcode === 'procedures_definition'
      ? top.successor
      : script.top
  walkSequence(
    json,
    index,
    start,
    graph,
    new Set(),
    result,
    {
      state: 'non-warp',
      parentState: 'non-warp',
      uncertaintyReason: null,
      loopKeys: [],
      warpLoopDepth: 0,
    },
    budget
  )
  return result
}

export interface ExecutionBoundarySummary
{
  state: 'clean' | 'dirty' | 'indeterminate'
  completion: ProcedureReturnState
  reason:
    'mixed-warp-callers' | 'unresolved-closure' | 'unsupported-feature' | null
  definiteWrites: ReadonlySet<string>
  possibleWrites: ReadonlySet<string>
}

export type ProcedureBoundarySummaryCache = Map<
  IndexedProcedure,
  Map<string, ExecutionBoundarySummary>
>

interface SummaryWalkContext
{
  state: WarpState
  parentState: WarpState
}

function boundarySummary(
  state: ExecutionBoundarySummary['state'],
  reason: ExecutionBoundarySummary['reason'],
  definiteWrites: ReadonlySet<string> = new Set(),
  possibleWrites: ReadonlySet<string> = new Set(),
  completion: ProcedureReturnState = 'returns',
  budget: FragilityAnalysisBudgetV1 = new FragilityAnalysisBudgetV1()
): ExecutionBoundarySummary
{
  budget.work()

  return { state, completion, reason, definiteWrites, possibleWrites }
}

function mergeSequentialBoundaryState(
  current: ExecutionBoundarySummary['state'],
  next: ExecutionBoundarySummary['state'],
  budget: FragilityAnalysisBudgetV1 = new FragilityAnalysisBudgetV1()
): ExecutionBoundarySummary['state']
{
  budget.work()

  if (current === 'dirty') return 'dirty'
  if (current === 'indeterminate') return 'indeterminate'
  return next
}

function addPossibleWrites(
  destination: Set<string>,
  summary: ExecutionBoundarySummary,
  budget: FragilityAnalysisBudgetV1 = new FragilityAnalysisBudgetV1()
): void
{
  budget.work()

  for (const key of summary.definiteWrites)
  {
    budget.work()
    destination.add(key)
  }
  for (const key of summary.possibleWrites)
  {
    budget.work()
    destination.add(key)
  }
}

function mergeSequentialWrites(
  definiteWrites: Set<string>,
  possibleWrites: Set<string>,
  summary: ExecutionBoundarySummary,
  budget: FragilityAnalysisBudgetV1 = new FragilityAnalysisBudgetV1()
): void
{
  budget.work()

  for (const key of summary.definiteWrites)
  {
    budget.work()

    definiteWrites.add(key)
    possibleWrites.delete(key)
  }
  for (const key of summary.possibleWrites)
  {
    budget.work()

    if (!definiteWrites.has(key)) possibleWrites.add(key)
  }
}

function procedureBoundarySummary(
  json: ProjectJson,
  index: ProjectIndex,
  procedure: IndexedProcedure,
  graph: ProcedureCallGraph,
  activeProcedures: Set<IndexedProcedure>,
  cache: ProcedureBoundarySummaryCache,
  writerKeysByBlock: ReadonlyMap<string, readonly string[]>,
  state: WarpState,
  parentState: WarpState,
  budget: FragilityAnalysisBudgetV1 = new FragilityAnalysisBudgetV1()
): ExecutionBoundarySummary
{
  budget.work()

  if (activeProcedures.has(procedure))
    return boundarySummary(
      'indeterminate',
      'unsupported-feature',
      new Set(),
      new Set(),
      'indeterminate',
      budget
    )
  const cacheKey = `${state}:${parentState}`
  const cached = cache.get(procedure)?.get(cacheKey)
  if (cached) return cached
  const definition = procedure.runtimeDefinition
  const indexedDefinition = definition
    ? index.semantic.blockByKey.get(blockKey(definition))
    : undefined
  if (!indexedDefinition)
    return boundarySummary(
      'indeterminate',
      'unresolved-closure',
      new Set(),
      new Set(),
      'indeterminate',
      budget
    )

  activeProcedures.add(procedure)
  let summary: ExecutionBoundarySummary
  try
  {
    summary = walkBoundarySummary(
      json,
      index,
      indexedDefinition.successor,
      null,
      graph,
      activeProcedures,
      cache,
      writerKeysByBlock,
      { state, parentState },
      budget
    )
  }
  finally
  {
    activeProcedures.delete(procedure)
  }
  const byState = cache.get(procedure) ?? new Map()
  byState.set(cacheKey, summary)
  cache.set(procedure, byState)
  return summary
}

function walkBoundarySummary(
  json: ProjectJson,
  index: ProjectIndex,
  start: BlockRef | null,
  stop: BlockRef | null,
  graph: ProcedureCallGraph,
  activeProcedures: Set<IndexedProcedure>,
  cache: ProcedureBoundarySummaryCache,
  writerKeysByBlock: ReadonlyMap<string, readonly string[]>,
  context: SummaryWalkContext,
  budget: FragilityAnalysisBudgetV1 = new FragilityAnalysisBudgetV1()
): ExecutionBoundarySummary
{
  budget.work()
  budget.enter()
  try
  {
    let current = start
    let state: ExecutionBoundarySummary['state'] = 'clean'
    let possibleReason: ExecutionBoundarySummary['reason'] = null
    let completionIndeterminate = false
    const definiteWrites = new Set<string>()
    const possibleWrites = new Set<string>()
    const seen = new Set<string>()
    const stopKey = stop ? blockKey(stop) : null
    while (current)
    {
      budget.work()

      const key = blockKey(current)
      if (key === stopKey)
        return boundarySummary(
          state === 'clean' && possibleReason ? 'indeterminate' : state,
          state === 'dirty' ? null : possibleReason,
          definiteWrites,
          possibleWrites,
          completionIndeterminate ? 'indeterminate' : 'returns',
          budget
        )
      if (seen.has(key))
        return boundarySummary(
          'indeterminate',
          'unresolved-closure',
          definiteWrites,
          possibleWrites,
          'indeterminate',
          budget
        )
      seen.add(key)
      const indexed = index.semantic.blockByKey.get(key)
      if (!indexed)
        return boundarySummary(
          'indeterminate',
          'unresolved-closure',
          definiteWrites,
          possibleWrites,
          'indeterminate',
          budget
        )

      for (const writerKey of writerKeysByBlock.get(key) ?? [])
      {
        budget.work()

        definiteWrites.add(writerKey)
        possibleWrites.delete(writerKey)
      }

      if (indexed.opcode === 'procedures_call')
      {
        const callee = calledProcedure(json, index, current, budget)
        if (!callee)
        {
          possibleReason = 'unresolved-closure'
          completionIndeterminate = true
        }
        else
        {
          const calleeState = callee.warp === true ? 'warp' : context.state
          const nested = procedureBoundarySummary(
            json,
            index,
            callee,
            graph,
            activeProcedures,
            cache,
            writerKeysByBlock,
            calleeState,
            context.state,
            budget
          )
          state = mergeSequentialBoundaryState(state, nested.state, budget)
          mergeSequentialWrites(definiteWrites, possibleWrites, nested, budget)
          if (nested.completion === 'nonreturning')
            return boundarySummary(
              state,
              state === 'dirty' ? null : nested.reason,
              definiteWrites,
              possibleWrites,
              'nonreturning',
              budget
            )
          if (nested.completion === 'indeterminate')
            completionIndeterminate = true
          if (nested.state === 'indeterminate')
            possibleReason ??= nested.reason ?? 'unsupported-feature'
        }
      }

      if (indexed.opcode && LOOP_ENTRIES.has(indexed.opcode))
      {
        state = mergeSequentialBoundaryState(state, 'dirty', budget)
        const body = primaryBranch(indexed, 'SUBSTACK', budget)
        if (body)
        {
          const nested = walkBoundarySummary(
            json,
            index,
            body,
            null,
            graph,
            activeProcedures,
            cache,
            writerKeysByBlock,
            context,
            budget
          )
          addPossibleWrites(possibleWrites, nested, budget)
          for (const key of definiteWrites)
          {
            budget.work()
            possibleWrites.delete(key)
          }
        }
        if (indexed.opcode === 'control_forever')
          return boundarySummary(
            state,
            state === 'dirty' ? null : possibleReason,
            definiteWrites,
            possibleWrites,
            'nonreturning',
            budget
          )
        if (
          (indexed.opcode === 'control_repeat_until' &&
            literalBooleanCondition(json, current, budget) === false) ||
          (indexed.opcode === 'control_while' &&
            literalBooleanCondition(json, current, budget) === true)
        )
          return boundarySummary(
            state,
            state === 'dirty' ? null : possibleReason,
            definiteWrites,
            possibleWrites,
            'nonreturning',
            budget
          )
      }
      else if (
        indexed.opcode === 'control_if' ||
        indexed.opcode === 'control_if_else'
      )
      {
        const branchRefs = [
          primaryBranch(indexed, 'SUBSTACK', budget),
          primaryBranch(indexed, 'SUBSTACK2', budget),
        ]
        if (indexed.opcode === 'control_if') branchRefs[1] = null
        const branches = budget.scan(branchRefs, (budgetValues) =>
          budgetValues.map((branch) =>
          {
            budget.work()

            return branch === null
              ? boundarySummary(
                  'clean',
                  null,
                  undefined,
                  undefined,
                  undefined,
                  budget
                )
              : walkBoundarySummary(
                  json,
                  index,
                  branch,
                  null,
                  graph,
                  activeProcedures,
                  cache,
                  writerKeysByBlock,
                  context,
                  budget
                )
          })
        )
        const branchState = branches.every((entry) =>
          {
          budget.work()
          return entry.state === 'dirty'
        })
          ? 'dirty'
          : branches.every((entry) =>
            {
                budget.work()
                return entry.state === 'clean'
              })
            ? 'clean'
            : 'indeterminate'
        state = mergeSequentialBoundaryState(state, branchState, budget)
        if (branchState === 'indeterminate')
          possibleReason ??=
            branches.find((entry) =>
            {
              budget.work()
              return entry.reason
            })?.reason ?? 'unsupported-feature'

        const branchCompletions = budget.scan(branches, (budgetValues) =>
          budgetValues.map((entry) =>
          {
            budget.work()
            return entry.completion
          })
        )
        if (
          branchCompletions.every((entry) =>
          {
            budget.work()
            return entry === 'nonreturning'
          })
        )
          return boundarySummary(
            state,
            state === 'dirty' ? null : possibleReason,
            definiteWrites,
            possibleWrites,
            'nonreturning',
            budget
          )
        if (
          branchCompletions.some((entry) =>
          {
            budget.work()
            return entry !== 'returns'
          })
        )
          completionIndeterminate = true

        const branchWriteKeys = new Set<string>()
        for (const branch of branches)
        {
          budget.work()
          addPossibleWrites(branchWriteKeys, branch, budget)
        }
        for (const writerKey of branchWriteKeys)
        {
          budget.work()

          if (
            branches.every((branch) =>
            {
              budget.work()
              return branch.definiteWrites.has(writerKey)
            })
          )
          {
            definiteWrites.add(writerKey)
            possibleWrites.delete(writerKey)
          }
          else if (!definiteWrites.has(writerKey))
            possibleWrites.add(writerKey)
        }
      }

      if (indexed.opcode === 'control_stop')
      {
        const block = rawBlock(json, current, budget)
        const option = block
          ? scratchRecordValue(block.fields, 'STOP_OPTION')
          : undefined
        if (
          option === undefined ||
          String(option[0]).toLowerCase() !== 'other scripts in sprite'
        )
          return boundarySummary(
            state,
            state === 'dirty' ? null : possibleReason,
            definiteWrites,
            possibleWrites,
            'nonreturning',
            budget
          )
      }

      const boundary = evaluateBoundary(
        json,
        index,
        current,
        context.state,
        budget
      )
      if (boundary?.state === 'triggered')
        state = mergeSequentialBoundaryState(state, 'dirty', budget)
      else if (boundary?.state === 'indeterminate')
      {
        state = mergeSequentialBoundaryState(state, 'indeterminate', budget)
        possibleReason ??= 'unsupported-feature'
      }
      if (
        indexed.opcode === 'control_wait_until' &&
        literalBooleanCondition(json, current, budget) === false
      )
        return boundarySummary(
          state,
          state === 'dirty' ? null : possibleReason,
          definiteWrites,
          possibleWrites,
          'nonreturning',
          budget
        )
      current = indexed.successor
    }
    if (stopKey !== null)
      return boundarySummary(
        'indeterminate',
        'unresolved-closure',
        definiteWrites,
        possibleWrites,
        'indeterminate',
        budget
      )
    return boundarySummary(
      state === 'clean' && possibleReason ? 'indeterminate' : state,
      state === 'dirty' ? null : possibleReason,
      definiteWrites,
      possibleWrites,
      completionIndeterminate ? 'indeterminate' : 'returns',
      budget
    )
  }
  finally
  {
    budget.leave()
  }
}

export function evaluateExecutionWindow(
  json: ProjectJson,
  index: ProjectIndex,
  start: BlockRef | null,
  stop: BlockRef,
  graph: ProcedureCallGraph,
  state: WarpState,
  cache: ProcedureBoundarySummaryCache = new Map(),
  writerKeysByBlock: ReadonlyMap<string, readonly string[]> = new Map(),
  budget: FragilityAnalysisBudgetV1 = new FragilityAnalysisBudgetV1()
): ExecutionBoundarySummary
{
  budget.work()

  if (state === 'mixed')
    return boundarySummary(
      'indeterminate',
      'mixed-warp-callers',
      undefined,
      undefined,
      undefined,
      budget
    )
  return walkBoundarySummary(
    json,
    index,
    start,
    stop,
    graph,
    new Set(),
    cache,
    writerKeysByBlock,
    { state, parentState: state },
    budget
  )
}

export interface PrefixWalkResult
{
  blockIds: string[]
  possibleBlockIds: string[]
  terminated: boolean
  indeterminateReason:
    'unresolved-closure' | 'unresolved-receivers' | 'unsupported-feature' | null
}

function walkProcedurePrefix(
  json: ProjectJson,
  index: ProjectIndex,
  procedure: IndexedProcedure,
  activeProcedures: Set<string>,
  warpState: WarpState,
  budget: FragilityAnalysisBudgetV1 = new FragilityAnalysisBudgetV1()
): PrefixWalkResult
{
  budget.work()

  const key = procedureKey(procedure.target, procedure.proccode)
  if (activeProcedures.has(key))
  {
    return {
      blockIds: [],
      possibleBlockIds: [],
      terminated: false,
      indeterminateReason: 'unsupported-feature',
    }
  }
  const definition = procedure.runtimeDefinition
  if (!definition)
  {
    return {
      blockIds: [],
      possibleBlockIds: [],
      terminated: false,
      indeterminateReason: 'unresolved-closure',
    }
  }
  const script = index.semantic.scriptByKey.get(
    scriptKey({
      target: definition.target,
      topBlockId: definition.blockId,
    })
  )
  if (!script)
  {
    return {
      blockIds: [],
      possibleBlockIds: [],
      terminated: false,
      indeterminateReason: 'unresolved-closure',
    }
  }

  activeProcedures.add(key)
  try
  {
    return walkPrefix(
      json,
      index,
      script,
      activeProcedures,
      procedure.warp === true ? 'warp' : warpState,
      budget
    )
  }
  finally
  {
    activeProcedures.delete(key)
  }
}

function walkPrefix(
  json: ProjectJson,
  index: ProjectIndex,
  script: IndexedScript,
  activeProcedures: Set<string>,
  warpState: WarpState,
  budget: FragilityAnalysisBudgetV1 = new FragilityAnalysisBudgetV1()
): PrefixWalkResult
{
  budget.work()
  budget.enter()
  try
  {
    const top = index.semantic.blockByKey.get(blockKey(script.top))
    let current =
      script.hat || top?.opcode === 'procedures_definition'
        ? (top?.successor ?? null)
        : script.top
    const blockIds: string[] = []
    const possibleBlockIds: string[] = []
    const seenBlocks = new Set<string>()
    let definite = true
    let indeterminateReason: PrefixWalkResult['indeterminateReason'] = null

    while (current)
    {
      budget.work()

      const key = blockKey(current)
      if (seenBlocks.has(key))
      {
        indeterminateReason ??= 'unresolved-closure'
        break
      }
      seenBlocks.add(key)
      const indexed = index.semantic.blockByKey.get(key)
      if (!indexed)
      {
        indeterminateReason ??= 'unresolved-closure'
        break
      }
      budget.occurrence(current, indexed.opcode)
      ;(definite ? blockIds : possibleBlockIds).push(current.blockId)

      if (indexed.opcode === 'procedures_call')
      {
        const callee = calledProcedure(json, index, current, budget)
        if (callee)
        {
          const nested = walkProcedurePrefix(
            json,
            index,
            callee,
            activeProcedures,
            warpState,
            budget
          )
          if (definite)
          {
            budget.append(blockIds, nested.blockIds)
            budget.append(possibleBlockIds, nested.possibleBlockIds)
          }
          else
          {
            budget.append(possibleBlockIds, nested.blockIds)
            budget.append(possibleBlockIds, nested.possibleBlockIds)
          }
          if (nested.indeterminateReason)
          {
            indeterminateReason ??= nested.indeterminateReason
            definite = false
          }
          if (nested.terminated)
          {
            return {
              blockIds,
              possibleBlockIds,
              terminated: true,
              indeterminateReason,
            }
          }
        }
        else
        {
          indeterminateReason ??= 'unresolved-closure'
          definite = false
        }
      }
      const boundary = evaluateBoundary(json, index, current, warpState, budget)
      if (
        boundary?.state === 'triggered' ||
        LOOP_ENTRIES.has(indexed.opcode ?? '')
      )
      {
        return {
          blockIds,
          possibleBlockIds,
          terminated: true,
          indeterminateReason,
        }
      }
      if (boundary?.state === 'indeterminate')
      {
        indeterminateReason ??=
          boundary.indeterminateReason ?? 'unsupported-feature'
        definite = false
      }
      current = indexed.successor
    }
    return {
      blockIds,
      possibleBlockIds,
      terminated: false,
      indeterminateReason,
    }
  }
  finally
  {
    budget.leave()
  }
}

export function prefixWalk(
  json: ProjectJson,
  index: ProjectIndex,
  script: IndexedScript,
  seenProcedures: Set<string> = new Set(),
  budget: FragilityAnalysisBudgetV1 = new FragilityAnalysisBudgetV1()
): PrefixWalkResult
{
  budget.work()

  return walkPrefix(json, index, script, seenProcedures, 'non-warp', budget)
}
