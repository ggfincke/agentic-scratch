// packages/ir/src/edit/contracts/contract-model.ts
// normalized semantic declarations & strict schema authority

import {
  EDIT_TOOL_NAMES,
  OPERATION_KINDS,
  OPERATION_REVIEW_ROWS,
  PROJECT_TOOL_NAMES,
  REFUSAL_CODES,
  REFUSAL_REVIEW_ROWS,
  SEMANTIC_HASH_DOMAINS,
  STATEFUL_EDIT_TOOL_NAMES,
  type EditToolName,
  type OperationKind,
  type RefusalCode,
  type RefusalContextField,
} from './contract-data.js'
import {
  OPERATION_PLANNING_ROWS,
  type OperationPlanningChoiceValueKind,
  type OperationPlanningFactValueKind,
} from './catalog.js'
import {
  defineSchemaModel,
  schema,
  type ObjectField,
  type SchemaDefinitions,
  type SchemaModel,
  type SchemaNode,
} from './schema-model.js'

type Fields = Record<string, ObjectField>

const required = schema.required
const optional = schema.optional
const ref = schema.ref

function object(fields: Fields): SchemaNode
{
  return schema.object(fields)
}

function union(...variants: SchemaNode[]): SchemaNode
{
  if (variants.length === 0) throw new Error('schema union cannot be empty')
  return schema.anyOf(variants as [SchemaNode, ...SchemaNode[]])
}

function stringEnum(values: readonly string[]): SchemaNode
{
  if (values.length === 0) throw new Error('schema enum cannot be empty')
  return schema.enumString(values as [string, ...string[]])
}

function integer(minimum = 0, maximum = Number.MAX_SAFE_INTEGER): SchemaNode
{
  return schema.integer({ minimum, maximum })
}

function signedInteger(
  minimum = Number.MIN_SAFE_INTEGER,
  maximum = Number.MAX_SAFE_INTEGER
): SchemaNode
{
  return schema.integer({ minimum, maximum })
}

function authoredString(
  utf8MinBytes: number,
  utf8MaxBytes: number
): SchemaNode
{
  return schema.string({
    utf8MinBytes,
    utf8MaxBytes,
    requireNfc: true,
    rejectNul: true,
    rejectUnpairedSurrogates: true,
  })
}

function exactInteger(value: number): SchemaNode
{
  return schema.literalInteger(value)
}

function list(items: SchemaNode, minimum = 0, maximum = 512): SchemaNode
{
  return schema.array(items, { minItems: minimum, maxItems: maximum })
}

function uniqueList(items: SchemaNode, minimum = 0, maximum = 512): SchemaNode
{
  return schema.array(items, {
    minItems: minimum,
    maxItems: maximum,
    uniqueItems: true,
  })
}

function boundedCollection(itemDefinitionName: string): SchemaNode
{
  return object({
    collectionSha256: required(ref('Sha256')),
    totalCount: required(integer()),
    items: required(list(ref(itemDefinitionName), 0, 50)),
    nextCursor: optional(ref('OpaqueId')),
  })
}

const ENTITY_LOCATION_PROJECTION_DEFINITION: Readonly<Record<string, string>> =
  {
    target: 'BoundedTargetLocationProjectionV1',
    declaration: 'BoundedDeclarationLocationProjectionV1',
    script: 'BoundedScriptLocationProjectionV1',
    block: 'BoundedBlockLocationProjectionV1',
    topLevelPrimitive: 'BoundedTopLevelPrimitiveLocationProjectionV1',
    procedure: 'BoundedProcedureLocationProjectionV1',
    comment: 'BoundedCommentLocationProjectionV1',
    media: 'BoundedMediaLocationProjectionV1',
    parameter: 'BoundedParameterLocationProjectionV1',
  }

const STRUCTURAL_CRITERIA_DEFINITION: Readonly<Record<string, string>> = {
  target: 'TargetStructuralMatchCriteriaV1',
  declaration: 'DeclarationStructuralMatchCriteriaV1',
  script: 'ScriptStructuralMatchCriteriaV1',
  block: 'BlockStructuralMatchCriteriaV1',
  topLevelPrimitive: 'TopLevelPrimitiveStructuralMatchCriteriaV1',
  procedure: 'ProcedureStructuralMatchCriteriaV1',
  comment: 'CommentStructuralMatchCriteriaV1',
  media: 'MediaStructuralMatchCriteriaV1',
  parameter: 'ParameterStructuralMatchCriteriaV1',
}

function entityLocationProjectionDefinition(entityKind: string): string
{
  const name = ENTITY_LOCATION_PROJECTION_DEFINITION[entityKind]
  if (name === undefined)
    throw new Error(`missing bounded location projection for ${entityKind}`)
  return name
}

function structuralCriteriaDefinition(entityKind: string): string
{
  const name = STRUCTURAL_CRITERIA_DEFINITION[entityKind]
  if (name === undefined)
    throw new Error(`missing structural criteria for ${entityKind}`)
  return name
}

function structuralEntityRefVariants(entityKind: string): SchemaNode[]
{
  const common = {
    entityKind: required(schema.literalString(entityKind)),
  }
  return [
    object({
      refKind: required(schema.literalString('structural')),
      selectorKind: required(schema.literalString('exactLocation')),
      ...common,
      location: required(ref(entityLocationProjectionDefinition(entityKind))),
      expectedFullLocationSha256: required(ref('Sha256')),
      expectedSemanticFingerprint: required(ref('Sha256')),
      expectedContextFingerprint: required(ref('Sha256')),
    }),
    object({
      refKind: required(schema.literalString('structural')),
      selectorKind: required(schema.literalString('matchSet')),
      ...common,
      scope: required(ref('StructuralMatchScopeV1')),
      criteria: required(ref(structuralCriteriaDefinition(entityKind))),
      expectedMatchCount: required(integer(1, 256)),
      expectedOrderedMatchSetSha256: required(ref('Sha256')),
      selection: required(ref('MatchSetSelectionV1')),
      expectedSelectedFullLocationSha256: required(ref('Sha256')),
      expectedSelectedSemanticFingerprint: required(ref('Sha256')),
      expectedSelectedContextFingerprint: required(ref('Sha256')),
    }),
  ]
}

function entityRef(entityKind: string, allowCreated = true): SchemaNode
{
  const common = {
    entityKind: required(schema.literalString(entityKind)),
  }
  const handle = object({
    refKind: required(schema.literalString('handle')),
    ...common,
    token: required(ref('HandleTokenV1')),
    expectedSemanticFingerprint: required(ref('Sha256')),
  })
  const structuralVariants = structuralEntityRefVariants(entityKind)
  if (!allowCreated) return union(handle, ...structuralVariants)
  const created = object({
    refKind: required(schema.literalString('created')),
    ...common,
    opId: required(ref('OpId')),
    slot: required(createdResultSlotSchema(entityKind)),
  })
  return union(handle, ...structuralVariants, created)
}

function structuralEntityRef(entityKind: string): SchemaNode
{
  return union(...structuralEntityRefVariants(entityKind))
}

function structuralMatchCriteria(
  definitionNames: readonly string[]
): SchemaNode
{
  const criteria = definitionNames.map(ref)
  return object({
    conjunction: required(
      uniqueList(
        criteria.length === 1 ? criteria[0]! : union(...criteria),
        1,
        criteria.length
      )
    ),
  })
}

const RESULT_SLOT_ENTITY_KIND: Readonly<Record<string, string>> = {
  target: 'target',
  declaration: 'declaration',
  script: 'script',
  definitionScript: 'script',
  destinationScript: 'script',
  rootBlock: 'block',
  sourceGapRootBlock: 'block',
  blockAlias: 'block',
  cloneAlias: 'block',
  comment: 'comment',
  procedure: 'procedure',
  parameter: 'parameter',
  media: 'media',
}

function resultSlotIdentitySchema(slotName: string): SchemaNode
{
  if (slotName === 'blockAlias' || slotName === 'cloneAlias')
  {
    return object({
      slotKind: required(schema.literalString(slotName)),
      alias: required(ref('LocalKey')),
    })
  }
  if (slotName === 'parameter')
  {
    return object({
      slotKind: required(schema.literalString('parameter')),
      localKey: required(ref('LocalKey')),
    })
  }
  return object({
    slotKind: required(schema.literalString('fixed')),
    name: required(schema.literalString(slotName)),
  })
}

function createdResultSlotSchema(entityKind: string): SchemaNode
{
  const variants = Object.entries(RESULT_SLOT_ENTITY_KIND)
    .filter(([, slotEntityKind]) => slotEntityKind === entityKind)
    .map(([slotName]) => resultSlotIdentitySchema(slotName))
  if (variants.length === 0)
  {
    throw new Error(`missing created result slot for ${entityKind}`)
  }
  return union(...variants)
}

function operationResultSlotSchema(slotName: string): SchemaNode
{
  const entityKind = RESULT_SLOT_ENTITY_KIND[slotName]
  if (entityKind === undefined)
    throw new Error(`missing result-slot entity kind for ${slotName}`)

  return object({
    slot: required(resultSlotIdentitySchema(slotName)),
    entityKind: required(schema.literalString(entityKind)),
    lineageSha256: required(ref('Sha256')),
    semanticFingerprint: required(ref('Sha256')),
    contextFingerprint: required(ref('Sha256')),
    location: required(ref(entityLocationProjectionDefinition(entityKind))),
  })
}

function contractEntityRefSchema(
  entityKind?: EntityKind,
  entitySubtypes?: readonly string[],
  refKinds: readonly ('existing' | 'future')[] = ['existing', 'future']
): SchemaNode
{
  const kinds = entityKind === undefined ? ENTITY_KINDS : [entityKind]
  const variants: SchemaNode[] = []

  for (const kind of kinds)
  {
    const subtypes = entitySubtypes ?? ENTITY_SUBTYPES[kind]

    for (const subtype of subtypes)
    {
      for (const refKind of refKinds)
      {
        if (
          refKind === 'future' &&
          (kind === 'topLevelPrimitive' ||
            (kind === 'target' && subtype === 'stage'))
        )
        {
          continue
        }

        variants.push(
          object({
            contractRefKind: required(schema.literalString(refKind)),
            entityKind: required(schema.literalString(kind)),
            entitySubtype: required(schema.literalString(subtype)),
            bindingKey: required(ref('LocalKey')),
          })
        )
      }
    }
  }

  return union(...variants)
}

function semanticPropertyPath(
  surface: string,
  properties: readonly string[]
): SchemaNode
{
  return object({
    surface: required(schema.literalString(surface)),
    property: required(stringEnum(properties)),
  })
}

function compatiblePropertySelection(
  entityKind: EntityKind,
  entitySubtypes: readonly string[],
  surface: string,
  properties: readonly string[]
): SchemaNode
{
  return object({
    entity: required(contractEntityRefSchema(entityKind, entitySubtypes)),
    property: required(semanticPropertyPath(surface, properties)),
  })
}

function compatiblePropertyPredicate(
  entityKind: EntityKind,
  entitySubtypes: readonly string[],
  surface: string,
  properties: readonly string[]
): SchemaNode
{
  return object({
    objectiveId: required(ref('LocalKey')),
    kind: required(schema.literalString('propertyEquals')),
    entity: required(contractEntityRefSchema(entityKind, entitySubtypes)),
    property: required(semanticPropertyPath(surface, properties)),
    canonicalValueSha256: required(ref('Sha256')),
  })
}

function compatiblePropertyAllowance(
  entityKind: EntityKind,
  entitySubtypes: readonly string[],
  surface: string,
  properties: readonly string[]
): SchemaNode
{
  return object({
    allowanceId: required(ref('LocalKey')),
    kind: required(schema.literalString('propertyTransition')),
    entity: required(contractEntityRefSchema(entityKind, entitySubtypes)),
    property: required(semanticPropertyPath(surface, properties)),
    beforeValueSha256: required(ref('Sha256')),
    afterValueSha256: required(ref('Sha256')),
  })
}

const COMPATIBLE_PROPERTY_ROWS: readonly {
  entityKind: EntityKind
  entitySubtypes: readonly string[]
  surface: string
  properties: readonly string[]
  maximum: number
}[] = [
  {
    entityKind: 'target',
    entitySubtypes: ['sprite'],
    surface: 'target',
    properties: [
      'name',
      'x',
      'y',
      'direction',
      'size',
      'visible',
      'draggable',
      'rotationStyle',
      'volume',
      'layerOrder',
      'selectedCostume',
    ],
    maximum: 16,
  },
  {
    entityKind: 'target',
    entitySubtypes: ['stage'],
    surface: 'target',
    properties: [
      'name',
      'volume',
      'tempo',
      'videoTransparency',
      'videoState',
      'selectedCostume',
    ],
    maximum: 16,
  },
  {
    entityKind: 'declaration',
    entitySubtypes: ['variable'],
    surface: 'declaration',
    properties: ['name', 'initialValue'],
    maximum: 2,
  },
  {
    entityKind: 'declaration',
    entitySubtypes: ['list'],
    surface: 'declaration',
    properties: ['name', 'initialItems'],
    maximum: 2,
  },
  {
    entityKind: 'declaration',
    entitySubtypes: ['broadcast'],
    surface: 'declaration',
    properties: ['name'],
    maximum: 1,
  },
  {
    entityKind: 'script',
    entitySubtypes: ['unspecialized'],
    surface: 'script',
    properties: ['workspaceX', 'workspaceY'],
    maximum: 2,
  },
  {
    entityKind: 'comment',
    entitySubtypes: ['unspecialized'],
    surface: 'comment',
    properties: [
      'text',
      'attachment',
      'x',
      'y',
      'width',
      'height',
      'minimized',
    ],
    maximum: 7,
  },
  {
    entityKind: 'procedure',
    entitySubtypes: ['unspecialized'],
    surface: 'procedure',
    properties: ['signature', 'warp'],
    maximum: 2,
  },
  {
    entityKind: 'media',
    entitySubtypes: ['costume'],
    surface: 'media',
    properties: ['name', 'order', 'payload', 'rotationCenter'],
    maximum: 4,
  },
  {
    entityKind: 'media',
    entitySubtypes: ['sound'],
    surface: 'media',
    properties: ['name', 'order', 'payload'],
    maximum: 3,
  },
]

function compatiblePropertyPathList(
  entityKind: EntityKind,
  entitySubtype: string
): SchemaNode
{
  if (entityKind === 'block')
    return uniqueList(
      union(
        object({
          surface: required(schema.literalString('blockField')),
          descriptorName: required(
            schema.string({ minLength: 1, maxLength: 256 })
          ),
        }),
        object({
          surface: required(schema.literalString('blockInput')),
          descriptorName: required(
            schema.string({ minLength: 1, maxLength: 256 })
          ),
        })
      ),
      0,
      64
    )
  const compatibility = COMPATIBLE_PROPERTY_ROWS.find(
    (row) =>
      row.entityKind === entityKind &&
      row.entitySubtypes.includes(entitySubtype)
  )
  if (compatibility)
    return uniqueList(
      semanticPropertyPath(compatibility.surface, compatibility.properties),
      0,
      compatibility.maximum
    )

  return list(ref('SemanticPropertyPathV1'), 0, 0)
}

function existingContractBindingSchema(
  entityKind: EntityKind,
  entitySubtype: string
): SchemaNode
{
  return object({
    bindingKind: required(schema.literalString('existing')),
    bindingKey: required(ref('LocalKey')),
    entityKind: required(schema.literalString(entityKind)),
    entitySubtype: required(schema.literalString(entitySubtype)),
    sourceLocationSha256: required(ref('Sha256')),
    expectedSourceSemanticFingerprint: required(ref('Sha256')),
    expectedSourceContextFingerprint: required(ref('Sha256')),
    expectedMatchCount: required(exactInteger(1)),
  })
}

function contractCreationRoleSchema(
  entityKind: EntityKind,
  entitySubtype: string
): SchemaNode
{
  const fixedNames: Partial<Record<EntityKind, readonly string[]>> = {
    target: ['target'],
    declaration: ['declaration'],
    script: ['script', 'destinationScript', 'definitionScript'],
    block: ['rootBlock', 'sourceGapRootBlock'],
    procedure: ['procedure'],
    comment: ['comment'],
    media: ['media'],
  }
  const variants: SchemaNode[] = []
  const names = fixedNames[entityKind]

  if (names !== undefined)
  {
    variants.push(
      object({
        roleKind: required(schema.literalString('fixed')),
        name: required(stringEnum(names)),
        entityKind: required(schema.literalString(entityKind)),
        entitySubtype: required(schema.literalString(entitySubtype)),
      })
    )
  }

  if (entityKind === 'block')
  {
    variants.push(
      object({
        roleKind: required(schema.literalString('dynamic')),
        name: required(stringEnum(['blockAlias', 'cloneAlias'])),
        entityKind: required(schema.literalString('block')),
        entitySubtype: required(schema.literalString('unspecialized')),
      })
    )
  }

  if (entityKind === 'parameter')
  {
    variants.push(
      object({
        roleKind: required(schema.literalString('dynamic')),
        name: required(schema.literalString('parameter')),
        entityKind: required(schema.literalString('parameter')),
        entitySubtype: required(schema.literalString('unspecialized')),
      })
    )
  }

  return union(...variants)
}

function contractCreationScopeSchema(entityKind: EntityKind): SchemaNode
{
  const variants: SchemaNode[] = []

  if (entityKind === 'target')
  {
    variants.push(
      object({
        scopeKind: required(schema.literalString('projectEntityCollection')),
        collection: required(schema.literalString('targets')),
      })
    )
  }

  if (entityKind === 'declaration')
  {
    variants.push(
      object({
        scopeKind: required(schema.literalString('projectEntityCollection')),
        collection: required(schema.literalString('broadcasts')),
      }),
      object({
        scopeKind: required(schema.literalString('targetAndOwnedDescendants')),
        target: required(contractEntityRefSchema('target')),
      })
    )
  }

  if (['script', 'comment', 'procedure', 'media'].includes(entityKind))
  {
    variants.push(
      object({
        scopeKind: required(schema.literalString('targetAndOwnedDescendants')),
        target: required(contractEntityRefSchema('target')),
      })
    )
  }

  if (entityKind === 'block')
  {
    variants.push(
      object({
        scopeKind: required(schema.literalString('scriptClosure')),
        script: required(contractEntityRefSchema('script')),
      })
    )
  }

  if (entityKind === 'parameter')
  {
    variants.push(
      object({
        scopeKind: required(schema.literalString('procedureOwnedClosure')),
        procedure: required(contractEntityRefSchema('procedure')),
      })
    )
  }

  return union(...variants)
}

function futureContractBindingSchema(
  entityKind: EntityKind,
  entitySubtype: string
): SchemaNode
{
  const creatorOperationKinds: Partial<
    Record<EntityKind, readonly OperationKind[]>
  > = {
    target: ['target.addSprite'],
    declaration:
      entitySubtype === 'variable'
        ? ['declaration.addVariable']
        : entitySubtype === 'list'
          ? ['declaration.addList']
          : ['declaration.addBroadcast'],
    script: ['script.add', 'script.duplicate', 'block.move', 'procedure.add'],
    block: [
      'script.add',
      'script.duplicate',
      'block.insertBefore',
      'block.insertAfter',
      'block.insertSubstack',
      'block.replace',
      'block.move',
      'block.remove',
      'block.setInput',
      'procedure.add',
      'procedure.updateSignature',
      'procedure.setCallArgument',
    ],
    procedure: ['procedure.add'],
    parameter: ['procedure.add', 'procedure.updateSignature'],
    comment: ['comment.add'],
    media:
      entitySubtype === 'costume' ? ['media.addCostume'] : ['media.addSound'],
  }
  const operationKinds = creatorOperationKinds[entityKind]

  if (operationKinds === undefined)
  {
    throw new Error(
      `entity kind ${entityKind} has no future creation operation in V1`
    )
  }

  return object({
    bindingKind: required(schema.literalString('future')),
    bindingKey: required(ref('LocalKey')),
    entityKind: required(schema.literalString(entityKind)),
    entitySubtype: required(schema.literalString(entitySubtype)),
    expectedCreatorOperationKind: required(stringEnum(operationKinds)),
    expectedCreationRole: required(
      contractCreationRoleSchema(entityKind, entitySubtype)
    ),
    expectedCreationScope: required(contractCreationScopeSchema(entityKind)),
    expectedCreationContentFingerprintSha256: required(ref('Sha256')),
  })
}

function optionalState(value: SchemaNode): SchemaNode
{
  return union(
    object({ state: required(schema.literalString('missing')) }),
    object({
      state: required(schema.literalString('value')),
      value: required(value),
    })
  )
}

function nullableOptionalState(value: SchemaNode): SchemaNode
{
  return union(
    optionalState(value),
    object({ state: required(schema.literalString('null')) })
  )
}

const ENTITY_KINDS = [
  'target',
  'declaration',
  'script',
  'block',
  'topLevelPrimitive',
  'procedure',
  'parameter',
  'comment',
  'media',
] as const

const ENTITY_SUBTYPES = {
  target: ['stage', 'sprite'],
  declaration: ['variable', 'list', 'broadcast'],
  script: ['unspecialized'],
  block: ['unspecialized'],
  topLevelPrimitive: ['variableReporter', 'listReporter'],
  procedure: ['unspecialized'],
  parameter: ['unspecialized'],
  comment: ['unspecialized'],
  media: ['costume', 'sound'],
} as const

type EntityKind = keyof typeof ENTITY_SUBTYPES

const EXECUTION_LANES = [
  'officialHeadless',
  'officialBrowser',
  'turboWarpBrowser',
] as const

const VISUAL_EVIDENCE_LANES = [
  'officialBrowser',
  'turboWarpBrowser',
  'renderedDifferential',
  'nativeVisual',
] as const

const EVALUATION_LANES = [
  'projectPreflight',
  ...EXECUTION_LANES,
  'renderedDifferential',
  'nativeVisual',
] as const

const SEMANTIC_SURFACES = [
  'target',
  'declaration',
  'script',
  'blockField',
  'blockInput',
  'comment',
  'procedure',
  'media',
  'project',
] as const

const STATEFUL_SESSION_TOOL_NAMES = STATEFUL_EDIT_TOOL_NAMES.filter(
  (name) => name !== 'edit_begin'
)

const CLOSED_REFUSAL_CODES = [...new Set(REFUSAL_CODES)]

