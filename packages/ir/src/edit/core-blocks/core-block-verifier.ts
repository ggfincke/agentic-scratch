// packages/ir/src/edit/core-blocks/core-block-verifier.ts
// cross-check the curated catalog against independent pinned parity rows

import { VANILLA_CORE_DESCRIPTORS } from '../contracts/catalog.js'
import {
  APPROVED_CURATED_CORE_DESCRIPTOR_PROFILE_SHA256,
  CURATED_CORE_BLOCK_CATALOG_EVIDENCE_V1,
} from './core-block-catalog.js'
import { curatedBuilderDescriptorCoverageV1 } from './core-block-builder.js'
import { semanticHashV1 } from '../contracts/hash-domains.js'
import { deepFreeze } from '../support/immutable.js'

interface CuratedCoreParityRowV1
{
  readonly opcode: string
  readonly category: string
  readonly shape: string
  readonly placements: string
  readonly owners: string
  readonly successor: boolean
  readonly terminal: boolean
  readonly fields: string
  readonly inputs: string
  readonly refs: string
  readonly availability: string
  readonly builder: string
}

export const PINNED_CURATED_CORE_PARITY_ROWS_V1 = deepFreeze([
  {
    opcode: 'event_whenflagclicked',
    category: 'event',
    shape: 'hat',
    placements: 'eventScriptHat',
    owners: 'stage,sprite',
    successor: true,
    terminal: false,
    fields: '',
    inputs: '',
    refs: '',
    availability: 'supported',
    builder: 'ordinaryBlock',
  },
  {
    opcode: 'event_whenbroadcastreceived',
    category: 'event',
    shape: 'hat',
    placements: 'eventScriptHat',
    owners: 'stage,sprite',
    successor: true,
    terminal: false,
    fields: 'BROADCAST_OPTION:broadcast:broadcast',
    inputs: '',
    refs: 'broadcast',
    availability: 'supported',
    builder: 'ordinaryBlock',
  },
  {
    opcode: 'event_broadcast',
    category: 'event',
    shape: 'stack',
    placements: 'topLevelStatement,statementSequence',
    owners: 'stage,sprite',
    successor: true,
    terminal: false,
    fields: '',
    inputs: '!BROADCAST_INPUT:entityMenu:entityMenu:11:broadcast:broadcast',
    refs: 'broadcast',
    availability: 'supported',
    builder: 'ordinaryBlock',
  },
  {
    opcode: 'event_broadcast_menu',
    category: 'event',
    shape: 'menuReporter',
    placements: 'menuShadow',
    owners: 'stage,sprite',
    successor: false,
    terminal: false,
    fields: 'BROADCAST_OPTION:broadcast:broadcast',
    inputs: '',
    refs: 'broadcast',
    availability: 'builderOnly',
    builder: 'referenceMenuShadow',
  },
  {
    opcode: 'motion_gotoxy',
    category: 'motion',
    shape: 'stack',
    placements: 'topLevelStatement,statementSequence',
    owners: 'sprite',
    successor: true,
    terminal: false,
    fields: '',
    inputs: '!X:number:primitive:4:null:null,!Y:number:primitive:4:null:null',
    refs: '',
    availability: 'supported',
    builder: 'ordinaryBlock',
  },
  {
    opcode: 'motion_xposition',
    category: 'motion',
    shape: 'reporter',
    placements: 'topLevelExpression,reporterInput',
    owners: 'sprite',
    successor: false,
    terminal: false,
    fields: '',
    inputs: '',
    refs: '',
    availability: 'supported',
    builder: 'ordinaryBlock',
  },
  {
    opcode: 'looks_show',
    category: 'looks',
    shape: 'stack',
    placements: 'topLevelStatement,statementSequence',
    owners: 'sprite',
    successor: true,
    terminal: false,
    fields: '',
    inputs: '',
    refs: '',
    availability: 'supported',
    builder: 'ordinaryBlock',
  },
  {
    opcode: 'looks_say',
    category: 'looks',
    shape: 'stack',
    placements: 'topLevelStatement,statementSequence',
    owners: 'sprite',
    successor: true,
    terminal: false,
    fields: '',
    inputs: '!MESSAGE:stringOrNumber:primitive:10:null:null',
    refs: '',
    availability: 'supported',
    builder: 'ordinaryBlock',
  },
  {
    opcode: 'data_setvariableto',
    category: 'data',
    shape: 'stack',
    placements: 'topLevelStatement,statementSequence',
    owners: 'stage,sprite',
    successor: true,
    terminal: false,
    fields: 'VARIABLE:variable:variable',
    inputs: '!VALUE:stringOrNumber:primitive:10:null:null',
    refs: 'variable',
    availability: 'supported',
    builder: 'ordinaryBlock',
  },
  {
    opcode: 'control_if',
    category: 'control',
    shape: 'cShape',
    placements: 'topLevelStatement,statementSequence',
    owners: 'stage,sprite',
    successor: true,
    terminal: false,
    fields: '',
    inputs:
      '?CONDITION:boolean:none:none:null:null,?SUBSTACK:substack:none:none:null:null',
    refs: '',
    availability: 'supported',
    builder: 'ordinaryBlock',
  },
  {
    opcode: 'control_repeat',
    category: 'control',
    shape: 'cShape',
    placements: 'topLevelStatement,statementSequence',
    owners: 'stage,sprite',
    successor: true,
    terminal: false,
    fields: '',
    inputs:
      '!TIMES:number:primitive:6:null:null,?SUBSTACK:substack:none:none:null:null',
    refs: '',
    availability: 'supported',
    builder: 'ordinaryBlock',
  },
  {
    opcode: 'control_delete_this_clone',
    category: 'control',
    shape: 'cap',
    placements: 'topLevelStatement,statementSequence',
    owners: 'sprite',
    successor: false,
    terminal: true,
    fields: '',
    inputs: '',
    refs: '',
    availability: 'supported',
    builder: 'ordinaryBlock',
  },
  {
    opcode: 'operator_equals',
    category: 'operators',
    shape: 'boolean',
    placements: 'topLevelExpression,booleanInput',
    owners: 'stage,sprite',
    successor: false,
    terminal: false,
    fields: '',
    inputs:
      '!OPERAND1:stringOrNumber:primitive:10:null:null,!OPERAND2:stringOrNumber:primitive:10:null:null',
    refs: '',
    availability: 'supported',
    builder: 'ordinaryBlock',
  },
] as const satisfies readonly CuratedCoreParityRowV1[])

