// packages/static/src/analyze.ts
// entry point: run the static checks & compute basic size metrics

import type { ProjectJson } from '@scratch-agent/sb3'
import type { ProjectIR } from '@scratch-agent/ir'
import {
  buildIndex,
  Diagnostics,
  isBlock,
  type Diagnostic,
  type ProjectIndex,
} from '@scratch-agent/validate'

import { runStaticChecks } from './checks.js'

export interface StaticMetrics
{
  targets: number
  blocks: number
  scripts: number
  sprites: number
  costumes: number
  sounds: number
  monitors: number
  variables: number
  lists: number
  broadcasts: number
  comments: number
  extensions: number
}

export interface StaticResult
{
  diagnostics: Diagnostic[]
  metrics: StaticMetrics
}

function metricsOf(json: ProjectJson): StaticMetrics
{
  let blocks = 0
  let scripts = 0
  let costumes = 0
  let sounds = 0
  let variables = 0
  let lists = 0
  let broadcasts = 0
  let comments = 0
  for (const target of json.targets)
  {
    costumes += target.costumes.length
    sounds += target.sounds.length
    variables += Object.keys(target.variables).length
    lists += Object.keys(target.lists ?? {}).length
    broadcasts += Object.keys(target.broadcasts ?? {}).length
    comments += Object.keys(target.comments ?? {}).length
    for (const entry of Object.values(target.blocks))
    {
      if (!isBlock(entry)) continue
      blocks++
      if (entry.topLevel === true && entry.shadow !== true) scripts++
    }
  }
  return {
    targets: json.targets.length,
    blocks,
    scripts,
    sprites: json.targets.filter((t) => !t.isStage).length,
    costumes,
    sounds,
    monitors: json.monitors?.length ?? 0,
    variables,
    lists,
    broadcasts,
    comments,
    extensions: json.extensions?.length ?? 0,
  }
}

// reuse an existing index (built by the graph layer) to avoid a second pass
export function analyzeStatic(
  json: ProjectJson,
  index: ProjectIndex
): StaticResult
{
  const diags = new Diagnostics()
  runStaticChecks(json, index, diags)
  return { diagnostics: diags.list, metrics: metricsOf(json) }
}

export function analyzeStaticProject(ir: ProjectIR): StaticResult
{
  const json = ir.toProjectJson()
  return analyzeStatic(json, buildIndex(json))
}
