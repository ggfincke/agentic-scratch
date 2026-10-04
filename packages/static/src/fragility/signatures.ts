// packages/static/src/fragility/signatures.ts
// five isolated fragility signature evaluators

import {
  blockKey,
  declarationKey,
  procedureKey,
  scriptKey,
  type BlockRef,
  type IndexedBlock,
  type IndexedDeclaration,
  type IndexedProcedure,
  type IndexedScript,
  type ListRef,
  type ScriptRef,
  type VariableRef,
} from '@scratch-agent/ir'
import {
  scratchRecordValue,
  type Block,
  type ProjectJson,
} from '@scratch-agent/sb3'
import { isBlock, type ProjectIndex } from '@scratch-agent/validate'

import { isLiteralPrimitive, primarySlot } from '../helpers.js'
import {
  buildProcedureCallGraph,
  effectiveWarp,
  evaluateBoundary,
  evaluateExecutionWindow,
  executionSequenceReturnState,
  mixedContext,
  prefixWalk,
  procedureExecution,
  procedureReturnState,
  type ProcedureBoundarySummaryCache,
  type ProcedureCallGraph,
  type ProcedureExecutionBlock,
  type ProcedureReturnCache,
} from './closure-walker.js'
import type {
  FragilityConfidence,
  FragilityEvidenceBlock,
  FragilityFinding,
  FragilityIndeterminateReason,
} from './fragility-types.js'
import { FragilityAnalysisBudgetV1 } from './analysis-budget.js'

const PROBES = new Set([
  'sensing_touchingobject',
  'sensing_touchingcolor',
  'sensing_coloristouchingcolor',
])
const MIXED_CONTEXT_NOTE =
  'also reachable via non-warp chain: runs unwarped in that context'

type Declaration = IndexedDeclaration<VariableRef | ListRef>
type VariableDeclaration = IndexedDeclaration<VariableRef>
type PositionAxis = 'x' | 'y'

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

function indexedBlock(
  index: ProjectIndex,
  ref: BlockRef,
  budget: FragilityAnalysisBudgetV1 = new FragilityAnalysisBudgetV1()
): IndexedBlock | undefined
{
  budget.work()

  return index.semantic.blockByKey.get(blockKey(ref))
}

function evidence(
  index: ProjectIndex,
  ref: BlockRef,
  role: string,
  detail: string,
  budget: FragilityAnalysisBudgetV1 = new FragilityAnalysisBudgetV1()
): FragilityEvidenceBlock
{
  budget.work()

  return {
    targetName: ref.target.name,
    blockId: ref.blockId,
    opcode: indexedBlock(index, ref, budget)?.opcode ?? 'unknown',
    role,
    detail,
  }
}

function procedureCounterEvidence(
  procedure: IndexedProcedure,
  graph: ProcedureCallGraph,
  budget: FragilityAnalysisBudgetV1 = new FragilityAnalysisBudgetV1()
): string[]
{
  budget.work()

  return mixedContext(procedure, graph, budget) ? [MIXED_CONTEXT_NOTE] : []
}

function procedureFinding(
  index: ProjectIndex,
  procedure: IndexedProcedure,
  graph: ProcedureCallGraph,
  ref: BlockRef,
  confidence: FragilityConfidence,
  role: string,
  detail: string,
  message: string,
  budget: FragilityAnalysisBudgetV1 = new FragilityAnalysisBudgetV1()
): FragilityFinding
{
  budget.work()

  return {
    signature: 'fragility.warp-break',
    class: 'flagged',
    severity: 'high',
    confidence,
    verdict: 'witnessed',
    indeterminateReason: null,
    targetName: procedure.target.name,
    topBlockId: procedure.runtimeDefinition?.blockId ?? null,
    message,
    evidence: [evidence(index, ref, role, detail, budget)],
    counterEvidence: procedureCounterEvidence(procedure, graph, budget),
  }
}

function indeterminateProcedureFinding(
  index: ProjectIndex,
  procedure: IndexedProcedure,
  graph: ProcedureCallGraph,
  ref: BlockRef | null,
  reason: FragilityIndeterminateReason,
  role: string,
  detail: string,
  message: string,
  budget: FragilityAnalysisBudgetV1 = new FragilityAnalysisBudgetV1()
): FragilityFinding
{
  budget.work()

  return {
    signature: 'fragility.warp-break',
    class: 'flagged',
    severity: 'high',
    confidence: 'low',
    verdict: 'indeterminate',
    indeterminateReason: reason,
    targetName: procedure.target.name,
    topBlockId: procedure.runtimeDefinition?.blockId ?? null,
    message,
    evidence: ref ? [evidence(index, ref, role, detail, budget)] : [],
    counterEvidence: procedureCounterEvidence(procedure, graph, budget),
  }
}

function waitDuration(
  json: ProjectJson,
  ref: BlockRef,
  budget: FragilityAnalysisBudgetV1 = new FragilityAnalysisBudgetV1()
): number | null
{
  budget.work()

  const block = rawBlock(json, ref, budget)
  const input = block ? scratchRecordValue(block.inputs, 'DURATION') : undefined
  if (!input) return null
  const slot = primarySlot(input)
  if (!Array.isArray(slot) || !isLiteralPrimitive(slot)) return null
  const value = Number(slot[1])
  return Number.isFinite(value) ? value : null
}

function literalBooleanInput(
  json: ProjectJson,
  ref: BlockRef,
  inputName: string,
  budget: FragilityAnalysisBudgetV1 = new FragilityAnalysisBudgetV1()
): boolean | null
{
  budget.work()

  const block = rawBlock(json, ref, budget)
  const input = block ? scratchRecordValue(block.inputs, inputName) : undefined
  if (!input) return null
  const slot = primarySlot(input)
  if (!Array.isArray(slot) || !isLiteralPrimitive(slot)) return null
  const value = slot[1]
  if (typeof value === 'string')
    return !(value === '' || value === '0' || value.toLowerCase() === 'false')
  return Boolean(value)
}

