# 样式模块

`src/main.tsx` 继续加载 `src/index.css`，入口只维护 Tailwind 和各模块的导入顺序。
各模块使用全局选择器，保留现有组件及消毒后正文的样式契约。

| 模块 | 职责 |
| --- | --- |
| `fonts.css` / `theme.css` | 字体声明、Tailwind 语义 token、明暗与风格方案 |
| `base.css` | 安全区、阅读偏好变量、基础元素样式 |
| `motion.css` / `utilities.css` / `controls.css` | 通用过渡、工具类、控件文本选择行为 |
| `reader/` | 正文排版、翻译状态、阅读手势、图片、表格与代码块 |
| `player/` | 播放器控件、视频占位、YouTube、音频、进度条 |
| `changelog.css` / `accessibility.css` | 更新日志、减少动效与墨水屏全局规则 |
| `zhihu.css` | 知乎信息流、正文卡片与图片 |
| `linuxdo/` | Linux.do 壳、正文、引用卡片、反馈动效、编辑器与通用组件 |

修改样式时进入对应模块；新增模块在入口的适当位置导入。
导入顺序影响同优先级规则的覆盖关系，不要按文件名自动排序。
样式契约测试通过 `scripts/helpers/readAppStyles.ts` 按入口顺序展开本地导入。
