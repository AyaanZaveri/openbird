import AsyncStorage from '@react-native-async-storage/async-storage';

export type ThemePreference = 'light' | 'dark' | 'system';

export const THEME_PREFERENCE_STORAGE_KEY = 'chat.theme-preference';

export async function loadThemePreference(): Promise<ThemePreference> {
  try {
    const storedValue = await AsyncStorage.getItem(THEME_PREFERENCE_STORAGE_KEY);
    if (storedValue === 'light' || storedValue === 'dark' || storedValue === 'system') {
      return storedValue;
    }
  } catch {
    // Ignore storage issues and fall back to system.
  }

  return 'system';
}

export async function saveThemePreference(themePreference: ThemePreference) {
  await AsyncStorage.setItem(THEME_PREFERENCE_STORAGE_KEY, themePreference);
}
