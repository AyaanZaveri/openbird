import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';
import { ModelBottomSheet } from '@/components/model-bottom-sheet';
import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { MarkdownText } from '@/components/ui/markdown';
import { Textarea } from '@/components/ui/textarea';
import { Text } from '@/components/ui/text';
import { useChatHistory } from '@/components/providers/chat-history-provider';
import {
  truncateTitle,
  type Attachment,
  type Message,
  type ToolInvocation,
} from '@/lib/chat-history';
import {
  defaultSettings,
  loadProviderSettings,
  saveProviderSettings,
  settingsSchema,
  type SettingsForm,
} from '@/lib/provider-settings';
import { searchSearxng } from '@/lib/searxng';
import { loadUserMemory, normalizeMemoryPrompt, saveUserMemory } from '@/lib/user-memory';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { generateText, stepCountIs, streamText, tool } from 'ai';
import * as Clipboard from 'expo-clipboard';
import * as ImagePicker from 'expo-image-picker';
import { useFocusEffect, useNavigation, useRouter } from 'expo-router';
import { fetch as expoFetch } from 'expo/fetch';
import * as Haptics from 'expo-haptics';
import {
  Bird,
  Brain,
  Check,
  ChevronDown,
  Copy,
  Globe,
  Hourglass,
  ImagePlus,
  Menu,
  MessageCirclePlus,
  RotateCw,
  SendHorizontal,
  Timer,
  TriangleAlert,
  X,
} from 'lucide-react-native';
import * as React from 'react';
import { Alert, Image, Platform, Pressable, ScrollView, View } from 'react-native';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import { SafeAreaView } from 'react-native-safe-area-context';
import { withUniwind } from 'uniwind';
import { z } from 'zod';

const StyledSafeAreaView = withUniwind(SafeAreaView);

const updateMemoryInputSchema = z.object({
  memory: z
    .string()
    .trim()
    .min(1)
    .describe('The durable user context that should be saved for future conversations.'),
  reason: z
    .string()
    .trim()
    .optional()
    .describe('Why this information matters for future conversations.'),
});

const webSearchInputSchema = z.object({
  queries: z
    .array(
      z
        .string()
        .trim()
        .min(1)
        .max(80)
        .describe('A short factual search query, ideally 3 to 6 words.')
    )
    .min(2)
    .max(4)
    .describe(
      'Two to four meaningfully different web search queries covering different phrasings or angles of the user request.'
    ),
});

const webSearchOutputSchema = z.array(
  z.object({
    title: z.string(),
    url: z.string(),
    snippet: z.string(),
    date: z.string().optional(),
  })
);

function getWebSearchContext() {
  const fallbackDate = new Date();

  try {
    const resolved = Intl.DateTimeFormat().resolvedOptions();
    const locale = resolved.locale || 'en-US';
    const timeZone = resolved.timeZone || 'UTC';
    const currentDate = new Date();

    return {
      locale,
      timeZone,
      currentYear: new Intl.DateTimeFormat(locale, { year: 'numeric', timeZone }).format(
        currentDate
      ),
      currentDate: new Intl.DateTimeFormat(locale, {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        timeZone,
      }).format(currentDate),
      dayOfWeek: new Intl.DateTimeFormat(locale, { weekday: 'long', timeZone }).format(currentDate),
    };
  } catch {
    return {
      locale: 'en-US',
      timeZone: 'UTC',
      currentYear: `${fallbackDate.getFullYear()}`,
      currentDate: fallbackDate.toDateString(),
      dayOfWeek: new Intl.DateTimeFormat('en-US', { weekday: 'long' }).format(fallbackDate),
    };
  }
}

function buildWebSearchSystemPrompt() {
  const context = getWebSearchContext();

  return [
    'Web search is enabled for this conversation.',
    'Call the webSearch tool first when the user needs real-time, factual, or time-sensitive information.',
    'Do not use webSearch for pure math, coding syntax, timeless conceptual questions, or opinions.',
    'When you use webSearch, generate 2 to 4 short factual queries that are meaningfully different from each other.',
    `At least one query must be anchored to the current year: ${context.currentYear}.`,
    'Keep queries short and factual. Three to six words is ideal.',
    'Synthesize across the returned results instead of leaning on a single source or over-quoting snippets.',
    'If results conflict, seem dated, or are sparse, say so briefly and then answer as well as you can.',
    'This app may be using a smaller Ollama model, so keep tool use efficient and result synthesis concise.',
    `Current date: ${context.currentDate}`,
    `Current year: ${context.currentYear}`,
    `Day of week: ${context.dayOfWeek}`,
    `User locale: ${context.locale}`,
    `User timezone: ${context.timeZone}`,
  ].join('\n');
}

