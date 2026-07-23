// scripts/suites/vistest.ts
// browser visual runner: run the visual suite, write artifacts + report, gate on failures

import { resolve } from 'node:path'

import { visualSuite } from '@scratch-agent/eval'

import { runSuiteCli } from './run-suite.js'

async function main(): Promise<void>
{
  await runSuiteCli({
    root: resolve(import.meta.dirname, '../..'),
    prefix: 'vistest',
    reportBasename: 'vistest',
    reportTitle: 'Browser visual test report',
    cases: visualSuite,
    artifactRouting: true,
    printDetails(result)
    {
      for (const t of result.results)
      {
        console.log(`${t.ok ? 'PASS' : 'FAIL'}  ${t.name}`)
        for (const e of t.errors) console.log(`        run error: ${e}`)
        for (const a of [...t.asserts, ...t.visual])
        {
          if (a.ok) continue
          console.log(
            `        ${a.location.hint}: expected ${a.expected}, observed ${a.observed}` +
              ` (at "${a.at}" -> ${a.location.target})`
          )
        }
        const vid = t.video ? ', 1 video' : ''
        console.log(
          `        artifacts: ${t.screenshots.length} screenshots${vid}`
        )
      }
    },
  })
}

main().catch((err: unknown) =>
{
  console.error(err)
  process.exitCode = 1
})
