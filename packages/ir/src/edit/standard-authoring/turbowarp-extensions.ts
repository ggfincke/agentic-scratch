// packages/ir/src/edit/standard-authoring/turbowarp-extensions.ts
// describe the opt-in TurboWarp extension profile beside the frozen standard catalog

import { TURBOWARP_EXTENSION_ALLOWLIST_V1 } from '@scratch-agent/sb3'
import { semanticHashV1 } from '../contracts/hash-domains.js'
import type { VanillaBlockShape } from '../contracts/catalog.js'
import { deepFreeze } from '../support/immutable.js'
import type {
  StandardAuthoringDescriptorV2,
  StandardFieldDescriptorV2,
  StandardInputDescriptorV2,
} from './catalog.js'

export type TurboWarpExtensionProfileIdV1 = 'turbowarp-v1'

const rows: StandardAuthoringDescriptorV2[] = []

function evidenceFor(id: string): string
{
  const entry = TURBOWARP_EXTENSION_ALLOWLIST_V1.find((x) => x.id === id)
  if (entry === undefined) throw new Error(`extension ${id} is not allowlisted`)
  return `vendored-turbowarp-${id}-${entry.scriptSha256}`
}

// a plain argument becomes the same inline primitive shadow scratch-vm builds
function argument(
  name: string,
  type: 'number' | 'string',
  value: string
): StandardInputDescriptorV2
{
  return {
    name,
    connection: type === 'number' ? 'number' : 'stringOrNumber',
    semanticDomain: type === 'number' ? 'ScratchNumberV1' : 'ScratchScalarV1',
    canonicalShadow: {
      kind: 'primitive',
      opcode: type === 'number' ? 'math_number' : 'text',
      sb3PrimitiveTag: type === 'number' ? 4 : 10,
      value,
      fallbackDisplayValue: value,
    },
    choices: [],
    specialTokens: [],
    referenceDomain: null,
    requiredEntitySubtype: null,
  }
}

// an acceptReporters menu is an `<id>_menu_<menu>` shadow whose field is the menu name
function menu(
  id: string,
  name: string,
  menuName: string,
  value: string,
  choices: readonly string[]
): StandardInputDescriptorV2
{
  return {
    name,
    connection: 'stringOrNumber',
    semanticDomain: 'menu',
    canonicalShadow: {
      kind: 'menu',
      opcode: `${id}_menu_${menuName}`,
      field: menuName,
      sb3PrimitiveTag: null,
      value,
      fallbackDisplayValue: value,
    },
    choices,
    specialTokens: [],
    referenceDomain: null,
    requiredEntitySubtype: null,
  }
}

function add(
  id: string,
  opcode: string,
  shape: VanillaBlockShape,
  inputs: readonly StandardInputDescriptorV2[] = [],
  fields: readonly StandardFieldDescriptorV2[] = []
): void
{
  const expression = shape === 'reporter' || shape === 'boolean'
  rows.push({
    opcode: `${id}_${opcode}`,
    category: id,
    shape,
    context: {
      allowedPlacements:
        shape === 'hat'
          ? ['eventScriptHat']
          : shape === 'menuReporter'
            ? ['menuShadow']
            : expression
              ? [
                  'topLevelExpression',
                  shape === 'boolean' ? 'booleanInput' : 'reporterInput',
                ]
              : ['topLevelStatement', 'statementSequence'],
      ownerTargets: ['stage', 'sprite'],
      acceptsSuccessor: !expression && shape !== 'menuReporter',
      mustTerminateSequence: false,
    },
    requiredFields: fields,
    optionalFields: [],
    requiredInputs: inputs,
    optionalInputs: [],
    referenceDomains: [],
    orderDomains: [],
    safeBuilderKind:
      shape === 'menuReporter' ? 'referenceMenuShadow' : 'ordinaryBlock',
    readSetDerivation:
      'exact descriptor fields and inputs plus resolved reference evidence',
    writeSetDerivation: 'owned block closure',
    deleteSetDerivation: 'owned block closure',
    resultSlots: {
      fixed: ['rootBlock'],
      dynamic: ['blockAlias'],
      conditional: [],
    },
    availability: shape === 'menuReporter' ? 'builderOnly' : 'supported',
    preservationOnlyReason: null,
    evidence: [evidenceFor(id)],
  })
}

const PAD = ['any', '1', '2', '3', '4']
const BUTTON = ['any', ...Array.from({ length: 16 }, (_, i) => String(i + 1))]
const AXIS = ['1', '2', '3', '4']
const AXES_GROUP = ['1', '3']
const G = 'Gamepad'
const pad = (name: string) => menu(G, name, 'padMenu', '1', PAD)
const button = menu(G, 'b', 'buttonMenu', '1', BUTTON)
const axesGroup = menu(G, 'axis', 'axesGroupMenu', '1', AXES_GROUP)