function buildChatSystemPrompt(memoryPrompt: string, webSearchEnabled: boolean) {
  const sections = [
    'You are OpenBird, a helpful assistant.',
    'Use the saved memory only when it improves the current conversation. Do not mention the memory block unless it is relevant.',
    'When the user shares durable personal context that would help future conversations, call the updateMemory tool.',
    'Save only long-term useful details such as identity, preferences, goals, constraints, recurring projects, communication preferences, or important ongoing context.',
    'Do not save filler, temporary one-off details, or short-term requests that will not matter later.',
  ];

  if (memoryPrompt.trim()) {
    sections.push(`Saved user memory:\n${memoryPrompt.trim()}`);
  }

  if (webSearchEnabled) {
    sections.push(buildWebSearchSystemPrompt());
  }

  return sections.join('\n\n');
}

function getToolCallId(part: { toolCallId?: string; id?: string }) {
  return part.toolCallId ?? part.id ?? `tool-${Date.now()}`;
}

function upsertToolInvocation(
  toolInvocations: ToolInvocation[] | undefined,
  toolCallId: string,
  updater: (toolInvocation: ToolInvocation | null) => ToolInvocation
) {
  const current = toolInvocations ?? [];
  const index = current.findIndex((toolInvocation) => toolInvocation.toolCallId === toolCallId);

  if (index === -1) {
    return [...current, updater(null)];
  }

  return current.map((toolInvocation, currentIndex) =>
    currentIndex === index ? updater(toolInvocation) : toolInvocation
  );
}

function createStreamingMemoryInvocation(
  toolCallId: string,
  toolInvocation: Extract<ToolInvocation, { toolName: 'updateMemory' }> | null
): Extract<ToolInvocation, { toolName: 'updateMemory' }> {
  return {
    toolCallId,
    toolName: 'updateMemory',
    state: 'input-streaming',
    inputText: toolInvocation?.inputText ?? '',
    input: toolInvocation?.input,
    output: toolInvocation?.output,
  };
}

function createStreamingWebSearchInvocation(
  toolCallId: string,
  toolInvocation: Extract<ToolInvocation, { toolName: 'webSearch' }> | null
): Extract<ToolInvocation, { toolName: 'webSearch' }> {
  return {
    toolCallId,
    toolName: 'webSearch',
    state: 'input-streaming',
    inputText: toolInvocation?.inputText ?? '',
    input: toolInvocation?.input,
    output: toolInvocation?.output,
  };
}

