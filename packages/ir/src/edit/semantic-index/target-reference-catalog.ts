// packages/ir/src/edit/semantic-index/target-reference-catalog.ts
// pinned core target-name menu/reference descriptors for edits

import { deepFreeze } from '../support/immutable.js'

type TargetNameReferenceKindV1 =
  | 'touching'
  | 'distance-to'
  | 'go-to'
  | 'point-towards'
  | 'clone'
  | 'attribute-of'

type TargetNameResolutionDomainV1 =
  | 'motionTarget'
  | 'cloneTarget'
  | 'touchingObjectTarget'
  | 'distanceTarget'
  | 'sensingObjectTarget'

interface TargetNameReferenceDescriptorV1
{
  readonly sourceOpcode: string
  readonly inputName: string
  readonly menuOpcode: string
  readonly fieldName: string
  readonly referenceKind: TargetNameReferenceKindV1
  readonly resolutionDomain: TargetNameResolutionDomainV1
  readonly specialNames: readonly string[]
}

export const TARGET_NAME_REFERENCE_DESCRIPTORS_V1 = deepFreeze([
  {
    sourceOpcode: 'event_whentouchingobject',
    inputName: 'TOUCHINGOBJECTMENU',
    menuOpcode: 'event_touchingobjectmenu',
    fieldName: 'TOUCHINGOBJECTMENU',
    referenceKind: 'touching',
    resolutionDomain: 'touchingObjectTarget',
    specialNames: ['_mouse_', '_edge_'],
  },
  {
    sourceOpcode: 'sensing_touchingobject',
    inputName: 'TOUCHINGOBJECTMENU',
    menuOpcode: 'sensing_touchingobjectmenu',
    fieldName: 'TOUCHINGOBJECTMENU',
    referenceKind: 'touching',
    resolutionDomain: 'touchingObjectTarget',
    specialNames: ['_mouse_', '_edge_'],
  },
  {
    sourceOpcode: 'sensing_distanceto',
    inputName: 'DISTANCETOMENU',
    menuOpcode: 'sensing_distancetomenu',
    fieldName: 'DISTANCETOMENU',
    referenceKind: 'distance-to',
    resolutionDomain: 'distanceTarget',
    specialNames: ['_mouse_'],
  },
  {
    sourceOpcode: 'motion_goto',
    inputName: 'TO',
    menuOpcode: 'motion_goto_menu',
    fieldName: 'TO',
    referenceKind: 'go-to',
    resolutionDomain: 'motionTarget',
    specialNames: ['_mouse_', '_random_'],
  },
  {
    sourceOpcode: 'motion_glideto',
    inputName: 'TO',
    menuOpcode: 'motion_glideto_menu',
    fieldName: 'TO',
    referenceKind: 'go-to',
    resolutionDomain: 'motionTarget',
    specialNames: ['_mouse_', '_random_'],
  },
  {
    sourceOpcode: 'motion_pointtowards',
    inputName: 'TOWARDS',
    menuOpcode: 'motion_pointtowards_menu',
    fieldName: 'TOWARDS',
    referenceKind: 'point-towards',
    resolutionDomain: 'motionTarget',
    specialNames: ['_mouse_', '_random_'],
  },
  {
    sourceOpcode: 'control_create_clone_of',
    inputName: 'CLONE_OPTION',
    menuOpcode: 'control_create_clone_of_menu',
    fieldName: 'CLONE_OPTION',
    referenceKind: 'clone',
    resolutionDomain: 'cloneTarget',
    specialNames: ['_myself_'],
  },
  {
    sourceOpcode: 'sensing_of',
    inputName: 'OBJECT',
    menuOpcode: 'sensing_of_object_menu',
    fieldName: 'OBJECT',
    referenceKind: 'attribute-of',
    resolutionDomain: 'sensingObjectTarget',
    specialNames: ['_stage_'],
  },
] as const satisfies readonly TargetNameReferenceDescriptorV1[])
