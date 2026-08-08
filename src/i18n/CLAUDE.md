# src/i18n/

> L2 | 父级: /CLAUDE.md

成员清单
index.ts: i18next 初始化层，initReactI18next + expo-localization 设备语言探测/同步 + AsyncStorage 手动语言偏好持久化；默认跟随系统，导出语言选项、偏好管理与资源，含 @opencode/language → @kkcode/language 一次性迁移
locales/: 21 种语言翻译文件目录（zh-CN/zh-TW/en/ja/ko/de/fr/es/it/pt/pt-BR/ru/uk/bg/pl/tr/ar/hi/th/vi/id），en.ts 为键与插值 source of truth、zh-CN.ts 为语义锚点，各语言按 CLDR 补齐 session/todo/question/license 复数变体；详见 locales/CLAUDE.md

支持语言
zh-CN 简体中文 | zh-TW 繁體中文 | en English | ja 日本語 | ko 한국어
de Deutsch | fr Français | es Español | it Italiano
pt Português | pt-BR Português (BR)
ru Русский | uk Українська | bg Български | pl Polski | tr Türkçe
ar العربية（RTL，UI 暂未翻转） | hi हिन्दी | th ไทย | vi Tiếng Việt | id Bahasa Indonesia

依赖
i18next + react-i18next: 国际化核心
expo-localization: 设备语言探测（getLocales）
@react-native-async-storage/async-storage: 用户语言偏好持久化

已知遗留
ar（阿拉伯语）：仅翻译文件上线，UI 方向未做 RTL 翻转。代码中 45+ 处硬编码 marginLeft/Right/paddingLeft/Right/left/right 不会自动镜像；如需完整 RTL 体验，需专项改造样式 + I18nManager.allowRTL/forceRTL。

法则: 成员完整·一行一文件·父级链接·技术词前置

[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
