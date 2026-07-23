// scripts/project/validate.ts
// validate a .sb3: schema (scratch-parser) + block-graph/referential + static checks.
// gate: exits non-zero on any error; --strict also fails on warnings.

import { readFileSync } from 'node:fs'
import { basename, resolve } from 'node:path'

import { validateSb3 } from '@scratch-agent/sb3'
import { ProjectIR } from '@scratch-agent/ir'
import {
  countBySeverity,
  formatDiagnostic,
  validateProject,
  type Diagnostic,
} from '@scratch-agent/validate'
import { analyzeStatic } from '@scratch-agent/static'

const SEVERITY_ORDER = { error: 0, warning: 1, info: 2 }
const PER_SEVERITY_CAP = 50

async function main(): Promise<void>
{
  const args = process.argv.slice(2)
  const strict = args.includes('--strict')
  const arg = args.find((a) => !a.startsWith('--'))
  if (!arg)
  {
    console.error('usage: npm run validate -- <path.sb3> [--strict]')
    process.exitCode = 1
    return
  }
  const path = resolve(process.cwd(), arg)
  const bytes = readFileSync(path)

  const ir = await ProjectIR.fromSb3(bytes)
  const { diagnostics: graph, index } = validateProject(ir)
  const { diagnostics: statics, metrics } = analyzeStatic(
    ir.toProjectJson(),
    index
  )

  // the schema layer (scratch-parser) is the authority for structural rejection
  const schema = await validateSb3(bytes)
  const schemaDiags: Diagnostic[] = schema.ok
    ? []
    : schema.errors.map((message) => ({
        code: 'schema',
        severity: 'error' as const,
        message,
        location: {},
      }))

  const all = [...schemaDiags, ...graph, ...statics]
  all.sort(
    (a, b) =>
      SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] ||
      ((a.location.target ?? '') < (b.location.target ?? '')
        ? -1
        : (a.location.target ?? '') > (b.location.target ?? '')
          ? 1
          : 0) ||
      (a.code < b.code ? -1 : a.code > b.code ? 1 : 0)
  )
  const counts = countBySeverity(all)

  console.log(
    `${basename(path)}  blocks=${metrics.blocks} scripts=${metrics.scripts} sprites=${metrics.sprites}`
  )
  console.log(
    `  errors ${counts.error}, warnings ${counts.warning}, info ${counts.info}`
  )
  printCapped(all)

  const fail = counts.error > 0 || (strict && counts.warning > 0)
  if (fail) process.exitCode = 1
}

// print each severity bucket up to a cap, noting how many were elided
function printCapped(diags: Diagnostic[]): void
{
  for (const severity of ['error', 'warning', 'info'] as const)
  {
    const bucket = diags.filter((d) => d.severity === severity)
    for (const d of bucket.slice(0, PER_SEVERITY_CAP))
    {
      console.log(`    ${formatDiagnostic(d)}`)
    }
    if (bucket.length > PER_SEVERITY_CAP)
    {
      console.log(
        `    ... and ${bucket.length - PER_SEVERITY_CAP} more ${severity}`
      )
    }
  }
}

main().catch((err: unknown) =>
{
  console.error(err)
  process.exitCode = 1
})
