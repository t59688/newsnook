// ==UserScript==
// @name         NewsNook | Linux.do 油猴引擎自检
// @namespace    https://news.aizeek.com/userscripts
// @version      1.0.0
// @description  明显的视觉标识 + DOM/CSS/持久化/网络/Discourse 单页导航自检；所有操作仅作用于 linux.do。
// @match        https://linux.do/*
// @run-at       document-end
// @grant        GM_addStyle
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_listValues
// @grant        GM_registerMenuCommand
// @grant        GM_xmlhttpRequest
// @connect      linux.do
// ==/UserScript==

(function () {
  'use strict';

  // 防止浏览器管理器误配置匹配规则时执行到其他站点或 iframe。
  if (location.protocol !== 'https:' || location.hostname !== 'linux.do' || window !== window.top) return;
  if (document.getElementById('nnus-probe-host')) return;

  const KEY = 'linuxdo-demo:';
  const state = {
    enabled: true,
    loads: 0,
    writes: 0,
    cssOk: false,
    storageOk: false,
    menuOk: false,
    lastUrl: location.href,
    routeChanges: 0,
    domEvents: 0,
    probePending: false,
  };

  const css = `
    #nnus-probe-host, #nnus-probe-host * { box-sizing: border-box !important; }
    #nnus-probe-host { position: fixed !important; bottom: calc(16px + env(safe-area-inset-bottom, 0px)) !important;
      right: 14px !important; width: min(354px, calc(100vw - 28px)) !important;
      z-index: 2147483600 !important; pointer-events: none !important;
      font: 13px/1.45 system-ui, -apple-system, 'Segoe UI', sans-serif !important; color: #f7f9ff !important; }
    #nnus-probe-host button { appearance: none !important; -webkit-appearance: none !important;
      border: 0 !important; cursor: pointer !important; font: inherit !important; }
    #nnus-probe-host [hidden] { display: none !important; }
    #nnus-probe-host .nnus-panel { pointer-events: auto !important; max-height: min(78vh, 530px) !important; overflow-y: auto !important;
      padding: 17px !important; border-radius: 19px !important;
      background: linear-gradient(155deg, #20234a, #10152e 67%) !important;
      border: 1px solid rgba(142, 178, 255, .45) !important;
      box-shadow: 0 22px 70px rgba(0, 0, 0, .56), 0 0 0 1px rgba(53, 247, 186, .12) inset !important; }
    #nnus-probe-host .nnus-top { display: flex !important; gap: 10px !important; align-items: center !important; }
    #nnus-probe-host .nnus-emblem { flex: none !important; display: grid !important; place-items: center !important;
      width: 43px !important; height: 43px !important; border-radius: 13px !important;
      font-size: 22px !important; font-weight: 900 !important; color: #0c182c !important;
      background: linear-gradient(135deg, #35f7ba, #61cfff) !important; box-shadow: 0 0 20px rgba(53, 247, 186, .34) !important; }
    #nnus-probe-host .nnus-title { min-width: 0 !important; flex: 1 !important; }
    #nnus-probe-host .nnus-title strong { display: block !important; font-size: 16px !important; color: #fff !important;
      font-weight: 800 !important; letter-spacing: -.025em !important; }
    #nnus-probe-host .nnus-title small { display: block !important; font-size: 10px !important;
      color: #a9bce4 !important; letter-spacing: .1em !important; }
    #nnus-probe-host .nnus-compact { flex: none !important; border-radius: 9px !important; background: rgba(255,255,255,.1) !important;
      width: 29px !important; height: 29px !important; color: #f7f9ff !important; }
    #nnus-probe-host .nnus-live { margin: 13px 0 11px !important; padding: 10px 12px !important; border-radius: 10px !important;
      background: rgba(42, 231, 168, .12) !important; border: 1px solid rgba(53, 247, 186, .37) !important;
      color: #70ffcc !important; font-weight: 700 !important; display: flex !important; align-items: center !important; gap: 8px !important; }
    #nnus-probe-host .nnus-dot { width: 8px !important; height: 8px !important; border-radius: 50% !important; flex: none !important;
      background: #35f7ba !important; box-shadow: 0 0 0 4px rgba(53,247,186,.14), 0 0 13px #35f7ba !important; }
    #nnus-probe-host .nnus-checks { display: grid !important; grid-template-columns: 1fr 1fr !important; gap: 7px !important; }
    #nnus-probe-host .nnus-check { border: 1px solid rgba(154,175,226,.17) !important; border-radius: 9px !important;
      padding: 7px 9px !important; background: rgba(255,255,255,.04) !important; min-width: 0 !important; }
    #nnus-probe-host .nnus-check span { display: block !important; color: #9aaacc !important; font-size: 10px !important; }
    #nnus-probe-host .nnus-check b { display: block !important; margin-top: 2px !important; font-size: 12px !important;
      font-weight: 700 !important; color: #e6ecfc !important; overflow: hidden !important; text-overflow: ellipsis !important;
      white-space: nowrap !important; }
    #nnus-probe-host .nnus-check b[data-result="pass"] { color: #50f8b6 !important; }
    #nnus-probe-host .nnus-check b[data-result="fail"] { color: #ff8c9f !important; }
    #nnus-probe-host .nnus-check b[data-result="pending"] { color: #ffcf80 !important; }
    #nnus-probe-host .nnus-info { display: flex !important; justify-content: space-between !important; gap: 8px !important;
      margin: 12px 0 !important; color: #bac6e6 !important; font-size: 11px !important; }
    #nnus-probe-host .nnus-info strong { color: #fff !important; font-variant-numeric: tabular-nums !important; }
    #nnus-probe-host .nnus-route { border-top: 1px solid rgba(146,172,225,.19) !important; padding: 9px 0 11px !important;
      color: #adbcdf !important; font-size: 11px !important; word-break: break-all !important; }
    #nnus-probe-host .nnus-actions { display: grid !important; grid-template-columns: 1fr 1fr !important; gap: 7px !important; }
    #nnus-probe-host .nnus-action { padding: 9px 6px !important; border-radius: 9px !important;
      background: rgba(108,146,229,.2) !important; color: #edf3ff !important; border: 1px solid rgba(148,177,255,.2) !important;
      font-size: 12px !important; font-weight: 650 !important; min-height: 38px !important; }
    #nnus-probe-host .nnus-action-primary { background: #35f7ba !important; color: #112130 !important; }
    #nnus-probe-host .nnus-action:active { transform: scale(.98) !important; }
    #nnus-probe-host .nnus-activity { margin-top: 10px !important; min-height: 26px !important; font-size: 11px !important;
      line-height: 1.5 !important; color: #aabbdf !important; }
    #nnus-probe-host .nnus-launcher { pointer-events: auto !important; display: flex !important; align-items: center !important;
      gap: 8px !important; margin-left: auto !important; border-radius: 99px !important; padding: 12px 18px !important;
      box-shadow: 0 12px 34px rgba(0, 0, 0, .36) !important; background: #35f7ba !important;
      color: #082323 !important; font-weight: 800 !important; }
    #nnus-edge { position: fixed !important; top: 0 !important; left: 0 !important; right: 0 !important;
      height: 7px !important; z-index: 2147483599 !important;
      background: linear-gradient(90deg, #35f7ba, #50a7ff, #f384ff, #35f7ba) !important;
      background-size: 200% auto !important; animation: nnus-shine 3s linear infinite !important;
      pointer-events: none !important; }
    #nnus-signal { position: fixed !important; top: 10px !important; left: 50% !important; transform: translateX(-50%) !important;
      z-index: 2147483599 !important; pointer-events: none !important; background: #16224c !important;
      border: 1px solid #35f7ba !important; box-shadow: 0 8px 22px rgba(0,0,0,.2) !important;
      border-radius: 0 0 12px 12px !important; color: #aeffeb !important; padding: 6px 13px !important;
      font: 800 10px/1.3 system-ui, sans-serif !important; letter-spacing: .08em !important; white-space: nowrap !important; }
    html.nnus-highlight-active tr.topic-list-item, html.nnus-highlight-active .topic-list-item,
    html.nnus-highlight-active .topic-list tbody tr { box-shadow: inset 4px 0 0 #35f7ba !important;
      background-image: linear-gradient(90deg, rgba(53,247,186,.16), rgba(84,113,239,.065) 35%, transparent 85%) !important; }
    html.nnus-highlight-active .topic-list-item a.title, html.nnus-highlight-active .topic-list .main-link a.title,
    html.nnus-highlight-active .topic-card .topic-title a { text-decoration: underline !important;
      text-decoration-color: #35dcb5 !important; text-decoration-thickness: 2px !important; text-underline-offset: 4px !important; }
    html.nnus-highlight-active article[data-post-id] .cooked, html.nnus-highlight-active .topic-post .cooked {
      border-left: 3px solid rgba(53,247,186,.6) !important; }
    .nnus-dom-marker { position: fixed !important; top: 55px !important; left: 14px !important;
      z-index: 2147483598 !important; border-radius: 10px !important; background: #35f7ba !important;
      color: #071e27 !important; padding: 9px 12px !important;
      font: 800 12px system-ui, sans-serif !important; pointer-events: none !important;
      box-shadow: 0 8px 24px rgba(0,0,0,.18) !important; }
    @keyframes nnus-shine { to { background-position: 200% center; } }
    @media (max-height: 620px) { #nnus-probe-host .nnus-panel { max-height: 62vh !important; } }
    @media (prefers-reduced-motion: reduce) { #nnus-edge { animation: none !important; } }
  `;

  // 单独验证 GM_addStyle；即使失败也采用原生 style 兜底，以便显示错误面板。
  try {
    if (typeof GM_addStyle === 'function') {
      const style = GM_addStyle(css);
      state.cssOk = !!style;
    }
  } catch (error) {
    console.error('[NewsNook Userscript Test] GM_addStyle:', error);
  }
  if (!state.cssOk) {
    const fallback = document.createElement('style');
    fallback.textContent = css;
    (document.head || document.documentElement).appendChild(fallback);
  }

  const host = document.createElement('div');
  host.id = 'nnus-probe-host';
  host.setAttribute('data-newsnook-userscript-test', '1');
  host.innerHTML = `
    <section class="nnus-panel" role="region" aria-label="NewsNook 油猴引擎测试">
      <div class="nnus-top">
        <span class="nnus-emblem" aria-hidden="true">N</span>
        <div class="nnus-title"><strong>NewsNook 油猴自检</strong><small>LINUX.DO / USER SCRIPT</small></div>
        <button type="button" class="nnus-compact" data-action="collapse" aria-label="折叠面板">−</button>
      </div>
      <div class="nnus-live"><span class="nnus-dot" aria-hidden="true"></span>脚本已在 Linux.do 中执行</div>
      <div class="nnus-checks">
        <div class="nnus-check"><span>DOM 注入</span><b data-check="dom" data-result="pass">PASS</b></div>
        <div class="nnus-check"><span>GM_addStyle</span><b data-check="css">待检验</b></div>
        <div class="nnus-check"><span>GM 存储</span><b data-check="storage">待检验</b></div>
        <div class="nnus-check"><span>GM HTTP 请求</span><b data-check="http" data-result="pending">点击测试</b></div>
        <div class="nnus-check"><span>MutationObserver</span><b data-check="observer" data-result="pending">点击测试</b></div>
        <div class="nnus-check"><span>Discourse SPA 导航</span><b data-check="route" data-result="pending">切换帖子验证</b></div>
      </div>
      <div class="nnus-info">
        <span>脚本加载 <strong data-field="loads">—</strong> 次</span>
        <span>检测到 <strong data-field="topics">0</strong> 条帖子</span>
        <span>菜单 <strong data-field="menu">—</strong></span>
      </div>
      <div class="nnus-route">当前路径：<span data-field="path">/</span></div>
      <div class="nnus-actions">
        <button type="button" class="nnus-action nnus-action-primary" data-action="theme">切换页面高亮</button>
        <button type="button" class="nnus-action" data-action="storage">写入 GM 存储</button>
        <button type="button" class="nnus-action" data-action="dom">测试动态 DOM</button>
        <button type="button" class="nnus-action" data-action="http">测试 GM 请求</button>
      </div>
      <div class="nnus-activity" role="status" aria-live="polite" data-field="message">点击按钮进行验证。重新打开页面可检查持久化。</div>
    </section>
    <button class="nnus-launcher" type="button" data-action="expand" hidden>NewsNook · 油猴运行中</button>
  `;

  const edge = document.createElement('div'); edge.id = 'nnus-edge'; edge.setAttribute('aria-hidden', 'true');
  const signal = document.createElement('div'); signal.id = 'nnus-signal'; signal.textContent = 'NEWSNOOK USERSCRIPT · ACTIVE';
  signal.setAttribute('aria-hidden', 'true');
  document.body.append(host, edge, signal);

  const get = selector => host.querySelector(selector);
  const field = (name, text) => {
    const node = get(`[data-field="${name}"]`);
    if (node && node.textContent !== String(text)) node.textContent = String(text);
  };
  const status = (name, label, result) => {
    const node = get(`[data-check="${name}"]`);
    if (!node) return;
    if (node.textContent !== label) node.textContent = label;
    if (node.dataset.result !== result) node.dataset.result = result;
  };
  const message = text => { field('message', text); };
  const safeGet = (key, fallback) => (typeof GM_getValue === 'function' ? GM_getValue(KEY + key, fallback) : fallback);
  const safeSet = (key, value) => {
    if (typeof GM_setValue !== 'function') throw new Error('GM_setValue 不可用');
    GM_setValue(KEY + key, value);
    if (typeof GM_getValue !== 'function' || GM_getValue(KEY + key) !== value) throw new Error('写入后读取不一致');
  };

  status('css', state.cssOk ? 'PASS · 样式已注入' : 'FAIL · 使用兜底样式', state.cssOk ? 'pass' : 'fail');
  try {
    const previous = Number(safeGet('loads', 0)) || 0;
    state.loads = previous + 1;
    safeSet('loads', state.loads);
    if (typeof GM_listValues !== 'function' || !GM_listValues().includes(KEY + 'loads')) {
      throw new Error('GM_listValues 未返回脚本存储键');
    }
    state.enabled = safeGet('enabled', true) !== false;
    state.writes = Number(safeGet('writes', 0)) || 0;
    state.storageOk = true;
    status('storage', 'PASS · 读写/列举', 'pass');
  } catch (error) {
    status('storage', 'FAIL · 存储异常', 'fail');
    message(String(error && error.message || error));
  }
  document.documentElement.classList.toggle('nnus-highlight-active', state.enabled);
  field('loads', state.storageOk ? state.loads : '不可用');

  const panel = get('.nnus-panel');
  const launcher = get('.nnus-launcher');
  function setExpanded(expanded) {
    panel.hidden = !expanded;
    launcher.hidden = expanded;
  }
  function toggleTheme() {
    state.enabled = !state.enabled;
    document.documentElement.classList.toggle('nnus-highlight-active', state.enabled);
    try {
      safeSet('enabled', state.enabled);
      status('storage', 'PASS · 设置已保存', 'pass');
      message(`帖子高亮：${state.enabled ? '已开启' : '已关闭'}。刷新页面可检查设置是否保留。`);
    } catch (error) { status('storage', 'FAIL · 写入失败', 'fail'); message(String(error)); }
  }

  function checkStorage() {
    try {
      state.writes += 1;
      safeSet('writes', state.writes);
      state.storageOk = true;
      status('storage', `PASS · 写入 #${state.writes}`, 'pass');
      message(`GM_setValue / GM_getValue 均通过；累计手动写入 ${state.writes} 次。`);
    } catch (error) { status('storage', 'FAIL · 写入失败', 'fail'); message(String(error)); }
  }

  function checkHttp() {
    if (typeof GM_xmlhttpRequest !== 'function') {
      status('http', 'FAIL · API 不可用', 'fail');
      message('当前版本未提供 GM_xmlhttpRequest。');
      return;
    }
    status('http', '请求中…', 'pending');
    message('正在通过 GM_xmlhttpRequest 请求 https://linux.do/');
    let done = false;
    const complete = (ok, label, details) => {
      if (done) return;
      done = true;
      clearTimeout(watchdog);
      status('http', label, ok ? 'pass' : 'fail');
      message(details);
    };
    let request;
    const watchdog = setTimeout(() => {
      complete(false, 'FAIL · 超时', 'GM 请求超过 12 秒。请检查网络与脚本 @connect 权限。');
      if (request && typeof request.abort === 'function') request.abort();
    }, 12000);
    try {
      request = GM_xmlhttpRequest({
        method: 'GET', url: 'https://linux.do/',
        onload(response) {
          const http = Number(response.status || 0);
          complete(http >= 200 && http < 300, `HTTP ${http || '?'}`,
            `GM_xmlhttpRequest 已收到响应（HTTP ${http || '?'}）。`);
        },
        onerror(error) { complete(false, 'FAIL · 请求出错', `请求失败：${String(error && error.error || 'unknown')}`); },
        onabort() { if (!done) complete(false, 'FAIL · 已中止', '请求已中止。'); },
      });
    } catch (error) { complete(false, 'FAIL · 调用异常', String(error)); }
  }

  const countTopics = () => {
    const nodes = document.querySelectorAll('tr.topic-list-item, .topic-list-body tr, .topic-card, .topic-list-item');
    return new Set(Array.from(nodes)).size;
  };
  function refreshPageInfo() {
    field('topics', countTopics());
    field('path', location.pathname + location.search + location.hash);
    if (state.lastUrl !== location.href) {
      state.lastUrl = location.href;
      state.routeChanges += 1;
      status('route', `PASS · ${state.routeChanges} 次切换`, 'pass');
      message('检测到 Discourse 站内导航；脚本面板未丢失。');
    }
  }

  let framePending = false;
  function scheduleRefresh() {
    if (framePending) return;
    framePending = true;
    requestAnimationFrame(() => { framePending = false; refreshPageInfo(); });
  }
  const observer = new MutationObserver(records => {
    let changedSite = false;
    for (const record of records) {
      // 自己的面板状态更新不应再次触发刷新，防止观察器自激循环。
      const element = record.target.nodeType === 1 ? record.target : record.target.parentElement;
      if (element && element.closest && element.closest('#nnus-probe-host')) continue;
      changedSite = true;
      if (state.probePending && Array.from(record.addedNodes).some(node => node.nodeType === 1 && node.classList.contains('nnus-dom-marker'))) {
        state.probePending = false;
        status('observer', 'PASS · 已观察新增节点', 'pass');
        message('MutationObserver 捕获到页面中新插入的测试节点。');
      }
    }
    if (changedSite) { state.domEvents++; scheduleRefresh(); }
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });
  setInterval(refreshPageInfo, 1300); // Discourse 的 History API 导航可能无需整页刷新。
  refreshPageInfo();

  function checkDom() {
    state.probePending = true;
    const node = document.createElement('div');
    node.className = 'nnus-dom-marker';
    node.textContent = '动态 DOM 已插入';
    status('observer', '检测中…', 'pending');
    document.body.appendChild(node);
    setTimeout(() => { node.remove(); if (state.probePending) { state.probePending = false; status('observer', 'FAIL · 未收到事件', 'fail'); } }, 2200);
  }

  host.addEventListener('click', event => {
    const button = event.target.closest('button[data-action]');
    if (!button) return;
    if (button.dataset.action === 'theme') toggleTheme();
    if (button.dataset.action === 'storage') checkStorage();
    if (button.dataset.action === 'dom') checkDom();
    if (button.dataset.action === 'http') checkHttp();
    if (button.dataset.action === 'collapse') setExpanded(false);
    if (button.dataset.action === 'expand') setExpanded(true);
  });

  if (typeof GM_registerMenuCommand === 'function') {
    try {
      GM_registerMenuCommand('NewsNook：打开测试面板', () => setExpanded(true));
      GM_registerMenuCommand('NewsNook：切换 Linux.do 高亮', toggleTheme);
      state.menuOk = true;
    } catch (error) { console.warn('[NewsNook Userscript Test] menu:', error); }
  }
  field('menu', state.menuOk ? '已注册' : '不支持');
  console.info('[NewsNook Userscript Test] injected', { loads: state.loads, css: state.cssOk, storage: state.storageOk, menu: state.menuOk });
})();
