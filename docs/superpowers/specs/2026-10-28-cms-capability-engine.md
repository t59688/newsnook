# 通用 CMS 页面能力引擎

## 目标与范围

在 `feature/media-sniffer-production-v2` 延续已有导航修复，把所有已识别 CMS 和未知模板统一到证据驱动的页面模型。支持类型/年份/地区/语言/状态等筛选、排行/排序、搜索、分页以及混合内容；不按域名打补丁，不让控件只更新颜色而没有真实请求。

## 不变量

- 站点身份是先验，不是功能授权。仅从实际链接、标准表单、结构化数据或已渲染 DOM 建立可执行操作；不扫描未公开端点，不猜测模板路由。
- `CatalogPage` 保存响应级能力、证据和选中状态，`CatalogProfile` 维持 version 1 的兼容投影。DOM、会话令牌与响应级表单状态不进入备份或云同步。
- 控件操作使用真实 GET/POST 请求，保留成功表单控件、重复字段、筛选组合与业务参数。未加载成功不能把旧列表标成新状态。
- 查询、筛选、排序与分页共享请求身份；同 URL 的不同 POST 不能被判为循环。分页从实际链接/表单获取，不猜页码或 cursor。
- 内容与导航/分页/播放控件/作者资料分离；标题、封面、排行及内容类型逐条判断，不强制将整站内容转换为视频。
- 使用现有 HTTP、代理、Cookie、取消、大小限制与信源身份。普通浏览器、普通新闻/RSS 和可选云同步不改变策略。
- 无生产依赖；Android 9 / WebView 69 兼容。用户数据设备只能备份后 `adb install -r`，不能清数据或卸载。

## 算法

1. 单次解析响应，规范化 URL/表单属性与成功控件。
2. 通过标签/字段语义、最小 DOM 分组、URL 族差异、当前值与引擎字段别名交叉确认能力。引擎注册表穷尽现有 FrameworkId，但不能凭名字创建接口。
3. 先识别筛选/排序/分页等控件区，再识别导航和内容，避免同一链接被多个角色消费。保留原始顺序、当前值以及每个操作的证据。
4. 链接控件严格沿用原地址；表单控件替换本字段并保留其他成功字段，多选按原字段名重复提交。不对原站签名 URL 做猜测合并。
5. 页面能力表示 `observed`、`not-observed` 或 `requires-browser`；网络成功不等于结果已验证，展示选中态以返回响应为准。
6. 对静态响应确为动态壳的交互目录，Android 采用隔离、有预算、可取消的只读渲染快照后重复同一解析算法。不会在普通浏览器自动点击、自动播放；任意 JS 事件、验证码或不安全表单不伪装成支持。

## 数据与 UI

- `CatalogPage.capabilities`：筛选/排序 choices、搜索模板、证据、无法执行原因、静态/渲染来源。
- 操作只有三类：页面真实 GET 链接、标准表单提交、真实下一页请求。UI 不拼接上游 URL。
- 保留现有一级/子导航；增加可收起的真实筛选组，单选/多选/排序由能力定义驱动。搜索与选项点击走同一目录会话；忙碌、失败、重试与当前选择有明确状态。
- 旧 profile、已读、收藏、缓存 ID 和同步协议不清空或改格式。目录版本标记提升为 catalog-v4，以现有无损迁移修复可确定的旧内容类型，保留 ID 与缓存时间。兼容投影不得混入临时令牌。

## 验收

覆盖现有 17 类 CMS、努努与 generic 的能力契约；不同模板使用不同结构夹具，不用仅替换 generator 冒充行为覆盖。覆盖 query/path 筛选、标准 GET/POST、select/radio/checkbox、重复字段、动态壳、排行文本/卡片、类型混合、请求失败、快速切换与撤销。基于真实页面的验证单独标记，不等同于所有网站已实测。

## 规范依据

- HTML 表单成功控件与提交：https://html.spec.whatwg.org/multipage/form-control-infrastructure.html
- HTML select/button：https://html.spec.whatwg.org/multipage/form-elements.html
- MacCMS 字段含义（不等同于部署站路由）：https://github.com/magicblack/maccms10/wiki/标签文档
- Drupal Views 暴露排序字段：https://api.drupal.org/api/drupal/core%21modules%21views%21src%21Plugin%21views%21exposed_form%21ExposedFormPluginBase.php/11.x
