// packages/eval/src/visual/visual-suite.ts
// bind the canonical collector renderer spec to its generated project

import { buildCollector } from '@scratch-agent/ir'

import { collectorRendererSpec } from '../core/repair-specs.js'
import type { TestCase } from '../core/test.js'

export const collectorCase: TestCase = {
  ...collectorRendererSpec,
  project: buildCollector(),
}

export const visualSuite: TestCase[] = [collectorCase]
