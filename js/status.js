(function () {
  "use strict";

  var WEBAPP_URL =
    "https://script.google.com/macros/s/AKfycbx9iJtomvZzKM8qJn8EzaOVJ2j-KMATO3xiXRfvR-IT__3v8UEO6dOLT9xwlNWOVSda-Q/exec";
  var STATUS_URL = WEBAPP_URL + "?action=status";
  var POLL_MS = 60 * 1000;
  var TIMEOUT_MS = 8000;
  var TOAST_MS = 20 * 1000;
  var STATUS_CACHE_KEY = "gemorcafilm_status";
  var SEEN_COUNT_KEY = "gemorcafilm_seen_count";
  var ANN_DISMISSED_KEY = "gemorcafilm_ann_dismissed";
  var SHEET_CACHE_KEY = "gemorcafilm_sheet_cache";
  var DEFAULT_MESSAGE = "Kami sedang memperbarui situs. Silakan kembali beberapa saat lagi.";

  var inflight = false;
  var overlay = null;
  var banner = null;
  var toastEl = null;
  var toastTimer = null;
  var maintTimer = null;
  var inertNodes = [];

  function store(kind) {
    try {
      return window[kind];
    } catch (e) {
      return null;
    }
  }

  function read(kind, key) {
    var s = store(kind);
    try {
      return s ? s.getItem(key) : null;
    } catch (e) {
      return null;
    }
  }

  function write(kind, key, value) {
    var s = store(kind);
    try {
      if (s) s.setItem(key, value);
    } catch (e) {
      return;
    }
  }

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function parseTargetDate(str) {
    if (!str) return null;
    var s = String(str).trim();
    if (!s) return null;

    if (/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2})?$/.test(s)) {
      s = s.replace(" ", "T") + "+08:00";
    }
    var t = Date.parse(s);
    return isNaN(t) ? null : t;
  }

  function isMaintenanceActive(data) {
    if (!data || !data.maintenance) return false;
    var targetMs = parseTargetDate(data.estimasi);
    return !(targetMs && targetMs <= Date.now());
  }

  function formatTimeRemaining(ms) {
    var totalSec = Math.floor(ms / 1000);
    var days = Math.floor(totalSec / 86400);
    var hours = Math.floor((totalSec % 86400) / 3600);
    var mins = Math.floor((totalSec % 3600) / 60);
    var secs = totalSec % 60;

    var pad = function (n) {
      return (n < 10 ? "0" : "") + n;
    };

    if (days > 0) {
      return days + " hari " + pad(hours) + ":" + pad(mins) + ":" + pad(secs);
    }
    return pad(hours) + ":" + pad(mins) + ":" + pad(secs);
  }

  function injectStyles() {
    var css = [
      ".gm-maint{position:fixed;inset:0;z-index:40;display:flex;align-items:center;justify-content:center;",
      "padding:calc(var(--header-h,4.5rem) + 1rem) 1.25rem 1.5rem;background:var(--bg,#0f1013);text-align:center}",
      ".gm-maint__box{max-width:30rem}",
      ".gm-maint__icon{width:4rem;height:4rem;margin:0 auto 1.25rem;color:var(--accent-strong,#38a8ff)}",
      ".gm-maint h2{margin:0 0 .75rem;font-family:var(--font-display,system-ui,sans-serif);font-size:1.75rem;color:var(--text,#f3f4f6)}",
      ".gm-maint p{margin:0 0 .75rem;line-height:1.6;color:var(--soft,#d5d8de)}",
      ".gm-maint__eta{color:var(--muted,#9ba1ad);font-weight:600;font-variant-numeric:tabular-nums}",
      ".gm-maint .btn{margin-top:.5rem}",
      "body.is-maintenance{overflow:hidden}",
      "body.is-maintenance .nav,body.is-maintenance .search{display:none}",
      ".gm-bar{position:fixed;left:0;right:0;bottom:0;z-index:60;display:flex;align-items:center;gap:.75rem;",
      "padding:.75rem 1rem calc(.75rem + env(safe-area-inset-bottom,0px));background:var(--accent,#1673d6);color:#fff;",
      "font-size:.95rem;line-height:1.4}",
      ".gm-bar__text{flex:1;min-width:0;overflow-wrap:anywhere}",
      ".gm-x{flex:none;width:2rem;height:2rem;border:0;border-radius:50%;background:transparent;color:inherit;",
      "font-size:1.4rem;line-height:1;cursor:pointer}",
      ".gm-x:hover{background:rgba(255,255,255,.18)}",
      ".gm-toast{position:fixed;left:50%;bottom:1rem;z-index:70;transform:translateX(-50%);width:min(26rem,calc(100% - 2rem));",
      "display:flex;align-items:center;gap:.75rem;padding:.85rem 1rem;border:1px solid var(--line,#2a2f39);",
      "border-radius:var(--radius,10px);background:var(--surface,#171a20);color:var(--text,#f3f4f6);",
      "box-shadow:0 10px 30px rgba(0,0,0,.45)}",
      ".gm-toast__text{flex:1;min-width:0;overflow-wrap:anywhere}",
      ".gm-toast__title{display:block;font-weight:600}",
      ".gm-toast__sub{display:block;color:var(--muted,#9ba1ad);font-size:.9rem}",
      ".gm-toast .btn{flex:none}",
      ".gm-toast .gm-x{color:var(--muted,#9ba1ad)}"
    ].join("");
    var style = document.createElement("style");
    style.textContent = css;
    document.head.appendChild(style);
  }

  function setInert(on) {
    if (on) {
      inertNodes = Array.prototype.slice.call(document.querySelectorAll("main, #top, .site-footer"));
      inertNodes.forEach(function (n) {
        n.inert = true;
      });
    } else {
      inertNodes.forEach(function (n) {
        n.inert = false;
      });
      inertNodes = [];
    }
  }

  function closePlayerIfOpen() {
    var modal = document.getElementById("playerModal");
    var close = document.getElementById("modalClose");
    if (modal && !modal.hidden && close) close.click();
  }

  function buildOverlay() {
    var box = el("div", "gm-maint__box");
    box.innerHTML =
      '<svg class="gm-maint__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" ' +
      'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      '<path d="M14.7 6.3a4 4 0 0 0-5.4 5.1L3.5 17.2a1.8 1.8 0 0 0 2.6 2.6l5.8-5.8a4 4 0 0 0 5.1-5.4l-2.4 2.4-2.1-.5-.5-2.1z"/></svg>';
    box.appendChild(el("h2", "", "Sedang Pemeliharaan"));
    box.appendChild(el("p", "gm-maint__msg"));
    box.appendChild(el("p", "gm-maint__eta"));
    var retry = el("button", "btn btn-ghost", "Coba lagi");
    retry.type = "button";
    retry.addEventListener("click", function () {
      poll(true);
    });
    box.appendChild(retry);

    var wrap = el("div", "gm-maint");
    wrap.setAttribute("role", "status");
    wrap.setAttribute("aria-live", "polite");
    wrap.appendChild(box);
    return wrap;
  }

  function showMaintenance(data) {
    if (!overlay) {
      overlay = buildOverlay();
      document.body.appendChild(overlay);
    }
    overlay.querySelector(".gm-maint__msg").textContent = data.pesan || DEFAULT_MESSAGE;
    var eta = overlay.querySelector(".gm-maint__eta");

    if (maintTimer) {
      clearInterval(maintTimer);
      maintTimer = null;
    }

    var targetMs = parseTargetDate(data.estimasi);

    if (targetMs) {
      var updateCountdown = function () {
        var now = Date.now();
        var diff = targetMs - now;
        if (diff <= 0) {
          hideMaintenance();
          poll(true);
        } else {
          eta.textContent = "Perkiraan selesai: " + formatTimeRemaining(diff) + " (WITA)";
          eta.hidden = false;
        }
      };
      updateCountdown();
      if (!overlay) return;
      maintTimer = setInterval(updateCountdown, 1000);
    } else {
      eta.textContent = data.estimasi ? "Perkiraan selesai: " + data.estimasi : "";
      eta.hidden = !data.estimasi;
    }

    document.body.classList.add("is-maintenance");
    setInert(true);
    closePlayerIfOpen();
    hideToast();
    hideBanner();
  }

  function hideMaintenance() {
    if (maintTimer) {
      clearInterval(maintTimer);
      maintTimer = null;
    }
    if (overlay) {
      overlay.remove();
      overlay = null;
    }
    document.body.classList.remove("is-maintenance");
    setInert(false);
  }

  function hideBanner() {
    if (banner) {
      banner.remove();
      banner = null;
    }
  }

  function showBanner(text) {
    if (!text || read("sessionStorage", ANN_DISMISSED_KEY) === text) {
      hideBanner();
      return;
    }
    if (banner && banner.getAttribute("data-text") === text) return;
    hideBanner();

    banner = el("div", "gm-bar");
    banner.setAttribute("role", "status");
    banner.setAttribute("data-text", text);
    banner.appendChild(el("span", "gm-bar__text", text));
    var close = el("button", "gm-x", "\u00d7");
    close.type = "button";
    close.setAttribute("aria-label", "Tutup pengumuman");
    close.addEventListener("click", function () {
      write("sessionStorage", ANN_DISMISSED_KEY, text);
      hideBanner();
    });
    banner.appendChild(close);
    document.body.appendChild(banner);
  }

  function hideToast() {
    clearTimeout(toastTimer);
    if (toastEl) {
      toastEl.remove();
      toastEl = null;
    }
  }

  function reloadFresh() {
    try {
      sessionStorage.removeItem(SHEET_CACHE_KEY);
    } catch (e) {
      
    }
    window.location.reload();
  }

  function showNewVideoToast(added, lastTitle) {
    hideToast();
    toastEl = el("div", "gm-toast");
    toastEl.setAttribute("role", "status");

    var text = el("div", "gm-toast__text");
    text.appendChild(el("span", "gm-toast__title", "Video baru tayang"));
    var sub = added > 1 ? added + " video baru ditambahkan." : lastTitle || "Ada video baru untuk Anda.";
    text.appendChild(el("span", "gm-toast__sub", sub));

    var reload = el("button", "btn btn-primary", "Muat ulang");
    reload.type = "button";
    reload.addEventListener("click", reloadFresh);

    var close = el("button", "gm-x", "\u00d7");
    close.type = "button";
    close.setAttribute("aria-label", "Tutup notifikasi");
    close.addEventListener("click", hideToast);

    toastEl.append(text, reload, close);
    document.body.appendChild(toastEl);
    toastTimer = setTimeout(hideToast, TOAST_MS);
  }

  function checkNewVideos(data) {
    if (typeof data.count !== "number") return;
    var raw = read("sessionStorage", SEEN_COUNT_KEY);
    var seen = raw === null ? null : Number(raw);
    write("sessionStorage", SEEN_COUNT_KEY, String(data.count));
    if (seen === null || !isFinite(seen)) return;
    if (data.count > seen) showNewVideoToast(data.count - seen, data.last);
  }

  function apply(data, fromCache) {
    if (isMaintenanceActive(data)) {
      showMaintenance(data);
      return;
    }
    var wasMaintenance = !!overlay;
    hideMaintenance();
    showBanner(data.pengumuman);
    if (!fromCache && !wasMaintenance) checkNewVideos(data);
    if (!fromCache && wasMaintenance && typeof data.count === "number") {
      write("sessionStorage", SEEN_COUNT_KEY, String(data.count));
    }
  }

  function fetchStatus() {
    var controller = typeof AbortController !== "undefined" ? new AbortController() : null;
    var timer = controller
      ? setTimeout(function () {
          controller.abort();
        }, TIMEOUT_MS)
      : null;
    var options = { cache: "no-store" };
    if (controller) options.signal = controller.signal;

    return fetch(STATUS_URL, options)
      .then(function (res) {
        return res.json();
      })
      .then(
        function (data) {
          clearTimeout(timer);
          return data;
        },
        function (err) {
          clearTimeout(timer);
          throw err;
        }
      );
  }

  function poll(force) {
    if (inflight || (document.hidden && !force)) return;
    inflight = true;
    fetchStatus()
      .then(function (data) {
        if (!data || data.ok !== true) return;
        write("localStorage", STATUS_CACHE_KEY, JSON.stringify(data));
        apply(data, false);
      })
      .catch(function () {
        
      })
      .then(function () {
        inflight = false;
      });
  }

  function start() {
    injectStyles();

    var cached = null;
    try {
      cached = JSON.parse(read("localStorage", STATUS_CACHE_KEY) || "null");
    } catch (e) {
      cached = null;
    }
    if (cached && cached.ok === true) apply(cached, true);

    poll(true);
    setInterval(poll, POLL_MS);
    document.addEventListener("visibilitychange", function () {
      if (!document.hidden) poll(true);
    });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();
})();