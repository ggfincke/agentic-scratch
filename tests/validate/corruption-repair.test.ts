// tests/validate/corruption-repair.test.ts
// corruption classes: our layers flag them, sb3fix repairs them (or both reject)

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

import sb3fix from '@turbowarp/sb3fix'
import JSZip from 'jszip'

import type { Block, ProjectJson, Target } from '@scratch-agent/sb3'
import { validateSb3, type ValidateResult } from '@scratch-agent/sb3'
import { validateProjectJson } from '@scratch-agent/validate'
import { fixturePath } from '../helpers/repo-paths.js'

interface FixtureBundle
{
  json: ProjectJson
  assets: Map<string, Uint8Array>
}

async function loadFixture(): Promise<FixtureBundle>
{
  const zip = await JSZip.loadAsync(readFileSync(fixturePath('fixture.sb3')))
  const entry = zip.file('project.json')
  assert.ok(entry, 'fixture has project.json')
  const assets = new Map<string, Uint8Array>()
  for (const [path, file] of Object.entries(zip.files))
  {
    if (file.dir || path === 'project.json') continue
    assets.set(path, await file.async('uint8array'))
  }
  return { json: JSON.parse(await entry.async('text')) as ProjectJson, assets }
}

async function rezip(bundle: FixtureBundle): Promise<Uint8Array>
{
  const zip = new JSZip()
  zip.file('project.json', JSON.stringify(bundle.json))
  for (const [path, bytes] of bundle.assets) zip.file(path, bytes)
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' })
}

// canonicalize through JSON text so in-memory-only values (NaN) become what a real .sb3 carries
function canonicalize(json: ProjectJson): ProjectJson
{
  return JSON.parse(JSON.stringify(json)) as ProjectJson
}

function graphCodes(json: ProjectJson): Set<string>
{
  return new Set(
    validateProjectJson(json).diagnostics.map((d) => `${d.severity}:${d.code}`)
  )
}

async function schemaOf(bundle: FixtureBundle): Promise<ValidateResult>
{
  return validateSb3(await rezip(bundle))
}

function spriteOf(json: ProjectJson): Target
{
  const t = json.targets.find((x) => x.name === 'Sprite1')
  assert.ok(t, 'fixture has Sprite1')
  return t
}

function firstBlock(target: Target): Block
{
  for (const entry of Object.values(target.blocks))
  {
    if (!Array.isArray(entry)) return entry
  }
  throw new Error('no object block found')
}

// named object-form block; array entries are bare reporters, never scripts
function blockOf(json: ProjectJson, id: string): Block
{
  const entry = spriteOf(json).blocks[id]
  assert.ok(entry && !Array.isArray(entry), `sprite has block ${id}`)
  return entry
}

// sb3fix mutates its input in place & types the result loosely
function fixJson(json: ProjectJson): ProjectJson
{
  return sb3fix.fixJSON(structuredClone(json)) as unknown as ProjectJson
}

function stub(opcode: string, extra: Partial<Block> = {}): Block
{
  return {
    opcode,
    next: null,
    parent: null,
    inputs: {},
    fields: {},
    shadow: false,
    topLevel: true,
    x: 0,
    y: 0,
    ...extra,
  }
}

interface RepairedCase
{
  name: string
  // which layers must flag the corruption before repair
  expectCode?: string
  expectSchemaReject?: boolean
  mutate: (json: ProjectJson) => void
  // sb3fix's observable transformation on the corrupted value
  assertFixed: (json: ProjectJson) => void
}

const repairedCases: RepairedCase[] = [
  {
    name: 'corrupt colour primitive',
    expectCode: 'error:bad-primitive',
    mutate: (j) =>
    {
      ;(blockOf(j, 'changex1').inputs ??= {}).DX = [1, [9, 'zzz']] as never
    },
    assertFixed: (j) =>
      assert.deepEqual(
        (blockOf(j, 'changex1').inputs?.DX as unknown[] | undefined)?.[1],
        [9, '#000000']
      ),
  },
  {
    name: 'duplicate stage target',
    expectCode: 'error:stage-count',
    mutate: (j) => j.targets.push(structuredClone(j.targets[0]!)),
    assertFixed: (j) => assert.equal(j.targets.length, 2),
  },
  {
    name: 'empty costumes array',
    expectCode: 'info:current-costume-range',
    expectSchemaReject: true,
    mutate: (j) =>
    {
      spriteOf(j).costumes = []
    },
    assertFixed: (j) => assert.equal(spriteOf(j).costumes.length, 1),
  },
  {
    name: 'prototype shadow flipped ownerless',
    expectCode: 'warning:missing-block-owner',
    mutate: (j) =>
    {
      spriteOf(j).blocks['proto'] = stub('procedures_prototype', {
        shadow: false,
        topLevel: false,
        mutation: {
          tagName: 'mutation',
          children: [],
          proccode: 'p %s',
          argumentids: '["a"]',
          argumentnames: '["a"]',
          argumentdefaults: '[""]',
        },
      })
    },
    assertFixed: (j) =>
      assert.deepEqual(blockOf(j, 'proto'), {
        opcode: 'procedures_prototype',
        next: null,
        parent: null,
        inputs: {},
        fields: {},
        shadow: true,
        topLevel: false,
        x: 0,
        y: 0,
        mutation: {
          tagName: 'mutation',
          children: [],
          proccode: 'p %s',
          argumentids: '["a"]',
          argumentnames: '["a"]',
          argumentdefaults: '[""]',
        },
      }),
  },
  {
    name: 'non-finite coordinate serializes to null',
    expectSchemaReject: true,
    mutate: (j) =>
    {
      ;(spriteOf(j) as { x?: unknown }).x = Number.NaN
    },
    assertFixed: (j) => assert.equal((spriteOf(j) as { x?: number }).x, 0),
  },
  {
    name: 'variable without name',
    expectSchemaReject: true,
    mutate: (j) =>
    {
      ;(spriteOf(j).variables ??= {})['scoreVarId'] = [null as never, 0]
    },
    assertFixed: (j) =>
      assert.equal(spriteOf(j).variables?.['scoreVarId']?.[0], 'null'),
  },
]

