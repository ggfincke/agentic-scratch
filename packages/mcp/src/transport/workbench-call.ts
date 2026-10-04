// packages/mcp/src/transport/workbench-call.ts
// enforce shared bounded request, response & audit rules for workbench profiles

import type { CallToolResult, Tool } from '@modelcontextprotocol/sdk/types.js'
import { validateClosedJsonSchemaValueV1 } from './json-schema-check.js'
import {
  WorkbenchAuditErrorV1,
  type WorkbenchCallAuditV1,
} from '../authoring/audit.js'

export async function callWorkbenchToolV1(options: {
  audit: WorkbenchCallAuditV1
  tools: readonly Tool[]
  name: string
  raw: unknown
  namespace: 'authoring' | 'development'
  execute(
    input: Readonly<Record<string, unknown>>
  ): Promise<Readonly<Record<string, unknown>>>
}): Promise<CallToolResult>
{
  const input = options.raw ?? {}
  const callId = await options.audit.begin(options.name, input)
  let ok = true
  let data: Readonly<Record<string, unknown>>
  try
  {
    if (Buffer.byteLength(JSON.stringify(input)) > 16 * 1024)
      throw new Error(`${options.namespace} request exceeds 16 KiB`)
    const tool = options.tools.find((row) => row.name === options.name)
    if (!tool) throw new Error('unknown workbench tool')
    const issues = validateClosedJsonSchemaValueV1(tool.inputSchema, input)
    if (issues.length)
      throw new Error(`invalid ${options.namespace} request: ${issues[0]}`)
    data = await options.execute(input as Readonly<Record<string, unknown>>)
    if (Buffer.byteLength(JSON.stringify(data)) > 48 * 1024)
      throw new Error(
        `${options.namespace} response exceeds 48 KiB; use pagination or artifact references`
      )
  }
  catch (error)
  {
    if (error instanceof WorkbenchAuditErrorV1) throw error
    ok = false
    data = {
      code:
        error &&
        typeof error === 'object' &&
        'code' in error &&
        typeof error.code === 'string'
          ? error.code
          : `${options.namespace}.request_failed`,
      message: (error instanceof Error ? error.message : String(error)).slice(
        0,
        4096
      ),
    }
  }
  const outcome = { schemaVersion: 1, tool: options.name, ok, data }
  const receipt = await options.audit.complete(callId, options.name, outcome)
  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify({
          schemaVersion: 1,
          tool: options.name,
          ok,
          structuredContent: true,
        }),
      },
    ],
    structuredContent: { ...outcome, data: { ...data, audit: receipt } },
    ...(ok ? {} : { isError: true }),
  }
}
