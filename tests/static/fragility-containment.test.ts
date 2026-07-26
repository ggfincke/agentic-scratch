// tests/static/fragility-containment.test.ts
// proves fragility results stay outside the static diagnostic channel

import assert from 'node:assert/strict'
import { test } from 'node:test'

import * as staticApi from '@scratch-agent/static'
import {
  FRAGILITY_SIGNATURE_IDS,
  STATIC_DIAGNOSTIC_CODES,
  analyzeFragility,
  analyzeStatic,
  type FragilitySignatureId,
} from '@scratch-agent/static'
import { buildIndex } from '@scratch-agent/validate'

import {
  advisoryPositiveProject,
  startupPositiveProject,
  warpPositiveProject,
} from './fragility-positive-fixtures.js'

const STATIC_CODE_INVENTORY = [
  'message-never-received',
  'message-never-sent',
  'unused-variable',
  'unused-custom-block',
  'dead-code',
  'empty-script',
  'empty-control-body',
  'hide-without-show',
  'comparing-literals',
  'missing-backdrop',
  'ambiguous-custom-block-signature',
] as const

const FROZEN_FRAGILITY_SIGNATURE_IDS = [
  'fragility.warp-break',
  'fragility.startup-write-race',
  'fragility.warp-probe-restore',
  'fragility.timing-barrier-wait',
  'fragility.declaration-shadowing',
] as const satisfies readonly FragilitySignatureId[]

const PUBLIC_STATIC_EXPORTS = [
  'BOUNDARY_SEARCH_COMMANDS_V1',
  'BUDGET_BURNER_OPCODES_V1',
  'FRAGILITY_SIGNATURE_IDS',
  'MAX_TIMING_BARRIER_FINDINGS',
  'NON_BREAKER_SIBLINGS_V1',
  'PINNED_SCRATCH_AUDIO_VERSION',
  'PINNED_VM_SOURCE_FILES_V1',
  'PINNED_VM_VERSION',
  'STATIC_DIAGNOSTIC_CODES',
  'WARP_BREAKERS_V1',
  'WARP_TIME_MS',
  'analyzeFragility',
  'analyzeStatic',
  'analyzeStaticProject',
  'boundaryTableSha256',
  'broadcastReceivedName',
  'broadcastSentName',
  'buildProcedureCallGraph',
  'eachBlock',
  'effectiveWarp',
  'evaluateBoundary',
  'evaluateExecutionWindow',
  'findDeclarationShadowing',
  'findStartupWriteRaces',
  'findTimingBarrierWaits',
  'findTimingBarrierWaitsBounded',
  'findWarpBreaks',
  'findWarpProbeRestores',
  'isBudgetBurner',
  'isHat',
  'isLiteralPrimitive',
  'mixedContext',
  'prefixWalk',
  'primarySlot',
  'procedureCanReturn',
  'procedureEntryWarpState',
  'procedureExecution',
  'runStaticChecks',
  'scriptExecution',
  'warpBreakerFor',
] as const

const POSITIVE_FIXTURES = [
  ['warp closure', warpPositiveProject, ['fragility.warp-break']],
  [
    'startup race',
    () => startupPositiveProject(false),
    ['fragility.startup-write-race'],
  ],
  [
    'advisory patterns',
    () => advisoryPositiveProject(true),
    [
      'fragility.warp-probe-restore',
      'fragility.timing-barrier-wait',
      'fragility.declaration-shadowing',
    ],
  ],
] as const

test('T7 same positive fixtures prove exact static containment', () =>
{
  const emittedStaticCodes = new Set<string>()
  for (const [name, fixture, expectedSignatures] of POSITIVE_FIXTURES)
  {
    const json = fixture()
    const index = buildIndex(json)
    const staticResult = analyzeStatic(json, index)
    for (const diagnostic of staticResult.diagnostics)
    {
      emittedStaticCodes.add(diagnostic.code)
      assert.equal(
        diagnostic.code.startsWith('fragility.'),
        false,
        `${name} leaked ${diagnostic.code} into static diagnostics`
      )
    }

    const fragility = analyzeFragility(json, index)
    const signatures = new Set(
      [...fragility.findings, ...fragility.advisories].map(
        (finding) => finding.signature
      )
    )
    for (const signature of expectedSignatures)
      assert.ok(
        signatures.has(signature),
        `${name} is missing signature ${signature}`
      )
  }

  assert.deepEqual(
    [...emittedStaticCodes].sort(),
    [...STATIC_CODE_INVENTORY].sort()
  )
})

test('T7 static diagnostic codes equal the frozen public inventory', () =>
{
  assert.deepEqual(
    Object.values(STATIC_DIAGNOSTIC_CODES),
    STATIC_CODE_INVENTORY
  )
})

test('T7 fragility signature ids cannot collide with static codes', () =>
{
  assert.deepEqual(FRAGILITY_SIGNATURE_IDS, FROZEN_FRAGILITY_SIGNATURE_IDS)
  for (const signature of FROZEN_FRAGILITY_SIGNATURE_IDS)
  {
    assert.ok(signature.startsWith('fragility.'))
    assert.equal(
      STATIC_CODE_INVENTORY.includes(
        signature as (typeof STATIC_CODE_INVENTORY)[number]
      ),
      false
    )
  }
})

test('T7 analyzeStatic exposes exactly diagnostics & metrics', () =>
{
  const json = advisoryPositiveProject(true)
  const result = analyzeStatic(json, buildIndex(json))
  assert.deepEqual(Object.keys(result).sort(), ['diagnostics', 'metrics'])
})

test('T7 static package exports equal the frozen public contract', () =>
{
  assert.deepEqual(Object.keys(staticApi).sort(), PUBLIC_STATIC_EXPORTS)
})
