/**
 * [INPUT]: 依赖 i18next/react-i18next、expo-localization、AsyncStorage 与 locales 下 21 种 translation resource
 * [OUTPUT]: 对外提供 i18next 默认实例、语言选项/偏好管理、resources 与设备语言同步能力
 * [POS]: src/i18n 的初始化入口，负责设备语言探测、资源注册、回退与手动语言偏好持久化
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import i18next from "i18next";
import { initReactI18next } from "react-i18next";
import { getLocales } from "expo-localization";
import AsyncStorage from "@react-native-async-storage/async-storage";

import zhCN from "./locales/zh-CN";
import zhTW from "./locales/zh-TW";
import en from "./locales/en";
import ja from "./locales/ja";
import ko from "./locales/ko";
import de from "./locales/de";
import fr from "./locales/fr";
import es from "./locales/es";
import it from "./locales/it";
import ptBR from "./locales/pt-BR";
import pt from "./locales/pt";
import ru from "./locales/ru";
import uk from "./locales/uk";
import bg from "./locales/bg";
import pl from "./locales/pl";
import tr from "./locales/tr";
import ar from "./locales/ar";
import hi from "./locales/hi";
import th from "./locales/th";
import vi from "./locales/vi";
import id from "./locales/id";

export const LANGUAGE_KEY = "@kkcode/language";
const LEGACY_LANGUAGE_KEY = "@opencode/language";
export const SYSTEM_LANGUAGE = "system";

export const SUPPORTED_LANGUAGES = [
  { code: "zh-CN", label: "简体中文" },
  { code: "zh-TW", label: "繁體中文" },
  { code: "en", label: "English" },
  { code: "ja", label: "日本語" },
  { code: "ko", label: "한국어" },
  { code: "de", label: "Deutsch" },
  { code: "fr", label: "Français" },
  { code: "es", label: "Español" },
  { code: "it", label: "Italiano" },
  { code: "pt", label: "Português" },
  { code: "pt-BR", label: "Português (BR)" },
  { code: "ru", label: "Русский" },
  { code: "uk", label: "Українська" },
  { code: "bg", label: "Български" },
  { code: "pl", label: "Polski" },
  { code: "tr", label: "Türkçe" },
  { code: "ar", label: "العربية" },
  { code: "hi", label: "हिन्दी" },
  { code: "th", label: "ไทย" },
  { code: "vi", label: "Tiếng Việt" },
  { code: "id", label: "Bahasa Indonesia" },
] as const;

export type LanguageCode = (typeof SUPPORTED_LANGUAGES)[number]["code"];
export type LanguagePreference = LanguageCode | typeof SYSTEM_LANGUAGE;

const resources = {
  "zh-CN": { translation: zhCN },
  "zh-TW": { translation: zhTW },
  en: { translation: en },
  ja: { translation: ja },
  ko: { translation: ko },
  de: { translation: de },
  fr: { translation: fr },
  es: { translation: es },
  it: { translation: it },
  pt: { translation: pt },
  "pt-BR": { translation: ptBR },
  ru: { translation: ru },
  uk: { translation: uk },
  bg: { translation: bg },
  pl: { translation: pl },
  tr: { translation: tr },
  ar: { translation: ar },
  hi: { translation: hi },
  th: { translation: th },
  vi: { translation: vi },
  id: { translation: id },
};

const languagePreferenceListeners = new Set<() => void>();
let languagePreference: LanguagePreference = SYSTEM_LANGUAGE;

function isLanguageCode(value: string): value is LanguageCode {
  return value in resources;
}

function updateLanguagePreference(next: LanguagePreference): void {
  if (languagePreference === next) return;
  languagePreference = next;
  languagePreferenceListeners.forEach((listener) => listener());
}

export function getLanguagePreference(): LanguagePreference {
  return languagePreference;
}

export function subscribeToLanguagePreference(listener: () => void): () => void {
  languagePreferenceListeners.add(listener);
  return () => languagePreferenceListeners.delete(listener);
}

/** Converts the device's first preferred BCP 47 tag to a supported app language. */
export function resolveDeviceLanguage(tag?: string): LanguageCode {
  const normalizedTag = tag?.trim();
  if (normalizedTag && isLanguageCode(normalizedTag)) return normalizedTag;

  const subtags = normalizedTag?.split("-") ?? [];
  const language = subtags[0]?.toLowerCase();
  if (language === "zh") {
    const usesTraditionalScript = subtags.some(
      (subtag) =>
        subtag.toLowerCase() === "hant" || ["TW", "HK", "MO"].includes(subtag.toUpperCase()),
    );
    return usesTraditionalScript ? "zh-TW" : "zh-CN";
  }
  if (language === "pt") {
    return subtags.some((subtag) => subtag.toUpperCase() === "BR") ? "pt-BR" : "pt";
  }
  if (language && isLanguageCode(language)) return language;

  return "en";
}

function detectDeviceLanguage(): LanguageCode {
  return resolveDeviceLanguage(getLocales()[0]?.languageTag);
}

async function applyLanguage(code: LanguageCode): Promise<void> {
  await i18next.changeLanguage(code);
}

// 同步初始化（用设备语言先启动），AsyncStorage 读取后再切换
i18next.use(initReactI18next).init({
  resources,
  lng: detectDeviceLanguage(),
  fallbackLng: "en",
  interpolation: { escapeValue: false },
});

// 异步加载用户保存的语言偏好，有则覆盖；
// 同时一次性迁移旧 key 到新 key（KKCode 改名前用的是 @opencode/language）。
(async () => {
  let saved = await AsyncStorage.getItem(LANGUAGE_KEY);
  if (saved == null) {
    const legacy = await AsyncStorage.getItem(LEGACY_LANGUAGE_KEY);
    if (legacy != null) {
      await AsyncStorage.setItem(LANGUAGE_KEY, legacy);
      await AsyncStorage.removeItem(LEGACY_LANGUAGE_KEY);
      saved = legacy;
    }
  }
  if (saved && isLanguageCode(saved)) {
    updateLanguagePreference(saved);
    await applyLanguage(saved);
  }
})();

export async function setLanguage(code: LanguageCode): Promise<void> {
  await AsyncStorage.setItem(LANGUAGE_KEY, code);
  updateLanguagePreference(code);
  await applyLanguage(code);
}

export async function followSystemLanguage(): Promise<void> {
  await AsyncStorage.removeItem(LANGUAGE_KEY);
  updateLanguagePreference(SYSTEM_LANGUAGE);
  await applyLanguage(detectDeviceLanguage());
}

/** Refreshes the app language after a device locale change when no manual preference is saved. */
export async function syncDeviceLanguage(deviceLanguageTag?: string): Promise<void> {
  if (languagePreference !== SYSTEM_LANGUAGE) return;
  await applyLanguage(
    deviceLanguageTag === undefined
      ? detectDeviceLanguage()
      : resolveDeviceLanguage(deviceLanguageTag),
  );
}

export default i18next;
export { resources };
