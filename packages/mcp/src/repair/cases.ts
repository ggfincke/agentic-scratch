// packages/mcp/src/repair/cases.ts
// resolve external R1-R5 IDs to fresh trusted benchmark cases

import {
  buildRepairBenchmark,
  REPAIR_BENCHMARK_IDS as REPAIR_CASE_IDS,
  type RepairBenchmarkDefinition,
  type RepairBenchmarkId,
} from '@scratch-agent/repair'

import { RepairMcpBoundaryError } from '../transport/errors.js'

export { REPAIR_CASE_IDS }

export function isRepairCaseId(value: unknown): value is RepairBenchmarkId
{
  return (
    typeof value === 'string' &&
    REPAIR_CASE_IDS.includes(value as RepairBenchmarkId)
  )
}

export function registeredRepairCase(
  caseId: unknown
): RepairBenchmarkDefinition
{
  if (!isRepairCaseId(caseId))
  {
    throw new RepairMcpBoundaryError(
      'mcp.case-unknown',
      'caseId must be one of R1, R2, R3, R4, or R5'
    )
  }
  return buildRepairBenchmark(caseId)
}
