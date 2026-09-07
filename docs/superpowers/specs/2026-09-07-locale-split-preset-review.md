# 预设 × 分类 × 信源 审查表（全库重筛提案）

> **口径**：从全部 135 个内置信源重新筛选、分组；**不必每个源都进某个预设**。
> 规则：同栏不中英混源；中文栏在前，外刊栏在后；同一预设内主题栏信源互斥。**内置预设不再使用「综合」**——原先堆在 mix 的源改挂主题分类。
> 已按本表写入 `CATEGORIES` 与 `BUILTIN_PRESETS`。

## 覆盖

- 注册表信源：135
- 至少进入 1 个预设：129
- 未进入任何预设（频道页仍可开）：6

### 网易细分入座（并入主题栏，不堆轨）

| 源 | 放入 | 分类 | 理由 |
|---|---|---|---|
| `netease-exclusive` | 全景门户 | `exclusive` 独家（热点后） | 门户特稿 |
| `netease-football` / `netease-cn-football` | 全景门户 | `sports` 体育（并入） | 体育垂直，不开足球轨 |
| `netease-auto` | 全景门户、商业创投 | `tech` 科技（并入） | 消费/产业都走科技，不开汽车轨；不进极客（极客科技已是手机/数码） |
| `netease-phone` / `netease-digital` | 极客与 AI | `tech` 科技（并入） | 消费电子，跟 IT之家同栏 |
| `netease-edu` | 慢读知性 | `edu` 教育 | 人文教育，不是门户快讯 |
| `netease-blog` | 慢读知性 | `blog` 博客 | 随笔，和知乎/无业游民同场景 |
| `netease-travel` | 摸鱼消遣 | `travel` 旅游 | 生活消遣，和历史同轨 |

仍不进预设：`netease-nba` · `netease-cba` · `netease-run` · `netease-antique` · `netease-gov` · `netease-select`。

### 通盘调整（相对上一稿）

- **取消综合**：全景 / 商业创投 / 全球视野都不再挂 `mix`。分类管理里仍可自开，内置预设默认隐藏。
- **原全景综合 6 源**：阮一峰、小众软件 → 全景科技；返朴、物理所 → 全景科普；东财、股票 → 全景商业。
- **原商业创投综合**：网易商业 / 股票 / 东财 → 该预设「商业」；DW → 「国际」。
- **原全球视野综合**：BBC 中文·中国 → 「国际」。
- **汽车**：并入全景/商业创投「科技」，不开汽车轨。
- 默认轨不再堆 AI（量子位等只在极客/商业创投「业界」）。

## 全景门户 (`builtin-default`)

*日常中文阅读为主；外刊分栏靠后。无综合栏；汽车/阮一峰/小众软件进科技，返朴/物理所进科普，东财/股票进商业。*

可见栏 17 · 信源位 56 · 中文栏 10 · 外刊栏 7

