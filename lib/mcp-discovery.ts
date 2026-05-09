import {
  createMCPServerConfig,
  loadMCPServers,
  saveMCPServers,
  testMCPServerConnection,
  type MCPServerConfig,
} from '@/lib/mcp-settings';
import { searchSearxng, type SearxngResult } from '@/lib/searxng';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { generateText, Output } from 'ai';
import { fetch as expoFetch } from 'expo/fetch';
import { z } from 'zod';

type MCPDiscoverySettings = {
  apiKey: string;
  baseUrl: string;
  model: string;
  searxngBaseUrl: string;
};

type DocumentationPage = SearxngResult & {
  text: string;
};

export type MCPDiscoveryResult =
  | {
      status: 'created' | 'updated';
      server: MCPServerConfig;
      summary: string;
      testMessage: string;
      sources: SearxngResult[];
    }
  | {
      status: 'needs-info' | 'error';
      summary: string;
      sources: SearxngResult[];
    };

const DOCUMENTATION_PAGE_LIMIT = 4;
const DOCUMENTATION_TEXT_LIMIT = 5_000;
const DISCOVERY_TIMEOUT_MS = 10_000;

const mcpDiscoveryOutputSchema = z.object({
  serverName: z.string().trim().min(1),
  serverUrl: z.string().trim(),
  transport: z.enum(['http', 'sse']),
  bearerToken: z.string(),
  headersJson: z.string(),
  confidence: z.enum(['high', 'medium', 'low']),
  authNotes: z.string(),
  summary: z.string().trim().min(1),
});

export function parseMCPSetupCommand(input: string) {
  const trimmed = input.trim();
  const match = trimmed.match(/^\/(?:mcp|create-mcp|createMCP)\b\s*(.*)$/i);
  if (!match) {
    return null;
  }

  return match[1]?.trim() || '';
}

export async function discoverAndSaveMCPServer(
  request: string,
  settings: MCPDiscoverySettings,
  abortSignal?: AbortSignal
): Promise<MCPDiscoveryResult> {
  const searchResults = await searchMCPDocumentation(request, settings.searxngBaseUrl, abortSignal);
  const documentationPages = await fetchDocumentationPages(searchResults, abortSignal);

  if (searchResults.length === 0) {
    return {
      status: 'needs-info',
      summary: 'I could not find any MCP setup documentation for that request.',
      sources: [],
    };
  }

  const inferredConfig = await inferMCPConfigFromDocs(
    request,
    settings,
    searchResults,
    documentationPages,
    abortSignal
  );

  if (!inferredConfig.serverUrl || inferredConfig.confidence === 'low') {
    return {
      status: 'needs-info',
      summary: inferredConfig.summary,
      sources: searchResults.slice(0, 6),
    };
  }

  const server = {
    ...createMCPServerConfig(),
    name: inferredConfig.serverName,
    url: inferredConfig.serverUrl,
    transport: inferredConfig.transport,
    enabled: true,
    bearerToken: inferredConfig.bearerToken,
    headersJson: normalizeHeadersJson(inferredConfig.headersJson),
  };

  const existingServers = await loadMCPServers();
  const existingIndex = existingServers.findIndex(
    (entry) => entry.url.trim().toLowerCase() === server.url.trim().toLowerCase()
  );
  const nextServers =
    existingIndex >= 0
      ? existingServers.map((entry, index) =>
          index === existingIndex ? { ...server, id: entry.id } : entry
        )
      : [...existingServers, server];
  const savedServer = existingIndex >= 0 ? { ...server, id: existingServers[existingIndex].id } : server;

  await saveMCPServers(nextServers);

  const testResult = await testMCPServerConnection(savedServer);

  return {
    status: existingIndex >= 0 ? 'updated' : 'created',
    server: savedServer,
    summary: [inferredConfig.summary, inferredConfig.authNotes].filter(Boolean).join(' '),
    testMessage: testResult.message,
    sources: searchResults.slice(0, 6),
  };
}

