/* downloads.js — 下载中心：模组切换、搜索、通道/性质/线路筛选、URL 状态同步。 */
(function () {
  'use strict';
  var RBMK = window.RBMK = window.RBMK || {};
  var state = { mod: null, channel: 'all', flag: 'all', source: 'auto', q: '' };
  var index = [];
  var cfg = null;

  function readHash() {
    var p = new URLSearchParams(location.search);
    if (p.get('mod')) state.mod = p.get('mod');
    if (p.get('ch')) state.channel = p.get('ch');
    if (p.get('flag')) state.flag = p.get('flag');
    if (p.get('src')) state.source = p.get('src');
    if (p.get('q')) state.q = p.get('q');
  }

  function writeHash() {
    var p = new URLSearchParams();
    p.set('mod', state.mod);
    if (state.channel !== 'all') p.set('ch', state.channel);
    if (state.flag !== 'all') p.set('flag', state.flag);
    if (state.source !== 'auto') p.set('src', state.source);
    if (state.q) p.set('q', state.q);
    history.replaceState(null, '', '?' + p.toString());
  }

  function currentRows() {
    var entry = index.filter(function (e) { return e.mod.id === state.mod; })[0];
    return entry ? entry.rows : [];
  }

  function filtered() {
    var q = state.q.trim().toLowerCase();
    return currentRows().filter(function (r) {
      if (state.channel !== 'all' && r.channel !== state.channel) return false;
      if (state.flag !== 'all' && (r.flags || []).indexOf(state.flag) < 0) return false;
      if (state.source !== 'auto' && r.platform !== state.source) return false;
      if (q) {
        var hay = (r.tag + ' ' + r.name + ' ' + (r.notes || '') + ' ' +
          (r.assets || []).map(function (a) { return a.name; }).join(' ')).toLowerCase();
        if (hay.indexOf(q) < 0) return false;
      }
      return true;
    });
  }

  function renderCounts() {
    var rows = currentRows();
    var n = { all: rows.length, stable: 0, beta: 0, preview: 0, hotfix: 0, major: 0, unstable: 0 };
    rows.forEach(function (r) {
      n[r.channel] = (n[r.channel] || 0) + 1;
      (r.flags || []).forEach(function (f) { n[f] = (n[f] || 0) + 1; });
    });
    document.querySelectorAll('[data-count]').forEach(function (el) {
      var k = el.getAttribute('data-count');
      el.textContent = n[k] == null ? '0' : String(n[k]);
    });
  }

  function renderList() {
    var host = document.getElementById('versionList');
    if (!host) return;
    var rows = filtered();
    var shown = document.getElementById('shownCount');
    if (shown) shown.textContent = String(rows.length);
    host.innerHTML = '';
    if (!rows.length) {
      var empty = document.createElement('div');
      empty.className = 'skeleton';
      empty.textContent = (RBMK.config.downloads && RBMK.config.downloads.empty) || '没有匹配的版本。';
      host.appendChild(empty);
      return;
    }
    rows.forEach(function (r) { host.appendChild(RBMK.UI.renderRelease(cfg, r)); });
  }

  function renderSidebar() {
    var rows = currentRows();
    var stable = rows.filter(function (r) { return r.channel === 'stable'; })[0];
    var latestEl = document.getElementById('latestStable');
    if (latestEl) {
      latestEl.innerHTML = stable
        ? '<span class="release-tag">' + RBMK.UI.esc(stable.tag) + '</span> <span class="muted">· ' +
          RBMK.UI.esc(RBMK.UI.fmtDate(stable.date)) + '</span>'
        : '<span class="muted">暂无正式版数据</span>';
    }
    var syncEl = document.getElementById('syncTime');
    var data = window.__RBMK_DATA__;
    if (syncEl) {
      syncEl.textContent = data && data.updated_at
        ? new Date(data.updated_at).toLocaleString('zh-CN', { hour12: false })
        : '尚未同步';
    }
  }

  function bindControls() {
    document.querySelectorAll('[data-filter="channel"]').forEach(function (b) {
      b.setAttribute('aria-pressed', b.getAttribute('data-value') === state.channel ? 'true' : 'false');
      b.addEventListener('click', function () {
        state.channel = b.getAttribute('data-value');
        document.querySelectorAll('[data-filter="channel"]').forEach(function (x) {
          x.setAttribute('aria-pressed', x.getAttribute('data-value') === state.channel ? 'true' : 'false');
        });
        writeHash(); renderList();
      });
    });
    document.querySelectorAll('[data-filter="flag"]').forEach(function (b) {
      b.setAttribute('aria-pressed', b.getAttribute('data-value') === state.flag ? 'true' : 'false');
      b.addEventListener('click', function () {
        state.flag = b.getAttribute('data-value');
        document.querySelectorAll('[data-filter="flag"]').forEach(function (x) {
          x.setAttribute('aria-pressed', x.getAttribute('data-value') === state.flag ? 'true' : 'false');
        });
        writeHash(); renderList();
      });
    });
    document.querySelectorAll('[data-filter="source"]').forEach(function (b) {
      b.setAttribute('aria-pressed', b.getAttribute('data-value') === state.source ? 'true' : 'false');
      b.addEventListener('click', function () {
        state.source = b.getAttribute('data-value');
        document.querySelectorAll('[data-filter="source"]').forEach(function (x) {
          x.setAttribute('aria-pressed', x.getAttribute('data-value') === state.source ? 'true' : 'false');
        });
        writeHash(); renderList();
      });
    });
    var search = document.getElementById('dlSearch');
    if (search) {
      search.value = state.q;
      var timer = null;
      search.addEventListener('input', function () {
        clearTimeout(timer);
        timer = setTimeout(function () {
          state.q = search.value;
          writeHash(); renderList();
        }, 140);
      });
    }
  }

  function onPick(id) {
    state.mod = id;
    writeHash();
    RBMK.UI.renderTabs(cfg, state.mod, onPick);
    renderCounts();
    renderSidebar();
    renderList();
    applyModParams();
  }

  function boot(cfgIn) {
    cfg = cfgIn;
    if (!cfg || !document.getElementById('versionList')) return;
    readHash();
    index = RBMK.UI.buildIndex(cfg);
    if (!state.mod || !(cfg.mods || []).some(function (m) { return m.id === state.mod; })) {
      state.mod = (cfg.mods && cfg.mods[0] && cfg.mods[0].id) || 'rbmk';
    }
    RBMK.UI.renderTabs(cfg, state.mod, onPick);
    bindControls();
    renderCounts();
    renderSidebar();
    renderList();
    applyModParams();

    /* 秒开用内联快照，随后再拉一次 assets/releases.json 做热更新 */
    if (window.RBMKData) {
      window.RBMKData.refresh(function (changed) {
        if (!changed) return;
        index = RBMK.UI.buildIndex(cfg);
        renderCounts();
        renderSidebar();
        renderList();
      });
    }
  }

  /* 参数表：根据当前模组把对应列高亮 */
  function applyModParams() {
    document.querySelectorAll('[data-param-mod]').forEach(function (td) {
      td.style.background = td.getAttribute('data-param-mod') === state.mod
        ? 'rgba(255,176,32,.06)' : '';
    });
    document.querySelectorAll('[data-param-col]').forEach(function (th) {
      th.style.color = th.getAttribute('data-param-col') === state.mod ? 'var(--amber)' : '';
    });
  }

  window.RBMKDownloads = { boot: boot, getState: function () { return state; } };
})();
