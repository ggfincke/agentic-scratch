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
  keyOf: (entry: T) => string
): void
{
  const key = keyOf(value)
  if (!values.some((entry) => keyOf(entry) === key)) values.push(value)
}

export function buildProcedureCallGraph(
  json: ProjectJson,
  index: ProjectIndex
): ProcedureCallGraph
{
  const procedures = index.semantic.procedures
  const calleesByProcedure = new Map<string, IndexedProcedure[]>()
  const callersByProcedure = new Map<string, IndexedProcedure[]>()
  const nonProcedureCallers = new Map<string, ScriptRef[]>()
  const definitionOwners = new Map<string, IndexedProcedure>()

  for (const procedure of procedures)
  {
    const key = procedureKey(procedure.target, procedure.proccode)
    calleesByProcedure.set(key, [])
    callersByProcedure.set(key, [])
    nonProcedureCallers.set(key, [])
    if (procedure.runtimeDefinition)
      definitionOwners.set(blockKey(procedure.runtimeDefinition), procedure)
  }

  for (const callee of procedures)
  {
    const calleeKey = procedureKey(callee.target, callee.proccode)
    for (const call of callee.calls)
    {
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
          uniquePush(callees, callee, (entry) =>
            procedureKey(entry.target, entry.proccode)
          )
        const callers = callersByProcedure.get(calleeKey)
        if (callers)
          uniquePush(callers, caller, (entry) =>
            procedureKey(entry.target, entry.proccode)
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
        if (callers) uniquePush(callers, callerScript, scriptKey)
      }
    }
  }

  const effectiveWarpProcedures = new Set<string>()
  for (const procedure of procedures)
  {
    if (procedure.warp === true)
      effectiveWarpProcedures.add(
        procedureKey(procedure.target, procedure.proccode)
      )
  }
  let changed = true
  while (changed)
  {
    changed = false
    for (const caller of procedures)
    {
      const callerKey = procedureKey(caller.target, caller.proccode)
      if (!effectiveWarpProcedures.has(callerKey)) continue
      for (const callee of calleesByProcedure.get(callerKey) ?? [])
      {
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
    changed = false
    for (const caller of procedures)
    {
      const callerKey = procedureKey(caller.target, caller.proccode)
      if (!unwarpedProcedures.has(callerKey)) continue
      for (const callee of calleesByProcedure.get(callerKey) ?? [])
      {
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
  graph: ProcedureCallGraph
): boolean
{
  return graph.effectiveWarpProcedures.has(
    procedureKey(procedure.target, procedure.proccode)
  )
}

export function mixedContext(
  procedure: IndexedProcedure,
  graph: ProcedureCallGraph
): boolean
{
  return graph.mixedContextProcedures.has(
    procedureKey(procedure.target, procedure.proccode)
  )
}

function rawBlock(json: ProjectJson, ref: BlockRef): Block | undefined
{
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

function fieldValue(field: BlockField | undefined): StaticValue
{
  return field ? { known: true, value: field[0] } : { known: false }
}

function inputValue(
  json: ProjectJson,
  ref: BlockRef,
  inputName: string,
  menuOpcode: string,
  fieldName: string
): StaticValue
{
  const block = rawBlock(json, ref)
  const input = block ? scratchRecordValue(block.inputs, inputName) : undefined
  if (!input) return { known: false }
  const slot = primarySlot(input)
  if (Array.isArray(slot) && isLiteralPrimitive(slot))
    return { known: true, value: slot[1] }
  if (typeof slot !== 'string') return { known: false }
  const target = json.targets[ref.target.targetIndex]
  const menu = target ? scratchRecordValue(target.blocks, slot) : undefined
  if (!isBlock(menu) || menu.opcode !== menuOpcode) return { known: false }
  return fieldValue(scratchRecordValue(menu.fields, fieldName))
}

function scratchNumber(value: string | number | null | undefined): number
{
  if (typeof value === 'number') return Number.isNaN(value) ? 0 : value
  const number = Number(value)
  return Number.isNaN(number) ? 0 : number
}

function scratchBoolean(value: string | number | null | undefined): boolean
{
  if (typeof value === 'string')
  {
    return !(value === '' || value === '0' || value.toLowerCase() === 'false')
  }
  return Boolean(value)
}

function literalBooleanCondition(
  json: ProjectJson,
  ref: BlockRef
): boolean | null
{
  const value = inputValue(json, ref, 'CONDITION', 'math_number', 'NUM')
  return value.known ? scratchBoolean(value.value) : null
}

function decision(
  state: BoundaryState,
  kind: BoundaryEvaluation['kind'],
  detail: string,
  indeterminateReason: BoundaryEvaluation['indeterminateReason'] = null
): BoundaryEvaluation
{
  return { state, kind, detail, indeterminateReason }
}

function waitDecision(
  json: ProjectJson,
  ref: BlockRef,
  warpState: WarpState
): BoundaryEvaluation
{
  const value = inputValue(json, ref, 'DURATION', 'math_number', 'NUM')
  if (!value.known && warpState === 'non-warp')
    return decision(
      'triggered',
      'budget-burn',
      'wait yields once outside warp regardless of its runtime duration'
    )
  if (!value.known)
    return decision(
      'indeterminate',
      'budget-burn',
      'wait duration is computed at runtime',
      'unsupported-feature'
    )
  const duration = scratchNumber(value.value)
  if (duration > 0)
    return decision(
      'triggered',
      'budget-burn',
      `literal wait duration casts to ${duration} seconds`
    )
  if (warpState === 'warp')
    return decision(
      'not-triggered',
      'budget-burn',
      'nonpositive wait completes during the same warp pass'
    )
  if (warpState === 'non-warp')
    return decision(
      'triggered',
      'budget-burn',
      'nonpositive wait yields once outside warp'
    )
  return decision(
    'indeterminate',
    'budget-burn',
    'nonpositive wait depends on caller warp context',
    'unsupported-feature'
  )
}

function waitUntilDecision(
  json: ProjectJson,
  ref: BlockRef
): BoundaryEvaluation
{
  const condition = literalBooleanCondition(json, ref)
  if (condition === null)
    return decision(
      'indeterminate',
      'budget-burn',
      'wait-until condition is computed at runtime',
      'unsupported-feature'
    )
  return condition
    ? decision(
        'not-triggered',
        'budget-burn',
        'wait-until condition is already true'
      )
    : decision(
        'triggered',
        'budget-burn',
        'wait-until condition is statically false'
      )
}

function glideTargetDecision(
  json: ProjectJson,
  index: ProjectIndex,
  ref: BlockRef
): BoundaryEvaluation
{
  const target = index.semantic.spriteReferences.find(
    (entry) =>
      entry.sourceBlock !== null &&
      blockKey(entry.sourceBlock) === blockKey(ref)
  )
  if (target?.special || target?.targetStatus === 'unique')
    return decision('triggered', 'budget-burn', 'glide target resolves')
  if (target?.targetStatus === 'unresolved')
    return decision(
      'not-triggered',
      'budget-burn',
      'glide target does not resolve'
    )
  if (target)
    return decision(
      'indeterminate',
      'budget-burn',
      'glide target is ambiguous',
      'unsupported-feature'
    )
  const dynamic = index.semantic.dynamicSpriteReferences.some(
    (entry) => blockKey(entry.block) === blockKey(ref)
  )
  if (dynamic)
    return decision(
      'indeterminate',
      'budget-burn',
      'glide target is computed at runtime',
      'unsupported-feature'
    )
  const value = inputValue(json, ref, 'TO', 'motion_glideto_menu', 'TO')
  if (!value.known)
    return decision(
      'indeterminate',
      'budget-burn',
      'glide target cannot be resolved',
      'unsupported-feature'
    )
  const name = String(value.value)
  if (name === '_mouse_' || name === '_random_')
    return decision('triggered', 'budget-burn', 'glide target resolves')
  const matches = json.targets.filter(
    (entry) => !entry.isStage && entry.name === name
  )
  if (matches.length === 1)
    return decision('triggered', 'budget-burn', 'glide target resolves')
  if (matches.length === 0)
    return decision(
      'not-triggered',
      'budget-burn',
      'glide target does not resolve'
    )
  return decision(
    'indeterminate',
    'budget-burn',
    'glide target is ambiguous',
    'unsupported-feature'
  )
}

function glideDecision(
  json: ProjectJson,
  index: ProjectIndex,
  ref: BlockRef,
  opcode: string
): BoundaryEvaluation
{
  const duration = inputValue(json, ref, 'SECS', 'math_number', 'NUM')
  if (!duration.known)
    return decision(
      'indeterminate',
      'budget-burn',
      'glide duration is computed at runtime',
      'unsupported-feature'
    )
  const seconds = scratchNumber(duration.value)
  if (seconds <= 0)
    return decision(
      'not-triggered',
      'budget-burn',
      'nonpositive glide completes without yielding'
    )
  if (opcode === 'motion_glideto') return glideTargetDecision(json, index, ref)
  return decision(
    'triggered',
    'budget-burn',
    `literal glide duration casts to ${seconds} seconds`
  )
}

function soundEffectDecision(
  json: ProjectJson,
  ref: BlockRef
): BoundaryEvaluation
{
  const block = rawBlock(json, ref)
  if (!block)
    return decision(
      'indeterminate',
      'warp-break',
      'sound effect block is unavailable',
      'unsupported-feature'
    )
  const effect = fieldValue(scratchRecordValue(block.fields, 'EFFECT'))
  const name = String(effect.value).toLowerCase()
  return name === 'pitch' || name === 'pan'
    ? decision(
        'triggered',
        'warp-break',
        `sound effect ${name} returns a promise`
      )
    : decision(
        'not-triggered',
        'warp-break',
        `sound effect ${name} returns without a promise`
      )
}

function soundDecision(json: ProjectJson, ref: BlockRef): BoundaryEvaluation
{
  const target = json.targets[ref.target.targetIndex]
  if (!target || target.sounds.length === 0)
    return decision(
      'not-triggered',
      'warp-break',
      'target has no resolvable sounds'
    )
  const selector = inputValue(
    json,
    ref,
    'SOUND_MENU',
    'sound_sounds_menu',
    'SOUND_MENU'
  )
  if (!selector.known)
    return decision(
      'indeterminate',
      'warp-break',
      'sound selector is computed at runtime',
      'unsupported-feature'
    )
  const name = selector.value
  const named = target.sounds.some((sound) => sound.name === name)
  const ordinal = Number.parseInt(String(name), 10)
  if (!named && Number.isNaN(ordinal))
    return decision(
      'not-triggered',
      'warp-break',
      'sound selector does not resolve'
    )
  return decision(
    'indeterminate',
    'warp-break',
    'sound resolves but sound-bank state is runtime-only',
    'unsupported-feature'
  )
}

function broadcastDecision(
  index: ProjectIndex,
  ref: BlockRef
): BoundaryEvaluation
{
  const key = blockKey(ref)
  const broadcast = index.semantic.broadcasts.find((entry) =>
    entry.senders.some((sender) => blockKey(sender.block) === key)
  )
  const unresolved = [
    ...index.semantic.unresolvedBroadcastUses,
    ...index.semantic.dynamicBroadcastSenders,
  ].find((sender) => blockKey(sender.block) === key)
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
      'unresolved-receivers'
    )
  }
  if (!broadcast || broadcast.receivers.length === 0)
    return decision(
      'not-triggered',
      'warp-break',
      'broadcast starts no receiver scripts'
    )
  return decision(
    'triggered',
    'warp-break',
    `${broadcast.receivers.length} resolved receiver script(s) start`
  )
}

function wrappedIndex(oneBased: number, length: number): number
{
  const zeroBased = oneBased - 1
  return zeroBased - Math.floor(zeroBased / length) * length
}

function backdropName(json: ProjectJson, ref: BlockRef): StaticValue
{
  const stage = json.targets.find((target) => target.isStage)
  if (!stage || stage.costumes.length === 0) return { known: false }
  const selector = inputValue(
    json,
    ref,
    'BACKDROP',
    'looks_backdrops',
    'BACKDROP'
  )
  if (!selector.known) return selector
  if (typeof selector.value === 'number')
  {
    return {
      known: true,
      value:
        stage.costumes[wrappedIndex(selector.value, stage.costumes.length)]
          ?.name,
    }
  }
  const value = String(selector.value)
  const named = stage.costumes.find((costume) => costume.name === value)
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
    value: stage.costumes[wrappedIndex(ordinal, stage.costumes.length)]?.name,
  }
}

function backdropDecision(
  json: ProjectJson,
  index: ProjectIndex,
  ref: BlockRef
): BoundaryEvaluation
{
  const selected = backdropName(json, ref)
  if (!selected.known || typeof selected.value !== 'string')
    return decision(
      'indeterminate',
      'warp-break',
      'resulting backdrop depends on runtime state',
      'unresolved-receivers'
    )
  const selectedName = selected.value.toUpperCase()
  const receivers = index.semantic.eventHats.filter((hat) =>
  {
    if (hat.opcode !== 'event_whenbackdropswitchesto') return false
    const block = rawBlock(json, hat.block)
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
      `backdrop ${selected.value} starts no receiver scripts`
    )
  return decision(
    'triggered',
    'warp-break',
    `${receivers.length} matching backdrop receiver script(s) start`
  )
}

export function evaluateBoundary(
  json: ProjectJson,
  index: ProjectIndex,
  ref: BlockRef,
  warpState: WarpState
): BoundaryEvaluation | null
{
  const opcode = index.semantic.blockByKey.get(blockKey(ref))?.opcode
  if (!opcode) return null
  const breaker = warpBreakerFor(opcode)
  if (breaker)
  {
    if (breaker.group === 'unconditional')
      return decision('triggered', 'warp-break', breaker.mechanism)
    if (breaker.group === 'argument-conditional')
      return soundEffectDecision(json, ref)
    if (breaker.group === 'state-conditional') return soundDecision(json, ref)
    return opcode === 'event_broadcastandwait'
      ? broadcastDecision(index, ref)
      : backdropDecision(json, index, ref)
  }
  if (!isBudgetBurner(opcode)) return null
  if (opcode === 'control_wait') return waitDecision(json, ref, warpState)
  if (opcode === 'control_wait_until') return waitUntilDecision(json, ref)
  return glideDecision(json, index, ref, opcode)
}

function calledProcedure(
  json: ProjectJson,
  index: ProjectIndex,
  ref: BlockRef
): IndexedProcedure | undefined
{
  const block = rawBlock(json, ref)
  const proccode = block?.mutation?.proccode
  if (block?.opcode !== 'procedures_call' || typeof proccode !== 'string')
    return undefined
  return index.semantic.procedureByKey.get(procedureKey(ref.target, proccode))
}

export type ProcedureReturnState = 'returns' | 'nonreturning' | 'indeterminate'
export type ProcedureReturnCache = Map<IndexedProcedure, ProcedureReturnState>

function walkSequenceReturnState(
  json: ProjectJson,
  index: ProjectIndex,
  start: BlockRef | null,
  cache: ProcedureReturnCache,
  activeProcedures: Set<IndexedProcedure>
): ProcedureReturnState
{
  let current = start
  let indeterminate = false
  const seen = new Set<string>()
  while (current)
  {
    const key = blockKey(current)
    if (seen.has(key)) return 'indeterminate'
    seen.add(key)
    const indexed = index.semantic.blockByKey.get(key)
    if (!indexed) return 'indeterminate'
    if (indexed.opcode === 'control_forever') return 'nonreturning'
    if (
      (indexed.opcode === 'control_wait_until' ||
        indexed.opcode === 'control_repeat_until') &&
      literalBooleanCondition(json, current) === false
    )
      return 'nonreturning'
    if (
      indexed.opcode === 'control_while' &&
      literalBooleanCondition(json, current) === true
    )
      return 'nonreturning'
    if (indexed.opcode === 'control_stop')
    {
      const block = rawBlock(json, current)
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
      const callee = calledProcedure(json, index, current)
      const state = callee
        ? procedureReturnState(json, index, callee, cache, activeProcedures)
        : 'indeterminate'
      if (state === 'nonreturning') return state
      if (state === 'indeterminate') indeterminate = true
    }
    if (indexed.opcode === 'control_if_else')
    {
      const left = primaryBranch(indexed, 'SUBSTACK')
      const right = primaryBranch(indexed, 'SUBSTACK2')
      const leftState =
        left === null
          ? 'returns'
          : walkSequenceReturnState(json, index, left, cache, activeProcedures)
      const rightState =
        right === null
          ? 'returns'
          : walkSequenceReturnState(json, index, right, cache, activeProcedures)
      if (leftState === 'nonreturning' && rightState === 'nonreturning')
        return 'nonreturning'
      if (leftState !== 'returns' || rightState !== 'returns')
        indeterminate = true
    }
    else if (indexed.opcode === 'control_if')
    {
      const branch = primaryBranch(indexed, 'SUBSTACK')
      if (
        branch !== null &&
        walkSequenceReturnState(
          json,
          index,
          branch,
          cache,
          activeProcedures
        ) !== 'returns'
      )
        indeterminate = true
    }
    current = indexed.successor
  }
  return indeterminate ? 'indeterminate' : 'returns'
}

export function procedureReturnState(
  json: ProjectJson,
  index: ProjectIndex,
  procedure: IndexedProcedure,
  cache: ProcedureReturnCache = new Map(),
  activeProcedures: Set<IndexedProcedure> = new Set()
): ProcedureReturnState
{
  const cached = cache.get(procedure)
  if (cached !== undefined) return cached
  if (activeProcedures.has(procedure)) return 'indeterminate'
  const definition = procedure.runtimeDefinition
  const indexedDefinition = definition
    ? index.semantic.blockByKey.get(blockKey(definition))
    : undefined
  if (!indexedDefinition || topologyIssues(procedure).length > 0)
    return 'indeterminate'
  activeProcedures.add(procedure)
  const state = walkSequenceReturnState(
    json,
    index,
    indexedDefinition.successor,
    cache,
    activeProcedures
  )
  activeProcedures.delete(procedure)
  cache.set(procedure, state)
  return state
}

export function executionSequenceReturnState(
  json: ProjectJson,
  index: ProjectIndex,
  start: BlockRef | null,
  cache: ProcedureReturnCache = new Map()
): ProcedureReturnState
{
  return walkSequenceReturnState(json, index, start, cache, new Set())
}

export function procedureCanReturn(
  json: ProjectJson,
  index: ProjectIndex,
  procedure: IndexedProcedure,
  cache: ProcedureReturnCache = new Map(),
  activeProcedures: Set<IndexedProcedure> = new Set()
): boolean
{
  return (
    procedureReturnState(json, index, procedure, cache, activeProcedures) ===
    'returns'
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

function mergeWarpStates(left: WarpState, right: WarpState): WarpState
{
  return left === right ? left : 'mixed'
}

export function procedureEntryWarpState(
  procedure: IndexedProcedure,
  graph: ProcedureCallGraph
): WarpState
{
  if (mixedContext(procedure, graph)) return 'mixed'
  return effectiveWarp(procedure, graph) ? 'warp' : 'non-warp'
}

function procedureParentWarpState(
  procedure: IndexedProcedure,
  graph: ProcedureCallGraph
): WarpState
{
  const key = procedureKey(procedure.target, procedure.proccode)
  let state: WarpState | null =
    (graph.nonProcedureCallers.get(key)?.length ?? 0) > 0 ? 'non-warp' : null
  for (const caller of graph.callersByProcedure.get(key) ?? [])
  {
    const callerState = procedureEntryWarpState(caller, graph)
    state = state === null ? callerState : mergeWarpStates(state, callerState)
  }
  return state ?? 'non-warp'
}

function topologyIssues(procedure: IndexedProcedure): ProcedureClosureIssue[]
{
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
  inputName: string
): BlockRef | null
{
  return (
    indexed.inputChildren.find(
      (child) => child.inputName === inputName && child.slot === 'primary'
    )?.block ?? null
  )
}

function walkSequence(
  json: ProjectJson,
  index: ProjectIndex,
  start: BlockRef | null,
  graph: ProcedureCallGraph,
  activeProcedures: Set<string>,
  result: MutableProcedureExecution,
  context: WalkContext
): WarpState
{
  let current = start
  let state = context.state
  const seen = new Set<string>()
  while (current)
  {
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
      const raw = rawBlock(json, current)
      const proccode = raw?.mutation?.proccode
      const callee = calledProcedure(json, index, current)
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
          walkProcedure(json, index, callee, graph, activeProcedures, result, {
            state: calleeState,
            parentState: state,
            uncertaintyReason:
              calleeState === 'mixed'
                ? 'mixed-warp-callers'
                : context.uncertaintyReason,
            loopKeys: context.loopKeys,
            warpLoopDepth: 0,
          })
        }
      }
    }

    if (indexed.opcode && LOOP_ENTRIES.has(indexed.opcode))
    {
      const branch = primaryBranch(indexed, 'SUBSTACK')
      const loopKey = blockKey(current)
      walkSequence(json, index, branch, graph, activeProcedures, result, {
        state,
        parentState: state,
        uncertaintyReason: context.uncertaintyReason,
        loopKeys: [...context.loopKeys, loopKey],
        warpLoopDepth: context.warpLoopDepth + 1,
      })
      if (indexed.opcode === 'control_forever') break
    }
    else if (
      indexed.opcode === 'control_if' ||
      indexed.opcode === 'control_if_else'
    )
    {
      const branches = [
        primaryBranch(indexed, 'SUBSTACK'),
        primaryBranch(indexed, 'SUBSTACK2'),
      ]
      const exitStates: WarpState[] =
        indexed.opcode === 'control_if' ? [state] : []
      for (const branch of branches)
      {
        if (branch === null)
        {
          if (indexed.opcode === 'control_if_else') exitStates.push(state)
          continue
        }
        exitStates.push(
          walkSequence(json, index, branch, graph, activeProcedures, result, {
            state,
            parentState: context.parentState,
            uncertaintyReason: 'unsupported-feature',
            loopKeys: context.loopKeys,
            warpLoopDepth: context.warpLoopDepth,
          })
        )
      }
      if (exitStates.length > 0) state = exitStates.reduce(mergeWarpStates)
    }

    const boundary = evaluateBoundary(json, index, current, state)
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
          : mergeWarpStates(state, context.parentState)
    }
    current = indexed.successor
  }
  return state
}

function walkProcedure(
  json: ProjectJson,
  index: ProjectIndex,
  procedure: IndexedProcedure,
  graph: ProcedureCallGraph,
  activeProcedures: Set<string>,
  result: MutableProcedureExecution,
  context: WalkContext
): void
{
  const key = procedureKey(procedure.target, procedure.proccode)
  if (activeProcedures.has(key)) return
  result.issues.push(...topologyIssues(procedure))
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
  walkSequence(
    json,
    index,
    indexedDefinition.successor,
    graph,
    activeProcedures,
    result,
    context
  )
  activeProcedures.delete(key)
}

export function procedureExecution(
  json: ProjectJson,
  index: ProjectIndex,
  procedure: IndexedProcedure,
  graph: ProcedureCallGraph,
  parentState: WarpState = procedureParentWarpState(procedure, graph)
): ProcedureExecution
{
  const result: MutableProcedureExecution = { blocks: [], issues: [] }
  const state = procedureEntryWarpState(procedure, graph)
  walkProcedure(json, index, procedure, graph, new Set(), result, {
    state,
    parentState,
    uncertaintyReason: state === 'mixed' ? 'mixed-warp-callers' : null,
    loopKeys: [],
    warpLoopDepth: 0,
  })
  return result
}

export function scriptExecution(
  json: ProjectJson,
  index: ProjectIndex,
  script: IndexedScript,
  graph: ProcedureCallGraph
): ProcedureExecution
{
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
  walkSequence(json, index, start, graph, new Set(), result, {
    state: 'non-warp',
    parentState: 'non-warp',
    uncertaintyReason: null,
    loopKeys: [],
    warpLoopDepth: 0,
  })
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
  completion: ProcedureReturnState = 'returns'
): ExecutionBoundarySummary
{
  return { state, completion, reason, definiteWrites, possibleWrites }
}

function mergeSequentialBoundaryState(
  current: ExecutionBoundarySummary['state'],
  next: ExecutionBoundarySummary['state']
): ExecutionBoundarySummary['state']
{
  if (current === 'dirty') return 'dirty'
  if (current === 'indeterminate') return 'indeterminate'
  return next
}

function addPossibleWrites(
  destination: Set<string>,
  summary: ExecutionBoundarySummary
): void
{
  for (const key of summary.definiteWrites) destination.add(key)
  for (const key of summary.possibleWrites) destination.add(key)
}

function mergeSequentialWrites(
  definiteWrites: Set<string>,
  possibleWrites: Set<string>,
  summary: ExecutionBoundarySummary
): void
{
  for (const key of summary.definiteWrites)
  {
    definiteWrites.add(key)
    possibleWrites.delete(key)
  }
  for (const key of summary.possibleWrites)
  {
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
  parentState: WarpState
): ExecutionBoundarySummary
{
  if (activeProcedures.has(procedure))
    return boundarySummary(
      'indeterminate',
      'unsupported-feature',
      new Set(),
      new Set(),
      'indeterminate'
    )
  const cacheKey = `${state}:${parentState}`
  const cached = cache.get(procedure)?.get(cacheKey)
  if (cached) return cached
  if (topologyIssues(procedure).length > 0)
    return boundarySummary(
      'indeterminate',
      'unresolved-closure',
      new Set(),
      new Set(),
      'indeterminate'
    )
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
      'indeterminate'
    )

  activeProcedures.add(procedure)
  const summary = walkBoundarySummary(
    json,
    index,
    indexedDefinition.successor,
    null,
    graph,
    activeProcedures,
    cache,
    writerKeysByBlock,
    { state, parentState }
  )
  activeProcedures.delete(procedure)
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
  context: SummaryWalkContext
): ExecutionBoundarySummary
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
    const key = blockKey(current)
    if (key === stopKey)
      return boundarySummary(
        state === 'clean' && possibleReason ? 'indeterminate' : state,
        state === 'dirty' ? null : possibleReason,
        definiteWrites,
        possibleWrites,
        completionIndeterminate ? 'indeterminate' : 'returns'
      )
    if (seen.has(key))
      return boundarySummary(
        'indeterminate',
        'unresolved-closure',
        definiteWrites,
        possibleWrites,
        'indeterminate'
      )
    seen.add(key)
    const indexed = index.semantic.blockByKey.get(key)
    if (!indexed)
      return boundarySummary(
        'indeterminate',
        'unresolved-closure',
        definiteWrites,
        possibleWrites,
        'indeterminate'
      )

    for (const writerKey of writerKeysByBlock.get(key) ?? [])
    {
      definiteWrites.add(writerKey)
      possibleWrites.delete(writerKey)
    }

    if (indexed.opcode === 'procedures_call')
    {
      const callee = calledProcedure(json, index, current)
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
          context.state
        )
        state = mergeSequentialBoundaryState(state, nested.state)
        mergeSequentialWrites(definiteWrites, possibleWrites, nested)
        if (nested.completion === 'nonreturning')
          return boundarySummary(
            state,
            state === 'dirty' ? null : nested.reason,
            definiteWrites,
            possibleWrites,
            'nonreturning'
          )
        if (nested.completion === 'indeterminate')
          completionIndeterminate = true
        if (nested.state === 'indeterminate')
          possibleReason ??= nested.reason ?? 'unsupported-feature'
      }
    }

    if (indexed.opcode && LOOP_ENTRIES.has(indexed.opcode))
    {
      state = mergeSequentialBoundaryState(state, 'dirty')
      const body = primaryBranch(indexed, 'SUBSTACK')
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
          context
        )
        addPossibleWrites(possibleWrites, nested)
        for (const key of definiteWrites) possibleWrites.delete(key)
      }
      if (indexed.opcode === 'control_forever')
        return boundarySummary(
          state,
          state === 'dirty' ? null : possibleReason,
          definiteWrites,
          possibleWrites,
          'nonreturning'
        )
      if (
        (indexed.opcode === 'control_repeat_until' &&
          literalBooleanCondition(json, current) === false) ||
        (indexed.opcode === 'control_while' &&
          literalBooleanCondition(json, current) === true)
      )
        return boundarySummary(
          state,
          state === 'dirty' ? null : possibleReason,
          definiteWrites,
          possibleWrites,
          'nonreturning'
        )
    }
    else if (
      indexed.opcode === 'control_if' ||
      indexed.opcode === 'control_if_else'
    )
    {
      const branchRefs = [
        primaryBranch(indexed, 'SUBSTACK'),
        primaryBranch(indexed, 'SUBSTACK2'),
      ]
      if (indexed.opcode === 'control_if') branchRefs[1] = null
      const branches = branchRefs.map((branch) =>
      {
        return branch === null
          ? boundarySummary('clean', null)
          : walkBoundarySummary(
              json,
              index,
              branch,
              null,
              graph,
              activeProcedures,
              cache,
              writerKeysByBlock,
              context
            )
      })
      const branchState = branches.every((entry) => entry.state === 'dirty')
        ? 'dirty'
        : branches.every((entry) => entry.state === 'clean')
          ? 'clean'
          : 'indeterminate'
      state = mergeSequentialBoundaryState(state, branchState)
      if (branchState === 'indeterminate')
        possibleReason ??=
          branches.find((entry) => entry.reason)?.reason ??
          'unsupported-feature'

      const branchCompletions = branches.map((entry) => entry.completion)
      if (branchCompletions.every((entry) => entry === 'nonreturning'))
        return boundarySummary(
          state,
          state === 'dirty' ? null : possibleReason,
          definiteWrites,
          possibleWrites,
          'nonreturning'
        )
      if (branchCompletions.some((entry) => entry !== 'returns'))
        completionIndeterminate = true

      const branchWriteKeys = new Set<string>()
      for (const branch of branches) addPossibleWrites(branchWriteKeys, branch)
      for (const writerKey of branchWriteKeys)
      {
        if (branches.every((branch) => branch.definiteWrites.has(writerKey)))
        {
          definiteWrites.add(writerKey)
          possibleWrites.delete(writerKey)
        }
        else if (!definiteWrites.has(writerKey)) possibleWrites.add(writerKey)
      }
    }

    if (indexed.opcode === 'control_stop')
    {
      const block = rawBlock(json, current)
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
          'nonreturning'
        )
    }

    const boundary = evaluateBoundary(json, index, current, context.state)
    if (boundary?.state === 'triggered')
      state = mergeSequentialBoundaryState(state, 'dirty')
    else if (boundary?.state === 'indeterminate')
    {
      state = mergeSequentialBoundaryState(state, 'indeterminate')
      possibleReason ??=
        boundary.indeterminateReason === 'unresolved-receivers'
          ? 'unsupported-feature'
          : (boundary.indeterminateReason ?? 'unsupported-feature')
    }
    if (
      indexed.opcode === 'control_wait_until' &&
      literalBooleanCondition(json, current) === false
    )
      return boundarySummary(
        state,
        state === 'dirty' ? null : possibleReason,
        definiteWrites,
        possibleWrites,
        'nonreturning'
      )
    current = indexed.successor
  }
  if (stopKey !== null)
    return boundarySummary(
      'indeterminate',
      'unresolved-closure',
      definiteWrites,
      possibleWrites,
      'indeterminate'
    )
  return boundarySummary(
    state === 'clean' && possibleReason ? 'indeterminate' : state,
    state === 'dirty' ? null : possibleReason,
    definiteWrites,
    possibleWrites,
    completionIndeterminate ? 'indeterminate' : 'returns'
  )
}

