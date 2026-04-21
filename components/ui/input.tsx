import { cn } from '@/lib/utils';
import { THEME } from '@/lib/theme';
import * as React from 'react';
import { Platform, TextInput } from 'react-native';
import { useUniwind } from 'uniwind';

type InputProps = React.ComponentProps<typeof TextInput>;

function Input({ className, placeholderTextColor, style, ...props }: InputProps) {
  const { theme } = useUniwind();
  const foregroundColor = THEME[theme ?? 'light'].foreground;

  return (
    <TextInput
      className={cn(
        'border-input bg-background text-foreground placeholder:text-muted-foreground min-h-11 rounded-md border px-3 py-2.5 text-base',
        Platform.select({
          web: 'ring-offset-background focus-visible:border-ring focus-visible:ring-ring/50 outline-none focus-visible:ring-[3px]',
        }),
        props.editable === false && 'opacity-50',
        className
      )}
      cursorColor={foregroundColor}
      placeholderTextColor={placeholderTextColor ?? '#8a8a8a'}
      selectionColor={foregroundColor}
      style={[
        {
          fontFamily: 'Geist_400Regular',
          lineHeight: Platform.OS === 'ios' ? 20 : 22,
          paddingTop: Platform.OS === 'ios' ? 8 : undefined,
          paddingBottom: Platform.OS === 'ios' ? 10 : undefined,
        },
        style,
      ]}
      {...props}
    />
  );
}

export { Input };
export type { InputProps };
