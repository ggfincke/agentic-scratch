// packages/model/src/checks.ts
// the check catalog: evaluate a {name,negated,args[]} check against one tick's CheckContext

import type { ScalarValue } from '@scratch-agent/runner'

import { MS_PER_TICK, type Check, type CheckContext } from './types.js'

// pure checks usable as edge conditions or program-model effect assertions
export const SUPPORTED_CHECKS = new Set<string>([
  'VarComp',
  'VarChange',
  'AttrComp',
  'AttrChange',
  'Output',
  'Key',
  'AnyKey',
  'Click',
  'TimeElapsed',
  'TimeAfterEnd',
  'Probability',
  'SpriteTouching',
  'SetStorage',
  'ChangeStorageBy',
  'StopModels',
  'RestartModels',
])

// effects that mutate model storage (impure, applied once - never asserted)
export const STORAGE_EFFECTS = new Set<string>([
  'SetStorage',
  'ChangeStorageBy',
])

// effects that steer the model runtime rather than assert or store
export const CONTROL_EFFECTS = new Set<string>(['StopModels', 'RestartModels'])

// user-model input names (applied to the program, not asserted)
export const USER_INPUTS = new Set<string>([
  'InputKey',
  'InputText',
  'InputClickSprite',
  'InputClickStage',
  'InputMouseDown',
  'InputMouseMove',
])

export function isImpureEffect(name: string): boolean
{
  return STORAGE_EFFECTS.has(name) || CONTROL_EFFECTS.has(name)
}

// checks whose first arg names the sprite they address (for failure localization)
const SPRITE_SCOPED = new Set<string>([
  'VarComp',
  'VarChange',
  'AttrComp',
  'AttrChange',
  'Output',
  'Click',
  'SpriteTouching',
])

function num(v: unknown): number
{
  const n = Number(v)
  return Number.isNaN(n) ? 0 : n
}

// Scratch-faithful three-way compare: numeric when both parse, else case-insensitive string
function scratchCompare(a: unknown, b: unknown): number
{
  const na = Number(a)
  const nb = Number(b)
  const aNum = a !== '' && a !== null && !Number.isNaN(na)
  const bNum = b !== '' && b !== null && !Number.isNaN(nb)
  if (aNum && bNum) return na < nb ? -1 : na > nb ? 1 : 0
  const sa = String(a).toLowerCase()
  const sb = String(b).toLowerCase()
  return sa < sb ? -1 : sa > sb ? 1 : 0
}

// canonical scratch key name so 'right' / 'ArrowRight' / 'right arrow' all match
const KEY_CANON: Record<string, string> = {
  right: 'right arrow',
  arrowright: 'right arrow',
  'right arrow': 'right arrow',
  left: 'left arrow',
  arrowleft: 'left arrow',
  'left arrow': 'left arrow',
  up: 'up arrow',
  arrowup: 'up arrow',
  'up arrow': 'up arrow',
  down: 'down arrow',
  arrowdown: 'down arrow',
  'down arrow': 'down arrow',
  ' ': 'space',
  space: 'space',
  enter: 'enter',
}

function canonKey(key: string): string
{
  const k = key.toLowerCase()
  return KEY_CANON[k] ?? k
}

function applyCompareOp(a: unknown, b: unknown, op: string): boolean
{
  const c = scratchCompare(a, b)
  switch (op)
  {
    case '=':
    case '==':
      return c === 0
    case '!=':
      return c !== 0
    case '>':
      return c > 0
    case '>=':
      return c >= 0
    case '<':
      return c < 0
    case '<=':
      return c <= 0
    default:
      return false
  }
}

// old -> new change: a numeric arg means an exact delta, else a +/-/==/!= direction op
function applyChangeOp(
  oldV: unknown,
  newV: unknown,
  change: unknown,
  delta: unknown
): boolean
{
  if (typeof change === 'number') return num(newV) - num(oldV) === change
  switch (String(change))
  {
    case '+':
      return num(newV) > num(oldV)
    case '-':
      return num(newV) < num(oldV)
    case '=':
    case '==':
      return scratchCompare(newV, oldV) === 0
    case '!=':
      return scratchCompare(newV, oldV) !== 0
    case '+=':
      return num(newV) - num(oldV) === num(delta)
    case '-=':
      return num(oldV) - num(newV) === num(delta)
    default:
      return false
  }
}

function isStage(sprite: string): boolean
{
  return sprite.toLowerCase() === 'stage'
}

// resolve a variable value: Stage -> globals; a sprite -> its locals, falling back to globals
function resolveVar(
  ctx: CheckContext,
  useState: 'state' | 'prev',
  sprite: string,
  name: string
): ScalarValue | undefined
{
  const snap = useState === 'state' ? ctx.state : ctx.prev
  if (!snap) return undefined
  if (isStage(sprite)) return snap.variables[name]
  const t = snap.targets[sprite]
  if (t && name in t.variables) return t.variables[name]
  return snap.variables[name]
}

