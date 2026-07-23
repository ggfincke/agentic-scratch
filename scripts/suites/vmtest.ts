// scripts/suites/vmtest.ts
// VM test runner: run the canonical scenario suite, write a report, gate on failures

import { resolve } from 'node:path'

import { vmTestSuite } from '@scratch-agent/eval'

import { runSuiteCli } from './run-suite.js'

async function main(): Promise<void>
{
  await runSuiteCli({
    root: resolve(import.meta.dirname, '../..'),
    prefix: 'vmtest',
    reportBasename: 'vmtest',
    cases: vmTestSuite,
    printDetails(result)
    {
      for (const t of result.results)
      {
        console.log(`${t.ok ? 'PASS' : 'FAIL'}  ${t.name}`)
        for (const e of t.errors) console.log(`        run error: ${e}`)
        for (const a of t.asserts)
        {
          if (a.ok) continue
          console.log(
            `        ${a.location.hint}: expected ${a.expected}, observed ${a.observed}` +
              ` (at "${a.at}" -> ${a.location.target})`
          )
        }
      }
    },
  })
}

main().catch((err: unknown) =>
{
  console.error(err)
  process.exitCode = 1
})
