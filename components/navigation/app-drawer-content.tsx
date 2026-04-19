import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { Text } from '@/components/ui/text';
import {
  DrawerContentScrollView,
  type DrawerContentComponentProps,
} from '@react-navigation/drawer';
import { router, usePathname } from 'expo-router';
import { Bird, MessageSquare, Settings } from 'lucide-react-native';
import { InteractionManager, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

export function AppDrawerContent(props: DrawerContentComponentProps) {
  const insets = useSafeAreaInsets();
  const pathname = usePathname();
  const isChatActive =
    pathname === '/' || pathname === '/(drawer)' || pathname === '/(drawer)/index';
  const isSettingsActive = pathname === '/settings';

  return (
    <View className="bg-card flex-1">
      <DrawerContentScrollView
        {...props}
        contentContainerStyle={{ paddingTop: insets.top + 12, paddingBottom: 16 }}>
        <View className="px-4 pb-4 flex-row items-center gap-2">
          <Icon className="size-6" as={Bird} />
          <Text className="text-2xl font-semibold tracking-tight">OpenBird</Text>
        </View>

        <View className="gap-2 px-2">
          <DrawerActionRow
            active={isChatActive}
            icon={MessageSquare}
            label="Chat"
            onPress={() => {
              router.replace('/(drawer)');
            }}
          />
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
      <View className="flex-row items-center gap-3">
        <Icon as={icon} className="size-5" />
        <Text className="font-medium">{label}</Text>
      </View>
    </Button>
  );
}
