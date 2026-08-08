# src/components/dev-panel/

> L2 | 父级: /src/components/CLAUDE.md

成员清单
JsonView.tsx: 递归 JSON 树渲染器，折叠/展开节点 + 等宽字体（复用 useFontStore fontId 解析 mono family），被所有 Dev* Tab 和 DevInspectModal 消费
DevInspectModal.tsx: 通用 JSON 查看 + 编辑弹层，基于 BottomSheet，编辑时实时校验 JSON 语法，被 DevStorage/DevLogs/DevNetwork 消费
DevOverview.tsx: Tab1 概览页，展示 App/设备/运行时信息与当前路由栈（useNavigationState）
DevStorage.tsx: Tab2 存储页，AsyncStorage 全量枚举（getAllKeys + multiGet）+ SecureStore 硬编码 key 清单，支持查看/编辑/删除/复制/搜索
DevStores.tsx: Tab3 状态页，import 全部 21 个 Zustand store 的 getState() 快照，按持久化/内存态分组，支持搜索和长按复制
DevLogs.tsx: Tab4 日志页，useSyncExternalStore 订阅 dev-logger 环形缓冲，按 level 多选筛选 + 搜索 + 暂停/清空/导出
DevNetwork.tsx: Tab5 网络页，封装 react-native-network-logger 的 NetworkLogger 组件（patch XHR+fetch），含拦截开关，自动捕获所有 HTTP 请求与 SSE（XHR 底层）
DevTools.tsx: Tab6 工具页，清空 AsyncStorage/重置 store/复制主题与连接配置/导出存储与日志/跳转引导/触发测试崩溃；含实验功能开关与开发者入口开关

依赖
../../store/*: DevStores 导入全部 store，DevTools/DevOverview 导入部分 store
../../services/dev-logger: DevLogs 消费日志缓冲
react-native-network-logger: DevNetwork 封装其 NetworkLogger 组件
../../utils/secure-store + dev-secure-keys: DevStorage 读写 SecureStore
../../theme: 全部组件复用 useTheme + makeStyles 工厂
../BottomSheet: DevInspectModal 基于 BottomSheet 实现

法则: 成员完整·一行一文件·父级链接·技术词前置

[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
