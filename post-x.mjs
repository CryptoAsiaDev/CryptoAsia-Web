// Posts the biggest recent news story to X (@CryptoAsiaBTC). Run on a schedule (see .github/workflows/post-x.yml).
// Secrets: ANTHROPIC_API_KEY, X_API_KEY, X_API_SECRET, X_ACCESS_TOKEN, X_ACCESS_SECRET
// Options (env): DRY_RUN=true (write the tweet but do not post), X_INCLUDE_LINK=true (add the article link; X charges more for posts with links),
//                MAX_PER_DAY (default 6), NEWS_MODEL
import { readFileSync, writeFileSync, existsSync, mkdirSync, appendFileSync } from 'node:fs';
import { createHmac, randomBytes } from 'node:crypto';

const MODEL = process.env.NEWS_MODEL || 'claude-haiku-5-5';
const LOG = 'data/x-posted.json';
const enc = s => encodeURIComponent(s).replace(/[!'()*]/g, c => '%' + c.charCodeAt(0).toString(16).toUpperCase());

export function oauthHeader(method, url, creds, nonce = randomBytes(16).toString('hex'), ts = Math.floor(Date.now() / 1000)) {
  const p = { oauth_consumer_key: creds.key, oauth_nonce: nonce, oauth_signature_method: 'HMAC-SHA1', oauth_timestamp: String(ts), oauth_token: creds.token, oauth_version: '1.0' };
  const base = [method.toUpperCase(), enc(url), enc(Object.keys(p).sort().map(k => enc(k) + '=' + enc(p[k])).join('&'))].join('&');
  p.oauth_signature = createHmac('sha1', enc(creds.secret) + '&' + enc(creds.tokenSecret)).update(base).digest('base64');
  return 'OAuth ' + Object.keys(p).sort().map(k => enc(k) + '="' + enc(p[k]) + '"').join(', ');
}

export async function pickAndWrite(cands, apiKey, includeLink, fetchFn = fetch) {
  const sys = `You run the X account of Crypto Asia, an Asia-focused crypto news brand. From the list of recent stories, pick the ONE that matters most to crypto readers (big market moves, major regulation, big exchange or protocol news, notable airdrops; Asia stories get a slight boost). Then write one tweet about it.
Rules: max 240 characters. Plain, factual, no hype, no emojis spam (at most one emoji). Do not invent facts beyond the story. ${includeLink ? 'Do not include a link; it is added for you.' : 'Do not include any link or URL.'} End with the source as "via <source>" and 1 or 2 relevant hashtags.
Reply with JSON only: {"id": "<story id>", "tweet": "<text>"}`;
  const res = await fetchFn('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model: MODEL, max_tokens: 400, system: sys, messages: [{ role: 'user', content: JSON.stringify(cands.map(c => ({ id: c.id, headline: c.headline, summary: c.summary, source: c.source, category: c.category }))) }] }),
  });
  if (!res.ok) throw new Error(`Claude API ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const raw = ((await res.json()).content || []).map(b => b.text || '').join('');
  const a = raw.indexOf('{'), b = raw.lastIndexOf('}'); if (a < 0 || b < a) throw new Error('No JSON in model reply');
  const j = JSON.parse(raw.slice(a, b + 1));
  const story = cands.find(c => String(c.id) === String(j.id)); if (!story) throw new Error('Model chose an unknown story');
  let tweet = String(j.tweet || '').replace(/https?:\/\/\S+/g, '').replace(/\s+\n/g, '\n').trim();
  if (!tweet) throw new Error('Empty tweet');
  if (includeLink) tweet += '\n' + story.url;            // X counts any link as 23 characters
  const len = includeLink ? tweet.length - story.url.length + 23 : tweet.length;
  if (len > 280) throw new Error('Tweet too long (' + len + ')');
  return { story, tweet };
}

export async function postTweet(text, creds, fetchFn = fetch) {
  const url = 'https://api.x.com/2/tweets';
  const r = await fetchFn(url, { method: 'POST', headers: { Authorization: oauthHeader('POST', url, creds), 'content-type': 'application/json' }, body: JSON.stringify({ text }) });
  const body = await r.text();
  if (!r.ok) throw new Error(`X API ${r.status}: ${body.slice(0, 300)}`);
  return JSON.parse(body).data;
}

export async function run(env = process.env, fetchFn = fetch, now = new Date()) {
  const log = existsSync(LOG) ? JSON.parse(readFileSync(LOG, 'utf8')) : [];
  const today = new Date(now.getTime() + 8 * 3600000).toISOString().slice(0, 10);
  const todays = log.filter(l => l.kl_day === today).length;
  const cap = +(env.MAX_PER_DAY || 6);
  if (todays >= cap) { console.log(`Already posted ${todays} today (cap ${cap}).`); return null; }
  const items = (JSON.parse(readFileSync('news.json', 'utf8')).items || []);
  const seen = new Set(log.map(l => String(l.story_id)));
  const cutoff = now.getTime() - 24 * 3600000;
  const cands = items.filter(i => !seen.has(String(i.id)) && Date.parse(i.published) >= cutoff).slice(0, 15);
  if (!cands.length) { console.log('No fresh unposted stories.'); return null; }
  const { story, tweet } = await pickAndWrite(cands, env.ANTHROPIC_API_KEY, env.X_INCLUDE_LINK === 'true', fetchFn);
  console.log('Tweet:\n' + tweet + '\n(story: ' + story.headline + ')');
  let tid = 'dry-run';
  if (env.DRY_RUN !== 'true') {
    const creds = { key: env.X_API_KEY, secret: env.X_API_SECRET, token: env.X_ACCESS_TOKEN, tokenSecret: env.X_ACCESS_SECRET };
    if (!creds.key || !creds.secret || !creds.token || !creds.tokenSecret) throw new Error('X credentials are missing (X_API_KEY, X_API_SECRET, X_ACCESS_TOKEN, X_ACCESS_SECRET).');
    tid = (await postTweet(tweet, creds, fetchFn)).id;
    console.log('Posted: https://x.com/CryptoAsiaBTC/status/' + tid);
  }
  log.push({ story_id: story.id, tweet_id: tid, kl_day: today, at: now.toISOString(), text: tweet });
  mkdirSync('data', { recursive: true });
  writeFileSync(LOG, JSON.stringify(log.slice(-500), null, 1));
  if (env.GITHUB_STEP_SUMMARY) appendFileSync(env.GITHUB_STEP_SUMMARY, `### Tweet ${env.DRY_RUN === 'true' ? '(dry run, not posted)' : 'posted'}\n\n${tweet}\n`);
  return { tweet, tid };
}
if (import.meta.url === `file://${process.argv[1]}`) run().catch(e => { console.error(e.message); process.exit(1); });
