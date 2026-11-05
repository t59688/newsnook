# 公开来源发现、检查与平台候选采集

本目录只生成本地候选和审查证据，不直接改写 NewsNook 目录或发布数据。基础工具使用 Python 3.10+ 标准库；`platforms.py` 联网采集还使用系统已有的 curl，不安装 Python 包。所有下载、响应、检查历史和报告放在已忽略的 `artifacts/`。

正式目录、质量规则及当前数量见[发布维护文档](../../docs/rss-catalog-publishing.md)。`data/rss-catalog/upstream.json` 是唯一可发布维护源，离线种子由项目导入器生成。候选身份、暂缓记录和原始采集数量均不能代表最终可用来源数量。

## 发现与实际 Feed 检查

```bash
python -B tools/feed-catalog/catalog.py discover --work artifacts/feed-catalog
python -B tools/feed-catalog/catalog.py check --work artifacts/feed-catalog --workers 16 --timeout 8 --instance https://rsshub-balancer.virworks.moe --instance https://rsshub.cups.moe
# 使用系统 curl 的总请求时限约束 DNS、连接与下载
python -B tools/feed-catalog/catalog.py check --work artifacts/feed-catalog --transport curl
# 中断后从已有检查证据重新生成报告，不联网
python -B tools/feed-catalog/catalog.py report --work artifacts/feed-catalog
```

`sources.json` 维护公开目录入口与许可声明，支持 URL 列表、OPML、CSV、JSON 数组和 B站主页 Markdown 名单。CSV 可提供 `platform,creator_id,title`；只处理明确的真实 ID，不枚举账号或执行远端 JavaScript。Markdown 头像链接不能作为作者名，粗体标记会去除；只有明确名称链接才作为创作者候选。

检查支持 RSS、Atom、RDF、JSON Feed。不设置更新时间或发布频率门槛。HTTP 200 且 Feed 格式可解析才标记 `accept`；403、429、5xx、TLS、超时、无效响应及身份未知均保留为 `defer`，不伪造成功。多个实例尝试仍只算一次独立检查。最近连续至少三次不同 run_id 的 404/410、跨度至少七天，且身份地址也返回 404/410、不能确认身份，才标记 `permanent`；目录桥接器不会据此自动删除既有条目。

每个响应最多 4 MiB；默认 16 并发，最高 128。默认 urllib 预算不是操作系统级硬截止，需硬时限时选择 curl。检查记录完成一条就追加并刷新，兼容旧 `checks.jsonl`；完整行损坏报错，未完成尾行保留并提示。不可同时向同一工作目录运行多个检查进程。

重跑跳过 24 小时内已检查条目；`--recheck` 强制重查。`--run-id` 标记同一次外部作业，重复重试不会凑成多次独立证据。`--offset/--limit` 支持分段。Ctrl+C 取消排队任务，等待当前请求结束后导出部分报告并返回 130；强制结束后仍可通过 `report` 恢复摘要。

## 平台身份候选与预转换

`platforms.py` 从 CC0 Wikidata 结构化身份取得公开平台 ID、中英文名称和明确职业/实体类型，生成候选订阅地址。支持 B站、YouTube、微博、知乎、小红书、抖音和 X/Twitter。来源实体名不保证等于当前频道昵称或认证名称；无内容语言证据时记为 `und`。不能可靠转换的标识和无名称条目保存在 `unresolved.json`，不编造账号或地址。

```bash
python -B tools/feed-catalog/platforms.py --platform bilibili --work artifacts/feed-platforms/bilibili
# 离线重建：检查原始数据、官方规则哈希及平台/属性/规则绑定
python -B tools/feed-catalog/platforms.py --platform bilibili --work artifacts/feed-platforms/bilibili --cached
# 必须继续对 candidates.json 进行实际 Feed 检查
python -B tools/feed-catalog/catalog.py check --work artifacts/feed-platforms/bilibili --transport curl --instance https://rsshub-balancer.virworks.moe
```

平台采集器初始输出的 `index` 只是研究候选，**不能由项目桥接器导入正式目录**。实际检查产生 `accept/defer/permanent` 报告后才可进入下一阶段；不能仅凭名称、UID、可构造路由或实例首页响应就宣称可用。`--limit` 限制查询结果行数（默认 20,000），不是平台账号总量；同一账号的多职业会占多行。公开服务限流时应稍后重试，不把限流当作身份消失。

## 导入及发布边界

```bash
node --import tsx scripts/rss-catalog-merge.ts --report artifacts/feed-catalog/report.json
node --import tsx scripts/rss-catalog-merge.ts --report artifacts/feed-catalog/report.json --apply
npm run rss-catalog:import
npm run test:rss-catalog
# 仅生成本地文件，不上传 R2
npm run rss-catalog:build
python -B -m unittest discover -s tools/feed-catalog -p 'test_*.py'
```

默认只预览；`--apply` 完整校验后原子更新权威目录。新增 ID 按内容身份生成；同平台同账号同内容路由去重，不因不同平台同名而合并。Telegram 和 Twitter 用户名按不区分大小写去重。既有记录不改名、不换 URL、不换 ID；重复导入不增加 revision。

`accept` 仅证明当次 Feed 请求与格式检查成功，**不等于应用内正文阅读或视频播放已验收**。正式发布仍需执行项目规定的内容质量和应用链路验证；低频、冷门、数量多均不作为删除理由。可疑项保留证据待复核，不直接定性为低质量。

## 数据出处与许可

- [Kagi Small Web](https://github.com/kagisearch/smallweb)：MIT，Copyright (c) 2023 Kagi Search；个人博客、YouTube 与漫画目录，不能代表全部内容生态。
- [中文独立博客](https://github.com/lovexw/chinese-independent-blogs)：MIT，Copyright (c) 2019 Tim Qian；不采用新鲜度过滤。
- [awesome-bilibili](https://github.com/SyMind/awesome-bilibili)：CC0-1.0；真实技术创作者主页名单。
- [RSSHub 官方规则](https://github.com/DIYgod/RSSHub)：公开转换规则证据，不执行源码、不作为客户端依赖打包；下载时记录许可证与 SHA-256。
- [Wikidata](https://www.wikidata.org/wiki/Wikidata:Licensing)：结构化数据 CC0；平台工具通过 QLever 镜像查询并保存原始响应。
- [Topic Play / YouTubeList](https://github.com/topicplay/YouTubeList)：MIT，Copyright (c) 2020 Topic Play；只取名称、频道 ID、明确主题，不引入热度排序。
- [TGrpg / awesome-telegram](https://github.com/TGrpg/awesome-telegram)：CC-BY-4.0，原数据由 tgbox.cc 汇编；仅公开频道，不复制描述。
- [ttttmr / Wechat2RSS](https://github.com/ttttmr/Wechat2RSS)：未声明许可，记录 NOASSERTION；只提取公开名称与实际 Feed URL，不将服务 Feed 哈希当作微信原生账号 ID。

随包来源说明保存在 `public/licenses/rss-catalog.txt`。目录许可不替代文章或媒体的权利声明。原始下载、审查过程、临时脚本及报告不提交 Git；只维护可复用工具、测试、必要说明和经审查的最终目录。
