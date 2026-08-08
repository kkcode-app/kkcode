# src/hooks/

> L2 | 父级: /CLAUDE.md

成员清单
useResponsive.ts: 响应式布局判断 hook，基于 Platform.isPad + useWindowDimensions 给出 splitView/isWide/限宽值，iPad 适配单一来源
useStickToBottom.ts: 聊天虚拟列表滚动状态机，以最小 scrollTo* handle 和稳定 facade 提供流式跟随、Android touchCancel 原生接管隔离、基于 drag/momentum 实时落点的用户介入锁定与仅 pinned 时显示回底按钮的滚动铁律（见 docs/chat-scroll-sovereignty.md）

法则: 成员完整·一行一文件·父级链接·技术词前置

[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