function shadowProjection(
  shadow: CuratedCoreBlockDescriptorV1Input['canonicalShadow']
): readonly [string, string]
{
  if (shadow === null) return ['none', 'none']
  return [
    shadow.kind,
    'sb3PrimitiveTag' in shadow ? String(shadow.sb3PrimitiveTag) : 'none',
  ]
}

type CuratedCoreBlockDescriptorV1Input =
  (typeof VANILLA_CORE_DESCRIPTORS)[number]['requiredInputs'][number]

function liveParityRow(
  descriptor: (typeof VANILLA_CORE_DESCRIPTORS)[number]
): CuratedCoreParityRowV1
{
  const fields = descriptor.requiredFields.map(
    (field) =>
      `${field.name}:${field.requiredEntitySubtype}:${field.referenceDomain}`
  )
  const inputs = [
    ...descriptor.requiredInputs.map((input) => ({ marker: '!', input })),
    ...descriptor.optionalInputs.map((input) => ({ marker: '?', input })),
  ].map(({ marker, input }) =>
  {
    const [shadowKind, shadowTag] = shadowProjection(input.canonicalShadow)
    return `${marker}${input.name}:${input.connection}:${shadowKind}:${shadowTag}:${input.requiredEntitySubtype}:${input.referenceDomain}`
  })
  return {
    opcode: descriptor.opcode,
    category: descriptor.category,
    shape: descriptor.shape,
    placements: descriptor.context.allowedPlacements.join(','),
    owners: descriptor.context.ownerTargets.join(','),
    successor: descriptor.context.acceptsSuccessor,
    terminal: descriptor.context.mustTerminateSequence,
    fields: fields.join(','),
    inputs: inputs.join(','),
    refs: descriptor.referenceDomains.join(','),
    availability: descriptor.availability,
    builder: descriptor.safeBuilderKind,
  }
}

