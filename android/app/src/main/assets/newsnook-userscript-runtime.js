/* NewsNook browser userscript runtime. Injected into a new page before its application code. */
'use strict';
function __NN_BOOT(userScript) {
  const cfg = __NN_CONFIG;
  const port = window.__NewsNookUserScriptPort;
  if (!port) return;
  const grants = new Set(cfg.grants || []);
  const isMainFrame = window === window.top;
  const hasNativeGrants = Array.from(grants).some(grant => grant !== 'none' && grant !== 'unsafeWindow');
  const pendingHttp = new Map();
  const pendingDownloads = new Map();
  const menuCallbacks = new Map();
  const values = Object.assign(Object.create(null), cfg.values || {});
  const changeListeners = new Map();
  let seq = 0;
  let storageEpoch = cfg.storageEpoch || 0;
  const documentId = String(performance.timeOrigin || performance.timing.navigationStart);
  const nextId = () => cfg.id + ':' + (++seq) + ':' + Date.now().toString(36);
  const send = (message) => port.postMessage(JSON.stringify({ ...message, id: cfg.id, token: cfg.secret,
    documentId, documentUrl: location.href, storageEpoch }));

  function wildcard(pattern, text) {
    let regex = '^';
    for (const ch of pattern) regex += ch === '*' ? '.*' : /[.+?^${}()|[\]\\]/.test(ch) ? '\\' + ch : ch;
    try { return new RegExp(regex + '$', 'i').test(text) } catch (error) { void error; return false }
  }
  function matchPattern(pattern, href) {
    const match = /^(\*|https?|file):\/\/([^/]+)(\/.*)$/.exec(pattern);
    if (!match) return false;
    const u = new URL(href);
    if (match[1] === '*' ? !['https:', 'http:'].includes(u.protocol) : match[1] !== u.protocol.slice(0, -1)) return false;
    const host = match[2];
    if (host !== '*' && !(host.startsWith('*.') ? u.hostname === host.slice(2) || u.hostname.endsWith(host.slice(1)) : u.hostname === host)) return false;
    return wildcard(match[3], u.pathname + u.search + u.hash);
  }
  function includePattern(pattern, href) {
    if (pattern.length > 2 && pattern[0] === '/' && pattern[pattern.length - 1] === '/') {
      try { return new RegExp(pattern.slice(1, -1)).test(href) } catch (error) { void error; return false }
    }
    return wildcard(pattern, href);
  }
  function matches() {
    const href = location.href;
    if (!/^https?:\/\//.test(href)) return false;
    if (!(cfg.matches || []).some(x => matchPattern(x, href)) && !(cfg.includes || []).some(x => includePattern(x, href))) return false;
    if ((cfg.excludeMatches || []).some(x => matchPattern(x, href))) return false;
    if ((cfg.excludes || []).some(x => includePattern(x, href))) return false;
    return true;
  }
  // Page-world scripts without native GM capabilities may run in matching frames.
  // Native bridge operations remain main-frame-only; privileged scripts are not injected into frames.
  if (!matches() || (!isMainFrame && (cfg.noFrames || hasNativeGrants))) return;

  function GM_addStyle(css) {
    const style = document.createElement('style');
    style.type = 'text/css';
    style.textContent = String(css);
    const append = () => (document.head || document.documentElement).appendChild(style);
    if (document.documentElement) append();
    else document.addEventListener('DOMContentLoaded', append, { once: true });
    return style;
  }
  function GM_getValue(name, fallback) {
    return Object.prototype.hasOwnProperty.call(values, name) ? values[name] : fallback;
  }
  function GM_setValue(name, value) {
    if (typeof name !== 'string' || name.length > 256) throw new Error('Invalid userscript storage key');
    const encoded = JSON.stringify(value);
    if (typeof encoded !== 'string' || encoded.length > 100000) throw new Error('Unsupported userscript storage value');
    const old = values[name];
    values[name] = value;
    send({ op: 'set', key: name, value: encoded });
    for (const l of changeListeners.values()) if (l.key === name) l.callback(name, old, value, false);
  }
  function GM_deleteValue(name) {
    const old = values[name];
    delete values[name];
    send({ op: 'delete', key: String(name) });
    for (const l of changeListeners.values()) if (l.key === name) l.callback(name, old, undefined, false);
  }
  function GM_listValues() { return Object.keys(values); }
  function GM_addValueChangeListener(key, callback) {
    const id = nextId(); changeListeners.set(id, {key, callback}); return id;
  }
  function GM_removeValueChangeListener(id) { changeListeners.delete(id); }
  function GM_registerMenuCommand(title, fn) {
    if (typeof fn !== 'function') throw new Error('Menu command callback must be a function');
    const key = nextId();
    menuCallbacks.set(key, fn);
    send({ op: 'menu', key, title: String(title) });
    return key;
  }
  function base64ToBytes(encoded) {
    const decoded = atob(encoded || '');
    const bytes = new Uint8Array(decoded.length);
    for (let i = 0; i < decoded.length; i++) bytes[i] = decoded.charCodeAt(i);
    return bytes;
  }
  function arrayBufferToBase64(buffer) {
    const bytes = new Uint8Array(buffer);
    let chars = '';
    for (let i = 0; i < bytes.length; i++) chars += String.fromCharCode(bytes[i]);
    return btoa(chars);
  }
  function GM_xmlhttpRequest(options) {
    if (!options || typeof options.url !== 'string') throw new Error('GM_xmlhttpRequest requires URL');
    const req = nextId();
    pendingHttp.set(req, options);
    const headers = options.headers && typeof options.headers === 'object' ? options.headers : {};
    send({ op: 'http', req, method: options.method || 'GET', url: new URL(options.url, location.href).href,
      headers, data: typeof options.data === 'string' ? options.data : '' });
    return { abort() {
      if (!pendingHttp.has(req)) return;
      pendingHttp.delete(req);
      send({ op: 'abort', req });
      if (typeof options.onabort === 'function') options.onabort();
    } };
  }
  function toBuffer(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(reader.error || new Error('File read failed'));
      reader.readAsArrayBuffer(blob);
    });
  }
  function GM_download(options, nameArg) {
    const config = typeof options === 'string' ? { url: options, name: nameArg } : options;
    if (!config || !config.url) throw new Error('GM_download requires URL or Blob');
    const req = nextId();
    const state = { options: config, ack: null, end: null };
    pendingDownloads.set(req, state);
    const nextAck = () => new Promise((resolve, reject) => {
      state.ack = resolve;
      state.end = reject;
    });
    const task = async () => {
      try {
        if (config.url instanceof Blob) {
          let ack = nextAck();
          send({ op: 'downloadStart', req, name: config.name || 'download.bin' });
          await ack;
          for (let position = 0; position < config.url.size; position += 48 * 1024) {
            const chunk = config.url.slice(position, position + 48 * 1024);
            const binary = await toBuffer(chunk);
            ack = nextAck();
            send({ op: 'downloadChunk', req, data: arrayBufferToBase64(binary) });
            await ack;
          }
          send({ op: 'downloadFinish', req });
        } else {
          send({ op: 'downloadUrl', req, url: String(config.url), name: config.name || 'download' });
        }
      } catch (error) {
        pendingDownloads.delete(req);
        if (typeof config.onerror === 'function') config.onerror({ error: String(error) });
      }
    };
    task();
    return { abort: () => {
      pendingDownloads.delete(req);
      if (typeof config.onabort === 'function') config.onabort();
    } };
  }
  port.addEventListener('message', event => {
    let message;
    try { message = JSON.parse(event.data) } catch (error) { void error; return }
    if (message.event === 'storageReset') {
      if (message.id !== cfg.id || !Number.isSafeInteger(message.storageEpoch) || message.storageEpoch <= storageEpoch) return;
      if (!message.values || typeof message.values !== 'object' || Array.isArray(message.values)) return;
      storageEpoch = message.storageEpoch;
      for (const key of Object.keys(values)) delete values[key];
      Object.assign(values, message.values);
      return;
    }
    if (message.event === 'menuInvoke') {
      menuCallbacks.get(message.key)?.();
      return;
    }
    if (message.event === 'httpLoad' || message.event === 'httpError' || message.event === 'httpProgress') {
      const opts = pendingHttp.get(message.req);
      if (!opts) return;
      if (message.event === 'httpProgress') {
        if (typeof opts.onprogress === 'function') opts.onprogress({ lengthComputable: true, loaded: message.loaded, total: message.total });
      } else {
        pendingHttp.delete(message.req);
        if (message.event === 'httpError') {
          if (typeof opts.onerror === 'function') opts.onerror({ error: message.message });
        } else {
          const bytes = base64ToBytes(message.data);
          let response;
          const type = opts.responseType || 'text';
          if (type === 'blob') response = new Blob([bytes], { type: message.contentType || 'application/octet-stream' });
          else if (type === 'arraybuffer') response = bytes.buffer;
          else {
            const text = new TextDecoder().decode(bytes);
            response = type === 'json' ? (() => { try { return JSON.parse(text) } catch (error) { void error; return null } })() : text;
          }
          const result = { status: message.status, statusText: '', finalUrl: message.finalUrl,
            response, responseText: typeof response === 'string' ? response : '', readyState: 4 };
          if (typeof opts.onload === 'function') opts.onload(result);
        }
      }
      return;
    }
    const dl = pendingDownloads.get(message.req);
    if (!dl) return;
    if (message.event === 'downloadAck') {
      const cb = dl.ack; dl.ack = null; cb?.();
    } else if (message.event === 'downloadDone') {
      pendingDownloads.delete(message.req);
      if (typeof dl.options.onload === 'function') dl.options.onload();
    } else if (message.event === 'downloadError') {
      pendingDownloads.delete(message.req);
      dl.end?.(new Error(message.message));
      if (typeof dl.options.onerror === 'function') dl.options.onerror({ error: message.message });
    }
  });

  const granted = (legacy, modern) => grants.has(legacy) || grants.has(modern);
  // Namespaced GM methods are NOT ambient authority. Each one requires its own @grant.
  const modern = {};
  if (granted('GM_getValue', 'GM.getValue')) modern.getValue = (key, fallback) => Promise.resolve(GM_getValue(key, fallback));
  if (granted('GM_setValue', 'GM.setValue')) modern.setValue = (key, value) => { GM_setValue(key, value); return Promise.resolve(); };
  if (granted('GM_deleteValue', 'GM.deleteValue')) modern.deleteValue = key => { GM_deleteValue(key); return Promise.resolve(); };
  if (granted('GM_listValues', 'GM.listValues')) modern.listValues = () => Promise.resolve(GM_listValues());
  if (granted('GM_addValueChangeListener', 'GM.addValueChangeListener')) modern.addValueChangeListener = GM_addValueChangeListener;
  if (granted('GM_removeValueChangeListener', 'GM.removeValueChangeListener')) modern.removeValueChangeListener = GM_removeValueChangeListener;
  if (granted('GM_xmlhttpRequest', 'GM.xmlHttpRequest')) modern.xmlHttpRequest = options => new Promise((resolve, reject) => {
    const original = options || {};
    GM_xmlhttpRequest({ ...original,
      onload: response => { original.onload?.(response); resolve(response); },
      onerror: error => { original.onerror?.(error); reject(error); },
      ontimeout: error => { original.ontimeout?.(error); reject(error); },
    });
  });
  if (granted('GM_download', 'GM.download')) modern.download = opts => new Promise((resolve, reject) => {
    const original = typeof opts === 'string' ? {url:opts} : opts;
    GM_download({ ...original,
      onload: () => { original.onload?.(); resolve(); },
      onerror: error => { original.onerror?.(error); reject(error); },
    });
  });
  if (granted('GM_addStyle', 'GM.addStyle')) modern.addStyle = GM_addStyle;
  if (granted('GM_registerMenuCommand', 'GM.registerMenuCommand')) modern.registerMenuCommand = GM_registerMenuCommand;
  const GM = Object.freeze(modern);
  const GM_info = Object.freeze({ script: { name: cfg.name, version: cfg.version },
    scriptHandler: 'NewsNook', version: '1.0.0', platform: { browserName: 'Android WebView' } });
  let started = false;
  function execute() {
    if (started) return;
    started = true;
    // Count the execution boundary, including a user script whose own body throws.
    // A detached status port must not stop an otherwise runnable script.
    try { send({ op: 'started' }); } catch (error) { void error; }
    try {
      userScript(
        granted('GM_addStyle', 'GM.addStyle') ? GM_addStyle : undefined,
        granted('GM_getValue', 'GM.getValue') ? GM_getValue : undefined,
        granted('GM_setValue', 'GM.setValue') ? GM_setValue : undefined,
        granted('GM_registerMenuCommand', 'GM.registerMenuCommand') ? GM_registerMenuCommand : undefined,
        granted('GM_xmlhttpRequest', 'GM.xmlHttpRequest') ? GM_xmlhttpRequest : undefined,
        granted('GM_download', 'GM.download') ? GM_download : undefined,
        grants.has('unsafeWindow') && cfg.executionWorld === 'page' ? window : undefined,
        GM,
        granted('GM_deleteValue', 'GM.deleteValue') ? GM_deleteValue : undefined,
        granted('GM_listValues', 'GM.listValues') ? GM_listValues : undefined,
        granted('GM_addValueChangeListener', 'GM.addValueChangeListener') ? GM_addValueChangeListener : undefined,
        granted('GM_removeValueChangeListener', 'GM.removeValueChangeListener') ? GM_removeValueChangeListener : undefined,
        GM_info,
      );
    } catch (error) { console.error('NewsNook userscript', cfg.name, error); }
  }
  if (cfg.runAt === 'document-start') execute();
  else if (cfg.runAt === 'document-idle') {
    if (document.readyState === 'complete') setTimeout(execute, 0);
    else {
      window.addEventListener('load', execute, { once: true });
      // Some SPAs never finish loading one of their resources.
      setTimeout(execute, 5000);
    }
  } else if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', execute, { once: true });
  } else execute();
}
