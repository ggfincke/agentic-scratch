// packages/ir/src/project/projects.ts
// build well-known projects entirely through IR ops (dogfoods the builder)

import { createHash } from 'node:crypto'

import type {
  Costume,
  ProjectJson,
  SpriteTarget,
  StageTarget,
} from '@scratch-agent/sb3'

import { ProjectIR } from './project-ir.js'
import type { TargetIR } from './target-ir.js'

// trivial 20x20 svg shared as backdrop/costume for generated projects
const SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" version="1.1" width="20" height="20">' +
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

function addSpriteWithCostume(
  ir: ProjectIR,
  spriteName: string,
  costumeName: string,
  init: Partial<SpriteTarget> = {}
): TargetIR
{
  const sprite = ir.addSprite(spriteName, init)
  const { costume, bytes } = svgCostume(costumeName)
  sprite.addCostume(costume, bytes)
  return sprite
}

// a minimal valid project: a Stage w/ one backdrop, no sprites
export function blankProject(): ProjectIR
{
  const { costume, bytes } = svgCostume('backdrop1')
  const stage: StageTarget = {
    isStage: true,
    name: 'Stage',
    variables: {},
    lists: {},
    broadcasts: {},
    blocks: {},
    comments: {},
    currentCostume: 0,
    costumes: [costume],
    sounds: [],
    volume: 100,
    layerOrder: 0,
    tempo: 60,
    videoTransparency: 50,
    videoState: 'on',
    textToSpeechLanguage: null,
  }
  const json: ProjectJson = {
    targets: [stage],
    monitors: [],
    extensions: [],
    meta: { semver: '3.0.0', vm: '0.2.0', agent: '' },
  }
  return ProjectIR.fromProjectJson(json, [{ path: costume.md5ext!, bytes }])
}

// a clicker: green flag resets score; clicking the sprite increments it
export function buildClicker(): ProjectIR
{
  const ir = blankProject()
  const sprite = addSpriteWithCostume(ir, 'Sprite1', 'costume1')
  const scoreId = sprite.addVariable('score', 0)

  sprite.addScript([
    { opcode: 'event_whenflagclicked' },
    {
      opcode: 'data_setvariableto',
      fields: { VARIABLE: ['score', scoreId] },
      inputs: { VALUE: 0 },
    },
  ])
  sprite.addScript(
    [
      { opcode: 'event_whenthisspriteclicked' },
      {
        opcode: 'data_changevariableby',
        fields: { VARIABLE: ['score', scoreId] },
        inputs: { VALUE: 1 },
      },
    ],
    { x: 0, y: 200 }
  )
  return ir
}

// a cat: green flag -> forever move & bounce
export function buildCat(): ProjectIR
{
  const ir = blankProject()
  const cat = addSpriteWithCostume(ir, 'Cat', 'cat')

  cat.addScript([
    { opcode: 'event_whenflagclicked' },
    {
      opcode: 'control_forever',
      inputs: {
        SUBSTACK: {
          substack: [
            { opcode: 'motion_movesteps', inputs: { STEPS: 10 } },
            { opcode: 'motion_ifonedgebounce' },
          ],
        },
      },
    },
  ])
  return ir
}

// a mover: the right/left arrow keys nudge a sprite's x by +/-10 (input-driven)
export function buildMovement(): ProjectIR
{
  const ir = blankProject()
  const sprite = addSpriteWithCostume(ir, 'Mover', 'mover')

  sprite.addScript([
    {
      opcode: 'event_whenkeypressed',
      fields: { KEY_OPTION: ['right arrow', null] },
    },
    { opcode: 'motion_changexby', inputs: { DX: 10 } },
  ])
  sprite.addScript(
    [
      {
        opcode: 'event_whenkeypressed',
        fields: { KEY_OPTION: ['left arrow', null] },
      },
      { opcode: 'motion_changexby', inputs: { DX: -10 } },
    ],
    { x: 0, y: 200 }
  )
  return ir
}

