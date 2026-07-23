// scripts/project/inspect.ts
// print a readable summary of a .sb3 project (sprites, scripts, vars, custom blocks)

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { ProjectIR, summarizeProject } from '@scratch-agent/ir'

async function main(): Promise<void>
{
  const arg = process.argv[2]
  if (!arg)
  {
    console.error('usage: npm run inspect -- <path.sb3> [maxScriptsPerSprite]')
    process.exitCode = 1
    return
  }
  const path = resolve(process.cwd(), arg)
  const max = process.argv[3] ? Number(process.argv[3]) : 0
  const ir = await ProjectIR.fromSb3(readFileSync(path))
  console.log(summarizeProject(ir, { maxScriptsPerTarget: max }))
}

main().catch((err: unknown) =>
{
  console.error(err)
  process.exitCode = 1
})