const DEFINITIONS: Record<string, SchemaNode> = {
  Sha256: schema.string({
    minLength: 64,
    maxLength: 64,
    pattern: '^[0-9a-f]{64}$',
  }),
  OpaqueId: schema.string({
    minLength: 16,
    maxLength: 128,
    pattern: '^[A-Za-z0-9_-]+$',
  }),
  HandleTokenV1: schema.string({
    minLength: 87,
    maxLength: 87,
    pattern: '^[A-Za-z0-9_-]{87}$',
  }),
  ResourceTokenV1: schema.string({
    minLength: 108,
    maxLength: 108,
    pattern: '^[A-Za-z0-9_-]{108}$',
  }),
  ScratchEditArtifactResourceUriV1: schema.string({
    minLength: 132,
    maxLength: 132,
    pattern: '^scratch-edit://artifact/[A-Za-z0-9_-]{108}$',
  }),
  ScratchEditResourceRevisionOrStoreIdentityV1: union(
    object({
      kind: required(schema.literalString('revision')),
      revisionId: required(ref('Sha256')),
    }),
    object({
      kind: required(schema.literalString('store')),
      storeIdentitySha256: required(ref('Sha256')),
    })
  ),
  ScratchEditResourceMacInputV1: object({
    schemaVersion: required(exactInteger(1)),
    tokenVersion: required(exactInteger(1)),
    sessionStoreKey: required(
      schema.string({
        minLength: 32,
        maxLength: 32,
        pattern: '^[0-9a-f]{32}$',
      })
    ),
    principalIdentity: required(ref('Sha256')),
    sessionId: required(ref('OpaqueId')),
    revisionOrStoreIdentity: required(
      ref('ScratchEditResourceRevisionOrStoreIdentityV1')
    ),
    locatorKind: required(
      stringEnum(['retained-artifact', 'exact-virtual-slice'])
    ),
    locatorDigest: required(ref('Sha256')),
    contentSha256: required(ref('Sha256')),
    mimeType: required(
      schema.string({
        minLength: 1,
        maxLength: 256,
        pattern: '^[\\x20-\\x7e]+$',
      })
    ),
    byteLength: required(integer(0, 5 * 1024 * 1024)),
  }),
  OutputBasenameV1: schema.string({
    minLength: 5,
    maxLength: 255,
    pattern: '^[A-Za-z0-9][A-Za-z0-9._-]{0,250}\\.sb3$',
    utf8MinBytes: 5,
    utf8MaxBytes: 255,
    requireNfc: true,
    rejectNul: true,
    rejectUnpairedSurrogates: true,
  }),
  RequestId: authoredString(1, 128),
  AuthoringNameV1: authoredString(1, 256),
  AuthoringCommentTextV1: authoredString(0, 4096),
  AuthoringProcedureFragmentV1: schema.string({
    pattern: '^[^%\\\\]+$',
    utf8MinBytes: 1,
    utf8MaxBytes: 256,
    requireNfc: true,
    rejectNul: true,
    rejectUnpairedSurrogates: true,
  }),
  OpId: schema.string({
    minLength: 1,
    maxLength: 64,
    pattern: '^[A-Za-z][A-Za-z0-9_-]{0,63}$',
  }),
  LocalKey: schema.string({
    minLength: 1,
    maxLength: 64,
    pattern: '^[A-Za-z][A-Za-z0-9_-]{0,63}$',
  }),
  ScratchNumberV1: schema.number(),
  ScratchScalarV1: union(
    authoredString(0, 60 * 1024),
    ref('ScratchNumberV1'),
    schema.boolean()
  ),
  ProcedureDefaultStringOrNumberV1: union(
    authoredString(0, 60 * 1024),
    ref('ScratchNumberV1')
  ),
  BoundedDisplayStringV1: union(
    object({
      displayKind: required(schema.literalString('inline')),
      value: required(schema.string({ maxLength: 4096 })),
      canonicalJsonStringByteLength: required(integer()),
      valueSha256: required(ref('Sha256')),
    }),
    object({
      displayKind: required(schema.literalString('hashOnly')),
      canonicalJsonStringByteLength: required(integer()),
      valueSha256: required(ref('Sha256')),
      escapedPrefix: optional(schema.string({ maxLength: 64 })),
    })
  ),
  ExpectedStringIdentityV1: object({
    canonicalJsonStringByteLength: required(integer()),
    valueSha256: required(ref('Sha256')),
  }),
  ExistingOptionalNumberV1: optionalState(schema.number()),
  ExistingNullableOptionalNumberV1: nullableOptionalState(schema.number()),
  ExistingOptionalBooleanV1: optionalState(schema.boolean()),
  OptionalCollectionContainerStateV1: union(
    object({ state: required(schema.literalString('missing')) }),
    object({
      state: required(schema.literalString('present')),
      expectedEntryCount: required(integer()),
      expectedEntrySetSha256: required(ref('Sha256')),
    })
  ),
  TargetLocationV1: object({
    kind: required(schema.literalString('target')),
    targetKind: required(stringEnum(['stage', 'sprite'])),
    name: required(schema.string()),
    serializedTargetOrdinal: required(integer()),
    visualLayerOrdinal: optional(integer(1)),
    semanticFingerprint: required(ref('Sha256')),
  }),
  ProjectLocationScopeV1: object({
    kind: required(schema.literalString('project')),
  }),
  DeclarationLocationV1: union(
    object({
      kind: required(schema.literalString('declaration')),
      declarationKind: required(stringEnum(['variable', 'list'])),
      scope: required(
        union(ref('TargetLocationV1'), ref('ProjectLocationScopeV1'))
      ),
      name: required(schema.string()),
      semanticFingerprint: required(ref('Sha256')),
    }),
    object({
      kind: required(schema.literalString('declaration')),
      declarationKind: required(schema.literalString('broadcast')),
      scope: required(ref('ProjectLocationScopeV1')),
      rawOwnerTarget: required(ref('TargetLocationV1')),
      name: required(schema.string()),
      semanticFingerprint: required(ref('Sha256')),
    })
  ),
  ScriptLocationV1: object({
    kind: required(schema.literalString('script')),
    target: required(ref('TargetLocationV1')),
    hatOrRootOpcode: required(schema.string({ minLength: 1, maxLength: 256 })),
    workspace: required(
      object({
        x: required(ref('ExistingOptionalNumberV1')),
        y: required(ref('ExistingOptionalNumberV1')),
      })
    ),
    boundedOutlineSha256: required(ref('Sha256')),
    semanticFingerprint: required(ref('Sha256')),
  }),
  OwnershipStepV1: union(
    object({
      relation: required(schema.literalString('next')),
      ordinal: required(integer()),
    }),
    object({
      relation: required(stringEnum(['input', 'substack'])),
      name: required(schema.string({ minLength: 1, maxLength: 256 })),
      ordinal: required(integer()),
    })
  ),
  OwnedBlockLocationV1: object({
    kind: required(schema.literalString('block')),
    ownershipStatus: required(schema.literalString('uniqueOwned')),
    script: required(ref('ScriptLocationV1')),
    ownershipPath: required(list(ref('OwnershipStepV1'), 0, 256)),
    opcode: required(schema.string({ minLength: 1, maxLength: 256 })),
    semanticFingerprint: required(ref('Sha256')),
  }),
  NonUniqueBlockLocationV1: object({
    kind: required(schema.literalString('block')),
    ownershipStatus: required(stringEnum(['unowned', 'multiplyOwned'])),
    target: required(ref('TargetLocationV1')),
    opcode: required(schema.string({ minLength: 1, maxLength: 256 })),
    stableTargetBlockOrdinal: required(integer()),
    boundedOutlineSha256: required(ref('Sha256')),
    candidateScriptSetSha256: required(ref('Sha256')),
    semanticFingerprint: required(ref('Sha256')),
  }),
  BlockLocationV1: union(
    ref('OwnedBlockLocationV1'),
    ref('NonUniqueBlockLocationV1')
  ),
  ProcedureLocationV1: object({
    kind: required(schema.literalString('procedure')),
    target: required(ref('TargetLocationV1')),
    canonicalSignature: required(
      schema.string({ minLength: 1, maxLength: 1024 })
    ),
    semanticFingerprint: required(ref('Sha256')),
  }),
  ParameterLocationV1: object({
    kind: required(schema.literalString('parameter')),
    procedure: required(ref('ProcedureLocationV1')),
    name: required(schema.string({ minLength: 1, maxLength: 256 })),
    parameterType: required(
      stringEnum(['stringOrNumber', 'number', 'boolean'])
    ),
    ordinal: required(integer()),
    semanticFingerprint: required(ref('Sha256')),
  }),
  CommentLocationV1: object({
    kind: required(schema.literalString('comment')),
    target: required(ref('TargetLocationV1')),
    attachedBlock: optional(ref('BlockLocationV1')),
    workspace: required(
      object({
        x: required(ref('ExistingNullableOptionalNumberV1')),
        y: required(ref('ExistingNullableOptionalNumberV1')),
        width: required(ref('ExistingOptionalNumberV1')),
        height: required(ref('ExistingOptionalNumberV1')),
        minimized: required(ref('ExistingOptionalBooleanV1')),
      })
    ),
    textSha256: required(ref('Sha256')),
    semanticFingerprint: required(ref('Sha256')),
  }),
  MediaLocationV1: object({
    kind: required(schema.literalString('media')),
    mediaKind: required(stringEnum(['costume', 'sound'])),
    target: required(ref('TargetLocationV1')),
    name: required(schema.string()),
    order: required(integer()),
    payload: required(
      union(
        object({
          resolution: required(schema.literalString('present')),
          payloadSha256: required(ref('Sha256')),
        }),
        object({
          resolution: required(schema.literalString('missing')),
          expectedAssetIdentitySha256: required(ref('Sha256')),
          diagnosticFingerprint: required(ref('Sha256')),
        })
      )
    ),
    semanticFingerprint: required(ref('Sha256')),
  }),
  TopLevelPrimitiveLocationV1: object({
    kind: required(schema.literalString('topLevelPrimitive')),
    primitiveKind: required(stringEnum(['variableReporter', 'listReporter'])),
    target: required(ref('TargetLocationV1')),
    declaration: required(
      union(
        object({
          resolution: required(schema.literalString('resolved')),
          location: required(ref('DeclarationLocationV1')),
        }),
        object({
          resolution: required(schema.literalString('unresolved')),
          declarationKind: required(stringEnum(['variable', 'list'])),
          referencedName: required(schema.string()),
          rawReferenceSha256: required(ref('Sha256')),
          diagnosticFingerprint: required(ref('Sha256')),
        })
      )
    ),
    workspace: required(
      object({
        x: required(ref('ExistingOptionalNumberV1')),
        y: required(ref('ExistingOptionalNumberV1')),
      })
    ),
    semanticFingerprint: required(ref('Sha256')),
  }),
  SemanticLocationV1: union(
    ref('TargetLocationV1'),
    ref('DeclarationLocationV1'),
    ref('ScriptLocationV1'),
    ref('BlockLocationV1'),
    ref('TopLevelPrimitiveLocationV1'),
    ref('ProcedureLocationV1'),
    ref('ParameterLocationV1'),
    ref('CommentLocationV1'),
    ref('MediaLocationV1')
  ),
  BoundedTargetLocationProjectionV1: object({
    kind: required(schema.literalString('target')),
    targetKind: required(stringEnum(['stage', 'sprite'])),
    name: required(ref('BoundedDisplayStringV1')),
    serializedTargetOrdinal: required(integer()),
    visualLayerOrdinal: optional(integer(1)),
    semanticFingerprint: required(ref('Sha256')),
    fullLocationSha256: required(ref('Sha256')),
    retainedLocationArtifactId: required(ref('OpaqueId')),
  }),
  BoundedDeclarationLocationProjectionV1: object({
    kind: required(schema.literalString('declaration')),
    declarationKind: required(stringEnum(['variable', 'list', 'broadcast'])),
    scopeKind: required(stringEnum(['project', 'target'])),
    scopeTargetSha256: optional(ref('Sha256')),
    rawOwnerTargetSha256: optional(ref('Sha256')),
    name: required(ref('BoundedDisplayStringV1')),
    semanticFingerprint: required(ref('Sha256')),
    fullLocationSha256: required(ref('Sha256')),
    retainedLocationArtifactId: required(ref('OpaqueId')),
  }),
  BoundedOwnershipStepV1: union(
    object({
      relation: required(schema.literalString('next')),
      ordinal: required(integer()),
    }),
    object({
      relation: required(stringEnum(['input', 'substack'])),
      name: required(ref('BoundedDisplayStringV1')),
      ordinal: required(integer()),
    })
  ),
  BoundedOwnershipPathV1: object({
    stepCount: required(integer()),
    fullPathSha256: required(ref('Sha256')),
    prefix: required(list(ref('BoundedOwnershipStepV1'), 0, 8)),
    suffix: required(list(ref('BoundedOwnershipStepV1'), 0, 8)),
  }),
  BoundedScriptLocationProjectionV1: object({
    kind: required(schema.literalString('script')),
    targetLocationSha256: required(ref('Sha256')),
    hatOrRootOpcode: required(ref('BoundedDisplayStringV1')),
    workspace: required(
      object({
        x: required(ref('ExistingOptionalNumberV1')),
        y: required(ref('ExistingOptionalNumberV1')),
      })
    ),
    boundedOutlineSha256: required(ref('Sha256')),
    semanticFingerprint: required(ref('Sha256')),
    fullLocationSha256: required(ref('Sha256')),
    retainedLocationArtifactId: required(ref('OpaqueId')),
  }),
  BoundedBlockLocationProjectionV1: union(
    object({
      kind: required(schema.literalString('block')),
      ownershipStatus: required(schema.literalString('uniqueOwned')),
      scriptLocationSha256: required(ref('Sha256')),
      ownershipPath: required(ref('BoundedOwnershipPathV1')),
      opcode: required(ref('BoundedDisplayStringV1')),
      semanticFingerprint: required(ref('Sha256')),
      fullLocationSha256: required(ref('Sha256')),
      retainedLocationArtifactId: required(ref('OpaqueId')),
    }),
    object({
      kind: required(schema.literalString('block')),
      ownershipStatus: required(stringEnum(['unowned', 'multiplyOwned'])),
      targetLocationSha256: required(ref('Sha256')),
      opcode: required(ref('BoundedDisplayStringV1')),
      stableTargetBlockOrdinal: required(integer()),
      boundedOutlineSha256: required(ref('Sha256')),
      candidateScriptSetSha256: required(ref('Sha256')),
      semanticFingerprint: required(ref('Sha256')),
      fullLocationSha256: required(ref('Sha256')),
      retainedLocationArtifactId: required(ref('OpaqueId')),
    })
  ),
  BoundedTopLevelPrimitiveLocationProjectionV1: object({
    kind: required(schema.literalString('topLevelPrimitive')),
    primitiveKind: required(stringEnum(['variableReporter', 'listReporter'])),
    targetLocationSha256: required(ref('Sha256')),
    declarationResolution: required(stringEnum(['resolved', 'unresolved'])),
    declarationLocationSha256: optional(ref('Sha256')),
    referencedName: optional(ref('BoundedDisplayStringV1')),
    rawReferenceSha256: optional(ref('Sha256')),
    diagnosticFingerprint: optional(ref('Sha256')),
    workspace: required(
      object({
        x: required(ref('ExistingOptionalNumberV1')),
        y: required(ref('ExistingOptionalNumberV1')),
      })
    ),
    semanticFingerprint: required(ref('Sha256')),
    fullLocationSha256: required(ref('Sha256')),
    retainedLocationArtifactId: required(ref('OpaqueId')),
  }),
  BoundedProcedureLocationProjectionV1: object({
    kind: required(schema.literalString('procedure')),
    targetLocationSha256: required(ref('Sha256')),
    canonicalSignature: required(ref('BoundedDisplayStringV1')),
    semanticFingerprint: required(ref('Sha256')),
    fullLocationSha256: required(ref('Sha256')),
    retainedLocationArtifactId: required(ref('OpaqueId')),
  }),
  BoundedCommentLocationProjectionV1: object({
    kind: required(schema.literalString('comment')),
    targetLocationSha256: required(ref('Sha256')),
    attachedBlockLocationSha256: optional(ref('Sha256')),
    workspace: required(
      object({
        x: required(ref('ExistingNullableOptionalNumberV1')),
        y: required(ref('ExistingNullableOptionalNumberV1')),
        width: required(ref('ExistingOptionalNumberV1')),
        height: required(ref('ExistingOptionalNumberV1')),
        minimized: required(ref('ExistingOptionalBooleanV1')),
      })
    ),
    textSha256: required(ref('Sha256')),
    semanticFingerprint: required(ref('Sha256')),
    fullLocationSha256: required(ref('Sha256')),
    retainedLocationArtifactId: required(ref('OpaqueId')),
  }),
  BoundedMediaLocationProjectionV1: object({
    kind: required(schema.literalString('media')),
    mediaKind: required(stringEnum(['costume', 'sound'])),
    targetLocationSha256: required(ref('Sha256')),
    name: required(ref('BoundedDisplayStringV1')),
    order: required(integer()),
    payloadResolution: required(stringEnum(['present', 'missing'])),
    payloadOrExpectedIdentitySha256: required(ref('Sha256')),
    diagnosticFingerprint: optional(ref('Sha256')),
    semanticFingerprint: required(ref('Sha256')),
    fullLocationSha256: required(ref('Sha256')),
    retainedLocationArtifactId: required(ref('OpaqueId')),
  }),
  BoundedParameterLocationProjectionV1: object({
    kind: required(schema.literalString('parameter')),
    procedureLocationSha256: required(ref('Sha256')),
    name: required(ref('BoundedDisplayStringV1')),
    parameterType: required(
      stringEnum(['stringOrNumber', 'number', 'boolean'])
    ),
    ordinal: required(integer()),
    semanticFingerprint: required(ref('Sha256')),
    fullLocationSha256: required(ref('Sha256')),
    retainedLocationArtifactId: required(ref('OpaqueId')),
  }),
  BoundedSemanticLocationProjectionV1: union(
    ref('BoundedTargetLocationProjectionV1'),
    ref('BoundedDeclarationLocationProjectionV1'),
    ref('BoundedScriptLocationProjectionV1'),
    ref('BoundedBlockLocationProjectionV1'),
    ref('BoundedTopLevelPrimitiveLocationProjectionV1'),
    ref('BoundedProcedureLocationProjectionV1'),
    ref('BoundedCommentLocationProjectionV1'),
    ref('BoundedMediaLocationProjectionV1'),
    ref('BoundedParameterLocationProjectionV1')
  ),
  StructuralMatchScopeV1: union(
    object({ scopeKind: required(schema.literalString('project')) }),
    object({
      scopeKind: required(schema.literalString('target')),
      target: required(entityRef('target', false)),
    }),
    object({
      scopeKind: required(schema.literalString('script')),
      script: required(entityRef('script', false)),
    })
  ),
  OpcodeMatchCriterionV1: object({
    criterionKind: required(schema.literalString('opcode')),
    opcode: required(schema.string({ minLength: 1, maxLength: 256 })),
  }),
  CategoryMatchCriterionV1: object({
    criterionKind: required(schema.literalString('category')),
    category: required(
      stringEnum([
        'motion',
        'looks',
        'event',
        'control',
        'sensing',
        'operators',
        'data',
      ])
    ),
  }),
  NameMatchCriterionV1: object({
    criterionKind: required(schema.literalString('nameIdentity')),
    name: required(ref('ExpectedStringIdentityV1')),
  }),
  RootRoleMatchCriterionV1: object({
    criterionKind: required(schema.literalString('rootRole')),
    rootRole: required(
      stringEnum([
        'eventHat',
        'statement',
        'expression',
        'procedureDefinition',
        'topLevelPrimitive',
      ])
    ),
  }),
  PropertyMatchCriterionV1: object({
    criterionKind: required(schema.literalString('property')),
    semanticSurface: required(schema.string({ minLength: 1, maxLength: 64 })),
    property: required(schema.string({ minLength: 1, maxLength: 128 })),
  }),
  ContentFingerprintMatchCriterionV1: object({
    criterionKind: required(schema.literalString('contentFingerprint')),
    contentFingerprint: required(ref('Sha256')),
  }),
  TargetStructuralMatchCriteriaV1: structuralMatchCriteria([
    'NameMatchCriterionV1',
    'PropertyMatchCriterionV1',
    'ContentFingerprintMatchCriterionV1',
  ]),
  DeclarationStructuralMatchCriteriaV1: structuralMatchCriteria([
    'NameMatchCriterionV1',
    'PropertyMatchCriterionV1',
    'ContentFingerprintMatchCriterionV1',
  ]),
  ScriptStructuralMatchCriteriaV1: structuralMatchCriteria([
    'OpcodeMatchCriterionV1',
    'CategoryMatchCriterionV1',
    'RootRoleMatchCriterionV1',
    'ContentFingerprintMatchCriterionV1',
  ]),
  BlockStructuralMatchCriteriaV1: structuralMatchCriteria([
    'OpcodeMatchCriterionV1',
    'CategoryMatchCriterionV1',
    'PropertyMatchCriterionV1',
    'ContentFingerprintMatchCriterionV1',
  ]),
  TopLevelPrimitiveStructuralMatchCriteriaV1: structuralMatchCriteria([
    'RootRoleMatchCriterionV1',
    'PropertyMatchCriterionV1',
    'ContentFingerprintMatchCriterionV1',
  ]),
  ProcedureStructuralMatchCriteriaV1: structuralMatchCriteria([
    'NameMatchCriterionV1',
    'ContentFingerprintMatchCriterionV1',
  ]),
  CommentStructuralMatchCriteriaV1: structuralMatchCriteria([
    'ContentFingerprintMatchCriterionV1',
  ]),
  MediaStructuralMatchCriteriaV1: structuralMatchCriteria([
    'NameMatchCriterionV1',
    'PropertyMatchCriterionV1',
    'ContentFingerprintMatchCriterionV1',
  ]),
  ParameterStructuralMatchCriteriaV1: structuralMatchCriteria([
    'NameMatchCriterionV1',
    'PropertyMatchCriterionV1',
    'ContentFingerprintMatchCriterionV1',
  ]),
  StructuralMatchCriteriaV1: union(
    ref('TargetStructuralMatchCriteriaV1'),
    ref('DeclarationStructuralMatchCriteriaV1'),
    ref('ScriptStructuralMatchCriteriaV1'),
    ref('BlockStructuralMatchCriteriaV1'),
    ref('TopLevelPrimitiveStructuralMatchCriteriaV1'),
    ref('ProcedureStructuralMatchCriteriaV1'),
    ref('CommentStructuralMatchCriteriaV1'),
    ref('MediaStructuralMatchCriteriaV1'),
    ref('ParameterStructuralMatchCriteriaV1')
  ),
  MatchSetSelectionV1: union(
    object({ kind: required(schema.literalString('exactlyOne')) }),
    object({
      kind: required(schema.literalString('occurrence')),
      zeroBasedIndex: required(integer()),
    })
  ),
  CreatedResultSlotV1: union(
    ...Object.keys(RESULT_SLOT_ENTITY_KIND).map(resultSlotIdentitySchema)
  ),
  TargetRefV1: entityRef('target'),
  StandaloneTargetRefV1: entityRef('target', false),
  DeclarationRefV1: entityRef('declaration'),
  StandaloneDeclarationRefV1: entityRef('declaration', false),
  ScriptRefV1: entityRef('script'),
  StandaloneScriptRefV1: entityRef('script', false),
  BlockRefV1: entityRef('block'),
  StandaloneBlockRefV1: entityRef('block', false),
  CommentRefV1: entityRef('comment'),
  ProcedureRefV1: entityRef('procedure'),
  StandaloneProcedureRefV1: entityRef('procedure', false),
  ParameterRefV1: entityRef('parameter'),
  MediaRefV1: entityRef('media'),
  StandaloneMediaRefV1: entityRef('media', false),
  AssetRefV1: object({
    assetToken: required(ref('OpaqueId')),
    expectedPayloadSha256: required(ref('Sha256')),
    expectedMetadataSha256: required(ref('Sha256')),
  }),
  ProspectiveNameActivationGuardV1: object({
    expectedActivationSetSha256: required(ref('Sha256')),
    requireProspectiveActivationCount: required(exactInteger(0)),
  }),
  WorkspaceV1: object({
    x: required(schema.number({ minimum: -1_000_000, maximum: 1_000_000 })),
    y: required(schema.number({ minimum: -1_000_000, maximum: 1_000_000 })),
  }),
  SpritePropertiesV1: object({
    x: required(schema.number({ minimum: -1_000_000, maximum: 1_000_000 })),
    y: required(schema.number({ minimum: -1_000_000, maximum: 1_000_000 })),
    direction: required(schema.number({ minimum: -179, maximum: 180 })),
    size: required(schema.number({ minimum: 0, maximum: 100_000 })),
    visible: required(schema.boolean()),
    draggable: required(schema.boolean()),
    rotationStyle: required(
      stringEnum(['all around', 'left-right', "don't rotate"])
    ),
    volume: required(schema.number({ minimum: 0, maximum: 100 })),
  }),
  RotationStyleV1: stringEnum(['all around', 'left-right', "don't rotate"]),
  VideoStateV1: stringEnum(['on', 'off', 'on-flipped']),
  ExistingOptionalRotationStyleV1: optionalState(ref('RotationStyleV1')),
  ExistingOptionalVideoStateV1: optionalState(ref('VideoStateV1')),
  SpritePropertyEditV1: union(
    object({
      property: required(stringEnum(['x', 'y'])),
      expected: required(ref('ExistingOptionalNumberV1')),
      value: required(
        schema.number({ minimum: -1_000_000, maximum: 1_000_000 })
      ),
    }),
    object({
      property: required(schema.literalString('direction')),
      expected: required(ref('ExistingOptionalNumberV1')),
      value: required(schema.number({ minimum: -179, maximum: 180 })),
    }),
    object({
      property: required(schema.literalString('size')),
      expected: required(ref('ExistingOptionalNumberV1')),
      value: required(schema.number({ minimum: 0, maximum: 100_000 })),
    }),
    object({
      property: required(schema.literalString('volume')),
      expected: required(ref('ExistingOptionalNumberV1')),
      value: required(schema.number({ minimum: 0, maximum: 100 })),
    }),
    object({
      property: required(stringEnum(['visible', 'draggable'])),
      expected: required(ref('ExistingOptionalBooleanV1')),
      value: required(schema.boolean()),
    }),
    object({
      property: required(schema.literalString('rotationStyle')),
      expected: required(ref('ExistingOptionalRotationStyleV1')),
      value: required(ref('RotationStyleV1')),
    })
  ),
  SpritePropertyGoalEditV1: union(
    object({
      property: required(stringEnum(['x', 'y'])),
      value: required(
        schema.number({ minimum: -1_000_000, maximum: 1_000_000 })
      ),
    }),
    object({
      property: required(schema.literalString('direction')),
      value: required(schema.number({ minimum: -179, maximum: 180 })),
    }),
    object({
      property: required(schema.literalString('size')),
      value: required(schema.number({ minimum: 0, maximum: 100_000 })),
    }),
    object({
      property: required(schema.literalString('volume')),
      value: required(schema.number({ minimum: 0, maximum: 100 })),
    }),
    object({
      property: required(stringEnum(['visible', 'draggable'])),
      value: required(schema.boolean()),
    }),
    object({
      property: required(schema.literalString('rotationStyle')),
      value: required(ref('RotationStyleV1')),
    })
  ),
  StagePropertyEditV1: union(
    object({
      property: required(schema.literalString('tempo')),
      expected: required(ref('ExistingOptionalNumberV1')),
      value: required(schema.number({ minimum: 20, maximum: 500 })),
    }),
    object({
      property: required(schema.literalString('videoTransparency')),
      expected: required(ref('ExistingOptionalNumberV1')),
      value: required(schema.number({ minimum: 0, maximum: 100 })),
    }),
    object({
      property: required(schema.literalString('volume')),
      expected: required(ref('ExistingOptionalNumberV1')),
      value: required(schema.number({ minimum: 0, maximum: 100 })),
    }),
    object({
      property: required(schema.literalString('videoState')),
      expected: required(ref('ExistingOptionalVideoStateV1')),
      value: required(ref('VideoStateV1')),
    })
  ),
  StagePropertyGoalEditV1: union(
    object({
      property: required(schema.literalString('tempo')),
      value: required(schema.number({ minimum: 20, maximum: 500 })),
    }),
    object({
      property: required(schema.literalString('videoTransparency')),
      value: required(schema.number({ minimum: 0, maximum: 100 })),
    }),
    object({
      property: required(schema.literalString('volume')),
      value: required(schema.number({ minimum: 0, maximum: 100 })),
    }),
    object({
      property: required(schema.literalString('videoState')),
      value: required(ref('VideoStateV1')),
    })
  ),
  CommentLayoutEditV1: union(
    object({
      property: required(stringEnum(['x', 'y'])),
      expected: required(ref('ExistingNullableOptionalNumberV1')),
      value: required(
        schema.number({ minimum: -1_000_000, maximum: 1_000_000 })
      ),
    }),
    object({
      property: required(stringEnum(['width', 'height'])),
      expected: required(ref('ExistingOptionalNumberV1')),
      value: required(schema.number({ minimum: 0, maximum: 1_000_000 })),
    }),
    object({
      property: required(schema.literalString('minimized')),
      expected: required(ref('ExistingOptionalBooleanV1')),
      value: required(schema.boolean()),
    })
  ),
  CommentLayoutGoalEditV1: union(
    object({
      property: required(stringEnum(['x', 'y'])),
      value: required(
        schema.number({ minimum: -1_000_000, maximum: 1_000_000 })
      ),
    }),
    object({
      property: required(stringEnum(['width', 'height'])),
      value: required(schema.number({ minimum: 0, maximum: 1_000_000 })),
    }),
    object({
      property: required(schema.literalString('minimized')),
      value: required(schema.boolean()),
    })
  ),
  SemanticFieldValueV1: union(
    object({
      valueKind: required(schema.literalString('text')),
      value: required(ref('AuthoringCommentTextV1')),
    }),
    object({
      valueKind: required(schema.literalString('number')),
      value: required(ref('ScratchNumberV1')),
    }),
    object({
      valueKind: required(schema.literalString('boolean')),
      value: required(schema.boolean()),
    }),
    object({
      valueKind: required(schema.literalString('enum')),
      value: required(schema.string()),
    }),
    object({
      valueKind: required(schema.literalString('entity')),
      value: required(
        union(ref('TargetRefV1'), ref('DeclarationRefV1'), ref('MediaRefV1'))
      ),
    })
  ),
  SemanticSpecialInputV1: union(
    object({
      domain: required(schema.literalString('targetSelector')),
      token: required(
        stringEnum(['mouse', 'random', 'myself', 'edge', 'stage'])
      ),
    }),
    object({
      domain: required(schema.literalString('costumeSelector')),
      token: required(stringEnum(['next', 'previous'])),
    }),
    object({
      domain: required(schema.literalString('backdropSelector')),
      token: required(stringEnum(['next', 'previous', 'random'])),
    })
  ),
  SemanticInputValueV1: union(
    object({
      valueKind: required(schema.literalString('literal')),
      value: required(ref('ScratchScalarV1')),
    }),
    object({
      valueKind: required(schema.literalString('entity')),
      value: required(
        union(ref('TargetRefV1'), ref('DeclarationRefV1'), ref('MediaRefV1'))
      ),
    }),
    object({
      valueKind: required(schema.literalString('special')),
      value: required(ref('SemanticSpecialInputV1')),
    }),
    object({
      valueKind: required(schema.literalString('block')),
      value: required(ref('SemanticBlockTreeV1')),
    }),
    object({
      valueKind: required(schema.literalString('statementSequence')),
      value: required(ref('SemanticStatementSequenceV1')),
    }),
    object({ valueKind: required(schema.literalString('empty')) })
  ),
  SemanticNamedFieldV1: object({
    name: required(schema.string({ minLength: 1, maxLength: 256 })),
    value: required(ref('SemanticFieldValueV1')),
  }),
  SemanticNamedInputV1: object({
    name: required(schema.string({ minLength: 1, maxLength: 256 })),
    value: required(ref('SemanticInputValueV1')),
  }),
  OrdinarySemanticBlockTreeV1: object({
    nodeKind: required(schema.literalString('ordinary')),
    localAlias: optional(ref('LocalKey')),
    opcode: required(schema.string({ minLength: 1, maxLength: 256 })),
    fields: required(list(ref('SemanticNamedFieldV1'), 0, 64)),
    inputs: required(list(ref('SemanticNamedInputV1'), 0, 64)),
  }),
  ProcedureSemanticRefV1: union(
    ref('ProcedureRefV1'),
    object({ refKind: required(schema.literalString('selfProcedure')) })
  ),
  ParameterSemanticRefV1: union(
    ref('ParameterRefV1'),
    object({
      refKind: required(schema.literalString('procedureLocalParameter')),
      localKey: required(ref('LocalKey')),
    })
  ),
  ProcedureCallArgumentV1: object({
    parameter: required(ref('ParameterSemanticRefV1')),
    value: required(ref('SemanticInputValueV1')),
  }),
  ProcedureCallBlockTreeV1: object({
    nodeKind: required(schema.literalString('procedureCall')),
    localAlias: optional(ref('LocalKey')),
    procedure: required(ref('ProcedureSemanticRefV1')),
    expectedSignatureSha256: required(ref('Sha256')),
    arguments: required(list(ref('ProcedureCallArgumentV1'), 0, 64)),
  }),
  ParameterReporterBlockTreeV1: object({
    nodeKind: required(schema.literalString('parameterReporter')),
    localAlias: optional(ref('LocalKey')),
    parameter: required(ref('ParameterSemanticRefV1')),
  }),
  SemanticBlockTreeV1: union(
    ref('OrdinarySemanticBlockTreeV1'),
    ref('ProcedureCallBlockTreeV1'),
    ref('ParameterReporterBlockTreeV1')
  ),
  SemanticStatementBlockTreeV1: union(
    ref('OrdinarySemanticBlockTreeV1'),
    ref('ProcedureCallBlockTreeV1')
  ),
  SemanticExpressionBlockTreeV1: union(
    ref('OrdinarySemanticBlockTreeV1'),
    ref('ParameterReporterBlockTreeV1')
  ),
  SemanticEventHatBlockTreeV1: ref('OrdinarySemanticBlockTreeV1'),
  SemanticStatementSequenceV1: object({
    blocks: required(list(ref('SemanticStatementBlockTreeV1'), 1, 256)),
  }),
  SemanticReplacementV1: union(
    object({
      replacementKind: required(schema.literalString('statementSequence')),
      value: required(ref('SemanticStatementSequenceV1')),
    }),
    object({
      replacementKind: required(schema.literalString('expression')),
      value: required(ref('SemanticExpressionBlockTreeV1')),
    })
  ),
  TopLevelScriptRootV1: union(
    object({
      rootKind: required(schema.literalString('eventScript')),
      hat: required(ref('SemanticEventHatBlockTreeV1')),
      body: optional(ref('SemanticStatementSequenceV1')),
    }),
    object({
      rootKind: required(schema.literalString('statementSequence')),
      value: required(ref('SemanticStatementSequenceV1')),
    }),
    object({
      rootKind: required(schema.literalString('expression')),
      value: required(ref('SemanticExpressionBlockTreeV1')),
    })
  ),
  CommentRemovalDispositionV1: union(
    object({ kind: required(schema.literalString('rejectIfPresent')) }),
    object({
      kind: required(schema.literalString('deleteExact')),
      comments: required(list(ref('CommentRefV1'), 1, 256)),
    })
  ),
  CommentReattachmentMappingV1: object({
    comment: required(ref('CommentRefV1')),
    newBlockAlias: required(ref('LocalKey')),
  }),
  CommentReplacementDispositionV1: union(
    ref('CommentRemovalDispositionV1'),
    object({
      kind: required(schema.literalString('reattachExact')),
      mappings: required(list(ref('CommentReattachmentMappingV1'), 1, 256)),
    })
  ),
  PrototypeReporterCommentDispositionV1: union(
    ref('CommentRemovalDispositionV1'),
    object({
      kind: required(schema.literalString('reattachExactToParameterReporter')),
      comments: required(list(ref('CommentRefV1'), 1, 256)),
    })
  ),
  ScriptCopyCommentDispositionV1: union(
    object({ kind: required(schema.literalString('rejectIfPresent')) }),
    object({
      kind: required(schema.literalString('duplicateAll')),
      layout: required(stringEnum(['preserveAbsolute', 'translateWithRoot'])),
    })
  ),
  MovedCommentDispositionV1: object({
    kind: required(schema.literalString('preserveAttached')),
    expectedCommentSetSha256: required(ref('Sha256')),
    layout: required(stringEnum(['preserveAbsolute', 'translateWithRoot'])),
  }),
  OwnedInputReplacementV1: union(
    object({ kind: required(schema.literalString('requireNoOwnedBlock')) }),
    object({
      kind: required(schema.literalString('deleteExactOwnedClosure')),
      expectedClosureSha256: required(ref('Sha256')),
      expectedOwnedBlockCount: required(integer()),
      comments: required(ref('CommentReplacementDispositionV1')),
    })
  ),
  TopLevelWorkspaceV1: object({
    target: required(ref('TargetRefV1')),
    x: required(schema.number({ minimum: -1_000_000, maximum: 1_000_000 })),
    y: required(schema.number({ minimum: -1_000_000, maximum: 1_000_000 })),
  }),
  StatementDestinationV1: union(
    object({
      kind: required(schema.literalString('before')),
      anchor: required(ref('BlockRefV1')),
    }),
    object({
      kind: required(schema.literalString('after')),
      anchor: required(ref('BlockRefV1')),
    }),
    object({
      kind: required(schema.literalString('substack')),
      owner: required(ref('BlockRefV1')),
      inputName: required(schema.string({ minLength: 1, maxLength: 256 })),
      expectedCurrentInputFingerprint: required(ref('Sha256')),
      expectedEmpty: required(schema.literalBoolean(true)),
    }),
    object({
      kind: required(schema.literalString('topLevelStatement')),
      workspace: required(ref('TopLevelWorkspaceV1')),
    })
  ),
  StatementDestinationGoalV1: union(
    object({
      kind: required(schema.literalString('before')),
      anchor: required(ref('BlockRefV1')),
    }),
    object({
      kind: required(schema.literalString('after')),
      anchor: required(ref('BlockRefV1')),
    }),
    object({
      kind: required(schema.literalString('substack')),
      owner: required(ref('BlockRefV1')),
      inputName: required(schema.string({ minLength: 1, maxLength: 256 })),
    }),
    object({
      kind: required(schema.literalString('topLevelStatement')),
      workspace: required(ref('TopLevelWorkspaceV1')),
    })
  ),
  ReporterDestinationV1: union(
    object({
      kind: required(schema.literalString('input')),
      owner: required(ref('BlockRefV1')),
      inputName: required(schema.string({ minLength: 1, maxLength: 256 })),
      expectedCurrentInputFingerprint: required(ref('Sha256')),
      expectedNoOwnedBlock: required(schema.literalBoolean(true)),
    }),
    object({
      kind: required(schema.literalString('procedureArgument')),
      call: required(ref('BlockRefV1')),
      procedure: required(ref('ProcedureRefV1')),
      parameter: required(ref('ParameterRefV1')),
      expectedSignatureSha256: required(ref('Sha256')),
      expectedCurrentInputFingerprint: required(ref('Sha256')),
      expectedNoOwnedBlock: required(schema.literalBoolean(true)),
    }),
    object({
      kind: required(schema.literalString('topLevelExpression')),
      workspace: required(ref('TopLevelWorkspaceV1')),
    })
  ),
  ReporterDestinationGoalV1: union(
    object({
      kind: required(schema.literalString('input')),
      owner: required(ref('BlockRefV1')),
      inputName: required(schema.string({ minLength: 1, maxLength: 256 })),
    }),
    object({
      kind: required(schema.literalString('procedureArgument')),
      call: required(ref('BlockRefV1')),
      procedure: required(ref('ProcedureRefV1')),
      parameter: required(ref('ParameterRefV1')),
    }),
    object({
      kind: required(schema.literalString('topLevelExpression')),
      workspace: required(ref('TopLevelWorkspaceV1')),
    })
  ),
  BlockMoveDestinationGoalV1: union(
    ref('StatementDestinationGoalV1'),
    ref('ReporterDestinationGoalV1')
  ),
  SourceGapDispositionV1: union(
    object({ kind: required(schema.literalString('spliceStatements')) }),
    object({
      kind: required(schema.literalString('revealExistingShadow')),
      expectedCurrentInputFingerprint: required(ref('Sha256')),
      expectedShadowFingerprint: required(ref('Sha256')),
    }),
    object({
      kind: required(schema.literalString('replaceInput')),
      expectedCurrentInputFingerprint: required(ref('Sha256')),
      obscuredShadow: required(
        union(
          object({ kind: required(schema.literalString('requireNone')) }),
          object({
            kind: required(schema.literalString('preserveExact')),
            expectedShadowFingerprint: required(ref('Sha256')),
          })
        )
      ),
      value: required(ref('SemanticInputValueV1')),
    }),
    object({
      kind: required(schema.literalString('removeTopLevelScript')),
      expectedScriptClosureSha256: required(ref('Sha256')),
    })
  ),
  CostumePlacementV1: union(
    object({ kind: required(schema.literalString('derivedImageCenter')) }),
    object({
      kind: required(schema.literalString('explicitCenter')),
      x: required(schema.number({ minimum: -1_000_000, maximum: 1_000_000 })),
      y: required(schema.number({ minimum: -1_000_000, maximum: 1_000_000 })),
    })
  ),
  CostumeReplacementPlacementV1: union(
    object({ kind: required(schema.literalString('preserveExistingCenter')) }),
    ref('CostumePlacementV1')
  ),
  ProcedureSignatureV1: object({
    parts: required(
      list(
        union(
          object({
            kind: required(schema.literalString('label')),
            text: required(ref('AuthoringProcedureFragmentV1')),
          }),
          object({
            kind: required(schema.literalString('parameter')),
            localKey: required(ref('LocalKey')),
            name: required(ref('AuthoringProcedureFragmentV1')),
            parameterType: required(schema.literalString('stringOrNumber')),
            defaultValue: required(ref('ProcedureDefaultStringOrNumberV1')),
          }),
          object({
            kind: required(schema.literalString('parameter')),
            localKey: required(ref('LocalKey')),
            name: required(ref('AuthoringProcedureFragmentV1')),
            parameterType: required(schema.literalString('number')),
            defaultValue: required(ref('ScratchNumberV1')),
          }),
          object({
            kind: required(schema.literalString('parameter')),
            localKey: required(ref('LocalKey')),
            name: required(ref('AuthoringProcedureFragmentV1')),
            parameterType: required(schema.literalString('boolean')),
            defaultValue: required(schema.boolean()),
          })
        ),
        1,
        64
      )
    ),
    warp: required(schema.boolean()),
  }),
  ProcedureParameterLineageV1: object({
    parameterLocalKey: required(ref('LocalKey')),
    lineage: required(
      union(
        object({
          kind: required(schema.literalString('retain')),
          existingParameter: required(ref('ParameterRefV1')),
        }),
        object({ kind: required(schema.literalString('create')) })
      )
    ),
  }),
  ProcedureParameterReporterMappingV1: object({
    existingParameter: required(ref('ParameterRefV1')),
    expectedReporterSetSha256: required(ref('Sha256')),
    disposition: required(
      union(
        object({
          kind: required(schema.literalString('retainMapped')),
          parameterLocalKey: required(ref('LocalKey')),
        }),
        object({
          kind: required(schema.literalString('requireFinalZero')),
          requireFinalReporterCount: required(exactInteger(0)),
        })
      )
    ),
  }),
  ProcedurePrototypeReporterMappingV1: object({
    existingParameter: required(ref('ParameterRefV1')),
    expectedReporterBlockFingerprint: required(ref('Sha256')),
    disposition: required(
      union(
        object({
          kind: required(schema.literalString('preserveExisting')),
          parameterLocalKey: required(ref('LocalKey')),
          expectedCommentSetSha256: required(ref('Sha256')),
        }),
        object({
          kind: required(schema.literalString('replaceForMappedParameter')),
          parameterLocalKey: required(ref('LocalKey')),
          comments: required(ref('PrototypeReporterCommentDispositionV1')),
        }),
        object({
          kind: required(schema.literalString('remove')),
          comments: required(ref('CommentRemovalDispositionV1')),
        })
      )
    ),
  }),
  ProcedureCallArgumentSourceV1: union(
    object({
      kind: required(schema.literalString('preserveParameter')),
      existingParameter: required(ref('ParameterRefV1')),
      expectedInputFingerprint: required(ref('Sha256')),
    }),
    object({
      kind: required(schema.literalString('replaceParameter')),
      existingParameter: required(ref('ParameterRefV1')),
      expectedInputFingerprint: required(ref('Sha256')),
      replacedInput: required(ref('OwnedInputReplacementV1')),
      value: required(ref('SemanticInputValueV1')),
    }),
    object({
      kind: required(schema.literalString('initializeNewParameter')),
      value: required(ref('SemanticInputValueV1')),
    })
  ),
  ProcedureCallMappingV1: object({
    call: required(ref('BlockRefV1')),
    expectedArgumentSetSha256: required(ref('Sha256')),
    arguments: required(
      list(
        object({
          parameterLocalKey: required(ref('LocalKey')),
          source: required(ref('ProcedureCallArgumentSourceV1')),
        }),
        0,
        64
      )
    ),
    removedArguments: required(
      list(
        object({
          existingParameter: required(ref('ParameterRefV1')),
          expectedInputFingerprint: required(ref('Sha256')),
          removedInput: required(ref('OwnedInputReplacementV1')),
        }),
        0,
        64
      )
    ),
  }),
  CostumeSelectionPreconditionV1: union(
    object({
      selectionState: required(
        schema.literalString('uninitializedCreatedTarget')
      ),
      expectedCostumeCount: required(exactInteger(0)),
    }),
    object({
      selectionState: required(schema.literalString('selected')),
      expectedRawCurrentCostume: required(ref('ExistingOptionalNumberV1')),
      expectedEffectiveCurrentCostumeIndex: required(integer()),
      expectedEffectiveCurrentCostume: required(ref('MediaRefV1')),
      expectedEffectiveCurrentCostumeFingerprint: required(ref('Sha256')),
    })
  ),
}

