// MAIN-world interceptor: patches fetch/XHR at document_start to catch the user's own accepted submission-check responses (not the DOM badge).
// Only ever sees the logged-in user's own submissions. No chrome.* access; posts results to content.js via window.postMessage, which validates event.source === window.
(function () {
  'use strict';
  if (window.__leetsquadInterceptorInstalled) return;
  window.__leetsquadInterceptorInstalled = true;

  const CHECK_RE = /\/submissions\/detail\/(\d+)\/check\/?/;
  const TAG = 'leetsquad-interceptor';

  // Slug from the page URL; the check response has no reliable titleSlug.
  function currentSlug() {
    const m = window.location.pathname.match(/\/problems\/([^/]+)/);
    return m ? m[1] : null;
  }

  // Inspect submission-check JSON; emit only on a finished accepted run (status_code 10, state SUCCESS).
  function handleCheckPayload(url, json) {
    if (!json || json.state !== 'SUCCESS') return;
    const accepted = json.status_code === 10 || json.status_msg === 'Accepted';
    if (!accepted) return;

    const idMatch = url.match(CHECK_RE);
    const submissionId = idMatch ? idMatch[1] : (json.submission_id ? String(json.submission_id) : null);
    const slug = currentSlug();
    if (!slug) return;

    window.postMessage({
      source: TAG,
      type: 'submissionAccepted',
      payload: {
        slug,
        id: submissionId,
        lang: json.lang || json.pretty_lang || null,
        runtime: json.status_runtime || null,
        memory: json.status_memory || null,
        // task_finish_time is epoch ms; fall back to now (sec) for our own clock.
        timestamp: json.task_finish_time ? Math.floor(json.task_finish_time / 1000) : Math.floor(Date.now() / 1000),
      },
    }, window.location.origin);
  }

  function tryParseAndHandle(url, text) {
    if (!url || !CHECK_RE.test(url) || !text) return;
    let json;
    try { json = JSON.parse(text); } catch (e) { return; }
    try { handleCheckPayload(url, json); } catch (e) { /* never break the page */ }
  }

  // ---- patch fetch ----
  const origFetch = window.fetch;
  if (typeof origFetch === 'function') {
    window.fetch = function (...args) {
      const p = origFetch.apply(this, args);
      try {
        const reqUrl = (args[0] && args[0].url) || args[0];
        if (typeof reqUrl === 'string' && CHECK_RE.test(reqUrl)) {
          p.then((res) => {
            try { res.clone().text().then((t) => tryParseAndHandle(reqUrl, t)).catch(() => {}); } catch (e) {}
          }).catch(() => {});
        }
      } catch (e) { /* ignore */ }
      return p;
    };
  }

  // ---- patch XMLHttpRequest ----
  const origOpen = XMLHttpRequest.prototype.open;
  const origSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (method, url, ...rest) {
    try { this.__leetsquadUrl = url; } catch (e) {}
    return origOpen.call(this, method, url, ...rest);
  };
  XMLHttpRequest.prototype.send = function (...args) {
    try {
      const url = this.__leetsquadUrl;
      if (typeof url === 'string' && CHECK_RE.test(url)) {
        this.addEventListener('load', function () {
          try { tryParseAndHandle(url, this.responseText); } catch (e) {}
        });
      }
    } catch (e) { /* ignore */ }
    return origSend.apply(this, args);
  };
})();