export function findWarpBreaks(
  json: ProjectJson,
  index: ProjectIndex,
  budget: FragilityAnalysisBudgetV1 = new FragilityAnalysisBudgetV1()
): FragilityFinding[]
{
  budget.work()

  const findings: FragilityFinding[] = []
  const graph = buildProcedureCallGraph(json, index, budget)
  const owners = procedureOwners(index, budget)

  for (const procedure of index.semantic.procedures)
  {
    budget.work()

    if (procedure.warpEncoding !== 'malformed') continue
    const ref =
      procedure.runtimePrototype ??
      procedure.prototypes[0] ??
      procedure.runtimeDefinition
    findings.push(
      budget.retainFinding(
        indeterminateProcedureFinding(
          index,
          procedure,
          graph,
          ref,
          'malformed-warp',
          'warp-encoding',
          'warp value cannot be decoded',
          `procedure "${procedure.proccode}" has malformed warp metadata`,
          budget
        )
      )
    )
  }

  interface ExecutionOccurrence
  {
    block: ProcedureExecutionBlock
    executionId: number
    root: IndexedProcedure
  }

  const ownWarpProcedures = index.semantic.procedures.filter((procedure) =>
  {
    budget.work()
    return procedure.warp === true
  })
  const roots = ownWarpProcedures.filter((procedure) =>
  {
    budget.work()

    const key = procedureKey(procedure.target, procedure.proccode)
    const callers = graph.callersByProcedure.get(key) ?? []
    return (
      callers.length === 0 ||
      (graph.nonProcedureCallers.get(key)?.length ?? 0) > 0 ||
      callers.some((caller) =>
      {
        budget.work()
        return (
          !effectiveWarp(caller, graph, budget) ||
          mixedContext(caller, graph, budget)
        )
      })
    )
  })
  const executions: {
    blocks: readonly ProcedureExecutionBlock[]
    issueCount: number
    root: IndexedProcedure
  }[] = []
  const coveredProcedures = new Set<string>()
  const closureIssueKeys = new Set<string>()

  const recordExecution = (
    root: IndexedProcedure,
    parentState?: 'non-warp'
  ): void =>
  {
    budget.work()

    const execution = procedureExecution(
      json,
      index,
      root,
      graph,
      parentState,
      budget
    )
    executions.push({
      blocks: execution.blocks,
      issueCount: execution.issues.length,
      root,
    })
    coveredProcedures.add(procedureKey(root.target, root.proccode))
    for (const block of execution.blocks)
    {
      budget.work()

      const topScript = indexedBlock(index, block.ref, budget)?.topScript
      if (!topScript) continue
      const owner = owners.get(
        blockKey({
          target: topScript.target,
          blockId: topScript.topBlockId,
        })
      )
      if (owner)
        coveredProcedures.add(procedureKey(owner.target, owner.proccode))
    }
    for (const issue of execution.issues)
    {
      budget.work()

      const issueKey = `${procedureKey(root.target, root.proccode)}:${issue.ref ? blockKey(issue.ref) : ''}:${issue.detail}`
      if (closureIssueKeys.has(issueKey)) continue
      closureIssueKeys.add(issueKey)
      const finding = indeterminateProcedureFinding(
        index,
        root,
        graph,
        issue.ref,
        'unresolved-closure',
        'closure',
        issue.detail,
        `warp procedure "${root.proccode}" has an incomplete executable closure`,
        budget
      )
      findings.push(budget.retainFinding(finding))
    }
  }

  for (const root of roots)
  {
    budget.work()
    recordExecution(root)
  }
  for (const procedure of ownWarpProcedures)
  {
    budget.work()

    const key = procedureKey(procedure.target, procedure.proccode)
    if (!coveredProcedures.has(key)) recordExecution(procedure, 'non-warp')
  }

  const allBlocks: ExecutionOccurrence[] = budget.scan(
    executions,
    (budgetValues) =>
      budgetValues.flatMap((execution, executionId) =>
      {
        budget.work()
        return budget.scan(execution.blocks, (budgetValues) =>
          budgetValues.map((block) =>
          {
            budget.work()
            return {
              block,
              executionId,
              root: execution.root,
            }
          })
        )
      })
  )
  const occurrences = new Map<string, ExecutionOccurrence[]>()
  for (const occurrence of allBlocks)
  {
    budget.work()

    const key = blockKey(occurrence.block.ref)
    const matching = occurrences.get(key)
    if (matching) matching.push(occurrence)
    else occurrences.set(key, [occurrence])
  }

  for (const entries of occurrences.values())
  {
    budget.work()

    const ref = entries[0]!.block.ref
    const opcode = indexedBlock(index, ref, budget)?.opcode
    if (!opcode) continue
    const topScript = indexedBlock(index, ref, budget)?.topScript
    const owner = topScript
      ? owners.get(
          blockKey({
            target: topScript.target,
            blockId: topScript.topBlockId,
          })
        )
      : undefined
    const procedure = owner ?? entries[0]!.root
    const mixedOwnerContext =
      owner !== undefined && mixedContext(owner, graph, budget)

    if (opcode === 'control_forever')
    {
      const loopKey = blockKey(ref)
      const outcomes = budget.scan(
        entries.filter((entry) =>
        {
          budget.work()
          return entry.block.warpState !== 'non-warp'
        }),
        (budgetValues) =>
          budgetValues.map((entry) =>
          {
            budget.work()

            const descendants = allBlocks.filter((candidate) =>
            {
              budget.work()
              return (
                candidate.executionId === entry.executionId &&
                budget.scan(candidate.block.loopKeys, (budgetValues) =>
                  budgetValues.includes(loopKey)
                )
              )
            })
            const checkpoints = budget
              .scan(descendants, (budgetValues) =>
                budgetValues.map((candidate) =>
                {
                  budget.work()
                  return evaluateBoundary(
                    json,
                    index,
                    candidate.block.ref,
                    candidate.block.warpState,
                    budget
                  )
                })
              )
              .filter((boundary) =>
              {
                budget.work()
                return boundary !== null
              })
            return {
              checkpoint: checkpoints.some((boundary) =>
              {
                budget.work()
                return boundary.state === 'triggered'
              }),
              indeterminate:
                checkpoints.some((boundary) =>
                {
                  budget.work()
                  return boundary.state === 'indeterminate'
                }) ||
                entry.block.warpState === 'mixed' ||
                entry.block.uncertaintyReason !== null ||
                executions[entry.executionId]!.issueCount > 0,
            }
          })
      )
      if (
        outcomes.length === 0 ||
        outcomes.every((entry) =>
        {
          budget.work()
          return entry.checkpoint
        })
      )
        continue
      const uncertain =
        mixedOwnerContext ||
        outcomes.some((entry) =>
        {
          budget.work()
          return entry.indeterminate
        }) ||
        outcomes.some((entry) =>
        {
          budget.work()
          return entry.checkpoint
        })
      if (uncertain)
      {
        findings.push(
          budget.retainFinding(
            indeterminateProcedureFinding(
              index,
              procedure,
              graph,
              ref,
              'unsupported-feature',
              'unbounded',
              'loop checkpoint reachability is not statically conclusive',
              `warp procedure "${procedure.proccode}" may contain an unbounded loop`,
              budget
            )
          )
        )
        continue
      }
      findings.push(
        budget.retainFinding(
          procedureFinding(
            index,
            procedure,
            graph,
            ref,
            'medium',
            'unbounded',
            'unbounded loop has no reachable scheduler checkpoint',
            `warp procedure "${procedure.proccode}" contains an unbounded loop`,
            budget
          )
        )
      )
      continue
    }

    const evaluations = budget.scan(entries, (budgetValues) =>
      budgetValues.map((entry) =>
      {
        budget.work()
        return {
          ...entry,
          boundary: evaluateBoundary(
            json,
            index,
            entry.block.ref,
            entry.block.warpState,
            budget
          ),
        }
      })
    )
    const relevant = evaluations.filter(({ block, boundary }) =>
    {
      budget.work()
      return (
        boundary !== null &&
        block.warpState !== 'non-warp' &&
        boundary.state !== 'not-triggered'
      )
    })
    if (relevant.length === 0) continue

    const hasNonWarpOccurrence =
      entries.some((entry) =>
      {
        budget.work()
        return entry.block.warpState === 'non-warp'
      }) || mixedOwnerContext
    const definite = relevant.find(({ block, boundary }) =>
    {
      budget.work()
      return (
        block.warpState === 'warp' &&
        block.uncertaintyReason === null &&
        boundary?.state === 'triggered'
      )
    })
    const uncertain = relevant.find(({ block, boundary }) =>
    {
      budget.work()
      return (
        block.warpState === 'mixed' ||
        block.uncertaintyReason !== null ||
        boundary?.state === 'indeterminate'
      )
    })
    const selected = definite ?? uncertain ?? relevant[0]!
    const boundary = selected.boundary!
    if (!definite || uncertain || hasNonWarpOccurrence)
    {
      const reason =
        hasNonWarpOccurrence || selected.block.warpState === 'mixed'
          ? 'mixed-warp-callers'
          : (boundary.indeterminateReason ??
            selected.block.uncertaintyReason ??
            'unsupported-feature')
      findings.push(
        budget.retainFinding(
          indeterminateProcedureFinding(
            index,
            procedure,
            graph,
            ref,
            reason,
            boundary.kind,
            boundary.detail,
            `warp procedure "${procedure.proccode}" may reach ${opcode} while warp is active`,
            budget
          )
        )
      )
      continue
    }

    findings.push(
      budget.retainFinding(
        procedureFinding(
          index,
          procedure,
          graph,
          ref,
          'high',
          boundary.kind,
          boundary.detail,
          boundary.kind === 'budget-burn'
            ? `warp procedure "${procedure.proccode}" can exhaust its budget at ${opcode}`
            : `warp procedure "${procedure.proccode}" reaches ${opcode}`,
          budget
        )
      )
    )
  }
  return findings
}

