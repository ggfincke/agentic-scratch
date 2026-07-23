// scripts/suites/modeltest.ts
// model-based test runner: drive the model suite, write a report, gate on failures

import { resolve } from 'node:path'

import { modelSuite } from '@scratch-agent/eval'

import { runSuiteCli } from './run-suite.js'

async function main(): Promise<void>
{
  await runSuiteCli({
    root: resolve(import.meta.dirname, '../..'),
    prefix: 'modeltest',
    reportBasename: 'modeltest',
    reportTitle: 'Model test report',
    cases: modelSuite,
    printDetails(result)
    {
      for (const t of result.results)
      {
        console.log(`${t.ok ? 'PASS' : 'FAIL'}  ${t.name}`)
        for (const e of t.errors) console.log(`        run error: ${e}`)
        for (const m of t.model?.models ?? [])
        {
          const cov = `${m.coverage.covered.length}/${m.coverage.total.length}`
          console.log(
            `        model ${m.modelId} (${m.usage}): ${m.ok ? 'ok' : 'FAIL'}` +
              ` -> node ${m.finalNode}, edges ${cov}`
          )
          for (const f of m.failures)
          {
            console.log(
              `          FAIL ${f.check} at tick ${f.tick}` +
                (f.sprite ? ` -> ${f.sprite}` : '')
            )
          }
        }
        for (const w of t.model?.warnings ?? [])
        {
          console.log(`        warning: ${w}`)
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
