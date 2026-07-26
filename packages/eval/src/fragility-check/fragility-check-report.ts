// packages/eval/src/fragility-check/fragility-check-report.ts
// render & atomically checkpoint authoritative fragility-check JSON/Markdown

import { mdCode as renderMdCode } from '@scratch-agent/runner'
import type { FragilityFinding } from '@scratch-agent/static'

import { ProjectArtifactStore } from '../project-check/project-artifacts.js'
import type { FragilityCheckReport } from './fragility-check-contract.js'

function mdCode(value: unknown): string
{
  let visible = ''
  for (const character of String(value))
  {
    const codePoint = character.codePointAt(0)!
    if (character === '\r') visible += '\\r'
    else if (character === '\n') visible += '\\n'
    else if (character === '\t') visible += '\\t'
    else if (
      codePoint < 0x20 ||
      (codePoint >= 0x7f && codePoint <= 0x9f) ||
      codePoint === 0x2028 ||
      codePoint === 0x2029
    )
      visible += `\\u{${codePoint.toString(16)}}`
    else visible += character
  }
  return renderMdCode(visible)
}

function mdTableCode(value: unknown): string
{
  return mdCode(String(value).replaceAll('|', '\\u{7c}'))
}

export function fragilityCheckReportJson(report: FragilityCheckReport): string
{
  return JSON.stringify(report, null, 2) + '\n'
}

function findingRows(findings: FragilityFinding[]): string[]
{
  if (findings.length === 0) return ['| _none_ |  |  |  |  |  |']
  return findings.map(
    (finding) =>
      `| ${mdTableCode(finding.signature)} | ${mdTableCode(finding.severity)} | ${mdTableCode(finding.confidence)} | ${mdTableCode(finding.verdict)} | ${mdTableCode(finding.targetName)} | ${mdTableCode(finding.message)} |`
  )
}

function evidenceLines(
  heading: string,
  findings: FragilityFinding[]
): string[]
{
  const lines = [`### ${heading} evidence`, '']
  if (findings.length === 0) return [...lines, '_none_', '']
  for (const [index, finding] of findings.entries())
  {
    lines.push(
      `- ${mdCode(`${index + 1}:${finding.signature}:${finding.targetName}`)}`
    )
    for (const evidence of finding.evidence)
    {
      lines.push(
        `  - target ${mdCode(evidence.targetName)}; block ${mdCode(evidence.blockId)}; opcode ${mdCode(evidence.opcode)}; role ${mdCode(evidence.role)}; detail ${mdCode(evidence.detail)}`
      )
    }
    for (const counterEvidence of finding.counterEvidence)
    {
      lines.push(`  - counter-evidence ${mdCode(counterEvidence)}`)
    }
  }
  return [...lines, '']
}

function findingSection(
  heading: string,
  findings: FragilityFinding[]
): string[]
{
  return [
    `## ${heading}`,
    '',
    '| Signature | Severity | Confidence | Verdict | Target | Message |',
    '| --- | --- | --- | --- | --- | --- |',
    ...findingRows(findings),
    '',
    ...evidenceLines(heading.toLowerCase(), findings),
  ]
}

