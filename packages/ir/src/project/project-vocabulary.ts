// packages/ir/src/project/project-vocabulary.ts
// own shared project field vocabulary, pointer escaping, & target projection

import type { Target } from '@scratch-agent/sb3'

export const KNOWN_ROOT_FIELDS: ReadonlySet<string> = new Set([
  'targets',
  'monitors',
  'extensions',
  'meta',
])

export const KNOWN_TARGET_FIELDS: ReadonlySet<string> = new Set([
  'isStage',
  'name',
  'variables',
  'lists',
  'broadcasts',
  'blocks',
  'comments',
  'currentCostume',
  'costumes',
  'sounds',
  'volume',
  'layerOrder',
  'tempo',
  'videoTransparency',
  'videoState',
  'textToSpeechLanguage',
  'visible',
  'x',
  'y',
  'size',
  'direction',
  'draggable',
  'rotationStyle',
])

export const KNOWN_BLOCK_FIELDS: ReadonlySet<string> = new Set([
  'opcode',
  'next',
  'parent',
  'inputs',
  'fields',
  'shadow',
  'topLevel',
  'x',
  'y',
  'comment',
  'mutation',
])

export const KNOWN_MUTATION_FIELDS: ReadonlySet<string> = new Set([
  'tagName',
  'children',
  'proccode',
  'argumentids',
  'argumentnames',
  'argumentdefaults',
  'warp',
  'hasnext',
])

export function jsonPointerPart(value: string | number): string
{
  return String(value).replaceAll('~', '~0').replaceAll('/', '~1')
}

interface ProjectTargetIdentity
{
  targetIndex: number
  name: string
  isStage: boolean
}

export function projectTargetIdentity(
  target: Target,
  targetIndex: number
): ProjectTargetIdentity
{
  return {
    targetIndex,
    name: target.name,
    isStage: target.isStage,
  }
}
