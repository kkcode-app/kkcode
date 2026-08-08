// Entry redirector:
//   1. 首次启动且未看过应用介绍 → /onboarding
//   2. 没有连接 → /servers
//   3. 否则 → /sessions（工作目录跟随会话，按需在新建会话时挑选）
//
// 用 useEffect + getState() 代替响应式 <Redirect>，避免在用户配置服务器期间
// active 状态发生变化时再次触发重定向，导致与 server-edit 的导航产生竞争。

import { useRouter } from "expo-router";
import { useEffect } from "react";

import { useConnectionStore } from "../src/store/connection";
import { useOnboardingStore } from "../src/store/onboarding";

export default function Index() {
  const router = useRouter();

  useEffect(() => {
    const active = useConnectionStore.getState().active;
    const onboardingCompleted = useOnboardingStore.getState().completed;

    if (!onboardingCompleted) {
      router.replace("/onboarding?initial=1");
    } else if (!active) {
      router.replace("/servers");
    } else {
      router.replace("/sessions");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return null;
}
