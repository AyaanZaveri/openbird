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
import { THEME } from '@/lib/theme';
import { loadMCPServers, type MCPServerConfig } from '@/lib/mcp-settings';
import {
  discoverAndSaveMCPServer,
  parseMCPSetupCommand,
  type MCPDiscoveryResult,
} from '@/lib/mcp-discovery';
import {
  closeMCPClients,
  createMCPToolRuntime,
  getMCPToolDisplayName,
  type MCPToolRuntime,
} from '@/lib/mcp-tools';
import { searchSearxng } from '@/lib/searxng';
import { loadUserMemory, normalizeMemoryPrompt, saveUserMemory } from '@/lib/user-memory';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { generateText, Output, stepCountIs, streamText, tool } from 'ai';
import * as Clipboard from 'expo-clipboard';
import * as ImagePicker from 'expo-image-picker';
import { useFocusEffect, useNavigation, useRouter } from 'expo-router';
import { fetch as expoFetch } from 'expo/fetch';
import * as Haptics from 'expo-haptics';
import {
  ExpoSpeechRecognitionModule,
  useSpeechRecognitionEvent,
} from 'expo-speech-recognition';
import {
  Brain,
  Check,
  ChevronDown,
  Copy,
  Globe,
  ImagePlus,
  Loader2,
  Menu,
  MessageCirclePlus,
  Origami,
  Mic,
  RotateCw,
  SearchCheckIcon,
  SendHorizontal,
  Square,
  Wrench,
  Timer,
  TriangleAlert,
  X
} from 'lucide-react-native';
import * as React from 'react';
import { Alert, Animated, Image, Platform, Pressable, ScrollView, View } from 'react-native';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useUniwind, withUniwind } from 'uniwind';
import { z } from 'zod';

const StyledSafeAreaView = withUniwind(SafeAreaView);

type SpeechRecognitionPermissionStatus = Awaited<
  ReturnType<typeof ExpoSpeechRecognitionModule.getPermissionsAsync>
>;

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