interface CuratedCoreCrossVerificationV1
{
  readonly ok: boolean
  readonly profileId: string
  readonly descriptorProfileSha256: string
  readonly rowParitySha256: string
  readonly builderCoverageSha256: string
  readonly descriptorCount: number
  readonly authorableDescriptorCount: number
  readonly coveredAuthorableDescriptorCount: number
  readonly coveredBuilderOnlyDescriptorCount: number
  readonly issues: readonly string[]
}

function verifyCuratedCoreCatalogV1(): CuratedCoreCrossVerificationV1
{
  const liveRows = VANILLA_CORE_DESCRIPTORS.map(liveParityRow)
  const issues: string[] = []
  if (
    CURATED_CORE_BLOCK_CATALOG_EVIDENCE_V1.descriptorProfileSha256 !==
    APPROVED_CURATED_CORE_DESCRIPTOR_PROFILE_SHA256
  )
  {
    issues.push('descriptor profile hash differs from the approved A0 hash')
  }
  if (liveRows.length !== PINNED_CURATED_CORE_PARITY_ROWS_V1.length)
    issues.push('descriptor count differs from the independent parity rows')
  for (const [
    index,
    expected,
  ] of PINNED_CURATED_CORE_PARITY_ROWS_V1.entries())
  {
    const actual = liveRows[index]
    if (
      actual === undefined ||
      semanticHashV1('capability-profile', actual) !==
        semanticHashV1('capability-profile', expected)
    )
    {
      issues.push(`${expected.opcode} differs from its independent parity row`)
    }
  }
  const coverage = VANILLA_CORE_DESCRIPTORS.map(
    curatedBuilderDescriptorCoverageV1
  )
  for (const row of coverage)
  {
    if (!row.covered)
      issues.push(`${row.opcode} lacks curated builder coverage`)
  }
  const authorable = VANILLA_CORE_DESCRIPTORS.filter(
    (descriptor) => descriptor.availability === 'supported'
  )
  const coveredAuthorable = coverage.filter(
    (row) => row.covered && row.loweringKind === 'ordinary-block'
  )
  const coveredBuilderOnly = coverage.filter(
    (row) => row.covered && row.loweringKind === 'compressed-entity-menu'
  )
  if (
    authorable.length !== 12 ||
    coveredAuthorable.length !== authorable.length
  )
    issues.push('all 12 authorable descriptor rows are not builder-covered')
  if (coveredBuilderOnly.length !== 1)
    issues.push('the compressed menu descriptor lacks exact builder coverage')
  return {
    ok: issues.length === 0,
    profileId: CURATED_CORE_BLOCK_CATALOG_EVIDENCE_V1.profileId,
    descriptorProfileSha256:
      CURATED_CORE_BLOCK_CATALOG_EVIDENCE_V1.descriptorProfileSha256,
    rowParitySha256: semanticHashV1('capability-profile', {
      component: 'curated-core-independent-parity-rows',
      schemaVersion: 1,
      value: liveRows,
    }),
    builderCoverageSha256: semanticHashV1('capability-profile', {
      component: 'curated-core-builder-coverage',
      schemaVersion: 1,
      value: coverage,
    }),
    descriptorCount: liveRows.length,
    authorableDescriptorCount: authorable.length,
    coveredAuthorableDescriptorCount: coveredAuthorable.length,
    coveredBuilderOnlyDescriptorCount: coveredBuilderOnly.length,
    issues,
  }
}

export function assertCuratedCoreCatalogV1(): CuratedCoreCrossVerificationV1
{
  const verification = verifyCuratedCoreCatalogV1()
  if (!verification.ok)
    throw new Error(
      `curated core catalog verification failed: ${verification.issues.join('; ')}`
    )
  return verification
}
