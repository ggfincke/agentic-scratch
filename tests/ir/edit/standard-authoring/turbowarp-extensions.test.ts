// tests/ir/edit/standard-authoring/turbowarp-extensions.test.ts
// pin the opt-in TurboWarp profile to the vendored scripts & its fail-closed compiler contract

import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { runInNewContext } from 'node:vm'

import { ProjectIR, blankProject } from '@scratch-agent/ir'
import {
  compileScratchWorkspaceV2,
  type ScratchWorkspaceManifestV2,
  type WorkspaceBlockV2,
  type WorkspaceScriptFileV2,
} from '@scratch-agent/ir/authoring'
import {
  STANDARD_AUTHORING_CATALOG_EVIDENCE_V2,
  PINNED_STANDARD_AUTHORING_AUTHORITY_SHA256_V2,
  TURBOWARP_EXTENSION_PROFILE_V1,
  assertStandardAuthoringAuthorityV2,
  assertTurboWarpExtensionProfileV1,
  getStandardDescriptorV2,
  getTurboWarpDescriptorV1,
  targetEntityEvidenceSetV1,
  type StandardAuthoringDescriptorV2,
  type StandardInputDescriptorV2,
} from '@scratch-agent/ir/edit'
import { TURBOWARP_EXTENSION_ALLOWLIST_V1, unpackSb3 } from '@scratch-agent/sb3'

const VENDOR = new URL(
  '../../../../packages/runner/vendor/turbowarp-extensions/',
  import.meta.url
)

interface ExtensionInfo
{
  readonly id: string
  readonly blocks: readonly (
    | string
    | {
        readonly opcode?: string
        readonly blockType: string
        readonly arguments?: Record<
          string,
          {
            readonly type: string
            readonly defaultValue: string
            readonly menu?: string
          }
        >
      }
  )[]
  readonly menus?: Record<
    string,
    {
      readonly acceptReporters: boolean
      readonly items: readonly { readonly value: string }[]
    }
  >
}

function sha256(bytes: Uint8Array): string
{
  return createHash('sha256').update(bytes).digest('hex')
}

// evaluate a vendored script against a stub unsandboxed Scratch API & capture getInfo()
function extensionInfo(bytes: Buffer): ExtensionInfo
{
  let registered: { getInfo(): ExtensionInfo } | undefined
  const Scratch = {
    translate: Object.assign(
      (text: string | { default: string }) =>
        typeof text === 'string' ? text : text.default,
      { setup()
      {} }
    ),
    extensions: {
      unsandboxed: true,
      register(extension: { getInfo(): ExtensionInfo })
      {
        registered = extension
      },
    },
    BlockType: {
      BOOLEAN: 'Boolean',
      COMMAND: 'command',
      EVENT: 'event',
      HAT: 'hat',
      LABEL: 'label',
      REPORTER: 'reporter',
    },
    ArgumentType: { NUMBER: 'number', STRING: 'string' },
    Cast: { toNumber: Number, toString: String },
    vm: {
      // storage that drops writes keeps local-storage.js on its no-namespace defaults
      runtime: {
        extensionStorage: new Proxy({}, { set: () => true }),
        on()
        {},
        startHats()
        {},
      },
      extensionManager: { isExtensionLoaded: () => false, refreshBlocks()
      {} },
    },
  }
  runInNewContext(bytes.toString('utf8'), {
    Scratch,
    window: { addEventListener()
    {} },
    localStorage: { getItem: () => null, setItem()
    {}, removeItem()
    {} },
    navigator: { getGamepads: () => [] },
    alert()
    {},
    console,
  })
  assert.ok(registered, 'script registered no extension')
  return registered.getInfo()
}