function selectionField(name: string): SchemaNode
{
  if (name.includes('target') || name === 'scope') return ref('TargetRefV1')
  if (name.includes('declaration')) return ref('DeclarationRefV1')
  if (name.includes('script')) return ref('ScriptRefV1')
  if (name === 'expectedBlock') return ref('BlockRefV1')
  if (
    name.includes('block') ||
    name === 'anchor' ||
    name === 'owner' ||
    name === 'call'
  )
    return ref('BlockRefV1')
  if (name.includes('comment')) return ref('CommentRefV1')
  if (name.includes('procedure')) return ref('ProcedureRefV1')
  if (name.includes('parameter')) return ref('ParameterRefV1')
  if (name.includes('media')) return ref('MediaRefV1')
  if (name.includes('asset')) return ref('AssetRefV1')
  throw new Error(`unclassified operation selection field ${name}`)
}

function operationField(kind: OperationKind, name: string): SchemaNode
{
  if (name === 'opId') return ref('OpId')
  if (name === 'kind') return schema.literalString(kind)
  if (name.endsWith('Sha256') || name.includes('Fingerprint'))
    return ref('Sha256')
  if (name === 'requireFinalCostumeCountAtLeast') return exactInteger(1)
  if (name.startsWith('requireFinal') || name.startsWith('requireExisting'))
    return exactInteger(0)
  if (name === 'expectedName') return ref('ExpectedStringIdentityV1')
  if (name === 'name' || name === 'newName') return ref('AuthoringNameV1')
  if (name === 'text') return ref('AuthoringCommentTextV1')
  if (name === 'fieldName' || name === 'inputName')
    return schema.string({ minLength: 1, maxLength: 256 })
  if (
    name === 'visualLayerOrdinal' ||
    name === 'expectedVisualLayerOrdinal' ||
    name === 'newVisualLayerOrdinal'
  )
    return integer(1)
  if (
    name === 'expectedIndex' ||
    name === 'newIndex' ||
    name === 'order' ||
    name === 'expectedCostumeCount' ||
    name === 'expectedFinalCurrentCostumeIndex' ||
    name === 'expectedOwnedBlockCount'
  )
    return integer()
  if (name === 'expectedEmpty' || name === 'expectedDetached')
    return schema.literalBoolean(true)
  if (name === 'expectedCurrentCostume' || name === 'cloud')
    return schema.literalBoolean(false)
  if (name === 'properties') return ref('SpritePropertiesV1')
  if (name === 'edits')
  {
    if (kind === 'target.setSpriteProperties')
      return uniqueList(ref('SpritePropertyEditV1'), 1, 8)
    if (kind === 'target.setStageProperties')
      return uniqueList(ref('StagePropertyEditV1'), 1, 4)
    if (kind === 'comment.move')
      return uniqueList(ref('CommentLayoutEditV1'), 1, 5)
    throw new Error(`unclassified edits field for ${kind}`)
  }
  if (name === 'layout')
  {
    return object({
      x: required(schema.number({ minimum: -1_000_000, maximum: 1_000_000 })),
      y: required(schema.number({ minimum: -1_000_000, maximum: 1_000_000 })),
      width: required(schema.number({ minimum: 0, maximum: 1_000_000 })),
      height: required(schema.number({ minimum: 0, maximum: 1_000_000 })),
      minimized: required(schema.boolean()),
    })
  }
  if (name === 'workspace' || name === 'changes') return ref('WorkspaceV1')
  if (name === 'expected')
    return object({
      x: required(ref('ExistingOptionalNumberV1')),
      y: required(ref('ExistingOptionalNumberV1')),
    })
  if (name === 'nameActivation' || name === 'newNameActivation')
    return ref('ProspectiveNameActivationGuardV1')
  if (
    name === 'expectedListMapState' ||
    name === 'expectedStageBroadcastMapState' ||
    name === 'expectedCommentMapState'
  )
    return ref('OptionalCollectionContainerStateV1')
  if (name === 'expectedFinalCurrentCostumeState')
    return ref('ExistingOptionalNumberV1')
  if (name === 'initialValue' || name === 'newValue')
    return ref('ScratchScalarV1')
  if (name === 'initialItems' || name === 'newItems')
    return list(ref('ScratchScalarV1'), 0, 100_000)
  if (name === 'root') return ref('TopLevelScriptRootV1')
  if (name === 'tree' || name === 'body')
    return ref('SemanticStatementSequenceV1')
  if (name === 'replacement') return ref('SemanticReplacementV1')
  if (name === 'value')
  {
    if (kind === 'block.setField') return ref('SemanticFieldValueV1')
    return ref('SemanticInputValueV1')
  }
  if (name === 'signature') return ref('ProcedureSignatureV1')
  if (name === 'parameterLineage')
    return list(ref('ProcedureParameterLineageV1'), 0, 64)
  if (name === 'prototypeReporters')
    return list(ref('ProcedurePrototypeReporterMappingV1'), 0, 64)
  if (name === 'bodyParameterReporters')
    return list(ref('ProcedureParameterReporterMappingV1'), 0, 512)
  if (name === 'callSites') return list(ref('ProcedureCallMappingV1'), 0, 512)
  if (name === 'placement')
  {
    if (kind === 'media.addCostume') return ref('CostumePlacementV1')
    if (kind === 'media.replaceCostume')
      return ref('CostumeReplacementPlacementV1')
    throw new Error(`unclassified placement field for ${kind}`)
  }
  if (name === 'currentSelection') return ref('CostumeSelectionPreconditionV1')
  if (name === 'exposeClones')
    return list(
      object({
        sourceBlock: required(ref('BlockRefV1')),
        alias: required(ref('LocalKey')),
      }),
      0,
      256
    )
  if (name === 'attachment')
    return union(
      object({ kind: required(schema.literalString('detached')) }),
      object({
        kind: required(schema.literalString('attached')),
        block: required(ref('BlockRefV1')),
      })
    )
  if (name === 'comments')
  {
    if (kind === 'script.duplicate')
      return ref('ScriptCopyCommentDispositionV1')
    if (kind === 'block.replace') return ref('CommentReplacementDispositionV1')
    if (kind === 'block.move') return ref('MovedCommentDispositionV1')
    return ref('CommentRemovalDispositionV1')
  }
  if (name === 'sourceGap') return ref('SourceGapDispositionV1')
  if (name === 'replacedInput') return ref('OwnedInputReplacementV1')
  if (name === 'destination')
    return union(ref('StatementDestinationV1'), ref('ReporterDestinationV1'))
  if (
    [
      'target',
      'scope',
      'declaration',
      'script',
      'block',
      'anchor',
      'owner',
      'comment',
      'procedure',
      'parameter',
      'call',
      'media',
      'asset',
      'expectedBlock',
    ].includes(name)
  )
    return selectionField(name)
  throw new Error(`unclassified ${kind} operation field ${name}`)
}

function operationGoalField(
  kind: OperationKind,
  name: string
): SchemaNode | null
{
  if (name === 'edits')
  {
    if (kind === 'target.setSpriteProperties')
      return uniqueList(ref('SpritePropertyGoalEditV1'), 1, 8)
    if (kind === 'target.setStageProperties')
      return uniqueList(ref('StagePropertyGoalEditV1'), 1, 4)
    if (kind === 'comment.move')
      return uniqueList(ref('CommentLayoutGoalEditV1'), 1, 5)
    throw new Error(`unclassified goal edits field for ${kind}`)
  }
  if (kind === 'block.move' && name === 'destination')
    return ref('BlockMoveDestinationGoalV1')
  if (kind === 'comment.add' && name === 'attachment')
    return operationField(kind, name)
  if (
    name.startsWith('expected') ||
    name.startsWith('require') ||
    name === 'nameActivation' ||
    name === 'newNameActivation' ||
    name === 'currentSelection'
  )
  {
    return null
  }

  if (
    [
      'comments',
      'sourceGap',
      'replacedInput',
      'destination',
      'parameterLineage',
      'prototypeReporters',
      'bodyParameterReporters',
      'callSites',
      'attachment',
    ].includes(name)
  )
  {
    return null
  }
  return operationField(kind, name)
}

function operationTypeSuffix(kind: OperationKind): string
{
  return kind
    .split(/[._-]/u)
    .map((part) => part[0]!.toUpperCase() + part.slice(1))
    .join('')
}

const OPERATION_SCHEMA_DEFINITION_NAMES = Object.fromEntries(
  OPERATION_REVIEW_ROWS.map((row) => [
    row.kind,
    `SemanticEditOperation${operationTypeSuffix(row.kind)}V1`,
  ])
) as Record<OperationKind, string>

const OPERATION_GOAL_SCHEMA_DEFINITION_NAMES = Object.fromEntries(
  OPERATION_REVIEW_ROWS.map((row) => [
    row.kind,
    `SemanticEditOperationGoal${operationTypeSuffix(row.kind)}V1`,
  ])
) as Record<OperationKind, string>

const operationSchemas = OPERATION_REVIEW_ROWS.map((row) =>
{
  const fields: Fields = {}
  for (const field of row.requiredFields)
  {
    fields[field] = required(operationField(row.kind, field))
  }
  for (const field of row.optionalFields)
  {
    fields[field] = optional(operationField(row.kind, field))
  }
  const operationSchema = object(fields)
  DEFINITIONS[OPERATION_SCHEMA_DEFINITION_NAMES[row.kind]] = operationSchema
  return ref(OPERATION_SCHEMA_DEFINITION_NAMES[row.kind])
})

const operationGoalSchemas = OPERATION_REVIEW_ROWS.map((row) =>
{
  const fields: Fields = {}

  for (const field of row.requiredFields)
  {
    const goalField = operationGoalField(row.kind, field)
    if (goalField) fields[field] = required(goalField)
  }

  for (const field of row.optionalFields)
  {
    const goalField = operationGoalField(row.kind, field)
    if (goalField) fields[field] = optional(goalField)
  }

  const goalSchema = object(fields)
  DEFINITIONS[OPERATION_GOAL_SCHEMA_DEFINITION_NAMES[row.kind]] = goalSchema
  return ref(OPERATION_GOAL_SCHEMA_DEFINITION_NAMES[row.kind])
})

DEFINITIONS.SemanticEditOperationV1 = union(...operationSchemas)
DEFINITIONS.SemanticEditOperationGoalV1 = union(...operationGoalSchemas)

