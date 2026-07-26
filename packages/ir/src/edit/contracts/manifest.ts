// packages/ir/src/edit/contracts/manifest.ts
// approved A0 semantic authority fingerprints & production parity checks

import { canonicalJsonV1 } from '@scratch-agent/sb3/canonical-json'
import { sha256Hex } from '@scratch-agent/sb3/crypto-node'

import {
  PHASE8_CONTRACT_MODEL,
  contractDefinitionNames,
} from './contract-model.js'
import { emitJsonSchema202012, emitTypeScriptAnnex } from './schema-model.js'

export const APPROVED_A0_SEMANTIC_AUTHORITY_V1 = Object.freeze({
  declarationSha256:
    'da2ab486dd407f0cd1ae26303fa996c6e6de16b3e3125dfd8a86c01b189614c0',
  semanticSchemaSha256:
    '022240af8e3c2cb1898d1c6b464a0c056e5d70e7671062e2a791f60d9947500b',
})

const CHECKED_PRODUCTION_DECLARATION_SHA256_V1 =
  'bffc39a6e0591fe6cbca1d55732382c9a2eca7a5ca96b6e4061bbacbf5e445d4'

const ANNEX_CANONICAL_JSON_LIMITS = Object.freeze({
  maxDepth: 128,
  maxMembers: 250_000,
  maxNodes: 2_000_000,
  maxStringCodeUnits: 16_000_000,
})

const REVIEW_DECLARATION_HEADER = Object.freeze({
  relativePath:
    'review/phase-8-a0/generated/declarations/semantic-edit-v1.d.ts',
  purpose: 'generated review-only phase 8 semantic contract declarations',
})

const PRODUCTION_DECLARATION_HEADER = Object.freeze({
  relativePath: 'packages/ir/src/edit/contracts.generated.ts',
  purpose:
    'generated phase 8 semantic edit declarations from the production contract model',
})

function textBytes(value: string): Uint8Array
{
  return new TextEncoder().encode(value.endsWith('\n') ? value : `${value}\n`)
}

export function approvedA0DeclarationBytesV1(): Uint8Array
{
  return textBytes(
    emitTypeScriptAnnex(PHASE8_CONTRACT_MODEL, {
      header: REVIEW_DECLARATION_HEADER,
      rootTypeName: 'Phase8ReviewContractRootV1',
    })
  )
}

function productionDeclarationSourceV1(): string
{
  return emitTypeScriptAnnex(PHASE8_CONTRACT_MODEL, {
    header: PRODUCTION_DECLARATION_HEADER,
    rootTypeName: 'Phase8ReviewContractRootV1',
  })
}

export function approvedA0SemanticSchemaBytesV1(): Uint8Array
{
  const schema = emitJsonSchema202012(PHASE8_CONTRACT_MODEL)
  return textBytes(canonicalJsonV1(schema, ANNEX_CANONICAL_JSON_LIMITS))
}

interface SemanticAuthorityManifestV1
{
  readonly authority: 'phase-8-semantic-edit-v1'
  readonly definitionCount: number
  readonly declarationSha256: string
  readonly productionDeclarationSha256: string
  readonly semanticSchemaSha256: string
  readonly approvedA0Parity: boolean
  readonly checkedProductionDeclarationParity: boolean
}

export function semanticAuthorityManifestV1(): SemanticAuthorityManifestV1
{
  const declarationSha256 = sha256Hex(approvedA0DeclarationBytesV1())
  const productionDeclarationSha256 = sha256Hex(
    textBytes(productionDeclarationSourceV1())
  )
  const semanticSchemaSha256 = sha256Hex(approvedA0SemanticSchemaBytesV1())
  const approvedA0Parity =
    declarationSha256 === APPROVED_A0_SEMANTIC_AUTHORITY_V1.declarationSha256 &&
    semanticSchemaSha256 ===
      APPROVED_A0_SEMANTIC_AUTHORITY_V1.semanticSchemaSha256
  const checkedProductionDeclarationParity =
    productionDeclarationSha256 === CHECKED_PRODUCTION_DECLARATION_SHA256_V1

  return Object.freeze({
    authority: 'phase-8-semantic-edit-v1',
    definitionCount: contractDefinitionNames().length,
    declarationSha256,
    productionDeclarationSha256,
    semanticSchemaSha256,
    approvedA0Parity,
    checkedProductionDeclarationParity,
  })
}

export function assertApprovedA0SemanticAuthorityV1(): SemanticAuthorityManifestV1
{
  const manifest = semanticAuthorityManifestV1()

  if (
    !manifest.approvedA0Parity ||
    !manifest.checkedProductionDeclarationParity
  )
  {
    throw new Error(
      `production semantic authority diverged from approved A0: ${JSON.stringify(manifest)}`
    )
  }

  return manifest
}
