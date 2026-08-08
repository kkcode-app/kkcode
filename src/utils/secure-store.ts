// Native build: re-export expo-secure-store as-is.
// A sibling `secure-store.web.ts` provides a localStorage fallback so the
// same import works on the web target (where expo-secure-store is unavailable).
//
// The lazy require below also covers the test runner (`tsx test/...`),
// which executes in plain node where `expo-secure-store` cannot be resolved
// (it transitively requires `react-native`). On the first call we try the
// real module; on failure we fall back to an in-memory map. Production
// (native or web bundle) hits the real implementation on the first call.
//
// We use a synchronous `require` instead of `await import(...)` because
// dynamic import on Android Hermes/Metro can produce stale internal module
// ids after fast-refresh ("Requiring unknown module NNNN").

type Backend = {
  getItemAsync: (key: string) => Promise<string | null>;
  setItemAsync: (key: string, value: string) => Promise<void>;
  deleteItemAsync: (key: string) => Promise<void>;
};

let backend: Backend | null = null;

function loadBackend(): Backend {
  if (backend) return backend;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const Expo = require("expo-secure-store") as Backend;
    backend = {
      getItemAsync: Expo.getItemAsync,
      setItemAsync: Expo.setItemAsync,
      deleteItemAsync: Expo.deleteItemAsync,
    };
  } catch {
    // Plain node (e.g. tsx test runner). Use an in-memory map so the rest
    // of the app code can run unchanged.
    const mem = new Map<string, string>();
    backend = {
      getItemAsync: async (k) => mem.get(k) ?? null,
      setItemAsync: async (k, v) => {
        mem.set(k, v);
      },
      deleteItemAsync: async (k) => {
        mem.delete(k);
      },
    };
  }
  return backend;
}

export async function getItemAsync(key: string): Promise<string | null> {
  try {
    return await loadBackend().getItemAsync(key);
  } catch {
    // iOS keychain / Android KeyStore failures land here.
    // Swallow to prevent white-screen on startup.
    return null;
  }
}

export async function setItemAsync(key: string, value: string): Promise<void> {
  try {
    return await loadBackend().setItemAsync(key, value);
  } catch {
    // silent
  }
}

export async function deleteItemAsync(key: string): Promise<void> {
  try {
    return await loadBackend().deleteItemAsync(key);
  } catch {
    // silent
  }
}