DEFINITIONS.SemanticEntityKindV1 = stringEnum(ENTITY_KINDS)
DEFINITIONS.SemanticEntitySubtypeV1 = union(
  ...ENTITY_KINDS.map((entityKind) =>
    object({
      entityKind: required(schema.literalString(entityKind)),
      entitySubtype: required(stringEnum(ENTITY_SUBTYPES[entityKind])),
    })
  )
)
DEFINITIONS.ExistingContractEntityRefV1 = contractEntityRefSchema(
  undefined,
  undefined,
  ['existing']
)
DEFINITIONS.FutureContractEntityRefV1 = contractEntityRefSchema(
  undefined,
  undefined,
  ['future']
)
DEFINITIONS.ContractEntityRefV1 = contractEntityRefSchema()
DEFINITIONS.TargetContractRefV1 = contractEntityRefSchema('target')
DEFINITIONS.SpriteTargetContractRefV1 = contractEntityRefSchema('target', [
  'sprite',
])
DEFINITIONS.DeclarationContractRefV1 = contractEntityRefSchema('declaration')
DEFINITIONS.VariableDeclarationContractRefV1 = contractEntityRefSchema(
  'declaration',
  ['variable']
)
DEFINITIONS.ListDeclarationContractRefV1 = contractEntityRefSchema(
  'declaration',
  ['list']
)
DEFINITIONS.BroadcastDeclarationContractRefV1 = contractEntityRefSchema(
  'declaration',
  ['broadcast']
)
DEFINITIONS.ScriptContractRefV1 = contractEntityRefSchema('script')
DEFINITIONS.BlockContractRefV1 = contractEntityRefSchema('block')
DEFINITIONS.ProcedureContractRefV1 = contractEntityRefSchema('procedure')
DEFINITIONS.CommentContractRefV1 = contractEntityRefSchema('comment')
DEFINITIONS.MediaContractRefV1 = contractEntityRefSchema('media')
DEFINITIONS.CostumeContractRefV1 = contractEntityRefSchema('media', ['costume'])
DEFINITIONS.SoundContractRefV1 = contractEntityRefSchema('media', ['sound'])

const contractBindingSchemas: SchemaNode[] = []

for (const entityKind of ENTITY_KINDS)
{
  for (const entitySubtype of ENTITY_SUBTYPES[entityKind])
  {
    contractBindingSchemas.push(
      existingContractBindingSchema(entityKind, entitySubtype)
    )

    if (
      entityKind !== 'topLevelPrimitive' &&
      !(entityKind === 'target' && entitySubtype === 'stage')
    )
    {
      contractBindingSchemas.push(
        futureContractBindingSchema(entityKind, entitySubtype)
      )
    }
  }
}

DEFINITIONS.ContractEntityBindingV1 = union(...contractBindingSchemas)
DEFINITIONS.SemanticPropertyPathV1 = union(
  semanticPropertyPath('target', [
    'name',
    'x',
    'y',
    'direction',
    'size',
    'visible',
    'draggable',
    'rotationStyle',
    'volume',
    'tempo',
    'videoTransparency',
    'videoState',
    'layerOrder',
    'selectedCostume',
  ]),
  semanticPropertyPath('declaration', ['name', 'initialValue', 'initialItems']),
  semanticPropertyPath('script', ['workspaceX', 'workspaceY']),
  object({
    surface: required(schema.literalString('blockField')),
    descriptorName: required(schema.string({ minLength: 1, maxLength: 256 })),
  }),
  object({
    surface: required(schema.literalString('blockInput')),
    descriptorName: required(schema.string({ minLength: 1, maxLength: 256 })),
  }),
  semanticPropertyPath('comment', [
    'text',
    'attachment',
    'x',
    'y',
    'width',
    'height',
    'minimized',
  ]),
  semanticPropertyPath('procedure', ['signature', 'warp']),
  semanticPropertyPath('media', ['name', 'order', 'payload', 'rotationCenter'])
)
DEFINITIONS.ProjectSemanticPropertyPathV1 = semanticPropertyPath('project', [
  'serializedTargetOrder',
  'runtimeExecutableTargetOrder',
])
DEFINITIONS.SemanticSurfaceV1 = stringEnum(SEMANTIC_SURFACES)
DEFINITIONS.CompatibleSemanticPropertySelectionV1 = union(
  ...COMPATIBLE_PROPERTY_ROWS.slice(0, 6).map((row) =>
    compatiblePropertySelection(
      row.entityKind,
      row.entitySubtypes,
      row.surface,
      row.properties
    )
  ),
  object({
    entity: required(ref('BlockContractRefV1')),
    property: required(
      union(
        object({
          surface: required(schema.literalString('blockField')),
          descriptorName: required(
            schema.string({ minLength: 1, maxLength: 256 })
          ),
        }),
        object({
          surface: required(schema.literalString('blockInput')),
          descriptorName: required(
            schema.string({ minLength: 1, maxLength: 256 })
          ),
        })
      )
    ),
  }),
  ...COMPATIBLE_PROPERTY_ROWS.slice(6).map((row) =>
    compatiblePropertySelection(
      row.entityKind,
      row.entitySubtypes,
      row.surface,
      row.properties
    )
  )
)
DEFINITIONS.StructuralPredicateV1 = union(
  object({
    objectiveId: required(ref('LocalKey')),
    kind: required(schema.literalString('entityExists')),
    candidate: required(ref('ContractEntityRefV1')),
  }),
  object({
    objectiveId: required(ref('LocalKey')),
    kind: required(schema.literalString('entityAbsent')),
    source: required(ref('ExistingContractEntityRefV1')),
  }),
  ...COMPATIBLE_PROPERTY_ROWS.slice(0, 6).map((row) =>
    compatiblePropertyPredicate(
      row.entityKind,
      row.entitySubtypes,
      row.surface,
      row.properties
    )
  ),
  object({
    objectiveId: required(ref('LocalKey')),
    kind: required(schema.literalString('propertyEquals')),
    entity: required(ref('BlockContractRefV1')),
    property: required(
      union(
        object({
          surface: required(schema.literalString('blockField')),
          descriptorName: required(
            schema.string({ minLength: 1, maxLength: 256 })
          ),
        }),
        object({
          surface: required(schema.literalString('blockInput')),
          descriptorName: required(
            schema.string({ minLength: 1, maxLength: 256 })
          ),
        })
      )
    ),
    canonicalValueSha256: required(ref('Sha256')),
  }),
  ...COMPATIBLE_PROPERTY_ROWS.slice(6).map((row) =>
    compatiblePropertyPredicate(
      row.entityKind,
      row.entitySubtypes,
      row.surface,
      row.properties
    )
  ),
  object({
    objectiveId: required(ref('LocalKey')),
    kind: required(schema.literalString('projectPropertyEquals')),
    property: required(ref('ProjectSemanticPropertyPathV1')),
    canonicalValueSha256: required(ref('Sha256')),
  }),
  object({
    objectiveId: required(ref('LocalKey')),
    kind: required(schema.literalString('inputEquals')),
    block: required(ref('BlockContractRefV1')),
    inputName: required(schema.string({ minLength: 1, maxLength: 256 })),
    contractContentFingerprintSha256: required(ref('Sha256')),
  }),
  object({
    objectiveId: required(ref('LocalKey')),
    kind: required(schema.literalString('scriptContains')),
    script: required(ref('ScriptContractRefV1')),
    contractContentFingerprintSha256: required(ref('Sha256')),
    exactCount: required(integer()),
  }),
  object({
    objectiveId: required(ref('LocalKey')),
    kind: required(schema.literalString('procedureEquals')),
    procedure: required(ref('ProcedureContractRefV1')),
    signatureSha256: required(ref('Sha256')),
    contractCallSetContentSha256: required(ref('Sha256')),
  }),
  object({
    objectiveId: required(ref('LocalKey')),
    kind: required(schema.literalString('mediaAttached')),
    media: required(ref('MediaContractRefV1')),
    payloadSha256: required(ref('Sha256')),
    metadataSha256: required(ref('Sha256')),
  }),
  object({
    objectiveId: required(ref('LocalKey')),
    kind: required(schema.literalString('deltaContains')),
    direction: required(stringEnum(['parent-child', 'source-head'])),
    operationKind: required(stringEnum(OPERATION_KINDS)),
    semanticScopeSha256: required(ref('Sha256')),
    semanticChangeFingerprint: required(ref('Sha256')),
  })
)
DEFINITIONS.RuntimeStatePathV1 = union(
  object({
    pathKind: required(schema.literalString('targetProperty')),
    target: required(ref('SpriteTargetContractRefV1')),
    property: required(
      stringEnum([
        'x',
        'y',
        'direction',
        'costume',
        'visible',
        'size',
        'rotationStyle',
        'draggable',
        'volume',
        'effects',
        'bubble',
      ])
    ),
  }),
  object({
    pathKind: required(schema.literalString('declarationValue')),
    declaration: required(ref('VariableDeclarationContractRefV1')),
  }),
  object({
    pathKind: required(schema.literalString('declarationList')),
    declaration: required(ref('ListDeclarationContractRefV1')),
  }),
  object({
    pathKind: required(schema.literalString('stageProperty')),
    property: required(
      stringEnum(['answer', 'timer', 'backdrop', 'tempo', 'videoState'])
    ),
  })
)
DEFINITIONS.ObservedRuntimeNumberV1 = union(
  object({
    numberKind: required(schema.literalString('finite')),
    value: required(schema.number()),
  }),
  ...['negativeZero', 'nan', 'positiveInfinity', 'negativeInfinity'].map(
    (numberKind) =>
      object({
        numberKind: required(schema.literalString(numberKind)),
      })
  )
)
DEFINITIONS.ObservedRuntimeScalarV1 = union(
  object({
    scalarKind: required(schema.literalString('string')),
    value: required(schema.string()),
  }),
  object({
    scalarKind: required(schema.literalString('boolean')),
    value: required(schema.boolean()),
  }),
  object({
    scalarKind: required(schema.literalString('number')),
    value: required(ref('ObservedRuntimeNumberV1')),
  })
)
DEFINITIONS.RuntimeExpectedV1 = union(
  object({
    valueKind: required(schema.literalString('scalar')),
    value: required(ref('ScratchScalarV1')),
  }),
  object({
    valueKind: required(schema.literalString('scalarList')),
    value: required(list(ref('ScratchScalarV1'), 0, 50_000)),
  }),
  object({
    valueKind: required(schema.literalString('canonicalJson')),
    valueSha256: required(ref('Sha256')),
  })
)
DEFINITIONS.RuntimeExecutionLaneV1 = stringEnum(EXECUTION_LANES)
DEFINITIONS.RuntimeVisualEvidenceLaneV1 = stringEnum(VISUAL_EVIDENCE_LANES)
DEFINITIONS.EditScenarioStepV1 = union(
  ...['greenFlag', 'clickStage'].map((action) =>
    object({
      do: required(schema.literalString(action)),
    })
  ),
  object({
    do: required(schema.literalString('wait')),
    ticks: required(integer()),
  }),
  ...['keyDown', 'keyUp', 'pressKey', 'releaseKey'].map((action) =>
    object({
      do: required(schema.literalString(action)),
      key: required(schema.string({ minLength: 1, maxLength: 256 })),
    })
  ),
  object({
    do: required(schema.literalString('tapKey')),
    key: required(schema.string({ minLength: 1, maxLength: 256 })),
    ticks: optional(integer()),
  }),
  object({
    do: required(schema.literalString('clickTarget')),
    target: required(ref('SpriteTargetContractRefV1')),
  }),
  object({
    do: required(schema.literalString('broadcast')),
    broadcast: required(ref('BroadcastDeclarationContractRefV1')),
  }),
  object({
    do: required(schema.literalString('broadcastAndWait')),
    broadcast: required(ref('BroadcastDeclarationContractRefV1')),
    maxTicks: optional(integer()),
  }),
  ...['moveMouse', 'mouseDown', 'mouseUp'].map((action) =>
    object({
      do: required(schema.literalString(action)),
      x: required(schema.number({ minimum: -1_000_000, maximum: 1_000_000 })),
      y: required(schema.number({ minimum: -1_000_000, maximum: 1_000_000 })),
    })
  ),
  object({
    do: required(schema.literalString('typeAnswer')),
    text: required(schema.string({ maxLength: 4096 })),
  }),
  object({
    do: required(schema.literalString('snapshot')),
    label: required(schema.string({ minLength: 1, maxLength: 256 })),
  })
)
DEFINITIONS.EditScenarioPolicyV1 = object({
  scenarioId: required(ref('LocalKey')),
  applicability: required(
    stringEnum(['baselineAndCandidate', 'candidateOnly'])
  ),
  seed: required(integer()),
  fixedDateMs: required(signedInteger()),
  maxTicks: required(integer(0, 600)),
  steps: required(list(ref('EditScenarioStepV1'), 1, 64)),
})
DEFINITIONS.RuntimePredicateV1 = union(
  object({
    objectiveId: required(ref('LocalKey')),
    kind: required(schema.literalString('stateAtLabel')),
    scenarioId: required(ref('LocalKey')),
    lane: required(ref('RuntimeExecutionLaneV1')),
    label: required(schema.string({ minLength: 1, maxLength: 256 })),
    path: required(ref('RuntimeStatePathV1')),
    assertion: required(
      union(
        object({
          comparator: required(schema.literalString('equals')),
          expected: required(ref('RuntimeExpectedV1')),
        }),
        object({
          comparator: required(schema.literalString('within')),
          expected: required(schema.number()),
          tolerance: required(schema.number({ minimum: 0 })),
        })
      )
    ),
  }),
  object({
    objectiveId: required(ref('LocalKey')),
    kind: required(schema.literalString('cloneCountAtTick')),
    scenarioId: required(ref('LocalKey')),
    lane: required(ref('RuntimeExecutionLaneV1')),
    tick: required(integer()),
    target: required(ref('SpriteTargetContractRefV1')),
    exactCount: required(integer()),
  }),
  object({
    objectiveId: required(ref('LocalKey')),
    kind: required(schema.literalString('runtimeOutcome')),
    scenarioId: required(ref('LocalKey')),
    lane: required(ref('RuntimeExecutionLaneV1')),
    ok: required(schema.boolean()),
    exactIssueMultisetSha256: required(ref('Sha256')),
  }),
  object({
    objectiveId: required(ref('LocalKey')),
    kind: required(schema.literalString('visualCriterion')),
    scenarioId: required(ref('LocalKey')),
    lane: required(ref('RuntimeVisualEvidenceLaneV1')),
    evidenceWindow: required(
      union(
        object({
          windowKind: required(schema.literalString('label')),
          label: required(schema.string({ minLength: 1, maxLength: 256 })),
        }),
        object({
          windowKind: required(schema.literalString('tickRange')),
          firstTick: required(integer()),
          lastTick: required(integer()),
        })
      )
    ),
    criterionPolicySha256: required(ref('Sha256')),
    region: optional(
      object({
        x: required(schema.number({ minimum: 0, maximum: 1 })),
        y: required(schema.number({ minimum: 0, maximum: 1 })),
        width: required(schema.number({ minimum: 0, maximum: 1 })),
        height: required(schema.number({ minimum: 0, maximum: 1 })),
      })
    ),
    confidencePolicySha256: required(ref('Sha256')),
  })
)
DEFINITIONS.RetainedPolicyBindingV1 = object({
  bindingId: required(ref('LocalKey')),
  kind: required(
    stringEnum([
      'scenario',
      'runtime',
      'observation',
      'lens',
      'nativeEvidence',
      'visualCriterion',
      'confidence',
    ])
  ),
  schemaVersion: required(integer(1)),
  semanticSha256: required(ref('Sha256')),
  retainedArtifactSha256: required(ref('Sha256')),
})
DEFINITIONS.EntityMoveAllowanceV1 = union(
  object({
    allowanceId: required(ref('LocalKey')),
    kind: required(schema.literalString('entityMove')),
    entity: required(ref('SpriteTargetContractRefV1')),
    collection: required(schema.literalString('visualLayers')),
    beforePositionSha256: required(ref('Sha256')),
    afterPositionSha256: required(ref('Sha256')),
  }),
  object({
    allowanceId: required(ref('LocalKey')),
    kind: required(schema.literalString('entityMove')),
    entity: required(ref('CostumeContractRefV1')),
    collection: required(schema.literalString('costumes')),
    beforePositionSha256: required(ref('Sha256')),
    afterPositionSha256: required(ref('Sha256')),
  }),
  object({
    allowanceId: required(ref('LocalKey')),
    kind: required(schema.literalString('entityMove')),
    entity: required(ref('SoundContractRefV1')),
    collection: required(schema.literalString('sounds')),
    beforePositionSha256: required(ref('Sha256')),
    afterPositionSha256: required(ref('Sha256')),
  }),
  object({
    allowanceId: required(ref('LocalKey')),
    kind: required(schema.literalString('entityMove')),
    entity: required(ref('ScriptContractRefV1')),
    collection: required(schema.literalString('scriptWorkspace')),
    beforePositionSha256: required(ref('Sha256')),
    afterPositionSha256: required(ref('Sha256')),
  }),
  object({
    allowanceId: required(ref('LocalKey')),
    kind: required(schema.literalString('entityMove')),
    entity: required(ref('CommentContractRefV1')),
    collection: required(schema.literalString('commentWorkspace')),
    beforePositionSha256: required(ref('Sha256')),
    afterPositionSha256: required(ref('Sha256')),
  })
)
DEFINITIONS.StructuralAllowanceV1 = union(
  ...COMPATIBLE_PROPERTY_ROWS.slice(0, 6).map((row) =>
    compatiblePropertyAllowance(
      row.entityKind,
      row.entitySubtypes,
      row.surface,
      row.properties
    )
  ),
  object({
    allowanceId: required(ref('LocalKey')),
    kind: required(schema.literalString('propertyTransition')),
    entity: required(ref('BlockContractRefV1')),
    property: required(
      union(
        object({
          surface: required(schema.literalString('blockField')),
          descriptorName: required(
            schema.string({ minLength: 1, maxLength: 256 })
          ),
        }),
        object({
          surface: required(schema.literalString('blockInput')),
          descriptorName: required(
            schema.string({ minLength: 1, maxLength: 256 })
          ),
        })
      )
    ),
    beforeValueSha256: required(ref('Sha256')),
    afterValueSha256: required(ref('Sha256')),
  }),
  ...COMPATIBLE_PROPERTY_ROWS.slice(6).map((row) =>
    compatiblePropertyAllowance(
      row.entityKind,
      row.entitySubtypes,
      row.surface,
      row.properties
    )
  ),
  object({
    allowanceId: required(ref('LocalKey')),
    kind: required(schema.literalString('projectPropertyTransition')),
    property: required(ref('ProjectSemanticPropertyPathV1')),
    beforeValueSha256: required(ref('Sha256')),
    afterValueSha256: required(ref('Sha256')),
  }),
  object({
    allowanceId: required(ref('LocalKey')),
    kind: required(schema.literalString('collectionContainerTransition')),
    owner: required(ref('TargetContractRefV1')),
    collection: required(stringEnum(['lists', 'broadcasts', 'comments'])),
    beforeState: required(ref('OptionalCollectionContainerStateV1')),
    afterState: required(
      object({
        state: required(schema.literalString('present')),
        expectedEntryCount: required(integer()),
        expectedEntrySetSha256: required(ref('Sha256')),
      })
    ),
  }),
  object({
    allowanceId: required(ref('LocalKey')),
    kind: required(schema.literalString('entityAddition')),
    candidate: required(ref('FutureContractEntityRefV1')),
    expectedAddedContentSha256: required(ref('Sha256')),
  }),
  object({
    allowanceId: required(ref('LocalKey')),
    kind: required(schema.literalString('entityRemoval')),
    source: required(ref('ExistingContractEntityRefV1')),
    expectedRemovedContentSha256: required(ref('Sha256')),
  }),
  ref('EntityMoveAllowanceV1'),
  object({
    allowanceId: required(ref('LocalKey')),
    kind: required(schema.literalString('referencePropagation')),
    owner: required(ref('ContractEntityRefV1')),
    beforeReferenceSetSha256: required(ref('Sha256')),
    afterReferenceSetSha256: required(ref('Sha256')),
  }),
  object({
    allowanceId: required(ref('LocalKey')),
    kind: required(schema.literalString('deltaFingerprint')),
    direction: required(stringEnum(['parent-child', 'source-head'])),
    semanticChangeFingerprint: required(ref('Sha256')),
  })
)
DEFINITIONS.ObservationLabelsV1 = union(
  schema.literalString('final'),
  uniqueList(schema.string({ minLength: 1, maxLength: 256 }), 1, 64)
)
DEFINITIONS.StateProjectionMaskV1 = union(
  object({
    maskId: required(ref('LocalKey')),
    maskKind: required(schema.literalString('oneSidedTarget')),
    scenarioId: required(ref('LocalKey')),
    side: required(stringEnum(['baseline', 'candidate'])),
    labels: required(ref('ObservationLabelsV1')),
    target: required(ref('SpriteTargetContractRefV1')),
    expectedTargetMatchesPerObservation: required(exactInteger(1)),
    expectedTargetPaneOrderMatchesPerObservation: required(exactInteger(1)),
    expectedExecutableOrderMatchesPerObservation: required(exactInteger(1)),
  }),
  object({
    maskId: required(ref('LocalKey')),
    maskKind: required(schema.literalString('oneSidedDeclaration')),
    scenarioId: required(ref('LocalKey')),
    side: required(stringEnum(['baseline', 'candidate'])),
    labels: required(ref('ObservationLabelsV1')),
    declaration: required(
      union(
        ref('VariableDeclarationContractRefV1'),
        ref('ListDeclarationContractRefV1')
      )
    ),
    expectedMatchesPerObservation: required(exactInteger(1)),
  }),
  object({
    maskId: required(ref('LocalKey')),
    maskKind: required(schema.literalString('statePath')),
    scenarioId: required(ref('LocalKey')),
    labels: required(ref('ObservationLabelsV1')),
    path: required(ref('RuntimeStatePathV1')),
    expectedMatchesPerObservation: required(exactInteger(1)),
  })
)
DEFINITIONS.CloneProjectionMaskV1 = union(
  object({
    maskId: required(ref('LocalKey')),
    maskKind: required(schema.literalString('oneSidedTargetCloneSeries')),
    scenarioId: required(ref('LocalKey')),
    side: required(stringEnum(['baseline', 'candidate'])),
    target: required(ref('SpriteTargetContractRefV1')),
    expectedTickSetSha256: required(ref('Sha256')),
    expectedCloneCountSeriesSha256: required(ref('Sha256')),
  }),
  object({
    maskId: required(ref('LocalKey')),
    maskKind: required(schema.literalString('targetCloneCountTransition')),
    scenarioId: required(ref('LocalKey')),
    target: required(
      contractEntityRefSchema('target', ['sprite'], ['existing'])
    ),
    expectedTickSetSha256: required(ref('Sha256')),
    expectedBaselineCloneCountSeriesSha256: required(ref('Sha256')),
    expectedCandidateCloneCountSeriesSha256: required(ref('Sha256')),
  })
)
DEFINITIONS.NormalizedRegionV1 = object({
  x: required(schema.number({ minimum: 0, maximum: 1 })),
  y: required(schema.number({ minimum: 0, maximum: 1 })),
  width: required(schema.number({ minimum: Number.MIN_VALUE, maximum: 1 })),
  height: required(schema.number({ minimum: Number.MIN_VALUE, maximum: 1 })),
})
DEFINITIONS.VisualProjectionMaskV1 = union(
  object({
    maskId: required(ref('LocalKey')),
    maskKind: required(schema.literalString('oneSidedTargetGeometrySet')),
    scenarioId: required(ref('LocalKey')),
    side: required(stringEnum(['baseline', 'candidate'])),
    frames: required(
      list(
        object({
          frameId: required(schema.string({ minLength: 1, maxLength: 256 })),
          expectedOriginalMatches: required(exactInteger(1)),
          expectedCloneCount: required(integer()),
          expectedInstanceSetSha256: required(ref('Sha256')),
        }),
        1,
        512
      )
    ),
    target: required(ref('SpriteTargetContractRefV1')),
  }),
  object({
    maskId: required(ref('LocalKey')),
    maskKind: required(schema.literalString('targetGeometryProperty')),
    scenarioId: required(ref('LocalKey')),
    frames: required(
      list(
        object({
          frameId: required(schema.string({ minLength: 1, maxLength: 256 })),
          expectedMatchCount: required(integer()),
          expectedInstanceSetSha256: required(ref('Sha256')),
        }),
        1,
        512
      )
    ),
    target: required(ref('SpriteTargetContractRefV1')),
    property: required(
      stringEnum([
        'targetName',
        'visible',
        'costumeIndex',
        'costumeName',
        'rect',
      ])
    ),
  }),
  object({
    maskId: required(ref('LocalKey')),
    maskKind: required(schema.literalString('pixelRegion')),
    scenarioId: required(ref('LocalKey')),
    frameIds: required(
      uniqueList(schema.string({ minLength: 1, maxLength: 256 }), 1, 512)
    ),
    normalizedRegion: required(ref('NormalizedRegionV1')),
    maxMaskedAreaFraction: required(schema.number({ minimum: 0, maximum: 1 })),
  })
)
DEFINITIONS.PreservationLensV1 = union(
  object({
    lensKind: required(
      stringEnum([
        'finalState',
        'labeledTrace',
        'runtimeOutcome',
        'cloneCounts',
      ])
    ),
    scenarioId: required(ref('LocalKey')),
    lane: required(ref('RuntimeExecutionLaneV1')),
    lensPolicySha256: required(ref('Sha256')),
    required: required(schema.literalBoolean(true)),
    stateMaskIds: optional(uniqueList(ref('LocalKey'), 1, 512)),
    cloneMaskIds: optional(uniqueList(ref('LocalKey'), 1, 512)),
  }),
  object({
    lensKind: required(schema.literalString('visualKeyframes')),
    scenarioId: required(ref('LocalKey')),
    lane: required(schema.literalString('renderedDifferential')),
    lensPolicySha256: required(ref('Sha256')),
    required: required(schema.literalBoolean(true)),
    visualMaskIds: optional(uniqueList(ref('LocalKey'), 1, 512)),
  })
)
DEFINITIONS.LaneRequirementV1 = union(
  ...EVALUATION_LANES.flatMap((lane) => [
    object({
      lane: required(schema.literalString(lane)),
      disposition: required(schema.literalString('required')),
      requiredUnavailableResult: required(
        stringEnum(['unavailable', 'inconclusive'])
      ),
    }),
    object({
      lane: required(schema.literalString(lane)),
      disposition: required(stringEnum(['optional', 'forbidden'])),
    }),
  ])
)
DEFINITIONS.OutputNamePolicyV1 = union(
  object({
    kind: required(schema.literalString('exact')),
    basename: required(schema.string({ minLength: 1, maxLength: 255 })),
  }),
  object({
    kind: required(schema.literalString('boundedStem')),
    requiredPrefix: required(schema.string({ maxLength: 255 })),
    requiredSuffix: required(schema.literalString('.sb3')),
    minStemBytes: required(integer()),
    maxStemBytes: required(integer()),
    alphabet: required(
      schema.literalString('ascii-alnum-space-dot-dash-underscore')
    ),
  })
)
DEFINITIONS.SemanticLocationScopeV1 = union(
  object({ scopeKind: required(schema.literalString('project')) }),
  object({
    scopeKind: required(schema.literalString('exactEntity')),
    entity: required(ref('ContractEntityRefV1')),
  }),
  object({
    scopeKind: required(schema.literalString('targetAndOwnedDescendants')),
    target: required(ref('TargetContractRefV1')),
  }),
  object({
    scopeKind: required(schema.literalString('scriptClosure')),
    script: required(ref('ScriptContractRefV1')),
  }),
  object({
    scopeKind: required(schema.literalString('procedureOwnedClosure')),
    procedure: required(ref('ProcedureContractRefV1')),
  }),
  object({
    scopeKind: required(schema.literalString('mediaCollection')),
    target: required(ref('TargetContractRefV1')),
    mediaKind: required(stringEnum(['costume', 'sound'])),
  })
)
DEFINITIONS.EntityAuthorizationLocationScopeV1 = union(
  object({
    scopeKind: required(schema.literalString('projectEntityCollection')),
    collection: required(stringEnum(['targets', 'broadcasts'])),
  }),
  object({
    scopeKind: required(schema.literalString('exactEntity')),
    entity: required(ref('ContractEntityRefV1')),
  }),
  object({
    scopeKind: required(schema.literalString('targetAndOwnedDescendants')),
    target: required(ref('TargetContractRefV1')),
  }),
  object({
    scopeKind: required(schema.literalString('scriptClosure')),
    script: required(ref('ScriptContractRefV1')),
  }),
  object({
    scopeKind: required(schema.literalString('procedureOwnedClosure')),
    procedure: required(ref('ProcedureContractRefV1')),
  }),
  object({
    scopeKind: required(schema.literalString('mediaCollection')),
    target: required(ref('TargetContractRefV1')),
    mediaKind: required(stringEnum(['costume', 'sound'])),
  })
)
DEFINITIONS.ContractScopeV1 = union(
  ...ENTITY_KINDS.flatMap((entityKind) =>
    ENTITY_SUBTYPES[entityKind].map((entitySubtype) =>
      object({
        scopeSubjectKind: required(schema.literalString('entity')),
        operationKind: required(stringEnum(OPERATION_KINDS)),
        entityKind: required(schema.literalString(entityKind)),
        entitySubtype: required(schema.literalString(entitySubtype)),
        locationScope: required(ref('EntityAuthorizationLocationScopeV1')),
        allowedPropertyPaths: required(
          compatiblePropertyPathList(entityKind, entitySubtype)
        ),
      })
    )
  ),
  object({
    scopeSubjectKind: required(schema.literalString('project')),
    operationKind: required(stringEnum(OPERATION_KINDS)),
    locationScope: required(
      object({
        scopeKind: required(schema.literalString('project')),
      })
    ),
    allowedProjectPropertyPaths: required(
      uniqueList(ref('ProjectSemanticPropertyPathV1'), 0, 2)
    ),
  })
)
DEFINITIONS.EditLimitKeyV1 = stringEnum([
  'activeMatchCandidateLimit',
  'activeScenariosPerEvaluationPlanLimit',
  'artifactBytesPerSessionLimit',
  'evaluationAttemptsPerSessionLimit',
  'impactBudgetLimit',
  'intentBudgetLimit',
  'laneSideScenarioCellsPerEvaluationAttemptLimit',
  'operationsPerBatchLimit',
  'retainedEvidenceBytesPerSessionLimit',
])
DEFINITIONS.EditLimitOverrideV1 = object({
  key: required(ref('EditLimitKeyV1')),
  value: required(integer()),
})
DEFINITIONS.EditEvaluationPlanV1 = object({
  planId: required(ref('LocalKey')),
  planClass: required(stringEnum(['behavioralEdit', 'structuralMetadataOnly'])),
  requiredForExport: required(schema.boolean()),
  scenarioPolicySha256s: required(uniqueList(ref('Sha256'), 1, 16)),
  runtimePolicySha256: required(ref('Sha256')),
  requiredRuntimeChanges: required(list(ref('RuntimePredicateV1'), 0, 2048)),
  preservationLenses: required(list(ref('PreservationLensV1'), 1, 2048)),
  nativeEvidencePolicySha256: optional(ref('Sha256')),
  laneRequirements: required(list(ref('LaneRequirementV1'), 6, 6)),
})
DEFINITIONS.EditSemanticChangeContractV1 = object({
  schemaVersion: required(exactInteger(1)),
  sourceConstraint: required(
    union(
      object({
        kind: required(schema.literalString('exactArtifact')),
        sourceArtifactSha256: required(ref('Sha256')),
      }),
      object({
        kind: required(schema.literalString('template')),
        templateId: required(schema.string({ minLength: 1, maxLength: 256 })),
        version: required(schema.string({ minLength: 1, maxLength: 64 })),
        artifactSha256: required(ref('Sha256')),
      })
    )
  ),
  entityBindings: required(list(ref('ContractEntityBindingV1'), 0, 1024)),
  allowedOperationKinds: required(
    uniqueList(stringEnum(OPERATION_KINDS), 1, OPERATION_KINDS.length)
  ),
  allowedSemanticScopes: required(list(ref('ContractScopeV1'), 1, 2048)),
  requiredStructuralChanges: required(
    list(ref('StructuralPredicateV1'), 1, 2048)
  ),
  allowedStructuralChanges: required(
    list(ref('StructuralAllowanceV1'), 0, 2048)
  ),
  stateProjectionMasks: required(list(ref('StateProjectionMaskV1'), 0, 2048)),
  cloneProjectionMasks: required(list(ref('CloneProjectionMaskV1'), 0, 2048)),
  visualProjectionMasks: required(list(ref('VisualProjectionMaskV1'), 0, 2048)),
  protectedSurfacePolicy: required(
    schema.literalString('phase8-default-deny-v1')
  ),
  unknownFieldPolicy: required(schema.literalString('preserveExact')),
  policyBindings: required(list(ref('RetainedPolicyBindingV1'), 1, 256)),
  evaluationPlans: required(list(ref('EditEvaluationPlanV1'), 1, 64)),
  exportRequiredPlanId: required(ref('LocalKey')),
  outputNamePolicy: required(ref('OutputNamePolicyV1')),
  limitOverrides: required(uniqueList(ref('EditLimitOverrideV1'), 0, 9)),
})
DEFINITIONS.EditContractBindingDisplayEvidenceV1 = object({
  bindingKey: required(ref('LocalKey')),
  boundedLocation: required(ref('BoundedSemanticLocationProjectionV1')),
  fullLocationEvidence: optional(
    object({
      artifactSha256: required(ref('Sha256')),
      byteLength: required(integer()),
      hostLocator: required(ref('BoundedDisplayStringV1')),
    })
  ),
  humanLabel: required(ref('BoundedDisplayStringV1')),
})
DEFINITIONS.EditChangeContractRegistrationProvenanceV1 = object({
  authorityId: required(ref('OpaqueId')),
  registeredAt: required(schema.string({ minLength: 1, maxLength: 64 })),
  hostConfigurationSha256: required(ref('Sha256')),
  provenanceArtifactSha256: required(ref('Sha256')),
})
DEFINITIONS.EditChangeContractRegistrationV1 = object({
  schemaVersion: required(exactInteger(1)),
  registrationId: required(ref('OpaqueId')),
  semanticContract: required(ref('EditSemanticChangeContractHashProjectionV1')),
  semanticContractSha256: required(ref('Sha256')),
  displayObjective: required(ref('BoundedDisplayStringV1')),
  bindingDisplayEvidence: required(
    list(ref('EditContractBindingDisplayEvidenceV1'), 0, 1024)
  ),
  displayEvidenceSha256: required(ref('Sha256')),
  provenance: required(ref('EditChangeContractRegistrationProvenanceV1')),
})

