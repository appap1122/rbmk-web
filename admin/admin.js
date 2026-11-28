/* admin.js — 后台界面逻辑。所有写入都走 /api/*，服务端才是唯一真相。 */
(function () {
  'use strict';

  var state = { config: null, local: { mods: {} }, uploads: [] };
  var $ = function (s) { return document.querySelector(s); };

  function setStatus(text, cls) {
    var el = $('#status');
    el.textContent = text;
    el.className = 'admin-status' + (cls ? ' ' + cls : '');
  }

  function api(path, opts) {
    return fetch(path, Object.assign({ headers: { 'Content-Type': 'application/json' } }, opts || {}))
      .then(function (r) { return r.json().then(function (b) { return { ok: r.ok, body: b }; }); });
  }

  /* ---------- 标签页 ---------- */
  function tabs() {
    document.querySelectorAll('.admin-tabs .tab').forEach(function (b) {
      b.addEventListener('click', function () {
        document.querySelectorAll('.admin-tabs .tab').forEach(function (x) {
          x.setAttribute('aria-selected', x === b ? 'true' : 'false');
        });
        document.querySelectorAll('.panel').forEach(function (p) {
          p.hidden = p.id !== 'panel-' + b.getAttribute('data-panel');
        });
      });
    });
  }

  /* ---------- 载入 ---------- */
  function load() {
    return api('/api/state').then(function (r) {
      if (!r.ok) throw new Error(r.body.error || '读取失败');
      state = r.body;
      setStatus('已连接 · 配置 ' + (state.config ? '就绪' : '缺失'), 'ok');
      $('#configText').value = JSON.stringify(state.config, null, 2);

      var synced = state.synced || {};
      var lines = Object.keys(synced.repos || {}).map(function (k) {
        return k + ' — ' + synced.repos[k] + ' 条';
      });
      $('#syncedSummary').textContent =
        '上次同步：' + (synced.updated_at || '从未') + '\n' + (lines.join('\n') || '（无数据）');

      var localLines = [];
      Object.keys(state.local.mods || {}).forEach(function (mod) {
        (state.local.mods[mod] || []).forEach(function (e) {
          localLines.push(mod + ' · ' + e.tag + ' — ' + (e.files || []).length + ' 个文件');
        });
      });
      $('#localSummary').textContent = localLines.join('\n') || '（还没有手工发布）';
      $('#uploadSummary').textContent = (state.uploads || []).join('\n') || '（public/downloads 为空）';

      fillModSelect();
      renderLocal();
      renderUploads();
      return state;
    }).catch(function (e) {
      setStatus('连接失败：' + e.message, 'err');
    });
  }

  function fillModSelect() {
    var sel = $('#pubMod');
    var mods = (state.config && state.config.mods) || [];
    sel.innerHTML = mods.map(function (m) {
      return '<option value="' + m.id + '">' + m.name + '</option>';
    }).join('');
  }

  /* ---------- 文案 ---------- */
  function bindConfig() {
    $('#configReload').addEventListener('click', load);
    $('#configSave').addEventListener('click', function () {
      var text = $('#configText').value;
      var parsed;
      try { parsed = JSON.parse(text); }
      catch (e) {
        $('#configMsg').className = 'msg err';
        $('#configMsg').textContent = 'JSON 语法错误：' + e.message;
        return;
      }
      api('/api/config', { method: 'PUT', body: JSON.stringify(parsed) }).then(function (r) {
        $('#configMsg').className = 'msg ' + (r.ok ? 'ok' : 'err');
        $('#configMsg').textContent = r.ok ? '已保存（旧版本存为 config.json.bak）' : ('保存失败：' + r.body.error);
        if (r.ok) load();
      });
    });
  }

  /* ---------- 手工发布 ---------- */
  function parseFiles(text) {
    return String(text || '').split('\n').map(function (line) {
      var parts = line.split('|').map(function (s) { return s.trim(); });
      if (!parts[0]) return null;
      return {
        name: parts[0],
        url: parts[1] || ('downloads/' + encodeURIComponent(parts[0])),
        size: parts[2] ? Number(parts[2]) : undefined
      };
    }).filter(Boolean);
  }

  function renderLocal() {
    var host = $('#localList');
    var items = [];
    Object.keys(state.local.mods || {}).forEach(function (mod) {
      (state.local.mods[mod] || []).forEach(function (e) {
        items.push({ mod: mod, entry: e });
      });
    });
    if (!items.length) {
      host.innerHTML = '<p class="muted small">还没有手工发布的条目。</p>';
      return;
    }
    host.innerHTML = items.map(function (it) {
      return '<div class="local-item">' +
        '<span class="badge amber">' + it.mod + '</span>' +
        '<b class="mono">' + it.entry.tag + '</b>' +
        '<span class="muted">' + (it.entry.name || '') + '</span>' +
        '<span class="muted mono small">' + (it.entry.files || []).length + ' 文件</span>' +
        '<button class="btn btn-sm btn-ghost del" data-del-mod="' + it.mod + '" data-del-tag="' + it.entry.tag + '">删除</button>' +
        '</div>';
    }).join('');
    host.querySelectorAll('[data-del-mod]').forEach(function (b) {
      b.addEventListener('click', function () {
        if (!confirm('删除 ' + b.getAttribute('data-del-tag') + '？')) return;
        api('/api/local?mod=' + encodeURIComponent(b.getAttribute('data-del-mod')) +
            '&tag=' + encodeURIComponent(b.getAttribute('data-del-tag')), { method: 'DELETE' })
          .then(load);
      });
    });
  }

  function bindPublish() {
    $('#publishForm').addEventListener('submit', function (ev) {
      ev.preventDefault();
      var f = ev.target;
      var payload = {
        mod: f.mod.value,
        tag: f.tag.value.trim(),
        name: f.name.value.trim(),
        date: f.date.value ? new Date(f.date.value).toISOString() : undefined,
        notes: f.notes.value,
        files: parseFiles(f.files.value)
      };
      if (!payload.tag) return;
      api('/api/local', { method: 'POST', body: JSON.stringify(payload) }).then(function (r) {
        if (r.ok) { f.reset(); load(); }
        else alert('保存失败：' + r.body.error);
      });
    });
  }

  /* ---------- 上传 ---------- */
  function renderUploads() {
    var host = $('#uploadList');
    var files = state.uploads || [];
    host.innerHTML = files.length
      ? files.map(function (n) { return '<div class="local-item"><span class="mono">' + n + '</span></div>'; }).join('')
      : '<p class="muted small">public/downloads 里还没有文件。</p>';
  }

  function bindUpload() {
    $('#uploadForm').addEventListener('submit', function (ev) {
      ev.preventDefault();
      var input = $('#uploadFile');
      if (!input.files.length) return;
      var fd = new FormData();
      fd.append('file', input.files[0]);
      setStatus('上传中…');
      fetch('/api/upload', { method: 'POST', body: fd })
        .then(function (r) { return r.json(); })
        .then(function (b) {
          $('#uploadMsg').className = 'msg ' + (b.ok ? 'ok' : 'err');
          $('#uploadMsg').textContent = b.ok
            ? ('已写入 ' + b.url + '（' + b.size + ' 字节）')
            : ('失败：' + b.error);
          setStatus('已连接', 'ok');
          return load();
        });
    });
  }

  /* ---------- 同步 / 构建 ---------- */
  function bindRun() {
    document.querySelectorAll('[data-task]').forEach(function (b) {
      b.addEventListener('click', function () {
        var task = b.getAttribute('data-task');
        var out = $('#runOut');
        out.textContent = '运行 ' + task + ' …\n';
        b.disabled = true;
        fetch('/api/run', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ task: task })
        }).then(function (r) { return r.json(); })
          .then(function (b2) {
            out.textContent += (b2.out || '') + '\n退出码 ' + b2.code;
            b.disabled = false;
            load();
          })
          .catch(function (e) {
            out.textContent += '\n失败：' + e.message;
            b.disabled = false;
          });
      });
    });
  }

  document.addEventListener('DOMContentLoaded', function () {
    tabs();
    bindConfig();
    bindPublish();
    bindUpload();
    bindRun();
    load();
  });
})();