function stageDeclarations(
  index: ProjectIndex,
  budget: FragilityAnalysisBudgetV1 = new FragilityAnalysisBudgetV1()
): Declaration[]
{
  budget.work()

  return [
    ...budget.iterable(index.semantic.variables),
    ...budget.iterable(index.semantic.lists),
  ].filter((entry) =>
  {
    budget.work()
    return entry.declaration.declarationTarget.isStage
  })
}

function sameScript(
  left: ScriptRef | null,
  right: ScriptRef | null,
  budget: FragilityAnalysisBudgetV1 = new FragilityAnalysisBudgetV1()
): boolean
{
  budget.work()

  return left !== null && right !== null && scriptKey(left) === scriptKey(right)
}

export function findStartupWriteRaces(
  json: ProjectJson,
  index: ProjectIndex,
  budget: FragilityAnalysisBudgetV1 = new FragilityAnalysisBudgetV1()
): FragilityFinding[]
{
  budget.work()

  const flagScripts: IndexedScript[] = []
  for (const hat of index.semantic.eventHats)
  {
    budget.work()

    if (hat.opcode !== 'event_whenflagclicked') continue
    const script = index.semantic.scriptByKey.get(scriptKey(hat.script))
    if (script) flagScripts.push(script)
  }
  const prefixes = new Map<
    string,
    {
      definite: ReadonlySet<string>
      possible: ReadonlySet<string>
      reason: FragilityIndeterminateReason | null
    }
  >()
  for (const script of flagScripts)
  {
    budget.work()

    const walked = prefixWalk(json, index, script, undefined, budget)
    prefixes.set(scriptKey(script.ref), {
      definite: new Set(budget.iterable(walked.blockIds)),
      possible: new Set(budget.iterable(walked.possibleBlockIds)),
      reason: walked.indeterminateReason,
    })
  }

  const findings: FragilityFinding[] = []
  for (const declaration of stageDeclarations(index, budget))
  {
    budget.work()

    const prefixWriters: {
      writer: (typeof declaration.writers)[number]
      script: ScriptRef
    }[] = []
    const possibleWriters: {
      writer: (typeof declaration.writers)[number]
      script: ScriptRef
      reason: FragilityIndeterminateReason
    }[] = []
    for (const script of flagScripts)
    {
      budget.work()

      const prefix = prefixes.get(scriptKey(script.ref))
      if (!prefix) continue
      for (const writer of declaration.writers)
      {
        budget.work()

        if (
          (writer.access !== 'write' && writer.access !== 'read-write') ||
          writer.block.target.targetIndex !== script.ref.target.targetIndex
        )
          continue
        if (prefix.definite.has(writer.block.blockId))
          prefixWriters.push({ writer, script: script.ref })
        else if (prefix.possible.has(writer.block.blockId))
          possibleWriters.push({
            writer,
            script: script.ref,
            reason: prefix.reason ?? 'unsupported-feature',
          })
      }
    }
    const writerScripts = new Map<string, ScriptRef>()
    for (const entry of prefixWriters)
    {
      budget.work()
      writerScripts.set(scriptKey(entry.script), entry.script)
    }
    const candidateWriterScripts = new Map(budget.iterable(writerScripts))
    for (const entry of possibleWriters)
    {
      budget.work()
      candidateWriterScripts.set(scriptKey(entry.script), entry.script)
    }
    if (candidateWriterScripts.size < 2) continue
    const reader = declaration.readers.find((entry) =>
    {
      budget.work()
      return (
        entry.script !== null &&
        (entry.access === 'read' || entry.access === 'read-write') &&
        [...budget.iterable(candidateWriterScripts.values())].some(
          (writerScript) =>
          {
            budget.work()
            return !sameScript(entry.script, writerScript, budget)
          }
        )
      )
    })
    if (!reader) continue
    const distinctTargets = new Set(
      budget.iterable(
        budget.scan(
          [...budget.iterable(candidateWriterScripts.values())],
          (budgetValues) =>
            budgetValues.map((script) =>
            {
              budget.work()
              return script.target.targetIndex
            })
        )
      )
    )
    const firstWriterScript = candidateWriterScripts.values().next().value as
      ScriptRef | undefined
    const witnessed = writerScripts.size >= 2
    const possibleReason = possibleWriters[0]?.reason ?? 'unsupported-feature'
    findings.push(
      budget.retainFinding({
        signature: 'fragility.startup-write-race',
        class: 'flagged',
        severity: 'medium',
        confidence: witnessed
          ? distinctTargets.size >= 2
            ? 'high'
            : 'medium'
          : 'low',
        verdict: witnessed ? 'witnessed' : 'indeterminate',
        indeterminateReason: witnessed ? null : possibleReason,
        targetName: declaration.declaration.declarationTarget.name,
        topBlockId: firstWriterScript?.topBlockId ?? null,
        message: witnessed
          ? `startup scripts compete to initialize ${declaration.declaration.kind} "${declaration.declaration.name}"`
          : `startup scripts may compete to initialize ${declaration.declaration.kind} "${declaration.declaration.name}"`,
        evidence: [
          ...budget.iterable(
            budget.scan(
              prefixWriters.filter((entry, position, entries) =>
              {
                budget.work()
                return (
                  entries.findIndex((candidate) =>
                  {
                    budget.work()
                    return (
                      blockKey(candidate.writer.block) ===
                      blockKey(entry.writer.block)
                    )
                  }) === position
                )
              }),
              (budgetValues) =>
                budgetValues.map((entry) =>
                {
                  budget.work()
                  return evidence(
                    index,
                    entry.writer.block,
                    'writer',
                    `prefix write from ${entry.script.target.name}`,
                    budget
                  )
                })
            )
          ),
          ...budget.iterable(
            budget.scan(
              possibleWriters.filter((entry, position, entries) =>
              {
                budget.work()
                return (
                  entries.findIndex((candidate) =>
                  {
                    budget.work()
                    return (
                      blockKey(candidate.writer.block) ===
                      blockKey(entry.writer.block)
                    )
                  }) === position
                )
              }),
              (budgetValues) =>
                budgetValues.map((entry) =>
                {
                  budget.work()
                  return evidence(
                    index,
                    entry.writer.block,
                    'possible-writer',
                    `write may be in the startup prefix from ${entry.script.target.name}`,
                    budget
                  )
                })
            )
          ),
          evidence(
            index,
            reader.block,
            'reader',
            `read from ${reader.block.target.name}`,
            budget
          ),
        ],
        counterEvidence: [
          'green-flag start order is deterministic for a fixed project; the race manifests under reordering, remix, or sprite re-layering',
        ],
      })
    )
  }
  return findings
}

