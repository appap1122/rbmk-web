/* RBMK 显示屏官网 · 共享脚本：主题切换 + 导航高亮 + 下载中心（快照 + 实时双通道） */
(function () {
  /* ---------- 主题 ---------- */
  var btn = document.getElementById('themeBtn');
  var root = document.documentElement;
  function applyTheme(dark) {
    if (dark) { root.setAttribute('data-theme', 'dark'); if (btn) btn.textContent = '☀️'; }
    else { root.removeAttribute('data-theme'); if (btn) btn.textContent = '🌙'; }
    try { localStorage.setItem('rbmk-theme', dark ? 'dark' : 'light'); } catch (e) {}
  }
  try {
    var qTheme = new URLSearchParams(location.search).get('theme');
    if (qTheme === 'dark') applyTheme(true);
    else if (localStorage.getItem('rbmk-theme') === 'dark') applyTheme(true);
  } catch (e) {}
  if (btn) btn.addEventListener('click', function () { applyTheme(root.getAttribute('data-theme') !== 'dark'); });

  /* ---------- 导航高亮 ---------- */
  var here = location.pathname.split('/').pop() || 'index.html';
  document.querySelectorAll('nav.links a').forEach(function (a) {
    var target = a.getAttribute('href').split('#')[0];
    if (target === here) a.classList.add('active');
  });
})();

