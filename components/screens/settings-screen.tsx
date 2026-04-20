import { Button } from '@/components/ui/button';
import { ModelBottomSheet } from '@/components/model-bottom-sheet';
import {
  BottomSheet,
  BottomSheetContent,
  BottomSheetDescription,
  BottomSheetHeader,
  BottomSheetTitle,
} from '@/components/ui/bottom-sheet';
import { Icon } from '@/components/ui/icon';
import { Input } from '@/components/ui/input';
import { Text } from '@/components/ui/text';
import {
  defaultSettings,
  loadProviderSettings,
  saveProviderSettings,
  settingsSchema,
  type SettingsForm,
} from '@/lib/provider-settings';
import {
  loadThemePreference,
  saveThemePreference,
  type ThemePreference,
} from '@/lib/theme-preferences';
import * as Haptics from 'expo-haptics';
import { useRouter } from 'expo-router';
import { ChevronLeft, ChevronRight, Eclipse, Moon, Box, Sun, SunMoon } from 'lucide-react-native';
import * as React from 'react';
import { InteractionManager, ScrollView, View } from 'react-native';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Uniwind, useUniwind, withUniwind } from 'uniwind';
import { BlurView } from 'expo-blur';

const StyledSafeAreaView = withUniwind(SafeAreaView);

export function SettingsScreen() {
  const router = useRouter();
  const { theme, hasAdaptiveThemes } = useUniwind();
  const insets = useSafeAreaInsets();
  const [settings, setSettings] = React.useState<SettingsForm>(defaultSettings);
  const [settingsError, setSettingsError] = React.useState<string | null>(null);
  const [themePreference, setThemePreference] = React.useState<ThemePreference>('system');
  const [hasLoadedInitialState, setHasLoadedInitialState] = React.useState(false);
  const [isThemeSheetOpen, setIsThemeSheetOpen] = React.useState(false);
  const [isModelSheetOpen, setIsModelSheetOpen] = React.useState(false);
  const themeBottomSheetRef = React.useRef<any>(null);

  React.useEffect(() => {
    if (isThemeSheetOpen) {
      themeBottomSheetRef.current?.present();
    } else {
      themeBottomSheetRef.current?.dismiss();
    }
  }, [isThemeSheetOpen]);

  const activeThemePreference = hasAdaptiveThemes
    ? 'system'
    : themePreference === 'system'
      ? theme
      : themePreference;

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
    };
  }, []);

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

  function openModelSheet() {
    setIsModelSheetOpen(true);
  }

  function selectModel(modelValue: string) {
    setSettingsError(null);
    setSettings((current) => ({ ...current, model: modelValue }));
  }

  return (
    <>
      <StyledSafeAreaView className="bg-background flex-1" edges={['left', 'right', 'bottom']}>
        <KeyboardAvoidingView behavior="padding" className="flex-1">
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
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={{ padding: 16, paddingTop: 16, paddingBottom: 32, gap: 24 }}>
            <View className="gap-4">
              <View className="gap-3">
                <View className="gap-1">
                  <View className="flex-row items-center gap-2">
                    <Icon as={Eclipse} className="text-foreground size-5" />
                    <Text className="text-lg font-medium">Appearance</Text>
                  </View>
                  <Text className="text-muted-foreground text-sm">
                    Choose between system, light, or dark theme.
                  </Text>
                </View>

                <Button
                  variant="outline"
                  className="w-full justify-between"
                  onPress={() => setIsThemeSheetOpen(true)}>
                  <View className="flex-row items-center gap-2">
                    <Icon
                      as={
                        activeThemePreference === 'dark'
                          ? Moon
                          : activeThemePreference === 'light'
                            ? Sun
                            : SunMoon
                      }
                      className="text-foreground size-4"
                    />
                    <Text className="font-normal capitalize">{activeThemePreference}</Text>
                  </View>
                  <Icon as={ChevronRight} className="text-muted-foreground size-4" />
                </Button>
              </View>

              <View className="mt-2 gap-1">
                <View className="flex-row items-center gap-2">
                  <Icon as={Box} className="text-foreground size-5" />
                  <Text className="text-lg font-medium">Provider</Text>
                </View>
                <Text className="text-muted-foreground text-sm">
                  Configure the endpoint, key, and model.
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
                <View className="flex flex-row items-center gap-2">
                  <Button
                    variant="outline"
                    className="min-w-0 flex-1 justify-between"
                    onPress={openModelSheet}>
                    <Text
                      className={
                        settings.model
                          ? 'shrink pr-2 font-normal'
                          : 'text-muted-foreground shrink pr-2'
                      }
                      numberOfLines={1}>
                      {settings.model || 'Choose a model'}
                    </Text>
                    <Icon as={ChevronRight} className="text-muted-foreground size-4" />
                  </Button>
                </View>
              </View>
            </View>

            {settingsError ? (
              <Text className="text-destructive text-sm">{settingsError}</Text>
            ) : null}

            <View className="mt-2 flex-row gap-2">
              <Button variant="outline" className="flex-1" onPress={() => router.back()}>
                <Text>Cancel</Text>
              </Button>
              <Button className="flex-1" onPress={() => void saveSettings()}>
                <Text>Save</Text>
              </Button>
            </View>
          </ScrollView>
        </KeyboardAvoidingView>
      </StyledSafeAreaView>

      <BottomSheet
        ref={themeBottomSheetRef}
        onDismiss={() => setIsThemeSheetOpen(false)}
        enableDynamicSizing>
        <BottomSheetContent>
          <BottomSheetHeader>
            <BottomSheetTitle>Choose Theme</BottomSheetTitle>
            <BottomSheetDescription>Select your preferred appearance</BottomSheetDescription>
          </BottomSheetHeader>
          <View className="mt-4 gap-2">
            <Button
              variant={activeThemePreference === 'system' ? 'default' : 'outline'}
              className="w-full justify-start"
              onPress={() => {
                void selectTheme('system');
                setIsThemeSheetOpen(false);
              }}>
              <Icon as={SunMoon} className="mr-2 size-4" />
              <Text>System</Text>
            </Button>
            <Button
              variant={activeThemePreference === 'light' ? 'default' : 'outline'}
              className="w-full justify-start"
              onPress={() => {
                void selectTheme('light');
                setIsThemeSheetOpen(false);
              }}>
              <Icon as={Sun} className="mr-2 size-4" />
              <Text>Light</Text>
            </Button>
            <Button
              variant={activeThemePreference === 'dark' ? 'default' : 'outline'}
              className="w-full justify-start"
              onPress={() => {
                void selectTheme('dark');
                setIsThemeSheetOpen(false);
              }}>
              <Icon as={Moon} className="mr-2 size-4" />
              <Text>Dark</Text>
            </Button>
          </View>
        </BottomSheetContent>
      </BottomSheet>

      <ModelBottomSheet
        open={isModelSheetOpen}
        onOpenChange={setIsModelSheetOpen}
        settings={settings}
        value={settings.model}
        onSelect={selectModel}
      />
    </>
  );
}
