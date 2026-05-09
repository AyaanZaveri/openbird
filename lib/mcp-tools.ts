import {
  parseMCPServerHeaders,
  type MCPServerConfig,
} from '@/lib/mcp-settings';
import { fetch as expoFetch } from 'expo/fetch';

type MCPClient = Awaited<ReturnType<typeof import('@ai-sdk/mcp').createMCPClient>>;
type MCPTool = {
  description?: string;
  inputSchema?: unknown;
  execute?: (input: unknown, options?: unknown) => Promise<unknown> | unknown;
};

export type MCPToolRuntime = {
  tools: Record<string, unknown>;
  clients: MCPClient[];
  errors: string[];
  toolNameMap: Record<string, { serverName: string; toolName: string }>;
};

export function getMCPToolDisplayName(
  toolName: string,
  toolNameMap: Record<string, { serverName: string; toolName: string }>
) {
  const mappedTool = toolNameMap[toolName];
  if (!mappedTool) {
    return toolName;
  }

  return `${mappedTool.serverName}: ${mappedTool.toolName}`;
}

export async function createMCPToolRuntime(servers: MCPServerConfig[]): Promise<MCPToolRuntime> {
  const { createMCPClient } = await import('@ai-sdk/mcp');
  const runtime: MCPToolRuntime = {
    tools: {},
    clients: [],
    errors: [],
    toolNameMap: {},
  };

  for (const server of servers.filter((entry) => entry.enabled)) {
    try {
      const client = await createMCPClient({
        clientName: 'openbird',
        version: '1.0.0',
        transport: {
          type: server.transport,
          url: server.url,
          headers: parseMCPServerHeaders(server),
          fetch: expoFetch as unknown as typeof globalThis.fetch,
        },
      });

      runtime.clients.push(client);
      const tools = await client.tools();
      const serverKey = toToolNameSegment(server.name || server.id);

      for (const [toolName, mcpTool] of Object.entries(tools) as [string, MCPTool][]) {
        const safeToolName =
          toolName in runtime.tools ? `mcp__${serverKey}__${toToolNameSegment(toolName)}` : toolName;
        runtime.tools[safeToolName] = wrapMCPToolForLogging({
          tool: mcpTool,
          toolName,
          safeToolName,
          serverLabel: getSafeServerLabel(server),
        });
        runtime.toolNameMap[safeToolName] = {
          serverName: server.name || server.url,
          toolName,
        };
      }
    } catch (error) {
      console.error('[OpenBird MCP] failed to load server', {
        server: getSafeServerLabel(server),
        transport: server.transport,
        error: serializeError(error),
      });

      runtime.errors.push(
        `${server.name || server.url}: ${
          error instanceof Error ? error.message : 'Unable to load MCP tools.'
        }`
      );
    }
  }

  return runtime;
}

export async function closeMCPClients(clients: MCPClient[]) {
  await Promise.allSettled(clients.map((client) => client.close()));
}

function toToolNameSegment(value: string) {
  const normalized = value.trim().replace(/[^a-zA-Z0-9_-]+/g, '_').replace(/^_+|_+$/g, '');

  return normalized || 'server';
}

function wrapMCPToolForLogging({
  tool,
  toolName,
  safeToolName,
  serverLabel,
}: {
  tool: MCPTool;
  toolName: string;
  safeToolName: string;
  serverLabel: string;
}) {
  if (typeof tool.execute !== 'function') {
    return tool;
  }

  const execute = tool.execute.bind(tool);

  return {
    ...tool,
    execute: async (input: unknown, options?: unknown) => {
      console.info('[OpenBird MCP] execute start', {
        server: serverLabel,
        toolName,
        exposedAs: safeToolName,
        input: summarizeValue(input),
        options: summarizeValue(options),
      });

      try {
        return await execute(input, normalizeMCPToolOptions(options));
      } catch (error) {
        console.error('[OpenBird MCP] execute error', {
          server: serverLabel,
          toolName,
          exposedAs: safeToolName,
          input: summarizeValue(input),
          error: serializeError(error),
        });

        throw error;
      }
    },
  };
}

function getSafeServerLabel(server: MCPServerConfig) {
  return server.name.trim() || safeUrlLabel(server.url) || server.id;
}

function safeUrlLabel(value: string) {
  try {
    const url = new URL(value);
    return `${url.origin}${url.pathname}`;
  } catch {
    return value.replace(/[?].*$/, '');
  }
}

function summarizeValue(value: unknown) {
  if (value === undefined) {
    return { type: 'undefined' };
  }

  if (value === null) {
    return { type: 'null' };
  }

  if (typeof value !== 'object') {
    return {
      type: typeof value,
      value,
    };
  }

  if (Array.isArray(value)) {
    return {
      type: 'array',
      length: value.length,
      preview: value.slice(0, 3),
    };
  }

  const record = value as Record<string, unknown>;
  return {
    type: 'object',
    keys: Object.keys(record),
    preview: getPreviewObject(record),
  };
}

function getPreviewObject(record: Record<string, unknown>) {
  return Object.fromEntries(
    Object.entries(record)
      .filter(([key]) => !/token|authorization|api[-_]?key|secret|password/i.test(key))
      .slice(0, 8)
  );
}

function serializeError(error: unknown): Record<string, unknown> {
  if (!(error instanceof Error)) {
    return {
      type: typeof error,
      value: error,
    };
  }

  return {
    name: error.name,
    message: error.message,
    stack: error.stack,
    cause: error.cause instanceof Error ? serializeError(error.cause) : error.cause,
  };
}

function normalizeMCPToolOptions(options: unknown) {
  if (!options || typeof options !== 'object') {
    return options;
  }

  const record = options as { abortSignal?: AbortSignal & { throwIfAborted?: () => void } };
  const abortSignal = record.abortSignal;

  if (!abortSignal || typeof abortSignal.throwIfAborted === 'function') {
    return options;
  }

  try {
    Object.defineProperty(abortSignal, 'throwIfAborted', {
      configurable: true,
      value() {
        if (!abortSignal.aborted) {
          return;
        }

        const error = new Error('The operation was aborted.');
        error.name = 'AbortError';
        throw error;
      },
    });

    return options;
  } catch {
    return {
      ...record,
      abortSignal: {
        ...abortSignal,
        get aborted() {
          return abortSignal.aborted;
        },
        addEventListener: abortSignal.addEventListener?.bind(abortSignal),
        removeEventListener: abortSignal.removeEventListener?.bind(abortSignal),
        throwIfAborted() {
          if (!abortSignal.aborted) {
            return;
          }

          const error = new Error('The operation was aborted.');
          error.name = 'AbortError';
          throw error;
        },
      },
    };
  }
}
