// packages/repair/src/session/controller.ts
// run a direct RepairAgent through the shared turn-based repair session

import {
  detachJson,
  type RepairAgent,
  type RepairAgentDescriptor,
  type RepairResult,
  type StartRepairInput,
} from '../policy/contracts.js'
import { normalizeTrustedSubmissionMetadata, startRepair } from './session.js'

function trustedDescriptor(agent: RepairAgent): RepairAgentDescriptor
{
  const descriptor = detachJson(agent.descriptor)
  return normalizeTrustedSubmissionMetadata({ descriptor }).descriptor!
}

export async function repairProject(
  input: StartRepairInput,
  agent: RepairAgent
): Promise<RepairResult>
{
  const session = await startRepair(input)
  while (true)
  {
    const next = session.nextRequest()
    if (!('requestId' in next)) return session.result()

    const started = performance.now()
    let descriptor: RepairAgentDescriptor | null = null
    let rawProposal: unknown
    try
    {
      descriptor = trustedDescriptor(agent)
      rawProposal = await agent.propose(next)
    }
    catch (error)
    {
      await session.stopAgent(next.requestId, error, {
        ...(descriptor ? { descriptor } : {}),
        latencyMs: Math.max(0, performance.now() - started),
      })
      return session.result()
    }
    await session.submitProposal(rawProposal, {
      descriptor: descriptor!,
      latencyMs: Math.max(0, performance.now() - started),
    })
  }
}
