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
  const ask = async (extra) => {
    const res = await fetchFn('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: MODEL, max_tokens: 800, system: sys + extra, messages: [{ role: 'user', content: JSON.stringify(cands.map(c => ({ id: c.id, headline: c.headline, summary: c.summary, source: c.source, category: c.category }))) }] }),
    });
    if (!res.ok) throw new Error(`Claude API ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const raw = ((await res.json()).content || []).map(b => b.text || '').join('');
    const a = raw.indexOf('{'), b = raw.lastIndexOf('}');
    if (a < 0 || b < a) { console.warn('Model reply had no JSON. First 300 characters: ' + raw.slice(0, 300)); return null; }
    try { return JSON.parse(raw.slice(a, b + 1)); } catch (e) { console.warn('Model JSON could not be parsed: ' + raw.slice(0, 300)); return null; }
  };
  let j = await ask('');
  if (!j) j = await ask('\nIMPORTANT: your whole reply must be one JSON object and nothing else. Start with { and end with }.');
  let story = j && cands.find(c => String(c.id) === String(j.id));
  let tweet = j ? String(j.tweet || '') : '';
  if (!story || !tweet.trim()) {                        // fallback: newest story, written from its own headline (no AI)
    console.warn('Using the fallback: newest story headline.');
    story = cands[0];
    tweet = `${story.headline}\nvia ${story.source}`;
  }
  tweet = tweet.replace(/https?:\/\/\S+/g, '').replace(/\s+\n/g, '\n').trim();
  if (!tweet) throw new Error('Empty tweet');
  if (tweet.length > 240) tweet = tweet.slice(0, 237).trimEnd() + '...';
  if (includeLink) tweet += '\n' + story.url;            // X counts any link as 23 characters
  const len = includeLink ? tweet.length - story.url.length + 23 : tweet.length;
  if (len > 280) throw new Error('Tweet too long (' + len + ')');
  return { story, tweet };
}

const MY_RE = /malaysia|malaysian|kuala lumpur|\bkl\b|ringgit|\bmyr\b|bursa|securities commission|bank negara|southeast asia|\basean\b|singapore|thailand|indonesia|vietnam|philippines/i;
export const isMalaysian = st => MY_RE.test(`${st.headline || ''} ${st.summary || ''}`);

// A separate, friendlier text for the Facebook Page (2-3 sentences). Falls back to the short post if the AI step fails.
export async function writeFacebookText(story, fallback, apiKey, fetchFn = fetch) {
  try {
    const my = isMalaysian(story);
    const sys = `You write Facebook Page posts for Crypto Asia, an Asia-focused crypto news brand run from Malaysia. Write ONE post about the story you are given.
Style: casual and conversational, like a friendly crypto-savvy friend sharing news. 2 to 3 short sentences in your own words, max 450 characters. Plain English, no corporate tone. At most one emoji. At most 2 relevant hashtags at the end. Do not start with "Breaking". Do not include any link.
Accuracy rules: use only facts from the headline and summary; never invent numbers, quotes or background. No hype, no price predictions, no advice to buy or sell.
${my ? 'This story involves Malaysia or Southeast Asia: add a short Malaysian angle, for example why Malaysian readers may care, but only if it follows from the story itself; a light, natural Malaysian touch (like "lah" or "boleh") is allowed at most once, never forced.' : 'Do not add any local-slang or Malaysia-specific angle; keep it a general, casual post.'}
Reply with JSON only: {"post": "<text>"}`;
    const res = await fetchFn('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: MODEL, max_tokens: 500, system: sys, messages: [{ role: 'user', content: JSON.stringify({ headline: story.headline, summary: story.summary, source: story.source }) }] }),
    });
    if (!res.ok) throw new Error('Claude API ' + res.status);
    const raw = ((await res.json()).content || []).map(b => b.text || '').join('');
    const a = raw.indexOf('{'), b = raw.lastIndexOf('}');
    let text = String(JSON.parse(raw.slice(a, b + 1)).post || '').replace(/https?:\/\/\S+/g, '').trim();
    if (text.length < 20) throw new Error('too short');
    if (text.length > 600) text = text.slice(0, 597).trimEnd() + '...';
    return `${text}\n\nSource: ${story.source}. More crypto news: https://cryptoasiabtc.com`;
  } catch (e) { console.warn('Facebook text fallback (' + e.message + ')'); return fallback; }
}

export async function postTweet(text, creds, fetchFn = fetch) {
  const url = 'https://api.x.com/2/tweets';
  const r = await fetchFn(url, { method: 'POST', headers: { Authorization: oauthHeader('POST', url, creds), 'content-type': 'application/json' }, body: JSON.stringify({ text }) });
  const body = await r.text();
  if (!r.ok) throw new Error(`X API ${r.status}: ${body.slice(0, 300)}`);
  return JSON.parse(body).data;
}

