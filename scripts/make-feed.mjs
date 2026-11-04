// Builds feed.xml (RSS) from news.json. Run by the news workflow after fetch-news.mjs.
import { readFileSync, writeFileSync } from 'node:fs';
const esc = s => String(s ?? '').replace(/[<>&"']/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' }[c]));
export function buildFeed(news) {
  const items = (news.items || []).slice(0, 40).map(i =>
    `<item><title>${esc(i.headline)}</title><link>${esc(i.url)}</link><guid isPermaLink="false">${esc(i.id)}</guid>` +
    `<pubDate>${new Date(i.published).toUTCString()}</pubDate><category>${esc(i.category || 'Other')}</category>` +
    `<description>${esc(i.summary)} (Source: ${esc(i.source)})</description></item>`).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<rss version="2.0"><channel><title>Crypto Asia news</title><link>https://cryptoasiabtc.com/</link>` +
    `<description>Short crypto news briefs with links to the original publishers.</description><language>en</language>\n${items}\n</channel></rss>\n`;
}
if (import.meta.url === `file://${process.argv[1]}`) {
  let n = { items: [] }; try { n = JSON.parse(readFileSync('news.json', 'utf8')); } catch {}
  writeFileSync('feed.xml', buildFeed(n));
  console.log('feed.xml written');
}
