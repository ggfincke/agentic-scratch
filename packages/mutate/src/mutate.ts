// packages/mutate/src/mutate.ts
// generate mutant projects from a base ProjectIR & score which mutants a test suite kills

import { ProjectIR } from '@scratch-agent/ir'

import { enumerateSites, type MutationOperator } from './operators.js'

export interface MutationRecord
{
  id: string
  operator: MutationOperator
  sprite: string
  blockId: string
  opcode: string
  description: string
}

interface Mutant
{
  record: MutationRecord
  project: ProjectIR
}

// deep-clone the base project, apply one mutation site, return the mutant project + its record
export function mutants(base: ProjectIR): Mutant[]
{
  const sites = enumerateSites(base.json.targets)
  return sites.map((site, i) =>
  {
    const json = structuredClone(base.json)
    const target = json.targets[site.targetIndex]
    if (!target || target.name !== site.targetName)
    {
      throw new Error(
        `mutants: target ${site.targetIndex} "${site.targetName}" vanished in clone`
      )
    }
    site.apply(target)
    const record: MutationRecord = {
      id: `m${i}-${site.operator}`,
      operator: site.operator,
      sprite: site.targetName,
      blockId: site.blockId,
      opcode: site.opcode,
      description: site.describe,
    }
    // assets are immutable bytes; share them across mutants rather than re-clone
    return { record, project: ProjectIR.fromProjectJson(json, base.assets) }
  })
}

interface MutationOutcome
{
  record: MutationRecord
  killed: boolean
}

export interface MutationReport
{
  total: number
  killed: number
  survived: number
  // fraction of mutants the suite caught (1 when there are no mutants)
  score: number
  outcomes: MutationOutcome[]
  survivors: MutationRecord[]
}

// aggregate per-mutant kill outcomes into a mutation score + survivor list
export function scoreMutants(outcomes: MutationOutcome[]): MutationReport
{
  const killed = outcomes.filter((o) => o.killed).length
  return {
    total: outcomes.length,
    killed,
    survived: outcomes.length - killed,
    score: outcomes.length === 0 ? 1 : killed / outcomes.length,
    outcomes,
    survivors: outcomes.filter((o) => !o.killed).map((o) => o.record),
  }
}
