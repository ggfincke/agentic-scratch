// packages/eval/src/multimodal/multimodal-report.ts
// authoritative JSON & bounded human projection for a Multimodal evaluation

import { mdCode } from '@scratch-agent/runner'

import { hashMultimodalJson } from './multimodal-contracts.js'
import type { MultimodalEvaluationReportV1 } from './multimodal.js'

export function multimodalReportJson(
  report: MultimodalEvaluationReportV1
): string
{
  return JSON.stringify(report, null, 2) + '\n'
}

export function multimodalReportMarkdown(
  report: MultimodalEvaluationReportV1
): string
{
  const lines = [
    '# Multimodal evaluation',
    '',
    `**${report.verdict.toUpperCase()}**`,
    '',
    'This is a bounded observational result, not a claim of semantic equivalence.',
    '',
    '## Run',
    '',
    `- id: ${mdCode(report.runId)}`,
    `- created: ${mdCode(report.createdAt)}`,
    `- mode: ${mdCode(report.mode)}`,
    `- structural preflight: ${mdCode(report.structuralPreflight)}`,
    `- input sha256: ${mdCode(report.input.artifactSha256)}`,
    `- request sha256: ${mdCode(report.requestSha256)}`,
    `- vlm request sha256: ${mdCode(report.vlmRequest ? hashMultimodalJson(report.vlmRequest) : 'none')}`,
    `- scenario sha256: ${mdCode(report.scenarioSha256)}`,
    `- observation trace sha256: ${mdCode(report.observationTraceSha256)}`,
    `- sample ordinal: ${report.sampleOrdinal}`,
    `- rubric sha256: ${mdCode(report.rubricSha256)}`,
    `- observation plan sha256: ${mdCode(report.observationPlanSha256)}`,
    '',
    '## Evidence selection',
    '',
  ]
  for (const decision of report.selection.decisions)
  {
    lines.push(
      `- ${mdCode(decision.criterionId)}: ${mdCode(decision.decision)} — ${mdCode(decision.reason)}`
    )
  }
  lines.push('', '## Lenses', '')
  if (report.lenses.length === 0) lines.push('_none_')
  for (const lens of report.lenses)
  {
    lines.push(
      `- ${mdCode(lens.specId)} (${mdCode(lens.kind)}): ${mdCode(lens.verdict)}`
    )
    if (lens.inconclusiveReason)
      lines.push(`  - reason: ${mdCode(lens.inconclusiveReason)}`)
    for (const difference of lens.differences)
      lines.push(`  - ${mdCode(difference.path)}: ${mdCode(difference.detail)}`)
    if (lens.omittedDifferenceCount > 0)
      lines.push(
        `  - ${lens.omittedDifferenceCount} additional differences omitted`
      )
  }
  lines.push('', '## VLM calls', '')
  if (report.calls.length === 0) lines.push('_none_')
  for (const call of report.calls)
  {
    lines.push(
      `- ${mdCode(call.mode)} ${mdCode(call.descriptor.provider)}/${mdCode(call.descriptor.model)}: ${mdCode(call.outcome)}, ${call.providerCallCount} provider calls, ${call.latencyMs} ms, cost ${mdCode(call.cost.source)} (${mdCode(call.cost.accountedUsd === null ? 'unknown' : String(call.cost.accountedUsd))} USD)`
    )
  }
  lines.push(
    '',
    '## VLM budget',
    '',
    `- live calls: ${report.budget.liveCallsAttempted} attempted / ${report.budget.liveCallsSettled} settled / ${report.budget.liveCallsReserved} reserved`,
    `- submitted media: ${report.budget.submittedMediaBytes} bytes across ${report.budget.submittedClipIds.length} unique clips`,
    `- charged tokens: ${mdCode(report.budget.chargedInputTokens === null ? 'unknown input' : String(report.budget.chargedInputTokens))} input / ${report.budget.chargedOutputTokens} output`,
    `- charged cost: ${mdCode(report.budget.chargedCostUsd === null ? 'unknown' : String(report.budget.chargedCostUsd))} USD`
  )
  if (report.budget.overrunReasons.length > 0)
    lines.push(
      `- overruns: ${report.budget.overrunReasons.map((reason) => mdCode(reason)).join(', ')}`
    )
  if (report.limitations.length > 0)
  {
    lines.push('', '## Limitations', '')
    for (const limitation of report.limitations)
      lines.push(`- ${mdCode(limitation)}`)
  }
  if (report.issues.length > 0)
  {
    lines.push('', '## Issues', '')
    for (const issue of report.issues)
    {
      lines.push(
        `- ${mdCode(issue.responsibility)} ${mdCode(issue.code)}: ${mdCode(issue.message)}`
      )
    }
  }
  return lines.join('\n') + '\n'
}
