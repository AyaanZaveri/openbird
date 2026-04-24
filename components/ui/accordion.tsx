import { Icon } from '@/components/ui/icon';
import { TextClassContext } from '@/components/ui/text';
import { cn } from '@/lib/utils';
import { ChevronDown } from 'lucide-react-native';
import * as React from 'react';
import { Pressable, View } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useDerivedValue,
  withTiming,
} from 'react-native-reanimated';

type AccordionType = 'single' | 'multiple';

type AccordionRootProps = {
  children?: React.ReactNode;
  className?: string;
  type: AccordionType;
  collapsible?: boolean;
  defaultValue?: string | string[];
  value?: string | string[];
  onValueChange?: ((value: string | undefined) => void) | ((value: string[]) => void);
};

type AccordionContextValue = {
  type: AccordionType;
  collapsible: boolean;
  expandedValues: string[];
  toggleValue: (value: string) => void;
};

type AccordionItemContextValue = {
  value: string;
  isExpanded: boolean;
};

const AccordionContext = React.createContext<AccordionContextValue | null>(null);
const AccordionItemContext = React.createContext<AccordionItemContextValue | null>(null);

function normalizeValues(type: AccordionType, value?: string | string[]) {
  if (value === undefined) {
    return [];
  }

  if (Array.isArray(value)) {
    return type === 'multiple' ? value : value.slice(0, 1);
  }

  return value ? [value] : [];
}

function useAccordionContext() {
  const context = React.useContext(AccordionContext);

  if (!context) {
    throw new Error('Accordion components must be used within Accordion');
  }

  return context;
}

function useAccordionItemContext() {
  const context = React.useContext(AccordionItemContext);

  if (!context) {
    throw new Error('Accordion components must be used within AccordionItem');
  }

  return context;
}

function Accordion({
  children,
  className,
  type,
  collapsible = true,
  defaultValue,
  value,
  onValueChange,
}: AccordionRootProps) {
  const isControlled = value !== undefined;
  const [uncontrolledValue, setUncontrolledValue] = React.useState<string[]>(() =>
    normalizeValues(type, defaultValue)
  );
  const expandedValues = isControlled ? normalizeValues(type, value) : uncontrolledValue;

  const toggleValue = React.useCallback(
    (itemValue: string) => {
      if (type === 'single') {
        const isOpen = expandedValues[0] === itemValue;
        const nextValue = isOpen ? (collapsible ? undefined : itemValue) : itemValue;

        if (!isControlled) {
          setUncontrolledValue(nextValue ? [nextValue] : []);
        }

        (onValueChange as ((value: string | undefined) => void) | undefined)?.(nextValue);
        return;
      }

      const isOpen = expandedValues.includes(itemValue);
      const nextValues = isOpen
        ? expandedValues.filter((value) => value !== itemValue)
        : [...expandedValues, itemValue];

      if (!isControlled) {
        setUncontrolledValue(nextValues);
      }

      (onValueChange as ((value: string[]) => void) | undefined)?.(nextValues);
    },
    [collapsible, expandedValues, isControlled, onValueChange, type]
  );

  const contextValue = React.useMemo(
    () => ({
      type,
      collapsible,
      expandedValues,
      toggleValue,
    }),
    [collapsible, expandedValues, toggleValue, type]
  );

  return (
    <AccordionContext.Provider value={contextValue}>
      <View className={className}>{children}</View>
    </AccordionContext.Provider>
  );
}

function AccordionItem({
  children,
  className,
  value,
}: {
  children?: React.ReactNode;
  className?: string;
  value: string;
}) {
  const { expandedValues } = useAccordionContext();
  const isExpanded = expandedValues.includes(value);

  return (
    <AccordionItemContext.Provider value={{ value, isExpanded }}>
      <View className={cn('border-border border-b overflow-hidden', className)}>{children}</View>
    </AccordionItemContext.Provider>
  );
}

function AccordionTrigger({
  className,
  children,
  ...props
}: React.ComponentProps<typeof Pressable> & {
  children?: React.ReactNode;
}) {
  const { toggleValue } = useAccordionContext();
  const { value, isExpanded } = useAccordionItemContext();
  const progress = useDerivedValue(
    () => (isExpanded ? withTiming(1, { duration: 300 }) : withTiming(0, { duration: 240 })),
    [isExpanded]
  );
  const chevronStyle = useAnimatedStyle(
    () => ({
      transform: [{ rotate: `${progress.value * 180}deg` }],
    }),
    [progress]
  );

  return (
    <TextClassContext.Provider value="text-left text-sm font-medium">
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: isExpanded, disabled: props.disabled ?? undefined }}
        onPress={(event) => {
          toggleValue(value);
          props.onPress?.(event);
        }}
        className={cn(
          'flex-row items-center justify-between gap-3 rounded-xl py-2 disabled:opacity-50',
          className
        )}
        {...props}>
        <>{children}</>
        <Animated.View style={chevronStyle}>
          <Icon as={ChevronDown} size={16} className="text-muted-foreground shrink-0" />
        </Animated.View>
      </Pressable>
    </TextClassContext.Provider>
  );
}

function AccordionContent({
  className,
  children,
}: {
  className?: string;
  children?: React.ReactNode;
}) {
  const { isExpanded } = useAccordionItemContext();
  const [contentHeight, setContentHeight] = React.useState(0);
  const targetHeight = useDerivedValue(
    () => withTiming(isExpanded ? contentHeight : 0, { duration: isExpanded ? 300 : 240 }),
    [contentHeight, isExpanded]
  );
  const contentStyle = useAnimatedStyle(
    () => ({
      height: targetHeight.value,
      overflow: 'hidden',
    }),
    [targetHeight]
  );

  return (
    <TextClassContext.Provider value="text-sm">
      <View className="relative">
        <View
          pointerEvents="none"
          onLayout={(event) => {
            const nextHeight = Math.ceil(event.nativeEvent.layout.height) + 2;
            if (nextHeight !== contentHeight) {
              setContentHeight(nextHeight);
            }
          }}
          className={cn('absolute inset-x-0 top-0 opacity-0 pb-2', className)}>
          {children}
        </View>
        <Animated.View style={contentStyle}>
          <View className={cn('pb-2', className)}>{children}</View>
        </Animated.View>
      </View>
    </TextClassContext.Provider>
  );
}

export { Accordion, AccordionContent, AccordionItem, AccordionTrigger };
