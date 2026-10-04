// scripts/tools/fetch-litterbox.mjs
// ensure the pinned LitterBox jar is cached in .tmp/tools w/ verified sha256

import { createHash } from 'node:crypto'
import { createReadStream, createWriteStream } from 'node:fs'
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
} from 'node:fs'
import { join, resolve } from 'node:path'
import { pipeline } from 'node:stream/promises'

const root = resolve(import.meta.dirname, '../..')
const manifest = JSON.parse(
  readFileSync(join(import.meta.dirname, 'litterbox-manifest.json'), 'utf8')
)
const jarName = manifest.url.split('/').pop()
if (typeof jarName !== 'string' || !jarName.endsWith('.jar'))
{
  console.error(`manifest url has no jar filename: ${manifest.url}`)
  process.exit(1)
}
const toolsDir = join(root, '.tmp/tools')
const jarPath = join(toolsDir, jarName)

function sha256Of(path)
{
  return new Promise((resolveHash, reject) =>
  {
    const hash = createHash('sha256')
    const stream = createReadStream(path)
    stream.on('data', (chunk) => hash.update(chunk))
    stream.on('end', () => resolveHash(hash.digest('hex')))
    stream.on('error', reject)
  })
}

// a cached jar only counts when its bytes still hash to the pinned value
async function cachedJarIsValid()
{
  if (!existsSync(jarPath)) return false
  const observed = await sha256Of(jarPath)
  if (observed === manifest.sha256) return true
  console.error(`cached jar hash mismatch at ${jarPath}`)
  console.error(`  expected ${manifest.sha256}`)
  console.error(`  observed ${observed}`)
  console.error('removing stale cache & re-downloading')
  rmSync(jarPath, { force: true })
  return false
}

async function downloadJar()
{
  mkdirSync(toolsDir, { recursive: true })
  const response = await fetch(manifest.url)
  if (!response.ok || !response.body)
  {
    throw new Error(
      `download failed: HTTP ${response.status} for ${manifest.url}`
    )
  }
  const tmpPath = `${jarPath}.download`
  await pipeline(response.body, createWriteStream(tmpPath))
  const observed = await sha256Of(tmpPath)
  if (observed !== manifest.sha256)
  {
    rmSync(tmpPath, { force: true })
    throw new Error(
      `downloaded jar failed sha256 pin\n  expected ${manifest.sha256}\n  observed ${observed}`
    )
  }
  renameSync(tmpPath, jarPath)
}

try
{
  if (!(await cachedJarIsValid())) await downloadJar()
  console.log(jarPath)
}
catch (err)
{
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
}
