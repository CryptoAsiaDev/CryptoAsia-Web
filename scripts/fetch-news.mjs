// Crypto Asia news pipeline.
// 1. Reads the public RSS feeds listed in scripts/feeds.json
// 2. Finds stories we have not published yet
// 3. Asks Claude to write a SHORT, ORIGINAL brief from the headline + excerpt (never the full article)
// 4. Saves the briefs to news.json, each with a link back to the original publisher
//
// Run by .github/workflows/news.yml every 30 minutes. Needs the secret ANTHROPIC_API_KEY.

import { readFile, writeFile, rename } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { XMLParser } from 'fast-xml-parser';

const FEEDS_PATH = new URL('./feeds.json', import.meta.url);
const OUT_PATH = new URL('../news.json', import.meta.url);

const MODEL = process.env.NEWS_MODEL || 'claude-haiku-5-5';
const MAX_NEW = Number(process.env.NEWS_MAX_NEW || 12);      // new briefs written per run (controls cost)
const KEEP = Number(process.env.NEWS_KEEP || 80);            // how many briefs stay on the site
const PER_FEED = Number(process.env.NEWS_PER_FEED || 8);     // newest items read from each feed
const MAX_AGE_HOURS = Number(process.env.NEWS_MAX_AGE_HOURS || 72);
const UA = 'CryptoAsiaNewsBot/1.0 (+https://cryptoasia.net)';

export const CATEGORIES = ['Airdrops','Bitcoin','Ethereum','Altcoins','DeFi','NFTs & Ordinals','Regulation','Markets','Exchanges','Tech','Asia','Other'];
const MAX_IMAGE_LOOKUPS = Number(process.env.NEWS_MAX_IMAGE_LOOKUPS || 10);   // article-page lookups per run (new + backfill)