| 分类 | id | 栏 | 信源 |
|---|---|---|---|
| 热点 | `hot` | 中文 | 网易热点 (`netease`) |
| 独家 | `exclusive` | 中文 | 网易独家 (`netease-exclusive`) |
| 娱乐 | `ent` | 中文 | 网易娱乐 (`netease-ent`) |
| 体育 | `sports` | 中文 | 网易体育 (`netease-sports`) · 足球 (`netease-football`) · 中国足球 (`netease-cn-football`) |
| 科技 | `tech` | 中文 | 网易科技 (`netease-tech`) · IT 之家 (`ithome`) · 少数派 (`sspai`) · 极客公园 (`geekpark`) · Solidot (`solidot`) · 爱范儿 (`ifanr`) · 汽车 (`netease-auto`) · 阮一峰的网络日志 (`ruanyifeng`) · 小众软件 (`appinn`) |
| 商业 | `finance` | 中文 | 财联社电报 (`cls-telegraph`) · 晚点 LatePost (`latepost`) · 36 氪 (`kr36`) · 东方财富快讯 (`eastmoney-kx`) · 华尔街见闻快讯 (`wscn-live`) · 虎嗅 (`huxiu`) · 甲子光年 (`jazzyear`) · 钛媒体 (`tmtpost`) · 东方财富 (`eastmoney-news`) · 股票 (`netease-stock`) · 网易商业 (`netease-biz`) |
| 国际 | `intl` | 中文 | BBC 中文 (`bbc-zh`) · DW 德国之声 (`dw-top`) · 端传媒 (`theinitium`) · BBC 中文 · 国际 (`bbc-zh-world`) |
| 健康 | `health` | 中文 | 网易健康 (`netease-health`) |
| 科普 | `science` | 中文 | 果壳 · 科学人 (`guokr`) · PanSci 泛科学 (`pansci`) · 环球科学 (`huanqiukexue`) · 地球知识局 (`netease-diqiu`) · 知识分子 (`zhishifenzi`) · 返朴 (`netease-fanpu`) · 中科院物理所 (`netease-wuli`) |
| 轻松一刻 | `fun` | 中文 | 网易轻松一刻 (`netease-fun`) · 煎蛋新鲜事 (`jandan`) · 机核 (`gcores`) |
| 娱乐·外刊 | `ent-world` | 外刊 | Google 娱乐 (`gnews-ent`) |
| 体育·外刊 | `sports-world` | 外刊 | Google 体育 (`gnews-sports`) |
| 科技·外刊 | `tech-world` | 外刊 | Google 科技 (`gnews-tech`) · The Verge (`verge`) · Ars Technica (`arstechnica`) |
| 商业·外刊 | `finance-world` | 外刊 | BBC Business (`bbc-business`) · Google 商业 (`gnews-business`) · TechCrunch (`techcrunch`) |
| 国际·外刊 | `intl-world` | 外刊 | Google 全球 (`gnews-world`) · SCMP 中国 (`scmp-china`) · NPR News (`npr`) · The Guardian World (`guardian-world`) |
| 健康·外刊 | `health-world` | 外刊 | Google 健康 (`gnews-health`) |
| 科普·外刊 | `science-world` | 外刊 | Google 科学 (`gnews-science`) · Quanta Magazine (`quanta`) |

## 极客与 AI (`builtin-tech`)

*中文业界/深读/社区/科技/科普在前；外刊与官方实验室在后。手机/数码并入科技，不另开栏。*

可见栏 13 · 信源位 69 · 中文栏 6 · 外刊栏 7

| 分类 | id | 栏 | 信源 |
|---|---|---|---|
| 业界 | `ai-media` | 中文 | 量子位 (`qbitai`) · 机器之心 (`jiqizhixin`) · 新智元 (`aiera`) · 雷锋网 (`leiphone`) |
| 深读 | `ai-depth` | 中文 | 智东西 (`zhidx`) · 宝玉的分享 (`baoyu`) · 夕小瑶科技说 (`xixiaoyao`) · 42章经 (`42zhangjing`) |
| 社区 | `ai-community` | 中文 | 优设 · AIGC (`uisdc-aigc`) · V2EX 分享创造 (`v2ex`) · PaperWeekly (`paperweekly`) · 人人都是产品经理 · AI (`woshipm-ai`) |
| 科技 | `tech` | 中文 | 少数派 (`sspai`) · 极客公园 (`geekpark`) · IT 之家 (`ithome`) · Solidot (`solidot`) · 阮一峰的网络日志 (`ruanyifeng`) · 小众软件 (`appinn`) · 手机 (`netease-phone`) · 数码 (`netease-digital`) |
| 科普 | `science` | 中文 | 果壳 · 科学人 (`guokr`) · PanSci 泛科学 (`pansci`) · 环球科学 (`huanqiukexue`) · 知识分子 (`zhishifenzi`) · 返朴 (`netease-fanpu`) · 中科院物理所 (`netease-wuli`) · 集智俱乐部 (`swarma`) |
| 科技深度 | `tech-depth` | 中文 | 浅黑科技 (`qianhei`) · 爱范儿 (`ifanr`) · InfoQ 中文 (`infoq-cn`) |
| 业界·外刊 | `ai-media-world` | 外刊 | MIT TR · AI (`mittr-ai`) · The Verge · AI (`verge-ai`) · IEEE Spectrum AI (`ieee-ai`) · VentureBeat AI (`venturebeat-ai`) · Synced (`synced`) · MarkTechPost (`marktechpost`) |
| 深读·外刊 | `ai-depth-world` | 外刊 | One Useful Thing (`oneusefulthing`) · Latent Space (`latent-space`) · Understanding AI (`understandingai`) · Don't Worry About the Vase (`thezvi`) · Last Week in AI (`lastweek-ai`) · Import AI (`import-ai`) · Simon Willison (`simonw`) · Interconnects (`interconnects`) · Lil’Log (`lil-log`) · Ahead of AI (`ahead-of-ai`) |
| 社区·外刊 | `ai-community-world` | 外刊 | Hacker News (`hn`) |
| 科技深度·外刊 | `tech-depth-world` | 外刊 | Ars Technica (`arstechnica`) · MIT Technology Review (`mittr`) · Quanta Magazine (`quanta`) · Stratechery (`stratechery`) · Vitalik Buterin's website (`vitalik`) · Paul Graham Essays (`paulgraham`) · Fabricated Knowledge (`fabricated-knowledge`) · Construction Physics (`construction-physics`) · WIRED (`wired`) · The Verge (`verge`) |
| OpenAI | `ai-openai` | 外刊 | OpenAI News (`openai-news`) · OpenAI Cookbook (`openai-cookbook`) |
| Claude | `ai-claude` | 外刊 | Anthropic News (`anthropic`) · Claude Blog (`claude-blog`) · Claude Customers (`claude-customers`) · Claude Academy · Use Cases (`claude-academy-use-cases`) · Claude Academy · Tutorials (`claude-academy-tutorials`) |
| 实验室 | `ai` | 外刊 | Google AI Blog (`google-ai`) · Google DeepMind (`deepmind`) · Hugging Face Blog (`huggingface`) · PyTorch Blog (`pytorch`) · Arena Blog (`arena`) |

