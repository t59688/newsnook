# 悬浮播放与 PR #75 交付验收

日期：2026-10-10。基线：`865916860b1704b2e4718eebb976ea4fd1c4e933`；对比 PR [#75](https://github.com/t59688/newsnook/pull/75) 的 `7066b060a9c3114d5cae10082a0e555dcde2be10`。

## 已修复

- 纳入 PR #75 的原生页面遮挡协调、小窗控件点击与首次手势提示修复；补齐提示隐藏、重新进入及 StrictMode 的生命周期。
- HLS 故障恢复采用有上限的单次退避；致命解码错误、卸载和销毁会取消待执行恢复。初始清单失败会重新请求清单，而非调用不能恢复初始清单的 `startLoad()`。
- 手动重试、原生重新连接和清单重载保留播放位置、速率与用户暂停选择；孤立播放页也可以重试，不再依赖已经卸载的母页回调。
- 原生播放会话支持续期，关闭后不能重新激活；异步初始化或续期晚返回时释放会话。会话独立管理凭据、Cookie 和新媒体来源，保留播放过程中更新的状态。
- 原生 HLS 请求沿用默认 XHR 并携带应用内部会话标记；本地拦截处理 CORS 和 Range，标记不会转发上游。Web 与开发代理正确传递字节范围并避免范围响应污染完整资源缓存。
- 资源服务器忽略 Range、请求范围超过文件末尾，以及加载器复用等边界均有处理和回归测试。
- 本地流代理限制请求和并发规模，关闭时取消连接与请求；重新启动后的监听器不会被旧线程接管。
- JNI 增加 16KB 页大小链接参数。APK 发布流程增加 ZIP、64 位 ELF LOAD 和 RELRO 校验，避免将不兼容原生库作为成功交付结果。
- 新增播放器 CI 和聚合测试入口。Android 下载通知的既有单测改为等待异步回调完成后断言，没有修改下载生产行为或弱化断言。

没有新增生产依赖、全局状态库、系统悬浮窗权限或云端阅读依赖。悬浮窗口仍是应用内能力；应用退出后台暂停，返回前台后由用户继续播放。

## 验证结果

| 验证 | 结果 |
|---|---|
| `npm run test:video-player` | 14 个测试命令全部通过，覆盖悬浮生命周期、真实 HLS 清单控制器、Range、嗅探、投屏及代理 |
| `node scripts/android-apk-pages.test.mjs` | 通过，覆盖 4KB LOAD、不安全 RELRO、安全覆盖整个加载段的 RELRO 与无效 ELF |
| `npm run lint` | 通过；18 条既有、与本次改动无关的警告 |
| `npm run build` | TypeScript 与 Vite 生产构建通过 |
| `:app:testCloudDebugUnitTest` | 63 项测试，0 失败、0 错误 |
| `:app:compileLocalDebugJavaWithJavac` | 通过 |
| `npm run android:apk` | 通过；cloud、local universal 及四种 ABI APK 共 6 个产物均通过签名与 16KB 校验 |
| `git diff --check` | 通过 |

### ADB 验收

使用 `emulator-5554`，实际 `PAGE_SIZE=16384`。安装隔离的 Release 验收包，使用当前生产组件、样式和原生播放实现；单独提供文章、列表、设置及受控媒体资源。开启验收包 WebView 调试读取状态，点击、拖动、缩放、返回和 Home 均通过 ADB 执行。

以下行为全部通过：

1. MP4、HLS、DASH 正常解码，播放时间持续前进。
2. 转为悬浮后卸载母页，保持同一 video 实例并持续播放。
3. 自由拖动、调整大小；全屏横屏后按返回键，恢复原窗口位置与尺寸。
4. Home 后暂停；回到前台保持暂停，手动恢复后继续播放。
5. 母页不存在时打开独立播放页，按返回键回到小窗；关闭后 video 实例销毁。
6. 无上游 CORS 响应头的鉴权字节范围 HLS 正常解码，母页卸载后继续播放；服务器记录确认实际 Range 请求及鉴权生效，内部会话标记未向上游发送。

未覆盖：物理 ARM64 设备、所有第三方 CDN、长时间弱网与设备厂商的 WebView 差异。模拟器已有同包名应用签名与本机发布签名不同，未卸载该应用或清除用户数据；ADB 功能验证使用隔离包，不能视为已有安装包的覆盖升级验证。

### 16KB 校验边界

除 [Android 的 ZIP / LOAD 校验要求](https://developer.android.com/guide/practices/page-sizes)外，校验器检查 RELRO 是否会把可写数据所在页面变为只读。RELRO 完整覆盖一个 LOAD 段的安全尾部布局可以通过；这与 [Android 链接器对 RELRO 页边界的处理](https://android.googlesource.com/platform/bionic/+/android16-qpr2-release/linker/linker_phdr.cpp)一致，避免只看 RELRO 末尾是否整除 16KB 所产生的误报。JNI 自身保留 max-page-size 和 common-page-size 两个链接参数。

## 交付范围

本记录对应 PR #75 的修复与验收结果；合并状态以 GitHub PR 为准。已增加可重复的测试与发布校验入口；跨真机及第三方网络兼容性仍应在正式发版前按目标设备进行抽检。分支合并不代表已发布新版本。
