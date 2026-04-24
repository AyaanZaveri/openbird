import { Text } from '@/components/ui/text';
import { THEME } from '@/lib/theme';
import * as Linking from 'expo-linking';
import * as React from 'react';
import { ScrollView, View } from 'react-native';
import { useUniwind } from 'uniwind';

type MarkdownTextProps = {
  children: string;
};

type InlineNode =
  | { type: 'text'; value: string }
  | { type: 'strong'; children: InlineNode[] }
  | { type: 'em'; children: InlineNode[] }
  | { type: 'code'; value: string }
  | { type: 'link'; href: string; children: InlineNode[] };

type BlockNode =
  | { type: 'heading'; level: 1 | 2 | 3 | 4 | 5 | 6; text: string }
  | { type: 'paragraph'; text: string }
  | { type: 'blockquote'; text: string }
  | { type: 'code'; text: string }
  | { type: 'table'; headers: string[]; rows: string[][] }
  | { type: 'ul'; items: string[] }
  | { type: 'ol'; items: string[] };

const BLOCK_MARKER = /^(#{1,6}	|#{1,6} |```|>|[-*] |\d+\. )/;
const INLINE_MARKER = /(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`|\[[^\]]+\]\([^\)]+\))/;
const TABLE_COLUMN_WIDTH = 220;

function MarkdownText({ children }: MarkdownTextProps) {
  const { theme } = useUniwind();
  const palette = THEME[theme ?? 'light'];
  const blocks = React.useMemo(() => parseMarkdown(children), [children]);

  return (
    <View className="gap-3">
      {blocks.map((block, index) => renderBlock(block, index, palette))}
    </View>
  );
}

function parseMarkdown(input: string): BlockNode[] {
  const lines = input.replace(/\r\n/g, '\n').split('\n');
  const blocks: BlockNode[] = [];

  for (let index = 0; index < lines.length; ) {
    const line = lines[index] ?? '';
    const trimmed = line.trim();

    if (!trimmed) {
      index += 1;
      continue;
    }

    if (trimmed.startsWith('```')) {
      const codeLines: string[] = [];
      index += 1;

      while (index < lines.length && !(lines[index] ?? '').trim().startsWith('```')) {
        codeLines.push(lines[index] ?? '');
        index += 1;
      }

      if (index < lines.length) {
        index += 1;
      }

      blocks.push({ type: 'code', text: codeLines.join('\n') });
      continue;
    }

    const headingMatch = line.match(/^(#{1,6})\s+(.*)$/);
    if (headingMatch) {
      blocks.push({
        type: 'heading',
        level: headingMatch[1].length as 1 | 2 | 3 | 4 | 5 | 6,
        text: headingMatch[2].trim(),
      });
      index += 1;
      continue;
    }

    if (index + 1 < lines.length && isMarkdownTableHeader(line, lines[index + 1] ?? '')) {
      const headers = parseTableRow(line);
      const rows: string[][] = [];
      index += 2;

      while (index < lines.length) {
        const current = lines[index] ?? '';
        if (!current.trim() || !current.includes('|')) {
          break;
        }

        const row = parseTableRow(current);
        if (row.length === 0) {
          break;
        }

        rows.push(normalizeTableRow(row, headers.length));
        index += 1;
      }

      blocks.push({ type: 'table', headers, rows });
      continue;
    }

    if (trimmed.startsWith('>')) {
      const quoteLines: string[] = [];

      while (index < lines.length) {
        const current = lines[index] ?? '';
        if (!current.trim().startsWith('>')) {
          break;
        }

        quoteLines.push(current.replace(/^>\s?/, ''));
        index += 1;
      }

      blocks.push({ type: 'blockquote', text: quoteLines.join('\n').trim() });
      continue;
    }

    if (/^[-*]\s+/.test(trimmed)) {
      const items: string[] = [];

      while (index < lines.length) {
        const current = (lines[index] ?? '').trim();
        const match = current.match(/^[-*]\s+(.*)$/);
        if (!match) {
          break;
        }

        items.push(match[1]);
        index += 1;
      }

      blocks.push({ type: 'ul', items });
      continue;
    }

    if (/^\d+\.\s+/.test(trimmed)) {
      const items: string[] = [];

      while (index < lines.length) {
        const current = (lines[index] ?? '').trim();
        const match = current.match(/^\d+\.\s+(.*)$/);
        if (!match) {
          break;
        }

        items.push(match[1]);
        index += 1;
      }

      blocks.push({ type: 'ol', items });
      continue;
    }

    const paragraphLines: string[] = [];

    while (index < lines.length) {
      const current = lines[index] ?? '';
      if (!current.trim()) {
        break;
      }

      if (paragraphLines.length > 0 && BLOCK_MARKER.test(current)) {
        break;
      }

      if (paragraphLines.length > 0 && isMarkdownTableHeader(current, lines[index + 1] ?? '')) {
        break;
      }

      paragraphLines.push(current.trim());
      index += 1;
    }

    blocks.push({ type: 'paragraph', text: paragraphLines.join(' ') });
  }

  return blocks;
}

function isMarkdownTableHeader(headerLine: string, dividerLine: string) {
  if (!headerLine.includes('|')) {
    return false;
  }

  const headerCells = parseTableRow(headerLine);
  const dividerCells = parseTableRow(dividerLine);

  return (
    headerCells.length > 0 &&
    headerCells.length === dividerCells.length &&
    dividerCells.every((cell) => /^:?-{3,}:?$/.test(cell))
  );
}

function parseTableRow(line: string) {
  const normalized = line.trim().replace(/^\|/, '').replace(/\|$/, '');
  if (!normalized) {
    return [];
  }

  return normalized.split('|').map((cell) => cell.trim());
}

function normalizeTableRow(row: string[], width: number) {
  if (row.length === width) {
    return row;
  }

  if (row.length > width) {
    return row.slice(0, width);
  }

  return [...row, ...Array.from({ length: width - row.length }, () => '')];
}

function parseInline(text: string): InlineNode[] {
  const nodes: InlineNode[] = [];
  let cursor = 0;

  while (cursor < text.length) {
    const remaining = text.slice(cursor);
    const match = remaining.match(INLINE_MARKER);

    if (!match || match.index === undefined) {
      nodes.push({ type: 'text', value: remaining });
      break;
    }

    if (match.index > 0) {
      nodes.push({ type: 'text', value: remaining.slice(0, match.index) });
    }

    const token = match[0];

    if (token.startsWith('**') && token.endsWith('**')) {
      nodes.push({ type: 'strong', children: parseInline(token.slice(2, -2)) });
    } else if (token.startsWith('*') && token.endsWith('*')) {
      nodes.push({ type: 'em', children: parseInline(token.slice(1, -1)) });
    } else if (token.startsWith('`') && token.endsWith('`')) {
      nodes.push({ type: 'code', value: token.slice(1, -1) });
    } else {
      const linkMatch = token.match(/^\[([^\]]+)\]\(([^\)]+)\)$/);
      if (linkMatch) {
        nodes.push({
          type: 'link',
          href: linkMatch[2],
          children: parseInline(linkMatch[1]),
        });
      } else {
        nodes.push({ type: 'text', value: token });
      }
    }

    cursor += match.index + token.length;
  }

  return nodes;
}