function activeInputClosure(
  index: ProjectIndex,
  block: IndexedBlock,
  inputName?: string,
  budget: FragilityAnalysisBudgetV1 = new FragilityAnalysisBudgetV1()
): IndexedBlock[]
{
  budget.work()

  const pending = budget.scan(
    block.inputChildren.filter((child) =>
    {
      budget.work()
      return (
        child.slot === 'primary' &&
        (inputName === undefined || child.inputName === inputName)
      )
    }),
    (budgetValues) =>
      budgetValues.map((child) =>
      {
        budget.work()
        return child.block
      })
  )
  const seen = new Set<string>()
  const closure: IndexedBlock[] = []
  let pendingOffset = 0
  while (pendingOffset < pending.length)
  {
    budget.work()

    const ref = pending[pendingOffset++]!
    const key = blockKey(ref)
    if (seen.has(key)) continue
    seen.add(key)
    const child = indexedBlock(index, ref, budget)
    if (!child) continue
    closure.push(child)
    budget.append(
      pending,
      budget.scan(
        child.inputChildren.filter((entry) =>
        {
          budget.work()
          return entry.slot === 'primary'
        }),
        (budgetValues) =>
          budgetValues.map((entry) =>
          {
            budget.work()
            return entry.block
          })
      )
    )
  }
  return closure
}

function activeInputContains(
  index: ProjectIndex,
  block: IndexedBlock,
  opcodes: ReadonlySet<string>,
  inputName?: string,
  budget: FragilityAnalysisBudgetV1 = new FragilityAnalysisBudgetV1()
): boolean
{
  budget.work()

  return activeInputClosure(index, block, inputName, budget).some((entry) =>
  {
    budget.work()
    return entry.opcode !== null && opcodes.has(entry.opcode)
  })
}

function stackChain(
  json: ProjectJson,
  index: ProjectIndex,
  script: IndexedScript,
  returnCache: ProcedureReturnCache,
  stopAtNonreturningCalls: 'none' | 'definite' | 'uncertain',
  budget: FragilityAnalysisBudgetV1 = new FragilityAnalysisBudgetV1()
): IndexedBlock[]
{
  budget.work()

  const chain: IndexedBlock[] = []
  const seen = new Set<string>()
  let current: BlockRef | null = script.top
  while (current)
  {
    budget.work()

    const key = blockKey(current)
    if (seen.has(key)) break
    seen.add(key)
    const block = indexedBlock(index, current, budget)
    if (!block) break
    chain.push(block)
    if (block.opcode === 'control_forever') break
    if (block.opcode === 'control_stop')
    {
      const raw = rawBlock(json, block.ref, budget)
      const option = raw
        ? scratchRecordValue(raw.fields, 'STOP_OPTION')
        : undefined
      if (
        option === undefined ||
        String(option[0]).toLowerCase() !== 'other scripts in sprite'
      )
        break
    }
    if (
      block.opcode === 'control_wait_until' ||
      block.opcode === 'control_repeat_until' ||
      block.opcode === 'control_while'
    )
    {
      const condition = literalBooleanInput(
        json,
        block.ref,
        'CONDITION',
        budget
      )
      const nonreturning =
        block.opcode === 'control_while'
          ? condition === true
          : condition === false
      if (
        nonreturning ||
        (condition === null && stopAtNonreturningCalls === 'uncertain')
      )
        break
    }
    const controlState = directControlReturnState(
      json,
      index,
      block,
      returnCache,
      budget
    )
    if (
      controlState === 'nonreturning' ||
      (controlState === 'indeterminate' &&
        stopAtNonreturningCalls === 'uncertain')
    )
      break
    if (
      stopAtNonreturningCalls !== 'none' &&
      block.opcode === 'procedures_call'
    )
    {
      const raw = rawBlock(json, block.ref, budget)
      const proccode = raw?.mutation?.proccode
      const procedure =
        typeof proccode === 'string'
          ? index.semantic.procedureByKey.get(
              procedureKey(block.ref.target, proccode)
            )
          : undefined
      const state = procedure
        ? procedureReturnState(
            json,
            index,
            procedure,
            returnCache,
            undefined,
            budget
          )
        : 'indeterminate'
      if (
        state === 'nonreturning' ||
        (state === 'indeterminate' && stopAtNonreturningCalls === 'uncertain')
      )
        break
    }
    current = block.successor
  }
  return chain
}

function controlBranch(
  block: IndexedBlock,
  inputName: 'SUBSTACK' | 'SUBSTACK2',
  budget: FragilityAnalysisBudgetV1 = new FragilityAnalysisBudgetV1()
): BlockRef | null | undefined
{
  budget.work()

  const branches = block.inputChildren.filter((entry) =>
  {
    budget.work()
    return entry.inputName === inputName && entry.slot === 'primary'
  })
  if (branches.length > 1) return undefined
  return branches[0]?.block ?? null
}

function directControlReturnState(
  json: ProjectJson,
  index: ProjectIndex,
  block: IndexedBlock,
  cache: ProcedureReturnCache,
  budget: FragilityAnalysisBudgetV1 = new FragilityAnalysisBudgetV1()
): 'returns' | 'nonreturning' | 'indeterminate'
{
  budget.work()

  if (block.opcode !== 'control_if' && block.opcode !== 'control_if_else')
    return 'returns'
  const left = controlBranch(block, 'SUBSTACK', budget)
  if (left === undefined) return 'indeterminate'
  const leftState =
    left === null
      ? 'returns'
      : executionSequenceReturnState(json, index, left, cache, budget)
  if (block.opcode === 'control_if')
    return leftState === 'returns' ? 'returns' : 'indeterminate'
  const right = controlBranch(block, 'SUBSTACK2', budget)
  if (right === undefined) return 'indeterminate'
  const rightState =
    right === null
      ? 'returns'
      : executionSequenceReturnState(json, index, right, cache, budget)
  if (leftState === 'nonreturning' && rightState === 'nonreturning')
    return 'nonreturning'
  if (leftState === 'returns' && rightState === 'returns') return 'returns'
  return 'indeterminate'
}

