// packages/mcp/src/authoring/dispatch.ts
// route authoring & catalogue requests through the shared retained boundary

import { callWorkbenchToolV1 } from '../transport/workbench-call.js'
import { describeStandardAuthoringCatalogV2 } from './catalog.js'
import {
  AUTHORING_TOOLS_V1,
  type AuthoringToolHostV1,
  type AuthoringToolNameV1,
} from './tools.js'
import type { WorkbenchCallAuditV1 } from './audit.js'

export function callAuthoringToolV1(
  host: AuthoringToolHostV1,
  audit: WorkbenchCallAuditV1,
  name: AuthoringToolNameV1,
  raw: unknown,
  signal?: AbortSignal
)
{
  return callWorkbenchToolV1({
    audit,
    tools: AUTHORING_TOOLS_V1,
    name,
    raw,
    namespace: 'authoring',
    async execute(request)
    {
      return name === 'authoring_inspect' && request.collection === 'catalog'
        ? describeStandardAuthoringCatalogV2({
            ...(request.opcodePrefix === undefined
              ? {}
              : { opcodePrefix: request.opcodePrefix as string }),
            ...(request.limit === undefined
              ? {}
              : { pageSize: request.limit as number }),
            ...(request.cursor === undefined
              ? {}
              : { cursor: request.cursor as string }),
          })
        : host.call(name, request, { signal })
    },
  })
}