DEFINITIONS.CapabilityAvailabilityV1 = stringEnum([
  'supported',
  'preservationOnly',
  'unsupported',
])
DEFINITIONS.CapabilityVersionSetV1 = object({
  schema: required(integer(1)),
  selector: required(integer(1)),
  fingerprint: required(integer(1)),
  lineage: required(integer(1)),
  allocator: required(integer(1)),
  descriptor: required(integer(1)),
  delta: required(integer(1)),
  preservation: required(integer(1)),
  changeContract: required(integer(1)),
  evaluationCertificate: required(integer(1)),
  manifest: required(integer(1)),
})
DEFINITIONS.CapabilityLimitV1 = object({
  key: required(schema.string({ minLength: 1, maxLength: 128 })),
  defaultValue: required(integer()),
  hardMaximum: required(integer()),
})
DEFINITIONS.CapabilityFamilyAssessmentV1 = object({
  family: required(
    stringEnum([
      'target',
      'declaration',
      'script',
      'block',
      'comment',
      'procedure',
      'media',
      'evaluation',
      'export',
      'replay',
    ])
  ),
  availability: required(ref('CapabilityAvailabilityV1')),
  refusalCodes: required(uniqueList(stringEnum(CLOSED_REFUSAL_CODES), 0, 128)),
  boundedExplanation: required(ref('BoundedDisplayStringV1')),
  affectedSemanticScopeSha256: optional(ref('Sha256')),
})
DEFINITIONS.SemanticEditCapabilityProfileV1 = object({
  schemaVersion: required(exactInteger(1)),
  versions: required(ref('CapabilityVersionSetV1')),
  operationKinds: required(
    uniqueList(
      stringEnum(OPERATION_KINDS),
      OPERATION_KINDS.length,
      OPERATION_KINDS.length
    )
  ),
  resultSlotCatalogSha256: required(ref('Sha256')),
  blockDescriptorProfileSha256: required(ref('Sha256')),
  pinnedScratchRuntimeSourceSha256: required(ref('Sha256')),
  semanticFieldDomainsSha256: required(ref('Sha256')),
  semanticInputDomainsSha256: required(ref('Sha256')),
  referenceDomainsSha256: required(ref('Sha256')),
  safeMutationBuildersSha256: required(ref('Sha256')),
  mediaCapabilityProfileSha256: required(ref('Sha256')),
  selectorKinds: required(
    uniqueList(stringEnum(['handle', 'exactLocation', 'matchSet']), 3, 3)
  ),
  selectorCardinalityPolicySha256: required(ref('Sha256')),
  refusalCodes: required(
    uniqueList(
      stringEnum(CLOSED_REFUSAL_CODES),
      CLOSED_REFUSAL_CODES.length,
      CLOSED_REFUSAL_CODES.length
    )
  ),
  limits: required(list(ref('CapabilityLimitV1'), 1, 256)),
  runtimeCapabilitySha256: required(ref('Sha256')),
  networkPolicy: required(schema.literalString('denied')),
  containmentLimitationsSha256: required(ref('Sha256')),
  exportCapabilitySha256: required(ref('Sha256')),
  replayCapabilitySha256: required(ref('Sha256')),
  semanticSourceSha256: required(ref('Sha256')),
  projectConstraintAssessmentSha256: required(ref('Sha256')),
  unsupportedExtensionsSha256: required(ref('Sha256')),
  unsupportedOpcodesSha256: required(ref('Sha256')),
  unsupportedMediaSha256: required(ref('Sha256')),
  unknownReferenceSurfacesSha256: required(ref('Sha256')),
  familyAssessments: required(list(ref('CapabilityFamilyAssessmentV1'), 1, 64)),
  targetConstraintCollectionSha256: required(ref('Sha256')),
  admissionCompatibilitySha256: required(ref('Sha256')),
  runtimeProfileCompatibilitySha256: required(ref('Sha256')),
})
DEFINITIONS.SemanticEditCapabilityProfileEnvelopeV1 = object({
  profile: required(ref('SemanticEditCapabilityProfileHashProjectionV1')),
  capabilityProfileSha256: required(ref('Sha256')),
})
DEFINITIONS.RunnerAvailabilityV1 = object({
  lane: required(stringEnum(EVALUATION_LANES)),
  availability: required(stringEnum(['available', 'unavailable', 'poisoned'])),
  availabilityEpoch: required(integer()),
  poisonSha256: optional(ref('Sha256')),
})
DEFINITIONS.SemanticEditCapabilitySnapshotHashProjectionV1 = object({
  head: required(ref('ExactRevisionIdentityV1')),
  capabilityProfileSha256: required(ref('Sha256')),
  changeContractSha256: required(ref('Sha256')),
  admittedAssetCollectionVersion: required(integer()),
  policyConfigVersion: required(integer()),
  runnerAvailabilityEpoch: required(integer()),
  diskLowWaterState: required(
    stringEnum(['normal', 'low', 'critical', 'unavailable'])
  ),
})
DEFINITIONS.SemanticEditCapabilitySnapshotV1 = object({
  schemaVersion: required(exactInteger(1)),
  hashProjection: required(
    ref('SemanticEditCapabilitySnapshotHashProjectionV1')
  ),
  collectionEpoch: required(integer()),
  resourceEpoch: required(integer()),
  cursorEpoch: required(integer()),
  casPreconditionSha256: required(ref('Sha256')),
  runnerAvailability: required(list(ref('RunnerAvailabilityV1'), 6, 6)),
  diskCapacityClass: required(
    stringEnum(['normal', 'low', 'critical', 'unavailable'])
  ),
  remainingBudget: required(ref('BudgetProjectionV1')),
  freeByteTelemetryClass: required(
    stringEnum(['ample', 'bounded', 'low', 'unknown'])
  ),
  retentionPolicyVersion: required(integer()),
  retentionPolicySha256: required(ref('Sha256')),
})
DEFINITIONS.SemanticEditCapabilitySnapshotEnvelopeV1 = object({
  snapshot: required(ref('SemanticEditCapabilitySnapshotV1')),
  capabilitySnapshotSha256: required(ref('Sha256')),
})

function exactHeadFields(): Fields
{
  return {
    sessionId: required(ref('OpaqueId')),
    expectedSourceArtifactSha256: required(ref('Sha256')),
    expectedRevisionNumber: required(integer()),
    expectedRevisionId: required(ref('Sha256')),
    expectedCandidateSha256: required(ref('Sha256')),
    expectedAssetManifestSha256: required(ref('Sha256')),
    expectedChangeContractSha256: required(ref('Sha256')),
    expectedCapabilityProfileSha256: required(ref('Sha256')),
  }
}

function planningHeadFields(): Fields
{
  return {
    ...exactHeadFields(),
    expectedCapabilitySnapshotSha256: required(ref('Sha256')),
  }
}

DEFINITIONS.SemanticEditBatchV1 = object({
  schemaVersion: required(exactInteger(1)),
  expected: required(ref('PlanningHeadV1')),
  operations: required(list(ref('SemanticEditOperationV1'), 1, 128)),
})

DEFINITIONS.ExactHeadV1 = object(exactHeadFields())
DEFINITIONS.PlanningHeadV1 = object(planningHeadFields())
DEFINITIONS.PageRequestV1 = object({
  pageSize: optional(integer(1, 50)),
  cursor: optional(ref('OpaqueId')),
})
DEFINITIONS.ProvisionalObligationV1 = object({
  obligationKind: required(
    schema.literalString('firstCostumeForCreatedTarget')
  ),
  creatorOpId: required(ref('OpId')),
  target: required(
    object({
      refKind: required(schema.literalString('created')),
      entityKind: required(schema.literalString('target')),
      opId: required(ref('OpId')),
      slot: required(
        object({
          slotKind: required(schema.literalString('fixed')),
          name: required(schema.literalString('target')),
        })
      ),
    })
  ),
})
DEFINITIONS.ProvisionalObligationSetV1 = object({
  ordered: required(list(ref('ProvisionalObligationV1'), 0, 128)),
  orderedSetSha256: required(ref('Sha256')),
})
function planningChoiceSelectionSchema(
  valueKind: OperationPlanningChoiceValueKind
): SchemaNode
{
  let value: SchemaNode
  switch (valueKind)
  {
    case 'bodyParameterReporterKind':
      value = stringEnum(['retainMapped', 'requireFinalZero'])
      break
    case 'callArgumentKind':
      value = stringEnum([
        'preserveParameter',
        'replaceParameter',
        'initializeNewParameter',
      ])
      break
    case 'commentRemoval':
      value = ref('CommentRemovalDispositionV1')
      break
    case 'commentReplacement':
      value = ref('CommentReplacementDispositionV1')
      break
    case 'localKey':
      value = ref('LocalKey')
      break
    case 'movedCommentLayout':
      value = stringEnum(['preserveAbsolute', 'translateWithRoot'])
      break
    case 'obscuredShadowKind':
      value = stringEnum(['requireNone', 'preserveExact'])
      break
    case 'ownedInputReplacementKind':
      value = stringEnum(['requireNoOwnedBlock', 'deleteExactOwnedClosure'])
      break
    case 'parameterLineageKind':
      value = stringEnum(['retain', 'create'])
      break
    case 'parameterRef':
      value = ref('ParameterRefV1')
      break
    case 'prototypeReporterComment':
      value = ref('PrototypeReporterCommentDispositionV1')
      break
    case 'prototypeReporterKind':
      value = stringEnum([
        'preserveExisting',
        'replaceForMappedParameter',
        'remove',
      ])
      break
    case 'scriptCopyComments':
      value = ref('ScriptCopyCommentDispositionV1')
      break
    case 'semanticInput':
      value = ref('SemanticInputValueV1')
      break
    case 'sourceGapKind':
      value = stringEnum([
        'spliceStatements',
        'revealExistingShadow',
        'replaceInput',
        'removeTopLevelScript',
      ])
      break
  }
  return object({
    choiceKind: required(schema.literalString(valueKind)),
    value: required(value),
  })
}

const choiceValueKinds = [
  ...new Set(
    OPERATION_PLANNING_ROWS.flatMap((row) =>
      row.choiceMappings.map((mapping) => mapping.valueKind)
    )
  ),
]
DEFINITIONS.OperationPlanningChoiceSelectionV1 = union(
  ...choiceValueKinds.map(planningChoiceSelectionSchema)
)
const operationPlanningChoiceSchemas = OPERATION_PLANNING_ROWS.flatMap((row) =>
  row.choiceMappings.map((mapping) =>
    object({
      operationKind: required(schema.literalString(row.operationKind)),
      choiceSlotKey: required(ref('OpaqueId')),
      destination: required(schema.literalString(mapping.destination)),
      selection: required(planningChoiceSelectionSchema(mapping.valueKind)),
    })
  )
)
DEFINITIONS.OperationPlanningChoiceV1 = union(...operationPlanningChoiceSchemas)
DEFINITIONS.OperationPlanningChoiceSlotRowV1 = union(
  ...OPERATION_PLANNING_ROWS.flatMap((row) =>
    row.choiceMappings.map((mapping) =>
      object({
        itemKind: required(schema.literalString('planningChoice')),
        operationKind: required(schema.literalString(row.operationKind)),
        choiceSlotKey: required(ref('OpaqueId')),
        destination: required(schema.literalString(mapping.destination)),
        currentStateSha256: required(ref('Sha256')),
        boundedCurrentState: required(ref('BoundedDisplayStringV1')),
        allowedAlternativeSetSha256: required(ref('Sha256')),
        allowedAlternativeKinds: required(
          uniqueList(
            stringEnum(mapping.allowedAlternativeKinds),
            mapping.allowedAlternativeKinds.length,
            mapping.allowedAlternativeKinds.length
          )
        ),
        evidenceIds: required(list(ref('OpaqueId'), 1, 128)),
      })
    )
  )
)

function planningFactValueSchema(
  valueKind: OperationPlanningFactValueKind,
  destination?: string
): SchemaNode
{
  let value: SchemaNode
  switch (valueKind)
  {
    case 'blockRef':
      value = ref('BlockRefV1')
      break
    case 'boolean':
      value =
        destination === undefined
          ? schema.boolean()
          : destination.endsWith('/expectedCurrentCostume')
            ? schema.literalBoolean(false)
            : schema.literalBoolean(true)
      break
    case 'commentLayoutExpected':
      value = union(
        ref('ExistingNullableOptionalNumberV1'),
        ref('ExistingOptionalNumberV1'),
        ref('ExistingOptionalBooleanV1')
      )
      break
    case 'containerState':
      value = ref('OptionalCollectionContainerStateV1')
      break
    case 'costumeSelection':
      value = ref('CostumeSelectionPreconditionV1')
      break
    case 'existingOptionalNumber':
      value = ref('ExistingOptionalNumberV1')
      break
    case 'integer':
    {
      const leaf = destination?.split('/').at(-1)
      value =
        leaf === 'requireFinalCostumeCountAtLeast'
          ? exactInteger(1)
          : leaf?.startsWith('require')
            ? exactInteger(0)
            : integer()
      break
    }
    case 'localKey':
      value = ref('LocalKey')
      break
    case 'movedCommentKind':
      value = schema.literalString('preserveAttached')
      break
    case 'nameActivation':
      value = ref('ProspectiveNameActivationGuardV1')
      break
    case 'parameterRef':
      value = ref('ParameterRefV1')
      break
    case 'sha256':
      value = ref('Sha256')
      break
    case 'spritePropertyExpected':
      value = union(
        ref('ExistingOptionalNumberV1'),
        ref('ExistingOptionalBooleanV1'),
        ref('ExistingOptionalRotationStyleV1')
      )
      break
    case 'stagePropertyExpected':
      value = union(
        ref('ExistingOptionalNumberV1'),
        ref('ExistingOptionalVideoStateV1')
      )
      break
    case 'stringIdentity':
      value = ref('ExpectedStringIdentityV1')
      break
    case 'workspaceExpected':
      value = object({
        x: required(ref('ExistingOptionalNumberV1')),
        y: required(ref('ExistingOptionalNumberV1')),
      })
      break
  }
  return object({
    valueKind: required(schema.literalString(valueKind)),
    value: required(value),
  })
}

const factValueKinds = [
  ...new Set(
    OPERATION_PLANNING_ROWS.flatMap((row) =>
      row.completedFactMappings.map((mapping) => mapping.valueKind)
    )
  ),
]
DEFINITIONS.OperationPlanningFactValueV1 = union(
  ...factValueKinds.map((valueKind) => planningFactValueSchema(valueKind))
)
DEFINITIONS.OperationPlanningFactRowV1 = union(
  ...OPERATION_PLANNING_ROWS.flatMap((row) =>
    row.completedFactMappings.flatMap((mapping) =>
    {
      const identityFields: Fields = {
        itemKind: required(schema.literalString('planningFact')),
        operationKind: required(schema.literalString(row.operationKind)),
        destination: required(schema.literalString(mapping.destination)),
        evidenceIds: required(list(ref('OpaqueId'), 1, 128)),
      }
      return [
        object({
          ...identityFields,
          availability: required(schema.literalString('available')),
          value: required(
            planningFactValueSchema(mapping.valueKind, mapping.destination)
          ),
        }),
        object({
          ...identityFields,
          availability: required(stringEnum(['unavailable', 'refused'])),
          refusalCode: required(stringEnum(CLOSED_REFUSAL_CODES)),
        }),
      ]
    })
  )
)
DEFINITIONS.OperationPlanningBindingHeadV1 = object({
  sessionId: required(ref('OpaqueId')),
  sourceArtifactSha256: required(ref('Sha256')),
  revisionNumber: required(integer()),
  revisionId: required(ref('Sha256')),
  candidateSha256: required(ref('Sha256')),
  assetManifestSha256: required(ref('Sha256')),
  changeContractSha256: required(ref('Sha256')),
  capabilityProfileSha256: required(ref('Sha256')),
  capabilitySnapshotSha256: required(ref('Sha256')),
  plannedPrefixSha256: required(ref('Sha256')),
  goalSha256: required(ref('Sha256')),
  obligationsBefore: required(ref('ProvisionalObligationSetV1')),
  obligationsAfter: required(ref('ProvisionalObligationSetV1')),
})
DEFINITIONS.OperationPlanningChoiceSetHeaderV1 = object({
  binding: required(ref('OperationPlanningBindingHeadV1')),
  choiceSetSha256: required(ref('Sha256')),
  completedChoiceProjectionSha256: required(ref('Sha256')),
  totalChoiceCount: required(integer()),
  orderedChoiceCollectionSha256: required(ref('Sha256')),
})
DEFINITIONS.OperationPlanningFactsHeaderV1 = object({
  binding: required(ref('OperationPlanningBindingHeadV1')),
  expectedChoiceSetSha256: required(ref('Sha256')),
  completedChoiceProjectionSha256: required(ref('Sha256')),
  planningFactSetSha256: required(ref('Sha256')),
  totalFactCount: required(integer()),
  orderedFactCollectionSha256: required(ref('Sha256')),
})
DEFINITIONS.OperationPlanningQueryV1 = union(
  object({
    kind: required(schema.literalString('operationPlanningFacts')),
    planningStage: required(schema.literalString('enumerateChoices')),
    plannedPrefix: required(list(ref('SemanticEditOperationV1'), 0, 127)),
    goal: required(ref('SemanticEditOperationGoalV1')),
  }),
  object({
    kind: required(schema.literalString('operationPlanningFacts')),
    planningStage: required(schema.literalString('completeChoices')),
    plannedPrefix: required(list(ref('SemanticEditOperationV1'), 0, 127)),
    goal: required(ref('SemanticEditOperationGoalV1')),
    expectedChoiceSetSha256: required(ref('Sha256')),
    choices: required(list(ref('OperationPlanningChoiceV1'), 0, 512)),
  })
)
DEFINITIONS.OperationResultsInspectionQueryV1 = union(
  object({
    kind: required(schema.literalString('operationResults')),
    attemptId: required(ref('OpaqueId')),
  }),
  object({
    kind: required(schema.literalString('operationResults')),
    revisionId: required(ref('Sha256')),
  }),
  object({
    kind: required(schema.literalString('operationResults')),
    attemptId: required(ref('OpaqueId')),
    revisionId: required(ref('Sha256')),
  })
)

const commonInspectionQueryVariants: SchemaNode[] = [
  object({ kind: required(schema.literalString('summary')) }),
  object({
    kind: required(schema.literalString('targets')),
    targetKind: optional(stringEnum(['stage', 'sprite'])),
  }),
  object({
    kind: required(schema.literalString('declarations')),
    declarationKind: optional(stringEnum(['variable', 'list', 'broadcast'])),
    target: optional(ref('StandaloneTargetRefV1')),
  }),
  object({
    kind: required(schema.literalString('scripts')),
    target: optional(ref('StandaloneTargetRefV1')),
  }),
  object({
    kind: required(schema.literalString('blocks')),
    script: optional(ref('StandaloneScriptRefV1')),
    opcode: optional(schema.string({ minLength: 1, maxLength: 256 })),
    ownershipStatus: optional(
      stringEnum(['uniqueOwned', 'unowned', 'multiplyOwned'])
    ),
  }),
  object({
    kind: required(schema.literalString('topLevelPrimitives')),
    target: optional(ref('StandaloneTargetRefV1')),
    primitiveKind: optional(stringEnum(['variableReporter', 'listReporter'])),
  }),
  ...['procedures', 'comments', 'media'].map((kind) =>
    object({
      kind: required(schema.literalString(kind)),
      target: optional(ref('StandaloneTargetRefV1')),
    })
  ),
  object({
    kind: required(schema.literalString('parameters')),
    procedure: optional(ref('StandaloneProcedureRefV1')),
    target: optional(ref('StandaloneTargetRefV1')),
  }),
  object({
    kind: required(schema.literalString('diagnostics')),
    severity: optional(stringEnum(['error', 'warning', 'info'])),
  }),
  ...[
    'capabilities',
    'history',
    'attempts',
    'previews',
    'checkpoints',
    'evaluations',
    'artifacts',
    'exports',
  ].map((kind) => object({ kind: required(schema.literalString(kind)) })),
  object({
    kind: required(schema.literalString('diff')),
    fromRevisionNumber: required(integer()),
    fromRevisionId: required(ref('Sha256')),
    toRevisionNumber: required(integer()),
    toRevisionId: required(ref('Sha256')),
    direction: required(stringEnum(['parent-child', 'source-head'])),
    surface: optional(ref('SemanticSurfaceV1')),
  }),
  ref('OperationResultsInspectionQueryV1'),
]

