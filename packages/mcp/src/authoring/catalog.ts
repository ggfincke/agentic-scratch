// packages/mcp/src/authoring/catalog.ts
// paginate actionable standard block docs without changing A0 discovery

import {
  STANDARD_AUTHORING_CATALOG_EVIDENCE_V2,
  STANDARD_AUTHORING_DESCRIPTORS_V2,
  STANDARD_AUTHORING_EXCLUSIONS_V2,
  STANDARD_PROCEDURE_OPCODES_V2,
  semanticHashV1,
} from '@scratch-agent/edit'

export interface StandardCatalogQueryV2
{
  readonly opcodePrefix?: string
  readonly pageSize?: number
  readonly cursor?: string
}

export function describeStandardAuthoringCatalogV2(
  query: StandardCatalogQueryV2 = {}
)
{
  const size = query.pageSize ?? 20
  if (!Number.isSafeInteger(size) || size < 1 || size > 50)
    throw new TypeError('catalog pageSize must be an integer from 1 to 50')
  if (
    query.opcodePrefix !== undefined &&
    (typeof query.opcodePrefix !== 'string' || query.opcodePrefix.length > 256)
  )
    throw new TypeError('catalog opcodePrefix must be bounded text')
  const rows: readonly Record<string, unknown>[] = [
    ...STANDARD_AUTHORING_DESCRIPTORS_V2.map((row) => ({
      opcode: row.opcode,
      category: row.category,
      shape: row.shape,
      status: row.availability,
      ordinaryConstruction: row.safeBuilderKind === 'ordinaryBlock',
      construction:
        row.safeBuilderKind === 'ordinaryBlock'
          ? 'ordinary semantic tree'
          : 'generated shadow or menu',
      placements: row.context.allowedPlacements,
      ownerTargets: row.context.ownerTargets,
      acceptsSuccessor: row.context.acceptsSuccessor,
      conditionalRules:
        row.opcode === 'control_stop'
          ? [
              'other scripts in sprite permits continuation; all and this script terminate',
            ]
          : row.opcode === 'sensing_of'
            ? ['variable property must belong to the selected object target']
            : [],
      fields: [...row.requiredFields, ...row.optionalFields].map((field) => ({
        name: field.name,
        kind: field.kind,
        required: row.requiredFields.includes(field),
        default: field.canonicalDefault,
        choices: field.choices,
        referenceDomain: field.referenceDomain,
      })),
      inputs: [...row.requiredInputs, ...row.optionalInputs].map((input) => ({
        name: input.name,
        connection: input.connection,
        required: row.requiredInputs.includes(input),
        default: input.canonicalShadow?.value ?? null,
        choices: input.choices,
        specialTokens: input.specialTokens,
        referenceDomain: input.referenceDomain,
        generatedShadow: input.canonicalShadow,
        reporterSubstitution:
          input.connection !== 'substack' && input.connection !== 'boolean',
      })),
    })),
    ...STANDARD_PROCEDURE_OPCODES_V2.map((opcode) => ({
      opcode,
      status: 'semanticOnly',
      ordinaryConstruction: false,
      construction:
        'procedure operations, procedureCall or parameterReporter semantic nodes',
    })),
    ...STANDARD_AUTHORING_EXCLUSIONS_V2.map((row) => ({
      opcode: row.opcode,
      status: row.availability,
      classification: row.classification,
      ordinaryConstruction: false,
      construction: row.reason,
    })),
  ]
    .filter(
      (row) =>
        query.opcodePrefix === undefined ||
        String(row.opcode).startsWith(query.opcodePrefix)
    )
    .sort((a, b) =>
      String(a.opcode) < String(b.opcode)
        ? -1
        : String(a.opcode) > String(b.opcode)
          ? 1
          : 0
    )
  const collectionSha256 = semanticHashV1('evidence-content', {
    kind: 'standard-authoring-documentation-v2',
    authority: STANDARD_AUTHORING_CATALOG_EVIDENCE_V2,
    opcodePrefix: query.opcodePrefix ?? null,
    rows,
  })
  let offset = 0
  if (query.cursor !== undefined)
  {
    if (query.cursor.length > 256)
      throw new TypeError('catalog cursor is invalid')
    let cursor: { offset: unknown; collectionSha256: unknown }
    try
    {
      cursor = JSON.parse(
        Buffer.from(query.cursor, 'base64url').toString()
      ) as typeof cursor
    }
    catch
    {
      throw new TypeError('catalog cursor is invalid')
    }
    if (
      cursor.collectionSha256 !== collectionSha256 ||
      typeof cursor.offset !== 'number' ||
      !Number.isSafeInteger(cursor.offset) ||
      cursor.offset < 0 ||
      cursor.offset > rows.length
    )
      throw new TypeError('catalog cursor belongs to a different collection')
    offset = cursor.offset
  }
  const items = rows.slice(offset, offset + size)
  const next = offset + items.length
  return {
    schemaVersion: 2,
    authorityId: 'standard-v2',
    authority: STANDARD_AUTHORING_CATALOG_EVIDENCE_V2,
    collectionSha256,
    items,
    totalCount: rows.length,
    ...(next < rows.length
      ? {
          nextCursor: Buffer.from(
            JSON.stringify({
              collectionSha256,
              offset: next,
            })
          ).toString('base64url'),
        }
      : {}),
  }
}