## 深度智识 (`builtin-depth`)

*中文深度叙事与国际中文在前；思想外刊与专栏在后。*

可见栏 9 · 信源位 27 · 中文栏 4 · 外刊栏 5

| 分类 | id | 栏 | 信源 |
|---|---|---|---|
| 无业游民 | `theue` | 中文 | 无业游民 (`theue`) |
| 国际 | `intl` | 中文 | 端传媒 (`theinitium`) · BBC 中文 (`bbc-zh`) · DW 德国之声 (`dw-top`) |
| 科技 | `tech` | 中文 | V2EX 分享创造 (`v2ex`) · 阮一峰的网络日志 (`ruanyifeng`) · 浅黑科技 (`qianhei`) |
| 科普 | `science` | 中文 | 果壳 · 科学人 (`guokr`) · 知识分子 (`zhishifenzi`) · 返朴 (`netease-fanpu`) · 集智俱乐部 (`swarma`) |
| 国际·外刊 | `intl-world` | 外刊 | Foreign Affairs (`foreign-affairs`) · The New York Review of Books (`nyrb`) · Bloomberg Opinion (`bloomberg-opinion`) · Project Syndicate (`project-syndicate`) · Sinocism (`sinocism`) · SCMP 中国 (`scmp-china`) |
| 科技深度·外刊 | `tech-depth-world` | 外刊 | Quanta Magazine (`quanta`) · Stratechery (`stratechery`) · Vitalik Buterin's website (`vitalik`) · Paul Graham Essays (`paulgraham`) · Fabricated Knowledge (`fabricated-knowledge`) · Construction Physics (`construction-physics`) · MIT Technology Review (`mittr`) |
| ACX | `astral-codex-ten` | 外刊 | Astral Codex Ten (`astral-codex-ten`) |
| Marginalian | `marginalian` | 外刊 | The Marginalian (`marginalian`) |
| ALDaily | `aldaily` | 外刊 | Arts & Letters Daily (`aldaily`) |

## 商业创投 (`builtin-biz`)

*中文创投产业为主；外刊靠后。无综合栏；网易商业/股票/东财进商业，DW 进国际。*

可见栏 7 · 信源位 31 · 中文栏 4 · 外刊栏 3

| 分类 | id | 栏 | 信源 |
|---|---|---|---|
| 商业 | `finance` | 中文 | 晚点 LatePost (`latepost`) · 甲子光年 (`jazzyear`) · 36 氪 (`kr36`) · 虎嗅 (`huxiu`) · 钛媒体 (`tmtpost`) · 财联社电报 (`cls-telegraph`) · 东方财富快讯 (`eastmoney-kx`) · 华尔街见闻快讯 (`wscn-live`) · 网易商业 (`netease-biz`) · 股票 (`netease-stock`) · 东方财富 (`eastmoney-news`) |
| 国际 | `intl` | 中文 | 端传媒 (`theinitium`) · BBC 中文 (`bbc-zh`) · DW 德国之声 (`dw-top`) |
| 科技 | `tech` | 中文 | 极客公园 (`geekpark`) · 少数派 (`sspai`) · 爱范儿 (`ifanr`) · 汽车 (`netease-auto`) |
| 业界 | `ai-media` | 中文 | 量子位 (`qbitai`) · 新智元 (`aiera`) · 机器之心 (`jiqizhixin`) |
| 商业·外刊 | `finance-world` | 外刊 | TechCrunch (`techcrunch`) · BBC Business (`bbc-business`) · Google 商业 (`gnews-business`) · Stratechery (`stratechery`) |
| 国际·外刊 | `intl-world` | 外刊 | Bloomberg Opinion (`bloomberg-opinion`) · Project Syndicate (`project-syndicate`) · SCMP 中国 (`scmp-china`) · Sinocism (`sinocism`) |
| 业界·外刊 | `ai-media-world` | 外刊 | VentureBeat AI (`venturebeat-ai`) · MIT TR · AI (`mittr-ai`) |

