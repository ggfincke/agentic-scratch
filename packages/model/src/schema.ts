// packages/model/src/schema.ts
// Whisker-compatible model JSON: Zod validation + lowering to runtime Model objects

import type { ScalarValue } from '@scratch-agent/runner'
import { z } from 'zod'

import { isImpureEffect, SUPPORTED_CHECKS, USER_INPUTS } from './checks.js'
import {
  MS_PER_TICK,
  type Check,
  type LoadedModels,
  type Model,
  type ModelEdge,
  type ModelNode,
  type UserInput,
} from './types.js'

const checkArg = z.union([z.string(), z.number(), z.boolean()])

// a condition or effect: name + optional negation + positional args (per Whisker's ICheckJSON)
const checkJson = z.object({
  name: z.string(),
  negated: z.boolean().optional().default(false),
  args: z.array(checkArg).optional().default([]),
})

const nodeJson = z.object({
  id: z.string(),
  label: z.string().optional().default(''),
})

const edgeJson = z.object({
  id: z.string(),
  label: z.string().optional().default(''),
  from: z.string(),
  to: z.string(),
  forceTestAt: z.number().optional().default(-1),
  forceTestAfter: z.number().optional().default(-1),
  conditions: z.array(checkJson).optional().default([]),
  effects: z.array(checkJson).optional().default([]),
})

// per-model guard memory; exprType is carried for fidelity but rejected at load (unsupported)
const storageTuple = z.union([
  z.tuple([z.literal('number'), z.number()]),
  z.tuple([z.literal('string'), z.string()]),
  z.tuple([z.literal('exprType'), z.union([z.string(), z.array(z.string())])]),
])

const modelJson = z.object({
  id: z.string(),
  usage: z.enum(['program', 'end', 'user']),
  type: z.string().optional().default('GreenFlag'),
  param: z.string().optional().default(''),
  maxDuration: z.number().optional().default(0),
  startNodeId: z.string(),
  stopAllNodeIds: z.array(z.string()).optional().default([]),
  nodes: z.array(nodeJson),
  edges: z.array(edgeJson).optional().default([]),
  initialStorage: z.record(z.string(), storageTuple).optional().default({}),
})

const modelFile = z.array(modelJson)

type ModelJson = z.infer<typeof modelJson>

// parse + validate raw JSON text into model objects (throws a ZodError on a malformed file)
export function parseModels(text: string): ModelJson[]
{
  return modelFile.parse(JSON.parse(text) as unknown)
}

// off (-1) stays off; else round ms to our 60 TPS ticks
function msToTicks(ms: number): number
{
  return ms < 0 ? -1 : Math.round(ms / MS_PER_TICK)
}

function toCheck(c: z.infer<typeof checkJson>): Check
{
  return { name: c.name, negated: c.negated, args: c.args }
}

function toUserInput(c: z.infer<typeof checkJson>): UserInput
{
  return { name: c.name, args: c.args }
}

function toStorage(
  modelId: string,
  raw: ModelJson['initialStorage']
): Record<string, ScalarValue>
{
  const out: Record<string, ScalarValue> = {}
  for (const [key, tuple] of Object.entries(raw))
  {
    if (tuple[0] === 'exprType')
    {
      throw new Error(
        `model "${modelId}": exprType initial storage is not yet supported (key "${key}")`
      )
    }
    out[key] = tuple[1]
  }
  return out
}

function buildModel(json: ModelJson): Model
{
  const nodes = new Map<string, ModelNode>()
  for (const n of json.nodes)
  {
    nodes.set(n.id, { id: n.id, label: n.label, outgoing: [], isStop: true })
  }
  if (!nodes.has(json.startNodeId))
  {
    throw new Error(
      `model "${json.id}": startNodeId "${json.startNodeId}" is not a declared node`
    )
  }

  const edges: ModelEdge[] = []
  const isUser = json.usage === 'user'
  for (const e of json.edges)
  {
    const from = nodes.get(e.from)
    if (!from)
    {
      throw new Error(
        `model "${json.id}": edge "${e.id}" from unknown node "${e.from}"`
      )
    }
    if (!nodes.has(e.to))
    {
      throw new Error(
        `model "${json.id}": edge "${e.id}" to unknown node "${e.to}"`
      )
    }
    // forced-timeout checks are parsed for fidelity but not yet driven by the runtime; reject a
    // model that relies on them rather than let it pass vacuously (default -1 == off)
    if (e.forceTestAt >= 0 || e.forceTestAfter >= 0)
    {
      throw new Error(
        `model "${json.id}": edge "${e.id}" uses forceTestAt/forceTestAfter, which is not yet supported`
      )
    }
    // conditions must be pure supported checks; effects may be pure or impure supported
    for (const c of e.conditions)
    {
      if (!SUPPORTED_CHECKS.has(c.name) || isImpureEffect(c.name))
      {
        throw new Error(
          `model "${json.id}": edge "${e.id}" has unsupported condition "${c.name}"`
        )
      }
    }
    for (const c of e.effects)
    {
      const ok = isUser ? USER_INPUTS.has(c.name) : SUPPORTED_CHECKS.has(c.name)
      if (!ok)
      {
        throw new Error(
          `model "${json.id}": edge "${e.id}" has unsupported effect "${c.name}"`
        )
      }
    }
    const edge: ModelEdge = {
      id: e.id,
      label: e.label,
      from: e.from,
      to: e.to,
      forceTestAtTicks: msToTicks(e.forceTestAt),
      forceTestAfterTicks: msToTicks(e.forceTestAfter),
      conditions: e.conditions.map(toCheck),
      effects: isUser ? [] : e.effects.map(toCheck),
      inputs: isUser ? e.effects.map(toUserInput) : [],
    }
    edges.push(edge)
    from.outgoing.push(edge)
    from.isStop = false
  }

  return {
    id: json.id,
    usage: json.usage,
    startNodeId: json.startNodeId,
    stopAllNodeIds: new Set(json.stopAllNodeIds),
    nodes,
    edges,
    initialStorage: toStorage(json.id, json.initialStorage),
    startTrigger: json.type,
    maxDurationTicks:
      isUser && json.maxDuration > 0 ? msToTicks(json.maxDuration) : null,
  }
}

// validate + lower a parsed model file into its program/end/user roles
export function loadModels(json: ModelJson[]): LoadedModels
{
  const models = json.map(buildModel)
  return {
    programModels: models.filter((m) => m.usage === 'program'),
    endModels: models.filter((m) => m.usage === 'end'),
    userModels: models.filter((m) => m.usage === 'user'),
  }
}

// parse text + lower in one step
export function loadModelsFromText(text: string): LoadedModels
{
  return loadModels(parseModels(text))
}
