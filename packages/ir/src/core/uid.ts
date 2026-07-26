// packages/ir/src/core/uid.ts
// deterministic IDs, edit-session reservations, & collision-universe scans

import { isBlockEntry, type ProjectJson } from '@scratch-agent/sb3'

import { parseMutationArray } from '../edit/semantic-index/procedure-mutation.js'
import { ownRecordKeys, ownRecordValue } from '../edit/support/own-record.js'
import { compareText } from '../internal/compare-text.js'

const UID_ALLOCATOR_VERSION = 'scratch-uids-v2' as const

const GENERATED_UID_NAMESPACE_PATTERN =
  /^(?:b|var|list|bc|broadcast|comment|target|script|proc|arg|costume|sound|media|monitor)-[0-9a-z]+(?:-[0-9a-z]+)*$/i

export interface UidSnapshot
{
  version: typeof UID_ALLOCATOR_VERSION
  counter: number
  usedIds: readonly string[]
  generatedReservationIds: readonly string[]
  pendingReservationIds: readonly string[]
  tombstonedIds: readonly string[]
}

function assertSnapshot(snapshot: UidSnapshot): void
{
  if (snapshot.version !== UID_ALLOCATOR_VERSION)
    throw new Error(`unsupported UID snapshot version: ${snapshot.version}`)
  if (!Number.isSafeInteger(snapshot.counter) || snapshot.counter < 0)
    throw new Error('UID snapshot counter must be a nonnegative safe integer')
  for (const [name, values] of [
    ['usedIds', snapshot.usedIds],
    ['generatedReservationIds', snapshot.generatedReservationIds],
    ['pendingReservationIds', snapshot.pendingReservationIds],
    ['tombstonedIds', snapshot.tombstonedIds],
  ] as const)
  {
    if (new Set(values).size !== values.length)
      throw new Error(`UID snapshot ${name} must contain unique IDs`)
    if (values.some((value) => typeof value !== 'string'))
      throw new Error(`UID snapshot ${name} must contain only strings`)
  }
  const used = new Set(snapshot.usedIds)
  const generated = new Set(snapshot.generatedReservationIds)
  const pending = new Set(snapshot.pendingReservationIds)
  const tombstoned = new Set(snapshot.tombstonedIds)
  for (const id of generated)
  {
    if (!used.has(id))
      throw new Error(`UID snapshot generated ID is absent from usedIds: ${id}`)
  }
  for (const id of [
    ...snapshot.pendingReservationIds,
    ...snapshot.tombstonedIds,
  ])
  {
    if (!used.has(id))
      throw new Error(`UID snapshot reservation is absent from usedIds: ${id}`)
    if (!generated.has(id))
      throw new Error(
        `UID snapshot reservation is absent from generatedReservationIds: ${id}`
      )
  }
  for (const id of pending)
  {
    if (tombstoned.has(id))
      throw new Error(`UID snapshot reservation has conflicting status: ${id}`)
  }
  if (generated.size !== pending.size + tombstoned.size)
    throw new Error(
      'UID snapshot generated reservations must have exactly one status'
    )
}

export class Uids
{
  private readonly used: Set<string>
  private readonly generatedReservations: Set<string>
  private readonly pendingReservations: Set<string>
  private readonly tombstones: Set<string>
  private counter: number

  constructor(used: Iterable<string> = [])
  {
    this.used = new Set(used)
    this.generatedReservations = new Set()
    this.pendingReservations = new Set()
    this.tombstones = new Set()
    this.counter = 0
  }

  static fromSnapshot(snapshot: UidSnapshot): Uids
  {
    assertSnapshot(snapshot)
    const allocator = new Uids(snapshot.usedIds)
    allocator.counter = snapshot.counter
    for (const id of snapshot.generatedReservationIds)
      allocator.generatedReservations.add(id)
    for (const id of snapshot.pendingReservationIds)
      allocator.pendingReservations.add(id)
    for (const id of snapshot.tombstonedIds) allocator.tombstones.add(id)
    return allocator
  }

