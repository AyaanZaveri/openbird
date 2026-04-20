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
import { Check, RotateCwIcon, X } from 'lucide-react-native';
import * as React from 'react';
import { Pressable, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

type ModelBottomSheetProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  settings: SettingsForm;
  value: string;
  onSelect: (model: string) => void;
};

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

  React.useEffect(() => {
    if (open) {
      bottomSheetRef.current?.present();
      setModelSearch('');
    } else {
      bottomSheetRef.current?.dismiss();
    }
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

    const timer = setTimeout(() => {
      void refreshModels();
    }, 250);

    return () => clearTimeout(timer);
  }, [open, refreshModels, settings.apiKey, settings.baseUrl]);

  const modelOptions = React.useMemo(() => {
    if (!value || availableModels.some((model) => model.value === value)) {
      return availableModels;
    }

    return [{ label: value, value }, ...availableModels];
  }, [availableModels, value]);

  const filteredModelOptions = React.useMemo(() => {
    const query = modelSearch.trim();

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
  }, [modelOptions, modelSearch]);

  const shouldShowUseTypedModel =
    modelSearch.trim().length > 0 &&
    !modelOptions.some((model) => model.value === modelSearch.trim());

  const modelRows = React.useMemo(() => {
    const rows: Array<
      | { key: string; type: 'typed'; label: string; value: string }
      | { key: string; type: 'model'; label: string; value: string; isLast: boolean }
    > = [];

    if (shouldShowUseTypedModel) {
      rows.push({
        key: `typed-${modelSearch.trim()}`,
        type: 'typed',
        label: `Use "${modelSearch.trim()}"`,
        value: modelSearch.trim(),
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
  }, [filteredModelOptions, modelSearch, shouldShowUseTypedModel]);

  const modelSheetSnapPoints = React.useMemo(
    () => ['65%', Math.min(windowHeight - insets.top - 16, 960)],
    [insets.top, windowHeight]
  );

  return (
    <BottomSheet
      ref={bottomSheetRef}
      onDismiss={() => onOpenChange(false)}
      enableDynamicSizing={false}
      enablePanDownToClose={false}
      keyboardBehavior="extend"
      snapPoints={modelSheetSnapPoints}>
      <BottomSheetFlatList
        data={modelRows}
        keyExtractor={(item) => item.key}
        keyboardShouldPersistTaps="handled"
        stickyHeaderIndices={[0]}
        contentContainerStyle={{ paddingBottom: insets.bottom + 8 }}
        ListHeaderComponent={
          <View className="bg-card px-5 pt-1 pb-3">
            <BottomSheetHeader>
              <BottomSheetTitle>Choose Model</BottomSheetTitle>
              <BottomSheetDescription>
                Search your provider models or enter a custom model ID.
              </BottomSheetDescription>
            </BottomSheetHeader>

            <View className="mt-4 flex-row items-center gap-2">
              <View className="border-input bg-background min-w-0 flex-1 flex-row items-center gap-2 rounded-xl border pr-1.5 pl-3">
                <BottomSheetInput
                  autoCapitalize="none"
                  autoCorrect={false}
                  placeholder={'Search or enter a model ID'}
                  value={modelSearch}
                  onChangeText={setModelSearch}
                  style={{
                    flex: 1,
                    minHeight: 44,
                    borderWidth: 0,
                    backgroundColor: 'transparent',
                    paddingHorizontal: 0,
                  }}
                />

                {modelSearch.length > 0 ? (
                  <Button
                    variant="ghost"
                    size="icon"
                    onPress={() => setModelSearch('')}
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
        }
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
        renderItem={({ item }) => (
          <Pressable
            className="active:bg-accent border-border flex-row items-center justify-between px-5 py-4"
            style={{ borderBottomWidth: item.type === 'model' && item.isLast ? 0 : 1 }}
            onPress={() => {
              onSelect(item.value);
              onOpenChange(false);
            }}>
            <Text className={item.type === 'typed' ? 'text-sm font-medium' : 'text-sm'}>
              {item.label}
            </Text>
            {item.value === value ? <Icon as={Check} className="text-foreground size-4" /> : null}
          </Pressable>
        )}
      />
    </BottomSheet>
  );
}
