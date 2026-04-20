import { Icon } from '@/components/ui/icon';
import { TextClassContext } from '@/components/ui/text';
import { cn } from '@/lib/utils';
import * as AccordionPrimitive from '@rn-primitives/accordion';
import { ChevronDown } from 'lucide-react-native';
import * as React from 'react';
import { Platform, Pressable, View } from 'react-native';
import Animated, {
  FadeOutUp,
  LayoutAnimationConfig,
  LinearTransition,
  useAnimatedStyle,
  useDerivedValue,
  withTiming,
} from 'react-native-reanimated';

function Accordion(props: Omit<React.ComponentProps<typeof AccordionPrimitive.Root>, 'asChild'>) {
  return (
    <LayoutAnimationConfig skipEntering>
      <AccordionPrimitive.Root
        {...(props as AccordionPrimitive.RootProps)}
        asChild={Platform.OS !== 'web'}>
        <Animated.View layout={LinearTransition.duration(200)}>{props.children}</Animated.View>
      </AccordionPrimitive.Root>
    </LayoutAnimationConfig>
  );
}

function AccordionItem({
  children,
  className,
  value,
  ...props
}: React.ComponentProps<typeof AccordionPrimitive.Item>) {
  return (
    <AccordionPrimitive.Item value={value} asChild {...props}>
      <Animated.View
        className={cn('native:overflow-hidden', className)}
        layout={Platform.select({ native: LinearTransition.duration(200) })}>
        {children}
      </Animated.View>
    </AccordionPrimitive.Item>
  );
}

const Trigger = Platform.OS === 'web' ? View : Pressable;

function AccordionTrigger({
  className,
  children,
  ...props
}: React.ComponentProps<typeof AccordionPrimitive.Trigger> & {
  children?: React.ReactNode;
}) {
  const { isExpanded } = AccordionPrimitive.useItemContext();
  const progress = useDerivedValue(
    () => (isExpanded ? withTiming(1, { duration: 250 }) : withTiming(0, { duration: 200 })),
    [isExpanded]
  );
  const chevronStyle = useAnimatedStyle(
    () => ({
      transform: [{ rotate: `${progress.value * 180}deg` }],
    }),
    [progress]
  );

  return (
    <TextClassContext.Provider
      value={cn(
        'text-left text-sm font-medium',
        Platform.select({ web: 'group-hover:underline' })
      )}>
      <AccordionPrimitive.Header>
        <AccordionPrimitive.Trigger {...props} asChild={Platform.OS !== 'web'}>
          <Trigger
            className={cn(
              'flex-row items-center justify-between gap-3 rounded-xl py-2 disabled:opacity-50',
              Platform.select({
                web: 'flex transition-all outline-none disabled:pointer-events-none',
              }),
              className
            )}>
            <>{children}</>
            <Animated.View style={chevronStyle}>
              <Icon as={ChevronDown} size={16} className="text-muted-foreground shrink-0" />
            </Animated.View>
          </Trigger>
        </AccordionPrimitive.Trigger>
      </AccordionPrimitive.Header>
    </TextClassContext.Provider>
  );
}

function AccordionContent({
  className,
  children,
  ...props
}: React.ComponentProps<typeof AccordionPrimitive.Content>) {
  const { isExpanded } = AccordionPrimitive.useItemContext();

  return (
    <TextClassContext.Provider value="text-sm">
      <AccordionPrimitive.Content
        className={cn(
          'overflow-hidden',
          Platform.select({ web: isExpanded ? 'animate-accordion-down' : 'animate-accordion-up' })
        )}
        {...props}>
        <Animated.View
          exiting={Platform.select({ native: FadeOutUp.duration(200) })}
          className={cn('pb-2', className)}>
          {children}
        </Animated.View>
      </AccordionPrimitive.Content>
    </TextClassContext.Provider>
  );
}

export { Accordion, AccordionContent, AccordionItem, AccordionTrigger };