test('the TurboWarp profile mirrors the vendored scripts and leaves the standard authority alone', () =>
{
  assertStandardAuthoringAuthorityV2()
  assertTurboWarpExtensionProfileV1()
  assert.equal(
    STANDARD_AUTHORING_CATALOG_EVIDENCE_V2.publicCoreOpcodeCount,
    121
  )
  assert.equal(
    STANDARD_AUTHORING_CATALOG_EVIDENCE_V2.publicExtensionOpcodeCount,
    20
  )
  assert.equal(
    STANDARD_AUTHORING_CATALOG_EVIDENCE_V2.authoritySha256,
    PINNED_STANDARD_AUTHORING_AUTHORITY_SHA256_V2
  )
  const sources = JSON.parse(
    readFileSync(new URL('SOURCES.json', VENDOR), 'utf8')
  ) as {
    files: { id: string; url: string; path: string; sha256: string }[]
  }
  const shapes: Record<string, string> = {
    Boolean: 'boolean',
    reporter: 'reporter',
    command: 'stack',
    event: 'hat',
  }
  const publicOpcodes: string[] = []
  const menuOpcodes = new Set<string>()
  for (const entry of TURBOWARP_EXTENSION_ALLOWLIST_V1)
  {
    const source = sources.files.find((file) => file.id === entry.id)
    assert.ok(source, `SOURCES.json lacks ${entry.id}`)
    assert.equal(source.url, entry.url)
    const bytes = readFileSync(new URL(source.path, VENDOR))
    assert.equal(sha256(bytes), entry.scriptSha256)
    assert.equal(source.sha256, entry.scriptSha256)
    const info = extensionInfo(bytes)
    assert.equal(info.id, entry.id)
    for (const block of info.blocks)
    {
      if (typeof block === 'string' || block.blockType === 'label') continue
      const opcode = `${info.id}_${block.opcode}`
      publicOpcodes.push(opcode)
      const descriptor: StandardAuthoringDescriptorV2 | null =
        getTurboWarpDescriptorV1(opcode)
      assert.ok(descriptor, `profile lacks ${opcode}`)
      assert.equal(getStandardDescriptorV2(opcode), null)
      assert.equal(descriptor.availability, 'supported')
      assert.equal(descriptor.category, info.id)
      assert.equal(descriptor.shape, shapes[block.blockType], opcode)
      const args = Object.entries(block.arguments ?? {})
      assert.deepEqual(
        descriptor.requiredInputs.map((x) => x.name),
        args.map(([name]) => name),
        opcode
      )
      for (const [i, [name, arg]] of args.entries())
      {
        const input: StandardInputDescriptorV2 = descriptor.requiredInputs[i]!
        const shadow = input.canonicalShadow!
        assert.equal(shadow.value, arg.defaultValue, `${opcode}.${name}`)
        if (arg.menu === undefined)
        {
          assert.equal(shadow.kind, 'primitive')
          assert.equal(shadow.sb3PrimitiveTag, arg.type === 'number' ? 4 : 10)
          continue
        }
        const menu = info.menus![arg.menu]!
        assert.equal(menu.acceptReporters, true, `${opcode}.${name}`)
        assert.equal(shadow.opcode, `${info.id}_menu_${arg.menu}`)
        assert.equal(shadow.field, arg.menu)
        // Array.from moves the vm realm's values into this realm for deepEqual
        const values = Array.from(menu.items, (item) => item.value)
        assert.deepEqual(input.choices, values)
        const row: StandardAuthoringDescriptorV2 | null =
          getTurboWarpDescriptorV1(shadow.opcode)
        assert.ok(row, `profile lacks ${shadow.opcode}`)
        assert.equal(row.availability, 'builderOnly')
        assert.equal(row.shape, 'menuReporter')
        assert.deepEqual(row.requiredFields[0]!.choices, values)
        menuOpcodes.add(shadow.opcode)
      }
    }
  }
  assert.equal(publicOpcodes.length, 14)
  assert.deepEqual(
    TURBOWARP_EXTENSION_PROFILE_V1.descriptors.map((x) => x.opcode),
    [...publicOpcodes, ...menuOpcodes].sort()
  )
})

function block(
  opcode: string,
  inputs: Record<string, WorkspaceBlockV2 | string>
): WorkspaceBlockV2
{
  return {
    nodeKind: 'ordinary',
    opcode,
    fields: [],
    inputs: Object.entries(inputs).map(([name, value]) => ({
      name,
      value:
        typeof value === 'string'
          ? { valueKind: 'literal', value }
          : { valueKind: 'block', value },
    })),
  }
}

function script(root: WorkspaceScriptFileV2['root']): Uint8Array
{
  return Buffer.from(JSON.stringify({ schemaVersion: 2, kind: 'script', root }))
}

const URLS = {
  Gamepad: 'https://extensions.turbowarp.org/gamepad.js',
  localstorage: 'https://extensions.turbowarp.org/local-storage.js',
}
const STORAGE = { localstorage: { namespace: 'msis3' } }
const TURBOWARP = {
  schemaVersion: 1,
  runtime: 'turbowarp',
  scheduler: 'deterministic',
  tickRate: 30,
} as const

async function workspace()
{
  const baselineBytes = await blankProject().toSb3()
  const baseline = await ProjectIR.fromSb3(baselineBytes)
  const fingerprint = targetEntityEvidenceSetV1(baseline.json)[0]!
    .semanticFingerprintSha256
  const held = {
    nodeKind: 'ordinary',
    opcode: 'data_variable',
    inputs: [],
    fields: [
      {
        name: 'VARIABLE',
        value: {
          valueKind: 'entity',
          value: { entityKind: 'declaration', id: 'held' },
        },
      },
    ],
  } as const
  const files = [
    { path: 'baseline.sb3', bytes: baselineBytes },
    {
      path: 'flag.json',
      bytes: script({
        rootKind: 'eventScript',
        hat: block('event_whenflagclicked', {}),
        body: {
          blocks: [
            block('localstorage_setProjectId', { ID: 'msis3' }),
            block('pen_clear', {}),
            {
              ...held,
              opcode: 'data_setvariableto',
              inputs: [
                {
                  name: 'VALUE',
                  value: {
                    valueKind: 'block',
                    value: block('Gamepad_buttonDown', { b: '1', i: 'any' }),
                  },
                },
              ],
            },
            block('localstorage_set', {
              KEY: 'k',
              VALUE: block('localstorage_get', { KEY: 'k' }),
            }),
          ],
        },
      }),
    },
    {
      path: 'changed.json',
      bytes: script({
        rootKind: 'eventScript',
        hat: block('localstorage_whenChanged', {}),
        body: { blocks: [block('localstorage_removeAll', {})] },
      }),
    },
  ]
  const manifest: ScratchWorkspaceManifestV2 = {
    schemaVersion: 2,
    baseline: {
      kind: 'selectedProject',
      path: 'baseline.sb3',
      expectedArtifactSha256: sha256(baselineBytes),
    },
    targets: [
      {
        id: 'stage',
        kind: 'stage',
        name: 'Stage',
        existing: { expectedSemanticFingerprintSha256: fingerprint },
        logicMode: 'replace',
        declarations: [{ id: 'held', kind: 'variable', name: 'held' }],
        scripts: [
          { id: 'flag', path: 'flag.json' },
          { id: 'changed', path: 'changed.json' },
        ],
      },
    ],
    runtimeTargets: [TURBOWARP],
    extensionProfile: 'turbowarp-v1',
    extensionStorage: STORAGE,
  }
  return { manifest, files, baselineBytes, preparedAssets: [] }
}

