// packages/ir/src/edit/contracts/hash-domains.ts
// typed Node semantic hash domains over canonical caller-owned projections

import {
  DEFAULT_CANONICAL_JSON_LIMITS,
  semanticHashPreimageV1,
} from '@scratch-agent/sb3/canonical-json'
import { sha256Hex } from '@scratch-agent/sb3/crypto-node'

import { SEMANTIC_HASH_DOMAINS } from './contract-data.js'

export type SemanticHashDomainV1 = (typeof SEMANTIC_HASH_DOMAINS)[number]

const SEMANTIC_HASH_DOMAIN_SET: ReadonlySet<string> = new Set(
  SEMANTIC_HASH_DOMAINS
)

function isSemanticHashDomainV1(
  domain: string
): domain is SemanticHashDomainV1
{
  return SEMANTIC_HASH_DOMAIN_SET.has(domain)
}

export function semanticHashPreimageForDomainV1(
  domain: SemanticHashDomainV1,
  projection: unknown,
  limits: typeof DEFAULT_CANONICAL_JSON_LIMITS = DEFAULT_CANONICAL_JSON_LIMITS
): Uint8Array
{
  if (!isSemanticHashDomainV1(domain))
  {
    throw new TypeError(`unknown Phase 8 semantic hash domain ${domain}`)
  }

  return semanticHashPreimageV1(domain, projection, limits)
}

export function semanticHashV1(
  domain: SemanticHashDomainV1,
  projection: unknown,
  limits: typeof DEFAULT_CANONICAL_JSON_LIMITS = DEFAULT_CANONICAL_JSON_LIMITS
): string
{
  return sha256Hex(semanticHashPreimageForDomainV1(domain, projection, limits))
}