function renderInlineNodes(nodes: InlineNode[], palette: (typeof THEME)['light'], keyPrefix: string) {
  return nodes.map((node, index) => {
    const key = `${keyPrefix}-${index}`;

    switch (node.type) {
      case 'text':
        return <React.Fragment key={key}>{node.value}</React.Fragment>;
      case 'strong':
        return (
          <Text key={key} className="font-semibold">
            {renderInlineNodes(node.children, palette, key)}
          </Text>
        );
      case 'em':
        return (
          <Text key={key} style={{ fontStyle: 'italic' }}>
            {renderInlineNodes(node.children, palette, key)}
          </Text>
        );
      case 'code':
        return (
          <Text
            key={key}
            className="font-mono"
            style={{
              backgroundColor: palette.background,
              borderRadius: 6,
              paddingHorizontal: 6,
              paddingVertical: 2,
            }}>
            {node.value}
          </Text>
        );
      case 'link':
        return (
            <Text
              key={key}
            style={{ color: palette.primary, textDecorationLine: 'underline' as const }}
            onPress={() => {
              void Linking.openURL(node.href);
            }}>
            {renderInlineNodes(node.children, palette, key)}
          </Text>
        );
    }
  });
}

function renderRichText(text: string, palette: (typeof THEME)['light'], key: string, className?: string) {
  return <Text className={className}>{renderInlineNodes(parseInline(text), palette, key)}</Text>;
}

