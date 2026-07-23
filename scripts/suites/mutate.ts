// scripts/suites/mutate.ts
// mutation runner: mutate the state-game fixture, score which mutants the suite kills

import { mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

import { runMutationForCase, runTest, stateGameCase } from '@scratch-agent/eval'
import type { MutationReport, MutationRecord } from '@scratch-agent/mutate'
import { collectVersions, newRunId } from '@scratch-agent/runner'

const root = resolve(import.meta.dirname, '../..')

function recordLine(r: MutationRecord): string
{
  return `\`${r.operator}\` ${r.description} — \`${r.sprite}\``
}

function reportMarkdown(
  report: MutationReport,
  invalid: MutationRecord[],
  baseOk: boolean
): string
{
  const lines = [
    '# Mutation test report',
    '',
    `**base case passes:** ${baseOk ? 'yes' : 'NO'}`,
    `**mutation score:** ${report.killed}/${report.total} = ${(report.score * 100).toFixed(0)}%`,
    `**stillborn (invalid) mutants:** ${invalid.length}`,
    '',
    '## Killed',
    '',
    ...report.outcomes
      .filter((o) => o.killed)
      .map((o) => `- ${recordLine(o.record)}`),
    '',
    '## Survived (oracle gaps / equivalent mutants)',
    '',
    ...(report.survivors.length
      ? report.survivors.map((r) => `- ${recordLine(r)}`)
      : ['_none_']),
  ]
  if (invalid.length)
  {
    lines.push(
      '',
      '## Stillborn',
      '',
      ...invalid.map((r) => `- ${recordLine(r)}`)
    )
  }
  return lines.join('\n') + '\n'
}

async function main(): Promise<void>
{
  const runId = `mutate-${newRunId()}`
  const base = await runTest(stateGameCase)
  if (!base.ok)
  {
    console.error('base case does not pass on the un-mutated project; aborting')
    process.exitCode = 1
    return
  }

  const { report, invalid } = await runMutationForCase(stateGameCase)
  const envelope = {
    runId,
    createdAt: new Date().toISOString(),
    versions: collectVersions(),
    baseOk: base.ok,
    report,
    invalid,
  }

  const runRoot = join(root, 'runs', runId)
  mkdirSync(runRoot, { recursive: true })
  writeFileSync(
    join(runRoot, 'mutate.json'),
    JSON.stringify(envelope, null, 2) + '\n'
  )
  writeFileSync(
    join(runRoot, 'mutate.md'),
    reportMarkdown(report, invalid, base.ok)
  )

  console.log(
    `mutation score: ${report.killed}/${report.total} = ${(report.score * 100).toFixed(0)}%` +
      ` (${invalid.length} stillborn)`
  )
  console.log('killed:')
  for (const o of report.outcomes.filter((o) => o.killed))
  {
    console.log(`  x ${o.record.description} [${o.record.sprite}]`)
  }
  console.log('survived:')
  for (const r of report.survivors)
  {
    console.log(`  . ${r.description} [${r.sprite}]`)
  }
  console.log(`\nreport -> ${join(runRoot, 'mutate.md')}`)
  // the deliberate score bug MUST be caught; fail the job otherwise
  const scoreBug = report.outcomes.find(
    (o) =>
      o.record.sprite === 'Hero' &&
      /data_changevariableby\.VALUE: 1 -> 0/.test(o.record.description)
  )
  if (!scoreBug?.killed)
  {
    console.error('the deliberate score-increment mutation was NOT caught')
    process.exitCode = 1
  }
}

main().catch((err: unknown) =>
{
  console.error(err)
  process.exitCode = 1
})