DEFINITIONS.HistoricalInspectionQueryV1 = union(
  ...commonInspectionQueryVariants
)
DEFINITIONS.CurrentInspectionQueryV1 = union(
  ...commonInspectionQueryVariants,
  ref('OperationPlanningQueryV1')
)
DEFINITIONS.InspectionQueryV1 = ref('CurrentInspectionQueryV1')

function withSchemaVersion(fields: Fields): SchemaNode
{
  return object({ schemaVersion: required(exactInteger(1)), ...fields })
}

function beginRequestFields(includeRequestId: boolean): Fields
{
  return {
    ...(includeRequestId ? { requestId: required(ref('RequestId')) } : {}),
    baseline: required(
      union(
        object({
          kind: required(schema.literalString('projectSession')),
          projectSessionId: required(ref('OpaqueId')),
          expectedSourceArtifactSha256: required(ref('Sha256')),
        }),
        object({
          kind: required(schema.literalString('template')),
          templateId: required(schema.string({ minLength: 1, maxLength: 256 })),
          expectedVersion: required(
            schema.string({ minLength: 1, maxLength: 64 })
          ),
          expectedArtifactSha256: required(ref('Sha256')),
        })
      )
    ),
    changeContractRegistrationId: required(ref('OpaqueId')),
    expectedSemanticContractSha256: required(ref('Sha256')),
  }
}

const TOOL_INPUT_DEFINITION_NAMES: Record<EditToolName, string> = {} as Record<
  EditToolName,
  string
>

function registerToolInput(name: EditToolName, value: SchemaNode): void
{
  const typeName = `${name
    .split('_')
    .map((part) => part[0]!.toUpperCase() + part.slice(1))
    .join('')}RequestV1`
  DEFINITIONS[typeName] = value
  TOOL_INPUT_DEFINITION_NAMES[name] = typeName
}

DEFINITIONS.CapabilityQueryV1 = union(
  object({ kind: required(schema.literalString('summary')) }),
  object({
    kind: required(schema.literalString('operations')),
    operationKinds: optional(
      uniqueList(stringEnum(OPERATION_KINDS), 1, OPERATION_KINDS.length)
    ),
    availability: optional(uniqueList(ref('CapabilityAvailabilityV1'), 1, 3)),
  }),
  object({
    kind: required(schema.literalString('blockDescriptors')),
    opcodePrefix: optional(schema.string({ maxLength: 256 })),
    availability: optional(uniqueList(ref('CapabilityAvailabilityV1'), 1, 3)),
  }),
  ...['selectors', 'limits', 'limitations', 'refusalCodes'].map((kind) =>
    object({ kind: required(schema.literalString(kind)) })
  )
)
registerToolInput(
  'edit_capabilities',
  withSchemaVersion({
    context: optional(
      union(
        object({
          kind: required(schema.literalString('project')),
          projectSessionId: required(ref('OpaqueId')),
          expectedSourceArtifactSha256: required(ref('Sha256')),
        }),
        object({
          kind: required(schema.literalString('edit')),
          sessionId: required(ref('OpaqueId')),
          expectedRevisionId: required(ref('Sha256')),
        })
      )
    ),
    query: required(ref('CapabilityQueryV1')),
    page: optional(ref('PageRequestV1')),
  })
)
registerToolInput('edit_begin', withSchemaVersion(beginRequestFields(true)))
registerToolInput(
  'edit_inspect',
  union(
    withSchemaVersion({
      revisionSelection: required(schema.literalString('currentHead')),
      ...exactHeadFields(),
      issueHandles: optional(schema.literalBoolean(true)),
      query: required(ref('CurrentInspectionQueryV1')),
      page: optional(ref('PageRequestV1')),
    }),
    withSchemaVersion({
      revisionSelection: required(schema.literalString('retainedRevision')),
      sessionId: required(ref('OpaqueId')),
      expectedSourceArtifactSha256: required(ref('Sha256')),
      revisionNumber: required(integer()),
      revisionId: required(ref('Sha256')),
      expectedCandidateSha256: required(ref('Sha256')),
      expectedAssetManifestSha256: required(ref('Sha256')),
      expectedChangeContractSha256: required(ref('Sha256')),
      expectedCapabilityProfileSha256: required(ref('Sha256')),
      issueHandles: required(schema.literalBoolean(false)),
      query: required(ref('HistoricalInspectionQueryV1')),
      page: optional(ref('PageRequestV1')),
    })
  )
)
registerToolInput(
  'edit_asset_admit',
  withSchemaVersion({
    ...planningHeadFields(),
    requestId: required(ref('RequestId')),
    source: required(
      union(
        object({
          kind: required(schema.literalString('inputFile')),
          absolutePath: required(
            schema.string({ minLength: 1, maxLength: 32768 })
          ),
          mediaKind: required(stringEnum(['costume', 'sound'])),
          expectedByteLength: required(integer()),
          expectedPayloadSha256: required(ref('Sha256')),
        }),
        object({
          kind: required(schema.literalString('sourceMedia')),
          media: required(ref('StandaloneMediaRefV1')),
          expectedPayloadSha256: required(ref('Sha256')),
        })
      )
    ),
  })
)
registerToolInput(
  'edit_preview',
  withSchemaVersion({
    sessionId: required(ref('OpaqueId')),
    requestId: required(ref('RequestId')),
    batch: required(ref('SemanticEditBatchV1')),
  })
)
registerToolInput(
  'edit_apply',
  withSchemaVersion({
    ...exactHeadFields(),
    requestId: required(ref('RequestId')),
    previewId: required(ref('OpaqueId')),
    expectedResolvedPlanSha256: required(ref('Sha256')),
    applyGuardSha256: required(ref('Sha256')),
  })
)
registerToolInput(
  'edit_checkpoint',
  withSchemaVersion({
    ...exactHeadFields(),
    requestId: required(ref('RequestId')),
    label: required(schema.string({ minLength: 1, maxLength: 256 })),
    note: optional(schema.string({ maxLength: 4096 })),
  })
)
registerToolInput(
  'edit_undo',
  withSchemaVersion({
    ...exactHeadFields(),
    requestId: required(ref('RequestId')),
    expectedUndoableApplyRevisionId: required(ref('Sha256')),
  })
)
registerToolInput(
  'edit_rollback',
  withSchemaVersion({
    ...exactHeadFields(),
    requestId: required(ref('RequestId')),
    target: required(
      union(
        object({
          kind: required(schema.literalString('revision')),
          revisionNumber: required(integer()),
          revisionId: required(ref('Sha256')),
        }),
        object({
          kind: required(schema.literalString('checkpoint')),
          checkpointId: required(ref('OpaqueId')),
          expectedCheckpointSha256: required(ref('Sha256')),
        })
      )
    ),
  })
)
registerToolInput(
  'edit_evaluate',
  union(
    withSchemaVersion({
      action: required(schema.literalString('start')),
      ...exactHeadFields(),
      requestId: required(ref('RequestId')),
      evaluationPlanId: required(ref('LocalKey')),
    }),
    withSchemaVersion({
      action: required(schema.literalString('finalize')),
      requestId: required(ref('RequestId')),
      sessionId: required(ref('OpaqueId')),
      evaluatedRevision: required(
        object({
          sourceArtifactSha256: required(ref('Sha256')),
          revisionNumber: required(integer()),
          revisionId: required(ref('Sha256')),
          candidateSha256: required(ref('Sha256')),
          assetManifestSha256: required(ref('Sha256')),
          changeContractSha256: required(ref('Sha256')),
          capabilityProfileSha256: required(ref('Sha256')),
        })
      ),
      expectedCurrentHead: required(
        object({
          revisionNumber: required(integer()),
          revisionId: required(ref('Sha256')),
          candidateSha256: required(ref('Sha256')),
        })
      ),
      evaluationId: required(ref('OpaqueId')),
      expectedEvaluationAttemptSha256: required(ref('Sha256')),
    })
  )
)
registerToolInput(
  'edit_status',
  union(
    withSchemaVersion({
      lookup: required(schema.literalString('session')),
      sessionId: required(ref('OpaqueId')),
    }),
    withSchemaVersion({
      lookup: required(schema.literalString('idempotency')),
      toolName: required(stringEnum(STATEFUL_SESSION_TOOL_NAMES)),
      sessionId: required(ref('OpaqueId')),
      requestId: required(ref('RequestId')),
    }),
    withSchemaVersion({
      lookup: required(schema.literalString('idempotency')),
      toolName: required(schema.literalString('edit_begin')),
      requestId: required(ref('RequestId')),
      beginRequest: required(object(beginRequestFields(false))),
    })
  )
)
registerToolInput(
  'edit_export',
  withSchemaVersion({
    ...exactHeadFields(),
    requestId: required(ref('RequestId')),
    certificateSha256: required(ref('Sha256')),
    output: required(
      union(
        object({
          kind: required(schema.literalString('basename')),
          basename: required(ref('OutputBasenameV1')),
        }),
        object({
          kind: required(schema.literalString('reservation')),
          reservationId: required(ref('OpaqueId')),
          expectedReservationSha256: required(ref('Sha256')),
        })
      )
    ),
  })
)
registerToolInput(
  'edit_close',
  withSchemaVersion({
    ...exactHeadFields(),
    requestId: required(ref('RequestId')),
    reason: required(schema.string({ minLength: 1, maxLength: 4096 })),
  })
)

DEFINITIONS.AuditReceiptV1 = object({
  callId: required(ref('OpaqueId')),
  beginSequence: required(integer()),
  beginRecordSha256: required(ref('Sha256')),
  completeSequence: required(integer()),
  completeRecordSha256: required(ref('Sha256')),
})
DEFINITIONS.BudgetProjectionV1 = object({
  intentUsed: required(integer()),
  impactUsed: required(integer()),
  artifactBytesUsed: required(integer()),
  restoreReserveHeld: required(schema.boolean()),
})
DEFINITIONS.HeadProjectionV1 = object({
  sourceArtifactSha256: required(ref('Sha256')),
  revisionNumber: required(integer()),
  revisionId: required(ref('Sha256')),
  candidateSha256: required(ref('Sha256')),
  assetManifestSha256: required(ref('Sha256')),
  changeContractSha256: required(ref('Sha256')),
  capabilityProfileSha256: required(ref('Sha256')),
  capabilitySnapshotSha256: required(ref('Sha256')),
})
DEFINITIONS.ExactResponseHeadV1 = ref('HeadProjectionV1')
DEFINITIONS.ExactRevisionIdentityV1 = object({
  sourceArtifactSha256: required(ref('Sha256')),
  revisionNumber: required(integer()),
  revisionId: required(ref('Sha256')),
  candidateSha256: required(ref('Sha256')),
  assetManifestSha256: required(ref('Sha256')),
  changeContractSha256: required(ref('Sha256')),
  capabilityProfileSha256: required(ref('Sha256')),
})
DEFINITIONS.PriorExactRevisionIdentityV1 = union(
  object({ state: required(schema.literalString('absent')) }),
  object({
    state: required(schema.literalString('present')),
    head: required(ref('ExactRevisionIdentityV1')),
  })
)
DEFINITIONS.PriorResponseHeadV1 = union(
  object({ state: required(schema.literalString('absent')) }),
  object({
    state: required(schema.literalString('present')),
    head: required(ref('ExactResponseHeadV1')),
  })
)
DEFINITIONS.SemanticEventIdentityV1 = object({
  sequence: required(integer()),
  eventSha256: required(ref('Sha256')),
})
DEFINITIONS.SemanticEventCorrelationV1 = union(
  object({ state: required(schema.literalString('absent')) }),
  object({
    state: required(schema.literalString('present')),
    event: required(ref('SemanticEventIdentityV1')),
  })
)
function statefulResponseIdentity(
  preHead: SchemaNode,
  outcomeKind: SchemaNode,
  event: SchemaNode = ref('SemanticEventIdentityV1')
): SchemaNode
{
  return object({
    requestId: required(ref('RequestId')),
    requestSha256: required(ref('Sha256')),
    attemptId: required(ref('OpaqueId')),
    sessionId: required(ref('OpaqueId')),
    preHead: required(preHead),
    postHead: required(ref('ExactResponseHeadV1')),
    outcomeKind: required(outcomeKind),
    event: required(event),
    budget: required(ref('BudgetProjectionV1')),
    evidenceIds: required(uniqueList(ref('OpaqueId'), 0, 128)),
  })
}
DEFINITIONS.BeginStatefulResponseIdentityV1 = statefulResponseIdentity(
  object({ state: required(schema.literalString('absent')) }),
  schema.literalString('completed')
)
DEFINITIONS.CompletedStatefulResponseIdentityV1 = statefulResponseIdentity(
  object({
    state: required(schema.literalString('present')),
    head: required(ref('ExactResponseHeadV1')),
  }),
  schema.literalString('completed')
)
DEFINITIONS.EvaluationStatefulResponseIdentityV1 = statefulResponseIdentity(
  object({
    state: required(schema.literalString('present')),
    head: required(ref('ExactResponseHeadV1')),
  }),
  stringEnum(['completed', 'awaitingExternalEvidence'])
)
DEFINITIONS.AwaitingExternalEvidenceStatefulResponseIdentityV1 =
  statefulResponseIdentity(
    object({
      state: required(schema.literalString('present')),
      head: required(ref('ExactResponseHeadV1')),
    }),
    schema.literalString('awaitingExternalEvidence')
  )
DEFINITIONS.BoundedCollectionV1 = boundedCollection('BoundedItemV1')
DEFINITIONS.CapabilityItemV1 = union(
  object({
    itemKind: required(schema.literalString('operation')),
    operationKind: required(stringEnum(OPERATION_KINDS)),
    availability: required(ref('CapabilityAvailabilityV1')),
    executableGroup: required(stringEnum(['C', 'D', 'E', 'F'])),
    operationContractSha256: required(ref('Sha256')),
    resultSlotContractSha256: required(ref('Sha256')),
    limitationCodes: required(list(stringEnum(CLOSED_REFUSAL_CODES), 0, 32)),
  }),
  object({
    itemKind: required(schema.literalString('blockDescriptor')),
    opcode: required(schema.string({ minLength: 1, maxLength: 256 })),
    category: required(
      stringEnum([
        'motion',
        'looks',
        'event',
        'control',
        'sensing',
        'operators',
        'data',
      ])
    ),
    shape: required(
      stringEnum([
        'stack',
        'reporter',
        'boolean',
        'hat',
        'cap',
        'cShape',
        'menuReporter',
      ])
    ),
    availability: required(ref('CapabilityAvailabilityV1')),
    descriptorSha256: required(ref('Sha256')),
    fieldContractSha256: required(ref('Sha256')),
    inputContractSha256: required(ref('Sha256')),
    limitationCodes: required(list(stringEnum(CLOSED_REFUSAL_CODES), 0, 32)),
  }),
  object({
    itemKind: required(schema.literalString('selector')),
    selectorKind: required(stringEnum(['handle', 'exactLocation', 'matchSet'])),
    entityKind: required(stringEnum(ENTITY_KINDS)),
    availability: required(ref('CapabilityAvailabilityV1')),
    occurrenceSelectionSupported: required(schema.boolean()),
    selectorContractSha256: required(ref('Sha256')),
  }),
  object({
    itemKind: required(schema.literalString('limit')),
    key: required(ref('EditLimitKeyV1')),
    defaultValue: required(integer()),
    hardMaximum: required(integer()),
    effectiveValue: required(integer()),
  }),
  object({
    itemKind: required(schema.literalString('limitation')),
    limitationCode: required(stringEnum(CLOSED_REFUSAL_CODES)),
    availability: required(ref('CapabilityAvailabilityV1')),
    affectedSemanticScopeSha256: required(ref('Sha256')),
    explanation: required(ref('BoundedDisplayStringV1')),
  }),
  object({
    itemKind: required(schema.literalString('refusalCode')),
    code: required(stringEnum(CLOSED_REFUSAL_CODES)),
    callerReachable: required(schema.boolean()),
    toolSetSha256: required(ref('Sha256')),
    stateSetSha256: required(ref('Sha256')),
  })
)
DEFINITIONS.CapabilityCollectionV1 = boundedCollection('CapabilityItemV1')
DEFINITIONS.OperationResultSlotV1 = union(
  ...Object.keys(RESULT_SLOT_ENTITY_KIND).map(operationResultSlotSchema)
)

function acceptedOperationResultSlots(
  fixedResultSlots: readonly string[],
  dynamicResultSlots: readonly string[]
): SchemaNode
{
  const fixedFields = Object.fromEntries(
    fixedResultSlots.map((slotName) => [
      slotName,
      required(operationResultSlotSchema(slotName)),
    ])
  ) as Fields
  const dynamicItems =
    dynamicResultSlots.length === 0
      ? ref('OperationResultSlotV1')
      : union(...dynamicResultSlots.map(operationResultSlotSchema))
  return object({
    fixed: required(object(fixedFields)),
    dynamic: required(
      list(dynamicItems, 0, dynamicResultSlots.length === 0 ? 0 : 512)
    ),
    orderedSlotSetSha256: required(ref('Sha256')),
  })
}

const refusedOperationResultSlots = object({
  fixed: required(object({})),
  dynamic: required(list(ref('OperationResultSlotV1'), 0, 0)),
  orderedSlotSetSha256: required(ref('Sha256')),
})

DEFINITIONS.OperationResultSummaryV1 = union(
  ...OPERATION_REVIEW_ROWS.map((row) =>
  {
    const common: Fields = {
      itemKind: required(schema.literalString('operationResult')),
      opId: required(ref('OpId')),
      operationKind: required(schema.literalString(row.kind)),
      attributedEffectSha256: required(ref('Sha256')),
      attributedEffectCount: required(integer()),
      evidenceIds: required(list(ref('OpaqueId'), 1, 128)),
    }
    return union(
      object({
        ...common,
        outcome: required(schema.literalString('accepted')),
        resultSlots: required(
          acceptedOperationResultSlots(
            row.fixedResultSlots,
            row.dynamicResultSlots
          )
        ),
      }),
      object({
        ...common,
        outcome: required(schema.literalString('refused')),
        refusalCode: required(stringEnum(CLOSED_REFUSAL_CODES)),
        resultSlots: required(refusedOperationResultSlots),
      })
    )
  })
)
DEFINITIONS.OperationResultCollectionV1 = boundedCollection(
  'OperationResultSummaryV1'
)
DEFINITIONS.StructuralSelectorRecipeV1 = union(
  ...ENTITY_KINDS.map(structuralEntityRef)
)
DEFINITIONS.NonEntityBoundedItemV1 = union(
  object({
    itemKind: required(schema.literalString('diff')),
    lineageSha256: required(ref('Sha256')),
    surface: required(ref('SemanticSurfaceV1')),
    semanticPathSha256: required(ref('Sha256')),
    changeKind: required(stringEnum(['add', 'remove', 'change', 'move'])),
    beforeSha256: optional(ref('Sha256')),
    afterSha256: optional(ref('Sha256')),
    attributionSha256: required(ref('Sha256')),
    authorization: required(stringEnum(['required', 'allowed', 'protected'])),
  }),
  ref('OperationResultSummaryV1'),
  ref('OperationPlanningChoiceSlotRowV1'),
  ref('OperationPlanningFactRowV1'),
  object({
    itemKind: required(schema.literalString('record')),
    recordKind: required(
      stringEnum([
        'diagnostic',
        'history',
        'attempt',
        'preview',
        'checkpoint',
        'evaluation',
        'artifact',
        'export',
        'planningChoice',
        'planningFact',
      ])
    ),
    recordId: required(ref('OpaqueId')),
    recordSha256: required(ref('Sha256')),
    status: required(schema.string({ minLength: 1, maxLength: 64 })),
    revisionId: optional(ref('Sha256')),
    evidenceIds: required(list(ref('OpaqueId'), 1, 128)),
  })
)
function inspectionEntityItems(includeHandle: boolean): SchemaNode[]
{
  return ENTITY_KINDS.map((entityKind) =>
    object({
      itemKind: required(schema.literalString('entity')),
      entityKind: required(schema.literalString(entityKind)),
      semanticFingerprint: required(ref('Sha256')),
      contextFingerprint: required(ref('Sha256')),
      location: required(ref(entityLocationProjectionDefinition(entityKind))),
      ...(includeHandle ? { handle: optional(ref('HandleTokenV1')) } : {}),
      structuralSelectorRecipe: optional(structuralEntityRef(entityKind)),
      structuralSelectorUnavailableReason: optional(
        stringEnum([
          'notSupportedForEntityKind',
          'candidateSetTooLarge',
          'projectionTooLarge',
          'ambiguousOccurrenceForbidden',
        ])
      ),
      boundedCountsSha256: required(ref('Sha256')),
      canonicalSummarySha256: required(ref('Sha256')),
      evidenceId: required(ref('OpaqueId')),
    })
  )
}

DEFINITIONS.CurrentInspectionEntityItemV1 = union(
  ...inspectionEntityItems(true)
)
DEFINITIONS.HistoricalInspectionEntityItemV1 = union(
  ...inspectionEntityItems(false)
)
DEFINITIONS.BoundedItemV1 = union(
  ref('CurrentInspectionEntityItemV1'),
  ref('NonEntityBoundedItemV1')
)
DEFINITIONS.HistoricalInspectionItemV1 = union(
  ref('HistoricalInspectionEntityItemV1'),
  ref('NonEntityBoundedItemV1')
)
DEFINITIONS.CurrentInspectionCollectionV1 = boundedCollection('BoundedItemV1')
DEFINITIONS.HistoricalInspectionCollectionV1 = boundedCollection(
  'HistoricalInspectionItemV1'
)
DEFINITIONS.EditInspectSuccessDataV1 = union(
  object({
    evidenceIds: required(uniqueList(ref('OpaqueId'), 0, 128)),
    revisionSelection: required(schema.literalString('currentHead')),
    requestedRevision: required(ref('ExactResponseHeadV1')),
    querySha256: required(ref('Sha256')),
    handlesIssued: required(schema.boolean()),
    collection: required(ref('CurrentInspectionCollectionV1')),
    planningHeader: optional(
      union(
        ref('OperationPlanningChoiceSetHeaderV1'),
        ref('OperationPlanningFactsHeaderV1')
      )
    ),
  }),
  object({
    evidenceIds: required(uniqueList(ref('OpaqueId'), 0, 128)),
    revisionSelection: required(schema.literalString('retainedRevision')),
    requestedRevision: required(ref('ExactRevisionIdentityV1')),
    querySha256: required(ref('Sha256')),
    handlesIssued: required(schema.literalBoolean(false)),
    collection: required(ref('HistoricalInspectionCollectionV1')),
  })
)
DEFINITIONS.IdempotencyNamespaceV1 = object({
  realmSha256: required(ref('Sha256')),
  profileSha256: required(ref('Sha256')),
  principalSha256: required(ref('Sha256')),
  toolName: required(
    stringEnum(['edit_begin', ...STATEFUL_SESSION_TOOL_NAMES])
  ),
  sessionId: optional(ref('OpaqueId')),
  beginNamespaceSha256: optional(ref('Sha256')),
  requestId: required(ref('RequestId')),
  requestSha256: required(ref('Sha256')),
})
DEFINITIONS.AwaitingEvaluationRequiredHostActionV1 = object({
  kind: required(schema.literalString('stageExternalEvidence')),
  evaluationId: required(ref('OpaqueId')),
  requestArtifactIds: required(uniqueList(ref('OpaqueId'), 1, 128)),
  requestSetSha256: required(ref('Sha256')),
  deadlineSha256: required(ref('Sha256')),
  notificationSha256: required(ref('Sha256')),
})
DEFINITIONS.AwaitingEvaluationStatusV1 = object({
  evaluationId: required(ref('OpaqueId')),
  evaluationAttemptSha256: required(ref('Sha256')),
  evaluatedRevision: required(ref('ExactRevisionIdentityV1')),
  requestArtifactIds: required(uniqueList(ref('OpaqueId'), 1, 128)),
  requestSetSha256: required(ref('Sha256')),
  deadlineSha256: required(ref('Sha256')),
  notificationSha256: required(ref('Sha256')),
  requiredHostAction: required(ref('AwaitingEvaluationRequiredHostActionV1')),
})
DEFINITIONS.EditStatusSuccessDataV1 = union(
  object({
    evidenceIds: required(uniqueList(ref('OpaqueId'), 0, 128)),
    lookup: required(schema.literalString('session')),
    sessionId: required(ref('OpaqueId')),
    state: required(
      stringEnum([
        'active',
        'exporting',
        'recovery-required',
        'closed-unexported',
        'closed-exported',
        'closed-abandoned',
        'interrupted',
      ])
    ),
    busyKind: optional(
      stringEnum([
        'assetAdmit',
        'preview',
        'apply',
        'checkpoint',
        'undo',
        'rollback',
        'evaluate',
        'export',
        'close',
        'recovery',
      ])
    ),
    head: required(ref('HeadProjectionV1')),
    capabilityProfileSha256: required(ref('Sha256')),
    capabilitySnapshotSha256: required(ref('Sha256')),
    budget: required(ref('BudgetProjectionV1')),
    latestGateSha256: optional(ref('Sha256')),
    latestEvaluationSha256: optional(ref('Sha256')),
    awaitingEvaluations: required(
      list(ref('AwaitingEvaluationStatusV1'), 0, 16)
    ),
    eventHeadSha256: required(ref('Sha256')),
    auditHeadSha256: required(ref('Sha256')),
    recoveryKind: optional(
      stringEnum([
        'headCommit',
        'prePublicationIntent',
        'publicationCommit',
        'externalInterference',
      ])
    ),
    exportReady: required(schema.boolean()),
    exportLimitationSetSha256: required(ref('Sha256')),
  }),
  object({
    evidenceIds: required(uniqueList(ref('OpaqueId'), 0, 128)),
    lookup: required(schema.literalString('session')),
    sessionId: required(ref('OpaqueId')),
    state: required(stringEnum(['opening', 'failed-infrastructure'])),
    latestGateSha256: optional(ref('Sha256')),
    eventHeadSha256: optional(ref('Sha256')),
    auditHeadSha256: required(ref('Sha256')),
    exportReady: required(schema.literalBoolean(false)),
    exportLimitationSetSha256: required(ref('Sha256')),
  }),
  object({
    evidenceIds: required(uniqueList(ref('OpaqueId'), 0, 128)),
    lookup: required(schema.literalString('idempotency')),
    namespace: required(ref('IdempotencyNamespaceV1')),
    classification: required(schema.literalString('pending')),
    retainedStatusSha256: required(ref('Sha256')),
  }),
  object({
    evidenceIds: required(uniqueList(ref('OpaqueId'), 0, 128)),
    lookup: required(schema.literalString('idempotency')),
    namespace: required(ref('IdempotencyNamespaceV1')),
    classification: required(stringEnum(['completed', 'refused'])),
    sessionId: optional(ref('OpaqueId')),
    retainedOutcomeSha256: required(ref('Sha256')),
  })
)

