// scripts/authoring/acceptance-fixture.ts
// prepare generic logical workspace sources for retained build & play acceptance

import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type {
  ScratchWorkspaceManifestV2,
  WorkspaceBlockV2,
  WorkspaceScriptFileV2,
} from '@scratch-agent/ir/authoring'

const PIXEL_ACTOR =
  'iVBORw0KGgoAAAANSUhEUgAAAAQAAAAECAYAAACp8Z5+AAAAGklEQVR4AWP8UKHxnwEJMDGgASYGNMDEgAYAqPwCl5WvKZEAAAAASUVORK5CYII='

function block(
  opcode: string,
  inputs: Extract<WorkspaceBlockV2, { nodeKind: 'ordinary' }>['inputs'] = []
): WorkspaceBlockV2
{
  return { nodeKind: 'ordinary', opcode, fields: [], inputs }
}

function keyboardScript(key: string): WorkspaceScriptFileV2
{
  return {
    schemaVersion: 2,
    kind: 'script',
    root: {
      rootKind: 'eventScript',
      hat: block('event_whenflagclicked'),
      body: {
        blocks: [
          block('motion_setx', [
            { name: 'X', value: { valueKind: 'literal', value: 0 } },
          ]),
          block('control_forever', [
            {
              name: 'SUBSTACK',
              value: {
                valueKind: 'statementSequence',
                value: {
                  blocks: [
                    block('control_if', [
                      {
                        name: 'CONDITION',
                        value: {
                          valueKind: 'block',
                          value: block('sensing_keypressed', [
                            {
                              name: 'KEY_OPTION',
                              value: { valueKind: 'literal', value: key },
                            },
                          ]),
                        },
                      },
                      {
                        name: 'SUBSTACK',
                        value: {
                          valueKind: 'statementSequence',
                          value: {
                            blocks: [
                              block('motion_changexby', [
                                {
                                  name: 'DX',
                                  value: { valueKind: 'literal', value: 3 },
                                },
                              ]),
                            ],
                          },
                        },
                      },
                    ]),
                  ],
                },
              },
            },
          ]),
        ],
      },
    },
  }
}

export async function prepareGenericAuthoringAcceptanceV1(root: string)
{
  const sources = join(root, 'source')
  const evidence = join(root, 'build-evidence')
  const output = join(root, 'builds')
  const developmentEvidence = join(root, 'development-evidence')
  await Promise.all(
    [sources, evidence, output, developmentEvidence].map((path) =>
      mkdir(path, { recursive: true, mode: 0o700 })
    )
  )
  const manifest: ScratchWorkspaceManifestV2 = {
    schemaVersion: 2,
    baseline: { kind: 'greenfield' },
    assets: Array.from({ length: 18 }, (_, index) => ({
      id: `frame${index}`,
      kind: 'costume',
      source: { path: 'actor.png' },
      pivot: { x: 2, y: 2 },
    })),
    targets: [
      { id: 'stage', kind: 'stage', name: 'Stage' },
      {
        id: 'player1',
        kind: 'sprite',
        name: 'Player1',
        properties: { x: 0, y: 30, size: 400 },
        costumes: Array.from({ length: 18 }, (_, index) => ({
          assetId: `frame${index}`,
          name: `Frame${index}`,
        })),
        scripts: [{ id: 'move1', path: 'player1.json' }],
      },
      {
        id: 'player2',
        kind: 'sprite',
        name: 'Player2',
        properties: { x: 0, y: -30, size: 400 },
        costumes: [{ assetId: 'frame0', name: 'Player2' }],
        scripts: [{ id: 'move2', path: 'player2.json' }],
      },
    ],
    clips: [
      {
        id: 'walk',
        name: 'Walk',
        targetId: 'player1',
        loop: true,
        frames: [
          { logicalAssetId: 'frame17', durationMs: 40 },
          { logicalAssetId: 'frame0', durationMs: 60 },
        ],
      },
    ],
    runtimeTargets: [
      {
        schemaVersion: 1,
        runtime: 'scratch-official',
        scheduler: 'deterministic',
        tickRate: 30,
      },
      {
        schemaVersion: 1,
        runtime: 'turbowarp',
        scheduler: 'deterministic',
        tickRate: 60,
      },
    ],
    scenarios: [
      {
        id: 'reset',
        scenario: {
          seed: 0,
          maxTicks: 2,
          steps: [
            { do: 'greenFlag' },
            { do: 'wait', ticks: 2 },
            { do: 'snapshot', label: 'ready' },
          ],
        },
      },
    ],
    assertions: [
      {
        scenarioId: 'reset',
        assertion: {
          at: 'ready',
          probe: { on: 'prop', sprite: 'Player1', prop: 'x' },
          match: { kind: 'equals', value: 0 },
        },
      },
      {
        scenarioId: 'reset',
        assertion: {
          at: 'ready',
          probe: { on: 'prop', sprite: 'Player2', prop: 'x' },
          match: { kind: 'equals', value: 0 },
        },
      },
    ],
    output: { path: 'generic-two-player.sb3' },
  }
  const manifestPath = join(sources, 'scratch-workspace.json')
  await writeFile(
    join(sources, 'actor.png'),
    Buffer.from(PIXEL_ACTOR, 'base64'),
    { flag: 'wx', mode: 0o600 }
  )
  await writeFile(
    join(sources, 'player1.json'),
    JSON.stringify(keyboardScript('d')),
    { flag: 'wx', mode: 0o600 }
  )
  await writeFile(
    join(sources, 'player2.json'),
    JSON.stringify(keyboardScript('l')),
    { flag: 'wx', mode: 0o600 }
  )
  await writeFile(manifestPath, JSON.stringify(manifest), {
    flag: 'wx',
    mode: 0o600,
  })
  const hostConfigPath = join(root, 'authoring-host.json')
  const developmentConfigPath = join(root, 'development-host.json')
  await writeFile(
    hostConfigPath,
    JSON.stringify({
      schemaVersion: 1,
      permissions: {
        sourceRoots: [sources],
        evidenceRoot: evidence,
        outputRoots: [output],
      },
    }),
    { flag: 'wx', mode: 0o600 }
  )
  await writeFile(
    developmentConfigPath,
    JSON.stringify({
      schemaVersion: 1,
      permissions: {
        sourceRoots: [output, evidence],
        evidenceRoot: developmentEvidence,
      },
    }),
    { flag: 'wx', mode: 0o600 }
  )
  return {
    root,
    sources,
    evidence,
    output,
    developmentEvidence,
    manifestPath,
    hostConfigPath,
    developmentConfigPath,
  }
}
