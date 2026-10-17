// ==UserScript==
// @name         NewsNook | Linux.do 油猴引擎自检
// @namespace    https://news.aizeek.com/userscripts
// @version      2.0.0
// @description  真实回复树、自动上下滚动、只看楼主，以及 GM API/现代 JS 兼容性诊断。
// @match        https://linux.do/*
// @run-at       document-end
// @grant        GM_addStyle
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_deleteValue
// @grant        GM_listValues
// @grant        GM_addValueChangeListener
// @grant        GM_removeValueChangeListener
// @grant        GM_registerMenuCommand
// @grant        GM_xmlhttpRequest
// @connect      linux.do
// ==/UserScript==

(() => {
  'use strict';

  // 本脚本用于验证 NewsNook 的独立 WebView 浏览器，不作用于原生 Linux.do 社区。
  if (location.protocol !== 'https:' || location.hostname !== 'linux.do' || window !== window.top) return;
  if (document.getElementById('nnus-lab-root')) return;

  const ROOT = 'nnus-lab-root';
  const PREFIX = 'nnus-demo-v2:';
  const VERSION = '2.0.0';
  const state = {
    page: location.href,
    topicId: null,
    topicData: null,
    topicPromise: null,
    topicRequestId: null,
    owner: null,
    onlyOwner: false,
    autoscroll: false,
    scrollDirection: 1,
    scrollTick: 0,
    scrollTimer: null,
    scrollElapsed: 0,
    sheetOpen: false,
    panelOpen: true,
    routeChanges: 0,
    eventCount: 0,
    cssOk: false,
    menuOk: false,
    loadNumber: null,
    diagRunning: false,
  };

  const css = `
    #${ROOT}, #${ROOT} * {box-sizing:border-box !important}
    #${ROOT} {font-family:system-ui,-apple-system,"Segoe UI",sans-serif !important;color:#eef4ff !important;
      line-height:1.45 !important;position:fixed !important;inset:0 !important;z-index:2147483610 !important;
      pointer-events:none !important;font-size:13px !important}
    #${ROOT} [hidden][hidden] {display:none !important}
    #${ROOT} button {font:inherit !important;cursor:pointer !important;touch-action:manipulation !important;
      -webkit-appearance:none !important;appearance:none !important}
    #${ROOT} .nnus-dock {pointer-events:auto !important;position:absolute !important;
      right:12px !important;bottom:calc(12px + env(safe-area-inset-bottom,0px)) !important;
      width:min(366px,calc(100vw - 24px)) !important;max-height:min(75vh,610px) !important;
      overflow:auto !important;overscroll-behavior:contain !important;
      border:1px solid #435d90 !important;border-radius:17px !important;
      background:#151e37 !important;box-shadow:0 18px 56px #07102080 !important;}
    #${ROOT} .nnus-head {display:flex !important;align-items:center !important;gap:10px !important;
      padding:13px 14px 11px !important;border-bottom:1px solid #354461 !important;}
    #${ROOT} .nnus-logo {display:grid !important;place-items:center !important;flex:none !important;
      background:#39e3b7 !important;color:#09312d !important;font-weight:900 !important;font-size:17px !important;
      width:35px !important;height:35px !important;border-radius:11px !important;}
    #${ROOT} .nnus-head-main {flex:1 !important;min-width:0 !important;}
    #${ROOT} .nnus-head-main strong {font-size:15px !important;font-weight:800 !important;color:#fff !important;}
    #${ROOT} .nnus-head-main small {display:block !important;color:#9baecd !important;font-size:10px !important;}
    #${ROOT} .nnus-mini {background:#293957 !important;color:#f6faff !important;border:0 !important;
      border-radius:8px !important;width:32px !important;height:32px !important;font-weight:800 !important;}
    #${ROOT} .nnus-status {padding:9px 14px !important;font-size:11px !important;
      background:#133b39 !important;color:#7bf6d4 !important;}
    #${ROOT} .nnus-features {padding:10px !important;display:grid !important;gap:8px !important;}
    #${ROOT} .nnus-feature {display:flex !important;gap:11px !important;align-items:center !important;
      width:100% !important;text-align:left !important;border-radius:11px !important;
      border:1px solid #435778 !important;background:#22304e !important;color:#f4f7ff !important;
      padding:11px 12px !important;min-height:61px !important;}
    #${ROOT} .nnus-feature:active {transform:scale(.992) !important;}
    #${ROOT} .nnus-feature[data-on="true"] {border-color:#30d6aa !important;background:#194344 !important;}
    #${ROOT} .nnus-icon {width:36px !important;height:36px !important;display:grid !important;place-items:center !important;
      border-radius:10px !important;background:#34456b !important;color:#74f0d4 !important;
      flex:none !important;font-weight:900 !important;font-size:17px !important;}
    #${ROOT} .nnus-feature[data-on="true"] .nnus-icon {background:#22d9aa !important;color:#082c25 !important;}
    #${ROOT} .nnus-feature-name {min-width:0 !important;flex:1 !important;}
    #${ROOT} .nnus-feature-name strong {font-size:13px !important;font-weight:750 !important;display:block !important;}
    #${ROOT} .nnus-feature-name small {color:#a6b7d5 !important;font-size:11px !important;display:block !important;
      margin-top:2px !important;}
    #${ROOT} .nnus-arrow {font-size:18px !important;color:#8cefd6 !important;font-weight:800 !important;}
    #${ROOT} .nnus-extra {padding:0 12px 12px !important;}
    #${ROOT} .nnus-secondary {background:#152947 !important;border:1px solid #536586 !important;
      border-radius:9px !important;padding:9px 12px !important;color:#d3e2ff !important;width:100% !important;
      font-weight:650 !important;text-align:center !important;}
    #${ROOT} .nnus-feedback {font-size:11px !important;color:#adbfdf !important;margin-top:9px !important;
      line-height:1.5 !important;word-break:break-word !important;}
    #${ROOT} .nnus-diag {max-height:220px !important;overflow:auto !important;background:#0b1527 !important;
      margin-top:10px !important;border:1px solid #405474 !important;border-radius:9px !important;padding:9px !important;}
    #${ROOT} .nnus-diag-line {display:flex !important;gap:8px !important;justify-content:space-between !important;
      border-bottom:1px solid #22324e !important;padding:6px 0 !important;font-size:11px !important;}
    #${ROOT} .nnus-diag-line:last-child {border-bottom:0 !important}
    #${ROOT} .nnus-diag-line b {flex:none !important;color:#74f0c8 !important;}
    #${ROOT} .nnus-diag-line b[data-ok="false"] {color:#ffb46e !important;}
    #${ROOT} .nnus-fab {position:absolute !important;pointer-events:auto !important;
      bottom:calc(13px + env(safe-area-inset-bottom,0px)) !important;right:12px !important;
      display:flex !important;align-items:center !important;gap:9px !important;
      padding:12px 17px !important;border:none !important;border-radius:30px !important;
      background:#27e5ad !important;color:#0d322b !important;font-weight:800 !important;
      box-shadow:0 10px 30px #001d1b88 !important;}
    #${ROOT} .nnus-fab-label {font-size:13px !important}
    #${ROOT} .nnus-sheet-bg {pointer-events:auto !important;position:absolute !important;inset:0 !important;
      background:rgba(9,18,33,.72) !important;display:flex !important;align-items:stretch !important;
      justify-content:center !important;}
    #${ROOT} .nnus-sheet {display:flex !important;flex-direction:column !important;min-width:0 !important;
      width:min(100%,760px) !important;height:100% !important;background:#f6f8fc !important;
      color:#16263d !important;box-shadow:0 10px 60px #050d1799 !important;}
    #${ROOT} .nnus-sheet-head {padding:16px !important;background:#101f36 !important;color:#e9f4ff !important;
      border-bottom:3px solid #35ddb1 !important;}
    #${ROOT} .nnus-sheet-heading {display:flex !important;gap:10px !important;align-items:center !important;}
    #${ROOT} .nnus-sheet-heading div {flex:1 !important;min-width:0 !important;}
    #${ROOT} .nnus-sheet-heading strong {font-size:18px !important;font-weight:800 !important;display:block !important;}
    #${ROOT} .nnus-sheet-heading small {font-size:11px !important;color:#a9c3d3 !important;display:block !important;
      overflow:hidden !important;white-space:nowrap !important;text-overflow:ellipsis !important;}
    #${ROOT} .nnus-return {background:#31e0b4 !important;color:#0b322b !important;border:0 !important;
      border-radius:10px !important;padding:9px 12px !important;font-size:12px !important;font-weight:800 !important;}
    #${ROOT} .nnus-sheet-summary {font-size:12px !important;color:#556983 !important;
      padding:10px 16px !important;background:#e6f4ef !important;line-height:1.5 !important;}
    #${ROOT} .nnus-posts {overflow:auto !important;overscroll-behavior:contain !important;flex:1 !important;
      min-height:0 !important;padding:14px 11px 25px !important;}
    #${ROOT} .nnus-post {background:white !important;border-radius:12px !important;box-shadow:0 1px 5px #142c4017 !important;
      margin:0 0 10px !important;padding:10px !important;border:1px solid #dee7ef !important;
      border-left:4px solid #39cbaa !important;min-width:0 !important;}
    #${ROOT} .nnus-post[data-depth="0"] {border-left-color:#1a85cf !important;}
    #${ROOT} .nnus-post-meta {display:flex !important;align-items:center !important;flex-wrap:wrap !important;
      gap:7px !important;font-size:11px !important;color:#718099 !important;margin-bottom:6px !important;}
    #${ROOT} .nnus-post-author {color:#195681 !important;font-weight:850 !important;font-size:12px !important;}
    #${ROOT} .nnus-post-reference {background:#dcf7e9 !important;border-radius:6px !important;
      padding:2px 5px !important;color:#247860 !important;font-size:10px !important;}
    #${ROOT} .nnus-post-content {color:#26374f !important;font-size:13px !important;line-height:1.7 !important;
      white-space:pre-wrap !important;overflow-wrap:anywhere !important;max-height:200px !important;overflow:hidden !important;}
    #${ROOT} .nnus-post-foot {display:flex !important;align-items:center !important;justify-content:space-between !important;
      font-size:11px !important;color:#8191a4 !important;padding-top:6px !important;}
    #${ROOT} .nnus-jump {border:none !important;background:transparent !important;color:#2377a0 !important;
      text-decoration:underline !important;font-size:11px !important;padding:3px 0 !important;}
    #${ROOT} .nnus-sheet-bottom {padding:9px 15px !important;border-top:1px solid #dce8ef !important;
      background:#fff !important;display:flex !important;align-items:center !important;gap:10px !important;}
    #${ROOT} .nnus-loadmore {background:#d8f5e8 !important;color:#175647 !important;border:0 !important;
      padding:10px 13px !important;border-radius:10px !important;font-size:12px !important;font-weight:700 !important;}
    #${ROOT} .nnus-sheet-note {flex:1 !important;font-size:11px !important;color:#718399 !important;}
    html.nnus-only-op .topic-post.nnus-other-poster {display:none !important;}
    html.nnus-only-op #post-stream .topic-post.nnus-other-poster {display:none !important;}
    html.nnus-only-op .post-stream .topic-post.nnus-other-poster {display:none !important;}
    html.nnus-swipe-on {scroll-behavior:auto !important}
    html.nnus-swipe-on .topic-post .cooked {border-left:3px solid #37d6a8 !important;padding-left:8px !important;}
    @media (prefers-reduced-motion:reduce) {
      #${ROOT} .nnus-feature:active {transform:none !important;}
    }
  `;

  try {
    if (typeof GM_addStyle === 'function') {
      const element = GM_addStyle(css);
      state.cssOk = !!element;
    }
  } catch (error) {
    console.warn('[NewsNook Userscript] GM_addStyle failed:', error);
  }
  if (!state.cssOk) {
    const fallback = document.createElement('style');
    fallback.textContent = css;
    (document.head || document.documentElement).appendChild(fallback);
  }

  const host = document.createElement('div');
  host.id = ROOT;
  host.innerHTML = `
    <section class="nnus-dock" aria-label="NewsNook Linux.do 油猴测试工具">
      <header class="nnus-head">
        <span class="nnus-logo">N</span>
        <span class="nnus-head-main"><strong>Linux.do 交互实验室</strong>
          <small>NEWSNOOK USER SCRIPT · V${VERSION}</small></span>
        <button class="nnus-mini" type="button" data-action="collapse" aria-label="收起测试工具">−</button>
      </header>
      <div class="nnus-status" data-field="health">● 油猴脚本执行成功 · 功能待测</div>
      <div class="nnus-features">
        <button class="nnus-feature" type="button" data-action="thread" data-on="false">
          <span class="nnus-icon">▤</span>
          <span class="nnus-feature-name"><strong>1. 楼中楼模式</strong>
            <small>真实引用关系 → 嵌套对话树</small></span><span class="nnus-arrow">›</span>
        </button>
        <button class="nnus-feature" type="button" data-action="swipe" data-on="false">
          <span class="nnus-icon">↕</span>
          <span class="nnus-feature-name"><strong data-field="swipe-name">2. 自动上下滑动</strong>
            <small data-field="swipe-detail">自动滚动，底部反向 · 点击启动</small></span>
          <span class="nnus-arrow" data-field="swipe-icon">▶</span>
        </button>
        <button class="nnus-feature" type="button" data-action="onlyOp" data-on="false">
          <span class="nnus-icon">◎</span>
          <span class="nnus-feature-name"><strong data-field="op-name">3. 只看楼主</strong>
            <small data-field="op-detail">隐藏其他用户的回复 · 点击筛选</small></span>
          <span class="nnus-arrow">›</span>
        </button>
      </div>
      <div class="nnus-extra">
        <button class="nnus-secondary" data-action="diagnostics" type="button">4. 运行兼容性体检</button>
        <div class="nnus-diag" data-field="diag" hidden></div>
        <div class="nnus-feedback" role="status" aria-live="polite" data-field="message">
          先进入 Linux.do 帖子，然后点击三个功能按钮观察页面变化。
        </div>
      </div>
    </section>
    <button class="nnus-fab" type="button" data-action="expand" hidden><span>◉</span>
      <span class="nnus-fab-label">NewsNook · 打开交互工具</span></button>
    <div class="nnus-sheet-bg" hidden>
      <section class="nnus-sheet" role="dialog" aria-modal="true" aria-label="Linux.do 楼中楼实验视图">
        <div class="nnus-sheet-head">
          <div class="nnus-sheet-heading">
            <div><strong>楼中楼 · 对话树</strong><small data-field="thread-title">正在载入帖子...</small></div>
            <button class="nnus-return" data-action="threadClose" type="button">返回原布局</button>
          </div>
        </div>
        <div class="nnus-sheet-summary" data-field="thread-summary">正在建立回复关系...</div>
        <div class="nnus-posts" data-field="posts"></div>
        <div class="nnus-sheet-bottom">
          <button class="nnus-loadmore" type="button" data-action="loadMore" hidden>加载更多回复</button>
          <span class="nnus-sheet-note" data-field="thread-bottom">读取真实 Linux.do 话题数据</span>
        </div>
      </section>
    </div>`;

  document.body.appendChild(host);

  const select = query => host.querySelector(query);
  function field(name, text) {
    const element = select(`[data-field="${name}"]`);
    if (element) element.textContent = String(text);
  }
  function note(text) {
    field('message', text);
  }
  function actionState(action, on) {
    const button = select(`[data-action="${action}"]`);
    if (button) button.dataset.on = on ? 'true' : 'false';
  }
  function safeGet(name, defaultValue) {
    return typeof GM_getValue === 'function' ? GM_getValue(PREFIX + name, defaultValue) : defaultValue;
  }
  function safeSet(name, value) {
    if (typeof GM_setValue !== 'function') return false;
    GM_setValue(PREFIX + name, value);
    return typeof GM_getValue === 'function' && GM_getValue(PREFIX + name) === value;
  }
  try {
    const previous = Number(safeGet('loads', 0)) || 0;
    state.loadNumber = previous + 1;
    safeSet('loads', state.loadNumber);
    field('health', `● 脚本运行成功 · GM_addStyle ${state.cssOk ? 'PASS' : 'FAIL'} · 加载 #${state.loadNumber}`);
  } catch (error) {
    field('health', '● 脚本运行成功 · GM 存储待检查');
    console.warn('[NewsNook Userscript] storage:', error);
  }

  const currentTopicId = () => {
    const parts = location.pathname.split('/').filter(Boolean);
    if (parts[0] !== 't') return null;
    if (/^\d+$/.test(parts[1] || '')) return parts[1];
    if (/^\d+$/.test(parts[2] || '')) return parts[2];
    return null;
  };
  state.topicId = currentTopicId();

  function requestWithGm(url, responseType = 'json') {
    return new Promise((resolve, reject) => {
      if (typeof GM_xmlhttpRequest !== 'function') {
        reject(new Error('GM_xmlhttpRequest 不可用'));
        return;
      }
      let completed = false;
      let request;
      const finalize = (error, value) => {
        if (completed) return;
        completed = true;
        clearTimeout(timeout);
        if (error) reject(error);
        else resolve(value);
      };
      const timeout = setTimeout(() => {
        if (request && typeof request.abort === 'function') request.abort();
        finalize(new Error('GM HTTP 请求超时'));
      }, 13000);
      try {
        request = GM_xmlhttpRequest({
          method: 'GET', url, responseType,
          onload(result) {
            if (Number(result.status) < 200 || Number(result.status) >= 300) {
              finalize(new Error(`GM HTTP ${result.status}`)); return;
            }
            let data = result.response;
            if (responseType === 'json' && typeof data === 'string') {
              try { data = JSON.parse(data); } catch (error) { finalize(error); return; }
            }
            finalize(null, responseType === 'json' ? data : result);
          },
          onerror(error) { finalize(new Error(String(error && (error.error || error.message) || 'GM HTTP error'))); },
          onabort() { finalize(new Error('GM HTTP 请求已取消')); },
        });
      } catch (error) { finalize(error); }
    });
  }

  async function requestJson(url) {
    // GM API 始终优先；站内 fetch 只作为浏览器运行时故障时的退路。
    try {
      return await requestWithGm(url, 'json');
    } catch (gmError) {
      try {
        const response = await fetch(url, { credentials: 'include', headers: { Accept: 'application/json' } });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        note('GM HTTP 不可用，已使用站内 fetch 加载；请运行兼容性体检查看故障。');
        return await response.json();
      } catch (fetchError) {
        throw new Error(`GM: ${gmError.message}；fetch: ${fetchError.message}`);
      }
    }
  }

  function loadTopic() {
    const id = currentTopicId();
    if (!id) return Promise.reject(new Error('请先打开一篇 Linux.do 帖子'));
    if (state.topicData && state.topicRequestId === id) return Promise.resolve(state.topicData);
    if (state.topicPromise && state.topicRequestId === id) return state.topicPromise;
    const url = `https://linux.do/t/${id}.json`;
    state.topicRequestId = id;
    state.topicPromise = requestJson(url)
      .then(data => {
        if (!data || !data.post_stream || !Array.isArray(data.post_stream.posts)) {
          throw new Error('未收到符合 Discourse 结构的帖子数据');
        }
        if (currentTopicId() === id) {
          state.topicData = data;
          const first = data.post_stream.posts.find(post => Number(post.post_number) === 1);
          state.owner = first ? { id: first.user_id, username: first.username } : null;
        }
        return data;
      })
      .finally(() => { if (state.topicRequestId === id) state.topicPromise = null; });
    return state.topicPromise;
  }

  function cookedToText(html) {
    if (typeof html !== 'string') return '';
    const parsed = new DOMParser().parseFromString(html, 'text/html');
    parsed.querySelectorAll('script,style,iframe,object,svg,form').forEach(el => el.remove());
    return (parsed.body.textContent || '').replace(/[ \t]{2,}/g, ' ').trim().slice(0, 750);
  }

  function renderThread(data) {
    const list = select('[data-field="posts"]');
    list.replaceChildren();
    const posts = data.post_stream.posts
      .filter(p => p && Number.isFinite(Number(p.post_number)) && !p.deleted_at)
      .slice().sort((a, b) => Number(a.post_number) - Number(b.post_number));
    const byNumber = new Map(posts.map(p => [Number(p.post_number), { post: p, children: [] }]));
    const roots = [];
    for (const [number, node] of byNumber) {
      const proposed = Number(node.post.reply_to_post_number);
      const parentNumber = proposed && proposed < number && byNumber.has(proposed)
        ? proposed : (number !== 1 && byNumber.has(1) ? 1 : null);
      const parent = parentNumber == null ? null : byNumber.get(parentNumber);
      if (parent) {
        node.parentNumber = parentNumber;
        parent.children.push(node);
      } else roots.push(node);
    }

    const fragment = document.createDocumentFragment();
    let explicitLinks = 0;
    function walk(node, depth, visited) {
      const post = node.post;
      const number = Number(post.post_number);
      if (visited.has(number)) return;
      const next = new Set(visited);
      next.add(number);
      if (post.reply_to_post_number && Number(post.reply_to_post_number) === node.parentNumber) explicitLinks++;

      const card = document.createElement('article');
      card.className = 'nnus-post';
      card.dataset.depth = depth === 0 ? '0' : '1';
      card.style.marginLeft = `${Math.min(depth, 4) * 19}px`;
      const meta = document.createElement('div');
      meta.className = 'nnus-post-meta';
      const author = document.createElement('span');
      author.className = 'nnus-post-author';
      author.textContent = String(post.name || post.username || '匿名');
      const numberLabel = document.createElement('span');
      numberLabel.textContent = `#${number}`;
      meta.append(author, numberLabel);
      if (node.parentNumber != null) {
        const relation = document.createElement('span');
        relation.className = 'nnus-post-reference';
        relation.textContent = `↳ 回复 #${node.parentNumber}`;
        meta.append(relation);
      }
      const content = document.createElement('div');
      content.className = 'nnus-post-content';
      content.textContent = cookedToText(post.cooked) || '（此回复没有可显示的文本）';
      const foot = document.createElement('div');
      foot.className = 'nnus-post-foot';
      const replyCount = document.createElement('span');
      replyCount.textContent = node.children.length ? `${node.children.length} 条子回复` : '回复';
      const jump = document.createElement('button');
      jump.className = 'nnus-jump';
      jump.type = 'button';
      jump.dataset.action = 'jump';
      jump.dataset.postNumber = String(number);
      jump.textContent = '定位原帖 ↗';
      foot.append(replyCount, jump);
      card.append(meta, content, foot);
      fragment.appendChild(card);
      for (const child of node.children) walk(child, depth + 1, next);
    }
    for (const node of roots) walk(node, 0, new Set());
    list.appendChild(fragment);

    const total = Array.isArray(data.post_stream.stream) ? data.post_stream.stream.length : posts.length;
    const missing = Math.max(0, total - posts.length);
    field('thread-title', data.title || 'Linux.do 话题');
    field('thread-summary', `真实回复树 · 已载入 ${posts.length}/${total} 条 · ${explicitLinks} 条明确引用关系 · 缩进显示父子层级`);
    field('thread-bottom', missing > 0 ? `当前显示已加载的回复，剩余 ${missing} 条可继续加载` : '已载入全部返回的回复');
    select('[data-action="loadMore"]').hidden = missing === 0;
  }

  async function showThread() {
    const id = currentTopicId();
    if (!id) { note('请先进入任意 Linux.do 帖子，再点击「楼中楼模式」。'); return; }
    stopAutoscroll();
    state.sheetOpen = true;
    select('.nnus-sheet-bg').hidden = false;
    const list = select('[data-field="posts"]');
    list.textContent = '正在向 Linux.do 请求真实帖子及引用关系…';
    field('thread-title', '加载中…');
    field('thread-summary', 'Discourse JSON → reply_to_post_number → 嵌套回复树');
    select('[data-action="loadMore"]').hidden = true;
    actionState('thread', true);
    try {
      const data = await loadTopic();
      if (!state.sheetOpen || currentTopicId() !== id) return;
      renderThread(data);
      note(`楼中楼成功：已处理 ${data.post_stream.posts.length} 条真实回复。`);
    } catch (error) {
      field('thread-title', '加载失败');
      field('thread-summary', '无法创建回复树；可返回原布局继续正常浏览。');
      list.textContent = `原因：${error.message}`;
      note(`楼中楼加载失败：${error.message}`);
    }
  }

  async function loadMorePosts() {
    const data = state.topicData;
    const id = currentTopicId();
    if (!data || !id) return;
    const all = Array.isArray(data.post_stream.stream) ? data.post_stream.stream : [];
    const seen = new Set(data.post_stream.posts.map(p => Number(p.id)));
    const missing = all.filter(postId => !seen.has(Number(postId))).slice(0, 20);
    if (!missing.length) { select('[data-action="loadMore"]').hidden = true; return; }
    const button = select('[data-action="loadMore"]');
    button.disabled = true;
    button.textContent = '加载中…';
    try {
      const params = missing.map(postId => `post_ids%5B%5D=${encodeURIComponent(postId)}`).join('&');
      const result = await requestJson(`https://linux.do/t/${id}/posts.json?${params}`);
      const newPosts = result && result.post_stream && result.post_stream.posts;
      if (!Array.isArray(newPosts) || !newPosts.length) throw new Error('未获取到后续帖子');
      if (state.topicData !== data || currentTopicId() !== id) return;
      for (const post of newPosts) if (!seen.has(Number(post.id))) {
        seen.add(Number(post.id)); data.post_stream.posts.push(post);
      }
      renderThread(data);
      note(`成功加载 ${newPosts.length} 条更多回复。`);
    } catch (error) {
      note(`加载后续回复失败：${error.message}`);
      field('thread-bottom', `加载失败：${error.message}`);
    } finally {
      button.disabled = false;
      button.textContent = '加载更多回复';
    }
  }

  function closeThread() {
    state.sheetOpen = false;
    select('.nnus-sheet-bg').hidden = true;
    actionState('thread', false);
    note('已恢复 Linux.do 原始页面布局。');
  }

  function stopAutoscroll() {
    if (state.scrollTimer != null) clearInterval(state.scrollTimer);
    state.scrollTimer = null;
    state.autoscroll = false;
    state.scrollElapsed = 0;
    document.documentElement.classList.remove('nnus-swipe-on');
    actionState('swipe', false);
    field('swipe-name', '2. 自动上下滑动');
    field('swipe-detail', '自动滚动，底部反向 · 点击启动');
    field('swipe-icon', '▶');
  }

  function toggleAutoscroll() {
    if (state.autoscroll) {
      stopAutoscroll();
      note('已停止自动滑动，页面停留在当前位置。');
      return;
    }
    if (state.sheetOpen) closeThread();
    state.autoscroll = true;
    state.scrollDirection = 1;
    state.scrollElapsed = 0;
    state.scrollTick = 0;
    document.documentElement.classList.add('nnus-swipe-on');
    actionState('swipe', true);
    field('swipe-name', '2. 停止自动滑动');
    field('swipe-detail', '正在向下滚动，触底后自动反向');
    field('swipe-icon', '■');
    note('已启动真实页面滚动；触底/触顶会自动反向。再次点击即可停止。');
    let previous = (document.scrollingElement || document.documentElement).scrollTop;
    state.scrollTimer = setInterval(() => {
      if (!state.autoscroll) return;
      const target = document.scrollingElement || document.documentElement;
      const maximum = Math.max(0, target.scrollHeight - target.clientHeight);
      if (maximum <= 4) {
        field('swipe-detail', '当前页面不可滚动，请打开长帖子');
        return;
      }
      const old = target.scrollTop;
      target.scrollTop = Math.max(0, Math.min(maximum, old + state.scrollDirection * 16));
      const newPosition = target.scrollTop;
      if ((state.scrollDirection > 0 && (newPosition >= maximum - 2 || newPosition <= old))
          || (state.scrollDirection < 0 && (newPosition <= 2 || newPosition >= old))) {
        state.scrollDirection *= -1;
      }
      state.scrollElapsed += 1;
      if (state.scrollElapsed % 10 === 0 || previous === newPosition) {
        field('swipe-detail', `${state.scrollDirection > 0 ? '↓ 向下滑动中' : '↑ 向上滑动中'} · ${Math.round(newPosition)}px / ${Math.round(maximum)}px`);
      }
      previous = newPosition;
    }, 45);
  }

  function postNodes() {
    return Array.from(document.querySelectorAll('#post-stream .topic-post, .post-stream .topic-post, .topic-post'))
      .filter((node, index, nodes) => nodes.indexOf(node) === index);
  }

  function candidateUsername(node) {
    const author = node.querySelector('.names .username a, .names .username, .topic-meta-data .names a, a[data-user-card], .username a');
    return author ? String(author.textContent || '').trim().replace(/^@/, '') : '';
  }

  function postIsOwner(node) {
    const owner = state.owner;
    if (!owner) return true; // 无法判定的元素不能被误隐藏。
    const rawId = node.getAttribute('data-post-id') || node.dataset.postId ||
      (node.id.match(/^post_(\d+)$/) || [])[1];
    const known = state.topicData && state.topicData.post_stream.posts.find(p =>
      String(p.id) === String(rawId) || String(p.post_number) === String(rawId));
    if (known && owner.id != null) return String(known.user_id) === String(owner.id);
    const username = candidateUsername(node);
    return !username || username.toLowerCase() === String(owner.username || '').toLowerCase();
  }

  function applyOnlyOwner() {
    const nodes = postNodes();
    let shown = 0;
    let hidden = 0;
    for (const node of nodes) {
      const hide = state.onlyOwner && !postIsOwner(node);
      node.classList.toggle('nnus-other-poster', hide);
      if (hide) hidden++;
      else shown++;
    }
    if (state.onlyOwner) {
      field('op-detail', `仅看 @${state.owner.username} · 显示 ${shown} / 隐藏 ${hidden}`);
      return { shown, hidden, total: nodes.length };
    }
    return { shown, hidden, total: nodes.length };
  }

  function clearOnlyOwner() {
    state.onlyOwner = false;
    document.documentElement.classList.remove('nnus-only-op');
    document.querySelectorAll('.topic-post.nnus-other-poster').forEach(node => node.classList.remove('nnus-other-poster'));
    actionState('onlyOp', false);
    field('op-name', '3. 只看楼主');
    field('op-detail', '隐藏其他用户的回复 · 点击筛选');
  }

  async function toggleOnlyOwner() {
    if (state.onlyOwner) {
      clearOnlyOwner();
      note('已恢复所有用户的回复，原始内容完整保留。');
      return;
    }
    const id = currentTopicId();
    if (!id) { note('请先进入一篇 Linux.do 帖子，再点击「只看楼主」。'); return; }
    field('op-detail', '正在识别楼主身份…');
    try {
      await loadTopic();
      if (currentTopicId() !== id) return;
      if (!state.owner || !state.owner.username) throw new Error('未识别到首帖作者');
      state.onlyOwner = true;
      document.documentElement.classList.add('nnus-only-op');
      const result = applyOnlyOwner();
      actionState('onlyOp', true);
      field('op-name', '3. 关闭只看楼主');
      note(`只看楼主已开启：@${state.owner.username}，隐藏 ${result.hidden} 条当前已加载的非楼主回复。`);
    } catch (error) {
      clearOnlyOwner();
      note(`无法筛选楼主：${error.message}`);
    }
  }

  function setExpanded(show) {
    state.panelOpen = show;
    select('.nnus-dock').hidden = !show;
    select('.nnus-fab').hidden = show;
  }

  function addDiagnostic(name, passed, detail = '') {
    const row = document.createElement('div');
    row.className = 'nnus-diag-line';
    const left = document.createElement('span');
    left.textContent = detail ? `${name} · ${detail}` : name;
    const right = document.createElement('b');
    right.dataset.ok = passed ? 'true' : 'false';
    right.textContent = passed ? 'PASS' : 'FAIL';
    row.append(left, right);
    select('[data-field="diag"]').appendChild(row);
    return passed;
  }

  async function runDiagnostics() {
    if (state.diagRunning) return;
    state.diagRunning = true;
    const container = select('[data-field="diag"]');
    container.hidden = false;
    container.replaceChildren();
    field('message', '正在逐项调用已申请的 GM API 与浏览器能力…');
    let successes = 0;
    let count = 0;
    const check = (name, passed, detail = '') => {
      count++;
      if (addDiagnostic(name, !!passed, detail)) successes++;
    };
    try {
      check('DOM 注入', !!document.getElementById(ROOT));
      check('GM_addStyle', state.cssOk, '真实注入');
      check('JS 可选链 / 空值合并', ({ a: { b: 42 } })?.a?.b === 42 && (null ?? 42) === 42);
      check('解构 / 展开 / Map / Set', (() => {
        const [first, ...rest] = [1, 2, 3];
        return first === 1 && rest.length === 2 && new Map([['ok', 1]]).get('ok') === 1 && new Set(rest).size === 2;
      })());
      check('Promise / async-await', (await Promise.resolve(10)) === 10);
      check('URL / TextDecoder', new URL('/t/123', 'https://linux.do').pathname === '/t/123' && typeof TextDecoder === 'function');
      check('MutationObserver', await new Promise(resolve => {
        if (typeof MutationObserver !== 'function') { resolve(false); return; }
        const parent = document.createElement('div');
        const watcher = new MutationObserver(records => { watcher.disconnect(); resolve(records.some(r => r.addedNodes.length)); });
        watcher.observe(parent, { childList: true });
        parent.appendChild(document.createElement('span'));
        setTimeout(() => { watcher.disconnect(); resolve(false); }, 600);
      }));

      const key = PREFIX + 'selftest:' + Date.now();
      const value = { kind: 'object', count: 27, items: [1, true, '✓'] };
      let storageWrite = false;
      let storageRead = false;
      let storageList = false;
      let storageDelete = false;
      let storageEvent = false;
      let listener = null;
      try {
        if (typeof GM_addValueChangeListener === 'function')
          listener = GM_addValueChangeListener(key, (name, old, current) => {
            if (name === key && current && current.count === 27) storageEvent = true;
          });
        if (typeof GM_setValue === 'function') { GM_setValue(key, value); storageWrite = true; }
        const output = typeof GM_getValue === 'function' ? GM_getValue(key) : null;
        storageRead = !!(output && output.count === 27 && output.items[2] === '✓');
        storageList = typeof GM_listValues === 'function' && GM_listValues().includes(key);
        if (typeof GM_deleteValue === 'function') {
          GM_deleteValue(key);
          storageDelete = GM_getValue(key, null) === null;
        }
      } catch (error) { console.warn('[NewsNook Diagnostic] GM storage:', error); }
      finally {
        if (listener != null && typeof GM_removeValueChangeListener === 'function')
          GM_removeValueChangeListener(listener);
      }
      check('GM_setValue', storageWrite, '对象写入');
      check('GM_getValue', storageRead, '读取对象/数组');
      check('GM_listValues', storageList, '列出测试键');
      check('GM_deleteValue', storageDelete, '删除并读取');
      check('GM_addValueChangeListener', storageEvent, '接收本地变更');
      check('GM_removeValueChangeListener', typeof GM_removeValueChangeListener === 'function', '解除监听');
      check('GM_registerMenuCommand', state.menuOk, '菜单成功注册');
      check('GM_info', typeof GM_info === 'object' && GM_info.scriptHandler === 'NewsNook', '识别 NewsNook 宿主');

      let modernOk = false;
      try {
        if (typeof GM === 'object' && typeof GM.getValue === 'function' && typeof GM.setValue === 'function') {
          await GM.setValue(key, 'modern');
          modernOk = (await GM.getValue(key)) === 'modern';
          if (typeof GM.deleteValue === 'function') await GM.deleteValue(key);
        }
      } catch (error) { console.warn('[NewsNook Diagnostic] GM modern:', error); }
      check('GM.* Promise API', modernOk, 'getValue/setValue');

      let httpOk = false;
      try {
        const response = await requestWithGm('https://linux.do/', 'text');
        httpOk = Number(response.status) >= 200 && Number(response.status) < 300;
      } catch (error) { console.warn('[NewsNook Diagnostic] GM HTTP:', error); }
      check('GM_xmlhttpRequest', httpOk, '真实 HTTPS 响应');
    } catch (error) {
      check('自检流程', false, String(error.message || error));
    } finally {
      state.diagRunning = false;
      field('message', `兼容性体检完成：${successes}/${count} 项通过。未通过项需要检查引擎，不自动视为浏览器不支持所有油猴语法。`);
      const button = select('[data-action="diagnostics"]');
      button.textContent = `4. 兼容性体检：${successes}/${count} 通过 · 再测一次`;
    }
  }

  function onNavigate() {
    if (state.page === location.href) return;
    const before = state.topicId;
    state.page = location.href;
    state.topicId = currentTopicId();
    state.routeChanges += 1;
    if (state.topicId !== before) {
      stopAutoscroll();
      clearOnlyOwner();
      if (state.sheetOpen) closeThread();
      state.topicData = null;
      state.topicPromise = null;
      state.topicRequestId = null;
      state.owner = null;
    }
    note(`Discourse 站内导航检测成功（第 ${state.routeChanges} 次）· 当前路径 ${location.pathname}`);
  }

  let scanScheduled = false;
  function scheduleScan() {
    if (scanScheduled) return;
    scanScheduled = true;
    setTimeout(() => {
      scanScheduled = false;
      onNavigate();
      if (state.onlyOwner) applyOnlyOwner();
    }, 120);
  }
  const observer = new MutationObserver(records => {
    let changedSite = false;
    for (const record of records) {
      const target = record.target.nodeType === 1 ? record.target : record.target.parentElement;
      if (target && target.closest && target.closest('#' + ROOT)) continue;
      const others = Array.from(record.addedNodes).concat(Array.from(record.removedNodes))
        .filter(node => node !== host);
      if (others.length) { changedSite = true; state.eventCount++; }
    }
    if (changedSite) scheduleScan();
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });
  setInterval(onNavigate, 1000);

  host.addEventListener('click', event => {
    const button = event.target && event.target.closest && event.target.closest('button[data-action]');
    if (!button || !host.contains(button)) return;
    const action = button.dataset.action;
    if (action === 'thread') void showThread();
    else if (action === 'threadClose') closeThread();
    else if (action === 'loadMore') void loadMorePosts();
    else if (action === 'swipe') toggleAutoscroll();
    else if (action === 'onlyOp') void toggleOnlyOwner();
    else if (action === 'diagnostics') void runDiagnostics();
    else if (action === 'collapse') setExpanded(false);
    else if (action === 'expand') setExpanded(true);
    else if (action === 'jump') {
      const number = Number(button.dataset.postNumber);
      if (!number || !currentTopicId()) return;
      closeThread();
      location.assign(`https://linux.do/t/${currentTopicId()}/${number}`);
    }
  });

  if (typeof GM_registerMenuCommand === 'function') {
    try {
      GM_registerMenuCommand('NewsNook：打开交互工具', () => setExpanded(true));
      GM_registerMenuCommand('NewsNook：楼中楼模式', () => { void showThread(); });
      GM_registerMenuCommand('NewsNook：自动上下滑动（开关）', toggleAutoscroll);
      GM_registerMenuCommand('NewsNook：只看楼主（开关）', () => { void toggleOnlyOwner(); });
      state.menuOk = true;
    } catch (error) { console.warn('[NewsNook Userscript] menu:', error); }
  }

  console.info('[NewsNook Linux.do Userscript]', VERSION, {
    css: state.cssOk, storageLoads: state.loadNumber, menu: state.menuOk,
  });
})();
