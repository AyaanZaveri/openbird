import AsyncStorage from '@react-native-async-storage/async-storage';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { fetch as expoFetch } from 'expo/fetch';
import { z } from 'zod';

export type SettingsForm = {
  apiKey: string;
  baseUrl: string;
  model: string;
};

export type ModelOption = {
  label: string;
  value: string;
};

type DiscoveredModelsResponse = {
  models: Array<{
    id: string;
    name?: string;
  }>;
};

export const SETTINGS_STORAGE_KEY = 'chat.provider-settings';

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
});

export const defaultSettings: SettingsForm = {
  apiKey: '',
  baseUrl: 'https://api.openai.com/v1',
  model: 'gpt-4o-mini',
};

export async function loadProviderSettings() {
  try {
    const storedValue = await AsyncStorage.getItem(SETTINGS_STORAGE_KEY);
    if (!storedValue) {
      return defaultSettings;
    }

    const parsedValue = settingsSchema.safeParse(JSON.parse(storedValue));
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

  try {
    const provider = createOpenAICompatible({
      name: 'custom-provider',
      apiKey: form.apiKey,
      baseURL: parsedBaseUrl.data,
      fetch: expoFetch as unknown as typeof globalThis.fetch,
    });

    const providerWithDiscovery = provider as typeof provider & {
      getAvailableModels?: () => Promise<{ models?: Array<{ id: string; name?: string }> }>;
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
      });
    }

    const models = Array.from(uniqueModels.values()).sort((left, right) =>
      left.label.localeCompare(right.label)
    );

    return {
      models,
      error: models.length === 0 ? 'No models were returned for this provider.' : null,
    };
  } catch (error) {
    return {
      models: [] as ModelOption[],
      error: error instanceof Error ? error.message : 'Unable to load available models.',
    };
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
    | { data?: Array<{ id?: string; name?: string }> }
    | { models?: Array<{ id?: string; name?: string }> };

  const models = 'models' in json ? json.models : 'data' in json ? json.data : undefined;

  return {
    models: (models ?? [])
      .filter(
        (
          model: { id?: string; name?: string } | undefined
        ): model is { id: string; name?: string } => typeof model?.id === 'string'
      )
      .map((model: { id: string; name?: string }) => ({ id: model.id, name: model.name })),
  };
}
