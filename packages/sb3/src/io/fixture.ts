// packages/sb3/src/io/fixture.ts
// deterministic minimal .sb3: Stage + Sprite1 w/ a green-flag script (set score=0, change x by 10)

import { createHash } from 'node:crypto'

import type {
  Block,
  Costume,
  ProjectJson,
  SpriteTarget,
  StageTarget,
} from '../json/project-json.js'
import { packSb3 } from './pack.js'

interface BuiltSb3
{
  sb3: Uint8Array
  project: ProjectJson
  projectJsonBytes: number
  assetCount: number
}

function md5(buf: Uint8Array): string
{
  return createHash('md5').update(buf).digest('hex')
}

// trivial 20x20 svg used for both backdrop & sprite costume
const SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" version="1.1" width="20" height="20">' +
  '<rect width="20" height="20" fill="#4c97ff"/></svg>'

function costume(name: string, assetId: string, md5ext: string): Costume
{
  return {
    name,
    assetId,
    md5ext,
    dataFormat: 'svg',
    bitmapResolution: 1,
    rotationCenterX: 10,
    rotationCenterY: 10,
  }
}

// green-flag script: when-flag-clicked -> set [score] to 0 -> change x by 10
function spriteBlocks(varId: string): Record<string, Block>
{
  return {
    hat1: {
      opcode: 'event_whenflagclicked',
      next: 'setvar1',
      parent: null,
      inputs: {},
      fields: {},
      shadow: false,
      topLevel: true,
      x: 0,
      y: 0,
    },
    setvar1: {
      opcode: 'data_setvariableto',
      next: 'changex1',
      parent: 'hat1',
      inputs: { VALUE: [1, [10, '0']] },
      fields: { VARIABLE: ['score', varId] },
      shadow: false,
      topLevel: false,
    },
    changex1: {
      opcode: 'motion_changexby',
      next: null,
      parent: 'setvar1',
      inputs: { DX: [1, [4, '10']] },
      fields: {},
      shadow: false,
      topLevel: false,
    },
  }
}

function buildFixtureProject(): ProjectJson
{
  const svgBuf = Buffer.from(SVG, 'utf-8')
  const assetId = md5(svgBuf)
  const md5ext = `${assetId}.svg`
  const varId = 'scoreVarId'

  const stage: StageTarget = {
    isStage: true,
    name: 'Stage',
    variables: {},
    lists: {},
    broadcasts: {},
    blocks: {},
    comments: {},
    currentCostume: 0,
    costumes: [costume('backdrop1', assetId, md5ext)],
    sounds: [],
    volume: 100,
    layerOrder: 0,
    tempo: 60,
    videoTransparency: 50,
    videoState: 'on',
    textToSpeechLanguage: null,
  }

  const sprite: SpriteTarget = {
    isStage: false,
    name: 'Sprite1',
    variables: { [varId]: ['score', 0] },
    lists: {},
    broadcasts: {},
    blocks: spriteBlocks(varId),
    comments: {},
    currentCostume: 0,
    costumes: [costume('costume1', assetId, md5ext)],
    sounds: [],
    volume: 100,
    layerOrder: 1,
    visible: true,
    x: 0,
    y: 0,
    size: 100,
    direction: 90,
    draggable: false,
    rotationStyle: 'all around',
  }

  return {
    targets: [stage, sprite],
    monitors: [],
    extensions: [],
    meta: { semver: '3.0.0', vm: '0.2.0', agent: '' },
  }
}

// build a deterministic .sb3 zip (project.json + the shared svg asset)
export async function buildFixtureSb3(): Promise<BuiltSb3>
{
  const project = buildFixtureProject()
  const svgBuf = Buffer.from(SVG, 'utf-8')
  const md5ext = `${md5(svgBuf)}.svg`
  const projectJson = JSON.stringify(project)
  const sb3 = await packSb3(projectJson, [{ path: md5ext, bytes: svgBuf }])

  return {
    sb3,
    project,
    projectJsonBytes: Buffer.byteLength(projectJson),
    assetCount: 1,
  }
}
