// packages/ir/src/project/summarize.ts
// render a ProjectIR to a readable text summary (sprites, scripts, vars, custom blocks)

import type { ProjectIR } from './project-ir.js'
import type { RenderedBlock, ResolvedArg } from './scripts.js'
import type { TargetIR } from './target-ir.js'

// readable labels for common opcodes; others fall back to a humanized opcode
const LABELS: Record<string, string> = {
  event_whenflagclicked: 'when green flag clicked',
  event_whenkeypressed: 'when key pressed',
  event_whenthisspriteclicked: 'when this sprite clicked',
  event_whenbroadcastreceived: 'when I receive',
  event_broadcast: 'broadcast',
  event_broadcastandwait: 'broadcast and wait',
  control_wait: 'wait',
  control_repeat: 'repeat',
  control_forever: 'forever',
  control_if: 'if',
  control_if_else: 'if / else',
  control_wait_until: 'wait until',
  control_repeat_until: 'repeat until',
  control_stop: 'stop',
  control_create_clone_of: 'create clone of',
  control_delete_this_clone: 'delete this clone',
  control_start_as_clone: 'when I start as a clone',
  motion_movesteps: 'move steps',
  motion_gotoxy: 'go to x y',
  motion_changexby: 'change x by',
  motion_setx: 'set x to',
  motion_changeyby: 'change y by',
  motion_sety: 'set y to',
  motion_turnright: 'turn right',
  motion_turnleft: 'turn left',
  motion_pointindirection: 'point in direction',
  looks_say: 'say',
  looks_sayforsecs: 'say for secs',
  looks_think: 'think',
  looks_show: 'show',
  looks_hide: 'hide',
  looks_switchcostumeto: 'switch costume to',
  looks_nextcostume: 'next costume',
  looks_changesizeby: 'change size by',
  looks_setsizeto: 'set size to',
  data_setvariableto: 'set var to',
  data_changevariableby: 'change var by',
  data_showvariable: 'show variable',
  data_hidevariable: 'hide variable',
  data_addtolist: 'add to list',
  sensing_touchingobject: 'touching',
  sensing_keypressed: 'key pressed?',
  operator_equals: '=',
  operator_gt: '>',
  operator_lt: '<',
  operator_add: '+',
  operator_subtract: '-',
  operator_multiply: '*',
  operator_divide: '/',
  operator_and: 'and',
  operator_or: 'or',
  operator_not: 'not',
  operator_random: 'pick random',
  operator_join: 'join',
  procedures_call: 'call',
  procedures_definition: 'define',
}

function label(opcode: string): string
{
  return LABELS[opcode] ?? opcode.replace(/^[^_]+_/, '').replace(/_/g, ' ')
}

function renderArg(arg: ResolvedArg): string
{
  switch (arg.kind)
  {
    case 'literal':
      return `[${arg.value}]`
    case 'variable':
    case 'list':
      return `(${arg.name})`
    case 'broadcast':
      return `[${arg.name}]`
    case 'reporter':
      return `(${renderInline(arg.block)})`
    case 'empty':
      return '()'
  }
}

// inline reporter rendering (reporters carry no substacks)
function renderInline(block: RenderedBlock): string
{
  const parts = [label(block.opcode)]
  for (const v of Object.values(block.fields)) parts.push(`[${v}]`)
  for (const arg of Object.values(block.inputs)) parts.push(renderArg(arg))
  return parts.join(' ')
}

function renderBlock(
  block: RenderedBlock,
  indent: number,
  out: string[]
): void
{
  const pad = '  '.repeat(indent)
  const parts = [label(block.opcode)]
  if (block.mutation?.proccode) parts.push(`"${block.mutation.proccode}"`)
  for (const v of Object.values(block.fields)) parts.push(`[${v}]`)
  for (const arg of Object.values(block.inputs)) parts.push(renderArg(arg))
  out.push(pad + parts.join(' '))
  for (const stack of block.substacks)
  {
    for (const child of stack) renderBlock(child, indent + 1, out)
  }
}

function summarizeTarget(target: TargetIR, maxScripts = 0): string
{
  const lines: string[] = []
  lines.push(`${target.isStage ? 'Stage' : 'Sprite'}: ${target.name}`)
  const vars = target.variableNames()
  const lists = target.listNames()
  const broadcasts = target.broadcastNames()
  if (vars.length) lines.push(`  variables: ${vars.join(', ')}`)
  if (lists.length) lines.push(`  lists: ${lists.join(', ')}`)
  if (broadcasts.length) lines.push(`  broadcasts: ${broadcasts.join(', ')}`)

  const scripts = target.scripts()
  lines.push(`  scripts: ${scripts.length}`)
  const shown = maxScripts > 0 ? scripts.slice(0, maxScripts) : scripts
  for (const script of shown)
  {
    lines.push('  ---')
    const out: string[] = []
    for (const block of script.blocks) renderBlock(block, 2, out)
    lines.push(...out)
  }
  if (shown.length < scripts.length)
  {
    lines.push(`  ... ${scripts.length - shown.length} more scripts`)
  }
  return lines.join('\n')
}

interface SummaryOptions
{
  // cap scripts rendered per target (0 = all)
  maxScriptsPerTarget?: number
}

export function summarizeProject(
  ir: ProjectIR,
  opts: SummaryOptions = {}
): string
{
  const sections: string[] = []
  const meta = ir.json.meta
  sections.push(
    `project: ${ir.json.targets.length} targets, vm ${meta.vm ?? '?'}`
  )
  const cap = opts.maxScriptsPerTarget ?? 0
  for (const target of ir.targets)
  {
    sections.push(summarizeTarget(target, cap))
  }
  return sections.join('\n\n')
}
