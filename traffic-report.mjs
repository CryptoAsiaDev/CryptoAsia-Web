// Builds daily / weekly / monthly traffic reports from Umami Cloud.
// Env: UMAMI_API_KEY, UMAMI_WEBSITE_ID, optional UMAMI_API_URL (default https://api.umami.is/v1),
//      REPORT_OUT (default ./reports), REPORT_NOW (ISO time, for testing), REPORT_FORCE (daily|weekly|monthly|all)
import { mkdirSync, writeFileSync, appendFileSync } from 'node:fs';

const KL = 8 * 3600000; // Kuala Lumpur is UTC+8
const day = 86400000;

export function periodsFor(now) {
  const k = new Date(now.getTime() + KL);                       // shifted so UTC getters = KL clock
  const sod = Date.UTC(k.getUTCFullYear(), k.getUTCMonth(), k.getUTCDate()) - KL; // start of today KL, real ms
  const out = [{ kind: 'daily', start: sod - day, end: sod }];
  if (k.getUTCDay() === 1) out.push({ kind: 'weekly', start: sod - 7 * day, end: sod });
  if (k.getUTCDate() === 1) {
    const y = k.getUTCFullYear(), m = k.getUTCMonth();
    out.push({ kind: 'monthly', start: Date.UTC(y, m - 1, 1) - KL, end: sod });
  }
  return out;
}
const fmtDate = ms => new Date(ms + KL).toISOString().slice(0, 10);
const label = p => p.kind === 'daily' ? fmtDate(p.start) : `${fmtDate(p.start)} to ${fmtDate(p.end - 1)}`;

export async function collect(api, p, fetchFn = fetch) {
  const { base, key, id } = api;
  const headers = { 'x-umami-api-key': key, Authorization: 'Bearer ' + key, Accept: 'application/json' };
  const get = async (path, params) => {
    const q = new URLSearchParams({ startAt: p.start, endAt: p.end, ...params });
    const r = await fetchFn(`${base}/websites/${id}/${path}?${q}`, { headers });
    if (!r.ok) throw new Error(`${path} ${r.status}`);
    return r.json();
  };
  const val = v => (v && typeof v === 'object' && 'value' in v) ? v.value : v;
  const safe = async (fn, fb) => { try { return await fn(); } catch (e) { console.warn('warn:', e.message); return { error: e.message, v: fb }; } };
  const stats = await safe(() => get('stats'), {});
  const s = stats.error ? {} : stats;
  const list = async type => { const r = await safe(() => get('metrics', { type, limit: 10 }), []); return Array.isArray(r) ? r : []; };
  const events = await list('event');
  return {
    visitors: +val(s.visitors) || 0, pageviews: +val(s.pageviews) || 0, visits: +val(s.visits) || 0,
    bounces: +val(s.bounces) || 0, totaltime: +val(s.totaltime) || 0, statsError: stats.error || null,
    pages: await list('path'), referrers: await list('referrer'), countries: await list('country'),
    refClicks: events.filter(e => String(e.x).startsWith('ref-')),
  };
}

