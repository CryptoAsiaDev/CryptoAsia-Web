// Free, keyless volume / open-interest sources for perp DEXs (their own public APIs; endpoints taken from
// DefiLlama's open-source dimension-adapters). Each adapter returns any of: { v24, v7, v30, vAll, oi } in USD.
// Every adapter is isolated: if one breaks, the others still work and the run summary shows which failed and why.
const DAY = 86400;
const UA = { Accept: 'application/json', 'User-Agent': 'cryptoasiabtc.com perps updater' };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const n = v => { const x = parseFloat(v); return isFinite(x) ? x : 0; };
const sum = (arr, fn) => (arr || []).reduce((a, x) => a + n(fn(x)), 0);
const nowS = () => Math.floor(Date.now() / 1000);
const dateStr = s => new Date(s * 1000).toISOString().slice(0, 10);

async function get(f, url, opts) {
  const r = await f(url, { headers: UA, ...(opts || {}) });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return r.json();
}
const post = (f, url, body) => get(f, url, { method: 'POST', headers: { ...UA, 'content-type': 'application/json' }, body: JSON.stringify(body) });
// find numeric values by key name anywhere in a response (used where the exact shape is unknown)
function dig(o, re, depth = 0) {
  if (o == null || depth > 4) return null;
  if (typeof o !== 'object') return null;
  for (const k of Object.keys(o)) { if (re.test(k) && isFinite(parseFloat(o[k])) && typeof o[k] !== 'object') return parseFloat(o[k]); }
  for (const k of Object.keys(o)) { const r = dig(o[k], re, depth + 1); if (r != null) return r; }
  return null;
}
// windows from a list of daily volumes (oldest first). The last entry is treated as the latest day.
function windows(daily) {
  const d = daily.filter(x => isFinite(x));
  if (!d.length) return {};
  const last = n => d.slice(-n).reduce((a, x) => a + x, 0);
  return { v24: d[d.length - 1], v7: d.length >= 7 ? last(7) : undefined, v30: d.length >= 30 ? last(30) : undefined };
}