// a collector: arrow keys slide a Player; a falling Item scores on touch (renderer-dependent).
// the touch only fires w/ a renderer, so the vm lane never scores & the browser lane does.
export function buildCollector(): ProjectIR
{
  const ir = blankProject()

  const player = addSpriteWithCostume(ir, 'Player', 'player', {
    x: 0,
    y: -150,
  })
  player.addScript([
    {
      opcode: 'event_whenkeypressed',
      fields: { KEY_OPTION: ['right arrow', null] },
    },
    { opcode: 'motion_changexby', inputs: { DX: 15 } },
  ])
  player.addScript(
    [
      {
        opcode: 'event_whenkeypressed',
        fields: { KEY_OPTION: ['left arrow', null] },
      },
      { opcode: 'motion_changexby', inputs: { DX: -15 } },
    ],
    { x: 0, y: 200 }
  )

  const item = addSpriteWithCostume(ir, 'Item', 'item', { x: 0, y: 150 })
  const scoreId = item.addVariable('score', 0)
  item.addScript([
    { opcode: 'event_whenflagclicked' },
    {
      opcode: 'control_forever',
      inputs: {
        SUBSTACK: {
          substack: [
            { opcode: 'motion_changeyby', inputs: { DY: -10 } },
            {
              opcode: 'control_if',
              inputs: {
                CONDITION: {
                  boolean: {
                    opcode: 'sensing_touchingobject',
                    inputs: {
                      TOUCHINGOBJECTMENU: {
                        reporter: {
                          opcode: 'sensing_touchingobjectmenu',
                          fields: { TOUCHINGOBJECTMENU: ['Player', null] },
                        },
                      },
                    },
                  },
                },
                SUBSTACK: {
                  substack: [
                    {
                      opcode: 'data_changevariableby',
                      fields: { VARIABLE: ['score', scoreId] },
                      inputs: { VALUE: 1 },
                    },
                    { opcode: 'motion_gotoxy', inputs: { X: 0, Y: 150 } },
                  ],
                },
              },
            },
            {
              opcode: 'control_if',
              inputs: {
                CONDITION: {
                  boolean: {
                    opcode: 'operator_lt',
                    inputs: {
                      OPERAND1: { reporter: { opcode: 'motion_yposition' } },
                      OPERAND2: -150,
                    },
                  },
                },
                SUBSTACK: {
                  substack: [
                    { opcode: 'motion_gotoxy', inputs: { X: 0, Y: 150 } },
                  ],
                },
              },
            },
          ],
        },
      },
    },
  ])
  return ir
}

// a state-machine game: space collects (score +1), 'd' takes damage (lives -1); the Stage
// derives a `state` var (playing -> won at score 10 / lost at 0 lives). the model test
// externalizes those implicit states as an FSM & the mutation engine breaks the collect rule.
export function buildStateGame(): ProjectIR
{
  const ir = blankProject()
  const stage = ir.stage!
  const scoreId = stage.addVariable('score', 0)
  const livesId = stage.addVariable('lives', 3)
  const stateId = stage.addVariable('state', 'playing')

  stage.addScript([
    { opcode: 'event_whenflagclicked' },
    {
      opcode: 'data_setvariableto',
      fields: { VARIABLE: ['score', scoreId] },
      inputs: { VALUE: 0 },
    },
    {
      opcode: 'data_setvariableto',
      fields: { VARIABLE: ['lives', livesId] },
      inputs: { VALUE: 3 },
    },
    {
      opcode: 'data_setvariableto',
      fields: { VARIABLE: ['state', stateId] },
      inputs: { VALUE: 'playing' },
    },
    {
      opcode: 'control_forever',
      inputs: {
        SUBSTACK: {
          substack: [
            {
              opcode: 'control_if',
              inputs: {
                CONDITION: {
                  boolean: {
                    opcode: 'operator_gt',
                    inputs: {
                      OPERAND1: { var: 'score', id: scoreId },
                      OPERAND2: 9,
                    },
                  },
                },
                SUBSTACK: {
                  substack: [
                    {
                      opcode: 'data_setvariableto',
                      fields: { VARIABLE: ['state', stateId] },
                      inputs: { VALUE: 'won' },
                    },
                  ],
                },
              },
            },
            {
              opcode: 'control_if',
              inputs: {
                CONDITION: {
                  boolean: {
                    opcode: 'operator_lt',
                    inputs: {
                      OPERAND1: { var: 'lives', id: livesId },
                      OPERAND2: 1,
                    },
                  },
                },
                SUBSTACK: {
                  substack: [
                    {
                      opcode: 'data_setvariableto',
                      fields: { VARIABLE: ['state', stateId] },
                      inputs: { VALUE: 'lost' },
                    },
                  ],
                },
              },
            },
          ],
        },
      },
    },
  ])

  const hero = addSpriteWithCostume(ir, 'Hero', 'hero', { x: 0, y: -120 })
  hero.addScript([
    { opcode: 'event_whenkeypressed', fields: { KEY_OPTION: ['space', null] } },
    {
      opcode: 'data_changevariableby',
      fields: { VARIABLE: ['score', scoreId] },
      inputs: { VALUE: 1 },
    },
  ])
  hero.addScript(
    [
      { opcode: 'event_whenkeypressed', fields: { KEY_OPTION: ['d', null] } },
      {
        opcode: 'data_changevariableby',
        fields: { VARIABLE: ['lives', livesId] },
        inputs: { VALUE: -1 },
      },
    ],
    { x: 0, y: 200 }
  )
  return ir
}
