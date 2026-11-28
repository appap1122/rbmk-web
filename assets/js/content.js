/* content.js — 把 data/config.json 的文案绑定到页面上。
   用法：
     <span data-cfg="hero.title"></span>                  -> textContent
     <a data-cfg-href="hero.primaryHref">…</a>            -> href
     <meta data-cfg-content="site.description">           -> content
     <div data-cfg-list="editions.items" data-cfg-tpl="edition"></div>  -> 由 site.js 处理
   配置来源优先级：window.__RBMK_CONFIG__（data/config.js，file:// 预览可用）
                 然后 fetch('data/config.json')（http 下的兜底）。 */
(function () {
  'use strict';

  var RBMK = window.RBMK = window.RBMK || {};

  function getPath(obj, path) {
    return String(path).split('.').reduce(function (acc, key) {
      if (acc == null) return undefined;
      var idx = String(key).match(/^(\d+)$/);
      if (idx) return acc[Number(key)];
      return acc[key];
    }, obj);
  }

  RBMK.getPath = getPath;

  function applyBindings(cfg) {
    document.querySelectorAll('[data-cfg]').forEach(function (el) {
      var v = getPath(cfg, el.getAttribute('data-cfg'));
      if (v != null) el.textContent = String(v);
    });
    document.querySelectorAll('[data-cfg-href]').forEach(function (el) {
      var v = getPath(cfg, el.getAttribute('data-cfg-href'));
      if (v) el.setAttribute('href', String(v));
    });
    document.querySelectorAll('[data-cfg-content]').forEach(function (el) {
      var v = getPath(cfg, el.getAttribute('data-cfg-content'));
      if (v) el.setAttribute('content', String(v));
    });
    document.querySelectorAll('[data-cfg-html]').forEach(function (el) {
      var v = getPath(cfg, el.getAttribute('data-cfg-html'));
      if (v != null) el.innerHTML = String(v);
    });

    var page = document.body.getAttribute('data-page');
    if (page) {
      var title = getPath(cfg, 'pages.' + page + '.title');
      var lede = getPath(cfg, 'pages.' + page + '.lede');
      if (title) document.title = title + ' · ' + (cfg.site && cfg.site.brandName ? cfg.site.brandName : 'RBMK');
      if (lede) {
        var ledeEl = document.querySelector('[data-page-lede]');
        if (ledeEl && !ledeEl.textContent.trim()) ledeEl.textContent = lede;
      }
    }
  }

  function renderNav(cfg) {
    var items = (cfg.nav || []);
    document.querySelectorAll('[data-nav]').forEach(function (host) {
      var page = document.body.getAttribute('data-page');
      host.innerHTML = items.map(function (it) {
        var active = it.href && it.href.split('?')[0] === page ? ' aria-current="page"' : '';
        return '<a href="' + it.href + '"' + active + '>' + it.text + '</a>';
      }).join('');
    });
  }

  function renderFooter(cfg) {
    var f = cfg.footer || {};
    document.querySelectorAll('[data-footer-nav]').forEach(function (host) {
      host.innerHTML = (f.nav || []).map(function (it) {
        return '<a href="' + it.href + '">' + it.text + '</a>';
      }).join('');
    });
    document.querySelectorAll('[data-footer-links]').forEach(function (host) {
      host.innerHTML = (f.links || []).map(function (it) {
        return '<a href="' + it.href + '" target="_blank" rel="noopener">' + it.text + '</a>';
      }).join('');
    });
    document.querySelectorAll('[data-ticker]').forEach(function (host) {
      host.innerHTML =
        '<span class="ticker-badge">' + (cfg.site.tickerBadge || 'SYNC') + '</span>' +
        '<span>' + (cfg.site.tickerLabel || '最新版本') + '</span>' +
        '<b data-latest-version style="color:var(--amber);font-family:var(--mono)">—</b>' +
        '<span class="ticker-sep">·</span>' +
        '<span class="muted">' + (cfg.site.tickerNote || '') + '</span>' +
        '<a href="downloads.html">' + (cfg.site.tickerLinkText || '下载 →') + '</a>';
    });
  }

  function boot(cfg) {
    if (!cfg) return;
    RBMK.config = cfg;
    applyBindings(cfg);
    renderNav(cfg);
    renderFooter(cfg);
    if (window.RBMKSite && window.RBMKSite.boot) window.RBMKSite.boot(cfg);
    if (window.RBMKDownloads && window.RBMKDownloads.boot) window.RBMKDownloads.boot(cfg);
    if (window.RBMKHome && window.RBMKHome.boot) window.RBMKHome.boot(cfg);
    document.documentElement.setAttribute('data-cfg-ready', '1');
  }

  RBMK.loadConfig = function (cb) {
    if (window.__RBMK_CONFIG__) { cb(window.__RBMK_CONFIG__); return; }
    fetch('data/config.json', { cache: 'no-cache' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(cb)
      .catch(function () { cb(null); });
  };

  function start() {
    RBMK.loadConfig(boot);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
