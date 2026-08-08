// ESLint flat config (Expo SDK 53+).
// 参考 https://docs.expo.dev/guides/using-eslint/

const { defineConfig, globalIgnores } = require("eslint/config");
const expoConfig = require("eslint-config-expo/flat");
const eslintPluginPrettierRecommended = require("eslint-plugin-prettier/recommended");

module.exports = defineConfig([
  globalIgnores([
    "node_modules/**",
    ".expo/**",
    "dist/**",
    "ios/**",
    "android/**",
    "web-build/**",
    "cli/node_modules/**",
    "relay/node_modules/**",
    "fastlane/report.xml",
    // Expo prebuild 产物
    "*.tsbuildinfo",
  ]),
  expoConfig,
  eslintPluginPrettierRecommended,
  {
    // 业务自定义规则
    rules: {
      // 允许 console.warn/error（项目里大量用 console.warn 做降级日志）
      "no-console": ["warn", { allow: ["warn", "error"] }],
      // React 19 不再需要显式 import React（runtime JSX transform）
      "react/react-in-jsx-scope": "off",
      "react/jsx-uses-react": "off",
      // TypeScript 项目里没必要禁止 any（业务复杂数据结构多）
      "@typescript-eslint/no-explicit-any": "off",
      // 业务里偶尔需要解构 props
      "react/destructuring-assignment": "off",
      // hooks 依赖检查开 warn 不开 error（依赖大对象时误报多）
      "react-hooks/exhaustive-deps": "warn",
      // Prettier 集成
      "prettier/prettier": "warn",
    },
  },
  {
    // babel/metro/fastlane 等 Node 环境配置
    files: ["babel.config.js", "metro.config.js", "fastlane/**/*.rb"],
    languageOptions: {
      globals: {
        process: "readonly",
        __dirname: "readonly",
        module: "readonly",
        require: "readonly",
      },
    },
  },
  {
    // 测试文件宽松规则
    files: ["test/**/*.{ts,tsx}", "**/*.test.{ts,tsx}"],
    rules: {
      "@typescript-eslint/no-non-null-assertion": "off",
      "no-empty": "off",
    },
  },
]);
