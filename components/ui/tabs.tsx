import { TextClassContext } from '@/components/ui/text';
import { THEME } from '@/lib/theme';
import { cn } from '@/lib/utils';
import * as TabsPrimitive from '@rn-primitives/tabs';
import * as React from 'react';
import { Platform, type LayoutChangeEvent } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { useUniwind } from 'uniwind';

const TabsValueContext = React.createContext<string>('');

function Tabs({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.Root>) {
  return (
    <TabsValueContext.Provider value={props.value}>
      <TabsPrimitive.Root className={cn('w-full gap-3', className)} {...props} />
    </TabsValueContext.Provider>
  );
}

function TabsList({
  className,
  children,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.List>) {
  const { theme } = useUniwind();
  const palette = THEME[theme ?? 'light'];
  const activeValue = React.useContext(TabsValueContext);
  const indicatorIndex = useSharedValue(0);
  const hasAnimatedRef = React.useRef(false);
  const [containerWidth, setContainerWidth] = React.useState(0);

  const triggerValues = React.useMemo(
    () =>
      React.Children.toArray(children)
        .map((child) =>
          React.isValidElement<{ value?: string }>(child) ? child.props.value : undefined
        )
        .filter((value): value is string => typeof value === 'string'),
    [children]
  );

  const activeIndex = React.useMemo(() => {
    const index = triggerValues.findIndex((value) => value === activeValue);
    return index >= 0 ? index : 0;
  }, [activeValue, triggerValues]);

  React.useEffect(() => {
    if (containerWidth === 0) {
      return;
    }

    if (!hasAnimatedRef.current) {
      indicatorIndex.value = activeIndex;
      hasAnimatedRef.current = true;
      return;
    }

    indicatorIndex.value = withTiming(activeIndex, {
      duration: 220,
      easing: Easing.out(Easing.cubic),
    });
  }, [activeIndex, containerWidth, indicatorIndex]);

  const handleLayout = React.useCallback((event: LayoutChangeEvent) => {
    setContainerWidth(event.nativeEvent.layout.width);
  }, []);

  const indicatorStyle = useAnimatedStyle(() => {
    const horizontalInset = 4;
    const availableWidth = Math.max(containerWidth - horizontalInset * 2, 0);
    const tabWidth = triggerValues.length > 0 ? availableWidth / triggerValues.length : 0;

    return {
      width: tabWidth,
      transform: [
        {
          translateX: horizontalInset + indicatorIndex.value * tabWidth,
        },
      ],
    };
  }, [containerWidth, triggerValues.length]);

  return (
    <TabsPrimitive.List
      onLayout={handleLayout}
      className={cn('bg-card border-border flex-row rounded-xl border p-1', className)}
      {...props}>
      {triggerValues.length > 0 ? (
        <Animated.View
          pointerEvents="none"
          style={[
            {
              position: 'absolute',
              top: 4,
              bottom: 4,
              borderRadius: 10,
              backgroundColor: palette.primary,
            },
            indicatorStyle,
          ]}
        />
      ) : null}
      {children}
    </TabsPrimitive.List>
  );
}

function TabsTrigger({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.Trigger>) {
  const textClassName = cn(
    'text-foreground text-center text-sm font-medium',
    Platform.select({ web: 'transition-colors' })
  );

  return (
    <TextClassContext.Provider value={textClassName}>
      <TabsPrimitive.Trigger
        className={cn(
          'z-10 flex-1 rounded-lg px-3 py-2.5',
          Platform.select({ web: 'outline-none' }),
          className
        )}
        {...props}
      />
    </TextClassContext.Provider>
  );
}

function TabsContent({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.Content>) {
  return <TabsPrimitive.Content className={cn('w-full', className)} {...props} />;
}

export { Tabs, TabsContent, TabsList, TabsTrigger };
