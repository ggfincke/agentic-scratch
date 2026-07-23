// packages/runner/src/report/report.ts
// write report.json & a human-readable report.md for a run

import { writeFileSync } from 'node:fs'
import { join } from 'node:path'

import type {
  BrowserLaneResult,
  RunReport,
  StateSnapshot,
  VmLaneResult,
} from '../policy/types.js'
import { mdCode } from './markdown.js'

export function writeReport(runRoot: string, report: RunReport): void
{
  writeFileSync(
    join(runRoot, 'report.json'),
    JSON.stringify(report, null, 2) + '\n'
  )
  writeFileSync(join(runRoot, 'report.md'), renderMarkdown(report))
}

function renderSnapshots(snapshots: StateSnapshot[]): string
{
  if (snapshots.length === 0) return '_no snapshots_\n'
  const lines: string[] = []
  for (const snap of snapshots)
  {
    lines.push(`- **tick ${snap.tick}**`)
    for (const [name, s] of Object.entries(snap.targets))
    {
      lines.push(
        `  - ${mdCode(name)}: x=${mdCode(s.x)} y=${mdCode(s.y)} dir=${mdCode(s.direction)} costume=${mdCode(s.costume)} visible=${mdCode(s.visible)}`
      )
    }
    const vars = Object.entries(snap.variables)
    if (vars.length > 0)
    {
      const rendered = vars
        .map(([k, v]) => `${mdCode(k)}=${mdCode(v)}`)
        .join(', ')
      lines.push(`  - vars: ${rendered}`)
    }
  }
  return lines.join('\n') + '\n'
}

function renderVm(vm: VmLaneResult | null): string
{
  if (!vm) return '_skipped_\n'
  const head = `runtime ${mdCode(vm.runtime)} — ${vm.ok ? 'ok' : 'FAILED'}\n\n`
  const errs = vm.errors.length
    ? `errors: ${vm.errors.map(mdCode).join('; ')}\n\n`
    : ''
  return head + errs + renderSnapshots(vm.snapshots)
}

function renderBrowser(browser: BrowserLaneResult | null): string
{
  if (!browser) return '_skipped_\n'
  const head = `runtime ${mdCode(browser.runtime)} — ${browser.ok ? 'ok' : 'FAILED'}\n\n`
  const errs = browser.errors.length
    ? `errors: ${browser.errors.map(mdCode).join('; ')}\n\n`
    : ''
  const shots = browser.screenshots.length
    ? `screenshots:\n${browser.screenshots.map((s) => `- ${mdCode(s)}`).join('\n')}\n\n`
    : ''
  return head + errs + shots + renderSnapshots(browser.snapshots)
}

function renderMarkdown(r: RunReport): string
{
  const v = r.versions
  return [
    `# Run ${r.runId}`,
    '',
    `**${r.ok ? 'PASS' : 'FAIL'}** — ${r.createdAt}`,
    '',
    '## Artifact',
    '',
    `- sb3: ${mdCode(r.artifact.sb3Path)}`,
    `- sha256: ${mdCode(r.artifact.sha256)}`,
    `- project.json: ${r.artifact.projectJsonBytes} bytes`,
    `- assets: ${r.artifact.assetCount}`,
    '',
    '## Versions',
    '',
    `- node ${mdCode(v.node)}`,
    `- @scratch/scratch-vm ${mdCode(v.vm)}`,
    `- @turbowarp/scaffolding ${mdCode(v.scaffolding)}`,
    `- scratch-parser ${mdCode(v.parser)}`,
    `- jszip ${mdCode(v.jszip)}`,
    `- playwright ${mdCode(v.playwright)}`,
    '',
    '## Validation',
    '',
    `${r.validation.ok ? 'ok' : 'FAILED'}${
      r.validation.errors.length
        ? ' — ' + r.validation.errors.map(mdCode).join('; ')
        : ''
    }`,
    '',
    '## VM lane',
    '',
    renderVm(r.vm),
    '## Browser lane',
    '',
    renderBrowser(r.browser),
  ].join('\n')
}