/* ================= 下载中心（仅 download.html 存在挂载点时生效） ================= */
(function () {
  var elSegLine = document.getElementById('segLine');
  var elSegSrc = document.getElementById('segSrc');
  if (!elSegLine || !elSegSrc) return;

  var LINES = {
    vanilla: {
      label: '原版线',
      desc: 'modid jiezhirbmkmod · TESR 渲染 · 支持倾斜吊装',
      gitee: 'baldih/jiezhi-and-baldih-rbmk-monitor',
      github: 'appap1122/jiezhi-and-baldih-rbmk-monitor',
      page: {
        gitee: 'https://gitee.com/baldih/jiezhi-and-baldih-rbmk-monitor/releases',
        github: 'https://github.com/appap1122/jiezhi-and-baldih-rbmk-monitor/releases'
      }
    },
    reset: {
      label: '重置版',
      desc: 'modid rbmkdisplay · 零 TESR · 平贴安装',
      gitee: 'baldih/jiezhi-and-baldih-rbmk-monitor-reset',
      github: 'appap1122/jiezhi-and-baldih-rbmk-monitor-reset',
      page: {
        gitee: 'https://gitee.com/baldih/jiezhi-and-baldih-rbmk-monitor-reset/releases',
        github: 'https://github.com/appap1122/jiezhi-and-baldih-rbmk-monitor-reset/releases'
      }
    }
  };
  var SNAPSHOT_URL = 'assets/releases.json?v=2';
  var state = { line: 'vanilla', source: 'gitee' }; /* 下载源默认 Gitee，优先展示 */
  var seq = 0;
  var snapshot = null;   /* { updated_at, repos: { "owner/repo": [release...] } } */
  var snapshotLoaded = false;
  var liveDone = false;

  function seg(el, key) {
    el.querySelectorAll('button').forEach(function (b) { b.classList.toggle('on', b.dataset.v === key); });
  }
  function fmtDate(s) {
    if (!s) return '';
    var d = new Date(s);
    if (isNaN(d.getTime())) return s;
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }
  function fmtSize(n) {
    if (n == null || isNaN(n)) return '';
    if (n >= 1048576) return (n / 1048576).toFixed(1) + ' MB';
    if (n >= 1024) return (n / 1024).toFixed(0) + ' KB';
    return n + ' B';
  }
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function linkify(s) {
    return esc(s).replace(/(https?:\/\/[^\s<>"')\]]+)/g, '<a href="$1" target="_blank" rel="noopener">$1</a>');
  }
  /* Pre-release 判定：平台标记优先，标签/名称含 beta·rc·alpha·snapshot 等也归为测试版 */
  function isPre(tag, name, flag) {
    return !!flag || /(beta|rc\b|alpha|pre[-_]?release|snapshot)/i.test((tag || '') + ' ' + (name || ''));
  }

  /* ---------- 快照（GitHub Actions 每 30 分钟同步 Gitee/GitHub 生成） ---------- */
  fetch(SNAPSHOT_URL).then(function (r) { return r.ok ? r.json() : null; }).then(function (j) {
    snapshot = j && j.repos ? j : null;
  }).catch(function () { snapshot = null; }).then(function () {
    snapshotLoaded = true;
    if (!liveDone) renderSnapshot(null);   /* 实时还没回来 → 先秒开快照 */
  });

  function renderSnapshot(notice) {
    if (!snapshot) return false;
    var rels = snapshot.repos[LINES[state.line][state.source]];
    if (!rels || !rels.length) return false;
    renderList(JSON.parse(JSON.stringify(rels)), notice);
    return true;
  }

  /* ---------- 实时直连（每次只发 1 个请求，从列表推断 Latest，降低限流概率） ---------- */
  function fetchRetry(url, tries) {
    var n = tries || 2;
    function attempt(left) {
      return fetch(url).then(function (r) {
        if (!r.ok) { var e = new Error('HTTP ' + r.status); e.status = r.status; throw e; }
        return r.json();
      }).catch(function (e) {
        if (left > 0 && e.status !== 403 && e.status !== 429) { return attempt(left - 1); }
        throw e;
      });
    }
    return attempt(n - 1);
  }

  function fetchReleases(source, repo) {
    var base = source === 'gitee'
      ? 'https://gitee.com/api/v5/repos/' + repo + '/releases'
      : 'https://api.github.com/repos/' + repo + '/releases';
    return fetchRetry(base + '?per_page=100').then(function (list) {
      return (list || []).filter(function (x) {
        return source === 'github' ? !x.draft : true;
      }).map(function (x) {
        return {
          tag: x.tag_name, name: x.name || '', notes: x.body || '',
          prerelease: isPre(x.tag_name, x.name || '', x.prerelease),
          date: x.published_at || x.created_at || '',
          htmlUrl: x.html_url || LINES[state.line].page[source],
          assets: (x.assets || []).map(function (a) {
            return { name: a.name, url: a.browser_download_url || a.url, size: a.size };
          })
        };
      });
    });
  }

  /* ---------- 渲染 ---------- */
  function renderList(rels, notice) {
    var host = document.getElementById('relHost');
    var noticeHtml = notice ? '<div class="dl-notice">ℹ️ ' + esc(notice) + '</div>' : '';
    if (!rels.length) {
      host.innerHTML = noticeHtml + '<div class="dl-state">该仓库在「' + (state.source === 'gitee' ? 'Gitee' : 'GitHub') +
        '」上暂无发行版——可切换下载源试试，或直接打开发行版页面查看。</div>';
      return;
    }
    rels.sort(function (a, b) { return new Date(b.date || 0) - new Date(a.date || 0); });
    /* Latest = 最新一个非测试版；若全部为测试版则取最新一个 */
    var li = -1;
    for (var i = 0; i < rels.length; i++) { if (!rels[i].prerelease) { li = i; break; } }
    if (li < 0) li = 0;
    var html = rels.map(function (r, idx) {
      var flags = '';
      if (idx === li) flags += '<span class="flag latest">Latest</span>';
      if (r.prerelease) flags += '<span class="flag pre">Pre-release</span>';
      var assets = r.assets.map(function (a) {
        return '<a class="asset-btn hot" href="' + esc(a.url) + '" target="_blank" rel="noopener">⬇ ' + esc(a.name) +
          (a.size ? '<span class="sz">' + fmtSize(a.size) + '</span>' : '') + '</a>';
      }).join('');
      if (!assets) assets = '<span style="font-size:13px;color:var(--ink-3)">（此版本未附附件，请到发行版页面下载）</span>';
      var snapTag = (!liveDone && snapshot && snapshot.updated_at)
        ? '<span class="sz" style="font-size:11.5px;color:var(--ink-3)"> · 快照 ' + fmtDate(snapshot.updated_at) + '</span>' : '';
      return '<div class="rel-card' + (idx === li ? ' latest' : '') + '">' +
        '<div class="rel-top"><span class="rel-tag">' + esc(r.tag) + '</span>' + flags +
        '<span class="rel-date">' + fmtDate(r.date) + snapTag + '</span></div>' +
        (r.name && r.name !== r.tag ? '<div class="rel-name">' + esc(r.name) + '</div>' : '') +
        (r.notes ? '<div class="rel-notes">' + linkify(r.notes) + '</div>' : '') +
        '<div class="rel-assets">' + assets + '</div>' +
        '<div class="rel-links">发行版详情：<a href="' + esc(r.htmlUrl) + '" target="_blank" rel="noopener">' +
        esc(r.htmlUrl) + '</a></div>' +
        '</div>';
    }).join('');
    host.innerHTML = noticeHtml + '<div class="rel-list">' + html + '</div>';
  }

  function showLoading() {
    document.getElementById('relHost').innerHTML =
      '<div class="dl-state"><span class="spin"></span><div>正在从 ' + (state.source === 'gitee' ? 'Gitee' : 'GitHub') +
      ' 实时拉取「' + LINES[state.line].label + '」的全部发行版…</div></div>';
  }

  function showError(msg) {
    var other = state.source === 'gitee' ? 'github' : 'gitee';
    document.getElementById('relHost').innerHTML =
      '<div class="dl-state err"><b>实时抓取失败：</b>' + esc(msg) +
      '<br>可能是网络波动、平台接口限流或该仓库暂无发行版。可重试、切换下载源，或直接打开发行版页面。' +
      '<div class="dl-actions">' +
      '<button class="asset-btn" id="retryBtn">🔄 重试</button>' +
      '<button class="asset-btn" id="switchBtn">切换到 ' + (other === 'gitee' ? 'Gitee' : 'GitHub') + '</button>' +
      '<a class="asset-btn" href="' + esc(LINES[state.line].page[state.source]) + '" target="_blank" rel="noopener">打开发行版页面 ↗</a>' +
      '</div></div>';
    document.getElementById('retryBtn').addEventListener('click', function () { load(); });
    document.getElementById('switchBtn').addEventListener('click', function () { setSource(other); });
  }

  function updateDesc() {
    document.getElementById('lineDesc').textContent = LINES[state.line].label + ' · ' + LINES[state.line].desc;
  }

  /* 加载：优先秒出快照 → 后台实时刷新覆盖；实时失败则保留快照并提示 */
  function load() {
    var my = ++seq;
    updateDesc();
    if (!renderSnapshot(null)) showLoading();
    fetchReleases(state.source, LINES[state.line][state.source]).then(function (rels) {
      if (my !== seq) return;
      liveDone = true;
      renderList(rels, null);
    }).catch(function (e) {
      if (my !== seq) return;
      var st = e && e.status;
      if (renderSnapshot(fallbackNotice(st))) return;   /* 快照兜底，不甩错误框 */
      showError(e && e.message ? e.message : '未知错误');
    });
  }

  function fallbackNotice(st) {
    var plat = state.source === 'gitee' ? 'Gitee' : 'GitHub';
    if (st === 403 || st === 429) return plat + ' 开放接口对本机限流（HTTP ' + st + '），以下为站点自动同步的快照数据（每 30 分钟更新，下载链接始终有效）';
    return '实时接口暂时不可用（' + (st ? 'HTTP ' + st : '网络异常') + '），以下为站点自动同步的快照数据（每 30 分钟更新，下载链接始终有效）';
  }

  function setLine(v) { state.line = v; liveDone = false; seg(elSegLine, v); load(); }
  function setSource(v) { state.source = v; liveDone = false; seg(elSegSrc, v); load(); }

  elSegLine.querySelectorAll('button').forEach(function (b) {
    b.addEventListener('click', function () { setLine(b.dataset.v); });
  });
  elSegSrc.querySelectorAll('button').forEach(function (b) {
    b.addEventListener('click', function () { setSource(b.dataset.v); });
  });

  /* 支持 download.html?line=reset&src=github 深链 */
  var q = new URLSearchParams(location.search);
  if (q.get('line') === 'reset' || q.get('line') === 'vanilla') { state.line = q.get('line'); seg(elSegLine, state.line); }
  if (q.get('src') === 'gitee' || q.get('src') === 'github') { state.source = q.get('src'); seg(elSegSrc, state.source); }
  load();
})();