## 全球视野 (`builtin-world`)

*中文国际与科普在前；外刊广电/智库在后。无综合栏；BBC 中文·中国并入国际。*

可见栏 6 · 信源位 27 · 中文栏 3 · 外刊栏 3

| 分类 | id | 栏 | 信源 |
|---|---|---|---|
| 国际 | `intl` | 中文 | 端传媒 (`theinitium`) · BBC 中文 (`bbc-zh`) · DW 德国之声 (`dw-top`) · BBC 中文 · 国际 (`bbc-zh-world`) · BBC 中文 · 中国 (`bbc-zh-china`) |
| 热点 | `hot` | 中文 | 网易热点 (`netease`) |
| 科普 | `science` | 中文 | 环球科学 (`huanqiukexue`) · PanSci 泛科学 (`pansci`) · 果壳 · 科学人 (`guokr`) · 知识分子 (`zhishifenzi`) |
| 国际·外刊 | `intl-world` | 外刊 | BBC World (`bbc-world`) · NPR News (`npr`) · The Guardian World (`guardian-world`) · France 24 (`france24`) · Al Jazeera (`aljazeera`) · SCMP 中国 (`scmp-china`) · SCMP News (`scmp-news`) · Foreign Affairs (`foreign-affairs`) · The New York Review of Books (`nyrb`) · Sinocism (`sinocism`) · Google 全球 (`gnews-world`) |
| 科技深度·外刊 | `tech-depth-world` | 外刊 | Quanta Magazine (`quanta`) · MIT Technology Review (`mittr`) · WIRED (`wired`) · Ars Technica (`arstechnica`) · The Verge (`verge`) |
| 科普·外刊 | `science-world` | 外刊 | Google 科学 (`gnews-science`) |

## 慢读知性 (`builtin-mindful`)

*全中文慢读；外刊不进本预设（需要外刊请切深度智识/全球视野）。教育、博客作为知性栏目，不进全景。*

可见栏 7 · 信源位 18 · 中文栏 7 · 外刊栏 0

| 分类 | id | 栏 | 信源 |
|---|---|---|---|
| 科普 | `science` | 中文 | 果壳 · 科学人 (`guokr`) · PanSci 泛科学 (`pansci`) · 环球科学 (`huanqiukexue`) · 知识分子 (`zhishifenzi`) · 返朴 (`netease-fanpu`) · 地球知识局 (`netease-diqiu`) · 集智俱乐部 (`swarma`) |
| 科技 | `tech` | 中文 | 少数派 (`sspai`) · 阮一峰的网络日志 (`ruanyifeng`) · 小众软件 (`appinn`) · V2EX 分享创造 (`v2ex`) · 浅黑科技 (`qianhei`) |
| 教育 | `edu` | 中文 | 教育 (`netease-edu`) |
| 无业游民 | `theue` | 中文 | 无业游民 (`theue`) |
| 知乎日报 | `zhihu` | 中文 | 知乎日报 (`zhihu-daily`) |
| 博客 | `blog` | 中文 | 网易博客 (`netease-blog`) |
| 轻松一刻 | `fun` | 中文 | 机核 (`gcores`) · 煎蛋新鲜事 (`jandan`) |

## 摸鱼消遣 (`builtin-fun`)

*中文消遣为主；娱乐外刊单栏靠后。旅游跟历史同属生活消遣，不进全景。*

可见栏 7 · 信源位 9 · 中文栏 6 · 外刊栏 1