function procedureOwners(
  index: ProjectIndex,
  budget: FragilityAnalysisBudgetV1 = new FragilityAnalysisBudgetV1()
): ReadonlyMap<string, IndexedProcedure>
{
  budget.work()

  const owners = new Map<string, IndexedProcedure>()
  for (const procedure of index.semantic.procedures)
  {
    budget.work()

    if (procedure.runtimeDefinition)
      owners.set(blockKey(procedure.runtimeDefinition), procedure)
  }
  return owners
}

interface VariableReader
{
  declaration: VariableDeclaration
  use: VariableDeclaration['readers'][number]
}

interface VariableUseLookup
{
  writersByBlock: ReadonlyMap<string, readonly VariableDeclaration[]>
  writerKeysByBlock: ReadonlyMap<string, readonly string[]>
  readersByBlock: ReadonlyMap<string, readonly VariableReader[]>
}

interface PositionSave
{
  axis: PositionAxis
  declaration: VariableDeclaration
}

interface ProbeSequence
{
  axis: PositionAxis
  declaration: VariableDeclaration
  saveIndex: number
  teleportIndex: number
  probeIndex: number
  restoreIndex: number
}

interface ProbeWindowEvaluation
{
  state: 'clean' | 'dirty' | 'indeterminate'
  completion: 'returns' | 'nonreturning' | 'indeterminate'
  warpState: 'warp' | 'non-warp' | 'mixed'
  reason: FragilityIndeterminateReason | null
  dataflow: 'valid' | 'invalid' | 'indeterminate'
}

function addGroupedValue<T>(
  groups: Map<string, T[]>,
  key: string,
  value: T,
  budget: FragilityAnalysisBudgetV1 = new FragilityAnalysisBudgetV1()
): void
{
  budget.work()

  const values = groups.get(key)
  if (values) values.push(value)
  else groups.set(key, [value])
}

function variableUseLookup(
  index: ProjectIndex,
  budget: FragilityAnalysisBudgetV1 = new FragilityAnalysisBudgetV1()
): VariableUseLookup
{
  budget.work()

  const writersByBlock = new Map<string, VariableDeclaration[]>()
  const writerKeysByBlock = new Map<string, string[]>()
  const readersByBlock = new Map<string, VariableReader[]>()
  for (const declaration of index.semantic.variables)
  {
    budget.work()

    for (const writer of declaration.writers)
    {
      budget.work()

      if (writer.access !== 'write' && writer.access !== 'read-write') continue
      const key = blockKey(writer.block)
      addGroupedValue(writersByBlock, key, declaration, budget)
      addGroupedValue(
        writerKeysByBlock,
        key,
        declarationKey(declaration.declaration),
        budget
      )
    }
    for (const use of declaration.readers)
    {
      budget.work()

      if (use.access !== 'read' && use.access !== 'read-write') continue
      addGroupedValue(
        readersByBlock,
        blockKey(use.block),
        {
          declaration,
          use,
        },
        budget
      )
    }
  }
  return { writersByBlock, writerKeysByBlock, readersByBlock }
}

function positionSave(
  index: ProjectIndex,
  block: IndexedBlock,
  uses: VariableUseLookup,
  budget: FragilityAnalysisBudgetV1 = new FragilityAnalysisBudgetV1()
): PositionSave | null
{
  budget.work()

  if (block.opcode !== 'data_setvariableto') return null
  const valueInputs = block.inputChildren.filter((input) =>
  {
    budget.work()
    return input.inputName === 'VALUE' && input.slot === 'primary'
  })
  if (valueInputs.length !== 1) return null
  const value = indexedBlock(index, valueInputs[0]!.block, budget)
  const axis =
    value?.ownershipStatus === 'unique' && value.opcode === 'motion_xposition'
      ? 'x'
      : value?.ownershipStatus === 'unique' &&
          value.opcode === 'motion_yposition'
        ? 'y'
        : null
  const writers = uses.writersByBlock.get(blockKey(block.ref)) ?? []
  if (axis === null || writers.length !== 1) return null
  return {
    axis,
    declaration: writers[0]!,
  }
}

function motionMutatesAxis(
  opcode: string | null,
  axis: PositionAxis,
  budget: FragilityAnalysisBudgetV1 = new FragilityAnalysisBudgetV1()
): boolean
{
  budget.work()

  if (opcode === 'motion_gotoxy') return true
  return axis === 'x'
    ? opcode === 'motion_setx' || opcode === 'motion_changexby'
    : opcode === 'motion_sety' || opcode === 'motion_changeyby'
}

function restoreInputName(
  opcode: string | null,
  axis: PositionAxis,
  budget: FragilityAnalysisBudgetV1 = new FragilityAnalysisBudgetV1()
): string | null
{
  budget.work()

  if (opcode === 'motion_gotoxy') return axis.toUpperCase()
  if (axis === 'x' && opcode === 'motion_setx') return 'X'
  if (axis === 'y' && opcode === 'motion_sety') return 'Y'
  return null
}

function inputVariableDeclarations(
  index: ProjectIndex,
  block: IndexedBlock,
  inputName: string,
  uses: VariableUseLookup,
  budget: FragilityAnalysisBudgetV1 = new FragilityAnalysisBudgetV1()
): VariableDeclaration[]
{
  budget.work()

  const declarations = new Map<string, VariableDeclaration>()
  const direct = uses.readersByBlock.get(blockKey(block.ref)) ?? []
  for (const reader of direct)
  {
    budget.work()

    if (
      reader.use.source === 'input-primitive' &&
      reader.use.siteName === inputName &&
      reader.use.inputSlotIndex === 1
    )
      declarations.set(
        declarationKey(reader.declaration.declaration),
        reader.declaration
      )
  }
  const children = budget
    .scan(
      block.inputChildren.filter((entry) =>
      {
        budget.work()
        return entry.inputName === inputName && entry.slot === 'primary'
      }),
      (budgetValues) =>
        budgetValues.map((entry) =>
        {
          budget.work()
          return indexedBlock(index, entry.block, budget)
        })
    )
    .filter((entry): entry is IndexedBlock =>
    {
      budget.work()
      return (
        entry !== undefined &&
        entry.ownershipStatus === 'unique' &&
        entry.opcode === 'data_variable'
      )
    })
  for (const child of children)
  {
    budget.work()

    for (const reader of uses.readersByBlock.get(blockKey(child.ref)) ?? [])
    {
      budget.work()
      declarations.set(
        declarationKey(reader.declaration.declaration),
        reader.declaration
      )
    }
  }
  return [...budget.iterable(declarations.values())]
}

