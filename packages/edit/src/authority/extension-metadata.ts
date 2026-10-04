// packages/edit/src/authority/extension-metadata.ts
// derive exact standard extension declarations from the authored graph

import type { ProjectIR } from '@scratch-agent/ir'
import { standardExtensionIdsV2, semanticHashV1 } from '@scratch-agent/ir/edit'

export interface DerivedStandardExtensionMetadataV2
{
  readonly kind: 'derived-standard-extension-metadata-v2'
  readonly beforePresent: boolean
  readonly before: readonly string[]
  readonly after: readonly string[]
  readonly required: readonly string[]
  readonly added: readonly string[]
  readonly evidenceSha256: string
}

export function referencedStandardExtensionsV2(
  project: ProjectIR
): readonly string[]
{
  const opcodes = project.json.targets.flatMap((target) =>
    Object.values(target.blocks).flatMap((block) =>
      Array.isArray(block) ? [] : [block.opcode]
    )
  )
  return standardExtensionIdsV2(opcodes)
}

export function deriveStandardExtensionMetadataV2(
  project: ProjectIR
): DerivedStandardExtensionMetadataV2 | undefined
{
  const beforePresent = Object.hasOwn(project.json, 'extensions')
  const before = [...(project.json.extensions ?? [])]
  const required = referencedStandardExtensionsV2(project)
  const added = required.filter((extension) => !before.includes(extension))
  if (added.length === 0) return undefined
  const after = [...before, ...added]
  const projection = {
    kind: 'derived-standard-extension-metadata-v2' as const,
    beforePresent,
    before,
    after,
    required,
    added,
  }
  project.json.extensions = after
  return Object.freeze({
    ...projection,
    evidenceSha256: semanticHashV1('evidence-content', projection),
  })
}

export function standardExtensionMetadataSequenceMatchesV2(
  current: ProjectIR,
  candidate: ProjectIR,
  proofs: readonly DerivedStandardExtensionMetadataV2[]
): boolean
{
  if (proofs.length === 0) return false
  let present = Object.hasOwn(current.json, 'extensions')
  let extensions = [...(current.json.extensions ?? [])]
  for (const proof of proofs)
  {
    const { evidenceSha256, ...projection } = proof
    if (
      proof.beforePresent !== present ||
      JSON.stringify(proof.before) !== JSON.stringify(extensions) ||
      semanticHashV1('evidence-content', projection) !== evidenceSha256 ||
      JSON.stringify(proof.after) !==
        JSON.stringify([...proof.before, ...proof.added]) ||
      proof.added.length === 0 ||
      new Set(proof.added).size !== proof.added.length ||
      proof.added.some(
        (extension) =>
          !['pen', 'music', 'videoSensing'].includes(extension) ||
          proof.before.includes(extension) ||
          !proof.required.includes(extension)
      )
    )
      return false
    extensions = [...proof.after]
    present = true
  }
  return (
    Object.hasOwn(candidate.json, 'extensions') === present &&
    JSON.stringify(candidate.json.extensions) === JSON.stringify(extensions)
  )
}

export function assertStandardExtensionRemovalV2(
  project: ProjectIR,
  extensionId: string
): void
{
  if (referencedStandardExtensionsV2(project).includes(extensionId))
    throw Object.assign(
      new Error(`extension ${extensionId} still has referenced blocks`),
      { code: 'edit.project_constraint' }
    )
}
