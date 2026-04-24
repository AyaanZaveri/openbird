import { Text } from '@/components/ui/text';
import { THEME } from '@/lib/theme';
import * as Linking from 'expo-linking';
import * as React from 'react';
import { ScrollView, View, useWindowDimensions } from 'react-native';
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

const BLOCK_MARKER = /^(#{1,6}\t|#{1,6} |```|>|[-*] |\d+\. )/;
const INLINE_MARKER = /(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`|\[[^\]]+\]\([^)]+\))/;
const TABLE_SIDE_PADDING = 14;
const TABLE_MIN_WIDTH = 72;
const TABLE_MAX_WIDTH = 340;

function MarkdownText({ children }: MarkdownTextProps) {
  const { theme } = useUniwind();
  const { width: windowWidth } = useWindowDimensions();
  const palette = THEME[theme ?? 'light'];
  const blocks = React.useMemo(() => parseMarkdown(children), [children]);
  const availableTableWidth = Math.max(windowWidth - 40, 260);

  return (
    <View className="gap-3">
      {blocks.map((block, index) => renderBlock(block, index, palette, availableTableWidth))}
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
      const linkMatch = token.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
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

function stripMarkdown(text: string) {
  return text
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1')
    .trim();
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function isCompactColumn(header: string, cells: string[]) {
  const normalizedHeader = header.trim().toLowerCase();
  if (/^(#|no\.?|num|id|rank|idx)$/.test(normalizedHeader)) {
    return true;
  }

  const strippedCells = cells.map(stripMarkdown).filter(Boolean);
  if (!strippedCells.length) {
    return false;
  }

  const compactValueCount = strippedCells.filter((cell) => /^[\d./:%-]+$/.test(cell)).length;
  return compactValueCount / strippedCells.length >= 0.7;
}

function getColumnWidths(headers: string[], rows: string[][], availableWidth: number) {
  const metadata = headers.map((header, columnIndex) => {
    const cells = rows.map((row) => row[columnIndex] ?? '');
    const samples = [header, ...cells].map(stripMarkdown);
    const longest = samples.reduce((max, sample) => Math.max(max, sample.length), 0);
    const average = samples.reduce((sum, sample) => sum + sample.length, 0) / Math.max(samples.length, 1);
    const longestWord = samples.reduce((max, sample) => {
      const wordMax = sample
        .split(/\s+/)
        .reduce((innerMax, word) => Math.max(innerMax, word.length), 0);
      return Math.max(max, wordMax);
    }, 0);
    const compact = isCompactColumn(header, cells);
    const descriptive = average > 28 || longest > 56;

    let width = longestWord * 8 + average * 2.6 + TABLE_SIDE_PADDING * 2 + 18;

    if (compact) {
      width = clamp(width, 72, 110);
    } else if (descriptive) {
      width = clamp(width + 28, 180, TABLE_MAX_WIDTH);
    } else {
      width = clamp(width, 120, 220);
    }

    return {
      compact,
      descriptive,
      weight: compact ? 0.4 : descriptive ? 1.45 : 1,
      width,
    };
  });

  const widths = metadata.map((column) => column.width);
  const totalWidth = widths.reduce((sum, width) => sum + width, 0);

  if (totalWidth < availableWidth) {
    const flexibleColumns = metadata
      .map((column, index) => ({ ...column, index }))
      .filter((column) => !column.compact);
    const pool = availableWidth - totalWidth;
    const totalWeight = flexibleColumns.reduce((sum, column) => sum + column.weight, 0) || 1;

    flexibleColumns.forEach((column) => {
      const extra = (pool * column.weight) / totalWeight;
      const maxWidth = column.descriptive ? TABLE_MAX_WIDTH : 240;
      widths[column.index] = clamp(widths[column.index] + extra, TABLE_MIN_WIDTH, maxWidth);
    });
  }

  return widths.map((width) => Math.round(width));
}

function getTableColors(palette: (typeof THEME)['light']) {
  const light = palette.background === '#ffffff';

  return {
    headerBackground: light ? 'rgba(8, 145, 178, 0.055)' : 'rgba(34, 211, 238, 0.12)',
    headerBorder: light ? 'rgba(8, 145, 178, 0.10)' : 'rgba(34, 211, 238, 0.18)',
    rowOddBackground: light ? 'rgba(255,255,255,0.92)' : 'rgba(255,255,255,0.015)',
    rowEvenBackground: light ? 'rgba(8, 145, 178, 0.022)' : 'rgba(255,255,255,0.035)',
  };
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

function renderBlock(
  block: BlockNode,
  index: number,
  palette: (typeof THEME)['light'],
  availableTableWidth: number
) {
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
    case 'table': {
      const columnWidths = getColumnWidths(block.headers, block.rows, availableTableWidth);
      const tableWidth = columnWidths.reduce((sum, width) => sum + width, 0);
      const tableColors = getTableColors(palette);

      return (
        <ScrollView
          key={key}
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ paddingBottom: 2 }}>
          <View
            className="overflow-hidden rounded-lg border"
            style={{
              borderColor: tableColors.headerBorder,
              backgroundColor: palette.card,
              width: Math.max(tableWidth, availableTableWidth),
            }}>
            <View
              className="flex-row border-b"
              style={{
                borderBottomColor: tableColors.headerBorder,
                backgroundColor: tableColors.headerBackground,
              }}>
              {block.headers.map((header, cellIndex) => (
                <View
                  key={`${key}-header-${cellIndex}`}
                  className="justify-center border-r px-3 py-3 last:border-r-0"
                  style={{ borderRightColor: tableColors.headerBorder, width: columnWidths[cellIndex] }}>
                  {renderRichText(
                    header,
                    palette,
                    `${key}-header-${cellIndex}`,
                    'text-sm font-semibold tracking-[-0.01em]'
                  )}
                </View>
              ))}
            </View>
            {block.rows.map((row, rowIndex) => (
              <View
                key={`${key}-row-${rowIndex}`}
                className="flex-row border-b last:border-b-0"
                style={{
                  borderBottomColor: palette.border,
                  backgroundColor:
                    rowIndex % 2 === 0 ? tableColors.rowOddBackground : tableColors.rowEvenBackground,
                }}>
                {row.map((cell, cellIndex) => (
                  <View
                    key={`${key}-row-${rowIndex}-cell-${cellIndex}`}
                    className="justify-center border-r px-3 py-3 last:border-r-0"
                    style={{ borderRightColor: palette.border, width: columnWidths[cellIndex] }}>
                    {renderRichText(
                      cell,
                      palette,
                      `${key}-row-${rowIndex}-cell-${cellIndex}`,
                      'text-[15px] leading-6'
                    )}
                  </View>
                ))}
              </View>
            ))}
          </View>
        </ScrollView>
      );
    }
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
