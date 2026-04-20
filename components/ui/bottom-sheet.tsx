import { Text } from '@/components/ui/text';
import { cn } from '@/lib/utils';
import { THEME } from '@/lib/theme';
import {
  BottomSheetBackdrop as BottomSheetBackdropPrimitive,
  BottomSheetFlatList as BottomSheetFlatListPrimitive,
  BottomSheetFooter as BottomSheetFooterPrimitive,
  BottomSheetModal as BottomSheetModalPrimitive,
  BottomSheetScrollView as BottomSheetScrollViewPrimitive,
  BottomSheetTextInput as BottomSheetTextInputPrimitive,
  BottomSheetView,
  type BottomSheetBackdropProps,
  type BottomSheetFooterProps,
  type BottomSheetModalProps,
} from '@gorhom/bottom-sheet';
import * as React from 'react';
import {
  Platform,
  StyleSheet,
  View,
  type StyleProp,
  type TextInputProps,
  type ViewProps,
  type ViewStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useUniwind } from 'uniwind';

const INPUT_PLACEHOLDER_COLOR = '#8a8a8a';

const BottomSheet = React.forwardRef<BottomSheetModalPrimitive, BottomSheetModalProps>(
  (
    {
      backdropComponent,
      backgroundStyle,
      children,
      enableDismissOnClose = true,
      enableDynamicSizing = true,
      enablePanDownToClose = true,
      handleIndicatorStyle,
      keyboardBehavior = 'interactive',
      keyboardBlurBehavior = 'restore',
      enableBlurKeyboardOnGesture = true,
      topInset,
      ...props
    },
    ref
  ) => {
    const { theme } = useUniwind();
    const { top } = useSafeAreaInsets();
    const palette = THEME[theme ?? 'light'];

    const renderBackdrop = React.useCallback(
      (backdropProps: BottomSheetBackdropProps) => (
        <BottomSheetBackdropPrimitive
          {...backdropProps}
          appearsOnIndex={0}
          disappearsOnIndex={-1}
          opacity={0.5}
          pressBehavior="close"
        />
      ),
      []
    );

    return (
      <BottomSheetModalPrimitive
        ref={ref}
        backdropComponent={backdropComponent ?? renderBackdrop}
        backgroundStyle={[
          {
            backgroundColor: palette.card,
            borderColor: palette.border,
            borderWidth: 1,
          },
          backgroundStyle,
        ]}
        enableBlurKeyboardOnGesture={enableBlurKeyboardOnGesture}
        enableDismissOnClose={enableDismissOnClose}
        enableDynamicSizing={enableDynamicSizing}
        enablePanDownToClose={enablePanDownToClose}
        handleIndicatorStyle={[
          { backgroundColor: palette.mutedForeground, width: 36 },
          handleIndicatorStyle,
        ]}
        keyboardBehavior={keyboardBehavior}
        keyboardBlurBehavior={keyboardBlurBehavior}
        topInset={topInset ?? top}
        {...props}>
        {children}
      </BottomSheetModalPrimitive>
    );
  }
);

BottomSheet.displayName = 'BottomSheet';

function BottomSheetContent({
  className,
  style,
  ...props
}: React.ComponentProps<typeof BottomSheetView>) {
  const { bottom } = useSafeAreaInsets();

  return (
    <BottomSheetView
      className={cn('px-5 pt-1', className)}
      style={[{ paddingBottom: bottom + 24 }, style]}
      {...props}
    />
  );
}

function BottomSheetHeader({ className, ...props }: ViewProps) {
  return <View className={cn('gap-1', className)} {...props} />;
}

function BottomSheetTitle({ className, ...props }: React.ComponentProps<typeof Text>) {
  return <Text className={cn('text-lg font-semibold', className)} {...props} />;
}

function BottomSheetDescription({ className, ...props }: React.ComponentProps<typeof Text>) {
  return <Text className={cn('text-muted-foreground text-sm', className)} {...props} />;
}

function BottomSheetFooter({
  children,
  containerStyle,
  ...props
}: BottomSheetFooterProps & { children: React.ReactNode; containerStyle?: StyleProp<ViewStyle> }) {
  const { bottom } = useSafeAreaInsets();

  return (
    <BottomSheetFooterPrimitive {...props} bottomInset={bottom + 12}>
      <View className="border-border bg-card border-t px-5 pt-3" style={containerStyle}>
        {children}
      </View>
    </BottomSheetFooterPrimitive>
  );
}

function BottomSheetFooterActions({ className, ...props }: ViewProps) {
  return <View className={cn('flex-row gap-2', className)} {...props} />;
}

function BottomSheetInput({ style, placeholderTextColor, ...props }: TextInputProps) {
  const { theme } = useUniwind();
  const palette = THEME[theme ?? 'light'];

  return (
    <BottomSheetTextInputPrimitive
      placeholderTextColor={placeholderTextColor ?? INPUT_PLACEHOLDER_COLOR}
      style={[
        styles.input,
        {
          backgroundColor: palette.background,
          borderColor: palette.input,
          color: palette.foreground,
          fontFamily: 'Inter_400Regular',
        },
        style,
      ]}
      {...props}
    />
  );
}

function BottomSheetScrollView({
  ...props
}: React.ComponentProps<typeof BottomSheetScrollViewPrimitive>) {
  return <BottomSheetScrollViewPrimitive {...props} />;
}

function BottomSheetFlatList<ItemT>({
  ...props
}: React.ComponentProps<typeof BottomSheetFlatListPrimitive<ItemT>>) {
  return <BottomSheetFlatListPrimitive {...props} />;
}

const styles = StyleSheet.create({
  input: {
    minHeight: 44,
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
    lineHeight: Platform.OS === 'ios' ? 20 : 22,
    paddingTop: Platform.OS === 'ios' ? 8 : 10,
    paddingBottom: Platform.OS === 'ios' ? 10 : 10,
  },
});

export {
  BottomSheet,
  BottomSheetContent,
  BottomSheetDescription,
  BottomSheetFlatList,
  BottomSheetFooter,
  BottomSheetFooterActions,
  BottomSheetHeader,
  BottomSheetInput,
  BottomSheetScrollView,
  BottomSheetTitle,
};
