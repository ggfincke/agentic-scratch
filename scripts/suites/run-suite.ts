// scripts/suites/run-suite.ts
// prepares suite artifacts once & shares report persistence & status handling

import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import {
  runSuite,
  suiteReportEnvelopeJson,
  suiteReportEnvelopeMarkdown,
  type RunOptions,
  type SuiteProjectArtifact,
  type SuiteReportEnvelope,
  type SuiteResult,
  type TestCase,
} from '@scratch-agent/eval'
import { collectVersions, newRunId, sha256 } from '@scratch-agent/runner'

export async function runSuiteCli(input: {
  root: string
  prefix: string
  reportBasename: string
  reportTitle?: string
  cases: TestCase[]
  artifactRouting?: boolean
  printDetails: (result: SuiteResult) => void
}): Promise<void>
{
  const runId = `${input.prefix}-${newRunId()}`
  const runRoot = join(input.root, 'runs', runId)
  mkdirSync(runRoot, { recursive: true })

  const prepared: Array<{
    testCase: TestCase
    bytes: Uint8Array
    artifact: SuiteProjectArtifact
  }> = []
  for (const testCase of input.cases)
  {
    const bytes = await testCase.project.toSb3()
    prepared.push({
      testCase,
      bytes,
      artifact: {
        name: testCase.name,
        sha256: sha256(bytes),
        bytes: bytes.byteLength,
      },
    })
  }

  const results = []
  for (const project of prepared)
  {
    const options: RunOptions = {
      artifactBytes: project.bytes,
      ...(input.artifactRouting ? { artifactDir: runRoot } : {}),
    }
    const result = await runSuite([project.testCase], options)
    results.push(result.results[0]!)
  }
  const passed = results.filter((result) => result.ok).length
  const result: SuiteResult = {
    ok: results.every((entry) => entry.ok),
    total: results.length,
    passed,
    failed: results.length - passed,
    results,
  }
  const artifacts = prepared.map((project) => project.artifact)
  const suiteText = artifacts
    .map((project) => `${project.name}\0${project.sha256}\0${project.bytes}`)
    .join('\n')
  const envelope: SuiteReportEnvelope = {
    runId,
    createdAt: new Date().toISOString(),
    ok: result.ok,
    versions: collectVersions(),
    suite: {
      sha256: sha256(Buffer.from(suiteText, 'utf-8')),
      projects: artifacts,
    },
    result,
  }

  writeFileSync(
    join(runRoot, `${input.reportBasename}.json`),
    suiteReportEnvelopeJson(envelope)
  )
  writeFileSync(
    join(runRoot, `${input.reportBasename}.md`),
    suiteReportEnvelopeMarkdown(envelope, input.reportTitle)
  )

  input.printDetails(result)
  console.log(
    `\n${result.passed}/${result.total} passed -> ${join(runRoot, `${input.reportBasename}.md`)}`
  )
  if (!result.ok) process.exitCode = 1
}
