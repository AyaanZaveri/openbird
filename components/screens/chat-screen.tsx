import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { Input } from '@/components/ui/input';
import { Text } from '@/components/ui/text';
import {
  defaultSettings,
  loadProviderSettings,
  settingsSchema,
  type SettingsForm,
} from '@/lib/provider-settings';
import { THEME } from '@/lib/theme';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { streamText } from 'ai';
import * as Linking from 'expo-linking';
import { useFocusEffect, useNavigation, useRouter } from 'expo-router';
import { fetch as expoFetch } from 'expo/fetch';
import { Menu, SendHorizontal } from 'lucide-react-native';
import * as React from 'react';
import { Platform, ScrollView, View } from 'react-native';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { MarkdownStyle } from 'react-native-enriched-markdown';
import { StreamdownText } from 'react-native-streamdown';
import { useUniwind, withUniwind } from 'uniwind';

type Message = {
  id: string;
  role: 'assistant' | 'user';
  text: string;
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
  const [isSending, setIsSending] = React.useState(false);

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

  async function sendMessage() {
    const value = draft.trim();
    if (!value || isSending) {
      return;
    }

    const parsedSettings = settingsSchema.safeParse(settings);
    if (!parsedSettings.success) {
      setChatError(parsedSettings.error.issues[0]?.message ?? 'Update your provider settings.');
      router.push('/settings');
      return;
    }

    const timestamp = Date.now();
    const userMessage: Message = { id: `${timestamp}-user`, role: 'user', text: value };
    const assistantMessageId = `${timestamp}-assistant`;
    const nextMessages = [
      ...messages,
      userMessage,
      { id: assistantMessageId, role: 'assistant' as const, text: '', pending: true },
    ];

    setChatError(null);
    setMessages(nextMessages);
    setDraft('');

    const provider = createOpenAICompatible({
      name: 'custom-provider',
      apiKey: parsedSettings.data.apiKey,
      baseURL: parsedSettings.data.baseUrl,
      fetch: expoFetch as unknown as typeof globalThis.fetch,
    });

    setIsSending(true);

    try {
      const result = streamText({
        model: provider(parsedSettings.data.model),
        messages: nextMessages
          .filter((message) => message.text.trim().length > 0)
          .map((message) => ({
            role: message.role,
            content: [{ type: 'text' as const, text: message.text }],
          })),
      });

      for await (const textPart of result.textStream) {
        setMessages((current) =>
          current.map((message) =>
            message.id === assistantMessageId
              ? {
                  ...message,
                  text: `${message.text}${textPart}`,
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

  return (
    <StyledSafeAreaView className="bg-background flex-1">
      <KeyboardAvoidingView behavior="padding" className="flex-1">
        <View className="flex-1 px-4 pt-2 pb-4">
          <View className="mb-4 flex-row items-center justify-between gap-3">
            <Button
              size="icon"
              variant="ghost"
              onPress={() => navigation.openDrawer()}
              accessibilityLabel="Open navigation menu">
              <Icon as={Menu} className="size-6" />
            </Button>

            <View className="flex-1">
              <Text className="text-lg font-semibold tracking-tight">Chat</Text>
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
                gap: 12,
                justifyContent: 'flex-end',
                paddingVertical: 24,
              }}
              keyboardShouldPersistTaps="handled">
              {messages.map((message) => (
                <ChatBubble key={message.id} message={message} />
              ))}
            </ScrollView>
          )}

          {chatError ? <Text className="text-destructive mb-3 text-sm">{chatError}</Text> : null}

          <View className="border-border bg-card mt-4 flex-row items-center gap-2 rounded-2xl border p-2">
            <Input
              value={draft}
              onChangeText={setDraft}
              editable={!isSending}
              placeholder="Say something to OpenBird..."
              multiline
              className="max-h-32 min-h-11 flex-1 rounded-xl border-0 bg-transparent px-3 py-2"
              textAlignVertical="center"
              onSubmitEditing={() => {
                if (Platform.OS !== 'web') {
                  sendMessage();
                }
              }}
              blurOnSubmit={false}
            />
            <Button
              size="icon"
              className="h-11 w-11 rounded-xl"
              disabled={isSending}
              onPress={() => void sendMessage()}
              accessibilityLabel="Send message">
              <Icon as={SendHorizontal} className="text-primary-foreground size-5" />
            </Button>
          </View>
        </View>
      </KeyboardAvoidingView>
    </StyledSafeAreaView>
  );
}

function ChatBubble({ message }: { message: Message }) {
  const { theme } = useUniwind();
  const palette = THEME[theme ?? 'light'];
  const isUser = message.role === 'user';
  const displayText = message.text || (message.pending ? 'Thinking...' : '');
  const markdownStyle = React.useMemo<MarkdownStyle>(
    () => ({
      paragraph: {
        color: palette.foreground,
        fontFamily: 'Geist_400Regular',
        fontSize: 16,
        lineHeight: 22,
        marginTop: 0,
        marginBottom: 0,
      },
      link: {
        color: palette.primary,
        underline: true,
      },
      strong: {
        fontFamily: 'Geist_700Bold',
        fontWeight: 'normal',
        color: palette.foreground,
      },
      em: {
        fontFamily: 'Geist_400Regular',
        color: palette.foreground,
      },
      code: {
        fontFamily: 'GeistMono_400Regular',
        fontSize: 14,
        color: palette.foreground,
        backgroundColor: palette.card,
        borderColor: palette.border,
      },
      codeBlock: {
        fontFamily: 'GeistMono_400Regular',
        fontSize: 14,
        lineHeight: 20,
        color: palette.foreground,
        backgroundColor: palette.card,
        borderColor: palette.border,
        borderRadius: 12,
        borderWidth: 1,
        padding: 12,
        marginTop: 8,
        marginBottom: 8,
      },
      blockquote: {
        backgroundColor: palette.card,
        borderColor: palette.border,
        borderWidth: 3,
        gapWidth: 12,
        color: palette.foreground,
        marginTop: 8,
        marginBottom: 8,
      },
      image: {
        height: 220,
        borderRadius: 12,
        marginTop: 8,
        marginBottom: 8,
      },
      math: {
        color: palette.foreground,
        backgroundColor: palette.card,
        padding: 12,
        marginTop: 8,
        marginBottom: 8,
      },
      inlineMath: {
        color: palette.foreground,
      },
    }),
    [palette.border, palette.card, palette.foreground, palette.primary]
  );

  return (
    <View className={isUser ? 'items-end' : 'items-start'}>
      <View
        className={
          isUser
            ? 'bg-primary max-w-[85%] rounded-2xl px-4 py-3'
            : 'bg-muted max-w-[85%] rounded-2xl px-4 py-3'
        }>
        {isUser ? (
          <Text className="text-primary-foreground">{displayText}</Text>
        ) : (
          <StreamdownText
            markdown={displayText}
            markdownStyle={markdownStyle}
            allowTrailingMargin={false}
            onLinkPress={(event) => {
              void Linking.openURL(event.url);
            }}
          />
        )}
      </View>
    </View>
  );
}
