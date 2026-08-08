/**
 * [INPUT]: 依赖 21 个 src/i18n/locales translation resource、i18next CLDR 复数规则与 locales/*.json 原生权限文案
 * [OUTPUT]: 对外提供 i18nSuite，校验 21 语键覆盖、插值、复数与原生权限本地化
 * [POS]: test 的国际化回归套件，由 run.ts 统一执行
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { strict as assert } from "node:assert";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

import i18next from "i18next";

import ar from "../src/i18n/locales/ar";
import bg from "../src/i18n/locales/bg";
import de from "../src/i18n/locales/de";
import en from "../src/i18n/locales/en";
import es from "../src/i18n/locales/es";
import fr from "../src/i18n/locales/fr";
import hi from "../src/i18n/locales/hi";
import id from "../src/i18n/locales/id";
import it from "../src/i18n/locales/it";
import ja from "../src/i18n/locales/ja";
import ko from "../src/i18n/locales/ko";
import pl from "../src/i18n/locales/pl";
import ptBR from "../src/i18n/locales/pt-BR";
import pt from "../src/i18n/locales/pt";
import ru from "../src/i18n/locales/ru";
import th from "../src/i18n/locales/th";
import tr from "../src/i18n/locales/tr";
import uk from "../src/i18n/locales/uk";
import vi from "../src/i18n/locales/vi";
import zhCN from "../src/i18n/locales/zh-CN";
import zhTW from "../src/i18n/locales/zh-TW";
import { test } from "./harness.ts";

const resources = {
  "zh-CN": zhCN,
  "zh-TW": zhTW,
  en,
  ja,
  ko,
  de,
  fr,
  es,
  it,
  pt,
  "pt-BR": ptBR,
  ru,
  uk,
  bg,
  pl,
  tr,
  ar,
  hi,
  th,
  vi,
  id,
} as const;

const pluralSuffix = /_(zero|one|two|few|many|other)$/u;
const pluralKeys = [
  "sessions.sessionCount",
  "part.summaryTodos",
  "part.summaryQuestion",
  "licenses.count",
];
const permissionKeys = [
  "NSLocalNetworkUsageDescription",
  "NSCameraUsageDescription",
  "NSPhotoLibraryUsageDescription",
] as const;

function toExpoLocale(locale: keyof typeof resources) {
  if (locale === "zh-CN") return "zh-Hans";
  if (locale === "zh-TW") return "zh-Hant";
  return locale;
}

function flatten(value: unknown, prefix = "", result: Record<string, string> = {}) {
  if (!value || typeof value !== "object") return result;
  for (const [key, child] of Object.entries(value)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (child && typeof child === "object") flatten(child, path, result);
    else result[path] = String(child);
  }
  return result;
}

function interpolationVariables(value: string) {
  return [...value.matchAll(/\{\{\s*([^},\s]+)/gu)].map((match) => match[1]).sort();
}

async function translate(locale: keyof typeof resources, key: string, count: number) {
  const instance = i18next.createInstance();
  await instance.init({
    lng: locale,
    fallbackLng: false,
    resources: { [locale]: { translation: resources[locale] } },
  });
  return instance.t(key, { count });
}

export async function i18nSuite() {
  console.log("\n== i18n ==");

  await test("device locale resolves to its supported language, otherwise English", async () => {
    const { resolveDeviceLanguage } = await import("../src/i18n/index.ts");

    assert.equal(resolveDeviceLanguage("fr-FR"), "fr");
    assert.equal(resolveDeviceLanguage("zh-Hant-HK"), "zh-TW");
    assert.equal(resolveDeviceLanguage("pt-PT"), "pt");
    assert.equal(resolveDeviceLanguage("nl-NL"), "en");
    assert.equal(resolveDeviceLanguage(), "en");
  });

  await test("all locales cover every non-plural English key and interpolation", () => {
    const source = flatten(en);
    const sourceKeys = Object.keys(source)
      .filter((key) => !pluralSuffix.test(key))
      .sort();

    for (const [locale, resource] of Object.entries(resources)) {
      const target = flatten(resource);
      const targetKeys = Object.keys(target)
        .filter((key) => !pluralSuffix.test(key))
        .sort();
      assert.deepEqual(targetKeys, sourceKeys, `${locale} key coverage differs from en`);
      for (const key of sourceKeys) {
        assert.deepEqual(
          interpolationVariables(target[key]),
          interpolationVariables(source[key]),
          `${locale}:${key} interpolation differs from en`,
        );
      }
    }
  });

  await test("pluralized UI keys cover every CLDR category", async () => {
    for (const [locale, resource] of Object.entries(resources)) {
      const categories = new Intl.PluralRules(locale).resolvedOptions().pluralCategories;
      const flat = flatten(resource);
      for (const key of pluralKeys) {
        if (categories.length === 1) {
          assert.ok(key in flat || `${key}_other` in flat, `${locale} missing ${key}`);
        } else {
          for (const category of categories) {
            assert.ok(`${key}_${category}` in flat, `${locale} missing ${key}_${category}`);
          }
        }
        for (const count of [0, 1, 2, 5, 1.5]) {
          const result = await translate(locale as keyof typeof resources, key, count);
          assert.notEqual(result, key, `${locale}:${key} returned its raw key for ${count}`);
        }
      }
    }
  });

  await test("representative plural outputs use natural forms", async () => {
    assert.equal(await translate("en", "sessions.sessionCount", 1), "1 session");
    assert.equal(await translate("ru", "part.summaryQuestion", 2), "Заданы 2 вопроса");
    assert.equal(await translate("uk", "sessions.sessionCount", 2), "2 сесії");
    assert.equal(await translate("pl", "part.summaryTodos", 2), "2 zadania");
    assert.equal(await translate("ar", "part.summaryQuestion", 2), "طُرح سؤالان");
  });

  await test("all Expo locale files provide localized iOS permission prompts", () => {
    const localeDir = fileURLToPath(new URL("../locales/", import.meta.url));
    const files = readdirSync(localeDir)
      .filter((name) => name.endsWith(".json"))
      .sort();
    const expectedLocales = Object.keys(resources)
      .map((locale) => toExpoLocale(locale as keyof typeof resources))
      .sort();
    const appConfig = JSON.parse(readFileSync(new URL("../app.json", import.meta.url), "utf8")) as {
      expo?: { locales?: Record<string, string> };
    };
    const localeMap = appConfig.expo?.locales ?? {};

    assert.deepEqual(files, expectedLocales.map((locale) => `${locale}.json`).sort());
    assert.deepEqual(Object.keys(localeMap).sort(), expectedLocales);
    for (const locale of expectedLocales) {
      assert.equal(localeMap[locale], `./locales/${locale}.json`);
    }

    const english = JSON.parse(readFileSync(`${localeDir}/en.json`, "utf8")) as {
      ios: Record<string, unknown>;
    };
    for (const file of files) {
      const parsed = JSON.parse(readFileSync(`${localeDir}/${file}`, "utf8")) as {
        ios?: Record<string, unknown>;
      };
      for (const key of permissionKeys) {
        assert.equal(typeof parsed.ios?.[key], "string", `${file} missing ios.${key}`);
        assert.ok(String(parsed.ios?.[key]).trim().length > 0, `${file} has empty ios.${key}`);
        if (file !== "en.json") {
          assert.notEqual(
            parsed.ios?.[key],
            english.ios[key],
            `${file} did not localize ios.${key}`,
          );
        }
      }
    }
  });
}