function sanitizeGeneratedTitle(value: string, fallback: string) {
  const normalized = value.replace(/["'`]/g, '').replace(/\s+/g, ' ').trim();
  return truncateTitle(normalized || fallback, 40);
}

export function ChatScreen() {
  const navigation = useNavigation<any>();
  const router = useRouter();
  const { currentChat, setCurrentChatMessages, setChatTitle, startNewChat, updateChatMessages } =
    useChatHistory();
  const [draft, setDraft] = React.useState('');
  const [attachments, setAttachments] = React.useState<Attachment[]>([]);
  const [settings, setSettings] = React.useState<SettingsForm>(defaultSettings);
  const [chatError, setChatError] = React.useState<string | null>(null);
  const [copiedMessageId, setCopiedMessageId] = React.useState<string | null>(null);
  const [isSending, setIsSending] = React.useState(false);
  const [isModelSheetOpen, setIsModelSheetOpen] = React.useState(false);
  const [webSearchEnabled, setWebSearchEnabled] = React.useState(false);
  const [memoryPrompt, setMemoryPrompt] = React.useState('');
  const memoryPromptRef = React.useRef('');

  React.useEffect(() => {
    memoryPromptRef.current = memoryPrompt;
  }, [memoryPrompt]);

  React.useEffect(() => {
    if (!copiedMessageId) {
      return;
    }

    const timeoutId = setTimeout(() => {
      setCopiedMessageId(null);
    }, 1500);

    return () => clearTimeout(timeoutId);
  }, [copiedMessageId]);

  const messages = currentChat.messages;

  useFocusEffect(
    React.useCallback(() => {
      let cancelled = false;

      void (async () => {
        const nextSettings = await loadProviderSettings();
        const nextMemoryPrompt = await loadUserMemory();
        if (!cancelled) {
          setSettings(nextSettings);
          setMemoryPrompt(nextMemoryPrompt);
        }
      })();

      return () => {
        cancelled = true;
      };
    }, [])
  );

  async function streamAssistantResponse(
    nextMessages: Message[],
    assistantMessageId: string,
    chatId: string,
    titleSource: string | null
  ) {
    const startedAt = Date.now();

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

      if (titleSource) {
        void (async () => {
          try {
            const result = await generateText({
              model: provider(parsedSettings.data.model),
              prompt: `Generate a short title for this chat using the user's request. Return only the title, max 6 words.\n\nUser request: ${titleSource}`,
            });

            setChatTitle(chatId, sanitizeGeneratedTitle(result.text, titleSource));
          } catch {
            setChatTitle(chatId, truncateTitle(titleSource, 40));
          }
        })();
      }

      const result = streamText({
        model: provider(parsedSettings.data.model),
        system: buildChatSystemPrompt(memoryPromptRef.current, webSearchEnabled),
        stopWhen: stepCountIs(5),
        tools: {
          updateMemory: tool({
            description:
              'Save durable user context that should persist across future conversations. Use this only for long-term helpful facts, preferences, goals, constraints, or recurring projects.',
            inputSchema: updateMemoryInputSchema,
            execute: async ({ memory, reason }) => {
              try {
                const existingMemory = memoryPromptRef.current;
                const mergeResult = await generateText({
                  model: provider(parsedSettings.data.model),
                  system: `You maintain a concise internal user briefing for future conversations. Merge the new candidate memory into the existing memory. Keep only durable, useful facts. Avoid duplicates. Prefer the newest information when facts conflict. Write natural-language paragraphs under clear category sections only when relevant. Do not use key-value fields, checklist formatting, or bullet lists. Each section should read like an internal profile note: direct, information-dense sentences with no fluff.

If relevant, use sections such as Work Context, Personal Context, Top of Mind, Preferences, Relationships, Goals, and Constraints. Only include sections that have meaningful content. Preserve nuance and important background, and update existing sections instead of rewriting everything blindly. Return only the final memory briefing text.

Example style:

Work Context

Ayaan is a 17-year-old full-stack developer in Toronto, graduating from Woodlands Secondary in June 2026. He previously worked at Exa and shipped production features including search and the API playground.

Personal Context

He communicates in a direct, casual, and concise style. He values honest pushback over reassurance and dislikes overly polished or corporate responses.`,
                  prompt: [
                    existingMemory.trim()
                      ? `Existing memory:\n${existingMemory.trim()}`
                      : 'Existing memory:\n(none)',
                    `New memory candidate:\n${memory}`,
                    reason?.trim() ? `Why it matters:\n${reason.trim()}` : null,
                  ]
                    .filter(Boolean)
                    .join('\n\n'),
                });

                const nextMemoryPrompt = normalizeMemoryPrompt(mergeResult.text);
                const normalizedExistingMemory = normalizeMemoryPrompt(existingMemory);

                if (!nextMemoryPrompt || nextMemoryPrompt === normalizedExistingMemory) {
                  return {
                    status: 'unchanged' as const,
                    summary: 'Memory already covered this context.',
                  };
                }

                await saveUserMemory(nextMemoryPrompt);
                memoryPromptRef.current = nextMemoryPrompt;
                setMemoryPrompt(nextMemoryPrompt);

                return {
                  status: 'saved' as const,
                  summary: 'Saved.',
                };
              } catch (error) {
                return {
                  status: 'error' as const,
                  summary: error instanceof Error ? error.message : 'Unable to update memory.',
                };
              }
            },
          }),
          ...(webSearchEnabled
            ? {
                webSearch: tool({
                  description:
                    'Search the web for recent or factual information using 2 to 4 short queries and return concise source snippets.',
                  inputSchema: webSearchInputSchema,
                  execute: async ({ queries }) => {
                    const settledResults = await Promise.all(
                      queries.map((query) =>
                        searchSearxng(query, { categories: 'general', language: 'en' })
                      )
                    );

                    const deduped = new Map<string, (typeof settledResults)[number][number]>();

                    for (const resultSet of settledResults) {
                      for (const resultItem of resultSet) {
                        const normalizedUrl = resultItem.url.trim();
                        if (!normalizedUrl || deduped.has(normalizedUrl)) {
                          continue;
                        }

                        deduped.set(normalizedUrl, resultItem);
                      }
                    }

                    return [...deduped.values()].slice(0, 12);
                  },
                }),
              }
            : {}),
        },
        messages: nextMessages
          .filter(
            (message) => message.text.trim().length > 0 || (message.attachments?.length ?? 0) > 0
          )
          .map((message) => {
            if (message.role === 'user') {
              return {
                role: 'user' as const,
                content: [
                  ...(message.text.trim().length > 0
                    ? [{ type: 'text' as const, text: message.text }]
                    : []),
                  ...(message.attachments ?? []).map((attachment) => ({
                    type: 'image' as const,
                    image: attachment.base64,
                    mediaType: attachment.mediaType,
                  })),
                ],
              };
            }

            return {
              role: 'assistant' as const,
              content: message.text,
            };
          }),
      });

      for await (const part of result.fullStream) {
        if (part.type === 'reasoning-delta') {
          updateChatMessages(chatId, (current) =>
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

        if (
          part.type === 'tool-input-start' &&
          (part.toolName === 'updateMemory' || part.toolName === 'webSearch')
        ) {
          const toolCallId = getToolCallId(part);

          updateChatMessages(chatId, (current) =>
            current.map((message) =>
              message.id === assistantMessageId
                ? {
                    ...message,
                    pending: false,
                    toolInvocations: upsertToolInvocation(
                      message.toolInvocations,
                      toolCallId,
                      (toolInvocation) =>
                        part.toolName === 'updateMemory'
                          ? createStreamingMemoryInvocation(
                              toolCallId,
                              toolInvocation?.toolName === 'updateMemory' ? toolInvocation : null
                            )
                          : createStreamingWebSearchInvocation(
                              toolCallId,
                              toolInvocation?.toolName === 'webSearch' ? toolInvocation : null
                            )
                    ),
                  }
                : message
            )
          );
          continue;
        }

        if (part.type === 'tool-input-delta') {
          const toolCallId = getToolCallId(part);

          updateChatMessages(chatId, (current) =>
            current.map((message) =>
              message.id === assistantMessageId
                ? (() => {
                    const existingToolInvocation = message.toolInvocations?.find(
                      (toolInvocation) => toolInvocation.toolCallId === toolCallId
                    );

                    if (!existingToolInvocation) {
                      return message;
                    }

                    return {
                      ...message,
                      pending: false,
                      toolInvocations: upsertToolInvocation(
                        message.toolInvocations,
                        toolCallId,
                        (toolInvocation) =>
                          existingToolInvocation.toolName === 'updateMemory'
                            ? {
                                toolCallId,
                                toolName: 'updateMemory',
                                state: 'input-streaming',
                                inputText: `${toolInvocation?.inputText ?? ''}${part.delta}`,
                                input:
                                  toolInvocation?.toolName === 'updateMemory'
                                    ? toolInvocation.input
                                    : undefined,
                                output:
                                  toolInvocation?.toolName === 'updateMemory'
                                    ? toolInvocation.output
                                    : undefined,
                              }
                            : {
                                toolCallId,
                                toolName: 'webSearch',
                                state: 'input-streaming',
                                inputText: `${toolInvocation?.inputText ?? ''}${part.delta}`,
                                input:
                                  toolInvocation?.toolName === 'webSearch'
                                    ? toolInvocation.input
                                    : undefined,
                                output:
                                  toolInvocation?.toolName === 'webSearch'
                                    ? toolInvocation.output
                                    : undefined,
                              }
                      ),
                    };
                  })()
                : message
            )
          );
          continue;
        }

        if (part.type === 'tool-call' && part.toolName === 'updateMemory') {
          const toolCallId = getToolCallId(part);
          const parsedInput = updateMemoryInputSchema.safeParse(part.input);

          updateChatMessages(chatId, (current) =>
            current.map((message) =>
              message.id === assistantMessageId
                ? {
                    ...message,
                    pending: false,
                    toolInvocations: upsertToolInvocation(
                      message.toolInvocations,
                      toolCallId,
                      (toolInvocation) => ({
                        toolCallId,
                        toolName: 'updateMemory',
                        state: 'input-available',
                        inputText: toolInvocation?.inputText,
                        input: parsedInput.success ? parsedInput.data : undefined,
                        output:
                          toolInvocation?.toolName === 'updateMemory'
                            ? toolInvocation.output
                            : undefined,
                      })
                    ),
                  }
                : message
            )
          );
          continue;
        }

        if (part.type === 'tool-call' && part.toolName === 'webSearch') {
          const toolCallId = getToolCallId(part);
          const parsedInput = webSearchInputSchema.safeParse(part.input);

          updateChatMessages(chatId, (current) =>
            current.map((message) =>
              message.id === assistantMessageId
                ? {
                    ...message,
                    pending: false,
                    toolInvocations: upsertToolInvocation(
                      message.toolInvocations,
                      toolCallId,
                      (toolInvocation) => ({
                        toolCallId,
                        toolName: 'webSearch',
                        state: 'input-available',
                        inputText: toolInvocation?.inputText,
                        input: parsedInput.success ? parsedInput.data : undefined,
                        output:
                          toolInvocation?.toolName === 'webSearch'
                            ? toolInvocation.output
                            : undefined,
                      })
                    ),
                  }
                : message
            )
          );
          continue;
        }

        if (part.type === 'tool-result' && part.toolName === 'updateMemory') {
          const toolCallId = getToolCallId(part);
          const output =
            part.output &&
            typeof part.output === 'object' &&
            'status' in part.output &&
            'summary' in part.output
              ? part.output
              : { status: 'error', summary: 'Unable to update memory.' };

          updateChatMessages(chatId, (current) =>
            current.map((message) =>
              message.id === assistantMessageId
                ? {
                    ...message,
                    pending: false,
                    toolInvocations: upsertToolInvocation(
                      message.toolInvocations,
                      toolCallId,
                      (toolInvocation) => ({
                        toolCallId,
                        toolName: 'updateMemory',
                        state: 'output-available',
                        inputText: toolInvocation?.inputText,
                        input:
                          toolInvocation?.toolName === 'updateMemory'
                            ? toolInvocation.input
                            : undefined,
                        output: {
                          status:
                            output.status === 'saved' ||
                            output.status === 'unchanged' ||
                            output.status === 'error'
                              ? output.status
                              : 'error',
                          summary:
                            typeof output.summary === 'string'
                              ? output.summary
                              : 'Unable to update memory.',
                        },
                      })
                    ),
                  }
                : message
            )
          );
          continue;
        }

        if (part.type === 'tool-result' && part.toolName === 'webSearch') {
          const toolCallId = getToolCallId(part);
          const parsedOutput = webSearchOutputSchema.safeParse(part.output);

          updateChatMessages(chatId, (current) =>
            current.map((message) =>
              message.id === assistantMessageId
                ? {
                    ...message,
                    pending: false,
                    toolInvocations: upsertToolInvocation(
                      message.toolInvocations,
                      toolCallId,
                      (toolInvocation) => ({
                        toolCallId,
                        toolName: 'webSearch',
                        state: 'output-available',
                        inputText: toolInvocation?.inputText,
                        input:
                          toolInvocation?.toolName === 'webSearch'
                            ? toolInvocation.input
                            : undefined,
                        output: {
                          results: parsedOutput.success ? parsedOutput.data : [],
                        },
                      })
                    ),
                  }
                : message
            )
          );
          continue;
        }

        if (part.type !== 'text-delta') {
          continue;
        }

        updateChatMessages(chatId, (current) =>
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

      updateChatMessages(chatId, (current) =>
        current.map((message) =>
          message.id === assistantMessageId ? { ...message, pending: false } : message
        )
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Request failed.';
      setChatError(message);
      updateChatMessages(chatId, (current) =>
        current.map((entry) =>
          entry.id === assistantMessageId
            ? {
                ...entry,
                pending: false,
                text: entry.text || 'Unable to generate a response.',
                responseTimeMs: Date.now() - startedAt,
              }
            : entry
        )
      );
      return;
    } finally {
      setIsSending(false);
    }

    updateChatMessages(chatId, (current) =>
      current.map((message) =>
        message.id === assistantMessageId
          ? {
              ...message,
              responseTimeMs: Date.now() - startedAt,
            }
          : message
      )
    );
  }

  async function pickImages() {
    if (isSending) {
      return;
    }

    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsMultipleSelection: true,
        selectionLimit: 10,
        quality: 0.8,
        base64: true,
      });

      if (result.canceled || result.assets.length === 0) {
        return;
      }

      const nextAttachments = result.assets.map((asset, index) => {
        const base64 = asset.base64;

        if (!base64) {
          throw new Error('The selected image could not be encoded for upload.');
        }

        return {
          id: asset.assetId ?? `${asset.uri}-${Date.now()}-${index}`,
          filename: asset.fileName ?? `image-${Date.now()}-${index + 1}.jpg`,
          mediaType: asset.mimeType ?? 'image/jpeg',
          previewUri: asset.uri,
          base64,
        } satisfies Attachment;
      });

      setAttachments((current) => {
        const deduped = new Map(current.map((attachment) => [attachment.id, attachment]));

        for (const attachment of nextAttachments) {
          deduped.set(attachment.id, attachment);
        }

        return [...deduped.values()];
      });
    } catch (error) {
      Alert.alert(
        'Unable to add images',
        error instanceof Error ? error.message : 'Please try again.'
      );
    }
  }

  function removeAttachment(attachmentId: string) {
    setAttachments((current) => current.filter((attachment) => attachment.id !== attachmentId));
  }

  async function sendMessage() {
    const value = draft.trim();
    if ((!value && attachments.length === 0) || isSending) {
      return;
    }

    const timestamp = Date.now();
    const userMessage: Message = {
      id: `${timestamp}-user`,
      role: 'user',
      text: value,
      attachments,
    };
    const assistantMessageId = `${timestamp}-assistant`;
    const shouldGenerateTitle =
      !currentChat.title.trim() &&
      !messages.some((message) => message.role === 'user') &&
      value.length > 0;
    const nextMessages = [
      ...messages,
      userMessage,
      {
        id: assistantMessageId,
        role: 'assistant' as const,
        text: '',
        reasoning: '',
        pending: true,
        toolInvocations: [],
      },
    ];

    const chatId = setCurrentChatMessages(nextMessages);
    setDraft('');
    setAttachments([]);

    await streamAssistantResponse(
      nextMessages,
      assistantMessageId,
      chatId,
      shouldGenerateTitle ? value : null
    );
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
        toolInvocations: [],
      },
    ];

    const chatId = setCurrentChatMessages(nextMessages);
    void Haptics.selectionAsync();

    await streamAssistantResponse(nextMessages, assistantMessageId, chatId, null);
  }

  async function selectModel(model: string) {
    const nextSettings = { ...settings, model };
    setSettings(nextSettings);
    await saveProviderSettings(nextSettings);
    void Haptics.selectionAsync();
  }

  async function toggleWebSearch() {
    const nextValue = !webSearchEnabled;
    setWebSearchEnabled(nextValue);

    if (nextValue) {
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      return;
    }

    await Haptics.selectionAsync();
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
    <StyledSafeAreaView className="bg-background flex-1 px-4">
      <KeyboardAvoidingView behavior="padding" className="flex-1">
        <View className="flex-1">
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
              <Pressable
                className="mt-0.5 flex-row items-center gap-1 self-start"
                onPress={() => setIsModelSheetOpen(true)}
                accessibilityRole="button"
                accessibilityLabel="Choose model">
                <Text className="text-muted-foreground font-mono text-sm tracking-tight">
                  {settings.model ? settings.model : 'Choose a provider to get started.'}
                </Text>
                <Icon as={ChevronDown} className="text-muted-foreground size-3.5" />
              </Pressable>
            </View>

            <Button
              size="icon"
              variant="ghost"
              disabled={isSending}
              onPress={() => {
                startNewChat();
                setDraft('');
                setAttachments([]);
              }}
              accessibilityLabel="Start a new chat">
              <Icon as={MessageCirclePlus} className="size-5" />
            </Button>
          </View>

          <View className="flex-1">
            {messages.length === 0 ? (
              <View className="flex-1 items-center justify-center px-6 pb-24">
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
                  paddingBottom: 180,
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

            <View className="absolute inset-x-4 bottom-4">
              {chatError ? (
                <Text className="text-destructive mb-3 px-1 text-sm">{chatError}</Text>
              ) : null}

              <View className="-mx-4">
                <View className="border-border/70 bg-background rounded-[1.25rem] border px-3 pt-3 pb-3 shadow-2xl shadow-primary/10">
                  {attachments.length > 0 ? (
                    <ScrollView
                      horizontal
                      className="mb-3"
                      contentContainerStyle={{ gap: 12 }}
                      showsHorizontalScrollIndicator={false}>
                      {attachments.map((attachment) => (
                        <View key={attachment.id} className="relative">
                          <Image
                            source={{ uri: attachment.previewUri }}
                            className="bg-muted size-18 rounded-xl"
                          />
                          <Pressable
                            className="bg-background/90 absolute top-1 right-1 items-center justify-center rounded-full p-1"
                            onPress={() => removeAttachment(attachment.id)}
                            accessibilityLabel={`Remove ${attachment.filename}`}>
                            <Icon as={X} className="size-3.5" />
                          </Pressable>
                        </View>
                      ))}
                    </ScrollView>
                  ) : null}

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

                  <View className="mt-2 flex-row items-center justify-between">
                    <View className="flex-row items-center gap-2">
                      <Button
                        size="icon"
                        variant="secondary"
                        className="size-9 rounded-full"
                        disabled={isSending}
                        onPress={() => void pickImages()}
                        accessibilityLabel="Add images">
                        <Icon as={ImagePlus} className="text-secondary-foreground size-4.5" />
                      </Button>
                      <Button
                        size="icon"
                        // variant={webSearchEnabled ? 'default' : 'secondary'}
                        variant={'secondary'}
                        className={`size-9 rounded-full ${webSearchEnabled ? 'bg-cyan-100/75 dark:bg-cyan-800/75' : ''}`}
                        disabled={isSending}
                        onPress={() => void toggleWebSearch()}
                        accessibilityLabel={
                          webSearchEnabled ? 'Disable web search' : 'Enable web search'
                        }>
                        <Icon
                          as={Globe}
                          className={
                            webSearchEnabled
                              ? 'text-cyan-500 dark:text-cyan-400 size-4.5'
                              : 'text-muted-foreground size-4.5'
                          }
                        />
                      </Button>
                    </View>

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
          </View>
        </View>
      </KeyboardAvoidingView>

      <ModelBottomSheet
        open={isModelSheetOpen}
        onOpenChange={setIsModelSheetOpen}
        settings={settings}
        value={settings.model}
        onSelect={(model) => void selectModel(model)}
      />
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
  const responseTimeLabel =
    message.responseTimeMs !== undefined ? `${(message.responseTimeMs / 1000).toFixed(1)}s` : null;
  const [lineCount, setLineCount] = React.useState(1);

  React.useEffect(() => {
    setLineCount(1);
  }, [displayText, message.id]);

  const userBubbleClass =
    lineCount > 1
      ? 'bg-accent max-w-[85%] rounded-2xl px-4 py-2.5'
      : 'bg-accent max-w-[85%] rounded-full px-4 py-2.5';

  return (
    <View className={isUser ? 'items-end' : 'mb-4 items-stretch'}>
      {message.attachments?.length ? (
        <View
          className={
            isUser
              ? 'mb-2 max-w-[85%] flex-row flex-wrap justify-end gap-2'
              : 'mb-2 flex-row flex-wrap gap-2'
          }>
          {message.attachments.map((attachment) => (
            <Image
              key={attachment.id}
              source={{ uri: attachment.previewUri }}
              className="bg-background/10 size-32 rounded-2xl"
            />
          ))}
        </View>
      ) : null}

      <View className={isUser ? userBubbleClass : 'w-full px-1 py-1'}>
        {!isUser && reasoningText ? (
          <Accordion type="single" collapsible className="mb-2">
            <AccordionItem value={`reasoning-${message.id}`} className="border-0">
              <AccordionTrigger className="rounded-lg py-2 pr-1">
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

        {!isUser && message.toolInvocations?.length ? (
          <View className="mb-4 gap-2">
            {message.toolInvocations.map((toolInvocation) => (
              <MemoryToolInvocationCard
                key={toolInvocation.toolCallId}
                toolInvocation={toolInvocation}
              />
            ))}
          </View>
        ) : null}

        {displayText ? (
          isUser ? (
            <Text
              onTextLayout={(event) => {
                setLineCount(event.nativeEvent.lines.length);
              }}>
              {displayText}
            </Text>
          ) : (
            <MarkdownText>{displayText}</MarkdownText>
          )
        ) : null}
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
          {responseTimeLabel ? (
            <View className="flex-row items-center gap-2 px-1.5">
              <Icon as={Timer} className="text-muted-foreground/70 size-4" />
              <Text className="text-muted-foreground/70 font-mono text-sm">
                {responseTimeLabel}
              </Text>
            </View>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

function MemoryToolInvocationCard({ toolInvocation }: { toolInvocation: ToolInvocation }) {
  if (toolInvocation.toolName === 'webSearch') {
    const queryPreview =
      toolInvocation.input?.queries.join(', ') ||
      toolInvocation.inputText?.trim() ||
      'Searching...';

    if (toolInvocation.state !== 'output-available') {
      return (
        <View className="border-border/70 bg-muted/40 flex-row items-start gap-3 rounded-2xl border px-3 py-2.5">
          <Icon as={Hourglass} className="text-muted-foreground mt-0.5 size-4" />
          <View className="flex-1 gap-1">
            <Text className="text-sm font-medium">Searching the web...</Text>
            <Text className="text-muted-foreground text-sm" numberOfLines={3}>
              {queryPreview}
            </Text>
          </View>
        </View>
      );
    }

    const resultCount = toolInvocation.output?.results.length ?? 0;

    return (
      <View className="border-border/70 bg-muted/30 flex-row items-center gap-3 rounded-2xl border px-3 py-2.5">
        <Icon as={Globe} className="text-primary mt-0.5 size-4" />
        <View className="flex-1">
          <Text className="text-sm font-medium">
            {resultCount > 0
              ? `Looked at ${resultCount} sources`
              : 'Web search returned no results'}
          </Text>
          <Text className="text-muted-foreground text-sm" numberOfLines={2}>
            {queryPreview}
          </Text>
        </View>
      </View>
    );
  }

  const preview = toolInvocation.input?.memory?.trim() || toolInvocation.inputText?.trim();

  if (toolInvocation.state !== 'output-available') {
    return (
      <View className="border-border/70 bg-muted/40 flex-row items-start gap-3 rounded-2xl border px-3 py-2.5">
        <Icon as={Hourglass} className="text-muted-foreground mt-0.5 size-4" />
        <View className="flex-1 gap-1">
          <Text className="text-sm font-medium">Saving to memory...</Text>
          {preview ? (
            <Text className="text-muted-foreground text-sm" numberOfLines={3}>
              {preview}
            </Text>
          ) : null}
        </View>
      </View>
    );
  }

  const isError = toolInvocation.output?.status === 'error';
  const isSaved = toolInvocation.output?.status === 'saved';

  return (
    <View
      className={
        isError
          ? 'border-destructive/30 bg-destructive/5 flex-row items-center gap-3 rounded-2xl border px-3 py-2.5'
          : 'border-border/70 bg-muted/30 flex-row items-center gap-3 rounded-2xl border px-3 py-2.5'
      }>
      <Icon
        as={isError ? TriangleAlert : Check}
        className={isError ? 'text-destructive mt-0.5 size-4' : 'text-primary mt-0.5 size-4'}
      />
      <View className="flex-1 gap-1">
        <Text className="text-sm font-medium">
          {isError
            ? 'Memory update failed'
            : isSaved
              ? 'Saved to memory'
              : 'Memory already up to date'}
        </Text>
        {/* {toolInvocation.output?.summary ? (
          <Text className="text-muted-foreground text-sm">{toolInvocation.output.summary}</Text>
        ) : null} */}
      </View>
    </View>
  );
}
