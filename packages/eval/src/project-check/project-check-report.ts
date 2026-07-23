// packages/eval/src/project-check/project-check-report.ts
// render & atomically checkpoint authoritative project-check JSON/Markdown

import { mdCode } from '@scratch-agent/runner'

import { ProjectArtifactStore } from './project-artifacts.js'
import type {
  ProjectCheckReport,
  ProjectCheckStageName,
  ProjectCheckStages,
} from './project-check-contract.js'

const STAGE_NAMES: ProjectCheckStageName[] = [
  'admission',
  'schema',
  'graph',
  'static',
  'roundTrip',
  'vmSmoke',
  'browserSmoke',
]

function projectCheckReportJson(report: ProjectCheckReport): string
{
  return JSON.stringify(report, null, 2) + '\n'
}

function stageRows(stages: ProjectCheckStages): string[]
{
  return STAGE_NAMES.map((name) =>
  {
    const stage = stages[name]
    const timing =
      stage.durationMs === null ? 'n/a' : `${stage.durationMs.toFixed(1)} ms`
    const note =
      stage.issues[0]?.message ?? stage.notRunReason?.message ?? 'complete'
    return `| ${mdCode(name)} | ${stage.required ? 'yes' : 'no'} | ${mdCode(stage.status)} | ${mdCode(timing)} | ${mdCode(note)} |`
  })
}

function diagnosticLines(report: ProjectCheckReport): string[]
{
  const graph = report.stages.graph.evidence
  const statics = report.stages.static.evidence
  return [
    `- graph: ${graph ? `${graph.counts.error} errors, ${graph.counts.warning} warnings, ${graph.counts.info} info` : 'not available'}`,
    `- static: ${statics ? `${statics.counts.error} errors, ${statics.counts.warning} warnings, ${statics.counts.info} info; strict=${statics.strict}` : 'not available'}`,
  ]
}

function metricLines(report: ProjectCheckReport): string[]
{
  if (!report.metrics) return ['_not available_']
  return Object.entries(report.metrics).map(
    ([name, value]) => `- ${mdCode(name)}: ${mdCode(value)}`
  )
}

function artifactLines(report: ProjectCheckReport): string[]
{
  if (report.artifacts.length === 0) return ['_none retained_']
  return report.artifacts.map(
    (artifact) =>
      `- ${mdCode(artifact.path)} — ${mdCode(artifact.kind)}, ${artifact.byteLength} bytes, sha256 ${mdCode(artifact.sha256)}`
  )
}

function projectCheckReportMarkdown(report: ProjectCheckReport): string
{
  const status = report.overall.status === 'passed' ? 'PASS' : 'FAIL'
  const roundTrip = report.stages.roundTrip.evidence
  const vm = report.stages.vmSmoke.evidence
  const browser = report.stages.browserSmoke.evidence
  const performance = report.performance
  return [
    `# Project check ${mdCode(report.runId)}`,
    '',
    `**${status}** — ${mdCode(report.input.displayName)}`,
    '',
    report.overall.stopReason
      ? `Stop reason: ${mdCode(report.overall.stopReason.code)} — ${mdCode(report.overall.stopReason.message)}`
      : 'All required stages passed.',
    '',
    '## Input and runtime identity',
    '',
    `- bytes: ${mdCode(report.input.byteLength ?? 'unavailable')}`,
    `- sha256: ${mdCode(report.input.sha256 ?? 'unavailable')}`,
    `- source revision: ${mdCode(report.sourceRevision)}`,
    `- node: ${mdCode(report.versions.node)}`,
    `- Scratch VM: ${mdCode(report.versions.vm)}`,
    `- scaffolding: ${mdCode(report.versions.scaffolding)}`,
    `- browser: ${mdCode(report.runtimeIdentity.browser)}`,
    '',
    'The report records a display name only; it does not retain the unrestricted input path.',
    '',
    '## Stages',
    '',
    '| Stage | Required | Status | Time | Note |',
    '| --- | --- | --- | ---: | --- |',
    ...stageRows(report.stages),
    '',
    '## Project metrics',
    '',
    ...metricLines(report),
    '',
    '## Diagnostics',
    '',
    ...diagnosticLines(report),
    '',
    '## Preservation and execution',
    '',
    `- exact project content: ${roundTrip?.contentExact ?? false}`,
    `- VM snapshots: ${vm?.snapshotCount ?? 0}`,
    `- VM captured log events: ${vm?.runtimeLog.total ?? 0}`,
    `- browser snapshots/screenshots: ${browser?.snapshotCount ?? 0}/${browser?.screenshotCount ?? 0}`,
    `- browser nonblank visual evidence: ${browser?.visual.nonblank ?? false}`,
    `- browser console events: ${browser?.console.total ?? 0}`,
    '',
    '## Performance',
    '',
    `- threshold status: ${performance.passed ? 'pass' : 'FAIL'}`,
    `- wall time: ${performance.totalMs.toFixed(1)} ms / ${performance.thresholds.totalMs} ms`,
    `- parent-process peak RSS: ${performance.parentProcessPeakRssBytes} / ${performance.thresholds.peakRssBytes} bytes`,
    '',
    'Chromium child-process memory is not included in the in-report RSS value; the explicit acceptance command may use an external process measurement.',
    '',
    '## What this means',
    '',
    ...report.claims.proves.map((claim) => `- proves: ${mdCode(claim)}`),
    ...report.claims.doesNotProve.map(
      (claim) => `- does not prove: ${mdCode(claim)}`
    ),
    `- runtime containment: ${mdCode(report.claims.runtimeContainment)}; hard kill timeout: ${mdCode(report.claims.hardKillTimeout)}`,
    '',
    '## Artifacts',
    '',
    ...artifactLines(report),
    '',
  ].join('\n')
}

export function writeProjectCheckCheckpoint(
  store: ProjectArtifactStore,
  report: ProjectCheckReport
): void
{
  report.artifacts = store
    .references()
    .filter(
      (artifact) =>
        artifact.path !== 'project-check.json' &&
        artifact.path !== 'project-check.md'
    )
  store.writeText(
    'project-check.json',
    'report-json',
    'application/json',
    projectCheckReportJson(report)
  )
  store.writeText(
    'project-check.md',
    'report-markdown',
    'text/markdown; charset=utf-8',
    projectCheckReportMarkdown(report)
  )
}