export async function postFacebook(text, link, env, fetchFn = fetch) {
  const body = new URLSearchParams({ message: text, link, access_token: env.FB_PAGE_TOKEN });
  const r = await fetchFn(`https://graph.facebook.com/v21.0/${encodeURIComponent(env.FB_PAGE_ID)}/feed`, { method: 'POST', body });
  const out = await r.text();
  if (!r.ok) throw new Error(`Facebook API ${r.status}: ${out.slice(0, 300)}`);
  return JSON.parse(out).id;
}

// Telegram group or channel (optional): needs TG_BOT_TOKEN and TG_CHAT_ID. Reuses the Facebook text, so no extra AI cost.
export async function postTelegram(text, env, fetchFn = fetch) {
  const r = await fetchFn(`https://api.telegram.org/bot${env.TG_BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ chat_id: env.TG_CHAT_ID, text: text.slice(0, 4000), disable_web_page_preview: false }),
  });
  const out = await r.text();
  if (!r.ok) throw new Error(`Telegram API ${r.status}: ${out.slice(0, 300).replace(env.TG_BOT_TOKEN, '***')}`);
  return String(JSON.parse(out).result?.message_id || '');
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
  let tid = 'dry-run', fbid = '', xErr = '', fbErr = '';
  if (env.DRY_RUN !== 'true') {
    const creds = { key: env.X_API_KEY, secret: env.X_API_SECRET, token: env.X_ACCESS_TOKEN, tokenSecret: env.X_ACCESS_SECRET };
    const haveX = creds.key && creds.secret && creds.token && creds.tokenSecret;
    if (!haveX && !(env.FB_PAGE_ID && env.FB_PAGE_TOKEN)) throw new Error('X credentials are missing (X_API_KEY, X_API_SECRET, X_ACCESS_TOKEN, X_ACCESS_SECRET).');
    if (haveX) {
      try { tid = (await postTweet(tweet, creds, fetchFn)).id; console.log('Posted: https://x.com/CryptoAsiaBTC/status/' + tid); }
      catch (e) { xErr = e.message; tid = 'x-failed'; console.warn('X post failed (Facebook will still be tried): ' + e.message); }
    } else { tid = 'x-skipped'; console.warn('X credentials missing, posting to Facebook only.'); }
  }
  // Facebook Page and Telegram (both optional). They share one friendlier text, written once.
  const wantFb = env.FB_PAGE_ID && env.FB_PAGE_TOKEN, wantTg = env.TG_BOT_TOKEN && env.TG_CHAT_ID;
  let tgid = '', tgErr = '';
  if ((wantFb || wantTg) && env.DRY_RUN !== 'true') {
    const fbText = await writeFacebookText(story, tweet, env.ANTHROPIC_API_KEY, fetchFn);
    console.log('Facebook/Telegram text:\n' + fbText);
    if (wantFb) {
      try { fbid = await postFacebook(fbText, story.url, env, fetchFn); console.log('Posted to Facebook: ' + fbid); }
      catch (e) { fbErr = e.message; console.warn('Facebook post failed (others are unaffected): ' + e.message); }
    }
    if (wantTg) {
      const body = fbText.split('\n\nSource: ')[0];
      try { tgid = await postTelegram(`${body}\n\nSource: ${story.source}\n${story.url}`, env, fetchFn); console.log('Posted to Telegram: ' + tgid); }
      catch (e) { tgErr = e.message; console.warn('Telegram post failed (others are unaffected): ' + e.message); }
    }
  }
  const posted = (tid !== 'dry-run' && !['x-failed', 'x-skipped'].includes(tid)) || fbid || tgid;
  if (env.DRY_RUN !== 'true' && !posted) throw new Error('Nothing was posted. ' + [xErr && 'X: ' + xErr, fbErr && 'Facebook: ' + fbErr, tgErr && 'Telegram: ' + tgErr].filter(Boolean).join(' | '));
  log.push({ story_id: story.id, tweet_id: tid, fb_id: fbid, tg_id: tgid, kl_day: today, at: now.toISOString(), text: tweet });
  mkdirSync('data', { recursive: true });
  writeFileSync(LOG, JSON.stringify(log.slice(-500), null, 1));
  if (env.GITHUB_STEP_SUMMARY) appendFileSync(env.GITHUB_STEP_SUMMARY, `### Tweet ${env.DRY_RUN === 'true' ? '(dry run, not posted)' : 'posted'}\n\n${tweet}\n`);
  return { tweet, tid };
}
if (import.meta.url === `file://${process.argv[1]}`) run().catch(e => { console.error(e.message); process.exit(1); });
