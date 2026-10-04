// packages/ir/src/edit/contracts/authority-selection.ts
// select the two supported semantic authoring authorities

export type SemanticAuthoringAuthorityIdV2 = 'a0-v1' | 'standard-v2'

export function assertSemanticAuthoringAuthorityIdV2(
  value: unknown
): asserts value is SemanticAuthoringAuthorityIdV2
{
  if (value !== 'a0-v1' && value !== 'standard-v2')
    throw new TypeError('unknown semantic authoring authority')
}