export const ADAPTERS = {
  hyperliquid: async f => {
    const d = await get(f, 'https://api.hyperliquid.xyz/info', { method: 'POST', headers: { ...UA, 'content-type': 'application/json' }, body: JSON.stringify({ type: 'metaAndAssetCtxs' }) });
    const c = d[1] || [];
    return { v24: sum(c, x => x.dayNtlVlm), oi: sum(c, x => n(x.openInterest) * n(x.markPx)) };
  },
  aster: async f => ({ v24: sum(await get(f, 'https://fapi.asterdex.com/fapi/v1/ticker/24hr'), t => t.quoteVolume) }),
  paradex: async f => ({ v24: sum((await get(f, 'https://api.prod.paradex.trade/v1/markets/summary?market=ALL')).results, m => m.volume_24h) }),
  pacifica: async f => { const d = await get(f, 'https://api.pacifica.fi/api/v1/info/prices'); return { v24: sum(d.data || d, m => m.volume_24h) / 2 }; }, // taker + maker are both counted
  lighter: async f => ({ v24: sum((await get(f, 'https://mainnet.zklighter.elliot.ai/api/v1/orderBookDetails')).order_book_details, m => m.daily_quote_token_volume) }),
  variational: async f => { const d = await get(f, 'https://omni-client-api.prod.ap-northeast-1.variational.io/metadata/stats'); return { v24: n(d.total_volume_24h), oi: n(d.open_interest) / 2 }; },
  hibachi: async f => {
    const t = nowS(), q = s => get(f, `https://data-api.hibachi.xyz/exchange/stats/volumes?start_timestamp=${s}&end_timestamp=${t}`).then(r => sum(r.chain_volumes, c => c.volume));
    const [a, b, c, all] = await Promise.all([q(t - DAY), q(t - 7 * DAY), q(t - 30 * DAY), q(Math.floor(Date.parse('2025-06-01') / 1000))]);
    return { v24: a, v7: b, v30: c, vAll: all };
  },
  nado: async f => {
    const gw = 'https://gateway.prod.nado.xyz/v1', ar = 'https://archive.prod.nado.xyz/v1';
    const syms = (await get(f, gw + '/symbols')).map(s => s.product_id);
    const prods = (await get(f, gw + '/query?type=all_products')).data.perp_products.map(p => p.product_id).filter(id => syms.includes(id));
    const r = await post(f, ar, { market_snapshots: { interval: { count: 31, granularity: DAY, max_time: nowS() }, product_ids: prods } });
    const sn = r.snapshots; if (!Array.isArray(sn) || sn.length < 2) throw new Error('no snapshots');
    const tot = i => Number(Object.values(sn[i].cumulative_volumes).reduce((a, c) => a + BigInt(c), 0n) / 10n ** 18n);
    const t0 = tot(0);
    return { v24: t0 - tot(1), v7: sn.length > 7 ? t0 - tot(7) : undefined, v30: sn.length > 30 ? t0 - tot(30) : undefined, vAll: t0 };
  },
  extended: async f => {
    const base = 'https://api.starknet.extended.exchange/api/v1';
    const mk = (await get(f, base + '/info/markets')).data || [];
    const out = { oi: sum(mk, m => m.marketStats && m.marketStats.openInterest) / 2, v24: sum(mk, m => m.marketStats && m.marketStats.dailyVolume) };
    const days = []; const today = nowS() - (nowS() % DAY);
    for (let i = 30; i >= 1; i--) { // last 30 full days
      const d = dateStr(today - i * DAY);
      try { const r = await get(f, `${base}/exchange/stats/trading?fromDate=${d}&toDate=${d}`); days.push(sum(r.data, x => x.tradingVolume) / 2); } catch (e) { days.push(NaN); }
    }
    const ok = days.filter(isFinite);
    if (ok.length >= 7) { out.v7 = days.slice(-7).filter(isFinite).reduce((a, x) => a + x, 0); if (ok.length >= 30) out.v30 = ok.reduce((a, x) => a + x, 0); }
    return out;
  },
  bulk: async f => {
    const api = 'https://mainnet-api1.bulk.trade/api/v1';
    const syms = [...new Set((await get(f, api + '/exchangeInfo')).filter(m => m.quoteAsset === 'USD').map(m => m.symbol))];
    const per = {};
    for (const s of syms) {
      try { const c = await get(f, `${api}/klines?symbol=${encodeURIComponent(s)}&interval=1d`); (Array.isArray(c) ? c : []).forEach(k => { per[k.t] = (per[k.t] || 0) + n(k.c) * n(k.v); }); } catch (e) {}
      await sleep(250);
    }
    const days = Object.keys(per).map(Number).sort((a, b) => a - b).map(k => per[k]);
    if (!days.length) throw new Error('no candles');
    const w = windows(days.slice(0, -1)); // drop today's partial candle: "24h" = latest full day
    return { ...w, vAll: days.reduce((a, x) => a + x, 0) };
  },
  n1: async f => {
    const api = 'https://api-mainnet.n1.xyz';
    const ms = ((await get(f, api + '/info')).markets || []).filter(m => String(m.symbol).endsWith('USD'));
    let v = 0, oi = 0, ok = 0;
    for (const m of ms) {
      try { const s = await get(f, `${api}/market/${m.marketId}/stats`); v += n(s.volumeQuote24h); oi += n(s.perpStats && s.perpStats.open_interest) * n(s.indexPrice); ok++; } catch (e) {}
      await sleep(200);
    }
    if (!ok) throw new Error('no market stats');
    return { v24: v, oi };
  },
  risex: async f => {
    const api = 'https://api.rise.trade/api/v1', NS = 1e9;
    const ids = ((await get(f, api + '/markets')).data.markets || []).map(m => Number(m.market_id));
    const per = {}; const to = nowS() * NS, from = Math.floor(Date.parse('2026-04-01') / 1000) * NS;
    for (const id of ids) {
      try { const r = await get(f, `${api}/trading-view-data?market_id=${id}&interval=${DAY * NS}&from=${from}&to=${to}`); (r.data.data || []).forEach(c => { per[c.time] = (per[c.time] || 0) + n(c.close) * n(c.volume); }); } catch (e) {}
      await sleep(1000);
    }
    const days = Object.keys(per).sort((a, b) => a - b).map(k => per[k]);
    if (!days.length) throw new Error('no candles');
    return { ...windows(days), vAll: days.reduce((a, x) => a + x, 0) };
  },
  aftermath: async f => {
    const api = 'https://aftermath.finance/api/perpetuals';
    const mk = (await post(f, api + '/all-markets', { collateralCoinType: '0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC' })).markets || [];
    if (!mk.length) throw new Error('no markets');
    const out = { oi: sum(mk, m => n(m.marketState && m.marketState.openInterest) * n(m.indexPrice)) };
    const per = {}, to = Date.now(), from = to - 31 * DAY * 1000;
    for (const m of mk) {
      try { const r = await post(f, api + '/market/candle-history', { marketId: m.objectId, resolution: '1d', fromTimestamp: from, toTimestamp: to }); (r.candles || []).forEach(c => { per[c.timestamp] = (per[c.timestamp] || 0) + n(c.volume); }); } catch (e) {}
      await sleep(300);
    }
    const days = Object.keys(per).map(Number).sort((a, b) => a - b).map(k => per[k]);
    return days.length ? { ...out, ...windows(days) } : out;
  },
  imperial: async f => {
    const api = 'https://api.imperial.trade/api/v1/stats';
    const out = {}; let note = '';
    try {
      const s = await get(f, api + '/summary');
      const k = Object.keys(s || {}).join(',');
      note = 'summary keys: ' + k.slice(0, 120);
      out.v24 = dig(s, /^(volume24h|volume_24h|dailyVolume|volume1d|volumeUsd24h|volume)$/i) ?? undefined;
      out.oi = dig(s, /open_?interest/i) ?? undefined;
      const tot = dig(s, /(total_?volume|allTime|cumulative)/i); if (tot != null) out.vAll = tot;
    } catch (e) { note = 'summary failed: ' + e.message; }
    const range = async (a, b) => {
      for (const mul of [1, 1000]) { // seconds, then milliseconds
        try { const r = await get(f, `${api}/volume/range?startTs=${a * mul}&endTs=${b * mul}&venue=sunrise`); const v = dig(r, /^volumeUsd$/i), l = dig(r, /^liquidationVolumeUsd$/i) || 0; if (v != null) return Math.max(0, v - l); } catch (e) {}
      }
      return undefined;
    };
    const t = nowS();
    const [d1, d7, d30] = [await range(t - DAY, t), await range(t - 7 * DAY, t), await range(t - 30 * DAY, t)];
    if (d1 != null) out.v24 = d1; if (d7 != null) out.v7 = d7; if (d30 != null) out.v30 = d30;
    const all = await range(Math.floor(Date.parse('2025-06-01') / 1000), t); if (all != null) out.vAll = all;
    if (out.v24 == null && out.oi == null) throw new Error('no usable numbers (' + note + ')');
    out._note = note; return out;
  },
};

