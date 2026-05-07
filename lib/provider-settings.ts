import AsyncStorage from '@react-native-async-storage/async-storage';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { fetch as expoFetch } from 'expo/fetch';
import { z } from 'zod';

export type SettingsForm = {
  apiKey: string;
  baseUrl: string;
  model: string;
  speechEnrichmentModel: string;
  searxngBaseUrl: string;
};

export const DEFAULT_SEARXNG_BASE_URL = 'https://cjj-on-hf-searxng.hf.space/';

export const SEARXNG_INSTANCE_OPTIONS = [
  {
    label: 'Hugging Face',
    value: DEFAULT_SEARXNG_BASE_URL,
  },
  {
    label: 'Railway',
    value: 'https://serxng-deployment-production.up.railway.app',
  },
] as const;

export type ModelOption = {
  label: string;
  value: string;
  created?: number;
};

type CachedModelsEntry = {
  expiresAt: number;
  result: {
    models: ModelOption[];
    error: string | null;
  };
};

type DiscoveredModelsResponse = {
  models: Array<{
    id: string;
    name?: string;
    created?: number;
  }>;
};

export const SETTINGS_STORAGE_KEY = 'chat.provider-settings';
const MODEL_CACHE_TTL_MS = 5 * 60 * 1000;
const modelDiscoveryCache = new Map<string, CachedModelsEntry>();

export const settingsSchema = z.object({
  apiKey: z.string(),
  baseUrl: z
    .string()
    .trim()
    .url({ message: 'Enter a valid URL.' })
    .refine((value) => {
      const protocol = new URL(value).protocol;
      return protocol === 'http:' || protocol === 'https:';
    }, 'Use an http or https URL.'),
  model: z.string().trim().min(1, 'Enter a model ID.'),
  speechEnrichmentModel: z.string().trim().min(1, 'Enter a speech enrichment model ID.'),
  searxngBaseUrl: z
    .string()
    .trim()
    .url({ message: 'Enter a valid SearXNG URL.' })
    .refine((value) => {
      const protocol = new URL(value).protocol;
      return protocol === 'http:' || protocol === 'https:';
    }, 'Use an http or https URL for SearXNG.'),
});

export const defaultSettings: SettingsForm = {
  apiKey: '',
  baseUrl: 'https://api.openai.com/v1',
  model: 'gpt-4o-mini',
  speechEnrichmentModel: 'gpt-4o-mini',
  searxngBaseUrl: DEFAULT_SEARXNG_BASE_URL,
};

export async function loadProviderSettings() {
  try {
    const storedValue = await AsyncStorage.getItem(SETTINGS_STORAGE_KEY);
    if (!storedValue) {
      return defaultSettings;
    }

    const parsedJson = JSON.parse(storedValue) as Partial<SettingsForm>;
    const parsedValue = settingsSchema.safeParse({
      ...defaultSettings,
      ...parsedJson,
      speechEnrichmentModel:
        parsedJson.speechEnrichmentModel?.trim() || parsedJson.model?.trim() || defaultSettings.speechEnrichmentModel,
      searxngBaseUrl: parsedJson.searxngBaseUrl?.trim() || defaultSettings.searxngBaseUrl,
    });
    if (!parsedValue.success) {
      return defaultSettings;
    }

    return parsedValue.data;
  } catch {
    return defaultSettings;
  }
}

export async function saveProviderSettings(settings: SettingsForm) {
  await AsyncStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings));
}

