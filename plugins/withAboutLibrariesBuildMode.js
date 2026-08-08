/**
 * [INPUT]: 依赖 expo/config-plugins 的 Gradle/Dangerous Mods、react-native-legal 的 aboutLibraries 配置块及本目录许可证快照
 * [OUTPUT]: 对外提供 withAboutLibrariesBuildMode Config Plugin，普通构建解压快照，显式刷新时启用在线采集任务
 * [POS]: plugins 的 Android 许可证构建策略插件，在 app.json 中置于 react-native-legal 前以按 Expo Mod 逆序处理生成结果
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");

const { withAppBuildGradle, withDangerousMod } = require("expo/config-plugins");

const MARKER = "_KKCODE_ABOUT_LIBRARIES_BUILD_MODE_";
const SNAPSHOT_FILE = "aboutlibraries.android.json.gz";

module.exports = function withAboutLibrariesBuildMode(config) {
  config = withAppBuildGradle(config, (config) => {
    const contents = config.modResults.contents;

    if (contents.includes(MARKER)) {
      return config;
    }

    const blockPattern = /aboutLibraries\s*\{/;
    if (!blockPattern.test(contents)) {
      throw new Error(
        "withAboutLibrariesBuildMode: cannot locate the aboutLibraries block; list this plugin before react-native-legal in app.json",
      );
    }

    config.modResults.contents = contents.replace(
      blockPattern,
      `aboutLibraries {
    // ${MARKER}
    // Normal builds package the checked-in snapshot without registering collection tasks.
    registerAndroidTasks = System.getenv("ABOUT_LIBRARIES_ONLINE") == "1"
    offlineMode = System.getenv("ABOUT_LIBRARIES_ONLINE") != "1"
    gitHubApiToken = System.getenv("GITHUB_TOKEN") ?: System.getenv("GH_TOKEN")`,
    );
    return config;
  });

  return withDangerousMod(config, [
    "android",
    (config) => {
      const snapshotPath = path.join(config.modRequest.projectRoot, "plugins", SNAPSHOT_FILE);
      if (!fs.existsSync(snapshotPath)) {
        // 快照缺失时不抛错 — 让 prebuild 走通。release 阶段 aboutLibraries 会以
        // 空 raw 资源生成许可证页（open-source 仓库不预填任何许可证快照）。
        // 维护者运行 `npm run licenses:refresh:android` 即可生成并提交快照。
        console.warn(
          `[withAboutLibrariesBuildMode] ${snapshotPath} not found — skipping snapshot copy.`,
        );
        return config;
      }

      const rawDir = path.join(
        config.modRequest.platformProjectRoot,
        "app",
        "src",
        "main",
        "res",
        "raw",
      );
      fs.mkdirSync(rawDir, { recursive: true });
      fs.writeFileSync(
        path.join(rawDir, "aboutlibraries.json"),
        zlib.gunzipSync(fs.readFileSync(snapshotPath)),
      );
      return config;
    },
  ]);
};
