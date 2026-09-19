// MAIN-world submission interceptor.
//
// Runs in the page's own JS context (world: "MAIN") at document_start so it can
// monkey-patch fetch/XHR before LeetCode issues any submission traffic. It does
// NOT use the DOM "Accepted" badge (hashed classes churn); instead it watches the
// user's own authenticated submission-check responses and reports the result.
//
// Scope by design: this only ever sees the logged-in user's OWN submissions made
// on-page. It is not a friend-data path and not a history-import path. It has no
// chrome.* access, so it hands results to the isolated content script via
// window.postMessage; content.js validates event.source === window before trusting.
(function () {
  'use strict';
  if (window.__leetsquadInterceptorInstalled) return;
  window.__leetsquadInterceptorInstalled = true;

  const CHECK_RE = /\/submissions\/detail\/(\d+)\/check\/?/;
  const TAG = 'leetsquad-interceptor';

  // Slug for the problem being submitted. The check response doesn't carry a
  // reliable titleSlug, so we read it from the page URL the submit happened on.
  function currentSlug() {
    const m = window.location.pathname.match(/\/problems\/([^/]+)/);
    return m ? m[1] : null;
  }

  // Inspect a parsed submission-check JSON. Emits only on a finished, accepted
  // run. status_code 10 === Accepted; state SUCCESS means polling is done.
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