function firstPositionAfter(
  positions: readonly number[],
  lowerExclusive: number,
  upperExclusive: number,
  budget: FragilityAnalysisBudgetV1 = new FragilityAnalysisBudgetV1()
): number | null
{
  budget.work()

  let low = 0
  let high = positions.length
  while (low < high)
  {
    budget.work()

    const middle = Math.floor((low + high) / 2)
    if (positions[middle]! <= lowerExclusive) low = middle + 1
    else high = middle
  }
  const selected = positions[low]
  return selected !== undefined && selected < upperExclusive ? selected : null
}

function latestPositionBefore(
  positions: readonly number[],
  upperExclusive: number,
  budget: FragilityAnalysisBudgetV1 = new FragilityAnalysisBudgetV1()
): number | null
{
  budget.work()

  let low = 0
  let high = positions.length
  while (low < high)
  {
    budget.work()

    const middle = Math.floor((low + high) / 2)
    if (positions[middle]! < upperExclusive) low = middle + 1
    else high = middle
  }
  return low === 0 ? null : positions[low - 1]!
}

function probeSequence(
  index: ProjectIndex,
  chain: readonly IndexedBlock[],
  uses: VariableUseLookup,
  budget: FragilityAnalysisBudgetV1 = new FragilityAnalysisBudgetV1()
): ProbeSequence | null
{
  budget.work()

  const saves = new Map<VariableDeclaration, Record<PositionAxis, number[]>>()
  const writes = new Map<VariableDeclaration, number[]>()
  const teleports: Record<PositionAxis, number[]> = { x: [], y: [] }
  const probes: number[] = []

  for (let position = 0; position < chain.length; position++)
  {
    budget.work()

    const block = chain[position]!
    for (const declaration of uses.writersByBlock.get(blockKey(block.ref)) ??
      [])
      {
      budget.work()

      const positions = writes.get(declaration) ?? []
      positions.push(position)
      writes.set(declaration, positions)
    }
    const save = positionSave(index, block, uses, budget)
    if (save)
    {
      const byAxis = saves.get(save.declaration) ?? { x: [], y: [] }
      byAxis[save.axis].push(position)
      saves.set(save.declaration, byAxis)
    }
    for (const axis of ['x', 'y'] as const)
    {
      budget.work()

      if (motionMutatesAxis(block.opcode, axis, budget))
        teleports[axis].push(position)
    }
    if (activeInputContains(index, block, PROBES, undefined, budget))
      probes.push(position)
  }

  for (let restoreIndex = 0; restoreIndex < chain.length; restoreIndex++)
  {
    budget.work()

    const restore = chain[restoreIndex]!
    for (const axis of ['x', 'y'] as const)
    {
      budget.work()

      const inputName = restoreInputName(restore.opcode, axis, budget)
      if (!inputName) continue
      const declarations = inputVariableDeclarations(
        index,
        restore,
        inputName,
        uses,
        budget
      )
      for (const declaration of declarations)
      {
        budget.work()

        const saveIndex = latestPositionBefore(
          saves.get(declaration)?.[axis] ?? [],
          restoreIndex,
          budget
        )
        if (saveIndex === null) continue
        if (
          firstPositionAfter(
            writes.get(declaration) ?? [],
            saveIndex,
            restoreIndex,
            budget
          ) !== null
        )
          continue
        const teleportIndex = firstPositionAfter(
          teleports[axis],
          saveIndex,
          restoreIndex,
          budget
        )
        if (teleportIndex === null) continue
        const probeIndex = firstPositionAfter(
          probes,
          teleportIndex,
          restoreIndex,
          budget
        )
        if (probeIndex === null) continue
        return {
          axis,
          declaration,
          saveIndex,
          teleportIndex,
          probeIndex,
          restoreIndex,
        }
      }
    }
  }
  return null
}

function probeWindowEvaluation(
  json: ProjectJson,
  index: ProjectIndex,
  chain: readonly IndexedBlock[],
  sequence: ProbeSequence,
  graph: ProcedureCallGraph,
  owner: IndexedProcedure | undefined,
  cache: ProcedureBoundarySummaryCache,
  returnCache: ProcedureReturnCache,
  writerKeysByBlock: ReadonlyMap<string, readonly string[]>,
  budget: FragilityAnalysisBudgetV1 = new FragilityAnalysisBudgetV1()
): ProbeWindowEvaluation
{
  budget.work()

  const save = chain[sequence.saveIndex]!
  const restore = chain[sequence.restoreIndex]!
  let warpState: 'warp' | 'non-warp' | 'mixed' = 'non-warp'
  let prefixIncomplete = false
  if (owner)
  {
    const execution = procedureExecution(
      json,
      index,
      owner,
      graph,
      undefined,
      budget
    )
    const firstPositionByBlock = new Map<string, number>()
    const saveStates: ('warp' | 'non-warp' | 'mixed')[] = []
    const saveKey = blockKey(save.ref)
    for (let position = 0; position < execution.blocks.length; position++)
    {
      budget.work()

      const entry = execution.blocks[position]!
      const key = blockKey(entry.ref)
      if (!firstPositionByBlock.has(key))
        firstPositionByBlock.set(key, position)
      if (key === saveKey) saveStates.push(entry.warpState)
    }
    const savePosition = firstPositionByBlock.get(saveKey) ?? -1
    prefixIncomplete = execution.issues.some((issue) =>
    {
      budget.work()

      if (issue.ref === null) return true
      const issuePosition = firstPositionByBlock.get(blockKey(issue.ref))
      return issuePosition === undefined || issuePosition < savePosition
    })
    warpState = saveStates.reduce<'warp' | 'non-warp' | 'mixed'>(
      (state, next) =>
      {
        budget.work()
        return state === next ? state : 'mixed'
      },
      saveStates[0] ?? 'mixed'
    )
  }
  for (let position = 0; position < sequence.saveIndex; position++)
  {
    budget.work()

    const block = chain[position]!
    if (
      directControlReturnState(json, index, block, returnCache, budget) ===
      'indeterminate'
    )
    {
      prefixIncomplete = true
      break
    }
    if (block.opcode !== 'procedures_call') continue
    const raw = rawBlock(json, block.ref, budget)
    const proccode = raw?.mutation?.proccode
    const procedure =
      typeof proccode === 'string'
        ? index.semantic.procedureByKey.get(
            procedureKey(block.ref.target, proccode)
          )
        : undefined
    if (
      !procedure ||
      procedureReturnState(
        json,
        index,
        procedure,
        returnCache,
        undefined,
        budget
      ) === 'indeterminate'
    )
    {
      prefixIncomplete = true
      break
    }
  }
  let directWindowReason: FragilityIndeterminateReason | null = null
  for (
    let position = sequence.saveIndex + 1;
    position < sequence.restoreIndex;
    position++
  )
  {
    budget.work()

    const block = chain[position]!
    if (block.opcode !== 'procedures_call') continue
    const raw = rawBlock(json, block.ref, budget)
    const proccode = raw?.mutation?.proccode
    const procedure =
      typeof proccode === 'string'
        ? index.semantic.procedureByKey.get(
            procedureKey(block.ref.target, proccode)
          )
        : undefined
    if (!procedure || procedure.runtimeDefinition === null)
    {
      directWindowReason = 'unresolved-closure'
      break
    }
    if (procedure.warpEncoding === 'malformed')
    {
      directWindowReason = 'unsupported-feature'
      break
    }
  }
  const summary = evaluateExecutionWindow(
    json,
    index,
    save.successor,
    restore.ref,
    graph,
    warpState,
    cache,
    writerKeysByBlock,
    budget
  )
  const savedKey = declarationKey(sequence.declaration.declaration)
  const possibleWrite = summary.possibleWrites.has(savedKey)
  const definiteWrite = summary.definiteWrites.has(savedKey)
  return {
    state:
      prefixIncomplete ||
      directWindowReason !== null ||
      possibleWrite ||
      summary.completion === 'indeterminate'
        ? 'indeterminate'
        : summary.state,
    completion: summary.completion,
    warpState,
    reason:
      directWindowReason ??
      summary.reason ??
      (prefixIncomplete ||
      possibleWrite ||
      summary.completion === 'indeterminate'
        ? 'unsupported-feature'
        : null),
    dataflow: definiteWrite
      ? 'invalid'
      : possibleWrite
        ? 'indeterminate'
        : 'valid',
  }
}

