// Install guard: detect reinstalls and wipe Keychain data.
//
// iOS Keychain (expo-secure-store) survives app uninstall/reinstall.
// AsyncStorage does not — it's cleared on uninstall.
//
// Strategy: on every cold start we check for a sentinel in AsyncStorage.
//   - Sentinel present → same install, nothing to do.
//   - Sentinel absent  → fresh install (or reinstall after uninstall).
//     Wipe all known Keychain keys, then write the sentinel so subsequent
//     launches are treated as the same install.
//
// Call `ensureFreshInstall()` once at the very start of app boot, before
// any store hydration, so stores always read from a clean slate.

import AsyncStorage from "@react-native-async-storage/async-storage";
import * as SecureStore from "./secure-store";

const SENTINEL_KEY = "@kkcode/installed";

// Only credentials and paired-device records live in Keychain; all preference flags use AsyncStorage.
const KEYCHAIN_KEYS = [
  "kkcode.servers.v2",
  "kkcode.servers.v3",
  "kkcode.push-device-id",
  "kkcode.push-device-secret",
  "kkcode.push-paired-installations",
];

export async function ensureFreshInstall(): Promise<void> {
  try {
    const sentinel = await AsyncStorage.getItem(SENTINEL_KEY);
    if (sentinel !== null) return; // same install, nothing to do

    // Fresh install or reinstall after uninstall — wipe Keychain.
    await Promise.all(KEYCHAIN_KEYS.map((k) => SecureStore.deleteItemAsync(k)));
    await AsyncStorage.setItem(SENTINEL_KEY, "1");
  } catch {
    // Never block app boot on guard failures.
  }
}
