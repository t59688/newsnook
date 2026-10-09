# Android AVD 实时调试指南

> 适用项目：News Nook（React + Vite + Capacitor 8 + Android）  
> 主要环境：Windows PowerShell  
> 更新日期：2026-08-19

## 1. 目标

本文说明如何在任意开发电脑上连接任意 Android Virtual Device（AVD），并完成以下调试工作：

- 修改 React、TypeScript 或 CSS 后，AVD 中的应用自动更新；
- 通过 Chrome DevTools 检查 WebView 的 DOM、Console、Network 和 Sources；
- 通过 ADB 或 Android Studio 查看原生日志；
- 通过 Android Studio 调试 Java/Kotlin 原生代码；
- 在 AVD 和物理 Android 设备之间切换，而不写死设备名称或设备编号。

## 2. 哪些参数是通用的

| 参数 | 是否通用 | 说明 |
|---|---:|---|
| `10.0.2.2` | 是，仅限官方 AVD | Android Emulator 访问开发电脑本机服务的固定特殊地址 |
| `5173` | 项目约定 | 本文使用的 Vite 开发端口，可换成其他空闲端口 |
| `com.aizeek.newsnook` | 是 | 本项目 Android 包名 |
| `cloud` / `local` | 是 | 本项目的两个 Android product flavor |
| `Pixel_9_Pro` | 否 | 某台电脑上创建的 AVD 名称 |
| `emulator-5554` | 否 | AVD 本次启动后由 ADB 动态分配的设备编号 |

调试命令不应永久写死 `Pixel_9_Pro`、`emulator-5554` 等本机值。只有在自动化脚本明确绑定某台测试设备时，才应指定 `--target`。

## 3. 新电脑准备

### 3.1 安装工具

安装以下软件：

1. Node.js 22 或更高版本；
2. Android Studio；
3. Android SDK、Platform Tools 和 Android Emulator；
4. 一个 Android 系统镜像；
5. JDK 21。

项目的 `web/scripts/android-env.mjs` 会依次检查环境变量和常见安装目录，自动寻找 Android SDK 与兼容 JDK。通常不需要手工编写 `local.properties`。

### 3.2 安装项目依赖

```powershell
cd C:\你的项目路径\cardnews\web
npm ci
```

如果当前分支没有可用的 lockfile，才使用：

```powershell
npm install
```

调试 APK 不需要初始化 Release 签名密钥。

## 4. 创建并启动任意 AVD

推荐使用 Android Studio：

1. 打开 **Tools > Device Manager**；
2. 点击 **Create Virtual Device**；
3. 选择任意手机模板；
4. 选择所需 Android 系统镜像；
5. 完成创建并启动 AVD。

AVD 名称和当前项目无绑定关系，可以是 `Pixel 8`、`Pixel 9` 或其他名称。

也可以用命令行查看和启动：

```powershell
$emulatorPath = "$env:LOCALAPPDATA\Android\Sdk\emulator\emulator.exe"

& $emulatorPath -list-avds
& $emulatorPath -avd "你的 AVD 名称"
```

## 5. 确认 AVD 已连接

### 5.1 使用 ADB

```powershell
$adbPath = "$env:LOCALAPPDATA\Android\Sdk\platform-tools\adb.exe"
& $adbPath devices -l
```

正常输出类似：

```text
List of devices attached
emulator-5554  device product:sdk_gphone_x86_64 ...
```

设备状态必须是 `device`：

- `offline`：等待启动完成，或重启 ADB；
- `unauthorized`：真机需要在手机上允许 USB 调试；
- 空列表：AVD 尚未启动，或 Platform Tools/ADB 异常。

### 5.2 使用 Capacitor

```powershell
cd C:\你的项目路径\cardnews\web
node scripts/android-cap.mjs run android --list
```

该命令会列出当前电脑实际可用的 AVD 和物理设备。设备 ID 可能在每次启动后变化。

## 6. 一次性启用 Debug WebView 检查

项目默认关闭 WebView 调试，避免 Release 包暴露调试接口。为了仅在开发时启用，建议在 `web/capacitor.config.ts` 中使用环境变量：

```ts
import type { CapacitorConfig } from '@capacitor/cli'

const webViewDebuggingEnabled =
  process.env.NEWSNOOK_WEBVIEW_DEBUG === '1'

const config: CapacitorConfig = {
  appId: 'com.aizeek.newsnook',
  appName: 'News Nook',
  webDir: 'dist',
  server: {
    androidScheme: 'https',
  },
  android: {
    allowMixedContent: true,
    webContentsDebuggingEnabled: webViewDebuggingEnabled,
  },
  // 其余配置保持不变
}

export default config
```

运行调试命令前设置：

```powershell
$env:NEWSNOOK_WEBVIEW_DEBUG = '1'
```

关闭当前 PowerShell 后，该环境变量不会永久保留。不要在正式发布环境中设置它。

## 7. AVD 实时调试：推荐流程

需要同时保持两个 PowerShell 窗口运行。

### 7.1 终端 A：启动 Vite