// an append continuation over a compiled archive, as MSIS3's certifier builds it
async function continuation(
  bytes: Uint8Array,
  opted: boolean
): Promise<Uint8Array>
{
  const project = await ProjectIR.fromSb3(bytes)
  const manifest: ScratchWorkspaceManifestV2 = {
    schemaVersion: 2,
    baseline: {
      kind: 'selectedProject',
      path: 'final.sb3',
      expectedArtifactSha256: sha256(bytes),
    },
    targets: targetEntityEvidenceSetV1(project.json).map((evidence) => ({
      id: `selected_${evidence.targetIndex}`,
      kind: 'stage',
      name: 'Stage',
      existing: {
        expectedSemanticFingerprintSha256: evidence.semanticFingerprintSha256,
      },
      logicMode: 'append',
    })),
    runtimeTargets: [TURBOWARP],
    ...(opted
      ? { extensionProfile: 'turbowarp-v1', extensionStorage: STORAGE }
      : {}),
  }
  const result = await compileScratchWorkspaceV2({
    manifest,
    files: [{ path: 'final.sb3', bytes }],
    baselineBytes: bytes,
    preparedAssets: [],
  })
  return result.candidateBytes
}

test('an opted-in TurboWarp workspace lowers extension blocks and writes exact roots', async () =>
{
  const result = await compileScratchWorkspaceV2(await workspace())
  const { projectJsonText } = await unpackSb3(result.candidateBytes)
  const json = JSON.parse(projectJsonText) as {
    targets: { blocks: Record<string, { opcode: string; fields: object }> }[]
    extensions: string[]
    extensionURLs: object
    extensionStorage: object
  }
  assert.deepEqual(json.extensions, ['Gamepad', 'localstorage', 'pen'])
  assert.deepEqual(json.extensionURLs, URLS)
  assert.deepEqual(json.extensionStorage, STORAGE)
  const blocks = Object.values(json.targets[0]!.blocks)
  for (const opcode of [
    'Gamepad_buttonDown',
    'localstorage_set',
    'localstorage_get',
    'localstorage_whenChanged',
    'localstorage_removeAll',
  ])
    assert.ok(
      blocks.some((x) => x.opcode === opcode),
      opcode
    )
  assert.deepEqual(
    blocks.find((x) => x.opcode === 'Gamepad_menu_buttonMenu')?.fields,
    { buttonMenu: ['1'] }
  )
  assert.equal(
    result.plan.extensionProfileSha256,
    TURBOWARP_EXTENSION_PROFILE_V1.profileSha256
  )

  // append continuations reproduce the bytes whether or not they opt in
  assert.equal(
    sha256(await continuation(result.candidateBytes, true)),
    result.plan.candidateSha256
  )
  assert.equal(
    sha256(await continuation(result.candidateBytes, false)),
    result.plan.candidateSha256
  )

  // the plain IR round trip keeps both roots byte-identical
  const reopened = await ProjectIR.fromSb3(result.candidateBytes)
  assert.equal(reopened.toProjectJsonText(), projectJsonText)
  assert.equal(
    JSON.stringify(reopened.json.extensionURLs),
    JSON.stringify(URLS)
  )
})

test('the TurboWarp profile fails closed without the opt-in or with a Scratch target', async () =>
{
  const input = await workspace()
  const {
    extensionProfile: _profile,
    extensionStorage: _storage,
    ...plain
  } = input.manifest
  await assert.rejects(
    compileScratchWorkspaceV2({ ...input, manifest: plain }),
    (error: Error & { code?: string }) => error.code === 'unsupported-opcode'
  )
  await assert.rejects(
    compileScratchWorkspaceV2({
      ...input,
      manifest: {
        ...input.manifest,
        runtimeTargets: [
          TURBOWARP,
          { ...TURBOWARP, runtime: 'scratch-official' },
        ],
      },
    }),
    /requires every runtime target to be turbowarp/
  )
  await assert.rejects(
    compileScratchWorkspaceV2({
      ...input,
      manifest: { ...plain, extensionStorage: STORAGE },
    }),
    /extension storage requires extensionProfile/
  )
})
