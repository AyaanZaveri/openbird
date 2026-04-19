import { AppDrawerContent } from '@/components/navigation/app-drawer-content';
import { Drawer } from 'expo-router/drawer';

export default function DrawerLayout() {
  return (
    <Drawer
      drawerContent={(props) => <AppDrawerContent {...props} />}
      screenOptions={{
        headerShown: false,
        drawerType: 'slide',
        swipeEdgeWidth: 250,
        freezeOnBlur: true,
      }}>
      <Drawer.Screen name="index" options={{ title: 'Chat' }} />
    </Drawer>
  );
}