  has(id: string): boolean
  {
    return this.used.has(id)
  }

  isPending(id: string): boolean
  {
    return this.pendingReservations.has(id)
  }

  isTombstoned(id: string): boolean
  {
    return this.tombstones.has(id)
  }

  reserve(id: string): void
  {
    this.used.add(id)
  }

  reserveHistorical(id: string): void
  {
    this.used.add(id)
    this.generatedReservations.add(id)
    this.pendingReservations.delete(id)
    this.tombstones.add(id)
  }

  clone(): Uids
  {
    return Uids.fromSnapshot(this.snapshot())
  }

  snapshot(): UidSnapshot
  {
    return {
      version: UID_ALLOCATOR_VERSION,
      counter: this.counter,
      usedIds: [...this.used].sort(compareText),
      generatedReservationIds: [...this.generatedReservations].sort(
        compareText
      ),
      pendingReservationIds: [...this.pendingReservations].sort(compareText),
      tombstonedIds: [...this.tombstones].sort(compareText),
    }
  }

  acceptReservations(): readonly string[]
  {
    const accepted = [...this.pendingReservations].sort(compareText)
    for (const id of accepted) this.tombstones.add(id)
    this.pendingReservations.clear()
    return accepted
  }

  commit(candidate: Uids): readonly string[]
  {
    if (candidate === this)
      throw new Error('candidate UID allocator must be an isolated clone')
    for (const id of this.used)
    {
      if (!candidate.used.has(id))
        throw new Error('candidate UID allocator does not descend from base')
    }
    if (candidate.counter < this.counter)
      throw new Error('candidate UID allocator rewinds the allocation counter')
    for (const id of this.generatedReservations)
    {
      if (!candidate.generatedReservations.has(id))
        throw new Error(
          'candidate UID allocator forgets generated reservation history'
        )
    }
    for (const id of this.tombstones)
    {
      if (!candidate.tombstones.has(id))
        throw new Error('candidate UID allocator forgets a tombstoned ID')
    }
    for (const id of this.pendingReservations)
    {
      if (
        !candidate.pendingReservations.has(id) &&
        !candidate.tombstones.has(id)
      )
        throw new Error('candidate UID allocator forgets a pending reservation')
    }
    for (const id of candidate.used)
    {
      if (!this.used.has(id) && !candidate.generatedReservations.has(id))
        throw new Error(
          `candidate UID allocator introduces an untracked reservation: ${id}`
        )
    }
    for (const id of candidate.pendingReservations)
    {
      if (
        candidate.tombstones.has(id) ||
        !candidate.generatedReservations.has(id)
      )
        throw new Error('candidate UID allocator has invalid pending state')
      if (this.used.has(id) && !this.pendingReservations.has(id))
        throw new Error(
          `candidate UID allocator reclassifies a preexisting ID: ${id}`
        )
    }
    for (const id of candidate.generatedReservations)
    {
      if (
        !this.generatedReservations.has(id) &&
        !candidate.pendingReservations.has(id)
      )
        throw new Error(
          `candidate UID allocator introduces unreported history: ${id}`
        )
    }
    const newlyAccepted = [...candidate.pendingReservations].sort(compareText)
    this.counter = candidate.counter
    for (const id of candidate.used) this.used.add(id)
    for (const id of candidate.generatedReservations)
      this.generatedReservations.add(id)
    for (const id of candidate.tombstones) this.tombstones.add(id)
    for (const id of candidate.pendingReservations) this.tombstones.add(id)
    this.pendingReservations.clear()
    return newlyAccepted
  }