export function findWarpProbeRestores(
  json: ProjectJson,
  index: ProjectIndex,
  budget: FragilityAnalysisBudgetV1 = new FragilityAnalysisBudgetV1()
): FragilityFinding[]
{
  budget.work()

  const graph = buildProcedureCallGraph(json, index, budget)
  const owners = procedureOwners(index, budget)
  const uses = variableUseLookup(index, budget)
  const boundaryCache: ProcedureBoundarySummaryCache = new Map()
  const returnCache: ProcedureReturnCache = new Map()
  const findings: FragilityFinding[] = []

  for (const script of index.semantic.scripts)
  {
    budget.work()

    const chain = stackChain(
      json,
      index,
      script,
      returnCache,
      'definite',
      budget
    )
    const sequence = probeSequence(index, chain, uses, budget)
    if (!sequence) continue
    const owner = owners.get(blockKey(script.top))
    const window = probeWindowEvaluation(
      json,
      index,
      chain,
      sequence,
      graph,
      owner,
      boundaryCache,
      returnCache,
      uses.writerKeysByBlock,
      budget
    )
    if (window.dataflow === 'invalid' || window.completion === 'nonreturning')
      continue
    const classification =
      window.state === 'indeterminate' || window.dataflow === 'indeterminate'
        ? 'atomicity is indeterminate because the probe window closure is incomplete'
        : window.warpState === 'warp'
          ? window.state === 'clean'
            ? 'atomicity preserved within the 500 ms budget'
            : 'warp broken inside the probe window'
          : window.state === 'clean'
            ? 'atomic anyway: rendering happens between steps'
            : 'non-atomic probe window'
    findings.push(
      budget.retainFinding({
        signature: 'fragility.warp-probe-restore',
        class: 'advisory',
        severity: 'low',
        confidence:
          window.state === 'indeterminate' ||
          window.dataflow === 'indeterminate'
            ? 'low'
            : 'medium',
        verdict:
          window.state === 'indeterminate' ||
          window.dataflow === 'indeterminate'
            ? 'indeterminate'
            : 'witnessed',
        indeterminateReason: window.reason,
        targetName: script.ref.target.name,
        topBlockId: script.ref.topBlockId,
        message: `probe/restore pattern: ${classification}`,
        evidence: [
          evidence(
            index,
            chain[sequence.saveIndex]!.ref,
            'save',
            `${sequence.axis} position saved`,
            budget
          ),
          evidence(
            index,
            chain[sequence.teleportIndex]!.ref,
            'teleport',
            `sprite ${sequence.axis} position changed`,
            budget
          ),
          evidence(
            index,
            chain[sequence.probeIndex]!.ref,
            'probe',
            'touching reporter evaluated',
            budget
          ),
          evidence(
            index,
            chain[sequence.restoreIndex]!.ref,
            'restore',
            `saved ${sequence.axis} position restored`,
            budget
          ),
        ],
        counterEvidence: [],
      })
    )
  }
  return findings
}

function readerCarrierPosition(
  index: ProjectIndex,
  chainPositions: ReadonlyMap<string, number>,
  reader: Declaration['readers'][number],
  budget: FragilityAnalysisBudgetV1 = new FragilityAnalysisBudgetV1()
): number | null
{
  budget.work()

  if (reader.source === 'input-primitive' && reader.inputSlotIndex !== 1)
    return null
  let current = reader.block
  const seen = new Set<string>()
  while (true)
  {
    budget.work()

    const key = blockKey(current)
    const position = chainPositions.get(key)
    if (position !== undefined) return position
    if (seen.has(key)) return null
    seen.add(key)
    const child = indexedBlock(index, current, budget)
    if (!child || child.ownershipStatus !== 'unique' || !child.parent)
      return null
    const parent = indexedBlock(index, child.parent, budget)
    if (!parent) return null
    const links = parent.inputChildren.filter((entry) =>
    {
      budget.work()
      return (
        entry.slot === 'primary' &&
        blockKey(entry.block) === key &&
        entry.inputName !== 'SUBSTACK' &&
        entry.inputName !== 'SUBSTACK2'
      )
    })
    if (links.length !== 1) return null
    current = child.parent
  }
}

export const MAX_TIMING_BARRIER_FINDINGS = 1_000

export interface BoundedTimingBarrierFindings
{
  findings: FragilityFinding[]
  omittedCount: number
}

function latestWaitBefore<T extends { position: number }>(
  waits: readonly T[],
  upperExclusive: number,
  budget: FragilityAnalysisBudgetV1 = new FragilityAnalysisBudgetV1()
): T | null
{
  budget.work()

  let low = 0
  let high = waits.length
  while (low < high)
  {
    budget.work()

    const middle = Math.floor((low + high) / 2)
    if (waits[middle]!.position < upperExclusive) low = middle + 1
    else high = middle
  }
  return low === 0 ? null : waits[low - 1]!
}

