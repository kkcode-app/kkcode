/**
 * [INPUT]: 依赖 Node Module 加载器，为 React Native、Expo 原生模块与字体静态资源提供测试替身
 * [OUTPUT]: 在测试导入前注册全局模块 mock、字体/图片静态资源与可控的 RN 尺寸/配色、SecureStore/FileSystem/ImagePicker 状态
 * [POS]: test 的 Node 环境预加载入口，使业务模块可脱离原生运行时执行单元测试
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
//
// This file is loaded via `tsx --import` BEFORE any test imports, so it can
// intercept modules that depend on React Native / native code.
//
// Modules mocked here:
//   - expo-modules-core: requireNativeModule crashes in Node; we provide a
//     no-op stub so native-backed modules can be imported by tests.
//   - expo-secure-store: native module; we provide an in-memory Map backend.
//   - expo-image-picker: native module; we provide a controllable mock.
//   - expo-font: native font registry; we provide an in-memory registry.
//   - expo-file-system: native File/Directory classes crash in Node; minimal stub.
//   - expo-localization: device locale access; stable empty default for i18n tests.
//   - react-native: Flow syntax (`import typeof`) breaks esbuild; stub with
//     Platform/useWindowDimensions and no-op components.

import { Module } from "node:module";

const origResolve = (Module as any)._resolveFilename;
const stubs: Record<string, any> = {};

// Metro 将字体与图片 require() 编译为资源 ID；Node 测试只需稳定占位值。
const staticAssetExtension = (module: any, filename: string) => {
  module.exports = filename;
};
(Module as any)._extensions[".ttf"] = staticAssetExtension;
(Module as any)._extensions[".svg"] = staticAssetExtension;
(Module as any)._extensions[".png"] = staticAssetExtension;

// ── expo-modules-core stub ──
stubs["expo-modules-core"] = {
  requireNativeModule: () => ({}),
  EventEmitter: class {
    addListener() {
      return { remove() {} };
    }
  },
};

// ── expo-secure-store stub ──
// In Node, the real expo-secure-store can be required (it finds
// expo-modules-core via our stub above) but its functions are no-ops that
// silently return undefined. Tests need an in-memory Map backend instead.
const secureStoreMap = new Map<string, string>();
stubs["expo-secure-store"] = {
  getItemAsync: async (k: string) => secureStoreMap.get(k) ?? null,
  setItemAsync: async (k: string, v: string) => {
    secureStoreMap.set(k, v);
  },
  deleteItemAsync: async (k: string) => {
    secureStoreMap.delete(k);
  },
};
(globalThis as any).__SECURE_STORE_MAP = secureStoreMap;

// ── expo-image-picker stub ──
let _pickerResult: any = { canceled: true, assets: [] };
stubs["expo-image-picker"] = {
  launchImageLibraryAsync: async () => _pickerResult,
};
(globalThis as any).__PICKER_MOCK = {
  setResult(result: any) {
    _pickerResult = result;
  },
  reset() {
    _pickerResult = { canceled: true, assets: [] };
  },
};

// ── expo-font stub ──
const loadedFonts = new Set<string>();
stubs["expo-font"] = {
  isLoaded: (family: string) => loadedFonts.has(family),
  loadAsync: async (family: string) => {
    loadedFonts.add(family);
  },
};

// ── expo-localization stub ──
stubs["expo-localization"] = {
  getLocales: () => [],
  useLocales: () => [],
};

// ── expo-file-system stub ──
// expo-file-system 的 File/Directory 依赖原生模块，在 Node 下 requireNativeModule
// 返回 {}，导致 `class File extends ExpoFileSystem.FileSystemFile` 抛
// "Class extends value undefined"。这里提供最小桩。
// arrayBuffer() 故意 reject，模拟"文件读取失败"降级路径，让 image-attach
// 测试覆盖 catch 分支（真实环境下 base64 缺失时 File 读取可能成功也可能失败）。
const mockFiles = new Set<string>();
const documentUri = "file:///current-container/Documents/";
function uriOf(value: any): string {
  return typeof value === "string" ? value : value.uri;
}
function joinUri(parts: any[]): string {
  return parts
    .map(uriOf)
    .reduce((base, part) => `${base.replace(/\/$/, "")}/${part.replace(/^\//, "")}`);
}
class MockFile {
  uri: string;
  constructor(...parts: any[]) {
    this.uri = parts.length === 1 ? uriOf(parts[0]) : joinUri(parts);
  }
  get name() {
    return this.uri.split("?")[0].split("/").pop() || "";
  }
  get exists() {
    return mockFiles.has(this.uri);
  }
  async copy(destination: MockFile) {
    mockFiles.add(destination.uri);
  }
  delete() {
    mockFiles.delete(this.uri);
  }
  async arrayBuffer(): Promise<ArrayBuffer> {
    throw new Error("[stub] expo-file-system not available in Node");
  }
}
class MockDirectory {
  uri: string;
  exists = true;
  constructor(...parts: any[]) {
    this.uri = parts.length === 1 ? uriOf(parts[0]) : `${joinUri(parts)}/`;
  }
  create() {
    this.exists = true;
  }
  list(): MockFile[] {
    // 列出 mock 文件系统中所有直接属于此目录的文件
    const prefix = this.uri;
    const result: MockFile[] = [];
    for (const fileUri of mockFiles) {
      if (!fileUri.startsWith(prefix)) continue;
      const rest = fileUri.slice(prefix.length);
      if (!rest || rest.includes("/")) continue;
      result.push(new MockFile(fileUri));
    }
    return result;
  }
}
stubs["expo-file-system"] = {
  File: MockFile,
  Directory: MockDirectory,
  Paths: { document: { uri: documentUri } },
};
(globalThis as any).__FILE_SYSTEM_MOCK = { files: mockFiles, documentUri };

// ── react-native stub ──
// react-native uses Flow syntax (`import typeof`) that esbuild/tsx cannot parse.
// We provide a minimal runtime stub with the values that tests actually touch:
//   - Platform (OS, isPad, select)
//   - useWindowDimensions / useColorScheme (return mocks that tests can override)
//   - Other commonly imported values default to no-op components/functions.
const rnMockState = { width: 375, height: 812, colorScheme: "light" as "light" | "dark" | null };
stubs["react-native"] = {
  Platform: {
    OS: "ios",
    get isPad() {
      return (globalThis as any).__RN_MOCK_IS_PAD ?? false;
    },
    select: (obj: Record<string, any>) => obj.ios ?? obj.default ?? obj.android,
    Version: undefined,
  },
  useWindowDimensions: () => ({ width: rnMockState.width, height: rnMockState.height }),
  useColorScheme: () => rnMockState.colorScheme,
  // Components are not used in unit tests; provide minimal stubs for import safety.
  View: function View() {},
  Text: function Text() {},
  TextInput: function TextInput() {},
  ScrollView: function ScrollView() {},
  KeyboardAvoidingView: function KeyboardAvoidingView() {},
  FlatList: function FlatList() {},
  Pressable: function Pressable() {},
  TouchableOpacity: function TouchableOpacity() {},
  TouchableHighlight: function TouchableHighlight() {},
  TouchableWithoutFeedback: function TouchableWithoutFeedback() {},
  Image: function Image() {},
  Modal: function Modal() {},
  SafeAreaView: function SafeAreaView() {},
  StyleSheet: { create: (s: any) => s, flatten: (s: any) => s },
  Animated: {
    Value: class {},
    timing: () => ({ start: () => {} }),
    spring: () => ({ start: () => {} }),
  },
  Easing: {},
  PanResponder: { create: () => ({}) },
  // Allow tests to override dimensions at runtime.
  __setDimensions: (w: number, h: number) => {
    rnMockState.width = w;
    rnMockState.height = h;
  },
  __setColorScheme: (scheme: "light" | "dark" | null) => {
    rnMockState.colorScheme = scheme;
  },
};
(globalThis as any).__RN_MOCK_STATE = rnMockState;

// ── Install interception ──
(Module as any)._resolveFilename = function (request: string, ...args: any[]) {
  if (stubs[request]) return `__stub__:${request}`;
  return origResolve.call(this, request, ...args);
};

for (const [name, exports] of Object.entries(stubs)) {
  (Module as any)._cache[`__stub__:${name}`] = {
    id: `__stub__:${name}`,
    filename: `__stub__:${name}`,
    loaded: true,
    exports,
  };
}
