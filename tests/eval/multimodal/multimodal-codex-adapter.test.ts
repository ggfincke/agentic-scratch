// tests/eval/multimodal/multimodal-codex-adapter.test.ts
// consequential native Codex visual-judgment execution boundary proof

import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import {
  chmodSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import {
  MULTIMODAL_SCHEMA_VERSION,
  RUBRIC_JUDGMENT_JSON_SCHEMA,
  hashMultimodalJson,
  prepareVlmRequest,
  type RawRubricJudgmentV1,
  type RubricSpecV1,
  type VlmAdapterRequest,
} from '@scratch-agent/eval'

import {
  CODEX_DISABLED_FEATURES,
  CODEX_ENVIRONMENT_POLICY_VERSION,
  CODEX_ENVIRONMENT_VARIABLES,
  CODEX_EXEC_ADAPTER_VERSION,
  CodexExecVlmAdapter,
  assertCodexOutputSchemaCompatible,
  codexExecDescriptorVersion,
  parseCodexExecTrace,
  type CodexExecProcessInput,
  type CodexExecProcessResult,
} from '../../../scripts/multimodal/codex-adapter.js'

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64'
)
const CLI_VERSION = 'codex-cli test-v1'
const MODEL = 'test-codex-model'
const REASONING_EFFORT = 'medium'

function sha256(value: Uint8Array | string): string
{
  return createHash('sha256').update(value).digest('hex')
}

function rubric(): RubricSpecV1
{
  return {
    schemaVersion: MULTIMODAL_SCHEMA_VERSION,
    id: 'codex-adapter-rubric',
    version: '1',
    objective: 'judge the retained visual motion evidence',
    criteria: [
      {
        id: 'motion',
        requirement: 'required',
        evidenceKind: 'temporal',
        description: 'the object moves coherently',
        passAnchors: ['the object changes position'],
        failAnchors: ['the object remains stuck'],
      },
    ],
  }
}

function rawJudgment(): RawRubricJudgmentV1
{
  return {
    schemaVersion: MULTIMODAL_SCHEMA_VERSION,
    criteria: [
      {
        criterionId: 'motion',
        verdict: 'pass',
        confidence: 0.9,
        evidence: [
          {
            evidenceId: 'temporal-1',
            frameId: 'frame-1',
            tick: 6,
            region: null,
          },
        ],
        symptoms: [],
        limitation: null,
      },
    ],
  }
}

function request(): VlmAdapterRequest
{
  const specification = rubric()
  const templateText = 'judge only the trusted selected rubric criteria'
  return prepareVlmRequest({
    context: {
      artifactSha256: 'a'.repeat(64),
      scenarioSha256: 'b'.repeat(64),
      observationPlanSha256: 'c'.repeat(64),
      observationTraceSha256: 'd'.repeat(64),
      sampleOrdinal: 0,
    },
    mediaAdmission: {
      maxSubmittedMediaBytes: PNG.byteLength,
      maxUniqueClips: 1,
    },
    rubric: specification,
    rubricSha256: hashMultimodalJson(specification),
    selectedCriterionIds: ['motion'],
    criterionEvidence: [{ criterionId: 'motion', frameIds: ['frame-1'] }],
    prompt: {
      template: {
        id: 'codex-adapter-prompt',
        version: '1',
        sha256: sha256(templateText),
      },
      templateText,
    },
    outputSchema: {
      identity: {
        id: 'rubric-judgment-schema',
        version: '1',
        sha256: hashMultimodalJson(RUBRIC_JUDGMENT_JSON_SCHEMA),
      },
      value: RUBRIC_JUDGMENT_JSON_SCHEMA,
    },
    provider: {
      adapter: 'codex-cli',
      provider: 'codex-agent',
      model: MODEL,
      version: codexExecDescriptorVersion(CLI_VERSION, REASONING_EFFORT),
    },
    generation: { temperature: null, maxOutputTokens: 256 },
    images: [
      {
        binding: {
          evidenceId: 'temporal-1',
          frameId: 'frame-1',
          clipId: 'clip-1',
          tick: 6,
          mimeType: 'image/png',
          bytes: PNG.byteLength,
          sha256: sha256(PNG),
          width: 1,
          height: 1,
          detail: 'low',
        },
        bytes: PNG,
      },
    ],
  })
}

function trace(
  finalMessage: string,
  forbidden = false,
  outputTokens = 30
): Buffer
{
  const events: unknown[] = [
    { type: 'thread.started', thread_id: 'thread-test-1' },
    { type: 'turn.started' },
    ...(forbidden
      ? [
          {
            type: 'item.completed',
            item: { type: 'command_execution', command: 'forbidden' },
          },
        ]
      : []),
    {
      type: 'item.completed',
      item: { type: 'agent_message', text: finalMessage },
    },
    {
      type: 'turn.completed',
      usage: {
        input_tokens: 100,
        cached_input_tokens: 20,
        output_tokens: outputTokens,
        reasoning_output_tokens: 10,
      },
    },
  ]
  return Buffer.from(
    events.map((event) => JSON.stringify(event)).join('\n') + '\n'
  )
}

