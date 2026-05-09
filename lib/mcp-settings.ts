import AsyncStorage from '@react-native-async-storage/async-storage';
import { fetch as expoFetch } from 'expo/fetch';
import { z } from 'zod';

export const MCP_SERVERS_STORAGE_KEY = 'chat.mcp-servers';

export const mcpServerSchema = z.object({
  id: z.string(),
  name: z.string().trim().min(1, 'Enter a server name.'),
  url: z
    .string()
    .trim()
    .url({ message: 'Enter a valid MCP URL.' })
    .refine((value) => {
      const protocol = new URL(value).protocol;
      return protocol === 'http:' || protocol === 'https:';
    }, 'Use an http or https MCP URL.'),
  transport: z.enum(['http', 'sse']),
  enabled: z.boolean(),
  bearerToken: z.string(),
  headersJson: z.string(),
});

export const mcpServersSchema = z.array(mcpServerSchema);

export type MCPServerConfig = z.infer<typeof mcpServerSchema>;

export function createMCPServerConfig(): MCPServerConfig {
  return {
    id: `mcp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    name: '',
    url: '',
    transport: 'http',
    enabled: true,
    bearerToken: '',
    headersJson: '',
  };
}

export async function loadMCPServers() {
  try {
    const storedValue = await AsyncStorage.getItem(MCP_SERVERS_STORAGE_KEY);
    if (!storedValue) {
      return [] as MCPServerConfig[];
    }

    const parsedValue = mcpServersSchema.safeParse(JSON.parse(storedValue));
    if (!parsedValue.success) {
      return [] as MCPServerConfig[];
    }

    return parsedValue.data;
  } catch {
    return [] as MCPServerConfig[];
  }
}

export async function saveMCPServers(servers: MCPServerConfig[]) {
  await AsyncStorage.setItem(MCP_SERVERS_STORAGE_KEY, JSON.stringify(servers));
}

export function parseMCPServerHeaders(server: MCPServerConfig) {
  const headers: Record<string, string> = {};
  const bearerToken = server.bearerToken.trim();

  if (bearerToken) {
    headers.Authorization = `Bearer ${bearerToken}`;
  }

  const rawHeaders = server.headersJson.trim();
  if (!rawHeaders) {
    return headers;
  }

  const parsedHeaders = z.record(z.string(), z.string()).safeParse(JSON.parse(rawHeaders));
  if (!parsedHeaders.success) {
    throw new Error(`${server.name || 'MCP server'} has invalid headers JSON.`);
  }

  return {
    ...headers,
    ...parsedHeaders.data,
  };
}

export async function testMCPServerConnection(server: MCPServerConfig) {
  const parsedServer = mcpServerSchema.safeParse(server);
  if (!parsedServer.success) {
    return {
      ok: false,
      message: parsedServer.error.issues[0]?.message ?? 'Update the MCP server settings.',
    };
  }

  try {
    const { createMCPClient } = await import('@ai-sdk/mcp');
    const client = await createMCPClient({
      clientName: 'openbird',
      version: '1.0.0',
      transport: {
        type: parsedServer.data.transport,
        url: parsedServer.data.url,
        headers: parseMCPServerHeaders(parsedServer.data),
        fetch: expoFetch as unknown as typeof globalThis.fetch,
      },
    });

    try {
      const tools = await client.listTools();
      return {
        ok: true,
        message:
          tools.tools.length === 1
            ? 'Connected. Found 1 tool.'
            : `Connected. Found ${tools.tools.length} tools.`,
      };
    } finally {
      await client.close();
    }
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : 'Unable to connect to MCP server.',
    };
  }
}
