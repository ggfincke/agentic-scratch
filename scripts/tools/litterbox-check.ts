// scripts/tools/litterbox-check.ts
// run pinned LitterBox over a .sb3 & print an advisory finding summary

import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { basename, join, resolve } from 'node:path'

interface LitterboxIssue
{
  finder?: string
  name?: string
  type?: string
  severity?: number
}

interface LitterboxReport
{
  metrics?: Record<string, unknown>
  issues?: LitterboxIssue[]
}

const root = resolve(import.meta.dirname, '../..')
const manifest = JSON.parse(
  readFileSync(join(import.meta.dirname, 'litterbox-manifest.json'), 'utf8')
) as { version?: string }

function parseArgs(argv: string[]): Map<string, string>
{
  const args = new Map<string, string>()
  for (let i = 0; i < argv.length; i += 2)
  {
    const flag = argv[i]
    const value = argv[i + 1]
    if (!flag?.startsWith('--') || value === undefined)
    {
      console.error(
        `usage: npm run litterbox -- --input <path.sb3> [--output <json>] [--detectors <csv>]`
      )
      process.exit(1)
    }
    args.set(flag.slice(2), value)
  }
  return args
}

async function main(): Promise<void>
{
  const args = parseArgs(process.argv.slice(2))
  const input = args.get('input')
  if (!input)
  {
    console.error('missing required --input <path.sb3>')
    process.exit(1)
  }
  const inputPath = resolve(input)
  if (!existsSync(inputPath))
  {
    console.error(`input not found: ${inputPath}`)
    process.exit(1)
  }

  // subprocess-only integration: fetch the pinned jar, never import its code
  const fetchScript = join(import.meta.dirname, 'fetch-litterbox.mjs')
  const fetched = spawnSync(process.execPath, [fetchScript], {
    stdio: 'inherit',
  })
  if (fetched.status !== 0)
  {
    console.error('litterbox jar fetch failed')
    process.exit(1)
  }

  const outputPath = args.has('output')
    ? resolve(args.get('output')!)
    : join(root, '.tmp', 'litterbox', `${basename(inputPath)}.json`)
  mkdirSync(join(outputPath, '..'), { recursive: true })

  const javaArgs = [
    '-jar',
    join(root, '.tmp/tools/Litterbox-1.12.full.jar'),
    'check',
    '--path',
    inputPath,
    '-o',
    outputPath,
  ]
  const detectors = args.get('detectors')
  if (detectors) javaArgs.push('--detectors', detectors)

  const run = spawnSync('java', javaArgs, { stdio: 'inherit' })
  if (run.error)
  {
    console.error(`failed to launch java: ${run.error.message}`)
    process.exit(1)
  }
  if (run.status !== 0)
  {
    console.error(
      `litterbox exited ${String(run.status)} for ${basename(inputPath)}`
    )
    process.exit(run.status ?? 1)
  }

  let report: LitterboxReport
  try
  {
    report = JSON.parse(readFileSync(outputPath, 'utf8')) as LitterboxReport
  }
  catch (err)
  {
    console.error(`unreadable litterbox output ${outputPath}: ${String(err)}`)
    process.exit(1)
  }

  // findings are advisory: summarize & exit 0 regardless of bug counts
  const byPattern = new Map<string, number>()
  for (const issue of report.issues ?? [])
  {
    const key = issue.finder ?? '<unknown>'
    byPattern.set(key, (byPattern.get(key) ?? 0) + 1)
  }
  const ranked = [...byPattern.entries()].sort(
    (a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)
  )
  console.log(`litterbox ${manifest.version ?? '?'}: ${basename(inputPath)}`)
  console.log(
    `  findings ${(report.issues ?? []).length} by bug-pattern: ${
      ranked.map(([k, n]) => `${k} x${n}`).join(', ') || 'none'
    }`
  )
  console.log(`  metrics keys: ${Object.keys(report.metrics ?? {}).length}`)
  console.log(`  report: ${outputPath}`)
}

main().catch((err: unknown) =>
{
  console.error(err)
  process.exitCode = 1
})
