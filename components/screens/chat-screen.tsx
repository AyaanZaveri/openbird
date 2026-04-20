import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';
import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { MarkdownText } from '@/components/ui/markdown';
import { Textarea } from '@/components/ui/textarea';
import { Text } from '@/components/ui/text';
import {
  defaultSettings,
  loadProviderSettings,
  settingsSchema,
  type SettingsForm,
} from '@/lib/provider-settings';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { streamText } from 'ai';
import * as Clipboard from 'expo-clipboard';
import { useFocusEffect, useNavigation, useRouter } from 'expo-router';
import { fetch as expoFetch } from 'expo/fetch';
import * as Haptics from 'expo-haptics';
import { Bird, Brain, Copy, Menu, RotateCw, SendHorizontal } from 'lucide-react-native';
import * as React from 'react';
import { Platform, ScrollView, View } from 'react-native';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import { SafeAreaView } from 'react-native-safe-area-context';
import { withUniwind } from 'uniwind';

type Message = {
  id: string;
  role: 'assistant' | 'user';
  text: string;
  reasoning?: string;
  pending?: boolean;
};

const StyledSafeAreaView = withUniwind(SafeAreaView);

export function ChatScreen() {
  const navigation = useNavigation<any>();
  const router = useRouter();
  const [messages, setMessages] = React.useState<Message[]>([]);
  const [draft, setDraft] = React.useState('');
  const [settings, setSettings] = React.useState<SettingsForm>(defaultSettings);
  const [chatError, setChatError] = React.useState<string | null>(null);
  const [copiedMessageId, setCopiedMessageId] = React.useState<string | null>(null);
  const [isSending, setIsSending] = React.useState(false);

  React.useEffect(() => {
    if (!copiedMessageId) {
      return;
    }

    const timeoutId = setTimeout(() => {
      setCopiedMessageId(null);
    }, 1500);

    return () => clearTimeout(timeoutId);
  }, [copiedMessageId]);

  useFocusEffect(
    React.useCallback(() => {
      let cancelled = false;

      void (async () => {
        const nextSettings = await loadProviderSettings();
        if (!cancelled) {
          setSettings(nextSettings);
        }
      })();

      return () => {
        cancelled = true;
      };
    }, [])
  );

  async function streamAssistantResponse(nextMessages: Message[], assistantMessageId: string) {
    const parsedSettings = settingsSchema.safeParse(settings);
    if (!parsedSettings.success) {
      setChatError(parsedSettings.error.issues[0]?.message ?? 'Update your provider settings.');
      router.push('/settings');
      return;
    }

    const provider = createOpenAICompatible({
      name: 'custom-provider',
      apiKey: parsedSettings.data.apiKey,
      baseURL: parsedSettings.data.baseUrl,
      fetch: expoFetch as unknown as typeof globalThis.fetch,
    });

    setIsSending(true);

    try {
      setChatError(null);
      const result = streamText({
        model: provider(parsedSettings.data.model),
        messages: nextMessages
          .filter((message) => message.text.trim().length > 0)
          .map((message) => ({
            role: message.role,
            content: [{ type: 'text' as const, text: message.text }],
          })),
      });

      for await (const part of result.fullStream) {
        if (part.type === 'reasoning-delta') {
          setMessages((current) =>
            current.map((message) =>
              message.id === assistantMessageId
                ? {
                    ...message,
                    reasoning: `${message.reasoning ?? ''}${part.text}`,
                    pending: false,
                  }
                : message
            )
          );
          continue;
        }

        if (part.type !== 'text-delta') {
          continue;
        }

        setMessages((current) =>
          current.map((message) =>
            message.id === assistantMessageId
              ? {
                  ...message,
                  text: `${message.text}${part.text}`,
                  pending: false,
                }
              : message
          )
        );
      }

      setMessages((current) =>
        current.map((message) =>
          message.id === assistantMessageId ? { ...message, pending: false } : message
        )
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Request failed.';
      setChatError(message);
      setMessages((current) =>
        current.map((entry) =>
          entry.id === assistantMessageId
            ? {
                ...entry,
                pending: false,
                text: entry.text || 'Unable to generate a response.',
              }
            : entry
        )
      );
    } finally {
      setIsSending(false);
    }
  }

  async function sendMessage() {
    const value = draft.trim();
    if (!value || isSending) {
      return;
    }

    const timestamp = Date.now();
    const userMessage: Message = { id: `${timestamp}-user`, role: 'user', text: value };
    const assistantMessageId = `${timestamp}-assistant`;
    const nextMessages = [
      ...messages,
      userMessage,
      {
        id: assistantMessageId,
        role: 'assistant' as const,
        text: '',
        reasoning: '',
        pending: true,
      },
    ];

    setMessages(nextMessages);
    setDraft('');

    await streamAssistantResponse(nextMessages, assistantMessageId);
  }

  async function copyMessageText(message: Message) {
    if (!message.text.trim()) {
      return;
    }

    await Clipboard.setStringAsync(message.text);
    setCopiedMessageId(message.id);
    void Haptics.selectionAsync();
  }

  async function regenerateLatestAssistantResponse() {
    if (isSending) {
      return;
    }

    const lastAssistantIndex = [...messages]
      .map((message, index) => ({ message, index }))
      .reverse()
      .find(({ message }) => message.role === 'assistant')?.index;

    if (lastAssistantIndex === undefined) {
      return;
    }

    const userIndex = messages
      .slice(0, lastAssistantIndex)
      .map((message, index) => ({ message, index }))
      .reverse()
      .find(({ message }) => message.role === 'user')?.index;

    if (userIndex === undefined) {
      return;
    }

    const assistantMessageId = `${Date.now()}-assistant`;
    const nextMessages = [
      ...messages.slice(0, userIndex + 1),
      {
        id: assistantMessageId,
        role: 'assistant' as const,
        text: '',
        reasoning: '',
        pending: true,
      },
    ];

    setMessages(nextMessages);
    void Haptics.selectionAsync();

    await streamAssistantResponse(nextMessages, assistantMessageId);
  }

  const lastAssistantMessageId = React.useMemo(() => {
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      if (messages[index]?.role === 'assistant') {
        return messages[index]?.id ?? null;
      }
    }

    return null;
  }, [messages]);

  return (
    <StyledSafeAreaView className="bg-background flex-1">
      <KeyboardAvoidingView behavior="padding" className="flex-1">
        <View className="flex-1 px-4 pb-4">
          <View className="mb-4 flex-row items-center justify-between gap-3 pt-2">
            <Button
              size="icon"
              variant="ghost"
              onPress={() => navigation.openDrawer()}
              accessibilityLabel="Open navigation menu">
              <Icon as={Menu} className="size-6" />
            </Button>

            <View className="flex-1">
              <View className="flex flex-row items-center gap-2">
                <Icon as={Bird} className="text-primary size-5" />
                <Text className="text-lg font-semibold tracking-tight">OpenBird</Text>
              </View>
              <Text className="text-muted-foreground font-mono text-sm tracking-tight">
                {settings.model ? settings.model : 'Choose a provider to get started.'}
              </Text>
            </View>
          </View>

          {messages.length === 0 ? (
            <View className="flex-1 items-center justify-center px-6">
              <Text className="text-center text-3xl font-semibold tracking-tight">
                What's on your mind?
              </Text>
            </View>
          ) : (
            <ScrollView
              className="flex-1"
              contentContainerStyle={{
                flexGrow: 1,
                gap: 16,
                paddingVertical: 20,
              }}
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
              scrollEventThrottle={16}>
              {messages.map((message) => (
                <ChatBubble
                  key={message.id}
                  message={message}
                  copied={copiedMessageId === message.id}
                  showActions={message.id === lastAssistantMessageId}
                  onCopy={() => void copyMessageText(message)}
                  onRegenerate={() => void regenerateLatestAssistantResponse()}
                  isSending={isSending}
                />
              ))}
            </ScrollView>
          )}

          {chatError ? <Text className="text-destructive mb-3 text-sm">{chatError}</Text> : null}

          <View className="-mx-4 mt-4 px-4">
            <View className="border-border/70 bg-background rounded-[1.25rem] border px-3 pt-3 pb-3 shadow-xl shadow-black/5">
              <Textarea
                value={draft}
                onChangeText={setDraft}
                editable={!isSending}
                placeholder="Ask OpenBird..."
                className="max-h-48 min-h-12 border-0 px-1 py-1 shadow-none"
                onSubmitEditing={() => {
                  if (Platform.OS !== 'web') {
                    sendMessage();
                  }
                }}
                blurOnSubmit={false}
              />

              <View className="mt-2 flex-row items-center justify-end">
                <Button
                  size="icon"
                  className="size-9 rounded-full"
                  disabled={isSending}
                  onPress={() => void sendMessage()}
                  accessibilityLabel="Send message">
                  <Icon as={SendHorizontal} className="text-primary-foreground size-4.5" />
                </Button>
              </View>
            </View>
          </View>
        </View>
      </KeyboardAvoidingView>
    </StyledSafeAreaView>
  );
}

