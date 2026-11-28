/**
 * release-labels.mjs — 版本标签判定规则（唯一权威实现）。
 *
 * 判定只看 Tag 与发行版标题，不做人工归类：
 *   通道   -beta -> 测试版，-preview -> 预览版，其余 -> 正式版
 *          发行版被标成 prerelease 且通道仍是正式版时，降级为测试版
 *   性质   hotfix / 紧急修复        -> hotfix
 *          major / 重大更新         -> major
 *          unstable / experimental / 不稳定 -> unstable
 *
 * 前端 assets/js/mods.js 里有一份等价的 classify()，两边必须保持同一套规则。
 * 同步脚本会把判定结果直接写进数据（channel / flags），所以线上页面
 * 正常情况下根本不跑前端那份，只是兜底。
 */

const HOTFIX = /(^|[^a-z])(hotfix|fix)([^a-z]|$)|紧急修复/i;
const MAJOR = /(^|[^a-z])(major)([^a-z]|$)|重大更新/i;
const UNSTABLE = /(unstable|experimental|alpha)|不稳定/i;

export const CHANNELS = ['stable', 'beta', 'preview'];
export const FLAGS = ['hotfix', 'major', 'unstable'];

export function classify(tag, name, prerelease = false) {
  const t = String(tag || '');
  const n = String(name || '');
  const hay = `${t} ${n}`;

  let channel = 'stable';
  if (/-beta/i.test(t) || /beta/i.test(n)) channel = 'beta';
  else if (/-preview/i.test(t) || /preview/i.test(n)) channel = 'preview';
  if (prerelease && channel === 'stable') channel = 'beta';

  const flags = [];
  if (HOTFIX.test(hay)) flags.push('hotfix');
  if (MAJOR.test(hay)) flags.push('major');
  if (UNSTABLE.test(hay)) flags.push('unstable');

  return { channel, flags };
}

/** 版本比较用的数字键，仅用于排序兜底（日期缺失时）。 */
export function versionKey(tag) {
  return String(tag || '')
    .replace(/^v/i, '')
    .split(/[.\-+_ ]/)
    .map((p) => {
      const m = p.match(/^(\d+)/);
      return m ? Number(m[1]) : 0;
    });
}
