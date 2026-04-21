import AsyncStorage from '@react-native-async-storage/async-storage';
import { z } from 'zod';

export const USER_MEMORY_STORAGE_KEY = 'chat.user-memory';

const userMemorySchema = z.object({
  prompt: z.string(),
  updatedAt: z.number(),
});

export function normalizeMemoryPrompt(value: string) {
  return value
    .split('\n')
    .map((line) => line.trimEnd())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export async function loadUserMemory() {
  try {
    const storedValue = await AsyncStorage.getItem(USER_MEMORY_STORAGE_KEY);
    if (!storedValue) {
      return '';
    }

    const parsedValue = userMemorySchema.safeParse(JSON.parse(storedValue));
    if (!parsedValue.success) {
      return '';
    }

    return normalizeMemoryPrompt(parsedValue.data.prompt);
  } catch {
    return '';
  }
}

export async function saveUserMemory(prompt: string) {
  const normalizedPrompt = normalizeMemoryPrompt(prompt);

  if (!normalizedPrompt) {
    await clearUserMemory();
    return;
  }

  await AsyncStorage.setItem(
    USER_MEMORY_STORAGE_KEY,
    JSON.stringify({
      prompt: normalizedPrompt,
      updatedAt: Date.now(),
    })
  );
}

export async function clearUserMemory() {
  await AsyncStorage.removeItem(USER_MEMORY_STORAGE_KEY);
}
