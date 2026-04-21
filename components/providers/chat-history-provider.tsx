import {
  createEmptyChat,
  loadChatHistory,
  saveChatHistory,
  sortChats,
  type ChatThread,
  type Message,
} from '@/lib/chat-history';
import * as React from 'react';

type ChatHistoryContextValue = {
  chats: ChatThread[];
  currentChat: ChatThread;
  currentChatId: string | null;
  isReady: boolean;
  startNewChat: () => void;
  selectChat: (chatId: string) => void;
  setCurrentChatMessages: (messages: Message[]) => string;
  updateChatMessages: (chatId: string, updater: (messages: Message[]) => Message[]) => void;
  setChatTitle: (chatId: string, title: string) => void;
};

const ChatHistoryContext = React.createContext<ChatHistoryContextValue | null>(null);

export function ChatHistoryProvider({ children }: { children: React.ReactNode }) {
  const [chats, setChats] = React.useState<ChatThread[]>([]);
  const [currentChatId, setCurrentChatId] = React.useState<string | null>(null);
  const [draftChat, setDraftChat] = React.useState<ChatThread>(() => createEmptyChat());
  const [isReady, setIsReady] = React.useState(false);

  React.useEffect(() => {
    let cancelled = false;

    void (async () => {
      const storedChats = await loadChatHistory();
      if (cancelled) {
        return;
      }

      setChats(storedChats);
      setCurrentChatId(storedChats[0]?.id ?? null);
      setDraftChat(createEmptyChat());
      setIsReady(true);
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  React.useEffect(() => {
    if (!isReady) {
      return;
    }

    void saveChatHistory(chats);
  }, [chats, isReady]);

  const currentChat = React.useMemo(() => {
    const selectedChat = chats.find((chat) => chat.id === currentChatId);
    return selectedChat ?? draftChat;
  }, [chats, currentChatId, draftChat]);

  const startNewChat = React.useCallback(() => {
    setCurrentChatId(null);
    setDraftChat(createEmptyChat());
  }, []);

  const selectChat = React.useCallback(
    (chatId: string) => {
      if (!chats.some((chat) => chat.id === chatId)) {
        return;
      }

      setCurrentChatId(chatId);
    },
    [chats]
  );

  const setCurrentChatMessages = React.useCallback(
    (messages: Message[]) => {
      const timestamp = Date.now();

      if (currentChatId === null) {
        const nextChat: ChatThread = {
          ...draftChat,
          updatedAt: timestamp,
          messages,
        };

        if (messages.length === 0) {
          setDraftChat(nextChat);
          return nextChat.id;
        }

        setChats((current) => sortChats([nextChat, ...current]));
        setCurrentChatId(nextChat.id);
        return nextChat.id;
      }

      setChats((current) =>
        sortChats(
          current.map((chat) =>
            chat.id === currentChatId ? { ...chat, messages, updatedAt: timestamp } : chat
          )
        )
      );

      return currentChatId;
    },
    [currentChatId, draftChat]
  );

  const updateChatMessages = React.useCallback(
    (chatId: string, updater: (messages: Message[]) => Message[]) => {
      setChats((current) =>
        sortChats(
          current.map((chat) =>
            chat.id === chatId
              ? {
                  ...chat,
                  messages: updater(chat.messages),
                  updatedAt: Date.now(),
                }
              : chat
          )
        )
      );
    },
    []
  );

  const setChatTitle = React.useCallback((chatId: string, title: string) => {
    const trimmedTitle = title.trim();
    if (!trimmedTitle) {
      return;
    }

    setChats((current) =>
      sortChats(
        current.map((chat) =>
          chat.id === chatId
            ? {
                ...chat,
                title: trimmedTitle,
                updatedAt: Date.now(),
              }
            : chat
        )
      )
    );
  }, []);

  const value = React.useMemo(
    () => ({
      chats,
      currentChat,
      currentChatId,
      isReady,
      startNewChat,
      selectChat,
      setCurrentChatMessages,
      updateChatMessages,
      setChatTitle,
    }),
    [
      chats,
      currentChat,
      currentChatId,
      isReady,
      setChatTitle,
      setCurrentChatMessages,
      startNewChat,
      selectChat,
      updateChatMessages,
    ]
  );

  return <ChatHistoryContext.Provider value={value}>{children}</ChatHistoryContext.Provider>;
}

export function useChatHistory() {
  const value = React.useContext(ChatHistoryContext);
  if (!value) {
    throw new Error('useChatHistory must be used within a ChatHistoryProvider.');
  }

  return value;
}
