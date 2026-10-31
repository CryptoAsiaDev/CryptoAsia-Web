// Crypto Asia NFT Studio — verifier for paid exports.
// For every new row in studio_exports it checks: the wallet signed the message, the message matches the row
// (wallet, collection version, size, chain), the fee matches the price list in studio-config.json, and the USDC
// payment really happened on-chain (from that wallet, to the receiver, at least the price, enough confirmations,
// not older than the signature). Only then is the row marked verified.
// Secret needed: SUPABASE_SERVICE_KEY.

import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { verifyMessage } from 'ethers';
import { makeRpc, unitsFor } from './verify-submissions.mjs';

const JOBS_CFG = new URL('../jobs-config.json', import.meta.url);
const STUDIO_CFG = new URL('../studio-config.json', import.meta.url);
const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
const MAX_AGE_MS = 3 * 24 * 3600 * 1000;
const pad32 = a => '0x' + a.toLowerCase().replace(/^0x/, '').padStart(64, '0');

export function priceFor(size, tiers) {
  for (const t of tiers) if (t.upTo === null || size <= t.upTo) return t.price;
  return tiers[tiers.length - 1].price;
}
export function parseMessage(msg) {
  const get = label => { const m = new RegExp('^' + label + ': (.+)$', 'm').exec(msg); return m ? m[1].trim() : ''; };
  return { wallet: get('Wallet').toLowerCase(), version: get('Version').toLowerCase(), size: Number(get('Size')), chain: Number(get('Chain')), fee: Number(get('Fee').replace(/ USDC$/, '')), issued: Date.parse(get('Issued')) };
}

export async function verifyRow(row, cfg, scfg, rpc, now = Date.now()) {
  try {
    const m = parseMessage(row.message || '');
    const wallet = String(row.wallet || '').toLowerCase();
    let signer = '';
    try { signer = verifyMessage(row.message, row.signature).toLowerCase(); } catch { return { status: 'rejected', reason: 'bad signature' }; }
    if (signer !== wallet || m.wallet !== wallet) return { status: 'rejected', reason: 'signer mismatch' };
    if (m.version !== row.fingerprint) return { status: 'rejected', reason: 'version mismatch' };
    if (m.size !== row.size || row.size < 1 || row.size > scfg.maxSize) return { status: 'rejected', reason: 'size mismatch' };
    if (m.chain !== row.chain_id) return { status: 'rejected', reason: 'chain mismatch' };
    const price = priceFor(row.size, scfg.tiers);
    if (m.fee < price || Number(row.fee) < price) return { status: 'rejected', reason: 'fee below price list' };
    if (!m.issued || m.issued > now + 5 * 60e3 || now - m.issued > MAX_AGE_MS) return { status: 'rejected', reason: 'signature too old' };

    const chain = cfg.chains.find(c => c.id === row.chain_id);
    if (!chain) return { status: 'rejected', reason: 'unsupported chain' };
    if (!/^0x[0-9a-fA-F]{40}$/.test(cfg.receiver || '')) return { status: 'pending', reason: 'receiver not configured' };

    const need = unitsFor(price, chain.decimals);
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
    if (Number(BigInt(blk.timestamp)) * 1000 < m.issued - 120e3) return { status: 'rejected', reason: 'payment is older than the signature' };
    return { status: 'verified' };
  } catch (e) {
    return { status: 'pending', reason: 'error: ' + e.message };
  }
}

export async function run({ fetchImpl = fetch, key = process.env.SUPABASE_SERVICE_KEY, now = Date.now() } = {}) {
  const cfg = JSON.parse(await readFile(JOBS_CFG, 'utf8'));
  const scfg = JSON.parse(await readFile(STUDIO_CFG, 'utf8'));
  if (!cfg.supabaseUrl) { console.log('supabaseUrl is empty in jobs-config.json — nothing to do.'); return { verified: 0 }; }
  if (!key) throw new Error('SUPABASE_SERVICE_KEY secret is not set.');
  const base = cfg.supabaseUrl.replace(/\/$/, '') + '/rest/v1/studio_exports';
  const H = { apikey: key, authorization: 'Bearer ' + key, 'content-type': 'application/json' };
  const rpc = makeRpc(fetchImpl);
  const r = await fetchImpl(base + '?verified=eq.false&reject_reason=is.null&order=created_at.asc&limit=100', { headers: H });
  if (!r.ok) throw new Error('Supabase read failed: HTTP ' + r.status);
  const rows = await r.json();
  console.log(rows.length + ' export payment(s) waiting');
  let verified = 0, rejected = 0, pending = 0, dropped = 0;
  for (const row of rows) {
    const res = await verifyRow(row, cfg, scfg, rpc, now);
    if (res.status === 'verified') {
      const p = await fetchImpl(base + '?id=eq.' + row.id, { method: 'PATCH', headers: H, body: JSON.stringify({ verified: true, verified_at: new Date(now).toISOString() }) });
      if (!p.ok) { console.warn('  could not save row', row.id, p.status); continue; }
      verified++; console.log('  verified', row.id);
    } else if (res.status === 'rejected') {
      await fetchImpl(base + '?id=eq.' + row.id, { method: 'PATCH', headers: H, body: JSON.stringify({ reject_reason: String(res.reason).slice(0, 200) }) });
      rejected++; console.log('  rejected', row.id, res.reason);
    } else if (now - Date.parse(row.created_at) > MAX_AGE_MS) {
      await fetchImpl(base + '?id=eq.' + row.id, { method: 'PATCH', headers: H, body: JSON.stringify({ reject_reason: 'expired: ' + String(res.reason).slice(0, 150) }) });
      dropped++;
    } else { pending++; console.log('  waiting', row.id, res.reason); }
  }
  console.log({ verified, rejected, pending, dropped });
  return { verified, rejected, pending, dropped };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  run().catch(e => { console.error(e.message); process.exit(1); });
}
