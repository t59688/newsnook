# 独立公开来源采集与检查

此目录可整体复制到任意工作目录运行，只需要 Python 3.10+，不安装依赖，不读写 NewsNook 代码、配置或目录数据。采集结果是可丢弃、可重新生成的证据，不是另一份业务目录。

## 第一步：发现与独立检查

在项目中使用时，将所有下载、候选、检查历史和报告放在已忽略的 `artifacts/feed-catalog/`。其他位置运行时自行指定产物目录。

```bash
python -B tools/feed-catalog/catalog.py discover --work artifacts/feed-catalog
python -B tools/feed-catalog/catalog.py check --work artifacts/feed-catalog --workers 16 --timeout 8 --instance https://rsshub.app --instance https://rsshub-balancer.virworks.moe
# 中断后无需联网，从已保存证据重新导出报告
python -B tools/feed-catalog/catalog.py report --work artifacts/feed-catalog
python -B -m unittest discover -s tools/feed-catalog -p test_catalog.py
```

`sources.json` 是公开目录入口与许可清单，不维护人工来源条目。支持 URL 逐行列表（`#` 后可带名称）、宽容 OPML、CSV（`title/url/site_url/tags` 或中文博客上游列名）、JSON 数组和 B 站主页 Markdown 名单。新站点适配在 `discover/convert` 边界扩展。下载文本只作数据解析，不执行网页、脚本或 Radar 函数。

创作者 CSV 也可提供 `platform,creator_id,title`，例如 `bilibili,946974,影视飓风`。工具从明确的 UID 生成官方主页，再匹配 Radar；`youtube` 的 UC 频道 ID 可直接生成原生 Feed。CSV/JSON 应来自清单中声明的可靠公开数据集，不能用随机 ID 或未经证实的名称填充。新平台没有明确可验证的转换规则时，不生成虚构订阅。

创作者需有明确的原平台 ID 或 Feed。B 站主页使用当次下载的 RSSHub 官方 Radar 中的声明式投稿模板转换，不枚举 UID。YouTube 原生频道 Feed 提取 channel_id。不同平台同名账号不合并；只有相同平台 ID 和内容路由才去重，不把投稿与动态混为一条。

Feed 验证支持 RSS、Atom、RDF、JSON Feed；过期或空 Feed 不因更新时间被排除。成功解析且有真实名称才接受新增。403/429/5xx、TLS、超时、无效正文及未知身份保留为 defer，不伪造成功。多个实例尝试合成一次检查，不能充当多次独立证据。只有连续至少三次不同 run_id 的 404/410，跨度至少 7 天，且本次原站身份地址也返回 404/410、不能确认身份，才标记 permanent。

网络使用匿名 GET，限制单响应 4 MiB、并发和套接字等待，逐块检查时间预算。DNS、代理连接、TLS 与平台限流可能延长实际墙钟耗时；该预算不是操作系统级硬截止。默认 16 并发，最高 128，不保证全部候选当次可验证。

若系统已有 curl，可给 check 增加 `--transport curl`，使用 curl 的总时限约束 DNS、连接和下载；不安装额外包、不加载 curlrc，也不跟随未经 URL 校验的重定向。默认 urllib 保持仅依赖 Python 标准库的可移植运行方式。

`checks-<uuid>.jsonl` 每完成一个候选就追加本次观察并刷新，不重复嵌入完整历史；续跑以流式读取合并历史，兼容旧 `checks.jsonl`。中断的残缺尾行保留原样并提示，完整行损坏则报错，不篡改或清理审计文件。重跑跳过 24 小时内已检查的条目。`--recheck` 强制新检查；`--run-id` 可标记同一次外部作业（重试不累积独立次数，成功证据也不会被替换）；`--offset/--limit` 支持分段。不得同时向同一 `--work` 运行多个检查进程。报告含候选总数、未下载成功的目录、accept/defer/permanent 数量及检查证据；未检查项不会冒充已通过。

按 Ctrl+C 会取消排队任务，等待当前请求退出后导出部分报告，并返回退出码 130。强制结束进程也不会改写已有证据，随后用 `report` 可离线恢复摘要；重新运行同一 check 命令即可续跑。降低并发或增加 timeout 可减少暂时失败，`--recheck` 才会在 24 小时内重新检查已完成项。

## 第二步：由项目离线导入

独立工具不会调用以下命令。确认 `report.json` 后，在 NewsNook 根目录运行：

```bash
node --import tsx scripts/rss-catalog-merge.ts --report artifacts/feed-catalog/report.json
node --import tsx scripts/rss-catalog-merge.ts --report artifacts/feed-catalog/report.json --apply
npm run rss-catalog:import
npm run test:rss-catalog
# 仅生成本地发布文件，不上传 R2
npm run rss-catalog:build
```

默认仅预览。`--apply` 完整校验后才原子更新唯一权威 `data/rss-catalog/upstream.json`；同一报告重复导入不改变 revision。新增 ID 按内容身份生成，原有条目不改名、不换地址、不换 ID。permanent 只供人工审查，此命令不删除旧条目。归一化、体积限制、种子、R2 本地构建继续复用项目原有链路，不自行发布。

## 本次交接的本地状态

2026-11-04 按用户要求停止采集，将完整工具交由用户运行。候选共 45,323 条，已检查 31,153 条（accept 14,516 / defer 16,637 / permanent 0），未检查 14,170 条。已有 `artifacts/feed-catalog/report.json` 可离线预览；预览新增 14,057 条、重复 459 条，预计目录为 20,566 条。**尚未 apply，权威目录和种子仍为 6,509 条。** 后续续跑后这些统计会变化，以工具输出为准。现有文件位于忽略目录，不提交采集过程数据。

## 数据出处与许可

- [Kagi Small Web](https://github.com/kagisearch/smallweb)：MIT，Copyright (c) 2023 Kagi Search；来源文件 smallweb.txt、smallyt.txt、smallcomic.txt。目录偏向独立内容，不代表全部全球平台覆盖。
- [中文独立博客](https://github.com/lovexw/chinese-independent-blogs)：MIT，Copyright (c) 2019 Tim Qian；使用 blogs-original.csv，不采用上游新鲜度过滤。
- [awesome-bilibili](https://github.com/SyMind/awesome-bilibili)：CC0-1.0；技术领域创作者主页名单。
- [RSSHub Radar](https://github.com/DIYgod/RSSHub)：MIT；只匹配安全的声明式路径参数。

各来源的许可文本保留在上游 LICENSE；本地候选记录下载地址、许可标识、内容 SHA-256。采集记录不提交 Git。目录本身的许可不代替被订阅站点的文章或媒体许可。
