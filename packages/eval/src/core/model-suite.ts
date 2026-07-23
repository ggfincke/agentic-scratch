// packages/eval/src/core/model-suite.ts
// bind the canonical state-game model spec to its generated project

import { buildStateGame } from '@scratch-agent/ir'

import { stateWinSpec } from './repair-specs.js'
import type { TestCase } from './test.js'

export const stateGameCase: TestCase = {
  ...stateWinSpec,
  project: buildStateGame(),
}

export const modelSuite: TestCase[] = [stateGameCase]
