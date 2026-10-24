// Crypto Asia jobs board — verifier.
// Runs on a schedule (see .github/workflows/verify.yml). For every new submission it checks:
//   1. the wallet really signed the submission (signature check)
//   2. the content matches what was signed (hash check) and passes length / allowed-value rules
//   3. for paid listings: the USDC payment really happened on-chain, from that wallet, to the Crypto Asia
//      receiver, for at least the fee, after the submission was signed, with enough confirmations,
//      and the same payment has not been used before.
// Only then does it mark the row verified, which is the only thing that makes a listing public.
// Secrets needed: SUPABASE_SERVICE_KEY (never put this in the website).

import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { verifyMessage } from 'ethers';

const CONFIG_URL = new URL('../jobs-config.json', import.meta.url);
const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
const MAX_AGE_MS = 3 * 24 * 3600 * 1000;      // unpaid / unconfirmed submissions are dropped after 3 days

/* ---------- shared helpers (the website uses the same canonical form) ---------- */
export function canon(v) {
  if (Array.isArray(v)) return '[' + v.map(canon).join(',') + ']';
  if (v && typeof v === 'object') return '{' + Object.keys(v).sort().map(k => JSON.stringify(k) + ':' + canon(v[k])).join(',') + '}';
  return JSON.stringify(v);
}
export const sha256 = s => createHash('sha256').update(s).digest('hex');

/* ---------- content rules ---------- */
export function schemas(cfg) {
  const cat = cfg.categories, type = cfg.types;
  return {
    profile: { name: [80, 1], x: [100], telegram: [100], website: [200], about: [500] },
    job:     { company: [80, 1], title: [100, 1], type: [0, 1, type], category: [0, 1, cat], location: [100], salary: [100], apply: [200, 1], description: [1200] },
    seeker:  { name: [80, 1], headline: [100, 1], category: [0, 1, cat], type: [0, 1, type], location: [100], skills: [200], about: [1000], contact: [200, 1] }
  };
}
export function validateData(kind, data, cfg) {
  const spec = schemas(cfg)[kind];
  if (!spec) return 'unknown kind';
  if (!data || typeof data !== 'object' || Array.isArray(data)) return 'data must be an object';
  for (const k of Object.keys(data)) if (!(k in spec)) return 'unexpected field: ' + k;
  for (const [k, [max, req, allowed]] of Object.entries(spec)) {
    const v = data[k];
    if (v === undefined || v === '') { if (req) return 'missing: ' + k; continue; }
    if (typeof v !== 'string') return 'not text: ' + k;
    if (allowed) { if (!allowed.includes(v)) return 'bad value: ' + k; }
    else if (v.length > max) return 'too long: ' + k;
  }
  return '';
}

/* ---------- message ---------- */
export function parseMessage(msg) {
  const get = label => { const m = new RegExp('^' + label + ': (.+)$', 'm').exec(msg); return m ? m[1].trim() : ''; };
  return { wallet: get('Wallet').toLowerCase(), role: get('Role'), chain: Number(get('Chain')), data: get('Data'), issued: Date.parse(get('Issued')) };
}

/* ---------- JSON-RPC ---------- */
export function makeRpc(fetchImpl = fetch) {
  return async function rpc(url, method, params) {
    const r = await fetchImpl(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }), signal: AbortSignal.timeout(15000) });
    if (!r.ok) throw new Error('RPC HTTP ' + r.status);
    const j = await r.json();
    if (j.error) throw new Error('RPC ' + (j.error.message || 'error'));
    return j.result;
  };
}
const pad32 = a => '0x' + a.toLowerCase().replace(/^0x/, '').padStart(64, '0');
export function unitsFor(fee, decimals) {
  return BigInt(Math.round(fee * 100)) * 10n ** BigInt(decimals - 2);
}

