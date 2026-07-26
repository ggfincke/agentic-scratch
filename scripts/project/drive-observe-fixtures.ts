// scripts/project/drive-observe-fixtures.ts
// builds generic held-input & denied-network drive-observe fixtures

import { buildMovement, type ProjectIR } from '@scratch-agent/ir'

function heldInputProject(): ProjectIR
{
  const project = buildMovement()
  const mover = project.target('Mover')
  if (!mover) throw new Error('generated movement fixture has no Mover')
  const heldTicks = mover.addVariable('heldTicks', 0)
  mover.addScript([
    { opcode: 'event_whenflagclicked' },
    {
      opcode: 'control_forever',
      inputs: {
        SUBSTACK: {
          substack: [
            {
              opcode: 'control_if',
              inputs: {
                CONDITION: {
                  boolean: {
                    opcode: 'sensing_keypressed',
                    inputs: { KEY_OPTION: 'right arrow' },
                  },
                },
                SUBSTACK: {
                  substack: [
                    {
                      opcode: 'data_changevariableby',
                      fields: { VARIABLE: ['heldTicks', heldTicks] },
                      inputs: { VALUE: 1 },
                    },
                    { opcode: 'motion_changexby', inputs: { DX: 1 } },
                  ],
                },
              },
            },
          ],
        },
      },
    },
  ])
  return project
}

export async function buildDriveObserveHeldInputFixture(): Promise<Uint8Array>
{
  return heldInputProject().toSb3()
}

export async function buildDriveObserveNetworkFixture(): Promise<Uint8Array>
{
  const project = heldInputProject()
  project.toProjectJson().extensions = ['translate']
  const mover = project.target('Mover')
  if (!mover) throw new Error('generated movement fixture has no Mover')
  const translated = mover.addVariable('translated', '')
  mover.addScript([
    { opcode: 'event_whenflagclicked' },
    {
      opcode: 'data_setvariableto',
      fields: { VARIABLE: ['translated', translated] },
      inputs: {
        VALUE: {
          reporter: {
            opcode: 'translate_getTranslate',
            inputs: { WORDS: 'hello', LANGUAGE: 'Spanish' },
          },
        },
      },
    },
  ])
  return project.toSb3()
}
