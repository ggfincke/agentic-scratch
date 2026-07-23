// packages/eval/src/core/report.ts
// render a suite result as JSON & human-readable Markdown

import type { ModelRunResult } from '@scratch-agent/model'
import { mdCode } from '@scratch-agent/runner'
import type { RunVersions } from '@scratch-agent/runner'

import type { AssertResult } from './assert.js'
import type { SuiteResult, TestResult } from './test.js'

export interface SuiteProjectArtifact
{
  name: string
  sha256: string
  bytes: number
}

export interface SuiteReportEnvelope
{
  runId: string
  createdAt: string
  ok: boolean
  versions: RunVersions
  suite: {
    sha256: string
    projects: SuiteProjectArtifact[]
  }
  result: SuiteResult
}

export function suiteReportEnvelopeJson(envelope: SuiteReportEnvelope): string
{
  return JSON.stringify(envelope, null, 2) + '\n'
}

function renderAssert(a: AssertResult): string
{
  const head = `  - ${a.ok ? 'ok' : 'FAIL'} ${mdCode(a.location.hint)} ${mdCode(a.expected)}`
  if (a.ok) return head
  return [
    head,
    `    - expected ${mdCode(a.expected)}, observed ${mdCode(a.observed)}`,
    `    - at ${mdCode(a.at)} -> ${mdCode(a.location.target)}`,
  ].join('\n')
}

// per-model outcome: node reached, edge coverage (the trace-attribute analog) & failed effects
function renderModel(model: ModelRunResult): string[]
{
  const lines: string[] = []
  for (const m of model.models)
  {
    const cov = `${m.coverage.covered.length}/${m.coverage.total.length}`
    lines.push(
      `  - model ${mdCode(m.modelId)} (${m.usage}): ${m.ok ? 'ok' : 'FAIL'} — node ${mdCode(m.finalNode)}, edges ${cov}`
    )
    for (const f of m.failures)
    {
      const where = f.sprite ? ` -> ${mdCode(f.sprite)}` : ''
      lines.push(`    - FAIL ${mdCode(f.check)} at tick ${f.tick}${where}`)
    }
  }
  for (const w of model.warnings) lines.push(`  - model warning: ${mdCode(w)}`)
  return lines
}

function renderTest(t: TestResult): string
{
  const lines = [`- **${t.ok ? 'PASS' : 'FAIL'}** ${mdCode(t.name)}`]
  if (t.errors.length)
    lines.push(`  - run error: ${t.errors.map(mdCode).join('; ')}`)
  for (const a of t.asserts) lines.push(renderAssert(a))
  for (const a of t.visual ?? []) lines.push(renderAssert(a))
  if (t.model) lines.push(...renderModel(t.model))
  const screenshots = t.screenshots ?? []
  if (screenshots.length)
  {
    lines.push('  - screenshots:')
    for (const s of screenshots)
    {
      lines.push(`    - ${mdCode(s.label)} (tick ${s.tick}): ${mdCode(s.path)}`)
    }
  }
  if (t.video) lines.push(`  - video (on failure): ${mdCode(t.video)}`)
  return lines.join('\n')
}

export function suiteReportMarkdown(result: SuiteResult): string
{
  const head = [
    '# VM test report',
    '',
    `**${result.ok ? 'PASS' : 'FAIL'}** — ${result.passed}/${result.total} passed`,
    '',
  ]
  return head.concat(result.results.map(renderTest)).join('\n') + '\n'
}

function renderVersions(versions: RunVersions): string[]
{
  return [
    `- node ${mdCode(versions.node)}`,
    `- @scratch/scratch-vm ${mdCode(versions.vm)}`,
    `- @turbowarp/scaffolding ${mdCode(versions.scaffolding)}`,
    `- scratch-parser ${mdCode(versions.parser)}`,
    `- jszip ${mdCode(versions.jszip)}`,
    `- playwright ${mdCode(versions.playwright)}`,
  ]
}

function renderProjectArtifacts(projects: SuiteProjectArtifact[]): string[]
{
  if (projects.length === 0) return ['_no projects_']
  return projects.map(
    (p) => `- ${mdCode(p.name)}: sha256 ${mdCode(p.sha256)}, ${p.bytes} bytes`
  )
}

export function suiteReportEnvelopeMarkdown(
  envelope: SuiteReportEnvelope,
  title = 'VM test report'
): string
{
  const result = envelope.result
  const head = [
    `# ${title}`,
    '',
    `**${envelope.ok ? 'PASS' : 'FAIL'}** — ${result.passed}/${result.total} passed`,
    '',
    '## Run',
    '',
    `- id: ${mdCode(envelope.runId)}`,
    `- created: ${mdCode(envelope.createdAt)}`,
    `- suite sha256: ${mdCode(envelope.suite.sha256)}`,
    '',
    '## Versions',
    '',
    ...renderVersions(envelope.versions),
    '',
    '## Project artifacts',
    '',
    ...renderProjectArtifacts(envelope.suite.projects),
    '',
    '## Results',
    '',
  ]
  return head.concat(result.results.map(renderTest)).join('\n') + '\n'
}
