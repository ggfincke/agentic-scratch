// packages/repair/src/session/scripted-agent.ts
// deterministic in-process RepairAgent for controller & benchmark gates

import type {
  RepairAgent,
  RepairAgentDescriptor,
  RepairProposal,
  RepairRequest,
} from '../policy/contracts.js'

type ScriptedProposal = (
  request: RepairRequest,
  callIndex: number
) => RepairProposal | Promise<RepairProposal>

export class ScriptedRepairAgent implements RepairAgent
{
  readonly descriptor: RepairAgentDescriptor
  readonly requests: RepairRequest[] = []
  private callCount = 0

  constructor(
    private readonly proposals: readonly ScriptedProposal[],
    descriptor: RepairAgentDescriptor = {
      adapter: 'scripted',
      provider: 'repository',
      model: 'deterministic-reference',
      version: '1',
    }
  )
  {
    if (proposals.length === 0)
      throw new Error('scripted agent needs at least one proposal')
    this.descriptor = structuredClone(descriptor)
  }

  async propose(request: RepairRequest): Promise<RepairProposal>
  {
    const callIndex = this.callCount++
    const scripted = this.proposals[callIndex]
    if (!scripted)
      throw new Error(`scripted proposal ${callIndex + 1} is not defined`)
    this.requests.push(structuredClone(request))
    return scripted(request, callIndex)
  }
}
