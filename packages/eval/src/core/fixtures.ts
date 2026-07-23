// packages/eval/src/core/fixtures.ts
// eval-local project builders for the broader suite (broadcast, wait/timer, say/ask, glide)

import { createHash } from 'node:crypto'

import { blankProject } from '@scratch-agent/ir'
import type { ProjectIR } from '@scratch-agent/ir'
import type { Costume } from '@scratch-agent/sb3'

const SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20">' +
  '<rect width="20" height="20" fill="#4c97ff"/></svg>'

function svgCostume(name: string): { costume: Costume; bytes: Uint8Array }
{
  const bytes = Buffer.from(SVG, 'utf-8')
  const assetId = createHash('md5').update(bytes).digest('hex')
  return {
    costume: {
      name,
      assetId,
      md5ext: `${assetId}.svg`,
      dataFormat: 'svg',
      bitmapResolution: 1,
      rotationCenterX: 10,
      rotationCenterY: 10,
    },
    bytes,
  }
}

function spriteWith(ir: ProjectIR, name: string)
{
  const sprite = ir.addSprite(name)
  const { costume, bytes } = svgCostume(name)
  sprite.addCostume(costume, bytes)
  return sprite
}

// relay: Sender broadcasts "go" on green flag; Receiver moves on "when I receive go"
export function buildRelay(): ProjectIR
{
  const ir = blankProject()
  const bcId = ir.stage!.addBroadcast('go')
  const sender = spriteWith(ir, 'Sender')
  sender.addScript([
    { opcode: 'event_whenflagclicked' },
    {
      opcode: 'event_broadcast',
      inputs: { BROADCAST_INPUT: { broadcast: 'go', id: bcId } },
    },
  ])
  const receiver = spriteWith(ir, 'Receiver')
  receiver.addScript([
    {
      opcode: 'event_whenbroadcastreceived',
      fields: { BROADCAST_OPTION: ['go', bcId] },
    },
    { opcode: 'motion_changexby', inputs: { DX: 10 } },
  ])
  return ir
}

// stuck relay: a "go" receiver parks in a long wait, so it never drains within a small cap --
// exercises the broadcastAndWait cap/maxTicks-exhaustion error path
export function buildStuckReceiver(): ProjectIR
{
  const ir = blankProject()
  const bcId = ir.stage!.addBroadcast('go')
  const receiver = spriteWith(ir, 'Receiver')
  receiver.addScript([
    {
      opcode: 'event_whenbroadcastreceived',
      fields: { BROADCAST_OPTION: ['go', bcId] },
    },
    { opcode: 'control_wait', inputs: { DURATION: 100 } },
  ])
  return ir
}

// wait/timer: green flag waits 1s then sets done=1 (proves deterministic time)
export function buildWaitTimer(): ProjectIR
{
  const ir = blankProject()
  const sprite = spriteWith(ir, 'Waiter')
  const doneId = sprite.addVariable('done', 0)
  sprite.addScript([
    { opcode: 'event_whenflagclicked' },
    { opcode: 'control_wait', inputs: { DURATION: 1 } },
    {
      opcode: 'data_setvariableto',
      fields: { VARIABLE: ['done', doneId] },
      inputs: { VALUE: 1 },
    },
  ])
  return ir
}

// say: green flag shows a speech bubble
export function buildSayer(): ProjectIR
{
  const ir = blankProject()
  const sprite = spriteWith(ir, 'Sayer')
  sprite.addScript([
    { opcode: 'event_whenflagclicked' },
    { opcode: 'looks_say', inputs: { MESSAGE: 'hello' } },
  ])
  return ir
}

// ask: green flag asks a question & waits for the answer
export function buildAsker(): ProjectIR
{
  const ir = blankProject()
  const sprite = spriteWith(ir, 'Asker')
  sprite.addScript([
    { opcode: 'event_whenflagclicked' },
    { opcode: 'sensing_askandwait', inputs: { QUESTION: 'name?' } },
  ])
  return ir
}

// calendar: green flag reads the current year into yr (proves the fixed-date edge)
export function buildClock(): ProjectIR
{
  const ir = blankProject()
  const sprite = spriteWith(ir, 'Clock')
  const yrId = sprite.addVariable('yr', 0)
  sprite.addScript([
    { opcode: 'event_whenflagclicked' },
    {
      opcode: 'data_setvariableto',
      fields: { VARIABLE: ['yr', yrId] },
      inputs: {
        VALUE: {
          reporter: {
            opcode: 'sensing_current',
            fields: { CURRENTMENU: ['YEAR', null] },
          },
        },
      },
    },
  ])
  return ir
}

// glide: green flag glides to x=100 over 1s (proves deterministic Timer-backed motion)
export function buildGlider(): ProjectIR
{
  const ir = blankProject()
  const sprite = spriteWith(ir, 'Glider')
  sprite.addScript([
    { opcode: 'event_whenflagclicked' },
    { opcode: 'motion_glidesecstoxy', inputs: { SECS: 1, X: 100, Y: 0 } },
  ])
  return ir
}
