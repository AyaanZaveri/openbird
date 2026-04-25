import { Button } from '@/components/ui/button';
import {
  BottomSheet,
  BottomSheetFlatList,
  BottomSheetHeader,
  BottomSheetInput,
  BottomSheetTitle,
  BottomSheetDescription,
} from '@/components/ui/bottom-sheet';
import { Icon } from '@/components/ui/icon';
import { Text } from '@/components/ui/text';
import {
  getFuzzyModelScore,
  loadAvailableModels,
  type ModelOption,
  type SettingsForm,
} from '@/lib/provider-settings';
import { cn } from '@/lib/utils';
import { Check, RotateCwIcon, X } from 'lucide-react-native';
import * as React from 'react';
import { InteractionManager, Platform, Pressable, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

type ModelBottomSheetProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  settings: SettingsForm;
  value: string;
  onSelect: (model: string) => void;
};

type ModelRow =
  | { key: string; type: 'typed'; label: string; value: string }
  | { key: string; type: 'model'; label: string; value: string; isLast: boolean };

export function ModelBottomSheet({
  open,
  onOpenChange,
  settings,
  value,
  onSelect,
}: ModelBottomSheetProps) {
  const insets = useSafeAreaInsets();
  const { height: windowHeight } = useWindowDimensions();
  const bottomSheetRef = React.useRef<any>(null);
  const [availableModels, setAvailableModels] = React.useState<ModelOption[]>([]);
  const [isLoadingModels, setIsLoadingModels] = React.useState(false);
  const [modelLoadError, setModelLoadError] = React.useState<string | null>(null);
  const [modelSearch, setModelSearch] = React.useState('');
  const [searchInputResetKey, setSearchInputResetKey] = React.useState(0);

  React.useEffect(() => {
    if (open) {
      setModelSearch('');
      setSearchInputResetKey((current) => current + 1);
      bottomSheetRef.current?.present();
      return;
    }

    bottomSheetRef.current?.dismiss();
  }, [open]);

  const refreshModels = React.useCallback(async () => {
    setIsLoadingModels(true);
    const result = await loadAvailableModels(settings);
    setAvailableModels(result.models);
    setModelLoadError(result.error);
    setIsLoadingModels(false);
  }, [settings]);

  React.useEffect(() => {
    if (!open) {
      return;
    }

    const task = InteractionManager.runAfterInteractions(() => {
      void refreshModels();
    });

    return () => task.cancel();
  }, [open, refreshModels, settings.apiKey, settings.baseUrl]);

  const normalizedModelSearch = React.useMemo(() => modelSearch.trim(), [modelSearch]);

  const modelOptions = React.useMemo(() => {
    if (!value || availableModels.some((model) => model.value === value)) {
      return availableModels;
    }

    return [{ label: value, value }, ...availableModels];
  }, [availableModels, value]);

  const filteredModelOptions = React.useMemo(() => {
    const query = normalizedModelSearch;

    return modelOptions
      .map((model) => ({ model, score: getFuzzyModelScore(query, model) }))
      .filter((entry): entry is { model: ModelOption; score: number } => entry.score !== null)
      .sort((left, right) => {
        if (left.score !== right.score) {
          return left.score - right.score;
        }

        return left.model.label.localeCompare(right.model.label);
      })
      .map((entry) => entry.model);
  }, [modelOptions, normalizedModelSearch]);

  const shouldShowUseTypedModel =
    normalizedModelSearch.length > 0 &&
    !modelOptions.some((model) => model.value === normalizedModelSearch);

  const modelRows = React.useMemo(() => {
    const rows: ModelRow[] = [];

    if (shouldShowUseTypedModel) {
      rows.push({
        key: `typed-${normalizedModelSearch}`,
        type: 'typed',
        label: `Use "${normalizedModelSearch}"`,
        value: normalizedModelSearch,
      });
    }

    filteredModelOptions.forEach((model, index) => {
      rows.push({
        key: model.value,
        type: 'model',
        label: model.label,
        value: model.value,
        isLast: index === filteredModelOptions.length - 1,
      });
    });

    return rows;
  }, [filteredModelOptions, normalizedModelSearch, shouldShowUseTypedModel]);

  const modelSheetSnapPoints = React.useMemo(
    () => ['65%', Math.min(windowHeight - insets.top - 16, 960)],
    [insets.top, windowHeight]
  );

  const renderModelRow = React.useCallback(
    ({ item, index }: { item: ModelRow; index: number }) => (
      <Pressable
        className={cn(
          'active:bg-accent flex-row items-center justify-between rounded-md px-4 py-3.5',
          index % 2 === 0 ? 'bg-card' : 'bg-muted/50'
        )}
        onPress={() => {
          onSelect(item.value);
          onOpenChange(false);
        }}>
        <Text className={item.type === 'typed' ? 'text-sm font-medium' : 'text-sm'}>
          {item.label}
        </Text>
        {item.value === value ? <Icon as={Check} className="text-foreground size-4" /> : null}
      </Pressable>
    ),
    [onOpenChange, onSelect, value]
  );

  return (
    <BottomSheet
      ref={bottomSheetRef}
      onDismiss={() => onOpenChange(false)}
      enableDynamicSizing={false}
      enablePanDownToClose={false}
      keyboardBehavior={Platform.OS === 'android' ? 'fillParent' : 'interactive'}
      android_keyboardInputMode="adjustResize"
      snapPoints={modelSheetSnapPoints}>
      <View className="flex-1">
        <View className="bg-card border-x border-border px-5 pt-1 pb-3">
          <BottomSheetHeader>
            <BottomSheetTitle>Choose Model</BottomSheetTitle>
            <BottomSheetDescription>
              Search your provider models or enter a custom model ID.
            </BottomSheetDescription>
          </BottomSheetHeader>

          <View className="mt-4 flex-row items-center gap-2">
            <View className="border-input bg-card min-w-0 flex-1 flex-row items-center gap-2 rounded-xl border pr-1.5 pl-3">
              <BottomSheetInput
                key={`model-search-${searchInputResetKey}`}
                autoCapitalize="none"
                autoCorrect={false}
                defaultValue={modelSearch}
                placeholder="Search or enter a model ID"
                onChangeText={setModelSearch}
                style={{
                  flex: 1,
                  minHeight: 44,
                  borderWidth: 0,
                  backgroundColor: 'transparent',
                  paddingHorizontal: 0,
                }}
              />

              {normalizedModelSearch.length > 0 ? (
                <Button
                  variant="ghost"
                  size="icon"
                  onPress={() => {
                    setModelSearch('');
                    setSearchInputResetKey((current) => current + 1);
                  }}
                  className="size-8 rounded-full"
                  style={{ width: 32, height: 32 }}>
                  <Icon as={X} className="text-muted-foreground size-4" />
                </Button>
              ) : null}
            </View>

            <Button
              variant="outline"
              size="icon"
              onPress={() => void refreshModels()}
              className="rounded-xl"
              style={{ width: 44, height: 44 }}>
              <Icon as={RotateCwIcon} className="text-foreground size-4" />
            </Button>
          </View>
        </View>

        <BottomSheetFlatList
          data={modelRows}
          keyExtractor={(item) => item.key}
          keyboardShouldPersistTaps="always"
          contentContainerStyle={{ paddingHorizontal: 12, paddingBottom: insets.bottom + 12, paddingTop: 4, gap: 2 }}
          initialNumToRender={20}
          maxToRenderPerBatch={20}
          windowSize={8}
          ListEmptyComponent={
            isLoadingModels ? (
              <View className="px-5 py-3">
                <Text className="text-muted-foreground text-sm">
                  Loading models from your provider...
                </Text>
              </View>
            ) : modelLoadError ? (
              <View className="px-5 py-3">
                <Text className="text-muted-foreground text-sm">{modelLoadError}</Text>
              </View>
            ) : (
              <View className="px-5 py-3">
                <Text className="text-muted-foreground text-sm">No models match your search.</Text>
              </View>
            )
          }
          renderItem={renderModelRow}
        />
      </View>
    </BottomSheet>
  );
}
