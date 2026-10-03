// packages/mcp/src/development/dispatch.ts
// route development requests through the shared bounded retained boundary

import { callWorkbenchToolV1 } from '../transport/workbench-call.js'
import type { WorkbenchCallAuditV1 } from '../authoring/audit.js'
import {
  DEVELOPMENT_TOOLS_V1,
  type DevelopmentToolHostV1,
  type DevelopmentToolNameV1,
} from './tools.js'

export function callDevelopmentToolV1(
  host: DevelopmentToolHostV1,
  audit: WorkbenchCallAuditV1,
  name: DevelopmentToolNameV1,
  raw: unknown,
  signal?: AbortSignal
)
{
  return callWorkbenchToolV1({
    audit,
    tools: DEVELOPMENT_TOOLS_V1,
    name,
    raw,
    namespace: 'development',
    execute: (request) => host.call(name, request, { signal }),
  })
}