| 分类 | id | 栏 | 信源 |
|---|---|---|---|
| 轻松一刻 | `fun` | 中文 | 网易轻松一刻 (`netease-fun`) · 煎蛋新鲜事 (`jandan`) · 机核 (`gcores`) |
| 娱乐 | `ent` | 中文 | 网易娱乐 (`netease-ent`) |
| 游戏 | `game` | 中文 | 游戏 (`netease-game`) |
| 历史 | `history` | 中文 | 历史 (`netease-history`) |
| 旅游 | `travel` | 中文 | 旅游 (`netease-travel`) |
| 知乎日报 | `zhihu` | 中文 | 知乎日报 (`zhihu-daily`) |
| 娱乐·外刊 | `ent-world` | 外刊 | Google 娱乐 (`gnews-ent`) |

## 信源 locale 总表

| id | 名称 | locale | 进入预设数 |
|---|---|---|---|
| `netease` | 网易热点 | zh | 2 |
| `netease-tech` | 网易科技 | zh | 1 |
| `netease-ent` | 网易娱乐 | zh | 2 |
| `netease-exclusive` | 网易独家 | zh | 1 |
| `netease-sports` | 网易体育 | zh | 1 |
| `netease-game` | 游戏 | zh | 1 |
| `netease-health` | 网易健康 | zh | 1 |
| `netease-nba` | NBA | zh | 0 |
| `netease-biz` | 网易商业 | zh | 2 |
| `netease-edu` | 教育 | zh | 1 |
| `netease-fun` | 网易轻松一刻 | zh | 2 |
| `netease-antique` | 古玩 | zh | 0 |
| `netease-gov` | 网易政务 | zh | 0 |
| `netease-select` | 精选 | zh | 0 |
| `netease-phone` | 手机 | zh | 1 |
| `netease-football` | 足球 | zh | 1 |
| `netease-digital` | 数码 | zh | 1 |
| `netease-run` | 跑步 | zh | 0 |
| `netease-history` | 历史 | zh | 1 |
| `netease-stock` | 股票 | zh | 2 |
| `netease-cba` | CBA | zh | 0 |
| `netease-cn-football` | 中国足球 | zh | 1 |
| `netease-auto` | 汽车 | zh | 2 |
| `netease-travel` | 旅游 | zh | 1 |
| `netease-blog` | 网易博客 | zh | 1 |
| `sspai` | 少数派 | zh | 4 |
| `ifanr` | 爱范儿 | zh | 3 |
| `kr36` | 36 氪 | zh | 2 |
| `ithome` | IT 之家 | zh | 2 |
| `huxiu` | 虎嗅 | zh | 2 |
| `geekpark` | 极客公园 | zh | 3 |
| `solidot` | Solidot | zh | 2 |
| `infoq-cn` | InfoQ 中文 | zh | 1 |
| `pansci` | PanSci 泛科学 | zh | 4 |
| `huanqiukexue` | 环球科学 | zh | 4 |
| `guokr` | 果壳 · 科学人 | zh | 5 |
| `netease-fanpu` | 返朴 | zh | 4 |
| `netease-wuli` | 中科院物理所 | zh | 2 |
| `netease-diqiu` | 地球知识局 | zh | 2 |
| `ruanyifeng` | 阮一峰的网络日志 | zh | 4 |
| `gcores` | 机核 | zh | 3 |
| `appinn` | 小众软件 | zh | 3 |
| `tmtpost` | 钛媒体 | zh | 2 |
| `jazzyear` | 甲子光年 | zh | 2 |
| `zhishifenzi` | 知识分子 | zh | 5 |
| `latepost` | 晚点 LatePost | zh | 2 |
| `cls-telegraph` | 财联社电报 | zh | 2 |
| `eastmoney-kx` | 东方财富快讯 | zh | 2 |
| `eastmoney-news` | 东方财富 | zh | 2 |
| `wscn-live` | 华尔街见闻快讯 | zh | 2 |
| `bbc-business` | BBC Business | world | 2 |
| `bbc-zh` | BBC 中文 | zh | 4 |
| `bbc-zh-china` | BBC 中文 · 中国 | zh | 1 |
| `bbc-zh-world` | BBC 中文 · 国际 | zh | 2 |
| `bbc-world` | BBC World | world | 1 |
| `gnews-world` | Google 全球 | world | 2 |
| `gnews-business` | Google 商业 | world | 2 |
| `gnews-tech` | Google 科技 | world | 1 |
| `gnews-sports` | Google 体育 | world | 1 |
| `gnews-ent` | Google 娱乐 | world | 2 |
| `gnews-science` | Google 科学 | world | 2 |
| `gnews-health` | Google 健康 | world | 1 |
| `dw-top` | DW 德国之声 | zh | 4 |
| `scmp-china` | SCMP 中国 | world | 4 |
| `scmp-news` | SCMP News | world | 1 |
| `npr` | NPR News | world | 2 |
| `guardian-world` | The Guardian World | world | 2 |
| `france24` | France 24 | world | 1 |
| `aljazeera` | Al Jazeera | world | 1 |
| `arstechnica` | Ars Technica | world | 3 |
| `mittr` | MIT Technology Review | world | 3 |
| `verge` | The Verge | world | 3 |
| `techcrunch` | TechCrunch | world | 2 |
| `wired` | WIRED | world | 2 |
| `hn` | Hacker News | world | 1 |
| `qbitai` | 量子位 | zh | 2 |
| `jiqizhixin` | 机器之心 | zh | 2 |
| `aiera` | 新智元 | zh | 2 |
| `leiphone` | 雷锋网 | zh | 1 |
| `synced` | Synced | world | 1 |
| `openai-news` | OpenAI News | world | 1 |
| `google-ai` | Google AI Blog | world | 1 |
| `deepmind` | Google DeepMind | world | 1 |
| `huggingface` | Hugging Face Blog | world | 1 |
| `pytorch` | PyTorch Blog | world | 1 |
| `mittr-ai` | MIT TR · AI | world | 2 |
| `verge-ai` | The Verge · AI | world | 1 |
| `ieee-ai` | IEEE Spectrum AI | world | 1 |
| `venturebeat-ai` | VentureBeat AI | world | 2 |
| `marktechpost` | MarkTechPost | world | 1 |
| `lastweek-ai` | Last Week in AI | world | 1 |
| `import-ai` | Import AI | world | 1 |
| `ahead-of-ai` | Ahead of AI | world | 1 |
| `lil-log` | Lil’Log | world | 1 |
| `simonw` | Simon Willison | world | 1 |
| `interconnects` | Interconnects | world | 1 |
| `zhidx` | 智东西 | zh | 1 |
| `baoyu` | 宝玉的分享 | zh | 1 |
| `oneusefulthing` | One Useful Thing | world | 1 |
| `understandingai` | Understanding AI | world | 1 |
| `latent-space` | Latent Space | world | 1 |
| `thezvi` | Don't Worry About the Vase | world | 1 |
| `xixiaoyao` | 夕小瑶科技说 | zh | 1 |
| `paperweekly` | PaperWeekly | zh | 1 |
| `42zhangjing` | 42章经 | zh | 1 |
| `swarma` | 集智俱乐部 | zh | 3 |
| `qianhei` | 浅黑科技 | zh | 3 |
| `uisdc-aigc` | 优设 · AIGC | zh | 1 |
| `woshipm-ai` | 人人都是产品经理 · AI | zh | 1 |
| `arena` | Arena Blog | world | 1 |
| `anthropic` | Anthropic News | world | 1 |
| `claude-blog` | Claude Blog | world | 1 |
| `claude-customers` | Claude Customers | world | 1 |
| `claude-academy-use-cases` | Claude Academy · Use Cases | world | 1 |
| `claude-academy-tutorials` | Claude Academy · Tutorials | world | 1 |
| `openai-cookbook` | OpenAI Cookbook | world | 1 |
| `zhihu-daily` | 知乎日报 | zh | 2 |
| `jandan` | 煎蛋新鲜事 | zh | 3 |
| `foreign-affairs` | Foreign Affairs | world | 2 |
| `nyrb` | The New York Review of Books | world | 2 |
| `bloomberg-opinion` | Bloomberg Opinion | world | 2 |
| `project-syndicate` | Project Syndicate | world | 2 |
| `sinocism` | Sinocism | world | 3 |
| `theinitium` | 端传媒 | zh | 4 |
| `quanta` | Quanta Magazine | world | 4 |
| `stratechery` | Stratechery | world | 3 |
| `vitalik` | Vitalik Buterin's website | world | 2 |
| `fabricated-knowledge` | Fabricated Knowledge | world | 2 |
| `construction-physics` | Construction Physics | world | 2 |
| `paulgraham` | Paul Graham Essays | world | 2 |
| `v2ex` | V2EX 分享创造 | zh | 3 |
| `astral-codex-ten` | Astral Codex Ten | world | 1 |
| `marginalian` | The Marginalian | world | 1 |
| `aldaily` | Arts & Letters Daily | world | 1 |
| `theue` | 无业游民 | zh | 2 |