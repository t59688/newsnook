# 文章纸面标注与触控笔（beta 开发分支）

## 规范与产品参考

- **GB/T 14706—1993《校对符号及其用法》**：中文排版校样的校对符号及用法，2025 年复审继续有效。标准的改正、删除、增补、改正上下角、对调、转移、接排、另起段、缩距等符号服务于出版校样。本产品只把与一般新闻阅读相关的部分作为**结构化校对建议**，而不是宣称已数字化实现整部标准。标准正文示例采用引线、符号、修订意见区，不应把大型字符强塞进原文字间。
- **W3C Web Annotation Data Model**：TextQuoteSelector 的 exact / prefix / suffix 与 TextPositionSelector 的 start / end 组合。采用持久文本锚点而非仅存屏幕坐标。
- **Readwise Reader、KOReader、Apple Books 等阅读器**：阅读与批注分离；选中原文后高亮/添加笔记；笔输入可减少选区操作；改变排版后仍可定位到段落。笔/触摸的语义分离优于透明覆盖整篇正文。

## 入口与操作

1. 打开普通 RSS / 新闻 / CMS 正文页，默认只显示正文，不在正文前增加任何工具行。顶部阅读工具栏通过单个笔形图标进入「标注与笔记」底部抽屉，抽屉分「笔工具」与「笔记」两部分。仅主动笔落笔后显示小型工具托盘，笔与手指任务分离。
2. **手机**：长按正文并拖动选区，保留 Android 原生选择菜单；高亮 / 划线 / 笔记 / 更多操作显示在**屏幕底部**，避免与「百科 / 搜索 / 复制」重叠。更多操作中的圈注、删除线、校对等放入底部抽屉；所有按钮固定横向排版，窄屏不竖排、不压入正文。点击笔记索引可定位原文。
3. **主动式触控笔**：Pointer Events 的 pen 指针才进入笔画管线，手指继续执行原有滚动；笔画支持下划线、荧光、圈注、自由手写、橡皮擦。使用 coalesced events（若可用）、pressure / tilt 记录，requestAnimationFrame 聚合 UI 更新；pointercancel 不存储不完整笔画。
4. **纸面批语**：较长批注单独排在锚定段落下方，以轻量竖线、小字说明，避免在原文上悬浮标签遮挡文字。增补只以小型「∨」标记位置，补充内容在段落后显示，避免上一版把文字挤进行缝、遮盖正文。批注只是 UI 补充节点，不修改缓存中的源文章 HTML。
5. **校对**：现支持增补、改正、删除线、对调等与文章相关的基础修订意图。校对意见始终属于个人标注，不自动更改来源文章。其他国家标准符号尚未全部数字化，不应声称标准全覆盖。
6. **不支持主动笔协议的普通电容笔**：通常被系统识别成 touch，继续使用触控选择文字后标注；不会伪造压感、防误触能力。

## 数据契约与存储

IndexedDB 数据库 `newsnook-annotations`（schema v1），object store `items`，主键 `id`，`articleId` 非唯一索引。存储对象：

```ts
interface ArticleAnnotation {
  schema: 1
  id: string
  articleId: string
  kind: 'highlight' | 'underline' | 'circle' | 'strike' |
        'note' | 'insert' | 'replace' | 'transpose' | 'ink'
  anchor: {
    exact: string
    prefix: string
    suffix: string
    start: number // UTF-16 code units
    end: number
  }
  note: string
  color: string
  strokes?: Array<{
    color: string
    width: number
    points: Array<{ x: number; y: number; pressure: number; tiltX?: number; tiltY?: number }>
  }>
  createdAt: number
  updatedAt: number
}
```

关键设计：

- `articleId` 直接沿用 NewsNook 已有稳定文章标识。每次按 articleId 读取，不跟随正文/离线缓存清理；无账号、离线时可工作。
- `anchor` 同时保存文本位置与上下文；原文抽取/翻译变化时先校验位置，再用原文和前后文候选定位。无可靠匹配时不乱画标注，原数据保留在笔记索引，可人工查阅。
- 手写点保留与起始字符锚定片段相对的矢量轨迹，而非整屏截图。可重新计算锚点位置；如果原文所在段落的局部换行发生很大变化，手写形状的相对几何需要用户核查，文字锚点标记则按 Range 重排。
- 逐条增加、更新、删除分别使用 IndexedDB 事务，成功提交后刷新内存列表；异步错误显示在阅读器而不伪装保存成功。限制大批量无效/异常轨迹，防止恶意备份破坏本地数据。
- “离线存储 → 配置备份”增加“文章高亮与批注”区（备份格式 v2，兼容 v1 读取）；JSON 导出和导入含标注，恢复时通过单个 IndexedDB 事务原子覆盖**批注分区**。云同步与本地缓存依然是独立数据域。

## 质量门槛与限制

- 当前新代码保持 React 19 / Capacitor 8 / WebView 69 兼容写法；新增零生产依赖。
- 自动化：TypeScript / oxlint / Vite build / 文本锚点 / 配置备份回归；隔离 Chrome 测试：选区 → 持久化 → 字号重排 → 模拟 pen 笔画 → cancel 不保存 → 刷新恢复 → 行间批语。
- 待 Android 真机硬件验收：不同主动笔（含侧键和笔尾橡皮）、掌压过滤、低版本 WebView 以及墨水屏分页/双语对照完整组合。不能以桌面模拟输入的通过结果替代这些验收。

## 参考链接

- 国家标准正文：https://www.slarc.org.cn/dwyx/attached/file/20240521/20240521153325_825.pdf
- Web Annotation：https://www.w3.org/TR/annotation-model/
- Android 手写笔：https://developer.android.com/develop/ui/views/touch-and-input/stylus-input
