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

APK 自托管分发会对 `local` 按 ABI 拆包，避免每次更新重复下载其它 CPU 架构的 ML Kit native runtime。为了让尚未识别 ABI 清单的旧客户端平滑升级，发布流程仍保留一个 universal local APK；新客户端会按 `Build.SUPPORTED_ABIS` 优先下载匹配专包，专包缺失时自动回退 universal。

最终产物位于：

```text
artifacts/android/newsnook-<version>-cloud-release.apk
artifacts/android/newsnook-<version>-local-release.apk                 # universal 迁移兼容包
artifacts/android/newsnook-<version>-local-arm64-v8a-release.apk
artifacts/android/newsnook-<version>-local-armeabi-v7a-release.apk
artifacts/android/newsnook-<version>-local-x86-release.apk
artifacts/android/newsnook-<version>-local-x86_64-release.apk
artifacts/android/newsnook-<version>-cloud-release.aab
artifacts/android/newsnook-<version>-local-release.aab
```

ABI split **只用于 APK**。AAB 不在本地预拆 ABI，由 Google Play / bundletool 在分发阶段生成设备适配 split。`npm run android:apk:local` 因此会生成 5 个 local APK；Android Studio debug、`android:run:local` 和 AAB 构建不启用该 split。

## 自托管 APK 统一增量更新

应用内更新的唯一优化原则是：**已安装 APK 的精确字节 SHA-256 命中差分源，且能合成出发布时签名的目标 APK**。无论 cloud、local universal 还是 local 各 ABI，均使用同一个 GDIFF + Gzip 协议；不按包体大小、功能模块或变体添加开启阈值。

- GitHub Actions 构建、签名并校验所有 APK；从同一 Stable/Beta 轨道最近 3 个已发布版本的 GitHub Releases 取回对应变体的**原始签名 APK**，对每个可用源 APK 与当前目标 APK 生成标准 GDIFF，然后压缩为 `.gdiff.gz`。这是一条“历史安装包 → 最新安装包”的直达路径，不要求用户逐版本升级。
- 每个差分生成后，CI **实际反向合成**目标 APK，校验目标文件大小、SHA-256 和签名证书；不一致就终止发布。差分文件按源、目标 SHA 命名，R2 存储于 `newsnook/{track}/deltas/`。`latest.json` 的 `schemaVersion: 2` 为每个 APK asset 增加可选的 `deltas` 列表，仍保留完整 APK URL 和 SHA。旧客户端忽略新增字段，继续正常全量更新。
- 新客户端读取 Android 当前安装的 `ApplicationInfo.sourceDir`，校验整个已安装 APK 的 SHA-256 后选择完全一致的差分。若设备以多个 split APK 安装、缺少历史差分、无法校验源文件，则自然退回完整 APK。这是对输入文件身份与可访问性的判断，不是 cloud/local 分类逻辑。
- 原生下载器先核对补丁 SHA-256 与长度，再于工作目录流式合成临时 APK，限制最大输出大小，核对最终完整 APK 的 SHA-256、长度、包名、版本号与签名；**不编辑已安装 APK、不自行签名、不绕过 Android 系统安装器**。差分下载、校验或合成失败只回退一次完整 APK，禁止差分重试循环。
- R2 先发布完整 APK 与差分对象，确认对象可访问后再原子更新最新清单；清理过期对象时仅保留最新清单引用的差分。GitHub Releases 一直保留完整 APK，兼作灾备和历史差分的可审计输入。对于已有旧版尚不支持增量的客户端，首次升级仍是完整 APK；升级到带增量能力的客户端后才能使用差分。

差分是传输优化，**完整 APK 是正确性与灾备的永久兜底**。同一版本 cloud/local 切换如果没有精确源包差分也走完整 APK，不会尝试针对不一致的源包强行打补丁。Google Play AAB/split 安装暂不走此自托管单 APK 差分路径。

只构建其中一种时使用 `npm run android:apk:cloud`、`npm run android:apk:local`、`npm run android:aab:cloud` 或 `npm run android:aab:local`。两个变体使用相同包名和签名，面向同一应用渠道，不能在同一设备上并存。

版本号只改一处：`package.json` 的 `"version"`，同时必须让 `package-lock.json` 根版本保持一致。

NewsNook 只接受两种发布版本：

- Stable：`X.Y.Z`，例如 `1.8.7`
- Beta：`X.Y.Z-beta.N`，例如 `1.8.8-beta.3`（`N` 为 `1..998`）

- 产物文件名：cloud / AAB 沿用 `newsnook-<version>-<cloud|local>-release.*`；local APK 另有 `newsnook-<version>-local-<abi>-release.apk`
- 包内 `versionName`：同一版本字符串
- 包内 `versionCode`：`core * 1000 + stage`，其中 `core = X*10000 + Y*100 + Z`；Beta 的 `stage=N`，Stable 的 `stage=999`

例如：

```text
1.8.7-beta.1 -> 10807001
1.8.7-beta.2 -> 10807002
1.8.7        -> 10807999
1.8.8-beta.1 -> 10808001
```

因此 Android 覆盖安装顺序天然满足 `beta.1 < beta.N < stable < 下一版本 beta.1`。

**发布不是单纯修改 version 后打任意 tag。** Stable 必须从 `main` 发布，Beta 必须从 `beta` 发布；tag、分支、package/package-lock 版本、APK `versionName/versionCode` 都会由 CI 强校验。完整流程见 [`release-channels.md`](./release-channels.md)。

上架 Google Play 时 `versionCode` 必须严格递增。仅在已有商店版本迁移等特殊场景才允许本地覆盖：

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
2. 根据目标通道更新版本：`main` 使用 `X.Y.Z`，`beta` 使用 `X.Y.Z-beta.N`；通过 npm 修改版本以同步 `package.json` / `package-lock.json`。
3. 执行 `npm run test:app-update`、`npm run test:app-deep-link`、`npm run lint` 和 `npm run build`。
4. 需要验证安装包时执行 `npm run android:apk` / `npm run android:aab`，并在至少一台真实 Android 设备上验证覆盖安装、启动、新闻加载、正文阅读、外链打开、返回键和持久化设置。
5. 仅在对应长期分支创建匹配 tag；CI 会拒绝错误分支、版本回退以及 APK 元数据不一致。
6. Stable 发布后确认 GitHub 正式 Release、R2 Stable 清单与旧客户端兼容入口均更新；Beta 发布后确认 GitHub Pre-release 与 R2 Beta 清单更新，且 Stable 入口未变化。
7. 需要上架 Google Play 时上传对应 Stable AAB，并遵循 Play App Signing。

分支、tag、R2 路径、旧客户端迁移和 Beta → Stable 流程以 [`release-channels.md`](./release-channels.md) 为唯一现行发布规范。

原生工程位于 `android/`，应与 Web 代码一同纳入版本控制；构建产物、本机 SDK 配置和签名材料不得提交。
