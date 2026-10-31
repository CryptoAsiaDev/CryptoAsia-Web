// Daily: pulls perp DEX volume and open interest from DefiLlama, appends a snapshot to data/perps-history.json
// and writes perps-data.json for the site. No API key needed for the open endpoints (set DEFILLAMA_API_KEY if you have a Pro key).
// Env: PERPS_VOL_URL, PERPS_OI_URL override the endpoints. PERPS_NOW (ISO) for tests.
import { getVolumes } from './perps-sources.mjs';
import { readFileSync, writeFileSync, mkdirSync, existsSync, appendFileSync } from 'node:fs';

const VOL_URL = process.env.PERPS_VOL_URL || 'https://api.llama.fi/overview/derivatives?excludeTotalDataChart=true&excludeTotalDataChartBreakdown=true';
const OI_URL = process.env.PERPS_OI_URL || 'https://api.llama.fi/overview/open-interest?excludeTotalDataChart=true&excludeTotalDataChartBreakdown=true';
const TOP_N = 29;
const KEEP_DAYS = 400;

const norm = s => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const num = v => (typeof v === 'number' && isFinite(v)) ? v : 0;

async function getJson(url, f) {
  const h = { Accept: 'application/json' };
  if (process.env.DEFILLAMA_API_KEY) h['x-api-key'] = process.env.DEFILLAMA_API_KEY;
  const r = await f(url, { headers: h });
  if (!r.ok) throw new Error(`${url.split('?')[0]} -> HTTP ${r.status}`);
  return r.json();
}
function rows(d) { return Array.isArray(d && d.protocols) ? d.protocols : []; }
function keyOf(p) { return norm(p.slug || p.defillamaId || p.name); }
function matches(meta, p) {
  const hay = [norm(p.name), norm(p.displayName), norm(p.slug), norm(p.parentProtocol)].filter(Boolean);
  return meta.match.some(m => { const w = norm(m); return hay.some(h => h === w || h.split(' ').includes(w) || (w.length > 4 && h.includes(w))); });
}

