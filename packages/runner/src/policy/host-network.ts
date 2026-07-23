// packages/runner/src/policy/host-network.ts
// serialize trusted host networking outside all project network-policy scopes

import { withRunnerExecution } from './execution-coordinator.js'
import { runnerNetworkPolicyActive } from './network-policy.js'

export async function withHostNetworkAccess<T>(
  callback: () => T | PromiseLike<T>
): Promise<T>
{
  return await withRunnerExecution(async () =>
  {
    if (runnerNetworkPolicyActive())
      throw new Error('host networking cannot overlap a project network policy')
    return await callback()
  })
}
