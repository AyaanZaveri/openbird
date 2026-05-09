import { DEFAULT_SEARXNG_BASE_URL } from '@/lib/provider-settings';

const SEARCH_RESULT_LIMIT = 6;
const SEARCH_TIMEOUT_MS = 10_000;
const SNIPPET_MAX_LENGTH = 180;

export type SearxngSearchOptions = {
  baseUrl?: string;
  categories?: string;
  time_range?: string;
  language?: string;
  pageno?: number;
  signal?: AbortSignal;
};

export type SearxngResult = {
  title: string;
  url: string;
  snippet: string;
  date?: string;
};

function truncateSnippet(value: string) {
  const normalized = value.replace(/\s+/g, ' ').trim();
  if (normalized.length <= SNIPPET_MAX_LENGTH) {
    return normalized;
  }

  return `${normalized.slice(0, SNIPPET_MAX_LENGTH - 1).trimEnd()}…`;
}

function getTimeoutSignal() {
  if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function') {
    return AbortSignal.timeout(SEARCH_TIMEOUT_MS);
  }

  return undefined;
}

export async function searchSearxng(
  query: string,
  options: SearxngSearchOptions = {}
): Promise<SearxngResult[]> {
  const normalizedQuery = query.trim();
  if (!normalizedQuery) {
    return [];
  }

  const searchParams = new URLSearchParams({
    q: normalizedQuery,
    format: 'json',
    categories: options.categories?.trim() || 'general',
    language: options.language?.trim() || 'en',
  });

  if (options.time_range?.trim()) {
    searchParams.set('time_range', options.time_range.trim());
  }

  if (typeof options.pageno === 'number' && Number.isFinite(options.pageno)) {
    searchParams.set('pageno', `${Math.max(1, Math.trunc(options.pageno))}`);
  }

  const normalizedBaseUrl = options.baseUrl?.trim() || DEFAULT_SEARXNG_BASE_URL;

  try {
    const response = await fetch(`${normalizedBaseUrl.replace(/\/+$/, '')}/search?${searchParams.toString()}`, {
      signal: options.signal ?? getTimeoutSignal(),
    });

    if (!response.ok) {
      return [];
    }

    const payload = (await response.json()) as {
      results?: {
        title?: unknown;
        url?: unknown;
        content?: unknown;
        publishedDate?: unknown;
      }[];
    };

    if (!Array.isArray(payload.results)) {
      return [];
    }

    return payload.results
      .map((result) => {
        const title = typeof result.title === 'string' ? result.title.trim() : '';
        const url = typeof result.url === 'string' ? result.url.trim() : '';
        const snippet = typeof result.content === 'string' ? truncateSnippet(result.content) : '';
        const date = typeof result.publishedDate === 'string' ? result.publishedDate : undefined;

        if (!title || !url || !snippet) {
          return null;
        }

        return {
          title,
          url,
          snippet,
          ...(date ? { date } : {}),
        } satisfies SearxngResult;
      })
      .filter((result) => result !== null)
      .slice(0, SEARCH_RESULT_LIMIT);
  } catch (error) {
    if (options.signal?.aborted) {
      throw error;
    }

    return [];
  }
}
