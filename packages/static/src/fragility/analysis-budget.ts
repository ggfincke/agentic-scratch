// packages/static/src/fragility/analysis-budget.ts
// share deterministic traversal, expansion & partial-evidence limits

import { createHash } from 'node:crypto'
import type { BlockRef } from '@scratch-agent/ir'

import type {
  FragilityFinding,
  FragilityEvidenceBlock,
} from './fragility-types.js'

export const FRAGILITY_ANALYSIS_POLICY_V1 = Object.freeze({
  id: 'fragility-analysis-bounded-v1',
  maximumExpandedOccurrences: 65536,
  maximumDepth: 128,
  maximumWorkUnits: 1048576,
  work: 'function-loop-callback-visits-and-sized-array-materialization',
  dynamicAppend: 'sequential-charged-push',
  partialEvidencePerClass: 200,
  partialOrder: 'encounter-order',
  partialExecutionBlocks: 32,
  partialProjectionWorkReserve: 16384,
})

export const FRAGILITY_ANALYSIS_POLICY_SHA256_V1 = createHash('sha256')
  .update(JSON.stringify(FRAGILITY_ANALYSIS_POLICY_V1))
  .digest('hex')

export type FragilityBudgetLimitV1 =
  'expanded-occurrences' | 'depth' | 'work-units'

export interface FragilityBudgetEvidenceV1
{
  readonly policySha256: string
  readonly limits: {
    readonly expandedOccurrences: number
    readonly depth: number
    readonly workUnits: number
  }
  readonly usage: {
    readonly expandedOccurrences: number
    readonly depth: number
    readonly workUnits: number
  }
  readonly exhaustedBy: FragilityBudgetLimitV1 | null
  readonly partialExecution: readonly FragilityEvidenceBlock[]
}

export class FragilityBudgetExceededV1 extends Error
{
  readonly code = 'FRAGILITY_ANALYSIS_BUDGET_EXCEEDED'

  constructor(readonly limit: FragilityBudgetLimitV1)
  {
    super(`fragility analysis exhausted its ${limit} budget`)
    this.name = 'FragilityBudgetExceededV1'
  }
}

export class FragilityAnalysisBudgetV1
{
  private expandedOccurrences = 0
  private depth = 0
  private maximumDepth = 0
  private workUnits = 0
  private exhaustedBy: FragilityBudgetLimitV1 | null = null
  private readonly partial: FragilityFinding[] = []
  private readonly partialCounts = { flagged: 0, advisory: 0 }
  private readonly partialExecution: FragilityEvidenceBlock[] = []
  private readonly seenCounts = { flagged: 0, advisory: 0 }
  private readonly coverage = new Map<
    string,
    { count: number; indeterminate: number }
  >()

  work(count = 1): void
  {
    if (
      !Number.isSafeInteger(count) ||
      count < 0 ||
      count >
        FRAGILITY_ANALYSIS_POLICY_V1.maximumWorkUnits -
          FRAGILITY_ANALYSIS_POLICY_V1.partialProjectionWorkReserve -
          this.workUnits
    )
      this.exhaust('work-units')
    this.workUnits += count
  }

  occurrence(ref: BlockRef, opcode: string | null): void
  {
    this.work()
    if (
      this.expandedOccurrences >=
      FRAGILITY_ANALYSIS_POLICY_V1.maximumExpandedOccurrences
    )
      this.exhaust('expanded-occurrences')
    this.expandedOccurrences++
    const evidence = {
      targetName: ref.target.name,
      blockId: ref.blockId,
      opcode: opcode ?? 'unavailable',
      role: 'expanded-occurrence',
      detail:
        'bounded executable closure evidence; incomplete analysis cannot certify this occurrence',
    }
    if (
      this.partialExecution.length <
      FRAGILITY_ANALYSIS_POLICY_V1.partialExecutionBlocks
    )
      this.partialExecution.push(evidence)
    else this.partialExecution[this.partialExecution.length - 1] = evidence
  }

  enter(): void
  {
    if (this.depth >= FRAGILITY_ANALYSIS_POLICY_V1.maximumDepth)
      this.exhaust('depth')
    this.depth++
    this.maximumDepth = Math.max(this.maximumDepth, this.depth)
  }

  leave(): void
  {
    this.depth--
  }

  scan<T extends { readonly length: number }, R>(
    values: T,
    operation: (values: T) => R
  ): R
  {
    this.work(values.length)
    return operation(values)
  }

  *iterable<T>(values: Iterable<T>): IterableIterator<T>
  {
    for (const value of values)
    {
      this.work()
      yield value
    }
  }

  // append sequentially so admitted graphs cannot hit variadic call limits
  append<T>(target: T[], values: Iterable<T>): void
  {
    this.work()
    for (const value of values)
    {
      this.work()
      target.push(value)
    }
  }

  retainFinding(finding: FragilityFinding): FragilityFinding
  {
    this.work()
    this.seenCounts[finding.class]++
    const coverage = this.coverage.get(finding.signature) ?? {
      count: 0,
      indeterminate: 0,
    }
    coverage.count++
    if (finding.verdict === 'indeterminate') coverage.indeterminate++
    this.coverage.set(finding.signature, coverage)
    if (
      this.partialCounts[finding.class] <
      FRAGILITY_ANALYSIS_POLICY_V1.partialEvidencePerClass
    )
    {
      this.partialCounts[finding.class]++
      this.partial.push(finding)
    }
    return finding
  }

  partialFindings(): readonly FragilityFinding[]
  {
    return this.partial
  }

  partialOmitted(): { findings: number; advisories: number }
  {
    return {
      findings: this.seenCounts.flagged - this.partialCounts.flagged,
      advisories: this.seenCounts.advisory - this.partialCounts.advisory,
    }
  }

  signatureCounts(signature: string): { count: number; indeterminate: number }
  {
    return this.coverage.get(signature) ?? { count: 0, indeterminate: 0 }
  }

  // terminal projection visits only the already bounded partial evidence
  projectionWork(count = 1): void
  {
    if (
      !Number.isSafeInteger(count) ||
      count < 0 ||
      count > FRAGILITY_ANALYSIS_POLICY_V1.maximumWorkUnits - this.workUnits
    )
      throw new Error('fragility partial projection exceeded its reserved work')
    this.workUnits += count
  }

  evidence(): FragilityBudgetEvidenceV1
  {
    this.projectionWork(
      this.exhaustedBy === null ? 1 : this.partialExecution.length + 1
    )
    return {
      policySha256: FRAGILITY_ANALYSIS_POLICY_SHA256_V1,
      limits: {
        expandedOccurrences:
          FRAGILITY_ANALYSIS_POLICY_V1.maximumExpandedOccurrences,
        depth: FRAGILITY_ANALYSIS_POLICY_V1.maximumDepth,
        workUnits: FRAGILITY_ANALYSIS_POLICY_V1.maximumWorkUnits,
      },
      usage: {
        expandedOccurrences: this.expandedOccurrences,
        depth: this.maximumDepth,
        workUnits: this.workUnits,
      },
      exhaustedBy: this.exhaustedBy,
      partialExecution:
        this.exhaustedBy === null ? [] : [...this.partialExecution],
    }
  }

  private exhaust(limit: FragilityBudgetLimitV1): never
  {
    this.exhaustedBy ??= limit
    throw new FragilityBudgetExceededV1(limit)
  }
}