function renderBlock(block: BlockNode, index: number, palette: (typeof THEME)['light']) {
  const key = `markdown-${index}`;

  switch (block.type) {
    case 'heading': {
      const headingClassNames = {
        1: 'text-2xl font-extrabold',
        2: 'text-xl font-semibold',
        3: 'text-lg font-semibold',
        4: 'text-base font-semibold',
        5: 'text-sm font-semibold',
        6: 'text-sm font-medium',
      } as const;

      return (
        <View key={key}>
          {renderRichText(block.text, palette, key, headingClassNames[block.level])}
        </View>
      );
    }
    case 'paragraph':
      return <View key={key}>{renderRichText(block.text, palette, key)}</View>;
    case 'blockquote':
      return (
        <View key={key} className="border-l pl-3" style={{ borderLeftColor: palette.border }}>
          {renderRichText(block.text, palette, key, 'text-muted-foreground')}
        </View>
      );
    case 'code':
      return (
        <ScrollView
          key={key}
          horizontal
          showsHorizontalScrollIndicator={false}
          className="rounded-xl border px-3 py-3"
          style={{ borderColor: palette.border, backgroundColor: palette.background }}>
          <Text className="font-mono">{block.text}</Text>
        </ScrollView>
      );
    case 'table':
      const tableWidth = block.headers.length * TABLE_COLUMN_WIDTH;

      return (
        <ScrollView key={key} horizontal showsHorizontalScrollIndicator>
          <View
            className="overflow-hidden rounded-xl border"
            style={{ borderColor: palette.border, width: tableWidth }}>
            <View
              className="flex-row border-b"
              style={{ borderBottomColor: palette.border, backgroundColor: palette.background }}>
              {block.headers.map((header, cellIndex) => (
                <View
                  key={`${key}-header-${cellIndex}`}
                  className="border-r px-3 py-2 last:border-r-0"
                  style={{ borderRightColor: palette.border, width: TABLE_COLUMN_WIDTH }}>
                  {renderRichText(header, palette, `${key}-header-${cellIndex}`, 'font-semibold')}
                </View>
              ))}
            </View>
            {block.rows.map((row, rowIndex) => (
              <View
                key={`${key}-row-${rowIndex}`}
                className="flex-row border-b last:border-b-0"
                style={{ borderBottomColor: palette.border }}>
                {row.map((cell, cellIndex) => (
                  <View
                    key={`${key}-row-${rowIndex}-cell-${cellIndex}`}
                    className="border-r px-3 py-2 last:border-r-0"
                    style={{ borderRightColor: palette.border, width: TABLE_COLUMN_WIDTH }}>
                    {renderRichText(cell, palette, `${key}-row-${rowIndex}-cell-${cellIndex}`)}
                  </View>
                ))}
              </View>
            ))}
          </View>
        </ScrollView>
      );
    case 'ul':
      return (
        <View key={key} className="gap-2">
          {block.items.map((item, itemIndex) => (
            <View key={`${key}-item-${itemIndex}`} className="flex-row gap-2 pr-2">
              <Text>{'\u2022'}</Text>
              <View className="flex-1">{renderRichText(item, palette, `${key}-item-${itemIndex}`)}</View>
            </View>
          ))}
        </View>
      );
    case 'ol':
      return (
        <View key={key} className="gap-2">
          {block.items.map((item, itemIndex) => (
            <View key={`${key}-item-${itemIndex}`} className="flex-row gap-2 pr-2">
              <Text className="font-medium">{`${itemIndex + 1}.`}</Text>
              <View className="flex-1">{renderRichText(item, palette, `${key}-item-${itemIndex}`)}</View>
            </View>
          ))}
        </View>
      );
  }
}

export { MarkdownText };