export async function build({ meta, history, now, fetchFn = fetch }) {
  const warnings = [];
  let vol = [], oi = [];
  try { vol = rows(await getJson(VOL_URL, fetchFn)); } catch (e) { warnings.push('volume: ' + e.message); }
  try { oi = rows(await getJson(OI_URL, fetchFn)); } catch (e) { warnings.push('open interest: ' + e.message); }
  if (!vol.length && !oi.length) throw new Error('No data from DefiLlama. ' + warnings.join('; '));

  // merge by key
  const map = new Map();
  const put = (p, kind) => {
    const k = keyOf(p); const o = map.get(k) || { key: k, name: p.displayName || p.name, slug: p.slug, raw: p, oi: 0, v24: 0, v7: 0, v30: 0, logo: p.logo };
    if (kind === 'oi') o.oi = num(p.total24h) || num(p.total) || o.oi;
    else { o.v24 = num(p.total24h); o.v7 = num(p.total7d); o.v30 = num(p.total30d); }
    map.set(k, o);
  };
  oi.forEach(p => put(p, 'oi')); vol.forEach(p => put(p, 'vol'));
  const excl = (meta.exclude || []).map(norm);
  const all = [...map.values()].filter(p => !excl.some(w => norm(p.name + ' ' + (p.slug || '')).split(' ').includes(w) || norm(p.name).includes(w)));
  const diag = [];
  const ownVol = await getVolumes(meta, fetchFn, diag);

  const used = new Set(), out = [];
  const coverage = {};
  for (const m of meta.protocols) {
    const hit = all.find(p => !used.has(p.key) && matches(m, p.raw));
    coverage[m.id] = !!hit;
    if (hit) { used.add(hit.key); out.push({ ...hit, meta: m }); }
    else out.push({ key: m.id, name: m.name, oi: null, v24: null, v7: null, v30: null, meta: m, missing: true });
  }
  // fill remaining slots with biggest unlisted protocols by OI (then volume)
  const rest = all.filter(p => !used.has(p.key)).sort((a, b) => (b.oi - a.oi) || (b.v24 - a.v24));
  for (const p of rest) { if (out.filter(x => !x.missing).length >= TOP_N) break; out.push({ ...p, meta: { id: p.key, name: p.name, maker: null, taker: null, season: '', token: '' } }); }

  for (const p of out) {
    const own = ownVol[p.meta.id] || null; p.own = own;
    if (!own) { p.hasVol = !p.missing && p.v24 > 0; continue; }
    if (p.missing) { p.missing = false; p.oi = 0; p.v24 = 0; p.v7 = 0; p.v30 = 0; coverage[p.meta.id] = true; }
    if (!(p.oi > 0) && own.oi > 0) p.oi = own.oi;
    if (own.v24 > 0) p.v24 = own.v24;
    p.hasVol = p.v24 > 0;
  }
  const day = new Date(now.getTime() + 8 * 3600000).toISOString().slice(0, 10); // KL date
  const snap = { d: day, oi: 0, v24: 0, p: {} };
  for (const p of out) if (!p.missing) { snap.oi += p.oi; if (p.hasVol) snap.v24 += p.v24; snap.p[p.meta.id] = { oi: Math.round(p.oi), v: p.hasVol ? Math.round(p.v24) : null }; }
  snap.oi = Math.round(snap.oi); snap.v24 = Math.round(snap.v24);
  const hist = history.filter(h => h.d !== day).concat(snap).sort((a, b) => a.d.localeCompare(b.d)).slice(-KEEP_DAYS);

  // trend + signals from history
  const prev = hist.filter(h => h.d < day).slice(-7);
  const ref = prev.length ? prev[0] : null;
  const result = out.map(p => {
    const id = p.meta.id;
    const series = hist.slice(-30).map(h => (h.p[id] ? h.p[id].oi : null));
    const old = ref && ref.p[id] ? ref.p[id].oi : null;
    const oiChg7 = old && !p.missing ? (p.oi - old) / old * 100 : null;
    const pv = prev.map(h => h.p[id] && h.p[id].v).filter(x => x != null);
    const avgV = pv.length >= 3 ? pv.reduce((a, b) => a + b, 0) / pv.length : null;
    const vRatio = avgV && !p.missing && p.hasVol ? p.v24 / avgV : null;
    // 7d / 30d / total volume: use DefiLlama's own figure when we have it, otherwise add up our saved daily snapshots
    const vs = hist.map(h => (h.p[id] && h.p[id].v > 0) ? [h.d, h.p[id].v] : null).filter(Boolean);
    const since = d => new Date(Date.parse(day) - d * 86400000).toISOString().slice(0, 10);
    const win = n => { const a = vs.filter(x => x[0] > since(n)); return a.length ? { v: a.reduce((t, x) => t + x[1], 0), days: a.length } : { v: null, days: 0 }; };
    const o = p.own || {};
    const w7 = o.v7 > 0 ? { v: o.v7, days: 7 } : p.v7 > 0 ? { v: p.v7, days: 7 } : win(7), w30 = o.v30 > 0 ? { v: o.v30, days: 30 } : p.v30 > 0 ? { v: p.v30, days: 30 } : win(30);
    const wAll = o.vAll > 0 ? { v: o.vAll, days: 'all', since: null } : vs.length ? { v: vs.reduce((t, x) => t + x[1], 0), days: vs.length, since: vs[0][0] } : { v: null, days: 0, since: null };
    return { id, name: p.meta.name, logo: p.logo || null, slug: p.slug || null, listed: !p.missing,
      oi: p.oi > 0 ? p.oi : null, v24: p.hasVol ? p.v24 : null, v7: w7.v, v7days: w7.days, v30: w30.v, v30days: w30.days, vAll: wAll.v, vAllDays: wAll.days, vSince: wAll.since, maker: p.meta.maker ?? null, taker: p.meta.taker ?? null,
      season: p.meta.season || '', token: p.meta.token || '', ref: p.meta.ref || '', ours: !!(p.meta.match),
      oiChg7, vRatio, trend: series };
  });
  const signals = {
    oiUp: result.filter(r => r.oiChg7 != null && r.oiChg7 >= 10).sort((a, b) => b.oiChg7 - a.oiChg7).slice(0, 5).map(r => ({ id: r.id, name: r.name, v: r.oiChg7 })),
    oiDown: result.filter(r => r.oiChg7 != null && r.oiChg7 <= -10).sort((a, b) => a.oiChg7 - b.oiChg7).slice(0, 5).map(r => ({ id: r.id, name: r.name, v: r.oiChg7 })),
    volUp: result.filter(r => r.vRatio != null && r.vRatio >= 1.5).sort((a, b) => b.vRatio - a.vRatio).slice(0, 5).map(r => ({ id: r.id, name: r.name, v: r.vRatio })),
    volDown: result.filter(r => r.vRatio != null && r.vRatio <= 0.6).sort((a, b) => a.vRatio - b.vRatio).slice(0, 5).map(r => ({ id: r.id, name: r.name, v: r.vRatio })),
  };
  const data = { updated: now.toISOString(), source: 'DefiLlama', day, totals: { oi: snap.oi, v24: snap.v24, v7: Math.round(result.reduce((a, r) => a + num(r.v7), 0)), v30: Math.round(result.reduce((a, r) => a + num(r.v30), 0)), vAll: Math.round(result.reduce((a, r) => a + num(r.vAll), 0)), tracked: result.filter(r => r.listed).length },
    oiTrend: hist.slice(-60).map(h => [h.d, h.oi]), signals, warnings, sources: diag, coverage, protocols: result };
  return { data, hist, coverage, warnings, diag };
}

async function main() {
  const meta = JSON.parse(readFileSync('perps-meta.json', 'utf8'));
  mkdirSync('data', { recursive: true });
  const hist = existsSync('data/perps-history.json') ? JSON.parse(readFileSync('data/perps-history.json', 'utf8')) : [];
  const now = process.env.PERPS_NOW ? new Date(process.env.PERPS_NOW) : new Date();
  const { data, hist: h2, coverage, warnings, diag } = await build({ meta, history: hist, now });
  writeFileSync('perps-data.json', JSON.stringify(data));
  writeFileSync('data/perps-history.json', JSON.stringify(h2));
  const missing = Object.keys(coverage).filter(k => !coverage[k]);
  const md = `### Perps update ${data.day}\nTracked ${data.totals.tracked} protocols. OI $${(data.totals.oi / 1e6).toFixed(1)}M, 24h volume $${(data.totals.v24 / 1e6).toFixed(1)}M.\n` +
    (missing.length ? `\n**Not found on DefiLlama (shown as "--"):** ${missing.join(', ')}\n` : '\nAll listed DEXs found.\n') + (warnings.length ? `\nWarnings: ${warnings.join('; ')}\n` : '') + `\n**Volume sources**\n${diag.map(x => '- ' + x).join('\n')}\n`;
  console.log(md);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, md);
}
if (import.meta.url === `file://${process.argv[1]}`) main().catch(e => { console.error(e); process.exit(1); });
