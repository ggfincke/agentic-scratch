// packages/ir/src/edit/scenario-policy.ts
// strict domain-separated semantic identity for retained scenario policies

import { scanStrictJson } from '@scratch-agent/sb3'
import { canonicalJsonBytesV1 } from '@scratch-agent/sb3/canonical-json'

import type { EditScenarioPolicyV1 } from './contracts.generated.js'
import { parseEditScenarioPolicyV1 } from './parser.js'
import { PHASE_8_RESOURCE_POLICY_CATALOG } from './resource-policy.js'
import { semanticHashV1 } from './hash-domains.js'

const POLICY_LIMITS = Object.freeze({
  maxDepth:
    PHASE_8_RESOURCE_POLICY_CATALOG.retainedPolicyJsonNestingDepth.hardMaximum,
  maxMembersPerContainer:
    PHASE_8_RESOURCE_POLICY_CATALOG.retainedPolicyMembersPerContainer
      .hardMaximum,
  maxNodes:
    PHASE_8_RESOURCE_POLICY_CATALOG.retainedPolicyTotalJsonNodes.hardMaximum,
})

export function scenarioPolicySemanticSha256V1(
  policyBytes: Uint8Array
): string
{
  if (
    policyBytes.byteLength >
    PHASE_8_RESOURCE_POLICY_CATALOG.retainedPolicyArtifactBytes.hardMaximum
  )
  {
    throw new RangeError('scenario policy exceeds the hard artifact-byte limit')
  }
  const scanned = scanStrictJson(policyBytes, POLICY_LIMITS)
  const parsed = parseEditScenarioPolicyV1(scanned.value)
  if (!parsed.ok)
  {
    throw new TypeError(
      `scenario policy refused ${parsed.issues.length} schema or semantic issue(s)`
    )
  }
  return semanticHashV1('scenario-policy', parsed.value)
}

export function scenarioPolicyValueSemanticSha256V1(
  policy: EditScenarioPolicyV1
): string
{
  return scenarioPolicySemanticSha256V1(canonicalJsonBytesV1(policy))
}