// mirrors gamepad.js getInfo(); the vm.Script test checks every argument & menu
add(G, 'gamepadConnected', 'boolean', [pad('pad')])
add(G, 'buttonDown', 'boolean', [button, pad('i')])
add(G, 'buttonValue', 'reporter', [button, pad('i')])
add(G, 'axisValue', 'reporter', [menu(G, 'b', 'axisMenu', '1', AXIS), pad('i')])
add(G, 'axisDirection', 'reporter', [axesGroup, pad('pad')])
add(G, 'axisMagnitude', 'reporter', [axesGroup, pad('pad')])
add(G, 'rumble', 'stack', [
  argument('s', 'number', '0.25'),
  argument('w', 'number', '0.5'),
  argument('t', 'number', '0.25'),
  pad('i'),
])
add(G, 'setAxisDeadzone', 'stack', [argument('DEADZONE', 'number', '0.1')])

// mirrors local-storage.js getInfo(); its label row is not a block
const L = 'localstorage'
const key = argument('KEY', 'string', 'score')
add(L, 'get', 'reporter', [key])
add(L, 'set', 'stack', [key, argument('VALUE', 'string', '1000')])
add(L, 'remove', 'stack', [key])
add(L, 'removeAll', 'stack')
add(L, 'whenChanged', 'hat')
add(L, 'setProjectId', 'stack', [argument('ID', 'string', 'project title')])

const publicCount = rows.length
const menuShadows = new Map<
  string,
  { readonly id: string; readonly entry: StandardInputDescriptorV2 }
>()
for (const row of rows)
  for (const entry of row.requiredInputs)
    if (entry.canonicalShadow?.kind === 'menu')
      menuShadows.set(entry.canonicalShadow.opcode, { id: row.category, entry })
// one builder-only shadow row per distinct menu, its enum field named after the menu
for (const { id, entry } of menuShadows.values())
{
  const shadow = entry.canonicalShadow!
  add(
    id,
    `menu_${shadow.field!}`,
    'menuReporter',
    [],
    [
      {
        name: shadow.field!,
        kind: 'enum',
        semanticDomain: 'menu',
        serialization: 'single-value-field',
        canonicalDefault: shadow.value,
        choices: entry.choices,
        referenceDomain: null,
        requiredEntitySubtype: null,
      },
    ]
  )
}

const descriptors = rows.sort((a, b) =>
  a.opcode < b.opcode ? -1 : a.opcode > b.opcode ? 1 : 0
)
const byOpcode = new Map(descriptors.map((x) => [x.opcode, x]))

export const TURBOWARP_EXTENSION_PROFILE_V1 = deepFreeze({
  schemaVersion: 1 as const,
  profileId: 'turbowarp-v1' as const,
  allowlist: TURBOWARP_EXTENSION_ALLOWLIST_V1,
  descriptors,
  publicOpcodeCount: publicCount,
  builderOnlyDescriptorCount: descriptors.length - publicCount,
  profileSha256: semanticHashV1('capability-profile', {
    component: 'turbowarp-extension-descriptor-profile',
    schemaVersion: 1,
    allowlist: TURBOWARP_EXTENSION_ALLOWLIST_V1,
    descriptors,
  }),
})

export const PINNED_TURBOWARP_EXTENSION_PROFILE_SHA256_V1 =
  'e2eb9a84b1ffffb32102cad1dbdc722938c22ae2b62f04a6fa8d489950e03686' as const

export function getTurboWarpDescriptorV1(
  opcode: string
): StandardAuthoringDescriptorV2 | null
{
  return byOpcode.get(opcode) ?? null
}

export function assertTurboWarpExtensionProfileV1(): void
{
  const profile = TURBOWARP_EXTENSION_PROFILE_V1
  if (
    profile.publicOpcodeCount !== 14 ||
    profile.builderOnlyDescriptorCount !== 4 ||
    byOpcode.size !== profile.descriptors.length ||
    profile.profileSha256 !== PINNED_TURBOWARP_EXTENSION_PROFILE_SHA256_V1
  )
    throw new Error('TurboWarp extension profile differs from version 1')
}

// the allowlisted extension ids whose profile opcodes appear in a project
export function turbowarpExtensionIdsV1(
  opcodes: Iterable<string>
): readonly string[]
{
  const used = new Set<string>()
  for (const opcode of opcodes)
  {
    const descriptor = byOpcode.get(opcode)
    if (descriptor !== undefined) used.add(descriptor.category)
  }
  return [...used].sort()
}
