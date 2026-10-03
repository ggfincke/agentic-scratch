// scripts/project/inspect.ts
// print a readable summary of a .sb3 project (sprites, scripts, vars, custom blocks)

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { ProjectIR, summarizeProject } from '@scratch-agent/ir'
import { emitProjectScratchblocks } from '@scratch-agent/static'

const TEXT_LINE_CAP = 400

async function main(): Promise<void>
{
  const argv = process.argv.slice(2)
  const withText = argv.includes('--text')
  const positional = argv.filter((a) => !a.startsWith('--'))
  const arg = positional[0]
  if (!arg)
  {
    console.error(
      'usage: npm run inspect -- <path.sb3> [maxScriptsPerSprite] [--text]'
    )
    process.exitCode = 1
    return
  }
  const path = resolve(process.cwd(), arg)
  const max = positional[1] ? Number(positional[1]) : 0
  const ir = await ProjectIR.fromSb3(readFileSync(path))
  console.log(summarizeProject(ir, { maxScriptsPerTarget: max }))
  if (withText) printScratchblocks(ir.toProjectJson())
}

// bounded per-target scratchblocks section appended after the summary
function printScratchblocks(
  json: ReturnType<ProjectIR['toProjectJson']>
): void
{
  const emitted = emitProjectScratchblocks(json)
  console.log('== scratchblocks ==')
  let budget = TEXT_LINE_CAP
  let totalLines = 0
  for (const target of emitted.targets)
  {
    const lines =
      target.scripts.length > 0
        ? target.scripts.join('\n').split('\n')
        : ['(no scripts)']
    totalLines += lines.length + 1
    if (budget <= 0) continue
    console.log(`-- ${target.name} --`)
    for (const line of lines)
    {
      if (budget <= 0) break
      console.log(line)
      budget--
    }
  }
  if (totalLines > TEXT_LINE_CAP)
  {
    console.log(
      `... truncated (${TEXT_LINE_CAP} of ${totalLines - emitted.targets.length} scratchblocks lines shown)`
    )
  }
}

main().catch((err: unknown) =>
{
  console.error(err)
  process.exitCode = 1
})
