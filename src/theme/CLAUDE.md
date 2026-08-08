# src/theme/

> L2 | 父级: /CLAUDE.md

成员清单
index.ts: useTheme() 引用稳定聚合层与 resolveThemeColors 纯函数，按真实主题依赖 memo 化 colors/spacing/radius/typography
colors.ts: 明暗 palette 与 Palette 类型定义
spacing.ts: 4pt 网格间距、radius 圆角、hitSlop 触摸区域常量
typography.ts: Apple HIG 字号阶梯常量，makeTypography(fontFamily, monoFontFamily) 按传入字体构建 typography 对象
breakpoints.ts: 响应式断点 token（twoColumn/contentMaxWidth/sidebarWidth 等），iPad 适配尺寸维度

法则: 成员完整·一行一文件·父级链接·技术词前置

[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