async function searchMCPDocumentation(
  request: string,
  searxngBaseUrl: string,
  abortSignal?: AbortSignal
) {
  const queries = buildMCPDiscoveryQueries(request);
  const resultSets = await Promise.all(
    queries.map((query) =>
      searchSearxng(query, {
        baseUrl: searxngBaseUrl,
        categories: 'general',
        language: 'en',
        signal: abortSignal,
      })
    )
  );
  const deduped = new Map<string, SearxngResult>();

  for (const resultSet of resultSets) {
    for (const result of resultSet) {
      if (!deduped.has(result.url)) {
        deduped.set(result.url, result);
      }
    }
  }

  return [...deduped.values()].slice(0, 10);
}

function buildMCPDiscoveryQueries(request: string) {
  const normalizedRequest = request.trim();
  return [
    `${normalizedRequest} MCP server remote URL setup`,
    `${normalizedRequest} Model Context Protocol server HTTP SSE`,
    `${normalizedRequest} MCP server documentation authorization bearer token`,
    `site:github.com ${normalizedRequest} mcp server`,
  ];
}

async function fetchDocumentationPages(results: SearxngResult[], abortSignal?: AbortSignal) {
  const pages: DocumentationPage[] = [];

  for (const result of results.slice(0, DOCUMENTATION_PAGE_LIMIT)) {
    const text = await fetchDocumentationText(result.url, abortSignal);
    if (text) {
      pages.push({ ...result, text });
    }
  }

  return pages;
}

async function fetchDocumentationText(url: string, abortSignal?: AbortSignal) {
  try {
    const response = await expoFetch(url, {
      signal:
        abortSignal ??
        (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function'
          ? AbortSignal.timeout(DISCOVERY_TIMEOUT_MS)
          : undefined),
      headers: {
        Accept: 'text/html, text/plain, application/json',
      },
    });

    if (!response.ok) {
      return '';
    }

    const contentType = response.headers.get('content-type') ?? '';
    const rawText = await response.text();
    const cleanedText = contentType.includes('html') ? stripHtml(rawText) : rawText;

    return cleanedText.replace(/\s+/g, ' ').trim().slice(0, DOCUMENTATION_TEXT_LIMIT);
  } catch (error) {
    if (abortSignal?.aborted) {
      throw error;
    }

    return '';
  }
}

function stripHtml(value: string) {
  return value
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

async function inferMCPConfigFromDocs(
  request: string,
  settings: MCPDiscoverySettings,
  searchResults: SearxngResult[],
  documentationPages: DocumentationPage[],
  abortSignal?: AbortSignal
) {
  const provider = createOpenAICompatible({
    name: 'custom-provider',
    apiKey: settings.apiKey,
    baseURL: settings.baseUrl,
    fetch: expoFetch as unknown as typeof globalThis.fetch,
  });

  const result = await generateText({
    model: provider(settings.model),
    temperature: 0,
    maxOutputTokens: 900,
    abortSignal,
    output: Output.object({
      schema: mcpDiscoveryOutputSchema,
    }),
    system: [
      'You configure remote MCP servers for a mobile AI chat app.',
      'Infer only remote HTTP or SSE MCP server settings. Do not suggest stdio, npx, docker, local commands, or localhost URLs.',
      'Prefer a Streamable HTTP endpoint over SSE when both are documented.',
      'If the documentation only describes a local stdio server, return low confidence and leave serverUrl empty.',
      'Do not invent API keys or secrets. If authentication is required but no token was provided by the user, leave bearerToken empty and explain the required token in authNotes.',
      'headersJson must be either an empty string or a JSON object string with string values.',
    ].join('\n'),
    prompt: [
      `User request: ${request}`,
      'Search results:',
      ...searchResults.map(
        (result, index) =>
          `${index + 1}. ${result.title}\nURL: ${result.url}\nSnippet: ${result.snippet}`
      ),
      'Fetched documentation excerpts:',
      ...documentationPages.map(
        (page, index) => `${index + 1}. ${page.title}\nURL: ${page.url}\nText: ${page.text}`
      ),
    ].join('\n\n'),
  });

  return result.output;
}

function normalizeHeadersJson(value: string) {
  const trimmed = value.trim();
  if (!trimmed) {
    return '';
  }

  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return '';
    }

    return JSON.stringify(parsed);
  } catch {
    return '';
  }
}