  restoreMonotonic(snapshot: UidSnapshot): void
  {
    assertSnapshot(snapshot)
    for (const id of snapshot.generatedReservationIds)
    {
      if (this.used.has(id) && !this.generatedReservations.has(id))
        throw new Error(
          `UID snapshot reclassifies a preexisting ID as generated: ${id}`
        )
    }
    this.counter = Math.max(this.counter, snapshot.counter)
    for (const id of snapshot.usedIds) this.used.add(id)
    for (const id of snapshot.generatedReservationIds)
      this.generatedReservations.add(id)
    for (const id of snapshot.tombstonedIds)
      this.tombstones.add(id)
    for (const id of snapshot.pendingReservationIds)
      this.tombstones.add(id)
    for (const id of this.pendingReservations) this.tombstones.add(id)
    this.pendingReservations.clear()
  }

  // fresh id not colliding w/ any seen/reserved id; deterministic given call order
  next(prefix = 'b'): string
  {
    let id = ''
    do
    {
      id = `${prefix}-${(this.counter++).toString(36)}`
    } while (this.used.has(id))
    this.used.add(id)
    this.generatedReservations.add(id)
    this.pendingReservations.add(id)
    return id
  }
}

function addGeneratedNamespaceStrings(
  value: unknown,
  ids: Set<string>,
  seen: WeakSet<object>
): void
{
  if (typeof value === 'string')
  {
    if (GENERATED_UID_NAMESPACE_PATTERN.test(value)) ids.add(value)
    return
  }
  if (value === null || typeof value !== 'object' || seen.has(value)) return
  seen.add(value)
  for (const key of Object.keys(value))
  {
    if (GENERATED_UID_NAMESPACE_PATTERN.test(key)) ids.add(key)
    const property = Object.getOwnPropertyDescriptor(value, key)
    if (!property || !('value' in property)) continue
    addGeneratedNamespaceStrings(property.value, ids, seen)
  }
}

function addString(value: unknown, ids: Set<string>): void
{
  if (typeof value === 'string') ids.add(value)
}

export function collectEditUidCollisionUniverse(
  json: ProjectJson
): readonly string[]
{
  const ids = new Set<string>()
  for (const target of json.targets)
  {
    for (const id of ownRecordKeys(target.variables)) ids.add(id)
    for (const id of ownRecordKeys(target.lists)) ids.add(id)
    for (const id of ownRecordKeys(target.broadcasts)) ids.add(id)
    for (const id of ownRecordKeys(target.comments)) ids.add(id)
    for (const blockId of ownRecordKeys(target.blocks))
    {
      ids.add(blockId)
      const entry = ownRecordValue(target.blocks, blockId)
      if (!isBlockEntry(entry))
      {
        if (entry && (entry[0] === 12 || entry[0] === 13))
          addString(entry[2], ids)
        continue
      }
      addString(entry.next, ids)
      addString(entry.parent, ids)
      addString(entry.comment, ids)
      for (const inputName of ownRecordKeys(entry.inputs))
      {
        if (entry.opcode === 'procedures_call') ids.add(inputName)
        const input = ownRecordValue(entry.inputs, inputName)
        if (!input) continue
        for (let index = 1; index < input.length; index++)
        {
          const slot = input[index]
          if (typeof slot === 'string') ids.add(slot)
          else if (
            Array.isArray(slot) &&
            (slot[0] === 11 || slot[0] === 12 || slot[0] === 13)
          )
          {
            addString(slot[2], ids)
          }
        }
      }
      for (const fieldName of ownRecordKeys(entry.fields))
      {
        const field = ownRecordValue(entry.fields, fieldName)
        if (field) addString(field[1], ids)
      }
      for (const argumentId of parseMutationArray(
        entry.mutation?.argumentids
      ) ?? [])
        ids.add(argumentId)
    }
    for (const commentId of ownRecordKeys(target.comments))
    {
      const comment = ownRecordValue(target.comments, commentId)
      if (comment) addString(comment.blockId, ids)
    }
  }
  for (const monitor of json.monitors ?? []) ids.add(monitor.id)
  addGeneratedNamespaceStrings(json, ids, new WeakSet())
  return [...ids].sort(compareText)
}

export function createEditUids(json: ProjectJson): Uids
{
  return new Uids(collectEditUidCollisionUniverse(json))
}
