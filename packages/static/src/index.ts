// packages/static/src/index.ts
// public surface for the Layer 2 static analyzer (smells, bug patterns, metrics)

export * from './helpers.js'
export * from './checks.js'
export * from './analyze.js'
export * from './text/scratchblocks.js'
export * from './fragility/fragility-types.js'
export {
  FRAGILITY_ANALYSIS_POLICY_V1,
  FRAGILITY_ANALYSIS_POLICY_SHA256_V1,
} from './fragility/analysis-budget.js'
export type {
  FragilityBudgetEvidenceV1,
  FragilityBudgetLimitV1,
} from './fragility/analysis-budget.js'
export * from './fragility/boundary-model.js'
export * from './fragility/analyze-fragility.js'
export * from './fragility/signatures.js'
export {
  buildProcedureCallGraph,
  effectiveWarp,
  evaluateBoundary,
  evaluateExecutionWindow,
  mixedContext,
  prefixWalk,
  procedureCanReturn,
  procedureEntryWarpState,
  procedureExecution,
  scriptExecution,
} from './fragility/closure-walker.js'
export type {
  BoundaryEvaluation,
  BoundaryState,
  ExecutionBoundarySummary,
  PrefixWalkResult,
  ProcedureBoundarySummaryCache,
  ProcedureCallGraph,
  ProcedureClosureIssue,
  ProcedureExecution,
  ProcedureExecutionBlock,
  ProcedureReturnCache,
  WarpState,
} from './fragility/closure-walker.js'
