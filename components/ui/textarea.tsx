import { cn } from '@/lib/utils';
import { THEME } from '@/lib/theme';
import * as React from 'react';
import { Platform, TextInput } from 'react-native';
import { useUniwind } from 'uniwind';

type TextareaProps = React.ComponentProps<typeof TextInput>;

function Textarea({
  className,
  placeholderTextColor,
  style,
  multiline = true,
  ...props
}: TextareaProps) {
  const { theme } = useUniwind();
  const foregroundColor = THEME[theme ?? 'light'].foreground;

  return (
    <TextInput
      className={cn(
        'text-foreground border-input flex min-h-24 w-full rounded-2xl border bg-transparent px-4 py-3 text-base shadow-sm shadow-black/5',
        Platform.select({
          web: 'placeholder:text-muted-foreground ring-offset-background focus-visible:border-ring focus-visible:ring-ring/50 transition-[color,box-shadow] outline-none focus-visible:ring-[3px] disabled:cursor-not-allowed md:text-sm',
        }),
        props.editable === false && 'opacity-50',
        className
      )}
      cursorColor={'#abab9c'}
      multiline={multiline}
      placeholderTextColor={placeholderTextColor ?? '#8a8a8a'}
      selectionColor={'#abab9c'}
      style={[{ fontFamily: 'Geist_400Regular' }, style]}
      textAlignVertical="top"
      {...props}
    />
  );
}

export { Textarea };
export type { TextareaProps };
