/* Invoked only by the browser's explicit image scan. No click handlers or bridge. */
(function () {
  'use strict';
  var key = __NEWSNOOK_IMAGE_KEY__;
  var scanId = __NEWSNOOK_IMAGE_SCAN__;
  var limit = 240, elementLimit = 3600, frameLimit = 12, deadline = Date.now() + 180;
  var previous = window[key];
  if (previous && previous.cancel) previous.cancel();
  var records = Object.create(null), seen = Object.create(null), items = [], frames = 0, visited = 0;
  var inaccessibleFrames = 0, truncated = false, alive = true, transfers = Object.create(null);
  var documents = [];

  function text(value, max) { return typeof value === 'string' ? value.slice(0, max) : ''; }
  function dimensions(node) {
    var rect;
    try { rect = node.getBoundingClientRect(); } catch (ignored) { void ignored; rect = {}; }
    return {
      width: Math.max(0, Math.round(Number(node.naturalWidth || node.getAttribute('width') || rect.width) || 0)),
      height: Math.max(0, Math.round(Number(node.naturalHeight || node.getAttribute('height') || rect.height) || 0))
    };
  }
  function isContent(node, size, kind) {
    var hint = text((node.id || '') + ' ' + (typeof node.className === 'string' ? node.className : ''), 500);
    if (node.getAttribute('role') === 'presentation' || node.getAttribute('aria-hidden') === 'true'
      || /(?:^|[\s_-])(avatar|emoji|icon|logo|badge|sprite|spinner)(?:$|[\s_-])/i.test(hint)) return false;
    if ((size.width > 0 && size.width < 72) || (size.height > 0 && size.height < 48)) return false;
    var article = node.closest && node.closest('article,main,figure,[role="main"],[itemprop="articleBody"]');
    if (article) return kind !== 'background' || size.width >= 160 && size.height >= 90;
    return size.width >= 160 && size.height >= 100 || kind !== 'background' && !size.width && !size.height;
  }
  function add(raw, node, kind, owner) {
    if (!alive || !raw || typeof raw !== 'string') return;
    raw = raw.trim();
    if (!raw || raw[0] === '#' || /^(?:javascript|file|content|about):/i.test(raw)) return;
    var source, transport, pageUrl;
    try {
      pageUrl = /^https?:/.test(owner.location.href) ? owner.location.href : owner.document.baseURI;
      source = new owner.URL(raw, node.baseURI || owner.document.baseURI).href;
    } catch (ignored) { void ignored; return; }
    if (/^https?:\/\//i.test(source)) { transport = 'http'; if (source.length > 8192) return; }
    else if (/^blob:/i.test(source) || /^data:image\//i.test(source)) transport = 'page';
    else return;
    // Keep data URLs in their owning page, including very large ones. The export
    // function enforces a byte budget before any data crosses the native boundary.
    var duplicate = seen[source];
    var size = dimensions(node), content = isContent(node, size, kind);
    if (duplicate) {
      if (duplicate.kinds.indexOf(kind) < 0) duplicate.kinds.push(kind);
      duplicate.content = duplicate.content || content;
      duplicate.width = Math.max(duplicate.width, size.width);
      duplicate.height = Math.max(duplicate.height, size.height);
      if (!duplicate.alt) duplicate.alt = text(node.alt || node.getAttribute('aria-label') || '', 300);
      return;
    }
    if (items.length >= limit) { truncated = true; return; }
    var id = scanId + '-' + items.length;
    var item = {
      id: id, sourceUrl: source.indexOf('data:') === 0 ? 'data:' : source, pageUrl: text(pageUrl, 8192),
      alt: text(node.alt || node.getAttribute('aria-label') || '', 300),
      width: size.width, height: size.height, content: content, kinds: [kind], transport: transport
    };
    items.push(item);
    seen[source] = item;
    records[id] = { source: source, owner: owner };
  }
  // The srcset URL token may itself contain a comma (a data URL). A comma at
  // the end of a URL or descriptor separates candidates, not every comma.
  function srcset(value, node, owner) {
    if (!value || typeof value !== 'string') return;
    var position = 0, count = 0;
    while (position < value.length && count++ < 30) {
      while (position < value.length && /[\s,]/.test(value[position])) position++;
      var start = position;
      while (position < value.length && !/\s/.test(value[position])) position++;
      var url = value.slice(start, position);
      var comma = /,+$/.test(url);
      if (comma) url = url.replace(/,+$/, '');
      add(url, node, 'srcset', owner);
      if (comma) continue;
      var parens = 0;
      while (position < value.length) {
        var ch = value[position++];
        if (ch === '(') parens++;
        else if (ch === ')') parens--;
        else if (ch === ',' && parens === 0) break;
      }
    }
  }
  function background(value, node, owner) {
    if (!value || value === 'none') return;
    var regex = /url\(\s*(?:"((?:\\.|[^"])*)"|'((?:\\.|[^'])*)'|([^)]*))\s*\)/g, match, count = 0;
    while ((match = regex.exec(value)) && count++ < 12) {
      add((match[1] || match[2] || match[3] || '').replace(/\\(["'\\() ])/g, '$1'), node, 'background', owner);
    }
  }
  function walk(owner, depth) {
    if (frames++ >= frameLimit || depth > 4) { truncated = true; return; }
    var doc;
    try {
      doc = owner.document;
      if (!doc || !doc.documentElement) { inaccessibleFrames++; return; }
      if (documents.indexOf(doc) >= 0) return;
      documents.push(doc);
    } catch (ignored) { void ignored; inaccessibleFrames++; return; }
    // Find image-bearing elements first so a large navigation/header does not
    // spend the CSS budget before the actual article images are reached.
    var candidates = doc.querySelectorAll('img,picture source,image,iframe,frame');
    for (var candidateIndex = 0; candidateIndex < candidates.length; candidateIndex++) {
      if (++visited > elementLimit || Date.now() > deadline) { truncated = true; return; }
      var node = candidates[candidateIndex];
      var name = (node.localName || '').toLowerCase();
      if (name === 'img') {
        add(node.currentSrc, node, 'img', owner);
        add(node.getAttribute('src'), node, 'img', owner);
        srcset(node.getAttribute('srcset'), node, owner);
        ['data-src', 'data-original', 'data-lazy-src', 'data-original-src', 'data-actualsrc', 'data-image', 'data-url'].forEach(function (attribute) {
          add(node.getAttribute(attribute), node, 'lazy', owner);
        });
        srcset(node.getAttribute('data-srcset'), node, owner);
        srcset(node.getAttribute('data-lazy-srcset'), node, owner);
      } else if (name === 'source' && node.parentElement && (node.parentElement.localName || '').toLowerCase() === 'picture') {
        var target = node.parentElement.querySelector('img') || node;
        srcset(node.getAttribute('srcset'), target, owner);
        srcset(node.getAttribute('data-srcset'), target, owner);
        add(node.getAttribute('src'), target, 'srcset', owner);
      } else if (name === 'image') {
        add(node.getAttribute('href') || node.getAttribute('xlink:href'), node, 'svg', owner);
      }
      if (name === 'iframe' || name === 'frame') {
        try {
          var child = node.contentWindow;
          if (child && child.document) walk(child, depth + 1);
          else inaccessibleFrames++;
        } catch (ignored) { void ignored; inaccessibleFrames++; }
      }
    }
    var walker = doc.createTreeWalker(doc.documentElement, 1);
    var backgroundNode = doc.documentElement;
    while (backgroundNode) {
      if (++visited > elementLimit || Date.now() > deadline) { truncated = true; return; }
      var backgroundName = (backgroundNode.localName || '').toLowerCase();
      if (!/^(script|style|head|meta|link)$/.test(backgroundName)) {
        try { background(owner.getComputedStyle(backgroundNode).backgroundImage, backgroundNode, owner); } catch (ignored) { void ignored; }
      }
      backgroundNode = walker.nextNode();
    }
  }

  var session = {
    scanId: scanId,
    cancel: function () {
      alive = false;
      Object.keys(transfers).forEach(function (token) { session.stop(token); });
      transfers = Object.create(null);
      records = Object.create(null);
    },
    start: function (id, token, maxBytes) {
      var entry = records[id];
      if (!alive || !entry) return { error: '图片已失效，请重新扫描' };
      if (Object.keys(transfers).length >= 2) return { error: '正在读取其他图片，请重试' };
      if (entry.source.indexOf('data:') === 0 && entry.source.length > maxBytes * 1.4 + 1024) {
        return { error: '图片超过 6 MB，请返回网页查看' };
      }
      var current = { token: token, done: false, cancelled: false };
      transfers[token] = current;
      function fail() {
        if (!alive || current.cancelled || transfers[token] !== current) return;
        current.done = true;
        current.error = '网页内存图片无法读取，请重新扫描或返回网页';
      }
      try {
        current.controller = new entry.owner.AbortController();
        entry.owner.fetch(entry.source, { signal: current.controller.signal }).then(function (response) {
          if (!response.ok) throw new Error('fetch');
          var length = Number(response.headers.get('content-length') || 0);
          if (length > maxBytes) { current.controller.abort(); throw new Error('size'); }
          var mime = (response.headers.get('content-type') || '').split(';')[0].toLowerCase();
          if (!mime || mime === 'application/octet-stream') mime = 'image/unknown';
          if (!/^image\//.test(mime)) throw new Error('mime');
          if (!response.body || !response.body.getReader) {
            if (!length) throw new Error('unbounded');
            return response.blob();
          }
          var stream = response.body.getReader(), chunks = [], bytes = 0;
          function readChunk() {
            return stream.read().then(function (part) {
              if (!alive || current.cancelled || transfers[token] !== current) { stream.cancel(); throw new Error('cancelled'); }
              if (part.done) return new entry.owner.Blob(chunks, { type: mime });
              bytes += part.value.byteLength;
              if (bytes > maxBytes) { stream.cancel(); current.controller.abort(); throw new Error('size'); }
              chunks.push(part.value);
              return readChunk();
            });
          }
          return readChunk();
        }).then(function (blob) {
          if (!alive || current.cancelled || transfers[token] !== current) return;
          if (!/^image\//i.test(blob.type) || !blob.size || blob.size > maxBytes) throw new Error('size');
          current.reader = new entry.owner.FileReader();
          current.reader.onerror = fail;
          current.reader.onload = function () {
            if (!alive || current.cancelled || transfers[token] !== current) return;
            current.dataUrl = String(current.reader.result || '');
            current.done = true;
          };
          current.reader.readAsDataURL(blob);
        }).catch(fail);
      } catch (ignored) { void ignored; fail(); }
      return { started: true };
    },
    read: function (token) {
      var transfer = transfers[token];
      if (!alive || !transfer) return { error: '图片读取已取消' };
      if (!transfer.done) return { pending: true };
      var result = transfer.error ? { error: transfer.error } : { dataUrl: transfer.dataUrl };
      delete transfers[token];
      return result;
    },
    stop: function (token) {
      var transfer = transfers[token];
      if (!transfer) return;
      transfer.cancelled = true;
      try { if (transfer.controller) transfer.controller.abort(); } catch (ignored) { void ignored; }
      try { if (transfer.reader) transfer.reader.abort(); } catch (ignored) { void ignored; }
      delete transfers[token];
    }
  };
  window[key] = session;
  walk(window, 0);
  return JSON.stringify({ pageUrl: location.href, items: items, truncated: truncated, inaccessibleFrames: inaccessibleFrames });
})()
