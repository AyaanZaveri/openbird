# Hacker News

A production-ready Expo React Native app for reading the current Hacker News front page on iOS and Android.

## Stack

- Expo SDK 55
- TypeScript in strict mode
- Expo Router file-based routing with typed routes enabled
- UniWind with Tailwind CSS v4 syntax
- React Native Reusables button and dialog primitives
- React Native Reanimated layout and timing animations
- Async Storage for saved stories
- Lucide React Native icons

## Run

```bash
npx expo start
```

From the Expo terminal, press `i` for the iOS simulator or `a` for the Android emulator.

## Checks

```bash
npx tsc --noEmit
npx expo install --check
```
