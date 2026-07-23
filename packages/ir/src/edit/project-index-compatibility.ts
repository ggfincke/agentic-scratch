// packages/ir/src/edit/project-index-compatibility.ts
// validate-compatible projection over the authoritative semantic index

import {
  isBlockEntry,
  type Block,
  type BlockEntry,
  type ProjectJson,
  type Target,
} from '@scratch-agent/sb3'

import {
  buildSemanticReferenceIndex,
  resolveBroadcastReference,
} from './reference-index.js'
import type {
  BroadcastResolution,
  SemanticReferenceIndex,
} from './reference-index-types.js'
import { ownRecordKeys } from './own-record.js'

export interface ProjectReferenceTargetIndex
{
  target: Target
  varIds: Set<string>
  listIds: Set<string>
  prototypes: Map<string, string[]>
}

export function isProjectReferenceBlock(
  entry: BlockEntry | undefined
): entry is Block
{
  return isBlockEntry(entry)
}

export class ProjectReferenceIndex
{
  readonly stage: Target | undefined
  readonly targetsByName = new Map<string, Target>()
  readonly spritesByName = new Map<string, Target>()
  readonly globalVarIds = new Set<string>()
  readonly globalListIds = new Set<string>()
  readonly broadcastIds = new Set<string>()
  readonly broadcastNames = new Set<string>()
  readonly perTarget = new Map<Target, ProjectReferenceTargetIndex>()
  readonly semantic: SemanticReferenceIndex

  constructor(json: ProjectJson)
  {
    const semantic = buildSemanticReferenceIndex({ json })
    this.semantic = semantic
    this.stage = json.targets.find((target) => target.isStage)

    for (
      let targetIndex = 0;
      targetIndex < json.targets.length;
      targetIndex++
    )
    {
      const target = json.targets[targetIndex]!
      if (!this.targetsByName.has(target.name))
        this.targetsByName.set(target.name, target)
      if (!target.isStage && !this.spritesByName.has(target.name))
        this.spritesByName.set(target.name, target)

      const varIds = new Set(ownRecordKeys(target.variables))
      const listIds = new Set(ownRecordKeys(target.lists))
      const prototypes = new Map<string, string[]>()
      for (const procedure of semantic.procedures)
      {
        if (procedure.target.targetIndex !== targetIndex) continue
        if (procedure.prototypes.length === 0) continue
        prototypes.set(
          procedure.proccode,
          procedure.prototypeSourceOrder.map((block) => block.blockId)
        )
      }
      this.perTarget.set(target, { target, varIds, listIds, prototypes })

      if (target.isStage)
      {
        for (const id of varIds) this.globalVarIds.add(id)
        for (const id of listIds) this.globalListIds.add(id)
      }
    }

    for (const broadcast of semantic.broadcasts)
    {
      this.broadcastIds.add(broadcast.declaration.id)
      this.broadcastNames.add(broadcast.declaration.name)
    }
  }

  resolveVar(target: Target, id: string): boolean
  {
    const local = this.perTarget.get(target)
    return (local?.varIds.has(id) ?? false) || this.globalVarIds.has(id)
  }

  resolveList(target: Target, id: string): boolean
  {
    const local = this.perTarget.get(target)
    return (local?.listIds.has(id) ?? false) || this.globalListIds.has(id)
  }

  resolveBroadcast(id: string): boolean
  {
    return this.broadcastIds.has(id)
  }

  broadcastResolution(
    id: string | null,
    name: string | null
  ): BroadcastResolution
  {
    return resolveBroadcastReference(this.semantic, id, name)
  }
}

export function buildProjectReferenceIndex(
  json: ProjectJson
): ProjectReferenceIndex
{
  return new ProjectReferenceIndex(json)
}
