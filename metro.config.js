const { getDefaultConfig } = require("expo/metro-config");

const config = getDefaultConfig(__dirname);

config.resolver.extraNodeModules = {
  ...config.resolver.extraNodeModules,
  punycode: require.resolve("punycode"),
};

// 生产构建走 Metro/terser 的 drop_console,把 release 包里的 console.log/info/debug
// 全部抹掉(保留 console.warn/error,留作运行时诊断信号)。
//
// 不用 babel-plugin-transform-remove-console:
//   Expo SDK 56 + RN 0.85 的转换链是 SWC,不是 Babel。一旦 babel.config.js
//   出现就会强迫 Metro 走 babel-preset-expo,而 babel-preset-expo 嵌套在
//   expo/node_modules/ 里 babel resolver 找不到,会报
//   "Cannot read properties of undefined (reading 'transformFile')"。
//   走 minifier 这层是 Expo 官方支持的姿势,只在 minify 阶段生效,无副作用。
config.transformer = {
  ...config.transformer,
  minifierConfig: {
    ...(config.transformer && config.transformer.minifierConfig),
    compress: {
      ...(config.transformer &&
        config.transformer.minifierConfig &&
        config.transformer.minifierConfig.compress),
      drop_console: ["log", "info", "debug", "trace"],
    },
  },
};

module.exports = config;
