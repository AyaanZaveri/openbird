import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { Input } from '@/components/ui/input';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Text } from '@/components/ui/text';
import {
  defaultSettings,
  getFuzzyModelScore,
  loadAvailableModels,
  loadProviderSettings,
  saveProviderSettings,
  settingsSchema,
  type ModelOption,
  type SettingsForm,
} from '@/lib/provider-settings';
import {
  loadThemePreference,
  saveThemePreference,
  type ThemePreference,
} from '@/lib/theme-preferences';
import * as Haptics from 'expo-haptics';
import { useRouter } from 'expo-router';
import { ChevronLeft, RotateCwIcon } from 'lucide-react-native';
import * as React from 'react';
import { InteractionManager, Pressable, ScrollView, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Uniwind, useUniwind, withUniwind } from 'uniwind';

const StyledSafeAreaView = withUniwind(SafeAreaView);

export function SettingsScreen() {
  const router = useRouter();
  const { theme, hasAdaptiveThemes } = useUniwind();
  const insets = useSafeAreaInsets();
  const modelBlurTimeoutRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const [settings, setSettings] = React.useState<SettingsForm>(defaultSettings);
  const [settingsError, setSettingsError] = React.useState<string | null>(null);
  const [availableModels, setAvailableModels] = React.useState<ModelOption[]>([]);
  const [isLoadingModels, setIsLoadingModels] = React.useState(false);
  const [modelLoadError, setModelLoadError] = React.useState<string | null>(null);
  const [isModelInputFocused, setIsModelInputFocused] = React.useState(false);
  const [themePreference, setThemePreference] = React.useState<ThemePreference>('system');
  const [hasLoadedInitialState, setHasLoadedInitialState] = React.useState(false);

  const activeThemePreference = hasAdaptiveThemes
    ? 'system'
    : themePreference === 'system'
      ? theme
      : themePreference;

  const modelOptions = React.useMemo(() => {
    if (!settings.model || availableModels.some((model) => model.value === settings.model)) {
      return availableModels;
    }

    return [{ label: settings.model, value: settings.model }, ...availableModels];
  }, [availableModels, settings.model]);

  const filteredModelOptions = React.useMemo(() => {
    const query = settings.model.trim();

    return modelOptions
      .map((model) => ({ model, score: getFuzzyModelScore(query, model) }))
      .filter((entry): entry is { model: ModelOption; score: number } => entry.score !== null)
      .sort((left, right) => {
        if (left.score !== right.score) {
          return left.score - right.score;
        }

        return left.model.label.localeCompare(right.model.label);
      })
      .slice(0, 5)
      .map((entry) => entry.model);
  }, [modelOptions, settings.model]);

  const shouldShowModelSuggestions =
    isModelInputFocused &&
    (filteredModelOptions.length > 0 || isLoadingModels || Boolean(modelLoadError));

  React.useEffect(() => {
    let cancelled = false;
    const task = InteractionManager.runAfterInteractions(() => {
      void (async () => {
        const nextSettings = await loadProviderSettings();
        const storedThemePreference = await loadThemePreference();
        if (!cancelled) {
          setSettings(nextSettings);
          setThemePreference(storedThemePreference);
          setHasLoadedInitialState(true);
        }
      })();
    });

    return () => {
      cancelled = true;
      task.cancel();
      if (modelBlurTimeoutRef.current) {
        clearTimeout(modelBlurTimeoutRef.current);
      }
    };
  }, []);

  React.useEffect(() => {
    if (!hasLoadedInitialState) {
      return;
    }

    let interactionTask: ReturnType<typeof InteractionManager.runAfterInteractions> | null = null;
    const timer = setTimeout(() => {
      interactionTask = InteractionManager.runAfterInteractions(() => {
        void refreshModels(settings);
      });
    }, 350);

    return () => {
      clearTimeout(timer);
      interactionTask?.cancel();
    };
  }, [hasLoadedInitialState, settings.apiKey, settings.baseUrl]);

  async function refreshModels(form: SettingsForm) {
    setIsLoadingModels(true);
    const result = await loadAvailableModels(form);
    setAvailableModels(result.models);
    setModelLoadError(result.error);
    setIsLoadingModels(false);
  }

  async function saveSettings() {
    const parsedSettings = settingsSchema.safeParse(settings);
    if (!parsedSettings.success) {
      setSettingsError(parsedSettings.error.issues[0]?.message ?? 'Update the provider settings.');
      return;
    }

    await saveProviderSettings(parsedSettings.data);
    setSettings(parsedSettings.data);
    setSettingsError(null);
    router.back();
  }

  async function selectTheme(nextThemePreference: ThemePreference) {
    if (nextThemePreference === themePreference) {
      return;
    }

    setThemePreference(nextThemePreference);
    Uniwind.setTheme(nextThemePreference);
    void Haptics.selectionAsync();
    await saveThemePreference(nextThemePreference);
  }

  return (
    <>
      <StyledSafeAreaView className="bg-background flex-1" edges={['left', 'right', 'bottom']}>
        <View
          className="border-border bg-background flex-row items-center gap-2 px-4 pb-3"
          style={{ paddingTop: insets.top + 8 }}>
          <Button
            size="icon"
            variant="ghost"
            className="rounded-xl"
            onPress={() => router.back()}
            accessibilityLabel="Go back">
            <Icon as={ChevronLeft} className="text-foreground size-6" />
          </Button>
          <Text className="text-xl font-medium tracking-tight">Settings</Text>
        </View>

        <ScrollView
          className="flex-1"
          contentContainerStyle={{ padding: 16, paddingTop: 16, gap: 24 }}>
          <View className="gap-4">
            <View className="gap-3">
              <View className="gap-1">
                <Text className="text-lg font-semibold">Appearance</Text>
                <Text className="text-muted-foreground text-sm">
                  Choose whether the app follows the system theme or stays fixed.
                </Text>
              </View>

              <Tabs
                value={activeThemePreference}
                onValueChange={(value) => void selectTheme(value as ThemePreference)}>
                <TabsList>
                  <TabsTrigger value="system">
                    <Text
                      className={
                        activeThemePreference === 'system' ? 'text-primary-foreground' : ''
                      }>
                      System
                    </Text>
                  </TabsTrigger>
                  <TabsTrigger value="light">
                    <Text
                      className={
                        activeThemePreference === 'light' ? 'text-primary-foreground' : ''
                      }>
                      Light
                    </Text>
                  </TabsTrigger>
                  <TabsTrigger value="dark">
                    <Text
                      className={activeThemePreference === 'dark' ? 'text-primary-foreground' : ''}>
                      Dark
                    </Text>
                  </TabsTrigger>
                </TabsList>
              </Tabs>
            </View>

            <View className="gap-1">
              <Text className="text-lg font-semibold">Provider</Text>
              <Text className="text-muted-foreground text-sm">
                Configure the endpoint, key, and model the chat screen should use.
              </Text>
            </View>

            <View className="gap-2">
              <Text className="text-sm font-medium">Base URL</Text>
              <Input
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="url"
                placeholder="https://api.openai.com/v1"
                value={settings.baseUrl}
                onChangeText={(value) => {
                  setSettingsError(null);
                  setSettings((current) => ({ ...current, baseUrl: value }));
                }}
              />
            </View>

            <View className="gap-2">
              <Text className="text-sm font-medium">API Key</Text>
              <Input
                autoCapitalize="none"
                autoCorrect={false}
                secureTextEntry
                placeholder="sk-..."
                value={settings.apiKey}
                onChangeText={(value) => {
                  setSettingsError(null);
                  setSettings((current) => ({ ...current, apiKey: value }));
                }}
              />
            </View>

            <View className="gap-2">
              <Text className="text-sm font-medium">Model</Text>
              <View className="relative z-20">
                {shouldShowModelSuggestions ? (
                  <View className="border-border bg-card absolute top-full right-0 left-0 mt-2 max-h-52 overflow-hidden rounded-xl border shadow-lg shadow-black/5">
                    <ScrollView nestedScrollEnabled keyboardShouldPersistTaps="handled">
                      {isLoadingModels ? (
                        <View className="px-3 py-3">
                          <Text className="text-muted-foreground text-sm">
                            Loading models from your provider...
                          </Text>
                        </View>
                      ) : null}

                      {!isLoadingModels && modelLoadError ? (
                        <View className="px-3 py-3">
                          <Text className="text-muted-foreground text-sm">{modelLoadError}</Text>
                        </View>
                      ) : null}

                      {!isLoadingModels && !modelLoadError
                        ? filteredModelOptions.map((model) => (
                            <Pressable
                              key={model.value}
                              className="active:bg-accent border-border border-b px-3 py-3 last:border-b-0"
                              onPress={() => {
                                if (modelBlurTimeoutRef.current) {
                                  clearTimeout(modelBlurTimeoutRef.current);
                                }

                                setSettingsError(null);
                                setSettings((current) => ({ ...current, model: model.value }));
                                setIsModelInputFocused(false);
                              }}>
                              <Text className="text-sm">{model.label}</Text>
                            </Pressable>
                          ))
                        : null}
                    </ScrollView>
                  </View>
                ) : null}

                <View className="w-full gap-2">
                  <Input
                    autoCapitalize="none"
                    autoCorrect={false}
                    placeholder={
                      isLoadingModels ? 'Loading models...' : 'Search or enter a model ID'
                    }
                    value={settings.model}
                    onFocus={() => {
                      if (modelBlurTimeoutRef.current) {
                        clearTimeout(modelBlurTimeoutRef.current);
                      }

                      setIsModelInputFocused(true);
                    }}
                    onBlur={() => {
                      modelBlurTimeoutRef.current = setTimeout(() => {
                        setIsModelInputFocused(false);
                      }, 120);
                    }}
                    onChangeText={(value) => {
                      setSettingsError(null);
                      setIsModelInputFocused(true);
                      setSettings((current) => ({ ...current, model: value }));
                    }}
                    className="w-full"
                  />
                  <Button
                    variant="outline"
                    size="sm"
                    onPress={() => void refreshModels(settings)}
                    className="w-full">
                    <Icon as={RotateCwIcon} className="text-foreground mr-2 size-4" />
                    <Text>Refresh Models</Text>
                  </Button>
                </View>
              </View>
            </View>
          </View>

          {settingsError ? <Text className="text-destructive text-sm">{settingsError}</Text> : null}

          <View className="mt-2 flex-row gap-2">
            <Button variant="outline" className="flex-1" onPress={() => router.back()}>
              <Text>Cancel</Text>
            </Button>
            <Button className="flex-1" onPress={() => void saveSettings()}>
              <Text>Save</Text>
            </Button>
          </View>
        </ScrollView>
      </StyledSafeAreaView>
    </>
  );
}
