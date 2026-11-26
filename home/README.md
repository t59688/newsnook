# NewsNook 门户介绍站（home/）

有所闻 NewsNook 的产品门户 / 介绍页。独立工程，不影响仓库主应用。

## 特点

- **界面即证据**：每个功能区块的示意都是从 `../src` 应用源码提取复刻的真实组件与样式（信息流、阅读器、墨水屏分页、分段器、开关、分享卡、TTS 听书、AI 速读、画中画、媒体嗅探、LINUX DO/知乎专属工作区……），绝非截图或外部静态图片。
- **全功能无遗漏覆盖**：不仅包含速闻、站内全文、排版定制、六套配色与数学自定义推导、墨水屏模式、本地推荐、8 大场景预设、34,270 源 RSS 订阅商店、7 大翻译引擎、可选云同步，还在「核心能力全景图」中无缝接入了 TTS 语音朗读、AI 智能速读、视频画中画、媒体嗅探、无线投屏、离线预存、LINUX DO 社区、知乎工作区、CMS 网页目录抓取、划词百科、跟贴互动、v2 自解释短链分享、智能网络分流代理、阅读足迹历史、本地备份、本地搜索、增量更新、隐私浏览器、功能引导与侘寂风纸鹤彩蛋共 20 项真实模块。
- **同一套设计语言**：ink / paper / cinnabar 令牌、六套配色方案、纸纹、`--ease-ink` 缓动整体移植自 `src/styles/theme.css` 等。
- **Framer Motion 极致交互**：首屏支持「真机随心交互」与「一键自动演示」双重体验，列表→点按→站内全文一镜到底；朱砂书签滑动；昼/夜整页 240ms 过渡。
- **真实数据与算法**：153 个内置信源、34,270 个离线目录、8 套互斥预设、WCAG 对比度算法推导、0.55+0.20+0.25 推荐打分公式，全与源码严格 1:1 对齐。

## 命令

```bash
npm install
npm run dev        # http://localhost:5199
npm run build      # tsc -b + vite build
npm run lint       # oxlint src
```

取证参数：`?theme=dark|light` 强制主题；`?goto=<section-id>` 直达区块。

## 结构

```text
src/
  index.css            # 移植的令牌 / 工具类 / 阅读排版 / eink 压制
  lib/demo.ts          # 真实信源、分类、预设与文章模型
  lib/customScheme.ts  # WCAG 对比度色彩推导引擎（自 src/lib/customScheme.ts 原样移植）
  components/app/      # 从应用源码复刻的界面示意组件与 20 项微型互动演示
  portal/              # 门户自身组件（导航 / 区块壳 / 出场动效 / 下载 / 页脚）
  heroes/              # 首屏叙事与交互（HeroScroll 主方向，HeroA/B/C 留档）
DESIGN.md              # 设计说明与令牌基线
```
