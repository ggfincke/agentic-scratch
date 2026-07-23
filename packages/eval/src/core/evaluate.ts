// packages/eval/src/core/evaluate.ts
// read each assertion's probe off the trace's labeled snapshots & judge it

import type { VmSpriteState, VmStateSnapshot } from '@scratch-agent/runner'

import type {
  AssertLocation,
  AssertResult,
  Assertion,
  Probe,
} from './assert.js'
import { describeMatcher, matches } from './matchers.js'
import {
  centerInRegion,
  rectField,
  regionChangedCount,
  regionInkCount,
} from '../visual/visual-probe.js'

// any lane trace w/ labeled snapshots; the browser trace also carries visual observations
interface SnapshotTrace
{
  snapshots: VmStateSnapshot[]
}

interface ProbeRead
{
  value: unknown
  found: boolean
  location: AssertLocation
}

const STAGE = 'Stage'

function stageTarget(snap: VmStateSnapshot): VmSpriteState | undefined
{
  return snap.targetsById[snap.stageTargetId] ?? snap.targets[STAGE]
}

function targetByName(
  snap: VmStateSnapshot,
  name: string,
  preferSprite: boolean
): VmSpriteState | undefined
{
  const directById = snap.targetsById[name]
  if (directById) return directById

  const matches = snap.targetOrder
    .map((id) => snap.targetsById[id])
    .filter(
      (target): target is VmSpriteState => !!target && target.name === name
    )
  if (matches.length > 0)
  {
    if (preferSprite)
    {
      const sprite = matches.find((target) => !target.isStage)
      if (sprite) return sprite
    }
    return matches[0]
  }

  return snap.targets[name]
}

function spriteProp(state: VmSpriteState, prop: string): unknown
{
  switch (prop)
  {
    case 'x':
      return state.x
    case 'y':
      return state.y
    case 'direction':
      return state.direction
    case 'costume':
      return state.costume
    case 'visible':
      return state.visible
    case 'size':
      return state.size
    case 'rotationStyle':
      return state.rotationStyle
    case 'volume':
      return state.volume
    case 'draggable':
      return state.draggable
    default:
      return undefined
  }
}

function readProbe(
  snap: VmStateSnapshot,
  probe: Probe,
  byLabel: Map<string, VmStateSnapshot>
): ProbeRead
{
  switch (probe.on)
  {
    case 'prop':
    {
      const t = targetByName(snap, probe.sprite, true)
      const value = t ? spriteProp(t, probe.prop) : undefined
      return {
        value,
        found: value !== undefined,
        location: {
          target: probe.sprite,
          hint: `${probe.prop} of ${probe.sprite}`,
        },
      }
    }
    case 'var':
    {
      const owner = probe.sprite ?? STAGE
      const t = probe.sprite
        ? targetByName(snap, probe.sprite, true)
        : stageTarget(snap)
      return {
        value: t ? t.variables[probe.name] : undefined,
        found: !!t && t.variables[probe.name] !== undefined,
        location: {
          target: owner,
          hint: `variable "${probe.name}" on ${owner}`,
        },
      }
    }
    case 'list':
    {
      const owner = probe.sprite ?? STAGE
      const t = probe.sprite
        ? targetByName(snap, probe.sprite, true)
        : stageTarget(snap)
      return {
        value: t ? t.lists[probe.name] : undefined,
        found: !!t && t.lists[probe.name] !== undefined,
        location: { target: owner, hint: `list "${probe.name}" on ${owner}` },
      }
    }
    case 'timer':
      return {
        value: snap.timer,
        found: true,
        location: { target: STAGE, hint: 'project timer' },
      }
    case 'answer':
      return {
        value: snap.answer,
        found: true,
        location: { target: STAGE, hint: 'sensing answer' },
      }
    case 'said':
    {
      const t = targetByName(snap, probe.sprite, true)
      return {
        value: t?.bubble ? t.bubble.text : undefined,
        found: !!t?.bubble,
        location: {
          target: probe.sprite,
          hint: `say/think bubble of ${probe.sprite}`,
        },
      }
    }
    case 'spriteRect':
    {
      const rect = snap.visual?.spriteRects[probe.sprite] ?? null
      return {
        value: rect ? rectField(rect, probe.field) : undefined,
        found: !!rect,
        location: {
          target: probe.sprite,
          hint: `${probe.field} of ${probe.sprite} screen rect`,
        },
      }
    }
    case 'spriteInRegion':
    {
      const rect = snap.visual?.spriteRects[probe.sprite] ?? null
      return {
        value: rect ? centerInRegion(rect, probe.region) : undefined,
        found: !!rect,
        location: {
          target: probe.sprite,
          hint: `${probe.sprite} centered within region`,
        },
      }
    }
    case 'notBlank':
    {
      const v = snap.visual
      return {
        value: v ? regionInkCount(v, probe.region) > 0 : undefined,
        found: !!v,
        location: { target: 'stage', hint: 'stage region not blank' },
      }
    }
    case 'regionInk':
    {
      const v = snap.visual
      return {
        value: v ? regionInkCount(v, probe.region) : undefined,
        found: !!v,
        location: { target: 'stage', hint: 'drawn cells in region' },
      }
    }
    case 'regionChanged':
    {
      const v = snap.visual
      const ref = byLabel.get(probe.from)?.visual
      if (!v || !ref)
      {
        return {
          value: undefined,
          found: false,
          location: {
            target: 'stage',
            hint: `region change vs "${probe.from}"`,
          },
        }
      }
      const changed = regionChangedCount(v, ref, probe.region)
      return {
        value: changed < 0 ? undefined : changed,
        found: changed >= 0,
        location: {
          target: 'stage',
          hint: `region changed vs "${probe.from}"`,
        },
      }
    }
  }
}

function show(value: unknown): string
{
  if (value === undefined) return '<absent>'
  if (Array.isArray(value)) return `[${value.map(String).join(', ')}]`
  return String(value)
}

// judge every assertion against the snapshot its `at` label names
export function evaluate(
  trace: SnapshotTrace,
  asserts: Assertion[]
): AssertResult[]
{
  const byLabel = new Map<string, VmStateSnapshot>()
  for (const s of trace.snapshots) if (s.label) byLabel.set(s.label, s)

  return asserts.map((a) =>
  {
    const snap = byLabel.get(a.at)
    if (!snap)
    {
      return {
        ok: false,
        at: a.at,
        probe: a.probe,
        matcher: a.match,
        expected: describeMatcher(a.match),
        observed: `<no snapshot labeled "${a.at}">`,
        location: {
          target: '-',
          hint: `scenario captured no snapshot "${a.at}"`,
        },
        note: a.note,
      }
    }
    const read = readProbe(snap, a.probe, byLabel)
    return {
      ok: read.found && matches(a.match, read.value),
      at: a.at,
      probe: a.probe,
      matcher: a.match,
      expected: describeMatcher(a.match),
      observed: show(read.value),
      location: read.location,
      note: a.note,
    }
  })
}
