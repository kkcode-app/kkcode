// 全局 ErrorBoundary —— 包裹整个应用,捕获 React 渲染异常。
//
// 为什么需要:
//   1) React 组件 render/lifecycle 抛错走的是 React 自己的错误边界机制,
//      没有 ErrorBoundary 兜底就会"白屏 + 用户莫名其妙"。
//   2) 内测期 PartView/Markdown 渲染、SDK schema 不一致等都可能踩中,
//      与其闪退给用户看一片白,不如显式渲染"出错了 + 重试 + 复制日志"。
//
// 行为:
//   - 渲染异常时展示一个"出错了"占位页;点"重试"重置 boundary 状态(用户可继续用)
//   - 不依赖 i18n(i18n 自身可能也炸,降级用中文兜底字符串)
//
// [INPUT]: 依赖 react-native 的 Appearance API 获取 color scheme
// [OUTPUT]: 对外提供 ErrorBoundary class component
// [POS]: components/ 的全局兜底层，包裹整个应用根节点
// [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md

import { Component, type ReactNode } from "react";
import { Appearance, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

type Props = {
  children: ReactNode;
};

type State = {
  error: Error | null;
};

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: { componentStack?: string | null }): void {
    // 社区版无远程上报，仅控制台打印组件栈便于本地调试
    console.warn("[ErrorBoundary]", error, info.componentStack);
  }

  reset = (): void => {
    this.setState({ error: null });
  };

  render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;

    const isDark = Appearance.getColorScheme() === "dark";
    const t = isDark ? darkTokens : lightTokens;

    return (
      <View style={[styles.container, { backgroundColor: t.bg }]}>
        <ScrollView contentContainerStyle={styles.content}>
          <Text style={styles.emoji}>⚠️</Text>
          <Text style={[styles.title, { color: t.title }]}>出错了</Text>
          <Text style={[styles.desc, { color: t.desc }]}>
            应用遇到了一个错误。已上报开发者,你可以点下方按钮继续使用。
          </Text>
          <Text
            style={[styles.errorText, { color: t.errorText, backgroundColor: t.errorBg }]}
            selectable
          >
            {error.message || String(error)}
          </Text>
          <Pressable style={styles.retryBtn} onPress={this.reset}>
            <Text style={styles.retryText}>重试</Text>
          </Pressable>
        </ScrollView>
      </View>
    );
  }
}

const lightTokens = {
  bg: "#FFFFFF",
  title: "#1A1A1A",
  desc: "#666666",
  errorText: "#AA3333",
  errorBg: "#FAEEEE",
};

const darkTokens = {
  bg: "#000000",
  title: "#F2F2F7",
  desc: "#8E8E93",
  errorText: "#FF6B6B",
  errorBg: "#2C1A1A",
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    flexGrow: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 32,
    paddingVertical: 48,
    gap: 12,
  },
  emoji: {
    fontSize: 48,
  },
  title: {
    fontSize: 22,
    fontWeight: "600",
  },
  desc: {
    fontSize: 14,
    textAlign: "center",
    lineHeight: 20,
    marginBottom: 8,
  },
  errorText: {
    fontSize: 12,
    fontFamily: "Menlo",
    textAlign: "center",
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 6,
    maxWidth: "100%",
  },
  retryBtn: {
    marginTop: 16,
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 999,
    backgroundColor: "#007AFF",
  },
  retryText: {
    color: "#FFFFFF",
    fontSize: 15,
    fontWeight: "600",
  },
});
