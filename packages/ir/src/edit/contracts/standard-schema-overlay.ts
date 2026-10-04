// packages/ir/src/edit/contracts/standard-schema-overlay.ts
// widen standard discovery categories over the unchanged A0 wire definitions

import type { CapabilityItemV1 } from '../contracts.generated.js'
import type { EditToolName } from './contract-data.js'
import {
  toolOutputSchemaModel,
  toolReceiptFreeResultSchemaModel,
} from './contract-model.js'
import { semanticHashV1 } from './hash-domains.js'
import type { SchemaModel, SchemaNode } from './schema-model.js'
import { deepFreeze } from '../support/immutable.js'

export type StandardCapabilityItemV2 = Omit<
  Extract<CapabilityItemV1, { itemKind: 'blockDescriptor' }>,
  'category'
> & { readonly category: string }

function overlay(model: SchemaModel): SchemaModel
{
  const item = model.definitions.CapabilityItemV1
  if (item?.kind !== 'anyOf')
    throw new Error('A0 capability union is unavailable')
  const mapped = item.variants.map((variant): SchemaNode =>
  {
    if (
      variant.kind !== 'object' ||
      variant.fields.itemKind?.schema.kind !== 'literalString' ||
      variant.fields.itemKind.schema.value !== 'blockDescriptor'
    )
      return variant
    return {
      ...variant,
      fields: {
        ...variant.fields,
        category: {
          required: true,
          schema: {
            kind: 'enumString',
            values: [
              'motion',
              'looks',
              'sound',
              'event',
              'control',
              'sensing',
              'operators',
              'data',
              'pen',
              'music',
              'videoSensing',
              'math',
              'colour',
              'text',
              'note',
            ],
          },
        },
      },
    }
  })
  const variants = [mapped[0]!, ...mapped.slice(1)] as const
  return deepFreeze({
    ...model,
    definitions: {
      ...model.definitions,
      CapabilityItemV1: { ...item, variants },
    },
  })
}

export function standardAuthoringToolOutputSchemaModelV2(
  name: EditToolName
): SchemaModel
{
  return overlay(toolOutputSchemaModel(name))
}

export function standardAuthoringToolReceiptFreeResultSchemaModelV2(
  name: EditToolName
): SchemaModel
{
  return overlay(toolReceiptFreeResultSchemaModel(name))
}

let retainedOverlaySha256: string | null = null

export function standardAuthoringSchemaOverlaySha256V2(): string
{
  if (retainedOverlaySha256 !== null) return retainedOverlaySha256
  retainedOverlaySha256 = semanticHashV1('capability-profile', {
    kind: 'standard-authoring-schema-overlay-v2',
    schemaVersion: 2,
    capabilities: standardAuthoringToolOutputSchemaModelV2('edit_capabilities'),
  })
  return retainedOverlaySha256
}
