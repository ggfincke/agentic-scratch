// packages/mcp/src/authoring/bootstrap.ts
// bind authoring transports to pinned operator permissions & retained services

import { createAuthoringWorkspaceServiceV1 } from '@scratch-agent/edit'
import { createProductionEditMcpServerFromEnvironmentV1 } from '../edit/edit-bootstrap.js'
import { productionEditProfileAuthoritySha256V1 } from '../edit/edit-tools.js'
import { EDIT_STATEFUL_RESPONSE_PROJECTOR_VERSION_V1 } from '../edit/edit-host.js'
import { WorkbenchCallAuditV1 } from './audit.js'
import { readAuthoringHostConfigurationV1 } from './config.js'
import { createAuthoringToolHostV1 } from './service-host.js'
import { nativeAdmissionBudgetFromEnvironmentV1 } from '../transport/native-admission-budget.js'

export async function createAuthoringMcpServerFromEnvironmentV1(
  environment: NodeJS.ProcessEnv = process.env
)
{
  if (environment.SCRATCH_AGENT_MCP_PROFILE !== 'authoring-v1')
    throw new Error('authoring bootstrap requires authoring-v1 profile')
  const nativeAdmissionBudget = await nativeAdmissionBudgetFromEnvironmentV1(
    environment,
    'authoring-v1'
  )
  const path = environment.SCRATCH_AGENT_WORKBENCH_CONFIG
  const sha256 = environment.SCRATCH_AGENT_WORKBENCH_CONFIG_SHA256
  if (!path || !sha256)
    throw new Error(
      'authoring MCP requires an operator workbench configuration and its pinned SHA-256'
    )
  const { configuration } = await readAuthoringHostConfigurationV1(path, sha256)
  const service = await createAuthoringWorkspaceServiceV1({
    permissions: configuration.permissions,
  })
  const audit = await WorkbenchCallAuditV1.create(
    configuration.permissions.evidenceRoot,
    productionEditProfileAuthoritySha256V1(
      EDIT_STATEFUL_RESPONSE_PROJECTOR_VERSION_V1,
      'standard-v2'
    )
  )
  return createProductionEditMcpServerFromEnvironmentV1(environment, {
    host: createAuthoringToolHostV1(service),
    audit,
    nativeAdmissionBudget,
  })
}
