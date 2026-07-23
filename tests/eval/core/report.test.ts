// tests/eval/core/report.test.ts
// rendered VM suite reports keep project-controlled Markdown inert

import assert from 'node:assert/strict'
import { test } from 'node:test'

import { mdCode } from '@scratch-agent/runner'

import {
  suiteReportEnvelopeMarkdown,
  suiteReportMarkdown,
  type SuiteReportEnvelope,
} from '@scratch-agent/eval'
import type { SuiteResult } from '@scratch-agent/eval'

test('suiteReportMarkdown escapes project-controlled Markdown', () =>
{
  const injected = '[case](https://example.test)<img src=x>'
  const result: SuiteResult = {
    ok: false,
    total: 1,
    passed: 0,
    failed: 1,
    results: [
      {
        name: injected,
        ok: false,
        runtime: 'vm',
        snapshots: [],
        errors: [injected],
        asserts: [
          {
            ok: false,
            at: injected,
            probe: { on: 'timer' },
            matcher: { kind: 'equals', value: injected },
            expected: injected,
            observed: injected,
            location: { target: injected, hint: injected },
          },
        ],
        visual: [],
        screenshots: [],
        video: null,
        model: null,
        issues: [],
      },
    ],
  }

  const md = suiteReportMarkdown(result)
  assert.ok(md.includes(mdCode(injected)))
  assert.doesNotMatch(md, /^- \*\*FAIL\*\* \[case\]/m)
  assert.doesNotMatch(md, /^ {2}- run error: \[case\]/m)
  assert.doesNotMatch(md, /^ {4}- expected \[case\]/m)
})

test('suite report envelope includes versions and artifact identity', () =>
{
  const envelope: SuiteReportEnvelope = {
    runId: 'vmtest-run',
    createdAt: '2026-06-30T00:00:00.000Z',
    ok: true,
    versions: {
      node: 'v0',
      vm: 'vm',
      scaffolding: 'scaffolding',
      parser: 'parser',
      jszip: 'jszip',
      playwright: 'playwright',
    },
    suite: {
      sha256: 'suitehash',
      projects: [{ name: 'case', sha256: 'casehash', bytes: 12 }],
    },
    result: {
      ok: true,
      total: 1,
      passed: 1,
      failed: 0,
      results: [
        {
          name: 'case',
          ok: true,
          runtime: 'vm',
          snapshots: [],
          errors: [],
          asserts: [],
          visual: [],
          screenshots: [],
          video: null,
          model: null,
          issues: [],
        },
      ],
    },
  }

  const md = suiteReportEnvelopeMarkdown(envelope)
  assert.match(md, /suite sha256: `suitehash`/)
  assert.match(md, /@scratch\/scratch-vm `vm`/)
  assert.match(md, /`case`: sha256 `casehash`, 12 bytes/)
})
