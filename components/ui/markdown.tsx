import { EnrichedMarkdownText } from 'react-native-enriched-markdown';

type MarkdownTextProps = {
  children: string;
};

function MarkdownText({ children }: MarkdownTextProps) {
  return <EnrichedMarkdownText markdown={children} />;
}

export { MarkdownText };