```powershell
cd C:\你的项目路径\cardnews\web
npm run dev -- --host 0.0.0.0 --port 5173
```

Vite 应显示可访问地址并保持运行。`--host 0.0.0.0` 允许 AVD 访问开发电脑上的服务。

### 7.2 终端 B：构建、安装并启动 Live Reload

```powershell
cd C:\你的项目路径\cardnews\web
$env:NEWSNOOK_WEBVIEW_DEBUG = '1'

node scripts/android-cap.mjs run android `
  --flavor cloud `
  --live-reload `
  --host 10.0.2.2 `
  --port 5173
```

不要添加 `--target` 时：

- 只有一个可用设备：直接使用该设备；
- 有多个可用设备：Capacitor 会提示选择；
- 换电脑或换 AVD：无需修改命令。

`cloud` 是默认轻量版本。如需调试 ML Kit 本地翻译，改为：

```powershell
--flavor local
```

### 7.3 明确指定某个设备（可选）

先运行：

```powershell
node scripts/android-cap.mjs run android --list
```

再把实际 ID 临时传给命令：

```powershell
node scripts/android-cap.mjs run android `
  --flavor cloud `
  --target "本机实际设备 ID" `
  --live-reload `
  --host 10.0.2.2 `
  --port 5173
```

不要把该 ID 提交到通用项目脚本中。

### 7.4 实时更新范围

以下修改通常会由 Vite HMR 自动更新：

- `src/**/*.tsx`；
- `src/**/*.ts`；
- CSS 和 Tailwind 样式；
- 前端图片与公开资源。

以下修改必须停止 Live Reload 并重新构建、安装：

- `MainActivity.java`；
- Android Manifest、资源和 Gradle 配置；
- Capacitor 原生插件；
- product flavor 或原生依赖；
- `capacitor.config.ts` 中需要写入原生工程的配置。

## 8. 使用 Chrome DevTools 调试 WebView

1. 保持应用在 AVD 中打开；
2. 在开发电脑的 Chrome 打开：

   ```text
   chrome://inspect/#devices
   ```

3. 勾选 **Discover USB devices**；
4. 找到 `com.aizeek.newsnook` 对应的 WebView；
5. 点击 **inspect**。

可以使用：

- **Console**：查看 JavaScript 日志和异常；
- **Network**：查看信源请求、状态码和耗时；
- **Elements**：检查 DOM、CSS 和布局；
- **Sources**：设置 TypeScript/JavaScript 断点；
- **Performance**：分析白屏、卡顿和动画性能。

如果看不到 WebView，依次检查：

1. 应用是否正在前台运行；
2. `NEWSNOOK_WEBVIEW_DEBUG` 是否在运行 Capacitor 的终端中设置为 `1`；
3. 是否在修改配置后重新执行了 Capacitor run/sync；
4. `adb devices -l` 是否显示设备状态为 `device`；
5. 刷新 `chrome://inspect/#devices`。

## 9. 实时查看 Logcat

模拟器调试的关键步骤：应用启动后，先用 `adb devices` 确认设备在线，再用一条命令把应用进程的 PID 直接传给 logcat。

```powershell
adb devices

adb -s emulator-5554 logcat --pid=$(adb -s emulator-5554 shell pidof -s com.aizeek.newsnook)
```

`emulator-5554` 替换为 `adb devices` 输出的实际设备 ID；`pidof -s` 只返回单个进程 PID。

如果 `adb` 不在 PATH 中，使用完整路径分步执行：

```powershell
$adbPath = "$env:LOCALAPPDATA\Android\Sdk\platform-tools\adb.exe"
& $adbPath devices -l

$appProcessId = & $adbPath -s "设备 ID" shell pidof -s com.aizeek.newsnook
& $adbPath -s "设备 ID" logcat --pid=$appProcessId -v color
```

如果只有一个设备，可以省略 `-s`：

```powershell
$appProcessId = & $adbPath shell pidof -s com.aizeek.newsnook
& $adbPath logcat --pid=$appProcessId -v color
```

`pidof` 没有输出通常表示应用尚未启动或进程已经退出。先在 AVD 中打开应用，再重新执行命令。

查看崩溃缓冲区：

```powershell
& $adbPath logcat -b crash -d
```

清空旧日志后重新复现：

```powershell
& $adbPath logcat -c
```

## 10. 使用 Android Studio 调试原生代码

无需重新同步时，直接打开原生工程：

```powershell
cd C:\你的项目路径\cardnews\web
node scripts/android-cap.mjs open android
```

在 Android Studio 中：

1. 选择目标 AVD；
2. 在 **Build Variants** 中选择 `cloudDebug` 或 `localDebug`；
3. 在 Java/Kotlin 文件中设置断点；
4. 点击 **Debug**；
5. 如果应用已经运行，使用 **Run > Attach Debugger to Android Process**；
6. 选择 `com.aizeek.newsnook`。

前端 WebView 断点使用 Chrome DevTools；原生 Java/Kotlin 断点使用 Android Studio。两者可以同时连接。

## 11. 调试物理 Android 手机

