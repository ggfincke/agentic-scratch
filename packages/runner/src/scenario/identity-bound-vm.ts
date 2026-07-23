// packages/runner/src/scenario/identity-bound-vm.ts
// resolve & drive identity-bound actions against a live VM through the seam lineage index

import type {
  IdentityBoundBroadcastActionV1,
  IdentityBoundBroadcastDispatchV1,
  IdentityBoundBroadcastResolutionV1,
  IdentityBoundResolvedBroadcastV1,
  IdentityBoundResolvedTargetV1,
  IdentityBoundTargetResolutionV1,
} from './identity-bound-scenario.js'
import type { RuntimeLineageTargetIndexV1 } from '../lineage/runtime-lineage-vm.js'
import type { ScratchRuntime, ScratchTarget, ScratchThread } from '../vm/vm-api.js'

const BROADCAST_RECEIVED_OPCODE = 'event_whenbroadcastreceived'
const SPRITE_CLICKED_OPCODE = 'event_whenthisspriteclicked'

interface ReceiverScriptCount
{
  readonly target: ScratchTarget
  readonly scriptCount: number
}

// mirror of the pinned runtime's own hat dispatch: BlocksRuntimeCache.getScripts
// walks `_scripts` top-level ids for the opcode, & startHats compares the
// uppercased BROADCAST_OPTION field value -> an independent receiver derivation
function proveBroadcastReceiverScripts(
  runtime: ScratchRuntime,
  name: string
): {
  readonly receivers: readonly ReceiverScriptCount[]
  readonly inconsistentFields: number
}
{
  const wanted = name.toUpperCase()
  const receivers: ReceiverScriptCount[] = []
  let inconsistentFields = 0
  for (const target of runtime.targets)
  {
    if (!target.isOriginal) continue
    const blocks = target.blocks
    if (!blocks) continue
    let scriptCount = 0
    for (const topBlockId of blocks._scripts ?? [])
    {
      const block = blocks._blocks[topBlockId]
      if (!block || block.opcode !== BROADCAST_RECEIVED_OPCODE) continue
      const value = block.fields?.BROADCAST_OPTION?.value
      if (typeof value !== 'string')
      {
        inconsistentFields += 1
        continue
      }
      if (value.toUpperCase() !== wanted) continue
      scriptCount += 1
    }
    if (scriptCount > 0) receivers.push({ target, scriptCount })
  }
  return { receivers: Object.freeze(receivers), inconsistentFields }
}

// a thread's target may be a clone; clones share the original's sprite object, so
// the sprite identity maps a running receiver back to its origin lineage
function lineageOf(
  index: RuntimeLineageTargetIndexV1,
  target: ScratchTarget | undefined
): string | null
{
  if (!target) return null
  for (const lineage of index.lineages)
  {
    const bound = index.resolve(lineage) as ScratchTarget | null
    if (!bound) continue
    if (bound === target) return lineage
    if (bound.sprite && target.sprite && bound.sprite === target.sprite)
      return lineage
  }
  return null
}

export class IdentityBoundVmBinder
{
  constructor(
    private readonly runtime: ScratchRuntime,
    private readonly index: RuntimeLineageTargetIndexV1
  )
  {}

  resolveTargetLineage(targetLineage: string): IdentityBoundTargetResolutionV1
  {
    if (this.index.status !== 'bound')
      return {
        status: 'inconclusive',
        targetLineage,
        reason: 'lineage-index-unavailable',
        detail:
          'the lane holds no verified runtime lineage binding; name & ordinal fallback is refused',
      }
    const bound = this.index.resolve(targetLineage)
    if (!bound)
      return {
        status: 'inconclusive',
        targetLineage,
        reason: 'lineage-not-bound',
        detail: `no seam-bound runtime target carries lineage ${targetLineage}`,
      }
    return { status: 'resolved', targetLineage }
  }

