// Config Plugin：将 android/build.gradle 的 repositories 替换为国内镜像
// 解决 google() / mavenCentral() 在国内无法访问导致 gradle 构建失败的问题
const { withProjectBuildGradle } = require("expo/config-plugins");

const CHINA_MIRRORS = `
    maven { url 'https://maven.aliyun.com/repository/google' }
    maven { url 'https://maven.aliyun.com/repository/central' }
    maven { url 'https://maven.aliyun.com/repository/jcenter' }
    maven { url 'https://maven.aliyun.com/repository/gradle-plugin' }
`;

module.exports = function withAndroidChinaMirrors(config) {
  return withProjectBuildGradle(config, (config) => {
    let contents = config.modResults.contents;

    // 替换 buildscript.repositories
    contents = contents.replace(
      /buildscript\s*\{[\s\S]*?repositories\s*\{([^}]*)\}/,
      (match, repos) => {
        if (repos.includes("maven.aliyun.com")) return match;
        return match.replace(
          /repositories\s*\{[^}]*\}/,
          `repositories {${CHINA_MIRRORS}    google()\n    mavenCentral()\n  }`,
        );
      },
    );

    // 替换 allprojects.repositories
    contents = contents.replace(
      /allprojects\s*\{[\s\S]*?repositories\s*\{([^}]*)\}/,
      (match, repos) => {
        if (repos.includes("maven.aliyun.com")) return match;
        return match.replace(
          /repositories\s*\{[^}]*\}/,
          `repositories {${CHINA_MIRRORS}    google()\n    mavenCentral()\n    maven { url 'https://www.jitpack.io' }\n  }`,
        );
      },
    );

    config.modResults.contents = contents;
    return config;
  });
};
