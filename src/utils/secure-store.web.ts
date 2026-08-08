// Web fallback for expo-secure-store. Uses localStorage — not actually
// secure, but acceptable for developer-only debugging on web. Metro picks
// this file automatically when bundling for `--platform web` because of the
// `.web.ts` extension.

export async function getItemAsync(key: string): Promise<string | null> {
  try {
    return globalThis.localStorage?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

export async function setItemAsync(key: string, value: string): Promise<void> {
  try {
    globalThis.localStorage?.setItem(key, value);
  } catch {
    // Storage may be unavailable in private mode; swallow.
  }
}

export async function deleteItemAsync(key: string): Promise<void> {
  try {
    globalThis.localStorage?.removeItem(key);
  } catch {
    // ignore
  }
}
