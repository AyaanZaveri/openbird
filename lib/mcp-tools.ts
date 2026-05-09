import {
  parseMCPServerHeaders,
  type MCPServerConfig,
} from '@/lib/mcp-settings';
import { fetch as expoFetch } from 'expo/fetch';

type MCPClient = Awaited<ReturnType<typeof import('@ai-sdk/mcp').createMCPClient>>;

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

      for (const [toolName, mcpTool] of Object.entries(tools)) {
        const safeToolName = `mcp__${serverKey}__${toToolNameSegment(toolName)}`;
        runtime.tools[safeToolName] = {
          ...mcpTool,
          description: [
            `MCP tool from ${server.name || server.url}: ${toolName}.`,
            typeof mcpTool.description === 'string' ? mcpTool.description : null,
          ]
            .filter(Boolean)
            .join(' '),
        };
        runtime.toolNameMap[safeToolName] = {
          serverName: server.name || server.url,
          toolName,
        };
      }
    } catch (error) {
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
