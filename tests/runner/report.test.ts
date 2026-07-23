// tests/runner/report.test.ts
// rendered run reports keep project-controlled Markdown inert

import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import { mdCode } from '@scratch-agent/runner'
import { writeReport } from '@scratch-agent/runner'
import type { RunReport } from '@scratch-agent/runner'

test('writeReport escapes project-controlled Markdown', () =>
{
  const runRoot = mkdtempSync(join(tmpdir(), 'runner-report-'))
  const injected = '[sprite](https://example.test)<img src=x>'
  const report: RunReport = {
    runId: 'run-1',
    createdAt: '2026-06-30T00:00:00.000Z',
    ok: false,
    artifact: {
      sb3Path: injected,
      sha256: 'abc',
      projectJsonBytes: 2,
      assetCount: 0,
    },
    versions: {
      node: 'v0',
      vm: 'vm',
      scaffolding: 'scaffolding',
      parser: 'parser',
      jszip: 'jszip',
      playwright: 'playwright',
    },
    validation: { ok: false, errors: [injected] },
    vm: {
      ok: false,
      runtime: 'vm',
      errors: [injected],
      snapshots: [
        {
          tick: 0,
          targets: {
            [injected]: {
              x: 0,
              y: 0,
              direction: 90,
              costume: injected,
              visible: true,
            },
          },
          variables: { [injected]: injected },
        },
      ],
    },
    browser: {
      ok: false,
      runtime: 'browser',
      errors: [injected],
      snapshots: [],
      screenshots: [injected],
      consoleLog: [],
    },
  }

  try
  {
    writeReport(runRoot, report)
    const md = readFileSync(join(runRoot, 'report.md'), 'utf-8')
    assert.ok(md.includes(mdCode(injected)))
    assert.doesNotMatch(md, /^ {2}- \[sprite\]/m)
    assert.doesNotMatch(md, /^errors: \[sprite\]/m)
    assert.doesNotMatch(md, /^- \[sprite\]/m)
  }
  finally
  {
    rmSync(runRoot, { recursive: true, force: true })
  }
})
