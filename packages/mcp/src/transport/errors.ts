// packages/mcp/src/transport/errors.ts
// stable transport-boundary failures without host-path disclosure

export class RepairMcpBoundaryError extends Error
{
  constructor(
    readonly code: string,
    message: string
  )
  {
    super(message)
  }
}

export { RepairMcpBoundaryError as McpBoundaryError }
