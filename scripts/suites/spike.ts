// scripts/suites/spike.ts
// end-to-end smoke: load a .sb3 (fixture or a path arg), validate, run VM + browser lanes, write a report

import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'

import { buildFixtureSb3, readSb3, validateSb3 } from '@scratch-agent/sb3'
import {
  collectVersions,
  createRunDir,
  runBrowser,
  runVm,
  sha256,
  writeReport,
} from '@scratch-agent/runner'
import type { RunReport, RunScenario } from '@scratch-agent/runner'

const root = resolve(import.meta.dirname, '../..')
const fixturePath = join(root, 'fixtures', 'fixture.sb3')
const runsRoot = join(root, 'runs')

// keep the committed fixture in sync w/ the deterministic builder, then return its path
async function ensureFixture(): Promise<string>
{
  const built = await buildFixtureSb3()
  const current = existsSync(fixturePath) ? readFileSync(fixturePath) : null
  if (!current || !current.equals(Buffer.from(built.sb3)))
  {
    if (current) console.warn(`fixture drift: regenerating ${fixturePath}`)
    mkdirSync(dirname(fixturePath), { recursive: true })
    writeFileSync(fixturePath, built.sb3)
  }
  return fixturePath
}

async function main(): Promise<void>
{
  // optional path arg: `npm run spike -- <path/to.sb3>`; default is the fixture
  const arg = process.argv[2]
  const inputPath = arg ? resolve(process.cwd(), arg) : await ensureFixture()
  if (!existsSync(inputPath))
  {
    console.error(`no such .sb3: ${inputPath}`)
    process.exitCode = 1
    return
  }

  const sb3 = readFileSync(inputPath)
  const meta = await readSb3(sb3)
  const validation = await validateSb3(sb3)
  const scenario: RunScenario = { greenFlag: true, ticks: 6, snapshots: [0, 6] }

  const runDir = createRunDir(runsRoot)
  copyFileSync(inputPath, join(runDir.root, 'candidate.sb3'))
  writeFileSync(join(runDir.root, 'project.json'), meta.projectJsonText)

  const vm = await runVm(sb3, scenario)
  const browser = await runBrowser(sb3, scenario, {
    screenshotPath: join(runDir.screenshots, 'stage.png'),
  })

  const report: RunReport = {
    runId: runDir.id,
    createdAt: new Date().toISOString(),
    ok: validation.ok && vm.ok && browser.ok,
    artifact: {
      sb3Path: join(runDir.root, 'candidate.sb3'),
      sha256: sha256(sb3),
      projectJsonBytes: meta.projectJsonBytes,
      assetCount: meta.assetCount,
    },
    versions: collectVersions(),
    validation: { ok: validation.ok, errors: validation.errors },
    vm,
    browser,
  }
  writeReport(runDir.root, report)

  const verdict = report.ok ? 'PASS' : 'FAIL'
  console.log(`run ${runDir.id} [${basename(inputPath)}]: ${verdict}`)
  console.log(
    `  project.json ${meta.projectJsonBytes} bytes, ${meta.assetCount} assets`
  )
  console.log(
    `  validation: ${validation.ok ? 'ok' : validation.errors.join('; ')}`
  )
  console.log(`  vm: ${vm.ok ? 'ok' : vm.errors.join('; ')}`)
  console.log(`  browser: ${browser.ok ? 'ok' : browser.errors.join('; ')}`)
  console.log(`  report: ${join(runDir.root, 'report.md')}`)
  if (!report.ok) process.exitCode = 1
}

main().catch((err: unknown) =>
{
  console.error(err)
  process.exitCode = 1
})