function processResult(
  finalMessage: string,
  forbidden = false,
  outputTokens = 30
): CodexExecProcessResult
{
  return {
    exitCode: 0,
    signal: null,
    timedOut: false,
    aborted: false,
    stdoutLimitExceeded: false,
    stderrLimitExceeded: false,
    settlementTimedOut: false,
    spawnError: null,
    trace: trace(finalMessage, forbidden, outputTokens),
    stderr: Buffer.alloc(0),
    finalMessage: Buffer.from(finalMessage),
  }
}

test('native Codex adapter preserves its isolated judgment contract', async (t) =>
{
  const root = mkdtempSync(join(tmpdir(), 'agentic-scratch-codex-adapter-'))
  const originalAuthToken = process.env.SAMPLE_AUTH_TOKEN
  process.env.SAMPLE_AUTH_TOKEN = 'must-not-reach-codex'
  t.after(() =>
  {
    if (originalAuthToken === undefined) delete process.env.SAMPLE_AUTH_TOKEN
    else process.env.SAMPLE_AUTH_TOKEN = originalAuthToken
    rmSync(root, { recursive: true, force: true })
  })

  await t.test('retains one exact tool-free structured execution', async () =>
  {
    const prepared = request()
    const raw = rawJudgment()
    const finalMessage = JSON.stringify(raw)
    const observed: CodexExecProcessInput[] = []
    const adapter = new CodexExecVlmAdapter({
      model: MODEL,
      reasoningEffort: REASONING_EFFORT,
      evidenceRoot: join(root, 'success'),
      cliVersion: CLI_VERSION,
      loginStatus: 'Logged in using ChatGPT',
      processRunner: async (input) =>
      {
        observed.push(input)
        return processResult(finalMessage)
      },
    })
    const response = await adapter.evaluate(
      prepared,
      new AbortController().signal
    )
    assert.equal(response.outcome, 'completed')
    assert.deepEqual(response.raw, raw)
    assert.equal(response.usage.totalTokens, 130)
    const invocation = observed[0]
    assert.ok(invocation)
    assert.ok(invocation.args.includes('--ephemeral'))
    assert.ok(invocation.args.includes('--ignore-user-config'))
    assert.ok(invocation.args.includes('--ignore-rules'))
    assert.ok(invocation.args.includes('--strict-config'))
    assert.equal(invocation.args[0], 'exec')
    assert.match(invocation.args[1]!, /isolated visual-judgment task/)
    assert.equal(invocation.env.SAMPLE_AUTH_TOKEN, undefined)
    assert.equal(invocation.env.NO_COLOR, '1')
    const expectedEnvironmentNames = CODEX_ENVIRONMENT_VARIABLES.filter(
      (name) => name === 'NO_COLOR' || process.env[name] !== undefined
    ).sort()
    assert.deepEqual(
      Object.keys(invocation.env).sort(),
      expectedEnvironmentNames
    )
    const disabledFeatures = invocation.args.flatMap((argument, index) =>
      argument === '--disable' ? [invocation.args[index + 1]!] : []
    )
    assert.deepEqual(disabledFeatures, [...CODEX_DISABLED_FEATURES])
    assert.ok(
      invocation.args.includes('shell_environment_policy.inherit="none"')
    )
    assert.ok(
      invocation.args.includes(
        'features.rollout_budget={enabled=true,limit_tokens=256,reminder_at_remaining_tokens=[],sampling_token_weight=1.0,prefill_token_weight=0.0}'
      )
    )
    const imageIndex = invocation.args.indexOf('--image')
    assert.notEqual(imageIndex, -1)
    const imagePath = invocation.args[imageIndex + 1]
    assert.ok(imagePath)
    assert.deepEqual(readFileSync(imagePath), PNG)
    const execution = adapter.executionFor(prepared.requestKey)
    assert.ok(execution)
    assert.equal(execution.adapterVersion, CODEX_EXEC_ADAPTER_VERSION)
    assert.equal(execution.outcome, 'completed')
    assert.equal(execution.invocation.command, 'codex')
    assert.equal(
      execution.invocation.environmentPolicyVersion,
      CODEX_ENVIRONMENT_POLICY_VERSION
    )
    assert.deepEqual(
      execution.invocation.environmentVariableNames,
      expectedEnvironmentNames
    )
    assert.equal(execution.invocation.toolsDisabled, true)
    assert.equal(execution.invocation.outputTokenLimit, 256)
    assert.equal(
      execution.invocation.canonicalArgumentsSha256,
      sha256(JSON.stringify(execution.invocation.canonicalArguments))
    )
    assert.match(
      execution.invocation.canonicalArguments[1]!,
      /^<effective-prompt-sha256:[a-f0-9]{64}>$/
    )
    assert.deepEqual(execution.trace.forbiddenItems, [])
    assert.equal(execution.trace.turnStarted, true)
    assert.equal(execution.trace.eventCount, 4)
    assert.equal(execution.trace.nativeUsage.reasoning_output_tokens, 10)
    assert.equal(execution.evidence.images[0]?.file.sha256, sha256(PNG))
    assert.ok(Object.isFrozen(execution))
    assert.equal(adapter.executions().length, 1)
  })

  await t.test(
    'rejects non-ChatGPT authentication before execution',
    async () =>
    {
      let executed = false
      const adapter = new CodexExecVlmAdapter({
        model: MODEL,
        reasoningEffort: REASONING_EFFORT,
        evidenceRoot: join(root, 'wrong-auth'),
        cliVersion: CLI_VERSION,
        loginStatus: 'Logged in using an API token',
        processRunner: async () =>
        {
          executed = true
          return processResult(JSON.stringify(rawJudgment()))
        },
      })
      await assert.rejects(
        adapter.evaluate(request(), new AbortController().signal),
        /requires ChatGPT authentication/
      )
      assert.equal(executed, false)
    }
  )

  await t.test(
    'keeps preparation independent from login and execution',
    async () =>
    {
      const prepared = request()
      let executed = false
      const adapter = new CodexExecVlmAdapter({
        model: MODEL,
        reasoningEffort: REASONING_EFFORT,
        evidenceRoot: join(root, 'prepare-only'),
        cliVersion: CLI_VERSION,
        prepareOnly: true,
        processRunner: async () =>
        {
          executed = true
          return processResult(JSON.stringify(rawJudgment()))
        },
      })
      assert.equal(adapter.admit(prepared).accepted, true)
      await assert.rejects(
        adapter.evaluate(prepared, new AbortController().signal),
        /prepare-only Codex adapter cannot execute/
      )
      assert.equal(executed, false)
    }
  )

  await t.test('fails closed when the agent invokes a tool', async () =>
  {
    const prepared = request()
    const finalMessage = JSON.stringify(rawJudgment())
    const adapter = new CodexExecVlmAdapter({
      model: MODEL,
      reasoningEffort: REASONING_EFFORT,
      evidenceRoot: join(root, 'forbidden-tool'),
      cliVersion: CLI_VERSION,
      loginStatus: 'Logged in using ChatGPT',
      processRunner: async () => processResult(finalMessage, true),
    })
    const response = await adapter.evaluate(
      prepared,
      new AbortController().signal
    )
    assert.equal(response.outcome, 'provider-error')
    const execution = adapter.executionFor(prepared.requestKey)
    assert.ok(execution)
    assert.equal(execution.outcome, 'failed')
    assert.deepEqual(execution.trace.forbiddenItems, ['command_execution'])
    assert.equal(execution.response, null)
  })

  await t.test('fails closed when output usage exceeds the bound', async () =>
  {
    const prepared = request()
    const finalMessage = JSON.stringify(rawJudgment())
    const adapter = new CodexExecVlmAdapter({
      model: MODEL,
      reasoningEffort: REASONING_EFFORT,
      evidenceRoot: join(root, 'output-overrun'),
      cliVersion: CLI_VERSION,
      loginStatus: 'Logged in using ChatGPT',
      processRunner: async () => processResult(finalMessage, false, 257),
    })
    const response = await adapter.evaluate(
      prepared,
      new AbortController().signal
    )
    assert.equal(response.outcome, 'provider-error')
    const execution = adapter.executionFor(prepared.requestKey)
    assert.ok(execution)
    assert.match(execution.error?.message ?? '', /output usage exceeded/)
  })

  await t.test(
    'bounds a child-created oversized final-message file',
    async () =>
    {
      const prepared = request()
      const finalMessage = JSON.stringify(rawJudgment())
      const evidenceRoot = join(root, 'oversized-final-file')
      const adapter = new CodexExecVlmAdapter({
        model: MODEL,
        reasoningEffort: REASONING_EFFORT,
        evidenceRoot,
        cliVersion: CLI_VERSION,
        loginStatus: 'Logged in using ChatGPT',
        maxFinalBytes: 1024,
        processRunner: async (input) =>
        {
          writeFileSync(input.finalMessagePath, Buffer.alloc(1025, 0x61))
          return processResult(finalMessage)
        },
      })
      const response = await adapter.evaluate(
        prepared,
        new AbortController().signal
      )
      assert.equal(response.outcome, 'provider-error')
      const execution = adapter.executionFor(prepared.requestKey)
      assert.ok(execution)
      assert.equal(execution.outcome, 'failed')
      assert.match(execution.error?.message ?? '', /exceeds 1024 bytes/)
      assert.equal(execution.evidence.finalMessage.byteLength, 0)
      assert.equal(
        readFileSync(
          join(evidenceRoot, execution.evidence.finalMessage.relativePath)
        ).byteLength,
        0
      )
    }
  )

  await t.test(
    'rejects a symlinked final-message without touching its target',
    async () =>
    {
      const prepared = request()
      const finalMessage = JSON.stringify(rawJudgment())
      const evidenceRoot = join(root, 'symlinked-final-file')
      const target = join(root, 'symlink-target.json')
      writeFileSync(target, 'target-must-remain-unchanged')
      chmodSync(target, 0o640)
      const targetMode = statSync(target).mode & 0o777
      const adapter = new CodexExecVlmAdapter({
        model: MODEL,
        reasoningEffort: REASONING_EFFORT,
        evidenceRoot,
        cliVersion: CLI_VERSION,
        loginStatus: 'Logged in using ChatGPT',
        processRunner: async (input) =>
        {
          symlinkSync(target, input.finalMessagePath)
          return processResult(finalMessage)
        },
      })
      const response = await adapter.evaluate(
        prepared,
        new AbortController().signal
      )
      assert.equal(response.outcome, 'provider-error')
      const execution = adapter.executionFor(prepared.requestKey)
      assert.ok(execution)
      assert.equal(execution.outcome, 'failed')
      assert.match(execution.error?.message ?? '', /artifact was rejected/)
      assert.equal(readFileSync(target, 'utf8'), 'target-must-remain-unchanged')
      assert.equal(statSync(target).mode & 0o777, targetMode)
      assert.equal(execution.evidence.finalMessage.byteLength, 0)
    }
  )

  await t.test(
    'does not spawn when the request is already aborted',
    async () =>
    {
      const prepared = request()
      const adapter = new CodexExecVlmAdapter({
        model: MODEL,
        reasoningEffort: REASONING_EFFORT,
        evidenceRoot: join(root, 'already-aborted'),
        cliVersion: CLI_VERSION,
        loginStatus: 'Logged in using ChatGPT',
        command: 'must-not-be-spawned',
      })
      const controller = new AbortController()
      controller.abort()
      const response = await adapter.evaluate(prepared, controller.signal)
      assert.equal(response.outcome, 'provider-error')
      const execution = adapter.executionFor(prepared.requestKey)
      assert.ok(execution)
      assert.equal(execution.process.aborted, true)
      assert.equal(execution.process.spawnError, null)
    }
  )

  await t.test('rejects malformed and out-of-order trace events', () =>
  {
    const malformedTrace = Buffer.from(
      [
        JSON.stringify({ type: 'thread.started', thread_id: 'thread-bad' }),
        'null',
        JSON.stringify({ type: 'future.event' }),
        JSON.stringify({
          type: 'item.completed',
          item: { type: 'command_execution' },
        }),
        JSON.stringify({ type: 'turn.started' }),
        JSON.stringify({
          type: 'item.completed',
          item: { type: 'agent_message', text: '{}' },
        }),
        JSON.stringify({
          type: 'turn.completed',
          usage: { input_tokens: 1, output_tokens: 1 },
        }),
        JSON.stringify({ type: 'turn.started' }),
      ].join('\n') + '\n'
    )
    const parsed = parseCodexExecTrace(malformedTrace, MODEL)
    assert.deepEqual(parsed.forbiddenItems, ['command_execution'])
    assert.match(parsed.errors.join('; '), /not a JSON object/)
    assert.match(parsed.errors.join('; '), /unknown event type future\.event/)
    assert.match(parsed.errors.join('; '), /item\.completed is out of sequence/)
    assert.match(parsed.errors.join('; '), /after a terminal turn event/)
    assert.match(parsed.errors.join('; '), /2 turn starts/)
  })

  await t.test('preflights the strict Codex output-schema subset', () =>
  {
    assert.doesNotThrow(() =>
      assertCodexOutputSchemaCompatible(request().outputSchema)
    )
    assert.throws(
      () =>
        assertCodexOutputSchemaCompatible({
          type: 'object',
          additionalProperties: false,
          required: ['schemaVersion'],
          properties: { schemaVersion: { const: 1 } },
        }),
      /const must declare its primitive type/
    )
    assert.throws(
      () =>
        assertCodexOutputSchemaCompatible({
          type: 'object',
          additionalProperties: false,
          required: ['score'],
          properties: {
            score: { type: 'number', minimum: 0 },
          },
        }),
      /unsupported keyword minimum/
    )
  })
})
