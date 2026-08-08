# src/i18n/locales/

> L2 | 父级: /src/i18n/CLAUDE.md

成员清单
en.ts: English source of truth，定义 translation 键、插值与 fallback 文案；**开发期新增 key 的首发文件之一**
zh-CN.ts: 简体中文语义锚点，提供中国大陆 UI 文案；**开发期新增 key 的首发文件之一**
zh-TW.ts: 繁體中文资源，采用台湾本地化术语；**开发期禁止手动改，用 `/i18n-fill` 补齐**
ja.ts: 日本語资源，统一です/ます体与技术术语
ko.ts: 한국어资源，统一敬语体与技术术语
de.ts: Deutsch 资源，统一 du 语体并提供 CLDR 复数
fr.ts: Français 资源，统一 vous 语体并提供 CLDR 复数
es.ts: Español 资源，统一 tú 语体并提供 CLDR 复数
it.ts: Italiano 资源，统一 tu 语体并提供 CLDR 复数
pt.ts: Português 资源，采用欧洲葡萄牙语并提供 CLDR 复数
pt-BR.ts: Português do Brasil 资源，采用巴西葡萄牙语并提供 CLDR 复数
ru.ts: Русский 资源，提供 one/few/many/other CLDR 复数
uk.ts: Українська资源，提供 one/few/many/other CLDR 复数
bg.ts: Български资源，提供 one/other CLDR 复数
pl.ts: Polski 资源，提供 one/few/many/other CLDR 复数
tr.ts: Türkçe 资源，统一土耳其语格变化与技术术语
ar.ts: العربية RTL 资源，提供 zero/one/two/few/many/other CLDR 复数
hi.ts: हिन्दी资源，统一印地语 UI 术语
th.ts: ภาษาไทย资源，统一通知与操作文案
vi.ts: Tiếng Việt 资源，统一 xóa/tùy 正字法
id.ts: Bahasa Indonesia 资源，统一 terowongan 等本地术语

工作流
开发期新增/修改/删除 key 时，**只动 en.ts 和 zh-CN.ts**。其余 19 个语言文件由发布期跑 `/i18n-fill` 批量补齐。详见 /AGENTS.md「i18n 词条工作流」章节。

法则: 成员完整·一行一文件·父级链接·技术词前置

[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
