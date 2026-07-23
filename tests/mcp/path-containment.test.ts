// tests/mcp/path-containment.test.ts
// protected MCP reads allow dot-prefixed child names while rejecting escapes

import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import {
  configureEditMcpProtectedRootsV1,
  readProtectedMcpFileV1,
} from '@scratch-agent/mcp'

test('protected MCP reads treat ..data as an in-root path component', (t) =>
{
  const temp = mkdtempSync(join(tmpdir(), 'agentic-scratch-mcp-paths-'))
  t.after(() => rmSync(temp, { recursive: true, force: true }))
  const rootNames = [
    'input',
    'asset-input',
    'output',
    'edit-private',
    'readable-artifact',
  ] as const
  for (const name of rootNames) mkdirSync(join(temp, name))
  const roots = configureEditMcpProtectedRootsV1({
    inputRoot: join(temp, 'input'),
    assetInputRoot: join(temp, 'asset-input'),
    outputRoot: join(temp, 'output'),
    editPrivateRoot: join(temp, 'edit-private'),
    readableArtifactRoot: join(temp, 'readable-artifact'),
  })
  const nested = join(temp, 'input', '..data')
  mkdirSync(nested)
  const path = join(nested, 'project.sb3')
  writeFileSync(path, 'fixture')

  const read = readProtectedMcpFileV1(roots.input, path)
  assert.equal(new TextDecoder().decode(read.bytes), 'fixture')
  assert.throws(
    () => readProtectedMcpFileV1(roots.input, join(temp, 'outside.sb3')),
    (error: unknown) =>
    {
      assert.equal(
        (error as { code?: unknown }).code,
        'mcp.protected-file-outside-root'
      )
      return true
    }
  )
})
