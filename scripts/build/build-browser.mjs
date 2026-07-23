// scripts/build/build-browser.mjs
// bundle rendered runtime & semantic hash page entries to isolated IIFEs

import { resolve } from 'node:path'

import esbuild from 'esbuild'

const root = resolve(import.meta.dirname, '../..')
const builds = [
  ['page-entry.ts', 'page.js'],
  ['official-page-entry.ts', 'official-page.js'],
  ['hash-parity-page-entry.ts', 'hash-parity-page.js'],
]

for (const [entryName, outputName] of builds)
{
  const entry = resolve(root, 'packages/runner/src/browser', entryName)
  const outfile = resolve(root, 'packages/runner/dist/browser', outputName)
  await esbuild.build({
    entryPoints: [entry],
    outfile,
    bundle: true,
    format: 'iife',
    platform: 'browser',
    target: 'es2020',
    logLevel: 'info',
  })
  console.log(`bundled browser page -> ${outfile}`)
}
