// Config Plugin：把所有 Pod 的 IPHONEOS_DEPLOYMENT_TARGET 拉齐到 13.0,
// 修复新 Xcode (16+) 拒绝 9.0/10.0 老 deployment target 的构建错误,典型受
// 害者是 PromisesObjC 等间接依赖:
//
//   error: The iOS deployment target 'IPHONEOS_DEPLOYMENT_TARGET' is set to
//   9.0, but the range of supported deployment target versions is 12.0 to
//   26.5.99. (in target 'PromisesObjC-FBLPromises_Privacy')
//
// 不是改单个 Pod —— Expo prebuild 每次都会重写 ios/Podfile,所以必须用
// config plugin 在 prebuild 阶段注入。
//
// 实现方式:
//   1. 给 Podfile 顶部追加一个独立 helper(_kkcode_pin_pod_deployment_target!)
//   2. 在现有 react_native_post_install 调用之后追加一行 helper 调用,
//      让它在生成的 .xcconfig 里强制覆盖每个 Pod target 的 deployment target
//
// 反复 prebuild 不会重复注入:用 marker `_KKCODE_PIN_DEPLOYMENT_TARGET_INJECTED_`
// 做幂等保护。

const { withPodfile } = require("expo/config-plugins");

// 选 13.0 是因为:
//   - 满足 Xcode 26 的最低要求(12.0)且不会强迫
//     更老的 Pod 用过新的 API 而崩溃
//   - Expo SDK 56 默认是 16.4(项目 Podfile 已经是 16.4)
const POD_MIN_DEPLOYMENT_TARGET = "13.0";
const MARKER = "_KKCODE_PIN_DEPLOYMENT_TARGET_INJECTED_";

const HELPER_DEFINITION = `
# ${MARKER}
# 见 plugins/withIosPodDeploymentTarget.js
def _kkcode_pin_pod_deployment_target!(installer, target_version)
  installer.pods_project.targets.each do |t|
    t.build_configurations.each do |config|
      current = config.build_settings['IPHONEOS_DEPLOYMENT_TARGET']
      if current.nil? || current.to_f < target_version.to_f
        config.build_settings['IPHONEOS_DEPLOYMENT_TARGET'] = target_version
      end
    end
  end
end
`;

const HELPER_INVOCATION = `    _kkcode_pin_pod_deployment_target!(installer, '${POD_MIN_DEPLOYMENT_TARGET}')`;

module.exports = function withIosPodDeploymentTarget(config) {
  return withPodfile(config, (config) => {
    let contents = config.modResults.contents;

    // 幂等检查 —— 已经注入过就不再操作
    if (contents.includes(MARKER)) {
      return config;
    }

    // 1) 在文件顶部(在第一个 require 行之前)插入 helper 定义
    //    用注释 marker 包裹,方便被人工搜索/将来卸载
    const headerInsertion = HELPER_DEFINITION + "\n";
    // 找到 prepare_react_native_project! 之前的某个稳定锚点
    const requireAnchor = contents.indexOf("prepare_react_native_project!");
    if (requireAnchor === -1) {
      throw new Error(
        "withIosPodDeploymentTarget: cannot locate 'prepare_react_native_project!' in Podfile",
      );
    }
    contents = contents.slice(0, requireAnchor) + headerInsertion + contents.slice(requireAnchor);

    // 2) 在 react_native_post_install(...) 调用结束后追加 helper 调用
    //    匹配:react_native_post_install( ... :ccache_enabled => xxx, )
    //    react_native_post_install 跨多行,正则用非贪婪 + 多行模式
    const invocationPattern = /(react_native_post_install\([\s\S]*?\)\s*\n)/m;
    if (!invocationPattern.test(contents)) {
      throw new Error(
        "withIosPodDeploymentTarget: cannot locate 'react_native_post_install(...)' in Podfile",
      );
    }
    contents = contents.replace(invocationPattern, (match) => match + HELPER_INVOCATION + "\n");

    config.modResults.contents = contents;
    return config;
  });
};
