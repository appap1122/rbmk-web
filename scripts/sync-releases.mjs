/* 发行版快照同步脚本：抓取 Gitee + GitHub 四个仓库的全部发行版，
 * 生成 assets/releases.json 供官网下载中心秒开与限流兜底。
 * 由 .github/workflows/sync-releases.yml 每 30 分钟调度；也可本地手动运行：node scripts/sync-releases.mjs
 */
import { writeFileSync, existsSync, readFileSync } from 'node:fs';

const TARGETS = [
  { platform: 'gitee',  repo: 'baldih/jiezhi-and-baldih-rbmk-monitor' },
  { platform: 'gitee',  repo: 'baldih/jiezhi-and-baldih-rbmk-monitor-reset' },
  { platform: 'github', repo: 'appap1122/jiezhi-and-baldih-rbmk-monitor' },
  { platform: 'github', repo: 'appap1122/jiezhi-and-baldih-rbmk-monitor-reset' },
];
const PRE = /(beta|rc\b|alpha|pre[-_]?release|snapshot)/i;
const OUT = new URL('../assets/releases.json', import.meta.url).pathname;

async function getJson(url, headers = {}) {
  const r = await fetch(url, {
    headers: { 'User-Agent': 'rbmk-web-release-sync', 'Accept': 'application/json', ...headers },
    redirect: 'follow',
  });
  if (!r.ok) throw new Error(`${url} -> HTTP ${r.status}`);
  return r.json();
}

async function fetchRepo(t) {
  const list = t.platform === 'gitee'
    ? await getJson(`https://gitee.com/api/v5/repos/${t.repo}/releases?per_page=100`, giteeHeaders())
    : await getJson(`https://api.github.com/repos/${t.repo}/releases?per_page=100`, githubHeaders());
  return (Array.isArray(list) ? list : [])
    .filter(x => t.platform === 'github' ? !x.draft : true)
    .map(x => ({
      tag: x.tag_name,
      name: x.name || '',
      notes: x.body || '',
      prerelease: !!x.prerelease || PRE.test(`${x.tag_name || ''} ${x.name || ''}`),
      date: x.published_at || x.created_at || '',
      htmlUrl: x.html_url || `https://${t.platform === 'gitee' ? 'gitee.com' : 'github.com'}/${t.repo}/releases`,
      assets: (x.assets || []).map(a => ({
        name: a.name,
        url: a.browser_download_url || a.url,
        size: a.size,
      })),
    }));
}

function giteeHeaders() {
  const h = {};
  if (process.env.GITEE_TOKEN) {
    /* 可选：Actions Secret 里配置 GITEE_TOKEN 可彻底避开匿名限流 */
    h['Authorization'] = `token ${process.env.GITEE_TOKEN}`;
  }
  return h;
}
function githubHeaders() {
  const h = {};
  if (process.env.GITHUB_TOKEN) {
    /* Actions 内置 GITHUB_TOKEN，避免 runner 共享 IP 的匿名限流 */
    h['Authorization'] = `Bearer ${process.env.GITHUB_TOKEN}`;
    h['X-GitHub-Api-Version'] = '2022-11-28';
  }
  return h;
}

const repos = {};
const errors = [];
for (const t of TARGETS) {
  try {
    repos[t.repo] = await fetchRepo(t);
    console.log(`ok  ${t.platform}  ${t.repo}  (${repos[t.repo].length} releases)`);
  } catch (e) {
    errors.push(`${t.platform}:${t.repo} ${e.message}`);
    console.error(`ERR ${t.platform}  ${t.repo}  ${e.message}`);
  }
}

if (errors.length === TARGETS.length) {
  console.error('全部仓库抓取失败，不写入快照');
  process.exit(1);
}

/* 保留上一次快照中抓取失败仓库的旧数据，避免快照倒退为空 */
if (errors.length && existsSync(OUT)) {
  try {
    const prev = JSON.parse(readFileSync(OUT, 'utf8'));
    for (const repo in prev.repos || {}) {
      if (!repos[repo] || !repos[repo].length) repos[repo] = prev.repos[repo] || [];
    }
  } catch { /* 旧快照损坏则忽略 */ }
}

const out = { updated_at: new Date().toISOString(), sources: TARGETS, repos };
writeFileSync(OUT, JSON.stringify(out, null, 2));
console.log(`written ${OUT}  updated_at=${out.updated_at}`);
if (errors.length) {
  console.warn(`部分仓库抓取失败（已沿用旧快照）：${errors.join(' | ')}`);
}