export async function loadAvailableModels(form: SettingsForm) {
  const parsedBaseUrl = settingsSchema.shape.baseUrl.safeParse(form.baseUrl);
  if (!parsedBaseUrl.success) {
    return { models: [] as ModelOption[], error: null };
  }

  const cacheKey = `${parsedBaseUrl.data}::${form.apiKey}`;
  const cachedResult = modelDiscoveryCache.get(cacheKey);

  if (cachedResult && cachedResult.expiresAt > Date.now()) {
    return cachedResult.result;
  }

  try {
    const provider = createOpenAICompatible({
      name: 'custom-provider',
      apiKey: form.apiKey,
      baseURL: parsedBaseUrl.data,
      fetch: expoFetch as unknown as typeof globalThis.fetch,
    });

    const providerWithDiscovery = provider as typeof provider & {
      getAvailableModels?: () => Promise<{ models?: Array<{ id: string; name?: string; created?: number }> }>;
    };

    const discovered =
      typeof providerWithDiscovery.getAvailableModels === 'function'
        ? await providerWithDiscovery.getAvailableModels()
        : await fetchOpenAICompatibleModels(parsedBaseUrl.data, form.apiKey);

    const uniqueModels = new Map<string, ModelOption>();

    for (const model of discovered.models ?? []) {
      if (!model.id || uniqueModels.has(model.id)) {
        continue;
      }

      uniqueModels.set(model.id, {
        value: model.id,
        label: model.name?.trim() || model.id,
        created: model.created,
      });
    }

    const models = Array.from(uniqueModels.values()).sort((left, right) =>
      (right.created ?? 0) - (left.created ?? 0)
    );

    const result = {
      models,
      error: models.length === 0 ? 'No models were returned for this provider.' : null,
    };

    modelDiscoveryCache.set(cacheKey, {
      expiresAt: Date.now() + MODEL_CACHE_TTL_MS,
      result,
    });

    return result;
  } catch (error) {
    const result = {
      models: [] as ModelOption[],
      error: error instanceof Error ? error.message : 'Unable to load available models.',
    };

    modelDiscoveryCache.set(cacheKey, {
      expiresAt: Date.now() + 15 * 1000,
      result,
    });

    return result;
  }
}

export function getFuzzyModelScore(query: string, model: ModelOption) {
  if (!query) {
    return 0;
  }

  const normalizedQuery = query.toLowerCase();
  const candidates = [model.value.toLowerCase(), model.label.toLowerCase()];
  let bestScore: number | null = null;

  for (const candidate of candidates) {
    const exactIndex = candidate.indexOf(normalizedQuery);
    if (exactIndex >= 0) {
      bestScore = bestScore === null ? exactIndex : Math.min(bestScore, exactIndex);
      continue;
    }

    let queryIndex = 0;
    let firstMatch = -1;
    let lastMatch = -1;

    for (let candidateIndex = 0; candidateIndex < candidate.length; candidateIndex += 1) {
      if (candidate[candidateIndex] !== normalizedQuery[queryIndex]) {
        continue;
      }

      if (firstMatch === -1) {
        firstMatch = candidateIndex;
      }

      lastMatch = candidateIndex;
      queryIndex += 1;

      if (queryIndex === normalizedQuery.length) {
        const spread = lastMatch - firstMatch;
        const fuzzyScore = firstMatch + spread;
        bestScore = bestScore === null ? fuzzyScore : Math.min(bestScore, fuzzyScore);
        break;
      }
    }
  }

  return bestScore;
}

async function fetchOpenAICompatibleModels(
  baseUrl: string,
  apiKey: string
): Promise<DiscoveredModelsResponse> {
  const modelsUrl = new URL('models', baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`);
  const response = await expoFetch(modelsUrl.toString(), {
    headers: {
      ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
    },
  });

  if (!response.ok) {
    throw new Error(`Unable to load models (${response.status}).`);
  }

  const json = (await response.json()) as
    | { data?: Array<{ id?: string; name?: string; created?: number }> }
    | { models?: Array<{ id?: string; name?: string; created?: number }> };

  const models = 'models' in json ? json.models : 'data' in json ? json.data : undefined;

  return {
    models: (models ?? [])
      .filter(
        (
          model: { id?: string; name?: string; created?: number } | undefined
        ): model is { id: string; name?: string; created?: number } => typeof model?.id === 'string'
      )
      .map((model: { id: string; name?: string; created?: number }) => ({ id: model.id, name: model.name, created: model.created })),
  };
}