const pct = (a, b) => b ? Math.round((a - b) / b * 100) : null;
const chg = (a, b) => { const c = pct(a, b); return c === null ? '' : (c >= 0 ? '+' : '') + c + '%'; };
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export function render(p, cur, prev) {
  const bounce = cur.visits ? Math.round(cur.bounces / cur.visits * 100) : 0;
  const avg = cur.visits && cur.totaltime ? Math.round(cur.totaltime / cur.visits) : 0;
  const kpi = [['Visitors', 'visitors'], ['Pageviews', 'pageviews'], ['Visits', 'visits']];
  const tbl = (title, rows) => `<h2>${title}</h2>` + (rows.length ? `<table>${rows.map(r => `<tr><td>${esc(r.x || '(direct)')}</td><td class="n">${r.y}</td></tr>`).join('')}</table>` : '<p class="muted">No data.</p>');
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>Crypto Asia ${p.kind} report ${label(p)}</title>
<style>body{font-family:Arial,sans-serif;max-width:760px;margin:2rem auto;padding:0 1rem;color:#111}h1{border-bottom:4px solid #F5C518;padding-bottom:.4rem}h2{margin-top:2rem}
.k{display:flex;gap:1rem;flex-wrap:wrap}.c{border:1px solid #ddd;border-top:4px solid #F5C518;padding:1rem;flex:1;min-width:140px}.c b{font-size:1.8rem;display:block}
table{width:100%;border-collapse:collapse}td{padding:.35rem .5rem;border-bottom:1px solid #eee}.n{text-align:right;font-weight:bold}.muted{color:#777}</style></head><body>
<h1>Crypto Asia &mdash; ${p.kind[0].toUpperCase() + p.kind.slice(1)} traffic report</h1><p class="muted">cryptoasiabtc.com &middot; ${label(p)} (Kuala Lumpur time) &middot; vs previous equal period</p>
<div class="k">${kpi.map(([n, f]) => `<div class="c">${n}<b>${cur[f].toLocaleString('en')}</b><span class="muted">${chg(cur[f], prev[f])} (was ${prev[f].toLocaleString('en')})</span></div>`).join('')}
<div class="c">Bounce rate<b>${bounce}%</b></div>${avg ? `<div class="c">Avg visit<b>${Math.floor(avg / 60)}m ${avg % 60}s</b></div>` : ''}</div>
${cur.statsError ? `<p class="muted">Some totals could not be loaded (${esc(cur.statsError)}).</p>` : ''}
${tbl('Top pages', cur.pages)}${tbl('Top referrers', cur.referrers)}${tbl('Top countries', cur.countries)}${tbl('Referral link clicks', cur.refClicks.map(r => ({ x: String(r.x).slice(4), y: r.y })))}
<p class="muted" style="margin-top:2rem">Counts come from Umami (cookie-less, no personal data).</p></body></html>`;
  const csv = ['section,name,value', ...['visitors', 'pageviews', 'visits', 'bounces'].map(f => `total,${f},${cur[f]}`),
    ...[['page', cur.pages], ['referrer', cur.referrers], ['country', cur.countries], ['ref_click', cur.refClicks]].flatMap(([s, rows]) => rows.map(r => `${s},"${String(r.x).replace(/"/g, '""')}",${r.y}`))].join('\n');
  return { html, csv, json: JSON.stringify({ period: p.kind, from: label(p), current: cur, previous: prev }, null, 2), bounce };
}

export async function main(env = process.env, fetchFn = fetch) {
  const key = env.UMAMI_API_KEY, id = env.UMAMI_WEBSITE_ID;
  if (!key || !id) { console.log('UMAMI_API_KEY / UMAMI_WEBSITE_ID not set. Skipping.'); return []; }
  const api = { base: (env.UMAMI_API_URL || 'https://api.umami.is/v1').replace(/\/$/, ''), key, id };
  const now = env.REPORT_NOW ? new Date(env.REPORT_NOW) : new Date();
  let ps = periodsFor(now);
  if (env.REPORT_FORCE) { const t = periodsFor(new Date(now.getTime())); const d = t[0]; ps = env.REPORT_FORCE === 'all' ? ['daily','weekly','monthly'].map(k => ({ ...d, kind: k, start: k === 'daily' ? d.start : k === 'weekly' ? d.end - 7*day : d.end - 30*day })) : [{ ...d, kind: env.REPORT_FORCE, start: env.REPORT_FORCE === 'weekly' ? d.end - 7*day : env.REPORT_FORCE === 'monthly' ? d.end - 30*day : d.start }]; }
  const out = env.REPORT_OUT || 'reports'; mkdirSync(out, { recursive: true });
  const files = [];
  for (const p of ps) {
    const len = p.end - p.start;
    const cur = await collect(api, p, fetchFn);
    const prev = await collect(api, { ...p, start: p.start - len, end: p.start }, fetchFn);
    const r = render(p, cur, prev), base = `${out}/${p.kind}-${fmtDate(p.start)}`;
    writeFileSync(base + '.html', r.html); writeFileSync(base + '.csv', r.csv); writeFileSync(base + '.json', r.json);
    files.push(base);
    const md = `### ${p.kind} report: ${label(p)}\n| Visitors | Pageviews | Visits | Bounce |\n|---|---|---|---|\n| ${cur.visitors} (${chg(cur.visitors, prev.visitors) || 'n/a'}) | ${cur.pageviews} (${chg(cur.pageviews, prev.pageviews) || 'n/a'}) | ${cur.visits} | ${r.bounce}% |\n\n`;
    console.log(md);
    if (env.GITHUB_STEP_SUMMARY) appendFileSync(env.GITHUB_STEP_SUMMARY, md);
  }
  return files;
}
if (import.meta.url === `file://${process.argv[1]}`) main().catch(e => { console.error(e); process.exit(1); });
