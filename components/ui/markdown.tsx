import { StreamdownText } from 'react-native-streamdown';

type MarkdownTextProps = {
  children: string;
};

function MarkdownText({ children }: MarkdownTextProps) {
  return <StreamdownText markdown={children} />;
}

export { MarkdownText };