export function fragilityCheckReportMarkdown(
  report: FragilityCheckReport
): string
{
  const status = report.overall.status === 'passed' ? 'PASS' : 'FAIL'
  return [
    `# Fragility check ${mdCode(report.runId)}`,
    '',
    `**${status}** — ${mdCode(report.input.displayName)}`,
    '',
    `- input sha256: ${mdCode(report.input.sha256 ?? 'unavailable')}`,
    `- input bytes: ${mdCode(report.input.byteLength ?? 'unavailable')}`,
    `- source revision: ${mdCode(report.sourceRevision)}`,
    `- node: ${mdCode(report.versions.node)}`,
    `- Scratch VM: ${mdCode(report.versions.vm)}`,
    `- scaffolding: ${mdCode(report.versions.scaffolding)}`,
    `- parser: ${mdCode(report.versions.parser)}`,
    `- JSZip: ${mdCode(report.versions.jszip)}`,
    `- Playwright: ${mdCode(report.versions.playwright)}`,
    '',
    '## Conversion provenance',
    '',
    `- semver: ${mdCode(report.conversionProvenance.semver ?? 'unavailable')}`,
    `- VM: ${mdCode(report.conversionProvenance.vm ?? 'unavailable')}`,
    `- agent: ${mdCode(report.conversionProvenance.agent ?? 'unavailable')}`,
    `- origin: ${mdCode(report.conversionProvenance.origin ?? 'unavailable')}`,
    `- inference: ${mdCode(report.conversionProvenance.inference)}`,
    '',
    'Provenance is reporting context only and does not affect findings.',
    '',
    '## Boundary model',
    '',
    `- pinned VM: ${mdCode(report.boundaryModel.pinnedVmVersion)}`,
    `- boundary table sha256: ${mdCode(report.boundaryModel.boundaryTableSha256)}`,
    `- probe script sha256: ${mdCode(report.boundaryModel.corroboratedBy.probeScriptSha256)}`,
    '',
    '## Signature coverage',
    '',
    '| Signature | Ran | Findings | Indeterminate |',
    '| --- | --- | ---: | ---: |',
    ...report.signatureCoverage.map(
      (coverage) =>
        `| ${mdTableCode(coverage.signature)} | ${mdTableCode(coverage.ran)} | ${mdTableCode(coverage.findingCount)} | ${mdTableCode(coverage.indeterminateCount)} |`
    ),
    '',
    ...findingSection('Findings', report.findings),
    ...findingSection('Advisories', report.advisories),
    '## Truncation',
    '',
    `- findings omitted: ${mdCode(report.truncation.findingsOmitted)}`,
    `- advisories omitted: ${mdCode(report.truncation.advisoriesOmitted)}`,
    `- maximum evidence omitted from one finding: ${mdCode(report.truncation.evidenceOmittedPerFinding)}`,
    `- maximum counter-evidence omitted from one finding: ${mdCode(report.truncation.counterEvidenceOmittedPerFinding)}`,
    `- text values truncated: ${mdCode(report.truncation.textValuesTruncated)}`,
    `- text bytes omitted: ${mdCode(report.truncation.textBytesOmitted)}`,
    '',
    '## Claims',
    '',
    ...report.claims.proves.map((claim) => `- proves: ${mdCode(claim)}`),
    ...report.claims.doesNotProve.map(
      (claim) => `- does not prove: ${mdCode(claim)}`
    ),
    `- scope: ${mdCode(report.claims.claimScope)}`,
    '',
    '## Issues',
    '',
    ...(report.issues.length === 0
      ? ['_none_']
      : report.issues.map(
          (issue) =>
            `- ${mdCode(issue.code)}${issue.stage ? ` at ${mdCode(issue.stage)}` : ''}: ${mdCode(issue.message)}`
        )),
    '',
  ].join('\n')
}

export function writeFragilityCheckCheckpoint(
  store: ProjectArtifactStore,
  report: FragilityCheckReport
): void
{
  if (report.completedAt === null)
    throw new Error('fragility checkpoint requires a terminal report')
  if (
    report.overall.status === 'passed' &&
    (report.issues.length > 0 || report.overall.gatedFindingCount > 0)
  )
    throw new Error('fragility PASS checkpoint violates report invariants')
  store.writeTextBatch([
    {
      relativePath: 'fragility-check.md',
      kind: 'report-markdown',
      mediaType: 'text/markdown; charset=utf-8',
      value: fragilityCheckReportMarkdown(report),
    },
    {
      // json commits the pair last so a crash cannot expose a new PASS alone
      relativePath: 'fragility-check.json',
      kind: 'report-json',
      mediaType: 'application/json',
      value: fragilityCheckReportJson(report),
    },
  ])
}