// map a Whisker attribute name onto our snapshot; Stage currentCostumeName is the backdrop
function resolveAttr(
  ctx: CheckContext,
  useState: 'state' | 'prev',
  sprite: string,
  attr: string
): ScalarValue | undefined
{
  const snap = useState === 'state' ? ctx.state : ctx.prev
  if (!snap) return undefined
  const t = snap.targets[sprite]
  if (!t) return undefined
  switch (attr)
  {
    case 'x':
      return t.x
    case 'y':
      return t.y
    case 'direction':
      return t.direction
    case 'size':
      return t.size
    case 'volume':
      return t.volume
    case 'visible':
      return t.visible
    case 'rotationStyle':
      return t.rotationStyle
    case 'costume':
    case 'currentCostumeName':
      return t.costume
    case 'sayText':
      return t.bubble ? t.bubble.text : ''
    default:
      return attr in t.effects ? t.effects[attr] : undefined
  }
}

function arg(check: Check, i: number): ScalarValue
{
  return check.args[i] ?? ''
}

// evaluate a pure check (conditions & program-model assertions), ignoring negation
function rawCheck(check: Check, ctx: CheckContext): boolean
{
  switch (check.name)
  {
    case 'VarComp':
    {
      const v = resolveVar(
        ctx,
        'state',
        String(arg(check, 0)),
        String(arg(check, 1))
      )
      if (v === undefined) return false
      return applyCompareOp(v, arg(check, 3), String(arg(check, 2)))
    }
    case 'AttrComp':
    {
      const v = resolveAttr(
        ctx,
        'state',
        String(arg(check, 0)),
        String(arg(check, 1))
      )
      if (v === undefined) return false
      return applyCompareOp(v, arg(check, 3), String(arg(check, 2)))
    }
    case 'VarChange':
    {
      const sprite = String(arg(check, 0))
      const name = String(arg(check, 1))
      const oldV = resolveVar(ctx, 'prev', sprite, name)
      const newV = resolveVar(ctx, 'state', sprite, name)
      if (oldV === undefined || newV === undefined) return false
      return applyChangeOp(oldV, newV, check.args[2], check.args[3])
    }
    case 'AttrChange':
    {
      const sprite = String(arg(check, 0))
      const attr = String(arg(check, 1))
      const oldV = resolveAttr(ctx, 'prev', sprite, attr)
      const newV = resolveAttr(ctx, 'state', sprite, attr)
      if (oldV === undefined || newV === undefined) return false
      return applyChangeOp(oldV, newV, check.args[2], check.args[3])
    }
    case 'Output':
    {
      const t = ctx.state.targets[String(arg(check, 0))]
      if (!t || !t.bubble) return false
      return scratchCompare(t.bubble.text, arg(check, 1)) === 0
    }
    case 'Key':
      return ctx.keysDown.some(
        (k) => canonKey(k) === canonKey(String(arg(check, 0)))
      )
    case 'AnyKey':
      return ctx.keysDown.length > 0
    case 'Click':
      return ctx.clicked.some((c) => c === String(arg(check, 0)))
    case 'TimeElapsed':
      return ctx.ticksSinceTransition * MS_PER_TICK >= num(arg(check, 0))
    case 'TimeAfterEnd':
      if (ctx.programEndTick === null) return false
      return (ctx.tick - ctx.programEndTick) * MS_PER_TICK >= num(arg(check, 0))
    case 'Probability':
      return ctx.random() < num(arg(check, 0))
    case 'SpriteTouching':
    {
      if (!ctx.touching)
      {
        throw new Error(
          'SpriteTouching requires the browser lane (no renderer on the VM lane)'
        )
      }
      return ctx.touching(String(arg(check, 0)), String(arg(check, 1)))
    }
    default:
      throw new Error(`unsupported check "${check.name}"`)
  }
}

// evaluate a check, applying its negation flag
export function evaluateCheck(check: Check, ctx: CheckContext): boolean
{
  const r = rawCheck(check, ctx)
  return check.negated ? !r : r
}

// apply a storage effect (SetStorage / ChangeStorageBy) to model-local storage
export function applyStorageEffect(
  check: Check,
  storage: Record<string, ScalarValue>
): void
{
  const key = String(arg(check, 0))
  if (check.name === 'SetStorage') storage[key] = arg(check, 1)
  else storage[key] = num(storage[key]) + num(arg(check, 1))
}

// a one-line rendering of a check for reports
export function describeCheck(check: Check): string
{
  const prefix = check.negated ? 'not ' : ''
  return `${prefix}${check.name}(${check.args.map(String).join(', ')})`
}

// the sprite a check addresses, for localizing a failure (null when unscoped)
export function checkSprite(check: Check): string | null
{
  if (!SPRITE_SCOPED.has(check.name)) return null
  const first = check.args[0]
  return first === undefined ? null : String(first)
}