// Generic fallback: CoinGecko derivatives exchanges (24h volume in BTC) for DEXs that have no adapter, or whose adapter failed.
export async function coingeckoVolumes(f) {
  const [ex, px] = await Promise.all([
    get(f, 'https://api.coingecko.com/api/v3/derivatives/exchanges?per_page=100'),
    get(f, 'https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd'),
  ]);
  const btc = px && px.bitcoin && px.bitcoin.usd; if (!btc) throw new Error('no BTC price');
  return (ex || []).map(e => ({ name: String(e.name || ''), id: String(e.id || ''), v24: n(e.trade_volume_24h_btc) * btc }));
}

const fmt = v => v == null ? '-' : '$' + (v >= 1e9 ? (v / 1e9).toFixed(2) + 'B' : (v / 1e6).toFixed(1) + 'M');
export async function getVolumes(meta, f, diag) {
  const out = {};
  for (const m of meta.protocols) {
    const ad = ADAPTERS[m.id]; if (!ad) { diag.push(`${m.id}: no public source found yet`); continue; }
    try {
      const r = await ad(f);
      if ((r.v24 > 0) || (r.oi > 0)) { out[m.id] = r; diag.push(`${m.id}: OK 24h ${fmt(r.v24)} 7d ${fmt(r.v7)} 30d ${fmt(r.v30)} total ${fmt(r.vAll)} OI ${fmt(r.oi)}${r._note ? ' [' + r._note + ']' : ''}`); }
      else diag.push(`${m.id}: API answered but gave no usable numbers`);
    } catch (e) { diag.push(`${m.id}: FAILED (${e.message})`); }
  }
  const need = meta.protocols.filter(m => !(m.id in out));
  if (need.length) {
    try {
      const cg = await coingeckoVolumes(f);
      for (const m of need) {
        const words = m.match.map(w => w.toLowerCase());
        const hit = cg.find(e => words.some(w => e.id.toLowerCase().includes(w) || e.name.toLowerCase().includes(w)));
        if (hit && hit.v24 > 0) { out[m.id] = { v24: hit.v24 }; diag.push(`${m.id}: OK 24h ${fmt(hit.v24)} (CoinGecko)`); }
      }
    } catch (e) { diag.push('CoinGecko fallback failed (' + e.message + ')'); }
  }
  return out;
}