const TOOL_SUCCESS_DATA_DEFINITION_NAMES: Record<EditToolName, string> =
  {} as Record<EditToolName, string>

DEFINITIONS.RequiredHostActionV1 = union(
  object({ kind: required(schema.literalString('none')) }),
  object({
    kind: required(schema.literalString('stageExternalEvidence')),
    evaluationId: required(ref('OpaqueId')),
    requestArtifactIds: required(uniqueList(ref('OpaqueId'), 1, 64)),
    requestSetSha256: required(ref('Sha256')),
    deadlineSha256: required(ref('Sha256')),
    notificationSha256: required(ref('Sha256')),
  }),
  object({
    kind: required(schema.literalString('configureEvidenceProducer')),
    limitationCode: required(
      stringEnum([
        'edit.pending_external_evidence',
        'edit.evaluation_unavailable',
      ])
    ),
  })
)
DEFINITIONS.EvidenceContentHashCollectionV1 = object({
  collectionSha256: required(ref('Sha256')),
  totalCount: required(integer()),
  hashes: required(uniqueList(ref('Sha256'), 0, 128)),
})

function presentCertificate(status: string): SchemaNode
{
  return object({
    state: required(schema.literalString('present')),
    certificateSha256: required(ref('Sha256')),
    status: required(schema.literalString(status)),
  })
}

const evaluateResultFields: Fields = {
  evaluationId: required(ref('OpaqueId')),
  evaluationAttemptSha256: required(ref('Sha256')),
  evaluatedRevision: required(ref('ExactRevisionIdentityV1')),
  evidenceContent: required(ref('EvidenceContentHashCollectionV1')),
}
const configureEvidenceProducerAction = object({
  kind: required(schema.literalString('configureEvidenceProducer')),
  limitationCode: required(
    stringEnum([
      'edit.pending_external_evidence',
      'edit.evaluation_unavailable',
    ])
  ),
})
DEFINITIONS.EditEvaluateSuccessDataV1 = union(
  ...[
    ['completed', 'passed'],
    ['failed', 'failed'],
    ['inconclusive', 'inconclusive'],
  ].map(([phase, certificateStatus]) =>
    object({
      identity: required(ref('CompletedStatefulResponseIdentityV1')),
      ...evaluateResultFields,
      phase: required(schema.literalString(phase!)),
      requiredHostAction: required(
        object({ kind: required(schema.literalString('none')) })
      ),
      certificate: required(presentCertificate(certificateStatus!)),
    })
  ),
  object({
    identity: required(ref('CompletedStatefulResponseIdentityV1')),
    ...evaluateResultFields,
    phase: required(schema.literalString('unavailable')),
    requiredHostAction: required(
      union(
        object({ kind: required(schema.literalString('none')) }),
        configureEvidenceProducerAction
      )
    ),
    certificate: required(
      union(
        object({ state: required(schema.literalString('absent')) }),
        presentCertificate('unavailable')
      )
    ),
  }),
  object({
    identity: required(
      ref('AwaitingExternalEvidenceStatefulResponseIdentityV1')
    ),
    ...evaluateResultFields,
    phase: required(schema.literalString('awaitingExternalEvidence')),
    requiredHostAction: required(
      object({
        kind: required(schema.literalString('stageExternalEvidence')),
        evaluationId: required(ref('OpaqueId')),
        requestArtifactIds: required(uniqueList(ref('OpaqueId'), 1, 64)),
        requestSetSha256: required(ref('Sha256')),
        deadlineSha256: required(ref('Sha256')),
        notificationSha256: required(ref('Sha256')),
      })
    ),
    certificate: required(
      object({ state: required(schema.literalString('absent')) })
    ),
  })
)

function successDataFields(name: EditToolName): Fields
{
  switch (name)
  {
    case 'edit_capabilities':
      return {
        evidenceIds: required(uniqueList(ref('OpaqueId'), 0, 128)),
        capabilityProfileSha256: required(ref('Sha256')),
        capabilitySnapshotSha256: required(ref('Sha256')),
        collection: required(ref('CapabilityCollectionV1')),
      }
    case 'edit_begin':
      return {
        identity: required(ref('BeginStatefulResponseIdentityV1')),
        semanticSourceSha256: required(ref('Sha256')),
        sourceProvenanceEvidenceSha256: required(ref('Sha256')),
        changeContractSha256: required(ref('Sha256')),
        state: required(schema.literalString('active')),
      }
    case 'edit_inspect':
      return {
        evidenceIds: required(uniqueList(ref('OpaqueId'), 0, 128)),
        requestedRevision: required(ref('ExactRevisionIdentityV1')),
        querySha256: required(ref('Sha256')),
        collection: required(ref('CurrentInspectionCollectionV1')),
      }
    case 'edit_asset_admit':
      return {
        identity: required(ref('CompletedStatefulResponseIdentityV1')),
        assetHandle: required(ref('OpaqueId')),
        payloadSha256: required(ref('Sha256')),
        mediaMetadataSha256: required(ref('Sha256')),
        byteLength: required(integer()),
        format: required(stringEnum(['png', 'wav'])),
        admissionEvidenceId: required(ref('OpaqueId')),
      }
    case 'edit_preview':
      return {
        identity: required(ref('CompletedStatefulResponseIdentityV1')),
        previewId: required(ref('OpaqueId')),
        requestBatchSha256: required(ref('Sha256')),
        resolvedSemanticBatchSha256: required(ref('Sha256')),
        resolvedPlanSha256: required(ref('Sha256')),
        predictedCandidateSha256: required(ref('Sha256')),
        deltaSha256: required(ref('Sha256')),
        preservationSha256: required(ref('Sha256')),
        diagnosticsSha256: required(ref('Sha256')),
        operationCount: required(integer()),
        operationResultCount: required(integer()),
        resultPage: required(ref('OperationResultCollectionV1')),
        applyGuardSha256: required(ref('Sha256')),
      }
    case 'edit_apply':
      return {
        identity: required(ref('CompletedStatefulResponseIdentityV1')),
        revisionSha256: required(ref('Sha256')),
        lineageSha256: required(ref('Sha256')),
        deltaSha256: required(ref('Sha256')),
        preservationSha256: required(ref('Sha256')),
        reportSha256: required(ref('Sha256')),
        preparedEventSha256: required(ref('Sha256')),
        committedEventSha256: required(ref('Sha256')),
        operationResultCount: required(integer()),
        resultPage: required(ref('OperationResultCollectionV1')),
      }
    case 'edit_checkpoint':
      return {
        identity: required(ref('CompletedStatefulResponseIdentityV1')),
        checkpointId: required(ref('OpaqueId')),
        checkpointSha256: required(ref('Sha256')),
      }
    case 'edit_undo':
    case 'edit_rollback':
      return {
        identity: required(ref('CompletedStatefulResponseIdentityV1')),
        restoreSource: required(ref('ExactRevisionIdentityV1')),
        restoreTarget: required(ref('ExactRevisionIdentityV1')),
        restoreDeltaSha256: required(ref('Sha256')),
        reportSha256: required(ref('Sha256')),
        preparedEventSha256: required(ref('Sha256')),
        committedEventSha256: required(ref('Sha256')),
      }
    case 'edit_evaluate':
      return {
        identity: required(ref('EvaluationStatefulResponseIdentityV1')),
        evaluationId: required(ref('OpaqueId')),
        evaluationAttemptSha256: required(ref('Sha256')),
        evaluatedRevision: required(ref('ExactRevisionIdentityV1')),
        phase: required(
          stringEnum([
            'completed',
            'failed',
            'inconclusive',
            'unavailable',
            'awaitingExternalEvidence',
          ])
        ),
        requiredHostAction: required(ref('RequiredHostActionV1')),
        evidenceContent: required(ref('EvidenceContentHashCollectionV1')),
        certificate: required(
          union(
            object({ state: required(schema.literalString('absent')) }),
            object({
              state: required(schema.literalString('present')),
              certificateSha256: required(ref('Sha256')),
              status: required(
                stringEnum(['passed', 'failed', 'inconclusive', 'unavailable'])
              ),
            })
          )
        ),
      }
    case 'edit_status':
      return {
        evidenceIds: required(uniqueList(ref('OpaqueId'), 0, 128)),
        lookup: required(stringEnum(['session', 'idempotency'])),
        classification: required(
          stringEnum(['pending', 'completed', 'refused', 'active', 'terminal'])
        ),
        sessionId: optional(ref('OpaqueId')),
        state: optional(schema.string({ minLength: 1, maxLength: 64 })),
        head: optional(ref('HeadProjectionV1')),
        budget: optional(ref('BudgetProjectionV1')),
        recoveryKind: optional(schema.string({ minLength: 1, maxLength: 64 })),
        exportReady: optional(schema.boolean()),
        retainedOutcomeSha256: optional(ref('Sha256')),
      }
    case 'edit_export':
      return {
        identity: required(ref('CompletedStatefulResponseIdentityV1')),
        terminalState: required(schema.literalString('closed-exported')),
        exportedRevision: required(ref('ExactRevisionIdentityV1')),
        certificateSha256: required(ref('Sha256')),
        outputReservationId: required(ref('OpaqueId')),
        outputReservationSha256: required(ref('Sha256')),
        publishedByteLength: required(integer()),
        publishedSha256: required(ref('Sha256')),
        publicationProofSha256: required(ref('Sha256')),
        publicationEvidenceId: required(ref('OpaqueId')),
        reopenSha256: required(ref('Sha256')),
        sourcePreservationSha256: required(ref('Sha256')),
        reportSha256: required(ref('Sha256')),
        eventSha256: required(ref('Sha256')),
      }
    case 'edit_close':
      return {
        identity: required(ref('CompletedStatefulResponseIdentityV1')),
        terminalState: required(schema.literalString('closed-unexported')),
        finalHead: required(ref('HeadProjectionV1')),
        reportSha256: required(ref('Sha256')),
        eventSha256: required(ref('Sha256')),
        retentionProofSha256: required(ref('Sha256')),
      }
  }
}

const semanticSourceIdentityFields: Fields = {
  schemaVersion: required(exactInteger(1)),
  admissionSchemaVersion: required(exactInteger(1)),
  semanticSourceSchemaVersion: required(exactInteger(1)),
  sourceArtifactSha256: required(ref('Sha256')),
  archiveByteLength: required(integer()),
  projectJsonSha256: required(ref('Sha256')),
  assetManifestSha256: required(ref('Sha256')),
  serializedTargetCollectionSha256: required(ref('Sha256')),
  protectedUnknownContentSha256: required(ref('Sha256')),
  admissionProfileSha256: required(ref('Sha256')),
}
DEFINITIONS.EditSemanticSourceIdentityHashProjectionV1 = union(
  object({
    ...semanticSourceIdentityFields,
    sourceKind: required(schema.literalString('admittedProjectBytes')),
  }),
  object({
    ...semanticSourceIdentityFields,
    sourceKind: required(schema.literalString('registeredTemplate')),
    templateId: required(ref('LocalKey')),
    templateVersion: required(integer(1)),
    templateArtifactSha256: required(ref('Sha256')),
  })
)
DEFINITIONS.SemanticLocationHashProjectionV1 = ref('SemanticLocationV1')
DEFINITIONS.SemanticFingerprintHashProjectionV1 = union(
  object({
    entityKind: required(schema.literalString('target')),
    targetKind: required(stringEnum(['stage', 'sprite'])),
    nameSha256: required(ref('Sha256')),
    knownPropertyStateSha256: required(ref('Sha256')),
    declarationChildFingerprintSha256s: required(list(ref('Sha256'), 0, 4096)),
    scriptChildFingerprintSha256s: required(list(ref('Sha256'), 0, 4096)),
    commentChildFingerprintSha256s: required(list(ref('Sha256'), 0, 4096)),
    mediaChildFingerprintSha256s: required(list(ref('Sha256'), 0, 4096)),
    protectedUnknownFieldSha256: required(ref('Sha256')),
  }),
  object({
    entityKind: required(schema.literalString('declaration')),
    declarationKind: required(stringEnum(['variable', 'list', 'broadcast'])),
    scopeLineageSha256: required(ref('Sha256')),
    nameSha256: required(ref('Sha256')),
    cloudStateSha256: required(ref('Sha256')),
    initialValueSha256: required(ref('Sha256')),
    referenceSetSha256: required(ref('Sha256')),
    monitorReferenceSetSha256: required(ref('Sha256')),
  }),
  object({
    entityKind: required(schema.literalString('script')),
    targetLineageSha256: required(ref('Sha256')),
    rootCategory: required(
      stringEnum(['eventHat', 'statementStack', 'reporter', 'booleanReporter'])
    ),
    workspaceStateSha256: required(ref('Sha256')),
    normalizedScriptClosureSha256: required(ref('Sha256')),
    attachedCommentSetSha256: required(ref('Sha256')),
  }),
  object({
    entityKind: required(schema.literalString('block')),
    ownership: required(stringEnum(['unique', 'unowned', 'multiplyOwned'])),
    targetLineageSha256: required(ref('Sha256')),
    scriptLineageSha256: optional(ref('Sha256')),
    opcode: required(schema.string({ minLength: 1, maxLength: 256 })),
    category: optional(schema.string({ minLength: 1, maxLength: 64 })),
    canonicalKnownStateSha256: optional(ref('Sha256')),
    blockClosureSha256: required(ref('Sha256')),
    ownerCandidateSetSha256: optional(ref('Sha256')),
    opaqueRawSha256: optional(ref('Sha256')),
  }),
  object({
    entityKind: required(schema.literalString('topLevelPrimitive')),
    primitiveKind: required(stringEnum(['variableReporter', 'listReporter'])),
    targetLineageSha256: required(ref('Sha256')),
    declarationResolutionSha256: required(ref('Sha256')),
    rawPrimitiveArraySha256: required(ref('Sha256')),
    workspaceStateSha256: required(ref('Sha256')),
  }),
  object({
    entityKind: required(schema.literalString('procedure')),
    targetLineageSha256: required(ref('Sha256')),
    signatureDefaultsWarpSha256: required(ref('Sha256')),
    definitionPrototypeBodySha256: required(ref('Sha256')),
    externalCallSetSha256: required(ref('Sha256')),
    parameterReferenceSetSha256: required(ref('Sha256')),
  }),
  object({
    entityKind: required(schema.literalString('parameter')),
    procedureLineageSha256: required(ref('Sha256')),
    ordinal: required(integer()),
    nameSha256: required(ref('Sha256')),
    parameterType: required(
      stringEnum(['stringOrNumber', 'number', 'boolean'])
    ),
    defaultStateSha256: required(ref('Sha256')),
  }),
  object({
    entityKind: required(schema.literalString('comment')),
    targetLineageSha256: required(ref('Sha256')),
    attachmentStateSha256: required(ref('Sha256')),
    textSha256: required(ref('Sha256')),
    minimized: required(schema.boolean()),
    layoutStateSha256: required(ref('Sha256')),
  }),
  object({
    entityKind: required(schema.literalString('media')),
    mediaKind: required(stringEnum(['costume', 'sound'])),
    targetLineageSha256: required(ref('Sha256')),
    nameSha256: required(ref('Sha256')),
    orderIndex: required(integer()),
    payloadStateSha256: required(ref('Sha256')),
    parsedMetadataSha256: required(ref('Sha256')),
    preservedRawMetadataSha256: required(ref('Sha256')),
  })
)
DEFINITIONS.SemanticEditCapabilityProfileHashProjectionV1 = ref(
  'SemanticEditCapabilityProfileV1'
)
DEFINITIONS.EditSemanticChangeContractHashProjectionV1 = ref(
  'EditSemanticChangeContractV1'
)
DEFINITIONS.TransportRequestHashProjectionV1 = union(
  ...EDIT_TOOL_NAMES.map((name) =>
    object({
      principalSha256: required(ref('Sha256')),
      realmSha256: required(ref('Sha256')),
      tool: required(schema.literalString(name)),
      request: required(ref(TOOL_INPUT_DEFINITION_NAMES[name])),
    })
  )
)
DEFINITIONS.ResolvedSemanticOperationV1 = object({
  opId: required(ref('OpId')),
  operationKind: required(stringEnum(OPERATION_KINDS)),
  authoredSemanticValueSetSha256: required(ref('Sha256')),
  resolvedReferenceSetSha256: required(ref('Sha256')),
  resolvedAssetSetSha256: required(ref('Sha256')),
  resolvedSelectionSetSha256: required(ref('Sha256')),
  resolvedCreatedReferenceSetSha256: required(ref('Sha256')),
  descriptorVersionSetSha256: required(ref('Sha256')),
  completedPlanningFactSetSha256: required(ref('Sha256')),
})
DEFINITIONS.ResolvedSemanticBatchHashProjectionV1 = object({
  schemaVersion: required(exactInteger(1)),
  expectedRevision: required(ref('ExactRevisionIdentityV1')),
  resolvedOperations: required(
    list(ref('ResolvedSemanticOperationV1'), 1, 128)
  ),
  resultBindingSetSha256: required(ref('Sha256')),
  planningFactSetSha256: required(ref('Sha256')),
})
DEFINITIONS.ResolvedOperationPlanV1 = object({
  opId: required(ref('OpId')),
  operationKind: required(stringEnum(OPERATION_KINDS)),
  resolvedSelectionSetSha256: required(ref('Sha256')),
  descriptorVersionSetSha256: required(ref('Sha256')),
  derivedReadSetSha256: required(ref('Sha256')),
  derivedWriteSetSha256: required(ref('Sha256')),
  derivedDeleteSetSha256: required(ref('Sha256')),
  authorizationProjectionSha256: required(ref('Sha256')),
  allocationProjectionSha256: required(ref('Sha256')),
  predictedResultSlotSetSha256: required(ref('Sha256')),
  derivedConsequenceSetSha256: required(ref('Sha256')),
})
DEFINITIONS.ResolvedPlanHashProjectionV1 = object({
  schemaVersion: required(exactInteger(1)),
  preHead: required(ref('ExactRevisionIdentityV1')),
  resolvedSemanticBatchSha256: required(ref('Sha256')),
  orderedOperationPlans: required(list(ref('ResolvedOperationPlanV1'), 1, 128)),
  allocatorProjectionSha256: required(ref('Sha256')),
  lineageProjectionSha256: required(ref('Sha256')),
  deltaProjectionSha256: required(ref('Sha256')),
  preservationProjectionSha256: required(ref('Sha256')),
  predictedPostHead: required(ref('ExactRevisionIdentityV1')),
})
DEFINITIONS.SemanticLineageHashProjectionV1 = object({
  schemaVersion: required(exactInteger(1)),
  entityKind: required(stringEnum(ENTITY_KINDS)),
  parentLineageSha256: optional(ref('Sha256')),
  creation: required(
    union(
      object({
        kind: required(schema.literalString('source')),
        semanticLocationSha256: required(ref('Sha256')),
        semanticFingerprintSha256: required(ref('Sha256')),
      }),
      object({
        kind: required(schema.literalString('operationResult')),
        creatorOperationKind: required(stringEnum(OPERATION_KINDS)),
        creationRole: required(schema.string({ minLength: 1, maxLength: 64 })),
        semanticParentBindingSha256: required(ref('Sha256')),
        initialSemanticContentSha256: required(ref('Sha256')),
        creationDescriptorSha256: required(ref('Sha256')),
      })
    )
  ),
})
DEFINITIONS.EditAllocatorHashProjectionV1 = object({
  schemaVersion: required(exactInteger(1)),
  sourceCollisionUniverseSha256: required(ref('Sha256')),
  priorAllocatorStateSha256: optional(ref('Sha256')),
  allocationNonce: required(integer()),
  issuedScratchIdSetSha256: required(ref('Sha256')),
  issuedScratchIdCount: required(integer()),
  tombstoneSetSha256: required(ref('Sha256')),
})
DEFINITIONS.EditDeltaHashProjectionV1 = object({
  schemaVersion: required(exactInteger(1)),
  sourceArtifactSha256: required(ref('Sha256')),
  beforeCandidateSha256: required(ref('Sha256')),
  afterCandidateSha256: required(ref('Sha256')),
  semanticLeafSetSha256: required(ref('Sha256')),
  semanticLeafCount: required(integer()),
  protectedLeafSetSha256: required(ref('Sha256')),
  assetDeltaSetSha256: required(ref('Sha256')),
  operationAttributionSha256: required(ref('Sha256')),
})
DEFINITIONS.EditPreservationHashProjectionV1 = object({
  schemaVersion: required(exactInteger(1)),
  sourceArtifactSha256: required(ref('Sha256')),
  beforeCandidateSha256: required(ref('Sha256')),
  afterCandidateSha256: required(ref('Sha256')),
  changeContractSha256: required(ref('Sha256')),
  requiredChangeResultSha256: required(ref('Sha256')),
  allowedChangeResultSha256: required(ref('Sha256')),
  protectedSurfaceResultSha256: required(ref('Sha256')),
  preservationLensResultSha256: required(ref('Sha256')),
  status: required(stringEnum(['passed', 'failed', 'inconclusive'])),
})
DEFINITIONS.EditDiagnosticHashProjectionV1 = object({
  schemaVersion: required(exactInteger(1)),
  sourceArtifactSha256: required(ref('Sha256')),
  revisionNumber: required(integer()),
  diagnosticCode: required(schema.string({ minLength: 1, maxLength: 256 })),
  severity: required(stringEnum(['error', 'warning', 'info'])),
  semanticLocationSha256: optional(ref('Sha256')),
  normalizedPayloadSha256: required(ref('Sha256')),
})
DEFINITIONS.RevisionPredecessorV1 = union(
  object({ state: required(schema.literalString('absent')) }),
  object({
    state: required(schema.literalString('present')),
    revisionNumber: required(integer()),
    revisionId: required(ref('Sha256')),
  })
)
DEFINITIONS.RevisionTransitionAttributionV1 = union(
  object({
    transitionKind: required(schema.literalString('sourceAdmission')),
    semanticSourceSha256: required(ref('Sha256')),
  }),
  object({
    transitionKind: required(schema.literalString('apply')),
    resolvedSemanticBatchSha256: required(ref('Sha256')),
    resolvedPlanSha256: required(ref('Sha256')),
    predecessorHistorySha256: required(ref('Sha256')),
    operationEffectMappingSha256: required(ref('Sha256')),
  }),
  object({
    transitionKind: required(stringEnum(['undo', 'rollback'])),
    restoreCommandSha256: required(ref('Sha256')),
    fromRevision: required(ref('ExactRevisionIdentityV1')),
    selectedRevision: required(ref('ExactRevisionIdentityV1')),
    restoreDeltaAttributionSha256: required(ref('Sha256')),
  })
)
DEFINITIONS.InvocationCorrelationV1 = object({
  boundaryKind: required(stringEnum(['mcp', 'directHost'])),
  invocationSha256: required(ref('Sha256')),
})
DEFINITIONS.EditRevisionHashProjectionV1 = object({
  schemaVersion: required(exactInteger(1)),
  semanticSourceSha256: required(ref('Sha256')),
  revisionNumber: required(integer()),
  predecessor: required(ref('RevisionPredecessorV1')),
  transition: required(ref('RevisionTransitionAttributionV1')),
  candidateSha256: required(ref('Sha256')),
  candidateByteLength: required(integer()),
  projectJsonSha256: required(ref('Sha256')),
  assetManifestSha256: required(ref('Sha256')),
  changeContractSha256: required(ref('Sha256')),
  capabilityProfileSha256: required(ref('Sha256')),
  allocatorReservationStateSha256: required(ref('Sha256')),
  activeLineageSnapshotSha256: required(ref('Sha256')),
  lineageHistoryLedgerSha256: required(ref('Sha256')),
  parentChildDeltaSha256: required(ref('Sha256')),
  sourceHeadDeltaSha256: required(ref('Sha256')),
  preservationSha256: required(ref('Sha256')),
  authorizationSha256: required(ref('Sha256')),
  diagnosticSha256: required(ref('Sha256')),
  cheapGateStatus: required(
    stringEnum(['passed', 'failed', 'inconclusive', 'unavailable'])
  ),
  operationResultSetSha256: required(ref('Sha256')),
  operationResultLineageCorrespondenceSha256: required(ref('Sha256')),
})
DEFINITIONS.EditRevisionV1 = object({
  hashProjection: required(ref('EditRevisionHashProjectionV1')),
  revisionId: required(ref('Sha256')),
  originatingRequestId: required(ref('RequestId')),
  invocationCorrelation: required(ref('InvocationCorrelationV1')),
  hostEvidenceTimestampEpochMs: required(integer()),
})
DEFINITIONS.AcceptedRevisionHistoryEntryV1 = object({
  revisionNumber: required(integer()),
  revisionId: required(ref('Sha256')),
  predecessor: required(ref('RevisionPredecessorV1')),
  transition: required(ref('RevisionTransitionAttributionV1')),
})
DEFINITIONS.RestoreHistoryEdgeV1 = object({
  transitionRevisionId: required(ref('Sha256')),
  restoreKind: required(stringEnum(['undo', 'rollback'])),
  fromRevisionId: required(ref('Sha256')),
  selectedRevisionId: required(ref('Sha256')),
  restoreDelta: required(ref('EditDeltaHashProjectionV1')),
})
DEFINITIONS.EditHistoryHashProjectionV1 = object({
  schemaVersion: required(exactInteger(1)),
  semanticSourceSha256: required(ref('Sha256')),
  orderedRevisions: required(
    list(ref('AcceptedRevisionHistoryEntryV1'), 1, 4096)
  ),
  restoreEdges: required(list(ref('RestoreHistoryEdgeV1'), 0, 4096)),
  head: required(ref('ExactRevisionIdentityV1')),
})
DEFINITIONS.EditEvidenceContentHashProjectionV1 = object({
  schemaVersion: required(exactInteger(1)),
  evidenceKind: required(
    stringEnum([
      'structuredState',
      'runtimeTrace',
      'screenshot',
      'video',
      'visualEvaluation',
      'exportProof',
    ])
  ),
  revision: required(ref('ExactRevisionIdentityV1')),
  lane: optional(stringEnum(EVALUATION_LANES)),
  scenarioId: optional(ref('LocalKey')),
  side: optional(stringEnum(['baseline', 'candidate'])),
  mediaType: required(schema.string({ minLength: 1, maxLength: 256 })),
  byteLength: required(integer()),
  payloadSha256: required(ref('Sha256')),
  identityBindingSha256: required(ref('Sha256')),
})
DEFINITIONS.EvaluationEvidenceSemanticBindingV1 = object({
  evidenceKind: required(
    stringEnum([
      'projectCheck',
      'projectPreflight',
      'runtimeTrace',
      'screenshot',
      'video',
      'nativeAgent',
    ])
  ),
  lane: required(stringEnum(EVALUATION_LANES)),
  contentSha256: required(ref('Sha256')),
  requestSha256: required(ref('Sha256')),
  resultSha256: required(ref('Sha256')),
})
DEFINITIONS.EditEvaluationCertificateHashProjectionV1 = object({
  schemaVersion: required(exactInteger(1)),
  semanticSourceSha256: required(ref('Sha256')),
  evaluatedRevision: required(ref('ExactRevisionIdentityV1')),
  evaluatedCandidateByteLength: required(integer()),
  projectJsonSha256: required(ref('Sha256')),
  historySha256: required(ref('Sha256')),
  evaluationPlanId: required(ref('LocalKey')),
  evaluationPlanSha256: required(ref('Sha256')),
  changeContractSha256: required(ref('Sha256')),
  status: required(
    stringEnum(['passed', 'failed', 'inconclusive', 'unavailable'])
  ),
  requiredChangeResultSha256: required(ref('Sha256')),
  allowedChangeResultSha256: required(ref('Sha256')),
  preservationResultSha256: required(ref('Sha256')),
  scenarioSetSha256: required(ref('Sha256')),
  seedSetSha256: required(ref('Sha256')),
  fixedTimePolicySha256: required(ref('Sha256')),
  observationPlanSetSha256: required(ref('Sha256')),
  rubricSetSha256: required(ref('Sha256')),
  lensPolicySetSha256: required(ref('Sha256')),
  vmIdentitySha256: required(ref('Sha256')),
  browserIdentitySha256: required(ref('Sha256')),
  runtimeIdentitySha256: required(ref('Sha256')),
  pinnedScratchIdentitySha256: required(ref('Sha256')),
  buildIdentitySha256: required(ref('Sha256')),
  executableIdentitySha256: required(ref('Sha256')),
  evidence: required(list(ref('EvaluationEvidenceSemanticBindingV1'), 0, 128)),
  limitationSetSha256: required(ref('Sha256')),
  gateDispositionSetSha256: required(ref('Sha256')),
})
DEFINITIONS.EditEvaluationCertificateV1 = object({
  hashProjection: required(ref('EditEvaluationCertificateHashProjectionV1')),
  certificateSha256: required(ref('Sha256')),
})
DEFINITIONS.EditSemanticEventHashProjectionV1 = object({
  schemaVersion: required(exactInteger(1)),
  sessionId: required(ref('OpaqueId')),
  sequence: required(integer()),
  previousEventSha256: optional(ref('Sha256')),
  eventKind: required(
    stringEnum([
      'session-begun',
      'asset-admitted',
      'preview-recorded',
      'checkpoint-recorded',
      'transition-prepared',
      'transition-committed',
      'transition-aborted',
      'evaluation-recorded',
      'export-prepared',
      'export-committed',
      'session-closed',
    ])
  ),
  preHead: required(ref('PriorExactRevisionIdentityV1')),
  postHead: required(ref('ExactRevisionIdentityV1')),
  invocationCorrelation: required(ref('InvocationCorrelationV1')),
  semanticPayloadSha256: required(ref('Sha256')),
})
DEFINITIONS.EditSemanticReportHashProjectionV1 = object({
  schemaVersion: required(exactInteger(1)),
  semanticSourceSha256: required(ref('Sha256')),
  finalHead: required(ref('ExactRevisionIdentityV1')),
  changeContractSha256: required(ref('Sha256')),
  capabilityProfileSha256: required(ref('Sha256')),
  historySha256: required(ref('Sha256')),
  revisionSetSha256: required(ref('Sha256')),
  deltaSetSha256: required(ref('Sha256')),
  certificateSetSha256: required(ref('Sha256')),
  exportProjectionSha256: optional(ref('Sha256')),
})
DEFINITIONS.EditReportProvenanceV1 = object({
  semanticReportProjectionSha256: required(ref('Sha256')),
  reportArtifactSha256: required(ref('Sha256')),
  eventHeadSha256: required(ref('Sha256')),
  auditHeadSha256: optional(ref('Sha256')),
  hostEvidenceSetSha256: required(ref('Sha256')),
})
DEFINITIONS.AuditPrincipalIdentityV1 = union(
  object({ state: required(schema.literalString('unavailable')) }),
  object({
    state: required(schema.literalString('authenticated')),
    principalSha256: required(ref('Sha256')),
  })
)
DEFINITIONS.AuditPriorRecordV1 = union(
  object({ state: required(schema.literalString('genesis')) }),
  object({
    state: required(schema.literalString('present')),
    recordSha256: required(ref('Sha256')),
  })
)
DEFINITIONS.AuditSessionBindingV1 = union(
  object({ state: required(schema.literalString('absent')) }),
  object({
    state: required(schema.literalString('present')),
    sessionId: required(ref('OpaqueId')),
  })
)
DEFINITIONS.AuditExpectedHeadV1 = union(
  object({ state: required(schema.literalString('absent')) }),
  object({
    state: required(schema.literalString('present')),
    head: required(ref('ExactResponseHeadV1')),
  })
)
DEFINITIONS.AuditIdempotencyBindingV1 = union(
  object({ state: required(schema.literalString('absent')) }),
  object({
    state: required(schema.literalString('present')),
    namespaceSha256: required(ref('Sha256')),
    requestIdSha256: required(ref('Sha256')),
  })
)
function nonToolServerAuditBoundaryVariants(): SchemaNode[]
{
  return [
    object({
      boundaryKind: required(schema.literalString('resource-list')),
    }),
    object({
      boundaryKind: required(schema.literalString('resource-read')),
      requestedUriSha256: required(ref('Sha256')),
    }),
    object({
      boundaryKind: required(schema.literalString('protocol')),
      protocolKind: required(
        stringEnum([
          'raw-frame-rejected',
          'invalid-utf8',
          'invalid-json',
          'invalid-json-rpc',
          'unknown-method',
          'forbidden-method',
          'schema-rejected',
          'tools-list',
          'admission-refused',
        ])
      ),
    }),
    object({
      boundaryKind: required(schema.literalString('server-close')),
    }),
  ]
}

