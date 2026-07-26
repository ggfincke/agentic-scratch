// packages/static/src/index.ts
// public surface for the Layer 2 static analyzer (smells, bug patterns, metrics)

export * from './helpers.js'
export * from './checks.js'
export * from './analyze.js'
export * from './fragility/fragility-types.js'
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
