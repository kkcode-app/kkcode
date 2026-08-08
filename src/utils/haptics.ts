/**
 * [INPUT]: 依赖 react-native-haptic-feedback 的 trigger + HapticFeedbackTypes enum（Core Haptics + Android Composition API 跨平台触感），
 *          依赖 store/haptics-prefs 的 enabled 开关
 * [OUTPUT]: 对外提供 haptic 对象（selection/impact/impactHeavy/success/warning/error 方法）
 * [POS]: src/utils 的触感反馈统一封装，被全项目交互事件消费
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { trigger, HapticFeedbackTypes } from "react-native-haptic-feedback";

import { useHapticsPrefsStore } from "../store/haptics-prefs";

function isEnabled(): boolean {
  return useHapticsPrefsStore.getState().enabled;
}

function fire(type: HapticFeedbackTypes) {
  if (!isEnabled()) return;
  try {
    trigger(type, {
      enableVibrateFallback: true,
      ignoreAndroidSystemSettings: false,
    });
  } catch {
    // 防御性吞掉，不影响主流程
  }
}

export const haptic = {
  /** 切换选项、toggle、tab 切换 —— 最轻的"我点到了"反馈 */
  selection() {
    fire(HapticFeedbackTypes.selection);
  },

  /** 轻量物理感:成功完成一个次要动作 */
  impact() {
    fire(HapticFeedbackTypes.impactLight);
  },

  /** 重量物理感:重大操作前/后(删除、不可逆操作) */
  impactHeavy() {
    fire(HapticFeedbackTypes.impactHeavy);
  },

  /** 操作成功完成 —— 比 impact medium 语义更明确 */
  success() {
    fire(HapticFeedbackTypes.notificationSuccess);
  },

  /** 警告 —— 还没失败但用户应该注意(例如删除前的确认) */
  warning() {
    fire(HapticFeedbackTypes.notificationWarning);
  },

  /** 操作失败 —— 错误 toast / 提交失败 / 解析报错 */
  error() {
    fire(HapticFeedbackTypes.notificationError);
  },
};
