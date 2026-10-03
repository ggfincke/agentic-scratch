// packages/mcp/src/development/bootstrap.ts
// start a scoped development server w/ pinned operator permissions

import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import {
  createDevelopmentServiceV1,
  type DevelopmentOperatorPermissionsV1,
} from '@scratch-agent/runner'
import { WorkbenchCallAuditV1 } from '../authoring/audit.js'
import { createScratchMcpServer } from '../transport/server.js'
import { readDevelopmentHostConfigurationV1 } from './config.js'
import { createDevelopmentToolHostV1 } from './service-host.js'
import { developmentProfileAuthoritySha256V1 } from './tools.js'
import { nativeAdmissionBudgetFromEnvironmentV1 } from '../transport/native-admission-budget.js'

export async function createDevelopmentMcpServerFromEnvironmentV1(
  environment: NodeJS.ProcessEnv = process.env
)
{
  if (environment.SCRATCH_AGENT_MCP_PROFILE !== 'development-v1')
    throw new Error('development bootstrap requires development-v1 profile')
  const nativeAdmissionBudget = await nativeAdmissionBudgetFromEnvironmentV1(
    environment,
    'development-v1'
  )
  const path = environment.SCRATCH_AGENT_WORKBENCH_CONFIG
  const sha256 = environment.SCRATCH_AGENT_WORKBENCH_CONFIG_SHA256
  if (!path || !sha256)
    throw new Error(
      'development MCP requires an operator workbench configuration and its pinned SHA-256'
    )
  const loaded = await readDevelopmentHostConfigurationV1(path, sha256)
  const permissions =
    loaded.permissions as unknown as DevelopmentOperatorPermissionsV1
  const service = await createDevelopmentServiceV1({ permissions })
  const host = createDevelopmentToolHostV1(service)
  const audit = await WorkbenchCallAuditV1.create(
    permissions.evidenceRoot,
    developmentProfileAuthoritySha256V1()
  )
  // legacy registries stay inert; only the five development tools are advertised
  const outputRoot = join(permissions.evidenceRoot, 'transport-output')
  const artifactRoot = join(permissions.evidenceRoot, 'transport-artifacts')
  await mkdir(outputRoot, { recursive: true, mode: 0o700 })
  await mkdir(artifactRoot, { recursive: true, mode: 0o700 })
  return createScratchMcpServer(
    { inputRoot: permissions.sourceRoots[0]!, outputRoot, artifactRoot },
    {
      profile: 'development-v1',
      developmentHost: host,
      workbenchAudit: audit,
      nativeAdmissionBudget,
    }
  )
}
