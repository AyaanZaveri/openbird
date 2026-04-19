import { Icon } from '@/components/ui/icon';
import { NativeOnlyAnimatedView } from '@/components/ui/native-only-animated-view';
import { cn } from '@/lib/utils';
import * as SelectPrimitive from '@rn-primitives/select';
import { Check, ChevronDown } from 'lucide-react-native';
import * as React from 'react';
import { Platform, View, type ViewProps } from 'react-native';
import { FadeIn, FadeOut } from 'react-native-reanimated';
import { FullWindowOverlay as RNFullWindowOverlay } from 'react-native-screens';

const Select = SelectPrimitive.Root;
const SelectGroup = SelectPrimitive.Group;
const SelectLabel = SelectPrimitive.Label;
const SelectValue = SelectPrimitive.Value;

const FullWindowOverlay = Platform.OS === 'ios' ? RNFullWindowOverlay : React.Fragment;

function SelectTrigger({
  className,
  children,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Trigger>) {
  return (
    <SelectPrimitive.Trigger
      className={cn(
        'border-input bg-background flex min-h-11 w-full flex-row items-center justify-between rounded-xl border px-3 py-2',
        props.disabled && 'opacity-50',
        className
      )}
      {...props}>
      {children as React.ReactNode}
      <Icon as={ChevronDown} className="text-muted-foreground size-4" />
    </SelectPrimitive.Trigger>
  );
}

function SelectContent({
  className,
  children,
  portalHost,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Content> & {
  portalHost?: string;
}) {
  return (
    <SelectPrimitive.Portal hostName={portalHost}>
      <FullWindowOverlay>
        <SelectPrimitive.Overlay asChild={Platform.OS !== 'web'} closeOnPress>
          <NativeOnlyAnimatedView entering={FadeIn.duration(200)} exiting={FadeOut.duration(150)}>
            <View className="absolute top-0 right-0 bottom-0 left-0 bg-black/50" />
          </NativeOnlyAnimatedView>
        </SelectPrimitive.Overlay>

        <SelectPrimitive.Content
          className={cn(
            'border-border bg-popover z-50 overflow-hidden rounded-xl border p-1 shadow-lg shadow-black/5',
            className
          )}
          {...props}>
          <SelectPrimitive.Viewport>{children}</SelectPrimitive.Viewport>
        </SelectPrimitive.Content>
      </FullWindowOverlay>
    </SelectPrimitive.Portal>
  );
}

function SelectItem({
  className,
  children,
  label,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Item>) {
  return (
    <SelectPrimitive.Item
      className={cn(
        'active:bg-accent flex-row items-center justify-between rounded-lg px-3 py-3',
        Platform.select({ web: 'hover:bg-accent cursor-default outline-none' }),
        className
      )}
      label={label}
      {...props}>
      {children as React.ReactNode}
      <SelectPrimitive.ItemIndicator>
        <Icon as={Check} className="text-foreground size-4" />
      </SelectPrimitive.ItemIndicator>
    </SelectPrimitive.Item>
  );
}

function SelectGroupLabel({ className, ...props }: React.ComponentProps<typeof SelectLabel>) {
  return (
    <SelectLabel
      className={cn('text-muted-foreground px-3 py-2 text-xs font-medium', className)}
      {...props}
    />
  );
}

function SelectDisplayValue({
  className,
  placeholder,
  ...props
}: React.ComponentProps<typeof SelectValue>) {
  return (
    <SelectValue
      className={cn('text-sm', className)}
      placeholder={placeholder}
      numberOfLines={1}
      {...props}
    />
  );
}

function SelectSeparator({ className, ...props }: ViewProps) {
  return <View className={cn('bg-border my-1 h-px', className)} {...props} />;
}

export {
  Select,
  SelectContent,
  SelectDisplayValue,
  SelectGroup,
  SelectGroupLabel,
  SelectItem,
  SelectSeparator,
  SelectTrigger,
};
