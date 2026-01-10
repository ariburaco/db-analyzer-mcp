import type { CallToolResult, TextContent } from '@modelcontextprotocol/sdk/types.js';

export type ToolResult = CallToolResult;

export function success(data: unknown): ToolResult {
  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify(data, null, 2),
      } as TextContent,
    ],
  };
}

export function error(message: string, details?: unknown): ToolResult {
  const errorData: Record<string, unknown> = {
    error: message,
  };

  if (details !== undefined) {
    errorData.details = details;
  }

  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify(errorData, null, 2),
      } as TextContent,
    ],
    isError: true,
  };
}

export function formatQueryResult(rows: unknown[], rowCount: number, duration: number): ToolResult {
  return success({
    success: true,
    rowCount,
    duration: `${duration}ms`,
    rows,
  });
}

export function formatSchemaResult(schema: unknown): ToolResult {
  return success({
    success: true,
    schema,
  });
}

export function formatTablesResult(tables: unknown[]): ToolResult {
  return success({
    success: true,
    tableCount: tables.length,
    tables,
  });
}
