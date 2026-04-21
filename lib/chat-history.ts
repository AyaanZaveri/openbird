import AsyncStorage from '@react-native-async-storage/async-storage';
import { z } from 'zod';

export type Attachment = {
  id: string;
  filename: string;
  mediaType: string;
  previewUri: string;
  base64: string;
};

export type Message = {
  id: string;
  role: 'assistant' | 'user';
  text: string;
  attachments?: Attachment[];
  reasoning?: string;
  pending?: boolean;
  responseTimeMs?: number;
};

export type ChatThread = {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messages: Message[];
};

const attachmentSchema = z.object({
  id: z.string(),
  filename: z.string(),
  mediaType: z.string(),
  previewUri: z.string(),
  base64: z.string(),
});

const messageSchema = z.object({
  id: z.string(),
  role: z.enum(['assistant', 'user']),
  text: z.string(),
  attachments: z.array(attachmentSchema).optional(),
  reasoning: z.string().optional(),
  pending: z.boolean().optional(),
  responseTimeMs: z.number().optional(),
});

const chatThreadSchema = z.object({
  id: z.string(),
  title: z.string(),
  createdAt: z.number(),
  updatedAt: z.number(),
  messages: z.array(messageSchema),
});

const chatHistorySchema = z.array(chatThreadSchema);

export const CHAT_HISTORY_STORAGE_KEY = 'chat.history';

export function createChatId() {
  return `chat-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function createEmptyChat(): ChatThread {
  const timestamp = Date.now();

  return {
    id: createChatId(),
    title: '',
    createdAt: timestamp,
    updatedAt: timestamp,
    messages: [],
  };
}

export function sortChats(chats: ChatThread[]) {
  return [...chats].sort((left, right) => right.updatedAt - left.updatedAt);
}

export function getFallbackChatTitle(chat: Pick<ChatThread, 'title' | 'messages'>) {
  const title = chat.title.trim();
  if (title) {
    return title;
  }

  const firstUserMessage = chat.messages.find(
    (message) => message.role === 'user' && message.text.trim()
  );
  if (!firstUserMessage) {
    return 'New chat';
  }

  return truncateTitle(firstUserMessage.text);
}

export function truncateTitle(value: string, maxLength = 48) {
  const normalized = value.replace(/\s+/g, ' ').trim();
  if (normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, maxLength - 1).trimEnd()}…`;
}

export async function loadChatHistory() {
  try {
    const storedValue = await AsyncStorage.getItem(CHAT_HISTORY_STORAGE_KEY);
    if (!storedValue) {
      return [] as ChatThread[];
    }

    const parsedValue = chatHistorySchema.safeParse(JSON.parse(storedValue));
    if (!parsedValue.success) {
      return [] as ChatThread[];
    }

    return sortChats(parsedValue.data);
  } catch {
    return [] as ChatThread[];
  }
}

export async function saveChatHistory(chats: ChatThread[]) {
  await AsyncStorage.setItem(CHAT_HISTORY_STORAGE_KEY, JSON.stringify(sortChats(chats)));
}
