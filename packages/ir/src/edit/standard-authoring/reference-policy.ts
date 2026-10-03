// packages/ir/src/edit/standard-authoring/reference-policy.ts
// refuse exact names and selectors that Scratch cannot represent unambiguously

import type { ProjectJson } from '@scratch-agent/sb3'
import {
  RESERVED_TARGET_NAMES_V1,
  TARGET_NAME_REFERENCE_DESCRIPTORS_V1,
} from '../semantic-index/target-reference-catalog.js'
import { deepFreeze } from '../support/immutable.js'

export const STANDARD_REFERENCE_REPRESENTABILITY_POLICY_V2 = deepFreeze({
  schemaVersion: 1,
  reservedAuthoredSpriteNames: RESERVED_TARGET_NAMES_V1,
  exactTarget: 'unique-sprite-name-not-an-input-special-token',
  exactMedia: 'unique-name-in-the-exact-owner-and-media-kind',
  mediaSelector: 'refuse-a-token-captured-by-a-real-media-name',
  rawMedia: 'exact-name-precedes-special-token',
  encoding: 'name-only-no-positional-substitution',
})

const TARGET_SELECTOR_NAMES: Readonly<Record<string, string>> = {
  mouse: '_mouse_',
  random: '_random_',
  myself: '_myself_',
  edge: '_edge_',
  stage: '_stage_',
}

export function standardSelectorValueV2(
  domain: string | null,
  token: string
): string
{
  if (domain === 'backdrop')
    return `${token} backdrop`
  if (domain === 'costume')
    return `${token} costume`
  return TARGET_SELECTOR_NAMES[token] ?? token
}

export function standardMenuSpecialNamesV2(
  opcode: string,
  domain: string | null
): readonly string[]
{
  if (domain === 'target')
    return TARGET_NAME_REFERENCE_DESCRIPTORS_V1.find(
      (entry) => entry.menuOpcode === opcode
    )?.specialNames ?? []
  if (domain === 'costume') return ['next costume', 'previous costume']
  if (domain === 'backdrop')
    return ['next backdrop', 'previous backdrop', 'random backdrop']
  return []
}

export function standardNamedMediaCountV2(
  project: ProjectJson,
  ownerTargetIndex: number,
  domain: string | null,
  name: string
): number
{
  const owner = domain === 'backdrop'
    ? project.targets.find((target) => target.isStage)
    : project.targets[ownerTargetIndex]
  const media = domain === 'sound'
    ? owner?.sounds
    : domain === 'costume' || domain === 'backdrop'
      ? owner?.costumes
      : undefined
  return media?.filter((entry) => entry.name === name).length ?? 0
}

export function standardNameReferenceIssueV2(
  project: ProjectJson,
  ownerTargetIndex: number,
  domain: string | null,
  name: string,
  specialNames: readonly string[] = [],
  selector = false
): string | null
{
  if (domain === 'target')
  {
    if (selector) return null
    if (specialNames.includes(name))
      return 'exact target name resolves to a special runtime selector'
    return project.targets.filter(
      (target) => !target.isStage && target.name === name
    ).length === 1
      ? null
      : 'exact target name is absent or ambiguous in the runtime target domain'
  }
  if (!['costume', 'backdrop', 'sound'].includes(domain ?? '')) return null
  const count = standardNamedMediaCountV2(project, ownerTargetIndex, domain, name)
  if (selector)
    return count === 0
      ? null
      : 'special media selector is captured by an exact media name'
  return count === 1
    ? null
    : 'exact media name is absent or ambiguous in the selected owner'
}