export function findTimingBarrierWaitsBounded(
  json: ProjectJson,
  index: ProjectIndex,
  maximumFindings = MAX_TIMING_BARRIER_FINDINGS,
  budget: FragilityAnalysisBudgetV1 = new FragilityAnalysisBudgetV1()
): BoundedTimingBarrierFindings
{
  budget.work()

  if (!Number.isSafeInteger(maximumFindings) || maximumFindings < 0)
    throw new Error('timing barrier finding limit must be a safe integer')
  const candidates = new Map<Declaration, FragilityFinding>()
  const returnCache: ProcedureReturnCache = new Map()
  const declarations = stageDeclarations(index, budget)
  const declarationsByScript = new Map<
    string,
    Map<Declaration, Declaration['readers'][number][]>
  >()
  const writersByDeclaration = new Map<
    Declaration,
    {
      scriptKey: string
      writer: Declaration['writers'][number]
    }[]
  >()
  for (const declaration of declarations)
  {
    budget.work()

    const writers: {
      scriptKey: string
      writer: Declaration['writers'][number]
    }[] = []
    const seenWriterScripts = new Set<string>()
    for (const writer of declaration.writers)
    {
      budget.work()

      if (
        writer.script === null ||
        (writer.access !== 'write' && writer.access !== 'read-write')
      )
        continue
      const key = scriptKey(writer.script)
      if (seenWriterScripts.has(key)) continue
      seenWriterScripts.add(key)
      writers.push({ scriptKey: key, writer })
      if (writers.length === 2) break
    }
    writersByDeclaration.set(declaration, writers)

    for (const reader of declaration.readers)
    {
      budget.work()

      if (
        reader.script === null ||
        (reader.access !== 'read' && reader.access !== 'read-write')
      )
        continue
      const key = scriptKey(reader.script)
      const declarations =
        declarationsByScript.get(key) ??
        new Map<Declaration, Declaration['readers'][number][]>()
      const readers = declarations.get(declaration) ?? []
      readers.push(reader)
      declarations.set(declaration, readers)
      declarationsByScript.set(key, declarations)
    }
  }

  for (const script of index.semantic.scripts)
  {
    budget.work()

    const chain = stackChain(
      json,
      index,
      script,
      returnCache,
      'uncertain',
      budget
    )
    const chainPositions = new Map(
      budget.iterable(
        budget.scan(chain, (budgetValues) =>
          budgetValues.map((block, position) =>
          {
            budget.work()
            return [blockKey(block.ref), position]
          })
        )
      )
    )
    const waits = budget
      .scan(chain, (budgetValues) =>
        budgetValues.map((block, position) =>
        {
          budget.work()
          return { block, position }
        })
      )
      .filter(({ block }) =>
      {
        budget.work()

        if (block.opcode !== 'control_wait') return false
        const duration = waitDuration(json, block.ref, budget)
        return duration !== null && duration > 0 && duration <= 0.3
      })
    if (waits.length === 0) continue
    const declarations = declarationsByScript.get(scriptKey(script.ref))
    if (!declarations) continue
    for (const [declaration, declarationReaders] of declarations)
    {
      budget.work()

      if (candidates.has(declaration)) continue
      const readers = budget
        .scan(declarationReaders, (budgetValues) =>
          budgetValues.map((reader) =>
          {
            budget.work()
            return {
              reader,
              position: readerCarrierPosition(
                index,
                chainPositions,
                reader,
                budget
              ),
            }
          })
        )
        .filter(
          (
            entry
          ): entry is {
            reader: (typeof declaration.readers)[number]
            position: number
          } =>
          {
            budget.work()
            return entry.position !== null
          }
        )
        .sort((left, right) =>
        {
          budget.work()
          return left.position - right.position
        })
      if (readers.length === 0) continue
      const currentScriptKey = scriptKey(script.ref)
      const otherWriter = writersByDeclaration
        .get(declaration)
        ?.find((entry) =>
        {
          budget.work()
          return entry.scriptKey !== currentScriptKey
        })?.writer
      if (!otherWriter) continue
      const readerEntry = readers.find((entry) =>
      {
        budget.work()
        return latestWaitBefore(waits, entry.position, budget) !== null
      })
      if (!readerEntry) continue
      const wait = latestWaitBefore(waits, readerEntry.position, budget)!
      const finding: FragilityFinding = {
        signature: 'fragility.timing-barrier-wait',
        class: 'advisory',
        severity: 'low',
        confidence: 'medium',
        verdict: 'witnessed',
        indeterminateReason: null,
        targetName: script.ref.target.name,
        topBlockId: script.ref.topBlockId,
        message: `small wait precedes access to shared ${declaration.declaration.kind} "${declaration.declaration.name}"`,
        evidence: [
          evidence(
            index,
            wait.block.ref,
            'wait',
            `${waitDuration(json, wait.block.ref, budget)} second wait`,
            budget
          ),
          evidence(
            index,
            readerEntry.reader.block,
            'reader',
            `reads value written by ${otherWriter.block.target.name}`,
            budget
          ),
        ],
        counterEvidence: [
          'small waits are also ordinary pacing and input debounce',
        ],
      }
      candidates.set(declaration, budget.retainFinding(finding))
    }
  }
  const candidateFindings = [...budget.iterable(candidates.values())]
  return {
    findings: budget.scan(candidateFindings, (budgetValues) =>
      budgetValues.slice(0, maximumFindings)
    ),
    omittedCount: Math.max(0, candidateFindings.length - maximumFindings),
  }
}

export function findTimingBarrierWaits(
  json: ProjectJson,
  index: ProjectIndex,
  budget: FragilityAnalysisBudgetV1 = new FragilityAnalysisBudgetV1()
): FragilityFinding[]
{
  budget.work()

  return findTimingBarrierWaitsBounded(json, index, undefined, budget).findings
}

export function findDeclarationShadowing(
  _json: ProjectJson,
  index: ProjectIndex,
  budget: FragilityAnalysisBudgetV1 = new FragilityAnalysisBudgetV1()
): FragilityFinding[]
{
  budget.work()

  const findings: FragilityFinding[] = []
  for (const kind of ['variable', 'list'] as const)
  {
    budget.work()

    const declarations: readonly Declaration[] =
      kind === 'variable' ? index.semantic.variables : index.semantic.lists
    const groups = new Map<
      string,
      { globals: Declaration[]; locals: Declaration[] }
    >()
    for (const entry of declarations)
    {
      budget.work()

      const name = entry.declaration.name
      const group = groups.get(name) ?? { globals: [], locals: [] }
      if (entry.declaration.declarationTarget.isStage) group.globals.push(entry)
      else group.locals.push(entry)
      groups.set(name, group)
    }
    for (const [name, { globals, locals }] of groups)
    {
      budget.work()

      if (globals.length === 0 || locals.length === 0) continue
      const stage = globals[0]!.declaration.declarationTarget
      findings.push(
        budget.retainFinding({
          signature: 'fragility.declaration-shadowing',
          class: 'advisory',
          severity: 'low',
          confidence: 'high',
          verdict: 'witnessed',
          indeterminateReason: null,
          targetName: stage.name,
          topBlockId: null,
          message: `${kind} "${name}" is declared globally and locally`,
          evidence: [
            ...budget.iterable(
              budget.scan(globals, (budgetValues) =>
                budgetValues.map((entry) =>
                {
                  budget.work()
                  return {
                    targetName: entry.declaration.declarationTarget.name,
                    blockId: entry.declaration.id,
                    opcode:
                      kind === 'variable'
                        ? 'data_variable'
                        : 'data_listcontents',
                    role: 'global',
                    detail: `stage ${kind} declaration "${name}"`,
                  }
                })
              )
            ),
            ...budget.iterable(
              budget.scan(locals, (budgetValues) =>
                budgetValues.map((entry) =>
                {
                  budget.work()
                  return {
                    targetName: entry.declaration.declarationTarget.name,
                    blockId: entry.declaration.id,
                    opcode:
                      kind === 'variable'
                        ? 'data_variable'
                        : 'data_listcontents',
                    role: 'local',
                    detail: `sprite-local ${kind} declaration "${name}"`,
                  }
                })
              )
            ),
          ],
          counterEvidence: [],
        })
      )
    }
  }
  return findings
}