function ChatBubble({
  message,
  copied,
  showActions,
  onCopy,
  onRegenerate,
  isSending,
}: {
  message: Message;
  copied: boolean;
  showActions: boolean;
  onCopy: () => void;
  onRegenerate: () => void;
  isSending: boolean;
}) {
  const isUser = message.role === 'user';
  const displayText = message.text || (message.pending ? 'Thinking...' : '');
  const reasoningText = message.reasoning?.trim();

  return (
    <View className={isUser ? 'items-end' : 'items-stretch'}>
      <View
        className={isUser ? 'bg-primary max-w-[85%] rounded-full px-4 py-2.5' : 'w-full px-1 py-1'}>
        {!isUser && reasoningText ? (
          <Accordion type="single" collapsible className="mb-2">
            <AccordionItem value={`reasoning-${message.id}`} className="border-0">
              <AccordionTrigger className="rounded-lg pr-1 py-2">
                <View className="flex-row items-center gap-2">
                  <Icon as={Brain} className="text-accent-foreground size-4" />
                  <Text className="text-accent-foreground text-sm font-medium">Reasoning</Text>
                </View>
              </AccordionTrigger>
              <AccordionContent className="px-2 pt-1">
                <Text className="text-muted-foreground text-sm leading-6">{reasoningText}</Text>
              </AccordionContent>
            </AccordionItem>
          </Accordion>
        ) : null}

        {isUser ? (
          <Text className="text-primary-foreground">{displayText}</Text>
        ) : (
          <MarkdownText>{displayText}</MarkdownText>
        )}
      </View>

      {!isUser && showActions ? (
        <View className="mt-1 flex-row items-center gap-1">
          <Button
            size="icon"
            variant="ghost"
            className="h-8 w-8 rounded-lg"
            onPress={onCopy}
            accessibilityLabel={copied ? 'Copied response' : 'Copy response'}>
            <Icon
              as={Copy}
              className={copied ? 'text-foreground size-4' : 'text-muted-foreground size-4'}
            />
          </Button>
          <Button
            size="icon"
            variant="ghost"
            className="h-8 w-8 rounded-lg"
            disabled={isSending}
            onPress={onRegenerate}
            accessibilityLabel="Regenerate response">
            <Icon as={RotateCw} className="text-muted-foreground size-4" />
          </Button>
        </View>
      ) : null}
    </View>
  );
}
