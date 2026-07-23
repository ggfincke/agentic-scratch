// packages/validate/src/validate.ts
// run the graph/referential layer over an IR (or raw project.json) & collect diagnostics

import type { ProjectJson } from '@scratch-agent/sb3'
import type { ProjectIR } from '@scratch-agent/ir'

import {
  countBySeverity,
  Diagnostics,
  type Diagnostic,
  type DiagnosticCounts,
} from './diagnostics.js'
import { validateGraph } from './graph.js'
import { buildIndex, type ProjectIndex } from './project-index.js'

export interface ValidateResult
{
  diagnostics: Diagnostic[]
  counts: DiagnosticCounts
  // the index is reusable by the static layer so it is not rebuilt
  index: ProjectIndex
}

interface ValidateOptions
{
  assetPaths?: Set<string>
}

export function validateProjectJson(
  json: ProjectJson,
  opts: ValidateOptions = {}
): ValidateResult
{
  const index = buildIndex(json)
  const diags = new Diagnostics()
  validateGraph(json, index, diags, { assetPaths: opts.assetPaths })
  return { diagnostics: diags.list, counts: countBySeverity(diags.list), index }
}

export function validateProject(ir: ProjectIR): ValidateResult
{
  const assetPaths = new Set(ir.assets.map((a) => a.path))
  return validateProjectJson(ir.toProjectJson(), { assetPaths })
}
