import '@/global.css';

import { loadThemePreference } from '@/lib/theme-preferences';
import { NAV_THEME } from '@/lib/theme';
import {
  Geist_400Regular,
  Geist_500Medium,
  Geist_600SemiBold,
  Geist_700Bold,
  Geist_800ExtraBold,
  useFonts,
} from '@expo-google-fonts/geist';
import { GeistMono_400Regular } from '@expo-google-fonts/geist-mono';
import { ThemeProvider } from '@react-navigation/native';
import { PortalHost } from '@rn-primitives/portal';
import { SplashScreen, Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as React from 'react';
import { View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { Uniwind, useUniwind } from 'uniwind';

export {
  // Catch any errors thrown by the Layout component.
  ErrorBoundary,
} from 'expo-router';

void SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const { theme } = useUniwind();
  const resolvedTheme = theme ?? 'light';
  const [themePreferenceLoaded, setThemePreferenceLoaded] = React.useState(false);
  const [loaded, error] = useFonts({
    Geist_400Regular,
    Geist_500Medium,
    Geist_600SemiBold,
    Geist_700Bold,
    Geist_800ExtraBold,
    GeistMono_400Regular,
  });

  React.useEffect(() => {
    void (async () => {
      const storedThemePreference = await loadThemePreference();
      Uniwind.setTheme(storedThemePreference);
      setThemePreferenceLoaded(true);
    })();
  }, []);

  React.useEffect(() => {
    if ((loaded || error) && themePreferenceLoaded) {
      void SplashScreen.hideAsync();
    }
  }, [error, loaded, themePreferenceLoaded]);

  if ((!loaded && !error) || !themePreferenceLoaded) {
    return null;
  }

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <ThemeProvider value={NAV_THEME[theme ?? 'light']}>
        <View style={{ flex: 1, backgroundColor: NAV_THEME[resolvedTheme].colors.background }}>
          <StatusBar style={theme === 'dark' ? 'light' : 'dark'} />
          <Stack
            screenOptions={{
              headerShadowVisible: false,
              headerTitleAlign: 'left',
              headerTitleStyle: { fontFamily: 'Geist_700Bold' },
              contentStyle: { backgroundColor: NAV_THEME[resolvedTheme].colors.background },
            }}>
            <Stack.Screen name="(drawer)" options={{ headerShown: false }} />
            <Stack.Screen
              name="settings"
              options={{
                headerShown: false,
                animation: 'ios_from_right',
                presentation: 'card',
                freezeOnBlur: true,
                contentStyle: { backgroundColor: NAV_THEME[resolvedTheme].colors.background },
              }}
            />
          </Stack>
          <PortalHost />
        </View>
      </ThemeProvider>
    </GestureHandlerRootView>
  );
}