DEFINITIONS.ServerAuditBoundaryV1 = union(
  object({
    boundaryKind: required(schema.literalString('tool')),
    tool: required(stringEnum([...PROJECT_TOOL_NAMES, ...EDIT_TOOL_NAMES])),
  }),
  ...nonToolServerAuditBoundaryVariants()
)
DEFINITIONS.NonToolServerAuditBoundaryV1 = union(
  ...nonToolServerAuditBoundaryVariants()
)
DEFINITIONS.AuditHeadObservationV1 = union(
  object({ state: required(schema.literalString('unavailable')) }),
  object({
    state: required(schema.literalString('observed')),
    head: required(ref('ExactResponseHeadV1')),
  })
)
DEFINITIONS.AuditSemanticEventCorrelationV1 = union(
  object({ state: required(schema.literalString('absent')) }),
  object({
    state: required(schema.literalString('present')),
    event: required(ref('SemanticEventIdentityV1')),
  })
)
const auditRecordIdentityFields: Fields = {
  schemaVersion: required(exactInteger(1)),
  serverInstanceId: required(ref('OpaqueId')),
  principal: required(ref('AuditPrincipalIdentityV1')),
  sequence: required(integer()),
  previousRecord: required(ref('AuditPriorRecordV1')),
  callId: required(ref('OpaqueId')),
  boundary: required(ref('ServerAuditBoundaryV1')),
}
function terminalAuditRecord(
  phase: 'call-complete' | 'call-rejected'
): SchemaNode
{
  return object({
    ...auditRecordIdentityFields,
    phase: required(schema.literalString(phase)),
    beginSequence: required(integer()),
    beginRecordSha256: required(ref('Sha256')),
    resultSha256: required(ref('Sha256')),
    preHead: required(ref('AuditHeadObservationV1')),
    postHead: required(ref('AuditHeadObservationV1')),
    completedWallClockEpochMs: required(integer()),
    durationMonotonicMs: required(integer()),
    evidenceIds: required(uniqueList(ref('OpaqueId'), 0, 128)),
    semanticEvent: required(ref('AuditSemanticEventCorrelationV1')),
  })
}

DEFINITIONS.ServerAuditRecordHashProjectionV1 = union(
  object({
    ...auditRecordIdentityFields,
    phase: required(schema.literalString('call-begin')),
    schemaProfileSha256: required(ref('Sha256')),
    policySha256: required(ref('Sha256')),
    redactedArgumentSha256: required(ref('Sha256')),
    fullInputSha256: required(ref('Sha256')),
    inputByteLength: required(integer()),
    session: required(ref('AuditSessionBindingV1')),
    expectedHead: required(ref('AuditExpectedHeadV1')),
    idempotency: required(ref('AuditIdempotencyBindingV1')),
    startedWallClockEpochMs: required(integer()),
    startedMonotonicMs: required(integer()),
  }),
  ...(['call-complete', 'call-rejected'] as const).map(terminalAuditRecord)
)
DEFINITIONS.ProjectToolReceiptFreeOutcomeHashProjectionV1 = object({
  outcomeKind: required(schema.literalString('projectTool')),
  tool: required(stringEnum(PROJECT_TOOL_NAMES)),
  outputSchemaSha256: required(ref('Sha256')),
  canonicalOutputSha256: required(ref('Sha256')),
  outputByteLength: required(integer()),
  isError: required(schema.boolean()),
})
DEFINITIONS.NonToolReceiptFreeOutcomeHashProjectionV1 = object({
  outcomeKind: required(schema.literalString('nonToolBoundary')),
  boundary: required(ref('NonToolServerAuditBoundaryV1')),
  disposition: required(
    stringEnum(['completed', 'refused', 'malformed', 'closed'])
  ),
  outcomeCode: required(schema.string({ minLength: 1, maxLength: 256 })),
  canonicalOutcomeSha256: required(ref('Sha256')),
  outcomeByteLength: required(integer()),
  evidenceIds: required(uniqueList(ref('OpaqueId'), 0, 128)),
})
DEFINITIONS.ServerAuditHashProjectionV1 = union(
  object({
    projectionKind: required(schema.literalString('editReceiptFreeOutcome')),
    outcome: required(ref('EditToolReceiptFreeResultV1')),
  }),
  object({
    projectionKind: required(schema.literalString('projectReceiptFreeOutcome')),
    outcome: required(ref('ProjectToolReceiptFreeOutcomeHashProjectionV1')),
  }),
  object({
    projectionKind: required(
      schema.literalString('boundaryReceiptFreeOutcome')
    ),
    outcome: required(ref('NonToolReceiptFreeOutcomeHashProjectionV1')),
  }),
  object({
    projectionKind: required(schema.literalString('auditRecord')),
    record: required(ref('ServerAuditRecordHashProjectionV1')),
  })
)

export const HASH_PROJECTION_DEFINITION_NAMES = {
  'semantic-source': 'EditSemanticSourceIdentityHashProjectionV1',
  'semantic-location': 'SemanticLocationHashProjectionV1',
  'semantic-fingerprint': 'SemanticFingerprintHashProjectionV1',
  'capability-profile': 'SemanticEditCapabilityProfileHashProjectionV1',
  'capability-snapshot': 'SemanticEditCapabilitySnapshotHashProjectionV1',
  'change-contract': 'EditSemanticChangeContractHashProjectionV1',
  'scenario-policy': 'EditScenarioPolicyV1',
  'transport-request': 'TransportRequestHashProjectionV1',
  'resolved-semantic-batch': 'ResolvedSemanticBatchHashProjectionV1',
  'resolved-plan': 'ResolvedPlanHashProjectionV1',
  lineage: 'SemanticLineageHashProjectionV1',
  allocator: 'EditAllocatorHashProjectionV1',
  delta: 'EditDeltaHashProjectionV1',
  preservation: 'EditPreservationHashProjectionV1',
  diagnostic: 'EditDiagnosticHashProjectionV1',
  revision: 'EditRevisionHashProjectionV1',
  history: 'EditHistoryHashProjectionV1',
  'evidence-content': 'EditEvidenceContentHashProjectionV1',
  certificate: 'EditEvaluationCertificateHashProjectionV1',
  'semantic-event': 'EditSemanticEventHashProjectionV1',
  'semantic-report-projection': 'EditSemanticReportHashProjectionV1',
  'server-audit': 'ServerAuditHashProjectionV1',
} as const satisfies Record<(typeof SEMANTIC_HASH_DOMAINS)[number], string>

const REFUSAL_CONTEXT_FIELD_SCHEMAS: Readonly<
  Record<RefusalContextField, SchemaNode>
> = {
  expectedRevisionId: ref('Sha256'),
  currentRevisionId: ref('Sha256'),
  expectedCandidateSha256: ref('Sha256'),
  currentCandidateSha256: ref('Sha256'),
  opId: ref('OpId'),
  semanticSurface: ref('SemanticSurfaceV1'),
  matchCount: integer(),
  limit: integer(),
  observed: integer(),
  evidenceId: ref('OpaqueId'),
}

function refusalContextSchema(
  contextFields: readonly RefusalContextField[]
): SchemaNode
{
  return object(
    Object.fromEntries(
      contextFields.map((field) => [
        field,
        required(REFUSAL_CONTEXT_FIELD_SCHEMAS[field]),
      ])
    )
  )
}

const uniqueRefusalContextFields = [
  ...new Map(
    REFUSAL_REVIEW_ROWS.map((row) => [
      [...row.contextFields].sort().join(','),
      row.contextFields,
    ])
  ).values(),
]
DEFINITIONS.RefusalContextV1 = union(
  ...uniqueRefusalContextFields.map(refusalContextSchema)
)

DEFINITIONS.RefusedStatefulResponseIdentityV1 = statefulResponseIdentity(
  object({
    state: required(schema.literalString('present')),
    head: required(ref('ExactResponseHeadV1')),
  }),
  schema.literalString('refused'),
  ref('SemanticEventCorrelationV1')
)
DEFINITIONS.OpeningRefusalIdentityV1 = union(
  object({
    requestId: required(ref('RequestId')),
    requestSha256: required(ref('Sha256')),
    attemptId: required(ref('OpaqueId')),
    session: required(
      object({
        state: required(schema.literalString('absent')),
        beginNamespaceSha256: required(ref('Sha256')),
      })
    ),
    preHead: required(
      object({ state: required(schema.literalString('absent')) })
    ),
    postHead: required(
      object({ state: required(schema.literalString('absent')) })
    ),
    outcomeKind: required(schema.literalString('refused')),
    registryAttemptSha256: required(ref('Sha256')),
    budget: required(ref('BudgetProjectionV1')),
    evidenceIds: required(uniqueList(ref('OpaqueId'), 0, 128)),
  }),
  object({
    requestId: required(ref('RequestId')),
    requestSha256: required(ref('Sha256')),
    attemptId: required(ref('OpaqueId')),
    session: required(
      object({
        state: required(schema.literalString('present')),
        sessionId: required(ref('OpaqueId')),
      })
    ),
    preHead: required(
      object({ state: required(schema.literalString('absent')) })
    ),
    postHead: required(
      object({
        state: required(schema.literalString('present')),
        head: required(ref('ExactResponseHeadV1')),
      })
    ),
    outcomeKind: required(schema.literalString('refused')),
    event: required(ref('SemanticEventIdentityV1')),
    budget: required(ref('BudgetProjectionV1')),
    evidenceIds: required(uniqueList(ref('OpaqueId'), 0, 128)),
  })
)

const REFUSAL_ERROR_DEFINITION_NAMES = Object.fromEntries(
  REFUSAL_REVIEW_ROWS.map((row) => [
    row.code,
    `RefusalError${row.code
      .split(/[._-]/u)
      .map((part) => part[0]!.toUpperCase() + part.slice(1))
      .join('')}V1`,
  ])
) as Record<(typeof REFUSAL_CODES)[number], string>

for (const row of REFUSAL_REVIEW_ROWS)
{
  DEFINITIONS[REFUSAL_ERROR_DEFINITION_NAMES[row.code]] = object({
    code: required(schema.literalString(row.code)),
    safeMessage: required(schema.string({ minLength: 1, maxLength: 4096 })),
    context: required(refusalContextSchema(row.contextFields)),
  })
}

type RefusalIdentityMode = 'boundary' | 'opening' | 'retained'

function refusalIdentityModes(
  name: EditToolName,
  states: readonly string[]
): readonly RefusalIdentityMode[]
{
  if (!STATEFUL_EDIT_TOOL_NAMES.includes(name as never)) return ['boundary']
  const anyState = states.includes('any')
  const modes: RefusalIdentityMode[] = []
  if (anyState || states.includes('request-boundary')) modes.push('boundary')
  if (anyState || states.some((state) => state !== 'request-boundary'))
  {
    modes.push(name === 'edit_begin' ? 'opening' : 'retained')
  }
  return modes
}

function refusalEnvelopeVariant(
  name: EditToolName,
  errorSchemas: readonly SchemaNode[],
  mode: RefusalIdentityMode,
  includeAudit: boolean
): SchemaNode
{
  const fields: Fields = {
    schemaVersion: required(exactInteger(1)),
    ok: required(schema.literalBoolean(false)),
    tool: required(schema.literalString(name)),
    error: required(union(...errorSchemas)),
  }
  if (includeAudit) fields.audit = required(ref('AuditReceiptV1'))
  if (mode === 'boundary')
  {
    fields.requestId = optional(ref('RequestId'))
    fields.attemptId = optional(ref('OpaqueId'))
  }
  else
  {
    fields.identity = required(
      ref(
        mode === 'opening'
          ? 'OpeningRefusalIdentityV1'
          : 'RefusedStatefulResponseIdentityV1'
      )
    )
  }
  return object(fields)
}

function groupedRefusalErrorSchemas(
  rows: readonly (typeof REFUSAL_REVIEW_ROWS)[number][]
): SchemaNode[]
{
  const groups = new Map<
    string,
    readonly (typeof REFUSAL_REVIEW_ROWS)[number][]
  >()
  for (const row of rows)
  {
    const key = [...row.contextFields].sort().join(',')
    groups.set(key, [...(groups.get(key) ?? []), row])
  }
  return [...groups.values()].map((group) =>
    object({
      code: required(stringEnum(group.map((row) => row.code))),
      safeMessage: required(schema.string({ minLength: 1, maxLength: 4096 })),
      context: required(refusalContextSchema(group[0]!.contextFields)),
    })
  )
}

const TOOL_OUTPUT_DEFINITION_NAMES: Record<EditToolName, string> = {} as Record<
  EditToolName,
  string
>
const TOOL_RECEIPT_FREE_DEFINITION_NAMES: Record<EditToolName, string> =
  {} as Record<EditToolName, string>

for (const name of EDIT_TOOL_NAMES)
{
  const prefix = name
    .split('_')
    .map((part) => part[0]!.toUpperCase() + part.slice(1))
    .join('')
  const dataName = `${prefix}SuccessDataV1`
  const errorName = `${prefix}RefusalErrorV1`
  const receiptFreeName = `${prefix}ReceiptFreeResultV1`
  const outputName = `${prefix}ResultV1`
  if (
    name !== 'edit_inspect' &&
    name !== 'edit_status' &&
    name !== 'edit_evaluate'
  )
  {
    DEFINITIONS[dataName] = object(successDataFields(name))
  }
  TOOL_SUCCESS_DATA_DEFINITION_NAMES[name] = dataName
  const toolRefusalRows = REFUSAL_REVIEW_ROWS.filter(
    (row) => row.tools.includes(name) && row.wireDisposition === 'tool-refusal'
  )
  DEFINITIONS[errorName] = union(...groupedRefusalErrorSchemas(toolRefusalRows))
  const receiptFreeSuccess = object({
    schemaVersion: required(exactInteger(1)),
    ok: required(schema.literalBoolean(true)),
    tool: required(schema.literalString(name)),
    data: required(ref(dataName)),
  })
  const refusalRowsByMode = new Map<
    RefusalIdentityMode,
    typeof toolRefusalRows
  >()
  for (const row of toolRefusalRows)
  {
    for (const mode of refusalIdentityModes(name, row.states))
    {
      const rows = refusalRowsByMode.get(mode) ?? []
      rows.push(row)
      refusalRowsByMode.set(mode, rows)
    }
  }
  const receiptFreeRefusals = [...refusalRowsByMode].map(([mode, rows]) =>
    refusalEnvelopeVariant(name, groupedRefusalErrorSchemas(rows), mode, false)
  )
  DEFINITIONS[receiptFreeName] = union(
    receiptFreeSuccess,
    ...receiptFreeRefusals
  )
  TOOL_RECEIPT_FREE_DEFINITION_NAMES[name] = receiptFreeName
  const success = object({
    schemaVersion: required(exactInteger(1)),
    ok: required(schema.literalBoolean(true)),
    tool: required(schema.literalString(name)),
    audit: required(ref('AuditReceiptV1')),
    data: required(ref(dataName)),
  })
  const refusalResults = [...refusalRowsByMode].map(([mode, rows]) =>
    refusalEnvelopeVariant(name, groupedRefusalErrorSchemas(rows), mode, true)
  )
  DEFINITIONS[outputName] = union(success, ...refusalResults)
  TOOL_OUTPUT_DEFINITION_NAMES[name] = outputName
}

DEFINITIONS.EditToolRequestV1 = union(
  ...EDIT_TOOL_NAMES.map((name) => ref(TOOL_INPUT_DEFINITION_NAMES[name]))
)
DEFINITIONS.EditToolResultV1 = union(
  ...EDIT_TOOL_NAMES.map((name) => ref(TOOL_OUTPUT_DEFINITION_NAMES[name]))
)
DEFINITIONS.EditToolReceiptFreeResultV1 = union(
  ...EDIT_TOOL_NAMES.map((name) =>
    ref(TOOL_RECEIPT_FREE_DEFINITION_NAMES[name])
  )
)
DEFINITIONS.EditToolReceiptFreeOutcomeHashProjectionV1 = ref(
  'EditToolReceiptFreeResultV1'
)
DEFINITIONS.Phase8ReviewContractV1 = object({
  artifactResourceUri: required(ref('ScratchEditArtifactResourceUriV1')),
  artifactResourceToken: required(ref('ResourceTokenV1')),
  artifactResourceMacInput: required(ref('ScratchEditResourceMacInputV1')),
  semanticBatch: required(ref('SemanticEditBatchV1')),
  semanticChangeContract: required(ref('EditSemanticChangeContractV1')),
  changeContractRegistration: required(ref('EditChangeContractRegistrationV1')),
  capabilityProfile: required(ref('SemanticEditCapabilityProfileEnvelopeV1')),
  capabilitySnapshot: required(ref('SemanticEditCapabilitySnapshotEnvelopeV1')),
  observedRuntimeScalar: required(ref('ObservedRuntimeScalarV1')),
  toolRequest: required(ref('EditToolRequestV1')),
  receiptFreeToolResult: required(ref('EditToolReceiptFreeResultV1')),
  toolResult: required(ref('EditToolResultV1')),
})

export const PHASE8_CONTRACT_MODEL = defineSchemaModel({
  root: ref('Phase8ReviewContractV1'),
  definitions: DEFINITIONS as SchemaDefinitions,
})

const SCHEMA_MODEL_VIEW_CACHE = new Map<string, SchemaModel>()

// every runtime view shares the one normalized immutable definition graph;
// only its frozen root ref differs
function schemaModelViewV1(name: string): SchemaModel
{
  if (!Object.hasOwn(PHASE8_CONTRACT_MODEL.definitions, name))
    throw new Error(`unknown Phase 8 contract definition ${name}`)
  const cached = SCHEMA_MODEL_VIEW_CACHE.get(name)
  if (cached !== undefined) return cached
  const model: SchemaModel = Object.freeze({
    schemaVersion: 1,
    root: ref(name),
    definitions: PHASE8_CONTRACT_MODEL.definitions,
  })
  SCHEMA_MODEL_VIEW_CACHE.set(name, model)
  return model
}

export function toolInputSchemaModel(name: EditToolName): SchemaModel
{
  return schemaModelViewV1(TOOL_INPUT_DEFINITION_NAMES[name])
}

export function toolOutputSchemaModel(name: EditToolName): SchemaModel
{
  return schemaModelViewV1(TOOL_OUTPUT_DEFINITION_NAMES[name])
}

export function toolReceiptFreeResultSchemaModel(
  name: EditToolName
): SchemaModel
{
  return schemaModelViewV1(TOOL_RECEIPT_FREE_DEFINITION_NAMES[name])
}

export function refusalErrorSchemaModel(code: RefusalCode): SchemaModel
{
  return schemaModelViewV1(REFUSAL_ERROR_DEFINITION_NAMES[code])
}

export function contractDefinitionSchemaModel(name: string): SchemaModel
{
  return schemaModelViewV1(name)
}

export function hashProjectionSchemaModel(
  domain: (typeof SEMANTIC_HASH_DOMAINS)[number]
): SchemaModel
{
  return schemaModelViewV1(HASH_PROJECTION_DEFINITION_NAMES[domain])
}

export function operationSchemaModel(kind: OperationKind): SchemaModel
{
  return schemaModelViewV1(OPERATION_SCHEMA_DEFINITION_NAMES[kind])
}

export function operationGoalSchemaModel(kind: OperationKind): SchemaModel
{
  return schemaModelViewV1(OPERATION_GOAL_SCHEMA_DEFINITION_NAMES[kind])
}

export function contractDefinitionNames(): string[]
{
  return Object.keys(PHASE8_CONTRACT_MODEL.definitions).sort()
}

export function operationSchemaKinds(): OperationKind[]
{
  return [...OPERATION_KINDS]
}
