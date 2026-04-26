import { useChatHistory } from '@/components/providers/chat-history-provider';
import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { Text } from '@/components/ui/text';
import { getFallbackChatTitle } from '@/lib/chat-history';
import {
  DrawerContentScrollView,
  type DrawerContentComponentProps,
} from '@react-navigation/drawer';
import { router, usePathname } from 'expo-router';
import { Origami, MessageCirclePlus, MessageSquare, Settings } from 'lucide-react-native';
import { InteractionManager, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

export function AppDrawerContent(props: DrawerContentComponentProps) {
  const insets = useSafeAreaInsets();
  const pathname = usePathname();
  const { chats, currentChatId, selectChat, startNewChat } = useChatHistory();
  const isChatActive =
    pathname === '/' || pathname === '/(drawer)' || pathname === '/(drawer)/index';
  const isSettingsActive = pathname === '/settings';

  return (
    <View className="bg-card flex-1">
      <DrawerContentScrollView
        {...props}
        contentContainerStyle={{ paddingTop: insets.top + 12, paddingBottom: 16 }}>
        <View className="flex-row items-center gap-2 px-4 pb-4">
          <Icon className="text-primary size-6" as={Origami} />
          <Text className="text-2xl font-semibold tracking-tight">OpenBird</Text>
        </View>

        <View className="gap-2 px-2">
          <DrawerActionRow
            active={currentChatId === null && isChatActive}
            icon={MessageCirclePlus}
            label="New chat"
            onPress={() => {
              startNewChat();
              props.navigation.closeDrawer();
              router.replace('/(drawer)');
            }}
          />

          <View className="mt-4 gap-1">
            <Text className="text-muted-foreground px-1 text-xs font-medium tracking-[0.18em] uppercase">
              Chats
            </Text>

            {chats.length === 0 ? (
              <Text className="text-muted-foreground px-2 py-3 text-sm">No saved chats yet.</Text>
            ) : (
              chats.map((chat) => (
                <DrawerActionRow
                  key={chat.id}
                  active={chat.id === currentChatId && isChatActive}
                  icon={MessageSquare}
                  label={getFallbackChatTitle(chat)}
                  onPress={() => {
                    selectChat(chat.id);
                    props.navigation.closeDrawer();
                    router.replace('/(drawer)');
                  }}
                />
              ))
            )}
          </View>
        </View>
      </DrawerContentScrollView>

      <View className="px-4 pt-3" style={{ paddingBottom: insets.bottom + 12 }}>
        <DrawerActionRow
          active={isSettingsActive}
          icon={Settings}
          label="Settings"
          onPress={() => {
            props.navigation.closeDrawer();
            InteractionManager.runAfterInteractions(() => {
              router.push('/settings');
            });
          }}
        />
      </View>
    </View>
  );
}

function DrawerActionRow({
  active,
  icon,
  label,
  onPress,
}: {
  active: boolean;
  icon: typeof MessageSquare;
  label: string;
  onPress: () => void;
}) {
  return (
    <Button
      variant="ghost"
      className={
        active ? 'bg-accent justify-start rounded-xl px-3' : 'justify-start rounded-xl px-3'
      }
      onPress={onPress}>
      <View className="flex-row items-center gap-2.5">
        <Icon as={icon} className="size-4.5" />
        <Text className="font-medium" numberOfLines={1}>
          {label}
        </Text>
      </View>
    </Button>
  );
}