/* ---------- helpers ---------- */
export function decodeEntities(s) {
  return String(s)
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&nbsp;/g, ' ').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
}
export function stripHtml(s = '') {
  return decodeEntities(String(s).replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
}
function text(v) {
  if (v == null) return '';
  if (typeof v === 'object') return v['#text'] != null ? String(v['#text']) : '';
  return String(v);
}
export function makeId(url) {
  return createHash('sha1').update(url.replace(/[?#].*$/, '')).digest('hex').slice(0, 16);
}
export function normTitle(t) {
  return t.toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim();
}

/* ---------- image from the feed item (stored, shown only if the site switch is on) ---------- */
function pickImage(it, html) {
  const arr = v => (v == null ? [] : [].concat(v));
  const cands = [
    ...arr(it['media:content']).map(m => m && m['@_url']),
    ...arr(it['media:thumbnail']).map(m => m && m['@_url']),
    ...arr(it.enclosure).filter(e => e && /^image\//i.test(e['@_type'] || '')).map(e => e['@_url'])
  ];
  const m = /<img[^>]+src=["']([^"']+)["']/i.exec(html || '');
  if (m) cands.push(m[1]);
  const u = cands.find(x => typeof x === 'string' && /^https:\/\//i.test(x));
  return u ? u.slice(0, 500) : '';
}

/* ---------- RSS / Atom parsing ---------- */
export function parseFeed(xml, source) {
  const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_', textNodeName: '#text' });
  const doc = parser.parse(xml);
  const out = [];
  const push = (title, link, snippet, published, image = '') => {
    title = stripHtml(title);
    link = String(link || '').trim();
    if (!title || !/^https?:\/\//i.test(link)) return;
    const d = new Date(published);
    out.push({
      title, link, source,
      snippet: stripHtml(snippet).slice(0, 600),
      image,
      published: isNaN(d) ? new Date().toISOString() : d.toISOString()
    });
  };
  if (doc?.rss?.channel) {
    for (const it of [].concat(doc.rss.channel.item || [])) {
      const body = text(it['content:encoded']) || text(it.description);
      push(text(it.title), text(it.link) || text(it.guid),
           text(it.description) || body, text(it.pubDate) || text(it['dc:date']), pickImage(it, body));
    }
  } else if (doc?.feed) {
    for (const e of [].concat(doc.feed.entry || [])) {
      const links = [].concat(e.link || []);
      const alt = links.find(l => l['@_rel'] === 'alternate') || links[0] || {};
      push(text(e.title), alt['@_href'], text(e.summary) || text(e.content), text(e.published) || text(e.updated));
    }
  }
  return out.sort((a, b) => b.published.localeCompare(a.published));
}

/* ---------- Claude: write an original brief ---------- */
const SYSTEM = `You write short, original news briefs for a crypto news website.
You are given only a headline and a short excerpt from another publication.
Rules:
- Write in your own words. Never copy a run of more than 4 words from the source.
- Use only facts that appear in the headline or excerpt. Do not add numbers, quotes, names or background that are not given.
- If the excerpt is thin, write one sentence instead of two.
- Neutral tone. No hype, no price predictions, no advice to buy or sell.
- Decide whether the story is really about crypto, blockchain, digital assets or their regulation or markets.
- Use the category "Airdrops" for any story about an airdrop, token distribution to users, points programs, retroactive rewards, claims or eligibility, even if another category could also fit.
Reply with JSON only, in this exact shape:
{"relevant": true|false, "headline": "max 12 words, your own words", "summary": "1-2 sentences, max 45 words", "category": "one of: ${CATEGORIES.join(' | ')}"}`;

export async function summarise(item, apiKey, fetchImpl = fetch) {
  const res = await fetchImpl('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 300,
      system: SYSTEM,
      messages: [{ role: 'user', content: JSON.stringify({ publication: item.source, headline: item.title, excerpt: item.snippet }) }]
    })
  });
  if (!res.ok) throw new Error(`Claude API ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = await res.json();
  const raw = (data.content || []).map(b => b.text || '').join('');
  const a = raw.indexOf('{'), b = raw.lastIndexOf('}');
  if (a < 0 || b < a) throw new Error('No JSON in model reply');
  const j = JSON.parse(raw.slice(a, b + 1));
  const headline = String(j.headline || '').trim();
  const summary = String(j.summary || '').trim();
  if (!j.relevant || !headline || !summary) return null;
  return {
    headline: headline.slice(0, 140),
    summary: summary.slice(0, 400),
    category: CATEGORIES.includes(j.category) ? j.category : 'Other'
  };
}

/* ---------- thumbnail: the article's own social-preview image ---------- */
export function extractOgImage(html, pageUrl) {
  const m = /<meta[^>]+(?:property|name)=["'](?:og:image(?::secure_url)?|twitter:image)["'][^>]*>/i.exec(html)
         || /<meta[^>]+content=["'][^"']+["'][^>]+(?:property|name)=["'](?:og:image|twitter:image)["'][^>]*>/i.exec(html);
  if (!m) return '';
  const c = /content=["']([^"']+)["']/i.exec(m[0]);
  if (!c) return '';
  try {
    const u = new URL(decodeEntities(c[1]), pageUrl);
    return u.protocol === 'https:' ? u.href.slice(0, 500) : '';
  } catch { return ''; }
}
export async function fetchOgImage(url, fetchImpl = fetch) {
  try {
    const r = await fetchImpl(url, { headers: { 'user-agent': UA, accept: 'text/html' }, signal: AbortSignal.timeout(12000), redirect: 'follow' });
    if (!r.ok) return '';
    const html = (await r.text()).slice(0, 200000);      // the <head> is at the top
    return extractOgImage(html, url);
  } catch { return ''; }
}

/* ---------- main ---------- */
async function readJson(url, fallback) {
  try { return JSON.parse(await readFile(url, 'utf8')); } catch { return fallback; }
}

export async function run({ fetchImpl = fetch, apiKey = process.env.ANTHROPIC_API_KEY, now = new Date() } = {}) {
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY is not set. Add it under Settings → Secrets and variables → Actions.');

  const feeds = await readJson(FEEDS_PATH, []);
  const existing = await readJson(OUT_PATH, { items: [] });
  const realExisting = (existing.items || []).filter(i => !i.sample);
  const skippedIds = existing.skipped || [];
  const knownIds = new Set([...realExisting.map(i => i.id), ...skippedIds]);
  const knownTitles = new Set(realExisting.map(i => normTitle(i.sourceTitle || i.headline)));

  // 1. collect candidates
  const cutoff = now.getTime() - MAX_AGE_HOURS * 3600 * 1000;
  const candidates = [];
  for (const f of feeds) {
    try {
      const r = await fetchImpl(f.url, { headers: { 'user-agent': UA, accept: 'application/rss+xml, application/xml, text/xml, */*' }, signal: AbortSignal.timeout(15000) });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const items = parseFeed(await r.text(), f.name).slice(0, PER_FEED);
      candidates.push(...items.filter(i => new Date(i.published).getTime() >= cutoff));
      console.log(`✔ ${f.name}: ${items.length} items`);
    } catch (e) {
      console.warn(`✘ ${f.name}: ${e.message}`);   // one broken feed never stops the run
    }
  }

  // 2. keep only new stories (by link, then by near-identical title across outlets)
  const seen = new Set();
  const fresh = [];
  for (const c of candidates.sort((a, b) => b.published.localeCompare(a.published))) {
    const id = makeId(c.link), nt = normTitle(c.title);
    if (knownIds.has(id) || knownTitles.has(nt) || seen.has(nt)) continue;
    seen.add(nt);
    fresh.push({ ...c, id });
  }
  const batch = fresh.slice(0, MAX_NEW);
  console.log(`${candidates.length} recent items, ${fresh.length} new, writing ${batch.length}`);

  // 3. write briefs
  const written = [];
  const newSkipped = [];
  let lookups = 0;
  for (const item of batch) {
    try {
      const brief = await summarise(item, apiKey, fetchImpl);
      if (!brief) { console.log('  skipped (not crypto):', item.title.slice(0, 60)); newSkipped.push(item.id); continue; }
      let image = item.image || '';
      if (!image && lookups < MAX_IMAGE_LOOKUPS) { lookups++; image = await fetchOgImage(item.link, fetchImpl); }
      written.push({
        id: item.id,
        headline: brief.headline,
        summary: brief.summary,
        category: brief.category,
        source: item.source,
        url: item.link,
        published: item.published,
        image,
        sourceTitle: item.title        // used only to avoid duplicates; the page never shows it
      });
    } catch (e) {
      console.warn('  brief failed:', e.message);   // never publish raw text if the brief fails
    }
  }

  // 3b. older briefs that never had a thumbnail lookup: try a few per run, then mark them as tried
  let backfilled = 0;
  for (const it of realExisting) {
    if (lookups >= MAX_IMAGE_LOOKUPS) break;
    if (it.image !== undefined || !it.url) continue;
    lookups++;
    it.image = await fetchOgImage(it.url, fetchImpl);   // '' = tried, none found
    backfilled++;
  }

  // 4. save (only when something changed, so we do not create empty commits)
  if (!written.length && !newSkipped.length && !backfilled) { console.log('Nothing new to publish.'); return { written: 0 }; }
  const items = [...written, ...realExisting]
    .sort((a, b) => b.published.localeCompare(a.published))
    .slice(0, KEEP);
  const payload = JSON.stringify({ updated: now.toISOString(), skipped: [...newSkipped, ...skippedIds].slice(0, 300), items }, null, 2) + '\n';
  JSON.parse(payload);                                  // never write a broken file
  const tmp = new URL('../news.json.tmp', import.meta.url);
  await writeFile(tmp, payload);
  await rename(tmp, OUT_PATH);                          // swap in one step, so the site never reads a half-written file
  console.log(`Published ${written.length} new brief(s). Total on site: ${items.length}`);
  return { written: written.length };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  run().catch(e => { console.error(e.message); process.exit(1); });
}
