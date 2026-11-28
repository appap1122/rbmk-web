/* mods.js — 下载页的核心渲染：标签判定、模组选项卡、版本卡片、数据合并。
   同时被 downloads.html 与（保留的）其他下载入口使用。 */
(function () {
  'use strict';
  var RBMK = window.RBMK = window.RBMK || {};

  /* ---------- 标签判定（与 scripts/release-labels.mjs 保持同一套规则） ---------- */
  var HOTFIX = /(^|[^a-z])(hotfix|fix)([^a-z]|$)|紧急修复/i;
  var MAJOR = /(^|[^a-z])(major)([^a-z]|$)|重大更新/i;
  var UNSTABLE = /(unstable|experimental|alpha)|不稳定/i;

  function classify(tag, name, prerelease) {
    var t = String(tag || '');
    var n = String(name || '');
    var hay = t + ' ' + n;
    var channel = 'stable';
    if (/-beta/i.test(t) || /beta/i.test(n)) channel = 'beta';
    else if (/-preview/i.test(t) || /preview/i.test(n)) channel = 'preview';
    if (prerelease && channel === 'stable') channel = 'beta';

    var flags = [];
    if (HOTFIX.test(hay)) flags.push('hotfix');
    if (MAJOR.test(hay)) flags.push('major');
    if (UNSTABLE.test(hay)) flags.push('unstable');
    return { channel: channel, flags: flags };
  }

  var SIZE_UNITS = ['B', 'KB', 'MB', 'GB'];
  function humanSize(n) {
    if (n == null || isNaN(n) || n <= 0) return '';
    var i = 0, v = Number(n);
    while (v >= 1024 && i < SIZE_UNITS.length - 1) { v /= 1024; i++; }
    return (v >= 100 || i === 0 ? Math.round(v) : v.toFixed(1)) + ' ' + SIZE_UNITS[i];
  }

  function fmtDate(iso) {
    if (!iso) return '';
    var d = new Date(iso);
    if (isNaN(d)) return String(iso);
    var p = function (x) { return x < 10 ? '0' + x : String(x); };
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
  }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  /* ---------- 数据 ---------- */
  function sourceKey(s) { return s.platform + ':' + s.repo; }

  /* 把上游（GitHub/Gitee 同步数据）与本地手工发布合并成 [{mod, rows}] */
  function buildIndex(cfg) {
    var upstream = window.__RBMK_DATA__ || { repos: {} };
    var local = window.__RBMK_LOCAL__ || { mods: {} };
    return (cfg.mods || []).map(function (mod) {
      var rows = [];
      (mod.sources || []).forEach(function (src) {
        var arr = (upstream.repos || {})[sourceKey(src)] || [];
        arr.forEach(function (r) {
          rows.push({
            mod: mod.id,
            tag: r.tag,
            name: r.name || r.tag,
            notes: r.notes || '',
            prerelease: !!r.prerelease,
            date: r.date || '',
            htmlUrl: r.htmlUrl || '',
            platform: src.platform,
            repo: src.repo,
            assets: r.assets || [],
            channel: r.channel || classify(r.tag, r.name, r.prerelease).channel,
            flags: r.flags || classify(r.tag, r.name, r.prerelease).flags,
            local: false
          });
        });
      });
      ((local.mods || {})[mod.id] || []).forEach(function (r) {
        var c = classify(r.tag, r.name, false);
        rows.push({
          mod: mod.id,
          tag: r.tag,
          name: r.name || r.tag,
          notes: r.notes || '',
          prerelease: false,
          date: r.date || '',
          htmlUrl: r.htmlUrl || '',
          platform: 'local',
          repo: '',
          assets: r.files || [],
          channel: c.channel,
          flags: c.flags,
          local: true
        });
      });
      // 同 tag 去重，本地优先
      var seen = {};
      rows.sort(function (a, b) {
        if (a.tag === b.tag) return (b.local ? 1 : 0) - (a.local ? 1 : 0);
        return 0;
      });
      rows = rows.filter(function (r) {
        if (seen[r.tag]) return false;
        seen[r.tag] = true;
        return true;
      });
      rows.sort(function (a, b) { return Date.parse(b.date || 0) - Date.parse(a.date || 0); });
      return { mod: mod, rows: rows };
    });
  }

  function labelText(cfg, kind, key) {
    var L = (cfg.labels || {})[kind] || {};
    return L[key] || key;
  }

  function labelBadge(cfg, kind, key) {
    var map = {
      stable: 'green', beta: 'amber', preview: 'violet',
      hotfix: 'red', major: 'blue', unstable: 'amber'
    };
    var cls = 'badge ' + (map[key] || '');
    if (kind === 'flag' && key === 'unstable') cls += ' dashed';
    return '<span class="' + cls + '">' + esc(labelText(cfg, kind, key)) + '</span>';
  }

  function assetKind(name) {
    var n = String(name || '').toLowerCase();
    if (n.endsWith('.jar')) return 'JAR';
    if (n.endsWith('.zip')) return 'ZIP';
    if (n.endsWith('.tar.gz')) return 'TGZ';
    return 'FILE';
  }

  function renderAssets(row) {
    var assets = (row.assets || []).slice();
    // jar 优先，其余（自动源码包）排在后面
    assets.sort(function (a, b) {
      var pa = /\.jar$/i.test(a.name) ? 0 : 1;
      var pb = /\.jar$/i.test(b.name) ? 0 : 1;
      return pa - pb;
    });
    if (!assets.length) {
      return '<p class="muted" style="margin:10px 0 0">这个版本没有可下载的文件，去发布页看看。</p>';
    }
    return '<div class="asset-list">' + assets.map(function (a) {
      var size = a.size ? '<span class="asset-size">' + humanSize(a.size) + '</span>' : '';
      return '<div class="asset">' +
        '<span class="asset-kind">' + assetKind(a.name) + '</span>' +
        '<span class="asset-name">' + esc(a.name) + '</span>' +
        size +
        '<a class="btn btn-sm btn-primary asset-dl" href="' + esc(a.url) + '" target="_blank" rel="noopener">下载</a>' +
        '</div>';
    }).join('') + '</div>';
  }

  function renderRelease(cfg, row) {
    var labels = labelBadge(cfg, 'channel', row.channel) +
      (row.flags || []).map(function (f) { return labelBadge(cfg, 'flag', f); }).join('');
    var srcBadge = row.platform === 'local'
      ? '<span class="badge outline">本站</span>'
      : '<span class="badge outline">' + (row.platform === 'gitee' ? 'Gitee' : 'GitHub') + '</span>';

    var el = document.createElement('article');
    el.className = 'release';
    el.innerHTML =
      '<div class="release-head" role="button" tabindex="0" aria-expanded="false">' +
        '<div>' +
          '<div class="release-tag">' + esc(row.tag) + '</div>' +
          '<div class="release-name">' + esc(row.name) + '</div>' +
        '</div>' +
        '<div class="release-meta">' +
          '<div class="release-labels">' + srcBadge + labels + '</div>' +
          '<div class="release-date">' + esc(fmtDate(row.date)) + '</div>' +
        '</div>' +
      '</div>' +
      '<div class="release-body">' +
        (row.notes ? '<div class="notes">' + esc(row.notes) + '</div>' : '<p class="muted">这个版本没有写发布说明。</p>') +
        renderAssets(row) +
        (row.htmlUrl ? '<div style="margin-top:14px"><a class="btn btn-sm btn-ghost" href="' + esc(row.htmlUrl) +
          '" target="_blank" rel="noopener">在发布页查看原文 ↗</a></div>' : '') +
      '</div>';

    var head = el.querySelector('.release-head');
    function toggle() {
      var open = el.classList.toggle('open');
      head.setAttribute('aria-expanded', open ? 'true' : 'false');
      if (open) el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
    head.addEventListener('click', toggle);
    head.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); }
    });
    return el;
  }

  function renderTabs(cfg, activeId, onPick) {
    var host = document.getElementById('modTabs');
    if (!host) return;
    host.innerHTML = (cfg.mods || []).map(function (m) {
      return '<button class="tab" role="tab" data-mod="' + esc(m.id) + '" aria-selected="' +
        (m.id === activeId ? 'true' : 'false') + '">' +
        '<span>' + esc(m.name) + '</span>' +
        '<span class="tab-modid">' + esc(m.modid) + '</span>' +
        '</button>';
    }).join('');
    host.querySelectorAll('.tab').forEach(function (b) {
      b.addEventListener('click', function () { onPick(b.getAttribute('data-mod')); });
    });
  }

  RBMK.UI = {
    classify: classify,
    humanSize: humanSize,
    fmtDate: fmtDate,
    esc: esc,
    buildIndex: buildIndex,
    renderRelease: renderRelease,
    renderTabs: renderTabs,
    labelText: labelText,
    sourceKey: sourceKey
  };

  /* ---------- 数据热更新 ----------
     页面先用 data/releases.js 里内联的快照秒开，再 fetch 一次
     assets/releases.json（旧工作流每 30 分钟提交一次这个文件），
     内容变新就重渲染。这样即使新的 deploy.yml 没启用，数据也不会陈旧。 */
  window.RBMKData = {
    refresh: function (done) {
      if (!/^https?:$/.test(location.protocol)) { done(false); return; }
      fetch('assets/releases.json', { cache: 'no-store' })
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (d) {
          if (!d || !d.repos) { done(false); return; }
          var old = window.__RBMK_DATA__;
          if (old && old.updated_at === d.updated_at) { done(false); return; }
          window.__RBMK_DATA__ = d;
          done(true);
        })
        .catch(function () { done(false); });
    }
  };

  /* ---------- 首页「收录一览」 ---------- */
  window.RBMKHome = {
    boot: function (cfg) {
      this.cfg = cfg;
      this.render(cfg);
      this.bootRefresh(cfg);
    },
    bootRefresh: function (cfg) {
      var self = this;
      window.RBMKData.refresh(function (changed) {
        if (changed) self.render(cfg);
      });
    },
    render: function (cfg) {
      var host = document.getElementById('collectTable');
      if (!host) return;
      var index = buildIndex(cfg);
      var rows = index.map(function (entry) {
        var mod = entry.mod;
        var stable = entry.rows.filter(function (r) { return r.channel === 'stable'; })[0] ||
          entry.rows[0];
        var jar = null, downloads = 0, hasCount = false;
        if (stable) {
          (stable.assets || []).forEach(function (a) {
            if (/\.jar$/i.test(a.name) && !jar) jar = a;
            if (typeof a.downloads === 'number') { downloads += a.downloads; hasCount = true; }
          });
        }
        return { mod: mod, stable: stable, jar: jar, downloads: hasCount ? downloads : null };
      });

      if (!rows.length) {
        host.innerHTML = '<tr><td colspan="5" class="muted">' +
          ((cfg.collect && cfg.collect.empty) || '暂无数据') + '</td></tr>';
        return;
      }

      host.innerHTML = rows.map(function (r) {
        var ver = r.stable ? '<span class="badge green">v' + esc(r.stable.tag) + '</span>' : '<span class="muted">—</span>';
        var file = r.jar
          ? '<a href="' + esc(r.jar.url) + '" target="_blank" rel="noopener" style="font-family:var(--mono);font-size:12.5px">' +
            esc(r.jar.name) + '</a>'
          : '<span class="muted">—</span>';
        var dl = r.downloads == null
          ? '<span class="muted" title="Gitee 不提供下载统计">不提供</span>'
          : String(r.downloads);
        return '<tr>' +
          '<td><b>' + esc(r.mod.name) + '</b><div class="muted" style="font-size:12px;font-family:var(--mono)">' +
          esc(r.mod.shortName) + '</div></td>' +
          '<td><code>' + esc(r.mod.modid) + '</code></td>' +
          '<td>' + ver + (r.stable ? '<div class="muted" style="font-size:12px;margin-top:4px">' +
            esc(fmtDate(r.stable.date)) + '</div>' : '') + '</td>' +
          '<td>' + file + '</td>' +
          '<td class="num">' + dl + '</td>' +
          '</tr>';
      }).join('');
    }
  };
})();