/* ---------- verify one row ---------- */
// returns { status: 'verified' | 'pending' | 'rejected', reason? }
export async function verifyRow(row, cfg, rpc, now = Date.now()) {
  try {
    const kind = row.kind;
    const bad = validateData(kind, row.data, cfg);
    if (bad) return { status: 'rejected', reason: 'content: ' + bad };

    // 1. signature + what was signed
    const m = parseMessage(row.message || '');
    const wallet = String(row.wallet || '').toLowerCase();
    let signer = '';
    try { signer = verifyMessage(row.message, row.signature).toLowerCase(); } catch { return { status: 'rejected', reason: 'bad signature' }; }
    if (signer !== wallet || m.wallet !== wallet) return { status: 'rejected', reason: 'signer mismatch' };
    if (m.role !== row.role || (kind === 'job' && row.role !== 'employer') || (kind === 'seeker' && row.role !== 'seeker')) return { status: 'rejected', reason: 'role mismatch' };
    if (m.data !== sha256(canon(row.data))) return { status: 'rejected', reason: 'content changed after signing' };
    if (!m.issued || m.issued > now + 5 * 60e3 || now - m.issued > MAX_AGE_MS) return { status: 'rejected', reason: 'signature too old' };

    if (kind === 'profile') return { status: 'verified' };

    // 2. payment
    const chain = cfg.chains.find(c => c.id === row.chain_id);
    if (!chain || m.chain !== chain.id) return { status: 'rejected', reason: 'unsupported chain' };
    if (!/^0x[0-9a-f]{64}$/.test(row.tx_hash || '')) return { status: 'rejected', reason: 'no payment hash' };
    if (!/^0x[0-9a-fA-F]{40}$/.test(cfg.receiver || '')) return { status: 'pending', reason: 'receiver not configured' };

    const fee = kind === 'job' ? cfg.fees.employer : cfg.fees.seeker;
    const need = unitsFor(fee, chain.decimals);
    const rc = await rpc(chain.rpc, 'eth_getTransactionReceipt', [row.tx_hash]);
    if (!rc) return { status: 'pending', reason: 'payment not found yet' };
    if (rc.status !== '0x1') return { status: 'rejected', reason: 'payment failed on-chain' };

    const to = pad32(cfg.receiver), from = pad32(wallet);
    const ok = (rc.logs || []).some(l =>
      l.address && l.address.toLowerCase() === chain.usdc.toLowerCase() &&
      l.topics && l.topics[0] === TRANSFER_TOPIC && String(l.topics[1]).toLowerCase() === from && String(l.topics[2]).toLowerCase() === to &&
      BigInt(l.data || '0x0') >= need);
    if (!ok) return { status: 'rejected', reason: 'no matching USDC payment' };

    const head = BigInt(await rpc(chain.rpc, 'eth_blockNumber', []));
    if (head - BigInt(rc.blockNumber) < BigInt(chain.confirmations)) return { status: 'pending', reason: 'waiting for confirmations' };

    const blk = await rpc(chain.rpc, 'eth_getBlockByNumber', [rc.blockNumber, false]);
    if (Number(BigInt(blk.timestamp)) * 1000 < m.issued - 120e3) return { status: 'rejected', reason: 'payment is older than the submission' };

    return { status: 'verified' };
  } catch (e) {
    return { status: 'pending', reason: 'error: ' + e.message };      // network trouble: try again next run
  }
}

/* ---------- main ---------- */
export async function run({ fetchImpl = fetch, key = process.env.SUPABASE_SERVICE_KEY, now = Date.now() } = {}) {
  const cfg = JSON.parse(await readFile(CONFIG_URL, 'utf8'));
  if (!cfg.supabaseUrl) { console.log('supabaseUrl is empty in jobs-config.json — nothing to do.'); return { verified: 0 }; }
  if (!key) throw new Error('SUPABASE_SERVICE_KEY secret is not set.');
  const base = cfg.supabaseUrl.replace(/\/$/, '') + '/rest/v1/submissions';
  const H = { apikey: key, authorization: 'Bearer ' + key, 'content-type': 'application/json' };
  const rpc = makeRpc(fetchImpl);

  const r = await fetchImpl(base + '?verified=eq.false&reject_reason=is.null&order=created_at.asc&limit=100', { headers: H });
  if (!r.ok) throw new Error('Supabase read failed: HTTP ' + r.status);
  const rows = await r.json();
  console.log(rows.length + ' submission(s) waiting');

  let verified = 0, rejected = 0, pending = 0, dropped = 0;
  for (const row of rows) {
    const res = await verifyRow(row, cfg, rpc, now);
    if (res.status === 'verified') {
      const days = row.kind === 'profile' ? null : cfg.listingDays;
      const body = { verified: true, verified_at: new Date(now).toISOString(), expires_at: days ? new Date(now + days * 86400e3).toISOString() : null };
      const p = await fetchImpl(base + '?id=eq.' + row.id, { method: 'PATCH', headers: H, body: JSON.stringify(body) });
      if (!p.ok) { console.warn('  could not save row', row.id, p.status); continue; }
      verified++; console.log('  verified', row.kind, row.id);
    } else if (res.status === 'rejected') {
      await fetchImpl(base + '?id=eq.' + row.id, { method: 'PATCH', headers: H, body: JSON.stringify({ reject_reason: String(res.reason).slice(0, 200) }) });
      rejected++; console.log('  rejected', row.id, res.reason);
    } else if (now - Date.parse(row.created_at) > MAX_AGE_MS) {
      await fetchImpl(base + '?id=eq.' + row.id, { method: 'PATCH', headers: H, body: JSON.stringify({ reject_reason: 'expired: ' + String(res.reason).slice(0, 150) }) });
      dropped++; console.log('  dropped (3 days, never confirmed)', row.id, res.reason);
    } else { pending++; console.log('  waiting', row.id, res.reason); }
  }
  // housekeeping: remove rejected / expired rows after a week
  await fetchImpl(base + '?verified=eq.false&created_at=lt.' + encodeURIComponent(new Date(now - 7 * 86400e3).toISOString()), { method: 'DELETE', headers: H });
  console.log({ verified, rejected, pending, dropped });
  return { verified, rejected, pending, dropped };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  run().catch(e => { console.error(e.message); process.exit(1); });
}
