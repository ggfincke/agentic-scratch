// scripts/project/roundtrip.ts
// round-trip a .sb3 through the IR & report losslessness (json fields + asset bytes)

import { readFileSync } from 'node:fs'
import { basename, resolve } from 'node:path'

import { roundTripSb3 } from '@scratch-agent/ir'

async function main(): Promise<void>
{
  const arg = process.argv[2]
  if (!arg)
  {
    console.error('usage: npm run roundtrip -- <path.sb3>')
    process.exitCode = 1
    return
  }
  const path = resolve(process.cwd(), arg)
  const result = await roundTripSb3(readFileSync(path))

  console.log(`${basename(path)}: ${result.lossless ? 'LOSSLESS' : 'LOSSY'}`)
  console.log(
    `  targets ${result.stats.targets}, blocks ${result.stats.blocks}, assets ${result.stats.assets}`
  )
  console.log(`  bytes ${result.stats.bytesIn} -> ${result.stats.bytesOut}`)
  console.log(
    `  project.json byte-identical: ${result.jsonTextIdentical ? 'yes' : 'no'}`
  )

  if (result.jsonDiffs.length)
  {
    console.log(`  json diffs (${result.jsonDiffs.length}):`)
    for (const d of result.jsonDiffs.slice(0, 40))
    {
      const a = d.a !== undefined ? ` a=${d.a}` : ''
      const b = d.b !== undefined ? ` b=${d.b}` : ''
      console.log(`    ${d.kind} ${d.path}${a}${b}`)
    }
  }
  if (result.assetDiffs.length)
  {
    console.log(`  asset diffs (${result.assetDiffs.length}):`)
    for (const d of result.assetDiffs.slice(0, 40))
    {
      console.log(`    ${d.kind} ${d.path}`)
    }
  }
  if (!result.lossless) process.exitCode = 1
}

main().catch((err: unknown) =>
{
  console.error(err)
  process.exitCode = 1
})