interface BothRejectCase
{
  name: string
  code: string
  schemaRejects?: boolean
  mutate: (json: ProjectJson) => void
  // the exact defect sb3fix leaves untouched
  defectPersists: (json: ProjectJson) => boolean
}

const bothRejectCases: BothRejectCase[] = [
  {
    name: 'dangling block parent',
    code: 'warning:dangling-parent',
    mutate: (j) => (firstBlock(spriteOf(j)).parent = 'nope'),
    defectPersists: (j) => firstBlock(spriteOf(j)).parent === 'nope',
  },
  {
    name: 'malformed block input reference',
    code: 'warning:dangling-input-block',
    mutate: (j) =>
    {
      ;(blockOf(j, 'changex1').inputs ??= {}).DX = [2, 'ghost'] as never
    },
    defectPersists: (j) =>
      (blockOf(j, 'changex1').inputs?.DX as unknown[] | undefined)?.[1] ===
      'ghost',
  },
  {
    name: 'broadcast without definition',
    code: 'warning:missing-broadcast',
    mutate: (j) =>
    {
      spriteOf(j).blocks['bc'] = stub('event_whenbroadcastreceived', {
        fields: { BROADCAST_OPTION: ['msg', 'ghostbc'] },
      })
    },
    defectPersists: (j) =>
    {
      const b = blockOf(j, 'bc')
      return b.fields?.BROADCAST_OPTION?.[1] === 'ghostbc'
    },
  },
  {
    name: 'target missing required field',
    code: 'schema',
    schemaRejects: true,
    mutate: (j) =>
    {
      delete (spriteOf(j) as { name?: unknown }).name
    },
    defectPersists: (j) => !('name' in j.targets[1]!),
  },
]

test('corruption baseline: pristine fixture is clean at every layer', async () =>
{
  const bundle = await loadFixture()
  assert.deepEqual(graphCodes(bundle.json), new Set())
  const schema = await schemaOf(bundle)
  assert.equal(schema.ok, true, schema.errors.join('; '))
})

for (const c of repairedCases)
{
  test(`corruption-repair: ${c.name} -> flagged, fixed, accepted`, async () =>
  {
    const bundle = await loadFixture()
    c.mutate(bundle.json)
    bundle.json = canonicalize(bundle.json)

    const codes = graphCodes(bundle.json)
    if (c.expectCode)
    {
      assert.ok(
        codes.has(c.expectCode),
        `expected ${c.expectCode}, got ${[...codes].join(', ')}`
      )
    }
    if (c.expectSchemaReject)
    {
      const preSchema = await schemaOf(bundle)
      assert.equal(preSchema.ok, false, 'schema rejects corrupted project')
    }

    const fixed = fixJson(bundle.json)
    c.assertFixed(fixed)

    const fixedBundle: FixtureBundle = { json: fixed, assets: bundle.assets }
    assert.deepEqual(
      graphCodes(fixed),
      new Set(),
      'our validator accepts the repaired project'
    )
    const postSchema = await schemaOf(fixedBundle)
    assert.equal(postSchema.ok, true, postSchema.errors.join('; '))
  })
}

test('corruption-both-reject: missing top-level meta field', async () =>
{
  const bundle = await loadFixture()
  delete (bundle.json as { meta?: unknown }).meta
  bundle.json = canonicalize(bundle.json)
  const preSchema = await schemaOf(bundle)
  assert.equal(preSchema.ok, false, 'schema rejects missing meta')

  const fixed = fixJson(bundle.json)
  assert.equal('meta' in fixed, false, 'sb3fix cannot restore meta')

  const postSchema = await schemaOf({ json: fixed, assets: bundle.assets })
  assert.equal(postSchema.ok, false, 'both tools reject it after fixJSON')
})

for (const c of bothRejectCases)
{
  test(`corruption-both-reject: ${c.name} -> flagged & unfixable`, async () =>
  {
    const bundle = await loadFixture()
    c.mutate(bundle.json)
    bundle.json = canonicalize(bundle.json)

    if (c.code === 'schema')
    {
      const schema = await schemaOf(bundle)
      assert.equal(schema.ok, false, 'schema rejects corrupted project')
    }
    else
    {
      const codes = graphCodes(bundle.json)
      assert.ok(
        codes.has(c.code),
        `expected ${c.code}, got ${[...codes].join(', ')}`
      )
    }

    const fixed = fixJson(bundle.json)
    assert.equal(
      c.defectPersists(fixed),
      true,
      'sb3fix leaves this corruption class unchanged'
    )

    if (c.code !== 'schema')
    {
      assert.ok(
        graphCodes(fixed).has(c.code),
        'our validator still flags it after fixJSON'
      )
    }
    if (c.schemaRejects)
    {
      const postSchema = await schemaOf({ json: fixed, assets: bundle.assets })
      assert.equal(postSchema.ok, false, 'schema still rejects after fixJSON')
    }
  })
}
