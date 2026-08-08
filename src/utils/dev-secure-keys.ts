/**
 * [INPUT]: 无外部依赖，硬编码项目已知 SecureStore key 清单
 * [OUTPUT]: SECURE_STORE_KEYS 常量数组
 * [POS]: utils/ 的开发面板辅助文件，被 dev-panel/DevStorage 消费，弥补 expo-secure-store 无 getAllKeys API 的缺陷
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */

// 项目所有通过 SecureStore 持久化的 key（凭据类敏感数据）。
// expo-secure-store 没有 getAllKeys API，无法运行时枚举，只能硬编码。
// 新增 SecureStore key 时务必同步追加到这里，否则开发面板看不到。
export const SECURE_STORE_KEYS: readonly string[] = [
  "kkcode.servers.v3",
  "kkcode.push-device-id",
  "kkcode.push-device-secret",
  "kkcode.push-paired-installations",
  "kkcode.push-notification-token",
];
