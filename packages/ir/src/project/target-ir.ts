// packages/ir/src/project/target-ir.ts
// typed editing view over one raw target (stage or sprite); mutates the underlying JSON

import type { Asset, Costume, ScalarVal, Target } from '@scratch-agent/sb3'

import { buildScript, type BlockSpec } from './build.js'
import { scriptsOf, type Script } from './scripts.js'
import type { Uids } from '../core/uid.js'

export class TargetIR
{
  constructor(
    readonly raw: Target,
    private readonly uids: Uids,
    private readonly sink: (asset: Asset) => void
  )
  {}

  get name(): string
  {
    return this.raw.name
  }

  get isStage(): boolean
  {
    return this.raw.isStage
  }

  scripts(): Script[]
  {
    return scriptsOf(this.raw)
  }

  variableNames(): string[]
  {
    return Object.values(this.raw.variables).map((v) => v[0])
  }

  listNames(): string[]
  {
    return Object.values(this.raw.lists ?? {}).map((v) => v[0])
  }

  broadcastNames(): string[]
  {
    return Object.values(this.raw.broadcasts ?? {})
  }

  // id of a variable by name within this target, if any
  variableId(name: string): string | undefined
  {
    for (const [id, v] of Object.entries(this.raw.variables))
    {
      if (v[0] === name) return id
    }
    return undefined
  }

  addVariable(name: string, value: ScalarVal = 0): string
  {
    const id = this.uids.next('var')
    this.raw.variables[id] = [name, value]
    return id
  }

  addList(name: string, items: ScalarVal[] = []): string
  {
    const id = this.uids.next('list')
    if (!this.raw.lists) this.raw.lists = {}
    this.raw.lists[id] = [name, items]
    return id
  }

  addBroadcast(name: string): string
  {
    const id = this.uids.next('bc')
    if (!this.raw.broadcasts) this.raw.broadcasts = {}
    this.raw.broadcasts[id] = name
    return id
  }

  addCostume(costume: Costume, bytes?: Uint8Array): void
  {
    this.raw.costumes.push(costume)
    if (bytes && costume.md5ext) this.sink({ path: costume.md5ext, bytes })
  }

  // add a script (a stacked chain of blocks) to this target; returns the top block id
  addScript(stack: BlockSpec[], pos: { x?: number; y?: number } = {}): string
  {
    const { topId, blocks } = buildScript(stack, this.uids, pos)
    Object.assign(this.raw.blocks, blocks)
    return topId
  }
}