物理手机不能使用 `10.0.2.2`。推荐通过 ADB reverse/Capacitor 端口转发连接电脑上的 Vite：

```powershell
cd C:\你的项目路径\cardnews\web
$env:NEWSNOOK_WEBVIEW_DEBUG = '1'

node scripts/android-cap.mjs run android `
  --flavor cloud `
  --live-reload `
  --host 127.0.0.1 `
  --port 5173 `
  --forwardPorts 5173:5173
```

首次连接真机时：

1. 在手机开发者选项中启用 USB 调试；
2. 使用支持数据传输的 USB 线；
3. 接受手机上的调试授权；
4. 用 `adb devices -l` 确认状态为 `device`。

如果同时连接了 AVD 和真机，先通过 `--list` 查看 ID，再用临时 `--target` 选择。

## 12. 常见问题

### 12.1 AVD 中显示 `ERR_CLEARTEXT_NOT_PERMITTED`

Live Reload 加载的是 `http://10.0.2.2:5173`（明文）。项目启用了 `network_security_config.xml` 后，Manifest 里的 `usesCleartextTraffic` 会被忽略；若配置未放行调试主机，WebView 会直接拦截。

检查：

- `web/android/app/src/main/res/xml/network_security_config.xml` 是否包含 `10.0.2.2` / `localhost` / `127.0.0.1`；
- 修改该 XML 后是否已重新执行 `android-cap` 构建并安装（原生配置变更不能靠 HMR）。

### 12.2 AVD 中显示 `ERR_CONNECTION_REFUSED`

检查：

- Vite 终端是否仍在运行；
- Vite 是否使用 `--host`（`package.json` 的 `dev` 脚本已带）；文档示例也可用 `--host 0.0.0.0`；
- Capacitor 是否使用 `--host 10.0.2.2`；
- 两边端口是否一致；
- Windows 防火墙是否阻止 Node.js/Vite；
- 是否误把 AVD 地址写成 `127.0.0.1`。

### 12.3 修改代码后没有更新

检查 Vite 终端是否收到文件变更。必要时：

1. 在 Chrome DevTools Network 面板禁用缓存；
2. 在 AVD 中彻底关闭并重新打开应用；
3. 停止两个终端，再按第 7 节重新启动；
4. 确认当前应用加载的是 `http://10.0.2.2:5173`，而不是 APK 内的静态 `dist`。

### 12.4 Capacitor 命令一直不退出

Live Reload 模式会持续监听，这是正常行为。按 `Ctrl+C` 停止，Capacitor 会还原临时写入的 Live Reload 配置。

### 12.5 ADB 状态异常

```powershell
$adbPath = "$env:LOCALAPPDATA\Android\Sdk\platform-tools\adb.exe"
& $adbPath kill-server
& $adbPath start-server
& $adbPath devices -l
```

仍然异常时，关闭 AVD 后从 Device Manager 冷启动（Cold Boot）或重建 AVD。

### 12.6 多个设备导致安装到错误目标

```powershell
node scripts/android-cap.mjs run android --list
```

然后仅为本次命令传入：

```powershell
--target "目标设备 ID"
```

## 13. 停止调试

1. 在 Capacitor Live Reload 终端按 `Ctrl+C`；
2. 在 Vite 终端按 `Ctrl+C`；
3. 关闭 AVD，或保留给下一次调试；
4. 不要把 `NEWSNOOK_WEBVIEW_DEBUG=1` 写入 Release 构建环境。

下次启动 AVD 后，即使设备编号变化，也可以继续使用不带 `--target` 的通用命令。

## 14. 快速命令卡

```powershell
# 终端 A
cd C:\你的项目路径\cardnews\web
npm run dev -- --host 0.0.0.0 --port 5173
```

```powershell
# 终端 B（任意官方 AVD）
cd C:\你的项目路径\cardnews\web
$env:NEWSNOOK_WEBVIEW_DEBUG = '1'
node scripts/android-cap.mjs run android --flavor cloud --live-reload --host 10.0.2.2 --port 5173
```

```text
# WebView DevTools
chrome://inspect/#devices
```

```powershell
# 查看当前设备
$adbPath = "$env:LOCALAPPDATA\Android\Sdk\platform-tools\adb.exe"
& $adbPath devices -l
node scripts/android-cap.mjs run android --list
```

```powershell
# 跟踪应用日志（emulator-5554 换成实际设备 ID）
adb -s emulator-5554 logcat --pid=$(adb -s emulator-5554 shell pidof -s com.aizeek.newsnook)
```

## 15. 官方参考

- [Android Emulator 网络地址](https://developer.android.com/studio/run/emulator-networking-address)
- [使用 Chrome DevTools 调试 WebView](https://developer.android.com/develop/ui/views/layout/webapps/debug-chrome-devtools)
- [Chrome 远程调试 WebView](https://developer.chrome.com/docs/devtools/remote-debugging/webviews)
- [Android Studio 调试应用](https://developer.android.com/studio/debug)
- [ADB Logcat](https://developer.android.com/tools/logcat)
- [从命令行启动 Android Emulator](https://developer.android.com/studio/run/emulator-commandline)