const setupMCPServerInputSchema = z.object({
  request: z
    .string()
    .trim()
    .min(1)
    .max(200)
    .describe(
      'The MCP server the user wants to add, including any provider name, docs URL, or token details they supplied.'
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

const speechEnrichmentOutputSchema = z.object({
  correctedText: z.string().trim().min(1),
});

function keepLastTwoWordsTogether(text: string) {
  return text.replace(/\s+(\S+)$/, '\u00A0$1');
}

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

function buildChatSystemPrompt(
  memoryPrompt: string,
  webSearchEnabled: boolean,
  mcpContext?: {
    activeServers: string[];
    errors: string[];
  }
) {
  const sections = [
    'You are OpenBird, a helpful assistant.',
    'Use the saved memory only when it improves the current conversation. Do not mention the memory block unless it is relevant.',
    'When the user shares durable personal context that would help future conversations, call the updateMemory tool.',
    'When the user explicitly asks to add, install, configure, or set up an MCP server, call setupMCPServer. This tool searches docs, infers the remote MCP endpoint, saves it, and tests it.',
    'Save only long-term useful details such as identity, preferences, goals, constraints, recurring projects, communication preferences, or important ongoing context.',
    'Do not save filler, temporary one-off details, or short-term requests that will not matter later.',
  ];

  if (memoryPrompt.trim()) {
    sections.push(`Saved user memory:\n${memoryPrompt.trim()}`);
  }

  if (webSearchEnabled) {
    sections.push(buildWebSearchSystemPrompt());
  }

  if (mcpContext?.activeServers.length) {
    sections.push(
      [
        'MCP tools are enabled for this conversation.',
        `Available MCP servers: ${mcpContext.activeServers.join(', ')}.`,
        'Use MCP tools when they are relevant to the user request. Do not call unrelated tools just because they are available.',
      ].join('\n')
    );
  }

  if (mcpContext?.errors.length) {
    sections.push(
      [
        'Some configured MCP servers could not be loaded for this request:',
        ...mcpContext.errors.map((error) => `- ${error}`),
      ].join('\n')
    );
  }

  return sections.join('\n\n');
}

function buildPostProcessSystemPrompt(memoryPrompt: string) {
  const sections = [
    'You are a precise speech-to-text post-processor. You take raw voice transcript and return clean, corrected text.',
    'Rules - follow them in order:',
    '1. Fix grammar, spelling, and punctuation (capitalize sentences, add periods, commas).',
    '2. Never change the meaning of what the user said.',
    '3. Keep informal contractions and phrasing intact (this is spoken text).',
    '4. Insert ONLY the corrected text — no preamble, no quotes, no markdown wrappers.',
    '5. Preserve filler words like "um" or "uh" only if they are intentional pauses; otherwise remove them.',
    '6. If the transcript is a question, ensure it ends with a question mark.',
    '7. Fix obvious homophone errors (e.g., "there" vs "they\'re").',
    '8. Add paragraph breaks only when there is a clear topic shift.',
    '9. Do not invent, stretch, repeat, or embellish words. Never turn a valid word into a playful or elongated spelling.',
    '10. Preserve proper nouns and capitalize them correctly when obvious from context.',
  ];

  if (memoryPrompt.trim()) {
    sections.push(
      `Personal memory / user context:\n${memoryPrompt.trim()}\n\nUse this context to spell names, places, and specific references correctly.`
    );
  }

  return sections.join('\n\n');
}

function wordCountToTokens(text: string): number {
  const wordCount = text.split(/\s+/).filter(Boolean).length;
  // ~1.3 tokens/word for English; add generous headroom for formatting changes
  return Math.min(Math.max(Math.ceil(wordCount * 2.5), 60), 1024);
}

function getMaxRepeatedCharacterRun(text: string): number {
  let maxRun = 0;
  let currentRun = 0;
  let previousChar = '';

  for (const char of text) {
    if (char.toLowerCase() === previousChar.toLowerCase()) {
      currentRun += 1;
    } else {
      previousChar = char;
      currentRun = 1;
    }

    maxRun = Math.max(maxRun, currentRun);
  }

  return maxRun;
}

function looksLikeQuestion(text: string): boolean {
  return /^(who|what|when|where|why|how|is|are|am|do|does|did|can|could|would|should|will|have|has)\b/i.test(
    text.trim()
  );
}

function applyBasicTextCleanup(text: string): string {
  const trimmed = text.replace(/\s+/g, ' ').trim();
  if (!trimmed) {
    return '';
  }

  const sentenceCased = trimmed.replace(/^([a-z])/, (match) => match.toUpperCase());
  if (/[.!?]$/.test(sentenceCased)) {
    return sentenceCased;
  }

  return sentenceCased + (looksLikeQuestion(sentenceCased) ? '?' : '.');
}

function isSpeechEnrichmentAcceptable(rawInput: string, correctedText: string): boolean {
  if (!correctedText.trim()) {
    return false;
  }

  if (correctedText.length > rawInput.length * 1.75) {
    return false;
  }

  const rawMaxRun = getMaxRepeatedCharacterRun(rawInput);
  const correctedMaxRun = getMaxRepeatedCharacterRun(correctedText);
  if (correctedMaxRun > Math.max(rawMaxRun, 2)) {
    return false;
  }

  return true;
}

function getToolCallId(part: { toolCallId?: string; id?: string }) {
  return part.toolCallId ?? part.id ?? `tool-${Date.now()}`;
}

function isAbortError(error: unknown) {
  return error instanceof Error && error.name === 'AbortError';
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

function createStreamingMCPInvocation(
  toolCallId: string,
  displayName: string,
  toolInvocation: Extract<ToolInvocation, { toolName: 'mcp' }> | null
): Extract<ToolInvocation, { toolName: 'mcp' }> {
  return {
    toolCallId,
    toolName: 'mcp',
    state: 'input-streaming',
    displayName: toolInvocation?.displayName ?? displayName,
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
  const { theme } = useUniwind();
  const { currentChat, setCurrentChatMessages, setChatTitle, startNewChat, updateChatMessages } =
    useChatHistory();
  const [draft, setDraft] = React.useState('');
  const [attachments, setAttachments] = React.useState<Attachment[]>([]);
  const [settings, setSettings] = React.useState<SettingsForm>(defaultSettings);
  const [mcpServers, setMCPServers] = React.useState<MCPServerConfig[]>([]);
  const [chatError, setChatError] = React.useState<string | null>(null);
  const [copiedMessageId, setCopiedMessageId] = React.useState<string | null>(null);
  const [isSending, setIsSending] = React.useState(false);
  const [isModelSheetOpen, setIsModelSheetOpen] = React.useState(false);
  const [webSearchEnabled, setWebSearchEnabled] = React.useState(false);
  const [memoryPrompt, setMemoryPrompt] = React.useState('');
  const memoryPromptRef = React.useRef('');
  const draftRef = React.useRef('');
  const settingsRef = React.useRef<SettingsForm>(defaultSettings);
  const activeRequestAbortControllerRef = React.useRef<AbortController | null>(null);
  const [isListening, setIsListening] = React.useState(false);
  const [micPermission, setMicPermission] = React.useState<SpeechRecognitionPermissionStatus | null>(null);
  const [isPostProcessing, setIsPostProcessing] = React.useState(false);
  const finalizedSpeechRef = React.useRef('');
  const interimSpeechRef = React.useRef('');
  const isPostProcessingRef = React.useRef(false);
  const shouldPostProcessSpeechRef = React.useRef(false);
  const speechSessionActiveRef = React.useRef(false);

  const rotateAnim = React.useRef(new Animated.Value(0)).current;
  const primaryForegroundColor =
    theme === 'dark' ? THEME.dark.primaryForeground : THEME.light.primaryForeground;

  React.useEffect(() => {
    if (!isPostProcessing) {
      rotateAnim.setValue(0);
      return;
    }

    const spin = Animated.loop(
      Animated.timing(rotateAnim, {
        toValue: 1,
        duration: 800,
        useNativeDriver: true,
      })
    );

    spin.start();
    return () => spin.stop();
  }, [isPostProcessing, rotateAnim]);

  React.useEffect(() => {
    draftRef.current = draft;
  }, [draft]);

  React.useEffect(() => {
    settingsRef.current = settings;
  }, [settings]);

  React.useEffect(() => {
    isPostProcessingRef.current = isPostProcessing;
  }, [isPostProcessing]);

  const syncDraftWithSpeechRefs = React.useCallback(() => {
    const currentInterim = interimSpeechRef.current;
    if (currentInterim) {
      const sep = finalizedSpeechRef.current.length > 0 ? ' ' : '';
      setDraft(finalizedSpeechRef.current + sep + currentInterim);
      return;
    }

    setDraft(finalizedSpeechRef.current);
  }, []);

  useSpeechRecognitionEvent('result', (event) => {
    if (!speechSessionActiveRef.current) {
      return;
    }

    if (event.results && event.results.length > 0) {
      const result = event.results[0];
      const transcript = result?.transcript ?? '';
      if (!transcript) return;

      if (event.isFinal) {
        const separator = finalizedSpeechRef.current.length > 0 && !finalizedSpeechRef.current.endsWith(' ') ? ' ' : '';
        finalizedSpeechRef.current += separator + transcript;
        interimSpeechRef.current = '';
      } else {
        interimSpeechRef.current = transcript;
      }
      syncDraftWithSpeechRefs();
    }
  });

  useSpeechRecognitionEvent('error', (event) => {
    speechSessionActiveRef.current = false;
    shouldPostProcessSpeechRef.current = false;
    setIsListening(false);
    interimSpeechRef.current = '';
    Alert.alert('Speech error', event.message || 'Speech recognition failed.');
  });

  useSpeechRecognitionEvent('end', () => {
    speechSessionActiveRef.current = false;
    setIsListening(false);
    if (interimSpeechRef.current) {
      const separator = finalizedSpeechRef.current.length > 0 && !finalizedSpeechRef.current.endsWith(' ') ? ' ' : '';
      finalizedSpeechRef.current += separator + interimSpeechRef.current;
      interimSpeechRef.current = '';
      syncDraftWithSpeechRefs();
    }

    if (!shouldPostProcessSpeechRef.current) {
      return;
    }

    shouldPostProcessSpeechRef.current = false;
    const capturedSpeech = finalizedSpeechRef.current.trim();
    void postProcessSpeech(capturedSpeech);
  });

  React.useEffect(() => {
    void ExpoSpeechRecognitionModule.getPermissionsAsync().then((status) => {
      setMicPermission(status);
    });
  }, []);

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
        const nextMCPServers = await loadMCPServers();
        if (!cancelled) {
          setSettings(nextSettings);
          setMemoryPrompt(nextMemoryPrompt);
          setMCPServers(nextMCPServers);
        }
      })();

      return () => {
        cancelled = true;
      };
    }, [])
  );

  async function ensureSpeechPermissions() {
    if (micPermission?.status === 'granted') {
      return true;
    }

    const response = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
    setMicPermission(response);
    return response.status === 'granted';
  }

  async function startListening() {
    if (isListening || isSending) return;
    const granted = await ensureSpeechPermissions();
    if (!granted) {
      Alert.alert('Permission needed', 'Microphone access is required for voice input.');
      return;
    }
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    shouldPostProcessSpeechRef.current = false;
    speechSessionActiveRef.current = true;
    finalizedSpeechRef.current = draftRef.current;
    interimSpeechRef.current = '';
    setIsListening(true);
    ExpoSpeechRecognitionModule.start({
      lang: 'en-US',
      interimResults: true,
      continuous: true,
      maxAlternatives: 1,
    });
  }

  async function stopListening() {
    if (!isListening) return;
    void Haptics.selectionAsync();
    shouldPostProcessSpeechRef.current = true;
    setIsListening(false);
    ExpoSpeechRecognitionModule.stop();
  }

  function resetSpeechDraftState() {
    finalizedSpeechRef.current = '';
    interimSpeechRef.current = '';
    shouldPostProcessSpeechRef.current = false;
    draftRef.current = '';
  }

  async function postProcessSpeech(rawInput: string) {
    if (isPostProcessingRef.current) return;

    if (!rawInput) return;

    const parsedSettings = settingsSchema.safeParse(settingsRef.current);
    if (!parsedSettings.success) return;

    isPostProcessingRef.current = true;
    setIsPostProcessing(true);

    try {
      const provider = createOpenAICompatible({
        name: 'custom-provider',
        apiKey: parsedSettings.data.apiKey,
        baseURL: parsedSettings.data.baseUrl,
        fetch: expoFetch as unknown as typeof globalThis.fetch,
      });

      const runEnrichment = async (prompt: string) => {
        const result = await generateText({
          model: provider(parsedSettings.data.speechEnrichmentModel),
          system: buildPostProcessSystemPrompt(memoryPromptRef.current),
          maxOutputTokens: wordCountToTokens(rawInput),
          temperature: 0,
          maxRetries: 2,
          output: Output.object({
            schema: speechEnrichmentOutputSchema,
          }),
          prompt,
        });

        return result.output.correctedText.trim();
      };

      let corrected = await runEnrichment(
        [
          'Return only corrected text in the schema field.',
          'Fix punctuation, grammar, and spelling while preserving meaning.',
          `Raw transcript: ${rawInput}`,
        ].join('\n\n')
      );

      if (!isSpeechEnrichmentAcceptable(rawInput, corrected)) {
        corrected = await runEnrichment(
          [
            'This is a strict normalization task.',
            'Do not rewrite tone or wording unless needed for spelling, capitalization, punctuation, or obvious grammar correction.',
            'Example input: what is the capital of france',
            'Example output: What is the capital of France?',
            `Now correct this transcript: ${rawInput}`,
          ].join('\n\n')
        );
      }

      const finalText = isSpeechEnrichmentAcceptable(rawInput, corrected)
        ? corrected
        : applyBasicTextCleanup(rawInput);

      if (finalText) {
        setDraft(finalText);
        finalizedSpeechRef.current = finalText;
        draftRef.current = finalText;
      }
    } catch {
      const fallback = applyBasicTextCleanup(rawInput);
      if (fallback) {
        setDraft(fallback);
        finalizedSpeechRef.current = fallback;
        draftRef.current = fallback;
      }
    } finally {
      isPostProcessingRef.current = false;
      setIsPostProcessing(false);
    }
  }

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
    const abortController = new AbortController();
    activeRequestAbortControllerRef.current = abortController;
    let mcpRuntime: MCPToolRuntime | null = null;

    try {
      setChatError(null);

      if (titleSource) {
        void (async () => {
          try {
            const result = await generateText({
              model: provider(parsedSettings.data.model),
              abortSignal: abortController.signal,
              prompt: `Generate a short title for this chat using the user's request. Return only the title, max 6 words.\n\nUser request: ${titleSource}`,
            });

            setChatTitle(chatId, sanitizeGeneratedTitle(result.text, titleSource));
          } catch {
            setChatTitle(chatId, truncateTitle(titleSource, 40));
          }
        })();
      }

      mcpRuntime = await createMCPToolRuntime(mcpServers);
      const activeMCPRuntime = mcpRuntime;

      const result = streamText({
        model: provider(parsedSettings.data.model),
        abortSignal: abortController.signal,
        system: buildChatSystemPrompt(memoryPromptRef.current, webSearchEnabled, {
          activeServers: mcpServers
            .filter((server) => server.enabled)
            .map((server) => server.name.trim() || server.url),
          errors: activeMCPRuntime.errors,
        }),
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
                  abortSignal: abortController.signal,
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
          setupMCPServer: tool({
            description:
              'Automatically find documentation for a remote MCP server, infer its HTTP or SSE endpoint, save it to OpenBird MCP settings, and test the connection.',
            inputSchema: setupMCPServerInputSchema,
            execute: async ({ request }) => {
              const discoveryResult = await discoverAndSaveMCPServer(
                request,
                parsedSettings.data,
                abortController.signal
              );
              const nextMCPServers = await loadMCPServers();
              setMCPServers(nextMCPServers);

              return {
                status: discoveryResult.status,
                message: formatMCPDiscoveryResult(discoveryResult),
              };
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
                        searchSearxng(query, {
                          baseUrl: parsedSettings.data.searxngBaseUrl,
                          categories: 'general',
                          language: 'en',
                          signal: abortController.signal,
                        })
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
          ...(activeMCPRuntime.tools as Record<string, any>),
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
          (part.toolName === 'updateMemory' ||
            part.toolName === 'webSearch' ||
            part.toolName.startsWith('mcp__'))
        ) {
          const toolCallId = getToolCallId(part);
          const displayName = getMCPToolDisplayName(part.toolName, activeMCPRuntime.toolNameMap);

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
                          : part.toolName === 'webSearch'
                            ? createStreamingWebSearchInvocation(
                              toolCallId,
                              toolInvocation?.toolName === 'webSearch' ? toolInvocation : null
                            )
                            : createStreamingMCPInvocation(
                                toolCallId,
                                displayName,
                                toolInvocation?.toolName === 'mcp' ? toolInvocation : null
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
                            : existingToolInvocation.toolName === 'webSearch'
                              ? {
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
                              : {
                                toolCallId,
                                toolName: 'mcp',
                                state: 'input-streaming',
                                displayName: existingToolInvocation.displayName,
                                inputText: `${toolInvocation?.inputText ?? ''}${part.delta}`,
                                input:
                                  toolInvocation?.toolName === 'mcp'
                                    ? toolInvocation.input
                                    : undefined,
                                output:
                                  toolInvocation?.toolName === 'mcp'
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

        if (part.type === 'tool-call' && part.toolName.startsWith('mcp__')) {
          const toolCallId = getToolCallId(part);
          const displayName = getMCPToolDisplayName(part.toolName, activeMCPRuntime.toolNameMap);

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
                        toolName: 'mcp',
                        state: 'input-available',
                        displayName,
                        inputText: toolInvocation?.inputText,
                        input: part.input,
                        output:
                          toolInvocation?.toolName === 'mcp' ? toolInvocation.output : undefined,
                      })
                    ),
                  }
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

        if (part.type === 'tool-result' && part.toolName.startsWith('mcp__')) {
          const toolCallId = getToolCallId(part);
          const displayName = getMCPToolDisplayName(part.toolName, activeMCPRuntime.toolNameMap);

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
                        toolName: 'mcp',
                        state: 'output-available',
                        displayName,
                        inputText: toolInvocation?.inputText,
                        input: toolInvocation?.toolName === 'mcp' ? toolInvocation.input : undefined,
                        output: part.output,
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
      if (abortController.signal.aborted || isAbortError(error)) {
        updateChatMessages(chatId, (current) =>
          current.map((entry) =>
            entry.id === assistantMessageId
              ? {
                  ...entry,
                  pending: false,
                  text: entry.text || 'Stopped.',
                  responseTimeMs: Date.now() - startedAt,
                }
              : entry
          )
        );
        return;
      }

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
      if (mcpRuntime) {
        await closeMCPClients(mcpRuntime.clients);
      }
      if (activeRequestAbortControllerRef.current === abortController) {
        activeRequestAbortControllerRef.current = null;
      }
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

  async function runMCPSetupCommand(
    request: string,
    assistantMessageId: string,
    chatId: string
  ) {
    const startedAt = Date.now();
    const parsedSettings = settingsSchema.safeParse(settings);

    if (!parsedSettings.success) {
      setChatError(parsedSettings.error.issues[0]?.message ?? 'Update your provider settings.');
      router.push('/settings');
      return;
    }

    setIsSending(true);
    const abortController = new AbortController();
    activeRequestAbortControllerRef.current = abortController;
    setChatError(null);

    updateChatMessages(chatId, (current) =>
      current.map((message) =>
        message.id === assistantMessageId
          ? {
              ...message,
              pending: false,
              text: `Looking up MCP setup docs for "${request}"...`,
            }
          : message
      )
    );

    try {
      const result = await discoverAndSaveMCPServer(
        request,
        parsedSettings.data,
        abortController.signal
      );
      const nextMCPServers = await loadMCPServers();
      setMCPServers(nextMCPServers);

      updateChatMessages(chatId, (current) =>
        current.map((message) =>
          message.id === assistantMessageId
            ? {
                ...message,
                pending: false,
                text: formatMCPDiscoveryResult(result),
                responseTimeMs: Date.now() - startedAt,
              }
            : message
        )
      );
    } catch (error) {
      if (abortController.signal.aborted || isAbortError(error)) {
        updateChatMessages(chatId, (current) =>
          current.map((entry) =>
            entry.id === assistantMessageId
              ? {
                  ...entry,
                  pending: false,
                  text: entry.text || 'Stopped.',
                  responseTimeMs: Date.now() - startedAt,
                }
              : entry
          )
        );
        return;
      }

      const message = error instanceof Error ? error.message : 'Unable to set up that MCP server.';
      setChatError(message);
      updateChatMessages(chatId, (current) =>
        current.map((entry) =>
          entry.id === assistantMessageId
            ? {
                ...entry,
                pending: false,
                text: `I could not set up that MCP server automatically.\n\n${message}`,
                responseTimeMs: Date.now() - startedAt,
              }
            : entry
        )
      );
    } finally {
      if (activeRequestAbortControllerRef.current === abortController) {
        activeRequestAbortControllerRef.current = null;
      }
      setIsSending(false);
    }
  }

  function stopActiveRequest() {
    activeRequestAbortControllerRef.current?.abort();
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

    const mcpSetupRequest = attachments.length === 0 ? parseMCPSetupCommand(value) : null;

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
    resetSpeechDraftState();

    if (mcpSetupRequest !== null) {
      if (!mcpSetupRequest) {
        updateChatMessages(chatId, (current) =>
          current.map((message) =>
            message.id === assistantMessageId
              ? {
                  ...message,
                  pending: false,
                  text: 'Tell me which MCP server to set up after the command, for example `/mcp GitHub MCP remote server`.',
                }
              : message
          )
        );
        return;
      }

      await runMCPSetupCommand(mcpSetupRequest, assistantMessageId, chatId);
      return;
    }

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

  const welcomeMessages = React.useMemo(
    () => [
      "What are we doing today?",
      "I'm ready when you are.",
      "What's on your mind today?",
      "What are we cooking today?",
      "Talk to me.",
    ],
    []
  );

  const [welcomeIndex, setWelcomeIndex] = React.useState(() =>
    Math.floor(Math.random() * welcomeMessages.length)
  );

  React.useEffect(() => {
    if (messages.length === 0) {
      setWelcomeIndex(Math.floor(Math.random() * welcomeMessages.length));
    }
  }, [messages.length, welcomeMessages.length]);

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
              <View className="flex flex-row items-center">
                {/* <Icon as={Origami} className="text-primary size-5" /> */}
                <Text className="text-lg font-semibold tracking-tight">OpenBird</Text>
              </View>
              <Pressable
                className="flex-row items-center gap-1 self-start"
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
              <View className="flex-1 items-center justify-center px-6 pb-24 gap-5 mt-[-60px]">
                <Icon as={Origami} className="text-primary size-11" />
                <Text
                  className="text-center text-[2.35rem] tracking-tight max-w-64 text-white"
                  style={{ fontFamily: 'InstrumentSerif_400Regular' }}>
                  {keepLastTwoWordsTogether(welcomeMessages[welcomeIndex])}
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
                        variant={webSearchEnabled ? 'default' : 'secondary'}
                        // variant={'secondary'}
                        className={`size-9 rounded-full`}
                        disabled={isSending}
                        onPress={() => void toggleWebSearch()}
                        accessibilityLabel={
                          webSearchEnabled ? 'Disable web search' : 'Enable web search'
                        }>
                        <Icon
                          as={Globe}
                          className={
                            webSearchEnabled
                              ? 'text-background size-4.5'
                              : 'text-foreground size-4.5'
                          }
                        />
                      </Button>
                    </View>

                    <View className="flex-row items-center gap-2">
                      {isPostProcessing ? (
                        <Button
                          size="icon"
                          variant="ghost"
                          className="size-9 rounded-full"
                          disabled>
                          <Animated.View
                            style={{
                              transform: [{
                                rotate: rotateAnim.interpolate({
                                  inputRange: [0, 1],
                                  outputRange: ['0deg', '360deg'],
                                }),
                              }],
                            }}>
                            <Icon
                              as={Loader2}
                              className="text-foreground size-4.5"
                            />
                          </Animated.View>
                        </Button>
                      ) : (
                        <>
                          <Button
                            size="icon"
                            variant="secondary"
                            className={
                              isListening
                                ? 'size-9 rounded-full bg-amber-500 active:bg-amber-500'
                                : 'size-9 rounded-full bg-amber-500/5 active:bg-amber-500/15'
                            }
                            disabled={isSending}
                            onPress={() => {
                              void (isListening ? stopListening() : startListening());
                            }}
                            accessibilityLabel={isListening ? 'Stop listening' : 'Start dictation'}
                            accessibilityRole="button"
                            accessibilityHint="Toggle voice dictation">
                            <Icon
                              as={Mic}
                              className={
                                isListening
                                  ? 'text-white size-4.5'
                                  : 'text-amber-600 size-4.5 dark:text-amber-400'
                              }
                            />
                          </Button>
                        </>
                      )}
                      <Button
                        size="icon"
                        className="size-9 rounded-full"
                        onPress={() => {
                          if (isSending) {
                            stopActiveRequest();
                            return;
                          }

                          void sendMessage();
                        }}
                        accessibilityLabel={isSending ? 'Stop response' : 'Send message'}>
                        <Icon
                          as={isSending ? Square : SendHorizontal}
                          className="text-primary-foreground size-4.5"
                          fill={isSending ? primaryForegroundColor : 'none'}
                        />
                      </Button>
                    </View>
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

function formatMCPDiscoveryResult(result: MCPDiscoveryResult) {
  const sourceLines = result.sources
    .slice(0, 3)
    .map((source, index) => `${index + 1}. [${source.title}](${source.url})`)
    .join('\n');

  if (result.status === 'created' || result.status === 'updated') {
    return [
      result.status === 'created' ? 'Added MCP server.' : 'Updated MCP server.',
      '',
      `Name: ${result.server.name}`,
      `URL: ${result.server.url}`,
      `Transport: ${result.server.transport.toUpperCase()}`,
      result.server.bearerToken || result.server.headersJson
        ? 'Authentication: configured from the command/docs.'
        : 'Authentication: no token was added. If this server requires auth, add the token in Settings.',
      '',
      result.summary,
      '',
      `Connection test: ${result.testMessage}`,
      sourceLines ? `\nSources:\n${sourceLines}` : '',
    ]
      .filter((line) => line !== '')
      .join('\n');
  }

  return [
    result.summary,
    sourceLines ? `\nSources I checked:\n${sourceLines}` : '',
  ]
    .filter((line) => line !== '')
    .join('\n');
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
  if (toolInvocation.toolName === 'mcp') {
    const preview = getMCPInvocationPreview(toolInvocation.input ?? toolInvocation.inputText);

    return (
      <View className="border-border/50 bg-emerald-500/2 flex-row items-center gap-3 rounded-2xl border px-3 py-2.5">
        <Icon as={Wrench} className="text-emerald-600 size-4 dark:text-emerald-400" />
        <View className={preview ? 'flex-1 gap-0.5' : 'flex-1'}>
          <Text className="text-sm font-medium">
            {toolInvocation.state === 'output-available' ? 'Used MCP tool' : 'Calling MCP tool...'}
          </Text>
          <Text className="text-muted-foreground text-sm" numberOfLines={1}>
            {toolInvocation.displayName}
          </Text>
          {preview ? (
            <Text
              className="text-muted-foreground text-xs font-mono tracking-tight mr-2"
              numberOfLines={2}>
              {preview}
            </Text>
          ) : null}
        </View>
      </View>
    );
  }

  if (toolInvocation.toolName === 'webSearch') {
    const queryPreview = getWebSearchQueryPreview(toolInvocation);

    if (toolInvocation.state !== 'output-available') {
      return (
        <View className="border-border/50 bg-amber-500/2 flex-row items-center gap-3 rounded-2xl border px-3 py-2.5">
          <Icon as={SearchCheckIcon} className="text-amber-600 size-4 dark:text-amber-400" />
          <View className={queryPreview ? 'flex-1 gap-0.5' : 'flex-1'}>
            <Text className="text-sm font-medium">Searching the web...</Text>
            {queryPreview ? (
              <Text
                className="text-muted-foreground text-sm font-mono tracking-tighter mr-2"
                numberOfLines={2}>
                {queryPreview}
              </Text>
            ) : null}
          </View>
        </View>
      );
    }

    const resultCount = toolInvocation.output?.results.length ?? 0;

    return (
      <View className="border-border/50 bg-primary/2 flex-row items-center gap-3 rounded-2xl border px-3 py-2.5">
        <Icon as={Globe} className="text-primary size-4" />
        <View className={queryPreview ? 'flex-1 gap-0.5' : 'flex-1'}>
          <Text className="text-sm font-medium">
            {resultCount > 0
              ? `Looked at ${resultCount} sources`
              : 'Web search returned no results'}
          </Text>
          {queryPreview ? (
            <Text
              className="text-muted-foreground text-sm font-mono tracking-tighter mr-2"
              numberOfLines={2}>
              {queryPreview}
            </Text>
          ) : null}
        </View>
      </View>
    );
  }

  const preview = toolInvocation.input?.memory?.trim() || toolInvocation.inputText?.trim();

  if (toolInvocation.state !== 'output-available') {
    return (
      <View className="border-border/70 bg-muted/40 flex-row items-start gap-3 rounded-2xl border px-3 py-2.5">
        <Icon as={SearchCheckIcon} className="text-muted-foreground mt-0.5 size-4" />
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

function getMCPInvocationPreview(value: unknown) {
  if (!value) {
    return '';
  }

  if (typeof value === 'string') {
    return value.trim();
  }

  try {
    return JSON.stringify(value);
  } catch {
    return '';
  }
}

function getWebSearchQueryPreview(toolInvocation: Extract<ToolInvocation, { toolName: 'webSearch' }>) {
  const directQueries = toolInvocation.input?.queries
    ?.map((query) => query.trim())
    .filter(Boolean);

  if (directQueries?.length) {
    return directQueries.join(', ');
  }

  const rawInput = toolInvocation.inputText?.trim();
  if (!rawInput) {
    return '';
  }

  try {
    const parsed = JSON.parse(rawInput) as { queries?: unknown };
    if (!Array.isArray(parsed.queries)) {
      return '';
    }

    const parsedQueries = parsed.queries
      .filter((query): query is string => typeof query === 'string')
      .map((query) => query.trim())
      .filter(Boolean);

    return parsedQueries.join(', ');
  } catch {
    return '';
  }
}