  resolveBroadcast(
    action: IdentityBoundBroadcastActionV1
  ): IdentityBoundBroadcastResolutionV1
  {
    const base = {
      broadcastLineage: action.broadcastLineage,
      name: action.name,
    }
    if (action.name.length === 0)
      return {
        ...base,
        status: 'inconclusive',
        reason: 'broadcast-name-empty',
        detail: 'the lowered broadcast carries no concrete message name',
      }
    if (this.index.status !== 'bound')
      return {
        ...base,
        status: 'inconclusive',
        reason: 'lineage-index-unavailable',
        detail:
          'the lane holds no verified runtime lineage binding; receivers cannot be identified',
      }
    const proof = proveBroadcastReceiverScripts(this.runtime, action.name)
    if (proof.inconsistentFields > 0)
      return {
        ...base,
        status: 'inconclusive',
        reason: 'broadcast-receiver-unmapped',
        detail: `${proof.inconsistentFields} broadcast hat field(s) carry no readable message name`,
      }
    const proven: string[] = []
    for (const receiver of proof.receivers)
    {
      const lineage = lineageOf(this.index, receiver.target)
      if (lineage === null)
        return {
          ...base,
          status: 'inconclusive',
          reason: 'broadcast-receiver-unmapped',
          detail: `a receiver of "${action.name}" is not bound to any manifest lineage`,
        }
      proven.push(lineage)
    }
    const expected = [...action.expectedReceiverTargetLineages].sort()
    const sortedProven = [...proven].sort()
    if (expected.length !== sortedProven.length)
      return {
        ...base,
        status: 'inconclusive',
        reason: 'broadcast-receiver-cardinality',
        detail: `"${action.name}" resolves ${sortedProven.length} receiver target(s) but the lowering expects ${expected.length}`,
      }
    if (
      expected.some((lineage, position) => lineage !== sortedProven[position])
    )
      return {
        ...base,
        status: 'inconclusive',
        reason: 'broadcast-receiver-identity',
        detail: `"${action.name}" resolves receivers ${JSON.stringify(sortedProven)} but the lowering expects ${JSON.stringify(expected)}`,
      }
    return {
      ...base,
      status: 'resolved',
      provenReceiverTargetLineages: Object.freeze(sortedProven),
      receiverScriptCount: proof.receivers.reduce(
        (total, receiver) => total + receiver.scriptCount,
        0
      ),
    }
  }

  // invoke the exact bound runtime target object; getSpriteTargetByName is never called
  clickResolvedTarget(resolved: IdentityBoundResolvedTargetV1): void
  {
    const bound = this.index.resolve(
      resolved.targetLineage
    ) as ScratchTarget | null
    if (!bound)
      throw new Error(
        `identity-bound click lost its target object for ${resolved.targetLineage}`
      )
    this.runtime.startHats(SPRITE_CLICKED_OPCODE, null, bound)
  }

  startResolvedBroadcast(resolved: IdentityBoundResolvedBroadcastV1): {
    readonly threads: readonly ScratchThread[]
    readonly dispatch: IdentityBoundBroadcastDispatchV1
  }
  {
    // startHats uppercases the match record in place, so it gets a fresh object
    const threads =
      this.runtime.startHats(BROADCAST_RECEIVED_OPCODE, {
        BROADCAST_OPTION: resolved.name,
      }) ?? []
    const started = new Set<string>()
    let unmappedThreadCount = 0
    for (const thread of threads)
    {
      const target = (thread as { target?: ScratchTarget }).target
      const lineage = lineageOf(this.index, target)
      if (lineage === null) unmappedThreadCount += 1
      else started.add(lineage)
    }
    return {
      threads,
      dispatch: Object.freeze({
        startedReceiverTargetLineages: Object.freeze([...started].sort()),
        startedThreadCount: threads.length,
        unmappedThreadCount,
      }),
    }
  }

  threadStillRunning(threads: readonly ScratchThread[]): boolean
  {
    return threads.some((thread) => this.runtime.threads.indexOf(thread) !== -1)
  }
}
