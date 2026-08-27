# News Nook Web / Android 构建指南

News Nook（有所闻）使用 React + Vite 构建 Web 应用，并通过 Capacitor 8 打包为原生 Android 应用。

产品说明见根目录 [`README.md`](../README.md)。

## 环境要求

- Node.js 22 或更高版本
- Android SDK（API 36、Build Tools 36）
- JDK 21（Android Studio 内置 JBR 也可以）

构建脚本会依次读取系统环境变量和常见安装目录：

- `ANDROID_HOME` / `ANDROID_SDK_ROOT`
- `JAVA_HOME`
- Windows 的 Android Studio、Android SDK 和 `%LOCALAPPDATA%\NewsNook\toolchains` 本地工具链目录

## 初始化

```bash
npm install
npm run android:keystore:init
```

`android:keystore:init` 只允许执行一次，会在本机生成：

- `.android-signing/newsnook-release.jks`
- `.env.android.local`

二者均已被 Git 忽略。请立即将这两个文件一起备份到安全的密码管理或密钥托管系统。应用发布后，后续版本必须继续使用同一个签名密钥；丢失密钥可能导致无法更新已发布应用。

CI 环境不应运行初始化脚本，应从密钥系统注入以下变量，并将 keystore 恢复到构建机：

```text
NEWSNOOK_KEYSTORE_FILE
NEWSNOOK_KEYSTORE_PASSWORD
NEWSNOOK_KEY_ALIAS
NEWSNOOK_KEY_PASSWORD
```

可选账户云同步的 API 地址由 Vite 在构建时写入前端包（`VITE_CLOUD_BASE_URL`）。正式发布请用环境变量注入，**不要**把真实地址写进仓库代码或注释。

本机 **Web 开发 / Web 生产构建 / Android** 共用一个文件：仓库根目录 `.env.local`
（Vite 在 `dev` 与 `build` 模式都会加载；`*.local` 已 gitignore）。
不要用 `.env.production.local`  alone——`npm run dev` 读不到它，会落到占位默认值。

| 场景 | 注入方式 |
|---|---|
| 本机 Web / Android | 根目录 `.env.local`（一份共用；改完需重启 `npm run dev`） |
| GitHub Actions | 仓库 Variables 设 `VITE_CLOUD_BASE_URL`；`android-release` / `android-manual-build` 已挂到 job `env` |
| Cloudflare Pages | 在 Pages 项目的 Build environment variables 中设置同名变量 |

未注入时客户端回退到代码里的占位默认值；云不可达不影响本地阅读。
## 构建 Android

默认同时生成两种签名 Release APK：

```bash
npm run android:apk
```

默认同时生成两种用于 Google Play 发布的签名 Release AAB：

```bash
npm run android:aab
```

两个命令都会自动完成 Web 生产构建、Capacitor 同步、Gradle Release 构建、R8 压缩、资源裁剪和签名校验。

| 变体 | 本地翻译 | 设置中的离线入口 | 用途 |
|---|---|---|---|
| `cloud` | 不编译 ML Kit / Bergamot 原生库 | 隐藏 | 默认轻量版，仅使用 DeepLX、Google、Azure、DeepL 等云服务 |
| `local` | 编译 ML Kit + Bergamot JNI；语言模型/语对仍按需下载 | 显示 | 需要离线翻译的完整版（minSdk 28，Bergamot 当前仅 `arm64-v8a`） |

构建可翻译的 Bergamot 引擎（而非 stub）前，先拉取第三方源码：

```bash
npm run bergamot:init
npm run android:apk:local
```

`bergamot:init` 不只是 clone；它还会自动对 `bergamot-translator` / `marian-dev` / `ssplit-cpp` 应用当前需要的 Android 兼容补丁。因此如果你删除了 `android/app/src/local/cpp/third_party/bergamot-translator`，重新执行同一命令即可恢复到可编译状态。

未执行 `bergamot:init` 时，local 包仍可编译（stub 引擎），设置页可下载 Mozilla 语对模型，但翻译会提示引擎未链接。

需要注意：

- Bergamot 目前只为 `arm64-v8a` 编入原生库；32 位 ARM、x86 / x86_64 模拟器不支持
- 在这些不支持设备上，应用会自动把 `bergamot` 视为不可用并回退到其它翻译 provider

最终产物位于：

```text
artifacts/android/newsnook-<version>-cloud-release.apk
artifacts/android/newsnook-<version>-local-release.apk
artifacts/android/newsnook-<version>-cloud-release.aab
artifacts/android/newsnook-<version>-local-release.aab
```

只构建其中一种时使用 `npm run android:apk:cloud`、`npm run android:apk:local`、`npm run android:aab:cloud` 或 `npm run android:aab:local`。两个变体使用相同包名和签名，面向同一应用渠道，不能在同一设备上并存。

版本号只改一处：`package.json` 的 `"version"`（semver，如 `1.1.0`）。

- 产物文件名：`newsnook-<version>-<cloud|local>-release.apk|aab`
- 包内 `versionName`：同一字符串
- 包内 `versionCode`：由 `X.Y.Z` 推导为 `X*10000 + Y*100 + Z`（例如 `1.2.3` → `10203`）

发版时把 `package.json` 的 version 调高即可，再跑 `npm run android:apk` / `android:aab`。上架 Google Play 时 `versionCode` 必须严格递增；正常升 semver 已满足。仅在极少数「不改 versionName、只再提一次 code」时才覆盖：

```powershell
$env:NEWSNOOK_VERSION_CODE = "10204"
npm run android:aab
```

## 启动闪屏

```bash
npm run assets
```

只更新 Android 各密度的 `splash.png`（含 night），**不会**改动 Adaptive Icon。
源图优先 `assets/splash.png` / `assets/splash-dark.png`；没有则用 `public/logo-light.svg` 合成。
启动图标维护于 `android/app/src/main/res/`（Adaptive Icon：`drawable-nodpi` 层 + `mipmap-anydpi-v26/v33`）。

母版在 `assets/android-icon/`：
- 前景/单色按 **48dp** 居中落在 108dp 画布上（规范：logo ≥48dp 且 ≤66dp）。不要画满 66dp 安全区边缘——`AdaptiveIconDrawable` 实际把图层中心 **72dp** 映射到启动器可视区，画满 66dp 时真机会占满约 92% 圆面。
- Legacy mipmap：`node scripts/generate-legacy-launcher-icons.mjs`
- Web path SVG（`mark-path.txt`）：`node scripts/generate-web-brand-icons.mjs`（Web 标不套 adaptive 边距）

## 开发和调试

同步 Web 资源与原生工程：

```bash
npm run android:sync
```

连接设备或启动模拟器后运行 Debug 版本。默认运行不带 ML Kit 的轻量版；需要验证本地翻译时运行 `local` 版：

```bash
npm run android:run
npm run android:run:local
```

在 Android Studio 中打开原生工程：

```bash
npm run android:open
```

## 发布前检查

1. 确认包名 `com.aizeek.newsnook`。首次上架后不要修改。
2. 递增 `package.json` 的 `"version"`（会同步推导 `versionName` / `versionCode`）。
3. 执行 `npm run lint` 和 `npm run android:aab`。
4. 在至少一台真实 Android 设备上验证启动、新闻加载、正文阅读、外链打开、返回键和持久化设置。
5. 将 AAB 上传 Google Play，并启用 Play App Signing。

原生工程位于 `android/`，应与 Web 代码一同纳入版本控制；构建产物、本机 SDK 配置和签名材料不得提交。
