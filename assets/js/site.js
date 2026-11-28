/* site.js — 全站公共交互：导航折叠、滚动揭示、视频门面、版本号回填。 */
(function () {
  'use strict';
  var RBMK = window.RBMK = window.RBMK || {};

  function navToggle() {
    var btn = document.querySelector('.nav-toggle');
    var links = document.querySelector('.nav-links');
    if (!btn || !links) return;
    btn.addEventListener('click', function () {
      var open = links.classList.toggle('open');
      btn.setAttribute('aria-expanded', open ? 'true' : 'false');
    });
    links.addEventListener('click', function (e) {
      if (e.target.tagName === 'A') links.classList.remove('open');
    });
  }

  function reveal() {
    var els = document.querySelectorAll('[data-reveal]');
    if (!els.length) return;
    if (!('IntersectionObserver' in window)) {
      els.forEach(function (el) { el.classList.add('in'); });
      return;
    }
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (en.isIntersecting) { en.target.classList.add('in'); io.unobserve(en.target); }
      });
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0.06 });
    els.forEach(function (el) { io.observe(el); });
  }

  function videoFacade() {
    document.querySelectorAll('.video-facade').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var id = btn.getAttribute('data-bvid');
        if (!id) return;
        var frame = document.createElement('iframe');
        frame.src = 'https://player.bilibili.com/player.html?bvid=' + encodeURIComponent(id) +
          '&page=1&high_quality=1&danmaku=0&autoplay=1';
        frame.allow = 'autoplay; fullscreen; picture-in-picture';
        frame.setAttribute('allowfullscreen', 'true');
        frame.setAttribute('scrolling', 'no');
        var host = btn.parentNode;
        host.innerHTML = '';
        host.appendChild(frame);
      });
    });
  }

  function year() {
    document.querySelectorAll('[data-year]').forEach(function (el) {
      el.textContent = String(new Date().getFullYear());
    });
  }

  /* 顶部 ticker 的"最新正式版"：从已同步数据里取第一个正式版 Tag。 */
  function latestVersion() {
    var data = window.__RBMK_DATA__;
    var cfg = RBMK.config;
    var mods = (cfg && cfg.mods) || [];
    var primary = mods[0];
    var label = '—';
    if (data && primary) {
      var rows = [];
      (primary.sources || []).forEach(function (s) {
        var key = s.platform + ':' + s.repo;
        var arr = (data.repos && data.repos[key]) || [];
        rows = rows.concat(arr);
      });
      var stable = rows.filter(function (r) { return !r.prerelease; });
      stable.sort(function (a, b) { return Date.parse(b.date || 0) - Date.parse(a.date || 0); });
      if (stable[0]) label = 'v' + stable[0].tag;
    }
    document.querySelectorAll('[data-latest-version]').forEach(function (el) {
      el.textContent = label;
    });
  }

  window.RBMKSite = {
    boot: function () {
      navToggle();
      reveal();
      videoFacade();
      year();
      latestVersion();
    }
  };
})();