export function evaluateExecutionWindow(
  json: ProjectJson,
  index: ProjectIndex,
  start: BlockRef | null,
  stop: BlockRef,
  graph: ProcedureCallGraph,
  state: WarpState,
  cache: ProcedureBoundarySummaryCache = new Map(),
  writerKeysByBlock: ReadonlyMap<string, readonly string[]> = new Map()
): ExecutionBoundarySummary
{
  if (state === 'mixed')
    return boundarySummary('indeterminate', 'mixed-warp-callers')
  return walkBoundarySummary(
    json,
    index,
    start,
    stop,
    graph,
    new Set(),
    cache,
    writerKeysByBlock,
    { state, parentState: state }
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
  warpState: WarpState
): PrefixWalkResult
{
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
  const result = walkPrefix(
    json,
    index,
    script,
    activeProcedures,
    procedure.warp === true ? 'warp' : warpState
  )
  activeProcedures.delete(key)
  if (topologyIssues(procedure).length > 0)
  {
    return {
      blockIds: [],
      possibleBlockIds: [...result.blockIds, ...result.possibleBlockIds],
      terminated: result.terminated,
      indeterminateReason: 'unresolved-closure',
    }
  }
  return result
}

function walkPrefix(
  json: ProjectJson,
  index: ProjectIndex,
  script: IndexedScript,
  activeProcedures: Set<string>,
  warpState: WarpState
): PrefixWalkResult
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
    ;(definite ? blockIds : possibleBlockIds).push(current.blockId)

    if (indexed.opcode === 'procedures_call')
    {
      const callee = calledProcedure(json, index, current)
      if (callee)
      {
        const nested = walkProcedurePrefix(
          json,
          index,
          callee,
          activeProcedures,
          warpState
        )
        if (definite)
        {
          blockIds.push(...nested.blockIds)
          possibleBlockIds.push(...nested.possibleBlockIds)
        }
        else
        {
          possibleBlockIds.push(...nested.blockIds, ...nested.possibleBlockIds)
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
    const boundary = evaluateBoundary(json, index, current, warpState)
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

export function prefixWalk(
  json: ProjectJson,
  index: ProjectIndex,
  script: IndexedScript,
  seenProcedures: Set<string> = new Set()
): PrefixWalkResult
{
  return walkPrefix(json, index, script, seenProcedures, 'non-warp')
}
